/**
 * ANLAMSAL katman.
 *
 * Kullanicinin konusu ve capalari birer vektore donuşur; video metni de vektore
 * donuşur; kosinus benzerligi olculur. Kelime eşleşmesi YOKTUR — "Erdogan" capasi,
 * icinde o kelime hic gecmeyen ama anlamca yakin bir basligi da yakalayabilir.
 *
 * Maliyet: gomu cagrilari toplu (batch) yapilir. 40 videonun basligi tek istekte
 * gomulur, boylece kaydirma sirasinda istek sayisi ~40 kat duşer.
 */

import { MODELS, EMBED_DIM } from '../shared/config.js';
import { l2normalize } from '../shared/vector.js';
import { parseList } from '../shared/text.js';
import { callGemini } from './net.js';
import { getAnchorBundle, putAnchorBundle } from './cache.js';

const BATCH_SIZE = 40;
const BATCH_WAIT_MS = 120;

/**
 * Capa ve video metnine uygulanan ORTAK sablon.
 *
 * Tek kelimelik bir capanin ("spoiler") ciplak gomusu, tam cumlelik bir video
 * basligiyla ayni uzayda zayif kalir. Ayni kalibi iki tarafa da uygulayarak
 * bu yanliligi dengeliyoruz — sablonun kendisi iki vektorde de ayni yonde
 * katki yaptigi icin karsilastirmada sadelesir.
 */
export function anchorTemplate(t) {
  return `${t} konulu video`;
}

/** Bekleyen gomu istekleri — mikro-toplama kuyrugu. */
let pending = [];
let batchTimer = null;

/**
 * Metinleri gomer. Ayni anda cagrilan istekler otomatik olarak tek
 * batchEmbedContents cagrisinda birleşir.
 */
export function embed(text, settings, taskType = 'SEMANTIC_SIMILARITY') {
  return new Promise((resolve, reject) => {
    pending.push({ text, taskType, resolve, reject, settings });
    if (pending.length >= BATCH_SIZE) {
      flushBatch();
    } else if (!batchTimer) {
      batchTimer = setTimeout(flushBatch, BATCH_WAIT_MS);
    }
  });
}

async function flushBatch() {
  clearTimeout(batchTimer);
  batchTimer = null;
  const batch = pending.splice(0, BATCH_SIZE);
  if (batch.length === 0) return;
  // Kuyrukta kalan varsa yeni tur planla
  if (pending.length > 0 && !batchTimer) batchTimer = setTimeout(flushBatch, BATCH_WAIT_MS);

  const settings = batch[0].settings;
  const model = settings.modelEmbedding || MODELS.embedding;

  try {
    const json = await callGemini(
      model,
      'batchEmbedContents',
      {
        requests: batch.map((b) => ({
          model: `models/${model}`,
          content: { parts: [{ text: b.text }] },
          taskType: b.taskType,
          outputDimensionality: EMBED_DIM,
        })),
      },
      settings,
    );

    const embeddings = json.embeddings || [];
    if (embeddings.length !== batch.length) {
      throw new Error(`Gomu sayisi uyuşmuyor: ${embeddings.length} != ${batch.length}`);
    }
    batch.forEach((b, i) => {
      const values = embeddings[i]?.values;
      if (!Array.isArray(values) || values.length === 0) {
        b.reject(new Error('Bos gomu dondu'));
        return;
      }
      b.resolve(l2normalize(values));
    });
  } catch (err) {
    batch.forEach((b) => b.reject(err));
  }
}

/**
 * Konu + capalar icin vektorleri hazirlar. Ayarlar degişmedikce
 * yeniden hesaplanmaz (onbellekten okunur).
 */
// Ayni anda degerlendirilen onlarca kart ayni capa kumesini ister.
// Bu koruma olmadan her kart capalari bastan gomdururdu.
let anchorsInflight = null;
let anchorsInflightHash = null;

export function getAnchors(settings, hash) {
  if (anchorsInflight && anchorsInflightHash === hash) return anchorsInflight;
  anchorsInflightHash = hash;
  anchorsInflight = computeAnchors(settings, hash).finally(() => {
    anchorsInflight = null;
    anchorsInflightHash = null;
  });
  return anchorsInflight;
}

async function computeAnchors(settings, hash) {
  const cached = await getAnchorBundle(hash);
  if (cached) return cached;

  const topic = (settings.topic || '').trim();
  const anchorTexts = parseList(settings.anchors);

  if (!topic && anchorTexts.length === 0) {
    const empty = { h: hash, topicVec: null, anchors: [] };
    await putAnchorBundle(hash, null, []);
    return empty;
  }

  // Capa metnine konu metnini ENJEKTE ETME.
  //
  // Onceki surum her capayi "(kullanicinin kacinmak istedigi konu: ...)" ekiyle
  // gomuyordu. Bu, tum capa vektorlerini ayni konu metninin etrafinda toplayip
  // birbirlerinden ayirt edilemez hale getiriyordu — capa basina ayri bir anlam
  // merkezi tutmanin butun amaci kayboluyordu.
  //
  // Ciplak kelimenin zayif gomusu sorunu, iki tarafa AYNI sablonu uygulayarak
  // simetrik cozulur: capa da video metni de "<metin> konulu video" kalibinda
  // gomulur, ortak bias iki tarafta sadelesir.
  const [topicVec, ...anchorVecs] = await Promise.all([
    topic ? embed(topic, settings) : Promise.resolve(null),
    ...anchorTexts.map((t) => embed(anchorTemplate(t), settings)),
  ]);

  const anchors = anchorTexts.map((text, i) => ({ text, vec: anchorVecs[i] }));
  await putAnchorBundle(hash, topicVec, anchors);
  return { h: hash, topicVec, anchors };
}
