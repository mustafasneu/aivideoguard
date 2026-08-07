import browser from 'webextension-polyfill';
import { getSettings, setSettings } from '../shared/storage.js';

const $ = (id) => document.getElementById(id);
let timer = null;

function flash(el, text) {
  el.textContent = text;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ''; }, 2000);
}

function save() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    await setSettings({ enabled: $('enabled').checked, topic: $('topic').value });
    flash($('saveStatus'), 'Kaydedildi');
  }, 350);
}

async function init() {
  const s = await getSettings();
  $('enabled').checked = s.enabled;
  $('topic').value = s.topic || '';
  $('keyWarning').hidden = !!s.apiKey;

  const st = await browser.runtime.sendMessage({ type: 'getStats' });
  $('stats').innerHTML = [
    ['Bugun engellenen', st.blocked || 0],
    ['LLM cagrisi', st.llmCalls || 0],
    ['Hata', st.errors || 0],
  ].map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
}

$('enabled').addEventListener('change', save);
$('topic').addEventListener('input', save);
$('openOptions').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
  window.close();
});

init();
