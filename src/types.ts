export interface LimitItem {
    label: string;
    remaining: number;
    description: string;
    resetTimeText?: string;
    notApplicable?: boolean;
    displayValue?: string;
}

export interface LimitGroup {
    id: string;
    title: string;
    infoTooltip?: string;
    items: LimitItem[];
}

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
    limitGroups?: LimitGroup[];
    isAuthenticated?: boolean;
    error?: string;
}

export interface DashboardData {
    antigravity: UserStatus | null;
    claude: UserStatus | null;
    codex: UserStatus | null;
    history?: HistoryEntry[];
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


