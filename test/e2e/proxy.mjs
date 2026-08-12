/**
 * Fikstur vekil sunucusu (Firefox kosumu icin).
 *
 * NEDEN VEKIL: Chrome tarafinda istekleri Playwright'in `context.route`'u
 * karsiliyor — ama SADECE sayfadan cikan istekleri. Arka plan service
 * worker'indan cikan istekler (Gemini cagrisi, kucuk resim indirme)
 * yakalanamiyor. Bu yuzden Chrome kosumunda gorsel katman HIC calismiyordu:
 * `fetchThumbnail` gercek i.ytimg.com'a gidiyor, sahte video kimligi 404
 * donuyor ve katman sessizce dusuyordu.
 *
 * Firefox'ta vekil TARAYICI GENELINDE calisir; arka plandan cikan istekler de
 * buradan gecer. Boylece icerik katmani (kapak gorseli) gercekten sinanabilir.
 *
 * NEDEN TLS: `isAllowedThumbnail` yalnizca https kabul eder — ve etmelidir,
 * bu bir guvenlik kurali. Duz HTTP ile calismak icin uretim kodunu gevsetmek
 * testi degersiz kilardi. Bunun yerine vekil kendi sertifikasiyla TLS
 * sonlandirir; Firefox oturumu `acceptInsecureCerts` ile acildigi icin
 * sertifikayi sorgusuz kabul eder. Uretim kodu hic degismez.
 */

import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureHtml, TINY_JPEG } from './fixture.js';

/**
 * Test icin tek kullanimlik kendinden imzali sertifika.
 *
 * `openssl` her platformda bulunmaz (Windows'ta varsayilan olarak yoktur).
 * Bulunamazsa acik bir mesajla durulur — Node yiginini kusmak, sorunun
 * eksik bir arac oldugunu gizlerdi.
 */
function makeCert() {
  const dir = mkdtempSync(join(tmpdir(), 'aivg-cert-'));
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', key, '-out', cert, '-days', '1',
      '-subj', '/CN=aivg-test-proxy',
      '-addext',
      'subjectAltName=DNS:youtube.com,DNS:*.youtube.com,DNS:ytimg.com,DNS:*.ytimg.com',
    ], { stdio: 'ignore' });
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(
      'Firefox kosumu icin `openssl` gerekiyor ama bulunamadi.\n' +
        '  Linux : zaten kurulu, degilse  sudo apt install openssl\n' +
        '  macOS : zaten kurulu, degilse  brew install openssl\n' +
        '  Windows: Git for Windows ile gelir (Git Bash icinden kosun)\n' +
        '  Not: bu yalnizca FIREFOX ucundan uca kosumu icindir.\n' +
        '       Eklentinin kendisi ve Chrome/Opera kosumu openssl istemez.\n' +
        `  Ayrinti: ${err.message}`,
    );
  }
  return {
    key: readFileSync(key),
    cert: readFileSync(cert),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export async function startFixtureProxy() {
  // `other` sayaci tek basina kordur: hangi adreslerin dustugunu kaydetmezsek
  // "gecti" demek kanit olmaz.
  const counters = { page: 0, image: 0, other: 0, connect: 0 };
  const unhandled = new Map();
  const note = (host) => unhandled.set(host, (unhandled.get(host) || 0) + 1);

  function handle(req, res) {
    let url;
    try {
      // Duz vekil kipinde istek satiri mutlak adres tasir; TLS sonlandirmadan
      // sonra ise yalnizca yol gelir, host basliktan okunur.
      url = new URL(req.url.startsWith('http') ? req.url : `https://${req.headers.host}${req.url}`);
    } catch {
      res.writeHead(400).end('bozuk adres');
      return;
    }

    const host = url.hostname;

    if (host.endsWith('youtube.com') && !host.startsWith('i.')) {
      counters.page++;
      const body = fixtureHtml();
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
      });
      res.end(body);
      return;
    }

    if (host.endsWith('ytimg.com') || host === 'img.youtube.com') {
      counters.image++;
      res.writeHead(200, {
        'content-type': 'image/jpeg',
        'content-length': TINY_JPEG.length,
        'cache-control': 'no-store',
      });
      res.end(TINY_JPEG);
      return;
    }

    counters.other++;
    note(host);
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`vekil bu adresi karsilamiyor: ${url.href}`);
  }

  const tls = makeCert();
  const httpsServer = createHttpsServer({ key: tls.key, cert: tls.cert }, handle);
  const server = createHttpServer(handle);

  // CONNECT: tuneli biz sonlandiriyoruz. Istemciye "kuruldu" dedikten sonra
  // ayni soketi kendi TLS sunucumuza devrediyoruz.
  server.on('connect', (req, socket) => {
    counters.connect++;
    const host = (req.url || '').split(':')[0];
    if (!/(^|\.)(youtube\.com|ytimg\.com)$/.test(host)) {
      note(`CONNECT ${host}`);
      socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return;
    }
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.on('error', () => {});
    httpsServer.emit('connection', socket);
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  return {
    port,
    counters,
    unhandledHosts: () => [...unhandled.entries()].sort((a, b) => b[1] - a[1]),
    close: () =>
      new Promise((r) =>
        server.close(() => {
          httpsServer.close(() => {
            tls.cleanup();
            r();
          });
        }),
      ),
  };
}
