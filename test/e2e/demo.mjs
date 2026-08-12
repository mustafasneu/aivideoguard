#!/usr/bin/env node
/**
 * Ucundan uca gorunur demo + dogrulama.
 *
 *   GEMINI_API_KEY=... node test/e2e/demo.mjs     # GERCEK Gemini (varsayilan)
 *   node test/e2e/demo.mjs --mock                 # sahte API, ag gerekmez
 *   node test/e2e/demo.mjs --headless             # ekransiz, yalniz dogrulama
 *   node test/e2e/demo.mjs --no-embed             # gomu kotasi tukendiyse: yalniz LLM katmani
 *
 * Uretim manifesti hic degistirilmez: gercek youtube.com adresine gidilir ve
 * istek Playwright tarafindan karsilanir. Boylece icerik betigi gercek
 * eslesme kuraliyla enjekte olur.
 */

import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { VIDEOS, fixtureHtml, TINY_JPEG } from './fixture.js';
import { startMockServer } from './mockApi.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Sahte kipte test paketi kullanilir: KOD AYNI, manifest'e yalnizca
// yerel uc nokta izni eklenmistir (Playwright service worker isteklerini
// yakalayamadigi icin ag katmaninda degil, uc nokta ayariyla yonlendiriyoruz).
// VARSAYILAN GERCEK MODEL.
//
// Sahte sunucu aninda ve kusursuz yanit verir; gercek model yavas, siraya
// girer ve bazen beklenmedik sey doner. Varsayilan olarak sahteyi kosmak,
// yalnizca gercek modelde ortaya cikan hatalari (zaman asimi, tutum yanilgisi)
// gormeden "gecti" demeye yol aciyordu. Sahte sunucu artik yalnizca `--mock`
// ile, ag olmadan hizli yineleme icin.
const MOCK = process.argv.includes('--mock');
const LIVE = !MOCK;
const EXT = resolve(ROOT, LIVE ? 'dist/chrome' : 'dist/chrome-test');

const HEADLESS = process.argv.includes('--headless');
// Gomu kotasi tukendiginde bile baglamsal katman olculebilsin diye
const NO_EMBED = process.argv.includes('--no-embed');
const SLOW = HEADLESS ? 0 : 380;

const APIKEY = LIVE ? process.env.GEMINI_API_KEY : 'TEST-SAHTE-ANAHTAR';
if (LIVE && !APIKEY) {
  console.error(
    'GEMINI_API_KEY ortam degiskeni gerekir.\n' +
      'Ag olmadan sahte sunucuyla kosmak icin: node test/e2e/demo.mjs --mock',
  );
  process.exit(2);
}

import { CRITERIA } from './criteria.js';

const SETTINGS = {
  criteriaText: CRITERIA,
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
  // Kosum sonunda capa gomulerini diske alan kanca (kural uretildiginde kurulur)
  let saveAnchorsAfterRun = null;
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
  await opt.fill('#criteriaText', SETTINGS.criteriaText);
  await opt.locator('.adv summary').first().click();       // kanal listeleri
  await opt.fill('#channelBlock', SETTINGS.channelBlock);
  await opt.fill('#channelAllow', SETTINGS.channelAllow);
  await opt.check('#debug');                                // katman izlerini gorunur kil

  // Gomu kotasi ayri bir havuzdan gelir ve LLM kotasindan cok once tukenir.
  // `--no-embed` anlamsal katmani kapatip her karti dogrudan baglamsal
  // katmana gonderir: aday eleme olcumu kaybolur ama TUTUM ve ODAK olcumu
  // gomu kotasi olmadan da yapilabilir.
  if (NO_EMBED) {
    await opt.uncheck('#useSemantic');
    await opt.selectOption('#visionScope', 'all');
    log('      --no-embed: anlamsal katman kapali, her kart baglamsal katmana gidiyor');
  }
  if (!LIVE) {
    await opt.locator('.adv summary').last().click();       // uc nokta
    await opt.fill('#apiEndpoint', mock.endpoint);
  }
  await opt.waitForTimeout(900); // debounce'lu kaydetme

  /* --------------------------------------------------------------- */
  // Kural uretimi PAHALI ama sonucu SABIT. Her kosumda yeniden uretmek bosuna
  // token harcamak olurdu; bir kere uretilip diske yazilir, sonraki kosumlar
  // dogrudan onu yukler. Yeniden uretmek icin dosyayi sil.
  // Sahte ve gercek modelin urettigi kurallar AYRI dosyada tutulur: sahte
  // kosumda uretilen kurallari gercek kosumda kullanmak, olcumu tamamen
  // gecersiz kilardi.
  const RULES_FILE = resolve(ROOT, LIVE ? 'test/e2e/rules.live.json' : 'test/e2e/rules.mock.json');
  const saved = await readFile(RULES_FILE, 'utf8').then(JSON.parse).catch(() => null);

  if (saved?.rules?.length) {
    step('1b', `Kurallar diskten yuklendi (${saved.rules.length} kural, LLM cagrisi YOK)`);
    await opt.evaluate(async ([rules, anchors]) => {
      const api = globalThis.browser || globalThis.chrome;
      await api.storage.sync.set({ 'rules:v1': rules });
      await api.storage.local.set({ 'rules:v1': rules });
      // Capa gomuleri de geri yuklenir. Her kosum sifir profille acildigi icin
      // aksi halde 124 capa BASTAN gomuluyor ve gunluk gomu kotasi (1000)
      // birkac kosumda tukeniyordu — olcum yapmak imkansiz hale geliyordu.
      if (anchors) await api.storage.local.set({ 'cache:anchors:v1': anchors });
    }, [saved.rules, saved.anchors || null]);
    if (saved.anchors) log(`      capa gomuleri de geri yuklendi (gomu cagrisi YOK)`);
    await opt.reload({ waitUntil: 'domcontentloaded' });
    await opt.waitForTimeout(700);
  } else {
  step('1b', 'Kurallar uretiliyor — LLM capalari kendisi turetiyor');
  await banner(opt, 'ADIM 1b — Kural uretimi',
    'Kullanici duz cumle yaziyor; kisaltmalari, jargonu ve tutum politikasini sistem turetiyor.');
  await opt.click('#buildRules');
  // Gercek modelde 14 olcut icin capa uretimi uzun surer; kisa zaman asimi
  // basarisizligi HATA gibi gosterir, oysa sadece beklemek gerekiyordu.
  await opt
    .waitForSelector('#rulesProposal:not([hidden])', { timeout: 120000 })
    .catch(async (err) => {
      // Sayfanin kendi hata metni tek gercek tani kaynagi — Playwright'in
      // zaman asimi mesaji sebebi soylemez.
      const status = await opt.textContent('#rulesStatus').catch(() => '');
      throw new Error(`kural uretimi basarisiz — sayfadaki durum: "${status}" (${err.message})`);
    });
  const proposed = await opt.locator('#proposalBody .rule').count();
  log(`      ${proposed} kural onerildi`);

  // ONAY: oneri kullanici onaylamadan kaydedilmez. Testin bu adimi atlamasi,
  // onay akisinin kirilmasini gorunmez kilardi.
  await opt.click('#acceptRules');
  // `state: 'hidden'` sart: varsayilan 'visible' beklentisi gizlenen ogeyi
  // asla saglayamaz ve test bosuna zaman asimina duser.
  await opt.waitForSelector('#rulesProposal', { state: 'hidden', timeout: 10000 });
  await opt.waitForTimeout(800);
  const savedRules = await opt.locator('#rulesList .rule').count();
  log(`      ${savedRules} kural kaydedildi`);

  // Diske yaz — bir daha uretilmesin.
  const produced = await opt.evaluate(async () => {
    const api = globalThis.browser || globalThis.chrome;
    const r = await api.storage.local.get('rules:v1');
    return r['rules:v1'] || [];
  });
  await writeFile(RULES_FILE, JSON.stringify({ version: 1, rules: produced }, null, 2));
  log(`      kurallar diske yazildi: ${RULES_FILE.split('/').pop()}`);
  }

  // Capa gomuleri kural kadar pahali: 100 capa + 24 arka plan = 124 gomu.
  // Kosum sonunda diske alinir ki sonraki kosum hic gommesin.
  saveAnchorsAfterRun = async () => {
    const bundle = await opt.evaluate(async () => {
      const api = globalThis.browser || globalThis.chrome;
      const r = await api.storage.local.get('cache:anchors:v1');
      return r['cache:anchors:v1'] || null;
    });
    if (!bundle) return;
    const cur = await readFile(RULES_FILE, 'utf8').then(JSON.parse).catch(() => ({ rules: [] }));
    await writeFile(RULES_FILE, JSON.stringify({ ...cur, anchors: bundle }, null, 2));
    log(`  capa gomuleri diske alindi — sonraki kosum gomu cagrisi yapmayacak`);
  };

  /* --------------------------------------------------------------- */
  step(2, 'Kalibrasyon paneli — hangi katmanin karar verdigi gorulüyor');
  await banner(opt, 'ADIM 2 — Kalibrasyon',
    'Tek bir başlık deneniyor. Skor ve karar veren katman görünür; önbelleğe yazılmaz.');
  await opt.fill('#probeTitle', 'LCK finalinde inanılmaz geri dönüş');
  await opt.fill('#probeChannel', 'Espor Arena');
  await opt.click('#probeBtn');
  await opt.waitForSelector('#probeOut dl', { timeout: 240000 });
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
    // "pending yok" YETMEZ: bekci zaman asiminda karti temizler, kart da
    // pending olmaktan cikar. O an olcum yaparsak karar gelmeden "gecti"
    // sanariz. Gercek kosul: HER kart bir karara baglanmis olmali.
    () => {
      const cards = document.querySelectorAll('ytd-rich-item-renderer');
      if (cards.length === 0) return false;
      return [...cards].every(
        (c) => c.getAttribute('data-aivg') === 'blocked' || c.hasAttribute('data-aivg-decided'),
      );
    },
    null,
    { timeout: 180000 },
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

  // Karar hattinin HAM ciktisi. Kart uzerindeki isaretler hata metnini
  // tasimaz (gecen kartta iz birakilmaz), dolayisiyla "neden error-policy"
  // sorusu ekrandan cevaplanamaz. Arka plana dogrudan soruyoruz.
  const raw = await opt.evaluate(async (items) => {
    const api = globalThis.browser || globalThis.chrome;
    return api.runtime.sendMessage({ type: 'evaluate', items });
  }, VIDEOS.map((v) => ({ videoId: v.id, title: v.title, channel: v.channel })));

  // Ayarlarin GERCEKTEN kaydedildigini depodan dogrula. Form doldurmak kanit
  // degil: kart "—" gosterdiginde sebep API hatasi mi yoksa bos ayar mi,
  // ancak bu okuma ayirt eder.
  const stored = await opt.evaluate(async () => {
    const api = globalThis.browser || globalThis.chrome;
    const [loc, syn] = await Promise.all([
      api.storage.local.get(['settings:v1', 'secret:v1', 'rules:v1']),
      api.storage.sync.get('rules:v1').catch(() => ({})),
    ]);
    const s = loc['settings:v1'] || {};
    const rules = syn['rules:v1'] || loc['rules:v1'] || [];
    return {
      channelBlock: s.channelBlock || '(BOS)',
      channelAllow: s.channelAllow || '(BOS)',
      enabled: s.enabled,
      hasKey: Boolean(loc['secret:v1']?.apiKey),
      ruleCount: rules.length,
      anchorCount: rules.reduce((n, r) => n + (r.anchors || []).length, 0),
      patternRules: rules.filter((r) => r.stanceSensitive === false).length,
    };
  });
  log(`\n  depodaki ayarlar:`);
  log(`    kanal kara/beyaz : ${stored.channelBlock} / ${stored.channelAllow}`);
  log(`    anahtar / etkin  : ${stored.hasKey ? 'var' : 'YOK'} / ${stored.enabled}`);
  log(`    kural / capa     : ${stored.ruleCount} kural, ${stored.anchorCount} capa`);
  log(`    kalip yetkili    : ${stored.patternRules} kural (tutum-duyarsiz)`);

  const errors = [...new Set((raw || []).map((r) => r?.error).filter(Boolean))];
  if (errors.length) {
    log(`\n  \x1b[31mkarar hatti hatalari:\x1b[0m`);
    for (const e of errors.slice(0, 5)) log(`    ${e.slice(0, 220)}`);
  }
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
  // Onbellekten gelen kararlar gerekcesini korumali. Aksi halde ikinci
  // goruntulemede kart "Gizlendi" der ama nedenini soyleyemez.
  await yt.waitForFunction(
    () => document.querySelectorAll('[data-aivg="pending"]').length === 0,
    null,
    { timeout: 120000 },
  ).catch(() => {});
  const cachedLabels = await yt.evaluate(() =>
    [...document.querySelectorAll('[data-aivg="blocked"]')].map((c) => ({
      layer: c.getAttribute('data-aivg-layer'),
      label: c.getAttribute('data-aivg-label') || '',
    })),
  );
  const reasonless = cachedLabels.filter((c) => c.label.split('\n').length < 2);
  log(`      onbellekten gelen ${cachedLabels.length} karttan ` +
      `${cachedLabels.length - reasonless.length} tanesi gerekcesini koruyor ` +
      (reasonless.length === 0 ? '\x1b[32m(tamam)\x1b[0m' : '\x1b[31m(eksik)\x1b[0m'));

  let cacheOk = reasonless.length === 0;
  if (mock) {
    const newEmbeds = mock.counters.embed - before.embed;
    const newLlm = mock.counters.text + mock.counters.vision - before.text - before.vision;
    cacheOk = cacheOk && newEmbeds + newLlm === 0;
    log(`      yenileme sonrasi ek cagri: ${newEmbeds} gomu, ${newLlm} LLM ` +
        (cacheOk ? '\x1b[32m(onbellek calisiyor)\x1b[0m' : '\x1b[33m(onbellek atlanmis)\x1b[0m'));
  }

  await saveAnchorsAfterRun?.();

  await mkdir(resolve(ROOT, 'test/e2e/out'), { recursive: true });
  await yt.screenshot({ path: resolve(ROOT, 'test/e2e/out/akis.png'), fullPage: true, timeout: 60000 });
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
  if (!cacheOk) {
    log('\n\x1b[31monbellek dogrulamasi basarisiz\x1b[0m');
    process.exitCode = 1;
  }
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
