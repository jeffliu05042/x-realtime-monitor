import { existsSync } from "node:fs";
import { win32 } from "node:path";
import process from "node:process";

export class BrowserNotFoundError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "BrowserNotFoundError";
  }
}

/**
 * @typedef {{type: string, executablePath: string | null}} BrowserPreference
 * @typedef {{platform?: string, environment?: NodeJS.ProcessEnv, homeDirectory?: string, exists?: (path: string) => boolean}} LocatorEnvironment
 */

/**
 * @param {BrowserPreference} preference
 * @param {LocatorEnvironment} [runtime]
 * @returns {{type: string, executablePath: string}}
 */
export function locateBrowser(preference, runtime = {}) {
  const platform = runtime.platform ?? process.platform;
  const exists = runtime.exists ?? existsSync;
  const environment = runtime.environment ?? process.env;

  if (preference.executablePath) {
    if (!exists(preference.executablePath)) {
      throw new BrowserNotFoundError(`browser executable does not exist: ${preference.executablePath}`);
    }
    return { type: preference.type === "auto" ? "custom" : preference.type, executablePath: preference.executablePath };
  }

  /** @type {{type: string, executablePath: string}[]} */
  let candidates = [];
  if (platform === "darwin") {
    candidates = [
        { type: "chrome", executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
        { type: "edge", executablePath: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
        { type: "firefox", executablePath: "/Applications/Firefox.app/Contents/MacOS/firefox" },
      ];
  } else if (platform === "win32") {
    const programFiles = [environment.PROGRAMFILES, environment["PROGRAMFILES(X86)"], environment.LOCALAPPDATA]
      .filter((value) => typeof value === "string" && value.length > 0);
    candidates = programFiles.flatMap((base) => [
      { type: "chrome", executablePath: win32.join(/** @type {string} */ (base), "Google", "Chrome", "Application", "chrome.exe") },
      { type: "edge", executablePath: win32.join(/** @type {string} */ (base), "Microsoft", "Edge", "Application", "msedge.exe") },
      { type: "firefox", executablePath: win32.join(/** @type {string} */ (base), "Mozilla Firefox", "firefox.exe") },
    ]);
  }
  const match = candidates.find((candidate) => (
    (preference.type === "auto" || preference.type === candidate.type) && exists(candidate.executablePath)
  ));
  if (!match) {
    throw new BrowserNotFoundError(
      `could not find ${preference.type === "auto" ? "Chrome, Edge, or Firefox" : preference.type}`,
    );
  }
  return match;
}
