// SPDX-License-Identifier: GPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('../..', import.meta.url));
const rpcSource = readFileSync(`${rootDir}/frontend/src/api/rpc.ts`, 'utf8');

function functionBody(source, signature, nextSignature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing function: ${signature}`);
  const bodyStart = source.indexOf('{', start) + 1;
  const end = source.indexOf(nextSignature, bodyStart);
  assert.notEqual(end, -1, `missing function terminator for: ${signature}`);
  return source.slice(bodyStart, end).replace(/}\s*$/, '');
}

const accessDeniedBody = functionBody(
  rpcSource,
  'function isAccessDenied(error: RpcError): boolean',
  '\n\nfunction currentSessionMatches',
);
const isAccessDenied = new Function('error', `'use strict';\n${accessDeniedBody}`);

for (const error of [
  { code: 'UBUS_6', message: '접근 권한이 없습니다.' },
  { code: 'JSON_RPC_-32002', message: 'Permission denied' },
  { code: 'HTTP_ERROR', message: '장치 API가 HTTP 401 오류를 반환했습니다.' },
  { code: 'HTTP_ERROR', message: '장치 API가 HTTP 403 오류를 반환했습니다.' },
  { code: 'OTHER', message: 'Access denied' },
  { code: 'OTHER', message: 'permission denied' },
  { code: 'OTHER', message: '접근 권한이 없습니다.' },
]) {
  assert.equal(isAccessDenied(error), true, `must recognize access denial: ${error.code} / ${error.message}`);
}

for (const error of [
  { code: 'UBUS_7', message: '요청 시간이 초과되었습니다.' },
  { code: 'HTTP_ERROR', message: '장치 API가 HTTP 500 오류를 반환했습니다.' },
  { code: 'NETWORK_ERROR', message: '공유기와 통신할 수 없습니다.' },
  { code: 'OTHER', message: 'request rejected for another reason' },
]) {
  assert.equal(isAccessDenied(error), false, `must not expire session for unrelated failure: ${error.code}`);
}

const expiryBody = functionBody(
  rpcSource,
  'function sessionExpiryError(error: RpcError, sessionId: string): RpcError',
  '\n\nfunction parseJsonRpcResponse',
);

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function evaluateExpiry({ error, requestSessionId, currentSessionId }) {
  const notifications = [];
  const currentSessionMatches = (sessionId) => sessionId === currentSessionId;
  const notifySessionExpired = (sessionId) => notifications.push(sessionId);
  const execute = new Function(
    'error',
    'sessionId',
    'isAccessDenied',
    'currentSessionMatches',
    'notifySessionExpired',
    'RpcError',
    'SESSION_EXPIRED_MESSAGE',
    `'use strict';\n${expiryBody}`,
  );
  const result = execute(
    error,
    requestSessionId,
    isAccessDenied,
    currentSessionMatches,
    notifySessionExpired,
    RpcError,
    'expired',
  );
  return { result, notifications };
}

{
  const original = new RpcError('UBUS_6', '접근 권한이 없습니다.');
  const { result, notifications } = evaluateExpiry({
    error: original,
    requestSessionId: 'session-a',
    currentSessionId: 'session-a',
  });
  assert.equal(result.code, 'SESSION_EXPIRED');
  assert.deepEqual(notifications, ['session-a']);
}

{
  const original = new RpcError('UBUS_6', '접근 권한이 없습니다.');
  const { result, notifications } = evaluateExpiry({
    error: original,
    requestSessionId: 'stale-session',
    currentSessionId: 'new-session',
  });
  assert.equal(result, original, 'a late failure from a stale request must not expire the new session');
  assert.deepEqual(notifications, []);
}

{
  const original = new RpcError('NETWORK_ERROR', 'network down');
  const { result, notifications } = evaluateExpiry({
    error: original,
    requestSessionId: 'session-a',
    currentSessionId: 'session-a',
  });
  assert.equal(result, original, 'non-authentication failures must stay ordinary RPC errors');
  assert.deepEqual(notifications, []);
}

assert.equal(
  rpcSource.includes('probeCurrentSession'),
  false,
  'Access denied recovery must not re-probe a potentially stale LuCI session',
);
assert.equal(
  rpcSource.includes('probeLuciSession'),
  false,
  'RPC layer must not start a second session-validation loop',
);

console.log('PASS: RPC access-denied classification expires only the active session without re-probing');
