(function () {
    /**
     * AG Automation Bridge - Core Logic
     * Quan sát UI và thực thi click tự động theo rules từ host.
     */

    let config = {
        rules: __RULES__,
        active: __STATE__,
        authToken: __AUTH_TOKEN__,
        port: 48787,
        scanInterval: 1000
    };

    const state = {
        clickedElements: new WeakSet(),
        pendingStats: {},
        lastClickAt: {}   // rule -> timestamp, enforces restPeriod cooldown
    };

    // Normalize labels for SAFE exact matching: lowercase, strip symbols
    // (keyboard-shortcut hints like "(⌘⏎)"), collapse whitespace.
    // Substring matching was dangerous: rule "Allow" used to match the
    // "Don't Allow" button. Exact match after normalization prevents that.
    function normalizeLabel(s) {
        return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    // 1. Discovery & Heartbeat — sync config from host bridge server
    async function syncWithHost() {
        // Try ports 48787-48850 in case server bound to a different port
        for (let p = config.port; p <= 48850; p++) {
            try {
                const query = Object.keys(state.pendingStats).length > 0
                    ? `?delta=${encodeURIComponent(JSON.stringify(state.pendingStats))}`
                    : '';

                const res = await fetch(`http://127.0.0.1:${p}/system/heartbeat${query}`, {
                    headers: { 'Authorization': `Bearer ${config.authToken}` }
                });
                // A foreign server (or stale token) may answer with 401/404 —
                // never apply that response as config or automation dies silently.
                if (!res.ok) continue;
                const remote = await res.json();
                if (typeof remote.power !== 'boolean' || !Array.isArray(remote.rules)) continue;

                config.port = p; // Remember working port
                config.active = remote.power;
                config.rules = remote.rules;
                config.scope = remote.scope || 'all';
                if (remote.timing) {
                    config.scanInterval = remote.timing.scanDelay || 1000;
                    config.restPeriod = remote.timing.restPeriod || 7000;
                }
                state.pendingStats = {};
                return;
            } catch (e) {
                // Try next port
            }
        }
    }

    // Scope 'panel' restricts clicks to side/aux/bottom panels, notification
    // toasts and dialogs — never buttons in the editor area or title bar.
    const PANEL_SCOPE_SELECTOR = '.part.sidebar, .part.auxiliarybar, .part.panel, .notifications-toasts, .monaco-dialog-box';

    // 2. Intelligent Click Engine — scan buttons in document + iframes
    function findButtonsRecursive(root, results = []) {
        try {
            // VS Code renders some dialog buttons as <a class="monaco-button">
            const buttons = root.querySelectorAll('button:not([disabled]), a.monaco-button:not(.disabled)');
            for (const btn of buttons) {
                results.push(btn);
            }
            const iframes = root.querySelectorAll('iframe');
            for (const iframe of iframes) {
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    if (iframeDoc) findButtonsRecursive(iframeDoc, results);
                } catch (e) { /* cross-origin iframe */ }
            }
        } catch (e) { }
        return results;
    }

    function executeAutomation() {
        if (!config.active) return;

        if (!Array.isArray(config.rules)) return;

        const buttons = findButtonsRecursive(document);
        const now = Date.now();
        for (const btn of buttons) {
            if (state.clickedElements.has(btn)) continue;

            const text = normalizeLabel(btn.innerText || btn.textContent);
            if (!text) continue;
            const matchedRule = config.rules.find(rule => text === normalizeLabel(rule));

            if (matchedRule) {
                if (btn.closest('.monaco-editor')) continue;
                if (config.scope === 'panel' && !btn.closest(PANEL_SCOPE_SELECTOR)) continue;
                // Cooldown: UI re-renders create fresh elements with the same
                // label — don't rapid-fire the same rule within restPeriod.
                if (now - (state.lastClickAt[matchedRule] || 0) < (config.restPeriod || 7000)) continue;

                btn.click();
                state.clickedElements.add(btn);
                state.lastClickAt[matchedRule] = now;
                state.pendingStats[matchedRule] = (state.pendingStats[matchedRule] || 0) + 1;
                logToHost({ type: 'auto-click', label: matchedRule });
            }
        }
    }

    // 3. Activity Logger
    function logToHost(payload) {
        fetch(`http://127.0.0.1:${config.port}/system/log`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${config.authToken}` },
            body: JSON.stringify(payload)
        }).catch(() => { });
    }

    // 4. Lifecycle — MutationObserver for efficient DOM watching
    let scanPending = false;
    function scheduleScan() {
        if (scanPending) return;
        scanPending = true;
        requestAnimationFrame(() => {
            executeAutomation();
            scanPending = false;
        });
    }

    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });

    // Fallback interval for iframes (MutationObserver can't watch cross-origin)
    setInterval(executeAutomation, 10000);
    setInterval(syncWithHost, 5000);
    console.log('[AG-Automation] Bridge initialized (MutationObserver mode).');
})();
