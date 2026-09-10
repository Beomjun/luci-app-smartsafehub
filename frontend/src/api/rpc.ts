import { probeLuciSession } from '../auth/session';
import {
  hasNotifiedSessionExpired,
  notifySessionExpired,
  SESSION_EXPIRED_MESSAGE,
} from '../auth/sessionEvents';
import type { SmartSafeHubBootstrap } from '../types/bootstrap';
import type { ApiResponse } from '../types/status';

const UBUS_STATUS_TEXT: Readonly<Record<number, string>> = {
  1: '잘못된 명령입니다.',
  2: '요청 인자가 올바르지 않습니다.',
  3: '요청한 메서드를 찾을 수 없습니다.',
  4: '요청한 리소스를 찾을 수 없습니다.',
  5: '응답 데이터가 없습니다.',
  6: '접근 권한이 없습니다.',
  7: '요청 시간이 초과되었습니다.',
  8: '지원하지 않는 기능입니다.',
  9: '장치에서 알 수 없는 오류가 발생했습니다.',
  10: '장치 연결이 끊어졌습니다.',
};

const DEFAULT_TIMEOUT_MS = 20_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60_000;

let requestId = 1;

export interface RpcCallOptions {
  timeoutMs?: number;
}

export class RpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
  }
}

function getBootstrap(): SmartSafeHubBootstrap {
  const bootstrap = window.__SMARTHUB_BOOTSTRAP__;

  if (!bootstrap?.sessionId || !bootstrap.rpcUrl) {
    throw new RpcError(
      'BOOTSTRAP_MISSING',
      'LuCI 세션 정보를 찾을 수 없습니다. 페이지를 새로고침해 주세요.',
    );
  }

  return bootstrap;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidResponse(): RpcError {
  return new RpcError(
    'INVALID_RESPONSE',
    '장치 API가 올바르지 않은 응답을 반환했습니다.',
  );
}

function normalizedTimeout(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_TIMEOUT_MS;
  }

  return Math.min(
    MAX_TIMEOUT_MS,
    Math.max(MIN_TIMEOUT_MS, Math.trunc(value)),
  );
}

function isAccessDenied(error: RpcError): boolean {
  const message = error.message.trim().toLowerCase();

  return (
    error.code === 'UBUS_6' ||
    error.code === 'JSON_RPC_-32002' ||
    (error.code === 'HTTP_ERROR' && /HTTP (401|403)\b/.test(error.message)) ||
    message.includes('access denied') ||
    message.includes('permission denied') ||
    message.includes('접근 권한')
  );
}

let pendingSessionProbe: {
  sessionId: string;
  promise: Promise<string | null>;
} | null = null;

function currentSessionMatches(sessionId: string): boolean {
  return window.__SMARTHUB_BOOTSTRAP__?.sessionId === sessionId;
}

function probeCurrentSession(sessionId: string): Promise<string | null> {
  if (pendingSessionProbe?.sessionId === sessionId) {
    return pendingSessionProbe.promise;
  }

  const promise = probeLuciSession().finally(() => {
    if (pendingSessionProbe?.promise === promise) {
      pendingSessionProbe = null;
    }
  });

  pendingSessionProbe = { sessionId, promise };
  return promise;
}

async function sessionExpiryError(
  error: RpcError,
  sessionId: string,
): Promise<RpcError> {
  if (!isAccessDenied(error)) {
    return error;
  }

  if (!currentSessionMatches(sessionId)) {
    return error;
  }

  if (hasNotifiedSessionExpired(sessionId)) {
    return new RpcError('SESSION_EXPIRED', SESSION_EXPIRED_MESSAGE);
  }

  let activeSessionId: string | null;

  try {
    activeSessionId = await probeCurrentSession(sessionId);
  } catch {
    // Do not mistake a temporary session-probe/network failure for expiry.
    return error;
  }

  // Another login may have completed while this request was probing. Ignore
  // stale failures from the previous bootstrap session in that case.
  if (!currentSessionMatches(sessionId)) {
    return error;
  }

  // A session probe must confirm the exact bootstrap session. Merely receiving
  // any valid LuCI session id is insufficient: LuCI may have replaced the
  // cookie/session while in-flight RPC requests still carry the stale id.
  if (activeSessionId === sessionId) {
    return error;
  }

  notifySessionExpired(sessionId);
  return new RpcError('SESSION_EXPIRED', SESSION_EXPIRED_MESSAGE);
}

function parseJsonRpcResponse<T>(payload: unknown, requestIdentifier: number): T {
  if (
    !isObject(payload) ||
    payload.jsonrpc !== '2.0' ||
    payload.id !== requestIdentifier
  ) {
    throw invalidResponse();
  }

  if ('error' in payload) {
    const error = payload.error;

    if (!isObject(error) || typeof error.code !== 'number') {
      throw invalidResponse();
    }

    throw new RpcError(
      `JSON_RPC_${error.code}`,
      typeof error.message === 'string' && error.message.length > 0
        ? error.message
        : 'JSON-RPC 요청에 실패했습니다.',
    );
  }

  const result = payload.result;

  if (!Array.isArray(result) || result.length < 1 || result.length > 2) {
    throw invalidResponse();
  }

  const status = result[0];

  if (typeof status !== 'number' || !Number.isInteger(status)) {
    throw invalidResponse();
  }

  if (status !== 0) {
    throw new RpcError(
      `UBUS_${status}`,
      UBUS_STATUS_TEXT[status] ?? `ubus 오류 코드 ${status}가 반환되었습니다.`,
    );
  }

  if (result.length < 2 || result[1] === undefined) {
    throw new RpcError('EMPTY_RESPONSE', '장치 API 응답이 비어 있습니다.');
  }

  return result[1] as T;
}

export async function callRpc<T>(
  object: string,
  method: string,
  params: Record<string, unknown> = {},
  options: RpcCallOptions = {},
): Promise<T> {
  const bootstrap = getBootstrap();
  const id = requestId++;
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    normalizedTimeout(options.timeoutMs),
  );

  try {
    const response = await fetch(bootstrap.rpcUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'call',
        params: [bootstrap.sessionId, object, method, params],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new RpcError(
        'HTTP_ERROR',
        `장치 API가 HTTP ${response.status} 오류를 반환했습니다.`,
      );
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      throw invalidResponse();
    }

    return parseJsonRpcResponse<T>(payload, id);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new RpcError(
        'RPC_TIMEOUT',
        '장치 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.',
      );
    }

    if (error instanceof RpcError) {
      throw await sessionExpiryError(error, bootstrap.sessionId);
    }

    throw new RpcError(
      'NETWORK_ERROR',
      '공유기와 통신할 수 없습니다. 네트워크 연결을 확인해 주세요.',
    );
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function callApi<T>(
  object: string,
  method: string,
  params: Record<string, unknown> = {},
  options: RpcCallOptions = {},
): Promise<T> {
  const bootstrap = getBootstrap();
  const response = await callRpc<ApiResponse<T>>(object, method, params, options);

  if (!response.ok) {
    throw await sessionExpiryError(
      new RpcError(response.error.code, response.error.message),
      bootstrap.sessionId,
    );
  }

  return response.data;
}
