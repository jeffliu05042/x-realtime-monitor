import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { BrowserFeedSource } from "../src/browser-source.js";

test("interactive login opens X home and verifies the dedicated profile", async () => {
  const visited = [];
  const page = {
    on() {},
    off() {},
    async goto(url) {
      visited.push(url);
    },
    async waitForSelector() {},
    async evaluate() {
      return { authRequired: false, challengeRequired: false };
    },
    async close() {},
  };
  const source = new BrowserFeedSource(
    {
      type: "chrome",
      executablePath: "/browser/chrome",
      profileDirectory: join(tmpdir(), "x-monitor-login-test"),
      fetchLimitPerAccount: 10,
      includeReplies: false,
      navigationTimeoutMs: 30_000,
    },
    {
      launch: async () => ({ newPage: async () => page, close: async () => {} }),
    },
  );

  await source.start({ headless: false });
  await source.openLogin();
  await source.verifyLogin();
  await source.close();

  assert.deepEqual(visited, ["https://x.com/home", "https://x.com/home"]);
});

test("one browser session reads multiple account pages into normalized posts", async () => {
  const visited = [];
  let launches = 0;
  let pages = 0;
  const page = {
    on() {},
    off() {},
    async goto(url) {
      visited.push(url);
    },
    async waitForSelector() {},
    async evaluate(_extract, account) {
      return {
        authRequired: false,
        challengeRequired: false,
        posts: [
          {
            id: account === "alpha" ? "1950000000000000001" : "1950000000000000002",
            author: account,
            text: `update from ${account}`,
            timestamp: "2026-08-11T02:00:00.000Z",
            url: `https://x.com/${account}/status/1950000000000000001`,
            replies: "1",
            reposts: "2",
            likes: "1.2K",
            views: "3,400",
            isReply: false,
            isRepost: false,
          },
        ],
      };
    },
    async close() {},
  };
  const browser = {
    async newPage() {
      pages += 1;
      return page;
    },
    async close() {},
  };
  const source = new BrowserFeedSource(
    {
      type: "chrome",
      executablePath: "/browser/chrome",
      profileDirectory: join(tmpdir(), "x-monitor-browser-test"),
      fetchLimitPerAccount: 10,
      includeReplies: false,
      navigationTimeoutMs: 30_000,
    },
    {
      launch: async () => {
        launches += 1;
        return browser;
      },
    },
  );

  await source.start({ headless: true });
  const result = await source.fetchAccounts(["alpha", "beta"]);
  await source.close();

  assert.equal(launches, 1);
  assert.equal(pages, 1);
  assert.deepEqual(visited, ["https://x.com/alpha", "https://x.com/beta"]);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.posts.map((post) => [post.author, post.metrics.likes, post.metrics.views]), [
    ["alpha", 1200, 3400],
    ["beta", 1200, 3400],
  ]);
});

test("account verification stops the whole check before another account is opened", async () => {
  const visited = [];
  const page = {
    on() {},
    off() {},
    async goto(url) {
      visited.push(url);
    },
    async waitForSelector() {},
    async evaluate() {
      return { authRequired: false, challengeRequired: true, posts: [] };
    },
    async close() {},
  };
  const source = new BrowserFeedSource(
    {
      type: "chrome",
      executablePath: "/browser/chrome",
      profileDirectory: join(tmpdir(), "x-monitor-challenge-test"),
      fetchLimitPerAccount: 10,
      includeReplies: false,
      navigationTimeoutMs: 30_000,
    },
    {
      launch: async () => ({ newPage: async () => page, close: async () => {} }),
    },
  );

  await source.start({ headless: true });
  await assert.rejects(
    source.fetchAccounts(["alpha", "beta"]),
    (error) => error?.code === "X_CHALLENGE_REQUIRED",
  );
  await source.close();

  assert.deepEqual(visited, ["https://x.com/alpha"]);
});

test("a challenge page discovered after a selector timeout stops monitoring", async () => {
  const visited = [];
  const page = {
    on() {},
    off() {},
    async goto(url) {
      visited.push(url);
    },
    async waitForSelector() {
      throw new Error("selector timed out");
    },
    async evaluate() {
      return { authRequired: false, challengeRequired: true, posts: [] };
    },
    async close() {},
  };
  const source = new BrowserFeedSource(
    {
      type: "chrome",
      executablePath: "/browser/chrome",
      profileDirectory: join(tmpdir(), "x-monitor-timeout-challenge-test"),
      fetchLimitPerAccount: 10,
      includeReplies: false,
      navigationTimeoutMs: 30_000,
    },
    {
      launch: async () => ({ newPage: async () => page, close: async () => {} }),
    },
  );

  await source.start({ headless: true });
  await assert.rejects(
    source.fetchAccounts(["alpha", "beta"]),
    (error) => error?.code === "X_CHALLENGE_REQUIRED",
  );
  await source.close();

  assert.deepEqual(visited, ["https://x.com/alpha"]);
});

test("an automatically translated page is replaced with the original GraphQL post text", async () => {
  let responseListener;
  const page = {
    on(event, listener) {
      if (event === "response") responseListener = listener;
    },
    off() {},
    async goto() {
      responseListener({
        url: () => "https://x.com/i/api/graphql/abc/UserTweets",
        headers: () => ({ "content-type": "application/json" }),
        json: async () => ({
          data: {
            result: {
              rest_id: "1950000000000000009",
              legacy: { full_text: "The original market update." },
            },
          },
        }),
      });
    },
    async waitForSelector() {},
    async evaluate() {
      return {
        authRequired: false,
        challengeRequired: false,
        posts: [
          {
            id: "1950000000000000009",
            author: "alpha",
            text: "自动翻译后的文本",
            displayedAsTranslated: true,
            timestamp: "2026-08-11T02:00:00.000Z",
            url: "https://x.com/alpha/status/1950000000000000009",
            replies: "0",
            reposts: "0",
            likes: "0",
            views: "0",
            isReply: false,
            isRepost: false,
          },
        ],
      };
    },
    async close() {},
  };
  const source = new BrowserFeedSource(
    {
      type: "chrome",
      executablePath: "/browser/chrome",
      profileDirectory: join(tmpdir(), "x-monitor-original-test"),
      fetchLimitPerAccount: 10,
      includeReplies: false,
      navigationTimeoutMs: 30_000,
    },
    {
      launch: async () => ({ newPage: async () => page, close: async () => {} }),
    },
  );

  await source.start({ headless: true });
  const result = await source.fetchAccounts(["alpha"]);
  await source.close();

  assert.equal(result.posts[0].text, "The original market update.");
});
