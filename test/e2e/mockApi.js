/**
 * Sahte Gemini API.
 *
 * NE KANITLAR: butun karar hattinin ucundan ucuna calistigini — katman sirasi,
 * toplu gomu, onbellek, kanal hafizasi, hata politikasi, DOM davranisi.
 *
 * NE KANITLAMAZ: Gemini'nin anlamsal kalitesini. Buradaki gomu deterministik bir
 * kavram-uzayi esleme; gercek modelin ayirt ediciligini temsil etmez. Anlamsal
 * kalite ancak gercek anahtarla `--live` kipinde olculur.
 */

import { EMBED_DIM } from '../../src/shared/config.js';

/**
 * Kucuk bir kavram uzayi. Her metin, icerdigi kavramlara gore bir vektore
 * yerlestirilir. Kelime ORTAKLIGI aranmaz — metin kavramla eslesirse yakin olur.
 * Boylece "koalisyon görüşmeleri" ile "siyaset" arasinda ortak kelime olmadan
 * yuksek benzerlik uretilebilir; gercek gomunun yaptigi is budur.
 */
const CONCEPTS = {
  siyaset: [
    'meclis', 'butce', 'koalisyon', 'kulis', 'secim', 'parti', 'milletvekili',
    'genel kurul', 'siyaset', 'ankara', 'duzenleme', 'gundem',
  ],
  yemek: ['corba', 'mercimek', 'tarif', 'mutfak', 'yemek', 'pisir'],
  yazilim: ['rust', 'ownership', 'kod', 'yazilim', 'programlama'],
  gezi: ['kayak', 'erciyes', 'sezon', 'gezi', 'rota', 'tatil'],
  dizi: ['spoiler', 'dizi', 'bolum', 'sezon finali'],
};

const CONCEPT_KEYS = Object.keys(CONCEPTS);

function fold(s) {
  return (s || '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g');
}

/** Metni kavram uzayinda konumlandirir, sonra EMBED_DIM'e yayar. */
export function fakeEmbed(text) {
  const t = fold(text);
  const coords = CONCEPT_KEYS.map((k) => {
    let hits = 0;
    for (const term of CONCEPTS[k]) if (t.includes(fold(term))) hits++;
    return hits;
  });

  // Hic kavram yakalanmadiysa metne ozgu zayif bir gurultu ver —
  // her bilinmeyen metin ayni vektore duserse yanlis eslesme olur
  if (coords.every((c) => c === 0)) {
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    coords[h % coords.length] = 0.25;
  }

  const vec = new Array(EMBED_DIM).fill(0);
  coords.forEach((c, i) => {
    // Her kavram, boyut uzayinda ayrik bir bloga yazilir
    const start = Math.floor((i * EMBED_DIM) / CONCEPT_KEYS.length);
    const end = Math.floor(((i + 1) * EMBED_DIM) / CONCEPT_KEYS.length);
    for (let d = start; d < end; d++) vec[d] = c;
  });

  const norm = Math.hypot(...vec) || 1;
  return vec.map((v) => v / norm);
}

/** LLM karari: kavram ortusmesine bakar, deterministik. */
export function fakeJudge(promptText) {
  const t = fold(promptText);
  // Istem icinde hem konu hem baslik var; siyaset kavramindan kac terim geciyor?
  let hits = 0;
  for (const term of CONCEPTS.siyaset) if (t.includes(fold(term))) hits++;
  const related = hits >= 3;
  return {
    related,
    confidence: related ? 0.88 : 0.82,
    reason: related ? 'siyasi gundem icerigi' : 'konuyla ilgisiz',
  };
}

/**
 * Yerel sahte Gemini sunucusu.
 *
 * Playwright'in context.route()'u service worker'dan cikan istekleri
 * yakalamiyor; bu yuzden ag katmaninda degil, eklentinin `apiEndpoint`
 * ayariyla buraya yonlendiriyoruz. Eklentinin KENDI kodu degismez.
 */
import { createServer } from 'node:http';

export async function startMockServer() {
  const counters = { embed: 0, embedTexts: 0, text: 0, vision: 0, models: 0, imageBytes: 0 };

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = req.url || '';
      const send = (obj, status = 200) => {
        const body = JSON.stringify(obj);
        res.writeHead(status, {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
        });
        res.end(body);
      };

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'POST,GET,OPTIONS',
        });
        return res.end();
      }

      if (url.startsWith('/v1beta/models?') || url === '/v1beta/models') {
        counters.models++;
        return send({
          models: [
            { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
            { name: 'models/gemini-flash-lite-latest', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] },
          ],
        });
      }

      let post = {};
      try { post = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { /* bos */ }

      if (url.includes(':batchEmbedContents')) {
        counters.embed++;
        const reqs = post.requests || [];
        counters.embedTexts += reqs.length;
        return send({
          embeddings: reqs.map((r) => ({ values: fakeEmbed(r.content?.parts?.[0]?.text || '') })),
        });
      }

      if (url.includes(':generateContent')) {
        const parts = post.contents?.[0]?.parts || [];
        const img = parts.find((p) => p.inline_data || p.inlineData);
        if (img) {
          counters.vision++;
          counters.imageBytes += (img.inline_data || img.inlineData)?.data?.length || 0;
        } else {
          counters.text++;
        }
        const promptText = parts.map((p) => p.text || '').join(' ');
        return send({
          candidates: [{ content: { parts: [{ text: JSON.stringify(fakeJudge(promptText)) }] } }],
        });
      }

      return send({ error: { message: `bilinmeyen yol: ${url}` } }, 404);
    });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  return {
    counters,
    endpoint: `http://127.0.0.1:${port}/v1beta`,
    close: () => new Promise((r) => server.close(r)),
  };
}
