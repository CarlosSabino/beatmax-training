// =====================================================================================
// perfis.js — perfis de jogador (ex.: pai e filho no mesmo PC).
//
// Cada perfil tem as PRÓPRIAS configurações (velocidade, calibração, teclas, skin, mods,
// fundo...), histórico, recordes, replays, controle e login da Nuvem. A biblioteca de
// músicas/charts e as skins criadas são compartilhadas.
//
// Como funciona: este arquivo carrega ANTES de todos os outros e faz o localStorage
// "trocar de gaveta": as chaves pessoais do perfil 2, 3... ganham um sufixo (@p2). O perfil 1
// usa as chaves de sempre, então quem já jogava continua com tudo como estava.
// Trocar de perfil recarrega a página (tudo é lido de novo, já da gaveta certa).
// =====================================================================================
(function () {
    const LIST_KEY = 'djmaxPerfis_v1';
    const PERSONAL = new Set([
        'djmaxTrainerSettings_v1', 'djmaxTrainerHistory_v1', 'djmaxTrainerRate_v1', 'djmaxTrainerWellbeing_v1',
        'djmaxTrainerReplay_v1', 'djmaxTrainerTelas_v1', 'djmaxTrainerFundo_v1', 'djmaxTrainerGamepad_v1',
        'djmaxPreviaMusica', 'djmaxTrainerBiblioteca_v1', 'djmaxCalibracao_v1', 'beatmaxNuvemAuth', 'djmaxTrainerPalco_v1', 'djmaxBeatcoins_v1', 'djmaxTrainerSkinFx_v1', 'djmaxTrainerSV_v1', 'djmaxTrainerLane8_v1', 'beatmaxNuvemAvisados_v1', 'djmaxTrainerGearProp_v1', 'djmaxNivel_v1', 'djmaxTrainerColecao_v1', 'beatmaxNuvemSync_v1'
    ]);
    const S = Storage.prototype;
    const rawGet = S.getItem, rawSet = S.setItem, rawRemove = S.removeItem;
    let data = null;
    try { data = JSON.parse(rawGet.call(localStorage, LIST_KEY) || 'null'); } catch (e) {}
    if (!data || !Array.isArray(data.list) || !data.list.length) data = { active: 'p1', list: [{ id: 'p1', name: 'Jogador 1', color: '#22d3ee' }] };
    if (!data.list.some(p => p.id === data.active)) data.active = data.list[0].id;

    const map = (store, key) => {
        if (window.__perfilBypass || store !== window.localStorage || data.active === 'p1' || !PERSONAL.has(key)) return key;
        return `${key}@${data.active}`;
    };
    S.getItem = function (k) { return rawGet.call(this, map(this, k)); };
    S.setItem = function (k, v) { return rawSet.call(this, map(this, k), v); };
    S.removeItem = function (k) { return rawRemove.call(this, map(this, k)); };

    const save = () => { try { rawSet.call(localStorage, LIST_KEY, JSON.stringify(data)); } catch (e) {} };
    window.perfis = {
        get list() { return data.list.slice(); },
        get active() { return data.list.find(p => p.id === data.active); },
        // sufixo pra chaves de dados em IndexedDB (replays) — perfil 1 sem sufixo
        suffix() { return data.active === 'p1' ? '' : `@${data.active}`; },
        switchTo(id) {
            if (!data.list.some(p => p.id === id)) return;
            data.active = id; save();
            try { sessionStorage.setItem('djmaxPerfilEscolhido', '1'); } catch (e) {}
            window.__beatmaxSaindo = true; location.reload();
        },
        add(name, color) {
            let n = 2; while (data.list.some(p => p.id === 'p' + n)) n++;
            const p = { id: 'p' + n, name: String(name || `Jogador ${n}`).slice(0, 20), color: color || ['#f472b6', '#a3e635', '#fbbf24', '#a78bfa'][(n - 2) % 4] };
            // começa com as configurações do perfil atual (velocidade, teclas...), mas SEM o histórico/calibração
            try {
                const cur = rawGet.call(localStorage, map(localStorage, 'djmaxTrainerSettings_v1'));
                if (cur) rawSet.call(localStorage, `djmaxTrainerSettings_v1@${p.id}`, cur);
            } catch (e) {}
            data.list.push(p); save();
            return p;
        },
        rename(id, name) { const p = data.list.find(x => x.id === id); if (p) { p.name = String(name || p.name).slice(0, 20); save(); } },
        remove(id) {
            if (id === 'p1' || id === data.active) return false;
            data.list = data.list.filter(p => p.id !== id); save();
            PERSONAL.forEach(k => { try { rawRemove.call(localStorage, `${k}@${id}`); } catch (e) {} });
            return true;
        }
    };
})();

// ---------- interface: botão no topo + tela "Quem vai jogar?" ----------
function perfilEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function perfilInicial(p) { return (p.name || '?').trim().charAt(0).toUpperCase(); }

function openPerfilPicker(first) {
    if (typeof isPlaying !== 'undefined' && isPlaying) return;
    let ov = document.getElementById('perfil-ov');
    if (ov) ov.remove();
    ov = document.createElement('div');
    ov.id = 'perfil-ov';
    ov.style.cssText = 'position:fixed;inset:0;z-index:160;background:rgba(2,6,23,.94);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;color:#e2e8f0;font-family:Rajdhani,sans-serif';
    const render = () => {
        const list = perfis.list, act = perfis.active;
        ov.innerHTML = `<div style="width:min(760px,94vw);text-align:center">
          <div style="font-family:Orbitron,monospace;font-weight:900;font-size:clamp(22px,3vw,34px);letter-spacing:.08em;color:#e0f2fe;margin-bottom:6px">QUEM VAI JOGAR?</div>
          <div style="color:#94a3b8;font-size:14px;margin-bottom:22px">Cada perfil guarda a própria velocidade, calibração, teclas, skin e recordes. As músicas são de todos.</div>
          <div id="pf-cards" style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center">
            ${list.map((p, i) => `<button data-pf="${p.id}" style="width:170px;padding:18px 10px;border-radius:18px;border:2px solid ${p.id === act.id ? p.color : '#334155'};background:#0f172a;cursor:pointer;color:#fff;position:relative">
                <div style="width:74px;height:74px;margin:0 auto 10px;border-radius:50%;background:${p.color}33;border:3px solid ${p.color};display:flex;align-items:center;justify-content:center;font:900 32px Orbitron,monospace;color:${p.color}">${perfilEsc(perfilInicial(p))}</div>
                <div style="font-weight:700;font-size:18px">${perfilEsc(p.name)}</div>
                <div style="font-size:12px;color:#64748b;margin-top:2px">tecla ${i + 1}${p.id === act.id ? ' · atual' : ''}</div>
              </button>`).join('')}
            ${list.length < 4 ? `<button id="pf-add" style="width:170px;padding:18px 10px;border-radius:18px;border:2px dashed #334155;background:transparent;cursor:pointer;color:#94a3b8">
                <div style="width:74px;height:74px;margin:0 auto 10px;border-radius:50%;border:3px dashed #475569;display:flex;align-items:center;justify-content:center;font-size:34px">+</div>
                <div style="font-weight:700;font-size:16px">Novo perfil</div></button>` : ''}
          </div>
          <div style="margin-top:22px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;font-size:13px">
            <button id="pf-rename" style="padding:7px 14px;border-radius:9px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;cursor:pointer">Renomear "${perfilEsc(act.name)}"</button>
            ${act.id !== 'p1' || list.length > 1 ? `<button id="pf-del" style="padding:7px 14px;border-radius:9px;border:1px solid #7f1d1d;background:#1e293b;color:#fca5a5;cursor:pointer">Excluir um perfil…</button>` : ''}
            ${first ? '' : '<button id="pf-close" style="padding:7px 14px;border-radius:9px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;cursor:pointer">Fechar (Esc)</button>'}
          </div></div>`;
        ov.querySelectorAll('[data-pf]').forEach(b => b.onclick = () => choose(b.dataset.pf));
        const add = ov.querySelector('#pf-add');
        if (add) add.onclick = () => {
            const name = prompt('Nome do novo perfil:', '');
            if (name == null) return;
            const p = perfis.add(name.trim() || undefined);
            if (confirm(`Perfil "${p.name}" criado. Entrar nele agora? (Lembre de fazer a Calibração com ele.)`)) perfis.switchTo(p.id); else render();
        };
        // Arya acenando ("Quem vai jogar?")
        const box = ov.firstElementChild;
        if (box && typeof window.beatmaxPersonagem === 'function') {
            box.classList.add('bx');
            const nm = perfilEsc(act.name);
            const lines = [`Oi, <b>${nm}</b>! É você mesmo? Escolhe seu perfil pra começar.`, 'Quem vai jogar hoje? Cada um tem os próprios recordes e configurações!', `Que bom te ver de novo! Aperta <b>1</b>${list.length > 1 ? `, <b>2</b>…` : ''} pra escolher rapidinho.`];
            window.beatmaxPersonagem(ov, 'arya', window.beatmaxFala ? window.beatmaxFala('arya-pf', lines) : lines[0], '760px', ov.dataset.chOnce === '1');
            ov.dataset.chOnce = '1';
        }
        ov.querySelector('#pf-rename').onclick = () => { const n = prompt('Novo nome:', act.name); if (n && n.trim()) { perfis.rename(act.id, n.trim()); render(); perfilBadge(); } };
        const del = ov.querySelector('#pf-del');
        if (del) del.onclick = () => {
            const others = perfis.list.filter(p => p.id !== 'p1' && p.id !== perfis.active.id);
            if (!others.length) { alert('Só dá pra excluir um perfil que não seja o atual nem o Jogador 1 original.'); return; }
            const n = prompt(`Digite o nome do perfil pra excluir (some o histórico e as configurações dele):\n${others.map(p => '• ' + p.name).join('\n')}`);
            const p = others.find(x => x.name.toLowerCase() === String(n || '').trim().toLowerCase());
            if (p && perfis.remove(p.id)) render();
        };
        const close = ov.querySelector('#pf-close');
        if (close) close.onclick = done;
    };
    const done = () => { try { sessionStorage.setItem('djmaxPerfilEscolhido', '1'); } catch (e) {} ov.remove(); document.removeEventListener('keydown', onKey, true); };
    const choose = (id) => { if (id === perfis.active.id) done(); else perfis.switchTo(id); };
    const onKey = (e) => {
        if (!document.getElementById('perfil-ov')) return;
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= perfis.list.length) { e.preventDefault(); e.stopImmediatePropagation(); choose(perfis.list[n - 1].id); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); done(); }
        else if (e.key === 'Escape' && !first) { e.preventDefault(); e.stopImmediatePropagation(); done(); }
        else e.stopImmediatePropagation();
    };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(ov);
    render();
}

function perfilBadge() {
    let b = document.getElementById('perfil-badge');
    const ref = document.getElementById('app-version-badge');
    if (!ref) return;
    if (!b) {
        b = document.createElement('button');
        b.id = 'perfil-badge';
        b.type = 'button';
        b.title = 'Trocar de jogador';
        b.style.cssText = 'margin-left:6px;align-self:center;display:flex;align-items:center;gap:6px;padding:3px 10px 3px 3px;border-radius:999px;border:1px solid #475569;background:rgba(30,41,59,.8);color:#e2e8f0;font-size:12px;font-weight:700;cursor:pointer';
        ref.insertAdjacentElement('afterend', b);
        b.addEventListener('click', () => openPerfilPicker(false));
    }
    const p = perfis.active;
    b.innerHTML = `<span style="width:22px;height:22px;border-radius:50%;background:${p.color}33;border:2px solid ${p.color};display:flex;align-items:center;justify-content:center;font:900 11px Orbitron,monospace;color:${p.color}">${perfilEsc(perfilInicial(p))}</span>${perfilEsc(p.name)}`;
}

document.addEventListener('DOMContentLoaded', () => {
    perfilBadge();
    // com mais de um perfil, pergunta quem vai jogar uma vez por sessão (abrir o jogo)
    let chosen = false;
    try { chosen = sessionStorage.getItem('djmaxPerfilEscolhido') === '1'; } catch (e) {}
    if (perfis.list.length > 1 && !chosen) setTimeout(() => openPerfilPicker(true), 50);
});
