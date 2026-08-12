/**
 * DETERMINISTIK KATMANIN testleri — hicbiri ag ya da LLM gerektirmez.
 *
 * Bu dosya karar hattinin LLM'e gitmeden once verdigi TUM kararlari kapsar:
 * kural sematigi, deterministik kalip yetkisi, tutum politikasi ve guven
 * esigi. Bu katman yanlissa ustundeki hicbir sey duzeltemez — LLM zaten
 * cagrilmaz.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION,
  makeRule,
  normalizeRules,
  allAnchors,
  allLiterals,
  allPatterns,
  ruleVerdict,
  applyRules,
  patternDecision,
  hasCriticalMarker,
  offlineDecision,
  DEFAULT_STANCE_POLICY,
  STANCE_SCOPED_POLICY,
  HOSTILITY_POLICY,
} from '../src/shared/rules.js';
import { literalMatches, channelMatches, normalize } from '../src/shared/text.js';

/* ---------------- kural semasi ---------------- */

test('makeRule varsayilan olarak TUTUM-DUYARLI kural uretir', () => {
  // Belirsizlikte pahali tarafa dusmek dogrudur: gereksiz bir LLM cagrisi,
  // tutum okunmadan yanlis engellemekten iyidir.
  const r = makeRule({ description: 'test' });
  assert.equal(r.stanceSensitive, true);
  assert.deepEqual(r.patterns, []);
});

test('normalizeRules bos kayitlari atar, kimlikleri tekillestirir', () => {
  const out = normalizeRules([
    { id: 'a', description: 'gecerli', anchors: ['x'] },
    { id: 'a', description: 'ayni kimlik', anchors: ['y'] },
    { id: 'b' }, // ne aciklama ne capa — gurultu
    null,
  ]);
  assert.equal(out.length, 2);
  assert.notEqual(out[0].id, out[1].id, 'ayni kimlik iki kurala verilemez');
});

test('kapali kurallarin capalari ve kaliplari toplanmaz', () => {
  const rules = [
    makeRule({ id: 'r1', description: 'acik', anchors: ['a1'], literals: ['l1'] }),
    makeRule({ id: 'r2', description: 'kapali', anchors: ['a2'], literals: ['l2'], enabled: false }),
  ];
  assert.deepEqual(allAnchors(rules).map((a) => a.text), ['a1']);
  assert.deepEqual(allLiterals(rules).map((a) => a.text), ['l1']);
});

test('capa ve kalip hangi kuraldan geldigini tasir', () => {
  const rules = [makeRule({ id: 'r7', description: 'x', anchors: ['lck'] })];
  assert.equal(allAnchors(rules)[0].ruleId, 'r7');
});

/* ---------------- deterministik kalip yetkisi ---------------- */

const match = (text, pattern) => Boolean(literalMatches(text, [pattern]));

test('KRITIK: tutum-DUYARSIZ kuralda kalip TEK BASINA engeller', () => {
  // "Frikik verdi" kalibinda tutum nuansi yoktur; kalibin kendisi zaten
  // istenmeyen seydir. Bu olcutte modele sormak bosuna token ve gecikmedir.
  const rules = [
    makeRule({
      id: 'yem', description: 'yem baslik', patterns: ['frikik verdi'],
      stanceSensitive: false,
    }),
  ];
  const hit = patternDecision('Kadın frikik verdi, görenler şok', rules, match);
  assert.ok(hit, 'kalip yakalanmali');
  assert.equal(hit.ruleId, 'yem');
});

test('KRITIK: tutum-DUYARLI kuralda kalip TEK BASINA engelleyemez', () => {
  // Bu testin kirilmasi, kullanicinin "kelime gecse bile elestiren video
  // gecsin" kuralinin kirilmasi demektir.
  const rules = [
    makeRule({
      id: 'lol', description: 'League of Legends', patterns: ['league of legends'],
      stanceSensitive: true,
    }),
  ];
  const hit = patternDecision('League of Legends artık berbat, bıraktım', rules, match);
  assert.equal(hit, null, 'tutum-duyarli kuralda kalip karar veremez');
});

test('KRITIK: kural YANLIS isaretlense bile elestirel baslik kalipla engellenmez', () => {
  // Bu testin varlik sebebi olculdu: kural uretici "League of Legends"i bir
  // kez tutum-duyarsiz isaretledi ve oyunu birakmayi anlatan video tutum hic
  // okunmadan engellendi. Bayragi duzeltmek yetmez — model bir dahaki sefere
  // yine yanlis isaretleyebilir. Emniyet kemeri kod duzeyinde olmali.
  const yanlisIsaretlenmis = [
    makeRule({
      id: 'lol', description: 'League of Legends', patterns: ['league of legends'],
      stanceSensitive: false, // <- LLM'in HATASI
    }),
  ];
  assert.equal(
    patternDecision('League of Legends artık eğlenceli değil, neden bıraktım', yanlisIsaretlenmis, match),
    null,
    'elestiri isareti varken kalip karar veremez, baglamsal katmana devretmeli',
  );
  // Elestiri isareti yoksa kalip yine calisir
  assert.ok(patternDecision('League of Legends yeni sezon rehberi', yanlisIsaretlenmis, match));
});

test('elestiri belirtecleri iki dilde de yakalanir', () => {
  assert.ok(hasCriticalMarker('Neden bıraktım, anlatıyorum'));
  assert.ok(hasCriticalMarker('Why I left this game for good'));
  assert.ok(hasCriticalMarker('Bu oyun REZALET olmuş'));
  assert.equal(hasCriticalMarker('Yeni sezon rehberi ve ipuçları'), false);
});

test('kalip eslesmesi Turkce buyuk-kucuk ve aksan farkini gozetmez', () => {
  const rules = [
    makeRule({ id: 'y', description: 'y', patterns: ['gogusleri'], stanceSensitive: false }),
  ];
  assert.ok(patternDecision('GÖĞÜSLERİ muhteşem', rules, match));
});

/* ---------------- tutum politikasi ---------------- */

const judgement = (patch) => ({
  ruleId: 'r1', related: true, stance: 'destekleyici', confidence: 0.9, ...patch,
});

test('KONU olcutu: oven engellenir, ELESTIREN gecer', () => {
  const rule = makeRule({ id: 'r1', description: 'lol', stancePolicy: DEFAULT_STANCE_POLICY });
  assert.equal(ruleVerdict(rule, judgement({ stance: 'destekleyici' })), ACTION.BLOCK);
  assert.equal(ruleVerdict(rule, judgement({ stance: 'notr' })), ACTION.BLOCK);
  assert.equal(ruleVerdict(rule, judgement({ stance: 'elestirel' })), ACTION.ALLOW);
});

test('OVGU olcutu: yalnizca oven engellenir, tarafsiz haber GECER', () => {
  // "Teror orgutunu oven icerik" gibi olcutlerde yasak olan sey konunun
  // kendisi degil, ona alinan tavirdir.
  const rule = makeRule({ id: 'r1', description: 'ovgu', stancePolicy: STANCE_SCOPED_POLICY });
  assert.equal(ruleVerdict(rule, judgement({ stance: 'destekleyici' })), ACTION.BLOCK);
  assert.equal(ruleVerdict(rule, judgement({ stance: 'notr' })), ACTION.ALLOW);
  assert.equal(ruleVerdict(rule, judgement({ stance: 'elestirel' })), ACTION.ALLOW);
});

test('HAKARET olcutu: ELESTIREL engellenir, konunun kendisi serbesttir', () => {
  // "Dine hakaret" olcutunde engellenmesi gereken taraf tam da elestirendir.
  // Tek global anahtar bunu KONU olcutuyle ayni anda dogru yapamaz.
  const rule = makeRule({ id: 'r1', description: 'hakaret', stancePolicy: HOSTILITY_POLICY });
  assert.equal(ruleVerdict(rule, judgement({ stance: 'elestirel' })), ACTION.BLOCK);
  assert.equal(ruleVerdict(rule, judgement({ stance: 'notr' })), ACTION.ALLOW);
  assert.equal(ruleVerdict(rule, judgement({ stance: 'destekleyici' })), ACTION.ALLOW);
});

test('ayni tutum, iki farkli kuralda ZIT sonuc verir', () => {
  // Tasariminin can damari tek testte.
  const konu = makeRule({ id: 'a', description: 'oyun', stancePolicy: DEFAULT_STANCE_POLICY });
  const hakaret = makeRule({ id: 'b', description: 'din', stancePolicy: HOSTILITY_POLICY });
  const elestirel = { related: true, stance: 'elestirel', confidence: 0.9 };
  assert.equal(ruleVerdict(konu, elestirel), ACTION.ALLOW);
  assert.equal(ruleVerdict(hakaret, elestirel), ACTION.BLOCK);
});

/* ---------------- guven esigi ---------------- */

test('KRITIK: guven esigin altindaysa engelleme YOK', () => {
  // "Normal insanin rahatsiz olacagi her sey" gibi genis olcutler yuksek
  // guven ister; olmazsa akisin buyuk kismini yutar.
  const genis = makeRule({ id: 'r1', description: 'genis olcut', minConfidence: 0.8 });
  assert.equal(ruleVerdict(genis, judgement({ confidence: 0.79 })), ACTION.ALLOW);
  assert.equal(ruleVerdict(genis, judgement({ confidence: 0.81 })), ACTION.BLOCK);
});

test('related=false ise tutum ne olursa olsun gecer', () => {
  const rule = makeRule({ id: 'r1', description: 'x' });
  assert.equal(ruleVerdict(rule, judgement({ related: false })), ACTION.ALLOW);
});

/* ---------------- eslesen kural cozumu ---------------- */

test('KRITIK: model bilinmeyen kural kimligi dondurdugunde engelleme YOK', () => {
  // Kural bilinmeden politika secilemez. "Engelle" demek keyfi olurdu ve
  // kullanicinin gormek istedigi icerigi sessizce yok ederdi.
  const rules = [makeRule({ id: 'r1', description: 'x' })];
  const out = applyRules(judgement({ ruleId: 'HAYALET' }), rules);
  assert.equal(out.verdict, ACTION.ALLOW);
  assert.equal(out.rule, null);
});

test('applyRules karari veren kurali geri dondurur', () => {
  const rules = [makeRule({ id: 'r1', label: 'Oyun', description: 'x' })];
  const out = applyRules(judgement({ ruleId: 'r1' }), rules);
  assert.equal(out.verdict, ACTION.BLOCK);
  assert.equal(out.rule.label, 'Oyun', 'kullanici neden gizlendigini gorebilmeli');
});

/* ---------------- kanal listeleri ---------------- */

test('kanal eslesmesi normalize edilmis substring', () => {
  assert.equal(channelMatches('Engelli Kanal HD', ['engelli kanal']), 'engelli kanal');
  assert.equal(channelMatches('Güvenli Kanal', ['guvenli kanal']), 'guvenli kanal');
  assert.equal(channelMatches('Baska Kanal', ['engelli kanal']), null);
});

test('KRITIK: bos liste girdisi her seyi eslestirmez', () => {
  // Bos dize `includes('')` ile HER metni eslestirir; eski surumde filtreyi
  // sessizce devre disi birakan hata buydu.
  assert.equal(channelMatches('Herhangi Kanal', ['']), null);
  assert.equal(literalMatches('herhangi bir baslik', ['']), null);
});

test('normalize Turkce I/i ve aksan katlamasini dogru yapar', () => {
  assert.equal(normalize('İSTANBUL'), 'istanbul');
  assert.equal(normalize('Şişli  Ğ'), 'sisli g');
});

/* ---------------- anahtarsiz mod ---------------- */

test('KRITIK: API anahtari olmadan da filtre calisir', () => {
  // Kurulan ama calismayan bir filtre, hic kurulmamis gibidir. Anahtar
  // yoksa capalar birebir eslestirilir.
  const rules = [
    makeRule({ id: 'lol', description: 'League of Legends', anchors: ['LCK', 'Riot Games'] }),
  ];
  const hit = offlineDecision('LCK finalinde inanılmaz geri dönüş', rules, match);
  assert.ok(hit, 'capa birebir eslesmeli');
  assert.equal(hit.ruleId, 'lol');
});

test('KRITIK: anahtarsiz modda da ELESTIREL baslik gecer', () => {
  // Model yokken tutum okunamaz, ama kullanicinin cekirdek kurali yine de
  // korunur: elestiri isareti tasiyan baslik engellenmez.
  const rules = [makeRule({ id: 'lol', description: 'LoL', anchors: ['League of Legends'] })];
  assert.equal(
    offlineDecision('League of Legends berbat olmuş, bıraktım', rules, match),
    null,
  );
});

test('anahtarsiz modda kapali kural calismaz', () => {
  const rules = [
    makeRule({ id: 'x', description: 'kapali', anchors: ['valorant'], enabled: false }),
  ];
  assert.equal(offlineDecision('Valorant yeni ajan', rules, match), null);
});
