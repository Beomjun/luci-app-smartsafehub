#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
PAGE="$ROOT_DIR/frontend/src/pages/SafeShieldPage.tsx"
PANEL="$ROOT_DIR/frontend/src/components/SafeShieldStatisticsPanel.tsx"
NAVIGATION="$ROOT_DIR/frontend/src/components/ProductNavigation.tsx"
ASSET_JS="$ROOT_DIR/root/www/luci-static/smartsafehub/app.js"
ASSET_CSS="$ROOT_DIR/root/www/luci-static/smartsafehub/app.css"

fail() {
	echo "FAIL: $*" >&2
	exit 1
}

for file in "$PAGE" "$PANEL" "$NAVIGATION" "$ASSET_JS" "$ASSET_CSS"; do
	[ -f "$file" ] || fail "missing SafeShield product UI source: ${file#$ROOT_DIR/}"
done

grep -Fq 'SafeShield 보호 상태' "$PAGE" || \
	fail 'SafeShield page must lead with the protection status'
grep -Fq 'eyebrow="Protection details"' "$PAGE" || \
	fail 'SafeShield page must provide a dedicated protection details section'
grep -Fq 'title="보호 구성"' "$PAGE" || \
	fail 'SafeShield page must group runtime, blocklist, refresh and health details'
grep -Fq 'eyebrow="Settings"' "$PAGE" || \
	fail 'SafeShield page must provide a dedicated settings section'
grep -Fq 'title="SafeShield 설정"' "$PAGE" || \
	fail 'SafeShield settings section must be clearly labeled'
grep -Fq '라이선스' "$PAGE" || fail 'SafeShield settings must retain license management'
grep -Fq 'Custom rules' "$PAGE" || fail 'SafeShield settings must expose product-facing custom rules'
grep -Fq 'href="#rules"' "$PAGE" || fail 'SafeShield settings must link to the user rules page'
if grep -Fq 'data.localOverrides.allowlistPath' "$PAGE" || grep -Fq 'data.localOverrides.blocklistPath' "$PAGE"; then
	fail 'SafeShield product UI must not expose internal local rule file paths'
fi

grep -Fq 'px-5 pb-5 sm:px-6 sm:pb-6' "$PAGE" || \
	fail 'SafeShield summary facts must remain visually inside the protection card'
grep -Fq 'class="bg-white px-5 py-4 sm:px-6"' "$PAGE" || \
	fail 'SafeShield summary fact cells must use the protection card surface color'
grep -Fq 'border-2 border-slate-300 bg-slate-50' "$PAGE" || \
	fail 'SafeShield license key field must remain visually recognizable as an input'
grep -Fq 'border border-slate-300 bg-slate-100' "$PAGE" || \
	fail 'SafeShield current license key action must remain recognizable as a button'
grep -Fq 'border border-teal-700 bg-teal-700' "$PAGE" || \
	fail 'SafeShield custom rules action must remain recognizable as a primary button'

grep -Fq 'const DISPLAY_HOURS = 24;' "$PANEL" || \
	fail 'SafeShield activity must continue to use 24 hourly buckets'
grep -Fq 'const recentTotals = buckets.reduce(' "$PANEL" || \
	fail 'SafeShield activity must derive recent totals from the displayed 24-hour buckets'
grep -Fq '최근 24시간 DNS 요청' "$PANEL" || \
	fail 'SafeShield activity must label recent DNS query totals accurately'
grep -Fq '최근 24시간 차단' "$PANEL" || \
	fail 'SafeShield activity must label recent blocked totals accurately'
grep -Fq '최근 24시간 차단율' "$PANEL" || \
	fail 'SafeShield activity must expose the recent block rate'
grep -Fq '수집 누적 DNS 요청' "$PANEL" || \
	fail 'SafeShield activity must preserve collector lifetime totals as secondary metadata'
grep -Fq "targetEnabled ? 'left-6' : 'left-1'" "$PANEL" || \
	fail 'SafeShield statistics switch thumb must use explicit left positioning for reliable alignment'
grep -Fq 'ssh-switch-control' "$PANEL" || \
	fail 'SafeShield statistics switch must use fixed shared geometry on narrow screens'
grep -Fq 'ssh-switch-thumb' "$PANEL" || \
	fail 'SafeShield statistics switch thumb must use the theme-safe shared circle style'
if grep -Fq "targetEnabled ? 'translate-x-6' : 'translate-x-1'" "$PANEL"; then
	fail 'SafeShield statistics switch thumb must not rely on translate positioning'
fi

REFRESH_MODEL="$ROOT_DIR/frontend/src/utils/safeshieldRefresh.ts"
[ -f "$REFRESH_MODEL" ] || fail 'missing SafeShield refresh presentation model'

grep -Fq "label: '갱신 준비'" "$REFRESH_MODEL" || \
	fail 'SafeShield refresh UI must start with a user-facing preparation step'
grep -Fq "label: '최신 차단 목록 확인'" "$REFRESH_MODEL" || \
	fail 'SafeShield refresh UI must translate resolve_api into a user-facing step'
grep -Fq "label: '차단 목록 다운로드'" "$REFRESH_MODEL" || \
	fail 'SafeShield refresh UI must expose a download step'
grep -Fq "label: '사용자 규칙 적용'" "$REFRESH_MODEL" || \
	fail 'SafeShield refresh UI must expose a custom-rule step'
grep -Fq "label: '보호 규칙 적용'" "$REFRESH_MODEL" || \
	fail 'SafeShield refresh UI must expose an install step'
grep -Fq "label: '보호 상태 확인'" "$REFRESH_MODEL" || \
	fail 'SafeShield refresh UI must end with a protection verification step'
grep -Fq "stages: ['resolve_api']" "$REFRESH_MODEL" || \
	fail 'resolve_api must map to the latest blocklist lookup step'
grep -Fq "stages: ['runtime_check', 'blocklist_verify']" "$REFRESH_MODEL" || \
	fail 'runtime verification stages must map to the final user-facing step'
grep -Fq 'getSafeShieldRefreshErrorMessage' "$REFRESH_MODEL" || \
	fail 'SafeShield refresh failures must have user-facing error explanations'

grep -Fq 'function RefreshDonut' "$PAGE" || \
	fail 'SafeShield page must render compact donut progress for refresh stages'
grep -Fq 'role="progressbar"' "$PAGE" || \
	fail 'SafeShield refresh donut must expose accessible progress semantics'
grep -Fq 'function RefreshProgress' "$PAGE" || \
	fail 'SafeShield page must render the current user-facing refresh step'
grep -Fq '<RefreshProgress data={data} />' "$PAGE" || \
	fail 'SafeShield protection summary must include refresh progress'
grep -Fq '<SummaryFact label="Protection" value={getProtectionSummaryLabel(data)} />' "$PAGE" || \
	fail 'SafeShield protection fact must stay separate from refresh operation status'
if grep -Fq '현재 단계: ${data.stage}' "$PAGE" || grep -Fq '· ${data.stage}' "$PAGE"; then
	fail 'SafeShield summary must not expose internal refresh stage names'
fi

grep -Fq 'lastKnownBlocklistCount' "$PAGE" || \
	fail 'SafeShield summary must retain the last known blocklist count during transient refresh data'

grep -Fq 'ssh-safeshield-refresh-donut' "$ASSET_JS" || \
	fail 'checked-in app.js must include SafeShield donut refresh progress'
grep -Fq '최신 차단 목록 확인' "$ASSET_JS" || \
	fail 'checked-in app.js must include user-facing SafeShield refresh stage labels'
grep -Fq '.ssh-safeshield-refresh-donut' "$ASSET_CSS" || \
	fail 'checked-in app.css must include SafeShield donut refresh styles'

echo 'PASS: SafeShield product page hierarchy, refresh progress and switch contracts are present'
