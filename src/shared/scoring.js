/** Saf hesaplama — tarayici API'sine bagimli degil, dogrudan test edilebilir. */

import { CACHE_RELEVANT_KEYS, EMBED_RELEVANT_KEYS } from './config.js';

// FNV-1a 32-bit — kriptografik degil, yalnizca degisiklik tespiti
function fnv(material) {
  let h = 0x811c9dc5;
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function fingerprint(settings, keys) {
  return fnv(keys.map((k) => `${k}=${settings[k]}`).join('|'));
}

/**
 * Karar parmak izi. Kullanici konuyu/capalari/esikleri/modelleri
 * degistirdiginde onbellekteki eski kararlar gecersiz olmali.
 */
export function configHash(settings) {
  return fingerprint(settings, CACHE_RELEVANT_KEYS);
}

/**
 * Capa gomuleri icin AYRI parmak izi.
 *
 * Yalnizca esik degistiginde capalari yeniden gomdurmek gereksiz maliyet;
 * ama gomu modeli degistiginde capalar MUTLAKA yeniden hesaplanmali.
 */
export function embedHash(settings) {
  return fingerprint(settings, EMBED_RELEVANT_KEYS);
}

/**
 * Kanal itibarinin anlamsal skora katkisi — BAGLAM sinyali.
 *
 * Kanal hafizasi tek basina engelleme yetkisi vermez; skora en fazla
 * `channelMemoryBoost` kadar eklenir. Aksi halde bir kez yanlis engellenen
 * kanal kendi istatistigini besleyip kacinilmaz sekilde tamamen engellenirdi.
 */
export function channelBoost(profile, settings) {
  if (!settings.useChannelMemory || !profile) return 0;
  if (!profile.n || profile.n < settings.channelMemoryMinSamples) return 0;
  const ratio = profile.blocked / profile.n;
  if (ratio < settings.channelMemoryBlockRatio) return 0;
  const span = 1 - settings.channelMemoryBlockRatio;
  const t = span > 0 ? (ratio - settings.channelMemoryBlockRatio) / span : 1;
  return settings.channelMemoryBoost * t;
}

/**
 * Anlamsal skoru esiklere gore banda ayirir.
 * 'block' | 'allow' | 'ask'  — 'ask' baglamsal katmanlara devreder.
 */
export function band(score, settings) {
  if (score >= settings.tBlock) return 'block';
  if (score < settings.tAsk) return 'allow';
  return 'ask';
}
