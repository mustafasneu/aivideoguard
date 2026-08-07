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

  async take() {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.rate);
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil((1 - this.tokens) / this.rate);
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
export async function callGemini(model, method, body, settings, { retries = 3, timeoutMs = 20000 } = {}) {
  if (!settings.apiKey) throw new ApiError('API anahtari tanimli degil', 0, false);
  bucket.setRate(settings.maxRequestsPerMinute || 60);

  let attempt = 0;
  for (;;) {
    await bucket.take();
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

      if (retriable && attempt < retries) {
        attempt++;
        // Ustel geri cekilme + jitter
        await sleep(Math.min(2 ** attempt * 500 + Math.random() * 300, 8000));
        continue;
      }
      await bumpStats({ errors: 1 });
      throw new ApiError(`HTTP ${res.status}: ${safe}`, res.status, retriable);
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
