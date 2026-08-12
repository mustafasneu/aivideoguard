import browser from 'webextension-polyfill';
import { getSettings, setSettings } from '../shared/storage.js';
import { DEFAULTS, MODELS, LAYER, VERDICT } from '../shared/config.js';
import { hasRequiredOrigins, requestRequiredOrigins } from '../shared/permissions.js';
import {
  ACTION, makeRule,
  DEFAULT_STANCE_POLICY, STANCE_SCOPED_POLICY, HOSTILITY_POLICY,
} from '../shared/rules.js';

const $ = (id) => document.getElementById(id);

const TEXT_FIELDS = [
  'criteriaText', 'channelBlock', 'channelAllow', 'apiKey', 'apiEndpoint',
];
const CHECK_FIELDS = [
  'enabled', 'useSemantic', 'useTextLlm', 'useVisionLlm', 'useChannelMemory',
  'allowThumbnailUpload', 'blockCritical', 'blockNeutral', 'debug',
];
const NUM_FIELDS = ['tCandidate', 'visionEscalateBelow', 'maxRequestsPerMinute', 'dailyLlmBudget'];
const SELECT_FIELDS = ['onError', 'visionScope', 'modelEmbedding', 'modelText', 'modelVision'];

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
  // Sabit secenekli alanlar: listeyi HTML tanimlar, burada yalnizca deger secilir
  if (id === 'onError' || id === 'visionScope') {
    el.value = s[id];
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
  $('tCandidateOut').textContent = Number($('tCandidate').value).toFixed(2);
  $('visionOut').textContent = Number($('visionEscalateBelow').value).toFixed(2);
}

function collect() {
  const patch = {};
  for (const id of TEXT_FIELDS) if ($(id)) patch[id] = $(id).value;
  for (const id of CHECK_FIELDS) if ($(id)) patch[id] = $(id).checked;
  for (const id of NUM_FIELDS) if ($(id)) patch[id] = Number($(id).value);
  for (const id of SELECT_FIELDS) if ($(id)) patch[id] = $(id).value;
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

/* ------------------------------------------------------------------ */
/* Kural yazan katman                                                  */
/* ------------------------------------------------------------------ */

// Onaylanmamis oneri burada bekler. Kullanici onaylayana kadar HICBIR SEY
// kaydedilmez — kullanicinin kural kumesini arkasindan degistirmek, filtrenin
// neden oyle davrandigini anlasilmaz kilardi.
let proposal = null;

const STANCE_LABEL = {
  block: 'engelle',
  allow: 'gecir',
};

const ACTION_BLOCK = ACTION.BLOCK;
const POLICY_BY_KIND = {
  konu: DEFAULT_STANCE_POLICY,
  ovgu: STANCE_SCOPED_POLICY,
  hakaret: HOSTILITY_POLICY,
};

/** Kayitli kural seti — duzenleme bunun uzerinde yapilir. */
let currentRules = [];

/** Duzenlemeden sonra depoya yaz. Silinen kurallar burada elenir. */
async function persistRules() {
  currentRules = currentRules.filter((r) => !r.__deleted);
  await setSettings({ rules: currentRules });
  // Kural degisimi tum kararlari gecersizler.
  await browser.runtime.sendMessage({ type: 'clearCache' });
  renderRules(currentRules, $('rulesList'), true, persistRules);
  flash($('rulesStatus'), `${currentRules.length} kural kaydedildi, onbellek temizlendi`);
}

/**
 * Kural kartini DOM olarak kurar.
 *
 * `innerHTML` KULLANILMAZ: kural metinleri modelden gelir ve kullanici
 * tarafindan duzenlenir; ikisi de kacissiz metin kaynagidir.
 *
 * @param {boolean} editable Duzenleme denetimleri gosterilsin mi?
 *   Oneri listesinde kapali (henuz kaydedilmemis), kayitli listede acik.
 */
function ruleCard(rule, editable = false, onChange = null) {
  const box = document.createElement('div');
  box.className = 'rule';
  if (rule.enabled === false) box.classList.add('rule-off');

  const head = document.createElement('div');
  head.className = 'rule-head';

  if (editable) {
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = rule.enabled !== false;
    toggle.title = 'Kurali ac / kapat';
    toggle.addEventListener('change', () => {
      rule.enabled = toggle.checked;
      box.classList.toggle('rule-off', !toggle.checked);
      onChange?.();
    });
    head.append(toggle);
  }

  const name = document.createElement('b');
  name.textContent = rule.label || '(adsiz)';
  head.append(name);

  if (editable) {
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn ghost';
    edit.textContent = 'Duzenle';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn ghost';
    del.textContent = 'Sil';
    edit.addEventListener('click', () => openEditor(rule, onChange));
    del.addEventListener('click', () => {
      // Silme geri alinamaz; kullanici ne sildigini gorerek onaylamali.
      if (!confirm(`"${rule.label}" kurali silinsin mi?`)) return;
      rule.__deleted = true;
      box.remove();
      onChange?.();
    });
    head.append(spacer, edit, del);
  }

  const desc = document.createElement('div');
  desc.className = 'hint';
  desc.textContent = rule.description;

  const anchors = document.createElement('div');
  anchors.className = 'chips';
  for (const a of rule.anchors) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = a;
    anchors.append(chip);
  }

  const policy = document.createElement('div');
  policy.className = 'hint';
  const p = rule.stancePolicy || {};
  policy.textContent =
    `Oven: ${STANCE_LABEL[p.destekleyici] || '?'} · ` +
    `Tarafsiz: ${STANCE_LABEL[p.notr] || '?'} · ` +
    `Elestiren: ${STANCE_LABEL[p.elestirel] || '?'} · ` +
    `guven esigi ${rule.minConfidence}` +
    (rule.stanceSensitive === false ? ' · kalip yetkili (LLM\'e sorulmaz)' : '');

  box.append(head, desc, anchors, policy);
  return box;
}

function renderRules(rules, container, editable = false, onChange = null) {
  container.replaceChildren();
  for (const r of rules) container.append(ruleCard(r, editable, onChange));
}

/**
 * Kural duzenleyici.
 *
 * Kullanicinin degistirebilmesi gereken her alan burada: ad, kapsam, capalar,
 * kaliplar, tutum politikasi ve guven esigi. Kural seti varsayilanla gelir
 * ama kullanicinin malidir — degistiremedigi bir filtre, ona ait degildir.
 */
function openEditor(rule, onChange) {
  const dlg = document.createElement('dialog');
  dlg.className = 'rule-editor';

  const field = (label, hint, el) => {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const l = document.createElement('span');
    l.className = 'lbl';
    l.textContent = label;
    wrap.append(l);
    if (hint) {
      const h = document.createElement('span');
      h.className = 'hint';
      h.textContent = hint;
      wrap.append(h);
    }
    wrap.append(el);
    return wrap;
  };

  const mk = (tag, props) => Object.assign(document.createElement(tag), props);

  const label = mk('input', { type: 'text', value: rule.label || '' });
  const desc = mk('textarea', { rows: 2, value: rule.description || '' });
  const anchors = mk('textarea', { rows: 5, value: (rule.anchors || []).join('\n') });
  const patterns = mk('textarea', { rows: 3, value: (rule.patterns || []).join('\n') });
  const conf = mk('input', { type: 'number', min: '0', max: '1', step: '0.05', value: rule.minConfidence });

  const policy = mk('select');
  for (const [v, t] of [
    ['konu', 'Konunun kendisi istenmiyor — elestiren gecer'],
    ['ovgu', 'Yalnizca oven/ozendiren engellensin — tarafsiz gecer'],
    ['hakaret', 'Konuya hakaret edeni engelle — konunun kendisi serbest'],
  ]) {
    policy.add(new Option(t, v));
  }
  const p = rule.stancePolicy || {};
  policy.value =
    p.elestirel === ACTION_BLOCK ? 'hakaret' : p.notr === ACTION_BLOCK ? 'konu' : 'ovgu';

  const sensitive = mk('input', { type: 'checkbox', checked: rule.stanceSensitive !== false });

  const body = document.createElement('div');
  body.className = 'editor-body';
  body.append(
    field('Kural adi', '', label),
    field('Kapsam', 'Kendi cumlenizle: bu kural neyi yakalamali?', desc),
    field('Anlam capalari', 'Her satira bir tane. Kelime listesi degil, anlam merkezi.', anchors),
    field('Kesin kaliplar', 'Her satira bir tane. Yalnizca tutum-duyarsiz kuralda kullanilir.', patterns),
    field('Tutum politikasi', '', policy),
    field('Guven esigi', 'Model bu guvenin altindaysa engelleme yapilmaz.', conf),
    field('Tutum okunsun', 'Kapatilirsa kalip eslesmesi tek basina engeller (LLM cagrisi yok).', sensitive),
  );

  const bar = document.createElement('div');
  bar.className = 'row';
  const save = mk('button', { type: 'button', className: 'btn', textContent: 'Kaydet' });
  const cancel = mk('button', { type: 'button', className: 'btn ghost', textContent: 'Vazgec' });
  bar.append(save, cancel);

  const title = mk('h3', { textContent: 'Kurali duzenle' });
  dlg.append(title, body, bar);
  document.body.append(dlg);
  dlg.showModal();

  const close = () => {
    dlg.close();
    dlg.remove();
  };
  cancel.addEventListener('click', close);

  save.addEventListener('click', () => {
    const lines = (el) => el.value.split('\n').map((s) => s.trim()).filter(Boolean);
    rule.label = label.value.trim() || rule.label;
    rule.description = desc.value.trim();
    rule.anchors = lines(anchors);
    rule.patterns = lines(patterns);
    rule.minConfidence = Math.max(0, Math.min(1, Number(conf.value) || 0.65));
    rule.stanceSensitive = sensitive.checked;
    rule.stancePolicy = POLICY_BY_KIND[policy.value];
    rule.origin = 'user';
    close();
    onChange?.();
  });
}

function criteriaLines() {
  return $('criteriaText')
    .value.split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

$('buildRules').addEventListener('click', async () => {
  const descriptions = criteriaLines();
  if (!descriptions.length) {
    flash($('rulesStatus'), 'Once olcutlerinizi yazin', true);
    return;
  }
  flash($('rulesStatus'), `${descriptions.length} olcut icin kural uretiliyor...`);
  try {
    const res = await browser.runtime.sendMessage({ type: 'buildRules', descriptions });
    if (!res?.rules?.length) throw new Error('Kural uretilemedi');
    proposal = res.rules;
    renderRules(proposal, $('proposalBody'));
    if (res.notes?.length) {
      const notes = document.createElement('div');
      notes.className = 'banner warn';
      for (const n of res.notes) {
        const li = document.createElement('div');
        li.textContent = n;
        notes.append(li);
      }
      $('proposalBody').prepend(notes);
    }
    $('rulesProposal').hidden = false;
    flash($('rulesStatus'), `${proposal.length} kural onerildi — onayiniz bekleniyor`);
  } catch (err) {
    flash($('rulesStatus'), `Hata: ${err.message}`, true);
  }
});

$('acceptRules').addEventListener('click', async () => {
  if (!proposal) return;
  await setSettings({ rules: proposal, criteriaText: $('criteriaText').value });
  $('rulesProposal').hidden = true;
  currentRules = proposal;
  renderRules(currentRules, $('rulesList'), true, persistRules);
  proposal = null;
  // Kural degisimi tum onbellegi gecersizler; eski kararlar yeni politikaya
  // gore verilmemisti.
  await browser.runtime.sendMessage({ type: 'clearCache' });
  flash($('rulesStatus'), 'Kurallar kaydedildi, onbellek temizlendi');
});

$('rejectRules').addEventListener('click', () => {
  proposal = null;
  $('rulesProposal').hidden = true;
  flash($('rulesStatus'), 'Oneri atildi, hicbir sey degismedi');
});

$('auditRules').addEventListener('click', async () => {
  const s = await getSettings();
  if (!s.rules?.length) {
    flash($('rulesStatus'), 'Denetlenecek kural yok', true);
    return;
  }
  flash($('rulesStatus'), 'Kural kumesi denetleniyor...');
  try {
    const findings = await browser.runtime.sendMessage({ type: 'auditRules', rules: s.rules });
    const box = $('proposalBody');
    box.replaceChildren();
    if (!findings?.length) {
      flash($('rulesStatus'), 'Denetim temiz — sorun bulunmadi');
      return;
    }
    for (const f of findings) {
      const el = document.createElement('div');
      el.className = 'banner warn';
      const kind = document.createElement('b');
      kind.textContent = `${f.kind}: `;
      el.append(kind, document.createTextNode(f.message));
      if (f.suggestion) {
        const s2 = document.createElement('div');
        s2.className = 'hint';
        s2.textContent = `Oneri: ${f.suggestion}`;
        el.append(s2);
      }
      box.append(el);
    }
    $('rulesProposal').hidden = false;
    flash($('rulesStatus'), `${findings.length} bulgu`);
  } catch (err) {
    flash($('rulesStatus'), `Hata: ${err.message}`, true);
  }
});

// Yeni kural ekleme — kullanicinin kendi kurali, LLM'e sormadan.
$('addRule').addEventListener('click', () => {
  const rule = makeRule({ label: 'Yeni kural', description: '', origin: 'user' });
  openEditor(rule, async () => {
    currentRules.push(rule);
    await persistRules();
  });
});

load().then(async () => {
  const s = await getSettings();
  currentRules = s.rules || [];
  renderRules(currentRules, $('rulesList'), true, persistRules);
});
