import browser from 'webextension-polyfill';
import { getSettings, setSettings } from '../shared/storage.js';
import { DEFAULTS, MODELS, LAYER, VERDICT } from '../shared/config.js';
import { hasRequiredOrigins, requestRequiredOrigins } from '../shared/permissions.js';

const $ = (id) => document.getElementById(id);

const TEXT_FIELDS = [
  'topic', 'anchors', 'hardBlock', 'channelBlock', 'channelAllow', 'apiKey', 'apiEndpoint',
];
const CHECK_FIELDS = [
  'enabled', 'useSemantic', 'useTextLlm', 'useVisionLlm', 'useChannelMemory',
  'allowThumbnailUpload', 'debug',
];
const NUM_FIELDS = ['tBlock', 'tAsk', 'visionEscalateBelow', 'maxRequestsPerMinute', 'dailyLlmBudget'];
const SELECT_FIELDS = ['onError', 'modelEmbedding', 'modelText', 'modelVision'];

const LAYER_LABEL = {
  [LAYER.CHANNEL_ALLOW]: 'Guvenli kanal',
  [LAYER.CHANNEL_BLOCK]: 'Engelli kanal',
  [LAYER.LITERAL]: 'Kesin kural',
  [LAYER.SEMANTIC]: 'Anlamsal katman',
  [LAYER.TEXT_LLM]: 'Baglamsal — metin',
  [LAYER.VISION_LLM]: 'Baglamsal — gorsel',
  [LAYER.CACHE]: 'Onbellek',
  [LAYER.ERROR_POLICY]: 'Hata politikasi',
  [LAYER.DISABLED]: 'Kapali',
};

let saveTimer = null;

/* ------------------------------------------------------------------ */

async function load() {
  const s = await getSettings();

  for (const id of TEXT_FIELDS) if ($(id)) $(id).value = s[id] ?? '';
  for (const id of CHECK_FIELDS) if ($(id)) $(id).checked = !!s[id];
  for (const id of NUM_FIELDS) if ($(id)) $(id).value = s[id];
  for (const id of SELECT_FIELDS) if ($(id)) fillSelect(id, s);

  syncOutputs();
  $('keyWarning').hidden = !!s.apiKey;
  $('permWarning').hidden = await hasRequiredOrigins();
  await refreshStats();
}

function fillSelect(id, s) {
  const el = $(id);
  if (id === 'onError') {
    el.value = s.onError;
    return;
  }
  // Model secicileri: dogrulama yapilmadan once yalnizca varsayilan deger bulunur
  const defaults = {
    modelEmbedding: MODELS.embedding,
    modelText: MODELS.text,
    modelVision: MODELS.vision,
  };
  const current = s[id] || defaults[id];
  if (![...el.options].some((o) => o.value === current)) {
    el.add(new Option(current, current));
  }
  el.value = current;
}

function syncOutputs() {
  $('tBlockOut').textContent = Number($('tBlock').value).toFixed(2);
  $('tAskOut').textContent = Number($('tAsk').value).toFixed(2);
  $('visionOut').textContent = Number($('visionEscalateBelow').value).toFixed(2);
}

function collect() {
  const patch = {};
  for (const id of TEXT_FIELDS) if ($(id)) patch[id] = $(id).value;
  for (const id of CHECK_FIELDS) if ($(id)) patch[id] = $(id).checked;
  for (const id of NUM_FIELDS) if ($(id)) patch[id] = Number($(id).value);
  for (const id of SELECT_FIELDS) if ($(id)) patch[id] = $(id).value;

  // Iki esik carpisirsa filtre anlamsizlasir: sorma esigi engelleme esigini gecemez
  if (patch.tAsk >= patch.tBlock) {
    patch.tAsk = Math.max(0.1, patch.tBlock - 0.05);
    $('tAsk').value = patch.tAsk;
    syncOutputs();
  }
  return patch;
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await setSettings(collect());
    $('keyWarning').hidden = !!$('apiKey').value;
    flash($('saveStatus'), 'Kaydedildi');
  }, 350);
}

function flash(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle('err', isError);
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ''; }, 2500);
}

/* ------------------------------------------------------------------ */
/* Model dogrulama                                                     */
/* ------------------------------------------------------------------ */

async function verifyKey() {
  const apiKey = $('apiKey').value.trim();
  const status = $('keyStatus');
  if (!apiKey) return flash(status, 'Once bir anahtar girin', true);

  status.textContent = 'Dogrulaniyor...';
  try {
    const models = await browser.runtime.sendMessage({ type: 'listModels', apiKey });
    const embed = models.filter((m) => m.methods.includes('embedContent'));
    const gen = models.filter((m) => m.methods.includes('generateContent'));

    populate('modelEmbedding', embed, MODELS.embedding);
    populate('modelText', gen, MODELS.text);
    populate('modelVision', gen, MODELS.vision);
    save();
    flash(status, `Gecerli — ${gen.length} uretim, ${embed.length} gomu modeli bulundu`);
  } catch (err) {
    flash(status, `Dogrulanamadi: ${err.message || err}`, true);
  }
}

function populate(id, models, fallback) {
  const el = $(id);
  const prev = el.value;
  el.innerHTML = '';
  for (const m of models) el.add(new Option(m.name, m.name));
  const pick = models.some((m) => m.name === prev) ? prev
    : models.some((m) => m.name === fallback) ? fallback
    : models[0]?.name;
  if (pick) el.value = pick;
}

/* ------------------------------------------------------------------ */
/* Kalibrasyon                                                         */
/* ------------------------------------------------------------------ */

async function probe() {
  const title = $('probeTitle').value.trim();
  if (!title) return;
  const out = $('probeOut');
  out.hidden = false;
  out.textContent = 'Degerlendiriliyor...';

  const res = await browser.runtime.sendMessage({
    type: 'probe',
    item: { title, channel: $('probeChannel').value.trim(), thumbnail: '' },
  });

  const isBlock = res.verdict === VERDICT.BLOCK;
  const rows = [['Karar', isBlock ? 'ENGELLE' : 'GECIR', `verdict-${res.verdict}`]];
  rows.push(['Karari veren', LAYER_LABEL[res.layer] || res.layer]);
  if (res.score != null) rows.push(['Anlamsal skor', res.score.toFixed(4)]);
  if (res.boost) rows.push(['Kanal hafizasi katkisi', `+${res.boost.toFixed(4)}`]);
  if (res.matched) rows.push(['En yakin capa', res.matched]);
  if (res.confidence != null) rows.push(['LLM guveni', res.confidence.toFixed(2)]);
  if (res.reason) rows.push(['Gerekce', res.reason]);
  if (res.error) rows.push(['Hata', res.error]);

  // innerHTML KULLANILMAZ: `reason` model ciktisi, `error` ise sunucu hata
  // metnidir. Ikisi de bizim denetimimiz disinda; sablona gomulurse
  // ayarlar sayfasina isaretleme enjekte edilebilir.
  const dl = document.createElement('dl');
  for (const [k, v, cls] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    if (cls) dd.className = cls;
    dl.append(dt, dd);
  }
  out.replaceChildren(dl);
}

/* ------------------------------------------------------------------ */

function statTiles(host, rows) {
  host.replaceChildren(
    ...rows.map(([label, v]) => {
      const div = document.createElement('div');
      const b = document.createElement('b');
      b.textContent = String(v);
      const span = document.createElement('span');
      span.textContent = label;
      div.append(b, span);
      return div;
    }),
  );
}

async function refreshStats() {
  const s = await browser.runtime.sendMessage({ type: 'getStats' });
  statTiles($('stats'), [
    ['Bugun engellenen', s.blocked || 0],
    ['Bugun gecen', s.allowed || 0],
    ['LLM cagrisi', s.llmCalls || 0],
    ['Hata', s.errors || 0],
    ['Toplam engellenen', s.totalBlocked || 0],
  ]);
}

/* ------------------------------------------------------------------ */

document.addEventListener('input', (e) => {
  if (e.target.type === 'range') syncOutputs();
  if (e.target.closest('.card')) save();
});
document.addEventListener('change', (e) => {
  if (e.target.closest('.card')) save();
});

// Izin istegi tiklamadan DOGRUDAN yapilir — araya await girerse
// tarayici kullanici hareketi baglamini kaybeder ve istegi reddeder.
$('grantPerms').addEventListener('click', () => {
  requestRequiredOrigins().then((granted) => {
    $('permWarning').hidden = granted;
    flash($('saveStatus'), granted ? 'Izinler verildi' : 'Izinler verilmedi', !granted);
  });
});

$('verifyKey').addEventListener('click', verifyKey);
$('probeBtn').addEventListener('click', probe);
$('probeTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') probe(); });

$('toggleKey').addEventListener('click', () => {
  const el = $('apiKey');
  const show = el.type === 'password';
  el.type = show ? 'text' : 'password';
  $('toggleKey').textContent = show ? 'Gizle' : 'Goster';
});

$('clearCache').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'clearCache' });
  await refreshStats();
  flash($('saveStatus'), 'Onbellek ve kanal hafizasi silindi');
});

load();
