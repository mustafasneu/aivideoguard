/**
 * Asgari WebDriver istemcisi (geckodriver).
 *
 * NEDEN PLAYWRIGHT DEGIL: Playwright Firefox'ta eklenti YUKLEYEMEZ — eklenti
 * destegi yalnizca kalici baglamda calisan Chromium icindir. Firefox tarafinda
 * eklentiyi surmenin desteklenen yolu geckodriver'in WebDriver uzantisi olan
 * `POST /session/{id}/moz/addon/install` ucudur.
 *
 * Yeni bagimlilik eklenmedi: Node 18'in yerlesik `fetch`'i yetiyor.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

/** Bos bir TCP portu bul — sabit port kullanmak paralel kosumda catisir. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startGeckodriver({ verbose = false } = {}) {
  const port = await freePort();
  const proc = spawn('geckodriver', ['--port', String(port), '--host', '127.0.0.1'], {
    stdio: verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });

  const log = [];
  if (!verbose) {
    proc.stdout?.on('data', (d) => log.push(String(d)));
    proc.stderr?.on('data', (d) => log.push(String(d)));
  }

  const base = `http://127.0.0.1:${port}`;
  // Surucunun dinlemeye baslamasini bekle
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) {
      throw new Error(`geckodriver ${proc.exitCode} koduyla cikti:\n${log.join('')}`);
    }
    try {
      const r = await fetch(`${base}/status`);
      if (r.ok) return { base, proc, log, stop: () => proc.kill('SIGTERM') };
    } catch {
      /* henuz dinlemiyor */
    }
    await sleep(100);
  }
  proc.kill('SIGKILL');
  throw new Error(`geckodriver 10 sn icinde baslamadi:\n${log.join('')}`);
}

/**
 * WebDriver hatalari JSON govdesinde gelir; HTTP durumu tek basina yeterli
 * tani vermez. Mesaji ve stack'i yuzeye cikariyoruz — aksi halde her hata
 * "500 Internal Server Error" olarak gorunur ve hata ayiklamak imkansizlasir.
 */
async function call(base, method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`WebDriver ${method} ${path} -> govde JSON degil: ${text.slice(0, 300)}`);
  }
  if (json.value && json.value.error) {
    const e = new Error(`${json.value.error}: ${json.value.message}`);
    e.webdriver = json.value;
    throw e;
  }
  if (!res.ok) {
    throw new Error(`WebDriver ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return json.value;
}

export class Session {
  constructor(base, id) {
    this.base = base;
    this.id = id;
  }

  static async create(base, capabilities) {
    const value = await call(base, 'POST', '/session', { capabilities });
    return new Session(base, value.sessionId);
  }

  #call(method, path, body) {
    return call(this.base, method, `/session/${this.id}${path}`, body);
  }

  /**
   * Imzasiz eklentiyi GECICI olarak kurar. Kalici kurulum imza ister;
   * gecici kurulum istemez ve tarayici kapaninca kendiliginden kalkar.
   */
  installAddon(path, temporary = true) {
    return this.#call('POST', '/moz/addon/install', { path, temporary });
  }

  go(url) {
    return this.#call('POST', '/url', { url });
  }

  url() {
    return this.#call('GET', '/url');
  }

  /** Sayfa baglaminda senkron betik. `args` dizisi betige aktarilir. */
  execute(script, args = []) {
    return this.#call('POST', '/execute/sync', { script, args });
  }

  /** Geri cagrili betik — son argüman `resolve`dir. */
  executeAsync(script, args = []) {
    return this.#call('POST', '/execute/async', { script, args });
  }

  setTimeouts(t) {
    return this.#call('POST', '/timeouts', t);
  }

  windowHandles() {
    return this.#call('GET', '/window/handles');
  }

  switchToWindow(handle) {
    return this.#call('POST', '/window', { handle });
  }

  async newTab() {
    const { handle } = await this.#call('POST', '/window/new', { type: 'tab' });
    await this.switchToWindow(handle);
    return handle;
  }

  closeWindow() {
    return this.#call('DELETE', '/window');
  }

  /**
   * Tarayici arayuzu (chrome) baglamina gecer. Izin balonu gibi icerik
   * disindaki ogeler yalnizca bu baglamdan gorulebilir.
   */
  setContext(context) {
    return this.#call('POST', '/moz/context', { context });
  }

  screenshotBase64() {
    return this.#call('GET', '/screenshot');
  }

  /** Kosul saglanana kadar bekler; `fn` true donerse cikar. */
  async waitFor(fn, { timeout = 20000, interval = 250, label = 'kosul' } = {}) {
    const started = Date.now();
    let last;
    while (Date.now() - started < timeout) {
      try {
        last = await fn();
        if (last) return last;
      } catch (err) {
        last = err;
      }
      await sleep(interval);
    }
    throw new Error(
      `zaman asimi (${timeout}ms): ${label}` +
        (last instanceof Error ? ` — son hata: ${last.message}` : ''),
    );
  }

  quit() {
    return call(this.base, 'DELETE', `/session/${this.id}`);
  }
}
