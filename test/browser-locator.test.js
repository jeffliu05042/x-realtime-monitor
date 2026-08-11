import assert from "node:assert/strict";
import test from "node:test";

import { locateBrowser } from "../src/browser-locator.js";

test("auto browser selection finds an installed Chrome on macOS", () => {
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

  const located = locateBrowser(
    { type: "auto", executablePath: null },
    {
      platform: "darwin",
      environment: {},
      homeDirectory: "/Users/example",
      exists: (candidate) => candidate === chrome,
    },
  );

  assert.deepEqual(located, { type: "chrome", executablePath: chrome });
});

test("auto browser selection finds an installed Edge on Windows", () => {
  const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

  const located = locateBrowser(
    { type: "auto", executablePath: null },
    {
      platform: "win32",
      environment: {
        "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
        PROGRAMFILES: "C:\\Program Files",
      },
      homeDirectory: "C:\\Users\\example",
      exists: (candidate) => candidate === edge,
    },
  );

  assert.deepEqual(located, { type: "edge", executablePath: edge });
});
