import * as vscode from 'vscode';
import * as https from 'https';

const REPO_OWNER = 'trinhvanhao';
const REPO_NAME = 'Auto-Quota-Antigravity';
const API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

export async function checkForUpdates(context: vscode.ExtensionContext) {
    try {
        const currentVersion = context.extension.packageJSON.version;
        if (!currentVersion) return;

        const options = {
            headers: {
                'User-Agent': 'VSCode-Auto-Quota-Antigravity-Extension'
            }
        };

        https.get(API_URL, options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const release = JSON.parse(data);
                        const latestTag = release.tag_name; // e.g., v1.2.2 or 1.2.2
                        if (!latestTag) return;

                        const latestVersion = latestTag.replace(/^v/, '');

                        if (isNewerVersion(currentVersion, latestVersion)) {
                            showUpdateNotification(latestVersion, release.html_url);
                        }
                    } catch (e) {
                        console.error('Failed to parse GitHub release data', e);
                    }
                }
            });
        }).on('error', (e) => {
            console.error('Error checking for updates:', e);
        });

    } catch (err) {
        console.error('Auto-Updater error:', err);
    }
}

function isNewerVersion(current: string, latest: string): boolean {
    const currentParts = current.split('.').map(Number);
    const latestParts = latest.split('.').map(Number);

    for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
        const c = currentParts[i] || 0;
        const l = latestParts[i] || 0;
        if (l > c) return true;
        if (l < c) return false;
    }
    return false;
}

async function showUpdateNotification(newVersion: string, url: string) {
    const action = 'Tải Về Ngay';
    const message = `Một phiên bản mới của Auto Quota Antigravity (v${newVersion}) đã sẵn sàng!`;
    const result = await vscode.window.showInformationMessage(message, action);

    if (result === action) {
        vscode.env.openExternal(vscode.Uri.parse(url));
    }
}
