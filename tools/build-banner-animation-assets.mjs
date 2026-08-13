import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const projectRoot = path.resolve(import.meta.dirname, "..");
const bannerRoot = path.join(projectRoot, "public/brand/banner");
const masterPath = path.join(bannerRoot, "master/banner-master.svg");
const outputRoot = path.join(bannerRoot, "animation-svg");
const manifestPath = path.join(bannerRoot, "animation-elements.json");
const sheetPath = path.join(bannerRoot, "animation-element-sheet.png");
const MIN_DISTANCE_FROM_WHITE = 24;

const elements = [
  { id: "bee-01", label: "Bi 1", kind: "bee", viewBox: [98, 23, 42, 42], rect: [102, 25, 38, 38] },
  { id: "bee-02", label: "Bi 2", kind: "bee", viewBox: [416, 25, 39, 38], rect: [418, 27, 36, 34] },
  { id: "bee-03", label: "Bi 3", kind: "bee", viewBox: [1183, 25, 39, 38], rect: [1186, 27, 35, 34] },
  { id: "bee-04", label: "Bi 4", kind: "bee", viewBox: [1497, 26, 44, 43], rect: [1500, 28, 40, 39] },
  { id: "bee-05", label: "Bi 5", kind: "bee", viewBox: [1811, 25, 39, 38], rect: [1814, 27, 34, 34] },
  { id: "sun-01", label: "Pricksol 1", kind: "sun", viewBox: [776, 1, 91, 98], center: [819, 52], radius: [47, 50] },
  { id: "sun-02", label: "Pricksol 2", kind: "sun", viewBox: [1298, 0, 87, 94], center: [1341, 45], radius: [45, 48] },
  {
    id: "snails-01",
    label: "Snigeltrio 1",
    kind: "snails",
    viewBox: [827, 90, 52, 47],
    parts: [[838, 92, 24, 25], [829, 110, 25, 27], [849, 110, 28, 25]],
  },
  {
    id: "snails-02",
    label: "Snigeltrio 2",
    kind: "snails",
    viewBox: [1244, 64, 69, 66],
    parts: [[1265, 64, 34, 37], [1245, 94, 36, 35], [1277, 94, 36, 36]],
  },
  { id: "garden-01", label: "Växtlager 1", kind: "garden", viewBox: [0, 28, 115, 112], range: [0, 114] },
  { id: "garden-02", label: "Växtlager 2", kind: "garden", viewBox: [110, 78, 78, 62], range: [114, 184] },
  { id: "garden-03", label: "Växtlager 3", kind: "garden", viewBox: [180, 65, 132, 75], range: [184, 315] },
  { id: "garden-04", label: "Växtlager 4", kind: "garden", viewBox: [424, 72, 101, 68], range: [420, 520] },
  { id: "garden-05", label: "Växtlager 5", kind: "garden", viewBox: [516, 55, 123, 85], range: [520, 635] },
  { id: "garden-06", label: "Växtlager 6", kind: "garden", viewBox: [705, 48, 135, 92], range: [700, 835] },
  { id: "garden-07", label: "Växtlager 7", kind: "garden", viewBox: [830, 52, 140, 88], range: [835, 965] },
  { id: "garden-08", label: "Växtlager 8", kind: "garden", viewBox: [960, 48, 160, 92], range: [965, 1115] },
  { id: "garden-09", label: "Växtlager 9", kind: "garden", viewBox: [1110, 72, 130, 68], range: [1115, 1235] },
  { id: "garden-10", label: "Växtlager 10", kind: "garden", viewBox: [1230, 45, 165, 95], range: [1235, 1390] },
  { id: "garden-11", label: "Växtlager 11", kind: "garden", viewBox: [1385, 27, 130, 113], range: [1390, 1510] },
  { id: "garden-12", label: "Växtlager 12", kind: "garden", viewBox: [1505, 62, 130, 78], range: [1510, 1630] },
  { id: "garden-13", label: "Växtlager 13", kind: "garden", viewBox: [1625, 60, 150, 80], range: [1630, 1770] },
  { id: "garden-14", label: "Växtlager 14", kind: "garden", viewBox: [1765, 42, 90, 98], range: [1770, 1850] },
  { id: "garden-15", label: "Växtlager 15", kind: "garden", viewBox: [1845, 68, 83, 72], range: [1850, 1928] },
];

function parseColor(hex) {
  const value = hex.replace("#", "");
  const normalized = value.length === 3
    ? value.split("").map((character) => `${character}${character}`).join("")
    : value;
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function distanceFromWhite(color) {
  return Math.max(255 - color.red, 255 - color.green, 255 - color.blue);
}

function getStartPoint(pathMarkup) {
  const data = pathMarkup.match(/\sd="([^"]+)"/)?.[1];
  if (!data) return null;
  const numbers = data.slice(1).match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi);
  if (!numbers || numbers.length < 2) return null;
  return [Number(numbers[0]), Number(numbers[1])];
}

function pointInRect(point, rect) {
  const [x, y] = point;
  const [left, top, width, height] = rect;
  return x >= left && x <= left + width && y >= top && y <= top + height;
}

function isSunYellow(color) {
  return color.red >= 220 && color.green >= 175 && color.blue <= 180;
}

function pointInEllipse(point, center, radius) {
  const [x, y] = point;
  const [centerX, centerY] = center;
  const [radiusX, radiusY] = radius;
  return ((x - centerX) ** 2) / (radiusX ** 2) +
    ((y - centerY) ** 2) / (radiusY ** 2) <= 1;
}

function chooseOwner(point, color) {
  if (!point) return null;

  const bee = elements.find((element) =>
    element.kind === "bee" && pointInRect(point, element.rect)
  );
  if (bee) return bee;

  if (isSunYellow(color)) {
    const sun = elements.find((element) =>
      element.kind === "sun" && pointInEllipse(point, element.center, element.radius)
    );
    if (sun) return sun;
  }

  const snails = elements.find((element) =>
    element.kind === "snails" && element.parts.some((part) => pointInRect(point, part))
  );
  if (snails) return snails;

  const [x] = point;
  return elements.find((element) =>
    element.kind === "garden" && x >= element.range[0] && x < element.range[1]
  ) ?? null;
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function createContactSheet(items) {
  const columns = 4;
  const cardWidth = 360;
  const cardHeight = 220;
  const rows = Math.ceil(items.length / columns);
  const composites = [];

  for (const [index, item] of items.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * cardWidth;
    const top = row * cardHeight;
    const rendered = await sharp(path.join(outputRoot, `${item.id}.svg`), { density: 216 })
      .resize({ width: 145, height: 140, fit: "contain" })
      .png()
      .toBuffer();
    const card = Buffer.from(`
      <svg width="${cardWidth}" height="${cardHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${cardWidth}" height="${cardHeight}" fill="#f6f3ed"/>
        <rect x="12" y="46" width="160" height="150" rx="12" fill="#ffffff"/>
        <rect x="188" y="46" width="160" height="150" rx="12" fill="#17201b"/>
        <text x="16" y="25" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#171917">${escapeXml(item.id)}</text>
        <text x="112" y="25" font-family="Arial, sans-serif" font-size="12" fill="#61645f">${escapeXml(item.label)}</text>
      </svg>
    `);
    composites.push({ input: card, left, top });
    composites.push({ input: rendered, left: left + 20, top: top + 51 });
    composites.push({ input: rendered, left: left + 196, top: top + 51 });
  }

  await sharp({
    create: {
      width: columns * cardWidth,
      height: rows * cardHeight,
      channels: 4,
      background: "#efeae1",
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(sheetPath);
}

const master = await fs.readFile(masterPath, "utf8");
const paths = [...master.matchAll(/<path\b[^>]*\/>/g)].map((match) => match[0]);
const output = new Map(elements.map((element) => [element.id, []]));
let ignoredNearWhite = 0;
let unassigned = 0;

for (const pathMarkup of paths) {
  const fill = pathMarkup.match(/\sfill="(#[0-9a-fA-F]{3,6})"/)?.[1];
  if (!fill) continue;
  const color = parseColor(fill);
  if (distanceFromWhite(color) < MIN_DISTANCE_FROM_WHITE) {
    ignoredNearWhite += 1;
    continue;
  }
  const owner = chooseOwner(getStartPoint(pathMarkup), color);
  if (!owner) {
    unassigned += 1;
    continue;
  }
  output.get(owner.id).push(pathMarkup);
}

await fs.mkdir(outputRoot, { recursive: true });

for (const element of elements) {
  const [left, top, width, height] = element.viewBox;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${width} ${height}" role="img" aria-label="${escapeXml(element.label)}">`,
    ...output.get(element.id),
    "</svg>",
    "",
  ].join("\n");
  await fs.writeFile(path.join(outputRoot, `${element.id}.svg`), svg, "utf8");
}

const manifest = {
  source: { width: 1928, height: 140, file: "/brand/banner/source/background3-original.jpg" },
  master: "/brand/banner/master/banner-master.svg",
  elements: elements.map((element) => ({
    id: element.id,
    label: element.label,
    kind: element.kind,
    viewBox: element.viewBox,
    file: `/brand/banner/animation-svg/${element.id}.svg`,
    anchor: element.kind === "bee" ? "center" : "bottom",
  })),
};
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await createContactSheet(elements);

console.log(JSON.stringify({
  paths: paths.length,
  ignoredNearWhite,
  assigned: [...output.values()].reduce((total, pathsForElement) => total + pathsForElement.length, 0),
  unassigned,
  emptyElements: elements.filter((element) => output.get(element.id).length === 0).map((element) => element.id),
}, null, 2));
