import * as vscode from 'vscode';
import { DashboardData, HistoryEntry, QuotaInfo } from './types';

/**
 * Persistent quota history for sidebar sparklines.
 * Snapshots are throttled to one per MIN_GAP_MS and capped at MAX_ENTRIES
 * (~24h of data at the default 5-minute refresh interval).
 */

// v2: Claude/Codex values switched from used% to remaining% — old entries
// would render inverted sparklines, so start a fresh store.
const STORE_KEY = 'quota_history_v2';
const MAX_ENTRIES = 288;
const MIN_GAP_MS = 4 * 60 * 1000;

let ctx: vscode.ExtensionContext | null = null;
let entries: HistoryEntry[] = [];

export function initQuotaHistory(context: vscode.ExtensionContext) {
    ctx = context;
    entries = context.globalState.get<HistoryEntry[]>(STORE_KEY, []);
}

export function recordQuotaSnapshot(data: DashboardData) {
    if (!ctx) return;
    const now = Date.now();
    if (entries.length && now - entries[entries.length - 1].t < MIN_GAP_MS) return;

    const v: Record<string, number> = {};
    const collect = (service: string, quotas?: QuotaInfo[] | null) => {
        for (const q of quotas || []) {
            // Skip non-percentage rows (e.g. Codex "Active Model" text gauge)
            if (q.displayValue !== undefined && !q.displayValue.endsWith('%')) continue;
            v[`${service}-${q.label}`] = Math.round(q.remaining * 10) / 10;
        }
    };
    collect('Antigravity', data.antigravity?.quotas);
    collect('Claude', data.claude?.quotas);
    collect('Codex', data.codex?.quotas);
    if (Object.keys(v).length === 0) return;

    entries.push({ t: now, v });
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
    ctx.globalState.update(STORE_KEY, entries);
}

export function getQuotaHistory(): HistoryEntry[] {
    return entries;
}
