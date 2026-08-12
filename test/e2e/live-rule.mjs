#!/usr/bin/env node
/**
 * EKRAN TESTI — kullanici kural ekleyince filtre aninda devreye giriyor mu?
 *
 *   node test/e2e/live-rule.mjs            # gorunur pencere
 *   node test/e2e/live-rule.mjs --headless
 *   node test/e2e/live-rule.mjs --tek=diyet --ifade="gaming setup"   # kosumu tekrarla
 *
 * Senaryo, gercek kullanimin birebir taklidi:
 *   1. Anahtarsiz kurulum. Secilen kelimeleri iceren basliklar akista GORUNUR.
 *   2. Kullanici ayarlardan yeni kural ekler, kalibina o kelimeyi yazar.
 *   3. Sayfa YENILENMEDEN o kartlarin gizlendigi dogrulanir.
 *
 * KELIME NEDEN RASTGELE: sabit tek kelimeyle kosan bir test, o kelimeye ozel
 * bir sey mi calisiyor yoksa mekanizma mi calisiyor ayirt edemez. Havuzdan her
 * kosumda baska bir kelime secilir; secim ekrana yazilir ki basarisiz bir kosum
 * `--tek` / `--ifade` ile birebir tekrar uretilebilsin.
 *
 * IKI TUR AYRI AYRI SINANIR — ayni yoldan gecmezler:
 *   · tek kelime      -> kalip tek bir sozcuk sinirinda eslesir
 *   · cok kelimeli    -> ifadenin yalnizca iki ucuna sinir aranir (wordMatches)
 *
 * Her adimda ekran goruntusu alinir: iddia degil, goruntu.
 */

import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fixtureHtml, TINY_JPEG } from './fixture.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXT = resolve(ROOT, 'dist/chrome');
const HEADLESS = process.argv.includes('--headless');
const OUT = resolve(ROOT, 'test/e2e/out');

/**
 * KELIME HAVUZU.
 *
 * Havuzdaki hicbir kelime varsayilan 14 kuralin kalip ve capalarinda GECMEZ.
 * Gecseydi kart daha ilk adimda gizli olurdu ve "kural ekleyince gizlendi"
 * iddiasini olcmek imkansizlasirdi — test kendi kendini kandirirdi.
 *
 * Kelimeler ASCII yazilir: dogrulama basliktaki duz alt-dize uzerinden
 * yapiliyor, aksan katlamasi (deburr) burada ayrica sinanmiyor.
 */
const TEK_KELIMELER = ['fenerbahce', 'besiktas', 'kripto', 'tarot', 'diyet', 'drift'];
const COK_KELIMELILER = ['kripto para borsasi', 'reaction video', 'gaming setup', 'vlog gunlugu'];

const log = (m) => console.log(m);
const step = (n, m) => console.log(`\n\x1b[36m[${n}]\x1b[0m ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ekran goruntusu TANI aracidir, dogrulama degil. Alinamamasi testi
// dusurmemeli: olculen sey kartlarin gizlenip gizlenmedigi, goruntunun
// diske yazilabilmesi degil.
const rastgele = (liste) => liste[Math.floor(Math.random() * liste.length)];
const arg = (ad) => {
  const p = process.argv.find((a) => a.startsWith(`--${ad}=`));
  return p ? p.slice(ad.length + 3).trim().toLowerCase() : null;
};

/**
 * Kosumun kelimelerini secer.
 *
 * TEK KELIME IFADENIN ICINDE GECMEMELI: "kripto" kurali eklendiginde
 * "kripto para borsasi" kartlari da kelime sinirindan eslesir ve iki sinama
 * birbirine karisir — ifade kartinin neden gizlendigi belirsiz kalir.
 */
function secKelimeler() {
  const tek = arg('tek') || rastgele(TEK_KELIMELER);
  const havuz = COK_KELIMELILER.filter((i) => !i.split(/\s+/).includes(tek));
  return { tek, ifade: arg('ifade') || rastgele(havuz) };
}

/** Secilen kelime icin fikstüre eklenecek kartlar. */
function kartlar(kelime, onek) {
  const bas = kelime.charAt(0).toUpperCase() + kelime.slice(1);
  return [
    { id: `${onek}1`, title: `${bas} hakkinda merak edilenler`, channel: 'Deneme Arsivi' },
    { id: `${onek}2`, title: `Yeni baslayanlar icin ${kelime} anlatimi`, channel: 'Rastgele Deneme' },
  ];
}

/**
 * Ekran goruntusu — once sekme one alinir.
 *
 * OLCULDU: `fullPage` goruntu, sayfa on plandaki sekme DEGILSE hic donmuyor.
 * Ayni sayfada olcum: viewport goruntusu 1.6 sn, fullPage 20 sn'de zaman
 * asimi, `bringToFront()` sonrasi ayni fullPage 0.36 sn. Sebep tarayicinin
 * arka plan sekmesinde viewport disini olusturmamasi; Playwright bekledigi
 * kareyi hic alamiyor.
 *
 * Yeni sekme kendiliginden one gelmedigi icin bu, testin kendi hatasiydi:
 * eklenti calisiyordu, goruntu alinamiyordu.
 */
const cek = async (page, ad) => {
  await page.bringToFront();
  await page.screenshot({ path: resolve(OUT, ad), fullPage: true, timeout: 90000 });
};

/** Ekranda o an kac kart gizli, hangileri? */
const OKU = () => {
  const out = { gizli: [], gorunur: [] };
  for (const c of document.querySelectorAll('ytd-rich-item-renderer')) {
    const t = c.querySelector('#video-title')?.textContent?.trim();
    if (!t) continue;
    (c.getAttribute('data-aivg') === 'blocked' ? out.gizli : out.gorunur).push(t);
  }
  return out;
};

/**
 * Bir kelimenin kartlarindan kaci gizli/gorunur?
 *
 * Alt-dize taramasi yerine BASLIK KIMLIGI kullanilir: kartlari biz urettik,
 * hangi basligin hangi kelimeye ait oldugunu biliyoruz. Alt-dize taransaydi
 * sabit fikstürdeki bir baslik tesadufen eslesip sayimi bozabilirdi.
 */
const ayir = (durum, kartListesi) => {
  const basliklar = kartListesi.map((k) => k.title);
  return {
    gizli: durum.gizli.filter((t) => basliklar.includes(t)),
    gorunur: durum.gorunur.filter((t) => basliklar.includes(t)),
  };
};

async function main() {
  const { tek, ifade } = secKelimeler();
  const tekKartlar = kartlar(tek, 'rndtek0000');
  const ifadeKartlar = kartlar(ifade, 'rndcok0000');
  const ekKartlar = [...tekKartlar, ...ifadeKartlar];

  const profile = await mkdtemp(resolve(tmpdir(), 'aivg-live-'));
  await mkdir(OUT, { recursive: true });

  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    viewport: null,
    serviceWorkers: 'allow',
    args: [
      ...(HEADLESS ? ['--headless=new'] : []),
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--window-size=1360,940',
    ],
  });

  await ctx.route('**://*.youtube.com/**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: fixtureHtml(undefined, ekKartlar),
    }),
  );
  await ctx.route('**://*.ytimg.com/**', (r) =>
    r.fulfill({ status: 200, contentType: 'image/jpeg', body: TINY_JPEG }),
  );

  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 30000 });
  const extId = new URL(sw.url()).host;

  log(`\n\x1b[1mEKRAN TESTI — canli kural ekleme\x1b[0m`);
  log(`  eklenti      : ${EXT}`);
  log(`  kip          : ANAHTARSIZ (API cagrisi yok)`);
  log(`  tek kelime   : "${tek}"`);
  log(`  cok kelimeli : "${ifade}"`);
  log(`  tekrar icin  : node test/e2e/live-rule.mjs --tek=${tek} --ifade="${ifade}"\n`);
  for (const k of ekKartlar) log(`      + kart: ${k.title}`);

  /**
   * Ayarlar sayfasindan tek bir kural ekler ve DEPODAN dogrular.
   *
   * Arayuz "kaydedildi" demis olabilir; depoya bakmadan buna guvenmek testin
   * en sik yaptigi hatadir.
   */
  async function kuralEkle(opt, kelime, ad) {
    await opt.click('#addRule');
    await opt.waitForSelector('dialog.rule-editor');

    // Duzenleyicideki alanlar: ad, kapsam, capalar, kaliplar, ...
    const alanlar = opt.locator('dialog.rule-editor .field');
    await alanlar.nth(0).locator('input').fill(ad);
    await alanlar.nth(1).locator('textarea').fill(`${kelime} ile ilgili icerikler`);
    await alanlar.nth(3).locator('textarea').fill(kelime); // kaliplar

    const png = resolve(OUT, `canli-kural-${kelime.replace(/\s+/g, '-')}.png`);
    await opt.screenshot({ path: png, fullPage: true, timeout: 90000 }).catch((e) => log(`      (ekran goruntusu alinamadi: ${e.message.split('\n')[0]})`));

    await opt.getByRole('button', { name: 'Kaydet' }).click();
    await opt.waitForSelector('dialog.rule-editor', { state: 'detached', timeout: 10000 });
    await sleep(1500);

    const kayit = await opt.evaluate(async (k) => {
      const api = globalThis.browser || globalThis.chrome;
      const loc = await api.storage.local.get('rules:v1');
      const syn = await api.storage.sync.get('rules:v1').catch(() => ({}));
      const rules = syn['rules:v1'] || loc['rules:v1'] || [];
      const yeni = rules.filter((r) => (r.patterns || []).some((p) => p.toLowerCase() === k));
      return { toplam: rules.length, yeni: yeni.map((r) => ({ label: r.label, patterns: r.patterns })) };
    }, kelime);

    log(`      depodaki kural sayisi : ${kayit.toplam}`);
    log(`      "${kelime}" kurali    : ${JSON.stringify(kayit.yeni)}`);
    return { png, kayitli: kayit.yeni.length > 0 };
  }

  /* --------------------------------------------------------------- */
  step(1, 'Akis aciliyor — hicbir kural eklenmeden once');
  const yt = await ctx.newPage();
  await yt.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
  await sleep(2500);

  const once = await yt.evaluate(OKU);
  const tekOnce = ayir(once, tekKartlar);
  const ifadeOnce = ayir(once, ifadeKartlar);
  log(`      gizli: ${once.gizli.length} kart, gorunur: ${once.gorunur.length} kart`);
  log(`      "${tek}" karti gorunur   : ${tekOnce.gorunur.length}/${tekKartlar.length}`);
  log(`      "${ifade}" karti gorunur : ${ifadeOnce.gorunur.length}/${ifadeKartlar.length}`);
  await yt.screenshot({ path: resolve(OUT, 'canli-1-once.png'), fullPage: true, timeout: 90000 }).catch((e) => log(`      (ekran goruntusu alinamadi: ${e.message.split('\n')[0]})`));

  /* --------------------------------------------------------------- */
  step(2, `Kullanici TEK KELIMELIK kural ekliyor: "${tek}"`);
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${extId}/popup/options.html`, { waitUntil: 'domcontentloaded' });
  await opt.waitForSelector('#addRule');
  const tekKayit = await kuralEkle(opt, tek, `Deneme — ${tek}`);

  /* --------------------------------------------------------------- */
  step(3, 'Akisa donuluyor — SAYFA YENILENMEDEN');
  await yt.bringToFront();
  await sleep(3000);

  const araa = await yt.evaluate(OKU);
  const tekSonra = ayir(araa, tekKartlar);
  const ifadeAra = ayir(araa, ifadeKartlar);
  await yt.screenshot({ path: resolve(OUT, 'canli-2-tek-sonra.png'), fullPage: true, timeout: 90000 }).catch((e) => log(`      (ekran goruntusu alinamadi: ${e.message.split('\n')[0]})`));

  log(`      "${tek}" karti GIZLI     : ${tekSonra.gizli.length}/${tekKartlar.length}`);
  for (const t of tekSonra.gizli) log(`        · ${t}`);
  // Ifade kartlari HENUZ kuralsiz: bu adimda gizlenmeleri, kaliplarin
  // birbirine tasti anlamina gelir.
  log(`      "${ifade}" karti hala gorunur: ${ifadeAra.gorunur.length}/${ifadeKartlar.length}`);

  // Yan etki: yeni kural yalnizca kendi kapsamini yakalamali
  const yanEtkiTek = araa.gizli.length - once.gizli.length - tekSonra.gizli.length;
  log(`      yan etki (baska kartlar) : ${yanEtkiTek}`);

  /* --------------------------------------------------------------- */
  step(4, `Kullanici COK KELIMELI kural ekliyor: "${ifade}"`);
  await opt.bringToFront();
  const ifadeKayit = await kuralEkle(opt, ifade, `Deneme — ${ifade}`);

  /* --------------------------------------------------------------- */
  step(5, 'Akisa yeniden donuluyor — yine SAYFA YENILENMEDEN');
  await yt.bringToFront();
  await sleep(3000);

  const son = await yt.evaluate(OKU);
  const ifadeSonra = ayir(son, ifadeKartlar);
  const tekHala = ayir(son, tekKartlar);
  await yt.screenshot({ path: resolve(OUT, 'canli-3-ifade-sonra.png'), fullPage: true, timeout: 90000 }).catch((e) => log(`      (ekran goruntusu alinamadi: ${e.message.split('\n')[0]})`));

  log(`      "${ifade}" karti GIZLI   : ${ifadeSonra.gizli.length}/${ifadeKartlar.length}`);
  for (const t of ifadeSonra.gizli) log(`        · ${t}`);
  log(`      "${tek}" karti hala gizli : ${tekHala.gizli.length}/${tekKartlar.length}`);

  const yanEtkiIfade = son.gizli.length - araa.gizli.length - ifadeSonra.gizli.length;
  log(`      yan etki (baska kartlar) : ${yanEtkiIfade}`);

  /* --------------------------------------------------------------- */
  step(6, 'Sonuc');
  const kontroller = [
    ['kural oncesi kartlar gorunur', tekOnce.gorunur.length === tekKartlar.length && ifadeOnce.gorunur.length === ifadeKartlar.length],
    [`"${tek}" kurali depoya yazildi`, tekKayit.kayitli],
    [`"${tek}" kartlari gizlendi`, tekSonra.gizli.length === tekKartlar.length],
    [`"${ifade}" kartlari o asamada etkilenmedi`, ifadeAra.gorunur.length === ifadeKartlar.length],
    ['tek kelime kuralinin yan etkisi yok', yanEtkiTek === 0],
    [`"${ifade}" kurali depoya yazildi`, ifadeKayit.kayitli],
    [`"${ifade}" kartlari gizlendi`, ifadeSonra.gizli.length === ifadeKartlar.length],
    [`"${tek}" kartlari gizli kaldi`, tekHala.gizli.length === tekKartlar.length],
    ['cok kelimeli kuralin yan etkisi yok', yanEtkiIfade === 0],
  ];
  for (const [ad, gecti] of kontroller) {
    log(`  ${gecti ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${ad}`);
  }

  const ok = kontroller.every(([, gecti]) => gecti);
  log(
    ok
      ? '\n\x1b[32m  Iki kural da eklendigi anda, sayfa yenilenmeden devreye girdi.\x1b[0m'
      : '\n\x1b[31m  Kural aninda devreye GIRMEDI.\x1b[0m',
  );
  log(`\n  bu kosumun kelimeleri: "${tek}" · "${ifade}"`);
  log(`  tekrarlamak icin: node test/e2e/live-rule.mjs --tek=${tek} --ifade="${ifade}"`);
  log(`  ekran goruntuleri: test/e2e/out/canli-1-once.png · canli-2-tek-sonra.png · canli-3-ifade-sonra.png`);
  log(`                    ${tekKayit.png}`);
  log(`                    ${ifadeKayit.png}\n`);

  if (!HEADLESS) await sleep(8000);
  await ctx.close();
  await rm(profile, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('\n\x1b[31mEkran testi basarisiz:\x1b[0m', e.message);
  process.exit(1);
});
