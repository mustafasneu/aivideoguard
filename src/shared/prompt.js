/**
 * ISTEM METINLERI — saf, tarayici API'sine bagimsiz.
 *
 * NEDEN AYRI MODUL: istemin dogrulugu ancak GERCEK modele sorularak olculur,
 * ve o olcumu Node'dan yapmak gerekir. `background/llm.js` tarayici API'lerine
 * bagli oldugu icin Node'dan yuklenemiyordu; istemi olcum betiginde yeniden
 * yazmak ise iki surumun sessizce birbirinden ayrilmasi demekti — olctugumuz
 * sey uretimde kullanilan istem olmazdi.
 */

export const STANCE = {
  SUPPORTIVE: 'destekleyici', // konuyu savunuyor / yayiyor / oven
  CRITICAL: 'elestirel', // konuyu elestiriyor / kotuluyor / alay ediyor
  NEUTRAL: 'notr', // haber dili, taraf tutmuyor
  UNRELATED: 'ilgisiz', // konuya hic girmiyor
};

/**
 * Cikti semasi.
 *
 * TEK CAGRIDA TUM KURALLAR: kullanicinin 10-15 olcutu olabilir. Her olcut icin
 * ayri istek atmak video basina 15 cagri demekti — hem gunluk butceyi ilk
 * kaydirmada bitirirdi hem de gecikme kabul edilemez olurdu. Bunun yerine
 * modelden butun kurallara karsi tek seferde bakip EN GUCLU eslesmeyi
 * dondurmesini istiyoruz.
 */

export const BATCH_VERDICT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    verdicts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          i: { type: 'INTEGER' },
          ruleId: { type: 'STRING' },
          related: { type: 'BOOLEAN' },
          stance: {
            type: 'STRING',
            enum: [STANCE.SUPPORTIVE, STANCE.CRITICAL, STANCE.NEUTRAL, STANCE.UNRELATED],
          },
          confidence: { type: 'NUMBER' },
          reason: { type: 'STRING' },
        },
        required: ['i', 'ruleId', 'related', 'stance', 'confidence', 'reason'],
      },
    },
  },
  required: ['verdicts'],
};


/** Kurallari modele okunabilir bicimde serer. */
export function renderRules(rules) {
  return rules
    .map((r) => {
      const parts = [`[${r.id}] ${r.label}: ${r.description}`];
      if (r.anchors.length) {
        parts.push(`     ilgili kavramlar: ${r.anchors.slice(0, 25).join(', ')}`);
      }
      return parts.join('\n');
    })
    .join('\n');
}


export function buildBatchPrompt(rules, items) {
  return [
    'Bir kullanicinin YouTube akisinda GORMEK ISTEMEDIGI icerik olcutleri asagida.',
    'Listedeki HER video icin ayri ayri karar ver.',
    '',
    'OLCUTLER:',
    renderRules(rules),
    '',
    'VIDEOLAR:',
    ...items.map((it, i) => {
      const bits = [`${i}. Baslik: ${it.title || '(yok)'} | Kanal: ${it.channel || '(yok)'}`];
      if (it.literalHit) bits.push(`   (baslikta "${it.literalHit}" ifadesi geciyor)`);
      if (it.channelProfile && it.channelProfile.n >= 3) {
        const ratio = (it.channelProfile.blocked / it.channelProfile.n) * 100;
        bits.push(`   (kanal gecmisi: ${it.channelProfile.n} videonun %${ratio.toFixed(0)}'i olcute giriyordu)`);
      }
      return bits.join('\n');
    }),
    '',
    'NASIL KARAR VERECEKSIN:',
    '- Kelime eslesmesi TEK BASINA karar sebebi DEGILDIR. Olcutun adi baslikta',
    '  gecse bile videonun o konuya nasil YAKLASTIGINA bak.',
    '- Dolayli iliskiyi de say: kisaltma, jargon, takma ad, lakap, kisinin rolu,',
    '  o alanla ozdeslesmis semboller, ima ve gonderme. Olcutun adi hic gecmeden',
    '  de video o olcute girebilir.',
    '- Baslik hangi dilde olursa olsun ayni olculere gore degerlendir.',
    '- Kanal gecmisi tek basina yeterli delil DEGILDIR; destekleyici sinyaldir.',
    '- Emin degilsen confidence dusuk olsun. Tahmin yurutup yuksek guven verme.',
    '',
    'HER VIDEO ICIN DONDUR:',
    '  i       : videonun yukaridaki numarasi',
    '  ruleId  : eslesen olcutun kimligi (ornek: r3), hicbiri eslesmiyorsa bos dize',
    '  related : video o olcute giriyor mu?',
    '  stance  : videonun O OLCUTE karsi durusu',
    `            "${STANCE.SUPPORTIVE}" = savunuyor, oven, ozendiren, masum gosteren`,
    `            "${STANCE.CRITICAL}"   = elestiren, kotuleyen, alay eden, karsi cikan`,
    `            "${STANCE.NEUTRAL}"    = haber/aktarim dili, taraf tutmuyor`,
    `            "${STANCE.UNRELATED}"  = konuya hic girmiyor`,
    '            Ayni konuyu OVEN ile ELESTIREN video farkli islem gorur.',
    '  confidence: 0.0-1.0.  reason: en fazla 12 kelime, Turkce.',
    '',
    `TAM ${items.length} kayit dondur, hicbirini atlama.`,
  ].join('\n');
}

