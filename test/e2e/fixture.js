/**
 * YouTube benzeri sahte sayfa.
 *
 * Gercek YouTube DOM'unun yapisini taklit eder: ayni renderer etiketleri,
 * ayni id/class isimleri. Icerik betigi uretim secicileriyle bunu yakalamali —
 * yakalayamazsa secicilerimiz yanlistir, bu da testin isidir.
 *
 * BASLIKLAR KULLANICININ KENDI OLCUTLERINDEN turetilmistir. Test malzemesinin
 * kullanicinin gercek olcutleriyle ayni alandan gelmesi sart: baska bir alanda
 * "9/9 gecti" demek, filtrenin kullanicinin akisinda calistigina dair hicbir
 * sey soylemez.
 */

export const VIDEOS = [
  /* --- olcut: League of Legends / Valorant --- */
  {
    id: 'aaaaaaaaaa1',
    title: 'LCK finalinde inanılmaz geri dönüş',
    channel: 'Espor Arena',
    expect: 'block',
    why: 'kisaltma — oyunun adi hic gecmiyor',
  },
  {
    id: 'aaaaaaaaaa2',
    title: 'Yeni sezon jungle rotaları ve kamp süreleri',
    channel: 'Rift Rehberi',
    expect: 'block',
    why: 'jargon — oyunun adi gecmiyor',
  },
  {
    id: 'aaaaaaaaaa3',
    title: 'Valorant yeni ajan ilk izlenim',
    channel: 'FPS Günlüğü',
    expect: 'block',
    why: 'dogrudan olcut',
  },
  {
    id: 'aaaaaaaaaa4',
    title: 'League of Legends artık eğlenceli değil, neden bıraktım',
    channel: 'Oyuncu Defteri',
    expect: 'allow',
    why: 'TUTUM: oyunu elestiriyor — kullanici elestirel icerigi gormek istiyor',
  },

  /* --- olcut: magazin --- */
  {
    id: 'bbbbbbbbbb1',
    title: 'Ünlü çiftin ayrılık iddiası kulisleri karıştırdı',
    channel: 'Magazin Bülteni',
    expect: 'block',
    why: 'magazin haberi',
  },

  /* --- olcut: yem baslik / cinsel cagrisim --- */
  {
    id: 'bbbbbbbbbb2',
    title: 'Kameraya böyle yansıdı, görenler inanamadı',
    channel: 'Viral Kutu',
    expect: 'block',
    why: 'yem baslik kalibi',
  },

  /* --- olcut: siddet --- */
  {
    id: 'bbbbbbbbbb3',
    title: 'Sokak ortasında dehşet anları kamerada',
    channel: 'Anlık Haber',
    expect: 'block',
    why: 'siddet icerigi',
  },

  /* --- olcut: dine hakaret (TUTUM eksenli) --- */
  {
    id: 'cccccccccc1',
    title: 'İnananlarla dalga geçen skeç serisi',
    channel: 'Komedi Kanalı',
    expect: 'block',
    why: 'TUTUM: hakaret eden taraf engellenir',
  },
  {
    id: 'cccccccccc2',
    title: 'Dinler tarihi dersi: ilk dönem kaynakları',
    channel: 'Akademi Ders',
    expect: 'allow',
    why: 'TUTUM: konu ayni ama tarafsiz akademik anlatim gecer',
  },

  /* --- olcut disi: hicbir olcute girmeyenler --- */
  {
    id: 'dddddddddd1',
    title: '20 dakikada ev yapımı mercimek çorbası',
    channel: 'Mutfak Günlüğü',
    expect: 'allow',
    why: 'hicbir olcute girmiyor',
  },
  {
    id: 'dddddddddd2',
    title: 'Rust ownership modeli nasıl çalışır?',
    channel: 'Kod Defteri',
    expect: 'allow',
    why: 'hicbir olcute girmiyor',
  },
  {
    id: 'dddddddddd3',
    title: 'How to build a standing desk on a budget',
    channel: 'Workshop Diaries',
    expect: 'allow',
    why: 'Ingilizce, hicbir olcute girmiyor — iki dilli calistigini gosterir',
  },

  /* --- olcut disi spor: canli kural testinde YAN ETKI denetcisi ---
     Kullanici rastgele bir kelime icin kural eklerken bu iki kart GORUNUR
     kalmali. Ayni alandan (spor) olmalari kasitli: yeni kuralin komsu
     basliklara tasip tasmadigini ancak yakin bir konu gosterir. */
  {
    id: 'gsgsgsgsgs1',
    title: 'Galatasaray derbi öncesi son antrenman',
    channel: 'Spor Ajansı',
    expect: 'allow',
    why: 'hicbir olcute girmiyor — eklenen kural buna dokunmamali',
  },
  {
    id: 'gsgsgsgsgs2',
    title: 'Galatasaray taraftarından tribün koreografisi',
    channel: 'Tribün TV',
    expect: 'allow',
    why: 'hicbir olcute girmiyor — eklenen kural buna dokunmamali',
  },

  /* --- kanal listeleri --- */
  {
    id: 'eeeeeeeeee1',
    title: 'Haftanın en iyi 10 fotoğrafı',
    channel: 'Engelli Kanal',
    expect: 'block',
    why: 'kara listedeki kanal',
  },
  {
    id: 'eeeeeeeeee2',
    title: 'LCK final tekrarı ve analiz',
    channel: 'Güvenli Kanal',
    expect: 'allow',
    why: 'beyaz liste her katmani atlar',
  },
];

function card(v) {
  return `
  <ytd-rich-item-renderer class="style-scope ytd-rich-grid-row">
    <div id="content">
      <ytd-thumbnail>
        <a id="thumbnail" href="/watch?v=${v.id}">
          <img src="https://i.ytimg.com/vi/${v.id}/hqdefault.jpg" width="320" height="180" alt="">
        </a>
        <ytd-thumbnail-overlay-time-status-renderer>
          <span id="text">12:34</span>
        </ytd-thumbnail-overlay-time-status-renderer>
      </ytd-thumbnail>
      <div id="details">
        <a id="video-title-link" href="/watch?v=${v.id}" title="${v.title}">
          <yt-formatted-string id="video-title">${v.title}</yt-formatted-string>
        </a>
        <ytd-channel-name id="channel-name">
          <a href="/@kanal">${v.channel}</a>
        </ytd-channel-name>
      </div>
    </div>
  </ytd-rich-item-renderer>`;
}

/**
 * Shorts rafi — ana sayfada gercekte oldugu gibi TEK bir
 * `ytd-rich-item-renderer` icinde uc ayri Short.
 *
 * Kod bu rafi tek video sanip ilk Short'un kararini butun rafa uyguluyordu.
 * Fikstürde bulunmasi sart: yoksa hata testlerde hic gorunmez.
 */
function shortsShelf() {
  const shorts = [
    { id: 'ssssssssss1', title: 'LCK highlights kısa kesit' },
    { id: 'ssssssssss2', title: 'Kedi yavrusu ilk adımları' },
    { id: 'ssssssssss3', title: 'Ekmek nasıl yoğrulur' },
  ];
  return `
  <ytd-rich-item-renderer id="shorts-raf">
    <div id="content">
      ${shorts
        .map(
          (s) => `
        <ytm-shorts-lockup-view-model>
          <a href="/shorts/${s.id}">
            <div class="shortsLockupViewModelHostThumbnail">
              <img src="https://i.ytimg.com/vi/${s.id}/hqdefault.jpg" alt="">
            </div>
          </a>
          <span class="shortsLockupViewModelHostMetadataTitle">${s.title}</span>
        </ytm-shorts-lockup-view-model>`,
        )
        .join('')}
    </div>
  </ytd-rich-item-renderer>`;
}

/**
 * @param videos    sabit kart listesi
 * @param ekKartlar kosum aninda uretilen kartlar ({ id, title, channel })
 *
 * EK KART NEDEN GEREKLI: canli kural testi her kosumda havuzdan RASTGELE bir
 * kelime seciyor. O kelimeyi iceren kart burada sabit duramaz — sabit dursa
 * havuz tek kelimeye kilitlenir ve test yine tek kelimeye ozel bir seyin
 * calistigini olcerdi. Ek kartlar cagirana birakilir; sabit liste degismez,
 * bu yuzden demo.mjs / firefox.mjs / proxy.mjs cagrilari etkilenmez.
 */
export function fixtureHtml(videos = VIDEOS, ekKartlar = []) {
  const hepsi = [...videos, ...ekKartlar];
  return `<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8"><title>YouTube</title>
<style>
  :root { color-scheme: dark; }
  body { background:#0f0f0f; color:#f1f1f1; font:14px/1.4 Roboto,system-ui,sans-serif; margin:0; padding:24px; }
  h1 { font-size:16px; font-weight:500; color:#aaa; margin:0 0 20px; }
  #grid { display:grid; grid-template-columns:repeat(3,1fr); gap:20px 16px; max-width:1100px; }
  ytd-rich-item-renderer { display:block; }
  ytd-thumbnail img { width:100%; height:auto; border-radius:12px; background:#272727; display:block; aspect-ratio:16/9; object-fit:cover; }
  #details { padding:10px 2px 0; }
  #video-title { display:block; font-size:14px; font-weight:500; line-height:1.35; color:#f1f1f1; }
  a { text-decoration:none; color:inherit; }
  ytd-channel-name a { font-size:12px; color:#aaa; display:block; margin-top:5px; }
  ytd-thumbnail { position:relative; display:block; }
  ytd-thumbnail-overlay-time-status-renderer { position:absolute; right:6px; bottom:6px; background:rgba(0,0,0,.8); border-radius:4px; padding:1px 4px; font-size:11px; }
</style></head>
<body>
  <h1>Ana sayfa — önerilenler</h1>
  <div id="grid">${hepsi.map(card).join('')}${shortsShelf()}</div>
</body></html>`;
}

/** Kucuk resim yerine dolu bir JPEG dondurulur (gorsel katman gercek veri gormeli). */
export const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);
