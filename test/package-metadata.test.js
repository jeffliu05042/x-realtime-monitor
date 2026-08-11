import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("package requires the minimum Node version supported by Puppeteer", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.equal(packageJson.engines.node, ">=22.12.0");
});
