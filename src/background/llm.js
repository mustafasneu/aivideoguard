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

const VERDICT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    related: { type: 'BOOLEAN' },
    confidence: { type: 'NUMBER' },
    reason: { type: 'STRING' },
  },
  required: ['related', 'confidence', 'reason'],
};

function buildPrompt(ctx) {
  const lines = [
    'Bir kullanici YouTube akisinda belirli bir konuyu gormek istemiyor.',
    'Asagidaki videonun bu konuyla ILGILI olup olmadigina karar ver.',
    '',
    `KACINILAN KONU: ${ctx.topic || '(belirtilmemis)'}`,
  ];

  if (ctx.anchorTexts?.length) {
    lines.push(`ILGILI KAVRAMLAR: ${ctx.anchorTexts.join(', ')}`);
  }

  lines.push(
    '',
    'VIDEO:',
    `- Baslik: ${ctx.title || '(yok)'}`,
    `- Kanal: ${ctx.channel || '(yok)'}`,
  );

  if (ctx.durationText) lines.push(`- Sure: ${ctx.durationText}`);
  if (ctx.surface) lines.push(`- Gorundugu yer: ${ctx.surface}`);
  if (ctx.badges?.length) lines.push(`- Rozetler: ${ctx.badges.join(', ')}`);

  // Baglamsal delil: kanal hafizasi
  if (ctx.channelProfile && ctx.channelProfile.n >= 3) {
    const ratio = (ctx.channelProfile.blocked / ctx.channelProfile.n) * 100;
    lines.push(
      `- Kanal gecmisi: bu kanalin degerlendirilmis ${ctx.channelProfile.n} videosunun ` +
        `%${ratio.toFixed(0)} kadari bu konuyla ilgili bulundu.`,
    );
  }

  if (ctx.semanticScore != null) {
    lines.push(`- Anlamsal benzerlik skoru: ${ctx.semanticScore.toFixed(3)} (0-1 arasi, bilgi amacli)`);
  }

  lines.push(
    '',
    'KURALLAR:',
    '- Dolayli iliskiyi de say: takma ad, lakap, kisinin gorevi/rolu, olayin taraflari,',
    '  konuyla ozdeslesmis semboller, ima ve gonderme.',
    '- Kanal gecmisi tek basina yeterli delil DEGILDIR; sadece destekleyici sinyaldir.',
    '- Emin degilsen confidence degerini dusuk ver. Tahmin yurutup yuksek guven verme.',
    '- confidence: 0.0 ile 1.0 arasi. reason: en fazla 15 kelime, Turkce.',
  );

  if (ctx.hasImage) {
    lines.push(
      '- Kucuk resim de verildi. Gorseldeki kisi, logo, sembol veya sahne konuyla',
      '  iliskiliyse bunu karara kat.',
    );
  }

  return lines.join('\n');
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
  return {
    related: parsed.related,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    reason: String(parsed.reason || '').slice(0, 120),
  };
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

/** Yalnizca bu alan adlarindan goruntu cekilir. */
const THUMB_HOST = /(^|\.)(ytimg\.com|img\.youtube\.com)$/;

/**
 * Kucuk resim adresi guvenli mi?
 *
 * URL sayfadan gelir; sayfa baglami kotu niyetli olabilir (youtube.com'da bir
 * XSS, baska bir uzanti, ya da YouTube'un kendi degisen DOM'u). Dogrulama
 * olmadan arka plan, sayfanin secttigi herhangi bir adrese uzanti
 * yetkileriyle istek atardi.
 */
export function isAllowedThumbnail(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && THUMB_HOST.test(u.hostname);
  } catch {
    return false;
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
