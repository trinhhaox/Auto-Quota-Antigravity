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
            document.getElementById('quota-list').innerHTML = `
                <div class="loading-state">
                    <div class="spinner"></div>
                    <span>Refreshing quotas...</span>
                </div>
            `;
            break;
        case "settings":
            renderSettingsData(message.settings);
            break;
    }
});

// Request initial data immediately on load
vscode.postMessage({ type: "onRefresh" });

document.getElementById('refresh-btn').addEventListener('click', () => {
    const btn = document.getElementById('refresh-btn');
    btn.classList.add('rotating');
    document.getElementById('quota-list').innerHTML = `
        <div class="loading-state">
            <div class="spinner"></div>
            <span>Fetching live quotas...</span>
        </div>
    `;
    vscode.postMessage({ type: 'onRefresh' });
    setTimeout(() => btn.classList.remove('rotating'), 800);
});

// Settings toggle
document.getElementById('settings-btn').addEventListener('click', () => {
    const panel = document.getElementById('settings-panel');
    const isHidden = panel.classList.toggle('hidden');
    if (!isHidden) {
        vscode.postMessage({ type: 'getSettings' });
    }
});

// Per-service accent color & icon
const SERVICE_META = {
    Antigravity: { accent: '#38BDF8', icon: '⚡', title: 'ANTIGRAVITY' },
    Claude: { accent: '#FB923C', icon: '🟧', title: 'CLAUDE CODE' },
    Codex: { accent: '#4ADE80', icon: '🟩', title: 'OPENAI CODEX' }
};

// data: DashboardData { antigravity, claude, codex } (+ history)
function renderDashboard(data) {
    if (!data) {
        document.getElementById('user-info').innerHTML = '';
        document.getElementById('quota-list').innerHTML = `
            <div class="error-card">
                <div class="error-icon">⚠️</div>
                <div class="error-title">Antigravity Server Offline</div>
                <div class="error-desc">Ensure Antigravity IDE is running to monitor model quotas.</div>
            </div>
        `;
        return;
    }

    const ag = data.antigravity;
    if (ag) {
        const tier = (ag.tier || 'Free').toUpperCase();
        const initial = (ag.name || 'U').charAt(0).toUpperCase();
        document.getElementById('user-info').innerHTML = `
            <div class="user-card">
                <div class="avatar">${escapeHtml(initial)}</div>
                <div class="user-details">
                    <div class="user-row-top">
                        <span class="user-name">${escapeHtml(ag.name || 'User')}</span>
                        <span class="tier-badge ${tier.toLowerCase()}">${escapeHtml(tier)}</span>
                    </div>
                    <div class="user-email">${escapeHtml(ag.email || '')}</div>
                </div>
            </div>
        `;
    } else {
        document.getElementById('user-info').innerHTML = '';
    }

    let html = '';

    // 1. Antigravity Quota Groups (Gemini Models & Claude/GPT Models with Weekly + 5H Session)
    if (ag && ag.limitGroups && ag.limitGroups.length > 0) {
        html += ag.limitGroups.map(group => renderLimitGroup(group)).join('');
    } else if (ag) {
        html += renderServiceGroup('Antigravity', ag);
    }

    // 2. External Services (Claude Code CLI & Codex if logged in)
    if (data.claude && data.claude.isAuthenticated) {
        const subtitle = `${data.claude.tier || 'User'} · ${data.claude.email || ''}`.trim();
        if (data.claude.limitGroups && data.claude.limitGroups.length > 0) {
            html += data.claude.limitGroups.map(group => renderLimitGroup(group, subtitle, '🟧')).join('');
        } else {
            html += renderServiceGroup('Claude', data.claude);
        }
    }
    if (data.codex && data.codex.isAuthenticated) {
        const subtitle = `${data.codex.tier || 'Free'} · ${data.codex.email || ''}`.trim();
        if (data.codex.limitGroups && data.codex.limitGroups.length > 0) {
            html += data.codex.limitGroups.map(group => renderLimitGroup(group, subtitle, '🟩')).join('');
        } else {
            html += renderServiceGroup('Codex', data.codex);
        }
    }

    if (!html) {
        html = `
            <div class="error-card">
                <div class="error-icon">🔍</div>
                <div class="error-title">No AI Services Active</div>
                <div class="error-desc">Ensure Antigravity IDE is running, or sign in to Claude Code / Codex.</div>
            </div>
        `;
    }
    document.getElementById('quota-list').innerHTML = html;
}

function createDonutSvg(pct) {
    const size = 26;
    const strokeWidth = 3.2;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const clampedPct = Math.max(0, Math.min(100, pct));
    const offset = circumference - (clampedPct / 100) * circumference;
    const color = healthColor(clampedPct);

    return `
        <svg class="donut-chart" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
            <circle class="donut-bg" cx="${size/2}" cy="${size/2}" r="${radius}" stroke="rgba(255, 255, 255, 0.1)" stroke-width="${strokeWidth}" fill="none"/>
            ${clampedPct > 0 ? `
                <circle class="donut-fill" cx="${size/2}" cy="${size/2}" r="${radius}" 
                    stroke="${color}" stroke-width="${strokeWidth}" fill="none"
                    stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
                    stroke-linecap="round"
                    transform="rotate(-90 ${size/2} ${size/2})"/>
            ` : `
                <circle class="donut-empty" cx="${size/2}" cy="${size/2}" r="${radius}" 
                    stroke="rgba(255, 255, 255, 0.16)" stroke-width="${strokeWidth}" fill="none"/>
            `}
        </svg>
    `;
}

function renderLimitGroup(group, subtitle, icon) {
    let rowsHtml = '';
    group.items.forEach((item, index) => {
        const isNotApplicable = item.notApplicable || (item.remaining === 0 && item.label.includes('Five Hour') && item.notApplicable);
        
        let statRightHtml = '';
        if (item.displayValue !== undefined && item.displayValue !== '') {
            statRightHtml = `
                <div class="limit-stat">
                    <span class="limit-badge-value">${escapeHtml(item.displayValue)}</span>
                </div>
            `;
        } else if (!isNotApplicable) {
            statRightHtml = `
                <div class="limit-stat">
                    <span class="limit-pct">${item.remaining}%</span>
                    ${createDonutSvg(item.remaining)}
                </div>
            `;
        } else {
            statRightHtml = `
                <div class="limit-stat">
                    <span class="limit-pct">0%</span>
                    ${createDonutSvg(0)}
                </div>
            `;
        }

        const divider = index < group.items.length - 1 ? '<div class="limit-row-divider"></div>' : '';

        rowsHtml += `
            <div class="limit-row">
                <div class="limit-row-header">
                    <span class="limit-name">${escapeHtml(item.label)}</span>
                    ${statRightHtml}
                </div>
                <div class="limit-desc">${escapeHtml(item.description)}</div>
            </div>
            ${divider}
        `;
    });

    const iconHtml = icon ? `<span class="group-icon">${icon}</span>` : '';
    const subtitleHtml = subtitle ? `<div class="limit-group-sub">${escapeHtml(subtitle)}</div>` : '';

    return `
        <div class="limit-group">
            <div class="limit-group-header">
                <div class="limit-group-title-wrap">
                    ${iconHtml}
                    <span class="limit-group-title">${escapeHtml(group.title)}</span>
                </div>
                <span class="info-icon" title="${escapeHtml(group.infoTooltip || '')}">ⓘ</span>
            </div>
            ${subtitleHtml}
            <div class="limit-card">
                ${rowsHtml}
            </div>
        </div>
    `;
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

function renderServiceGroup(serviceKey, status) {
    if (!status) return '';

    const meta = SERVICE_META[serviceKey] || { accent: '#64748B', icon: '🔹', title: serviceKey.toUpperCase() };
    const subtitle = `${status.tier || 'Free'} · ${status.email || ''}`.trim();

    if (status.error) {
        return `
            <div class="limit-group">
                <div class="limit-group-header">
                    <div class="limit-group-title-wrap">
                        <span class="group-icon">${meta.icon}</span>
                        <span class="limit-group-title">${escapeHtml(meta.title)}</span>
                    </div>
                </div>
                <div class="limit-card">
                    <div class="limit-row">
                        <p class="error-msg">${escapeHtml(status.error)}</p>
                    </div>
                </div>
            </div>
        `;
    }

    const items = (status.quotas || []).map(q => {
        const isPercent = isPercentQuota(q);
        if (!isPercent) {
            return {
                label: q.label,
                remaining: 0,
                displayValue: q.displayValue || '',
                description: 'Current model selected for session.'
            };
        }
        const timeFormatted = formatSessionResetText(q.resetTime, q.absResetTime);
        const isSession = q.label.includes('Session') || q.label.includes('5hr');
        const defaultName = isSession ? 'Five Hour Limit Remaining' : (q.label.includes('Weekly') || q.label.includes('7day') ? 'Weekly Limit Remaining' : q.label);
        return {
            label: defaultName,
            remaining: Math.round(q.remaining),
            description: q.remaining === 100
                ? `You have full limit available, ${timeFormatted}.`
                : (q.remaining === 0 ? `You have hit your limit, ${timeFormatted}.` : `You have used some of your limit, ${timeFormatted}.`),
            resetTimeText: q.resetTime
        };
    });

    return renderLimitGroup({
        id: serviceKey.toLowerCase(),
        title: meta.title,
        infoTooltip: `${meta.title} usage limits`,
        items
    }, subtitle, meta.icon);
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
