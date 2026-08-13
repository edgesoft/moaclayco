import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const LEGACY_ICON_GLYPHS = /[→←↗↘↙↑↓⇒➜➝⟶＋⌄⌃❯›]/;
const TRASH_ICON_COMPONENT = /<(?:Trash|Trash2|TrashIcon|DeleteIcon)\b/;
const TRASH_ICON_PATH = /M5 7h14M9 7V4\.5h6V7/;
const JOURNAL_ROW_REMOVAL_CONTROL = /Ta bort(?: konteringsraden?| raden)/;
const GREEN_ACTION_UNDERLINE = /decoration-emerald/;
const GREEN_VERIFICATION_ACCENT = /(?:text|bg|border|ring)-emerald/;
const VIEWPORT_DRIVEN_VERIFICATION_GRID =
  /(?:md:grid-cols|lg:grid-cols|lg:order|lg:block|lg:sticky)/;

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

test("the main app never renders a trash-can icon", async () => {
  const appDirectory = path.resolve("app");
  const violations: string[] = [];

  for (const filePath of await tsxFiles(appDirectory)) {
    const source = await readFile(filePath, "utf8");
    if (TRASH_ICON_COMPONENT.test(source) || TRASH_ICON_PATH.test(source)) {
      violations.push(path.relative(appDirectory, filePath));
    }
  }

  assert.deepEqual(violations, []);
});

test("journal-entry headers never render a removal control", async () => {
  const route = await readFile(
    path.resolve("app/routes/admin.verifications.new.tsx"),
    "utf8"
  );

  assert.doesNotMatch(route, JOURNAL_ROW_REMOVAL_CONTROL);
});

test("editorial actions never use a green underline", async () => {
  const appDirectory = path.resolve("app");
  const violations: string[] = [];

  for (const filePath of await tsxFiles(appDirectory)) {
    const source = await readFile(filePath, "utf8");
    if (GREEN_ACTION_UNDERLINE.test(source)) {
      violations.push(path.relative(appDirectory, filePath));
    }
  }

  assert.deepEqual(violations, []);
});

test("the verification form uses terracotta instead of green accents", async () => {
  const route = await readFile(
    path.resolve("app/routes/admin.verifications.new.tsx"),
    "utf8"
  );

  assert.doesNotMatch(route, GREEN_VERIFICATION_ACCENT);
});

test("save actions stay hidden while a file still needs attention", async () => {
  const route = await readFile(
    path.resolve("app/routes/admin.verifications.new.tsx"),
    "utf8"
  );

  assert.match(
    route,
    /const interpretationBlocksForm =\s*uploadingState === UploadingState\.UPLOADING \|\|\s*uploadingState === UploadingState\.REVIEW \|\|\s*uploadingState === UploadingState\.FAILED;/
  );
  assert.match(
    route,
    /const showVerificationActions =\s*hasStartedVerification && !interpretationBlocksForm;/
  );
  assert.match(
    route,
    /\{showVerificationActions \? \(\s*<div\s+ref=\{saveSummaryRef\}/
  );
  assert.match(route, /disabled=\{!isReadyToSave\}/);
  assert.match(route, /const currentEntriesForSaving = withoutEmptyJournalEntries\(currentEntries\)/);
  assert.doesNotMatch(route, /sticky bottom-0/);
});

test("long journal forms keep a compact balance monitor separate from save", async () => {
  const route = await readFile(
    path.resolve("app/routes/admin.verifications.new.tsx"),
    "utf8"
  );
  const styles = await readFile(path.resolve("app/styles/tailwind.css"), "utf8");

  assert.match(route, /data-testid="verification-balance-dock"/);
  assert.match(
    route,
    /showVerificationActions &&\s*fields\.length > 2 &&\s*isJournalSectionVisible &&\s*!isJournalBottomVisible &&\s*!isSaveSummaryVisible/
  );
  assert.match(route, /ref=\{saveSummaryRef\}/);
  assert.match(route, /ref=\{journalBottomRef\}/);
  assert.match(route, /new IntersectionObserver/);
  assert.match(route, />\s*Diff\s*</);
  assert.match(
    styles,
    /\.verification-balance-dock\s*\{[\s\S]*?bottom:\s*0;[\s\S]*?left:\s*0;[\s\S]*?margin:\s*0 !important;[\s\S]*?position:\s*fixed;[\s\S]*?right:\s*0;[\s\S]*?width:\s*100%;/
  );
  assert.doesNotMatch(route, /balanceDockBounds/);
  const dockStart = route.indexOf('data-testid="verification-balance-dock"');
  const journalRowsStart = route.indexOf('data-testid="verification-journal-rows"');
  assert.ok(journalRowsStart >= 0 && dockStart > journalRowsStart);
  const addRowStart = route.indexOf('onClick={handleAddRow}', dockStart);
  assert.ok(addRowStart > dockStart);
  assert.doesNotMatch(route.slice(dockStart, addRowStart), /type="submit"/);
});

test("the verification layout follows its container instead of the viewport", async () => {
  const route = await readFile(
    path.resolve("app/routes/admin.verifications.new.tsx"),
    "utf8"
  );
  const styles = await readFile(path.resolve("app/styles/tailwind.css"), "utf8");

  assert.doesNotMatch(route, VIEWPORT_DRIVEN_VERIFICATION_GRID);
  assert.match(styles, /container-name:\s*verification-page/);
  assert.match(styles, /@container verification-page/);
  assert.match(styles, /@container verification-entry/);
});

test("removing an uploaded material also removes its interpreted form data", async () => {
  const route = await readFile(
    path.resolve("app/routes/admin.verifications.new.tsx"),
    "utf8"
  );

  assert.match(route, /const preUploadFormValuesRef = useRef<FormData \| null>/);
  assert.match(route, /const removeUploadedMaterial = \(\) =>/);
  assert.match(
    route,
    /reset\(\s*previousManualValues \?\? \{\s*description: "",\s*verificationDate: initialVerificationDate,\s*journalEntries: \[\{ account: 0, debit: 0, credit: 0 \}\]/
  );
  assert.match(route, /onClick=\{removeUploadedMaterial\}/);
});

test("the new-verification form receives the selected accounting year", async () => {
  const parentRoute = await readFile(
    path.resolve("app/routes/admin.verifications.tsx"),
    "utf8"
  );

  assert.match(
    parentRoute,
    /<Outlet context=\{\{ latestVerificationNumber, year \}\} \/>/
  );
});
