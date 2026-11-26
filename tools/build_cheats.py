# Régénère cheats/ depuis libretro-database (codes .cht, CC BY-SA 4.0) et le DAT No-Intro N64.
# Usage : python tools/build_cheats.py <chemin/libretro-database> [cheats]
import os, re, json, hashlib, sys
DB = sys.argv[1]  # clone de github.com/libretro/libretro-database
OUT = sys.argv[2] if len(sys.argv) > 2 else 'cheats'
chtdir = DB + '/cht/Nintendo - Nintendo 64'
names = {f[:-4] for f in os.listdir(chtdir) if f.endswith('.cht')}
dat = open(DB + '/metadat/no-intro/Nintendo - Nintendo 64.dat', encoding='utf-8', errors='replace').read()
idx = {}
for m in re.finditer(r'game \(\s*name "([^"]+)".*?rom \( name "[^"]+" size \d+ crc \w+ md5 \w+ sha1 (\w+)', dat, re.S):
    nm, sha = m.group(1), m.group(2).lower()
    if nm in names: idx[sha[:12]] = nm
used = sorted(set(idx.values()))
def parse(nm):
    t = open(f'{chtdir}/{nm}.cht', encoding='utf-8', errors='replace').read()
    kv = dict(re.findall(r'^(\w+)\s*=\s*"?(.*?)"?\s*$', t, re.M))
    out = []
    for i in range(int(kv.get('cheats', 0))):
        d, c = kv.get(f'cheat{i}_desc', '').strip(), kv.get(f'cheat{i}_code', '').strip()
        if d and re.fullmatch(r'[0-9A-Fa-f]{8}[ :]?[0-9A-Fa-f]{4}(\+[0-9A-Fa-f]{8}[ :]?[0-9A-Fa-f]{4})*', c.replace(' + ', '+')):
            out.append([d, c.replace(' + ', '+').upper()])
    return out
NSH = 48
shards = [dict() for _ in range(NSH)]
games = {}
for nm in used:
    lst = parse(nm)
    if not lst: continue
    s = int(hashlib.sha1(nm.encode()).hexdigest(), 16) % NSH
    shards[s][nm] = lst; games[nm] = s
os.makedirs(OUT, exist_ok=True)
tot = 0
for i, sh in enumerate(shards):
    data = json.dumps(sh, ensure_ascii=False, separators=(',', ':'))
    open(f'{OUT}/{i:02d}.json', 'w', encoding='utf-8').write(data); tot += len(data)
index = {'v': 1, 'sha': {k: v for k, v in idx.items() if v in games}, 'games': games}
ij = json.dumps(index, ensure_ascii=False, separators=(',', ':'))
open(f'{OUT}/index.json', 'w', encoding='utf-8').write(ij)
print('jeux avec codes', len(games), '| empreintes', len(index['sha']), '| index', len(ij) // 1024, 'Ko | codes', tot // 1024, 'Ko en', NSH, 'fichiers')
oot = 'Legend of Zelda, The - Ocarina of Time (Europe) (En,Fr,De)'
print('OoT EU :', len(shards[games[oot]][oot]), 'codes, ex.', shards[games[oot]][oot][2:5])
