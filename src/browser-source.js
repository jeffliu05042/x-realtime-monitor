import { mkdir } from "node:fs/promises";

import puppeteer from "puppeteer-core";

export class BrowserLoginRequiredError extends Error {
  constructor() {
    super("the dedicated browser profile is not signed in to X; run the login command");
    this.name = "BrowserLoginRequiredError";
    this.code = "X_LOGIN_REQUIRED";
  }
}

export class BrowserChallengeRequiredError extends Error {
  constructor() {
    super("X requires an interactive account verification; run the login command and complete it manually");
    this.name = "BrowserChallengeRequiredError";
    this.code = "X_CHALLENGE_REQUIRED";
  }
}

export class OriginalTextUnavailableError extends Error {
  constructor() {
    super("X displayed an automatic translation but the original text was unavailable; this account was skipped");
    this.name = "OriginalTextUnavailableError";
    this.code = "X_ORIGINAL_TEXT_UNAVAILABLE";
  }
}

/** @param {unknown} value */
export function parseMetric(value) {
  const text = String(value ?? "0").trim().replaceAll(",", "");
  const match = text.match(/^([\d.]+)\s*([KMB万亿]?)$/i);
  if (!match) return 0;
  const number = Number(match[1]);
  const suffix = match[2].toUpperCase();
  const multiplier = suffix === "K" ? 1_000
    : suffix === "M" ? 1_000_000
      : suffix === "B" ? 1_000_000_000
        : suffix === "万" ? 10_000
          : suffix === "亿" ? 100_000_000
            : 1;
  return Number.isFinite(number) ? Math.round(number * multiplier) : 0;
}

/** @param {unknown} root */
function collectOriginalPostTexts(root) {
  const texts = new Map();
  const stack = [root];
  const seen = new Set();
  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    const object = /** @type {Record<string, any>} */ (value);
    const id = String(object.rest_id ?? object.id_str ?? "");
    const noteText = object.note_tweet?.note_tweet_results?.result?.text;
    const legacyText = object.legacy?.full_text;
    const text = typeof noteText === "string" && noteText
      ? noteText
      : typeof legacyText === "string" ? legacyText : "";
    if (/^\d+$/.test(id) && text) texts.set(id, text);
    stack.push(...Object.values(object));
  }
  return texts;
}

/** @param {import("puppeteer-core").Page} page */
function observeOriginalPostTexts(page) {
  const originals = new Map();
  const pending = new Set();
  /** @param {import("puppeteer-core").HTTPResponse} response */
  const onResponse = (response) => {
    if (!response.url().includes("/graphql/")) return;
    const task = Promise.resolve()
      .then(async () => collectOriginalPostTexts(await response.json()))
      .then((texts) => {
        for (const [id, text] of texts) originals.set(id, text);
      })
      .catch(() => {});
    pending.add(task);
    task.finally(() => pending.delete(task));
  };
  page.on("response", onResponse);
  return {
    originals,
    settle: async () => Promise.allSettled([...pending]),
    stop: () => page.off("response", onResponse),
  };
}

/**
 * This function executes inside the X page. It intentionally has no closure dependencies.
 * @param {string} expectedAccount
 */
function extractTimeline(expectedAccount) {
  const path = window.location.pathname.toLowerCase();
  const authRequired = Boolean(
    document.querySelector('input[autocomplete="username"], [data-testid="loginButton"], a[href="/login"]'),
  ) || path === "/login" || path.startsWith("/i/flow/login");
  const bodyText = document.body?.innerText?.slice(0, 4_000) ?? "";
  const explicitChallenge = Boolean(document.querySelector(
    'iframe[src*="arkoselabs"], iframe[title*="challenge"], [data-testid*="arkose"], #arkoseFrame',
  ));
  const verificationPrompt = Boolean(
    document.querySelector('[data-testid="ocfEnterTextTextInput"], input[name="text"]'),
  ) && /verify|verification|captcha|unusual activity|arkose|验证|確認身份|验证码|機器人/i.test(bodyText);
  const challengeRequired = path.startsWith("/account/access")
    || (path.startsWith("/i/flow/") && !path.startsWith("/i/flow/login"))
    || explicitChallenge
    || verificationPrompt;

  /** @param {Element | null | undefined} element */
  const parsePermalink = (element) => {
    const href = element?.getAttribute?.("href") ?? "";
    try {
      const parsed = new URL(href, "https://x.com");
      if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(parsed.hostname.toLowerCase())) {
        return null;
      }
      const match = decodeURIComponent(parsed.pathname).match(/^\/([^/]+)\/status\/(\d+)(?:\/|$)/i);
      return match ? {
        author: match[1].replace(/^@+/, "").toLowerCase(),
        id: match[2],
        url: `https://x.com/${match[1]}/status/${match[2]}`,
      } : null;
    } catch {
      return null;
    }
  };

  /** @param {string} id */
  const timestampFromId = (id) => {
    try {
      const milliseconds = Number((BigInt(id) >> 22n) + 1_288_834_974_657n);
      const timestamp = new Date(milliseconds);
      return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
    } catch {
      return null;
    }
  };

  const posts = [...document.querySelectorAll("article")].map((article) => {
    /** @param {Element | null | undefined} node */
    const isOuter = (node) => Boolean(
      node && node.closest?.("article") === article && !node.closest?.('[data-testid="quoteTweet"]'),
    );
    const time = [...article.querySelectorAll("time")].find((candidate) => (
      isOuter(candidate) && parsePermalink(candidate.closest("a"))
    ));
    const fallbackPermalink = [...article.querySelectorAll('a[href*="/status/"]')]
      .map((anchor) => parsePermalink(anchor))
      .find((candidate) => candidate !== null);
    const permalink = parsePermalink(time?.closest("a")) ?? fallbackPermalink;
    if (!permalink || permalink.author !== expectedAccount.toLowerCase()) return null;
    const textNode = [...article.querySelectorAll('[data-testid="tweetText"]')].find(isOuter)
      ?? [...article.querySelectorAll('[class*="whitespace-pre-wrap"]')]
        .find((candidate) => isOuter(candidate) && candidate.textContent?.trim());
    const socialContext = [...article.querySelectorAll('[data-testid="socialContext"]')]
      .filter(isOuter)
      .map((node) => node.textContent ?? "")
      .join(" ");
    const replyContext = [...article.querySelectorAll('[data-testid="replyingTo"], [data-testid="replyContext"]')]
      .some(isOuter);
    const displayedAsTranslated = [...article.querySelectorAll('button, [role="button"], span')]
      .filter(isOuter)
      .some((node) => /show original|显示原文|顯示原文|translated from|翻译自|翻譯自/i.test(
        [node.getAttribute("aria-label"), node.getAttribute("title"), node.textContent]
          .filter(Boolean)
          .join(" "),
      ));
    /** @param {string} testId */
    const metric = (testId) => {
      const legacy = article.querySelector(`[data-testid="${testId}"] span span`)?.textContent;
      if (legacy) return legacy;
      const label = testId === "retweet" ? /^(repost|retweet)$/i
        : testId === "reply" ? /^reply$/i
          : testId === "like" ? /^like$/i
            : /^view count$/i;
      const button = [...article.querySelectorAll("button")].find((candidate) => (
        label.test(candidate.getAttribute("aria-label") ?? "")
      ));
      return button?.textContent ?? "0";
    };
    return {
      id: permalink.id,
      author: permalink.author,
      text: textNode?.textContent ?? "",
      displayedAsTranslated,
      timestamp: time?.getAttribute("datetime") ?? timestampFromId(permalink.id),
      url: permalink.url,
      replies: metric("reply"),
      reposts: metric("retweet"),
      likes: metric("like"),
      views: article.querySelector('a[href*="/analytics"] span span')?.textContent ?? metric("view"),
      isReply: replyContext,
      isRepost: /reposted|retweeted|转发了|轉發了|リポスト/i.test(socialContext),
    };
  }).filter((post) => post !== null);
  return { authRequired, challengeRequired, posts };
}

/** @param {{authRequired: boolean, challengeRequired: boolean}} state */
function assertAuthenticated(state) {
  if (state.challengeRequired) throw new BrowserChallengeRequiredError();
  if (state.authRequired) throw new BrowserLoginRequiredError();
}

/**
 * @typedef {object} BrowserSourceOptions
 * @property {string} type
 * @property {string} executablePath
 * @property {string} profileDirectory
 * @property {number} fetchLimitPerAccount
 * @property {boolean} includeReplies
 * @property {number} navigationTimeoutMs
 */

export class BrowserFeedSource {
  /**
   * @param {BrowserSourceOptions} options
   * @param {{launch?: typeof puppeteer.launch}} [dependencies]
   */
  constructor(options, dependencies = {}) {
    this.options = options;
    this.launch = dependencies.launch ?? puppeteer.launch.bind(puppeteer);
    /** @type {import("puppeteer-core").Browser | null} */
    this.browser = null;
    /** @type {import("puppeteer-core").Page | null} */
    this.page = null;
  }

  /** @param {{headless: boolean}} options */
  async start({ headless }) {
    if (this.browser) return;
    await mkdir(this.options.profileDirectory, { recursive: true });
    this.browser = await this.launch({
      browser: this.options.type === "firefox" ? "firefox" : "chrome",
      executablePath: this.options.executablePath,
      userDataDir: this.options.profileDirectory,
      headless,
      args: [],
    });
    this.page = await this.browser.newPage();
  }

  async openLogin() {
    if (!this.page) throw new Error("browser source has not been started");
    await this.page.goto("https://x.com/home", {
      waitUntil: "domcontentloaded",
      timeout: this.options.navigationTimeoutMs,
    });
  }

  async verifyLogin() {
    if (!this.page) throw new Error("browser source has not been started");
    await this.page.goto("https://x.com/home", {
      waitUntil: "domcontentloaded",
      timeout: this.options.navigationTimeoutMs,
    });
    await this.page.waitForSelector("body", { timeout: this.options.navigationTimeoutMs });
    const result = await this.page.evaluate(extractTimeline, "");
    assertAuthenticated(result);
  }

  /** @param {string[]} accounts */
  async fetchAccounts(accounts) {
    if (!this.page) throw new Error("browser source has not been started");
    const posts = [];
    const errors = [];
    for (const account of accounts) {
      try {
        const rawPosts = await this.fetchAccount(account);
        posts.push(...rawPosts);
      } catch (error) {
        if (error instanceof BrowserLoginRequiredError || error instanceof BrowserChallengeRequiredError) {
          throw error;
        }
        errors.push({ account, message: error instanceof Error ? error.message : String(error) });
      }
    }
    return { posts, errors };
  }

  /** @param {string} account */
  async fetchAccount(account) {
    const page = /** @type {import("puppeteer-core").Page} */ (this.page);
    const observer = observeOriginalPostTexts(page);
    try {
      await page.goto(`https://x.com/${account}`, {
        waitUntil: "domcontentloaded",
        timeout: this.options.navigationTimeoutMs,
      });
      try {
        await page.waitForSelector(
          'article, [data-testid="emptyState"], input[autocomplete="username"], [data-testid="loginButton"], [data-testid="ocfEnterTextTextInput"], iframe[src*="arkoselabs"], #arkoseFrame',
          { timeout: this.options.navigationTimeoutMs },
        );
      } catch (error) {
        const state = await page.evaluate(extractTimeline, account).catch(() => null);
        if (state) assertAuthenticated(state);
        throw error;
      }
      const result = await page.evaluate(extractTimeline, account);
      await observer.settle();
      assertAuthenticated(result);
      return result.posts
        .filter((post) => post && post.text && !post.isRepost)
        .filter((post) => this.options.includeReplies || !post.isReply)
        .slice(0, this.options.fetchLimitPerAccount)
        .map((post) => {
          const original = observer.originals.get(String(post.id));
          if (post.displayedAsTranslated && !original) throw new OriginalTextUnavailableError();
          return {
            id: String(post.id),
            author: String(post.author).toLowerCase(),
            text: String(original ?? post.text).trim(),
            createdAt: post.timestamp ? String(post.timestamp) : null,
            url: String(post.url),
            metrics: {
              replies: parseMetric(post.replies),
              reposts: parseMetric(post.reposts),
              likes: parseMetric(post.likes),
              views: parseMetric(post.views),
            },
            isReply: Boolean(post.isReply),
            isRepost: false,
          };
        });
    } finally {
      observer.stop();
    }
  }

  async close() {
    const page = this.page;
    const browser = this.browser;
    this.page = null;
    this.browser = null;
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close();
  }
}
