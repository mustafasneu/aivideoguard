import browser from 'webextension-polyfill';
import { CARD_SELECTOR, extractCard, extractVideoId } from './extract.js';
import { getContentSettings, onSettingsChanged } from '../shared/storage.js';
import { VERDICT } from '../shared/config.js';

const STATE = new WeakMap(); // card -> { videoId, status }
const WATCHDOG_MS = 10000;

let settings = null;
let queue = [];
let queueTimer = null;

/* ------------------------------------------------------------------ */
/* Kart durumu                                                         */
/* ------------------------------------------------------------------ */

function clearCard(card) {
  card.removeAttribute('data-aivg');
  card.removeAttribute('data-aivg-label');
  card.removeAttribute('data-aivg-layer');
  card.removeAttribute('data-aivg-decided');
}

function markPending(card) {
  card.setAttribute('data-aivg', 'pending');
}

function markBlocked(card, res) {
  let label = 'Gizlendi';
  if (res.reason) label += `\n${res.reason}`;
  else if (res.matched) label += `\n${res.matched}`;
  if (res.error) label = `Filtre hatasi — gizlendi\n${res.error.slice(0, 60)}`;
  if (settings?.debug) {
    // Onbellekten gelen kararda asil katmani da goster: "cache←semantic"
    const origin = res.cachedFrom ? `${res.layer}←${res.cachedFrom}` : res.layer;
    const score = res.score != null ? ` ${res.score.toFixed(3)}` : '';
    label += `\n[${origin}${score}]`;
  }
  card.setAttribute('data-aivg', 'blocked');
  card.setAttribute('data-aivg-label', label);
  card.setAttribute('data-aivg-layer', res.layer || '');
}

/* ------------------------------------------------------------------ */
/* Degerlendirme kuyrugu                                               */
/* ------------------------------------------------------------------ */

function enqueue(card, item) {
  queue.push({ card, item });
  if (!queueTimer) queueTimer = setTimeout(flush, 150);
}

async function flush() {
  queueTimer = null;
  const batch = queue.splice(0, 60);
  if (batch.length === 0) return;
  if (queue.length > 0 && !queueTimer) queueTimer = setTimeout(flush, 150);

  // Bekleyen kartlarin sonsuza kadar bulanik kalmasini onleyen bekci.
  // Eski surumdeki en agir hata buydu: yanit hic gelmeyince kart
  // visibility:hidden olarak kaliyordu.
  const watchdog = setTimeout(() => {
    for (const { card } of batch) {
      const st = STATE.get(card);
      if (st?.status === 'pending') {
        st.status = 'timeout';
        if (settings?.onError === 'hide') {
          markBlocked(card, { layer: 'error-policy', error: 'Yanit gelmedi' });
        } else {
          clearCard(card);
        }
      }
    }
  }, WATCHDOG_MS);

  let results;
  try {
    results = await browser.runtime.sendMessage({
      type: 'evaluate',
      items: batch.map((b) => b.item),
    });
  } catch (err) {
    clearTimeout(watchdog);
    for (const { card } of batch) {
      const st = STATE.get(card);
      if (!st || st.status !== 'pending') continue;
      st.status = 'error';
      if (settings?.onError === 'hide') {
        markBlocked(card, { layer: 'error-policy', error: String(err.message || err) });
      } else {
        clearCard(card);
      }
    }
    return;
  }
  clearTimeout(watchdog);

  batch.forEach(({ card, item }, i) => {
    const st = STATE.get(card);
    // Kart bu arada geri donusturulduyse karari uygulama
    if (!st || st.videoId !== item.videoId) return;

    const res = results?.[i];
    st.status = 'done';
    if (res && res.verdict === VERDICT.BLOCK) {
      markBlocked(card, res);
    } else {
      clearCard(card);
      // Gecen kartta gorunur bir iz kalmaz; hata ayiklamada karari veren
      // katman yine de okunabilir olmali (beyaz liste mi, hata mi?).
      if (settings?.debug && res?.layer) card.setAttribute('data-aivg-decided', res.layer);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Tarama                                                              */
/* ------------------------------------------------------------------ */

function processCard(card) {
  const videoId = extractVideoId(card);
  const prev = STATE.get(card);

  // Dugum geri donusturulmus: eski karar artik gecersiz
  if (prev && prev.videoId !== videoId) {
    clearCard(card);
    STATE.delete(card);
  }
  if (!videoId) return;
  if (STATE.get(card)?.videoId === videoId) return; // zaten islendi/isleniyor

  const item = extractCard(card);
  if (!item) return;

  STATE.set(card, { videoId, status: 'pending' });
  markPending(card);
  enqueue(card, item);
}

// Yalnizca gorunur alana yaklasan kartlar degerlendirilir.
// Ana sayfada yuzlerce kart DOM'da bulunur; hepsini islemek gereksiz maliyet.
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) processCard(e.target);
    }
  },
  { rootMargin: '400px 0px' },
);

const observed = new WeakSet();

function scan(root = document) {
  const cards = root.querySelectorAll?.(CARD_SELECTOR);
  if (!cards) return;
  for (const card of cards) observe(card);
}

/** Tum kartlari bastan degerlendir — gezinme ve ayar degisiminde. */
function reevaluateAll() {
  for (const card of document.querySelectorAll(CARD_SELECTOR)) processCard(card);
  scan(document);
}

// YouTube tek sayfa uygulamasi: DOM surekli degisir, sayfa hic yenilenmez.
// setInterval yerine MutationObserver — bos donguleri tamamen ortadan kaldirir.
//
// IKI TUZAK:
//  1) Ayni kare icinde birden fazla mutation geri cagrisi tetiklenir. Erken
//     `return` etmek o cagrinin `records` dizisini KALICI olarak kaybettirir —
//     MutationObserver her kaydi tam bir kez teslim eder, ertelemez. Bu yuzden
//     kayitlar biriktirilir, atilmaz.
//  2) YouTube dugumu silip eklemek yerine MEVCUT kartin icini degistirerek
//     baska bir videoya atar. addedNodes'a bakmak bunu kacirir; degisen
//     dugumun ust kartini da yeniden degerlendirmek gerekir.
let scanScheduled = false;
let pendingRecords = [];

const mo = new MutationObserver((records) => {
  pendingRecords.push(...records);
  if (scanScheduled) return;
  scanScheduled = true;
  requestAnimationFrame(drainRecords);
});

function drainRecords() {
  scanScheduled = false;
  const records = pendingRecords;
  pendingRecords = [];

  const touched = new Set();

  for (const r of records) {
    // Eklenen dugumler
    for (const node of r.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches?.(CARD_SELECTOR)) observe(node);
      scan(node);
      const host = node.closest?.(CARD_SELECTOR);
      if (host) touched.add(host);
    }
    // Yerinde degisen dugumler — geri donusturulen kartlari yakalar
    const target = r.target?.nodeType === 1 ? r.target : r.target?.parentElement;
    const host = target?.closest?.(CARD_SELECTOR);
    if (host) touched.add(host);
  }

  for (const card of touched) processCard(card);
}

function observe(card) {
  if (observed.has(card)) return;
  observed.add(card);
  io.observe(card);
}

/* ------------------------------------------------------------------ */
/* Baslatma                                                            */
/* ------------------------------------------------------------------ */

async function init() {
  settings = await getContentSettings();
  scan(document);
  // attributes: kartin href'i degistiginde (dugum geri donusumu) yakalamak icin
  mo.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href'],
  });
}

// Ayarlar degistiginde tum kararlar gecersizdir: isaretleri temizle, yeniden tara
onSettingsChanged(async () => {
  settings = await getContentSettings();
  for (const card of document.querySelectorAll('[data-aivg], [data-aivg-decided]')) {
    clearCard(card);
    STATE.delete(card);
  }
  reevaluateAll();
});

// SPA gezinmesi. Yalnizca `scan` cagirmak YETMEZ: YouTube ayni renderer
// dugumlerini yeni sayfanin videolariyla doldurur; dugum zaten `observed`
// oldugu icin io.observe atlanir ve kart hic yeniden degerlendirilmez.
window.addEventListener('yt-navigate-finish', reevaluateAll);

init();
