/**
 * Metin normalizasyonu.
 *
 * Turkce'de I/i esleşmesi ozel: "İSTANBUL".toLowerCase() -> "i̇stanbul" (birleşik nokta).
 * Bu yuzden casefold her yerde locale-aware yapilir, ardindan aksan katlanir.
 */

/** Turkce-duyarli kucuk harfe cevirme. */
export function casefold(s) {
  return (s || '').toLocaleLowerCase('tr-TR');
}

/**
 * Aksan/birleşik isaretleri kaldirir: "şğüöçı" -> "sguoci".
 * Literal listede "erdogan" yazan kullanici "Erdoğan" basligini yakalayabilsin diye.
 */
export function deburr(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .replace(/ş/g, 's')
    .replace(/Ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/Ğ/g, 'g');
}

/** Literal karşilastirma icin tam normalizasyon: casefold + deburr + bosluk sadeleştirme. */
export function normalize(s) {
  return deburr(casefold(s)).replace(/\s+/g, ' ').trim();
}

/**
 * Virgul/satirbasi ile ayrilmiş kullanici listesini temizler.
 * Bos girdileri ATAR — bos dize `includes('')` ile her seyi eşleştirdigi icin
 * filtreyi sessizce devre disi birakiyordu (eski surumdeki hata).
 */
export function parseList(raw) {
  return (raw || '')
    .split(/[,\n;]/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

/** Kanal adi eşleşmesi: normalize edilmiş substring. */
export function channelMatches(channel, entries) {
  const c = normalize(channel);
  if (!c) return null;
  for (const e of entries) {
    const n = normalize(e);
    if (n && c.includes(n)) return e;
  }
  return null;
}

/**
 * TAM KELIME eşleşmesi — engelleme yetkisi olan her yerde bu kullanılır.
 *
 * NEDEN SUBSTRING DEĞİL: ölçüldü ve felaketti. "kan" çapası her videoda
 * tuttu, çünkü gömülen metin sonuna "Kanal: ..." ekleniyor. "din" çapası
 * "Dinler tarihi" ve "standing desk" içinde eşleşti. Kısa bir çapa,
 * alt-dize aranınca alakasız kelimelerin içinde kaybolur.
 *
 * Sınırlar normalize edilmiş metin üzerinde aranır; Türkçe harfler zaten
 * ASCII'ye katlandığı için basit sınıf yeterlidir. Çok kelimeli ifadeler
 * de doğru çalışır: yalnızca ifadenin iki ucuna sınır aranır.
 */
export function wordMatches(text, entries) {
  const t = normalize(text);
  if (!t) return null;
  for (const e of entries) {
    const n = normalize(e);
    if (!n) continue;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(t)) return e;
  }
  return null;
}

/** Literal "kesin engelle" eşleşmesi: metinde normalize substring arar. */
export function literalMatches(text, entries) {
  const t = normalize(text);
  if (!t) return null;
  for (const e of entries) {
    const n = normalize(e);
    if (n && t.includes(n)) return e;
  }
  return null;
}

/**
 * Capa ve (istenirse) video metnine uygulanan ORTAK sablon.
 *
 * Tek kelimelik bir capanin ("spoiler") ciplak gomusu, tam cumlelik bir video
 * basligiyla ayni uzayda zayif kalir. Ayni kalibi iki tarafa da uygulamak bu
 * yanliligi dengeler; sablon iki vektorde de ayni yonde katki yaptigi icin
 * karsilastirmada sadelesir.
 *
 * BURADA DURUYOR ki kalibrasyon araci ile uretim ayni kalibi kullansin.
 * Iki yerde ayri ayri yazilsaydi sessizce birbirinden ayrilirlardi ve
 * kalibrasyon sonucu uretimde gecersiz olurdu.
 */
export function anchorTemplate(t) {
  return `${t} konulu video`;
}

/** Bir videoyu temsil eden gomulecek metin. */
export function videoText({ title, channel }) {
  const parts = [];
  if (title) parts.push(title.trim());
  if (channel) parts.push(`Kanal: ${channel.trim()}`);
  return parts.join(' — ');
}
