import browser from 'webextension-polyfill';
import { DEFAULTS } from './config.js';
import { DEFAULT_RULES } from './default-rules.js';

export { configHash } from './scoring.js';

const SETTINGS_KEY = 'settings:v1';

/**
 * API anahtari AYRI bir depolama anahtarinda tutulur.
 *
 * Sebep: storage.onChanged olayi degisen anahtarin TUM degerini dinleyicilere
 * yayinlar. Anahtar ayarlarla ayni nesnede olsaydi, her ayar degisiminde
 * acik YouTube sekmelerindeki icerik betiklerine de gonderilirdi. Icerik
 * betiginin API anahtarina hicbir zaman ihtiyaci yok.
 */
const SECRET_KEY = 'secret:v1';

/**
 * Kurallar AYRI ve SENKRON depoda tutulur.
 *
 * Sebep: kural uretimi LLM cagrisi maliyetindedir ama sonucu SABITTIR.
 * Kullanici ayni hesabi baska bir makinede actiginda kurallarin yeniden
 * uretilmesi bosuna token harcamak olur — uretilen sey zaten ayni.
 * `storage.sync` tarayici hesabiyla tasindigi icin ikinci makinede tek bir
 * cagri bile yapilmaz.
 *
 * Not: sync kotasi kucuktur (~100 KB). Kural kumesi buyurse yerel depoya
 * dusulur; islevsellik kaybolmaz, yalnizca tasinmaz.
 */
const RULES_KEY = 'rules:v1';

function syncArea() {
  // Bazi kurulumlarda (ozel pencere, kurumsal politika) sync yoktur.
  return browser.storage.sync || browser.storage.local;
}

async function readRules() {
  try {
    const res = await syncArea().get(RULES_KEY);
    if (Array.isArray(res?.[RULES_KEY])) return res[RULES_KEY];
  } catch {
    /* sync okunamadi — yerele dus */
  }
  const local = await browser.storage.local.get(RULES_KEY);
  if (Array.isArray(local?.[RULES_KEY])) return local[RULES_KEY];

  // Hic kayit yoksa VARSAYILAN set. Kullanici eklentiyi kurar kurmaz calisan
  // bir filtre bulur; tek bir LLM cagrisi bile yapilmaz. Kullanici bu seti
  // sonradan duzenler, o andan itibaren kendi kaydi gecerlidir.
  //
  // Bos dizi DE gecerli bir kayittir (kullanici tum kurallari silmis
  // olabilir); bu yuzden "kayit var mi" kontrolu Array.isArray ile yapilir,
  // uzunlukla degil. Aksi halde silinen kurallar her acilista geri gelirdi.
  return DEFAULT_RULES;
}

async function writeRules(rules) {
  // Once senkron depo denenir; kota asilirsa yerele yazilir ki kullanici
  // kurallarini KAYBETMESIN. Sessizce basarisiz olmak en kotusu olurdu.
  try {
    await syncArea().set({ [RULES_KEY]: rules });
    await browser.storage.local.set({ [RULES_KEY]: rules });
    return { synced: true };
  } catch (err) {
    await browser.storage.local.set({ [RULES_KEY]: rules });
    return { synced: false, error: String(err?.message || err) };
  }
}

/** Arka plan ve ayarlar sayfasi icin tam ayar kumesi (anahtar dahil). */
export async function getSettings() {
  const [res, rules] = await Promise.all([
    browser.storage.local.get([SETTINGS_KEY, SECRET_KEY]),
    readRules(),
  ]);
  return {
    ...DEFAULTS,
    ...(res[SETTINGS_KEY] || {}),
    rules,
    apiKey: res[SECRET_KEY]?.apiKey || '',
  };
}

export async function setSettings(patch) {
  const { apiKey, rules, ...rest } = patch;
  const writes = {};

  if (Object.keys(rest).length > 0) {
    const res = await browser.storage.local.get(SETTINGS_KEY);
    const current = { ...DEFAULTS, ...(res[SETTINGS_KEY] || {}) };
    delete current.apiKey;
    delete current.rules;
    writes[SETTINGS_KEY] = { ...current, ...rest };
  }
  if (apiKey !== undefined) writes[SECRET_KEY] = { apiKey };

  if (Object.keys(writes).length > 0) await browser.storage.local.set(writes);
  // Kurallar ayri depoda: uretimi pahali, sonucu sabit, tasinabilir olmali.
  if (rules !== undefined) await writeRules(rules);
  return getSettings();
}

/** Kurallari disa aktarilabilir JSON olarak verir. */
export async function exportRules() {
  return { version: 1, rules: await readRules() };
}

/** Disaridan gelen kural kumesini yazar — tek LLM cagrisi yapilmadan. */
export async function importRules(payload) {
  const rules = Array.isArray(payload) ? payload : payload?.rules;
  if (!Array.isArray(rules)) throw new Error('Gecersiz kural dosyasi');
  await writeRules(rules);
  return rules;
}

/**
 * Icerik betiginin gordugu tek sey. Anahtar, konu, capalar, listeler —
 * hicbiri sayfa baglamina inmez.
 */
export async function getContentSettings() {
  const res = await browser.storage.local.get(SETTINGS_KEY);
  const s = { ...DEFAULTS, ...(res[SETTINGS_KEY] || {}) };
  return { onError: s.onError, debug: s.debug, enabled: s.enabled };
}

/** Yalnizca ayar anahtarindaki degisimleri bildirir; degeri TASIMAZ. */
export function onSettingsChanged(cb) {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SETTINGS_KEY]) cb();
  });
}
