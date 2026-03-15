import * as vscode from 'vscode';
import { QuotaService } from './quotaService';
import { SidebarProvider } from './sidebarProvider';
import { AutomationService } from './automationService';

let statusBarItem: vscode.StatusBarItem;
let latestQuotaData: any = null;
let globalSidebarProvider: SidebarProvider | null = null;
let globalContext: vscode.ExtensionContext | null = null;
let automationService: AutomationService | null = null;

const GROUPS = [
    { id: 'g1', title: 'GEMINI 3.1 PRO', models: ['Gemini 3.1 Pro (High)', 'Gemini 3.1 Pro (Low)'] },
    { id: 'g2', title: 'GEMINI 3 FLASH', models: ['Gemini 3 Flash'] },
    { id: 'g3', title: 'CLAUDE/GPT', models: ['Claude Sonnet 4.6 (Thinking)', 'Claude Opus 4.6 (Thinking)', 'GPT-OSS 120B (Medium)'] }
];

export function activate(context: vscode.ExtensionContext) {
    globalContext = context;
    const quotaService = new QuotaService();
    globalSidebarProvider = new SidebarProvider(context.extensionUri, quotaService);
    automationService = new AutomationService(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("sqm.sidebar", globalSidebarProvider)
    );

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    // Click opens the sidebar focus
    statusBarItem.command = "sqm.sidebar.focus";
    statusBarItem.text = "$(dashboard) AG Manager";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    context.subscriptions.push(
        vscode.commands.registerCommand("sqm.refresh", async () => {
            if (globalSidebarProvider) await globalSidebarProvider.updateData();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("ag-manager.updateAutoClick", async (config) => {
            if (automationService) {
                await automationService.patchSettings(config);
                // Force UI update to reflect new state immediately
                setLatestData(latestQuotaData);
            }
        })
    );

    // Initial fetch
    setTimeout(() => { if (globalSidebarProvider) globalSidebarProvider.updateData(); }, 2000);
}

function formatTime(t: string): string {
    const hMatch = t.match(/(\d+)h/);
    const mMatch = t.match(/(\d+)m/);
    if (!hMatch && !mMatch) return t;
    let h = hMatch ? parseInt(hMatch[1]) : 0;
    let m = mMatch ? parseInt(mMatch[1]) : 0;
    if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h ${m}m`;
    return `0d ${h}h ${m}m`;
}

function buildTooltipSVG(data: any): string {
    const rowHeight = 30;
    const groupHeaderHeight = 22;
    const padding = 15;
    const width = 400;

    let contentHtml = '';
    let currentY = padding + 5;

    GROUPS.forEach((group) => {
        const members = data.quotas.filter((q: any) => group.models.includes(q.label));
        if (members.length === 0) return;

        // Group Header
        contentHtml += `<text x="${padding}" y="${currentY + 12}" font-family="sans-serif" font-size="10" font-weight="800" fill="#4B5563" text-transform="uppercase">${group.title}</text>`;
        currentY += groupHeaderHeight;

        members.forEach((q: any) => {
            const pct = Math.round(q.remaining);
            const dotColor = pct > 50 ? '#10b981' : (pct > 20 ? '#f59e0b' : '#ef4444');
            const time = formatTime(q.resetTime);

            // Row Highlight
            contentHtml += `<rect x="${padding - 5}" y="${currentY}" width="${width - padding * 2 + 10}" height="${rowHeight - 4}" rx="6" fill="#FFFFFF" fill-opacity="0.03"/>`;

            // Dot
            contentHtml += `<circle cx="${padding + 8}" cy="${currentY + 13}" r="3.5" fill="${dotColor}"/>`;

            // Model Name
            const cleanName = q.label.replace(' (Thinking)', '').replace(' (Medium)', '');
            contentHtml += `<text x="${padding + 22}" y="${currentY + 17}" font-family="sans-serif" font-size="11" font-weight="600" fill="#9CA3AF">${cleanName}</text>`;

            // Segmented Bar (Aligned to specific X)
            const barX = 180;
            const segWidth = 10;
            const segGap = 2;
            const filled = Math.min(5, Math.ceil(pct / 20));
            for (let i = 0; i < 5; i++) {
                const opacity = i < filled ? 0.9 : 0.15;
                contentHtml += `<rect x="${barX + i * (segWidth + segGap)}" y="${currentY + 12}" width="${segWidth}" height="4" rx="1" fill="${q.themeColor}" fill-opacity="${opacity}"/>`;
            }

            // Fixed alignment for Pct & Time
            const pctX = 250; // Shifted right and anchor=start
            contentHtml += `<text x="${pctX}" y="${currentY + 17}" text-anchor="start" font-family="monospace" font-size="11" font-weight="bold" fill="#FFFFFF">${pct}%</text>`;

            const fullTime = `${time} ${q.absResetTime || ''}`.trim();
            const timeX = 285; // Move time closer to percentage
            contentHtml += `<text x="${timeX}" y="${currentY + 17}" text-anchor="start" font-family="monospace" font-size="10" font-weight="bold" fill="#FFFFFF">${fullTime}</text>`;

            currentY += rowHeight;
        });

        // Small spacing between groups
        contentHtml += `<line x1="${padding}" y1="${currentY - 5}" x2="${width - padding}" y2="${currentY - 5}" stroke="#2D333D" stroke-width="1" stroke-opacity="0.5"/>`;
        currentY += 4;
    });

    const totalHeight = currentY + 5;

    return `
    <svg width="${width}" height="${totalHeight}" viewBox="0 0 ${width} ${totalHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${totalHeight}" rx="10" fill="#1a1c23" stroke="#2d333d" stroke-width="1"/>
        ${contentHtml}
    </svg>`;
}

function refreshStatusBar() {
    if (!latestQuotaData?.quotas?.length) return;

    // Status bar text - Thêm icon dot theo từng group (Unicode 🟢, 🟡, 🔴)
    const groupsText = GROUPS.map(g => {
        const members = latestQuotaData.quotas.filter((q: any) => g.models.includes(q.label));
        if (members.length === 0) return '';
        const avg = members.reduce((acc: number, curr: any) => acc + curr.remaining, 0) / members.length;
        const short = g.id === 'g1' ? 'Pro' : (g.id === 'g2' ? 'Flash' : 'C/G');
        const dot = avg > 50 ? '🟢' : (avg > 20 ? '🟡' : '🔴');
        return `${dot} ${short} ${Math.round(avg)}%`;
    }).filter(t => t !== '').join('  |  ');

    statusBarItem.text = `$(dashboard)  ${groupsText}`;

    // Beautiful Tooltip
    const svg = buildTooltipSVG(latestQuotaData);
    const base64 = Buffer.from(svg).toString('base64');

    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`![Quota Info](data:image/svg+xml;base64,${base64})\n\n`);
    tooltip.appendMarkdown(`&nbsp;&nbsp;&nbsp;&nbsp;**${latestQuotaData.name}** · [Open Dashboard](command:sqm.sidebar.focus)`);
    tooltip.isTrusted = true;
    statusBarItem.tooltip = tooltip;
}

export function setLatestData(data: any) {
    latestQuotaData = data;
    refreshStatusBar();
    if (globalSidebarProvider && data) {
        const autoStatus = automationService ? automationService.dumpDiagnostics() : {};
        globalSidebarProvider.syncToWebview({ ...data, autoClick: autoStatus });
    }
}

export function deactivate() { }
