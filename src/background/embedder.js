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

import { MODELS, EMBED_DIM, BACKGROUND_TEXTS } from '../shared/config.js';
import { l2normalize, centroid } from '../shared/vector.js';
import { anchorTemplate } from '../shared/text.js';
import { normalizeRules, allAnchors } from '../shared/rules.js';
import { callGemini } from './net.js';
import { getAnchorBundle, putAnchorBundle } from './cache.js';

// Sablon `shared/text.js` icinde durur: kalibrasyon araci (Node) tarayici
// API'lerine bagli bu modulu yukleyemez, ama AYNI kalibi kullanmak zorundadir.
export { anchorTemplate };

const BATCH_SIZE = 40;
const BATCH_WAIT_MS = 120;

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

  // Capalar artik tek bir havuzdan degil, KURALLARDAN gelir. Her capa hangi
  // kurala ait oldugunu tasir; anlamsal katman bu sayede "hangi olcut
  // tetiklendi" bilgisini LLM'e devredebiliyor.
  const entries = allAnchors(normalizeRules(settings.rules));

  if (entries.length === 0) {
    const empty = { h: hash, topicVec: null, anchors: [], bg: null };
    await putAnchorBundle(hash, null, [], null);
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
  // Arka plan kulliyati da AYNI toplu istekte gomulur: ayri cagri yapmak
  // gereksiz gecikme olurdu, mikro-toplama kuyrugu zaten birlestirir.
  const vecs = await Promise.all([
    ...entries.map((e) => embed(anchorTemplate(e.text), settings)),
    ...BACKGROUND_TEXTS.map((t) => embed(t, settings)),
  ]);

  const anchorVecs = vecs.slice(0, entries.length);
  const bgVecs = vecs.slice(entries.length);

  const bg = centroid(bgVecs);
  const anchors = entries.map((e, i) => ({ text: e.text, ruleId: e.ruleId, vec: anchorVecs[i] }));

  await putAnchorBundle(hash, null, anchors, bg);
  return { h: hash, topicVec: null, anchors, bg };
}
