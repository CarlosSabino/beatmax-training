// =====================================================================================
// nuvem-progresso.js — PROGRESSO NA NUVEM (PC e site/Xbox com o mesmo progresso).
//
// Com a conta da Nuvem logada, o jogo guarda no Supabase (tabela "progresso", ver
// nuvem/progresso-setup.sql): nível/EXP, Beatcoins e itens, Personalizar, configurações e
// recordes/histórico. Ao abrir o jogo (ou entrar na conta) ele JUNTA o que tem no aparelho
// com o que está na nuvem — nada é apagado:
//   • EXP e Beatcoins: soma o que cada aparelho ganhou/gastou desde a última sincronia
//   • itens comprados, desafios feitos, músicas concluídas: junta os dois
//   • recordes/histórico: junta as partidas dos dois (o melhor resultado continua valendo)
//   • configurações e visual: vale o que foi mudado por último
// Ficam SÓ no aparelho: teclas, sincronia/calibração, renderizador, controle, fundo e telas
// (mudam de PC pra PC). Depois de juntar, o que mudou é aplicado na hora, sem recarregar
// o jogo (e nunca no meio da música).
// =====================================================================================
(function () {
    const META_KEY = 'beatmaxNuvemSync_v1';   // por perfil (perfis.js), fora do backup (não começa com "djmax")
    const NIVEL = 'djmaxNivel_v1', COINS = 'djmaxBeatcoins_v1', HIST = 'djmaxTrainerHistory_v1', SETT = 'djmaxTrainerSettings_v1';
    const KEYS = [NIVEL, COINS, HIST, SETT, 'djmaxTrainerColecao_v1', 'djmaxTrainerSkinFx_v1', 'djmaxTrainerGearProp_v1',
        'djmaxTrainerSV_v1', 'djmaxTrainerLane8_v1', 'djmaxTrainerReplay_v1', 'djmaxTrainerRate_v1'];
    const KSET = new Set(KEYS);
    // campos das configurações que são do APARELHO (não viajam)
    const SETT_LOCAL = ['keyConfigs', 'altKeyConfigs', 'globalOffset', 'judgeOffset', 'judgeOffsetByView', 'judgeOffsetLinked',
        'rendererPref', 'showFpsMeter', 'lowLatencyMode', 'autoFullscreen', 'currentPatternType', 'currentMode'];
    const HIST_NUVEM_ULTIMAS = 400;   // na nuvem vão os recordes + as últimas N partidas
    const PUSH_DEBOUNCE = 20000;

    const rawSet = Storage.prototype.setItem; // (já com a "gaveta" do perfil, de perfis.js)
    let aplicando = false;
    const lerMeta = () => { try { return JSON.parse(localStorage.getItem(META_KEY) || '{}') || {}; } catch (e) { return {}; } };
    let meta = Object.assign({ on: true, base: null, rev: 0, uid: null, mt: {}, last: 0, erro: '' }, lerMeta());
    const salvarMeta = () => { try { rawSet.call(localStorage, META_KEY, JSON.stringify(meta)); } catch (e) {} };

    // marca QUANDO cada chave mudou aqui (pra "vale o último") e agenda o envio
    Storage.prototype.setItem = function (k, v) {
        const r = rawSet.apply(this, arguments);
        if (!aplicando && this === window.localStorage && KSET.has(k)) {
            meta.mt[k] = Date.now(); salvarMeta();
            agendarEnvio();
        }
        return r;
    };

    const parse = (s) => { if (s == null) return undefined; try { return JSON.parse(s); } catch (e) { return s; } };
    const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    // configurações sem os campos do aparelho (pra comparar e pra mandar pra nuvem)
    const semLocais = (o) => { if (!o || typeof o !== 'object') return o; const c = Object.assign({}, o); SETT_LOCAL.forEach(f => delete c[f]); return c; };
    const idsHist = (h) => (h || []).map(r => r && r.id).filter(Boolean).sort().join(',');
    // o valor de k mudou de verdade? (histórico: mesmas partidas; configurações: sem os campos do aparelho)
    const mesmo = (k, a, b) => k === HIST ? idsHist(a) === idsHist(b) : k === SETT ? igual(semLocais(a), semLocais(b)) : igual(a, b);
    const lerLocal = () => { const o = {}; KEYS.forEach(k => { const v = parse(localStorage.getItem(k)); if (v !== undefined) o[k] = v; }); return o; };

    // ---------- histórico: charts próprias têm id diferente em cada aparelho → leva junto o osu!/nuvem ----------
    function mapasCharts() {
        const byId = new Map(), byOsu = new Map(), byCloud = new Map();
        (typeof customCharts !== 'undefined' ? customCharts : []).forEach(c => {
            byId.set(c.id, c);
            if (c.osu && c.osu.beatmapId) byOsu.set(c.osu.beatmapId + '|' + c.mode, c);
            if (c.cloud && c.cloud.id) byCloud.set(c.cloud.id, c);
        });
        return { byId, byOsu, byCloud };
    }
    function comRef(runs) {
        const m = mapasCharts();
        return runs.map(r => {
            if (typeof r.pattern !== 'string' || !r.pattern.startsWith('custom:') || r.ref) return r;
            const c = m.byId.get(r.pattern.slice(7));
            if (!c) return r;
            const ref = c.osu && c.osu.beatmapId ? { osu: c.osu.beatmapId, mode: c.mode } : c.cloud && c.cloud.id ? { cloud: c.cloud.id } : null;
            return ref ? Object.assign({}, r, { ref }) : r;
        });
    }
    function remapear(runs) {
        const m = mapasCharts();
        return runs.map(r => {
            if (!r.ref || typeof r.pattern !== 'string' || !r.pattern.startsWith('custom:') || m.byId.has(r.pattern.slice(7))) return r;
            const c = r.ref.osu ? m.byOsu.get(r.ref.osu + '|' + (r.ref.mode || r.mode)) : r.ref.cloud ? m.byCloud.get(r.ref.cloud) : null;
            return c ? Object.assign({}, r, { pattern: 'custom:' + c.id }) : r;
        });
    }
    function juntarHist(a, b) {
        const map = new Map();
        [...(a || []), ...(b || [])].forEach(r => { if (r && r.id && !map.has(r.id)) map.set(r.id, r); });
        const out = [...map.values()].sort((x, y) => (x.at || 0) - (y.at || 0));
        return out.length > 3000 ? out.slice(out.length - 3000) : out;
    }
    // versão enxuta pra nuvem: o melhor de cada música/modo/dificuldade + escadas + as últimas partidas
    function histParaNuvem(h) {
        h = comRef(h || []);
        const keep = new Set(h.slice(-HIST_NUVEM_ULTIMAS).map(r => r.id));
        const best = new Map();
        h.forEach(r => {
            if (r.ladder && r.ladderPassed) keep.add(r.id);
            if (r.failed || r.section || Math.abs((r.rate || 1) - 1) > 0.001) return;
            const k = `${r.pattern}|${r.mode}|${r.diff}`;
            const b = best.get(k);
            if (!b || r.acc > b.acc) best.set(k, r);
        });
        best.forEach(r => keep.add(r.id));
        return h.filter(r => keep.has(r.id));
    }

    // ---------- juntar ----------
    function maisRecente(k, L, R, rmt) { return (meta.mt[k] || 0) >= (rmt || 0) ? L : R; }
    function juntarNivel(L, R, B) {
        const out = JSON.parse(JSON.stringify(maisRecente(NIVEL, L, R, juntarNivel.rmt)));
        out.exp = B && typeof B.exp === 'number' ? Math.max(0, (R.exp || 0) + (L.exp || 0) - B.exp) : Math.max(L.exp || 0, R.exp || 0);
        out.cleared = Object.assign({}, R.cleared || {}, L.cleared || {});
        out.claimed = Math.max(L.claimed || 1, R.claimed || 1);
        const log = new Map(); [...(L.log || []), ...(R.log || [])].forEach(x => { const k = (x.at || 0) + '|' + x.t; if (!log.has(k)) log.set(k, x); });
        out.log = [...log.values()].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 20);
        return out;
    }
    function juntarCoins(L, R, B) {
        const out = JSON.parse(JSON.stringify(maisRecente(COINS, L, R, juntarCoins.rmt)));
        out.coins = B && typeof B.coins === 'number' ? Math.max(0, (R.coins || 0) + (L.coins || 0) - B.coins) : Math.max(L.coins || 0, R.coins || 0);
        out.owned = [...new Set([...(R.owned || []), ...(L.owned || [])])];
        out.done = Object.assign({}, R.done || {}, L.done || {});
        out.streak = Math.max(L.streak || 0, R.streak || 0);
        return out;
    }
    function juntarSett(L, R, k, rmt) {
        const out = JSON.parse(JSON.stringify(maisRecente(k, L, R, rmt)));
        if (out !== L && L && typeof L === 'object') {
            SETT_LOCAL.forEach(f => { if (f in L) out[f] = L[f]; else delete out[f]; });
            // skin criada só neste aparelho / que não existe aqui: mantém a daqui
            if (out.gearSkin && typeof GEAR_THEMES !== 'undefined' && !GEAR_THEMES[out.gearSkin] && !String(out.gearSkin).startsWith('shop_')) out.gearSkin = L.gearSkin;
        }
        return out;
    }
    function juntar(local, nuvemDoc) {
        const R = (nuvemDoc && nuvemDoc.k) || {}, RM = (nuvemDoc && nuvemDoc.mt) || {};
        const B = meta.base || {};
        const out = {};
        new Set([...Object.keys(local), ...Object.keys(R)]).forEach(k => {
            const L = local[k], Rv = R[k], Bv = B[k];
            if (k === HIST) { out[k] = juntarHist(L, remapear(Rv || [])); return; }
            if (Rv === undefined) { out[k] = L; return; }
            if (L === undefined) { out[k] = k === SETT ? juntarSett({}, Rv, k, Infinity) : Rv; return; }
            if (mesmo(k, L, Rv)) { out[k] = L; return; }
            if (Bv !== undefined && mesmo(k, L, Bv)) { out[k] = k === SETT ? juntarSett(L, Rv, k, Infinity) : Rv; return; }  // só a nuvem mudou
            if (Bv !== undefined && mesmo(k, Rv, Bv)) { out[k] = L; return; }                                               // só aqui mudou
            // os dois mudaram
            if (k === NIVEL) { juntarNivel.rmt = RM[k]; out[k] = juntarNivel(L, Rv, Bv); }
            else if (k === COINS) { juntarCoins.rmt = RM[k]; out[k] = juntarCoins(L, Rv, Bv); }
            else if (k === SETT) out[k] = juntarSett(L, Rv, k, RM[k]);
            else out[k] = maisRecente(k, L, Rv, RM[k]);
        });
        return out;
    }

    // ---------- conexão ----------
    const logado = () => typeof nuvem !== 'undefined' && nuvem.user;
    const jogando = () => typeof isPlaying !== 'undefined' && isPlaying;
    // aplicar o progresso que chegou: sem recarregar, só não no meio da música nem no editor
    const seguroAplicar = () => !jogando() && !(typeof isCountingDown !== 'undefined' && isCountingDown) && !document.querySelector('#chart-editor-modal:not(.hidden)');
    let rodando = null, envioT = 0, pendenteAplicar = false;

    async function puxar(sb) {
        const { data, error } = await sb.from('progresso').select('data,rev,updated_at').eq('user_id', nuvem.user.id).maybeSingle();
        if (error) throw error;
        return data; // null = ainda não tem
    }
    function docDe(merged) {
        const k = Object.assign({}, merged);
        if (k[HIST]) k[HIST] = histParaNuvem(k[HIST]);
        if (k[SETT]) k[SETT] = semLocais(k[SETT]);
        const mt = {}; KEYS.forEach(x => { if (meta.mt[x]) mt[x] = meta.mt[x]; });
        return { v: 1, k, mt, dev: window.BEATMAX_WEB ? 'web' : 'pc', at: Date.now() };
    }
    function aplicarLocal(merged) {
        const local = lerLocal();
        const mudou = [];
        aplicando = true;
        try {
            Object.entries(merged).forEach(([k, v]) => {
                if (v === undefined || (k === SETT ? igual(local[k], v) : mesmo(k, local[k], v))) return;
                rawSet.call(localStorage, k, typeof v === 'string' ? v : JSON.stringify(v));
                mudou.push(k);
            });
        } finally { aplicando = false; }
        return mudou;
    }

    // os módulos do jogo releem o que mudou, na hora (sem recarregar a página)
    function aplicarAoVivo(keys) {
        const tenta = (f) => { try { f(); } catch (e) { console.warn('[progresso] aplicar', e); } };
        keys.forEach(k => {
            // nível, Beatcoins e Personalizar escutam o evento "storage" e releem sozinhos
            tenta(() => window.dispatchEvent(new StorageEvent('storage', { key: k })));
        });
        if (keys.includes(HIST)) tenta(() => {
            if (typeof loadHistory === 'function') loadHistory();
            if (typeof decoratePatternCards === 'function') decoratePatternCards();
            if (typeof libQueue === 'function') libQueue();
        });
        if (keys.includes(SETT)) tenta(() => {
            if (typeof loadSettings === 'function') loadSettings();
            if (typeof setupControls === 'function') setupControls();
            if (typeof applySettingsToUI === 'function') applySettingsToUI();
            if (typeof resizeCanvas === 'function') resizeCanvas();
            if (typeof glResetGearCache === 'function') glResetGearCache();
        });
        tenta(() => { if (typeof window.bmMenuRefresh === 'function') window.bmMenuRefresh(); });
    }
    function avisoCarregado() {
        const t = document.createElement('div');
        t.style.cssText = 'position:fixed;left:50%;top:24px;transform:translateX(-50%);z-index:300;padding:10px 20px;border-radius:999px;background:linear-gradient(90deg,#0e7490,#4c1d95);border:1px solid #67e8f9;color:#fff;font:700 16px Rajdhani,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5);transition:opacity .5s;pointer-events:none';
        t.innerHTML = '☁️ Progresso da nuvem carregado — nível, Beatcoins e recordes em dia neste aparelho.';
        document.body.appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 600); }, 4500);
    }

    // sincroniza: puxa → junta → (aplica aqui) → envia. motivo: 'inicio' | 'login' | 'envio' | 'manual'
    async function sincronizar(motivo) {
        if (!meta.on || !logado()) return { off: true };
        if (rodando) return rodando;
        rodando = (async () => {
            const sb = nuvemClient();
            if (meta.uid && meta.uid !== nuvem.user.id) { meta.base = null; meta.rev = 0; }   // outra conta neste perfil
            meta.uid = nuvem.user.id;
            for (let tent = 0; tent < 3; tent++) {
                const row = await puxar(sb);
                const merged = juntar(lerLocal(), row && row.data);
                const loc = lerLocal();
                const precisaAqui = Object.keys(merged).some(k => merged[k] !== undefined && (loc[k] === undefined || !(k === SETT ? igual(merged[k], loc[k]) : mesmo(k, merged[k], loc[k]))));
                if (precisaAqui) {
                    // trocar os dados aqui no meio da música, não: espera acabar
                    if (!seguroAplicar()) { pendenteAplicar = true; return { esperando: true }; }
                }
                const doc = docDe(merged);
                let rev = row ? row.rev : 0;
                const rk = (row && row.data && row.data.k) || {};
                const difNuvem = !row || Object.keys(doc.k).some(k => !mesmo(k, doc.k[k], rk[k]));
                if (difNuvem) {
                    const { data: res, error } = await sb.rpc('progresso_salvar', { p_data: doc, p_rev: rev, p_ver: (document.getElementById('app-version-text') || {}).textContent || '' });
                    if (error) throw error;
                    if (res && res.conflito) continue;   // outro aparelho salvou no meio: relê e junta de novo
                    rev = res.rev;
                }
                meta.base = doc.k; meta.rev = rev; meta.last = Date.now(); meta.erro = ''; salvarMeta();
                if (precisaAqui) {
                    const keys = aplicarLocal(merged);
                    if (keys.length) { aplicarAoVivo(keys); avisoCarregado(); }
                }
                atualizarUI();
                return { ok: true };
            }
            throw new Error('a nuvem mudou várias vezes seguidas; tente de novo');
        })().catch(e => { meta.erro = typeof nuvemErr === 'function' ? nuvemErr(e) : String(e && e.message || e); salvarMeta(); atualizarUI(); console.warn('[progresso]', e); return { erro: meta.erro }; })
            .finally(() => { rodando = null; });
        return rodando;
    }
    function agendarEnvio(ms) {
        if (!meta.on) return;
        clearTimeout(envioT);
        envioT = setTimeout(function tenta() {
            if (!logado()) return;
            if (jogando()) { envioT = setTimeout(tenta, 15000); return; }   // nunca durante a música
            sincronizar('envio');
        }, ms == null ? PUSH_DEBOUNCE : ms);
    }

    // ---------- quando ----------
    // abrir o jogo: espera a sessão da nuvem (não trava nada; o que mudar é aplicado na hora)
    async function aoAbrir() {
        try {
            if (typeof nuvemLoadProfile !== 'function') return;
            const u = await nuvemLoadProfile();
            if (u) await sincronizar('inicio');
        } catch (e) {}
    }
    // depois que a biblioteca de músicas carregou (pra reconhecer os recordes das músicas)
    if (document.readyState === 'complete') setTimeout(aoAbrir, 1500); else window.addEventListener('load', () => setTimeout(aoAbrir, 1500));
    // ficou esperando um momento seguro pra aplicar
    setInterval(() => { if (pendenteAplicar && seguroAplicar() && logado()) { pendenteAplicar = false; sincronizar('envio'); } }, 3000);
    // terminou uma partida: manda logo (sem esperar os 20 s)
    if (typeof window.afterRunFinished === 'function') {
        const o = window.afterRunFinished;
        window.afterRunFinished = function () { const r = o.apply(this, arguments); agendarEnvio(4000); return r; };
    }
    // voltou pro jogo depois de um tempo (pode ter jogado em outro aparelho): confere
    let escondidoEm = 0;
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { escondidoEm = Date.now(); if (meta.on && logado() && !jogando()) sincronizar('envio'); }
        else if (escondidoEm && Date.now() - escondidoEm > 5 * 60000 && logado()) sincronizar('envio');
    });
    // entrou na conta: junta na hora
    if (typeof window.nuvemSignIn === 'function') {
        const o = window.nuvemSignIn;
        window.nuvemSignIn = async function () { const r = await o.apply(this, arguments); setTimeout(() => sincronizar('login'), 300); return r; };
    }
    if (typeof window.nuvemSignUp === 'function') {
        const o = window.nuvemSignUp;
        window.nuvemSignUp = async function () { const r = await o.apply(this, arguments); setTimeout(() => sincronizar('login'), 300); return r; };
    }

    // ---------- Nuvem › Conta ----------
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function quando(ts) {
        if (!ts) return 'nunca';
        const s = Math.round((Date.now() - ts) / 1000);
        if (s < 60) return 'agora há pouco';
        if (s < 3600) return `há ${Math.round(s / 60)} min`;
        const d = new Date(ts); return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
    function atualizarUI() {
        const box = document.getElementById('nv-prog');
        if (!box) return;
        box.querySelector('[data-st]').innerHTML = !meta.on ? 'Desligado neste aparelho.'
            : meta.erro ? `<span style="color:#fca5a5">⚠️ ${esc(meta.erro)}${/progresso|relation|schema/i.test(meta.erro) ? ' — falta rodar o progresso-setup.sql no Supabase.' : ''}</span>`
            : meta.last ? `✅ Última sincronização: <b>${quando(meta.last)}</b>` : 'Ainda não sincronizado neste aparelho.';
        box.querySelector('[data-on]').checked = !!meta.on;
    }
    if (typeof window.nuvemTabConta === 'function') {
        const o = window.nuvemTabConta;
        window.nuvemTabConta = function (body) {
            const r = o.apply(this, arguments);
            const host = body.querySelector('.nv-auth') || body;
            const box = document.createElement('div');
            box.id = 'nv-prog';
            box.style.cssText = 'margin-top:10px;padding:12px;border:1px solid #0369a1;border-radius:12px;background:rgba(3,105,161,.1);display:flex;flex-direction:column;gap:8px';
            box.innerHTML = `<div class="nv-h" style="margin:0">☁️ Progresso na nuvem</div>
  <label style="display:flex;gap:8px;align-items:flex-start;color:#e2e8f0;font-size:13px;cursor:pointer"><input type="checkbox" data-on style="margin-top:3px"> <span>Guardar meu progresso nesta conta e continuar de onde parei em qualquer aparelho (PC, site, Xbox).</span></label>
  <div class="nv-s" style="line-height:1.5">Vai junto: nível e EXP, Beatcoins e itens da loja, Personalizar, configurações, recordes e histórico.<br>Fica só neste aparelho: teclas, sincronia/calibração, controle, fundo e telas.</div>
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="nv-btn nv-pri" data-sync>Sincronizar agora</button><span class="nv-s" data-st></span></div>`;
            host.appendChild(box);
            box.querySelector('[data-on]').onchange = (e) => { meta.on = e.target.checked; salvarMeta(); atualizarUI(); if (meta.on) sincronizar('manual'); };
            const b = box.querySelector('[data-sync]');
            b.onclick = async () => { b.disabled = true; box.querySelector('[data-st]').textContent = '⏳ Sincronizando…'; const res = await sincronizar('manual'); b.disabled = false; if (res && res.esperando) box.querySelector('[data-st]').textContent = '⏳ Vai aplicar quando você voltar pro menu.'; else atualizarUI(); };
            atualizarUI();
            return r;
        };
    }

    window.beatmaxProgresso = { sincronizar, meta: () => meta, _juntar: juntar, _histParaNuvem: histParaNuvem };
})();
