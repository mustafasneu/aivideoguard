/**
 * YouTube benzeri sahte sayfa.
 *
 * Gercek YouTube DOM'unun yapisini taklit eder: ayni renderer etiketleri,
 * ayni id/class isimleri. Icerik betigi uretim secicileriyle bunu yakalamali —
 * yakalayamazsa secicilerimiz yanlistir, bu da testin isidir.
 */

export const VIDEOS = [
  // --- konuyla ILGILI olmasi beklenenler ---
  { id: 'aaaaaaaaaa1', title: 'Meclis genel kurulunda bütçe tartışması kızıştı', channel: 'Gündem Analiz', expect: 'block', why: 'konuyla dogrudan ilgili' },
  { id: 'aaaaaaaaaa2', title: 'Kulisler hareketli: koalisyon görüşmeleri sürüyor', channel: 'Ankara Kulis', expect: 'block', why: 'anlamsal — ortak kelime yok' },
  { id: 'aaaaaaaaaa3', title: 'Seçim güvenliği için yeni düzenleme', channel: 'Gündem Analiz', expect: 'block', why: 'kanal hafizasi destekli' },

  // --- ILGISIZ olmasi beklenenler ---
  { id: 'bbbbbbbbbb1', title: '20 dakikada ev yapımı mercimek çorbası', channel: 'Mutfak Günlüğü', expect: 'allow', why: 'tamamen ilgisiz' },
  { id: 'bbbbbbbbbb2', title: 'Rust ownership modeli nasıl çalışır?', channel: 'Kod Defteri', expect: 'allow', why: 'tamamen ilgisiz' },
  { id: 'bbbbbbbbbb3', title: 'Kayseri Erciyes kayak sezonu açıldı', channel: 'Gezi Rotası', expect: 'allow', why: 'ilgisiz' },

  // --- kesin kurallar ---
  { id: 'cccccccccc1', title: 'Bu videoda büyük SPOILER var, dikkat!', channel: 'Dizi Kutusu', expect: 'block', why: 'literal kesin kural' },
  { id: 'cccccccccc2', title: 'Haftanın en iyi 10 fotoğrafı', channel: 'Engelli Kanal', expect: 'block', why: 'kara listedeki kanal' },
  { id: 'cccccccccc3', title: 'Meclis genel kurulundan son dakika', channel: 'Güvenli Kanal', expect: 'allow', why: 'beyaz liste her katmani atlar' },
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

export function fixtureHtml(videos = VIDEOS) {
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
  <div id="grid">${videos.map(card).join('')}</div>
</body></html>`;
}

/** Kucuk resim yerine dolu bir JPEG dondurulur (gorsel katman gercek veri gormeli). */
export const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);
