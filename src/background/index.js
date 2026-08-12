/**
 * Arka plan giris noktasi — mesaj yonlendirici.
 *
 * MV3'te arka plan her an uykuya alinabilir. Bu yuzden hicbir kalici durum
 * bellekte tutulmaz; her uyanista storage'dan okunur.
 */

import browser from 'webextension-polyfill';
import { evaluateSafe, evaluateAll } from './pipeline.js';
import { getSettings } from '../shared/storage.js';
import { listModels } from './net.js';
import { getStats, clearVerdicts, clearChannels, getChannelProfile } from './cache.js';
import { expandCriteria, auditRules, reviseRule } from './curator.js';
import { normalize } from '../shared/text.js';

/** Ayni video icin es zamanli istekleri tek degerlendirmede birleştirir. */
const inflight = new Map();

/**
 * Bir partiyi TOPLU degerlendirir.
 *
 * Video basina LLM cagrisi olceklenmiyordu: gercek akista tek kaydirmada 60+
 * kart var ve ucretsiz kademede istekler siraya giriyor (olculdu: 14 es
 * zamanli istek ~50 sn). `evaluateAll` ucuz katmanlari video basina kosar,
 * baglamsal katmani ise gruplar halinde tek istemde sorar.
 *
 * Ayni video icin ucusan istek varsa ona baglanilir — YouTube ayni karti
 * kaydirma sirasinda birden fazla kez gorunur alana sokabiliyor.
 */
async function handleEvaluate(items) {
  const settings = await getSettings();

  const keyOf = (item) => item.videoId || `${item.title}|${item.channel}`;
  const fresh = [];
  const freshIdx = [];
  const out = new Array(items.length);

  items.forEach((item, i) => {
    const k = keyOf(item);
    if (inflight.has(k)) out[i] = inflight.get(k);
    else {
      freshIdx.push(i);
      fresh.push(item);
    }
  });

  if (fresh.length > 0) {
    const batch = evaluateAll(fresh, settings);
    fresh.forEach((item, j) => {
      const p = batch.then((rs) => rs[j]);
      const k = keyOf(item);
      inflight.set(k, p);
      p.finally(() => inflight.delete(k));
      out[freshIdx[j]] = p;
    });
  }

  return Promise.all(out);
}

browser.runtime.onMessage.addListener((msg) => {
  // Firefox ve Chrome'da polyfill ile Promise donduren tek imza gecerlidir.
  switch (msg?.type) {
    case 'evaluate':
      return handleEvaluate(msg.items || []);

    case 'probe':
      // Kalibrasyon: onbellege/istatistige yazmadan tek bir ornegi degerlendirir
      return getSettings().then((s) =>
        evaluateSafe({ videoId: null, surface: 'kalibrasyon', ...msg.item }, s, { dryRun: true }),
      );

    case 'getStats':
      return getStats();

    case 'listModels':
      return getSettings().then((s) => listModels(msg.apiKey, s));

    case 'clearCache':
      return Promise.all([clearVerdicts(), clearChannels()]).then(() => ({ ok: true }));

    case 'getChannelProfile':
      return getChannelProfile(normalize(msg.channel));

    // --- Kural yazan katman ------------------------------------------
    // Bu uclarin hicbiri KAYDETMEZ. Oneri uretirler; kaydetme karari
    // ayarlar sayfasindaki onay akisina aittir.
    case 'buildRules':
      return getSettings().then((s) => expandCriteria(msg.descriptions || [], s));

    case 'auditRules':
      return getSettings().then((s) => auditRules(msg.rules || [], s));

    case 'reviseRule':
      return getSettings().then((s) => reviseRule(msg.rule, msg.feedback, s));

    default:
      return undefined;
  }
});

browser.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') browser.runtime.openOptionsPage?.().catch(() => {});
});
