import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";

import { FeedStore } from "../src/feed-store.js";
import { MonitorService } from "../src/monitor-service.js";

test("one check saves only recent posts and reports individual account failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "x-monitor-service-"));
  const store = new FeedStore({ directory, latestLimit: 20 });
  const base = {
    author: "alpha",
    text: "market update",
    url: "https://x.com/alpha/status/1",
    metrics: { replies: 0, reposts: 0, likes: 0, views: 0 },
    isReply: false,
    isRepost: false,
  };
  const source = {
    async fetchAccounts() {
      return {
        posts: [
          { ...base, id: "1950000000000000001", createdAt: "2026-08-11T02:20:00.000Z" },
          { ...base, id: "1950000000000000002", createdAt: "2026-08-11T01:00:00.000Z" },
        ],
        errors: [{ account: "beta", message: "page timed out" }],
      };
    },
  };
  const monitor = new MonitorService(
    {
      accounts: ["alpha", "beta"],
      lookbackMinutes: 30,
      pollIntervalSeconds: 120,
    },
    { source, store, now: () => new Date("2026-08-11T02:30:00.000Z") },
  );

  const summary = await monitor.checkOnce();

  assert.deepEqual(summary, {
    fetched: 2,
    recent: 1,
    saved: 1,
    duplicates: 0,
    errors: [{ account: "beta", message: "page timed out" }],
  });
  const records = (await readFile(join(directory, "posts.jsonl"), "utf8")).trim().split("\n");
  assert.equal(records.length, 1);
  assert.equal(JSON.parse(records[0]).id, "1950000000000000001");
});

test("continuous monitoring repeats at the configured interval until cancelled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "x-monitor-loop-"));
  const store = new FeedStore({ directory, latestLimit: 20 });
  let fetches = 0;
  const waits = [];
  const controller = new AbortController();
  const monitor = new MonitorService(
    {
      accounts: ["alpha"],
      lookbackMinutes: 30,
      pollIntervalSeconds: 120,
    },
    {
      source: {
        async fetchAccounts() {
          fetches += 1;
          return { posts: [], errors: [] };
        },
      },
      store,
      now: () => new Date("2026-08-11T02:30:00.000Z"),
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
      },
    },
  );

  await monitor.run({
    signal: controller.signal,
    onCycle: () => {
      if (fetches === 2) controller.abort();
    },
  });

  assert.equal(fetches, 2);
  assert.deepEqual(waits, [120_000]);
});

test("a cycle merges different account timelines in newest-first order", async () => {
  const base = {
    text: "update",
    metrics: { replies: 0, reposts: 0, likes: 0, views: 0 },
    isReply: false,
    isRepost: false,
  };
  let savedPosts = [];
  const monitor = new MonitorService(
    { accounts: ["alpha", "beta"], lookbackMinutes: 30, pollIntervalSeconds: 120 },
    {
      source: {
        async fetchAccounts() {
          return {
            posts: [
              { ...base, id: "1", author: "alpha", createdAt: "2026-08-11T02:10:00.000Z", url: "https://x.com/alpha/status/1" },
              { ...base, id: "2", author: "beta", createdAt: "2026-08-11T02:20:00.000Z", url: "https://x.com/beta/status/2" },
            ],
            errors: [],
          };
        },
      },
      store: {
        async save(posts) {
          savedPosts = posts;
          return { saved: posts.length, duplicates: 0 };
        },
      },
      now: () => new Date("2026-08-11T02:30:00.000Z"),
    },
  );

  await monitor.checkOnce();

  assert.deepEqual(savedPosts.map((item) => item.id), ["2", "1"]);
});
