(function () {
  'use strict';
  const E = window.SignEngine;

  /* ============================================================
     小さな道具
     ============================================================ */
  const $ = s => document.querySelector(s);
  const uid = () => Math.random().toString(36).slice(2, 9);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function h(tag, props) {
    const el = document.createElement(tag);
    if (props) Object.keys(props).forEach(k => {
      const v = props[k]; if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v; else if (k === 'style') el.style.cssText = v; else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
    });
    (function add(list) { list.forEach(c => { if (c === null || c === undefined || c === false) return; if (Array.isArray(c)) add(c); else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c); }); })(Array.prototype.slice.call(arguments, 2));
    return el;
  }
  let toastT = null;
  function toast(msg, ms) { const old = $('.toast'); if (old) old.remove(); const t = h('div', { class: 'toast' }, msg); document.body.appendChild(t); clearTimeout(toastT); toastT = setTimeout(() => t.remove(), ms || 2200); }
  const CAT = {}; VOCAB_CATS.forEach(c => CAT[c.id] = c);
  const catColor = id => (CAT[id] || { c: '#868E96' }).c;

  /* ============================================================
     せってい（この iPad に 保存）
     ============================================================ */
  const ST_KEY = 'mieel-sign-st';
  const DEF = { lefty: false, say: 'p', rate: 0.95, chime: true, urgentRepeat: true, confirm: 'auto', sens: 2, mirror: true, hold: true, holdMs: 700, restY: 1.7, showVideo: true, learn: true, debug: false, activeSet: '' };
  let st = Object.assign({}, DEF);
  try { Object.assign(st, JSON.parse(localStorage.getItem(ST_KEY) || '{}')); } catch (e) { /* 無視 */ }
  function saveSt() { try { localStorage.setItem(ST_KEY, JSON.stringify(st)); } catch (e) { /* 無視 */ } }

  /* ============================================================
     音（ピンポン）と 読み上げ
     ============================================================ */
  let ac = null;
  function audio() { try { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); return ac; } catch (e) { return null; } }
  function tone(f, t0, dur, vol) { const a = audio(); if (!a) return; const o = a.createOscillator(), g = a.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0, a.currentTime + t0); g.gain.linearRampToValueAtTime(vol || 0.25, a.currentTime + t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + t0 + dur); o.connect(g).connect(a.destination); o.start(a.currentTime + t0); o.stop(a.currentTime + t0 + dur + 0.05); }
  function chime(urgent) { if (urgent) { tone(988, 0, 0.25, 0.3); tone(784, 0.22, 0.25, 0.3); tone(988, 0.44, 0.25, 0.3); tone(784, 0.66, 0.4, 0.3); } else { tone(880, 0, 0.35); tone(698, 0.28, 0.5); } }
  function beep() { tone(660, 0, 0.12, 0.18); }
  const canSpeak = 'speechSynthesis' in window;
  let jaVoice = null;
  function loadVoice() { if (!canSpeak) return; const v = speechSynthesis.getVoices().filter(x => /^ja/i.test(x.lang)); jaVoice = v.find(x => /Kyoko|O-ren|Otoya|Hattori/i.test(x.name)) || v[0] || null; }
  function speak(t, rate) { if (!canSpeak || !t) return; try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(jaSay(t)); u.lang = 'ja-JP'; u.rate = rate || st.rate; u.pitch = 1.05; u.volume = 1; if (jaVoice) u.voice = jaVoice; speechSynthesis.speak(u); } catch (e) { /* 無視 */ } }
  const sayText = w => st.say === 'w' ? (w.s || w.w) : (w.p || w.s || w.w);
  function announce(w) {
    if (st.say === 'none') { if (st.chime) chime(w.u); return; }
    if (st.chime) { chime(w.u); setTimeout(() => speak(sayText(w)), w.u ? 900 : 620); } else speak(sayText(w));
  }

  /* ============================================================
     ほぞん（IndexedDB：セットは 大きいので こちら）
     ============================================================ */
  const DB = {
    db: null,
    open() { if (this.db) return Promise.resolve(this.db); return new Promise((res, rej) => { const r = indexedDB.open('mieel-sign', 1); r.onupgradeneeded = () => r.result.createObjectStore('sets', { keyPath: 'id' }); r.onsuccess = () => { this.db = r.result; res(this.db); }; r.onerror = () => rej(r.error); }); },
    async all() { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('sets').objectStore('sets').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); }); },
    async put(s) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction('sets', 'readwrite'); tx.objectStore('sets').put(s); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
    async del(id) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction('sets', 'readwrite'); tx.objectStore('sets').delete(id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }
  };

  /* ============================================================
     サインセット
     ============================================================ */
  let SETS = [];          // [{ id, name, builtin, file, words, loaded }]
  let prepCache = { id: null, ver: -1, prep: null };
  let setVer = 0;
  const wordFromVocab = v => ({ id: v.id, cat: v.cat, e: v.e, w: v.w, p: v.p, s: v.s, u: v.u, memo: '', off: false, samples: [] });
  const active = () => SETS.find(s => s.id === st.activeSet) || SETS[0] || null;
  // null を 文字として 入れない append
  const put = (el, ...kids) => { kids.forEach(k => { if (k != null && k !== false) el.append(k); }); return el; };
  const recCount = s => s ? s.words.filter(w => w.samples && w.samples.length && !w.off).length : 0;
  async function loadSets() {
    const user = await DB.all().catch(() => []);
    let builtin = [];
    try { const r = await fetch('sets/index.json', { cache: 'no-cache' }); if (r.ok) builtin = (await r.json()).sets || []; } catch (e) { /* オフライン */ }
    SETS = builtin.map(b => ({ id: 'builtin:' + b.file, name: b.name, desc: b.desc || '', builtin: true, file: b.file, words: [], loaded: false })).concat(user.sort((a, b) => (a.made || 0) - (b.made || 0)));
    if (!SETS.some(s => !s.builtin)) {   // はじめての とき：ぜんぶの ことばが 入った 自分用セットを 作る
      const s = { id: 'u-' + uid(), name: 'わたしの しゅわ', made: Date.now(), words: VOCAB.map(wordFromVocab), loaded: true };
      await DB.put(s).catch(() => {}); SETS.push(s);
    }
    if (!SETS.some(s => s.id === st.activeSet)) st.activeSet = SETS[0].id;
    await ensureLoaded(active());
    // 先生が えらんで いない ときは、とうろくが いちばん 多い セットを つかう
    if (!localStorage.getItem(ST_KEY + '-chosen')) {
      for (const s of SETS) if (s.builtin) await ensureLoaded(s);
      const best = SETS.slice().sort((a, b) => recCount(b) - recCount(a))[0];
      if (best && recCount(best) > recCount(active())) st.activeSet = best.id;
    }
    saveSt();
  }
  async function ensureLoaded(s) {
    if (!s || s.loaded) return s;
    try { const r = await fetch('sets/' + s.file, { cache: 'no-cache' }); if (r.ok) { const j = await r.json(); s.words = (j.words || []); s.desc = s.desc || j.desc || ''; } } catch (e) { /* オフライン */ }
    s.loaded = true; return s;
  }
  async function saveSet(s) { if (!s || s.builtin) return; s.updated = Date.now(); setVer++; await DB.put(JSON.parse(JSON.stringify(s))).catch(e => toast('ほぞん できませんでした')); }
  function prepFor(s) {
    if (prepCache.id === s.id && prepCache.ver === setVer) return prepCache.prep;
    const words = s.words.filter(w => !w.off && w.samples && w.samples.length).map(w => ({ id: w.id, samples: w.samples.concat(w.learned || []) }));
    prepCache = { id: s.id, ver: setVer, prep: E.prepare(words) };
    return prepCache.prep;
  }
  function wordById(s, id) { return s.words.find(w => w.id === id); }
  function exportSet(s) {
    const data = { format: 'mieel-sign-set', v: 1, name: s.name, made: new Date().toISOString().slice(0, 10), words: s.words.map(w => ({ id: w.id, cat: w.cat, e: w.e, w: w.w, p: w.p, s: w.s, u: !!w.u, memo: w.memo || '', off: !!w.off, samples: w.samples || [], learned: w.learned || [] })) };
    const json = JSON.stringify(data);
    const name = 'サインセット_' + s.name.replace(/[\\/:*?"<>|\s]/g, '') + '.json';
    const download = () => {
      const a = h('a', { href: URL.createObjectURL(new Blob([json], { type: 'application/json' })), download: name }); document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      toast('💾「' + name + '」を ほぞん しました（' + (isIOS ? 'ファイル アプリ' : 'ダウンロード フォルダ') + '）', 4000);
    };
    // パソコンは かならず ダウンロード。iPad は AirDrop などの 共有 → だめなら ダウンロード
    const file = isIOS && typeof File === 'function' ? new File([json], name, { type: 'application/json' }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: s.name }).catch(e => { if (!e || e.name !== 'AbortError') download(); });
      return;
    }
    download();
  }
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  async function importFile(file) {
    try {
      const j = JSON.parse(await file.text());
      if (j.format !== 'mieel-sign-set' || !Array.isArray(j.words)) throw new Error('format');
      let name = j.name || 'よみこんだ セット'; while (SETS.some(s => s.name === name)) name += '（2）';
      const s = { id: 'u-' + uid(), name, made: Date.now(), loaded: true, words: j.words.map(w => ({ id: String(w.id || 'my-' + uid()), cat: w.cat || 'aisatsu', e: w.e || '🤟', w: w.w || '？', p: w.p || w.w, s: w.s || '', u: !!w.u, memo: w.memo || '', off: !!w.off, samples: Array.isArray(w.samples) ? w.samples.filter(x => typeof x === 'string') : [], learned: Array.isArray(w.learned) ? w.learned.filter(x => typeof x === 'string') : [] })) };
      await DB.put(s); SETS.push(s); st.activeSet = s.id; saveSt(); setVer++;
      toast('「' + name + '」を よみこみました（サイン ' + recCount(s) + 'こ）', 3000);
      renderTeacher();
    } catch (e) { toast('よみこめませんでした（サインセットの ファイルを えらんでください）', 3500); }
  }
  // 見本を 足す（10こ まで。はじめの 3こは のこし、あとから 足した ものを 入れかえる）
  function addSample(w, seq) { w.samples = w.samples || []; w.samples.push(E.encode(seq)); if (w.samples.length > 10) w.samples.splice(3, 1); }
  // つかいながら おぼえる（1語 6こまで・ふるい ものから いれかわる）。とりけし用に 文字列を かえす
  function addLearned(w, seq) { const code = E.encode(seq); w.learned = (w.learned || []).concat(code); while (w.learned.length > 6) w.learned.shift(); return code; }
  function dropLearned(w, code) { if (w && w.learned) { const i = w.learned.lastIndexOf(code); if (i >= 0) w.learned.splice(i, 1); } }

  /* ============================================================
     きろく
     ============================================================ */
  const LOG_KEY = 'mieel-sign-log';
  function logPush(w, k) { try { const a = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); a.push({ t: Date.now(), id: w.id, w: w.w, k }); while (a.length > 3000) a.shift(); localStorage.setItem(LOG_KEY, JSON.stringify(a)); } catch (e) { /* 無視 */ } }
  function logAll() { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (e) { return []; } }

  /* ============================================================
     カメラ と MediaPipe
     ============================================================ */
  const video = $('#video');
  const timeout = (pr, ms, name) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error(name)), ms))]);
  const V = { ready: false, loading: null, hand: null, pose: null, stream: null, running: false, onFrame: null, lastVT: -1, lastT: 0, lastPose: null, k: 0, fps: 0, slow: false, err: '' };
  function loadVision() {
    if (V.ready) return Promise.resolve();
    if (V.loading) return V.loading;
    V.loading = (async () => {
      V.step = 'よみとりの ぶひん（1/3）';
      const mp = await import(new URL('vendor/vision_bundle.js', location.href).href);
      const fs = await mp.FilesetResolver.forVisionTasks(new URL('vendor/wasm', location.href).href);
      const mk = async delegate => {
        V.step = '手の モデル（2/3）' + (delegate === 'CPU' ? '・CPU' : '');
        V.hand = await mp.HandLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: new URL('vendor/models/hand_landmarker.task', location.href).href, delegate }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
        V.step = 'からだの モデル（3/3）' + (delegate === 'CPU' ? '・CPU' : '');
        V.pose = await mp.PoseLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: new URL('vendor/models/pose_landmarker_lite.task', location.href).href, delegate }, runningMode: 'VIDEO', numPoses: 1 });
      };
      // GPU で 25びょう たっても できない・だめな ときは CPU で
      try { await timeout(mk('GPU'), 25000, 'gpu-timeout'); V.delegate = 'GPU'; } catch (e) { console.warn('GPU だめ → CPU', e); V.gpuErr = String(e && e.message || e); await mk('CPU'); V.delegate = 'CPU'; }
      V.ready = true;
    })();
    V.loading.catch(e => { V.loading = null; V.err = String(e && e.message || e); });
    return V.loading;
  }
  async function startCam() {
    if (V.stream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nocam');
    V.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
    video.srcObject = V.stream;
    await timeout(video.play(), 5000, 'play').catch(() => {});
  }
  function stopCam() { V.running = false; V.onFrame = null; if (V.stream) { V.stream.getTracks().forEach(t => t.stop()); V.stream = null; } video.srcObject = null; video.className = ''; document.body.appendChild(video); releaseWake(); }
  function runLoop(onFrame) {
    V.onFrame = onFrame;
    if (V.running) return;
    V.running = true; V.lastVT = -1;
    const step = () => {
      if (!V.running) return;
      requestAnimationFrame(step);
      if (!V.ready || video.readyState < 2 || !video.videoWidth) return;
      if (video.currentTime === V.lastVT) return;
      V.lastVT = video.currentTime;
      let t = performance.now(); if (t <= V.lastT) t = V.lastT + 1;
      const dt = t - V.lastT; V.lastT = t;
      if (dt < 500) { V.fps = V.fps * 0.9 + (1000 / dt) * 0.1; V.slow = V.fps < 18; }
      let hr, pose;
      try {
        hr = V.hand.detectForVideo(video, t);
        V.k++;
        if (!V.slow || V.k % 2 === 0 || !V.lastPose) V.lastPose = V.pose.detectForVideo(video, t);
        pose = V.lastPose && V.lastPose.landmarks && V.lastPose.landmarks[0];
      } catch (e) { console.warn(e); return; }
      const fr = E.frameFrom(hr.landmarks, hr.handedness, pose, video.videoWidth, video.videoHeight, st.lefty);
      if (V.onFrame) V.onFrame({ fr, t, hands: hr.landmarks || [], pose });
    };
    requestAnimationFrame(step);
  }
  let wake = null;
  async function keepAwake() { try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { /* 無視 */ } }
  function releaseWake() { try { if (wake) wake.release(); } catch (e) { /* 無視 */ } wake = null; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && V.running && cur === 'talk') keepAwake(); });

  /* ============================================================
     かく（カメラの 絵・ほね・見本の アニメ）
     ============================================================ */
  const HC = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
  const PC = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]];
  function fitCanvas(cv) {
    const r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * d)), hh = Math.max(1, Math.round(r.height * d));
    if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
    return { w, h: hh, d };
  }
  // カメラの 絵（かがみ うつし・ぜんぶ 入るように）＋ ほね ＋ おろす せん
  function drawCam(cv, info, seg) {
    const { w, h: H, d } = fitCanvas(cv), g = cv.getContext('2d');
    const VW = video.videoWidth || 16, VH = video.videoHeight || 9;
    const sc = Math.min(w / VW, H / VH), ox = (w - VW * sc) / 2, oy = (H - VH * sc) / 2;
    const P = (x, y) => [w - (ox + x * VW * sc), oy + y * VH * sc];
    g.clearRect(0, 0, w, H);
    if (!st.showVideo) { g.fillStyle = '#0B1A2E'; g.fillRect(0, 0, w, H); }
    if (!info) return;
    const pose = info.pose;
    if (pose) {
      g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 5 * d; g.lineCap = 'round';
      PC.forEach(([a, b]) => { if ((pose[a].visibility || 0) < 0.4 || (pose[b].visibility || 0) < 0.4) return; const p = P(pose[a].x, pose[a].y), q = P(pose[b].x, pose[b].y); g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); });
      // おろす せん（ここより 下に 手を おくと「まっている」）
      const Ls = pose[11], Rs = pose[12];
      if (Ls && Rs && (Ls.visibility || 1) > 0.4) {
        const lx = Ls.x * VW, ly = Ls.y * VH, rx = Rs.x * VW, ry = Rs.y * VH, s = Math.hypot(lx - rx, ly - ry);
        const y = ((ly + ry) / 2 + st.restY * s) / VH;
        if (y < 1.05) {
          const p = P(0, y), q = P(1, y);
          g.setLineDash([14 * d, 10 * d]); g.strokeStyle = 'rgba(255,212,59,.85)'; g.lineWidth = 3 * d; g.beginPath(); g.moveTo(q[0], p[1]); g.lineTo(p[0], p[1]); g.stroke(); g.setLineDash([]);
          g.fillStyle = 'rgba(255,212,59,.95)'; g.font = `700 ${14 * d}px sans-serif`; g.fillText('↓ ここより した ＝ まつ', Math.min(p[0], q[0]) + 10 * d, p[1] - 8 * d);
        }
      }
    }
    const hold = seg ? seg.holdProgress(info.t) : 0;
    info.hands.forEach((lm, i) => {
      g.strokeStyle = i === 0 ? '#4DABF7' : '#FFA94D'; g.lineWidth = 4 * d;
      HC.forEach(([a, b]) => { const p = P(lm[a].x, lm[a].y), q = P(lm[b].x, lm[b].y); g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); });
      g.fillStyle = '#fff'; lm.forEach(pt => { const p = P(pt.x, pt.y); g.beginPath(); g.arc(p[0], p[1], 3.2 * d, 0, 7); g.fill(); });
      if (hold > 0.05) {
        let cx = 0, cy = 0; [0, 5, 9, 13, 17].forEach(k => { const p = P(lm[k].x, lm[k].y); cx += p[0] / 5; cy += p[1] / 5; });
        g.strokeStyle = 'rgba(64,192,87,.95)'; g.lineWidth = 8 * d; g.beginPath(); g.arc(cx, cy, 46 * d, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hold); g.stroke();
      }
    });
  }
  // からだ基準の 1コマを かく（見本の アニメ・手前から 見た 向き）
  function drawBody(g, fr, w, H, opt) {
    opt = opt || {};
    // view：見本ぜんたいが 入る はんい（x0,x1,y0,y1 からだ単位）。なければ むね から 上
    const vw = opt.view || { x0: -1.55, x1: 1.55, y0: -1.1, y1: 1.5 };
    const sc = Math.min(w / (vw.x1 - vw.x0), H / (vw.y1 - vw.y0)), cx = w / 2 - (vw.x0 + vw.x1) / 2 * sc, cy = H / 2 - (vw.y0 + vw.y1) / 2 * sc;
    const P = (x, y) => [cx + x * sc, cy + y * sc];
    g.fillStyle = opt.bg || '#0B1A2E'; g.fillRect(0, 0, w, H);
    const lw = Math.max(2, sc * 0.05);
    g.lineCap = 'round'; g.lineJoin = 'round';
    // からだ
    g.fillStyle = 'rgba(255,255,255,.12)'; g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = lw;
    const n = P(fr.f[0], fr.f[1]);
    g.beginPath(); g.arc(n[0], n[1] + sc * 0.04, sc * 0.3, 0, 7); g.fill(); g.stroke();
    const sl = P(-0.5, 0), sr = P(0.5, 0);
    g.beginPath(); g.moveTo(sl[0], sl[1]); g.lineTo(sr[0], sr[1]); g.lineTo(P(0.42, 1.6)[0], P(0.42, 1.6)[1]); g.lineTo(P(-0.42, 1.6)[0], P(-0.42, 1.6)[1]); g.closePath(); g.fill(); g.stroke();
    const arm = (a, sx, col) => {
      if (!a) return;
      const s = P(sx, 0.05), wr = P(a[0], a[1]);
      const el = P(sx * 1.25 + (a[0] - sx) * 0.25, (0.05 + a[1]) / 2 + 0.35);
      g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = lw * 2.4;
      g.beginPath(); g.moveTo(s[0], s[1]); g.quadraticCurveTo(el[0], el[1], wr[0], wr[1]); g.stroke();
      g.strokeStyle = col; g.lineWidth = lw * 1.1;
      HC.forEach(([i, j]) => { const p = P(a[i * 3], a[i * 3 + 1]), q = P(a[j * 3], a[j * 3 + 1]); g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); });
      g.fillStyle = '#fff'; for (let k = 0; k < 21; k++) { const p = P(a[k * 3], a[k * 3 + 1]); g.beginPath(); g.arc(p[0], p[1], lw * 0.8, 0, 7); g.fill(); }
    };
    // サインする 人の 右手（d）は 見ている 人の 左
    arm(fr.n, 0.5, '#FFA94D');
    arm(fr.d, -0.5, '#4DABF7');
  }
  // 見本を ループで うごかす（canvas に つける。とめる 関数を かえす）
  function animateSample(cv, sampleStr, opt) {
    let seq; try { seq = E.decode(sampleStr); } catch (e) { return () => {}; }
    // 片手の 見本は きき手で かく（前の 見本で 右左を まちがえて 入っていても、うでが ×に ならない）
    { let both = 0, d = 0, n = 0; seq.forEach(fr => { if (fr.d) d++; if (fr.n) n++; if (fr.d && fr.n) both++; }); if (both <= seq.length * 0.2 && n) seq = seq.map(fr => ({ d: fr.d || fr.n, n: null, f: fr.f })); }
    let alive = true, t0 = performance.now();
    // 手が ぜんぶ 入るように はんいを きめる（あたまと かたは かならず 入れる）
    const vw = { x0: -0.9, x1: 0.9, y0: -1.0, y1: 0.7 };
    seq.forEach(fr => [fr.d, fr.n].forEach(a => { if (!a) return; for (let k = 0; k < 21; k++) { vw.x0 = Math.min(vw.x0, a[k * 3] - 0.15); vw.x1 = Math.max(vw.x1, a[k * 3] + 0.15); vw.y0 = Math.min(vw.y0, a[k * 3 + 1] - 0.15); vw.y1 = Math.max(vw.y1, a[k * 3 + 1] + 0.15); } }));
    const half = Math.max(-vw.x0, vw.x1); vw.x0 = -half; vw.x1 = half;
    const dur = (opt && opt.dur) || 1500, pause = 700;
    const lerpF = (a, b, k) => ({ d: a.d && b.d ? a.d.map((v, i) => v + (b.d[i] - v) * k) : (a.d || b.d), n: a.n && b.n ? a.n.map((v, i) => v + (b.n[i] - v) * k) : (k < 0.5 ? a.n : b.n), f: a.f.map((v, i) => v + (b.f[i] - v) * k) });
    const step = () => {
      if (!alive || !cv.isConnected) return;
      const { w, h: H } = fitCanvas(cv), g = cv.getContext('2d');
      const e = (performance.now() - t0) % (dur + pause), p = Math.min(1, e / dur) * (seq.length - 1);
      const i = Math.floor(p), k = p - i;
      drawBody(g, lerpF(seq[i], seq[Math.min(seq.length - 1, i + 1)], k), w, H, { view: vw });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return () => { alive = false; };
  }

  /* ============================================================
     画面
     ============================================================ */
  const main = $('#main');
  let cur = 'home', leave = null;
  function go(name, arg) {
    if (leave) { try { leave(); } catch (e) { /* 無視 */ } leave = null; }
    closeOverlay();
    cur = name; main.innerHTML = '';
    $('#homeBtn').hidden = name === 'home';
    ({ home: renderHome, talk: renderTalk, studio: renderStudio, words: renderWords })[name](arg);
  }
  $('#homeBtn').addEventListener('click', () => go('home'));

  /* ---------- ホーム ---------- */
  function renderHome() {
    const s = active(), n = recCount(s);
    const scr = h('section', { class: 'screen home' },
      h('h1', null, h('span', { class: 'emo' }, '🤟'), ' サインで つたえる'),
      h('p', { class: 'lead' }, 'カメラの まえで サインを すると、ことばに なって 大きな こえで つたわります'),
      h('div', { class: 'setchip' }, '📚 ', h('b', null, s ? s.name : '―'), h('span', { style: 'color:var(--sub);font-weight:500' }, '　サイン ' + n + ' こ')),
      n ? null : h('div', { class: 'notice' }, '⚠️ まだ サインが とうろく されていません。', h('br'), '右上の ⚙️ を ながおし（1.5びょう）→「サインを とうろく」から はじめてください。'),
      h('div', { class: 'modes' },
        h('button', { class: 'mcard main', type: 'button', onclick: () => go('talk') }, h('span', { class: 'emo' }, '🗣️'), h('span', { class: 'nm' }, 'つたえる'), h('small', null, 'サインを すると こえで つたえます')),
        h('button', { class: 'mcard', type: 'button', onclick: () => go('words') }, h('span', { class: 'emo' }, '📖'), h('span', { class: 'nm' }, 'サインを みる'), h('small', null, 'ことばを えらぶと サインの うごきが みられます'))
      )
    );
    main.appendChild(scr);
  }

  // カメラを つかう 画面の 共通の はじめかた
  function camBox() {
    const cv = h('canvas');
    const status = h('div', { class: 'status' }, 'じゅんび ちゅう…');
    const fps = h('div', { class: 'fps' });
    const loading = h('div', { class: 'loading' }, h('span', { class: 'emo' }, '📷'), 'カメラの じゅんび ちゅう…');
    const box = h('div', { class: 'cam' }, cv, loading, status, fps);
    return { box, cv, status, fps, loading };
  }
  function bootFail(cb, title, detail) {
    cb.loading.hidden = false; cb.loading.innerHTML = '';
    const ua = navigator.userAgent.replace(/^Mozilla\/5\.0 /, '');
    cb.loading.append(h('div', null, h('span', { class: 'emo' }, '🙈'), title,
      h('small', { style: 'font-size:15px;font-weight:500;opacity:.85;line-height:1.6;display:block;margin-top:6px' }, detail),
      h('small', { style: 'font-size:11px;font-weight:500;opacity:.5;display:block;margin-top:8px;-webkit-user-select:text;user-select:text' }, ua + (V.gpuErr ? ' / gpu:' + V.gpuErr : '')),
      h('button', { class: 'pill', type: 'button', style: 'margin-top:14px', onclick: () => go(cur) }, '🔄 もう いちど')));
    cb.status.hidden = true;
  }
  async function bootCam(cb, onFrame) {
    // 1. カメラ
    cb.loading.lastChild.textContent = 'カメラを ひらいています…';
    try { await timeout(startCam(), 20000, 'camtimeout'); }
    catch (e) {
      console.warn(e);
      const msg = String(e && (e.name + ' ' + e.message) || e);
      if (/NotAllowed|Permission|Security/i.test(msg)) bootFail(cb, 'カメラを つかう ことが ゆるされていません。', 'iPad の「設定」→「アプリ」→「Safari」→「カメラ」を「確認」か「許可」に して、この ページを ひらきなおしてください。（ホーム画面に 追加した アプリの ときは、いちど 完全に とじて ひらきなおす）');
      else if (/nocam/.test(msg)) bootFail(cb, 'この 画面では カメラが つかえません。', 'Safari で ひらいてください（LINE・Google アプリなどの 中の ブラウザや、プライベートでない https 以外の ページでは カメラが つかえません）。');
      else if (/NotFound|Overconstrained/i.test(msg)) bootFail(cb, 'カメラが みつかりません。', msg);
      else if (/NotReadable|camtimeout/i.test(msg)) bootFail(cb, 'カメラを ひらけませんでした。', 'ほかの アプリ（カメラ・FaceTime など）を とじてから、もう いちど ためしてください。（' + msg + '）');
      else bootFail(cb, 'カメラを ひらけませんでした。', msg);
      return false;
    }
    if (!cb.box.isConnected) return false;
    video.className = 'camvideo'; cb.box.insertBefore(video, cb.box.firstChild);
    video.play().catch(() => {});
    cb.loading.hidden = true;
    // 2. よみとり（はじめては ダウンロードが あるので すこし かかる）
    cb.status.hidden = false; cb.status.className = 'status';
    const tick = setInterval(() => { if (!V.ready) cb.status.textContent = '⏳ よみとりの じゅんび：' + (V.step || '…'); }, 300);
    try { await timeout(loadVision(), 120000, 'visiontimeout'); }
    catch (e) { clearInterval(tick); console.warn(e); bootFail(cb, 'よみとりの じゅんびが できませんでした。', '止まった ところ：' + (V.step || '') + '／' + String(e && e.message || e) + '　インターネットに つながっているか たしかめて、もう いちど ためしてください。'); return false; }
    clearInterval(tick);
    if (!cb.box.isConnected) return false;
    runLoop(onFrame);
    return true;
  }
  function statusOf(seg, info) {
    if (!info.pose) return ['bad', '🙋 からだ（かた）が うつるように はなれてね'];
    if (seg.state === 'sign') return ['sign', '👀 よみとり ちゅう…'];
    if (seg.state === 'wait') return ['', '⬇️ てを おろしてね'];
    return ['', '🤟 サインを どうぞ'];
  }
  let curSeg = null;
  function newSeg() { curSeg = new E.Segmenter({ restY: st.restY, useHold: st.hold, holdMs: st.holdMs }); return curSeg; }
  function syncSeg() { if (curSeg) Object.assign(curSeg.o, { restY: st.restY, useHold: st.hold, holdMs: st.holdMs }); }

  /* ---------- つたえる ---------- */
  function renderTalk() {
    const s = active();
    const cb = camBox();
    const result = h('div', { class: 'result' });
    const words = h('div', { class: 'words' });
    const strip = h('div', { class: 'strip' }, words,
      h('button', { class: 'pill', type: 'button', onclick: () => { const t = Array.from(words.children).map(c => c.dataset.say).join('、'); if (t) speak(t); } }, '🔊 ぜんぶ'),
      h('button', { class: 'pill', type: 'button', onclick: () => { words.innerHTML = ''; } }, '🧽 けす'));
    const scr = h('section', { class: 'screen talk' },
      h('div', { class: 'ptop' }, h('span', { class: 'ttl' }, '🗣️ サインで つたえる'), h('span', { style: 'color:var(--sub);font-size:15px;font-weight:500' }, '📚 ' + (s ? s.name : ''))),
      cb.box, result, strip);
    main.appendChild(scr);
    let last = null;
    function showIdle() {
      result.className = 'result';
      result.innerHTML = '';
      if (!recCount(s)) result.append(h('div', { class: 'hint' }, h('span', { class: 'emo' }, '📭'), 'この セットには まだ サインが ありません。', h('br'), '⚙️ ながおし →「サインを とうろく」'));
      else result.append(h('div', { class: 'hint' }, h('span', { class: 'emo' }, '🤟'), 'てを あげて サインを してね', h('br'), h('small', null, 'おわったら てを おろす（または 手を とめる）')));
    }
    function showWord(w, scores) {
      last = w;
      result.className = 'result'; void result.offsetWidth; result.className = 'result pop';
      result.style.borderColor = w.u ? 'var(--red)' : catColor(w.cat);
      result.innerHTML = '';
      result.append(h('span', { class: 'emo' }, w.e), h('div', { class: 'word' }, w.w), h('div', { class: 'phrase' }, w.p && w.p !== w.w ? w.p : ''),
        h('button', { class: 'pill again', type: 'button', onclick: () => announce(w) }, '🔊 もういちど'));
      if (st.debug && scores) result.append(h('div', { class: 'scores' }, scores));
    }
    function addChip(w) {
      const c = h('button', { class: 'wchip' + (w.u ? ' u' : ''), type: 'button', onclick: () => speak(sayText(w)) }, h('span', { class: 'emo' }, w.e), w.w);
      c.dataset.say = w.s || w.w;
      words.appendChild(c);
      while (words.children.length > 8) words.firstChild.remove();
      words.scrollLeft = words.scrollWidth;
    }
    // kind：ok（すぐ決定）・pick（もしかして で えらんだ）・fix（ちがう で なおした）
    function decided(w, kind, seq, scores, ranked, strong) {
      showWord(w, scores); addChip(w); logPush(w, kind);
      let code = null;
      const canLearn = st.learn && !s.builtin && seq;
      if (canLearn && (kind === 'pick' || kind === 'fix' || (kind === 'ok' && strong))) { code = addLearned(w, seq); saveSet(s); }
      bigCard(w, () => fixPicker(ranked, w, nw => {
        // まちがって おぼえた ぶんを とりけし、ただしい ことばの 見本として おぼえる
        if (code) dropLearned(w, code);
        if (s.words.indexOf(nw) >= 0) decided(nw, 'fix', seq, scores, ranked, false);
        saveSet(s);
      }));
    }
    showIdle();
    const seg = newSeg();
    if (!recCount(s)) { bootCam(cb, info => { drawCam(cb.cv, info, seg); cb.status.className = 'status'; cb.status.textContent = '📭 サインを とうろく すると つかえます'; }); leave = () => { stopCam(); }; return; }
    let busyUntil = 0;
    keepAwake();
    bootCam(cb, info => {
      drawCam(cb.cv, info, seg);
      if (st.debug) cb.fps.textContent = Math.round(V.fps) + 'fps ' + (V.delegate || '');
      const r = seg.push(info.fr, info.t);
      const [cls, txt] = statusOf(seg, info);
      cb.status.className = 'status ' + cls; if (cb.status.textContent !== txt) cb.status.textContent = txt;
      if (!r || overlayOpen() || info.t < busyUntil) return;
      const seq = E.resample(r.frames, r.times);
      const prep = prepFor(s), th = E.thresholds(prep, st.sens);
      const ranked = E.rank(prep, seq, { mirror: st.mirror });
      const j = E.judge(ranked, th);
      const scores = ranked.slice(0, 3).map(x => (wordById(s, x.id) || {}).w + ' ' + x.d.toFixed(2)).join(' / ') + '  しきい ' + th.ok.toFixed(2) + ' (' + r.why + ')';
      // 自信が たかい（2ばんめより はっきり 近い）ときだけ 自動で おぼえる
      const strong = j.kind === 'ok' && (!ranked[1] || ranked[1].d >= ranked[0].d * 1.4);
      if (j.kind === 'ok' && st.confirm !== 'always') decided(wordById(s, j.top[0].id), 'ok', seq, scores, ranked, strong);
      else if (j.kind === 'ok' || j.kind === 'maybe') {
        const cands = j.top.map(x => wordById(s, x.id)).filter(Boolean);
        maybeCard(cands, w => decided(w, 'pick', seq, scores, ranked, false), () => fixPicker(ranked, null, nw => decided(nw, 'fix', seq, scores, ranked, false)));
      } else {
        busyUntil = info.t + 600;
        result.classList.remove('pop'); void result.offsetWidth;
        toast('🤔 もう いちど サインして みてね', 1600);
        if (st.debug) result.append(h('div', { class: 'scores' }, scores));
      }
    });
    leave = () => { stopCam(); };
  }

  /* ---------- 大きな カード・もしかして ---------- */
  let ovTimer = null, ovRepeat = null;
  const overlayOpen = () => !!$('.overlay');
  function closeOverlay() { clearTimeout(ovTimer); clearInterval(ovRepeat); const o = $('.overlay'); if (o) o.remove(); }
  function bigCard(w, onWrong) {
    closeOverlay();
    const card = h('div', { class: 'bigcard', style: '--c:' + (w.u ? 'var(--red)' : catColor(w.cat)) }, h('span', { class: 'emo' }, w.e), h('div', { class: 'word' }, w.w), w.p && w.p !== w.w ? h('div', { class: 'phrase' }, w.p) : null);
    const wrong = onWrong ? h('button', { class: 'pill small wrongbtn', type: 'button', onclick: e => { e.stopPropagation(); closeOverlay(); onWrong(); } }, '✋ ちがう（なおす）') : null;
    const ov = h('div', { class: 'overlay' + (w.u ? ' urgent' : '') }, h('div', { style: 'display:flex;flex-direction:column;align-items:center' }, card,
      w.u ? h('button', { class: 'big-btn red ack', type: 'button', onclick: closeOverlay }, '👌 わかったよ') : h('div', { class: 'tapnote' }, 'タップで とじる'), wrong));
    if (!w.u) ov.addEventListener('click', closeOverlay);
    document.body.appendChild(ov);
    announce(w);
    if (w.u && st.urgentRepeat) { let n = 0; ovRepeat = setInterval(() => { if (++n > 5) { clearInterval(ovRepeat); return; } announce(w); }, 4500); }
    else if (!w.u) ovTimer = setTimeout(closeOverlay, 3300);
  }
  // ただしい ことばを えらびなおす（先生用）。ranked の 上から ＋ さがす
  function fixPicker(ranked, wrongW, onPick) {
    closeOverlay();
    const s = active(); if (!s) return;
    let q = '';
    const top = (ranked || []).map(r => wordById(s, r.id)).filter(w => w && w !== wrongW).slice(0, 8);
    const grid = h('div', { class: 'cands', style: 'max-height:52vh;overflow-y:auto' });
    const draw = () => {
      grid.innerHTML = '';
      const list = q ? s.words.filter(w => (w.w + (w.p || '') + (w.s || '')).indexOf(q) >= 0).slice(0, 24) : top;
      list.forEach(w => grid.append(h('button', { class: 'cand', type: 'button', style: 'border-color:' + catColor(w.cat), onclick: e => { e.stopPropagation(); closeOverlay(); onPick(w); } }, h('span', { class: 'emo' }, w.e), h('span', { class: 'word' }, w.w))));
    };
    const inp = h('input', { type: 'search', placeholder: '🔍 ことばを さがす', style: 'height:48px;border:2px solid var(--line);border-radius:14px;padding:0 14px;font-size:18px;width:min(420px,80vw)' });
    inp.addEventListener('input', () => { q = inp.value.trim(); draw(); });
    const box = h('div', { class: 'maybe' }, h('h2', null, '✋ ほんとうは どれ？'), h('p', { class: 'help', style: 'margin:0' }, 'えらぶと その ことばを こえで つたえ、この サインを その ことばとして おぼえます'), inp, grid,
      h('button', { class: 'pill', type: 'button', onclick: closeOverlay }, 'やめる'));
    const ov = h('div', { class: 'overlay' }, box);
    ov.addEventListener('click', e => { if (e.target === ov) closeOverlay(); });
    document.body.appendChild(ov); draw();
  }
  function maybeCard(cands, onPick, onNone) {
    closeOverlay();
    if (!cands.length) return;
    beep();
    const box = h('div', { class: 'maybe' }, h('h2', null, '🤔 もしかして？'),
      h('div', { class: 'cands' }, cands.map(w => h('button', { class: 'cand', type: 'button', style: 'border-color:' + catColor(w.cat), onclick: e => { e.stopPropagation(); closeOverlay(); onPick(w); } }, h('span', { class: 'emo' }, w.e), h('span', { class: 'word' }, w.w)))),
      h('button', { class: 'pill', type: 'button', onclick: e => { e.stopPropagation(); closeOverlay(); if (onNone) onNone(); } }, '✋ どれも ちがう（なおす）'));
    const ov = h('div', { class: 'overlay' }, box);
    ov.addEventListener('click', e => { if (e.target === ov) closeOverlay(); });
    document.body.appendChild(ov);
    ovTimer = setTimeout(closeOverlay, 9000);
  }

  /* ---------- サインを みる ---------- */
  function catChips(sel, onPick, extra) {
    return h('div', { class: 'cats' }, [h('button', { type: 'button', class: sel === '' ? 'on' : '', onclick: () => onPick('') }, 'ぜんぶ')].concat(VOCAB_CATS.map(c => h('button', { type: 'button', class: sel === c.id ? 'on' : '', style: '--c:' + c.c, onclick: () => onPick(c.id) }, h('span', { class: 'emo' }, c.e), c.name)), extra || []));
  }
  function renderWords() {
    const s = active();
    let cat = '';
    const body = h('div', { class: 'pbody' }), head = h('div', { class: 'phead' });
    const scr = h('section', { class: 'screen words-scr' }, h('div', { class: 'ptop' }, h('span', { class: 'ttl' }, '📖 サインを みる')), h('div', { class: 'panel', style: 'flex:1' }, head, body));
    main.appendChild(scr);
    function draw() {
      head.innerHTML = ''; head.append(catChips(cat, c => { cat = c; draw(); }));
      body.innerHTML = '';
      const list = s.words.filter(w => !w.off && w.samples && w.samples.length && (!cat || w.cat === cat));
      if (!list.length) { body.append(h('p', { class: 'help', style: 'text-align:center;font-size:18px' }, 'とうろく された サインが ありません')); return; }
      body.append(h('div', { class: 'wgrid' }, list.map(w => h('button', { class: 'wcard', type: 'button', style: 'border-color:' + catColor(w.cat), onclick: () => viewer(w) }, h('span', { class: 'emo' }, w.e), h('span', { class: 'nm' }, w.w)))));
    }
    draw();
  }
  function viewer(w) {
    let i = 0, stop = () => {};
    const cv = h('canvas');
    const no = h('span', { style: 'color:var(--sub);font-size:15px' });
    const play = () => { stop(); stop = animateSample(cv, w.samples[i]); no.textContent = w.samples.length > 1 ? 'みほん ' + (i + 1) + ' / ' + w.samples.length : ''; };
    const ov = h('div', { class: 'viewer' }, h('div', { class: 'vbox' },
      h('div', { class: 'anim' }, cv),
      h('div', { class: 'side' }, h('span', { class: 'emo' }, w.e), h('span', { class: 'word' }, w.w), w.memo ? h('div', { class: 'memo-t' }, w.memo) : null, no,
        h('div', { class: 'row', style: 'justify-content:center' },
          h('button', { class: 'pill', type: 'button', onclick: () => speak(sayText(w)) }, '🔊 きく'),
          w.samples.length > 1 ? h('button', { class: 'pill', type: 'button', onclick: () => { i = (i + 1) % w.samples.length; play(); } }, '🔁 ほかの みほん') : null),
        h('button', { class: 'big-btn blue', type: 'button', style: 'min-width:200px;min-height:64px', onclick: () => { stop(); ov.remove(); } }, 'とじる'))));
    document.body.appendChild(ov);
    play(); speak(sayText(w));
  }

  /* ---------- サインを とうろく（スタジオ） ---------- */
  function renderStudio(arg) {
    let s = active();
    if (!s || s.builtin) { toast('配布セットは へんしゅう できません。コピーして ください'); go('home'); openTeacher('sets'); return; }
    let cat = '', filter = 'all', q = '', sel = arg || null, rec = null;
    const cb = camBox();
    const head = h('div', { class: 'phead' }), body = h('div', { class: 'pbody' });
    const cdown = h('div', { class: 'countdown' });
    cb.box.appendChild(cdown);
    const scr = h('section', { class: 'screen studio' },
      h('div', { class: 'ptop' }, h('span', { class: 'ttl' }, '🎥 サインを とうろく ― ' + s.name), h('button', { class: 'pill small', type: 'button', onclick: () => openTeacher('settings') }, '⚙️ せってい')),
      cb.box, h('div', { class: 'panel' }, head, body));
    main.appendChild(scr);
    const stops = [];
    const stopAnims = () => { while (stops.length) stops.pop()(); };

    function drawList() {
      stopAnims(); sel = null;
      head.innerHTML = '';
      head.append(
        h('div', { class: 'search' }, h('input', { type: 'search', placeholder: '🔍 ことばを さがす', value: q, oninput: e => { q = e.target.value.trim(); drawGrid(); } }),
          h('div', { class: 'seg' }, [['all', 'ぜんぶ'], ['todo', 'まだ'], ['done', 'できた']].map(([k, t]) => h('button', { type: 'button', class: filter === k ? 'on' : '', onclick: () => { filter = k; drawList(); } }, t)))),
        catChips(cat, c => { cat = c; drawList(); }),
        h('div', { class: 'row' }, h('button', { class: 'pill small', type: 'button', onclick: drawCheck }, '🔍 にている サインを しらべる')));
      drawGrid();
    }
    // 見本を 1つずつ ほかの 見本で 判定して、まちがえやすい 組み合わせを 出す
    function drawCheck() {
      stopAnims(); body.innerHTML = '';
      body.append(h('p', { class: 'help' }, '⏳ しらべています…（ことばが 多いと すこし かかります）'));
      setTimeout(() => {
        const prep = prepFor(s);
        body.innerHTML = '';
        const back = h('button', { class: 'pill small', type: 'button', onclick: drawGrid }, '← いちらんへ');
        if (prep.items.length < 4) { body.append(back, h('p', { class: 'help' }, '2つ いじょうの ことばを、それぞれ 2回 いじょう とうろく すると しらべられます。')); return; }
        const c = E.confusions(prep), name = id => (wordById(s, id) || { e: '', w: id });
        body.append(h('div', { class: 'row', style: 'margin-bottom:10px' }, back),
          h('div', { class: c.pairs.length ? 'warn' : 'okmsg' }, '見本どうしの テスト：' + c.ok + ' / ' + c.total + ' こ 正しく わかりました。' + (prep.learned ? '（この セットの 見本から「見分けに 効く ところ」を 学習ずみ）' : '')),
          (() => { const one = s.words.filter(w => !w.off && w.samples && w.samples.length === 1).length; return one ? h('div', { class: 'warn' }, '📌 1回だけ とうろく された ことばが ' + one + 'こ あります。1つの ことばに 3回（できれば ちがう 人も）とると、ずっと よく わかるように なります。') : ''; })(),
          c.pairs.length ? h('p', { class: 'help' }, '↓ まちがえやすい 組み合わせです。ちがいが はっきり するように とりなおすか、見本を ふやして ください（上ほど にています）。') : h('p', { class: 'help' }, 'まちがえやすい 組み合わせは ありません。'),
          h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, c.pairs.slice(0, 30).map(p => {
            const A = name(p.a), Bw = name(p.b);
            return h('div', { class: 'setrow' },
              h('div', { class: 'nm' }, A.e + ' ' + A.w + '　⇔　' + Bw.e + ' ' + Bw.w, h('small', null, (p.ratio < 1 ? '⚠️ とても にている' : 'にている') + (st.debug ? '（' + p.ratio.toFixed(2) + '）' : ''))),
              h('button', { class: 'pill small', type: 'button', onclick: () => drawDetail(wordById(s, p.a)) }, A.w),
              h('button', { class: 'pill small', type: 'button', onclick: () => drawDetail(wordById(s, p.b)) }, Bw.w));
          })));
      }, 30);
    }
    function drawGrid() {
      body.innerHTML = '';
      const list = s.words.filter(w => (!cat || w.cat === cat) && (!q || (w.w + w.p + (w.s || '')).indexOf(q) >= 0) && (filter === 'all' || (filter === 'done') === !!(w.samples && w.samples.length)));
      const done = s.words.filter(w => w.samples && w.samples.length).length;
      body.append(h('p', { class: 'help', style: 'margin:0 0 10px' }, 'とうろく できた サイン：' + done + ' / ' + s.words.length + '　（1つの ことばに 3回 くらい とうろく すると よく わかるように なります）'));
      body.append(h('div', { class: 'wgrid' },
        list.map(w => h('button', { class: 'wcard' + (w.samples.length ? ' has' : '') + (w.off ? ' off' : '') + (w.u ? ' u' : ''), type: 'button', onclick: () => drawDetail(w) },
          h('span', { class: 'emo' }, w.e), h('span', { class: 'nm' }, w.w), h('span', { class: 'dots' }, [0, 1, 2].map(k => h('i', { class: k < w.samples.length ? 'on' : '' }))), w.samples.length > 3 ? h('small', { style: 'font-size:11px;color:var(--sub)' }, w.samples.length + 'こ') : null)),
        h('button', { class: 'wcard add', type: 'button', onclick: () => editWord(null, s, w => { drawDetail(w); }) }, h('span', { class: 'emo' }, '➕'), h('span', { class: 'nm' }, 'ことばを ふやす'))));
    }
    let msgBox = null;
    function drawDetail(w) {
      stopAnims(); sel = w;
      head.innerHTML = '';
      head.append(h('div', { class: 'row' }, h('button', { class: 'pill small', type: 'button', onclick: () => { cancelRec(); drawList(); } }, '← もどる'),
        h('span', { style: 'flex:1' }), h('button', { class: 'pill small', type: 'button', onclick: () => editWord(w, s, () => drawDetail(w)) }, '✏️ ことばを なおす')));
      body.innerHTML = '';
      msgBox = h('div');
      const memo = h('textarea', { class: 'memo', placeholder: 'サインの メモ（て の かたち・ばしょ・うごき など。「サインを みる」で 表示されます）' });
      memo.value = w.memo || '';
      memo.addEventListener('change', () => { w.memo = memo.value.trim(); saveSet(s); });
      body.append(h('div', { class: 'detail' },
        h('div', { class: 'dhead' }, h('span', { class: 'emo' }, w.e), h('div', null, h('div', { class: 'nm' }, w.w), h('small', null, '🔊「' + (w.p || w.w) + '」　' + ((CAT[w.cat] || {}).name || '') + (w.u ? '　🚨いそぎ' : '') + (w.off ? '　（つかわない）' : '')))),
        h('div', { class: 'recrow' },
          h('button', { class: 'big-btn red', type: 'button', style: 'min-width:220px;min-height:68px', onclick: () => startRec(w, 1) }, '● 1回 とる'),
          h('button', { class: 'big-btn vio', type: 'button', style: 'min-width:220px;min-height:68px', onclick: () => startRec(w, 3) }, '●●● 3回 つづけて')),
        h('p', { class: 'help', style: 'margin:0' }, '「どうぞ」の あと、手を おろした ところから サイン → おわったら 手を おろす（または 手を とめる）と 1回 ぶん 保存されます。'),
        msgBox, memo,
        h('div', { class: 'samples' }, (w.samples || []).map((smp, i) => {
          const cv = h('canvas');
          const box = h('div', { class: 'smp' }, cv, h('span', { class: 'no' }, String(i + 1)),
            h('button', { class: 'del', type: 'button', onclick: () => { if (!confirm((i + 1) + 'ばんの みほんを けしますか？')) return; w.samples.splice(i, 1); saveSet(s); drawDetail(w); } }, '✕'));
          setTimeout(() => stops.push(animateSample(cv, smp)), 30 * i);
          return box;
        }))));
    }
    function cancelRec() { if (rec) { clearTimeout(rec.timer); rec = null; } cdown.textContent = ''; }
    function startRec(w, n) {
      cancelRec();
      rec = { w, left: n, armed: false, timer: null };
      countdown(3);
    }
    function countdown(k) {
      if (!rec) return;
      // いちど 手を おろしてから（手を あげる ところから 記録する。見本の 区切り方を そろえる）
      if (k === 0) { cdown.textContent = ''; rec.armed = true; seg.reset(); seg.state = 'wait'; seg.holdRef = null; speak('どうぞ', 1.1); return; }
      cdown.textContent = k; beep();
      rec.timer = setTimeout(() => countdown(k - 1), 800);
    }
    function onSample(seq) {
      const w = rec.w;
      addSample(w, seq); saveSet(s);
      // ほかの ことばと にていないか しらべる
      const others = prepFor(s); const th = E.thresholds(others, st.sens);
      const rk = E.rank(others, seq, { mirror: false }).filter(x => x.id !== w.id);
      const selfD = (() => { const own = E.prepare([{ id: w.id, samples: w.samples.slice(0, -1) }]); const r = E.rank(own, seq, {}); return r.length ? r[0].d : null; })();
      rec.left--;
      const left = rec.left;
      drawDetail(w);
      const msgs = [];
      if (rk.length && rk[0].d < th.ok * 1.1) { const o = wordById(s, rk[0].id); msgs.push(h('div', { class: 'warn' }, '⚠️「' + o.w + '」の サインと にています。まちがえやすいので、ちがいが はっきり するように とりなおすか、どちらかの とりかたを かえて みてください。')); }
      if (selfD != null && selfD > th.ok) msgs.push(h('div', { class: 'warn' }, 'ℹ️ まえの みほんと すこし ちがう うごきでした。ちがう やりかたも おぼえさせたい ときは このままで だいじょうぶです。'));
      if (!msgs.length) msgs.push(h('div', { class: 'okmsg' }, '✅ ほぞん しました（' + w.samples.length + 'こめ）' + (rk.length ? '　いちばん にている ほかの サイン：「' + (wordById(s, rk[0].id) || {}).w + '」' + (st.debug ? ' ' + rk[0].d.toFixed(2) : '') : '')));
      msgBox.append(...msgs);
      if (left > 0) { rec.armed = false; rec.timer = setTimeout(() => countdown(2), 900); } else rec = null;
    }
    const seg = newSeg();
    if (sel) drawDetail(sel); else drawList();
    bootCam(cb, info => {
      drawCam(cb.cv, info, seg);
      if (st.debug) cb.fps.textContent = Math.round(V.fps) + 'fps ' + (V.delegate || '');
      const r = seg.push(info.fr, info.t);
      let [cls, txt] = statusOf(seg, info);
      if (!rec) { txt = sel ? '「● とる」を おすと とうろく できます' : '← ことばを えらんでください'; cls = ''; }
      else if (!rec.armed) { txt = '⏳ よーい…'; }
      else if (rec.armed && seg.state === 'wait') { txt = '⬇️ いちど てを おろしてから サインしてね'; cls = 'sign'; }
      else if (rec.armed && seg.state === 'idle') txt = '🔴 「' + rec.w.w + '」の サインを どうぞ';
      cb.status.className = 'status ' + cls; if (cb.status.textContent !== txt) cb.status.textContent = txt;
      if (r && rec && rec.armed) { rec.armed = false; chime(false); onSample(E.resample(r.frames, r.times)); }
    });
    leave = () => { cancelRec(); stopAnims(); stopCam(); };
  }

  /* ---------- ことばの 編集 ---------- */
  function editWord(w, s, after) {
    const isNew = !w;
    const d = w ? Object.assign({}, w) : { id: 'my-' + uid(), cat: 'aisatsu', e: '🤟', w: '', p: '', s: '', u: false, memo: '', off: false, samples: [] };
    const f = (label, key, ph) => { const i = h('input', { type: 'text', value: d[key] || '', placeholder: ph || '' }); i.addEventListener('input', () => d[key] = i.value); return h('label', { class: 'field' }, h('span', null, label), i); };
    const catSel = h('select', null, VOCAB_CATS.map(c => h('option', { value: c.id, selected: c.id === d.cat }, c.e + ' ' + c.name)));
    catSel.addEventListener('change', () => d.cat = catSel.value);
    const tog = (label, key) => { const b = h('button', { type: 'button', class: 'pill' + (d[key] ? ' on' : '') }, (d[key] ? '✅ ' : '⬜ ') + label); b.addEventListener('click', () => { d[key] = !d[key]; b.className = 'pill' + (d[key] ? ' on' : ''); b.textContent = (d[key] ? '✅ ' : '⬜ ') + label; }); return b; };
    $('#edTitle').textContent = isNew ? '➕ ことばを ふやす' : '✏️ ことばを なおす';
    const bodyEl = $('#edBody'); bodyEl.innerHTML = '';
    bodyEl.append(
      f('えもじ（1つ）', 'e', '🤟'), f('ことば（カードに 大きく 出る）', 'w', 'れい：トイレ'), f('ていねいな いいかた（よみあげ）', 'p', 'れい：トイレに いきたいです'), f('よみかた（よみまちがえる ときだけ。漢字など）', 's', 'れい：歯'),
      h('label', { class: 'field' }, h('span', null, 'なかま'), catSel),
      h('div', { class: 'row' }, tog('いそぎ（赤く 光って くりかえす）', 'u'), tog('つかわない（よみとりから はずす）', 'off')),
      h('div', { class: 'row', style: 'margin-top:6px' },
        h('button', { class: 'big-btn go', type: 'button', style: 'min-width:200px;min-height:60px', onclick: async () => {
          d.w = (d.w || '').trim(); if (!d.w) { toast('ことばを いれてください'); return; }
          d.p = (d.p || '').trim() || d.w; d.e = (d.e || '').trim() || '🤟'; d.s = (d.s || '').trim();
          if (isNew) { s.words.push(d); w = d; } else Object.assign(w, d);
          await saveSet(s); $('#editor').classList.remove('open'); after && after(w);
        } }, '💾 ほぞん'),
        isNew ? '' : h('button', { class: 'pill danger', type: 'button', onclick: async () => { if (!confirm('「' + w.w + '」を セットから けしますか？（とうろくした サインも きえます）')) return; s.words.splice(s.words.indexOf(w), 1); await saveSet(s); $('#editor').classList.remove('open'); go('studio'); } }, '🗑️ けす')));
    $('#editor').classList.add('open');
  }
  $('#edClose').addEventListener('click', () => $('#editor').classList.remove('open'));
  $('#editor').addEventListener('click', e => { if (e.target.id === 'editor') $('#editor').classList.remove('open'); });

  /* ============================================================
     先生用メニュー
     ============================================================ */
  let tTab = 'sets';
  function openTeacher(tab) { if (tab) tTab = tab; if (canSpeak) speechSynthesis.cancel(); renderTeacher(); $('#teacher').classList.add('open'); }
  function closeTeacher() { $('#teacher').classList.remove('open'); }
  $('#tClose').addEventListener('click', closeTeacher);
  $('#teacher').addEventListener('click', e => { if (e.target.id === 'teacher') closeTeacher(); });
  function renderTeacher() {
    const tabs = $('#tTabs'); tabs.innerHTML = '';
    [['sets', '📚 セット・とうろく'], ['settings', '🛠️ せってい'], ['log', '📊 きろく'], ['help', '❓ つかいかた'], ['lic', '📜 ライセンス']].forEach(([k, t]) => tabs.append(h('button', { type: 'button', class: tTab === k ? 'on' : '', onclick: () => { tTab = k; renderTeacher(); } }, t)));
    const b = $('#tBody'); b.innerHTML = '';
    ({ sets: tSets, settings: tSettings, log: tLog, help: tHelp, lic: renderLicense })[tTab](b);
  }
  function tSets(b) {
    const s = active();
    put(b, h('button', { class: 'big-btn red', type: 'button', disabled: !s || s.builtin, onclick: () => { closeTeacher(); go('studio'); } }, '🎥 サインを とうろく する'),
      s && s.builtin ? h('p', { class: 'help', style: 'margin:0' }, '配布セットは そのままでは へんしゅう できません。「コピー」すると 自分の セットに なり、とうろく・なじませが できます。') : null,
      h('div', { class: 'lb', style: 'font-size:17px' }, 'つかう セットを えらぶ'));
    const list = h('div', { class: 'setlist' });
    SETS.forEach(x => {
      const on = x.id === st.activeSet;
      list.append(h('div', { class: 'setrow' + (on ? ' on' : '') },
        h('button', { class: 'pill small' + (on ? ' on' : ''), type: 'button', onclick: async () => { await ensureLoaded(x); st.activeSet = x.id; saveSt(); try { localStorage.setItem(ST_KEY + '-chosen', '1'); } catch (e) { /* 無視 */ } renderTeacher(); if (cur !== 'studio') go(cur); } }, on ? '✅ つかう' : 'えらぶ'),
        h('div', { class: 'nm' }, (x.builtin ? '🔒 ' : '') + x.name, h('small', null, x.builtin ? '配布セット' + (x.desc ? '・' + x.desc : '') + (x.loaded ? '　サイン ' + recCount(x) + 'こ' : '') : 'ことば ' + x.words.length + '・サイン ' + recCount(x) + 'こ')),
        h('button', { class: 'pill small', type: 'button', onclick: async () => { await ensureLoaded(x); const name = prompt('コピーした セットの なまえ', x.name + '（' + (x.builtin ? 'じぶんよう' : 'コピー') + '）'); if (!name) return; const c = { id: 'u-' + uid(), name, made: Date.now(), loaded: true, words: JSON.parse(JSON.stringify(x.words)) }; await DB.put(c); SETS.push(c); st.activeSet = c.id; saveSt(); renderTeacher(); } }, '📄 コピー'),
        x.builtin ? null : h('button', { class: 'pill small', type: 'button', onclick: async () => { const name = prompt('セットの なまえ', x.name); if (!name) return; x.name = name; await saveSet(x); renderTeacher(); } }, '✏️'),
        h('button', { class: 'pill small', type: 'button', onclick: () => { if (x.loaded) exportSet(x); else ensureLoaded(x).then(() => { toast('じゅんび できました。もう いちど「かきだす」を おしてください'); renderTeacher(); }); } }, '📤 かきだす'),
        x.builtin ? null : h('button', { class: 'pill small danger', type: 'button', onclick: async () => { if (!confirm('「' + x.name + '」を けしますか？ とうろくした サインも ぜんぶ きえます。（さきに「かきだす」で バックアップ できます）')) return; await DB.del(x.id); SETS.splice(SETS.indexOf(x), 1); if (st.activeSet === x.id) st.activeSet = (SETS[0] || {}).id || ''; saveSt(); renderTeacher(); } }, '🗑️')));
    });
    b.append(list,
      h('div', { class: 'row' },
        h('button', { class: 'pill', type: 'button', onclick: async () => { const name = prompt('あたらしい セットの なまえ（れい：○○さんの サイン、マカトン）', ''); if (!name) return; const all = confirm('はじめから ある ことば（' + VOCAB.length + 'ご）を 入れますか？\n\nOK → ぜんぶ 入れる\nキャンセル → からっぽで つくる'); const c = { id: 'u-' + uid(), name, made: Date.now(), loaded: true, words: all ? VOCAB.map(wordFromVocab) : [] }; await DB.put(c); SETS.push(c); st.activeSet = c.id; saveSt(); renderTeacher(); } }, '➕ あたらしい セット'),
        h('button', { class: 'pill', type: 'button', onclick: () => $('#fileIn').click() }, '📥 ファイルを よみこむ')),
      h('p', { class: 'help', style: 'margin:0' }, '「かきだす」で できた ファイル（.json）は AirDrop や メールで ほかの iPad に わたせます。うけとった iPad で「ファイルを よみこむ」を おすと、とうろく しなくても すぐ つかえます。カメラの 映像は 保存されず、手と からだの 点の 動きだけが 入ります。'));
  }
  $('#fileIn').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) importFile(f); e.target.value = ''; });
  function tSettings(b) {
    const seg = (label, key, opts, help) => h('div', { class: 'row' }, h('span', { class: 'lb' }, label),
      h('div', { class: 'seg' }, opts.map(([v, t]) => h('button', { type: 'button', class: st[key] === v ? 'on' : '', onclick: () => { st[key] = v; saveSt(); syncSeg(); renderTeacher(); } }, t))), help ? h('small', null, help) : null);
    const range = (label, key, min, max, step, fmt, help) => { const out = h('span', { style: 'min-width:60px' }, fmt(st[key])); const r = h('input', { type: 'range', min, max, step, value: st[key] }); r.addEventListener('input', () => { st[key] = parseFloat(r.value); out.textContent = fmt(st[key]); saveSt(); syncSeg(); }); return h('div', { class: 'row' }, h('span', { class: 'lb' }, label), r, out, help ? h('small', null, help) : null); };
    b.append(
      seg('きき手', 'lefty', [[false, '✋ みぎ'], [true, '🤚 ひだり']], '片手の サインは どちらの 手でも よみとります'),
      seg('よみあげ', 'say', [['w', 'ことばだけ'], ['p', 'ていねいに'], ['none', 'よまない']]),
      range('こえの はやさ', 'rate', 0.6, 1.3, 0.05, v => v.toFixed(2)),
      seg('ピンポン音', 'chime', [[true, 'ならす'], [false, 'ならさない']]),
      seg('いそぎの くりかえし', 'urgentRepeat', [[true, 'くりかえす'], [false, '1回だけ']], 'トイレ・いたい などは「わかったよ」を おすまで 知らせます'),
      seg('たしかめ', 'confirm', [['auto', 'じしんが あれば すぐ'], ['always', 'いつも えらばせる']]),
      seg('かんど', 'sens', [[1, 'きびしい'], [2, 'ふつう'], [3, 'ゆるい']], 'まちがいが 多い → きびしい ／ わかってもらえない → ゆるい'),
      seg('左右はんたいの サイン', 'mirror', [[true, 'OK'], [false, 'みとめない']], '向かいあって まねした 子の サインも わかるように します'),
      seg('手を とめて きめる', 'hold', [[true, 'つかう'], [false, 'つかわない']], '手を おろさなくても、止めると 1つの サインとして 区切ります'),
      seg('とめる 長さ', 'holdMs', [[500, 'みじかい'], [700, 'ふつう'], [1000, 'ながい']]),
      range('おろす いち', 'restY', 0.9, 2.8, 0.05, v => v.toFixed(2), 'カメラ画面の 黄色い 線より 下に 手が あると「まっている」と みなします。すわって 机に 手を おく ときは 小さめに'),
      seg('カメラの えいぞう', 'showVideo', [[true, 'みせる'], [false, 'ほねだけ']], '映像が 気になる 子には「ほねだけ」'),
      seg('なじませ', 'learn', [[true, 'する'], [false, 'しない']], 'つかいながら その子の サインを おぼえます：自信を もって よめた とき・「もしかして？」で えらんだ とき・「✋ ちがう」で なおした とき（1つの ことばに 6こまで・ふるい ものから いれかわる。自分の セットのみ）'),
      seg('すうじを みせる', 'debug', [[false, 'みせない'], [true, 'みせる']], '先生用：近さの すうじ・fps を 表示'),
      h('p', { class: 'help', style: 'margin:10px 0 0;text-align:center' }, '© 2026 MieeL　学校や家庭での利用は自由です（無断転載・再配布・販売はお断り）。くわしくは「📜 ライセンス」')
    );
  }
  function tLog(b) {
    const a = logAll();
    const day = new Date(); day.setHours(0, 0, 0, 0);
    const today = a.filter(x => x.t >= day.getTime());
    const cnt = {}; a.filter(x => x.t >= Date.now() - 30 * 864e5).forEach(x => { cnt[x.w] = (cnt[x.w] || 0) + 1; });
    const top = Object.keys(cnt).sort((p, q) => cnt[q] - cnt[p]).slice(0, 20);
    b.append(h('div', { class: 'lb', style: 'font-size:17px' }, '📅 きょう つたえた ことば（' + today.length + '）'),
      today.length ? h('table', { class: 'log' }, today.slice().reverse().slice(0, 60).map(x => h('tr', null, h('td', null, new Date(x.t).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })), h('td', null, x.w), h('td', null, x.k === 'pick' ? 'えらんだ' : 'サイン')))) : h('p', { class: 'help' }, 'まだ ありません'),
      h('div', { class: 'lb', style: 'font-size:17px' }, '📈 この 30日で よく つかった ことば'),
      top.length ? h('table', { class: 'log' }, top.map(k => h('tr', null, h('td', null, k), h('td', null, cnt[k] + ' 回')))) : h('p', { class: 'help' }, 'まだ ありません'),
      h('div', { class: 'row' },
        h('button', { class: 'pill', type: 'button', onclick: () => { const csv = '﻿日時,ことば,しかた\n' + a.map(x => new Date(x.t).toLocaleString('ja-JP') + ',' + x.w + ',' + (x.k === 'pick' ? 'えらんだ' : 'サイン')).join('\n'); const el = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'サインのきろく.csv' }); document.body.appendChild(el); el.click(); setTimeout(() => el.remove(), 500); } }, '📄 CSV で かきだす'),
        h('button', { class: 'pill danger', type: 'button', onclick: () => { if (confirm('きろくを ぜんぶ けしますか？')) { localStorage.removeItem(LOG_KEY); renderTeacher(); } } }, '🗑️ きろくを けす')),
      h('p', { class: 'help', style: 'margin:0' }, 'きろくは この iPad の 中だけに あります。'));
  }
  function tHelp(b) {
    b.innerHTML = `
    <div class="help" style="font-size:16px;color:var(--ink)">
    <b>1. サインを とうろく する</b><br>「セット・とうろく」→「🎥 サインを とうろく」→ ことばを えらぶ →「●●● 3回 つづけて」。「どうぞ」の あとに サインを して、手を おろす（または 止める）と 1回分 保存されます。<br>
    ・3回 くらい とると よく わかるように なります。ちがう 人（先生・子ども）で とると、だれが やっても わかりやすく なります。<br>
    ・ほかの サインと にていると ⚠️ で 知らせます。<br><br>
    <b>2. つたえる</b><br>ホーム →「🗣️ つたえる」。カメラに かたと 手が うつる ように iPad を おきます（スタンドで ななめ前・80cm〜1.5m くらい）。<br>
    てを あげて サイン → おろす と、大きな カードと こえで つたえます。じしんが ない ときは「もしかして？」で えらべます。<br>
    ・トイレ・いたい など「いそぎ」の ことばは 赤く 光り、「わかったよ」を おすまで くりかえします。<br>
    ・つづけて サインすると 下に ことばが ならび、「🔊 ぜんぶ」で 文として よみます（れい：おちゃ ＋ ください）。<br><br>
    <b>3. くばる・うけとる</b><br>「📤 かきだす」→ AirDrop などで わたす → うけとった iPad で「📥 ファイルを よみこむ」。手話・マカトン・その子の オリジナルなど、セットを いくつでも 作って きりかえられます。<br><br>
    <b>4. その子に なじませる</b><br>配布セットを「コピー」して その子用に し、その子の サインを 1〜3回 とうろく すると、その子の くせも わかるように なります。「なじませ」を「する」に すると、「もしかして？」で えらんだ ものも おぼえます。<br><br>
    <b>プライバシー</b><br>カメラの 映像は どこにも 送らず、保存も しません。iPad の 中で 手と からだの 点に して、その 動きだけを 使います。<br><br>
    <b>うまく いかない とき</b><br>・「からだが うつるように」と 出る → かたが 画面に 入る ように はなれる<br>・サインの とちゅうで 区切られる →「手を とめて きめる」を「ながい」か「つかわない」に<br>・まちがいが 多い →「かんど」を「きびしい」・にている サインを とりなおす<br>・手を おろしても 終わらない →「おろす いち」を 小さく
    </div>`;
  }


  /* ---------- ライセンス・著作権 ---------- */
  function renderLicense(b) {
    b.innerHTML = `<div class="lic">
      <h3>このアプリ</h3>
      <p><b>© 2026 MieeL（ミエル）</b>　<a href="https://www.mieel-support-school.com/" target="_blank" rel="noopener">www.mieel-support-school.com</a><br>
      学校・家庭・放課後等デイサービス・療育機関などで、子どもの学習や支援のために使うことは自由です（費用はかかりません）。<br>
      プログラム・画像・文章の無断転載・複製、改変しての公開・再配布、販売、有料の サービスや 商品への 組みこみは お断りします。くわしくは <a href="LICENSE.md" target="_blank" rel="noopener">LICENSE.md</a> を ご覧ください。</p>
      <h3>使っている ソフトウェア</h3>
      <div class="licitem"><b>MediaPipe Tasks Vision</b>（@mediapipe/tasks-vision 1.1.0）・モデル：hand_landmarker・pose_landmarker_lite<br>
      Copyright The MediaPipe Authors / Google LLC<br>
      Apache License, Version 2.0 で 公開されています。<a href="https://github.com/google-ai-edge/mediapipe" target="_blank" rel="noopener">github.com/google-ai-edge/mediapipe</a><br>
      このアプリでは 変更せずに そのまま 同梱しています（vendor/ フォルダ）。<br>
      <button class="pill" type="button" id="licFull" style="margin-top:8px;height:42px">📄 Apache License 2.0 の 全文を ひょうじ</button>
      <pre id="licText" hidden></pre></div>
      <div class="licitem"><b>フォント Klee One</b>　© Fontworks Inc.　SIL Open Font License 1.1（Google Fonts から 読みこみ）</div>
      <div class="licitem"><b>絵文字</b>　iPad・パソコンに 入っている 標準の 絵文字フォントで 表示しています（アプリには ふくまれていません）。</div>
      <h3>プライバシー</h3>
      <p>カメラの 映像は 保存も 送信も しません。読み取りは すべて この端末の 中で 行います。きろくは この端末の 中だけに 保存されます。</p>
    </div>`;
    const btn = b.querySelector('#licFull'), pre = b.querySelector('#licText');
    btn.addEventListener('click', async () => {
      if (!pre.hidden) { pre.hidden = true; return; }
      pre.hidden = false; pre.textContent = 'よみこみ ちゅう…';
      try { const r = await fetch('vendor/LICENSE-APACHE-2.0.txt'); pre.textContent = r.ok ? await r.text() : 'https://www.apache.org/licenses/LICENSE-2.0'; } catch (e) { pre.textContent = 'オフラインの ため 表示できません。https://www.apache.org/licenses/LICENSE-2.0'; }
    });
  }
  /* ---------- ⚙️ ながおし ---------- */
  (function () {
    const g = $('#gear'); let t = null; const c = () => { clearTimeout(t); g.classList.remove('pressing'); };
    g.addEventListener('pointerdown', e => { e.preventDefault(); g.classList.add('pressing'); t = setTimeout(() => { c(); openTeacher(); }, 1500); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => g.addEventListener(ev, c));
    g.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('keydown', e => { if (e.shiftKey && (e.key === 'S' || e.key === 's') && !/INPUT|SELECT|TEXTAREA/.test((e.target || {}).tagName || '')) openTeacher(); if (e.key === 'Escape') { closeTeacher(); $('#editor').classList.remove('open'); closeOverlay(); } });
  })();
  function makeTouchIcon() { try { const c = document.createElement('canvas'); c.width = c.height = 180; const g = c.getContext('2d'); g.fillStyle = '#74C0FC'; g.fillRect(0, 0, 180, 180); g.font = '118px "Apple Color Emoji","Segoe UI Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🤟', 90, 98); $('#touchIcon').href = c.toDataURL(); } catch (e) { /* 無視 */ } }

  /* ============================================================
     はじまり
     ============================================================ */
  if (canSpeak) { loadVoice(); speechSynthesis.onvoiceschanged = loadVoice; }
  // iPad は さいしょの タップで 音を 出せるように なる
  document.addEventListener('pointerdown', function unlock() { audio(); if (canSpeak) { try { const u = new SpeechSynthesisUtterance(''); u.volume = 0; speechSynthesis.speak(u); } catch (e) { /* 無視 */ } } document.removeEventListener('pointerdown', unlock); }, { once: true });
  makeTouchIcon();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
  loadSets().then(() => go('home')).catch(e => { console.error(e); go('home'); });
  // つかいそうな ときは さきに よみとりの じゅんびを はじめておく
  setTimeout(() => { if (recCount(active())) loadVision().catch(() => {}); }, 1500);
  window.__sign = { E, V, get sets() { return SETS; }, st, prepFor, active, loadVision };
})();
