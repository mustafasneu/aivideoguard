import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize, parseList, channelMatches, literalMatches, casefold, videoText,
} from '../src/shared/text.js';

test('Turkce casefold: I/i ayrimi dogru', () => {
  assert.equal(casefold('İSTANBUL'), 'istanbul');
  assert.equal(casefold('ISPARTA'), 'ısparta');
});

test('normalize aksanlari katlar', () => {
  assert.equal(normalize('Erdoğan'), 'erdogan');
  assert.equal(normalize('ŞİŞLİ'), 'sisli');
  assert.equal(normalize('  cok   bosluk '), 'cok bosluk');
});

test('REGRESYON: parseList bos girdileri atar', () => {
  // Eski surumdeki hata: "kanal1, " -> ["kanal1", ""] ve includes("") her zaman true
  // donuyordu; beyaz listede tum filtreyi kapatiyordu.
  assert.deepEqual(parseList('kanal1, '), ['kanal1']);
  assert.deepEqual(parseList('a,,b'), ['a', 'b']);
  assert.deepEqual(parseList(',,,'), []);
  assert.deepEqual(parseList(''), []);
  assert.deepEqual(parseList(null), []);
  assert.deepEqual(parseList('a\nb;c'), ['a', 'b', 'c']);
});

test('REGRESYON: sondaki virgul tum kanallari beyaz listeye almaz', () => {
  const entries = parseList('GuvenliKanal, ');
  assert.equal(channelMatches('Rastgele Baska Kanal', entries), null);
  assert.equal(channelMatches('GuvenliKanal TV', entries), 'GuvenliKanal');
});

test('REGRESYON: bos kara liste her seyi engellemez', () => {
  assert.equal(channelMatches('Herhangi Bir Kanal', parseList('')), null);
  assert.equal(literalMatches('herhangi bir baslik', parseList(', ,')), null);
});

test('kanal eslesmesi aksan ve buyuk-kucuk harf gozetmez', () => {
  assert.equal(channelMatches('Şişli Haber', parseList('sisli')), 'sisli');
  assert.equal(channelMatches('ISPARTA TV', parseList('ısparta')), 'ısparta');
});

test('literal eslesme normalize edilmis substring arar', () => {
  assert.equal(literalMatches('Bugün Erdoğan açıklama yaptı', parseList('erdogan')), 'erdogan');
  assert.equal(literalMatches('alakasiz baslik', parseList('erdogan')), null);
});

test('videoText baslik ve kanali birlestirir', () => {
  assert.equal(videoText({ title: 'A', channel: 'B' }), 'A — Kanal: B');
  assert.equal(videoText({ title: 'A', channel: '' }), 'A');
});
