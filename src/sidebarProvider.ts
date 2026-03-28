import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { QuotaService } from './quotaService';
import { setLatestData } from "./extension";
import { DashboardData, WebviewMessage, AutoClickDiagnostics } from './types';

function getNonce(): string {
    return crypto.randomBytes(16).toString('hex');
}

const SECRET_KEYS = ['claude.sessionKey', 'claude.cfClearance'] as const;

export class SidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    private static _latestData: (DashboardData & { autoClick?: AutoClickDiagnostics }) | null = null;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _quotaService: QuotaService,
        private readonly _secrets: vscode.SecretStorage
    ) { }

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        if (SidebarProvider._latestData) {
            this.syncToWebview(SidebarProvider._latestData);
        }

        this.updateData();

        webviewView.webview.onDidReceiveMessage(async (data: WebviewMessage) => {
            if (data.type === "onRefresh") {
                this.updateData();
            } else if (data.type === "onAutoClickChange") {
                vscode.commands.executeCommand("ag-manager.updateAutoClick", data.config);
            } else if (data.type === "getSettings") {
                await this._sendSettings();
            } else if (data.type === "saveSettings") {
                await this._saveSettings(data.settings);
            }
        });
    }

    public syncToWebview(data: DashboardData & { autoClick?: AutoClickDiagnostics }) {
        SidebarProvider._latestData = data;
        if (this._view) {
            this._view.webview.postMessage({ type: "update", data });
        }
    }

    public async updateData() {
        if (this._view) {
            this._view.webview.postMessage({ type: "loading" });
        }
        const data = await this._quotaService.fetchDashboard();
        setLatestData(data);
    }

    private async _sendSettings() {
        const sqm = vscode.workspace.getConfiguration('sqm');
        const ag = vscode.workspace.getConfiguration('ag-manager');

        // Read secrets from SecretStorage (masked for display)
        const sessionKey = (await this._secrets.get('claude.sessionKey')) || '';
        const cfClearance = (await this._secrets.get('claude.cfClearance')) || '';

        this._view?.webview.postMessage({
            type: 'settings',
            settings: {
                'claude.sessionKey': sessionKey,
                'claude.cfClearance': cfClearance,
                'claude.organizationId': sqm.get<string>('claude.organizationId') || '',
                'claude.usagePeriod': sqm.get<string>('claude.usagePeriod') || 'both',
                'refreshInterval': sqm.get<number>('refreshInterval') || 5,
                'enableNotifications': sqm.get<boolean>('enableNotifications') !== false,
                'automation.enabled': ag.get<boolean>('automation.enabled') !== false,
            }
        });
    }

    private async _saveSettings(settings: Record<string, unknown>) {
        const sqm = vscode.workspace.getConfiguration('sqm');
        const ag = vscode.workspace.getConfiguration('ag-manager');
        const target = vscode.ConfigurationTarget.Global;

        for (const [key, value] of Object.entries(settings)) {
            // Store secrets in SecretStorage, not in settings.json
            if (SECRET_KEYS.includes(key as typeof SECRET_KEYS[number])) {
                await this._secrets.store(key, String(value));
            } else if (key.startsWith('automation.')) {
                await ag.update(key, value, target);
            } else {
                await sqm.update(key, value, target);
            }
        }

        await this._sendSettings();
        this.updateData();
        vscode.window.showInformationMessage('Settings saved!');
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "webview-ui", "style.css"));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "webview-ui", "main.js"));

        const nonce = getNonce();
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
                <link href="${styleUri}" rel="stylesheet">
            </head>
            <body>
                <div id="app">
                    <div class="header">
                        <h1>Quota Dashboard</h1>
                        <div class="header-actions">
                            <button id="settings-btn" title="Settings">&#9881;</button>
                            <button id="refresh-btn">Refresh</button>
                        </div>
                    </div>
                    <div id="settings-panel" class="settings-container hidden"></div>
                    <div id="user-info"></div>
                    <div id="quota-list">
                        <p class="loading">Establishing connection...</p>
                    </div>
                </div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}
