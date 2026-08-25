export function formatTime(t: string): string {
    const hMatch = t.match(/(\d+)h/);
    const mMatch = t.match(/(\d+)m/);
    if (!hMatch && !mMatch) return t;
    const h = hMatch ? parseInt(hMatch[1]) : 0;
    const m = mMatch ? parseInt(mMatch[1]) : 0;
    if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h ${m}m`;
    return `${h}h ${m}m`;
}

// Short reset time for compact status bar display (e.g. "1h30m" -> "1h30m" or "45m")
export function formatShortReset(t?: string): string {
    if (!t || t === 'Ready' || t === 'Refreshing...') return '';
    const hMatch = t.match(/(\d+)h/);
    const mMatch = t.match(/(\d+)m/);
    const h = hMatch ? parseInt(hMatch[1]) : 0;
    const m = mMatch ? parseInt(mMatch[1]) : 0;
    if (h >= 24) return `${Math.floor(h / 24)}d`;
    if (h > 0 && m > 0) return `${h}h${m}m`;
    if (h > 0) return `${h}h`;
    if (m > 0) return `${m}m`;
    return t.replace(/\s+/g, '');
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

// Format reset string specifically for session bar footer (e.g. "Resets today at 11:19", "Resets in 1d 17h (23h39)")
export function formatSessionResetText(resetTime?: string, absResetTime?: string): string {
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
        // Within same day or tomorrow morning
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

// Format duration as natural English text like IDE (e.g. "1 day, 16 hours", "4 hours, 38 minutes", "20 hours, 37 minutes")
export function formatNaturalDuration(diffMs: number): string {
    if (diffMs <= 0) return 'a few moments';
    const totalMinutes = Math.floor(diffMs / 60000);
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const mins = totalMinutes % 60;

    if (days > 0) {
        const dayStr = `${days} day${days > 1 ? 's' : ''}`;
        const hourStr = hours > 0 ? `, ${hours} hour${hours > 1 ? 's' : ''}` : '';
        return `${dayStr}${hourStr}`;
    }
    if (hours > 0) {
        const hourStr = `${hours} hour${hours > 1 ? 's' : ''}`;
        const minStr = mins > 0 ? `, ${mins} minute${mins > 1 ? 's' : ''}` : '';
        return `${hourStr}${minStr}`;
    }
    return `${mins} minute${mins > 1 ? 's' : ''}`;
}

export function formatNaturalDurationFromDate(dateStr?: string): string {
    if (!dateStr || dateStr === 'Ready') return '';
    try {
        const resetDate = new Date(dateStr);
        const diffMs = resetDate.getTime() - Date.now();
        return formatNaturalDuration(diffMs);
    } catch {
        return '';
    }
}
