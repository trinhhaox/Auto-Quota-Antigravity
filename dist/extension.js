"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate,
  setLatestData: () => setLatestData
});
module.exports = __toCommonJS(extension_exports);
var vscode5 = __toESM(require("vscode"));

// src/quotaService.ts
var http = __toESM(require("http"));
var https = __toESM(require("https"));
var import_child_process = require("child_process");
var import_util = require("util");
var vscode = __toESM(require("vscode"));
var fs2 = __toESM(require("fs"));
var os2 = __toESM(require("os"));
var path2 = __toESM(require("path"));

// src/codex-rate-limits.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var os = __toESM(require("os"));
var MAX_STALE_MS = 24 * 60 * 60 * 1e3;
var TAIL_BYTES = 262144;
function findNewestSessionFile(root) {
  let newest = null;
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries2;
    try {
      entries2 = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries2) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (e.name.endsWith(".jsonl")) {
        try {
          const mtime = fs.statSync(full).mtimeMs;
          if (!newest || mtime > newest.mtime) newest = { file: full, mtime };
        } catch {
        }
      }
    }
  };
  walk(root, 0);
  return newest;
}
function readTail(file, bytes) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}
function extractLatestRateLimits(content) {
  const lines = content.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits"')) continue;
    try {
      const obj = JSON.parse(lines[i]);
      const rl = obj?.payload?.rate_limits || obj?.rate_limits;
      if (rl?.primary || rl?.secondary) return rl;
    } catch {
    }
  }
  return null;
}
function toQuota(win, label, color) {
  const used = Number(win?.used_percent);
  if (!isFinite(used)) return null;
  const pct = 100 - Math.max(0, Math.min(100, used));
  let resetTime = "";
  let absResetTime = "";
  let secs = Number(win?.resets_in_seconds);
  if (!isFinite(secs) || secs <= 0) {
    const at = Number(win?.resets_at);
    if (isFinite(at) && at > 0) secs = at - Math.floor(Date.now() / 1e3);
  }
  if (isFinite(secs) && secs > 0) {
    const mins = Math.floor(secs / 60);
    resetTime = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
    const resetDate = new Date(Date.now() + secs * 1e3);
    absResetTime = `(${String(resetDate.getHours()).padStart(2, "0")}h${String(resetDate.getMinutes()).padStart(2, "0")})`;
  }
  return {
    label,
    remaining: pct,
    displayValue: `${Math.round(pct)}%`,
    resetTime,
    absResetTime,
    themeColor: color,
    style: "fluid"
  };
}
function readCodexRateLimits() {
  try {
    const sessionsDir = path.join(os.homedir(), ".codex", "sessions");
    if (!fs.existsSync(sessionsDir)) return [];
    const newest = findNewestSessionFile(sessionsDir);
    if (!newest || Date.now() - newest.mtime > MAX_STALE_MS) return [];
    const rl = extractLatestRateLimits(readTail(newest.file, TAIL_BYTES));
    if (!rl) return [];
    const quotas = [];
    const primary = toQuota(rl.primary, "Session (5h)", "#69F0AE");
    const secondary = toQuota(rl.secondary, "Weekly", "#26A69A");
    if (primary) quotas.push(primary);
    if (secondary) quotas.push(secondary);
    return quotas;
  } catch {
    return [];
  }
}

// src/quotaService.ts
var execAsync = (0, import_util.promisify)(import_child_process.exec);
async function execWithTimeout(command, timeoutMs = 8e3) {
  return new Promise((resolve, reject) => {
    let child;
    const timer = setTimeout(() => {
      child?.kill();
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const options = process.platform === "win32" ? { shell: "powershell.exe" } : {};
    child = (0, import_child_process.exec)(command, options, (error, stdout, stderr) => {
      clearTimeout(timer);
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}
var API_PATH = "/exa.language_server_pb.LanguageServerService/GetUserStatus";
var QuotaService = class {
  serverInfo = null;
  discovering = null;
  cachedClaude = null;
  claudeLastFetch = 0;
  claudeNextRetry = 0;
  // earliest retry time after a transient failure
  cachedCodex = null;
  codexLastFetch = 0;
  CACHE_TTL = 12e4;
  // 120 seconds (OAuth endpoint rate-limits aggressively)
  RETRY_TTL = 45e3;
  // back off 45s between attempts once rate-limited
  logger;
  constructor(logger) {
    this.logger = logger;
  }
  log(msg) {
    this.logger?.appendLine(`[${(/* @__PURE__ */ new Date()).toLocaleTimeString()}] [QuotaService] ${msg}`);
  }
  getClaudeLocalConfig() {
    const sqmConfig = vscode.workspace.getConfiguration("sqm");
    let organizationId = sqmConfig.get("claude.organizationId")?.trim() || "";
    let email = "";
    let displayName = "";
    let subscriptionType = "";
    try {
      const claudeConfigPath = path2.join(os2.homedir(), ".claude.json");
      if (fs2.existsSync(claudeConfigPath)) {
        const raw = fs2.readFileSync(claudeConfigPath, "utf8");
        const parsed = JSON.parse(raw);
        const oauth = parsed?.oauthAccount;
        if (oauth) {
          if (!organizationId && oauth.organizationUuid) {
            organizationId = oauth.organizationUuid;
          }
          email = oauth.emailAddress || "";
          displayName = oauth.displayName || "";
        }
      }
    } catch (e) {
      this.log(`Failed to read ~/.claude.json: ${e?.message}`);
    }
    const usagePeriod = sqmConfig.get("claude.usagePeriod") || "both";
    return { organizationId, email, displayName, subscriptionType, usagePeriod };
  }
  async getClaudeOAuthToken() {
    try {
      if (process.platform === "darwin") {
        const { stdout } = await execWithTimeout(
          'security find-generic-password -s "Claude Code-credentials" -w',
          5e3
        );
        const creds = JSON.parse(stdout.trim());
        const oauth = creds?.claudeAiOauth;
        if (oauth?.accessToken) {
          return { accessToken: oauth.accessToken, expiresAt: oauth.expiresAt || 0 };
        }
      } else {
        const credPath = path2.join(os2.homedir(), ".claude", ".credentials.json");
        if (fs2.existsSync(credPath)) {
          const raw = fs2.readFileSync(credPath, "utf8");
          const creds = JSON.parse(raw);
          const oauth = creds?.claudeAiOauth;
          if (oauth?.accessToken) {
            return { accessToken: oauth.accessToken, expiresAt: oauth.expiresAt || 0 };
          }
        }
      }
    } catch (e) {
      this.log(`OAuth token extraction failed: ${e?.message}`);
    }
    return null;
  }
  async fetchClaudeUsageOAuth(accessToken) {
    return new Promise((resolve, reject) => {
      const options = {
        method: "GET",
        hostname: "api.anthropic.com",
        path: "/api/oauth/usage",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
          "Content-Type": "application/json",
          "User-Agent": "auto-quota-antigravity/1.9.0"
        },
        timeout: 1e4
      };
      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => data += chunk);
        res.on("end", () => {
          if (res.statusCode === 429) {
            return reject(new Error("RATE_LIMITED"));
          }
          if (res.statusCode === 401) {
            return reject(new Error("OAuth token expired. Run any claude command to refresh."));
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Timeout"));
      });
      req.end();
    });
  }
  buildClaudeQuotas(usageData, usagePeriod) {
    const quotas = [];
    const five = usageData?.five_hour;
    const seven = usageData?.seven_day;
    const sevenSonnet = usageData?.seven_day_sonnet;
    const sevenOpus = usageData?.seven_day_opus;
    const parseResetTime = (resetsAt) => {
      if (!resetsAt) return { resetLabel: "", absLabel: "" };
      try {
        const resetDate = new Date(resetsAt);
        const diffMs = resetDate.getTime() - Date.now();
        if (diffMs <= 0) return { resetLabel: "Refreshing...", absLabel: "" };
        const mins = Math.floor(diffMs / 6e4);
        const resetLabel = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
        const absHours = resetDate.getHours().toString().padStart(2, "0");
        const absMins = resetDate.getMinutes().toString().padStart(2, "0");
        return { resetLabel, absLabel: `(${absHours}h${absMins})` };
      } catch {
        return { resetLabel: "", absLabel: "" };
      }
    };
    const pushQuota = (data, label, color, defaultReset) => {
      if (!data) return;
      const used = Math.max(0, Math.min(100, Number(data.utilization || 0)));
      const remaining = 100 - used;
      const { resetLabel, absLabel } = parseResetTime(data.resets_at);
      quotas.push({
        label,
        remaining,
        displayValue: `${Math.round(remaining)}%`,
        resetTime: resetLabel || defaultReset,
        absResetTime: absLabel,
        themeColor: color,
        style: "fluid"
      });
    };
    if (usagePeriod === "5-hour" || usagePeriod === "both") {
      pushQuota(five, "Session (5hr)", "#FFAB40", "5h");
    }
    if (usagePeriod === "7-day" || usagePeriod === "both") {
      pushQuota(seven, "Weekly (7day)", "#FF7043", "7d");
      pushQuota(sevenSonnet, "Sonnet (7day)", "#FFA726", "7d");
      pushQuota(sevenOpus, "Opus (7day)", "#AB47BC", "7d");
    }
    return quotas;
  }
  async discoverLocalServer() {
    if (this.discovering) return this.discovering;
    this.discovering = (async () => {
      try {
        let stdout = "";
        if (process.platform === "win32") {
          const command = `powershell -ExecutionPolicy Bypass -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'csrf_token' } | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"`;
          const res = await execAsync(command);
          stdout = res.stdout;
        } else {
          const command = "ps -eo pid,command | grep csrf_token | grep -v grep";
          const res = await execAsync(command);
          const lines = res.stdout.trim().split("\n");
          const arr = lines.map((line) => {
            const match = line.trim().match(/^(\d+)\s+(.+)$/);
            if (match) {
              return { ProcessId: parseInt(match[1]), CommandLine: match[2] };
            }
            return null;
          }).filter(Boolean);
          stdout = JSON.stringify(arr);
        }
        if (!stdout || stdout.trim() === "" || stdout.trim() === "[]") return false;
        let processes = [];
        try {
          const parsed = JSON.parse(stdout.trim());
          processes = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
          this.log(`Process discovery parse error: ${e?.message}`);
          return false;
        }
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
        console.error("[SQM] Discovery failed:", e);
      } finally {
        this.discovering = null;
      }
      return false;
    })();
    return this.discovering;
  }
  async getListeningPorts(pid) {
    try {
      if (process.platform === "win32") {
        const cmd = `powershell -NoProfile -Command "Get-NetTCPConnection -State Listen -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort | Sort-Object -Unique"`;
        const { stdout } = await execAsync(cmd);
        return stdout.trim().split(/\r?\n/).map((p) => parseInt(p.trim())).filter((p) => !isNaN(p) && p > 1024);
      } else {
        const cmd = `lsof -a -p ${pid} -i4TCP -sTCP:LISTEN -P -n | awk 'NR>1 {print $9}' | awk -F':' '{print $NF}' | sort -u`;
        const { stdout } = await execAsync(cmd);
        return stdout.trim().split(/\r?\n/).map((p) => parseInt(p.trim())).filter((p) => !isNaN(p) && p > 1024);
      }
    } catch (e) {
      this.log(`getListeningPorts failed for PID ${pid}: ${e?.message}`);
      return [];
    }
  }
  async testConnection(port, token) {
    return new Promise((resolve) => {
      const options = {
        hostname: "127.0.0.1",
        port,
        path: API_PATH,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Codeium-Csrf-Token": token,
          "Connect-Protocol-Version": "1"
        },
        timeout: 800
      };
      const req = http.request(options, (res) => resolve(res.statusCode === 200));
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.write(JSON.stringify({ wrapper_data: {} }));
      req.end();
    });
  }
  async fetchStatus() {
    if (!this.serverInfo) {
      const found = await this.discoverLocalServer();
      if (!found) return null;
    }
    try {
      const options = {
        hostname: "127.0.0.1",
        port: this.serverInfo.port,
        path: API_PATH,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Codeium-Csrf-Token": this.serverInfo.token,
          "Connect-Protocol-Version": "1"
        },
        timeout: 5e3
      };
      return await new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
          let data = "";
          res.on("data", (chunk) => data += chunk);
          res.on("end", () => {
            if (res.statusCode === 200) {
              try {
                resolve(this.parseResponse(JSON.parse(data)));
              } catch (e) {
                reject(e);
              }
            } else {
              reject(new Error(`HTTP ${res.statusCode}`));
            }
          });
        });
        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("Timeout"));
        });
        req.write(JSON.stringify({ wrapper_data: {} }));
        req.end();
      });
    } catch (e) {
      this.log(`fetchStatus failed (${e?.message}), resetting server info`);
      this.serverInfo = null;
      return null;
    }
  }
  parseResponse(resp) {
    const user = resp.userStatus;
    const modelConfigs = user?.cascadeModelConfigData?.clientModelConfigs || [];
    const rawQuotas = modelConfigs.filter((m) => m.quotaInfo).map((m) => {
      const resetTimeStr = m.quotaInfo.resetTime;
      let resetLabel = "Ready";
      let absResetLabel = "";
      if (resetTimeStr && resetTimeStr !== "Ready") {
        const resetDate = new Date(resetTimeStr);
        const diffMs = resetDate.getTime() - (/* @__PURE__ */ new Date()).getTime();
        if (diffMs > 0) {
          const mins = Math.floor(diffMs / 6e4);
          resetLabel = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
          const absHours = resetDate.getHours().toString().padStart(2, "0");
          const absMins = resetDate.getMinutes().toString().padStart(2, "0");
          absResetLabel = `(${absHours}h${absMins})`;
        } else {
          resetLabel = "Refreshing...";
        }
      }
      return {
        label: m.label,
        remaining: (m.quotaInfo.remainingFraction || 0) * 100,
        resetTime: resetLabel,
        absResetTime: absResetLabel,
        themeColor: m.label.includes("Gemini") ? "#40C4FF" : m.label.includes("Claude") ? "#FFAB40" : "#69F0AE"
      };
    });
    const quotaMap = /* @__PURE__ */ new Map();
    for (const q of rawQuotas) {
      const cleanLabel = q.label.replace(/\s*\(Thinking\)/i, "").replace(/\s*\(Medium\)/i, "").replace(/\s*\(High\)/i, "").replace(/\s*\(Low\)/i, "").trim();
      const existing = quotaMap.get(cleanLabel);
      if (!existing || q.remaining < existing.remaining) {
        quotaMap.set(cleanLabel, { ...q, label: cleanLabel });
      }
    }
    return {
      name: user?.name || "User",
      email: user?.email || "",
      tier: user?.userTier?.name || user?.planStatus?.planInfo?.planName || "Free",
      quotas: Array.from(quotaMap.values())
    };
  }
  // ─── [ADDED] Claude Code Status ───────────────────────────────────────────
  async fetchClaudeStatus() {
    const now = Date.now();
    const cachedGood = !!this.cachedClaude && this.cachedClaude.quotas.length > 0;
    if (cachedGood && now - this.claudeLastFetch < this.CACHE_TTL) {
      return this.cachedClaude;
    }
    if (now < this.claudeNextRetry) {
      return this.cachedClaude;
    }
    const fresh = await this._fetchClaudeStatusImpl();
    this.claudeLastFetch = now;
    if (fresh && fresh.quotas.length > 0) {
      this.cachedClaude = fresh;
      this.claudeNextRetry = 0;
      return fresh;
    }
    this.claudeNextRetry = now + this.RETRY_TTL;
    return cachedGood ? this.cachedClaude : fresh;
  }
  async _fetchClaudeStatusImpl() {
    this.log("Fetching Claude Status...");
    try {
      const localConfig = this.getClaudeLocalConfig();
      let authStatus = null;
      try {
        let binPath = "";
        const exeName = process.platform === "win32" ? "claude.exe" : "claude";
        const ext = vscode.extensions.getExtension("anthropic.claude-code");
        if (ext) {
          const candidate = path2.join(ext.extensionPath, "resources", "native-binary", exeName);
          if (fs2.existsSync(candidate)) binPath = candidate;
        }
        if (!binPath) {
          const home = os2.homedir();
          for (const dir of [path2.join(home, ".antigravity", "extensions"), path2.join(home, ".vscode", "extensions")]) {
            try {
              const cmd = process.platform === "win32" ? `Get-ChildItem -Path '${dir}' -Filter '${exeName}' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName` : `find "${dir}" -name "${exeName}" -type f 2>/dev/null | head -n 1`;
              const { stdout } = await execWithTimeout(cmd, 6e3);
              if (stdout?.trim()) {
                binPath = stdout.trim();
                break;
              }
            } catch (e) {
              this.log(`Claude binary search in ${dir}: ${e?.message}`);
            }
          }
        }
        if (binPath) {
          const cmd = process.platform === "win32" ? `& '${binPath}' auth status --json` : `"${binPath}" auth status --json`;
          const { stdout } = await execWithTimeout(cmd, 6e3);
          authStatus = JSON.parse(stdout.trim());
        }
      } catch (e) {
        this.log(`Claude CLI auth status failed: ${e?.message}`);
      }
      const isLoggedIn = authStatus?.loggedIn ?? !!localConfig.email;
      const email = authStatus?.email || localConfig.email || "";
      const tier = authStatus?.subscriptionType || localConfig.subscriptionType || "Unknown";
      const displayName = localConfig.displayName || "Claude Code";
      if (!isLoggedIn) {
        return { name: "Claude Code", email: "Not logged in", tier: "Guest", quotas: [], isAuthenticated: false };
      }
      const oauthToken = await this.getClaudeOAuthToken();
      if (!oauthToken) {
        return {
          name: displayName,
          email,
          tier,
          quotas: [],
          isAuthenticated: true,
          error: "OAuth token not found \u2014 run `claude auth login`"
        };
      }
      let usageData;
      try {
        usageData = await this.fetchClaudeUsageOAuth(oauthToken.accessToken);
      } catch (e) {
        if (e?.message === "RATE_LIMITED") {
          if (this.cachedClaude && this.cachedClaude.quotas.length > 0) {
            this.log("Rate limited \u2014 returning cached Claude data");
            return this.cachedClaude;
          }
          this.log("Rate limited with no cached data \u2014 will retry");
          return {
            name: displayName,
            email,
            tier,
            quotas: [],
            isAuthenticated: true,
            error: "Rate limited \u2014 retrying shortly\u2026"
          };
        }
        return {
          name: displayName,
          email,
          tier,
          quotas: [],
          isAuthenticated: true,
          error: e?.message || "Usage fetch failed"
        };
      }
      const quotas = this.buildClaudeQuotas(usageData, localConfig.usagePeriod);
      return {
        name: displayName,
        email,
        tier,
        quotas,
        isAuthenticated: true,
        error: quotas.length === 0 ? "No usage data returned" : void 0
      };
    } catch (e) {
      this.log(`Claude Status error: ${e.message}`);
      return { name: "Claude Code", email: "Check failed", tier: "Error", quotas: [], isAuthenticated: false, error: e.message };
    }
  }
  // ─── [ADDED] Codex Status ────────────────────────────────────────────────
  async fetchCodexStatus() {
    const now = Date.now();
    if (this.cachedCodex && now - this.codexLastFetch < this.CACHE_TTL) {
      return this.cachedCodex;
    }
    this.cachedCodex = await this._fetchCodexStatusImpl();
    this.codexLastFetch = now;
    return this.cachedCodex;
  }
  async _fetchCodexStatusImpl() {
    this.log("Fetching Codex Status...");
    try {
      const home = os2.homedir();
      const authFile = path2.join(home, ".codex", "auth.json");
      const configFile = path2.join(home, ".codex", "config.toml");
      const ext = vscode.extensions.getExtension("openai.chatgpt");
      if (!ext && !fs2.existsSync(authFile)) {
        return { name: "Codex", email: "Not installed", tier: "N/A", quotas: [], isAuthenticated: false };
      }
      if (!fs2.existsSync(authFile)) {
        return { name: "Codex", email: "Not logged in", tier: "Guest", quotas: [], isAuthenticated: false };
      }
      let email = "";
      let planType = "Free";
      let model = "Unknown";
      try {
        const authData = JSON.parse(fs2.readFileSync(authFile, "utf8"));
        const idToken = authData?.tokens?.id_token;
        if (idToken) {
          const parts = idToken.split(".");
          if (parts.length >= 2) {
            const payload = Buffer.from(parts[1], "base64url").toString("utf8");
            const claims = JSON.parse(payload);
            email = claims.email || "";
            const authInfo = claims["https://api.openai.com/auth"] || {};
            planType = authInfo.chatgpt_plan_type || "free";
          }
        }
      } catch (e) {
        this.log(`Codex JWT decode failed: ${e?.message}`);
      }
      try {
        if (fs2.existsSync(configFile)) {
          const configRaw = fs2.readFileSync(configFile, "utf8");
          const modelMatch = configRaw.match(/^model\s*=\s*"([^"]+)"/m);
          if (modelMatch) model = modelMatch[1];
        }
      } catch (e) {
        this.log(`Codex config read failed: ${e?.message}`);
      }
      this.log(`Codex: ${email} (${planType}), model: ${model}`);
      const tierDisplay = planType.charAt(0).toUpperCase() + planType.slice(1);
      const usageQuotas = readCodexRateLimits();
      return {
        name: "Codex",
        email,
        tier: tierDisplay,
        quotas: [
          ...usageQuotas,
          {
            label: "Active Model",
            remaining: 0,
            displayValue: model,
            resetTime: "",
            themeColor: "#69F0AE",
            style: "fluid"
          }
        ],
        isAuthenticated: true
      };
    } catch (e) {
      this.log(`Codex Status error: ${e.message}`);
      return { name: "Codex", email: "Check failed", tier: "Error", quotas: [], isAuthenticated: false, error: e.message };
    }
  }
  async fetchDashboard() {
    const [antigravity, claude, codex] = await Promise.all([
      this.fetchStatus(),
      this.fetchClaudeStatus(),
      this.fetchCodexStatus()
    ]);
    return { antigravity, claude, codex };
  }
};

// src/sidebarProvider.ts
var vscode2 = __toESM(require("vscode"));
var crypto = __toESM(require("crypto"));
function getNonce() {
  return crypto.randomBytes(16).toString("hex");
}
var SidebarProvider = class _SidebarProvider {
  constructor(_extensionUri, _quotaService) {
    this._extensionUri = _extensionUri;
    this._quotaService = _quotaService;
  }
  _extensionUri;
  _quotaService;
  _view;
  static _latestData = null;
  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    if (_SidebarProvider._latestData) {
      this.syncToWebview(_SidebarProvider._latestData);
    }
    this.updateData();
    webviewView.webview.onDidReceiveMessage(async (data) => {
      if (data.type === "onRefresh") {
        this.updateData();
      } else if (data.type === "getSettings") {
        await this._sendSettings();
      } else if (data.type === "saveSettings") {
        await this._saveSettings(data.settings);
      }
    });
  }
  syncToWebview(data) {
    _SidebarProvider._latestData = data;
    if (this._view) {
      this._view.webview.postMessage({ type: "update", data });
    }
  }
  async updateData() {
    if (this._view) {
      this._view.webview.postMessage({ type: "loading" });
    }
    const data = await this._quotaService.fetchDashboard();
    setLatestData(data);
  }
  async _sendSettings() {
    const sqm = vscode2.workspace.getConfiguration("sqm");
    this._view?.webview.postMessage({
      type: "settings",
      settings: {
        "claude.usagePeriod": sqm.get("claude.usagePeriod") || "both",
        "refreshInterval": sqm.get("refreshInterval") || 5,
        "enableNotifications": sqm.get("enableNotifications") !== false,
        "notifyThreshold": sqm.get("notifyThreshold") ?? 20,
        "statusBar.mode": sqm.get("statusBar.mode") || "full"
      }
    });
  }
  async _saveSettings(settings) {
    const sqm = vscode2.workspace.getConfiguration("sqm");
    const target = vscode2.ConfigurationTarget.Global;
    for (const [key, value] of Object.entries(settings)) {
      await sqm.update(key, value, target);
    }
    await this._sendSettings();
    this.updateData();
    vscode2.window.showInformationMessage("Settings saved!");
  }
  _getHtmlForWebview(webview) {
    const styleUri = webview.asWebviewUri(vscode2.Uri.joinPath(this._extensionUri, "webview-ui", "style.css"));
    const scriptUri = webview.asWebviewUri(vscode2.Uri.joinPath(this._extensionUri, "webview-ui", "main.js"));
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
};

// src/updater.ts
var vscode3 = __toESM(require("vscode"));
var https2 = __toESM(require("https"));
var REPO_OWNER = "trinhhaox";
var REPO_NAME = "Auto-Quota-Antigravity";
var API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
async function checkForUpdates(context) {
  try {
    const currentVersion = context.extension.packageJSON.version;
    if (!currentVersion) return;
    const options = {
      headers: {
        "User-Agent": "VSCode-Auto-Quota-Antigravity-Extension"
      }
    };
    https2.get(API_URL, options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            const release = JSON.parse(data);
            const latestTag = release.tag_name;
            if (!latestTag) return;
            const latestVersion = latestTag.replace(/^v/, "");
            if (isNewerVersion(currentVersion, latestVersion)) {
              showUpdateNotification(latestVersion, release.html_url);
            }
          } catch (e) {
            console.error("Failed to parse GitHub release data", e);
          }
        }
      });
    }).on("error", (e) => {
      console.error("Error checking for updates:", e);
    });
  } catch (err) {
    console.error("Auto-Updater error:", err);
  }
}
function isNewerVersion(current, latest) {
  const currentParts = current.split(".").map(Number);
  const latestParts = latest.split(".").map(Number);
  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const c = currentParts[i] || 0;
    const l = latestParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}
async function showUpdateNotification(newVersion, url) {
  const action = "T\u1EA3i V\u1EC1 Ngay";
  const message = `M\u1ED9t phi\xEAn b\u1EA3n m\u1EDBi c\u1EE7a Auto Quota Antigravity (v${newVersion}) \u0111\xE3 s\u1EB5n s\xE0ng!`;
  const result = await vscode3.window.showInformationMessage(message, action);
  if (result === action) {
    vscode3.env.openExternal(vscode3.Uri.parse(url));
  }
}

// src/automation-cleanup.ts
var vscode4 = __toESM(require("vscode"));
var fs3 = __toESM(require("fs"));
var path3 = __toESM(require("path"));
var os3 = __toESM(require("os"));
var crypto2 = __toESM(require("crypto"));
var import_child_process2 = require("child_process");
var SCRIPT_TAG_ID = "ag-logic-bridge";
function getTargetFile() {
  const root = vscode4.env.appRoot;
  const paths = [
    path3.join(root, "out/vs/code/electron-sandbox/workbench/workbench.html"),
    path3.join(root, "out/vs/code/electron-browser/workbench/workbench.html"),
    path3.join(root, "out/vs/workbench/workbench.html")
  ];
  return paths.find((p) => fs3.existsSync(p)) || null;
}
function writeSafe(p, c) {
  try {
    fs3.writeFileSync(p, c, "utf8");
  } catch {
    if (process.platform === "win32") throw new Error("Administrator privileges required to clean up automation.");
    const tmp = path3.join(os3.tmpdir(), `ag_cleanup_${process.pid}`);
    fs3.writeFileSync(tmp, c);
    try {
      const cmd = process.platform === "darwin" ? `osascript -e 'do shell script "cp \\"${tmp}\\" \\"${p}\\"" with administrator privileges'` : `pkexec cp "${tmp}" "${p}"`;
      (0, import_child_process2.execSync)(cmd);
    } finally {
      try {
        fs3.unlinkSync(tmp);
      } catch {
      }
    }
  }
}
function recalculateHashes() {
  try {
    const pJson = path3.join(vscode4.env.appRoot, "product.json");
    const data = JSON.parse(fs3.readFileSync(pJson, "utf8"));
    if (!data.checksums) return;
    for (const k of Object.keys(data.checksums)) {
      const fullPath = path3.join(vscode4.env.appRoot, "out", k.split("/").join(path3.sep));
      if (fs3.existsSync(fullPath)) {
        data.checksums[k] = crypto2.createHash("sha256").update(fs3.readFileSync(fullPath)).digest("base64").replace(/=+$/, "");
      }
    }
    writeSafe(pJson, JSON.stringify(data, null, "	"));
  } catch {
  }
}
function cleanupLegacyAutomation(logger) {
  const log = (m) => logger?.appendLine(`[${(/* @__PURE__ */ new Date()).toLocaleTimeString()}] [Cleanup] ${m}`);
  try {
    const target = getTargetFile();
    if (!target) return false;
    let html = fs3.readFileSync(target, "utf8");
    if (!html.includes(SCRIPT_TAG_ID)) return false;
    const startTag = `<!-- ${SCRIPT_TAG_ID}-START -->`;
    const endTag = `<!-- ${SCRIPT_TAG_ID}-END -->`;
    const startIdx = html.indexOf(startTag);
    const endIdx = html.indexOf(endTag);
    if (startIdx !== -1 && endIdx !== -1) {
      html = html.substring(0, startIdx) + html.substring(endIdx + endTag.length);
      html = html.replace(/\n\s*\n/g, "\n");
      writeSafe(target, html);
      recalculateHashes();
      log("Removed leftover automation bridge from workbench.html");
    }
    const bridgeFile = path3.join(path3.dirname(target), "ag-automation-bridge.js");
    if (fs3.existsSync(bridgeFile)) {
      try {
        fs3.unlinkSync(bridgeFile);
      } catch {
      }
    }
    return true;
  } catch (e) {
    log(`Cleanup failed: ${e?.message}`);
    return false;
  }
}

// src/utils.ts
function formatTime(t) {
  const hMatch = t.match(/(\d+)h/);
  const mMatch = t.match(/(\d+)m/);
  if (!hMatch && !mMatch) return t;
  const h = hMatch ? parseInt(hMatch[1]) : 0;
  const m = mMatch ? parseInt(mMatch[1]) : 0;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h ${m}m`;
  return `${h}h ${m}m`;
}
function formatShortReset(t) {
  if (!t || t === "Ready" || t === "Refreshing...") return "";
  const hMatch = t.match(/(\d+)h/);
  const mMatch = t.match(/(\d+)m/);
  const h = hMatch ? parseInt(hMatch[1]) : 0;
  const m = mMatch ? parseInt(mMatch[1]) : 0;
  if (h >= 24) return `${Math.floor(h / 24)}d`;
  if (h > 0 && m > 0) return `${h}h${m}m`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return t.replace(/\s+/g, "");
}
function getQuotaColor(pct) {
  if (pct > 50) return { hex: "#10b981", dot: "\u{1F7E2}" };
  if (pct > 20) return { hex: "#f59e0b", dot: "\u{1F7E1}" };
  return { hex: "#ef4444", dot: "\u{1F534}" };
}
function isPercentQuota(q) {
  return q.displayValue === void 0 || q.displayValue.endsWith("%");
}
function formatSessionResetText(resetTime, absResetTime) {
  if (!resetTime || resetTime === "Ready" || resetTime === "Refreshing...") {
    return resetTime || "Ready";
  }
  const absMatch = absResetTime ? absResetTime.match(/\(?(\d{1,2})h(\d{2})\)?/) : null;
  const timeFormatted = absMatch ? `${absMatch[1].padStart(2, "0")}:${absMatch[2]}` : "";
  const hMatch = resetTime.match(/(\d+)h/);
  const mMatch = resetTime.match(/(\d+)m/);
  const totalHours = hMatch ? parseInt(hMatch[1]) : 0;
  const totalMins = mMatch ? parseInt(mMatch[1]) : 0;
  if (totalHours < 24) {
    const now = /* @__PURE__ */ new Date();
    const resetDate = new Date(now.getTime() + (totalHours * 60 + totalMins) * 60 * 1e3);
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

// src/quota-history.ts
var STORE_KEY = "quota_history_v2";
var MAX_ENTRIES = 288;
var MIN_GAP_MS = 4 * 60 * 1e3;
var ctx = null;
var entries = [];
function initQuotaHistory(context) {
  ctx = context;
  entries = context.globalState.get(STORE_KEY, []);
}
function recordQuotaSnapshot(data) {
  if (!ctx) return;
  const now = Date.now();
  if (entries.length && now - entries[entries.length - 1].t < MIN_GAP_MS) return;
  const v = {};
  const collect = (service, quotas) => {
    for (const q of quotas || []) {
      if (q.displayValue !== void 0 && !q.displayValue.endsWith("%")) continue;
      v[`${service}-${q.label}`] = Math.round(q.remaining * 10) / 10;
    }
  };
  collect("Antigravity", data.antigravity?.quotas);
  collect("Claude", data.claude?.quotas);
  collect("Codex", data.codex?.quotas);
  if (Object.keys(v).length === 0) return;
  entries.push({ t: now, v });
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  ctx.globalState.update(STORE_KEY, entries);
}
function getQuotaHistory() {
  return entries;
}

// src/extension.ts
var statusBarItem;
var latestQuotaData = null;
var latestDataHash = "";
var globalSidebarProvider = null;
var refreshTimer = null;
var lastRefreshAt = 0;
var notifiedModels = /* @__PURE__ */ new Set();
function autoDetectGroups(quotas) {
  const geminiModels = [];
  const claudeGptModels = [];
  const otherModels = [];
  for (const q of quotas) {
    if (q.label.startsWith("Gemini")) {
      geminiModels.push(q.label);
    } else if (q.label.startsWith("Claude") || q.label.startsWith("GPT")) {
      claudeGptModels.push(q.label);
    } else {
      otherModels.push(q.label);
    }
  }
  const groups = [];
  if (geminiModels.length > 0) {
    groups.push({
      id: "gemini",
      title: "GEMINI MODELS",
      models: geminiModels
    });
  }
  if (claudeGptModels.length > 0) {
    groups.push({
      id: "claude_gpt",
      title: "CLAUDE / GPT",
      models: claudeGptModels
    });
  }
  if (otherModels.length > 0) {
    groups.push({
      id: "other",
      title: "OTHER",
      models: otherModels
    });
  }
  return groups;
}
function activate(context) {
  const logger = vscode5.window.createOutputChannel("Auto Quota Antigravity");
  context.subscriptions.push(logger);
  setTimeout(() => cleanupLegacyAutomation(logger), 500);
  const quotaService = new QuotaService(logger);
  globalSidebarProvider = new SidebarProvider(context.extensionUri, quotaService);
  initQuotaHistory(context);
  context.subscriptions.push(
    vscode5.window.registerWebviewViewProvider("sqm.sidebar", globalSidebarProvider)
  );
  statusBarItem = vscode5.window.createStatusBarItem(vscode5.StatusBarAlignment.Right, 100);
  statusBarItem.command = "sqm.menu";
  statusBarItem.text = "$(dashboard) Auto Quota Antigravity";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
  context.subscriptions.push(
    vscode5.commands.registerCommand("sqm.refresh", async () => {
      if (globalSidebarProvider) await globalSidebarProvider.updateData();
    })
  );
  context.subscriptions.push(
    vscode5.commands.registerCommand("sqm.menu", async () => {
      const items = [
        { id: "refresh", label: "$(refresh) Refresh quotas now" },
        { id: "dashboard", label: "$(dashboard) Open dashboard" },
        { id: "settings", label: "$(gear) Extension settings" }
      ];
      const pick = await vscode5.window.showQuickPick(items, { placeHolder: "Auto Quota Antigravity" });
      switch (pick?.id) {
        case "refresh":
          triggerRefresh();
          break;
        case "dashboard":
          vscode5.commands.executeCommand("sqm.sidebar.focus");
          break;
        case "settings":
          vscode5.commands.executeCommand("workbench.action.openSettings", "sqm");
          break;
      }
    })
  );
  setTimeout(() => triggerRefresh(), 2e3);
  startAutoRefresh();
  context.subscriptions.push(vscode5.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("sqm.refreshInterval")) {
      startAutoRefresh();
    }
    if (e.affectsConfiguration("sqm.statusBar.mode")) {
      refreshStatusBar();
    }
  }));
  context.subscriptions.push(vscode5.window.onDidChangeWindowState((ws) => {
    const intervalMs = (vscode5.workspace.getConfiguration("sqm").get("refreshInterval") || 5) * 60 * 1e3;
    if (ws.focused && Date.now() - lastRefreshAt > intervalMs) {
      triggerRefresh();
    }
  }));
  setTimeout(() => {
    checkForUpdates(context);
  }, 1e4);
}
function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function formatCleanModelName(label) {
  return label.replace(/\s*\(Thinking\)/i, "").replace(/\s*\(Medium\)/i, "").replace(/\s*\(High\)/i, "").replace(/\s*\(Low\)/i, "").trim();
}
function buildTooltipSVG(data) {
  const groupHeaderHeight = 24;
  const padding = 16;
  const width = 440;
  let contentHtml = "";
  let currentY = padding + 22;
  let minHealth = 100;
  const checkHealth = (quotas) => {
    if (!quotas) return;
    for (const q of quotas) {
      if (isPercentQuota(q) && q.remaining < minHealth) {
        minHealth = q.remaining;
      }
    }
  };
  checkHealth(data.antigravity?.quotas);
  checkHealth(data.claude?.quotas);
  checkHealth(data.codex?.quotas);
  const badgeColor = minHealth > 50 ? "#10B981" : minHealth > 20 ? "#F59E0B" : "#EF4444";
  const badgeText = minHealth > 50 ? "ALL NORMAL" : minHealth > 20 ? "MODERATE" : "LOW QUOTA";
  contentHtml += `<text x="${padding}" y="${padding + 10}" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="800" fill="#94A3B8" letter-spacing="0.5">AI QUOTA OVERVIEW</text>`;
  contentHtml += `<rect x="${width - padding - 82}" y="${padding - 2}" width="82" height="17" rx="8.5" fill="${badgeColor}" fill-opacity="0.15" stroke="${badgeColor}" stroke-opacity="0.4" stroke-width="1"/>`;
  contentHtml += `<circle cx="${width - padding - 73}" cy="${padding + 6.5}" r="2.5" fill="${badgeColor}"/>`;
  contentHtml += `<text x="${width - padding - 65}" y="${padding + 10}" font-family="system-ui, -apple-system, sans-serif" font-size="8.5" font-weight="700" fill="${badgeColor}">${badgeText}</text>`;
  const renderGroupSection = (title, quotas, accentColor = "#64748B") => {
    if (!quotas || quotas.length === 0) return;
    contentHtml += `<text x="${padding}" y="${currentY + 12}" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="800" fill="${accentColor}" letter-spacing="0.5">${escapeXml(title)}</text>`;
    currentY += groupHeaderHeight;
    quotas.forEach((q) => {
      const pct = Math.round(q.remaining);
      const isPercent = isPercentQuota(q);
      const color = isPercent ? getQuotaColor(pct) : { hex: "#6B7280", dot: "" };
      const cleanName = formatCleanModelName(q.label);
      const sessionReset = formatSessionResetText(q.resetTime, q.absResetTime);
      if (!isPercent) {
        const infoHeight = 32;
        contentHtml += `<rect x="${padding}" y="${currentY}" width="${width - padding * 2}" height="${infoHeight - 4}" rx="6" fill="#FFFFFF" fill-opacity="0.035"/>`;
        contentHtml += `<text x="${padding + 12}" y="${currentY + 18}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600" fill="#E2E8F0">${escapeXml(cleanName)}</text>`;
        contentHtml += `<text x="${width - padding - 12}" y="${currentY + 18}" text-anchor="end" font-family="ui-monospace, SFMono-Regular, monospace" font-size="11" font-weight="bold" fill="#69F0AE">${escapeXml(q.displayValue || "")}</text>`;
        currentY += infoHeight;
      } else {
        const cardHeight = 54;
        const cardWidth = width - padding * 2;
        const trackWidth = cardWidth - 24;
        const fillWidth = Math.max(3, pct / 100 * trackWidth);
        const subLabel = title.includes("CLAUDE") ? cleanName.includes("Session") ? "5-hour window" : "7-day window" : "Shared Pool";
        contentHtml += `<rect x="${padding}" y="${currentY}" width="${cardWidth}" height="${cardHeight - 6}" rx="8" fill="#FFFFFF" fill-opacity="0.03" stroke="#FFFFFF" stroke-opacity="0.05" stroke-width="1"/>`;
        contentHtml += `<circle cx="${padding + 12}" cy="${currentY + 13}" r="3" fill="${color.hex}"/>`;
        contentHtml += `<text x="${padding + 20}" y="${currentY + 16}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#F1F5F9">${escapeXml(cleanName)}</text>`;
        contentHtml += `<text x="${width - padding - 12}" y="${currentY + 16}" text-anchor="end" font-family="system-ui, -apple-system, sans-serif" font-size="9" font-weight="500" fill="#64748B">${escapeXml(subLabel)}</text>`;
        const barY = currentY + 23;
        contentHtml += `<rect x="${padding + 12}" y="${barY}" width="${trackWidth}" height="5" rx="2.5" fill="#FFFFFF" fill-opacity="0.08"/>`;
        contentHtml += `<rect x="${padding + 12}" y="${barY}" width="${fillWidth}" height="5" rx="2.5" fill="${color.hex}" fill-opacity="0.95"/>`;
        const textY = currentY + 41;
        contentHtml += `<text x="${padding + 12}" y="${textY}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="800" fill="${color.hex}">${pct}% <tspan font-weight="500" font-size="9.5" fill="#94A3B8">left</tspan></text>`;
        contentHtml += `<text x="${width - padding - 12}" y="${textY}" text-anchor="end" font-family="ui-monospace, SFMono-Regular, monospace" font-size="9.5" font-weight="500" fill="#94A3B8">${escapeXml(sessionReset)}</text>`;
        currentY += cardHeight;
      }
    });
    contentHtml += `<line x1="${padding}" y1="${currentY - 2}" x2="${width - padding}" y2="${currentY - 2}" stroke="#252C3F" stroke-width="1" stroke-opacity="0.6"/>`;
    currentY += 6;
  };
  if (data.antigravity?.quotas) {
    const groups = autoDetectGroups(data.antigravity.quotas);
    groups.forEach((group) => {
      const members = data.antigravity.quotas.filter((q) => group.models.includes(q.label));
      renderGroupSection(`ANTIGRAVITY \xB7 ${group.title}`, members, "#38BDF8");
    });
  }
  if (data.claude?.quotas) {
    renderGroupSection("CLAUDE CODE (CLI)", data.claude.quotas, "#FB923C");
  }
  if (data.codex?.quotas) {
    renderGroupSection("OPENAI CODEX", data.codex.quotas, "#4ADE80");
  }
  const totalHeight = currentY + 6;
  return `
    <svg width="${width}" height="${totalHeight}" viewBox="0 0 ${width} ${totalHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${totalHeight}" rx="12" fill="#12151E" stroke="#252C3F" stroke-width="1.2"/>
        ${contentHtml}
    </svg>`;
}
function refreshStatusBar() {
  if (!latestQuotaData) return;
  const segments = [];
  if (latestQuotaData.antigravity?.quotas) {
    const geminiQuotas = latestQuotaData.antigravity.quotas.filter((q) => q.label.startsWith("Gemini") && isPercentQuota(q));
    if (geminiQuotas.length > 0) {
      const minGemini = geminiQuotas.reduce((a, b) => b.remaining < a.remaining ? b : a);
      const pct = Math.round(minGemini.remaining);
      const color = getQuotaColor(minGemini.remaining);
      const resetShort = formatShortReset(minGemini.resetTime);
      segments.push({
        label: "Gemini",
        pct,
        dot: color.dot,
        resetText: resetShort,
        health: minGemini.remaining
      });
    }
    const claudeGptQuotas = latestQuotaData.antigravity.quotas.filter((q) => (q.label.startsWith("Claude") || q.label.startsWith("GPT")) && isPercentQuota(q));
    if (claudeGptQuotas.length > 0) {
      const minClaudeGpt = claudeGptQuotas.reduce((a, b) => b.remaining < a.remaining ? b : a);
      const pct = Math.round(minClaudeGpt.remaining);
      const color = getQuotaColor(minClaudeGpt.remaining);
      const resetShort = formatShortReset(minClaudeGpt.resetTime);
      segments.push({
        label: "Claude",
        pct,
        dot: color.dot,
        resetText: resetShort,
        health: minClaudeGpt.remaining
      });
    }
  }
  if (latestQuotaData.claude?.isAuthenticated && latestQuotaData.claude.quotas?.length) {
    const q = latestQuotaData.claude.quotas.find(isPercentQuota);
    if (q) {
      const pct = Math.round(q.remaining);
      const color = getQuotaColor(q.remaining);
      const resetShort = formatShortReset(q.resetTime);
      segments.push({
        label: "CLI",
        pct,
        dot: color.dot,
        resetText: resetShort,
        health: q.remaining
      });
    }
  }
  if (latestQuotaData.codex?.isAuthenticated && latestQuotaData.codex.quotas?.length) {
    const q = latestQuotaData.codex.quotas.find(isPercentQuota);
    if (q) {
      const pct = Math.round(q.remaining);
      const color = getQuotaColor(q.remaining);
      const resetShort = formatShortReset(q.resetTime);
      segments.push({
        label: "Codex",
        pct,
        dot: color.dot,
        resetText: resetShort,
        health: q.remaining
      });
    }
  }
  const mode = vscode5.workspace.getConfiguration("sqm").get("statusBar.mode") || "full";
  let text = "Auto Quota Antigravity";
  let minHealth = 100;
  const formatSegment = (s, includeReset = true) => {
    if (includeReset && s.pct < 100 && s.resetText) {
      return `${s.dot} ${s.label} ${s.pct}% (${s.resetText})`;
    }
    return `${s.dot} ${s.label} ${s.pct}%`;
  };
  if (segments.length > 0) {
    const worst = segments.reduce((a, b) => b.health < a.health ? b : a);
    minHealth = worst.health;
    if (mode === "dot") {
      text = worst.health < 100 ? `${worst.dot} ${worst.pct}%` : `${worst.dot} 100%`;
    } else if (mode === "compact") {
      if (worst.health < 100) {
        text = formatSegment(worst, true);
      } else {
        text = `\u{1F7E2} All 100%`;
      }
    } else {
      text = segments.map((s) => formatSegment(s, true)).join(" \xB7 ");
    }
  }
  if (minHealth <= 20) {
    statusBarItem.text = `$(warning) ${text}`;
  } else {
    statusBarItem.text = `$(dashboard) ${text}`;
  }
  statusBarItem.backgroundColor = void 0;
  statusBarItem.color = void 0;
  const svg = buildTooltipSVG(latestQuotaData);
  const base64 = Buffer.from(svg).toString("base64");
  const tooltip = new vscode5.MarkdownString();
  tooltip.isTrusted = true;
  tooltip.supportHtml = true;
  tooltip.appendMarkdown(`![Quota Info](data:image/svg+xml;base64,${base64})

`);
  const name = latestQuotaData.antigravity?.name || "User";
  const tier = latestQuotaData.antigravity?.tier || "";
  const tierDisplay = tier ? ` (${tier})` : "";
  tooltip.appendMarkdown(`&nbsp;&nbsp;\u{1F464} **${name}**${tierDisplay} &nbsp;&nbsp;\xB7&nbsp;&nbsp; [\u{1F504} Refresh](command:sqm.refresh) &nbsp;|&nbsp; [\u{1F4CA} Dashboard](command:sqm.sidebar.focus) &nbsp;|&nbsp; [\u2699\uFE0F Settings](command:sqm.menu)`);
  statusBarItem.tooltip = tooltip;
}
function setLatestData(data) {
  const dataStr = JSON.stringify(data);
  if (dataStr === latestDataHash) {
    return;
  }
  latestQuotaData = data;
  latestDataHash = dataStr;
  recordQuotaSnapshot(data);
  refreshStatusBar();
  if (globalSidebarProvider && data) {
    globalSidebarProvider.syncToWebview({
      ...data,
      history: getQuotaHistory()
    });
  }
  checkNotifications(data);
}
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  const config = vscode5.workspace.getConfiguration("sqm");
  const intervalMins = config.get("refreshInterval") || 5;
  refreshTimer = setInterval(() => {
    if (!vscode5.window.state.focused) return;
    triggerRefresh();
  }, intervalMins * 60 * 1e3);
}
function triggerRefresh() {
  lastRefreshAt = Date.now();
  if (globalSidebarProvider) globalSidebarProvider.updateData();
}
function checkNotifications(data) {
  const config = vscode5.workspace.getConfiguration("sqm");
  if (!config.get("enableNotifications")) return;
  const threshold = Math.max(1, Math.min(90, config.get("notifyThreshold") || 20));
  const checkQuota = (serviceName, quotas) => {
    if (!quotas) return;
    quotas.forEach((q) => {
      if (!isPercentQuota(q)) return;
      const modelKey = `${serviceName}-${q.label}`;
      const pct = Math.round(q.remaining);
      if (pct > threshold) {
        notifiedModels.delete(modelKey);
        return;
      }
      if (notifiedModels.has(modelKey)) return;
      const message = `${serviceName} [${q.label}] quota is low (${pct}% remaining).`;
      vscode5.window.showWarningMessage(message, "Dashboard").then((selection) => {
        if (selection === "Dashboard") {
          vscode5.commands.executeCommand("sqm.sidebar.focus");
        }
      });
      notifiedModels.add(modelKey);
    });
  };
  if (data.antigravity?.quotas) checkQuota("Antigravity", data.antigravity.quotas);
  if (data.claude?.quotas) checkQuota("Claude", data.claude.quotas);
  if (data.codex?.quotas) checkQuota("Codex", data.codex.quotas);
}
function deactivate() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate,
  setLatestData
});
