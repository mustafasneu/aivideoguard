import browser from 'webextension-polyfill';

const VERDICT_KEY = 'cache:verdicts:v1';
const CHANNEL_KEY = 'cache:channels:v1';
const ANCHOR_KEY = 'cache:anchors:v1';
const STATS_KEY = 'stats:v1';

const VERDICT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 gun
const VERDICT_MAX = 5000;

/* ------------------------------------------------------------------ */
/* Karar onbellegi — videoId -> karar                                   */
/* ------------------------------------------------------------------ */

let verdictMem = null;

async function loadVerdicts() {
  if (verdictMem) return verdictMem;
  const res = await browser.storage.local.get(VERDICT_KEY);
  verdictMem = res[VERDICT_KEY] || {};
  return verdictMem;
}

let flushTimer = null;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    if (!verdictMem) return;
    await browser.storage.local.set({ [VERDICT_KEY]: verdictMem });
  }, 3000);
}

export async function getVerdict(videoId, hash) {
  if (!videoId) return null;
  const all = await loadVerdicts();
  const e = all[videoId];
  if (!e) return null;
  if (e.h !== hash) return null; // ayarlar degismiş, karar gecersiz
  if (Date.now() - e.ts > VERDICT_TTL_MS) return null;
  return e;
}

/**
 * @param {string} [reason] Karari aciklayan kisa metin (LLM gerekcesi veya
 *   eslesen capa/kural). Onbellege YAZILMASI sart: aksi halde ikinci
 *   goruntulemede kart "Gizlendi" der ama nedenini soyleyemez.
 */
export async function putVerdict(videoId, hash, verdict, score, layer, reason, rule) {
  if (!videoId) return;
  const all = await loadVerdicts();
  all[videoId] = {
    h: hash,
    v: verdict,
    s: score,
    l: layer,
    ts: Date.now(),
    ...(reason ? { r: String(reason).slice(0, 120) } : {}),
    // Hangi olcut yakaladi — kullanici "neden gizlendi" diye sordugunda
    // gerekce tek basina yetmez, kuralin adi da lazim.
    ...(rule ? { k: String(rule).slice(0, 60) } : {}),
  };

  const keys = Object.keys(all);
  if (keys.length > VERDICT_MAX) {
    // En eski %20'yi at (LRU yerine yaş bazli — erişim zamani tutmak
    // her okumada yazma gerektirirdi, maliyeti degmez)
    keys.sort((a, b) => all[a].ts - all[b].ts);
    for (let i = 0; i < Math.floor(VERDICT_MAX * 0.2); i++) delete all[keys[i]];
  }
  scheduleFlush();
}

export async function clearVerdicts() {
  verdictMem = {};
  await browser.storage.local.remove(VERDICT_KEY);
}

/* ------------------------------------------------------------------ */
/* Kanal hafizasi — BAGLAM katmani                                      */
/*                                                                      */
/* Bir kanal hakkinda verilmiş kararlar birikir. Kanalin engellenme     */
/* orani yuksekse, o kanalin basligi masum gorunen videosu bile         */
/* baglamsal olarak supheli sayilir. Bu, anlamsal skora eklenen kucuk   */
/* bir katkidir — tek basina engelleme yetkisi YOKTUR.                  */
/* ------------------------------------------------------------------ */

let channelMem = null;

async function loadChannels() {
  if (channelMem) return channelMem;
  const res = await browser.storage.local.get(CHANNEL_KEY);
  channelMem = res[CHANNEL_KEY] || {};
  return channelMem;
}

export async function getChannelProfile(channelKey) {
  if (!channelKey) return null;
  const all = await loadChannels();
  return all[channelKey] || null;
}

const CHANNEL_MAX = 2000;
let channelDirty = false;
let channelTimer = null;

function scheduleChannelFlush() {
  channelDirty = true;
  if (channelTimer) return;
  channelTimer = setTimeout(async () => {
    channelTimer = null;
    if (!channelDirty || !channelMem) return;
    channelDirty = false;
    await browser.storage.local.set({ [CHANNEL_KEY]: channelMem });
  }, 3000);
}

/**
 * Kanal sonucunu kaydeder.
 *
 * Yazma GECIKMELIDIR. Her karar icin storage'a tam haritayi yazmak hem
 * pahaliydi hem de storage.onChanged uzerinden acik tum sekmelere yayin
 * yapiyordu: 60 kartlik bir kaydirmada 60 tam yazma + 60 yayin.
 */
export async function recordChannelOutcome(channelKey, blocked) {
  if (!channelKey) return;
  const all = await loadChannels();
  const p = all[channelKey] || { n: 0, blocked: 0, ts: 0 };
  p.n += 1;
  if (blocked) p.blocked += 1;
  p.ts = Date.now();
  all[channelKey] = p;

  const keys = Object.keys(all);
  if (keys.length > CHANNEL_MAX) {
    keys.sort((a, b) => all[a].ts - all[b].ts);
    for (let i = 0; i < Math.floor(CHANNEL_MAX * 0.2); i++) delete all[keys[i]];
  }
  scheduleChannelFlush();
}

export async function clearChannels() {
  channelMem = {};
  await browser.storage.local.remove(CHANNEL_KEY);
}

/* ------------------------------------------------------------------ */
/* Capa gomuleri                                                        */
/* ------------------------------------------------------------------ */

export async function getAnchorBundle(hash) {
  const res = await browser.storage.local.get(ANCHOR_KEY);
  const b = res[ANCHOR_KEY];
  if (!b || b.h !== hash) return null;
  return b;
}

export async function putAnchorBundle(hash, topicVec, anchors, bg = null) {
  await browser.storage.local.set({
    // `bg` = anizotropi merkezi. Capalarla AYNI pakette durur cunku ayni
    // gomu modeline baglidir; model degisince ikisi birlikte gecersizlesmeli.
    [ANCHOR_KEY]: { h: hash, topicVec, anchors, bg, ts: Date.now() },
  });
}

/* ------------------------------------------------------------------ */
/* Istatistik                                                           */
/* ------------------------------------------------------------------ */

/**
 * Istatistik.
 *
 * KRITIK: eskiden her artirim `oku -> degistir -> yaz` yapiyordu ve bu adimlar
 * `await` ile bolundugu icin es zamanli 60 cagri birbirinin yazmasini eziyordu.
 * Sayaclar kayboluyor, gunluk LLM butcesi fiilen hic dolmuyordu.
 *
 * Cozum: tek bir bellek kopyasi uzerinde SENKRON artirim + gecikmeli yazma.
 * Artirim ile yazma arasinda await yok, dolayisiyla ic ice girme imkani yok.
 */
let statsMem = null;
let statsTimer = null;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function fresh(prev = {}) {
  return {
    day: today(),
    blocked: 0,
    allowed: 0,
    llmCalls: 0,
    errors: 0,
    totalBlocked: prev.totalBlocked || 0,
  };
}

async function loadStats() {
  if (statsMem && statsMem.day === today()) return statsMem;
  if (!statsMem) {
    const res = await browser.storage.local.get(STATS_KEY);
    const stored = res[STATS_KEY] || {};
    statsMem = stored.day === today() ? { ...fresh(stored), ...stored } : fresh(stored);
  } else {
    // Gun donmus — gunluk sayaclar sifirlanir, toplam korunur
    statsMem = fresh(statsMem);
  }
  return statsMem;
}

function scheduleStatsFlush() {
  if (statsTimer) return;
  statsTimer = setTimeout(async () => {
    statsTimer = null;
    if (statsMem) await browser.storage.local.set({ [STATS_KEY]: statsMem });
  }, 2000);
}

export async function getStats() {
  return { ...(await loadStats()) };
}

export async function bumpStats(patch) {
  const s = await loadStats();
  // Buradan itibaren await YOK — artirim atomik kalir
  for (const [k, v] of Object.entries(patch)) s[k] = (s[k] || 0) + v;
  if (patch.blocked) s.totalBlocked = (s.totalBlocked || 0) + patch.blocked;
  scheduleStatsFlush();
  return { ...s };
}

/**
 * LLM cagrisi icin kota rezervasyonu.
 *
 * Kontrol ve artirim TEK adimda yapilir. Ayri `checkBudget()` + sonradan
 * `bumpStats()` deseni, ikisi arasindaki await penceresinde onlarca cagrinin
 * ayni bakiyeyi gormesine ve butcenin asilmasina yol aciyordu.
 *
 * @returns {boolean} true = kota ayrildi, false = butce dolu
 */
export async function reserveLlmCall(limit) {
  const s = await loadStats();
  if (limit && (s.llmCalls || 0) >= limit) return false;
  s.llmCalls = (s.llmCalls || 0) + 1;
  scheduleStatsFlush();
  return true;
}

/** Cagri gerceklesmediyse (orn. ag hatasi oncesi iptal) rezervasyonu geri ver. */
export async function releaseLlmCall() {
  const s = await loadStats();
  s.llmCalls = Math.max(0, (s.llmCalls || 0) - 1);
  scheduleStatsFlush();
}
