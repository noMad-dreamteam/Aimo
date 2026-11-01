import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../sw.js', import.meta.url), 'utf8');
function harness({ offline = false, full = false, cached = null } = {}) {
  const handlers = {}, writes = [], waits = [];
  const cache = {
    async match() { return cached; },
    async put(request) { writes.push(request.url); if (full) throw new DOMException('Full', 'QuotaExceededError'); },
  };
  vm.runInNewContext(source, {
    self: { location: { origin: 'https://example.com' }, addEventListener(name, fn) { handlers[name] = fn; } },
    caches: { open: async () => cache }, URL, Request,
    fetch: async () => { if (offline) throw new Error('Offline'); return new Response('network'); },
  });
  return { writes, async get(url) {
    let response;
    handlers.fetch({ request: new Request(url), respondWith(value) { response = value; }, waitUntil(value) { waits.push(value); } });
    const result = await response; await Promise.all(waits); return result;
  } };
}

test('a full offline cache never rejects a successful local or CDN response', async () => {
  const h = harness({ full: true });
  for (const url of ['https://example.com/Aimo/app/main.js', 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs']) {
    assert.equal(await (await h.get(url)).text(), 'network');
  }
  assert.equal(h.writes.length, 2);
});

test('offline requests use saved files and unrelated origins are left alone', async () => {
  const h = harness({ offline: true, cached: new Response('saved') });
  assert.equal(await (await h.get('https://example.com/Aimo/styles.css')).text(), 'saved');
  assert.equal(await h.get('https://unrelated.example/file.js'), undefined);
  assert.equal(h.writes.length, 0);
});
