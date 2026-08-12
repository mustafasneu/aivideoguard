#!/usr/bin/env node
/**
 * BAGLAM (tutum) katmani olcumu — gercek model, TEK cagri, gomu YOK.
 *
 *   GEMINI_API_KEY=... node scripts/measure-stance.mjs
 *
 * NEDEN AYRI: tarayici uzerinden olcmek her seferinde ~124 capa gomusu
 * gerektiriyor ve ucretsiz kademenin gunluk gomu kotasi (1000) birkac
 * kosumda tukeniyor. Oysa olculmek istenen sey gomu degil, modelin TUTUMU
 * dogru okuyup okumadigi. Bu betik uretimin AYNI istemini ve AYNI semasini
 * kullanir (`shared/prompt.js`), tek generateContent cagrisi yapar.
 *
 * NE OLCER:
 *   · dogru olcute mi bagladi (odak)
 *   · tutumu dogru mu okudu (baglam)
 *   · kural politikasi uygulaninca beklenen karar cikiyor mu
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBatchPrompt, BATCH_VERDICT_SCHEMA } from '../src/shared/prompt.js';
import { normalizeRules, applyRules, ACTION } from '../src/shared/rules.js';
import { VIDEOS } from '../test/e2e/fixture.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error('GEMINI_API_KEY gerekir.');
  process.exit(2);
}

const MODEL = 'gemini-flash-lite-latest';
const EP = 'https://generativelanguage.googleapis.com/v1beta';

const rulesFile = resolve(ROOT, 'test/e2e/rules.live.json');
const raw = await readFile(rulesFile, 'utf8').then(JSON.parse).catch(() => null);
if (!raw?.rules?.length) {
  console.error(`Kural dosyasi yok: ${rulesFile}\nOnce demo'yu kosup kurallari uretin.`);
  process.exit(2);
}
const rules = normalizeRules(raw.rules).filter((r) => r.enabled);

// Kanal listesi kararlari deterministiktir, LLM'e sorulmaz — olcum disinda.
const CHANNEL_BLOCK = 'Engelli Kanal';
const CHANNEL_ALLOW = 'Güvenli Kanal';
const cards = VIDEOS.filter((v) => v.channel !== CHANNEL_BLOCK && v.channel !== CHANNEL_ALLOW);

const items = cards.map((v) => ({ title: v.title, channel: v.channel }));

console.log(`\nAI Video Guard — baglam katmani olcumu`);
console.log(`  model  : ${MODEL}`);
console.log(`  kural  : ${rules.length}`);
console.log(`  kart   : ${items.length} (kanal listesi kararlari haric)`);
console.log(`  cagri  : 1 generateContent, 0 gomu\n`);

const res = await fetch(`${EP}/models/${MODEL}:generateContent`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
  body: JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: buildBatchPrompt(rules, items) }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: BATCH_VERDICT_SCHEMA,
      maxOutputTokens: Math.min(8192, 400 + items.length * 90),
    },
  }),
});

if (!res.ok) {
  const t = await res.text();
  const v = (JSON.parse(t).error?.details || []).flatMap((d) => d.violations || [])[0];
  console.error(`HTTP ${res.status}${v ? ` [${v.quotaId} sinir=${v.quotaValue}]` : ''}`);
  process.exit(1);
}

const json = await res.json();
const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
if (!text) {
  console.error('Model cikti uretmedi:', JSON.stringify(json).slice(0, 300));
  process.exit(1);
}

const verdicts = JSON.parse(text).verdicts || [];
const byIndex = new Map(verdicts.map((v) => [Number(v.i), v]));

const label = (s) => (s || '').padEnd(13);
let pass = 0;

console.log('  sonuc  beklenen  tutum         kural                      baslik');
console.log('  ' + '─'.repeat(104));

for (let i = 0; i < cards.length; i++) {
  const card = cards[i];
  const v = byIndex.get(i);
  if (!v) {
    console.log(`  \x1b[31m  ?\x1b[0m  model bu kaydi dondurmedi: ${card.title.slice(0, 40)}`);
    continue;
  }
  const { verdict, rule } = applyRules(v, rules);
  const got = verdict === ACTION.BLOCK ? 'block' : 'allow';
  const ok = got === card.expect;
  if (ok) pass++;
  console.log(
    (ok ? '\x1b[32m  ✓\x1b[0m  ' : '\x1b[31m  ✗\x1b[0m  ') +
      got.padEnd(7) +
      card.expect.padEnd(10) +
      label(v.stance) +
      (rule?.label || '—').slice(0, 26).padEnd(27) +
      card.title.slice(0, 40),
  );
  if (!ok) console.log(`         model gerekcesi: ${v.reason} (guven ${v.confidence})`);
}

console.log(`\n  \x1b[1m${pass}/${cards.length}\x1b[0m kart beklendigi gibi`);

// ODAK olcumu: en genis kural (14. madde) kac ILGISIZ karti yakaladi?
const broad = rules.find((r) => /rahatsiz|begenmeyecegi|tiksin/i.test(r.description));
if (broad) {
  const caught = cards.filter((c, i) => byIndex.get(i)?.ruleId === broad.id);
  const wrong = caught.filter((c) => c.expect === 'allow');
  console.log(
    `\n  odak — "${broad.label}" kurali ${caught.length} kart yakaladi, ` +
      `${wrong.length} tanesi YANLIS` +
      (wrong.length === 0 ? ' \x1b[32m(temiz)\x1b[0m' : ' \x1b[31m(akisi yutuyor)\x1b[0m'),
  );
  for (const w of wrong) console.log(`      yanlis: ${w.title}`);
}
console.log('');
