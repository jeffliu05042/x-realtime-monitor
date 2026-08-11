import process from "node:process";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import { locateBrowser as locateInstalledBrowser } from "./browser-locator.js";
import { BrowserFeedSource } from "./browser-source.js";
import { loadConfig as readConfig } from "./config.js";
import { FeedStore } from "./feed-store.js";
import { MonitorService } from "./monitor-service.js";

const HELP = `x-monitor - free local X account monitor

Usage:
  x-monitor doctor [--config PATH]
  x-monitor login  [--config PATH]
  x-monitor check  [--config PATH]
  x-monitor run    [--config PATH]
`;

/** @param {string[]} arguments_ */
function parseArguments(arguments_) {
  if (arguments_.includes("--help") || arguments_.includes("-h")) {
    return { command: "help", configPath: "config.json" };
  }
  const command = arguments_[0] ?? "help";
  if (!["doctor", "login", "check", "run", "help"].includes(command)) {
    throw new Error(`unknown command: ${command}`);
  }
  let configPath = "config.json";
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--config" && arguments_[index + 1]) {
      configPath = arguments_[index + 1];
      index += 1;
    } else {
      throw new Error(`unknown or incomplete option: ${argument}`);
    }
  }
  return { command, configPath };
}

/** @param {import("./config.js").MonitorConfig} config @param {{type: string, executablePath: string}} browser */
function makeSource(config, browser) {
  return new BrowserFeedSource({
    type: browser.type,
    executablePath: browser.executablePath,
    profileDirectory: config.browser.profileDirectory,
    fetchLimitPerAccount: config.fetchLimitPerAccount,
    includeReplies: config.includeReplies,
    navigationTimeoutMs: 45_000,
  });
}

/** @param {import("./config.js").MonitorConfig} config */
function makeStore(config) {
  return new FeedStore(config.output);
}

/**
 * @param {import("./config.js").MonitorConfig} config
 * @param {BrowserFeedSource} source
 * @param {FeedStore} store
 */
function makeMonitor(config, source, store) {
  return new MonitorService(
    {
      accounts: config.accounts,
      lookbackMinutes: config.lookbackMinutes,
      pollIntervalSeconds: config.pollIntervalSeconds,
    },
    { source, store },
  );
}

async function waitForTerminalEnter() {
  const interface_ = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await interface_.question("Press Enter after X Home is visible and you are fully signed in... ");
  } finally {
    interface_.close();
  }
}

/** @param {() => void} handler */
function registerProcessShutdown(handler) {
  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
  return () => {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
  };
}

/**
 * @typedef {{write: (value: string) => unknown}} Output
 * @typedef {object} CliDependencies
 * @property {Output} [stdout]
 * @property {Output} [stderr]
 * @property {typeof readConfig} [loadConfig]
 * @property {typeof locateInstalledBrowser} [locateBrowser]
 * @property {typeof makeSource} [createSource]
 * @property {typeof makeStore} [createStore]
 * @property {typeof makeMonitor} [createMonitor]
 * @property {typeof waitForTerminalEnter} [waitForEnter]
 * @property {typeof registerProcessShutdown} [registerShutdown]
 */

/** @param {string[]} arguments_ @param {CliDependencies} [dependencies] */
export async function execute(arguments_, dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const loadConfig = dependencies.loadConfig ?? readConfig;
  const findBrowser = dependencies.locateBrowser ?? locateInstalledBrowser;
  const createSource = dependencies.createSource ?? makeSource;
  const createStore = dependencies.createStore ?? makeStore;
  const createMonitor = dependencies.createMonitor ?? makeMonitor;
  const waitForEnter = dependencies.waitForEnter ?? waitForTerminalEnter;
  const registerShutdown = dependencies.registerShutdown ?? registerProcessShutdown;
  /** @type {BrowserFeedSource | null} */
  let source = null;

  try {
    const parsed = parseArguments(arguments_);
    if (parsed.command === "help") {
      stdout.write(HELP);
      return 0;
    }

    const config = await loadConfig(resolve(parsed.configPath));
    const browser = findBrowser(config.browser);
    if (parsed.command === "doctor") {
      stdout.write(`${JSON.stringify({
        status: "ok",
        accounts: config.accounts,
        pollIntervalSeconds: config.pollIntervalSeconds,
        browser,
        profileDirectory: config.browser.profileDirectory,
        outputDirectory: config.output.directory,
      }, null, 2)}\n`);
      return 0;
    }

    if (!config.browserAutomationRiskAccepted) {
      throw new Error(
        "set browserAutomationRiskAccepted to true after reading the README's X automation warning",
      );
    }

    source = createSource(config, browser);
    if (parsed.command === "login") {
      await source.start({ headless: false });
      await source.openLogin();
      stdout.write("Complete X sign-in or any verification in the opened browser.\n");
      await waitForEnter();
      await source.verifyLogin();
      stdout.write("Login profile verified.\n");
      return 0;
    }

    const store = createStore(config);
    const monitor = createMonitor(config, source, store);
    await source.start({ headless: true });
    if (parsed.command === "check") {
      stdout.write(`${JSON.stringify(await monitor.checkOnce(), null, 2)}\n`);
      return 0;
    }

    const controller = new AbortController();
    const unregister = registerShutdown(() => controller.abort());
    try {
      stdout.write("Monitoring started. Press Ctrl+C to stop.\n");
      await monitor.run({
        signal: controller.signal,
        onCycle: (summary) => {
          stdout.write(`${JSON.stringify(summary)}\n`);
        },
      });
    } finally {
      unregister();
    }
    return 0;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? ` [${String(error.code)}]` : "";
    stderr.write(`Error${code}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    if (source) await source.close().catch(() => {});
  }
}
