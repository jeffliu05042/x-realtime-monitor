import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

export class ConfigError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

/** @param {string} baseDirectory @param {unknown} value */
function resolvePath(baseDirectory, value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError("configured paths must be non-empty strings");
  }
  const expanded = value.trim();
  return isAbsolute(expanded) ? expanded : resolve(baseDirectory, expanded);
}

/**
 * @typedef {object} MonitorConfig
 * @property {string[]} accounts
 * @property {number} pollIntervalSeconds
 * @property {number} fetchLimitPerAccount
 * @property {boolean} includeReplies
 * @property {number} lookbackMinutes
 * @property {{type: string, executablePath: string | null, profileDirectory: string}} browser
 * @property {{directory: string, latestLimit: number}} output
 * @property {boolean} browserAutomationRiskAccepted
 */

/** @param {string} configPath @returns {Promise<MonitorConfig>} */
export async function loadConfig(configPath) {
  let raw;
  try {
    raw = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new ConfigError(`cannot read configuration: ${error instanceof Error ? error.message : error}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError("configuration must be a JSON object");
  }

  const baseDirectory = dirname(resolve(configPath));
  const value = /** @type {Record<string, unknown>} */ (raw);
  if (value.browser !== undefined && (!value.browser || typeof value.browser !== "object" || Array.isArray(value.browser))) {
    throw new ConfigError("browser must be a JSON object");
  }
  if (value.output !== undefined && (!value.output || typeof value.output !== "object" || Array.isArray(value.output))) {
    throw new ConfigError("output must be a JSON object");
  }
  const browser = /** @type {Record<string, unknown>} */ (value.browser ?? {});
  const output = /** @type {Record<string, unknown>} */ (value.output ?? {});
  const accounts = Array.isArray(value.accounts)
    ? value.accounts.map((account) => String(account).trim().replace(/^@+/, ""))
    : [];
  if (accounts.length < 1 || accounts.length > 10) {
    throw new ConfigError("configuration must contain between 1 and 10 accounts");
  }
  if (new Set(accounts.map((account) => account.toLowerCase())).size !== accounts.length) {
    throw new ConfigError("configured accounts must be unique");
  }
  if (accounts.some((account) => !/^[A-Za-z0-9_]{1,15}$/.test(account))) {
    throw new ConfigError("configured accounts must be valid X handles (1-15 letters, numbers, or underscores)");
  }
  const pollIntervalSeconds = Number(value.pollIntervalSeconds);
  if (!Number.isInteger(pollIntervalSeconds) || pollIntervalSeconds < 120 || pollIntervalSeconds > 300) {
    throw new ConfigError("pollIntervalSeconds must be between 120 and 300 seconds");
  }
  const fetchLimitPerAccount = Number(value.fetchLimitPerAccount ?? 10);
  if (!Number.isInteger(fetchLimitPerAccount) || fetchLimitPerAccount < 1 || fetchLimitPerAccount > 50) {
    throw new ConfigError("fetchLimitPerAccount must be between 1 and 50");
  }
  const lookbackMinutes = Number(value.lookbackMinutes ?? 30);
  if (!Number.isInteger(lookbackMinutes) || lookbackMinutes < 1 || lookbackMinutes > 1_440) {
    throw new ConfigError("lookbackMinutes must be between 1 and 1440");
  }
  const latestLimit = Number(output.latestLimit ?? 200);
  if (!Number.isInteger(latestLimit) || latestLimit < 1 || latestLimit > 5_000) {
    throw new ConfigError("output.latestLimit must be between 1 and 5000");
  }
  const browserType = String(browser.type ?? "auto").toLowerCase();
  if (!["auto", "chrome", "edge", "firefox"].includes(browserType)) {
    throw new ConfigError("browser.type must be auto, chrome, edge, or firefox");
  }

  return {
    accounts,
    pollIntervalSeconds,
    fetchLimitPerAccount,
    includeReplies: value.includeReplies === true,
    lookbackMinutes,
    browser: {
      type: browserType,
      executablePath: typeof browser.executablePath === "string" && browser.executablePath.trim()
        ? resolvePath(baseDirectory, browser.executablePath)
        : null,
      profileDirectory: resolvePath(
        baseDirectory,
        browser.profileDirectory ?? "data/browser-profile",
      ),
    },
    output: {
      directory: resolvePath(baseDirectory, output.directory ?? "data"),
      latestLimit,
    },
    browserAutomationRiskAccepted: value.browserAutomationRiskAccepted === true,
  };
}
