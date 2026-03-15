import * as vscode from 'vscode';
import { QuotaService } from './quotaService';
import { setLatestData } from "./extension";

export class SidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    private static _latestData: any = null;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _quotaService: QuotaService
    ) { }

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Gửi ngay dữ liệu mới nhất nếu có
        if (SidebarProvider._latestData) {
            this.syncToWebview(SidebarProvider._latestData);
        }

        // Tự động refresh nhẹ nhàng khi mở ra
        this.updateData();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (data.type === "onRefresh") {
                this.updateData();
            } else if (data.type === "onAutoClickChange") {
                // We'll need a reference to autoClickManager or use a global command/state
                vscode.commands.executeCommand("ag-manager.updateAutoClick", data.config);
            }
        });
    }

    public syncToWebview(data: any) {
        SidebarProvider._latestData = data;
        if (this._view) {
            this._view.webview.postMessage({ type: "update", data });
        }
    }

    public async updateData() {
        if (this._view) {
            this._view.webview.postMessage({ type: "loading" });
        }
        const data = await this._quotaService.fetchStatus();
        setLatestData(data); // Cập nhật global state và status bar
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "webview-ui", "style.css"));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "webview-ui", "main.js"));

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet">
            </head>
            <body>
                <div id="app">
                    <div class="header">
                        <h1>Quota Dashboard</h1>
                        <button id="refresh-btn">Refresh</button>
                    </div>
                    <div id="user-info"></div>
                    <div id="quota-list">
                        <p class="loading">Establishing connection...</p>
                    </div>
                </div>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}
