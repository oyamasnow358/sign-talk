# つかいかた： サインでつたえる フォルダで  python _src/build.py
import io, hashlib, os
R = lambda p: io.open(p, encoding='utf-8').read()
s = R('_src/src.html')
for key, f in [('JASAY', 'jasay.js'), ('VOCAB', 'vocab.js'), ('ENGINE', 'engine.js'), ('APP', 'app.js')]:
    s = s.replace('/*__%s__*/' % key, R('_src/' + f).rstrip() + '\n')
io.open('index.html', 'w', encoding='utf-8', newline='\n').write(s)
# オフライン用（sw.js）：中身が かわったら キャッシュの 名前も かわる
h = hashlib.sha1(s.encode('utf-8'))
for p in ['vendor/vision_bundle.js'] + ['sets/' + x for x in sorted(os.listdir('sets'))]:
    h.update(open(p, 'rb').read())
sw = R('_src/sw.js').replace('__VER__', h.hexdigest()[:10])
io.open('sw.js', 'w', encoding='utf-8', newline='\n').write(sw)
print('built', len(s), 'sw', h.hexdigest()[:10])
