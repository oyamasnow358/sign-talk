# サインで つたえる（MieeL）

カメラの前で手話・マカトン・その子のオリジナルのサインをすると、ことばを大きなカードと音声で伝える iPad 向けアプリです。

- 手・からだの読み取りは iPad の中だけで行います（映像は送らず、保存もしません）。
- サインの見本は「手とからだの点の動き」だけのファイル（サインセット .json）として書き出し・配布できます。
- はじめから 257 のことばが入っています（`_src/vocab.js`）。

## つくりかた
```
python _src/build.py      # _src/ から index.html と sw.js を作る
python -m http.server 8820 # → http://localhost:8820/ （カメラは localhost か https でのみ動きます）
```

## フォルダ
- `_src/engine.js` … サインの区切り・特徴・照らし合わせ（DTW）
- `_src/app.js` … 画面（つたえる・サインを みる・とうろく・先生用メニュー）
- `_src/vocab.js` … はじめから入っていることば
- `sets/` … 配布するサインセット（`index.json` に一覧を書く）
- `vendor/` … MediaPipe（Apache License 2.0）

## 配布セットの足しかた
1. アプリで登録したセットを「📤 かきだす」
2. できた .json を `sets/` に置き、`sets/index.json` に `{ "file": "ファイル名.json", "name": "表示名", "desc": "説明" }` を足す
3. `python _src/build.py` → push
