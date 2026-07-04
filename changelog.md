# Changelog - AG Manager

## [1.6.0] - 2026-07-05

### Unified Quota Semantics
- **One rule for every service:** Claude Code and Codex quotas now count DOWN from 100% (full) to 0% (exhausted), exactly like Antigravity. No more mixed "usage up" vs "remaining down" displays.
- **One color rule everywhere:** remaining >50% green, >20% yellow, otherwise red — applied consistently to sidebar bars, values, group dots, status bar dots, tooltip bars, and notifications.
- **Informational rows** (Codex "Active Model") are excluded from color/notification/history logic and render as plain label/value rows.

### Dashboard Redesign
- Service groups are now cards with a health status dot in the header (worst quota drives the color).
- Quota rows: label + reset countdown (incl. absolute time, e.g. "1h 47m (03h22)") on one line, thicker animated health-colored bar, bold colored percentage.
- Sparklines now use the health color; history store reset (v2) due to semantics change.
- Removed the "0d" prefix from sub-day reset countdowns.

## [1.5.0] - 2026-07-05

### Bug Fixes
- **Automation Bridge 401 (critical):** Auth token is now persisted in globalState instead of regenerated per session. The injected bridge script loads before the extension activates, so a per-session token guaranteed every heartbeat failed with 401 — automation toggles and metrics never worked within a session.
- **Automation Self-Disable:** Bridge script now validates HTTP status and response shape before applying remote config. Previously a 401 body was parsed as config, setting `active = undefined` and silently killing the engine.
- **Sidebar Stuck on "Refreshing...":** Network failures in `fetchStatus` are now caught properly; cached server info resets so the next refresh re-discovers the local server port.
- **Admin-Privilege Writes:** File paths are now quoted in osascript/pkexec copy commands (paths with spaces broke installation).
- **Windows Nested PowerShell:** Removed redundant `powershell.exe -Command` prefixes for commands already executed inside a PowerShell shell.
- **Status Dot Colors:** Usage-direction quotas (Claude/Codex) now show green below 50% usage instead of permanent orange.
- **Tooltip SVG Escaping:** Labels containing `&`/`<` no longer break the status bar tooltip.
- **Auto-Updater Repo:** Update checks now point to `trinhhaox/Auto-Quota-Antigravity`.

### New Features
- **Real Codex Quotas:** Session (5h) and Weekly usage percentages parsed from the newest Codex CLI session log (`~/.codex/sessions/**/*.jsonl`) — no network call needed.
- **Quota History Sparklines:** Each gauge now shows a mini trend chart (~4h window); snapshots persist across restarts (24h retention).
- **Status Bar Quick Menu:** Clicking the status bar opens a Quick Pick — refresh, open dashboard, toggle automation, remove injection, open settings.
- **Remove Automation Injection command:** Cleanly removes the bridge script from workbench.html and revokes consent.
- **Configurable Notify Threshold** (`sqm.notifyThreshold`, default 20%).
- **Status Bar Display Modes** (`sqm.statusBar.mode`): full / compact (worst group only) / dot.

### Performance
- **Focus-Aware Polling:** Auto-refresh skips while the window is unfocused (no more ps/lsof spawns and API calls overnight); a focus listener catches up immediately when data is stale.

## [1.4.0] - 2026-03-28

### Claude Code Quota — OAuth Migration
- **OAuth Token Auth:** Replaced fragile cookie-based authentication (sessionKey + cf_clearance) with OAuth token from macOS Keychain / ~/.claude/.credentials.json. Quota data now fetches automatically without manual cookie setup.
- **New API Endpoint:** Switched from `claude.ai/api/organizations/{orgId}/usage` to `api.anthropic.com/api/oauth/usage` — more reliable, no Cloudflare blocks.
- **Model Breakdown:** Added per-model weekly usage (Sonnet 7day, Opus 7day) from the new API response.
- **Reset Time Parsing:** Quota reset times now show precise countdown (e.g., "2h 15m (15h30)") instead of static "5h"/"7d".
- **Rate Limit Handling:** Returns cached data on HTTP 429 instead of showing an error. Cache TTL increased to 120 seconds.

### Codex Display
- **Model Info Gauge:** Codex now shows the active model name as a visual gauge row instead of an error message.

### Cleanup
- **Removed Cookie Settings:** Removed sessionKey, cf_clearance, and organizationId from settings UI and configuration.
- **Removed SecretStorage:** No longer stores or migrates browser cookies. All auth handled via OAuth.

## [1.3.1] - 2026-03-28

### Bug Fixes
- **Automation Bridge Auth:** Fixed auth token becoming stale after VS Code restart — bridge script is now re-deployed every session with a fresh token.
- **Cache Busting:** Script tag timestamp is updated on every deploy to prevent browser caching of stale bridge script.
- **Auto-Consent:** If automation script was previously installed, consent is granted automatically without re-prompting.

### Removed
- **Usage History (7 Days):** Removed the analytics history section from the dashboard, including all related tracking, rendering, and CSS.

## [1.3.0] - 2026-03-28

### Security
- **SecretStorage Migration:** Session keys and cf_clearance cookies are now stored encrypted via VS Code SecretStorage API instead of plaintext settings.json. Existing credentials are auto-migrated on first launch.
- **Content Security Policy:** Webview now enforces strict CSP with nonce-based script loading.
- **XSS Protection:** All user-supplied data (names, emails, error messages) is escaped before rendering in the dashboard.
- **Bridge Authentication:** HTTP automation bridge now requires a cryptographic auth token on every request. Removed wildcard CORS.
- **Injection Consent:** Users are prompted before the automation script is injected into VS Code workbench. Added cleanup on disable/uninstall.

### Bug Fixes
- **Proper Cleanup:** `deactivate()` now closes the HTTP bridge server and clears all timers to prevent resource leaks.
- **Process Leak Fix:** Child processes spawned by `execWithTimeout` are now killed on timeout instead of being left running.
- **Re-notification:** Quota alerts now reset when a model recovers, allowing re-notification if it drops again.
- **Port Binding:** Bridge server now logs and warns the user if all ports (48787-48850) are occupied.
- **Error Visibility:** Replaced 7+ silent catch blocks with structured logging to the Output channel.

### Architecture
- **Type Safety:** Extracted shared TypeScript interfaces into `types.ts`, replacing ~19 `any` types across the codebase.
- **History Service:** Quota history tracking extracted into a dedicated `HistoryService` class (SRP).
- **Shared Utilities:** `formatTime()` and `getQuotaColor()` deduplicated into `utils.ts`.
- **Dependency Injection:** Removed `globalContext` export; services now receive dependencies via constructor/setter injection.

### Performance
- **Diff Optimization:** Data comparison reduced from 4x `JSON.stringify()` to a single cached hash comparison.
- **MutationObserver:** Automation DOM scanning switched from 1-second polling to MutationObserver with a 10-second fallback.
- **Event Delegation:** Fixed event listener memory leak in automation and settings panels.
- **Auto-detect Model Groups:** Status bar and tooltip now dynamically group models by prefix instead of using a hardcoded list.

### UI
- **Standardized Language:** All UI labels normalized to English (previously mixed Vietnamese/English).

## [1.2.2] - 2026-03-24

### 🇻🇳 Tiếng Việt
- **UI Tối Giản:** Giao diện sidebar được tinh gọn, giảm hiệu ứng và đường viền.
- **List Layout:** Thay gauge vòng tròn bằng danh sách hàng với thanh tiến trình mảnh.

### 🇺🇸 English
- **Minimal UI:** Sidebar visuals simplified with fewer effects and cleaner borders.
- **List Layout:** Replaced circular gauges with a row list layout and slim progress bars.

## [1.2.0] - 2026-03-17

### 🇻🇳 Tiếng Việt
- **Hỗ trợ Đa Dịch vụ:** Tích hợp Claude Code và Codex (ChatGPT) vào dashboard.
- **Giao diện HP Bar:** Claude và Codex sử dụng thanh tiến trình dạng fluid (HP bar) trong status bar popup.
- **Logic Gauge Mới:** Claude xoay xuôi chiều kim đồng hồ, Codex/Antigravity xoay ngược chiều.
- **Làm mới Tự động:** Thêm tính năng tự động quét dữ liệu ngầm (1-30 phút).
- **Thông báo Cảnh báo:** Hiện Warning khi quota sắp cạn (Claude > 80%, model khác < 20%).
- **Tinh chỉnh UI:** Màu cam đặc trưng cho Claude và tối giản icon trên Status bar.

### 🇺🇸 English
- **Multi-Service AI Monitoring:** Added support for Claude Code and Codex (ChatGPT).
- **HP Bar Visualization:** Fluid progress indicators for Claude and Codex in the status bar popup.
- **Directional Gauge Logic:** Clockwise for Claude, Counter-clockwise for Codex/Antigravity.
- **Auto-Refresh:** Added background quota updates (configurable 1-30 minutes).
- **Smart Notifications:** Warning alerts for high Claude usage (>80%) or low balance (<20%).
- **UI Refinements:** Characteristic orange styling for Claude and cleaner status bar layout.
