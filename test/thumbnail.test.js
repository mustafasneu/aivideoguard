import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedThumbnail } from '../src/shared/thumbnail.js';

test('gecerli YouTube kucuk resim adresleri kabul edilir', () => {
  assert.ok(isAllowedThumbnail('https://i.ytimg.com/vi/abc/hqdefault.jpg'));
  assert.ok(isAllowedThumbnail('https://i9.ytimg.com/vi/abc/mq.jpg?sqp=x'));
  assert.ok(isAllowedThumbnail('https://img.youtube.com/vi/abc/0.jpg'));
});

test('REGRESYON: kanal avatari alan adi REDDEDILIR', () => {
  // Gorsel katman videonun kucuk resmini degerlendirmeli, kanal logosunu degil.
  // Eskiden karttaki "en buyuk" <img> secildigi icin duzenli olarak avatar
  // seciliyordu — avatarlar akista tekrar ettigi icin onbellekten yuklu gelir.
  assert.equal(isAllowedThumbnail('https://yt3.ggpht.com/ytc/AAA=s88-c-k'), false);
  assert.equal(isAllowedThumbnail('https://lh3.googleusercontent.com/a/AAA'), false);
});

test('http ve protokolsuz adresler reddedilir', () => {
  assert.equal(isAllowedThumbnail('http://i.ytimg.com/vi/abc/hq.jpg'), false);
  assert.equal(isAllowedThumbnail('//i.ytimg.com/vi/abc/hq.jpg'), false);
  assert.equal(isAllowedThumbnail('data:image/jpeg;base64,AAAA'), false);
  assert.equal(isAllowedThumbnail('javascript:alert(1)'), false);
});

test('KRITIK: alan adi taklidi reddedilir', () => {
  // Sinir `(^|\.)` ile bagli olmasaydi bunlar gecerdi
  assert.equal(isAllowedThumbnail('https://evil-ytimg.com/x.jpg'), false);
  assert.equal(isAllowedThumbnail('https://ytimg.com.evil.tr/x.jpg'), false);
  assert.equal(isAllowedThumbnail('https://notimg.youtube.com.attacker.net/x.jpg'), false);
  // ...ama gercek alt alan adlari gecmeli
  assert.ok(isAllowedThumbnail('https://i.ytimg.com/x.jpg'));
});

test('bozuk girdide patlamaz', () => {
  assert.equal(isAllowedThumbnail(''), false);
  assert.equal(isAllowedThumbnail(null), false);
  assert.equal(isAllowedThumbnail(undefined), false);
  assert.equal(isAllowedThumbnail('sacma sapan'), false);
  assert.equal(isAllowedThumbnail(42), false);
});
