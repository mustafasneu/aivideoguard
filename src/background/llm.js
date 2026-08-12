/**
 * BAGLAMSAL muhakeme katmani.
 *
 * Vektor benzerligi "bu metin o konuya benziyor mu?" sorusunu cevaplar.
 * LLM ise dolayli iliskiyi kurar: takma ad, lakap, kisinin rolu, olayin
 * baglami, kanalin yayin cizgisi, kucuk resimdeki yuz/logo.
 *
 * Cikti serbest metin degil, sema ile baglanmis JSON — "TRUE/FALSE iceriyor mu"
 * gibi kirilgan dize kontrolu yapilmaz.
 */

import { MODELS } from '../shared/config.js';
import { callGemini } from './net.js';
import { reserveLlmCall, releaseLlmCall } from './cache.js';
import { BudgetError } from './net.js';
import { isAllowedThumbnail } from '../shared/thumbnail.js';
// Istem metinleri SAF modulde durur ki Node'dan olculebilsin — kopya tutmak
// uretimle olcumun sessizce ayrilmasi demekti.
import { STANCE, BATCH_VERDICT_SCHEMA, renderRules, buildBatchPrompt } from '../shared/prompt.js';
export { STANCE };

/**
 * Tutum eksenleri.
 *
 * `related` tek basina yetmez: kullanici konuyu ELESTIREN icerigi gormek
 * isteyebilir. Bu yuzden model iki ayri sey dondurur — icerik konuya giriyor
 * mu, ve konuya karsi nasil duruyor.
 */
const VERDICT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    // Hangi kural eslesti? Hicbiri eslesmediyse bos dize.
    ruleId: { type: 'STRING' },
    related: { type: 'BOOLEAN' },
    stance: {
      type: 'STRING',
      enum: [STANCE.SUPPORTIVE, STANCE.CRITICAL, STANCE.NEUTRAL, STANCE.UNRELATED],
    },
    // Gorsel katmanda: kapakta konuyu cagristiran ne goruldu?
    visualCue: { type: 'STRING' },
    confidence: { type: 'NUMBER' },
    reason: { type: 'STRING' },
  },
  required: ['ruleId', 'related', 'stance', 'confidence', 'reason'],
};

function buildPrompt(ctx) {
  const lines = [
    'Bir kullanicinin YouTube akisinda GORMEK ISTEMEDIGI icerik olcutleri asagida.',
    'Videonun bu olcutlerden herhangi birine girip girmedigine karar ver.',
    '',
    'OLCUTLER:',
    renderRules(ctx.rules || []),
    '',
    'VIDEO:',
    `- Baslik: ${ctx.title || '(yok)'}`,
    `- Kanal: ${ctx.channel || '(yok)'}`,
  ];

  if (ctx.durationText) lines.push(`- Sure: ${ctx.durationText}`);
  if (ctx.surface) lines.push(`- Gorundugu yer: ${ctx.surface}`);
  if (ctx.badges?.length) lines.push(`- Rozetler: ${ctx.badges.join(', ')}`);

  // Baglamsal delil: kanal hafizasi
  if (ctx.channelProfile && ctx.channelProfile.n >= 3) {
    const ratio = (ctx.channelProfile.blocked / ctx.channelProfile.n) * 100;
    lines.push(
      `- Kanal gecmisi: bu kanalin degerlendirilmis ${ctx.channelProfile.n} videosunun ` +
        `%${ratio.toFixed(0)} kadari bu olcutlere giren icerikti.`,
    );
  }

  if (ctx.literalHit) {
    lines.push(`- Dikkat: baslikta "${ctx.literalHit}" ifadesi geciyor.`);
  }

  lines.push(
    '',
    'NASIL KARAR VERECEKSIN:',
    '- Kelime eslesmesi TEK BASINA karar sebebi DEGILDIR. Olcutun adi baslikta',
    '  gecse bile videonun o konuya nasil YAKLASTIGINA bak.',
    '- Dolayli iliskiyi de say: kisaltma, jargon, takma ad, lakap, kisinin rolu,',
    '  olayin taraflari, o alanla ozdeslesmis semboller, ima ve gonderme.',
    '  Olcutun adi hic gecmeden de video o olcute girebilir.',
    '- Baslik hangi dilde olursa olsun (Turkce, Ingilizce ya da baska) ayni',
    '  olculere gore degerlendir. Olcut Turkce yazilmis olmasi, Ingilizce',
    '  basligin o olcute girmeyecegi anlamina GELMEZ.',
    '- Kanal gecmisi tek basina yeterli delil DEGILDIR; sadece destekleyici sinyaldir.',
    '- Emin degilsen confidence degerini dusuk ver. Tahmin yurutup yuksek guven verme.',
    '',
    'DONDURECEKLERIN:',
    '  ruleId  : eslesen olcutun kimligi (ornek: r3). Birden fazlasi esliyorsa',
    '            EN GUCLU eslesen tek olcutu ver. Hicbiri eslesmiyorsa bos dize.',
    '  related : video eslesen olcute giriyor mu?',
    '  stance  : videonun O OLCUTE karsi durusu',
    `            "${STANCE.SUPPORTIVE}" = konuyu savunuyor, oven, ozendiren, yayan, masum gosteren`,
    `            "${STANCE.CRITICAL}"   = konuyu elestiren, kotuleyen, alay eden, karsi cikan`,
    `            "${STANCE.NEUTRAL}"    = haber/aktarim dili, taraf tutmuyor`,
    `            "${STANCE.UNRELATED}"  = konuya hic girmiyor`,
    '            Bu ayrim kritik: ayni konuyu OVEN ile ELESTIREN video farkli islem gorur.',
    '  confidence: 0.0-1.0.  reason: en fazla 15 kelime, Turkce.',
  );

  if (ctx.hasImage) {
    lines.push(
      '',
      'KAPAK GORSELI:',
      '- Kapak gorseli de verildi. Baslikta hicbir ipucu olmasa bile gorseldeki kisi,',
      '  logo, amblem, bayrak, sembol, oyun arayuzu, yazi veya sahne bir olcutu',
      '  cagristiriyorsa bunu karara kat.',
      '- visualCue alanina gorselde gorduugun ipucunu kisaca yaz; yoksa bos birak.',
    );
  }

  return lines.join('\n');
}

/**
 * Tek bir yargi kaydini guvenli hale getirir.
 *
 * Tutum alani sema ile baglidir ama model yine de bilinmeyen bir dize
 * dondurebilir. Bilinmeyen degeri "notr"e dusurmek, tutumu sessizce
 * "destekleyici" saymaktan guvenlidir: notr karar, kullanicinin
 * elestirel-icerik tercihini yanlislikla devre disi birakmaz.
 */
function normalizeVerdict(parsed) {
  const known = Object.values(STANCE);
  const stance = known.includes(parsed.stance)
    ? parsed.stance
    : parsed.related
      ? STANCE.NEUTRAL
      : STANCE.UNRELATED;

  return {
    ruleId: String(parsed.ruleId || '').trim(),
    related: parsed.related === true,
    stance,
    visualCue: String(parsed.visualCue || '').slice(0, 80),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    reason: String(parsed.reason || '').slice(0, 120),
  };
}

function parseVerdict(json) {
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const reason = json?.promptFeedback?.blockReason || json?.candidates?.[0]?.finishReason;
    throw new Error(`Model cikti uretmedi${reason ? ` (${reason})` : ''}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Model gecersiz JSON dondu');
  }
  if (typeof parsed.related !== 'boolean') throw new Error('Semaya uymayan cikti');
  return normalizeVerdict(parsed);
}

/**
 * TOPLU metin katmani — bir istekte cok video.
 *
 * KOK SORUN: video basina bir cagri olcekleneMEZ. Olculdu: ucretsiz kademede
 * 14 es zamanli istek ~50 sn suruyor. Gercek bir YouTube akisinda tek
 * kaydirmada 60+ kart var; video basina cagri hem dakikalarca gecikme hem de
 * gunluk kotanin aninda tukenmesi demek. Zaman asimini buyutmek bunu
 * cozmez, yalnizca bekleme suresini uzatir.
 *
 * Bu yuzden karar hatti videolari toplayip TEK istemde sorar. Modelin gordugu
 * olcut listesi zaten ortak; tekrar tekrar gondermek ayrica bosa token'di.
 */
/**
 * Bir grup videoyu tek istekte yargilar.
 * @returns {Promise<Array>} girdiyle AYNI sirada yargilar (eksikler null)
 */
export async function judgeTextBatch(rules, items, settings) {
  if (items.length === 0) return [];

  if (!(await reserveLlmCall(settings.dailyLlmBudget))) {
    throw new BudgetError(`Gunluk LLM butcesi doldu (${settings.dailyLlmBudget})`);
  }
  try {
    const model = settings.modelText || MODELS.text;
    const json = await callGemini(
      model,
      'generateContent',
      {
        contents: [{ role: 'user', parts: [{ text: buildBatchPrompt(rules, items) }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: BATCH_VERDICT_SCHEMA,
          // Kayit basina ~60 token; toplu istekte tavan buna gore olmali,
          // yoksa cikti ortadan kesilir ve TUM parti bosa gider.
          maxOutputTokens: Math.min(8192, 400 + items.length * 90),
        },
      },
      settings,
    );

    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      const why = json?.promptFeedback?.blockReason || json?.candidates?.[0]?.finishReason;
      throw new Error(`Model cikti uretmedi${why ? ` (${why})` : ''}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Toplu yargi gecersiz JSON');
    }

    // Sirayi indekse gore geri kur: model sirayi karistirabilir ya da
    // eksik dondurebilir. Diziyi oldugu gibi kabul etmek, kararlari yanlis
    // videoya yazmak demekti — sessiz ve agir bir hata.
    const out = new Array(items.length).fill(null);
    for (const v of parsed.verdicts || []) {
      const i = Number(v?.i);
      if (!Number.isInteger(i) || i < 0 || i >= items.length) continue;
      out[i] = normalizeVerdict(v);
    }
    return out;
  } catch (err) {
    await releaseLlmCall();
    throw err;
  }
}

/** Metin katmani — goruntu yok, ucuz. */
export async function judgeText(ctx, settings) {
  // Kota kontrolu ve artirim TEK adimda; ayri kontrol+artirim deseninde
  // aradaki await penceresinde onlarca cagri ayni bakiyeyi goruyordu.
  if (!(await reserveLlmCall(settings.dailyLlmBudget))) {
    throw new BudgetError(`Gunluk LLM butcesi doldu (${settings.dailyLlmBudget})`);
  }
  try {
    const model = settings.modelText || MODELS.text;
    const json = await callGemini(
      model,
      'generateContent',
      {
        contents: [{ role: 'user', parts: [{ text: buildPrompt({ ...ctx, hasImage: false }) }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: VERDICT_SCHEMA,
          maxOutputTokens: 200,
        },
      },
      settings,
    );
    return parseVerdict(json);
  } catch (err) {
    await releaseLlmCall();
    throw err;
  }
}

/** Gorsel katman — sadece metin katmani kararsiz kaldiginda. */
export async function judgeVision(ctx, imageBase64, mimeType, settings) {
  if (!(await reserveLlmCall(settings.dailyLlmBudget))) {
    throw new BudgetError(`Gunluk LLM butcesi doldu (${settings.dailyLlmBudget})`);
  }
  try {
    const model = settings.modelVision || MODELS.vision;
    const json = await callGemini(
      model,
      'generateContent',
      {
        contents: [
          {
            role: 'user',
            parts: [
              { text: buildPrompt({ ...ctx, hasImage: true }) },
              { inline_data: { mime_type: mimeType, data: imageBase64 } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: VERDICT_SCHEMA,
          maxOutputTokens: 200,
        },
      },
      settings,
    );
    return parseVerdict(json);
  } catch (err) {
    await releaseLlmCall();
    throw err;
  }
}

const THUMB_TIMEOUT_MS = 5000;

/**
 * Kucuk resmi cekip base64'e cevirir.
 * host_permissions icinde *.ytimg.com bulunmali — yoksa istek sessizce duser.
 */
export async function fetchThumbnail(url) {
  if (!isAllowedThumbnail(url)) throw new Error('Izinli olmayan kucuk resim adresi');

  // Zaman asimi olmadan tek bir asili istek, Promise.all ile beklenen
  // 60 kartlik yanitin tamamini sonsuza kadar bloke edebiliyordu.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), THUMB_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { credentials: 'omit', cache: 'force-cache', signal: ctrl.signal });
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? 'Kucuk resim zaman asimi' : String(err.message));
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Kucuk resim alinamadi: HTTP ${res.status}`);
  const blob = await res.blob();
  if (blob.size === 0) throw new Error('Bos kucuk resim');
  if (blob.size > 4 * 1024 * 1024) throw new Error('Kucuk resim cok buyuk');

  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000; // btoa'yi buyuk dizide patlatmamak icin parcali
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return { base64: btoa(bin), mimeType: blob.type || 'image/jpeg' };
}
