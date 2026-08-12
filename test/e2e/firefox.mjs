#!/usr/bin/env node
/**
 * Firefox ucundan uca kosum.
 *
 *   node test/e2e/firefox.mjs                # gorunur pencere, sahte API
 *   node test/e2e/firefox.mjs --headless
 *   node test/e2e/firefox.mjs --no-grant     # host izinleri VERILMEDEN baslat
 *   GEMINI_API_KEY=... node test/e2e/firefox.mjs --live
 *
 * NE KANITLAR — Chrome kosumunun kanitlayamadiklari:
 *   · Firefox MV3 `background.scripts` olay sayfasi (Chrome'da service worker)
 *   · webextension-polyfill uzerinden browser.* API'lerinin Gecko'da calismasi
 *   · Firefox MV3 host izinleri akisi (`shared/permissions.js`, bulgu 13)
 *   · Icerik betiginin gercek youtube.com kaynaginda enjekte olmasi
 *
 * Uretim manifestinin content_scripts bolumune dokunulmaz: fikstur, yerel
 * vekil uzerinden gercek `www.youtube.com` adresinde sunulur. Firefox paketi
 * yalnizca sahte API ucu icin `http://127.0.0.1/*` izniyle ayrilir — Chrome
 * tarafindaki `chrome-test` ile ayni sapma.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { VIDEOS } from './fixture.js';
import { startMockServer } from './mockApi.js';
import { startFixtureProxy } from './proxy.mjs';
import { startGeckodriver, Session } from './webdriver.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MOCK = process.argv.includes("--mock");
const LIVE = !MOCK;
const HEADLESS = process.argv.includes('--headless');
const NO_GRANT = process.argv.includes('--no-grant');
const EXT = resolve(ROOT, LIVE ? "dist/firefox" : "dist/firefox-test");

const ADDON_ID = 'aivideoguard@mustafaseker.dev';
const UUID = randomUUID();

const APIKEY = LIVE ? process.env.GEMINI_API_KEY : 'TEST-SAHTE-ANAHTAR';
if (LIVE && !APIKEY) {
  console.error('GEMINI_API_KEY gerekir. Sahte sunucu icin: --mock');
  process.exit(2);
}

import { CRITERIA } from './criteria.js';

const SETTINGS = {
  criteriaText: CRITERIA,
  channelBlock: 'Engelli Kanal',
  channelAllow: 'Güvenli Kanal',
};

const log = (m) => console.log(m);
const step = (n, m) => console.log(`\n\x1b[36m[${n}]\x1b[0m ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ayarlar sayfasina gecer.
 *
 * Marionette icerik bagliminda `moz-extension://` adresine DOGRUDAN gezinmeyi
 * reddeder ("not allowed in this context"). Iki mesru yol var:
 *   1) Eklenti kurulumda ayarlar sekmesini kendi acar (onInstalled) — devral.
 *   2) Acmadiysa tarayici (chrome) bagliminda sistem yetkisiyle sekme ac.
 */
async function openOptionsPage(session, optUrl) {
  const findHandle = async () => {
    for (const h of await session.windowHandles()) {
      await session.switchToWindow(h);
      if ((await session.url()).startsWith('moz-extension://')) return h;
    }
    return null;
  };

  // 1) Eklentinin kendi actigi sekme
  for (let i = 0; i < 12; i++) {
    if (await findHandle()) return 'onInstalled';
    await sleep(500);
  }

  // 2) Chrome bagliminda sistem yetkisiyle ac
  await session.setContext('chrome');
  try {
    await session.execute(
      `const url = arguments[0];
       const win = Services.wm.getMostRecentWindow('navigator:browser');
       win.gBrowser.selectedTab = win.gBrowser.addTab(url, {
         triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
       });
       return true;`,
      [optUrl],
    );
  } finally {
    await session.setContext('content');
  }

  for (let i = 0; i < 20; i++) {
    if (await findHandle()) return 'chrome-context';
    await sleep(400);
  }
  throw new Error('ayarlar sayfasi acilamadi');
}

/** Sayfadaki alani doldurup options.js'in dinledigi olayi uretir. */
const FILL = `
  const [id, value] = arguments;
  const el = document.getElementById(id);
  if (!el) throw new Error('alan yok: ' + id);
  if (el.type === 'checkbox') {
    if (el.checked !== value) { el.checked = value; el.dispatchEvent(new Event('change', {bubbles:true})); }
  } else {
    el.value = value;
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
  }
  return true;
`;

async function main() {
  await access(resolve(EXT, 'manifest.json')).catch(() => {
    throw new Error(`${EXT} bulunamadi — once: node scripts/build.mjs --test`);
  });

  const mock = LIVE ? null : await startMockServer();
  const proxy = await startFixtureProxy();
  const driver = await startGeckodriver();

  log(`\n\x1b[1mAI Video Guard — Firefox ucundan uca\x1b[0m`);
  log(`  kip      : ${LIVE ? 'GERCEK Gemini API' : `sahte API — ${mock.endpoint}`}`);
  log(`  pencere  : ${HEADLESS ? 'gizli' : 'gorunur'}`);
  log(`  eklenti  : ${EXT}`);
  log(`  vekil    : 127.0.0.1:${proxy.port} (youtube.com + ytimg.com)`);
  log(`  izinler  : ${NO_GRANT ? 'VERILMEDEN baslatiliyor (banner sinaniyor)' : 'kurulumda verilecek'}`);

  const prefs = {
    // Eklentinin ic adresini sabitle: Firefox her profilde rastgele UUID
    // uretir, sabitlemezsek options sayfasinin adresini bilemeyiz.
    'extensions.webextensions.uuids': JSON.stringify({ [ADDON_ID]: UUID }),
    'xpinstall.signatures.required': false,

    // MV3 host izinleri: Firefox bunlari kurulumda verir (grantByDefault).
    // --no-grant ile kapatip banner yolunu sinariz.
    'extensions.originControls.grantByDefault': !NO_GRANT,

    // Fikstur vekili — duz HTTP. HTTPS'e yukseltmeyi kapatmazsak youtube.com
    // HSTS on-yukleme listesinde oldugu icin istek TLS'e cikar ve vekil
    // karsilayamaz.
    'network.proxy.type': 1,
    'network.proxy.http': '127.0.0.1',
    'network.proxy.http_port': proxy.port,
    'network.proxy.ssl': '127.0.0.1',
    'network.proxy.ssl_port': proxy.port,
    // HTTPS asagi cekilmiyor: vekil kendi sertifikasiyla TLS sonlandiriyor,
    // oturum acceptInsecureCerts ile acildigi icin Firefox kabul ediyor.
    // Boylece uretimdeki gercek https://www.youtube.com kaynagi sinaniyor.

    // Tarayicinin kendi arka plan trafigi vekile dusup sayaclari kirletmesin
    'network.captive-portal-service.enabled': false,
    'network.connectivity-service.enabled': false,
    'browser.safebrowsing.malware.enabled': false,
    'browser.safebrowsing.phishing.enabled': false,
    'browser.safebrowsing.downloads.enabled': false,
    'extensions.update.enabled': false,
    'app.update.enabled': false,
    'toolkit.telemetry.enabled': false,
    'datareporting.policy.dataSubmissionEnabled': false,
    'app.shield.optoutstudies.enabled': false,
    'browser.startup.page': 0,
    'browser.startup.homepage': 'about:blank',
    'browser.shell.checkDefaultBrowser': false,
  };

  const session = await Session.create(driver.base, {
    alwaysMatch: {
      browserName: 'firefox',
      'moz:firefoxOptions': {
        args: HEADLESS ? ['-headless'] : [],
        prefs,
      },
      // Vekil duz HTTP konusuyor; sertifika uyarisi cikarsa da takilmasin
      acceptInsecureCerts: true,
      pageLoadStrategy: 'eager',
    },
  });

  let exitCode = 0;
  try {
    await session.setTimeouts({ script: 30000, pageLoad: 30000, implicit: 0 });

    /* --------------------------------------------------------------- */
    step(1, 'Eklenti gecici olarak kuruluyor');
    const installedId = await session.installAddon(EXT, true);
    log(`      kurulan eklenti: ${installedId}`);
    // Olay sayfasinin baslamasi ve options sayfasinin kayit olmasi icin an ver
    await sleep(1500);

    const optUrl = `moz-extension://${UUID}/popup/options.html`;
    const how = await openOptionsPage(session, optUrl);
    await session.waitFor(
      async () => session.execute('return !!document.getElementById("criteriaText")'),
      { label: 'ayarlar sayfasi yuklendi' },
    );
    log(`      ayarlar sayfasi acildi (${how})`);

    /* --------------------------------------------------------------- */
    step(2, 'Firefox MV3 host izinleri denetleniyor (bulgu 13)');
    // permissions.contains dogrudan sorulur — banner'in dogru sey soyleyip
    // soylemedigini bagimsiz bir olcumle karsilastirmak icin.
    const permState = await session.executeAsync(
      `const done = arguments[arguments.length - 1];
       browser.permissions.contains({origins: [
         '*://*.youtube.com/*', '*://*.ytimg.com/*',
         'https://generativelanguage.googleapis.com/*']})
         .then(has => done({has, banner: !document.getElementById('permWarning').hidden}))
         .catch(e => done({error: String(e)}));`,
    );

    if (permState.error) throw new Error(`izin sorgusu basarisiz: ${permState.error}`);
    log(`      permissions.contains  : ${permState.has ? 'verilmis' : 'VERILMEMIS'}`);
    log(`      uyari banneri gorunur : ${permState.banner ? 'evet' : 'hayir'}`);

    // Bulgu 13'un tam iddiasi: izin eksikse kullanici bunu GOREBILMELI.
    const bannerCorrect = permState.has !== permState.banner;
    log(
      `      banner izin durumuyla tutarli: ` +
        (bannerCorrect ? '\x1b[32mevet\x1b[0m' : '\x1b[31mHAYIR\x1b[0m'),
    );
    if (!bannerCorrect) exitCode = 1;

    if (NO_GRANT) {
      log('\n      --no-grant kipi: izinler verilmedigi icin karar hatti kosulmayacak.');
      log('      Bu kosumun amaci yalnizca banner tespitini dogrulamak.');
      await session.quit();
      await driver.stop();
      await mock?.close();
      await proxy.close();
      process.exit(exitCode);
    }

    if (!permState.has) {
      throw new Error(
        'host izinleri verilmemis — karar hatti kosturulamaz. ' +
          'Firefox surumu grantByDefault desteklemiyor olabilir.',
      );
    }

    /* --------------------------------------------------------------- */
    step(3, 'Filtre olculeri giriliyor');
    await session.execute(FILL, ['apiKey', APIKEY]);
    await session.execute(FILL, ['criteriaText', SETTINGS.criteriaText]);
    await session.execute(FILL, ['channelBlock', SETTINGS.channelBlock]);
    await session.execute(FILL, ['channelAllow', SETTINGS.channelAllow]);
    await session.execute(FILL, ['debug', true]);
    // Sahte sunucunun kotasi yoktur; hiz sinirlayici yalnizca testi yavaslatir.
    if (MOCK) await session.execute(FILL, ['maxRequestsPerMinute', '6000']);
    if (!LIVE) await session.execute(FILL, ['apiEndpoint', mock.endpoint]);
    await sleep(1200); // debounce'lu kaydetme

    /* --------------------------------------------------------------- */
    step('3b', 'Kurallar uretiliyor — LLM capalari kendisi turetiyor');
    await session.execute('document.getElementById("buildRules").click(); return true;');
    await session.waitFor(
      async () => session.execute('return !document.getElementById("rulesProposal").hidden'),
      { timeout: 25000, label: 'kural onerisi geldi' },
    );
    const proposed = await session.execute('return document.querySelectorAll("#proposalBody .rule").length');
    log(`      ${proposed} kural onerildi`);

    // ONAY akisi: oneri onaylanmadan kaydedilmez.
    await session.execute('document.getElementById("acceptRules").click(); return true;');
    await session.waitFor(
      async () => session.execute('return document.getElementById("rulesProposal").hidden'),
      { timeout: 15000, label: 'kurallar kaydedildi' },
    );

    // Ayarlarin gercekten yazildigini depodan dogrula — form doldurmak
    // tek basina kanit degil.
    const stored = await session.executeAsync(
      // Kurallar AYRI ve senkron depoda durur (`rules:v1`), ayarlarin icinde
      // degil. Yanlis anahtardan okumak "0 kural" gosterip testi bosuna
      // dusuruyordu — kartlar dogru filtrelendigi halde.
      `const done = arguments[arguments.length - 1];
       Promise.all([
         browser.storage.local.get(['secret:v1','rules:v1']),
         browser.storage.sync.get('rules:v1').catch(() => ({})),
       ]).then(([loc, syn]) => {
         const rules = syn['rules:v1'] || loc['rules:v1'] || [];
         done({
           ruleCount: rules.length,
           anchorCount: rules.reduce((n, x) => n + (x.anchors||[]).length, 0),
           hasKey: Boolean(loc['secret:v1']?.apiKey),
         });
       }).catch(e => done({error: String(e)}));`,
    );
    log(`      depoya yazilan kural  : ${stored.ruleCount} kural, ${stored.anchorCount} capa`);
    log(`      anahtar ayri depoda   : ${stored.hasKey ? 'evet' : 'HAYIR'}`);
    if (!stored.ruleCount || !stored.hasKey) {
      log('      \x1b[31mayarlar depoya yazilmadi\x1b[0m');
      exitCode = 1;
    }

    /* --------------------------------------------------------------- */
    step(4, 'Kalibrasyon paneli — arka plan olay sayfasi ile mesajlasma');
    await session.execute(FILL, ['probeTitle', 'LCK finalinde inanılmaz geri dönüş']);
    await session.execute(FILL, ['probeChannel', 'Espor Arena']);
    await session.execute('document.getElementById("probeBtn").click(); return true;');
    const probeText = await session.waitFor(
      async () => {
        const t = await session.execute(
          'const o = document.getElementById("probeOut");' +
            'return (!o.hidden && o.querySelector("dl")) ? o.textContent : null;',
        );
        return t;
      },
      { timeout: 180000, label: 'kalibrasyon sonucu' },
    );
    log(`      ${probeText.replace(/\s+/g, ' ').trim().slice(0, 120)}`);

    /* --------------------------------------------------------------- */
    step(5, 'Gercek youtube.com kaynaginda akis filtreleniyor');
    await session.newTab();
    await session.go('https://www.youtube.com/');

    // Kartlar yalnizca gorus alanina yaklastiginda degerlendirilir
    // (IntersectionObserver). Pencere kucukse alttaki kartlar HIC islenmez ve
    // test onlari "gecti" sanir. Once sona kaydir, sonra dogrula.
    await session.execute('window.scrollTo(0, document.body.scrollHeight); return true;');
    await sleep(1200);
    await session.execute('window.scrollTo(0, 0); return true;');

    await session.waitFor(
      async () =>
        session.execute(
          'return document.querySelectorAll(\'[data-aivg="pending"]\').length === 0 && ' +
            "document.querySelectorAll('ytd-rich-item-renderer').length > 0;",
        ),
      { timeout: 40000, label: 'tum kartlar karara baglandi' },
    ).catch(() => log('      \x1b[33muyari: bazi kartlar pending kaldi\x1b[0m'));
    await sleep(1000);

    // Hic degerlendirilmemis kart kalmamali — "islenmedi" sessizce "gecti"
    // gibi gorunur ve testi yaniltir.
    const untouched = await session.execute(
      "return [...document.querySelectorAll('ytd-rich-item-renderer')]" +
        ".filter(c => !c.hasAttribute('data-aivg') && !c.hasAttribute('data-aivg-decided')).length;",
    );
    if (untouched > 0) {
      log(`      \x1b[31m${untouched} kart hic degerlendirilmedi\x1b[0m`);
      exitCode = 1;
    }

    /* --------------------------------------------------------------- */
    step(6, 'Sonuclar dogrulaniyor');
    const actual = await session.execute(`
      const out = {};
      for (const card of document.querySelectorAll('ytd-rich-item-renderer')) {
        const href = card.querySelector('a[href*="v="]')?.getAttribute('href') || '';
        const id = href.match(/v=([\\w-]+)/)?.[1];
        if (!id) continue;
        out[id] = {
          state: card.getAttribute('data-aivg') || 'none',
          layer: card.getAttribute('data-aivg-layer') || card.getAttribute('data-aivg-decided') || '',
          label: card.getAttribute('data-aivg-label') || '',
        };
      }
      return out;
    `);

    let pass = 0;
    log('');
    log('  ' + 'sonuc'.padEnd(7) + 'beklenen'.padEnd(10) + 'katman'.padEnd(16) + 'baslik');
    log('  ' + '─'.repeat(94));
    for (const v of VIDEOS) {
      const a = actual[v.id] || { state: 'none', layer: '' };
      const got = a.state === 'blocked' ? 'block' : 'allow';
      const ok = got === v.expect;
      if (ok) pass++;
      log(
        (ok ? '\x1b[32m  ✓\x1b[0m  ' : '\x1b[31m  ✗\x1b[0m  ') +
          got.padEnd(9) +
          v.expect.padEnd(10) +
          (a.layer || '—').padEnd(16) +
          v.title.slice(0, 44),
      );
      if (!ok) log(`        beklenti gerekcesi: ${v.why}`);
    }
    log('');
    log(`  \x1b[1m${pass}/${VIDEOS.length}\x1b[0m kart beklendigi gibi`);
    if (mock) {
      log(
        `  API cagrilari: ${mock.counters.embed} toplu gomu (${mock.counters.embedTexts} metin), ` +
          `${mock.counters.text} metin LLM, ${mock.counters.vision} gorsel LLM`,
      );
    }
    log(
      `  vekil: ${proxy.counters.page} sayfa, ${proxy.counters.image} gorsel, ` +
        `${proxy.counters.other} karsilanmayan istek, ${proxy.counters.connect} CONNECT`,
    );
    const unhandled = proxy.unhandledHosts();
    if (unhandled.length) {
      log(`  karsilanmayan adresler: ${unhandled.map(([h, n]) => `${h}×${n}`).join(', ').slice(0, 160)}`);
    }
    // Kucuk resimler fiksturde https:// — vekil TLS konusmuyor, dolayisiyla
    // gorsel katman bu kosumda HIC uyarilmaz. Sessizce gecmesin.
    if (proxy.counters.image === 0) {
      log(
        '  \x1b[33mnot: kucuk resimler yuklenmedi (https vekilden gecmiyor) — ' +
          'gorsel katman bu kosumda kapsanmiyor\x1b[0m',
      );
    }
    if (pass !== VIDEOS.length) exitCode = 1;

    /* --------------------------------------------------------------- */
    step(7, 'Onbellek dogrulamasi — sayfa yenileniyor');
    const before = mock ? { ...mock.counters } : null;
    await session.go('https://www.youtube.com/');
    await session
      .waitFor(
        async () =>
          session.execute(
            'return document.querySelectorAll(\'[data-aivg="pending"]\').length === 0 && ' +
              "document.querySelectorAll('ytd-rich-item-renderer').length > 0;",
          ),
        { timeout: 25000, label: 'yenileme sonrasi kararlar' },
      )
      .catch(() => {});
    await sleep(800);

    const cached = await session.execute(`
      return [...document.querySelectorAll('[data-aivg="blocked"]')].map(c => ({
        layer: c.getAttribute('data-aivg-layer'),
        label: c.getAttribute('data-aivg-label') || '',
      }));
    `);
    const reasonless = cached.filter((c) => c.label.split('\n').length < 2);
    log(
      `      onbellekten gelen ${cached.length} karttan ${cached.length - reasonless.length} tanesi ` +
        `gerekcesini koruyor ` +
        (reasonless.length === 0 ? '\x1b[32m(tamam)\x1b[0m' : '\x1b[31m(eksik)\x1b[0m'),
    );
    if (reasonless.length > 0) exitCode = 1;

    if (mock) {
      const newEmbeds = mock.counters.embed - before.embed;
      const newLlm = mock.counters.text + mock.counters.vision - before.text - before.vision;
      const cacheOk = newEmbeds + newLlm === 0;
      log(
        `      yenileme sonrasi ek cagri: ${newEmbeds} gomu, ${newLlm} LLM ` +
          (cacheOk ? '\x1b[32m(onbellek calisiyor)\x1b[0m' : '\x1b[33m(onbellek atlanmis)\x1b[0m'),
      );
      if (!cacheOk) exitCode = 1;
    }

    /* --------------------------------------------------------------- */
    await mkdir(resolve(ROOT, 'test/e2e/out'), { recursive: true });
    const shot = await session.screenshotBase64();
    await writeFile(resolve(ROOT, 'test/e2e/out/firefox-akis.png'), Buffer.from(shot, 'base64'));
    log(`\n  ekran goruntusu: test/e2e/out/firefox-akis.png`);

    if (!HEADLESS) await sleep(6000);
  } catch (err) {
    log(`\n\x1b[31mFirefox kosumu basarisiz:\x1b[0m ${err.message}`);
    if (driver.log.length) log(driver.log.join('').slice(-1500));
    exitCode = 1;
  } finally {
    await session?.quit().catch(() => {});
    driver.stop();
    await mock?.close();
    await proxy.close();
  }

  log(
    exitCode === 0
      ? '\n\x1b[32mFirefox tarafi beklendigi gibi calisti.\x1b[0m\n'
      : '\n\x1b[31mFirefox kosumunda basarisiz adim var.\x1b[0m\n',
  );
  process.exit(exitCode);
}

main().catch((e) => {
  console.error('\n\x1b[31mBeklenmeyen hata:\x1b[0m', e);
  process.exit(1);
});
