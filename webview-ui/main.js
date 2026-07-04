const vscode = acquireVsCodeApi();
const state = vscode.getState() || {};

function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
        case "update":
            renderDashboard(message.data);
            break;
        case "loading":
            break;
        case "settings":
            renderSettingsData(message.settings);
            break;
    }
});

// Request initial data immediately on load
vscode.postMessage({ type: "onRefresh" });

document.getElementById('refresh-btn').addEventListener('click', () => {
    document.getElementById('quota-list').innerHTML = '<div class="loading">Refreshing...</div>';
    vscode.postMessage({ type: 'onRefresh' });
});

// Settings toggle
document.getElementById('settings-btn').addEventListener('click', () => {
    const panel = document.getElementById('settings-panel');
    const isHidden = panel.classList.toggle('hidden');
    if (!isHidden) {
        vscode.postMessage({ type: 'getSettings' });
    }
});

// [MODIFIED] renderDashboard: data is now DashboardData {antigravity, claude, codex}
// Old: data was UserStatus directly. New: data.antigravity = UserStatus | null
function renderDashboard(data) {
    if (!data) {
        document.getElementById('user-info').innerHTML = '';
        document.getElementById('quota-list').innerHTML = '<p class="error-msg">Local server not found.<br>Ensure Antigravity IDE is running.</p>';
        return;
    }

    // --- Antigravity user card (unchanged logic, uses data.antigravity) ---
    const ag = data.antigravity;
    if (ag) {
        document.getElementById('user-info').innerHTML = `
            <div class="user-card">
                <div class="avatar">${escapeHtml(ag.name.charAt(0))}</div>
                <div class="user-details">
                    <div class="user-name">${escapeHtml(ag.name)}</div>
                    <div class="user-sub">${escapeHtml(ag.tier)} &bull; ${escapeHtml(ag.email)}</div>
                </div>
            </div>
        `;
    } else {
        document.getElementById('user-info').innerHTML = '';
    }

    // --- Render all service groups ---
    // [ADDED] renderServiceGroup helper: renders a titled gauge group identical to Antigravity style
    let html = '';
    if (ag) {
        html += renderServiceGroup('ANTIGRAVITY', ag, 'Antigravity', data.history);
    }
    if (data.claude) {
        html += renderServiceGroup('CLAUDE CODE', data.claude, 'Claude', data.history);
    }
    if (data.codex) {
        html += renderServiceGroup('CODEX', data.codex, 'Codex', data.history);
    }

    if (!html) {
        html = '<p class="error-msg">No services detected.<br>Ensure Antigravity IDE is running, or sign in to Claude Code / Codex.</p>';
    }
    document.getElementById('quota-list').innerHTML = html;

    if (data.autoClick) {
        renderAutoClick(data.autoClick);
    } else if (data.antigravity && data.antigravity.autoClick) {
        renderAutoClick(data.antigravity.autoClick);
    }
}

// [ADDED] Renders a single service group (title + user info row + gauges)
// Uses exact same HTML/CSS structure as original Antigravity rendering
// Unified color rule (matches src/utils.ts): remaining >50 green, >20 yellow, else red
function healthColor(pct) {
    if (pct > 50) return '#10b981';
    if (pct > 20) return '#f59e0b';
    return '#ef4444';
}

// Rows whose displayValue is not a percentage are informational (e.g. model name)
function isPercentQuota(q) {
    return q.displayValue === undefined || String(q.displayValue).endsWith('%');
}

function renderServiceGroup(title, status, serviceKey, history) {
    if (!status) { return ''; }

    const isAuthenticated = status.isAuthenticated !== false; // true if undefined (backward compat)
    const infoLine = `${escapeHtml(status.tier)} &bull; ${escapeHtml(status.email)}`;

    // Group status dot = worst remaining % across percentage rows
    const pctRows = (status.quotas || []).filter(isPercentQuota);
    let dotHtml = '';
    if (isAuthenticated && !status.error && pctRows.length > 0) {
        const worst = Math.min(...pctRows.map(q => q.remaining));
        dotHtml = `<span class="group-dot" style="background:${healthColor(worst)}"></span>`;
    }

    let gaugesHtml = '';
    if (status.error) {
        gaugesHtml = `<p class="error-msg" style="font-size:11px;padding:10px 0;">${escapeHtml(status.error)}</p>`;
    } else if (isAuthenticated && status.quotas && status.quotas.length > 0) {
        gaugesHtml = `<div class="gauge-grid">${status.quotas.map(q =>
            createGauge(q, historySeries(history, `${serviceKey}-${q.label}`))
        ).join('')}</div>`;
    } else if (!isAuthenticated) {
        gaugesHtml = `<p class="error-msg" style="font-size:11px;padding:10px 0;">${escapeHtml(status.email)}</p>`;
    }

    return `
        <div class="service-group">
            <div class="group-header">${dotHtml}<span>${escapeHtml(title)}</span></div>
            <div class="service-info">${infoLine}</div>
            ${gaugesHtml}
        </div>
    `;
}


function renderAutoClick(config) {
    let container = document.getElementById('automation-module');
    if (!container) {
        container = document.createElement('div');
        container.id = 'automation-module';
        container.className = 'automation-container';
        document.getElementById('app').appendChild(container);
    }

    // Full rule set — must cover every default rule the host ships,
    // otherwise some rules can never be toggled off from the UI.
    const rules = [
        { id: 'Run', label: 'Run' },
        { id: 'Allow', label: 'Allow' },
        { id: 'Accept', label: 'Accept' },
        { id: 'Always Allow', label: 'Always Allow' },
        { id: 'Allow Once', label: 'Allow Once' },
        { id: 'Retry', label: 'Retry' },
        { id: 'Continue', label: 'Continue' },
        { id: 'Keep Waiting', label: 'Keep Waiting' },
        { id: 'Accept all', label: 'Accept All' }
    ];

    const metrics = config.metrics || {};
    const totalActions = config.total_actions || 0;
    const logs = Array.isArray(config.logs) ? config.logs.slice(0, 5) : [];

    const activityHtml = logs.length > 0
        ? `<div class="activity-feed">
                <div class="activity-title">Recent activity</div>
                ${logs.map(l => `
                    <div class="activity-row">
                        <span class="activity-ts">${escapeHtml(l.ts || '')}</span>
                        <span class="activity-ref">${escapeHtml(l.ref || l.act || '')}</span>
                    </div>`).join('')}
           </div>`
        : '';

    container.innerHTML = `
        <div class="section-title">Automation Suite
            <span class="total-actions" title="Total automated actions">${totalActions} actions</span>
        </div>

        <div class="power-row">
            <span class="power-label">Automation System</span>
            <label class="switch">
                <input type="checkbox" id="master-power" ${config.active ? 'checked' : ''}>
                <span class="slider"></span>
            </label>
        </div>

        <div class="automation-grid ${!config.active ? 'system-off' : ''}">
            ${rules.map(rule => {
        const rulesList = Array.isArray(config.rules) ? config.rules : [];
        const isRuleOn = rulesList.includes(rule.id);
        const isActuallyActive = config.active && isRuleOn;
        const count = metrics[rule.id] || 0;
        return `
                    <div class="automation-card ${isActuallyActive ? 'active' : ''} ${!config.active ? 'disabled' : ''}" data-rule="${escapeHtml(rule.id)}">
                        <div class="glow-ring"></div>
                        ${count > 0 ? `<span class="rule-badge">${count > 999 ? '999+' : count}</span>` : ''}
                        <div class="automation-label">${rule.label}</div>
                        <div class="automation-status">${isActuallyActive ? 'Active' : (config.active ? 'Idle' : 'Paused')}</div>
                    </div>
                `;
    }).join('')}
        </div>
        ${activityHtml}
    `;

    // Event delegation — single listener, no re-registration leak
    container.onclick = function(e) {
        const card = e.target.closest('.automation-card');
        if (card) {
            const ruleId = card.getAttribute('data-rule');
            const rulesList = Array.isArray(config.rules) ? config.rules : [];
            let currentRules = [...rulesList];

            card.style.opacity = '0.5';
            card.style.pointerEvents = 'none';

            if (currentRules.includes(ruleId)) {
                currentRules = currentRules.filter(r => r !== ruleId);
            } else {
                currentRules.push(ruleId);
            }

            vscode.postMessage({
                type: 'onAutoClickChange',
                config: { rules: currentRules }
            });
        }
    };
    container.onchange = function(e) {
        if (e.target.id === 'master-power') {
            vscode.postMessage({
                type: 'onAutoClickChange',
                config: { enabled: e.target.checked }
            });
        }
    };
}

function formatTime(t) {
    if (!t) return '';
    const hMatch = t.match(/(\d+)h/);
    const mMatch = t.match(/(\d+)m/);
    if (!hMatch && !mMatch) return t;
    const h = hMatch ? parseInt(hMatch[1]) : 0;
    const m = mMatch ? parseInt(mMatch[1]) : 0;
    if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h ${m}m`;
    return `${h}h ${m}m`;
}

// Extract the last N history points for one "Service-Label" key
function historySeries(history, key) {
    if (!Array.isArray(history)) return [];
    const series = [];
    for (const entry of history) {
        if (entry && entry.v && typeof entry.v[key] === 'number') {
            series.push(entry.v[key]);
        }
    }
    return series.slice(-48); // ~4h at 5-min refresh
}

// Tiny inline trend chart rendered under the quota bar
function sparklineSvg(series, color) {
    if (!series || series.length < 3) return '';
    const w = 96, h = 14;
    const min = Math.min(...series);
    const max = Math.max(...series);
    const span = (max - min) || 1;
    const pts = series.map((v, i) =>
        `${((i / (series.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`
    ).join(' ');
    return `<svg class="quota-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
        <polyline points="${pts}" fill="none" stroke="${escapeHtml(color)}" stroke-width="1.5" stroke-opacity="0.8"/>
    </svg>`;
}

function createGauge(quota, series) {
    const pct = Math.round(quota.remaining);
    const label = shortLabel(quota.label);

    // Informational rows (model name, etc.): plain label/value, no bar or spark
    if (!isPercentQuota(quota)) {
        return `
            <div class="quota-row model-row">
                <div class="quota-label">${escapeHtml(label)}</div>
                <div class="quota-value model-value">${escapeHtml(quota.displayValue || '')}</div>
            </div>
        `;
    }

    const color = healthColor(pct);
    const centerText = quota.displayValue !== undefined ? quota.displayValue : `${pct}%`;
    const time = `${formatTime(quota.resetTime)} ${quota.absResetTime || ''}`.trim();
    const barWidth = Math.max(0, Math.min(100, pct));

    return `
        <div class="quota-row">
            <div class="quota-main">
                <div class="quota-top">
                    <span class="quota-label">${escapeHtml(label)}</span>
                    <span class="quota-time">${escapeHtml(time)}</span>
                </div>
                <div class="quota-bar">
                    <div class="quota-bar-fill" style="width: ${barWidth}%; background-color: ${color};"></div>
                </div>
                ${sparklineSvg(series, color)}
            </div>
            <div class="quota-value" style="color: ${color};">${escapeHtml(centerText)}</div>
        </div>
    `;
}

function shortLabel(label) {
    // Rút gọn tên model cho compact display
    return label
        .replace('Gemini 3.1', 'G3.1')
        .replace('Gemini 3', 'G3')
        .replace('Gemini 2', 'G2')
        .replace('Claude Sonnet', 'Sonnet')
        .replace('Claude Opus', 'Opus')
        .replace('Claude Haiku', 'Haiku')
        .replace('GPT-OSS', 'GPT')
        .replace(' (Thinking)', '')
        .replace(' (High)', '↑')
        .replace(' (Low)', '↓')
        .replace(' (Medium)', '');
}

function renderSettingsData(settings) {
    const fields = [
        { key: 'claude.usagePeriod', label: 'Usage Period', type: 'select', options: [
            { value: '5-hour', label: '5 Hour' },
            { value: '7-day', label: '7 Day' },
            { value: 'both', label: 'Both' }
        ]},
        { key: 'refreshInterval', label: 'Refresh Interval (min)', type: 'select', options: [
            { value: 1, label: '1' }, { value: 2, label: '2' }, { value: 5, label: '5' },
            { value: 10, label: '10' }, { value: 15, label: '15' }, { value: 30, label: '30' }
        ]},
        { key: 'enableNotifications', label: 'Notifications', type: 'toggle' },
        { key: 'notifyThreshold', label: 'Notify Threshold (%)', type: 'select', options: [
            { value: 5, label: '5' }, { value: 10, label: '10' }, { value: 15, label: '15' },
            { value: 20, label: '20' }, { value: 30, label: '30' }, { value: 40, label: '40' },
            { value: 50, label: '50' }
        ]},
        { key: 'statusBar.mode', label: 'Status Bar', type: 'select', options: [
            { value: 'full', label: 'Full' },
            { value: 'compact', label: 'Compact' },
            { value: 'dot', label: 'Dot only' }
        ]},
    ];

    const panel = document.getElementById('settings-panel');
    let html = '<div class="section-title">Settings</div>';

    fields.forEach(f => {
        const val = settings[f.key] ?? '';
        html += '<div class="settings-row">';
        html += `<label class="settings-label">${f.label}</label>`;

        if (f.type === 'password' || f.type === 'text') {
            const masked = f.type === 'password' && val ? '••••••••' : '';
            html += `<div class="settings-input-wrap">
                <input class="settings-input" type="${f.type === 'password' ? 'password' : 'text'}"
                    data-key="${f.key}" value="${val}" placeholder="${f.placeholder || ''}"
                    autocomplete="off" spellcheck="false">
                ${f.type === 'password' ? '<button class="settings-eye" data-key="' + f.key + '">Show</button>' : ''}
            </div>`;
        } else if (f.type === 'select') {
            html += `<select class="settings-select" data-key="${f.key}">`;
            f.options.forEach(opt => {
                const sel = String(val) === String(opt.value) ? 'selected' : '';
                html += `<option value="${opt.value}" ${sel}>${opt.label}</option>`;
            });
            html += '</select>';
        } else if (f.type === 'toggle') {
            html += `<label class="switch"><input type="checkbox" data-key="${f.key}" ${val ? 'checked' : ''}><span class="slider"></span></label>`;
        }

        html += '</div>';
    });

    html += '<button class="settings-save" id="save-settings-btn">Save</button>';
    panel.innerHTML = html;

    // Eye toggle for password fields
    panel.querySelectorAll('.settings-eye').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-key');
            const input = panel.querySelector(`input[data-key="${key}"]`);
            if (input.type === 'password') {
                input.type = 'text';
                btn.textContent = 'Hide';
            } else {
                input.type = 'password';
                btn.textContent = 'Show';
            }
        });
    });

    // Save button
    document.getElementById('save-settings-btn').addEventListener('click', () => {
        const result = {};
        panel.querySelectorAll('[data-key]').forEach(el => {
            if (el.tagName === 'BUTTON') return;
            const key = el.getAttribute('data-key');
            if (el.type === 'checkbox') {
                result[key] = el.checked;
            } else {
                let v = el.value.trim();
                // Convert numeric selects
                if (key === 'refreshInterval' || key === 'notifyThreshold') v = parseInt(v);
                result[key] = v;
            }
        });
        vscode.postMessage({ type: 'saveSettings', settings: result });
    });
}

