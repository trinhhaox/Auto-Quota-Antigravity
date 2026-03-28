import * as vscode from 'vscode';
import { QuotaInfo, HistoryData } from './types';

export class HistoryService {
    constructor(private readonly _globalState: vscode.Memento) { }

    track(service: string, quotas: QuotaInfo[]): void {
        const history = this.getHistory();
        const today = new Date().toISOString().split('T')[0];
        if (!history[today]) history[today] = {};

        quotas.forEach(q => {
            const key = `${service}_${q.label.replace(/ \(.+?\)/g, '')}`;
            const isUp = q.direction === 'up';
            const current = q.remaining;

            if (history[today][key] === undefined) {
                history[today][key] = { value: current, direction: q.direction || 'down' };
            } else {
                const entry = history[today][key];
                let normalized = typeof entry === 'number'
                    ? { value: entry, direction: (q.direction || 'down') as 'up' | 'down' }
                    : entry as { value: number; direction: 'up' | 'down' };
                normalized.value = isUp
                    ? Math.max(normalized.value, current)
                    : Math.min(normalized.value, current);
                history[today][key] = normalized;
            }
        });

        // Keep only 7 days
        const keys = Object.keys(history).sort();
        if (keys.length > 7) {
            keys.slice(0, keys.length - 7).forEach(k => delete history[k]);
        }

        this._globalState.update('quota_history', history);
    }

    getHistory(): HistoryData {
        return this._globalState.get<HistoryData>('quota_history', {}) ?? {};
    }
}
