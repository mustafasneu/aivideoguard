import browser from 'webextension-polyfill';
import { DEFAULTS } from './config.js';

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

/** Arka plan ve ayarlar sayfasi icin tam ayar kumesi (anahtar dahil). */
export async function getSettings() {
  const res = await browser.storage.local.get([SETTINGS_KEY, SECRET_KEY]);
  return {
    ...DEFAULTS,
    ...(res[SETTINGS_KEY] || {}),
    apiKey: res[SECRET_KEY]?.apiKey || '',
  };
}

export async function setSettings(patch) {
  const { apiKey, ...rest } = patch;
  const writes = {};

  if (Object.keys(rest).length > 0) {
    const res = await browser.storage.local.get(SETTINGS_KEY);
    const current = { ...DEFAULTS, ...(res[SETTINGS_KEY] || {}) };
    delete current.apiKey;
    writes[SETTINGS_KEY] = { ...current, ...rest };
  }
  if (apiKey !== undefined) writes[SECRET_KEY] = { apiKey };

  if (Object.keys(writes).length > 0) await browser.storage.local.set(writes);
  return getSettings();
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
