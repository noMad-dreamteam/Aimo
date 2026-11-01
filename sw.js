// Offline support: after the first visit the app shell and the on-device vision models
// work without a network (a stage, a sports ground). Same-origin files: network first,
// revalidated with the server (an ETag check); the cache is an offline fallback.
// Versioned CDN
// files (MediaPipe, the WebLLM library, the pose and object models): cache first, their
// URLs carry the version and never change. WebLLM keeps its own model caches and Piper
// voices live in OPFS; neither is touched here. Piper runtime dependencies are loaded from a CDN on demand;
// offline speech falls back to the browser voice.
const CACHE = 'aimo-v53';
const SHELL = [
  './', './index.html', './src/styles.css', './assets/icons/app-icon-32.png', './assets/icons/app-icon-180.png', './assets/icons/app-icon-192.png', './assets/icons/app-icon-512.png', './manifest.webmanifest',
  './src/app/camera.js', './src/app/main.js', './src/app/chat.js', './src/app/live.js', './src/app/store.js', './src/app/ui.js', './src/app/viewport.js',
  './src/app/model-manager.js', './src/app/speech.js', './src/app/trainer-audio.js', './src/app/tts-worker.js',
  './src/app/vendor/ort.wasm-1.18.0.min.js', './src/app/voice-cache.js', './src/app/voice-models.js', './src/app/voice-queue.js', './src/app/tabbar.js', './src/app/live-intro.js',
  './src/coach/engine.js', './src/coach/motion.js', './src/coach/policy.js', './src/ai/llm.js', './src/ai/planner.js', './src/coach/talk.js',
  './src/coach/progress.js', './src/coach/objects.js', './src/ai/questions.js', './src/ai/chat.js', './src/coach/rhythm.js', './src/ai/llm-worker.js',
  './src/skills/index.js', './src/skills/common.js', './src/skills/puppet.js', './src/skills/football.js', './src/skills/balance.js', './src/skills/squats.js',
  './src/skills/lunges.js', './src/skills/pushups.js', './src/skills/plank.js', './src/skills/jacks.js', './src/skills/highknees.js',
  './src/skills/zolo.js', './src/skills/trend-dance.js', './src/skills/dance-common.js',
  './src/ai/safety.js', './src/shared/text.js', './src/app/action-policy.js',
];
const IMMUTABLE = [
  /^https:\/\/cdn\.jsdelivr\.net\/npm\/@mediapipe\/tasks-vision@\d/,
  /^https:\/\/storage\.googleapis\.com\/mediapipe-models\//,
  /^https:\/\/cdn\.jsdelivr\.net\/npm\/@mlc-ai\/web-llm@\d/,
];

self.addEventListener('install', (event) => {
  // 'reload' skips the browser's HTTP cache: GitHub Pages lets files live there for 10 minutes.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('aimo-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (IMMUTABLE.some(pattern => pattern.test(request.url))) { event.respondWith(cacheFirst(request, event)); return; }
  if (new URL(request.url).origin === self.location.origin) event.respondWith(networkFirst(request, event));
});

function saveResponse(cache, request, response, event) {
  // A full cache must not break a successful network response or reject in the background.
  event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
}
async function cacheFirst(request, event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.status === 200) saveResponse(cache, request, response, event);
  return response;
}
async function networkFirst(request, event) {
  const cache = await caches.open(CACHE);
  try {
    // Revalidate with the server so an online client sees deployed updates.
    const response = await fetch(request, { cache: 'no-cache' });
    if (response.status === 200) saveResponse(cache, request, response, event);
    return response;
  } catch (error) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === 'navigate') { const shell = await cache.match('./index.html'); if (shell) return shell; }
    throw error;
  }
}
