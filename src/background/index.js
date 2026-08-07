/**
 * Arka plan giris noktasi — mesaj yonlendirici.
 *
 * MV3'te arka plan her an uykuya alinabilir. Bu yuzden hicbir kalici durum
 * bellekte tutulmaz; her uyanista storage'dan okunur.
 */

import browser from 'webextension-polyfill';
import { evaluateSafe } from './pipeline.js';
import { getSettings } from '../shared/storage.js';
import { listModels } from './net.js';
import { getStats, clearVerdicts, clearChannels, getChannelProfile } from './cache.js';
import { normalize } from '../shared/text.js';

/** Ayni video icin es zamanli istekleri tek degerlendirmede birleştirir. */
const inflight = new Map();

async function handleEvaluate(items) {
  const settings = await getSettings();
  return Promise.all(
    items.map((item) => {
      const key = item.videoId || `${item.title}|${item.channel}`;
      if (inflight.has(key)) return inflight.get(key);
      const p = evaluateSafe(item, settings).finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    }),
  );
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

    default:
      return undefined;
  }
});

browser.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') browser.runtime.openOptionsPage?.().catch(() => {});
});
