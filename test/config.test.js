import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";

import { loadConfig } from "../src/config.js";

test("user can load a ten-account cross-platform browser monitor configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "x-monitor-config-"));
  const configPath = join(directory, "config.json");
  const accounts = Array.from({ length: 10 }, (_, index) => `market_news_${index}`);
  await writeFile(
    configPath,
    JSON.stringify({
      accounts,
      pollIntervalSeconds: 120,
      fetchLimitPerAccount: 10,
      includeReplies: false,
      lookbackMinutes: 30,
      browser: {
        type: "auto",
        executablePath: null,
        profileDirectory: "data/browser-profile",
      },
      output: { directory: "data", latestLimit: 200 },
      browserAutomationRiskAccepted: true,
    }),
  );

  const config = await loadConfig(configPath);

  assert.deepEqual(config.accounts, accounts);
  assert.equal(config.pollIntervalSeconds, 120);
  assert.equal(config.browser.type, "auto");
  assert.equal(config.browser.executablePath, null);
  assert.equal(config.browser.profileDirectory, join(directory, "data/browser-profile"));
  assert.equal(config.output.directory, join(directory, "data"));
  assert.equal(config.output.latestLimit, 200);
  assert.equal(config.fetchLimitPerAccount, 10);
  assert.equal(config.includeReplies, false);
  assert.equal(config.lookbackMinutes, 30);
});

test("configuration rejects more than ten monitored accounts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "x-monitor-config-"));
  const configPath = join(directory, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      accounts: Array.from({ length: 11 }, (_, index) => `account_${index}`),
      pollIntervalSeconds: 120,
      browserAutomationRiskAccepted: true,
    }),
  );

  await assert.rejects(loadConfig(configPath), /between 1 and 10 accounts/);
});

test("configuration rejects polling faster than two minutes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "x-monitor-config-"));
  const configPath = join(directory, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      accounts: ["market_news"],
      pollIntervalSeconds: 119,
      browserAutomationRiskAccepted: true,
    }),
  );

  await assert.rejects(loadConfig(configPath), /between 120 and 300 seconds/);
});

test("configuration normalizes leading @ signs and rejects duplicate handles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "x-monitor-config-"));
  const normalizedPath = join(directory, "normalized.json");
  await writeFile(normalizedPath, JSON.stringify({
    accounts: [" @Market_News "],
    pollIntervalSeconds: 120,
  }));

  const normalized = await loadConfig(normalizedPath);
  assert.deepEqual(normalized.accounts, ["Market_News"]);

  const duplicatePath = join(directory, "duplicate.json");
  await writeFile(duplicatePath, JSON.stringify({
    accounts: ["Market_News", "@market_news"],
    pollIntervalSeconds: 120,
  }));
  await assert.rejects(loadConfig(duplicatePath), /unique/);
});

test("configuration rejects malformed handles and unsafe numeric ranges", async () => {
  const directory = await mkdtemp(join(tmpdir(), "x-monitor-config-"));
  const cases = [
    [{ accounts: ["bad/name"], pollIntervalSeconds: 120 }, /valid X handles/],
    [{ accounts: ["alpha"], pollIntervalSeconds: 120, fetchLimitPerAccount: 0 }, /fetchLimitPerAccount/],
    [{ accounts: ["alpha"], pollIntervalSeconds: 120, lookbackMinutes: 0 }, /lookbackMinutes/],
    [{ accounts: ["alpha"], pollIntervalSeconds: 120, output: { latestLimit: 0 } }, /latestLimit/],
    [{ accounts: ["alpha"], pollIntervalSeconds: 120, browser: { type: "safari" } }, /browser.type/],
  ];

  for (const [index, [value, expectation]] of cases.entries()) {
    const configPath = join(directory, `invalid-${index}.json`);
    await writeFile(configPath, JSON.stringify(value));
    await assert.rejects(loadConfig(configPath), expectation);
  }
});
