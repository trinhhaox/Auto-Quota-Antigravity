// All quotas use one rule: `remaining` counts DOWN from 100% (full) to 0% (exhausted).
// Rows whose displayValue is not a percentage (e.g. Codex "Active Model") are
// informational only and excluded from color/notification/history logic.
export interface QuotaInfo {
    label: string;
    remaining: number;
    resetTime: string;
    themeColor?: string;
    absResetTime?: string;
    displayValue?: string;
    style?: 'segmented' | 'fluid';
}

export interface UserStatus {
    name: string;
    email: string;
    tier: string;
    quotas: QuotaInfo[];
    isAuthenticated?: boolean;
    error?: string;
}

export interface DashboardData {
    antigravity: UserStatus | null;
    claude: UserStatus | null;
    codex: UserStatus | null;
}

export type WebviewMessage =
    | { type: 'onRefresh' }
    | { type: 'getSettings' }
    | { type: 'saveSettings'; settings: Record<string, unknown> };

export interface ModelGroup {
    id: string;
    title: string;
    models: string[];
}

// One timestamped snapshot of all quota percentages, keyed "Service-Label"
export interface HistoryEntry {
    t: number;
    v: Record<string, number>;
}

