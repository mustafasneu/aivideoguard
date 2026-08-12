#!/usr/bin/env node
/**
 * Magaza paketi uretir — Windows, macOS ve Linux'ta AYNI sekilde.
 *
 * NEDEN KENDI YAZDIK: onceki surum kabuktan `zip` cagiriyordu. O komut
 * Windows'ta yoktur, dolayisiyla paket uretmek yalnizca Unix'te mumkundu.
 * Node'un yerlesik `zlib`i DEFLATE'i zaten sagliyor; ZIP kabugunu yazmak
 * bir bagimliliktan da, platforma bagli kalmaktan da ucuz.
 */

import { deflateRawSync } from 'node:zlib';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* --- CRC-32 -------------------------------------------------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Klasoru ozyinelemeli tarar, ZIP icindeki yollari dondurur. */
async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    // ZIP yollari HER ZAMAN '/' kullanir; Windows'un '\' ayraci ile
    // uretilen arsivi magazalar reddeder.
    else out.push({ full, name: relative(base, full).split(sep).join('/') });
  }
  return out;
}

/** MS-DOS tarih/saat alani — ZIP baslıklarinin zorunlu parcasi. */
function dosTime(date) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() / 2)) & 0xffff;
  const day =
    (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, day };
}

export async function zipDir(srcDir, outFile) {
  const files = (await walk(srcDir)).sort((a, b) => a.name.localeCompare(b.name));
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const data = await readFile(f.full);
    const info = await stat(f.full);
    const { time, day } = dosTime(info.mtime);
    const crc = crc32(data);
    const deflated = deflateRawSync(data, { level: 9 });
    // Sikistirma bazen buyutur (kucuk ya da zaten sikisik dosyalar).
    // Boyle durumda ham saklamak hem daha kucuk hem daha hizli acilir.
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const nameBuf = Buffer.from(f.name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // cikarmak icin gereken surum
    local.writeUInt16LE(0x0800, 6); // UTF-8 ad bayragi
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(day, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  await writeFile(outFile, Buffer.concat([...chunks, centralBuf, end]));
  return { files: files.length, bytes: offset + centralBuf.length + 22 };
}

const TARGETS = ['firefox', 'chrome', 'opera'];

for (const t of TARGETS) {
  const src = resolve(ROOT, 'dist', t);
  const out = resolve(ROOT, 'dist', `ai-video-guard-${t}.zip`);
  try {
    const { files, bytes } = await zipDir(src, out);
    console.log(`  ✓ dist/ai-video-guard-${t}.zip  (${files} dosya, ${(bytes / 1024).toFixed(0)} KB)`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`  ✗ dist/${t} yok — once: npm run build`);
      process.exitCode = 1;
    } else throw err;
  }
}
