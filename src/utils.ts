export function formatTime(t: string): string {
    const hMatch = t.match(/(\d+)h/);
    const mMatch = t.match(/(\d+)m/);
    if (!hMatch && !mMatch) return t;
    let h = hMatch ? parseInt(hMatch[1]) : 0;
    let m = mMatch ? parseInt(mMatch[1]) : 0;
    if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h ${m}m`;
    return `0d ${h}h ${m}m`;
}

export function getQuotaColor(pct: number, direction: 'up' | 'down' = 'down'): { hex: string, dot: string } {
    if (direction === 'up') {
        if (pct < 80) return { hex: '#FFAB40', dot: '\u{1F7E0}' };
        return { hex: '#ef4444', dot: '\u{1F534}' };
    } else {
        if (pct > 50) return { hex: '#10b981', dot: '\u{1F7E2}' };
        if (pct > 20) return { hex: '#f59e0b', dot: '\u{1F7E1}' };
        return { hex: '#ef4444', dot: '\u{1F534}' };
    }
}
