import * as vscode from 'vscode';

/**
 * Automation statistics: daily action counts (7-day retention) and
 * stuck-loop detection — if one rule fires too often in a short window,
 * the agent is probably looping and the user should know.
 */
export class AutomationStats {
    private static readonly LOOP_WINDOW_MS = 5 * 60 * 1000;
    private static readonly LOOP_LIMIT = 15;          // clicks of one rule per window
    private static readonly ALERT_COOLDOWN_MS = 10 * 60 * 1000;
    private static readonly STORE_KEY = 'automation_daily';

    private daily: Record<string, number>;
    private ruleEvents: Record<string, number[]> = {};
    private lastLoopAlert: Record<string, number> = {};

    constructor(
        private readonly ctx: vscode.ExtensionContext,
        private readonly onPauseRequest: () => void
    ) {
        this.daily = ctx.globalState.get<Record<string, number>>(AutomationStats.STORE_KEY, {});
        this.prune();
    }

    // LOCAL date key — toISOString() would bucket late-evening actions into
    // "yesterday" for timezones ahead of UTC.
    private static dateKey(d: Date): string {
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${m}-${day}`;
    }

    private todayKey(): string {
        return AutomationStats.dateKey(new Date());
    }

    private prune() {
        const keep = new Set<string>();
        for (let i = 0; i < 7; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            keep.add(AutomationStats.dateKey(d));
        }
        for (const k of Object.keys(this.daily)) {
            if (!keep.has(k)) delete this.daily[k];
        }
    }

    /** Called with each metrics delta reported by the bridge heartbeat. */
    recordDelta(delta: Record<string, number>) {
        const total = Object.values(delta).reduce((a, b) => a + (Number(b) || 0), 0);
        if (total <= 0) return;

        const t = this.todayKey();
        this.daily[t] = (this.daily[t] || 0) + total;
        this.prune();
        this.ctx.globalState.update(AutomationStats.STORE_KEY, this.daily);

        const now = Date.now();
        for (const [rule, raw] of Object.entries(delta)) {
            const count = Number(raw) || 0;
            if (count <= 0) continue;
            const events = (this.ruleEvents[rule] = this.ruleEvents[rule] || []);
            for (let i = 0; i < count; i++) events.push(now);
            while (events.length && now - events[0] > AutomationStats.LOOP_WINDOW_MS) events.shift();
            this.maybeAlertLoop(rule, events.length, now);
        }
    }

    private maybeAlertLoop(rule: string, hits: number, now: number) {
        if (hits < AutomationStats.LOOP_LIMIT) return;
        if (now - (this.lastLoopAlert[rule] || 0) < AutomationStats.ALERT_COOLDOWN_MS) return;
        this.lastLoopAlert[rule] = now;

        vscode.window.showWarningMessage(
            `Automation rule "${rule}" fired ${hits} times in 5 minutes — the agent may be stuck in a loop.`,
            'Pause Automation', 'Dismiss'
        ).then(sel => {
            if (sel === 'Pause Automation') this.onPauseRequest();
        });
    }

    getDaily(): Record<string, number> {
        return { ...this.daily };
    }
}
