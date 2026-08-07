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

/** Bir videoyu temsil eden gomulecek metin. */
export function videoText({ title, channel }) {
  const parts = [];
  if (title) parts.push(title.trim());
  if (channel) parts.push(`Kanal: ${channel.trim()}`);
  return parts.join(' — ');
}
