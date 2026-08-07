import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configHash, channelBoost, band } from '../src/shared/scoring.js';
import { DEFAULTS } from '../src/shared/config.js';

const S = (patch = {}) => ({ ...DEFAULTS, ...patch });

/* ---------------- configHash ---------------- */

test('configHash konu degisince degisir', () => {
  assert.notEqual(configHash(S({ topic: 'a' })), configHash(S({ topic: 'b' })));
});

test('configHash esik degisince degisir — eski kararlar gecersizlenmeli', () => {
  assert.notEqual(configHash(S({ tBlock: 0.7 })), configHash(S({ tBlock: 0.8 })));
});

test('configHash ilgisiz alan degisince AYNI kalir', () => {
  // API anahtari veya hata politikasi karar icerigini degistirmez;
  // onbellegi bosaltmak gereksiz maliyet olurdu
  assert.equal(configHash(S({ apiKey: 'x' })), configHash(S({ apiKey: 'y' })));
  assert.equal(configHash(S({ onError: 'show' })), configHash(S({ onError: 'hide' })));
});

test('configHash kararli — ayni girdi ayni cikti', () => {
  assert.equal(configHash(S({ topic: 'siyaset' })), configHash(S({ topic: 'siyaset' })));
});

/* ---------------- channelBoost ---------------- */

test('kanal hafizasi kapaliyken katki yok', () => {
  const p = { n: 100, blocked: 100 };
  assert.equal(channelBoost(p, S({ useChannelMemory: false })), 0);
});

test('yetersiz ornekte katki yok', () => {
  // 3 < channelMemoryMinSamples (4)
  assert.equal(channelBoost({ n: 3, blocked: 3 }, S()), 0);
});

test('dusuk engellenme oraninda katki yok', () => {
  // 2/10 = 0.2 < 0.6
  assert.equal(channelBoost({ n: 10, blocked: 2 }, S()), 0);
});

test('yuksek engellenme orani katki uretir', () => {
  const b = channelBoost({ n: 10, blocked: 9 }, S());
  assert.ok(b > 0);
  assert.ok(b <= DEFAULTS.channelMemoryBoost);
});

test('KRITIK: kanal katkisi ust sinirla bagli — tek basina engelleyemez', () => {
  // %100 engellenmis kanalda bile katki tavani asamaz.
  // Bu olmazsa kanal kendi istatistigini besleyip geri donusu olmayan
  // bir donguye girer.
  const b = channelBoost({ n: 1000, blocked: 1000 }, S());
  assert.equal(b, DEFAULTS.channelMemoryBoost);
  assert.ok(b < DEFAULTS.tBlock - DEFAULTS.tAsk,
    'katki, sorma bandinin genisliginden kucuk olmali');
});

test('kanal profili yoksa katki yok', () => {
  assert.equal(channelBoost(null, S()), 0);
  assert.equal(channelBoost({ n: 0, blocked: 0 }, S()), 0);
});

/* ---------------- band ---------------- */

test('band esikleri dogru ayirir', () => {
  const s = S({ tBlock: 0.74, tAsk: 0.42 });
  assert.equal(band(0.80, s), 'block');
  assert.equal(band(0.74, s), 'block');   // sinir dahil
  assert.equal(band(0.60, s), 'ask');
  assert.equal(band(0.42, s), 'ask');     // sinir dahil
  assert.equal(band(0.41, s), 'allow');
  assert.equal(band(-1, s), 'allow');     // capa yoksa bestMatch -1 doner
});
