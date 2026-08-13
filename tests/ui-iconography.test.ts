import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const LEGACY_ICON_GLYPHS = /[→←↗↘↙↑↓⇒➜➝⟶＋⌄⌃❯›]/;

async function tsxFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return tsxFiles(entryPath);
      return entry.name.endsWith(".tsx") ? [entryPath] : [];
    })
  );

  return nested.flat();
}

test("interactive UI icons use SVG components instead of font glyphs", async () => {
  const appDirectory = path.resolve("app");
  const violations: string[] = [];

  for (const filePath of await tsxFiles(appDirectory)) {
    const source = await readFile(filePath, "utf8");
    if (LEGACY_ICON_GLYPHS.test(source)) {
      violations.push(path.relative(appDirectory, filePath));
    }
  }

  assert.deepEqual(violations, []);
});
