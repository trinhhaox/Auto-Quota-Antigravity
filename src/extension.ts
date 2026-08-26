import * as vscode from 'vscode';
import { QuotaService } from './quotaService';
import { SidebarProvider } from './sidebarProvider';
import { checkForUpdates } from './updater';
import { cleanupLegacyAutomation } from './automation-cleanup';
import { DashboardData, ModelGroup, QuotaInfo, UserStatus } from './types';
import { formatTime, getQuotaColor, isPercentQuota, formatShortReset, formatSessionResetText } from './utils';
import { initQuotaHistory, recordQuotaSnapshot, getQuotaHistory } from './quota-history';

let statusBarItem: vscode.StatusBarItem;
let latestQuotaData: DashboardData | null = null;
let latestDataHash: string = '';
let globalSidebarProvider: SidebarProvider | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let lastRefreshAt = 0;
const notifiedModels = new Set<string>();

function autoDetectGroups(quotas: QuotaInfo[]): ModelGroup[] {
    const geminiModels: string[] = [];
    const claudeGptModels: string[] = [];
    const otherModels: string[] = [];

    for (const q of quotas) {
        if (q.label.startsWith('Gemini')) {
            geminiModels.push(q.label);
        } else if (q.label.startsWith('Claude') || q.label.startsWith('GPT')) {
            claudeGptModels.push(q.label);
        } else {
            otherModels.push(q.label);
        }
    }

    const groups: ModelGroup[] = [];
    if (geminiModels.length > 0) {
        groups.push({
            id: 'gemini',
            title: 'GEMINI MODELS',
            models: geminiModels
        });
    }
    if (claudeGptModels.length > 0) {
        groups.push({
            id: 'claude_gpt',
            title: 'CLAUDE / GPT',
            models: claudeGptModels
        });
    }
    if (otherModels.length > 0) {
        groups.push({
            id: 'other',
            title: 'OTHER',
            models: otherModels
        });
    }
    return groups;
}


export function activate(context: vscode.ExtensionContext) {
    const logger = vscode.window.createOutputChannel('Aquota');
    context.subscriptions.push(logger);

    // One-time cleanup: remove any auto-click bridge injected by older versions.
    setTimeout(() => cleanupLegacyAutomation(logger), 500);

    const quotaService = new QuotaService(logger);
    globalSidebarProvider = new SidebarProvider(context.extensionUri, quotaService);
    initQuotaHistory(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("sqm.sidebar", globalSidebarProvider)
    );

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = "sqm.menu";
    statusBarItem.text = "$(dashboard) Aquota";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    context.subscriptions.push(
        vscode.commands.registerCommand("sqm.refresh", async () => {
            if (globalSidebarProvider) await globalSidebarProvider.updateData();
        })
    );

    // Quick Pick menu opened from the status bar item
    context.subscriptions.push(
        vscode.commands.registerCommand("sqm.menu", async () => {
            type MenuItem = vscode.QuickPickItem & { id: string };
            const items: MenuItem[] = [
                { id: 'refresh', label: '$(refresh) Refresh quotas now' },
                { id: 'dashboard', label: '$(dashboard) Open Aquota Dashboard' },
                { id: 'settings', label: '$(gear) Extension settings' }
            ];
            const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Aquota Quick Menu' });
            switch (pick?.id) {
                case 'refresh': triggerRefresh(); break;
                case 'dashboard': vscode.commands.executeCommand('sqm.sidebar.focus'); break;
                case 'settings': vscode.commands.executeCommand('workbench.action.openSettings', 'sqm'); break;
            }
        })
    );

    // Initial fetch
    setTimeout(() => triggerRefresh(), 2000);

    startAutoRefresh();

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration("sqm.refreshInterval")) {
            startAutoRefresh();
        }
        if (e.affectsConfiguration("sqm.statusBar.mode") || e.affectsConfiguration("sqm.statusBar.usagePeriod")) {
            refreshStatusBar();
        }
    }));

    // Catch up immediately when the window regains focus with stale data
    context.subscriptions.push(vscode.window.onDidChangeWindowState(ws => {
        const intervalMs = (vscode.workspace.getConfiguration("sqm").get<number>("refreshInterval") || 5) * 60 * 1000;
        if (ws.focused && Date.now() - lastRefreshAt > intervalMs) {
            triggerRefresh();
        }
    }));

    // [AUTO-UPDATER] Check for new version from GitHub after 10s
    setTimeout(() => {
        checkForUpdates(context);
    }, 10000);
}

// Escape text nodes for the tooltip SVG — a label containing & or < would
// otherwise invalidate the whole XML document and blank the tooltip.
function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatCleanModelName(label: string): string {
    return label
        .replace(/^Gemini\s+/i, '')
        .replace(/^Claude\/GPT\s+/i, '')
        .replace(/\s*\(Thinking\)/i, '')
        .replace(/\s*\(Medium\)/i, '')
        .replace(/\s*\(High\)/i, '')
        .replace(/\s*\(Low\)/i, '')
        .trim();
}

function getStatusBarLabel(groupTitle: string, isClaudeCli?: boolean): string {
    if (isClaudeCli) return 'Claude CLI';
    const upper = groupTitle.toUpperCase().trim();
    if (upper.includes('GEMINI') && upper.includes('PRO')) return 'Gemini Pro';
    if (upper.includes('GEMINI') && upper.includes('FLASH')) return 'Gemini Flash';
    if (upper.includes('GEMINI')) return 'Gemini';
    if (upper.includes('CLAUDE')) return 'Claude';
    if (upper.includes('CODEX')) return 'Codex';
    return groupTitle.split('/')[0].trim();
}

interface StatusSegment {
    label: string;
    pct: number;
    dot: string;
    resetText?: string;
    health: number;
}

function buildTooltipSVG(data: DashboardData): string {
    const groupHeaderHeight = 24;
    const padding = 16;
    const width = 440;

    let contentHtml = '';
    let currentY = padding + 22;

    // Determine overall health for header badge
    let minHealth = 100;
    const checkHealth = (quotas?: QuotaInfo[]) => {
        if (!quotas) return;
        for (const q of quotas) {
            if (isPercentQuota(q) && q.remaining < minHealth) {
                minHealth = q.remaining;
            }
        }
    };
    checkHealth(data.antigravity?.quotas);
    checkHealth(data.claude?.quotas);
    checkHealth(data.codex?.quotas);

    const badgeColor = minHealth > 50 ? '#10B981' : (minHealth > 20 ? '#F59E0B' : '#EF4444');
    const badgeText = minHealth > 50 ? 'ALL NORMAL' : (minHealth > 20 ? 'MODERATE' : 'LOW QUOTA');

    // Header title (Aquota) and status pill
    contentHtml += `<text x="${padding}" y="${padding + 10}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="900" fill="#38BDF8" letter-spacing="0.8">⚡ AQUOTA</text>`;
    contentHtml += `<rect x="${width - padding - 82}" y="${padding - 2}" width="82" height="17" rx="8.5" fill="${badgeColor}" fill-opacity="0.15" stroke="${badgeColor}" stroke-opacity="0.4" stroke-width="1"/>`;
    contentHtml += `<circle cx="${width - padding - 73}" cy="${padding + 6.5}" r="2.5" fill="${badgeColor}"/>`;
    contentHtml += `<text x="${width - padding - 65}" y="${padding + 10}" font-family="system-ui, -apple-system, sans-serif" font-size="8.5" font-weight="700" fill="${badgeColor}">${badgeText}</text>`;

    const renderGroupSection = (title: string, quotas: QuotaInfo[], accentColor: string = '#64748B') => {
        if (!quotas || quotas.length === 0) return;

        contentHtml += `<text x="${padding}" y="${currentY + 12}" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="800" fill="${accentColor}" letter-spacing="0.5">${escapeXml(title)}</text>`;
        currentY += groupHeaderHeight;

        quotas.forEach((q) => {
            const pct = Math.round(q.remaining);
            const isPercent = isPercentQuota(q);
            const color = isPercent ? getQuotaColor(pct) : { hex: '#6B7280', dot: '' };
            const cleanName = formatCleanModelName(q.label);
            const sessionReset = formatSessionResetText(q.resetTime, q.absResetTime);

            if (!isPercent) {
                // Informational row (e.g. Active Model)
                const infoHeight = 32;
                contentHtml += `<rect x="${padding}" y="${currentY}" width="${width - padding * 2}" height="${infoHeight - 4}" rx="6" fill="#FFFFFF" fill-opacity="0.035"/>`;
                contentHtml += `<text x="${padding + 12}" y="${currentY + 18}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600" fill="#E2E8F0">${escapeXml(cleanName)}</text>`;
                contentHtml += `<text x="${width - padding - 12}" y="${currentY + 18}" text-anchor="end" font-family="ui-monospace, SFMono-Regular, monospace" font-size="11" font-weight="bold" fill="#69F0AE">${escapeXml(q.displayValue || '')}</text>`;
                currentY += infoHeight;
            } else {
                // Session-style Card
                const cardHeight = 54;
                const cardWidth = width - padding * 2;
                const trackWidth = cardWidth - 24;
                const fillWidth = Math.max(3, (pct / 100) * trackWidth);
                const isSession = cleanName.includes('Session') || cleanName.includes('5hr') || cleanName.includes('5-Hour');
                const isWeekly = cleanName.includes('Weekly') || cleanName.includes('7day') || cleanName.includes('7-Day');
                const subLabel = isSession ? '5-hour window' : (isWeekly ? '7-day window' : (title.includes('CLAUDE CODE') ? '5-hour window' : 'Shared Pool'));

                // Card background
                contentHtml += `<rect x="${padding}" y="${currentY}" width="${cardWidth}" height="${cardHeight - 6}" rx="8" fill="#FFFFFF" fill-opacity="0.03" stroke="#FFFFFF" stroke-opacity="0.05" stroke-width="1"/>`;

                // Top: Model / Session Label & Subtitle
                contentHtml += `<circle cx="${padding + 12}" cy="${currentY + 13}" r="3" fill="${color.hex}"/>`;
                contentHtml += `<text x="${padding + 20}" y="${currentY + 16}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#F1F5F9">${escapeXml(cleanName)}</text>`;
                contentHtml += `<text x="${width - padding - 12}" y="${currentY + 16}" text-anchor="end" font-family="system-ui, -apple-system, sans-serif" font-size="9" font-weight="500" fill="#64748B">${escapeXml(subLabel)}</text>`;

                // Middle: Full-width Progress Bar
                const barY = currentY + 23;
                contentHtml += `<rect x="${padding + 12}" y="${barY}" width="${trackWidth}" height="5" rx="2.5" fill="#FFFFFF" fill-opacity="0.08"/>`;
                contentHtml += `<rect x="${padding + 12}" y="${barY}" width="${fillWidth}" height="5" rx="2.5" fill="${color.hex}" fill-opacity="0.95"/>`;

                // Bottom: Percent left and Friendly Reset Time
                const textY = currentY + 41;
                contentHtml += `<text x="${padding + 12}" y="${textY}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="800" fill="${color.hex}">${pct}% <tspan font-weight="500" font-size="9.5" fill="#94A3B8">left</tspan></text>`;
                contentHtml += `<text x="${width - padding - 12}" y="${textY}" text-anchor="end" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5" font-weight="500" fill="#94A3B8">${escapeXml(sessionReset)}</text>`;

                currentY += cardHeight;
            }
        });

        contentHtml += `<line x1="${padding}" y1="${currentY - 2}" x2="${width - padding}" y2="${currentY - 2}" stroke="#252C3F" stroke-width="1" stroke-opacity="0.6"/>`;
        currentY += 6;
    };

    if (data.antigravity?.quotas) {
        const groups = autoDetectGroups(data.antigravity.quotas);
        groups.forEach(group => {
            const members = data.antigravity!.quotas.filter((q) => group.models.includes(q.label));
            renderGroupSection(`ANTIGRAVITY · ${group.title}`, members, '#38BDF8');
        });
    }

    if (data.claude?.quotas) {
        renderGroupSection("CLAUDE CODE (CLI)", data.claude.quotas, '#FB923C');
    }

    if (data.codex?.quotas) {
        renderGroupSection("OPENAI CODEX", data.codex.quotas, '#4ADE80');
    }

    const totalHeight = currentY + 6;

    return `
    <svg width="${width}" height="${totalHeight}" viewBox="0 0 ${width} ${totalHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${totalHeight}" rx="12" fill="#12151E" stroke="#252C3F" stroke-width="1.2"/>
        ${contentHtml}
    </svg>`;
}


function refreshStatusBar() {
    if (!latestQuotaData) return;

    const segments: StatusSegment[] = [];
    const period = vscode.workspace.getConfiguration('sqm').get<string>('statusBar.usagePeriod') || '5-hour';

    const selectQuota = (quotasList: QuotaInfo[]): QuotaInfo | undefined => {
        if (!quotasList || quotasList.length === 0) return undefined;
        if (period === '5-hour') {
            const fiveHr = quotasList.find(q => q.label.includes('5hr') || q.label.includes('5-Hour') || q.label.includes('Session'));
            if (fiveHr) return fiveHr;
        } else if (period === '7-day') {
            const sevenDay = quotasList.find(q => q.label.includes('7day') || q.label.includes('7-Day') || q.label.includes('Weekly'));
            if (sevenDay) return sevenDay;
        }
        return quotasList.reduce((a, b) => (b.remaining < a.remaining ? b : a));
    };

    // 1. Antigravity IDE - Gemini Models
    if (latestQuotaData.antigravity?.quotas) {
        const geminiQuotas = latestQuotaData.antigravity.quotas.filter(q => q.label.startsWith('Gemini') && isPercentQuota(q));
        const targetGemini = selectQuota(geminiQuotas);
        if (targetGemini) {
            const pct = Math.round(targetGemini.remaining);
            const color = getQuotaColor(targetGemini.remaining);
            const resetShort = formatShortReset(targetGemini.resetTime);
            segments.push({
                label: 'Gemini',
                pct,
                dot: color.dot,
                resetText: resetShort,
                health: targetGemini.remaining
            });
        }

        // Antigravity IDE - Claude / GPT Models
        const claudeGptQuotas = latestQuotaData.antigravity.quotas.filter(q => (q.label.startsWith('Claude') || q.label.startsWith('GPT')) && isPercentQuota(q));
        const targetClaudeGpt = selectQuota(claudeGptQuotas);
        if (targetClaudeGpt) {
            const pct = Math.round(targetClaudeGpt.remaining);
            const color = getQuotaColor(targetClaudeGpt.remaining);
            const resetShort = formatShortReset(targetClaudeGpt.resetTime);
            segments.push({
                label: 'Claude',
                pct,
                dot: color.dot,
                resetText: resetShort,
                health: targetClaudeGpt.remaining
            });
        }
    }

    // 2. Claude Code CLI (if authenticated)
    if (latestQuotaData.claude?.isAuthenticated && latestQuotaData.claude.quotas?.length) {
        const claudeCliQuotas = latestQuotaData.claude.quotas.filter(isPercentQuota);
        const q = selectQuota(claudeCliQuotas);
        if (q) {
            const pct = Math.round(q.remaining);
            const color = getQuotaColor(q.remaining);
            const resetShort = formatShortReset(q.resetTime);
            segments.push({
                label: 'CLI',
                pct,
                dot: color.dot,
                resetText: resetShort,
                health: q.remaining
            });
        }
    }

    // 3. OpenAI Codex (if authenticated and has percentage)
    if (latestQuotaData.codex?.isAuthenticated && latestQuotaData.codex.quotas?.length) {
        const codexQuotas = latestQuotaData.codex.quotas.filter(isPercentQuota);
        const q = selectQuota(codexQuotas);
        if (q) {
            const pct = Math.round(q.remaining);
            const color = getQuotaColor(q.remaining);
            const resetShort = formatShortReset(q.resetTime);
            segments.push({
                label: 'Codex',
                pct,
                dot: color.dot,
                resetText: resetShort,
                health: q.remaining
            });
        }
    }

    const mode = vscode.workspace.getConfiguration('sqm').get<string>('statusBar.mode') || 'full';
    let text = 'Aquota';
    let minHealth = 100;

    const formatSegment = (s: StatusSegment, includeReset: boolean = true): string => {
        if (includeReset && s.pct < 100 && s.resetText) {
            return `${s.dot} ${s.label} ${s.pct}% (${s.resetText})`;
        }
        return `${s.dot} ${s.label} ${s.pct}%`;
    };

    if (segments.length > 0) {
        const worst = segments.reduce((a, b) => (b.health < a.health ? b : a));
        minHealth = worst.health;

        if (mode === 'dot') {
            text = worst.health < 100 ? `${worst.dot} ${worst.pct}%` : `${worst.dot} 100%`;
        } else if (mode === 'compact') {
            if (worst.health < 100) {
                text = formatSegment(worst, true);
            } else {
                text = `🟢 All 100%`;
            }
        } else {
            // Full mode: Compact middle-dot separation to prevent overlap
            text = segments.map(s => formatSegment(s, true)).join(' · ');
        }
    }

    // Visual Alert icon when any quota <= 20% without intrusive full-bar highlight
    if (minHealth <= 20) {
        statusBarItem.text = `$(warning) ${text}`;
    } else {
        statusBarItem.text = `$(dashboard) ${text}`;
    }
    statusBarItem.backgroundColor = undefined;
    statusBarItem.color = undefined;


    const svg = buildTooltipSVG(latestQuotaData);
    const base64 = Buffer.from(svg).toString('base64');

    const tooltip = new vscode.MarkdownString();
    tooltip.isTrusted = true;
    tooltip.supportHtml = true;
    tooltip.appendMarkdown(`![Quota Info](data:image/svg+xml;base64,${base64})\n\n`);

    const name = latestQuotaData.antigravity?.name || "User";
    const tier = latestQuotaData.antigravity?.tier || "";
    const tierDisplay = tier ? ` (${tier})` : "";
    tooltip.appendMarkdown(`&nbsp;&nbsp;⚡ **Aquota** · 👤 **${name}**${tierDisplay} &nbsp;&nbsp;·&nbsp;&nbsp; [🔄 Refresh](command:sqm.refresh) &nbsp;|&nbsp; [📊 Dashboard](command:sqm.sidebar.focus) &nbsp;|&nbsp; [⚙️ Settings](command:sqm.menu)`);
    statusBarItem.tooltip = tooltip;
}


export function setLatestData(data: DashboardData) {
    const dataStr = JSON.stringify(data);
    if (dataStr === latestDataHash) {
        return;
    }

    latestQuotaData = data;
    latestDataHash = dataStr;

    recordQuotaSnapshot(data);
    refreshStatusBar();
    if (globalSidebarProvider && data) {
        globalSidebarProvider.syncToWebview({
            ...data,
            history: getQuotaHistory()
        });
    }
    checkNotifications(data);
}

function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);

    const config = vscode.workspace.getConfiguration("sqm");
    const intervalMins = config.get<number>("refreshInterval") || 5;

    refreshTimer = setInterval(() => {
        // Skip while the window is unfocused — polling spawns ps/lsof and hits
        // remote APIs for data nobody is looking at. A focus listener catches up.
        if (!vscode.window.state.focused) return;
        triggerRefresh();
    }, intervalMins * 60 * 1000);
}

function triggerRefresh() {
    lastRefreshAt = Date.now();
    if (globalSidebarProvider) globalSidebarProvider.updateData();
}

function checkNotifications(data: DashboardData) {
    const config = vscode.workspace.getConfiguration("sqm");
    if (!config.get<boolean>("enableNotifications")) return;
    const threshold = Math.max(1, Math.min(90, config.get<number>("notifyThreshold") || 20));

    const checkQuota = (serviceName: string, quotas: QuotaInfo[]) => {
        if (!quotas) return;
        quotas.forEach(q => {
            if (!isPercentQuota(q)) return; // informational rows never notify
            const modelKey = `${serviceName}-${q.label}`;
            const pct = Math.round(q.remaining);

            if (pct > threshold) {
                notifiedModels.delete(modelKey);
                return;
            }

            if (notifiedModels.has(modelKey)) return;

            const message = `${serviceName} [${q.label}] quota is low (${pct}% remaining).`;

            vscode.window.showWarningMessage(message, "Dashboard").then(selection => {
                if (selection === "Dashboard") {
                    vscode.commands.executeCommand("sqm.sidebar.focus");
                }
            });
            notifiedModels.add(modelKey);
        });
    };

    if (data.antigravity?.quotas) checkQuota("Antigravity", data.antigravity.quotas);
    if (data.claude?.quotas) checkQuota("Claude", data.claude.quotas);
    if (data.codex?.quotas) checkQuota("Codex", data.codex.quotas);
}

export function deactivate() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}
