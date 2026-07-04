export function formatTime(t: string): string {
    const hMatch = t.match(/(\d+)h/);
    const mMatch = t.match(/(\d+)m/);
    if (!hMatch && !mMatch) return t;
    const h = hMatch ? parseInt(hMatch[1]) : 0;
    const m = mMatch ? parseInt(mMatch[1]) : 0;
    if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h ${m}m`;
    return `${h}h ${m}m`;
}

// Single color rule for every service: remaining >50% green, >20% yellow, else red
export function getQuotaColor(pct: number): { hex: string, dot: string } {
    if (pct > 50) return { hex: '#10b981', dot: '\u{1F7E2}' };
    if (pct > 20) return { hex: '#f59e0b', dot: '\u{1F7E1}' };
    return { hex: '#ef4444', dot: '\u{1F534}' };
}

// Percentage rows follow the countdown rule; text rows (model names) don't
export function isPercentQuota(q: { displayValue?: string }): boolean {
    return q.displayValue === undefined || q.displayValue.endsWith('%');
}
