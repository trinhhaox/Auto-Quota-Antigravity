import * as http from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execAsync = promisify(exec);

export interface QuotaInfo {
    label: string;
    remaining: number;
    resetTime: string;
    themeColor: string;
}

export interface UserStatus {
    name: string;
    email: string;
    tier: string;
    quotas: QuotaInfo[];
}

const API_PATH = '/exa.language_server_pb.LanguageServerService/GetUserStatus';

export class QuotaService {
    private serverInfo: { port: number, token: string } | null = null;
    private discovering: Promise<boolean> | null = null;

    async discoverLocalServer(): Promise<boolean> {
        if (this.discovering) return this.discovering;

        this.discovering = (async () => {
            try {
                const command = 'powershell -ExecutionPolicy Bypass -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match \'csrf_token\' } | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"';
                const { stdout } = await execAsync(command);
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
            const cmd = `powershell -NoProfile -Command "Get-NetTCPConnection -State Listen -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort | Sort-Object -Unique"`;
            const { stdout } = await execAsync(cmd);
            return stdout.trim().split(/\r?\n/).map(p => parseInt(p.trim())).filter(p => !isNaN(p) && p > 1024);
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
}
