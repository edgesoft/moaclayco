import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const projectRoot = path.resolve(import.meta.dirname, "..");
const bannerRoot = path.join(projectRoot, "public/brand/banner");
const sourcePath = path.join(bannerRoot, "reference/chatgpt-element-reference.png");
const outputRoot = path.join(bannerRoot, "reference-elements-png");
const manifestPath = path.join(bannerRoot, "reference-elements.json");
const sheetPath = path.join(bannerRoot, "reference-element-sheet.png");

const elements = [
  { id: "reference-bee-01", kind: "bee", box: [20, 15, 150, 185] },
  { id: "reference-bee-02", kind: "bee", box: [170, 10, 165, 190] },
  { id: "reference-bee-03", kind: "bee", box: [325, 5, 165, 200] },
  { id: "reference-snail-01", kind: "snail", box: [455, 25, 150, 180] },
  { id: "reference-snail-02", kind: "snail", box: [585, 50, 160, 155] },
  { id: "reference-snails-03", kind: "snail", box: [705, 5, 190, 205] },
  { id: "reference-sun-01", kind: "sun", box: [875, 0, 205, 225] },
  { id: "reference-sun-02", kind: "sun", box: [1080, 35, 174, 195] },

  { id: "reference-flower-01", kind: "flower", box: [0, 205, 100, 295] },
  { id: "reference-flower-02", kind: "flower", box: [80, 205, 120, 295] },
  { id: "reference-flower-03", kind: "flower", box: [175, 235, 175, 270] },
  { id: "reference-flower-04", kind: "flower", box: [335, 245, 125, 255] },
  { id: "reference-flower-05", kind: "flower", box: [430, 230, 150, 275] },
  { id: "reference-flower-06", kind: "flower", box: [550, 255, 135, 245] },
  { id: "reference-flower-07", kind: "flower", box: [665, 220, 175, 285] },
  { id: "reference-flower-08", kind: "flower", box: [805, 235, 150, 270] },
  { id: "reference-flower-09", kind: "flower", box: [925, 235, 155, 270] },
  { id: "reference-flower-10", kind: "flower", box: [1065, 210, 189, 300] },

  { id: "reference-stem-01", kind: "stem", box: [15, 490, 105, 230] },
  { id: "reference-stem-02", kind: "stem", box: [100, 500, 125, 220] },
  { id: "reference-stem-03", kind: "stem", box: [205, 485, 135, 235] },
  { id: "reference-stem-04", kind: "stem", box: [325, 475, 150, 250] },
  { id: "reference-stem-05", kind: "stem", box: [450, 475, 155, 250] },
  { id: "reference-stem-06", kind: "stem", box: [575, 470, 140, 255] },
  { id: "reference-stem-07", kind: "stem", box: [680, 475, 125, 250] },
  { id: "reference-stem-08", kind: "stem", box: [785, 475, 130, 250] },
  { id: "reference-stem-09", kind: "stem", box: [890, 490, 120, 230] },
  { id: "reference-stem-10", kind: "stem", box: [985, 480, 130, 240] },
  { id: "reference-stem-11", kind: "stem", box: [1090, 475, 164, 250] },

  { id: "reference-leaf-01", kind: "leaf", box: [15, 710, 140, 285] },
  { id: "reference-leaf-02", kind: "leaf", box: [130, 715, 140, 275] },
  { id: "reference-leaf-03", kind: "leaf", box: [255, 735, 145, 255] },
  { id: "reference-leaf-04", kind: "leaf", box: [385, 725, 155, 265] },
  { id: "reference-leaf-05", kind: "leaf", box: [515, 735, 155, 250] },
  { id: "reference-leaf-06", kind: "leaf", box: [660, 705, 155, 285] },
  { id: "reference-leaf-07", kind: "leaf", box: [800, 705, 175, 285] },
  { id: "reference-leaf-08", kind: "leaf", box: [945, 715, 170, 275] },
  { id: "reference-leaf-09", kind: "leaf", box: [1080, 710, 174, 280] },

  { id: "reference-grass-01", kind: "grass", box: [0, 980, 140, 274] },
  { id: "reference-grass-02", kind: "grass", box: [105, 975, 160, 279] },
  { id: "reference-grass-03", kind: "grass", box: [240, 990, 170, 264] },
  { id: "reference-grass-04", kind: "grass", box: [375, 980, 170, 274] },
  { id: "reference-grass-05", kind: "grass", box: [510, 1000, 175, 254] },
  { id: "reference-grass-06", kind: "grass", box: [650, 990, 180, 264] },
  { id: "reference-grass-07", kind: "grass", box: [790, 995, 160, 259] },
  { id: "reference-grass-08", kind: "grass", box: [910, 995, 160, 259] },
  { id: "reference-grass-09", kind: "grass", box: [1020, 985, 155, 269] },
  { id: "reference-grass-10", kind: "grass", box: [1120, 970, 134, 284] },
];

function cleanAlpha(raw, width, height) {
  for (let offset = 0; offset < raw.length; offset += 4) {
    const alpha = raw[offset + 3];
    if (alpha <= 72) {
      raw[offset + 3] = 0;
    } else if (alpha >= 176) {
      raw[offset + 3] = 255;
    } else {
      raw[offset + 3] = Math.round(((alpha - 72) / 104) * 255);
    }
  }

  const labels = new Int32Array(width * height);
  const queue = new Int32Array(width * height);
  const components = [];
  let nextLabel = 1;

  for (let start = 0; start < labels.length; start += 1) {
    if (raw[start * 4 + 3] === 0 || labels[start] !== 0) continue;
    let head = 0;
    let tail = 1;
    let area = 0;
    let touchesLeft = false;
    let touchesRight = false;
    let touchesTop = false;
    queue[0] = start;
    labels[start] = nextLabel;

    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      area += 1;
      touchesLeft ||= x === 0;
      touchesRight ||= x === width - 1;
      touchesTop ||= y === 0;

      for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
        for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
          if (deltaX === 0 && deltaY === 0) continue;
          const nextX = x + deltaX;
          const nextY = y + deltaY;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (raw[next * 4 + 3] === 0 || labels[next] !== 0) continue;
          labels[next] = nextLabel;
          queue[tail++] = next;
        }
      }
    }

    components.push({
      label: nextLabel,
      area,
      touchesEdge: touchesLeft || touchesRight || touchesTop,
    });
    nextLabel += 1;
  }

  const largestArea = Math.max(...components.map((component) => component.area), 0);
  const removed = new Set(
    components
      .filter((component) =>
        component.area < Math.max(4, largestArea * 0.0015) ||
        (component.touchesEdge && component.area < largestArea * 0.9)
      )
      .map((component) => component.label),
  );

  for (let index = 0; index < labels.length; index += 1) {
    if (removed.has(labels[index])) raw[index * 4 + 3] = 0;
  }

  return raw;
}

async function extractElement(element) {
  const [left, top, width, height] = element.box;
  const { data, info } = await sharp(sourcePath)
    .extract({ left, top, width, height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const outputPath = path.join(outputRoot, `${element.id}.png`);
  await sharp(cleanAlpha(data, info.width, info.height), {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: 4,
      right: 4,
      bottom: 4,
      left: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  return {
    id: element.id,
    kind: element.kind,
    sourceBox: { left, top, width, height },
    file: `/brand/banner/reference-elements-png/${element.id}.png`,
    svg: `/brand/banner/reference-elements-svg/${element.id}.svg`,
  };
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
    const rendered = await sharp(path.join(projectRoot, "public", item.file))
      .resize({ width: 145, height: 145, fit: "contain" })
      .png()
      .toBuffer();
    const card = Buffer.from(`
      <svg width="${cardWidth}" height="${cardHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${cardWidth}" height="${cardHeight}" fill="#f6f3ed"/>
        <rect x="12" y="46" width="160" height="150" rx="12" fill="#fff"/>
        <rect x="188" y="46" width="160" height="150" rx="12" fill="#17201b"/>
        <text x="16" y="26" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#171917">${item.id}</text>
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

await fs.mkdir(outputRoot, { recursive: true });
const extracted = [];
for (const element of elements) extracted.push(await extractElement(element));
await fs.writeFile(
  manifestPath,
  `${JSON.stringify({
    source: "/brand/banner/reference/chatgpt-element-reference.png",
    generatedReference: true,
    elements: extracted,
  }, null, 2)}\n`,
  "utf8",
);
await createContactSheet(extracted);
console.log(`Extracted ${extracted.length} cleaned reference elements.`);
