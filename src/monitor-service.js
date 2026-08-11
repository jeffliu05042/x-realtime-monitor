/**
 * @typedef {object} MonitorSettings
 * @property {string[]} accounts
 * @property {number} lookbackMinutes
 * @property {number} pollIntervalSeconds
 */

export class MonitorService {
  /**
   * @param {MonitorSettings} settings
   * @param {{source: {fetchAccounts: (accounts: string[]) => Promise<{posts: import("./feed-store.js").ScrapedPost[], errors: {account: string, message: string}[]}>}, store: {save: (posts: import("./feed-store.js").ScrapedPost[], options: {capturedAt: string}) => Promise<{saved: number, duplicates: number}>}, now?: () => Date, sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>}} dependencies
   */
  constructor(settings, dependencies) {
    this.settings = settings;
    this.source = dependencies.source;
    this.store = dependencies.store;
    this.now = dependencies.now ?? (() => new Date());
    this.sleep = dependencies.sleep ?? abortableSleep;
  }

  async checkOnce() {
    const capturedAt = this.now();
    const result = await this.source.fetchAccounts(this.settings.accounts);
    const earliest = capturedAt.getTime() - this.settings.lookbackMinutes * 60_000;
    const latest = capturedAt.getTime() + 2 * 60_000;
    const recentPosts = result.posts.filter((post) => {
      const timestamp = Date.parse(post.createdAt ?? "");
      return Number.isFinite(timestamp) && timestamp >= earliest && timestamp <= latest;
    }).sort((left, right) => (
      Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? "")
    ));
    const stored = await this.store.save(recentPosts, { capturedAt: capturedAt.toISOString() });
    return {
      fetched: result.posts.length,
      recent: recentPosts.length,
      saved: stored.saved,
      duplicates: stored.duplicates,
      errors: result.errors,
    };
  }

  /**
   * @param {{signal: AbortSignal, onCycle?: (summary: Awaited<ReturnType<MonitorService["checkOnce"]>>) => void | Promise<void>}} options
   */
  async run({ signal, onCycle = () => {} }) {
    while (!signal.aborted) {
      const summary = await this.checkOnce();
      await onCycle(summary);

      if (signal.aborted) {
        break;
      }

      await this.sleep(this.settings.pollIntervalSeconds * 1000, signal);
    }
  }
}

/**
 * @param {number} milliseconds
 * @param {AbortSignal} signal
 */
function abortableSleep(milliseconds, signal) {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve(undefined);
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}
