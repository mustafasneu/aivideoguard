#!/usr/bin/env node
/**
 * Tek kod tabani -> iki hedef.
 *
 * Firefox ve Chrome MV3'te arka plan tanimi farklidir:
 *   Firefox : background.scripts  (event page, DOM yok ama modul yuklenebilir)
 *   Chrome  : background.service_worker
 *
 * Kaynak kodda bu fark hic gorunmez; burada uretiyoruz.
 */

import esbuild from 'esbuild';
import { mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const watch = args.includes('--watch');
// Test derlemesi: KOD AYNI, yalnizca manifest'e yerel uc nokta izni eklenir.
// Ucundan uca test uretim paketini calistirabilsin diye.
const testBuild = args.includes('--test');
const only = args.find((a) => a.startsWith('--target='))?.split('=')[1];
// Opera Chromium tabanlidir ve ayni MV3 API'lerini kullanir; kod farki yoktur.
// Yine de ayri paket uretiliyor: magaza gonderimleri ayri, ve Opera'nin
// surum tabani Chrome'dan geride olabildigi icin `minimum_chrome_version`
// dayatmasi kurulumu gereksiz yere engelleyebilir.
const TARGETS = only
  ? [only]
  : testBuild
    ? ['chrome-test', 'firefox-test']
    : ['firefox', 'chrome', 'opera'];

const VERSION = '2.0.0';

function manifest(target) {
  const base = {
    manifest_version: 3,
    name: 'AI Video Guard',
    version: VERSION,
    description:
      'YouTube icerigini anlamsal ve baglamsal olarak degerlendirip istemediginiz konulari gizler.',
    permissions: ['storage', 'unlimitedStorage'],
    host_permissions: [
      '*://*.youtube.com/*',
      '*://*.ytimg.com/*',
      'https://generativelanguage.googleapis.com/*',
    ],
    action: { default_popup: 'popup/popup.html', default_title: 'AI Video Guard' },
    options_ui: { page: 'popup/options.html', open_in_tab: true },
    content_scripts: [
      {
        matches: ['*://*.youtube.com/*'],
        js: ['content/index.js'],
        css: ['content/overlay.css'],
        run_at: 'document_idle',
        all_frames: false,
      },
    ],
  };

  if (target === 'firefox' || target === 'firefox-test') {
    const ff = {
      ...base,
      background: { scripts: ['background/index.js'], type: 'module' },
      browser_specific_settings: {
        gecko: { id: 'aivideoguard@mustafaseker.dev', strict_min_version: '115.0' },
      },
    };
    if (target === 'firefox-test') {
      ff.name = 'AI Video Guard (TEST)';
      ff.host_permissions = [...base.host_permissions, 'http://127.0.0.1/*'];
    }
    return ff;
  }

  const chrome = {
    ...base,
    background: { service_worker: 'background/index.js', type: 'module' },
    minimum_chrome_version: '116',
  };

  if (target === 'opera') {
    // Opera'nin Chromium tabani Chrome'un gerisinde olabilir; sabit bir alt
    // surum dayatmak kurulumu gereksiz yere reddettirir. API kullanimimiz
    // MV3'un ortak yuzeyinde kaldigi icin bu sinir zaten gerekli degil.
    delete chrome.minimum_chrome_version;
  }

  if (target === 'chrome-test') {
    chrome.name = 'AI Video Guard (TEST)';
    chrome.host_permissions = [...base.host_permissions, 'http://127.0.0.1/*'];
  }
  return chrome;
}

// Icerik betikleri MV3'te ES modulu OLARAK YUKLENMEZ — klasik betiktir.
// Bu yuzden iife'ye derlenir. Arka plan ve popup manifest'te `type: module`
// oldugu icin esm kalir.
const BUNDLES = [
  { out: 'background/index', in: 'src/background/index.js', format: 'esm' },
  { out: 'content/index', in: 'src/content/index.js', format: 'iife' },
  { out: 'popup/options', in: 'src/popup/options.js', format: 'esm' },
  { out: 'popup/popup', in: 'src/popup/popup.js', format: 'esm' },
];

async function buildTarget(target) {
  const out = resolve(ROOT, 'dist', target);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const common = {
    outdir: out,
    bundle: true,
    target: target.startsWith('firefox') ? ['firefox115'] : ['chrome116'],
    // Her paket polyfill'in kendi kopyasini gomer; eklenti paketlerinde
    // ortak chunk yuklemesi guvenilir degil.
    splitting: false,
    minify: !watch,
    sourcemap: watch ? 'inline' : false,
    logLevel: 'warning',
  };

  const contexts = await Promise.all(
    BUNDLES.map((b) =>
      esbuild.context({
        ...common,
        entryPoints: [{ out: b.out, in: resolve(ROOT, b.in) }],
        format: b.format,
      }),
    ),
  );

  if (watch) {
    await Promise.all(contexts.map((c) => c.watch()));
  } else {
    await Promise.all(contexts.map((c) => c.rebuild()));
    await Promise.all(contexts.map((c) => c.dispose()));
  }

  await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest(target), null, 2));
  await cp(resolve(ROOT, 'src/popup/options.html'), resolve(out, 'popup/options.html'));
  await cp(resolve(ROOT, 'src/popup/popup.html'), resolve(out, 'popup/popup.html'));
  await cp(resolve(ROOT, 'src/popup/options.css'), resolve(out, 'popup/options.css'));
  await cp(resolve(ROOT, 'src/content/overlay.css'), resolve(out, 'content/overlay.css'));

  console.log(`  ✓ dist/${target}`);
}

console.log(`AI Video Guard v${VERSION} derleniyor...`);
for (const t of TARGETS) await buildTarget(t);
if (watch) console.log('  izleme modu — cikmak icin Ctrl+C');
