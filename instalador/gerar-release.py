"""Gera os 2 arquivos da release do GitHub (atualização automática):
    python instalador/gerar-release.py 1.2.0 "o que mudou"
As novidades que aparecem no jogo (tela Novidades) vêm do novidades.json: se a versão ainda não
estiver lá, entra com o texto acima (itens separados por " | ").
Cria dist/djmax-training-<versão>.zip e dist/versao.json — é só subir os dois numa release nova
(Releases → Draft a new release → tag v<versão> → arrastar os arquivos → Publish)."""
import datetime, hashlib, json, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP_FILES = {'osu-config.json', 'servidor.log', 'atualizacao.json', 'bnft_100s.mp3', 'publicar-release.bat', 'publicar-release.ps1', 'publicar-web.bat', 'publicar-tudo.bat'}
SKIP_DIRS = {'python', 'dist', '.update_tmp', '__pycache__', '.git'}

def main():
    if len(sys.argv) < 2:
        print(__doc__); return 1
    args = sys.argv[1:]
    # --desde X.Y.Z: inclui nas notas da release as versões que ficaram sem publicar (> X.Y.Z)
    desde = None
    if '--desde' in args:
        i = args.index('--desde'); desde = args[i + 1].lstrip('vV') if i + 1 < len(args) else None; del args[i:i + 2]
    version, notes = args[0].lstrip('vV'), (args[1] if len(args) > 1 else '')
    vt = lambda v: tuple(int(x) for x in str(v).split('.') if x.isdigit())
    # novidades.json: garante a entrada desta versão (lista completa que o jogo mostra)
    nov_path = ROOT / 'novidades.json'
    try:
        nov = json.loads(nov_path.read_text(encoding='utf-8'))
    except Exception:
        nov = []
    entry = next((e for e in nov if e.get('version') == version), None)
    if entry is None:
        items = [x.strip() for x in notes.split(' | ') if x.strip()] or ['Melhorias e correções.']
        entry = {'version': version, 'date': datetime.date.today().isoformat(), 'title': '', 'items': items}
        nov.insert(0, entry)
        nov_path.write_text(json.dumps(nov, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if not notes:
        notes = ' '.join(entry.get('items', []))
    (ROOT / 'versao.json').write_text(json.dumps({'version': version}, indent=2) + '\n', encoding='utf-8')
    dist = ROOT / 'dist'; dist.mkdir(exist_ok=True)
    zname = f'djmax-training-{version}.zip'
    with zipfile.ZipFile(dist / zname, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in sorted(ROOT.rglob('*')):
            rel = f.relative_to(ROOT)
            if f.is_dir() or rel.parts[0] in SKIP_DIRS or f.name in SKIP_FILES or f.suffix in ('.exe',):
                continue
            z.write(f, rel.as_posix())
    sha = hashlib.sha256((dist / zname).read_bytes()).hexdigest()
    historico = []
    if desde:
        historico = [{'version': e['version'], 'title': e.get('title', ''), 'items': e.get('items', [])} for e in nov
                     if vt(desde) < vt(e.get('version', '0')) < vt(version)]
    info = {'version': version, 'notes': notes, 'title': entry.get('title', ''), 'items': entry.get('items', []), 'zip': zname, 'sha256': sha}
    if historico: info['historico'] = historico
    (dist / 'versao.json').write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'OK: dist/{zname} + dist/versao.json (sha256 {sha[:12]}…)')
    return 0

if __name__ == '__main__':
    sys.exit(main())
