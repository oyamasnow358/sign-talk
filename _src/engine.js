/* ============================================================
   サインエンジン（カメラの点 → からだ基準の点 → 特徴 → 見本と照らし合わせ）
   ・ブラウザでも node でも動く（テスト用に module.exports も出す）
   ・座標は「かたの まんなか」が 0、「かたはば」が 1。x は 見ている人から見て右（＝サインする人の左）が ＋、y は下が ＋
   ============================================================ */
(function (root) {
  'use strict';
  const L = 20;            // 見本・入力を この コマ数に そろえる
  const NH = 63;           // 手 1つ = 21点 × xyz
  const FMT = 1;           // 見本データの 形式 番号

  /* ---------- カメラの結果 → からだ基準の 1コマ ---------- */
  // hands: [[{x,y,z}×21], …]  handed: [[{categoryName}], …]  pose: [{x,y,z,visibility}×33]  W,H: 映像の大きさ
  function frameFrom(hands, handed, pose, W, H, lefty) {
    if (!pose || !pose[11] || !pose[12]) return null;
    const vis = p => p.visibility == null || p.visibility > 0.45;
    if (!vis(pose[11]) || !vis(pose[12])) return null;
    const px = p => [p.x * W, p.y * H, (p.z || 0) * W];
    const Ls = px(pose[11]), Rs = px(pose[12]);
    const O = [(Ls[0] + Rs[0]) / 2, (Ls[1] + Rs[1]) / 2];
    let ux = [Ls[0] - Rs[0], Ls[1] - Rs[1]];
    const s = Math.hypot(ux[0], ux[1]);
    if (s < 8) return null;
    ux = [ux[0] / s, ux[1] / s];
    const vy = [-ux[1], ux[0]];
    const B = q => { const dx = q[0] - O[0], dy = q[1] - O[1]; return [(dx * ux[0] + dy * ux[1]) / s, (dx * vy[0] + dy * vy[1]) / s, q[2] / s]; };
    // 手を「右手・左手」に 分ける（からだの 手首に 近いほう。だめなら モデルの 左右を 反対に 読む）
    const wL = pose[15] && vis(pose[15]) ? px(pose[15]) : null, wR = pose[16] && vis(pose[16]) ? px(pose[16]) : null;
    let R = null, Lh = null;
    const list = (hands || []).map((h, i) => {
      const w = px(h[0]);
      let side;
      if (wL && wR) side = Math.hypot(w[0] - wR[0], w[1] - wR[1]) <= Math.hypot(w[0] - wL[0], w[1] - wL[1]) ? 'R' : 'L';
      else { const c = handed && handed[i] && handed[i][0] && handed[i][0].categoryName; side = c === 'Left' ? 'R' : c === 'Right' ? 'L' : (w[0] < O[0] ? 'R' : 'L'); }
      return { h, side, x: w[0] };
    });
    if (list.length === 2 && list[0].side === list[1].side) { const a = list[0].x < list[1].x ? 0 : 1; list[a].side = 'R'; list[1 - a].side = 'L'; }
    list.forEach(o => { if (o.side === 'R') R = o.h; else Lh = o.h; });
    const conv = h => { if (!h) return null; const a = new Float32Array(NH); for (let k = 0; k < 21; k++) { const b = B(px(h[k])); a[k * 3] = b[0]; a[k * 3 + 1] = b[1]; a[k * 3 + 2] = b[2]; } return a; };
    const nose = B(px(pose[0])), mo = pose[9] && pose[10] ? B([(pose[9].x + pose[10].x) / 2 * W, (pose[9].y + pose[10].y) / 2 * H, 0]) : nose;
    let fr = { d: conv(R), n: conv(Lh), f: [nose[0], nose[1], mo[0], mo[1]] };
    if (lefty) fr = mirrorFrame(fr);      // 左ききは 右ききの 形に そろえる
    return fr;
  }

  function mirrorHand(a) { if (!a) return null; const b = new Float32Array(a); for (let k = 0; k < 21; k++) b[k * 3] = -a[k * 3]; return b; }
  function mirrorFrame(fr) { return fr && { d: mirrorHand(fr.n), n: mirrorHand(fr.d), f: [-fr.f[0], fr.f[1], -fr.f[2], fr.f[3]] }; }
  function mirrorSeq(seq) { return seq.map(mirrorFrame); }

  /* ---------- 手のひらの まんなか ---------- */
  function palm(a) { if (!a) return null; let x = 0, y = 0; [0, 5, 9, 13, 17].forEach(k => { x += a[k * 3]; y += a[k * 3 + 1]; }); return [x / 5, y / 5]; }

  /* ---------- 時間で L コマに そろえる ---------- */
  function lerpArr(a, b, t) { const r = new Float32Array(a.length); for (let i = 0; i < a.length; i++) r[i] = a[i] + (b[i] - a[i]) * t; return r; }
  function resample(frames, times, n) {
    n = n || L;
    if (!frames.length) return [];
    const t0 = times[0], t1 = times[times.length - 1], out = [];
    const near = (key, i, t) => {   // i の まわりで その手が うつっている コマを さがす
      let lo = i, hi = i + 1;
      while (lo >= 0 && !frames[lo][key]) lo--;
      while (hi < frames.length && !frames[hi][key]) hi++;
      const A = lo >= 0 ? frames[lo][key] : null, Bv = hi < frames.length ? frames[hi][key] : null;
      if (A && Bv) { const tt = (t - times[lo]) / Math.max(1, times[hi] - times[lo]); return lerpArr(A, Bv, Math.min(1, Math.max(0, tt))); }
      const ok = A ? Math.abs(t - times[lo]) < 260 : Bv ? Math.abs(times[hi] - t) < 260 : false;
      return ok ? new Float32Array(A || Bv) : null;
    };
    let j = 0;
    for (let k = 0; k < n; k++) {
      const t = t0 + (t1 - t0) * (n === 1 ? 0 : k / (n - 1));
      while (j < frames.length - 2 && times[j + 1] < t) j++;
      const tt = Math.min(1, Math.max(0, (t - times[j]) / Math.max(1, (times[j + 1] || times[j]) - times[j])));
      const fa = frames[j], fb = frames[Math.min(j + 1, frames.length - 1)];
      const f = fa.f.map((v, i) => v + (fb.f[i] - v) * tt);
      const pick = key => (fa[key] && fb[key]) ? lerpArr(fa[key], fb[key], tt) : near(key, j, t);
      out.push({ d: pick('d'), n: pick('n'), f });
    }
    return out;
  }

  /* ---------- 片手だけの サインは、どちらの手でも 右手として あつかう ---------- */
  function normalizeSeq(seq) {
    let d = 0, n = 0;
    seq.forEach(fr => { if (fr.d) d++; if (fr.n) n++; });
    return (d < seq.length * 0.3 && n > d) ? mirrorSeq(seq) : seq;
  }

  /* ---------- 見本データ ⇔ 文字列 ---------- */
  function b64enc(u8) { if (typeof btoa === 'function') { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); } return Buffer.from(u8).toString('base64'); }
  function b64dec(s) { if (typeof atob === 'function') { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; } return new Uint8Array(Buffer.from(s, 'base64')); }
  function encode(seq) {
    let len = 2;
    seq.forEach(fr => { len += 1 + 2 * (4 + (fr.d ? NH : 0) + (fr.n ? NH : 0)); });
    const buf = new ArrayBuffer(len), dv = new DataView(buf);
    let o = 0;
    dv.setUint8(o++, FMT); dv.setUint8(o++, seq.length);
    const put = v => { dv.setInt16(o, Math.max(-32767, Math.min(32767, Math.round(v * 1000))), true); o += 2; };
    seq.forEach(fr => {
      dv.setUint8(o++, (fr.d ? 1 : 0) | (fr.n ? 2 : 0));
      fr.f.forEach(put);
      if (fr.d) fr.d.forEach(put);
      if (fr.n) fr.n.forEach(put);
    });
    return b64enc(new Uint8Array(buf));
  }
  function decode(str) {
    const u8 = b64dec(str), dv = new DataView(u8.buffer);
    let o = 0;
    const ver = dv.getUint8(o++); if (ver !== FMT) throw new Error('format');
    const n = dv.getUint8(o++), out = [];
    const get = () => { const v = dv.getInt16(o, true) / 1000; o += 2; return v; };
    for (let k = 0; k < n; k++) {
      const fl = dv.getUint8(o++);
      const f = [get(), get(), get(), get()];
      let d = null, m = null;
      if (fl & 1) { d = new Float32Array(NH); for (let i = 0; i < NH; i++) d[i] = get(); }
      if (fl & 2) { m = new Float32Array(NH); for (let i = 0; i < NH; i++) m[i] = get(); }
      out.push({ d, n: m, f });
    }
    return out;
  }

  /* ---------- 特徴（手の形・向き・顔との位置・動き） ----------
     1コマ = [右手 43 | 左手 43 | 右手の動き 2 | 左手の動き 2 | 両手の位置関係 2] = 92 の数
     手 43 = 形 31（指の関節15・指の開き4・親指と各指先4・指先と手のひら5・となりの指先3）
             向き 6（手のひらの向き・指の向き）
             位置 6（手のひら：からだ基準・鼻から／人さし指の先：鼻から） */
  const CH = [[0, 1, 2], [1, 2, 3], [2, 3, 4], [0, 5, 6], [5, 6, 7], [6, 7, 8], [0, 9, 10], [9, 10, 11], [10, 11, 12], [0, 13, 14], [13, 14, 15], [14, 15, 16], [0, 17, 18], [17, 18, 19], [18, 19, 20]];
  const SP = [[5, 6, 9, 10], [9, 10, 13, 14], [13, 14, 17, 18], [2, 3, 5, 6]];
  const TIPS = [4, 8, 12, 16, 20];
  const P = (a, k) => [a[k * 3], a[k * 3 + 1], a[k * 3 + 2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const len = v => Math.hypot(v[0], v[1], v[2]);
  const nrm = v => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const angle = (u, v) => { const a = nrm(u), b = nrm(v); return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / Math.PI; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const NS = 31, NO = 6, NP = 6, HD = NS + NO + NP, VD = HD * 2 + 6;
  // グループ（重みの 学習を グループごとに そろえる）と 基本の 重み
  const GROUP = [], BASE = new Float32Array(VD);
  (function () {
    const put = (from, n, g, w) => { for (let i = 0; i < n; i++) { GROUP[from + i] = g; BASE[from + i] = w; } };
    [0, HD].forEach((o, hi) => {
      const k = hi ? 0.7 : 1;
      put(o, NS, 'shape', 4.5 / NS * k);
      put(o + NS, NO, 'ori', 1.2 / NO * k);
      put(o + NS + NO, 2, 'body', 0.25 * k);       // 手のひら（からだ基準）
      put(o + NS + NO + 2, 2, 'face', 0.4 * k);    // 手のひら（鼻から）
      put(o + NS + NO + 4, 2, 'face', 0.45 * k);   // 人さし指の先（鼻から）
    });
    put(HD * 2, 2, 'mov', 0.6); put(HD * 2 + 2, 2, 'mov', 0.4); put(HD * 2 + 4, 2, 'rel', 0.5);
  })();
  const MISS_D = 2.2, MISS_N = 1.2;
  function handVec(a, f, isN, out, o) {
    let k = o;
    CH.forEach(c => { out[k++] = angle(sub(P(a, c[1]), P(a, c[0])), sub(P(a, c[2]), P(a, c[1]))); });
    SP.forEach(c => { out[k++] = angle(sub(P(a, c[1]), P(a, c[0])), sub(P(a, c[3]), P(a, c[2]))); });
    const pl = len(sub(P(a, 9), P(a, 0))) || 1e-3;
    const pc = [0, 0, 0]; [0, 5, 9, 13, 17].forEach(i => { const q = P(a, i); pc[0] += q[0] / 5; pc[1] += q[1] / 5; pc[2] += q[2] / 5; });
    const d = (u, v) => Math.min(2, len(sub(u, v)) / pl) / 2;
    [8, 12, 16, 20].forEach(t => { out[k++] = d(P(a, 4), P(a, t)); });          // 親指と 各指の先（OK・つまむ 形）
    TIPS.forEach(t => { out[k++] = d(P(a, t), pc); });                           // 指先と 手のひら（のびている／にぎっている）
    [[8, 12], [12, 16], [16, 20]].forEach(([u, v]) => { out[k++] = d(P(a, u), P(a, v)); });   // となりの 指先（くっつく／はなれる）
    let nv = nrm(cross(sub(P(a, 5), P(a, 0)), sub(P(a, 17), P(a, 0))));
    if (isN) nv = [-nv[0], -nv[1], -nv[2]];
    const dv = nrm(sub(P(a, 9), P(a, 0)));
    out[k++] = nv[0]; out[k++] = nv[1]; out[k++] = nv[2]; out[k++] = dv[0]; out[k++] = dv[1]; out[k++] = dv[2];
    out[k++] = pc[0]; out[k++] = pc[1];
    out[k++] = pc[0] - f[0]; out[k++] = pc[1] - f[1];
    out[k++] = a[8 * 3] - f[0]; out[k++] = a[8 * 3 + 1] - f[1];
    return pc;
  }
  function features(seq) {
    const out = seq.map(fr => {
      const v = new Float32Array(VD);
      const pd = fr.d ? handVec(fr.d, fr.f, false, v, 0) : null;
      const pn = fr.n ? handVec(fr.n, fr.f, true, v, HD) : null;
      if (pd && pn) { v[HD * 2 + 4] = pd[0] - pn[0]; v[HD * 2 + 5] = pd[1] - pn[1]; }
      return { v, hd: !!fr.d, hn: !!fr.n, pd, pn, w: 1 };
    });
    // うごき（となりの コマとの 差）
    for (let k = 0; k < out.length; k++) {
      const a = out[Math.max(0, k - 1)], b = out[Math.min(out.length - 1, k + 1)];
      if (a.pd && b.pd) { out[k].v[HD * 2] = (b.pd[0] - a.pd[0]) * 3; out[k].v[HD * 2 + 1] = (b.pd[1] - a.pd[1]) * 3; }
      if (a.pn && b.pn) { out[k].v[HD * 2 + 2] = (b.pn[0] - a.pn[0]) * 3; out[k].v[HD * 2 + 3] = (b.pn[1] - a.pn[1]) * 3; }
    }
    // 手を あげる・おろす とちゅう（いちばん 低い ところ）は かるく みる
    let ymax = -9; out.forEach(o => { const p = o.pd || o.pn; if (p) ymax = Math.max(ymax, p[1]); });
    out.forEach(o => { const p = o.pd || o.pn; o.w = p ? Math.max(0.25, Math.min(1, (ymax - p[1]) / 0.35 + 0.25)) : 0.5; });
    return out;
  }

  /* ---------- コマどうしの ちがい ---------- */
  function l1(a, b, W, from, to) { let s = 0; for (let i = from; i < to; i++) s += W[i] * Math.abs(a[i] - b[i]); return s; }
  function frameDist(a, b, W) {
    W = W || BASE;
    let d = 0;
    if (a.hd && b.hd) d += l1(a.v, b.v, W, 0, HD) + l1(a.v, b.v, W, HD * 2, HD * 2 + 2); else if (a.hd || b.hd) d += MISS_D;
    if (a.hn && b.hn) d += l1(a.v, b.v, W, HD, HD * 2) + l1(a.v, b.v, W, HD * 2 + 2, HD * 2 + 4); else if (a.hn || b.hn) d += MISS_N;
    if (a.hd && a.hn && b.hd && b.hn) d += l1(a.v, b.v, W, HD * 2 + 4, VD);
    return d * (a.w + b.w) / 2;
  }
  // DTW（はやさの ちがいを 吸収して くらべる）
  function dtw(A, Bq, W) {
    const n = A.length, m = Bq.length, band = Math.max(3, Math.ceil(Math.max(n, m) * 0.3));
    const INF = 1e9; let prev = new Float64Array(m + 1).fill(INF), cur = new Float64Array(m + 1);
    prev[0] = 0;
    for (let i = 1; i <= n; i++) {
      cur.fill(INF);
      const lo = Math.max(1, Math.round(i * m / n) - band), hi = Math.min(m, Math.round(i * m / n) + band);
      for (let j = lo; j <= hi; j++) cur[j] = frameDist(A[i - 1], Bq[j - 1], W) + Math.min(prev[j], cur[j - 1], prev[j - 1]);
      const t = prev; prev = cur; cur = t;
    }
    return prev[m] / (n + m);
  }

  /* ---------- 見本から「見分けに 効く 特徴」を 学ぶ ----------
     同じ ことばの 見本どうしでは ばらつかず、ちがう ことばの あいだでは ちがう 特徴を 重く する（フィッシャーの 考え方） */
  function learnWeights(items) {
    const byId = {}; items.forEach(it => (byId[it.id] = byId[it.id] || []).push(it));
    const ids = Object.keys(byId), multi = ids.filter(id => byId[id].length >= 2);
    if (ids.length < 3 || multi.length < 2) return { W: BASE, learned: false };
    const Wv = new Float64Array(VD), Wn = new Float64Array(VD), means = [];
    ids.forEach(id => {
      const g = byId[id], L0 = g[0].f.length, sum = new Float64Array(VD), cnt = new Float64Array(VD);
      for (let k = 0; k < L0; k++) {
        for (let d = 0; d < VD; d++) {
          const vals = [];
          g.forEach(it => { const fr = it.f[k]; if (!fr) return; const ok = d < HD ? fr.hd : d < HD * 2 ? fr.hn : d < HD * 2 + 2 ? fr.hd : d < HD * 2 + 4 ? fr.hn : fr.hd && fr.hn; if (ok) vals.push(fr.v[d]); });
          vals.forEach(x => { sum[d] += x; cnt[d]++; });
          if (vals.length >= 2) { const m = vals.reduce((s, x) => s + x, 0) / vals.length; Wv[d] += vals.reduce((s, x) => s + (x - m) * (x - m), 0) / vals.length; Wn[d]++; }
        }
      }
      means.push(Array.from(sum, (s, d) => cnt[d] ? s / cnt[d] : NaN));
    });
    const f = new Float64Array(VD);
    for (let d = 0; d < VD; d++) {
      const ms = means.map(m => m[d]).filter(x => !isNaN(x));
      if (ms.length < 2 || !Wn[d]) { f[d] = 1; continue; }
      const mm = ms.reduce((s, x) => s + x, 0) / ms.length, between = ms.reduce((s, x) => s + (x - mm) * (x - mm), 0) / ms.length;
      const within = Wv[d] / Wn[d];
      f[d] = Math.sqrt((between + 1e-4) / (within + 1e-4));
    }
    // グループごとに 平均 1 に そろえ、0.3〜3 に おさめ、見本が すくない ときは ひかえめに
    const conf = Math.min(1, multi.length / 8);
    const W = new Float32Array(VD), gs = {};
    for (let d = 0; d < VD; d++) { const g = GROUP[d]; (gs[g] = gs[g] || []).push(f[d]); }
    const gm = {}; Object.keys(gs).forEach(g => { gm[g] = gs[g].reduce((s, x) => s + x, 0) / gs[g].length || 1; });
    for (let d = 0; d < VD; d++) { const r = Math.max(0.3, Math.min(3, f[d] / gm[GROUP[d]])); W[d] = BASE[d] * (1 + (r - 1) * conf); }
    return { W, learned: true };
  }

  /* ---------- 見本あつめ と 判定 ---------- */
  // words: [{id, samples:[文字列…]}]  → 内部用の 準備データ
  function prepare(words, opt) {
    const items = [];
    words.forEach(w => (w.samples || []).forEach((smp, i) => {
      try { items.push({ id: w.id, i, f: features(normalizeSeq(decode(smp))) }); } catch (e) { /* こわれた 見本は とばす */ }
    }));
    const lw = opt && opt.noLearn ? { W: BASE, learned: false } : learnWeights(items);
    // 同じ ことばの 見本どうしの ちがい（その セットの「ふつうの ばらつき」）
    const intra = [];
    const byId = {};
    items.forEach(it => (byId[it.id] = byId[it.id] || []).push(it));
    Object.keys(byId).forEach(id => { const g = byId[id]; for (let a = 0; a < g.length; a++) for (let b = a + 1; b < g.length; b++) intra.push(dtw(g[a].f, g[b].f, lw.W)); });
    intra.sort((a, b) => a - b);
    const med = intra.length ? intra[Math.floor(intra.length / 2)] : null;
    return { items, med, count: Object.keys(byId).length, W: lw.W, learned: lw.learned };
  }
  // 入力（L コマに そろえた からだ基準の 列）→ 近い じゅんの ランキング
  function rank(prep, seq, opt) {
    opt = opt || {};
    const q = features(normalizeSeq(seq));
    const qm = opt.mirror ? features(normalizeSeq(mirrorSeq(seq))) : null;
    const best = {};
    prep.items.forEach(it => {
      if (opt.only && !opt.only[it.id]) return;
      if (opt.skip && opt.skip(it)) return;
      let d = dtw(q, it.f, prep.W);
      if (qm) d = Math.min(d, dtw(qm, it.f, prep.W) + 0.05);
      if (best[it.id] == null || d < best[it.id]) best[it.id] = d;
    });
    return Object.keys(best).map(id => ({ id, d: best[id] })).sort((a, b) => a.d - b.d);
  }
  // まちがえやすい 組み合わせを さがす（見本を 1つずつ はずして ほかで 判定）
  function meanVec(f, W) {   // おおまかな くらべ用（コマの 平均）
    const m = new Float32Array(VD + 2); let n = 0;
    f.forEach(fr => { for (let d = 0; d < VD; d++) m[d] += fr.v[d] * fr.w; if (fr.hd) m[VD] += fr.w; if (fr.hn) m[VD + 1] += fr.w; n += fr.w; });
    for (let d = 0; d < VD + 2; d++) m[d] = m[d] / (n || 1) * (d < VD ? W[d] : 1.5);
    return m;
  }
  function confusions(prep) {
    const pairs = {}; let total = 0, ok = 0;
    const mv = prep.items.map(it => meanVec(it.f, prep.W));
    prep.items.forEach((it, ii) => {
      const r = [];
      const seen = {};
      // おおまかに 近い 10こ ＋ 同じ ことばの 見本 だけを くわしく くらべる
      const near = prep.items.map((o, j) => ({ o, j, c: j === ii ? Infinity : mv[ii].reduce((s, x, d) => s + Math.abs(x - mv[j][d]), 0) })).sort((a, b) => a.c - b.c).slice(0, 10).map(x => x.o);
      prep.items.forEach(o => { if (o !== it && o.id === it.id && near.indexOf(o) < 0) near.push(o); });
      near.forEach(o => { const d = dtw(it.f, o.f, prep.W); if (seen[o.id] == null || d < seen[o.id]) seen[o.id] = d; });
      Object.keys(seen).forEach(id => r.push({ id, d: seen[id] }));
      r.sort((a, b) => a.d - b.d);
      if (!r.length || !seen[it.id] && seen[it.id] !== 0) return;
      total++;
      const own = seen[it.id], other = r.find(x => x.id !== it.id);
      if (r[0].id === it.id) ok++;
      if (other && other.d <= own * 1.15) { const k = [it.id, other.id].sort().join('|'); pairs[k] = pairs[k] || { a: it.id, b: other.id, n: 0, ratio: 9 }; pairs[k].n++; pairs[k].ratio = Math.min(pairs[k].ratio, other.d / Math.max(1e-6, own)); }
    });
    return { total, ok, pairs: Object.values(pairs).sort((a, b) => a.ratio - b.ratio) };
  }
  // 感度（1 きびしい … 3 ゆるい）から しきい値を きめる
  function thresholds(prep, sens) {
    const base = prep.med != null ? Math.min(1.5, Math.max(0.3, prep.med * 1.9)) : 0.9;
    const k = [0.75, 1, 1.3][Math.max(0, Math.min(2, (sens || 2) - 1))];
    return { ok: base * k, maybe: base * k * 1.55, gap: 0.08 };
  }
  // 判定：{ kind:'ok'|'maybe'|'none', top:[…] }
  function judge(ranked, th) {
    if (!ranked.length) return { kind: 'none', top: [] };
    const a = ranked[0], b = ranked[1];
    if (a.d <= th.ok && (!b || b.d - a.d >= th.gap * Math.max(1, a.d) && b.d >= a.d * 1.08)) return { kind: 'ok', top: ranked.slice(0, 3) };
    if (a.d <= th.maybe) return { kind: 'maybe', top: ranked.slice(0, 3).filter(r => r.d <= th.maybe * 1.15) };
    return { kind: 'none', top: ranked.slice(0, 3) };
  }

  /* ---------- 区切り（手を あげて サイン → 手を おろす or 止める） ---------- */
  function Segmenter(opt) {
    this.o = Object.assign({ restY: 1.7, holdMs: 700, useHold: true, minMs: 280, maxMs: 4200, gapMs: 260, still: 0.07 }, opt || {});
    this.reset();
  }
  Segmenter.prototype.reset = function () { this.state = 'idle'; this.buf = []; this.times = []; this.pre = []; this.on = 0; this.gap = null; this.holdRef = null; this.holdT = null; this.start = 0; };
  Segmenter.prototype.active = function (fr) {
    if (!fr) return false;
    const y = this.o.restY, a = palm(fr.d), b = palm(fr.n);
    return !!((a && a[1] < y) || (b && b[1] < y));
  };
  // 1コマ ずつ 入れる。区切れたら { frames, times, why } を かえす
  Segmenter.prototype.push = function (fr, t) {
    const act = this.active(fr);
    if (this.state === 'idle') {
      this.pre.push({ fr, t }); if (this.pre.length > 3) this.pre.shift();
      this.on = act ? this.on + 1 : 0;
      if (this.on >= 3) {
        this.state = 'sign'; this.start = t; this.gap = null; this.holdRef = null;
        this.buf = []; this.times = [];
        this.pre.forEach(p => { if (p.fr) { this.buf.push(p.fr); this.times.push(p.t); } });
        if (!this.buf.length && fr) { this.buf.push(fr); this.times.push(t); }
      }
      return null;
    }
    if (this.state === 'wait') {   // 止めて きめた あと：手を おろすか 大きく うごかすまで まつ
      if (!act) { if (this.gap == null) this.gap = t; if (t - this.gap > this.o.gapMs) { this.reset(); } return null; }
      this.gap = null;
      const p = palm(fr.d) || palm(fr.n);
      if (p && this.holdRef && Math.hypot(p[0] - this.holdRef[0], p[1] - this.holdRef[1]) > 0.45) { this.reset(); this.on = 3; this.pre = [{ fr, t }]; return this.push(fr, t); }
      return null;
    }
    // sign
    if (!act) {
      if (this.gap == null) this.gap = t;
      if (t - this.gap > this.o.gapMs) return this.finish('drop', 'idle');
      return null;
    }
    this.gap = null;
    this.buf.push(fr); this.times.push(t);
    const p = palm(fr.d) || palm(fr.n);
    if (this.o.useHold && p) {
      if (!this.holdRef || Math.hypot(p[0] - this.holdRef[0], p[1] - this.holdRef[1]) > this.o.still) { this.holdRef = p; this.holdT = t; }
      else if (t - this.holdT >= this.o.holdMs && t - this.start >= this.o.minMs + this.o.holdMs * 0.6) return this.finish('hold', 'wait');
    }
    if (t - this.start > this.o.maxMs) return this.finish('max', 'wait');
    return null;
  };
  Segmenter.prototype.finish = function (why, next) {
    const frames = this.buf, times = this.times, ref = this.holdRef;
    this.reset();
    if (next === 'wait') { this.state = 'wait'; this.holdRef = ref; }
    if (!frames.length || times[times.length - 1] - times[0] < this.o.minMs) return null;
    return { frames, times, why };
  };
  // いま どれくらい 止まっているか（0〜1、きめる ゲージ用）
  Segmenter.prototype.holdProgress = function (t) {
    if (this.state !== 'sign' || !this.o.useHold || this.holdT == null) return 0;
    return Math.max(0, Math.min(1, (t - this.holdT) / this.o.holdMs));
  };

  const api = { L, frameFrom, mirrorFrame, mirrorSeq, resample, normalizeSeq, encode, decode, features, frameDist, dtw, prepare, rank, confusions, thresholds, judge, Segmenter, palm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SignEngine = api;
})(typeof window !== 'undefined' ? window : this);
