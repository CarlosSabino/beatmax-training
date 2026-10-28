// =====================================================================================
// novidades.js — tela "Novidades": o que mudou em cada versão (novidades.json) e, se houver,
// o que vem na próxima versão disponível (lido da release do GitHub pelo servidor).
//
//  • Ícone de presente ao lado da versão, com um pontinho quando tem novidade não vista
//  • Abre sozinha uma vez depois de cada atualização (inclusive a automática)
//  • Também dá pra abrir pelo painel de atualizações (clicando na versão)
// =====================================================================================
(function () {
    const SEEN_KEY = 'djmaxNovidadesVistas';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const vt = (v) => String(v || '0').split('.').map(n => parseInt(n, 10) || 0);
    const vcmp = (a, b) => { const x = vt(a), y = vt(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
    const fmtDate = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
    const getSeen = () => { try { return localStorage.getItem(SEEN_KEY) || ''; } catch (e) { return ''; } };
    const setSeen = (v) => { try { localStorage.setItem(SEEN_KEY, v); } catch (e) {} };

    let list = null, current = null;
    async function load() {
        if (list) return list;
        try { const r = await fetch('novidades.json?t=' + Date.now(), { cache: 'no-store' }); list = r.ok ? await r.json() : []; } catch (e) { list = []; }
        if (!Array.isArray(list)) list = [];
        list.sort((a, b) => vcmp(b.version, a.version));
        try { const r = await fetch('versao.json?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) current = (await r.json()).version; } catch (e) {}
        if (!current && list.length) current = list[0].version;
        return list;
    }

    // ---------- estilo ----------
    const css = document.createElement('style');
    css.textContent = `
#nov-btn{position:relative;margin-left:6px;align-self:center;width:30px;height:30px;border-radius:999px;border:1px solid #475569;background:rgba(30,41,59,.8);color:#f9a8d4;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center}
#nov-btn:hover{background:#334155}
#nov-btn .dot{position:absolute;top:-2px;right:-2px;width:10px;height:10px;border-radius:50%;background:#f43f5e;box-shadow:0 0 8px #f43f5e;display:none}
#nov-btn.unseen .dot{display:block}
#nov-ov{position:fixed;inset:0;z-index:150;background:rgba(2,6,23,.88);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;color:#e2e8f0}
#nov-ov .bx{width:min(760px,94vw);max-height:88vh;display:flex;flex-direction:column;background:#0f172a;border:1px solid #334155;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
#nov-ov .hd{display:flex;align-items:center;gap:12px;padding:18px 22px;border-bottom:1px solid #1e293b}
#nov-ov .hd h2{flex:1;font-family:Orbitron,monospace;font-weight:900;font-size:20px;letter-spacing:.06em;color:#e0f2fe}
#nov-ov .hd .cur{font-family:'JetBrains Mono',monospace;font-size:13px;color:#94a3b8}
#nov-ov .bd{overflow-y:auto;padding:14px 22px 20px;display:flex;flex-direction:column;gap:12px}
#nov-ov .v{border:1px solid #1e293b;border-radius:12px;padding:12px 14px;background:#0b1222}
#nov-ov .v.new{border-color:rgba(34,211,238,.55);background:rgba(8,145,178,.08)}
#nov-ov .v.next{border-color:rgba(52,211,153,.6);background:rgba(16,185,129,.08)}
#nov-ov .vh{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
#nov-ov .vn{font-family:Orbitron,monospace;font-weight:800;font-size:15px;color:#67e8f9}
#nov-ov .next .vn{color:#6ee7b7}
#nov-ov .vt{font-size:17px;font-weight:700;color:#f1f5f9}
#nov-ov .vd{font-size:13px;color:#64748b;margin-left:auto}
#nov-ov .tag{font-size:11px;font-weight:800;letter-spacing:.06em;padding:2px 8px;border-radius:999px;background:#0891b2;color:#020617}
#nov-ov .next .tag{background:#10b981}
#nov-ov ul{margin:8px 0 0 0;padding-left:20px;list-style:disc}
#nov-ov li{font-size:15.5px;line-height:1.4;color:#cbd5e1;margin:3px 0}
#nov-ov .ft{display:flex;gap:10px;justify-content:flex-end;padding:12px 22px;border-top:1px solid #1e293b}
#nov-ov button{padding:8px 16px;border-radius:9px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;font-size:14px;font-weight:700;cursor:pointer}
#nov-ov button:hover{background:#334155}
#nov-ov button.pri{background:#0891b2;border-color:#22d3ee;color:#020617}
#nov-ov button.go{background:#10b981;border-color:#6ee7b7;color:#020617}
#nov-ov .more{align-self:center;background:none;border:0;color:#67e8f9;text-decoration:underline;font-weight:600}
/* Arya, a personagem do BEATMAX, do lado esquerdo apontando pras novidades */
#nov-ov .bx{position:relative}
#nov-ov .arya{display:none}
@media (min-width:1000px) and (min-height:560px){
  #nov-ov .bx{margin-left:min(300px,22vw)}
  #nov-ov .arya{display:block;position:absolute;right:calc(100% - 70px);bottom:-1px;height:min(96vh,860px);width:auto;pointer-events:none;z-index:2;
    filter:drop-shadow(0 10px 30px rgba(0,0,0,.6)) drop-shadow(0 0 22px rgba(34,211,238,.25));animation:novArya .5s cubic-bezier(.2,1.2,.4,1) both}
  #nov-ov .bx > .hd,#nov-ov .bx > .bd,#nov-ov .bx > .ft{position:relative;z-index:1}
  #nov-ov .bx > .hd,#nov-ov .bx > .bd{padding-left:80px}
}
@keyframes novArya{from{opacity:0;transform:translateX(-40px)}to{opacity:1;transform:none}}`;
    document.head.appendChild(css);

    function card(e, cls, tag) {
        const items = (e.items || []).map(i => `<li>${esc(i)}</li>`).join('') || (e.notes ? `<li>${esc(e.notes)}</li>` : '');
        return `<div class="v ${cls || ''}"><div class="vh"><span class="vn">v${esc(e.version)}</span>${tag ? `<span class="tag">${tag}</span>` : ''}<span class="vt">${esc(e.title || '')}</span><span class="vd">${fmtDate(e.date)}</span></div>${items ? `<ul>${items}</ul>` : ''}</div>`;
    }

    // since: mostra só o que é mais novo que essa versão (ao abrir depois de atualizar)
    async function openNovidades(opts = {}) {
        await load();
        document.getElementById('nov-ov')?.remove();
        const ov = document.createElement('div');
        ov.id = 'nov-ov';
        const since = opts.since;
        let showAll = !opts.auto;
        const render = () => {
            const u = (typeof updState !== 'undefined') ? updState : null;
            const next = u && u.available ? { version: u.latest, title: u.title, items: u.items, notes: u.notes, date: (u.publishedAt || '').slice(0, 10) } : null;
            const recent = since ? list.filter(e => vcmp(e.version, since) > 0 && vcmp(e.version, current) <= 0) : [];
            const shown = showAll ? list.filter(e => vcmp(e.version, current) <= 0) : (recent.length ? recent : list.slice(0, 1));
            ov.innerHTML = `<div class="bx">
                <div class="hd"><h2>🎁 ${!showAll ? 'O QUE HÁ DE NOVO' : 'NOVIDADES'}</h2><span class="cur">instalada: v${esc(current || '?')}</span></div>
                <div class="bd">
                    ${next ? card(next, 'next', 'DISPONÍVEL PRA INSTALAR') : ''}
                    ${shown.map(e => card(e, vcmp(e.version, current) === 0 ? 'new' : '', vcmp(e.version, current) === 0 ? 'INSTALADA' : '')).join('') || '<div style="color:#94a3b8">Ainda não há notas de versão.</div>'}
                    ${!showAll ? '<button class="more" data-all>Ver todas as atualizações</button>' : ''}
                </div>
                <div class="ft">
                    ${next ? '<button class="go" data-upd>⬇ Atualizar agora</button>' : ''}
                    <button class="pri" data-x>OK</button>
                </div><img class="arya" src="assets/arya.png" alt="" draggable="false"></div>`;
            ov.querySelector('[data-x]').onclick = close;
            const all = ov.querySelector('[data-all]'); if (all) all.onclick = () => { showAll = true; render(); };
            const up = ov.querySelector('[data-upd]'); if (up) up.onclick = () => { close(); if (typeof updApply === 'function') updApply(); };
        };
        const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
        const onKey = (e) => {
            if (!document.getElementById('nov-ov')) return;
            if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
            e.stopImmediatePropagation();
        };
        ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(ov);
        render();
        if (current) { setSeen(current); badge(); }
        // procura a próxima versão em segundo plano e atualiza a tela se achar
        if (typeof updCheck === 'function' && !(typeof updState !== 'undefined' && updState)) {
            updCheck(false).then(() => { if (document.getElementById('nov-ov') === ov) render(); badge(); }).catch(() => {});
        }
    }
    window.openNovidades = openNovidades;

    // ---------- botão de presente ao lado da versão ----------
    function badge() {
        let b = document.getElementById('nov-btn');
        const ref = document.getElementById('app-version-badge');
        if (!ref) return;
        if (!b) {
            b = document.createElement('button');
            b.id = 'nov-btn'; b.type = 'button'; b.title = 'Novidades: o que mudou em cada versão';
            b.innerHTML = '<i class="fa-solid fa-gift"></i><span class="dot"></span>';
            ref.insertAdjacentElement('afterend', b);
            b.addEventListener('click', () => openNovidades());
        }
        const u = (typeof updState !== 'undefined') ? updState : null;
        b.classList.toggle('unseen', !!(current && vcmp(current, getSeen()) > 0) || !!(u && u.available));
    }

    // ---------- link no painel de atualizações ----------
    if (typeof window.updPanelEnsure === 'function') {
        const orig = window.updPanelEnsure;
        window.updPanelEnsure = function () {
            const pn = orig.apply(this, arguments);
            if (pn && !pn.querySelector('#updp-nov')) {
                const btn = document.createElement('button');
                btn.id = 'updp-nov';
                btn.className = 'px-2 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] text-pink-300';
                btn.innerHTML = '<i class="fa-solid fa-gift mr-1"></i>Ver todas as novidades';
                btn.addEventListener('click', () => { pn.classList.add('hidden'); openNovidades(); });
                pn.appendChild(btn);
            }
            return pn;
        };
    }
    if (typeof window.updUI === 'function') {
        const origUI = window.updUI;
        window.updUI = function () { const r = origUI.apply(this, arguments); try { badge(); } catch (e) {} return r; };
    }

    // ---------- abre sozinha depois de uma atualização ----------
    function busy() {
        return (typeof isPlaying !== 'undefined' && isPlaying) || document.getElementById('perfil-ov') || document.getElementById('sair-ov')
            || (typeof introEl !== 'undefined' && introEl) || document.querySelector('#intro-overlay:not(.hidden)');
    }
    (async function autoShow() {
        await load();
        badge();
        if (!current) return;
        const seen = getSeen();
        if (seen && vcmp(current, seen) <= 0) return;
        let tries = 0;
        const tick = () => {
            if (busy()) { if (++tries < 600) setTimeout(tick, 1000); return; }
            openNovidades({ auto: true, since: seen || null });
        };
        setTimeout(tick, 1500);
    })();
})();
