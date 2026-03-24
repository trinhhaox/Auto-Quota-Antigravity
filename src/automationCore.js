(function () {
    /**
     * AG Automation Bridge - Core Logic
     * Quan sát UI và thực thi click tự động theo rules từ host.
     */

    let config = {
        rules: __RULES__,
        active: __STATE__,
        port: 48787,
        scanInterval: 1000
    };

    const state = {
        clickedElements: new WeakSet(),
        pendingStats: {}
    };

    // 1. Discovery & Heartbeat — sync config from host bridge server
    async function syncWithHost() {
        // Try ports 48787-48850 in case server bound to a different port
        for (let p = config.port; p <= 48850; p++) {
            try {
                const query = Object.keys(state.pendingStats).length > 0
                    ? `?delta=${encodeURIComponent(JSON.stringify(state.pendingStats))}`
                    : '';

                const res = await fetch(`http://127.0.0.1:${p}/system/heartbeat${query}`);
                const remote = await res.json();

                config.port = p; // Remember working port
                config.active = remote.power;
                config.rules = remote.rules;
                if (remote.timing) config.scanInterval = remote.timing.scanDelay || 1000;
                state.pendingStats = {};
                return;
            } catch (e) {
                // Try next port
            }
        }
    }

    // 2. Intelligent Click Engine — scan buttons in document + iframes
    function findButtonsRecursive(root, results = []) {
        try {
            const buttons = root.querySelectorAll('button:not([disabled])');
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

        const buttons = findButtonsRecursive(document);
        for (const btn of buttons) {
            if (state.clickedElements.has(btn)) continue;

            const text = (btn.innerText || btn.textContent || '').trim();
            const matchedRule = config.rules.find(rule =>
                text === rule || text.includes(rule)
            );

            if (matchedRule) {
                if (btn.closest('.monaco-editor')) continue;

                btn.click();
                state.clickedElements.add(btn);
                state.pendingStats[matchedRule] = (state.pendingStats[matchedRule] || 0) + 1;
                logToHost({ type: 'auto-click', label: matchedRule });
            }
        }
    }

    // 3. Activity Logger
    function logToHost(payload) {
        fetch(`http://127.0.0.1:${config.port}/system/log`, {
            method: 'POST',
            body: JSON.stringify(payload)
        }).catch(() => { });
    }

    // 4. Lifecycle
    setInterval(syncWithHost, 5000);
    setInterval(executeAutomation, config.scanInterval);
    console.log('[AG-Automation] Bridge initialized.');
})();
