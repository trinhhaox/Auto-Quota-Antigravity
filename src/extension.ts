import * as vscode from 'vscode';
import { QuotaService } from './quotaService';
import { SidebarProvider } from './sidebarProvider';
import { checkForUpdates } from './updater';
import { cleanupLegacyAutomation } from './automation-cleanup';
import { DashboardData, ModelGroup, QuotaInfo, UserStatus } from './types';
import { formatTime, getQuotaColor, isPercentQuota } from './utils';
import { initQuotaHistory, recordQuotaSnapshot, getQuotaHistory } from './quota-history';

let statusBarItem: vscode.StatusBarItem;
let latestQuotaData: DashboardData | null = null;
let latestDataHash: string = '';
let globalSidebarProvider: SidebarProvider | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let lastRefreshAt = 0;
const notifiedModels = new Set<string>();

function autoDetectGroups(quotas: QuotaInfo[]): ModelGroup[] {
    const groupMap = new Map<string, string[]>();
    for (const q of quotas) {
        // Extract prefix: "Gemini 3.1 Pro (High)" -> "Gemini 3.1 Pro"
        // "Claude Sonnet 4.6 (Thinking)" -> "Claude/GPT" group
        const label = q.label;
        let groupKey: string;
        if (label.startsWith('Gemini')) {
            const match = label.match(/^(Gemini [\d.]+ \w+)/);
            groupKey = match ? match[1] : 'Gemini';
        } else {
            groupKey = 'Claude/GPT';
        }
        if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
        groupMap.get(groupKey)!.push(label);
    }
    return Array.from(groupMap.entries()).map(([key, models], i) => ({
        id: `g${i}`,
        title: key.toUpperCase(),
        models
    }));
}

export function activate(context: vscode.ExtensionContext) {
    const logger = vscode.window.createOutputChannel('Auto Quota Antigravity');
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
    statusBarItem.text = "$(dashboard) Auto Quota Antigravity";
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
                { id: 'dashboard', label: '$(dashboard) Open dashboard' },
                { id: 'settings', label: '$(gear) Extension settings' }
            ];
            const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Auto Quota Antigravity' });
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
        if (e.affectsConfiguration("sqm.statusBar.mode")) {
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

function buildTooltipSVG(data: DashboardData): string {
    const rowHeight = 30;
    const groupHeaderHeight = 22;
    const padding = 15;
    const width = 400;

    let contentHtml = '';
    let currentY = padding + 5;

    const renderGroupSection = (title: string, quotas: QuotaInfo[]) => {
        if (!quotas || quotas.length === 0) return;

        contentHtml += `<text x="${padding}" y="${currentY + 12}" font-family="sans-serif" font-size="10" font-weight="800" fill="#4B5563" text-transform="uppercase">${escapeXml(title)}</text>`;
        currentY += groupHeaderHeight;

        quotas.forEach((q) => {
            const pct = Math.round(q.remaining);
            const isPercent = isPercentQuota(q);
            const color = isPercent ? getQuotaColor(pct) : { hex: '#6B7280', dot: '' };
            const time = formatTime(q.resetTime);

            contentHtml += `<rect x="${padding - 5}" y="${currentY}" width="${width - padding * 2 + 10}" height="${rowHeight - 4}" rx="6" fill="#FFFFFF" fill-opacity="0.03"/>`;
            contentHtml += `<circle cx="${padding + 8}" cy="${currentY + 13}" r="3.5" fill="${color.hex}"/>`;

            const cleanName = q.label.replace(' (Thinking)', '').replace(' (Medium)', '');
            contentHtml += `<text x="${padding + 22}" y="${currentY + 17}" font-family="sans-serif" font-size="11" font-weight="600" fill="#9CA3AF">${escapeXml(cleanName)}</text>`;

            const barX = 180;
            const barWidth = 60;

            if (!isPercent) {
                // No bar for informational rows
            } else if (q.style === 'fluid') {
                const fillWidth = (pct / 100) * barWidth;
                contentHtml += `<rect x="${barX}" y="${currentY + 12}" width="${barWidth}" height="4" rx="2" fill="#FFFFFF" fill-opacity="0.1"/>`;
                contentHtml += `<rect x="${barX}" y="${currentY + 12}" width="${fillWidth}" height="4" rx="2" fill="${color.hex}" fill-opacity="0.9"/>`;
            } else {
                const segWidth = 10;
                const segGap = 2;
                const filled = Math.min(5, Math.ceil(pct / 20));
                for (let i = 0; i < 5; i++) {
                    const opacity = i < filled ? 0.9 : 0.15;
                    contentHtml += `<rect x="${barX + i * (segWidth + segGap)}" y="${currentY + 12}" width="${segWidth}" height="4" rx="1" fill="${color.hex}" fill-opacity="${opacity}"/>`;
                }
            }

            const pctX = 250;
            const centerText = q.displayValue !== undefined ? q.displayValue : `${pct}%`;
            contentHtml += `<text x="${pctX}" y="${currentY + 17}" text-anchor="start" font-family="monospace" font-size="11" font-weight="bold" fill="#FFFFFF">${escapeXml(centerText)}</text>`;

            const fullTime = `${time} ${q.absResetTime || ''}`.trim();
            const timeX = 285;
            contentHtml += `<text x="${timeX}" y="${currentY + 17}" text-anchor="start" font-family="monospace" font-size="10" font-weight="bold" fill="#FFFFFF">${escapeXml(fullTime)}</text>`;

            currentY += rowHeight;
        });

        contentHtml += `<line x1="${padding}" y1="${currentY - 5}" x2="${width - padding}" y2="${currentY - 5}" stroke="#2D333D" stroke-width="1" stroke-opacity="0.5"/>`;
        currentY += 4;
    };

    if (data.antigravity?.quotas) {
        const groups = autoDetectGroups(data.antigravity.quotas);
        groups.forEach(group => {
            const members = data.antigravity!.quotas.filter((q) => group.models.includes(q.label));
            renderGroupSection(group.title, members);
        });
    }

    if (data.claude?.quotas) {
        renderGroupSection("CLAUDE CODE", data.claude.quotas);
    }

    if (data.codex?.quotas) {
        renderGroupSection("CODEX", data.codex.quotas);
    }

    const totalHeight = currentY + 5;

    return `
    <svg width="${width}" height="${totalHeight}" viewBox="0 0 ${width} ${totalHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${totalHeight}" rx="10" fill="#1a1c23" stroke="#2d333d" stroke-width="1"/>
        ${contentHtml}
    </svg>`;
}

function refreshStatusBar() {
    if (!latestQuotaData) return;

    // Each segment carries a "health" (0 = worst, 100 = best) so compact/dot
    // modes can surface the single most critical service.
    const segments: { text: string; dot: string; health: number }[] = [];

    if (latestQuotaData.antigravity?.quotas) {
        const groups = autoDetectGroups(latestQuotaData.antigravity.quotas);
        for (const g of groups) {
            const members = latestQuotaData.antigravity.quotas.filter((q) => g.models.includes(q.label));
            if (members.length === 0) continue;
            const avg = members.reduce((acc, curr) => acc + curr.remaining, 0) / members.length;
            const shortName = g.title.replace('GEMINI ', 'G').replace(' PRO', 'P').replace(' FLASH', 'F').split('/')[0];
            const dot = avg > 50 ? '🟢' : (avg > 20 ? '🟡' : '🔴');
            segments.push({ text: `${dot} ${shortName} ${Math.round(avg)}%`, dot, health: avg });
        }
    }

    // Claude / Codex (if authenticated) — first percentage row drives the dot
    const pushService = (name: string, status: UserStatus | null | undefined) => {
        if (!status?.isAuthenticated || !status.quotas?.length) return;
        const q = status.quotas.find(isPercentQuota);
        if (!q) return;
        const color = getQuotaColor(q.remaining);
        segments.push({ text: `${name} ${color.dot}`, dot: color.dot, health: q.remaining });
    };
    pushService('Claude', latestQuotaData.claude);
    pushService('Codex', latestQuotaData.codex);

    const mode = vscode.workspace.getConfiguration('sqm').get<string>('statusBar.mode') || 'full';
    let text = 'Auto Quota Antigravity';
    if (segments.length > 0) {
        const worst = segments.reduce((a, b) => (b.health < a.health ? b : a));
        if (mode === 'dot') text = worst.dot;
        else if (mode === 'compact') text = worst.text;
        else text = segments.map(s => s.text).join('  |  ');
    }
    statusBarItem.text = `$(dashboard)  ${text}`;

    const svg = buildTooltipSVG(latestQuotaData);
    const base64 = Buffer.from(svg).toString('base64');

    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`![Quota Info](data:image/svg+xml;base64,${base64})\n\n`);
    const name = latestQuotaData.antigravity?.name || "User";
    tooltip.appendMarkdown(`&nbsp;&nbsp;&nbsp;&nbsp;**${name}** · [Dashboard](command:sqm.sidebar.focus)`);
    tooltip.isTrusted = true;
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
