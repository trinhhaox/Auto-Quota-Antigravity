import * as http from 'http';
import * as https from 'https';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { globalContext } from './extension';

const execAsync = promisify(exec);

// [ADDED] Utility: run a command with timeout, cross-platform
async function execWithTimeout(command: string, timeoutMs: number = 8000): Promise<{ stdout: string, stderr: string }> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Command timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        const options = process.platform === 'win32' ? { shell: 'powershell.exe' } : {};
        exec(command, options, (error, stdout, stderr) => {
            clearTimeout(timer);
            if (error) {
                (error as any).stdout = stdout;
                (error as any).stderr = stderr;
                reject(error);
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

export interface QuotaInfo {
    label: string;
    remaining: number;
    resetTime: string;
    themeColor?: string;
    absResetTime?: string;
    // [ADDED] Optional raw value for display (e.g. "23" or "20%")
    displayValue?: string;
    // [ADDED] Render style and direction
    style?: 'segmented' | 'fluid';
    direction?: 'up' | 'down';
}

export interface UserStatus {
    name: string;
    email: string;
    tier: string;
    quotas: QuotaInfo[];
    // [ADDED] Optional - used by Claude/Codex groups to show login prompt
    isAuthenticated?: boolean;
    error?: string;
}

// [ADDED] New interface for multi-service dashboard
export interface DashboardData {
    antigravity: UserStatus | null;
    claude: UserStatus | null;
    codex: UserStatus | null;
    autoClick?: any;
    history?: any;
}

const API_PATH = '/exa.language_server_pb.LanguageServerService/GetUserStatus';

export class QuotaService {
    private serverInfo: { port: number, token: string } | null = null;
    private discovering: Promise<boolean> | null = null;
    
    // [ADDED] Cache state
    private cachedClaude: UserStatus | null = null;
    private claudeLastFetch: number = 0;
    private cachedCodex: UserStatus | null = null;
    private codexLastFetch: number = 0;
    private readonly CACHE_TTL = 60000; // 60 seconds
    
    // [ADDED] Optional logger
    private logger?: vscode.OutputChannel;

    constructor(logger?: vscode.OutputChannel) {
        this.logger = logger;
    }

    private log(msg: string) {
        this.logger?.appendLine(`[${new Date().toLocaleTimeString()}] [QuotaService] ${msg}`);
    }

    private getClaudeLocalConfig(): { organizationId: string; email: string; displayName: string; subscriptionType: string; usagePeriod: '5-hour' | '7-day' | 'both' } {
        const sqmConfig = vscode.workspace.getConfiguration('sqm');
        let organizationId = sqmConfig.get<string>('claude.organizationId')?.trim() || '';
        let email = '';
        let displayName = '';
        let subscriptionType = '';

        // Read from ~/.claude.json (auto-populated by Claude Code)
        try {
            const claudeConfigPath = path.join(os.homedir(), '.claude.json');
            if (fs.existsSync(claudeConfigPath)) {
                const raw = fs.readFileSync(claudeConfigPath, 'utf8');
                const parsed = JSON.parse(raw);
                const oauth = parsed?.oauthAccount;
                if (oauth) {
                    if (!organizationId && oauth.organizationUuid) {
                        organizationId = oauth.organizationUuid;
                    }
                    email = oauth.emailAddress || '';
                    displayName = oauth.displayName || '';
                }
            }
        } catch { /* ignore */ }

        const usagePeriod =
            (sqmConfig.get<string>('claude.usagePeriod') as '5-hour' | '7-day' | 'both') || 'both';

        return { organizationId, email, displayName, subscriptionType, usagePeriod };
    }

    private async fetchClaudeUsage(sessionKey: string, organizationId: string): Promise<any> {
        const sqmConfig = vscode.workspace.getConfiguration('sqm');
        const cfClearance = sqmConfig.get<string>('claude.cfClearance')?.trim() || '';

        // Build cookie string - cf_clearance is required to bypass Cloudflare
        let cookieStr = `sessionKey=${sessionKey}; lastActiveOrg=${organizationId}`;
        if (cfClearance) {
            cookieStr += `; cf_clearance=${cfClearance}`;
        }

        return new Promise((resolve, reject) => {
            const options: https.RequestOptions = {
                method: 'GET',
                hostname: 'claude.ai',
                path: `/api/organizations/${organizationId}/usage`,
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/json',
                    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    'anthropic-client-platform': 'web_claude_ai',
                    'origin': 'https://claude.ai',
                    'referer': 'https://claude.ai/',
                    'cookie': cookieStr,
                    'sec-fetch-dest': 'empty',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-site': 'same-origin'
                },
                timeout: 10000
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 403) {
                        const hint = cfClearance
                            ? 'sessionKey or cf_clearance expired. Update from browser.'
                            : 'Cloudflare blocked. Add cf_clearance cookie in settings.';
                        return reject(new Error(`HTTP 403 — ${hint}`));
                    }
                    if (res.statusCode === 401) {
                        return reject(new Error('HTTP 401 — Unauthorized. Check organizationId.'));
                    }
                    if (res.statusCode !== 200) {
                        return reject(new Error(`HTTP ${res.statusCode}`));
                    }
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed);
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
            req.end();
        });
    }

    private buildClaudeQuotas(usageData: any, usagePeriod: '5-hour' | '7-day' | 'both'): QuotaInfo[] {
        const quotas: QuotaInfo[] = [];
        const five = usageData?.five_hour;
        const seven = usageData?.seven_day;

        const pushFive = () => {
            if (!five) return;
            // utilization is a fraction (0-1) from the API, convert to percentage
            const raw = Number(five.utilization || 0);
            const pct = Math.max(0, Math.min(100, raw <= 1 ? raw * 100 : raw));
            quotas.push({
                label: 'Session (5hr)',
                remaining: pct,
                displayValue: `${Math.round(pct)}%`,
                resetTime: '5h',
                themeColor: '#FFAB40',
                style: 'fluid',
                direction: 'up'
            });
        };

        const pushSeven = () => {
            if (!seven) return;
            // utilization is a fraction (0-1) from the API, convert to percentage
            const raw = Number(seven.utilization || 0);
            const pct = Math.max(0, Math.min(100, raw <= 1 ? raw * 100 : raw));
            quotas.push({
                label: 'Weekly (7day)',
                remaining: pct,
                displayValue: `${Math.round(pct)}%`,
                resetTime: '7d',
                themeColor: '#FF7043',
                style: 'fluid',
                direction: 'up'
            });
        };

        if (usagePeriod === '5-hour') {
            pushFive();
        } else if (usagePeriod === '7-day') {
            pushSeven();
        } else {
            pushFive();
            pushSeven();
        }

        return quotas;
    }

    async discoverLocalServer(): Promise<boolean> {
        if (this.discovering) return this.discovering;

        this.discovering = (async () => {
            try {
                let stdout = "";
                if (process.platform === 'win32') {
                    const command = 'powershell -ExecutionPolicy Bypass -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match \'csrf_token\' } | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"';
                    const res = await execAsync(command);
                    stdout = res.stdout;
                } else {
                    const command = 'ps -eo pid,command | grep csrf_token | grep -v grep';
                    const res = await execAsync(command);
                    const lines = res.stdout.trim().split('\n');
                    const arr = lines.map(line => {
                        const match = line.trim().match(/^(\d+)\s+(.+)$/);
                        if (match) {
                            return { ProcessId: parseInt(match[1]), CommandLine: match[2] };
                        }
                        return null;
                    }).filter(Boolean);
                    stdout = JSON.stringify(arr);
                }

                if (!stdout || stdout.trim() === "" || stdout.trim() === "[]") return false;

                let processes: any[] = [];
                try {
                    const parsed = JSON.parse(stdout.trim());
                    processes = Array.isArray(parsed) ? parsed : [parsed];
                } catch { return false; }

                for (const proc of processes) {
                    const cmdLine = proc.CommandLine || "";
                    const csrfMatch = cmdLine.match(/--csrf_token[\s=]+(?:["']?)([a-zA-Z0-9\-_.]+)(?:["']?)/);
                    if (!csrfMatch) continue;

                    const pid = proc.ProcessId;
                    const token = csrfMatch[1];
                    const listeningPorts = await this.getListeningPorts(pid);

                    for (const port of listeningPorts) {
                        if (await this.testConnection(port, token)) {
                            this.serverInfo = { port, token };
                            return true;
                        }
                    }
                }
            } catch (e) {
                console.error('[SQM] Discovery failed:', e);
            } finally {
                this.discovering = null;
            }
            return false;
        })();

        return this.discovering;
    }

    private async getListeningPorts(pid: number): Promise<number[]> {
        try {
            if (process.platform === 'win32') {
                const cmd = `powershell -NoProfile -Command "Get-NetTCPConnection -State Listen -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort | Sort-Object -Unique"`;
                const { stdout } = await execAsync(cmd);
                return stdout.trim().split(/\r?\n/).map(p => parseInt(p.trim())).filter(p => !isNaN(p) && p > 1024);
            } else {
                const cmd = `lsof -a -p ${pid} -i4TCP -sTCP:LISTEN -P -n | awk 'NR>1 {print $9}' | awk -F':' '{print $NF}' | sort -u`;
                const { stdout } = await execAsync(cmd);
                return stdout.trim().split(/\r?\n/).map(p => parseInt(p.trim())).filter(p => !isNaN(p) && p > 1024);
            }
        } catch { return []; }
    }

    private async testConnection(port: number, token: string): Promise<boolean> {
        return new Promise((resolve) => {
            const options = {
                hostname: '127.0.0.1', port, path: API_PATH, method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Codeium-Csrf-Token': token,
                    'Connect-Protocol-Version': '1'
                },
                timeout: 800
            };
            const req = http.request(options, (res) => resolve(res.statusCode === 200));
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
            req.write(JSON.stringify({ wrapper_data: {} }));
            req.end();
        });
    }

    async fetchStatus(): Promise<UserStatus | null> {
        if (!this.serverInfo) {
            const found = await this.discoverLocalServer();
            if (!found) return null;
        }

        try {
            const options = {
                hostname: '127.0.0.1', port: this.serverInfo!.port, path: API_PATH, method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Codeium-Csrf-Token': this.serverInfo!.token,
                    'Connect-Protocol-Version': '1'
                },
                timeout: 5000
            };

            return new Promise((resolve, reject) => {
                const req = http.request(options, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            try { resolve(this.parseResponse(JSON.parse(data))); } catch (e) { reject(e); }
                        } else { reject(new Error(`HTTP ${res.statusCode}`)); }
                    });
                });
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
                req.write(JSON.stringify({ wrapper_data: {} }));
                req.end();
            });
        } catch (e) {
            this.serverInfo = null;
            return null;
        }
    }

    private parseResponse(resp: any): UserStatus {
        const user = resp.userStatus;
        const modelConfigs = user?.cascadeModelConfigData?.clientModelConfigs || [];
        const quotas: QuotaInfo[] = modelConfigs
            .filter((m: any) => m.quotaInfo)
            .map((m: any) => {
                const resetTimeStr = m.quotaInfo.resetTime;
                let resetLabel = 'Ready';
                let absResetLabel = '';
                if (resetTimeStr && resetTimeStr !== 'Ready') {
                    const resetDate = new Date(resetTimeStr);
                    const diffMs = resetDate.getTime() - new Date().getTime();
                    if (diffMs > 0) {
                        const mins = Math.floor(diffMs / 60000);
                        resetLabel = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
                        // Absolute time format: (13h00)
                        const absHours = resetDate.getHours().toString().padStart(2, '0');
                        const absMins = resetDate.getMinutes().toString().padStart(2, '0');
                        absResetLabel = `(${absHours}h${absMins})`;
                    } else { resetLabel = 'Refreshing...'; }
                }
                return {
                    label: m.label,
                    remaining: (m.quotaInfo.remainingFraction || 0) * 100,
                    resetTime: resetLabel,
                    absResetTime: absResetLabel,
                    themeColor: m.label.includes('Gemini') ? '#40C4FF' : (m.label.includes('Claude') ? '#FFAB40' : '#69F0AE')
                };
            });
        return {
            name: user?.name || 'User',
            email: user?.email || '',
            tier: user?.userTier?.name || user?.planStatus?.planInfo?.planName || 'Free',
            quotas
        };
    }

    // ─── [ADDED] Claude Code Status ───────────────────────────────────────────
    async fetchClaudeStatus(): Promise<UserStatus | null> {
        const now = Date.now();
        if (this.cachedClaude && (now - this.claudeLastFetch < this.CACHE_TTL)) {
            return this.cachedClaude;
        }
        this.cachedClaude = await this._fetchClaudeStatusImpl();
        this.claudeLastFetch = now;
        return this.cachedClaude;
    }

    private async _fetchClaudeStatusImpl(): Promise<UserStatus | null> {
        this.log("Fetching Claude Status...");
        try {
            // Step 1: Read local config from ~/.claude.json (fast, no API call)
            const localConfig = this.getClaudeLocalConfig();

            // Step 2: Get auth status from CLI (for login check + subscription type)
            let authStatus: any = null;
            try {
                let binPath = "";
                const exeName = process.platform === 'win32' ? 'claude.exe' : 'claude';
                const ext = vscode.extensions.getExtension("anthropic.claude-code");
                if (ext) {
                    const candidate = path.join(ext.extensionPath, 'resources', 'native-binary', exeName);
                    if (fs.existsSync(candidate)) binPath = candidate;
                }
                if (!binPath) {
                    const home = os.homedir();
                    for (const dir of [path.join(home, '.antigravity', 'extensions'), path.join(home, '.vscode', 'extensions')]) {
                        try {
                            const cmd = process.platform === 'win32'
                                ? `powershell.exe -NoProfile -Command "Get-ChildItem -Path '${dir}' -Filter '${exeName}' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName"`
                                : `find "${dir}" -name "${exeName}" -type f 2>/dev/null | head -n 1`;
                            const { stdout } = await execWithTimeout(cmd, 6000);
                            if (stdout?.trim()) { binPath = stdout.trim(); break; }
                        } catch { /* ignore */ }
                    }
                }
                if (binPath) {
                    const cmd = process.platform === 'win32'
                        ? `powershell.exe -NoProfile -Command "& '${binPath}' auth status --json"`
                        : `"${binPath}" auth status --json`;
                    const { stdout } = await execWithTimeout(cmd, 6000);
                    authStatus = JSON.parse(stdout.trim());
                }
            } catch { /* CLI not available, use local config */ }

            // Determine auth state
            const isLoggedIn = authStatus?.loggedIn ?? !!localConfig.email;
            const email = authStatus?.email || localConfig.email || '';
            const tier = authStatus?.subscriptionType || localConfig.subscriptionType || 'Unknown';
            const displayName = localConfig.displayName || 'Claude Code';
            const organizationId = authStatus?.orgId || localConfig.organizationId;

            if (!isLoggedIn) {
                return { name: "Claude Code", email: "Not logged in", tier: "Guest", quotas: [], isAuthenticated: false };
            }

            // Step 3: Try to fetch usage data (requires sessionKey + cf_clearance)
            const sqmConfig = vscode.workspace.getConfiguration('sqm');
            const sessionKey = sqmConfig.get<string>('claude.sessionKey')?.trim() || '';

            if (!sessionKey || !organizationId) {
                return {
                    name: displayName,
                    email,
                    tier,
                    quotas: [],
                    isAuthenticated: true,
                    error: !sessionKey
                        ? "Add sessionKey + cf_clearance in settings to see usage %"
                        : "Missing organizationId"
                };
            }

            let usageData: any;
            try {
                usageData = await this.fetchClaudeUsage(sessionKey, organizationId);
            } catch (e: any) {
                return {
                    name: displayName,
                    email,
                    tier,
                    quotas: [],
                    isAuthenticated: true,
                    error: e?.message || 'Usage fetch failed'
                };
            }

            const quotas = this.buildClaudeQuotas(usageData, localConfig.usagePeriod);
            return {
                name: displayName,
                email,
                tier,
                quotas,
                isAuthenticated: true,
                error: quotas.length === 0 ? "No usage data returned" : undefined
            };
        } catch (e: any) {
            this.log(`Claude Status error: ${e.message}`);
            return { name: "Claude Code", email: "Check failed", tier: "Error", quotas: [], isAuthenticated: false, error: e.message };
        }
    }

    // ─── [ADDED] Codex Status ────────────────────────────────────────────────
    async fetchCodexStatus(): Promise<UserStatus | null> {
        const now = Date.now();
        if (this.cachedCodex && (now - this.codexLastFetch < this.CACHE_TTL)) {
            return this.cachedCodex;
        }
        this.cachedCodex = await this._fetchCodexStatusImpl();
        this.codexLastFetch = now;
        return this.cachedCodex;
    }

    private async _fetchCodexStatusImpl(): Promise<UserStatus | null> {
        this.log("Fetching Codex Status...");
        try {
            const home = os.homedir();
            const authFile = path.join(home, '.codex', 'auth.json');
            const configFile = path.join(home, '.codex', 'config.toml');

            // Check if Codex is installed (extension or local files)
            const ext = vscode.extensions.getExtension("openai.chatgpt");
            if (!ext && !fs.existsSync(authFile)) {
                return { name: "Codex", email: "Not installed", tier: "N/A", quotas: [], isAuthenticated: false };
            }

            // Read auth info from ~/.codex/auth.json
            if (!fs.existsSync(authFile)) {
                return { name: "Codex", email: "Not logged in", tier: "Guest", quotas: [], isAuthenticated: false };
            }

            let email = '';
            let planType = 'Free';
            let model = 'Unknown';

            try {
                const authData = JSON.parse(fs.readFileSync(authFile, 'utf8'));
                const idToken = authData?.tokens?.id_token;
                if (idToken) {
                    // Decode JWT payload (base64url) to get user info
                    const parts = idToken.split('.');
                    if (parts.length >= 2) {
                        const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
                        const claims = JSON.parse(payload);
                        email = claims.email || '';
                        const authInfo = claims['https://api.openai.com/auth'] || {};
                        planType = authInfo.chatgpt_plan_type || 'free';
                    }
                }
            } catch { /* JWT decode failed */ }

            // Read model from config.toml
            try {
                if (fs.existsSync(configFile)) {
                    const configRaw = fs.readFileSync(configFile, 'utf8');
                    const modelMatch = configRaw.match(/^model\s*=\s*"([^"]+)"/m);
                    if (modelMatch) model = modelMatch[1];
                }
            } catch { /* ignore */ }

            this.log(`Codex: ${email} (${planType}), model: ${model}`);
            return {
                name: "Codex",
                email,
                tier: planType.charAt(0).toUpperCase() + planType.slice(1),
                quotas: [],
                isAuthenticated: true,
                error: `Model: ${model} — Usage tracking not available via API`
            };
        } catch (e: any) {
            this.log(`Codex Status error: ${e.message}`);
            return { name: "Codex", email: "Check failed", tier: "Error", quotas: [], isAuthenticated: false, error: e.message };
        }
    }

    // ─── [ADDED] Combined dashboard fetch ────────────────────────────────────
    async fetchDashboard(): Promise<DashboardData> {
        const [antigravity, claude, codex] = await Promise.all([
            this.fetchStatus(),
            this.fetchClaudeStatus(),
            this.fetchCodexStatus()
        ]);

        // --- HISTORY TRACKING ---
        let history: any = {};
        if (globalContext) {
            history = globalContext.globalState.get('quota_history', {}) as any;
            const today = new Date().toISOString().split('T')[0];
            if (!history[today]) history[today] = {};
            
            const track = (service: string, quotas: QuotaInfo[]) => {
                quotas.forEach(q => {
                    const key = `${service}_${q.label.replace(/ \(.+?\)/g, '')}`;
                    const isUp = q.direction === 'up';
                    const current = q.remaining;
                    if (history[today][key] === undefined) {
                        history[today][key] = { value: current, direction: q.direction || 'down' };
                    } else {
                        const entry = history[today][key];
                        // Normalize old format (plain number) to new format
                        if (typeof entry === 'number') {
                            history[today][key] = { value: entry, direction: q.direction || 'down' };
                        }
                        if (isUp) history[today][key].value = Math.max(history[today][key].value, current);
                        else history[today][key].value = Math.min(history[today][key].value, current);
                    }
                });
            };
            
            if (antigravity?.quotas) track('AG', antigravity.quotas);
            if (claude?.quotas) track('Claude', claude.quotas);
            if (codex?.quotas) track('Codex', codex.quotas);
            
            const keys = Object.keys(history).sort();
            if (keys.length > 7) {
                const toRemove = keys.slice(0, keys.length - 7);
                toRemove.forEach(k => delete history[k]);
            }
            globalContext.globalState.update('quota_history', history);
        }

        return { antigravity, claude, codex, history };
    }
}
