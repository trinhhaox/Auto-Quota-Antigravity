const vscode = acquireVsCodeApi();

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
    document.getElementById('quota-list').innerHTML = '<div class="loading">Refreshing…</div>';
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

// Per-service accent color — makes each group instantly distinguishable
const SERVICE_ACCENT = {
    Antigravity: '#40c4ff',
    Claude: '#d97757',
    Codex: '#10a37f'
};

// data: DashboardData { antigravity, claude, codex } (+ history)
function renderDashboard(data) {
    if (!data) {
        document.getElementById('user-info').innerHTML = '';
        document.getElementById('quota-list').innerHTML = '<p class="error-msg">Local server not found.<br>Ensure Antigravity IDE is running.</p>';
        return;
    }

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
}

// Five-stop health scale — full → empty maps green → lime → yellow → orange → red
function healthColor(pct) {
    if (pct >= 70) return '#22c55e';
    if (pct >= 45) return '#84cc16';
    if (pct >= 25) return '#eab308';
    if (pct >= 10) return '#f97316';
    return '#ef4444';
}

// Rows whose displayValue is not a percentage are informational (e.g. model name)
function isPercentQuota(q) {
    return q.displayValue === undefined || String(q.displayValue).endsWith('%');
}

function renderServiceGroup(title, status, serviceKey, history) {
    if (!status) { return ''; }

    const accent = SERVICE_ACCENT[serviceKey] || 'var(--ui-border)';
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
        gaugesHtml = `<p class="error-msg" style="font-size:11px;padding:8px 0;">${escapeHtml(status.error)}</p>`;
    } else if (isAuthenticated && status.quotas && status.quotas.length > 0) {
        gaugesHtml = `<div class="gauge-grid">${status.quotas.map(q =>
            createGauge(q, historySeries(history, `${serviceKey}-${q.label}`))
        ).join('')}</div>`;
    } else if (!isAuthenticated) {
        gaugesHtml = `<p class="error-msg" style="font-size:11px;padding:8px 0;">${escapeHtml(status.email)}</p>`;
    }

    return `
        <div class="service-group" style="--accent:${accent}">
            <div class="group-header">${dotHtml}<span>${escapeHtml(title)}</span></div>
            <div class="service-info">${infoLine}</div>
            ${gaugesHtml}
        </div>
    `;
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

function formatSessionResetText(resetTime, absResetTime) {
    if (!resetTime || resetTime === 'Ready' || resetTime === 'Refreshing...') {
        return resetTime || 'Ready';
    }

    const absMatch = absResetTime ? absResetTime.match(/\(?(\d{1,2})h(\d{2})\)?/) : null;
    const timeFormatted = absMatch ? `${absMatch[1].padStart(2, '0')}:${absMatch[2]}` : '';

    const hMatch = resetTime.match(/(\d+)h/);
    const mMatch = resetTime.match(/(\d+)m/);
    const totalHours = hMatch ? parseInt(hMatch[1]) : 0;
    const totalMins = mMatch ? parseInt(mMatch[1]) : 0;

    if (totalHours < 24) {
        const now = new Date();
        const resetDate = new Date(now.getTime() + (totalHours * 60 + totalMins) * 60 * 1000);
        const isToday = resetDate.getDate() === now.getDate();
        if (timeFormatted) {
            return isToday ? `Resets today at ${timeFormatted}` : `Resets tomorrow at ${timeFormatted}`;
        }
        return `Resets in ${formatTime(resetTime)}`;
    }

    const days = Math.floor(totalHours / 24);
    const remHours = totalHours % 24;
    const inText = `${days}d ${remHours}h`;
    return absResetTime ? `Resets in ${inText} ${absResetTime}` : `Resets in ${inText}`;
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
    const w = 96, h = 12;
    const min = Math.min(...series);
    const max = Math.max(...series);
    const span = (max - min) || 1;
    const pts = series.map((v, i) =>
        `${((i / (series.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`
    ).join(' ');
    return `<svg class="quota-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
        <polyline points="${pts}" fill="none" stroke="${escapeHtml(color)}" stroke-width="1.5" stroke-opacity="0.75"/>
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
    const timeFormatted = formatSessionResetText(quota.resetTime, quota.absResetTime);
    const barWidth = Math.max(0, Math.min(100, pct));
    const subLabel = label.includes('Session') ? '5-hour window' : (label.includes('Weekly') || label.includes('7day') ? '7-day window' : 'Shared Pool');

    return `
        <div class="session-card">
            <div class="session-header">
                <span class="session-label">${escapeHtml(label)}</span>
                <span class="session-sub">${escapeHtml(subLabel)}</span>
            </div>
            <div class="session-bar-track">
                <div class="session-bar-fill" style="width:${barWidth}%;background:linear-gradient(90deg,${color}CC,${color});box-shadow:0 0 8px ${color}55;"></div>
            </div>
            <div class="session-footer">
                <span class="session-left"><strong style="color:${color};font-size:11.5px;">${pct}%</strong> left</span>
                <span class="session-reset">${escapeHtml(timeFormatted)}</span>
            </div>
            ${sparklineSvg(series, color)}
        </div>
    `;
}

function shortLabel(label) {
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

        if (f.type === 'select') {
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

    document.getElementById('save-settings-btn').addEventListener('click', () => {
        const result = {};
        panel.querySelectorAll('[data-key]').forEach(el => {
            if (el.tagName === 'BUTTON') return;
            const key = el.getAttribute('data-key');
            if (el.type === 'checkbox') {
                result[key] = el.checked;
            } else {
                let v = el.value.trim();
                if (key === 'refreshInterval' || key === 'notifyThreshold') v = parseInt(v);
                result[key] = v;
            }
        });
        vscode.postMessage({ type: 'saveSettings', settings: result });
    });
}
