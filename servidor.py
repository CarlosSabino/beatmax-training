# Servidor local do DJMAX Trainer: igual ao "python -m http.server", mas avisando o navegador
# pra NUNCA guardar cópia antiga dos arquivos (Cache-Control: no-store). Assim, depois de
# copiar uma versão nova pra pasta, o jogo sempre abre com todos os arquivos atualizados
# juntos (sem misturar, por exemplo, um style.css velho com um script.js novo).
#
# Também faz a ponte com o osu! (busca de mapas de osu!mania pela API oficial) e entrega pro
# jogo os .osz que você baixa no site do osu! (vigia a pasta Downloads). Só escuta no próprio
# PC (127.0.0.1) — nada fica acessível pela rede.
#
# ATUALIZAÇÃO AUTOMÁTICA: o servidor vigia o próprio arquivo (servidor.py). Quando você copia
# uma versão nova pra pasta, ele se reinicia sozinho em ~2 segundos (não precisa fechar nada,
# nem se ele estiver rodando escondido junto com o Windows). Os outros arquivos do jogo (html,
# js, css) nem precisam disso: como nada fica em cache, basta apertar F5 na página.
import http.server
import socket
import subprocess
import threading
import webbrowser
import json
import os
import sys
import time
import urllib.parse
import mimetypes
# Windows antigo não conhece alguns tipos: garante que imagens/vídeos sejam servidos certo
for _ext, _mt in (('.webp', 'image/webp'), ('.webm', 'video/webm'), ('.ogg', 'audio/ogg'), ('.mp4', 'video/mp4'), ('.json', 'application/json'), ('.js', 'text/javascript')):
    mimetypes.add_type(_mt, _ext)
import urllib.request
import urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONFIG_FILE = HERE / 'osu-config.json'
OSU_BASE = os.environ.get('OSU_BASE', 'https://osu.ppy.sh')          # trocável só pra testes
MIRROR_URL = os.environ.get('OSU_MIRROR', 'https://catboy.best/d/{id}')  # espelho NÃO oficial (desligado por padrão)
UA = 'BEATMAX-Training/1.0 (uso pessoal)'
SERVER_VERSION = 4          # sobe quando a página precisar de algo novo do servidor
RESTART_CODE = 3            # código de saída que pede pro iniciar.bat / inicio-oculto.vbs abrir de novo
IS_WIN = sys.platform.startswith('win')
ALLOWED_HOSTS = ('localhost', '127.0.0.1', '[::1]')

_token = {'value': None, 'exp': 0}
_last_api_call = [0.0]


def load_config():
    try:
        return json.loads(CONFIG_FILE.read_text(encoding='utf-8'))
    except Exception:
        return {}


def save_config(cfg):
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2), encoding='utf-8')


def known_folder(guid):
    # pasta "de verdade" do Windows (pode estar em outro disco ou no OneDrive)
    if not IS_WIN:
        return None
    try:
        import ctypes
        from ctypes import wintypes
        import uuid
        fid = uuid.UUID(guid)

        class GUID(ctypes.Structure):
            _fields_ = [('Data1', wintypes.DWORD), ('Data2', wintypes.WORD), ('Data3', wintypes.WORD), ('Data4', wintypes.BYTE * 8)]
        g = GUID(fid.fields[0], fid.fields[1], fid.fields[2], (wintypes.BYTE * 8).from_buffer_copy(fid.bytes[8:]))
        p = ctypes.c_wchar_p()
        if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(g), 0, None, ctypes.byref(p)) == 0:
            path = p.value
            ctypes.windll.ole32.CoTaskMemFree(p)
            return Path(path)
    except Exception:
        pass
    return None


def downloads_dir(cfg=None):
    cfg = cfg or load_config()
    if cfg.get('downloadsDir'):
        return Path(cfg['downloadsDir'])
    return known_folder('{374DE290-123F-4565-9164-39C4925E467B}') or (Path.home() / 'Downloads')


def http_json(url, data=None, headers=None, timeout=20):
    h = {'User-Agent': UA, 'Accept': 'application/json'}
    h.update(headers or {})
    body = None
    if data is not None:
        body = json.dumps(data).encode('utf-8')
        h['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=body, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def get_token(force=False):
    cfg = load_config()
    if not cfg.get('clientId') or not cfg.get('clientSecret'):
        raise RuntimeError('osu! não configurado')
    if not force and _token['value'] and time.time() < _token['exp'] - 60:
        return _token['value']
    res = http_json(OSU_BASE + '/oauth/token', data={
        'client_id': int(cfg['clientId']) if str(cfg['clientId']).isdigit() else cfg['clientId'],
        'client_secret': cfg['clientSecret'],
        'grant_type': 'client_credentials',
        'scope': 'public'
    })
    _token['value'] = res['access_token']
    _token['exp'] = time.time() + int(res.get('expires_in', 3600))
    return _token['value']


def osu_api(path, params):
    # a API pede no máximo ~1 pedido por segundo
    wait = 1.0 - (time.time() - _last_api_call[0])
    if wait > 0:
        time.sleep(wait)
    _last_api_call[0] = time.time()
    url = OSU_BASE + '/api/v2' + path + ('?' + urllib.parse.urlencode(params) if params else '')
    try:
        return http_json(url, headers={'Authorization': 'Bearer ' + get_token()})
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return http_json(url, headers={'Authorization': 'Bearer ' + get_token(force=True)})
        raise


# ---------------- ATUALIZAÇÃO AUTOMÁTICA (GitHub Releases) ----------------
# O jogo continua rodando aqui no PC; só o PACOTE de atualização fica no GitHub. Na release
# mais nova do repositório ficam dois arquivos: versao.json ({version, notes, zip, sha256}) e
# o .zip com os arquivos do jogo. A impressão digital (SHA-256) é conferida antes de instalar.
import hashlib
import zipfile
import shutil
VERSION_FILE = HERE / 'versao.json'
UPDATE_CFG_FILE = HERE / 'atualizacao.json'      # {"repo": "usuario/repositorio"}
UPDATE_KEEP = {'osu-config.json', 'servidor.log', 'atualizacao.json'}   # nunca são trocados
UPDATE_SKIP_DIRS = {'python', '.update_tmp'}
_update = {'checkedAt': 0, 'result': None, 'lock': threading.Lock(), 'applying': False}
_server_ref = {}


def local_version():
    try:
        return json.loads(VERSION_FILE.read_text(encoding='utf-8')).get('version', '0')
    except Exception:
        return '0'


def update_repo():
    try:
        r = json.loads(UPDATE_CFG_FILE.read_text(encoding='utf-8')).get('repo', '')
    except Exception:
        r = ''
    r = (os.environ.get('DJMAX_UPDATE_REPO') or r or '').strip().strip('/')
    return r if r.count('/') == 1 else ''


def ver_tuple(v):
    out = []
    for part in str(v).lstrip('vV').split('.'):
        num = ''.join(ch for ch in part if ch.isdigit())
        out.append(int(num) if num else 0)
    return tuple(out + [0] * (4 - len(out)))


def http_get_bytes(url, timeout=60, limit=300 * 1048576):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/octet-stream'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read(limit + 1)
    if len(data) > limit:
        raise RuntimeError('arquivo de atualização grande demais')
    return data


def check_update(force=False):
    with _update['lock']:
        if not force and _update['result'] and time.time() - _update['checkedAt'] < 15 * 60:
            return _update['result']
        cur = local_version()
        repo = update_repo()
        res = {'current': cur, 'repo': repo, 'available': False}
        if not repo:
            res['error'] = 'repositório de atualização não configurado'
        else:
            try:
                api = os.environ.get('DJMAX_UPDATE_API', 'https://api.github.com')
                rel = http_json(f'{api}/repos/{repo}/releases/latest', headers={'Accept': 'application/vnd.github+json'})
                assets = {a.get('name'): a.get('browser_download_url') for a in rel.get('assets', [])}
                if 'versao.json' not in assets:
                    raise RuntimeError('a release não tem o versao.json')
                info = json.loads(http_get_bytes(assets['versao.json'], 30, 1048576).decode('utf-8'))
                res.update({'latest': info.get('version'), 'notes': info.get('notes', ''), 'title': info.get('title', ''), 'items': info.get('items') or [], 'publishedAt': rel.get('published_at')})
                res['available'] = ver_tuple(info.get('version', '0')) > ver_tuple(cur)
                zip_name = info.get('zip') or ''
                if res['available'] and zip_name not in assets:
                    raise RuntimeError(f'a release não tem o pacote {zip_name}')
                res['_zip'] = assets.get(zip_name)
                res['_sha256'] = (info.get('sha256') or '').lower()
            except urllib.error.HTTPError as e:
                res['error'] = 'nenhuma versão publicada ainda' if e.code == 404 else f'GitHub respondeu {e.code}'
            except Exception as e:
                res['error'] = f'{type(e).__name__}: {e}'
        _update['result'] = res
        _update['checkedAt'] = time.time()
        return res


def apply_update():
    res = check_update(force=True)
    if not res.get('available'):
        return {'ok': False, 'error': res.get('error') or 'já está na versão mais nova'}
    if not res.get('_sha256'):
        return {'ok': False, 'error': 'a atualização não tem a impressão digital (sha256) — não vou instalar'}
    data = http_get_bytes(res['_zip'], 300)
    if hashlib.sha256(data).hexdigest() != res['_sha256']:
        return {'ok': False, 'error': 'o pacote baixado não confere (sha256 diferente) — nada foi trocado'}
    tmp = HERE / '.update_tmp'
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir()
    zpath = tmp / 'pacote.zip'
    zpath.write_bytes(data)
    changed = 0
    with zipfile.ZipFile(zpath) as z:
        names = [n for n in z.namelist() if not n.endswith('/')]
        # pacote com uma pasta raiz única (ex.: djmax-trainer/...) também vale
        roots = {n.split('/', 1)[0] for n in names}
        strip = (roots.pop() + '/') if len(roots) == 1 and all('/' in n for n in names) else ''
        for n in names:
            rel = n[len(strip):] if strip and n.startswith(strip) else n
            parts = Path(rel).parts
            if not parts or '..' in parts or Path(rel).is_absolute() or parts[0] in UPDATE_SKIP_DIRS or rel in UPDATE_KEEP:
                continue
            dest = HERE / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            content = z.read(n)
            if dest.exists() and dest.read_bytes() == content:
                continue
            part = dest.with_name(dest.name + '.novo')
            part.write_bytes(content)
            os.replace(part, dest)
            changed += 1
    shutil.rmtree(tmp, ignore_errors=True)
    print(f'[servidor] atualizado para {res.get("latest")} ({changed} arquivo(s))', flush=True)
    with _update['lock']:
        _update['result'] = None
    # reinicia pra pegar o servidor.py novo (mesmo que ele não tenha mudado)
    srv, flag = _server_ref.get('httpd'), _server_ref.get('flag')
    if srv is not None and flag is not None:
        flag['restart'] = True
        threading.Timer(0.8, srv.shutdown).start()
    return {'ok': True, 'version': res.get('latest'), 'changed': changed}


def update_watcher():
    time.sleep(8)
    while True:
        try:
            check_update(force=True)
        except Exception:
            pass
        time.sleep(3600)


def build_id():
    # "versão" dos arquivos do jogo: muda quando qualquer html/js/css da pasta é trocado.
    # A página compara com o valor de quando abriu e oferece recarregar (F5).
    newest = 0.0
    for f in HERE.iterdir():
        if f.suffix.lower() in ('.html', '.js', '.css', '.py') and f.is_file():
            newest = max(newest, f.stat().st_mtime)
    return str(int(newest))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(HERE), **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        if '/api/' in (args[0] if args else ''):
            return  # não polui o console com o vigia da pasta Downloads
        super().log_message(fmt, *args)

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_bytes(self, data, ctype='application/octet-stream', name=None):
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        if name:
            self.send_header('X-File-Name', urllib.parse.quote(name))
        self.end_headers()
        self.wfile.write(data)

    def host_ok(self):
        # recusa pedidos com "Host" estranho (proteção contra DNS rebinding de sites maliciosos)
        host = (self.headers.get('Host') or '').lower()
        name = host.rsplit(':', 1)[0] if not host.startswith('[') else host.split(']')[0] + ']'
        return name in ALLOWED_HOSTS

    def do_GET(self):
        if not self.host_ok():
            return self.send_json({'error': 'host não permitido'}, 403)
        u = urllib.parse.urlparse(self.path)
        if not u.path.startswith('/api/'):
            return super().do_GET()
        q = dict(urllib.parse.parse_qsl(u.query))
        try:
            if u.path == '/api/ping':
                return self.send_json({'ok': True, 'server': 'djmax-trainer', 'version': SERVER_VERSION,
                                       'build': build_id(), 'gameVersion': local_version(), 'pid': os.getpid(), 'autostart': bool(os.environ.get('DJMAX_AUTOSTART'))})
            if u.path == '/api/update/check':
                r = check_update(force=q.get('force') == '1')
                return self.send_json({k: v for k, v in r.items() if not k.startswith('_')})
            if u.path == '/api/osu/config':
                cfg = load_config()
                return self.send_json({
                    'configured': bool(cfg.get('clientId') and cfg.get('clientSecret')),
                    'clientId': cfg.get('clientId', ''),
                    'mirror': bool(cfg.get('mirror')),
                    'downloadsDir': str(downloads_dir(cfg))
                })
            if u.path == '/api/osu/search':
                params = {'m': '3'}
                if q.get('q'):
                    params['q'] = q['q']
                if q.get('s'):
                    params['s'] = q['s']
                if q.get('sort'):
                    params['sort'] = q['sort']
                if q.get('cursor'):
                    params['cursor_string'] = q['cursor']
                return self.send_json(osu_api('/beatmapsets/search', params))
            if u.path == '/api/osu/watch':
                since = float(q.get('since', '0'))
                d = downloads_dir()
                files = []
                if d.is_dir():
                    for f in d.iterdir():
                        if f.suffix.lower() == '.osz' and f.is_file():
                            st = f.stat()
                            if st.st_mtime * 1000 >= since:
                                files.append({'name': f.name, 'size': st.st_size, 'mtime': st.st_mtime * 1000})
                files.sort(key=lambda x: x['mtime'], reverse=True)
                return self.send_json({'dir': str(d), 'files': files[:50]})
            if u.path == '/api/osu/file':
                name = os.path.basename(q.get('name', ''))
                f = downloads_dir() / name
                if not name.lower().endswith('.osz') or not f.is_file():
                    return self.send_json({'error': 'arquivo não encontrado'}, 404)
                return self.send_bytes(f.read_bytes(), 'application/zip', name)
            if u.path == '/api/imagem':
                # baixa uma imagem por LINK pro Personalizar (sites que não deixam o navegador baixar
                # direto). Só a página do jogo pede (cabeçalho X-DJMAX), só http/https, nunca
                # endereços da rede local, só imagem e no máximo 15 MB.
                if self.headers.get('X-DJMAX') != '1':
                    return self.send_json({'error': 'pedido recusado'}, 403)
                url = q.get('url', '')
                pu = urllib.parse.urlparse(url)
                if pu.scheme not in ('http', 'https') or not pu.hostname:
                    return self.send_json({'error': 'link inválido'}, 400)
                import ipaddress, socket
                try:
                    for info in socket.getaddrinfo(pu.hostname, None):
                        ip = ipaddress.ip_address(info[4][0])
                        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                            return self.send_json({'error': 'endereço não permitido'}, 403)
                except socket.gaierror:
                    return self.send_json({'error': 'site não encontrado'}, 404)
                req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'image/*'})
                with urllib.request.urlopen(req, timeout=30) as r:
                    ctype = (r.headers.get('Content-Type') or '').split(';')[0].strip().lower()
                    if not ctype.startswith('image/'):
                        return self.send_json({'error': 'o link não é de uma imagem'}, 415)
                    data = r.read(15 * 1024 * 1024 + 1)
                if len(data) > 15 * 1024 * 1024:
                    return self.send_json({'error': 'imagem grande demais (máx. 15 MB)'}, 413)
                return self.send_bytes(data, ctype, None)
            if u.path == '/api/osu/mirror':
                cfg = load_config()
                if not cfg.get('mirror'):
                    return self.send_json({'error': 'download por espelho está desligado'}, 403)
                sid = ''.join(ch for ch in q.get('id', '') if ch.isdigit())
                req = urllib.request.Request(MIRROR_URL.format(id=sid), headers={'User-Agent': UA})
                with urllib.request.urlopen(req, timeout=120) as r:
                    data = r.read()
                return self.send_bytes(data, 'application/zip', f'{sid}.osz')
            return self.send_json({'error': 'rota desconhecida'}, 404)
        except RuntimeError as e:
            return self.send_json({'error': str(e), 'needsConfig': True}, 400)
        except urllib.error.HTTPError as e:
            return self.send_json({'error': f'osu! respondeu {e.code}', 'status': e.code}, 502)
        except Exception as e:
            return self.send_json({'error': f'{type(e).__name__}: {e}'}, 502)

    def do_POST(self):
        # só a própria página do jogo manda esse cabeçalho; um site qualquer não consegue
        # (o navegador exigiria uma permissão de CORS que este servidor nunca dá)
        if not self.host_ok() or self.headers.get('X-DJMAX') != '1':
            return self.send_json({'error': 'pedido recusado'}, 403)
        u = urllib.parse.urlparse(self.path)
        length = int(self.headers.get('Content-Length') or 0)
        try:
            body = json.loads(self.rfile.read(length).decode('utf-8') or '{}')
        except Exception:
            body = {}
        if u.path == '/api/update/apply':
            if _update['applying']:
                return self.send_json({'ok': False, 'error': 'já está atualizando'}, 409)
            _update['applying'] = True
            try:
                return self.send_json(apply_update())
            except Exception as e:
                return self.send_json({'ok': False, 'error': f'{type(e).__name__}: {e}'}, 500)
            finally:
                _update['applying'] = False
        if u.path == '/api/server/stop':
            # usado pelo remover-inicio-automatico.bat / instalar (pra trocar de servidor)
            self.send_json({'ok': True})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        if u.path == '/api/osu/config':
            cfg = load_config()
            for k in ('clientId', 'clientSecret', 'downloadsDir'):
                if k in body and body[k] is not None:
                    v = str(body[k]).strip()
                    if v:
                        cfg[k] = v
                    elif k == 'downloadsDir':
                        cfg.pop(k, None)
            if 'mirror' in body:
                cfg['mirror'] = bool(body['mirror'])
            save_config(cfg)
            _token['value'] = None
            if body.get('test'):
                try:
                    get_token(force=True)
                except Exception as e:
                    return self.send_json({'ok': False, 'error': f'Não deu pra entrar no osu!: {e}'}, 400)
            return self.send_json({'ok': True})
        return self.send_json({'error': 'rota desconhecida'}, 404)


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    # No Windows, SO_REUSEADDR deixaria DOIS servidores ouvirem a mesma porta ao mesmo tempo
    # (um iniciar.bat aberto + o do início automático) — lá usamos a porta exclusiva.
    allow_reuse_address = not IS_WIN

    def server_bind(self):
        if IS_WIN and hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def ping(port, timeout=1.5):
    try:
        req = urllib.request.Request(f'http://127.0.0.1:{port}/api/ping', headers={'Host': 'localhost'})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            j = json.loads(r.read().decode('utf-8'))
            return j if j.get('server') == 'djmax-trainer' else None
    except Exception:
        return None


def file_sig(path):
    try:
        st = path.stat()
        return (st.st_mtime, st.st_size)
    except OSError:
        return None


def watch_self(httpd, flag):
    # Vigia o servidor.py: mudou (e o arquivo novo está inteiro e sem erro) -> reinicia.
    me = Path(__file__).resolve()
    sig = file_sig(me)
    while True:
        time.sleep(2)
        now = file_sig(me)
        if now is None or now == sig:
            continue
        time.sleep(1)                     # espera a cópia terminar
        if file_sig(me) != now:
            continue
        try:
            compile(me.read_text(encoding='utf-8'), str(me), 'exec')
        except Exception as e:
            print(f'[servidor] servidor.py novo tem erro, continuo com o antigo: {e}', flush=True)
            sig = now
            continue
        print('[servidor] servidor.py foi atualizado — reiniciando...', flush=True)
        flag['restart'] = True
        httpd.shutdown()
        return


def setup_log():
    # rodando escondido (pythonw, início automático) não existe janela: as mensagens vão pro
    # servidor.log (zerado quando passa de 1 MB), senão o próprio log daria erro
    if sys.stdout is not None and sys.stderr is not None:
        return
    log = HERE / 'servidor.log'
    try:
        if log.exists() and log.stat().st_size > 1_000_000:
            log.unlink()
        fh = open(log, 'a', encoding='utf-8', buffering=1)
    except OSError:
        fh = open(os.devnull, 'w')
    sys.stdout = sys.stdout or fh
    sys.stderr = sys.stderr or fh


# ---------------- início automático com o Windows ----------------
STARTUP_NAME = 'BEATMAX Training (servidor).vbs'
SHORTCUT_NAME = 'BEATMAX Training.url'
OLD_NAMES = ('DJMAX Trainer (servidor).vbs', 'DJMAX Trainer.url')   # nomes antigos: apaga se achar


def startup_dir():
    return known_folder('{B97D20BB-F46A-4C97-BA10-5E3608430854}') or \
        Path(os.environ.get('APPDATA', str(Path.home()))) / 'Microsoft' / 'Windows' / 'Start Menu' / 'Programs' / 'Startup'


def desktop_dir():
    return known_folder('{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}') or (Path.home() / 'Desktop')


def hidden_python():
    exe = Path(sys.executable)
    w = exe.with_name('pythonw.exe')
    return w if w.exists() else exe     # sem pythonw, o .vbs esconde a janela do python.exe mesmo


def stop_running(port):
    try:
        req = urllib.request.Request(f'http://127.0.0.1:{port}/api/server/stop', data=b'{}', method='POST',
                                     headers={'X-DJMAX': '1', 'Content-Type': 'application/json'})
        urllib.request.urlopen(req, timeout=3).read()
    except Exception:
        pass
    for _ in range(20):
        if not ping(port, 0.5):
            return True
        time.sleep(0.5)
    return False


def vbs_quote(p):
    return '""' + str(p) + '""'


def browser_app_exe():
    """Navegador padrão do Windows (Chrome/Edge/Brave/Vivaldi/Opera), pra abrir o jogo em
    janela própria (--app). Usa o MESMO perfil de sempre, então as músicas/recordes aparecem."""
    if not IS_WIN:
        return None
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice') as k:
            progid = winreg.QueryValueEx(k, 'ProgId')[0]
    except Exception:
        progid = ''
    exe_by_prog = [('Chrome', 'chrome.exe'), ('MSEdge', 'msedge.exe'), ('Brave', 'brave.exe'), ('Vivaldi', 'vivaldi.exe'), ('Opera', 'opera.exe')]
    wanted = [exe for key, exe in exe_by_prog if key.lower() in progid.lower()]
    if not wanted and 'firefox' in progid.lower():
        return None   # Firefox não tem janela de app: abre normal
    wanted += ['msedge.exe']   # o Edge sempre existe no Windows 10/11
    import winreg
    for exe in wanted:
        for root in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                with winreg.OpenKey(root, 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\' + exe) as k:
                    path = winreg.QueryValueEx(k, '')[0]
                    if path and Path(path).exists():
                        return path
            except Exception:
                continue
    return None


def open_game(url, app=False):
    if app:
        exe = browser_app_exe()
        if exe:
            try:
                # janela própria já em TELA CHEIA (F11 volta pra janela, se quiser)
                subprocess.Popen([exe, f'--app={url}', '--start-fullscreen'])
                return
            except Exception:
                pass
    webbrowser.open(url)


def install_autostart(port):
    if not IS_WIN:
        print('Isso só funciona no Windows.')
        return 1
    for old in (startup_dir() / OLD_NAMES[0], desktop_dir() / OLD_NAMES[1]):
        try:
            if old.exists():
                old.unlink()
        except Exception:
            pass
    vbs = startup_dir() / STARTUP_NAME
    me = Path(__file__).resolve()
    vbs.write_text('\r\n'.join([
        "' BEATMAX Training: liga o servidor local escondido (sem janela) quando o Windows inicia.",
        "' Criado pelo instalar-inicio-automatico.bat. Pra tirar: remover-inicio-automatico.bat",
        "' (ou apague este arquivo). Se mudar a pasta do jogo de lugar, rode o instalar de novo.",
        'Set sh = CreateObject("WScript.Shell")',
        'Set env = sh.Environment("PROCESS")',
        'env("DJMAX_SUPERVISED") = "1"',
        'env("DJMAX_AUTOSTART") = "1"',
        'sh.CurrentDirectory = "' + str(HERE) + '"',
        'Do',
        '    rc = sh.Run("' + vbs_quote(hidden_python()) + ' ' + vbs_quote(me) + ' ' + str(port) + '", 0, True)',
        "Loop While rc = " + str(RESTART_CODE) + "   ' 3 = o servidor.py foi atualizado e pediu pra abrir de novo",
        '']), encoding='utf-16')
    print(f'OK: o servidor vai ligar sozinho (escondido) quando o Windows iniciar.\n    {vbs}')

    url = f'http://localhost:{port}/index.html'
    if '--sem-atalho' not in sys.argv:
        lnk = desktop_dir() / SHORTCUT_NAME
        icon = HERE / 'assets' / 'icone.ico'
        lines = ['[InternetShortcut]', f'URL={url}']
        if icon.exists():
            lines += [f'IconFile={icon}', 'IconIndex=0']
        try:
            lnk.write_text('\r\n'.join(lines) + '\r\n', encoding='mbcs')
            print(f'OK: atalho "BEATMAX Training" criado na Área de Trabalho.')
        except Exception as e:
            print(f'(não deu pra criar o atalho na Área de Trabalho: {e})')

    # troca o servidor que estiver rodando agora (ex.: um iniciar.bat aberto) pelo escondido
    running = ping(port)
    if running:
        if running.get('version', 0) >= 3:
            stop_running(port)
        else:
            print('\nATENÇÃO: tem um servidor antigo aberto (janela do iniciar.bat). Feche aquela janela;')
            print('o novo liga sozinho no próximo início do Windows (ou rode este instalador de novo).')
            return 0
    subprocess.Popen(['wscript.exe', str(vbs)], cwd=str(HERE))
    for _ in range(20):
        time.sleep(0.5)
        if ping(port, 0.5):
            print('OK: servidor ligado agora mesmo, em segundo plano.')
            if '--sem-abrir' not in sys.argv:
                webbrowser.open(url)
            return 0
    print('O servidor não respondeu ainda — confira o servidor.log nesta pasta.')
    return 1


def remove_autostart(port):
    vbs_list = [startup_dir() / n for n in (STARTUP_NAME, OLD_NAMES[0])]
    if any(v.exists() for v in vbs_list):
        for v in vbs_list:
            if v.exists():
                v.unlink()
        print('OK: não liga mais junto com o Windows.')
    else:
        print('O início automático já não estava instalado.')
    lnks = [desktop_dir() / n for n in (SHORTCUT_NAME, OLD_NAMES[1])]
    if any(l.exists() for l in lnks):
        for l in lnks:
            if l.exists():
                l.unlink()
        print('OK: atalho da Área de Trabalho removido.')
    if ping(port):
        print('Desligando o servidor que está rodando em segundo plano...')
        print('OK: desligado.' if stop_running(port) else 'Não consegui desligar (servidor antigo?). Reinicie o PC ou feche pelo Gerenciador de Tarefas (pythonw.exe).')
    return 0


def main():
    setup_log()
    args = [a for a in sys.argv[1:]]
    open_browser = '--abrir' in args or '--abrir-app' in args
    as_app = '--abrir-app' in args
    args = [a for a in args if not a.startswith('--')]
    port = int(args[0]) if args else 8791
    url = f'http://localhost:{port}/index.html'
    if '--instalar-inicio' in sys.argv:
        return install_autostart(port)
    if '--remover-inicio' in sys.argv:
        return remove_autostart(port)

    httpd = None
    for attempt in range(40):             # ~20s: dá tempo da versão anterior soltar a porta
        try:
            httpd = Server(('127.0.0.1', port), Handler)
            break
        except OSError:
            other = ping(port)
            if other and attempt == 0:
                # já tem um DJMAX Trainer rodando nessa porta (ex.: o do início automático)
                print(f'[servidor] já está rodando (versão {other.get("version")}) em {url}', flush=True)
                if open_browser:
                    open_game(url, as_app)
                return 0
            time.sleep(0.5)
    if httpd is None:
        print(f'[servidor] a porta {port} está ocupada por outro programa.', flush=True)
        return 1

    print(f'[servidor] BEATMAX Training v{SERVER_VERSION} em {url} (pid {os.getpid()})', flush=True)
    if open_browser:
        threading.Timer(0.3, lambda: open_game(url, as_app)).start()
    flag = {'restart': False}
    _server_ref['httpd'] = httpd
    _server_ref['flag'] = flag
    threading.Thread(target=watch_self, args=(httpd, flag), daemon=True).start()
    threading.Thread(target=update_watcher, daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()

    if flag['restart']:
        if os.environ.get('DJMAX_SUPERVISED'):
            return RESTART_CODE           # o iniciar.bat / inicio-oculto.vbs abre de novo
        # rodando "na mão": abre a versão nova sozinho
        kw = {'cwd': str(HERE)}
        if IS_WIN:
            kw['creationflags'] = getattr(subprocess, 'CREATE_NO_WINDOW', 0) if 'pythonw' in sys.executable.lower() else 0
        subprocess.Popen([sys.executable, str(Path(__file__).resolve())] + [str(port)], **kw)
    return 0


if __name__ == '__main__':
    sys.exit(main())
