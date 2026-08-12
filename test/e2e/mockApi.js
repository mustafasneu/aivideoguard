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
  oyun: [
    'lck', 'msi', 'worlds', 'jungle', 'rift', 'adc', 'valorant', 'ajan',
    'league of legends', 'lol', 'sampiyon', 'espor', 'solo queue',
  ],
  magazin: ['unlu', 'magazin', 'ayrilik', 'iddia', 'kulis', 'dedikodu'],
  yem: ['inanamadi', 'gorenler', 'boyle yansidi', 'kameraya', 'viral', 'sok'],
  siddet: ['dehset', 'kavga', 'saldiri', 'siddet', 'sokak ortasinda'],
  din: ['din', 'inanan', 'kutsal', 'dalga gecen', 'dinler tarihi'],
  notr: ['corba', 'mercimek', 'mutfak', 'rust', 'ownership', 'kod', 'desk', 'budget'],
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

/** Istemden video basligini ve kanalini ceker. */
function readVideo(promptText) {
  const title = promptText.match(/- Baslik: (.*)/)?.[1] || '';
  const channel = promptText.match(/- Kanal: (.*)/)?.[1] || '';
  return { title, channel };
}

/**
 * Istemdeki kural bloklarini ayristirir:
 *   [r1] Etiket: aciklama
 *        ilgili kavramlar: capa1, capa2, ...
 *
 * CAPA SATIRI SART: kurali yalnizca aciklamasina bakarak eslestirmek yanlisti.
 * Kullanicinin cumlesi ("cinsel cagrisimli yem baslikli videolar") kavram
 * terimlerini icermez; eslesmeyi saglayan sey capalardir.
 */
function readRules(promptText) {
  const out = [];
  const lines = promptText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/^\[(\w+)\] ([^:]+): (.*)$/);
    if (!head) continue;
    const anchors = lines[i + 1]?.match(/ilgili kavramlar:\s*(.*)$/)?.[1] || '';
    out.push({ id: head[1], label: head[2], description: head[3], anchors });
  }
  return out;
}

/** Metnin en cok hangi kavrama dustugu. */
function dominantConcept(text) {
  const t = fold(text);
  let best = null;
  let bestHits = 0;
  for (const [key, terms] of Object.entries(CONCEPTS)) {
    let hits = 0;
    for (const term of terms) if (t.includes(fold(term))) hits++;
    if (hits > bestHits) {
      bestHits = hits;
      best = key;
    }
  }
  return bestHits > 0 ? best : null;
}

/** Baslikta tutum isaretleri. */
function readStance(title) {
  const t = fold(title);
  if (/(elestir|biraktim|artik eglenceli degil|neden biraktim|dalga gecen|kotule)/.test(t)) {
    return 'elestirel';
  }
  if (/(ders|tarihi|akademi|kaynaklari|analiz|inceleme)/.test(t)) return 'notr';
  return 'destekleyici';
}

/**
 * LLM karari — deterministik.
 *
 * Gercek modelin yaptigi isin taklidi: videonun hangi OLCUTE girdigini ve o
 * olcute karsi TUTUMUNU dondurur. Tutum kritik: ayni kavrama giren iki video
 * (oyunu oven / oyunu elestiren) farkli sonuc almalidir.
 */
export function fakeJudge(promptText, hasImage = false) {
  const { title, channel } = readVideo(promptText);
  return judgeOne(title, channel, readRules(promptText), hasImage);
}

/**
 * TOPLU yargi taklidi — istemdeki her video icin ayri kayit.
 *
 * Uretimde tek istekte 20 video sorulur; sahte sunucunun da ayni sekilde
 * cevap vermesi sart, aksi halde toplu yolu hic sinanmamis olur.
 */
export function fakeJudgeBatch(promptText) {
  const rules = readRules(promptText);
  const verdicts = [];
  const re = /^(\d+)\. Baslik: (.*?) \| Kanal: (.*)$/gm;
  let m;
  while ((m = re.exec(promptText))) {
    const [, iRaw, title, channel] = m;
    const one = judgeOne(title, channel, rules, false);
    verdicts.push({ i: Number(iRaw), ...one });
  }
  return { verdicts };
}

/** Tek video karari — hem tekli hem toplu yol bunu kullanir. */
function judgeOne(title, channel, rules, hasImage) {
  const findRule = (concept) => rules.find((r) => dominantConcept(r.anchors) === concept);
  const titleConcept = dominantConcept(title);
  const channelConcept = dominantConcept(channel);

  if (titleConcept && titleConcept !== 'notr') {
    const rule = findRule(titleConcept);
    if (!rule) {
      return { ruleId: '', related: false, stance: 'ilgisiz', confidence: 0.8, reason: 'eslesen olcut yok' };
    }
    const stance = readStance(title);
    return {
      ruleId: rule.id,
      related: true,
      stance,
      confidence: 0.88,
      reason: `${titleConcept} olcutu — ${stance}`,
    };
  }

  // Baslik ipucu vermiyor ama kanal veriyor: kullanicinin kurali geregi
  // kapak gorseline bakilmali. Metin katmani KARARSIZ kalmali ki yukselsin.
  if (channelConcept && channelConcept !== 'notr') {
    const rule = findRule(channelConcept);
    if (rule && hasImage) {
      return {
        ruleId: rule.id,
        related: true,
        stance: 'destekleyici',
        visualCue: 'kapakta oyun arayuzu/logosu',
        confidence: 0.9,
        reason: 'kapak gorselinden tanindi',
      };
    }
    return {
      ruleId: '',
      related: false,
      stance: 'ilgisiz',
      confidence: 0.5, // yukseltme esiginin ALTINDA — kasitli
      reason: 'basliktan anlasilmiyor',
    };
  }

  return { ruleId: '', related: false, stance: 'ilgisiz', confidence: 0.85, reason: 'olcut disi' };
}

/**
 * Kural yazan katmanin taklidi.
 *
 * Gercek modelin yaptigi is: kullanicinin duz cumlesini capalara ve bir tutum
 * turune cevirmek. Burada bunu anahtar kelimeyle deterministik yapiyoruz.
 */
export function fakeCurator(promptText) {
  const lines = [];
  const re = /^\s*(\d+)\.\s+(.*)$/gm;
  let m;
  while ((m = re.exec(promptText))) lines.push(m[2].trim());

  return {
    rules: lines.map((description) => {
      const d = fold(description);
      let concept = 'notr';
      let stanceKind = 'konu';

      if (/(league|lol|valorant|oyun)/.test(d)) concept = 'oyun';
      else if (/magazin/.test(d)) concept = 'magazin';
      else if (/(yem|clickbait|cinsel|ciplak)/.test(d)) concept = 'yem';
      else if (/(siddet|kufur)/.test(d)) concept = 'siddet';
      else if (/(din|kutsal)/.test(d)) concept = 'din';

      // Tutum olcutun TANIMINA girmis mi?
      if (/hakaret/.test(d)) stanceKind = 'hakaret';
      else if (/(oven|ozendiren|masum gosteren)/.test(d)) stanceKind = 'ovgu';

      // Tutum bu olcutte karari degistirir mi? Yem baslik kaliplarinda
      // degistirmez — kalibin kendisi zaten istenmeyen seydir.
      const stanceSensitive = concept !== 'yem';

      return {
        label: description.slice(0, 40),
        anchors: CONCEPTS[concept] || [],
        literals: [],
        // Kalip yetkisi yalnizca tutum-duyarsiz kuralda anlamli
        patterns: stanceSensitive ? [] : CONCEPTS.yem,
        stanceSensitive,
        stanceKind,
        breadth: /her sey|rahatsiz/.test(d) ? 'genis' : 'dar',
        note: '',
      };
    }),
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
  const counters = {
    embed: 0, embedTexts: 0, text: 0, vision: 0,
    curator: 0, audit: 0, models: 0, imageBytes: 0,
  };

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
        const promptText = parts.map((p) => p.text || '').join('\n');

        // Kural yazan katman mi, video yargilayan katman mi? Istem icerigi
        // ayirir; ikisi de ayni uc noktayi kullanir.
        if (promptText.includes('KULLANICININ CUMLELERI:')) {
          counters.curator++;
          return send({
            candidates: [{ content: { parts: [{ text: JSON.stringify(fakeCurator(promptText)) }] } }],
          });
        }
        if (promptText.includes('kural kumesi var')) {
          counters.audit++;
          return send({
            candidates: [{ content: { parts: [{ text: JSON.stringify({ findings: [] }) }] } }],
          });
        }

        const img = parts.find((p) => p.inline_data || p.inlineData);
        if (img) {
          counters.vision++;
          counters.imageBytes += (img.inline_data || img.inlineData)?.data?.length || 0;
        } else {
          counters.text++;
        }
        // Toplu istem mi, tek video mu? Toplu istemde her kayit ayri dondurulur.
        if (/^\d+\. Baslik:/m.test(promptText)) {
          return send({
            candidates: [
              { content: { parts: [{ text: JSON.stringify(fakeJudgeBatch(promptText)) }] } },
            ],
          });
        }
        return send({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(fakeJudge(promptText, Boolean(img))) }] } },
          ],
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
