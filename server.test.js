import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, videoIdFromUrl, extractionFailure } from './server.js';

test('extractor diagnostics classify failures without exposing raw output', () => {
  assert.match(extractionFailure('Sign in to confirm you are not a bot https://secret.example'), /autenticacion/);
  assert.match(extractionFailure('Requested format is not available'), /WebM/);
  assert.match(extractionFailure('Video unavailable'), /disponible/);
  assert.match(extractionFailure('JavaScript challenge failed'), /JavaScript/);
  assert.match(extractionFailure('HTTP Error 429'), /limito/);
  assert.ok(!extractionFailure('unknown https://secret.example').includes('secret.example'));
});

const key = 'test-private-key-with-32-characters';
const id = 'abcdefghijk';

async function fixture(t, overrides = {}) {
  const seen = [];
  const app = createApp({
    apiKey: key, publicBaseUrl: 'https://music.example',
    extractor: async (target, options) => {
      seen.push({ target, options });
      if (options?.search) return { entries: [
        { id, title: 'Prueba', channel: 'Canal', duration: 180, view_count: 123 },
        { id: 'bad', title: 'No incluir' },
        { id: 'zyxwvutsrqp', duration: 2000 },
      ] };
      return { id, duration: 180, url: 'https://r1.googlevideo.com/audio?valid=1', http_headers: { 'User-Agent': 'Test' } };
    },
    fetcher: async (url, options) => {
      seen.push({ url, options });
      if (url.includes('i.ytimg.com')) return new Response(Buffer.from([255,216,255,217]), {
        headers: { 'content-type': 'image/jpeg' },
      });
      if (options.method === 'HEAD') return new Response(null, { headers: { 'content-length': '3' } });
      return new Response(Buffer.from('abc'), { status: options.headers.Range ? 206 : 200,
        headers: { 'content-length': '3', 'accept-ranges': 'bytes',
          ...(options.headers.Range ? { 'content-range': 'bytes 0-2/3' } : {}),
        },
      });
    },
    ...overrides,
  });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    app.closeAllConnections();
    await new Promise(resolve => app.close(resolve));
  });
  const base = `http://127.0.0.1:${app.address().port}`;
  const request = (path, options = {}) => fetch(base + path, {
    ...options, headers: { 'X-API-Key': key, ...options.headers },
  });
  return { request, seen };
}

const streamPath = `/stream?format=webm&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`;

test('diagnostics require authentication and do not expose cookie paths', async t => {
  const { request } = await fixture(t, { cookiesFile: '' });
  assert.equal((await request('/diagnostics', { headers: { 'X-API-Key': '' } })).status, 401);
  const result = await (await request('/diagnostics')).json();
  assert.deepEqual(result.cookies, { configured: false, status: 'not_configured' });
  assert.equal(result.youtubeAuthentication, 'not_verified');
  const invalid = await fixture(t, { cookiesFile: 'missing-private-cookie-file' });
  const response = await (await invalid.request('/diagnostics')).json();
  assert.deepEqual(response.cookies, { configured: true, status: 'unreadable_or_invalid' });
  assert.ok(!JSON.stringify(response).includes('missing-private-cookie-file'));
});

test('YouTube URLs are constrained to valid video IDs and known hosts', () => {
  assert.equal(videoIdFromUrl(`https://www.youtube.com/watch?v=${id}`), id);
  assert.equal(videoIdFromUrl(`https://youtu.be/${id}`), id);
  for (const raw of ['http://youtube.com/watch?v='+id, 'https://youtube.com.attacker.test/watch?v='+id,
    'https://127.0.0.1/', 'https://youtube.com/playlist?list=123', 'https://user@youtube.com/watch?v='+id]) {
    assert.throws(() => videoIdFromUrl(raw));
  }
});

test('health is public and search requires the server key', async t => {
  const { request, seen } = await fixture(t);
  assert.equal((await request('/health', { headers: { 'X-API-Key': '' } })).status, 200);
  assert.equal((await request('/search?q=test', { headers: { 'X-API-Key': '' } })).status, 401);
  assert.equal(seen.length, 0);
});

test('search returns the exact MTA contract, inline thumbnails and cached results', async t => {
  const { request, seen } = await fixture(t);
  const response = await request('/search?q=prueba&limit=8');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.results.length, 1);
  assert.equal(data.results[0].url, `https://www.youtube.com/watch?v=${id}`);
  assert.equal(data.results[0].duration, '3:00');
  assert.match(data.results[0].thumbnail, /^data:image\/jpeg;base64,/);
  await request('/search?q=PRUEBA&limit=8');
  assert.equal(seen.filter(value => value.target).length, 1);
});

test('bad search and arbitrary stream URLs fail before extraction', async t => {
  const { request, seen } = await fixture(t);
  for (const path of ['/search?q=', '/search?q=ok&limit=99', '/search?q=ok&limit=1.5',
    '/stream?url=http://127.0.0.1', streamPath.replace('webm', 'm4a')]) {
    assert.equal((await request(path)).status, 400);
  }
  assert.equal(seen.length, 0);
});

test('signed audio supports GET/HEAD and ranges without exposing the private key', async t => {
  const { request, seen } = await fixture(t);
  const data = await (await request(streamPath)).json();
  assert.equal(data.duration_ms, 180000);
  assert.equal(data.format, 'webm');
  assert.ok(!JSON.stringify(data).includes(key));
  const audioPath = new URL(data.stream_url).pathname + new URL(data.stream_url).search;
  const audio = await request(audioPath, { headers: { 'X-API-Key': '' } });
  assert.equal(audio.status, 200);
  assert.equal(await audio.text(), 'abc');
  const partial = await request(audioPath, { headers: { Range: 'bytes=0-2' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 0-2/3');
  assert.equal(await partial.text(), 'abc');
  assert.equal((await request(audioPath, { method: 'HEAD' })).status, 200);
  assert.equal((await request(audioPath, { headers: { Range: 'bytes=1-3,8-9' } })).status, 416);
  assert.equal(seen.filter(value => value.target).length, 1);
});

test('forged or expired audio tickets cannot trigger extraction', async t => {
  let clock = Date.now();
  const { request, seen } = await fixture(t, { now: () => clock });
  assert.equal((await request('/audio?ticket=bad')).status, 403);
  const data = await (await request(streamPath)).json();
  const path = new URL(data.stream_url).pathname + new URL(data.stream_url).search;
  assert.equal((await request(path + 'X')).status, 403);
  clock += 3 * 60 * 60 * 1000;
  assert.equal((await request(path)).status, 403);
  assert.equal(seen.filter(value => value.target).length, 1);
});

test('live, overlong, missing-duration and untrusted audio are rejected', async t => {
  for (const data of [
    { id, duration: 180, is_live: true }, { id, duration: 5000 },
    { id }, { id, duration: 180, url: 'https://localhost/private' },
  ]) {
    await t.test(JSON.stringify(data), async sub => {
      const { request } = await fixture(sub, { extractor: async () => data });
      assert.ok([422, 502].includes((await request(streamPath)).status));
    });
  }
});

test('provider failures return a sanitized error instead of signed URLs', async t => {
  const { request } = await fixture(t, { extractor: async () => { throw new Error('secret-upstream-url'); } });
  const response = await request('/search?q=test');
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('secret-upstream-url'));
});

test('simultaneous requests for the same track share extraction', async t => {
  let count = 0;
  const { request } = await fixture(t, { extractor: async () => {
    count++;
    await new Promise(resolve => setTimeout(resolve, 20));
    return { id, duration: 180, url: 'https://r1.googlevideo.com/audio' };
  } });
  const responses = await Promise.all([request(streamPath), request(streamPath)]);
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(count, 1);
});
