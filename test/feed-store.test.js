import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";

import { FeedStore } from "../src/feed-store.js";

const post = {
  id: "1950000000000000001",
  author: "market_wire",
  text: "Copper inventories fell.",
  createdAt: "2026-08-11T01:31:00.000Z",
  url: "https://x.com/market_wire/status/1950000000000000001",
  metrics: { replies: 1, reposts: 2, likes: 3, views: 4 },
  isReply: false,
  isRepost: false,
};

test("new browser posts are persisted once as JSONL and a latest JSON snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "x-monitor-feed-"));
  const store = new FeedStore({ directory, latestLimit: 20 });

  const first = await store.save([post], { capturedAt: "2026-08-11T01:32:00.000Z" });
  const duplicate = await store.save([post], { capturedAt: "2026-08-11T01:33:00.000Z" });

  assert.deepEqual(first, { saved: 1, duplicates: 0 });
  assert.deepEqual(duplicate, { saved: 0, duplicates: 1 });
  const lines = (await readFile(join(directory, "posts.jsonl"), "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    schema_version: 1,
    source: "x_browser",
    captured_at: "2026-08-11T01:32:00.000Z",
    id: post.id,
    url: post.url,
    text: post.text,
    created_at: post.createdAt,
    author: { username: post.author },
    public_metrics: post.metrics,
    is_reply: false,
    is_repost: false,
  });
  assert.deepEqual(JSON.parse(await readFile(join(directory, "latest.json"), "utf8")), [
    JSON.parse(lines[0]),
  ]);
});

test("duplicate IDs in the same browser response are written only once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "x-monitor-feed-"));
  const store = new FeedStore({ directory, latestLimit: 20 });

  const result = await store.save([post, post], { capturedAt: "2026-08-11T01:32:00.000Z" });

  assert.deepEqual(result, { saved: 1, duplicates: 1 });
  const lines = (await readFile(join(directory, "posts.jsonl"), "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
});

test("latest.json preserves the newest-first order returned by X", async () => {
  const directory = await mkdtemp(join(tmpdir(), "x-monitor-feed-"));
  const store = new FeedStore({ directory, latestLimit: 20 });
  const older = { ...post, id: "1950000000000000000", createdAt: "2026-08-11T01:30:00.000Z" };

  await store.save([post, older], { capturedAt: "2026-08-11T01:32:00.000Z" });

  const latest = JSON.parse(await readFile(join(directory, "latest.json"), "utf8"));
  assert.deepEqual(latest.map((item) => item.id), [post.id, older.id]);
});
