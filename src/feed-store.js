import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * @typedef {object} ScrapedPost
 * @property {string} id
 * @property {string} author
 * @property {string} text
 * @property {string | null} createdAt
 * @property {string} url
 * @property {{replies: number, reposts: number, likes: number, views: number}} metrics
 * @property {boolean} isReply
 * @property {boolean} isRepost
 */

/** @param {string} path @param {unknown} value */
async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

/** @param {string} path @param {unknown} fallback */
async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return structuredClone(fallback);
    }
    throw error;
  }
}

export class FeedStore {
  /** @param {{directory: string, latestLimit: number}} options */
  constructor({ directory, latestLimit }) {
    this.directory = directory;
    this.latestLimit = latestLimit;
    this.jsonlPath = join(directory, "posts.jsonl");
    this.latestPath = join(directory, "latest.json");
    this.statePath = join(directory, "state.json");
    /** @type {Set<string> | null} */
    this.seenIds = null;
  }

  async initialize() {
    if (this.seenIds) return;
    await mkdir(this.directory, { recursive: true });
    const state = await readJson(this.statePath, { seen_ids: [] });
    const ids = state && typeof state === "object" && "seen_ids" in state && Array.isArray(state.seen_ids)
      ? state.seen_ids.map(String)
      : [];
    this.seenIds = new Set(ids);
  }

  /**
   * @param {ScrapedPost[]} posts
   * @param {{capturedAt: string}} options
   * @returns {Promise<{saved: number, duplicates: number}>}
   */
  async save(posts, { capturedAt }) {
    await this.initialize();
    const seenIds = /** @type {Set<string>} */ (this.seenIds);
    const batchIds = new Set();
    const fresh = posts.filter((post) => {
      if (seenIds.has(post.id) || batchIds.has(post.id)) return false;
      batchIds.add(post.id);
      return true;
    });
    const records = fresh.map((post) => ({
      schema_version: 1,
      source: "x_browser",
      captured_at: capturedAt,
      id: post.id,
      url: post.url,
      text: post.text,
      created_at: post.createdAt,
      author: { username: post.author },
      public_metrics: post.metrics,
      is_reply: post.isReply,
      is_repost: post.isRepost,
    }));

    if (records.length > 0) {
      await appendFile(
        this.jsonlPath,
        records.map((record) => JSON.stringify(record)).join("\n") + "\n",
        "utf8",
      );
      const previousLatest = await readJson(this.latestPath, []);
      const latest = Array.isArray(previousLatest) ? previousLatest : [];
      await writeJsonAtomic(this.latestPath, records.concat(latest).slice(0, this.latestLimit));
      for (const record of records) seenIds.add(record.id);
      await writeJsonAtomic(this.statePath, { seen_ids: [...seenIds].slice(-20_000) });
    }

    return { saved: records.length, duplicates: posts.length - records.length };
  }
}
