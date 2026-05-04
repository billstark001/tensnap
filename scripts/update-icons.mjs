#!/usr/bin/env node
/**
 * update-icons.mjs
 * Regenerates all icon assets from assets/logo.png.
 * Run with: node scripts/update-icons.mjs [--logo <path>]
 */

import sharp from 'sharp';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');

// Parse --logo override
const logoArgIdx = process.argv.indexOf('--logo');
const LOGO_SRC = logoArgIdx !== -1
  ? resolve(process.argv[logoArgIdx + 1])
  : join(ROOT, 'assets', 'logo.png');


// #region Destination paths
const TAURI_ICONS = join(ROOT, 'packages', 'tensnap-tauri', 'src-tauri', 'icons');
const WEB_PUBLIC = join(ROOT, 'packages', 'tensnap-web', 'public');
const TAURI_PUBLIC = join(ROOT, 'packages', 'tensnap-tauri', 'public');

for (const dir of [TAURI_ICONS, WEB_PUBLIC, TAURI_PUBLIC]) {
  mkdirSync(dir, { recursive: true });
}

// #endregion

// #region Helper: resize and save a PNG
async function savePng(size, dest) {
  await sharp(LOGO_SRC).resize(size, size).png().toFile(dest);
  console.log(`  ✓ ${dest.replace(ROOT + '/', '')}`);
}

// #endregion

// #region 1. Tauri PNG icons

console.log('\nTauri PNG icons:');
const tauriPngs = [
  { file: '32x32.png', size: 32 },
  { file: '128x128.png', size: 128 },
  { file: '128x128@2x.png', size: 256 },
  { file: 'icon.png', size: 512 },
  { file: 'Square30x30Logo.png', size: 30 },
  { file: 'Square44x44Logo.png', size: 44 },
  { file: 'Square71x71Logo.png', size: 71 },
  { file: 'Square89x89Logo.png', size: 89 },
  { file: 'Square107x107Logo.png', size: 107 },
  { file: 'Square142x142Logo.png', size: 142 },
  { file: 'Square150x150Logo.png', size: 150 },
  { file: 'Square284x284Logo.png', size: 284 },
  { file: 'Square310x310Logo.png', size: 310 },
  { file: 'StoreLogo.png', size: 50 },
];
await Promise.all(tauriPngs.map(({ file, size }) => savePng(size, join(TAURI_ICONS, file))));

// #endregion

// #region 2. Tauri ICO (multi-resolution)

console.log('\nTauri ICO:');
const ICO_SIZES = [16, 32, 48, 64, 128, 256];

/**
 * Build a minimal ICO file buffer from an array of {size, buffer} PNG entries.
 * Reference: https://en.wikipedia.org/wiki/ICO_(file_format)
 */
function buildIco(entries) {
  const count = entries.length;
  const headerSize = 6;          // ICONDIR
  const dirEntrySize = 16;       // ICONDIRENTRY per image
  const dataOffset = headerSize + dirEntrySize * count;

  // Calculate byte offsets for each image
  let offset = dataOffset;
  const offsets = entries.map(({ buffer }) => {
    const cur = offset;
    offset += buffer.length;
    return cur;
  });

  const total = offset;
  const buf = Buffer.alloc(total);

  // ICONDIR header
  buf.writeUInt16LE(0, 0); // reserved
  buf.writeUInt16LE(1, 2); // type = 1 (ICO)
  buf.writeUInt16LE(count, 4);

  // ICONDIRENTRY entries
  entries.forEach(({ size, buffer }, i) => {
    const base = headerSize + i * dirEntrySize;
    buf.writeUInt8(size >= 256 ? 0 : size, base + 0);  // width  (0 = 256)
    buf.writeUInt8(size >= 256 ? 0 : size, base + 1);  // height (0 = 256)
    buf.writeUInt8(0, base + 2);  // color count (0 = no palette)
    buf.writeUInt8(0, base + 3);  // reserved
    buf.writeUInt16LE(1, base + 4); // planes
    buf.writeUInt16LE(32, base + 6); // bit count
    buf.writeUInt32LE(buffer.length, base + 8);
    buf.writeUInt32LE(offsets[i], base + 12);
  });

  // Image data
  entries.forEach(({ buffer }, i) => {
    buffer.copy(buf, offsets[i]);
  });

  return buf;
}

const icoEntries = await Promise.all(
  ICO_SIZES.map(async (size) => ({
    size,
    buffer: await sharp(LOGO_SRC).resize(size, size).png().toBuffer(),
  }))
);
const icoPath = join(TAURI_ICONS, 'icon.ico');
writeFileSync(icoPath, buildIco(icoEntries));
console.log(`  ✓ ${icoPath.replace(ROOT + '/', '')}`);

// #endregion

// #region 3. Tauri ICNS (macOS only, requires iconutil)

console.log('\nTauri ICNS:');
try {
  execFileSync('which', ['iconutil'], { stdio: 'ignore' });

  const tmpBase = mkdtempSync(join(tmpdir(), 'tensnap-'));
  const iconsetDir = join(tmpBase, 'tensnap.iconset');
  mkdirSync(iconsetDir);
  try {
    // iconutil requires exactly these base sizes; @2x is double the base.
    const icnsBaseSizes = [16, 32, 128, 256, 512];
    await Promise.all(
      icnsBaseSizes.flatMap((s) => [
        sharp(LOGO_SRC).resize(s, s).png().toFile(join(iconsetDir, `icon_${s}x${s}.png`)),
        sharp(LOGO_SRC).resize(s * 2, s * 2).png().toFile(join(iconsetDir, `icon_${s}x${s}@2x.png`)),
      ])
    );

    const icnsPath = join(TAURI_ICONS, 'icon.icns');
    execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath]);
    console.log(`  ✓ ${icnsPath.replace(ROOT + '/', '')}`);
  } finally {
    rmSync(tmpBase, { recursive: true, force: true });
  }
} catch (err) {
  if (err.code === 'ENOENT' || (err.stderr && err.stderr.includes('not found'))) {
    console.warn('  ⚠ iconutil not found — skipping .icns generation (macOS only)');
  } else {
    throw err;
  }
}

// #endregion

// #region 4. Web public assets (tensnap-web)

console.log('\nWeb public assets:');
const webAssets = [
  { file: 'favicon-32.png', size: 32 },
  { file: 'logo192.png', size: 192 },
  { file: 'logo512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
];
await Promise.all(webAssets.map(({ file, size }) => savePng(size, join(WEB_PUBLIC, file))));

// #endregion

// #region 5. Tauri web public assets (tensnap-tauri/public)

console.log('\nTauri web public assets:');
const tauriWebAssets = [
  { file: 'favicon-32.png', size: 32 },
  { file: 'logo192.png', size: 192 },
];
await Promise.all(tauriWebAssets.map(({ file, size }) => savePng(size, join(TAURI_PUBLIC, file))));

console.log('\nAll icons updated successfully.\n');

// #endregion