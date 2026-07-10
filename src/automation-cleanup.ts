import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

/**
 * One-shot cleanup for users upgrading from a version that injected the
 * auto-click bridge into the IDE's workbench.html. The automation feature has
 * been removed, so any leftover injection + patched product.json checksums must
 * be reverted — otherwise the IDE keeps loading a dead bridge script and may
 * warn about a modified installation.
 *
 * Fully best-effort: only touches files when a leftover injection is found, and
 * never throws into activation.
 */

const SCRIPT_TAG_ID = 'ag-logic-bridge';

function getTargetFile(): string | null {
    const root = vscode.env.appRoot;
    const paths = [
        path.join(root, 'out/vs/code/electron-sandbox/workbench/workbench.html'),
        path.join(root, 'out/vs/code/electron-browser/workbench/workbench.html'),
        path.join(root, 'out/vs/workbench/workbench.html')
    ];
    return paths.find(p => fs.existsSync(p)) || null;
}

function writeSafe(p: string, c: string): void {
    try {
        fs.writeFileSync(p, c, 'utf8');
    } catch {
        if (process.platform === 'win32') throw new Error('Administrator privileges required to clean up automation.');
        const tmp = path.join(os.tmpdir(), `ag_cleanup_${process.pid}`);
        fs.writeFileSync(tmp, c);
        try {
            const cmd = process.platform === 'darwin'
                ? `osascript -e 'do shell script "cp \\"${tmp}\\" \\"${p}\\"" with administrator privileges'`
                : `pkexec cp "${tmp}" "${p}"`;
            execSync(cmd);
        } finally {
            try { fs.unlinkSync(tmp); } catch { /* best-effort */ }
        }
    }
}

function recalculateHashes(): void {
    try {
        const pJson = path.join(vscode.env.appRoot, 'product.json');
        const data = JSON.parse(fs.readFileSync(pJson, 'utf8'));
        if (!data.checksums) return;
        for (const k of Object.keys(data.checksums)) {
            const fullPath = path.join(vscode.env.appRoot, 'out', k.split('/').join(path.sep));
            if (fs.existsSync(fullPath)) {
                data.checksums[k] = crypto.createHash('sha256')
                    .update(fs.readFileSync(fullPath)).digest('base64').replace(/=+$/, '');
            }
        }
        writeSafe(pJson, JSON.stringify(data, null, '\t'));
    } catch { /* best-effort */ }
}

/**
 * Remove any leftover bridge injection. Returns true if something was cleaned.
 */
export function cleanupLegacyAutomation(logger?: vscode.OutputChannel): boolean {
    const log = (m: string) => logger?.appendLine(`[${new Date().toLocaleTimeString()}] [Cleanup] ${m}`);
    try {
        const target = getTargetFile();
        if (!target) return false;

        let html = fs.readFileSync(target, 'utf8');
        if (!html.includes(SCRIPT_TAG_ID)) return false; // nothing injected — no writes, no prompt

        const startTag = `<!-- ${SCRIPT_TAG_ID}-START -->`;
        const endTag = `<!-- ${SCRIPT_TAG_ID}-END -->`;
        const startIdx = html.indexOf(startTag);
        const endIdx = html.indexOf(endTag);
        if (startIdx !== -1 && endIdx !== -1) {
            html = html.substring(0, startIdx) + html.substring(endIdx + endTag.length);
            html = html.replace(/\n\s*\n/g, '\n');
            writeSafe(target, html);
            recalculateHashes();
            log('Removed leftover automation bridge from workbench.html');
        }

        const bridgeFile = path.join(path.dirname(target), 'ag-automation-bridge.js');
        if (fs.existsSync(bridgeFile)) {
            try { fs.unlinkSync(bridgeFile); } catch { /* best-effort */ }
        }
        return true;
    } catch (e: any) {
        log(`Cleanup failed: ${e?.message}`);
        return false;
    }
}
