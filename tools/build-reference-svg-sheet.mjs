import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const projectRoot = path.resolve(import.meta.dirname, "..");
const bannerRoot = path.join(projectRoot, "public/brand/banner");
const manifest = JSON.parse(
  await fs.readFile(path.join(bannerRoot, "reference-elements.json"), "utf8"),
);
const columns = 4;
const cardWidth = 360;
const cardHeight = 220;
const rows = Math.ceil(manifest.elements.length / columns);
const composites = [];

for (const [index, element] of manifest.elements.entries()) {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const left = column * cardWidth;
  const top = row * cardHeight;
  const rendered = await sharp(path.join(projectRoot, "public", element.svg), { density: 216 })
    .resize({ width: 145, height: 145, fit: "contain" })
    .png()
    .toBuffer();
  const card = Buffer.from(`
    <svg width="${cardWidth}" height="${cardHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${cardWidth}" height="${cardHeight}" fill="#f6f3ed"/>
      <rect x="12" y="46" width="160" height="150" rx="12" fill="#fff"/>
      <rect x="188" y="46" width="160" height="150" rx="12" fill="#17201b"/>
      <text x="16" y="26" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#171917">${element.id}</text>
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
  .toFile(path.join(bannerRoot, "reference-svg-sheet.png"));

console.log(`Rendered ${manifest.elements.length} SVG elements.`);
