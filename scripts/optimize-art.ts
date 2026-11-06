// Optimise les illustrations générées (docs-assets/gen) pour le web : webp/png redimensionnés + icônes PWA.
import sharp from 'sharp';
const SRC = 'docs-assets/gen';
const OUT = 'apps/web/public/art';
await sharp(`${SRC}/splash.png`).resize({ width: 768 }).webp({ quality: 82 }).toFile(`${OUT}/splash.webp`);
await sharp(`${SRC}/logo.png`).trim().resize({ width: 720 }).png({ compressionLevel: 9, palette: true }).toFile(`${OUT}/logo.png`);
await sharp(`${SRC}/cover.png`).resize({ width: 1200 }).webp({ quality: 82 }).toFile(`${OUT}/cover.webp`);
await sharp(`${SRC}/cover.png`).resize({ width: 1200 }).jpeg({ quality: 82 }).toFile('docs-assets/cover.jpg');
for (const s of [192, 512]) await sharp(`${SRC}/icon.png`).resize(s, s).png({ compressionLevel: 9 }).toFile(`${OUT}/icon-${s}.png`);
await sharp(`${SRC}/icon.png`).resize(180, 180).png().toFile(`${OUT}/apple-touch-icon.png`);
await sharp(`${SRC}/icon.png`).resize(48, 48).png().toFile(`${OUT}/favicon.png`);
console.log('art optimized');
