import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configHash, embedHash, channelBoost, band } from '../src/shared/scoring.js';
import { DEFAULTS } from '../src/shared/config.js';

const S = (patch = {}) => ({ ...DEFAULTS, ...patch });

/** Kural kumesi kurar — testler artik tek `topic` alanina degil kurallara bakar. */
const R = (anchors, patch = {}) => [
  {
    id: 'r1',
    enabled: true,
    label: 'test',
    description: 'test olcutu',
    anchors,
    literals: [],
    stancePolicy: { destekleyici: 'block', notr: 'block', elestirel: 'allow' },
    minConfidence: 0.6,
    origin: 'user',
    ...patch,
  },
];

/* ---------------- configHash ---------------- */

test('configHash kural degisince degisir', () => {
  assert.notEqual(configHash(S({ rules: R(['a']) })), configHash(S({ rules: R(['b']) })));
});

test('KRITIK: kural nesnesi degisince parmak izi degisir', () => {
  // Duz `${settings[k]}` kullanilsaydi her kural dizisi "[object Object]"
  // olur ve parmak izi HIC degismezdi; onbellek eski kararlari sonsuza
  // kadar dogru sanardi. Sessiz ve teshisi zor bir bozulma.
  const a = S({ rules: R(['lol']) });
  const b = S({ rules: R(['lol'], { minConfidence: 0.9 }) });
  assert.notEqual(configHash(a), configHash(b));
});

test('configHash esik degisince degisir — eski kararlar gecersizlenmeli', () => {
  assert.notEqual(configHash(S({ tCandidate: 0.2 })), configHash(S({ tCandidate: 0.5 })));
});

test('configHash ilgisiz alan degisince AYNI kalir', () => {
  // API anahtari veya hata politikasi karar icerigini degistirmez;
  // onbellegi bosaltmak gereksiz maliyet olurdu
  assert.equal(configHash(S({ apiKey: 'x' })), configHash(S({ apiKey: 'y' })));
  assert.equal(configHash(S({ onError: 'show' })), configHash(S({ onError: 'hide' })));
});

test('configHash kararli — ayni girdi ayni cikti', () => {
  assert.equal(configHash(S({ rules: R(['lol']) })), configHash(S({ rules: R(['lol']) })));
});

/* ---------------- embedHash ---------------- */

test('KRITIK: gomu modeli degisince capa onbellegi gecersizlesir', () => {
  // Farkli gomu modelleri farkli vektor uzaylari uretir. Eski capa vektorleri
  // saklanip yeni video vektorleriyle karsilastirilirsa kosinus skoru
  // tamamen anlamsizlasir — sessiz ve teshisi cok zor bir bozulma.
  assert.notEqual(
    embedHash(S({ modelEmbedding: 'gemini-embedding-001' })),
    embedHash(S({ modelEmbedding: 'text-embedding-004' })),
  );
});

test('embedHash capa degisince degisir', () => {
  assert.notEqual(embedHash(S({ rules: R(['x']) })), embedHash(S({ rules: R(['y']) })));
});

test('embedHash tutum politikasi degisince AYNI kalir — gereksiz yeniden gomu yok', () => {
  // Capalar tutum politikasina bagli degildir. Kullanici "elestireni de
  // engelle" dedi diye butun capalari yeniden gomdurmek bosuna maliyettir.
  const a = S({ rules: R(['lol'], { stancePolicy: { elestirel: 'allow' } }) });
  const b = S({ rules: R(['lol'], { stancePolicy: { elestirel: 'block' } }) });
  assert.equal(embedHash(a), embedHash(b));
});

test('embedHash esik degisince AYNI kalir', () => {
  assert.equal(embedHash(S({ tCandidate: 0.2 })), embedHash(S({ tCandidate: 0.5 })));
});

test('configHash esik degisince degisir ama embedHash degismez', () => {
  const a = S({ tCandidate: 0.2 });
  const b = S({ tCandidate: 0.5 });
  assert.notEqual(configHash(a), configHash(b));
  assert.equal(embedHash(a), embedHash(b));
});

test('configHash gomu modeli degisince de degisir', () => {
  assert.notEqual(
    configHash(S({ modelEmbedding: 'gemini-embedding-001' })),
    configHash(S({ modelEmbedding: 'text-embedding-004' })),
  );
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

test('KRITIK: kanal katkisi ust sinirla bagli — tek basina aday yapamaz', () => {
  // %100 engellenmis kanalda bile katki tavani asamaz.
  // Bu olmazsa kanal kendi istatistigini besleyip geri donusu olmayan
  // bir donguye girer.
  const b = channelBoost({ n: 1000, blocked: 1000 }, S());
  assert.equal(b, DEFAULTS.channelMemoryBoost);
  assert.ok(b < DEFAULTS.tCandidate,
    'katki tek basina aday esigini asmamali — kanal gecmisi delil degil, sinyaldir');
});

test('kanal profili yoksa katki yok', () => {
  assert.equal(channelBoost(null, S()), 0);
  assert.equal(channelBoost({ n: 0, blocked: 0 }, S()), 0);
});

/* ---------------- band ---------------- */

test('band yalnizca aday secer — engelleme bandi YOKTUR', () => {
  const s = S({ tCandidate: 0.42 });
  assert.equal(band(0.42, s), 'ask'); // sinir dahil
  assert.equal(band(0.99, s), 'ask'); // ne kadar yuksek olursa olsun engellemez
  assert.equal(band(0.41, s), 'allow');
  assert.equal(band(-1, s), 'allow'); // capa yoksa bestMatch -1 doner
});

test('KRITIK: anlamsal katman tek basina engelleyemez', () => {
  // Tasarimin cekirdegi: kelime/konu yakinligi ne kadar yuksek olursa olsun
  // karar baglamsal katmana gider. Bu test kirilirsa "elestirel icerik gecsin"
  // sozu de kirilmis demektir.
  const s = S({ tCandidate: 0.1 });
  for (const score of [0.5, 0.8, 0.95, 1.0]) {
    assert.notEqual(band(score, s), 'block', `skor ${score} tek basina engellememeli`);
  }
});
