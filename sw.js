// オフラインでも つかえるように する（はじめて ひらいた ときに 読みとりの モデルも 保存）
const CACHE = 'sign-4673b93132';
const CORE = ['./', 'index.html', 'vendor/vision_bundle.js', 'vendor/wasm/vision_wasm_internal.js', 'vendor/wasm/vision_wasm_internal.wasm', 'vendor/models/hand_landmarker.task', 'vendor/models/pose_landmarker_lite.task', 'sets/index.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('sign-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const url = new URL(req.url);
  // ページと セットは あたらしい ものを 先に（つながらない ときは 保存した もの）
  if (req.mode === 'navigate' || url.pathname.indexOf('/sets/') >= 0) {
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(req, c)); return r; }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
    return;
  }
  // モデルなど 大きい ものは 保存した ものを 先に
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(k => k.put(req, c)); } return res; })));
});
