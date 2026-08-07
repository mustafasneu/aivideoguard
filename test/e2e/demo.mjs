#!/usr/bin/env node
/**
 * Ucundan uca gorunur demo + dogrulama.
 *
 *   node test/e2e/demo.mjs              # sahte API, gorunur pencere
 *   node test/e2e/demo.mjs --live       # gercek Gemini (GEMINI_API_KEY gerekir)
 *   node test/e2e/demo.mjs --headless   # ekransiz, yalniz dogrulama
 *
 * Uretim manifesti hic degistirilmez: gercek youtube.com adresine gidilir ve
 * istek Playwright tarafindan karsilanir. Boylece icerik betigi gercek
 * eslesme kuraliyla enjekte olur.
 */

import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { VIDEOS, fixtureHtml, TINY_JPEG } from './fixture.js';
import { startMockServer } from './mockApi.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Sahte kipte test paketi kullanilir: KOD AYNI, manifest'e yalnizca
// yerel uc nokta izni eklenmistir (Playwright service worker isteklerini
// yakalayamadigi icin ag katmaninda degil, uc nokta ayariyla yonlendiriyoruz).
const EXT = resolve(ROOT, process.argv.includes('--live') ? 'dist/chrome' : 'dist/chrome-test');

const LIVE = process.argv.includes('--live');
const HEADLESS = process.argv.includes('--headless');
const SLOW = HEADLESS ? 0 : 380;

const APIKEY = LIVE ? process.env.GEMINI_API_KEY : 'TEST-SAHTE-ANAHTAR';
if (LIVE && !APIKEY) {
  console.error('--live icin GEMINI_API_KEY ortam degiskeni gerekir.');
  process.exit(2);
}

const SETTINGS = {
  topic: 'Türkiye siyaseti, meclis gündemi, partiler arası tartışmalar ve seçim haberleri',
  anchors: 'siyasi tartışma programı\nseçim haberleri',
  hardBlock: 'spoiler',
  channelBlock: 'Engelli Kanal',
  channelAllow: 'Güvenli Kanal',
};

/* ------------------------------------------------------------------ */

const log = (m) => console.log(m);
const step = (n, m) => console.log(`\n\x1b[36m[${n}]\x1b[0m ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function banner(page, text, sub = '') {
  if (HEADLESS) return;
  await page.evaluate(
    ([t, s]) => {
      let el = document.getElementById('__aivg_demo');
      if (!el) {
        el = document.createElement('div');
        el.id = '__aivg_demo';
        el.style.cssText =
          'position:fixed;left:0;right:0;top:0;z-index:2147483647;padding:14px 20px;' +
          'background:linear-gradient(90deg,#c62828,#7b1fa2);color:#fff;' +
          'font:600 15px/1.35 system-ui,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.5)';
        document.documentElement.appendChild(el);
      }
      el.innerHTML = `${t}${s ? `<div style="font-weight:400;font-size:12.5px;opacity:.9;margin-top:3px">${s}</div>` : ''}`;
    },
    [text, sub],
  );
  await page.waitForTimeout(SLOW * 2);
}

/* ------------------------------------------------------------------ */

async function main() {
  const profile = await mkdtemp(resolve(tmpdir(), 'aivg-'));
  const mock = LIVE ? null : await startMockServer();

  log(`\n\x1b[1mAI Video Guard — ucundan uca demo\x1b[0m`);
  log(`  kip      : ${LIVE ? 'GERCEK Gemini API' : `sahte API — ${mock.endpoint}`}`);
  log(`  pencere  : ${HEADLESS ? 'gizli' : 'gorunur'}`);
  log(`  eklenti  : ${EXT}`);

  const context = await chromium.launchPersistentContext(profile, {
    // Playwright'in `headless:true` bayragi eski headless kipini secer ve
    // o kipte eklentiler HIC yuklenmez. Yeni headless kipini elle veriyoruz.
    headless: false,
    slowMo: SLOW ? 60 : 0,
    viewport: null,
    serviceWorkers: 'allow',
    args: [
      ...(HEADLESS ? ['--headless=new'] : []),
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--window-size=1280,900',
    ],
  });

  // --- Ag yonlendirmesi ------------------------------------------------
  await context.route('**://*.youtube.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixtureHtml() }),
  );
  await context.route('**://*.ytimg.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: TINY_JPEG }),
  );
  // Gemini istekleri arka plan service worker'indan cikar; Playwright bunlari
  // yakalayamiyor. Bu yuzden yonlendirmeyi eklentinin apiEndpoint ayariyla
  // yapiyoruz (asagida, ayarlar sayfasinda).

  // --- Eklenti kimligi -------------------------------------------------
  // Arka plan service worker'i tembel baslar; olay dinleyicisi gec baglanirsa
  // kacirilabilir. Bu yuzden hem olayi bekle hem de yoklamayi surdur.
  let sw = context.serviceWorkers()[0];
  if (!sw) {
    sw = await Promise.race([
      context.waitForEvent('serviceworker', { timeout: 30000 }),
      (async () => {
        for (let i = 0; i < 60; i++) {
          const found = context.serviceWorkers()[0];
          if (found) return found;
          await new Promise((r) => setTimeout(r, 500));
        }
        throw new Error('Arka plan service worker baslamadi — eklenti yuklenememis olabilir');
      })(),
    ]);
  }
  const extId = new URL(sw.url()).host;
  log(`  kimlik   : ${extId}\n`);

  const swErrors = [];
  sw.on('console', (m) => { if (m.type() === 'error') swErrors.push(m.text()); });

  /* --------------------------------------------------------------- */
  step(1, 'Ayarlar sayfasi aciliyor, filtre olculeri giriliyor');
  // Ilk kurulumda eklenti ayarlar sekmesini kendi acar (onInstalled).
  // Yeni sekme acmak yerine varsa onu devral, yoksa ac.
  const optUrl = `chrome-extension://${extId}/popup/options.html`;
  await sleep(800);
  let opt = context.pages().find((p) => p.url().startsWith(optUrl));
  if (!opt) {
    opt = await context.newPage();
    await opt.goto(optUrl, { waitUntil: 'domcontentloaded' });
  }
  // Kullanilmayan bos sekmeleri kapat — ekran goruntusu temiz olsun
  for (const p of context.pages()) {
    if (p !== opt && (p.url() === 'about:blank' || p.url().startsWith('chrome://'))) {
      await p.close().catch(() => {});
    }
  }
  await opt.bringToFront();
  await banner(opt, 'ADIM 1 — Filtre ölçütleri',
    'Kelime listesi değil: konu doğal dille yazılıyor, çapalar anlam merkezi olarak giriliyor.');

  await opt.fill('#apiKey', APIKEY);
  await opt.fill('#topic', SETTINGS.topic);
  await opt.fill('#anchors', SETTINGS.anchors);
  await opt.locator('.adv summary').first().click();       // kesin kurallar
  await opt.fill('#hardBlock', SETTINGS.hardBlock);
  await opt.fill('#channelBlock', SETTINGS.channelBlock);
  await opt.fill('#channelAllow', SETTINGS.channelAllow);
  await opt.check('#debug');                                // katman izlerini gorunur kil
  if (!LIVE) {
    await opt.locator('.adv summary').last().click();       // uc nokta
    await opt.fill('#apiEndpoint', mock.endpoint);
  }
  await opt.waitForTimeout(900); // debounce'lu kaydetme

  /* --------------------------------------------------------------- */
  step(2, 'Kalibrasyon paneli — hangi katmanin karar verdigi gorulüyor');
  await banner(opt, 'ADIM 2 — Kalibrasyon',
    'Tek bir başlık deneniyor. Skor ve karar veren katman görünür; önbelleğe yazılmaz.');
  await opt.fill('#probeTitle', 'Kulisler hareketli: koalisyon görüşmeleri sürüyor');
  await opt.fill('#probeChannel', 'Ankara Kulis');
  await opt.click('#probeBtn');
  await opt.waitForSelector('#probeOut dl', { timeout: 15000 });
  const probeText = await opt.textContent('#probeOut');
  log(`      ${probeText.replace(/\s+/g, ' ').trim()}`);
  await opt.waitForTimeout(SLOW * 3);

  /* --------------------------------------------------------------- */
  step(3, 'YouTube akisi aciliyor');
  const yt = await context.newPage();
  await yt.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
  await banner(yt, 'ADIM 3 — Akış filtreleniyor',
    'Kartlar önce bulanık (değerlendiriliyor), sonra karar uygulanıyor.');

  // Kararlarin oturmasini bekle: hicbir kart 'pending' kalmamali
  await yt.waitForFunction(
    () => document.querySelectorAll('[data-aivg="pending"]').length === 0,
    null,
    { timeout: 30000 },
  ).catch(() => log('      \x1b[33muyari: bazi kartlar pending kaldi (bekci devreye girmis olabilir)\x1b[0m'));
  await yt.waitForTimeout(1200);

  /* --------------------------------------------------------------- */
  step(4, 'Sonuclar dogrulaniyor');
  const actual = await yt.evaluate(() => {
    const out = {};
    for (const card of document.querySelectorAll('ytd-rich-item-renderer')) {
      const href = card.querySelector('a[href*="v="]')?.getAttribute('href') || '';
      const id = href.match(/v=([\w-]+)/)?.[1];
      if (!id) continue;
      out[id] = {
        state: card.getAttribute('data-aivg') || 'none',
        layer:
          card.getAttribute('data-aivg-layer') ||
          card.getAttribute('data-aivg-decided') ||
          '',
        label: card.getAttribute('data-aivg-label') || '',
      };
    }
    return out;
  });

  const rows = [];
  let pass = 0;
  for (const v of VIDEOS) {
    const a = actual[v.id] || { state: 'none' };
    const got = a.state === 'blocked' ? 'block' : 'allow';
    const ok = got === v.expect;
    if (ok) pass++;
    rows.push({ ok, v, got, layer: a.layer });
  }

  log('');
  log('  ' + 'sonuc'.padEnd(7) + 'beklenen'.padEnd(10) + 'katman'.padEnd(16) + 'baslik');
  log('  ' + '─'.repeat(96));
  for (const r of rows) {
    const mark = r.ok ? '\x1b[32m  ✓\x1b[0m  ' : '\x1b[31m  ✗\x1b[0m  ';
    log(
      mark +
        r.got.padEnd(9) +
        r.v.expect.padEnd(10) +
        (r.layer || '—').padEnd(16) +
        r.v.title.slice(0, 46),
    );
    if (!r.ok) log(`        beklenti gerekcesi: ${r.v.why}`);
  }

  log('');
  log(`  \x1b[1m${pass}/${VIDEOS.length}\x1b[0m kart beklendigi gibi`);
  if (!LIVE) {
    log(`  API cagrilari: ${mock.counters.embed} toplu gomu (${mock.counters.embedTexts} metin), ` +
        `${mock.counters.text} metin LLM, ${mock.counters.vision} gorsel LLM`);
    if (mock.counters.embedTexts > 0) {
      log(`  toplama kazanci: ${mock.counters.embedTexts} metin / ${mock.counters.embed} istek ` +
          `= istek basina ${(mock.counters.embedTexts / mock.counters.embed).toFixed(1)} metin`);
    }
  }
  if (swErrors.length) {
    log(`\n  \x1b[31marka plan hatalari:\x1b[0m`);
    for (const e of swErrors.slice(0, 6)) log(`    ${e.slice(0, 140)}`);
  }

  /* --------------------------------------------------------------- */
  step(5, 'Onbellek dogrulamasi — sayfa yenileniyor');
  const before = mock ? { ...mock.counters } : null;
  await banner(yt, 'ADIM 5 — Önbellek', 'Sayfa yenileniyor. Kararlar önbellekten gelmeli, yeni API çağrısı olmamalı.');
  await yt.reload({ waitUntil: 'domcontentloaded' });
  await yt.waitForTimeout(2500);
  let cacheOk = true;
  if (mock) {
    const newEmbeds = mock.counters.embed - before.embed;
    const newLlm = mock.counters.text + mock.counters.vision - before.text - before.vision;
    cacheOk = newEmbeds + newLlm === 0;
    log(`      yenileme sonrasi ek cagri: ${newEmbeds} gomu, ${newLlm} LLM ` +
        (cacheOk ? '\x1b[32m(onbellek calisiyor)\x1b[0m' : '\x1b[33m(onbellek atlanmis)\x1b[0m'));
  }

  await mkdir(resolve(ROOT, 'test/e2e/out'), { recursive: true });
  await yt.screenshot({ path: resolve(ROOT, 'test/e2e/out/akis.png'), fullPage: true });
  await opt.screenshot({ path: resolve(ROOT, 'test/e2e/out/ayarlar.png'), fullPage: true });
  log(`\n  ekran goruntuleri: test/e2e/out/`);

  if (!HEADLESS) {
    await banner(yt, 'Demo tamamlandı', 'Pencere 10 saniye açık kalacak.');
    await yt.waitForTimeout(10000);
  }

  await context.close();
  await mock?.close();
  await rm(profile, { recursive: true, force: true });

  const failed = VIDEOS.length - pass;
  if (!cacheOk) log('\n\x1b[33muyari: onbellek yenileme sonrasi devreye girmedi\x1b[0m');
  if (failed > 0) {
    log(`\n\x1b[31m${failed} kart beklenenden farkli davrandi.\x1b[0m\n`);
    process.exit(1);
  }
  log('\n\x1b[32mTum kartlar beklendigi gibi davrandi.\x1b[0m\n');
}

main().catch((e) => {
  console.error('\n\x1b[31mDemo basarisiz:\x1b[0m', e);
  process.exit(1);
});
