#!/usr/bin/env node
/**
 * Varsayilan kural setine BIREBIR ESLESEN kalip listeleri uretir.
 *
 *   GEMINI_API_KEY=... node scripts/gen-patterns.mjs
 *
 * NEDEN GEREKLI: capalar gomu icin uretilir — kisa ve genis olmalari
 * dogrudur ("kan", "din"). Ama anahtarsiz kipte karar birebir eslesmeyle
 * verilir ve orada bu terimler ise yaramaz: ya hicbir seyi yakalar ya da
 * alakasiz kelimelerin icinde patlar.
 *
 * Bu betik her kural icin AYRI bir kalip listesi uretir: tam kelime olarak
 * arandiginda yalnizca o olcute giren videolari yakalayacak kadar ozgul,
 * gercek basliklarda gecerek yeterince yaygin ifadeler. Iki dilli.
 *
 * Cikti dogrudan `src/shared/default-rules.js` icine yazilir; sonuc SABIT
 * bir urun parcasidir, her acilista yeniden uretilmez.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RULES } from '../src/shared/default-rules.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error('GEMINI_API_KEY gerekir.');
  process.exit(2);
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    rules: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          patterns: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['id', 'patterns'],
      },
    },
  },
  required: ['rules'],
};

const PROMPT = [
  'Bir YouTube icerik filtresi, API anahtari OLMADAN da calisabilmeli.',
  'O kipte karar TAM KELIME eslesmesiyle verilir: baslikta ya da kanal adinda',
  'listedeki ifade tam kelime olarak geciyorsa video gizlenir.',
  '',
  'Asagidaki her olcut icin boyle bir ifade listesi uret.',
  '',
  'KURALLAR:',
  '- Ifadeler YUKSEK KESINLIKLI olmali. Gectiginde video neredeyse kesin o',
  '  olcute giriyor olmali. Bir tereddut varsa o ifadeyi KOYMA — yanlis',
  '  engelleme, kacirmaktan cok daha kotudur.',
  '- Tek basina gecen genel kelimeler YASAK: "video", "kanal", "yeni", "haber",',
  '  "din", "kan", "oyun" gibi. Bunlar alakasiz basliklarda da geciyor.',
  '- Kisaltmalar ve ozel adlar cok degerlidir: lig adlari, turnuva adlari,',
  '  oyun/urun adlari, o alanin ayirt edici jargonu.',
  '- Cok kelimeli ifadeler tercih edilir; tek kelime yalnizca gercekten',
  '  ayirt ediciyse (ornek: "valorant") konulabilir.',
  '- IKI DILLI uret: Turkce ve Ingilizce basliklar icin ayri ifadeler.',
  '- Her olcut icin 10-25 ifade. Emin olamadigin olcutte az sayida ama kesin',
  '  ifade birak; bos birakmak da gecerlidir.',
  '- Ifadeler kucuk harfle, aksansiz yazilmasi gerekmez; sistem normalize eder.',
  '',
  'OLCUTLER:',
  ...DEFAULT_RULES.map((r) => `[${r.id}] ${r.label}: ${r.description}`),
].join('\n');

const res = await fetch(
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: PROMPT }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
        maxOutputTokens: 8192,
      },
    }),
  },
);

if (!res.ok) {
  const t = await res.text();
  console.error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
  process.exit(1);
}

const text = (await res.json())?.candidates?.[0]?.content?.parts?.[0]?.text;
const byId = new Map((JSON.parse(text).rules || []).map((r) => [r.id, r.patterns || []]));

// Cok kisa ya da genel ifadeleri BURADA da eleriz: modelin sozune guvenip
// gecmek, tek bir kotu ifadeyle butun akisi yanlis engellemeye acar.
const TOO_GENERIC = new Set([
  'video', 'kanal', 'haber', 'yeni', 'oyun', 'din', 'kan', 'film', 'muzik',
  'news', 'game', 'video game', 'channel', 'new', 'movie', 'music',
]);

let total = 0;
const out = DEFAULT_RULES.map((r) => {
  const raw = byId.get(r.id) || [];
  const patterns = [...new Set(raw.map((p) => String(p).trim()).filter(Boolean))].filter(
    (p) => p.length >= 4 && !TOO_GENERIC.has(p.toLocaleLowerCase('tr-TR')),
  );
  total += patterns.length;
  console.log(`  ${patterns.length.toString().padStart(3)} kalip  ${r.label}`);
  return { ...r, patterns };
});

const src = await readFile(resolve(ROOT, 'src/shared/default-rules.js'), 'utf8');
const header = src.slice(0, src.indexOf('export const DEFAULT_RULES ='));
await writeFile(
  resolve(ROOT, 'src/shared/default-rules.js'),
  `${header}export const DEFAULT_RULES = ${JSON.stringify(out, null, 2)};\n`,
);

console.log(`\ntoplam ${total} kalip yazildi -> src/shared/default-rules.js`);
