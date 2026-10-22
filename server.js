import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_DURATION = 20 * 60;
const CACHE_TTL = 15 * 60 * 1000;
const TICKET_TTL = 2 * 60 * 60;

class ServiceError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function videoIdFromUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new ServiceError(400, 'URL de YouTube invalida.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
    throw new ServiceError(400, 'Solo se aceptan enlaces HTTPS de YouTube.');
  }
  const id = host === 'youtu.be' ? url.pathname.slice(1) :
    (url.pathname === '/watch' ? url.searchParams.get('v') : null);
  if (!VIDEO_ID.test(id || '')) throw new ServiceError(400, 'Video invalido.');
  return id;
}

function safeEqual(a, b) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function audioUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new ServiceError(502, 'URL de audio invalida.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !url.hostname.endsWith('.googlevideo.com')) {
    throw new ServiceError(502, 'El proveedor no devolvio audio compatible.');
  }
  return url.href;
}

export function extractionFailure(stderr = '') {
  if (/sign in|confirm.*bot|login required|authentication/i.test(stderr)) {
    return 'YouTube exige autenticacion para esta solicitud desde el hosting.';
  }
  if (/requested format.*not available|no video formats/i.test(stderr)) {
    return 'YouTube no devolvio un formato WebM compatible. Revisa la version del extractor.';
  }
  if (/private video|video unavailable|not available in your country|age.restricted/i.test(stderr)) {
    return 'Este video es privado, restringido o no esta disponible desde el hosting.';
  }
  if (/challenge|javascript|js runtime|ejs/i.test(stderr)) {
    return 'Fallo el componente JavaScript del extractor. Revisa yt-dlp y su runtime en el backend.';
  }
  if (/HTTP Error 403|HTTP Error 429/i.test(stderr)) {
    return 'YouTube rechazo o limito la solicitud desde el hosting.';
  }
  return 'No se pudo extraer el audio de YouTube. Revisa la version del extractor y prueba otra cancion.';
}

export async function withCookieFile(source, action) {
  if (!source) return action(null);
  let contents;
  try {
    contents = await readFile(source, 'utf8');
    if (Buffer.byteLength(contents) > 1024 * 1024 ||
        !/^# (?:Netscape HTTP Cookie File|HTTP Cookie File)/.test(contents) ||
        !contents.split(/\r?\n/).some(line => {
          const fields = line.replace(/^#HttpOnly_/, '').split('\t');
          return fields.length === 7 && /^(?:\.)?(?:[\w-]+\.)*youtube\.com$/i.test(fields[0]);
        })) throw new Error('invalid');
  } catch {
    throw new ServiceError(503, 'El archivo de cookies no se pudo leer o no contiene cookies de YouTube en formato Netscape.');
  }
  // yt-dlp writes its cookie jar on exit. Keep the mounted secret read-only
  // and isolate concurrent extractions in private, disposable directories.
  const directory = await mkdtemp(join(tmpdir(), 'sirilo-cookies-'));
  try {
    const file = join(directory, 'cookies.txt');
    await writeFile(file, contents, { mode: 0o600 });
    return await action(file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function extract(target, { search = false } = {}) {
  return withCookieFile(process.env.YTDLP_COOKIES_FILE, cookieFile => new Promise((resolve, reject) => {
    const args = ['-m', 'yt_dlp', '--ignore-config', '--no-warnings', '--no-playlist',
      '--skip-download', '--socket-timeout', '12', '--retries', '1',
      '--extractor-retries', '1', '--js-runtimes', 'node', '--dump-single-json'];
    if (search) args.push('--flat-playlist');
    else args.push('--format', 'bestaudio[ext=webm][protocol=https]');
    if (cookieFile) args.push('--cookies', cookieFile);
    args.push('--', target);
    const child = spawn(process.env.PYTHON || 'python', args, { windowsHide: true });
    const chunks = [];
    let size = 0, settled = false, diagnostic = '';
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new ServiceError(504, 'La consulta de musica tardo demasiado.'));
    }, 28000);
    child.on('error', () => finish(new ServiceError(503, 'No se pudo iniciar yt-dlp.')));
    // Keep bounded stderr only for classification; never expose its raw URLs or secrets.
    child.stderr.on('data', chunk => {
      diagnostic = (diagnostic + chunk.toString('utf8')).slice(-16384);
    });
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        child.kill('SIGKILL');
        finish(new ServiceError(502, 'Respuesta de musica demasiado grande.'));
      } else chunks.push(chunk);
    });
    child.on('close', code => {
      if (code !== 0) {
        const detail = extractionFailure(diagnostic);
        console.error('[sirilo-music] yt-dlp:', detail);
        return finish(new ServiceError(502, detail));
      }
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { finish(new ServiceError(502, 'Respuesta invalida del extractor.')); }
    });
  }));
}

function durationLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function limitedSet(map, key, value, maximum) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > maximum) map.delete(map.keys().next().value);
}

export function createApp({
  apiKey = process.env.API_KEY || '',
  publicBaseUrl = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '',
  extractor = extract,
  fetcher = fetch,
  now = Date.now,
} = {}) {
  if (apiKey.length < 20) throw new Error('API_KEY debe tener al menos 20 caracteres.');
  const publicUrl = new URL(publicBaseUrl);
  if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password ||
      publicUrl.search || publicUrl.hash || publicUrl.pathname !== '/') {
    throw new Error('PUBLIC_BASE_URL debe ser el origen publico del servicio, sin ruta.');
  }
  const origin = publicUrl.origin;
  const metadata = new Map(), searches = new Map(), thumbnails = new Map(), pending = new Map();
  let jobs = 0, listeners = 0;
  let calls = [];

  async function job(action) {
    if (jobs >= 2) throw new ServiceError(429, 'Servicio ocupado. Espera unos segundos.');
    jobs++;
    try { return await action(); } finally { jobs--; }
  }

  async function resolveAudio(id) {
    const cached = metadata.get(id);
    if (cached && cached.until > now()) return cached.info;
    if (pending.has(id)) return pending.get(id);
    const operation = job(async () => {
      const info = await extractor(`https://www.youtube.com/watch?v=${id}`);
      const seconds = Number(info.duration);
      if (info.id !== id || info.is_live || !Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_DURATION) {
        throw new ServiceError(422, 'Elige una cancion grabada de hasta 20 minutos.');
      }
      const normalized = {
        url: audioUrl(info.url), durationMs: Math.round(seconds * 1000),
        userAgent: String(info.http_headers?.['User-Agent'] || 'Mozilla/5.0'),
      };
      limitedSet(metadata, id, { info: normalized, until: now() + CACHE_TTL }, 256);
      return normalized;
    });
    pending.set(id, operation);
    try { return await operation; } finally { pending.delete(id); }
  }

  async function thumbnail(id) {
    if (thumbnails.has(id)) return thumbnails.get(id);
    try {
      const response = await fetcher(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`, {
        redirect: 'error', signal: AbortSignal.timeout(4000),
      });
      if (!response.ok || !response.body) return null;
      if (Number(response.headers.get('content-length')) > 100000) {
        await response.body.cancel(); return null;
      }
      const parts = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 100000) return null;
        parts.push(Buffer.from(chunk));
      }
      if (!String(response.headers.get('content-type')).startsWith('image/jpeg')) return null;
      const result = `data:image/jpeg;base64,${Buffer.concat(parts).toString('base64')}`;
      limitedSet(thumbnails, id, result, 128);
      return result;
    } catch { return null; }
  }

  function signature(text) { return createHmac('sha256', apiKey).update(text).digest('base64url'); }
  function ticket(id) {
    const payload = `${id}.${Math.floor(now() / 1000) + TICKET_TTL}`;
    return `${payload}.${signature(payload)}`;
  }
  function verifyTicket(value) {
    const parts = value.split('.');
    if (parts.length !== 3 || !VIDEO_ID.test(parts[0]) || !/^\d+$/.test(parts[1]) ||
        !safeEqual(signature(`${parts[0]}.${parts[1]}`), parts[2]) || Number(parts[1]) <= now() / 1000) {
      throw new ServiceError(403, 'El enlace de audio no es valido o ha caducado.');
    }
    return parts[0];
  }

  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!['GET', 'HEAD'].includes(req.method)) throw new ServiceError(405, 'Metodo no permitido.');
      if (url.pathname === '/health') return json(res, 200, { status: 'ok', service: 'sirilo-music' });

      if (url.pathname === '/audio') {
        const id = verifyTicket(url.searchParams.get('ticket') || '');
        if (listeners >= 32) throw new ServiceError(429, 'Demasiados oyentes simultaneos.');
        const range = req.headers.range;
        if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) {
          throw new ServiceError(416, 'Rango de audio invalido.');
        }
        listeners++;
        const controller = new AbortController();
        const cancel = () => controller.abort();
        res.once('close', cancel);
        const timer = setTimeout(cancel, (MAX_DURATION + 120) * 1000);
        try {
          const info = await resolveAudio(id);
          if (res.destroyed) return;
          const headers = { 'User-Agent': info.userAgent };
          if (range) headers.Range = range;
          const upstream = await fetcher(info.url, {
            method: req.method, headers, redirect: 'error', signal: controller.signal,
          });
          if (![200, 206, 416].includes(upstream.status)) {
            await upstream.body?.cancel();
            metadata.delete(id);
            throw new ServiceError(502, 'El proveedor rechazo el audio. Busca la cancion de nuevo.');
          }
          const responseHeaders = { 'Content-Type': 'audio/webm', 'Cache-Control': 'private, no-store' };
          for (const name of ['content-length', 'content-range', 'accept-ranges']) {
            if (upstream.headers.has(name)) responseHeaders[name] = upstream.headers.get(name);
          }
          res.writeHead(upstream.status, responseHeaders);
          if (req.method === 'HEAD') { await upstream.body?.cancel(); res.end(); }
          else if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res);
          else res.end();
        } finally {
          clearTimeout(timer); res.off('close', cancel); controller.abort(); listeners--;
        }
        return;
      }

      if (!['/search', '/stream'].includes(url.pathname)) throw new ServiceError(404, 'Ruta no encontrada.');
      if (!safeEqual(String(req.headers['x-api-key'] || ''), apiKey)) throw new ServiceError(401, 'Clave de backend incorrecta.');
      calls = calls.filter(time => time > now() - 60000);
      if (calls.length >= 120) throw new ServiceError(429, 'Limite de consultas. Espera un minuto.');
      calls.push(now());

      if (url.pathname === '/search') {
        const query = (url.searchParams.get('q') || '').trim();
        const limit = Number(url.searchParams.get('limit') || 8);
        if (!query || Buffer.byteLength(query) > 100 || !Number.isInteger(limit) || limit < 1 || limit > 8) {
          throw new ServiceError(400, 'Busca entre 1 y 100 bytes; limit debe estar entre 1 y 8.');
        }
        const key = `${limit}:${query.toLowerCase()}`;
        const cached = searches.get(key);
        if (cached && cached.until > now()) return json(res, 200, cached.data);
        const result = await job(() => extractor(`ytsearch${limit}:${query}`, { search: true }));
        const entries = (Array.isArray(result.entries) ? result.entries : []).filter(item =>
          item && VIDEO_ID.test(item.id || '') && !item.is_live &&
          (!item.duration || Number(item.duration) <= MAX_DURATION)).slice(0, limit);
        const results = await Promise.all(entries.map(async item => ({
          video_id: item.id, url: `https://www.youtube.com/watch?v=${item.id}`,
          title: String(item.title || 'Sin titulo'), channel: String(item.channel || item.uploader || ''),
          duration: durationLabel(Number(item.duration)), views: String(item.view_count || ''),
          thumbnail: await thumbnail(item.id),
        })));
        const data = { results };
        limitedSet(searches, key, { data, until: now() + 60000 }, 32);
        return json(res, 200, data);
      }

      if ((url.searchParams.get('format') || 'webm') !== 'webm') {
        throw new ServiceError(400, 'Este backend utiliza WebM para MTA.');
      }
      const id = videoIdFromUrl(url.searchParams.get('url') || '');
      const info = await resolveAudio(id);
      return json(res, 200, {
        stream_url: `${origin}/audio?ticket=${encodeURIComponent(ticket(id))}`,
        duration_ms: info.durationMs, format: 'webm',
      });
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      json(res, error.status || 502, {
        detail: error instanceof ServiceError ? error.message : 'No se pudo completar la solicitud de musica.',
      });
    }
  }
  return http.createServer(handler);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createApp();
  server.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => console.log('Sirilo music backend ready'));
}
