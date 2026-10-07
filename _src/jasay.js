function jaSay(t) {
  // 読み上げで 単語の あたまの「は」「へ」が 助詞（わ・え）と 読まれないように カタカナに する（はこ→ハこ、へや→ヘや）
  return String(t == null ? '' : t).replace(/なかまはずれ/g, '仲間外れ').replace(/(^|[\s、。！？!?・（(「『])([はへ])(?=[\u3041-\u3096\u30A1-\u30FA\u30FC\u4E00-\u9FFF])/g, function (m, a, c) { return a + (c === 'は' ? 'ハ' : 'ヘ'); });
}
