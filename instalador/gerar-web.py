"""Gera a VERSÃO WEB do BEATMAX (site estático) em dist/web — pra jogar no navegador
(ex.: Edge do Xbox) sem instalar nada:
    python instalador/gerar-web.py
O publicar-web.bat chama este script e sobe a pasta pro GitHub Pages.

Fica de fora (nunca vai pro site):
  • osu-config.json (Client ID/Secret do osu!), servidor.py e tudo do programa do PC
  • músicas .mp3/.ogg/.wav/.flac soltas na pasta (direitos autorais)
  • instalador, dist, scripts .bat/.ps1/.sh, logs."""
import json, re, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'dist' / 'web'
SKIP_DIRS = {'instalador', 'dist', 'python', 'nuvem', '.git', '.update_tmp', '__pycache__', 'node_modules'}
SKIP_FILES = {'osu-config.json', 'servidor.py', 'servidor.log', 'atualizacao.json', 'bnft_100s.mp3'}
KEEP_FILES = {'assets/arya-lofi.ogg'}  # som do menu (feito pra este jogo)
SKIP_EXT = {'.bat', '.ps1', '.sh', '.py', '.log', '.exe', '.zip', '.mp3', '.ogg', '.wav', '.flac', '.osz'}


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    n = 0
    for f in sorted(ROOT.rglob('*')):
        rel = f.relative_to(ROOT)
        if rel.as_posix() in KEEP_FILES and f.is_file(): pass
        elif f.is_dir() or rel.parts[0] in SKIP_DIRS or f.name in SKIP_FILES or f.suffix.lower() in SKIP_EXT:
            continue
        dst = OUT / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dst)
        n += 1
    # liga o modo web antes de qualquer script do jogo
    idx = OUT / 'index.html'
    html = idx.read_text(encoding='utf-8')
    if 'BEATMAX_WEB' not in html:
        pat = r'(<meta charset[^>]*>)' if re.search(r'<meta charset', html) else r'(<head[^>]*>)'
        html = re.sub(pat, r'\1\n    <script>window.BEATMAX_WEB = true;</script>', html, count=1)
        idx.write_text(html, encoding='utf-8')
    # o site fica numa subpasta (usuario.github.io/beatmax/): caminhos relativos no manifesto
    man = OUT / 'manifest.json'
    if man.exists():
        m = json.loads(man.read_text(encoding='utf-8'))
        m['start_url'] = './index.html'
        m['scope'] = './'
        m['id'] = './index.html'
        man.write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (OUT / '.nojekyll').write_text('', encoding='utf-8')  # GitHub Pages: servir os arquivos como estão
    # conferência de segurança
    bad = [p for p in OUT.rglob('*') if p.name in ('osu-config.json', 'servidor.py')]
    if bad:
        print('ERRO: arquivo proibido na versão web:', bad)
        return 1
    ver = json.loads((ROOT / 'versao.json').read_text(encoding='utf-8')).get('version', '?')
    size = sum(p.stat().st_size for p in OUT.rglob('*') if p.is_file()) / 1e6
    print(f'OK: versão web v{ver} em dist/web ({n} arquivos, {size:.1f} MB)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
