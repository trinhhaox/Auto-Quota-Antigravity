# Changelog - AG Manager

## [1.9.3] - 2026-08-22

### Deduplication & Smart Grouping
- **Khử trùng lặp model hoàn toàn:** Loại bỏ việc lặp lại 3 lần các model biến thể Reasoning / Thinking (`Low`, `Medium`, `High`) của Gemini (như Gemini 3.5 Flash, Gemini 3.7 Flash, Gemini 3.6 Flash, Gemini 3.1 Pro) do dùng chung 1 quota pool.
- **Tối ưu gom nhóm Tooltip SVG:** Gom toàn bộ model Antigravity thành 2 nhóm tinh gọn `ANTIGRAVITY · GEMINI MODELS` và `ANTIGRAVITY · CLAUDE / GPT`, không còn bị xé nhỏ thành hàng loạt header con.
- **Đồng bộ dữ liệu sạch cho cả Sidebar Webview, Tooltip SVG và Status Bar.**

## [1.9.2] - 2026-08-22


### Status Bar & Tooltip Visual Enhancement
- **Rõ ràng & trực quan hơn:** Thay thế các ký hiệu viết tắt khó hiểu (`G3.1P`, `G3.5F`) bằng tên model tiêu chuẩn, ngắn gọn và dễ nhận biết (`Gemini Pro`, `Gemini Flash`, `Claude`, `Claude CLI`, `Codex`).
- **Hiển thị thông minh thời gian hồi phục (Smart Reset Time):** Tự động hiển thị thời gian reset rút gọn kèm theo khi quota < 100% (ví dụ: `🟡 Claude 45% (1h30m)` hoặc `🔴 Gemini Pro 15% (35m)`).
- **Phân cách thanh thoát:** Sử dụng dấu chấm giữa ` · ` thanh lịch thay vì thanh đứng ` | ` cồng kềnh.
- **Cảnh báo động (Dynamic Visual Alert):** Khi bất kỳ dịch vụ nào chạm mức nguy cấp (≤ 20%), Status Bar tự động chuyển sang icon cảnh báo `$(warning)` cùng màu nền nổi bật để nhắc nhở người dùng.
- **Nâng cấp Tooltip Card SVG:** Giao diện SVG hover hiện đại chuẩn Dark Glassmorphism, hiển thị badge trạng thái hệ thống, phân chia rõ từng nguồn dịch vụ (Antigravity IDE, Claude Code CLI, OpenAI Codex) với thanh tiến trình gradient và các nút tác vụ nhanh (Refresh, Open Dashboard, Settings).

## [1.9.1] - 2026-07-16

### Status Bar — Claude Code quota %
- **Show percentage for Claude Code and Codex on status bar:** Previously only a colored dot was shown (`Claude 🔴`). Now displays the actual percentage alongside the dot (`🔴 Claude 23%`), consistent with the Gemini model format (`🟢 G3.5F 69%`).


## [1.9.0] - 2026-07-11

### Removed — Automation Suite
- **Automation / auto-click feature fully removed.** The extension is now a focused quota dashboard for Antigravity, Claude Code and Codex. The auto-click bridge that patched the IDE's `workbench.html` is gone, along with its settings, commands and UI panel.
- **One-time cleanup on upgrade:** any bridge script injected by an older version is automatically removed from `workbench.html` and the `product.json` checksums restored, so the IDE no longer loads a dead script or warns about a modified installation.

### UI — compact & colorful
- Dashboard trimmed to just the quota view; tighter spacing throughout.
- Each service card now has a colored left accent (Antigravity blue, Claude orange, Codex green) for instant distinction.
- Quota bars use a five-stop health scale (green → lime → yellow → orange → red) with a soft colored glow and gradient fill; the percentage value is colored to match.

## [1.8.1] - 2026-07-11

### Bug Fixes
- **Claude Code quota not displaying (cache poisoning):** On startup the usage endpoint (`api.anthropic.com/api/oauth/usage`) is frequently rate-limited because Claude Code CLI and this extension poll the same token. Previously, if the very first fetch hit HTTP 429 (before any data was cached), the empty rate-limited status was stored as the cache and served for the rest of the session — the Claude panel stayed blank until an IDE reload. Fixes:
  - **Never overwrite good cached quotas with an empty/error status** — once a quota sample is captured it survives transient failures.
  - **Back off 45s between attempts after a 429** instead of re-hammering every 120s, which perpetuated the rate limit and prevented ever landing a successful response.
  - Clearer status message ("Rate limited — retrying shortly…") while waiting for the first successful sample.

## [1.8.0] - 2026-07-05

### Automation Suite — 5 New Features
- **Custom rules:** add any button label from the dashboard (input under the rule grid); custom rules appear as cards with a remove (×) badge and are matched with the same safe exact-match normalization. Stored in `ag-manager.automation.customRules`.
- **Auto-pause on low quota** (`sqm.autoPauseOnLowQuota`, default off): when any Antigravity quota crosses below the notify threshold, automation pauses itself and warns you — an unattended agent can no longer burn the remaining quota. Fires only on the downward crossing, so manual re-enable is respected.
- **Scan scope** (`ag-manager.automation.scanScope`): `panel` mode limits auto-click to side/bottom panels, notification toasts and dialogs — never editor-area buttons. Default `all` (previous behavior).
- **7-day action chart:** daily automated-action counts rendered as a mini bar chart in the Automation section (today highlighted green).
- **Stuck-loop alert:** if one rule fires ≥15 times within 5 minutes, a warning offers one-click "Pause Automation" (10-min alert cooldown per rule).

### Internals
- New `automation-stats.ts` module (daily counts + loop detection); automation settings react to changes made directly in VS Code preferences.

## [1.7.0] - 2026-07-05

### Automation Suite — Safety Fix & Upgrades
- **Safe rule matching (critical):** buttons are now matched by normalized EXACT label instead of substring. Previously rule "Allow" also matched the "Don't Allow" button — the automation could click the opposite of what you intended. Normalization strips keyboard-shortcut hints ("Accept all (⌘⏎)" still matches "Accept all").
- **Click cooldown:** the same rule won't fire more than once per rest period (7s) even when the UI re-renders fresh button elements.
- **Wider coverage:** scans `a.monaco-button` dialog buttons in addition to `<button>` elements.
- **Complete rule grid:** added missing "Continue" and "Allow Once" cards — these default rules were active but impossible to toggle from the UI.
- **Activity visibility:** per-rule click-count badges, total actions counter, and a "Recent activity" feed (last 5 automated clicks) — this data was always collected but never displayed.

### Verified
- End-to-end bridge test on live IDE: heartbeat auth (401 without / 200 with token), config sync, log POST, 400/404 error paths.

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
