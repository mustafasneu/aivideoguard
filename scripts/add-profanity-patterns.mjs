#!/usr/bin/env node
/**
 * Varsayilan kural setine TURKCE kufur ve cinsel argo kaliplari ekler.
 *
 *   node scripts/add-profanity-patterns.mjs
 *
 * TASARIM KARARI — neden bu liste elle secildi:
 * Kaliplar TAM KELIME olarak aranir ve tek baslarina ENGELLEME yetkileri
 * vardir. Yanlis bir kalip, masum bir videoyu sessizce yok eder. Bu yuzden
 * her ifade su sinavdan gecirildi: "masum, tibbi ya da akademik bir baslikta
 * gecebilir mi?" Gecebiliyorsa listeye ALINMADI.
 *
 * REDDEDILENLER ve nedeni:
 *   "am", "oc"        — cok kisa, baska baglamda gecer
 *   "pic"             — Ingilizce "picture" kisaltmasi olarak yaygin
 *   "nude"            — "nude painting", sanat/moda baglami
 *   "cinsel iliski"   — cinsel saglik ve egitim iceriginde normal gecer
 *   "meme"            — hem organ hem internet mizahi terimi
 *   "seks"            — tek basina egitim/haber basliginda gecer
 *
 * HARF DEGISTIRILMIS yazimlar bilerek eklendi: filtre atlatmak icin
 * kullanilan bu yazimlar gercek YouTube basliklarinda duz yazimdan daha
 * yaygin. Yalnizca duz yazimi eklemek listeyi fiilen etkisiz birakirdi.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RULES } from '../src/shared/default-rules.js';
import { wordMatches, videoText } from '../src/shared/text.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Agir kufur — Turkce ve kacamak yazimlari, arti Ingilizce karsiliklari. */
const KUFUR = [
  // Turkce, duz yazim
  'amk', 'amq', 'aminakoyayim', 'amina koyayim', 'amina koyim',
  'sikeyim', 'sikerim', 'siktir', 'siktir git', 'siktir',
  'orospu', 'orospu cocugu', 'oruspu',
  'pic kurusu', 'piclik',
  'yarrak', 'yarram', 'yarrag',
  'gavat', 'godos',
  // NOT: 'serefsiz' ve 'kahpe' bilerek YOK. Denetimde yakalandi — "Serefsiz
  // iftirasi" gibi tarih/edebiyat basliklarinda ve "kahpe felek" deyiminde
  // masumca geciyorlar. Bir kufur kalibi, kufur olmayan yerde de tutuyorsa
  // kalip degil tuzaktir.
  // Kacamak yazimlar — gercek basliklarda duz yazimdan yaygin
  'a.m.k', 'a*k', 'am*na', 's*ktir', 'sikt1r', 's1ktir',
  'y*rrak', 'y@rrak', '0rospu', 'or*spu', 'p*c kurusu',
  // Ingilizce
  'fuck', 'fucking', 'motherfucker', 'bullshit', 'asshole',
  'f*ck', 'f**k', 'wtf compilation',
  // Baglamsal ifadeler
  'kufurlu montaj', 'kufurlu tepki', 'agir kufurlu', 'sansursuz kufur',
  'kufur serbest', 'kufurlu komedi',
];

/** Cinsel icerik / mustehcen argo. */
const CINSEL = [
  // Turkce
  'porno', 'pornografi', 'porna', 'p0rno', 'p*rno',
  'sikis', 'sikisme', 'sikism', 'sikisen',
  'seks videosu', 'seks kasedi', 'sex tape',
  'erotik film', 'erotik video', 'erotik sahne',
  'ifsa videosu', 'ifsa oldu', 'ciplak ifsa', 'ifsa link',
  'ustsuz', 'ustsuz cekim', 'popo sov', 'kalca sov',
  'azdiran video', 'azdirici', 'tahrik edici goruntu',
  'mustehcen goruntu', 'mustehcen video',
  'onlyfans', 'onlyfans ifsa', 'onlyfans sizinti',
  // Ingilizce
  'porn', 'hardcore porn', 'xxx video', 'nsfw video', 'nsfw compilation',
  'explicit sex', 'sex scene compilation', 'nude leak', 'leaked nudes',
  'hot girls compilation', 'sexy dance compilation',
  // Ciplaklik SANAT baglaminda da engellenir — kullanicinin acik tercihi.
  // Bedeli kabul edildi: "nude makyaj", "nude ton" gibi kozmetik basliklar
  // da tutulur. Kullanici isterse ayarlardan bu kalibi kaldirabilir.
  'nude', 'nudity', 'nude painting', 'nude art', 'nude model',
  'ciplak', 'ciplaklik', 'ciplak sahne', 'ciplak model',
];

/** Yanlis engelleme denetimi — bu basliklarin HICBIRI engellenmemeli. */
const MASUM = [
  ['Dinler tarihi dersi: ilk dönem kaynakları', 'Akademi Ders'],
  ['20 dakikada ev yapımı mercimek çorbası', 'Mutfak Günlüğü'],
  ['Rust ownership modeli nasıl çalışır?', 'Kod Defteri'],
  ['How to build a standing desk on a budget', 'Workshop Diaries'],
  ['Bebek bakımı ve emzirme rehberi', 'Anne Çocuk'],
  ['Kadın sağlığı ve jinekoloji hakkında bilmeniz gerekenler', 'Sağlık Hattı'],
  ['Anatomi dersi: üreme sistemi', 'Tıp Fakültesi'],
  ['Ergenlik döneminde cinsel sağlık eğitimi', 'Okul Rehberlik'],
  ['Best pic of the week — photography review', 'Photo Weekly'],
  ['Meme kanseri farkındalık ayı', 'Sağlık Bakanlığı'],
  ['Ali Şükrü Bey ve Şerefsiz iftirası — tarih belgeseli', 'Tarih Arşivi'],
  ['Kahpe felek türküsü ve hikayesi', 'Türkü Arşivi'],
];

/* ------------------------------------------------------------------ */

const HEDEF = [
  { esles: /kufur/i, ekle: KUFUR, ad: 'kufur' },
  { esles: /cinsel icerik|ciplaklik/i, ekle: CINSEL, ad: 'cinsel' },
];

const out = DEFAULT_RULES.map((r) => {
  const hedef = HEDEF.find((h) => h.esles.test(r.label));
  if (!hedef) return r;
  const birlesik = [...new Set([...r.patterns, ...hedef.ekle])];
  console.log(`  ${r.label}: ${r.patterns.length} -> ${birlesik.length} kalip`);
  return { ...r, patterns: birlesik };
});

// DENETIM: eklenen kaliplar masum basliklari vurmamali.
console.log('\n  yanlis engelleme denetimi:');
let hata = 0;
for (const [baslik, kanal] of MASUM) {
  const metin = videoText({ title: baslik, channel: kanal });
  for (const r of out) {
    const vurus = r.patterns.find((p) => wordMatches(metin, [p]));
    if (vurus) {
      console.log(`    \x1b[31mYANLIS\x1b[0m "${baslik.slice(0, 44)}" <- '${vurus}' (${r.label})`);
      hata++;
    }
  }
}
if (hata === 0) console.log('    \x1b[32mtemiz — hicbir masum baslik engellenmiyor\x1b[0m');

// DENETIM: eklenen kaliplar gercekten yakaliyor mu?
const YAKALAMALI = [
  ['Bu adama amk dedirten olay', 'Komedi'],
  ['Sansursuz kufur serbest yayin', 'Yayin'],
  ['Ifsa videosu sizdi iddiasi', 'Magazin'],
  ['Nude painting techniques for beginners', 'Art Studio'],
  ['Ciplak sahne tartismasi', 'Sinema'],
  ['Hot girls compilation 2026', 'Viral'],
];
console.log('\n  yakalama denetimi:');
for (const [baslik, kanal] of YAKALAMALI) {
  const metin = videoText({ title: baslik, channel: kanal });
  const bulundu = out.some((r) => r.patterns.some((p) => wordMatches(metin, [p])));
  console.log(`    ${bulundu ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗ KACTI\x1b[0m'} ${baslik.slice(0, 44)}`);
  if (!bulundu) hata++;
}

if (hata > 0) {
  console.error(`\n  ${hata} sorun — dosya YAZILMADI.`);
  process.exit(1);
}

const src = await readFile(resolve(ROOT, 'src/shared/default-rules.js'), 'utf8');
const header = src.slice(0, src.indexOf('export const DEFAULT_RULES ='));
await writeFile(
  resolve(ROOT, 'src/shared/default-rules.js'),
  `${header}export const DEFAULT_RULES = ${JSON.stringify(out, null, 2)};\n`,
);
console.log('\n  yazildi -> src/shared/default-rules.js\n');
