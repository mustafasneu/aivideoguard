/**
 * Tek cikiş noktasi: her Gemini cagrisi buradan gecer.
 * Token-bucket hiz siniri + 429/5xx icin ustel geri cekilme + gunluk butce.
 */

import { bumpStats } from './cache.js';

import { DEFAULT_ENDPOINT } from '../shared/config.js';

/**
 * Uc nokta ayarlanabilir: kurumsal gateway / proxy arkasindaki kurulumlar icin.
 * Bos birakilirsa Google'in resmi adresi kullanilir.
 */
function endpoint(settings) {
  const e = (settings?.apiEndpoint || '').trim();
  return e ? e.replace(/\/+$/, '') : DEFAULT_ENDPOINT;
}

class TokenBucket {
  constructor(ratePerMinute) {
    this.capacity = ratePerMinute;
    this.tokens = ratePerMinute;
    this.rate = ratePerMinute / 60000; // token / ms
    this.last = Date.now();
  }

  setRate(ratePerMinute) {
    if (ratePerMinute === this.capacity) return;
    this.capacity = ratePerMinute;
    this.rate = ratePerMinute / 60000;
    this.tokens = Math.min(this.tokens, this.capacity);
  }

  /**
   * @param {number} cost Bu cagrinin KAC istek saydigi.
   *
   * TEMKINLI VARSAYIM (henuz kanitlanmadi): `batchEmbedContents` icine konan
   * her metin ayri bir istek olarak sayiliyor olabilir. Temiz olcum gunluk
   * kota tukendigi icin yapilamadi.
   *
   * Yanlis tarafta olmanin maliyeti asimetrik: varsayim yanlissa yalnizca
   * gereksiz yere yavaslariz; dogruysa ve saymazsak dakikalik kotayi 40 kat
   * asar, karar hatti tamamen hataya duser ve hata politikasi geregi butun
   * videolar gecer — yani filtre sessizce kapanir. Bu yuzden pahali tarafi
   * varsayiyoruz.
   */
  async take(cost = 1) {
    const need = Math.max(1, Math.min(cost, this.capacity));
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.rate);
      this.last = now;
      if (this.tokens >= need) {
        this.tokens -= need;
        return;
      }
      const waitMs = Math.ceil((need - this.tokens) / this.rate);
      await sleep(Math.min(waitMs, 5000));
    }
  }
}

const bucket = new TokenBucket(60);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export class ApiError extends Error {
  constructor(message, status, retriable) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retriable = retriable;
  }
}

export class BudgetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BudgetError';
  }
}

/**
 * Gemini REST cagrisi.
 * API anahtari X-goog-api-key basliginda gonderilir — URL'de degil.
 * Boylece anahtar tarayici/proxy loglarina ve hata mesajlarina sizmaz.
 */
/**
 * Zaman asimi GERCEK MODELE gore secilir, sahte sunucuya gore degil.
 *
 * Olculdu: ucretsiz kademede 14 es zamanli istek toplam ~50 sn suruyor —
 * istekler sunucu tarafinda siraya giriyor. Onceki 20 sn'lik sinir bu yuzden
 * her cagriyi iptal ediyor, 3 kez deniyor ve hepsi dusuyordu. Sahte sunucu
 * aninda yanit verdigi icin bu hata testlerde HIC gorunmuyordu.
 */
const DEFAULT_TIMEOUT_MS = 60000;

export async function callGemini(
  model,
  method,
  body,
  settings,
  { retries = 3, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  // Buraya anahtarsiz gelinmemesi gerekir: karar hatti anahtar yokken
  // tamamen yerel calisir ve API'ye hic ugramaz. Yine de bir yol acik
  // kalirsa mesaj "hata" gibi degil, YAPILACAK IS gibi okunmali —
  // anahtarsiz kip gecerli bir kullanim bicimidir, ariza degil.
  if (!settings.apiKey) {
    throw new ApiError(
      'Bu katman icin API anahtari gerekiyor. Anahtarsiz kip yerel kurallarla ' +
        'calisir; anlamsal ve baglamsal katmanlari acmak icin ayarlardan anahtar girin.',
      0,
      false,
    );
  }
  bucket.setRate(settings.maxRequestsPerMinute || 60);

  // Toplu gomude her metin ayri istek sayilir; sinirlayiciya gercek maliyeti
  // bildirmek zorundayiz, yoksa kotayi 40 kat asariz.
  const cost = Array.isArray(body?.requests) ? body.requests.length : 1;

  let attempt = 0;
  for (;;) {
    await bucket.take(cost);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetch(`${endpoint(settings)}/models/${model}:${method}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': settings.apiKey,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (res.ok) return await res.json();

      const retriable = res.status === 429 || res.status >= 500;
      const detail = await res.text().catch(() => '');
      // Hata metni anahtar icerebilir — kirp ve maskele
      const safe = detail.slice(0, 300).replace(/AIza[0-9A-Za-z_-]{10,}/g, 'AIza***');

      // 429'da HANGI kotanin doldugu tek kullanisli bilgidir: dakikalik mi
      // gunluk mu, gomu mu uretim mi. Ham metin kirpildiginda bu ayrinti
      // kayboluyor ve kullanici "kota doldu" disinda bir sey ogrenemiyordu.
      let quota = '';
      if (res.status === 429) {
        try {
          const v = (JSON.parse(detail).error?.details || [])
            .flatMap((d) => d.violations || [])[0];
          if (v) quota = ` [${v.quotaId} sinir=${v.quotaValue}]`;
        } catch {
          /* govde JSON degilse sessizce gec */
        }
      }

      if (retriable && attempt < retries) {
        attempt++;
        // 429 dakikalik pencereden gelir: 8 saniyelik tavan pencereyi
        // asmaya yetmez ve uc deneme de bosa gider. Kota hatasinda
        // pencerenin kapanmasini bekleyecek kadar geri cekiliyoruz.
        const cap = res.status === 429 ? 45000 : 8000;
        // Sunucu ne kadar beklenecegini soylediyse ona uy
        const retryAfter = Number(res.headers.get('retry-after')) * 1000;
        const backoff = Math.min(2 ** attempt * 1000 + Math.random() * 500, cap);
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, cap) : backoff);
        continue;
      }
      await bumpStats({ errors: 1 });
      throw new ApiError(`HTTP ${res.status}${quota}: ${safe}`, res.status, retriable);
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof ApiError) throw err;
      // Ag hatasi / zaman asimi
      if (attempt < retries) {
        attempt++;
        await sleep(Math.min(2 ** attempt * 500 + Math.random() * 300, 8000));
        continue;
      }
      await bumpStats({ errors: 1 });
      throw new ApiError(err.name === 'AbortError' ? 'Zaman asimi' : String(err.message), 0, true);
    }
  }
}

/** Kullanilabilir modelleri listeler — popup'taki model secici bunu kullanir. */
export async function listModels(apiKey, settings) {
  const res = await fetch(`${endpoint(settings)}/models?pageSize=200`, {
    headers: { 'x-goog-api-key': apiKey },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new ApiError(`HTTP ${res.status}: ${t.slice(0, 200)}`, res.status, false);
  }
  const json = await res.json();
  return (json.models || []).map((m) => ({
    name: (m.name || '').replace(/^models\//, ''),
    methods: m.supportedGenerationMethods || [],
  }));
}
