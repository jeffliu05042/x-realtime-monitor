import assert from "node:assert/strict";
import test from "node:test";

import { execute } from "../src/cli.js";

function validConfig(overrides = {}) {
  return {
    accounts: ["alpha"],
    pollIntervalSeconds: 120,
    fetchLimitPerAccount: 10,
    includeReplies: false,
    lookbackMinutes: 30,
    browser: { type: "auto", executablePath: null, profileDirectory: "/profile" },
    output: { directory: "/output", latestLimit: 200 },
    browserAutomationRiskAccepted: true,
    ...overrides,
  };
}

function fakeIo() {
  const stdout = [];
  const stderr = [];
  return {
    stdout,
    stderr,
    output: {
      stdout: { write: (value) => stdout.push(String(value)) },
      stderr: { write: (value) => stderr.push(String(value)) },
    },
  };
}

test("doctor validates configuration and finds a browser without opening it", async () => {
  const io = fakeIo();
  let sourceCreated = false;
  const exitCode = await execute(["doctor", "--config", "custom.json"], {
    ...io.output,
    loadConfig: async (path) => {
      assert.match(path, /custom\.json$/);
      return validConfig();
    },
    locateBrowser: () => ({ type: "chrome", executablePath: "/browser/chrome" }),
    createSource: () => {
      sourceCreated = true;
      throw new Error("should not open a browser");
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(sourceCreated, false);
  assert.match(io.stdout.join(""), /\/browser\/chrome/);
});

test("login opens a visible browser, waits for the user, and verifies the profile", async () => {
  const io = fakeIo();
  const calls = [];
  const source = {
    async start(options) { calls.push(["start", options]); },
    async openLogin() { calls.push(["openLogin"]); },
    async verifyLogin() { calls.push(["verifyLogin"]); },
    async close() { calls.push(["close"]); },
  };
  const exitCode = await execute(["login"], {
    ...io.output,
    loadConfig: async () => validConfig(),
    locateBrowser: () => ({ type: "chrome", executablePath: "/browser/chrome" }),
    createSource: () => source,
    waitForEnter: async () => { calls.push(["waitForEnter"]); },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [
    ["start", { headless: false }],
    ["openLogin"],
    ["waitForEnter"],
    ["verifyLogin"],
    ["close"],
  ]);
});

test("check runs one headless collection and prints its JSON summary", async () => {
  const io = fakeIo();
  const calls = [];
  const source = {
    async start(options) { calls.push(["start", options]); },
    async close() { calls.push(["close"]); },
  };
  const summary = { fetched: 1, recent: 1, saved: 1, duplicates: 0, errors: [] };
  const exitCode = await execute(["check"], {
    ...io.output,
    loadConfig: async () => validConfig(),
    locateBrowser: () => ({ type: "chrome", executablePath: "/browser/chrome" }),
    createSource: () => source,
    createStore: () => ({}),
    createMonitor: () => ({ checkOnce: async () => summary }),
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [["start", { headless: true }], ["close"]]);
  assert.deepEqual(JSON.parse(io.stdout.join("")), summary);
});

test("monitoring refuses to automate X until the risk acknowledgement is explicit", async () => {
  const io = fakeIo();
  const exitCode = await execute(["run"], {
    ...io.output,
    loadConfig: async () => validConfig({ browserAutomationRiskAccepted: false }),
    locateBrowser: () => ({ type: "chrome", executablePath: "/browser/chrome" }),
  });

  assert.equal(exitCode, 1);
  assert.match(io.stderr.join(""), /browserAutomationRiskAccepted/);
});
