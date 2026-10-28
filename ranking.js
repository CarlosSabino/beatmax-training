// =====================================================================================
// ranking.js — RANKING online por chart (usa a conta da Nuvem / Supabase).
//
//  • Entra no ranking: treinos (menos a calibração) e músicas do osu! SEM edição, música
//    inteira, sem falhar, velocidade 100%, fora do modo sem-falha. Cada julgamento
//    (Normal / Difícil / Máximo) tem o próprio ranking.
//  • Só o melhor resultado de cada jogador fica guardado (no servidor, função ranking_enviar).
//  • Sem internet: o resultado fica guardado e é enviado na próxima vez.
//  • Tela: aba "Esta música" (top 50 + sua posição) e "Meus recordes".
// =====================================================================================
(function () {
    const PEND_KEY = 'beatmaxRankingPendentes_v1';
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const JUDGES = [['normal', 'Normal'], ['hard', 'Difícil'], ['max', 'Máximo']];
    const gradeOf = (a) => a >= 100 ? 'P' : a >= 97 ? 'S' : a >= 90 ? 'A' : a >= 80 ? 'B' : 'C';
    const fmtN = (n) => String(Math.round(n || 0)).padStart(7, '0');
    const fmtP = (a) => (+a).toFixed(2).replace('.', ',') + '%';

    // ---------- qual chart é este (e se pode entrar no ranking) ----------
    function chartKeyFor(pattern, mode, diff, judge) {
        const pat = String(pattern || '');
        judge = judge || (typeof judgeDifficulty !== 'undefined' ? judgeDifficulty : 'normal');
        if (pat.startsWith('custom:')) {
            const ch = typeof findCustomChart === 'function' ? findCustomChart(pat.slice(7)) : null;
            if (!ch) return { why: 'chart não encontrado' };
            if (ch.source !== 'osu' || !ch.osu || !ch.osu.beatmapId) return { why: 'só treinos e músicas do osu! entram no ranking' };
            if (ch.editado) return { why: 'música do osu! editada no editor não entra no ranking' };
            return { key: `o:${ch.osu.beatmapId}|${mode}|${judge}`, title: ch.title || 'Música' };
        }
        if (typeof DRILLS === 'undefined' || !DRILLS[pat]) return { why: 'treino desconhecido' };
        if (DRILLS[pat].calibration) return { why: 'a calibração não entra no ranking' };
        const dn = { NM: 'NORMAL', HD: 'HARD', MX: 'EXPERT', SC: 'MASTER' }[diff] || diff;
        return { key: `d:${pat}|${mode}|${diff}|${judge}`, title: `${DRILLS[pat].title || pat} · ${dn}` };
    }
    const DRILL_DIFFS = [['NM', 'NORMAL', '#38bdf8'], ['HD', 'HARD', '#fbbf24'], ['MX', 'EXPERT', '#f87171'], ['SC', 'MASTER', '#c084fc']];
    // as dificuldades da música/treino que está na tela do ranking (iguais às da lista de músicas)
    function difsDe(pat, mode) {
        pat = String(pat || '');
        if (pat.startsWith('custom:')) {
            const ch = typeof findCustomChart === 'function' ? findCustomChart(pat.slice(7)) : null;
            if (!ch) return [];
            const gk = typeof window.diffGroupKey === 'function' ? window.diffGroupKey(ch) : null;
            const all = (typeof customCharts !== 'undefined' && Array.isArray(customCharts)) ? customCharts : [ch];
            const list = gk ? all.filter(c => window.diffGroupKey(c) === gk) : [ch];
            return list.map(c => {
                const d = typeof chartDifficulty === 'function' ? chartDifficulty(c) : { tier: 'normal', level: 1, auto: true };
                const t = (typeof DIFF_BY_ID !== 'undefined' && DIFF_BY_ID[d.tier]) || { name: d.tier, color: '#94a3b8', idx: 0 };
                return { id: 'custom:' + c.id, name: t.name, lv: (d.auto ? '≈' : '') + d.level, color: t.color, ord: t.idx * 100 + d.level + (c.notes || []).length / 1e6, ver: c.osu && c.osu.version || '' };
            }).sort((a, b) => a.ord - b.ord);
        }
        if (typeof DRILLS === 'undefined' || !DRILLS[pat] || DRILLS[pat].calibration) return [];
        return DRILL_DIFFS.map(([k, n, c]) => ({ id: k, name: n, lv: '', color: c }));
    }
    function chartAtual(judge) {
        const pat = tela.pat || (typeof currentPatternType !== 'undefined' ? currentPatternType : '');
        const mode = typeof currentMode !== 'undefined' ? currentMode : '4K';
        const c = chartKeyFor(pat, mode, tela.diff || (typeof currentDifficulty !== 'undefined' ? currentDifficulty : 'HD'), judge);
        try { c.label = typeof patternTitle === 'function' ? patternTitle(pat) : c.title; } catch (e) { c.label = c.title; }
        if (String(pat).startsWith('custom:')) { const ch = findCustomChart(pat.slice(7)); if (ch) c.label = String(ch.title || c.label).replace(/\s*\[[^\]]*\]\s*$/, ''); }
        else if (typeof DRILLS !== 'undefined' && DRILLS[pat]) c.label = DRILLS[pat].title || c.label;
        return c;
    }
    function modsTxt() {
        const out = [];
        ['mod-random', 'mod-cover', 'mod-speed', 'mod-fader'].forEach(id => { const s = $(id); if (s && s.selectedIndex > 0) out.push(s.options[s.selectedIndex].text.replace(/\s*\(.*$/, '').trim()); });
        return out.join(' · ');
    }

    // ---------- conexão ----------
    async function logado() {
        if (typeof nuvemClient !== 'function') return null;
        try {
            if (typeof nuvem !== 'undefined' && nuvem.user && nuvem.profile) return nuvem.user;
            if (typeof nuvemLoadProfile === 'function') return await nuvemLoadProfile();
        } catch (e) {}
        return null;
    }
    const pend = () => { try { return JSON.parse(localStorage.getItem(PEND_KEY) || '[]') || []; } catch (e) { return []; } };
    const setPend = (l) => { try { localStorage.setItem(PEND_KEY, JSON.stringify(l.slice(-30))); } catch (e) {} };
    async function enviar(r) {
        const sb = nuvemClient();
        const { data, error } = await sb.rpc('ranking_enviar', r);
        if (error) throw error;
        return data;
    }
    async function enviarPendentes() {
        const l = pend(); if (!l.length) return;
        if (!(await logado())) return;
        const rest = [];
        for (const r of l) {
            try { await enviar(r); await new Promise(res => setTimeout(res, 21000)); }
            catch (e) { if (/Failed to fetch|network/i.test(String(e && e.message))) rest.push(r); }
        }
        setPend(rest);
    }

    // ---------- depois de cada partida ----------
    let ultimo = null; // { key, res } pra tela de resultado
    if (typeof window.afterRunFinished === 'function') {
        const orig = window.afterRunFinished;
        window.afterRunFinished = function (failed) {
            const wasReplay = typeof replayRun !== 'undefined' && !!replayRun;
            const calib = typeof isCalibrationRun === 'function' && isCalibrationRun();
            const out = orig.apply(this, arguments);
            try {
                const run = typeof lastRunSummary !== 'undefined' && lastRunSummary && lastRunSummary.run;
                if (!window.__bmTeste && !wasReplay && !calib && run && !run.failed && !failed && !run.section && !run.noFail && Math.abs((run.rate || 1) - 1) < 0.001) {
                    const c = chartKeyFor(run.pattern, run.mode, run.diff, run.judge);
                    const nNotes = (typeof notes !== 'undefined' && Array.isArray(notes)) ? notes.length : 0;
                    if (c.key && nNotes >= 30) {
                        const payload = {
                            p_key: c.key, p_title: c.title, p_mode: run.mode, p_judge: run.judge || 'normal',
                            p_score: run.score | 0, p_acc: run.acc, p_combo: run.maxCombo | 0, p_notes: Math.max(nNotes, run.notes | 0),
                            p_m100: run.m100 | 0, p_brk: run.brk | 0, p_mods: modsTxt(),
                            p_ver: (($('app-version-text') || {}).textContent || '').replace(/[^0-9.]/g, '').slice(0, 20)
                        };
                        ultimo = { key: c.key, res: null, at: Date.now() };
                        logado().then(u => {
                            if (!u) { ultimo.res = { off: true }; return; }
                            return enviar(payload).then(res => {
                                ultimo.res = res;
                                if (res && res.recorde) aviso(`🏆 <b>#${res.posicao}</b> de ${res.total} no ranking de <b>${esc(c.title)}</b>`);
                                try { if (typeof resRender === 'function' && !$('stats-overlay').classList.contains('hidden')) resRender(); } catch (e) {}
                            }).catch(e => {
                                const m = String(e && e.message || e);
                                if (/Failed to fetch|network/i.test(m)) { const l = pend(); l.push(payload); setPend(l); }
                                ultimo.res = { erro: /rápidos/.test(m) ? 'envios muito rápidos' : 'não enviado' };
                            });
                        });
                    }
                }
            } catch (e) { console.warn('[ranking]', e); }
            return out;
        };
    }
    function aviso(html) {
        const t = document.createElement('div');
        t.style.cssText = 'position:fixed;left:50%;top:110px;transform:translateX(-50%);z-index:190;padding:9px 20px;border-radius:999px;background:linear-gradient(90deg,#78350f,#4c1d95);border:1px solid #fde68a;color:#fff;font:700 16px Rajdhani,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5);pointer-events:none;transition:opacity .4s';
        t.innerHTML = html; document.body.appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 450); }, 4200);
    }

    // ---------- estilo ----------
    const css = document.createElement('style');
    css.textContent = `
#rk-ov{position:fixed;inset:0;z-index:150;background:rgba(2,6,23,.9);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;color:#e2e8f0}
#rk-ov .bx{width:min(1000px,96vw);max-height:90vh;display:flex;flex-direction:column;background:linear-gradient(180deg,#111a2e,#0b1222);border:1px solid #334155;border-radius:18px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.6)}
#rk-ov .hd{display:flex;align-items:center;gap:14px;padding:16px 24px;background:linear-gradient(90deg,#78350f,#4c1d95);font:900 24px Orbitron,monospace;letter-spacing:.1em;color:#fff}
#rk-ov .hd .x{margin-left:auto;font:800 13px Orbitron;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.4);border-radius:8px;padding:6px 12px;color:#fff;cursor:pointer}
#rk-ov .tb{display:flex;gap:6px;padding:12px 24px 0;align-items:flex-end;flex-wrap:wrap}
#rk-ov .tb button{padding:8px 20px;border-radius:10px 10px 0 0;border:0;background:#0f172a;color:#64748b;font:900 14px Orbitron;cursor:pointer}
#rk-ov .tb button.on{background:#1e293b;color:#fff;box-shadow:inset 0 3px 0 #fbbf24}
#rk-ov .tb .j{margin-left:auto;display:flex;gap:4px;padding-bottom:6px}
#rk-ov .tb .j button{border-radius:8px;padding:5px 12px;font-size:12px}
#rk-ov .tb .j button.on{box-shadow:none;background:#fbbf24;color:#1c1917}
#rk-ov .tb .j span{font:800 10px Orbitron;letter-spacing:.1em;color:#64748b;align-self:center;margin-right:4px}
#rk-ov .dfs{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0 10px}
#rk-ov .dfs button{display:inline-flex;gap:6px;align-items:center;padding:4px 12px;border-radius:999px;border:1.5px solid var(--dc);color:var(--dc);background:rgba(15,23,42,.6);font:800 12px Orbitron;cursor:pointer;opacity:.6}
#rk-ov .dfs button:hover{opacity:1}#rk-ov .dfs button b{font-size:13px}
#rk-ov .dfs button.on{background:var(--dc);color:#020617;opacity:1;box-shadow:0 0 10px var(--dc)}
#rk-ov .dfs .ver{font:600 13px Rajdhani;color:#94a3b8}
#rk-ov .bd{background:#1e293b;padding:16px 24px 20px;overflow-y:auto;flex:1;min-height:200px}
#rk-ov .song{font:900 20px Orbitron;color:#fde68a;margin-bottom:4px}
#rk-ov .sub{font:600 14px Rajdhani;color:#94a3b8;margin-bottom:12px}
#rk-ov table{width:100%;border-collapse:collapse}
#rk-ov th{font:800 12px Orbitron;letter-spacing:.08em;color:#94a3b8;text-align:left;padding:6px 10px;border-bottom:1px solid #334155}
#rk-ov td{padding:8px 10px;border-bottom:1px solid rgba(51,65,85,.5);font:700 16px Rajdhani}
#rk-ov td.n{font:900 15px Orbitron;color:#cbd5e1;width:56px}
#rk-ov tr.top1 td.n{color:#fde047}#rk-ov tr.top2 td.n{color:#e2e8f0}#rk-ov tr.top3 td.n{color:#fb923c}
#rk-ov tr.me td{background:rgba(34,211,238,.12)}
#rk-ov td.sc{font:900 16px Orbitron;color:#fff}
#rk-ov td.g{font:900 16px Orbitron;color:#fde68a}
#rk-ov td.md{font-size:13px;color:#f472b6}
#rk-ov td .nk{color:#7dd3fc;font-size:14px;margin-left:6px}
#rk-ov .msg{padding:30px 10px;text-align:center;color:#94a3b8;font:600 16px Rajdhani}
#rk-ov .msg button{margin-top:12px;padding:9px 18px;border-radius:10px;border:1px solid #fbbf24;background:#78350f;color:#fff;font:700 15px Rajdhani;cursor:pointer}
#rk-ov .mine{margin-top:12px;padding:10px 14px;border-radius:12px;background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.35);font:700 15px Rajdhani}
#rk-ov .rl tr{cursor:pointer}#rk-ov .rl tr:hover td{background:rgba(255,255,255,.04)}
#rk-ov .ft{padding:10px 24px;font:600 13px Rajdhani;color:#64748b;background:#0b1222}
.lv-res .rk{font:800 12px Orbitron;color:#fde68a;margin-top:2px}`;
    document.head.appendChild(css);

    // ---------- tela ----------
    let tela = { aba: 'musica', judge: null, pat: '', diff: '' };
    async function abrir(opt) {
        opt = opt || {};
        document.getElementById('rk-ov')?.remove();
        const ov = document.createElement('div'); ov.id = 'rk-ov';
        tela.judge = opt.judge || tela.judge || (typeof judgeDifficulty !== 'undefined' ? judgeDifficulty : 'normal');
        if (opt.aba) tela.aba = opt.aba;
        tela.pat = typeof currentPatternType !== 'undefined' ? currentPatternType : '';
        tela.diff = typeof currentDifficulty !== 'undefined' ? currentDifficulty : 'HD';
        ov.innerHTML = `<div class="bx"><div class="hd">🏆 RANKING<button class="x" data-x>ESC · FECHAR</button></div>
            <div class="tb"><button data-a="musica">ESTA MÚSICA</button><button data-a="meus">MEUS RECORDES</button>
              <div class="j"><span>JULGAMENTO</span>${JUDGES.map(([k, n]) => `<button data-j="${k}">${n}</button>`).join('')}</div></div>
            <div class="bd" id="rk-bd"><div class="msg">Carregando…</div></div>
            <div class="ft">Entram no ranking: treinos e músicas do osu! sem edição, música inteira, sem falhar, velocidade 100%. Só o seu melhor resultado fica guardado. Cada dificuldade e cada julgamento têm o próprio ranking. ← → dificuldade · Tab aba · Shift julgamento</div></div>`;
        document.body.appendChild(ov);
        const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
        const onKey = (e) => {
            if (!document.getElementById('rk-ov')) return;
            if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault(); e.stopImmediatePropagation();
                const l = difsDe(tela.pat, currentMode); if (tela.aba !== 'musica' || l.length < 2) return;
                const cur = String(tela.pat).startsWith('custom:') ? tela.pat : tela.diff;
                const i = Math.max(0, l.findIndex(d => d.id === cur)); pickDif(l[(i + (e.key === 'ArrowRight' ? 1 : l.length - 1)) % l.length].id); return;
            }
            if (e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); tela.aba = tela.aba === 'musica' ? 'meus' : 'musica'; render(); return; }
            if (e.key === 'Shift') { e.preventDefault(); e.stopImmediatePropagation(); const i = JUDGES.findIndex(j => j[0] === tela.judge); tela.judge = JUDGES[(i + 1) % 3][0]; render(); return; }
            e.stopImmediatePropagation();
        };
        document.addEventListener('keydown', onKey, true);
        ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
        ov.querySelector('[data-x]').onclick = close;
        ov.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { tela.aba = b.dataset.a; render(); });
        ov.querySelectorAll('[data-j]').forEach(b => b.onclick = () => { tela.judge = b.dataset.j; render(); });
        if (typeof window.beatmaxPersonagem === 'function') {
            const l = ['Analisando o ranking… quem será que está no topo hoje?', 'Só o seu <b>melhor</b> resultado conta. Pode tentar quantas vezes quiser.', 'Cada <b>dificuldade</b> tem o próprio ranking. Troque com ← →.', 'O <b>julgamento</b> (Normal, Difícil, Máximo) é a janela de tempo dos acertos, não a dificuldade da música.', 'Bater o recorde por 1 ponto já sobe a sua posição. Os dados não mentem.'];
            window.beatmaxPersonagem(ov, 'echoRank', window.beatmaxFala ? window.beatmaxFala('echo-rk', l) : l[0], '1000px');
        }
        render();
    }
    function pickDif(id) { if (String(id).startsWith('custom:')) tela.pat = id; else tela.diff = id; render(); }
    let renderSeq = 0;
    async function render() {
        const ov = $('rk-ov'); if (!ov) return;
        const seq = ++renderSeq;
        ov.querySelectorAll('[data-a]').forEach(b => b.classList.toggle('on', b.dataset.a === tela.aba));
        ov.querySelectorAll('[data-j]').forEach(b => b.classList.toggle('on', b.dataset.j === tela.judge));
        const bd = $('rk-bd');
        bd.innerHTML = '<div class="msg">Carregando…</div>';
        const u = await logado();
        if (seq !== renderSeq) return;
        if (!u) {
            bd.innerHTML = `<div class="msg">O ranking usa a sua conta da <b>Nuvem</b>.<br>Entre (ou crie uma conta) pra ver e aparecer no ranking.<br><button data-login>☁️ Entrar na Nuvem</button></div>`;
            bd.querySelector('[data-login]').onclick = () => { ov.remove(); document.getElementById('btn-nuvem')?.click(); };
            return;
        }
        const sb = nuvemClient();
        try {
            if (tela.aba === 'musica') {
                const c = chartAtual(tela.judge);
                const difs = difsDe(tela.pat, currentMode), curD = String(tela.pat).startsWith('custom:') ? tela.pat : tela.diff;
                const act = difs.find(d => d.id === curD);
                const chips = difs.length ? `<div class="dfs">${difs.map(d => `<button data-d="${esc(d.id)}" class="${d.id === curD ? 'on' : ''}" style="--dc:${d.color}" title="${esc(d.ver)}">${esc(d.name)}${d.lv ? `<b>${esc(d.lv)}</b>` : ''}</button>`).join('')}${act && act.ver ? `<span class="ver">“${esc(act.ver)}”</span>` : ''}</div>` : '';
                const bindChips = () => bd.querySelectorAll('[data-d]').forEach(b => b.onclick = () => pickDif(b.dataset.d));
                if (!c.key) { bd.innerHTML = `<div class="song">${esc(c.label || '')}</div>${chips}<div class="msg">Esta música não tem ranking: ${esc(c.why)}.</div>`; bindChips(); return; }
                const { data: rows, error } = await sb.from('ranking').select('user_id,score,acc,max_combo,mods,at,profiles(nick,display)').eq('chart_key', c.key).order('score', { ascending: false }).order('at', { ascending: true }).limit(50);
                if (error) throw error;
                if (seq !== renderSeq) return;
                const meIdx = rows.findIndex(r => r.user_id === u.id);
                let mineHtml = '';
                if (meIdx < 0) {
                    const { data: me } = await sb.from('ranking').select('score,acc').eq('chart_key', c.key).eq('user_id', u.id).maybeSingle();
                    if (me) {
                        const { count } = await sb.from('ranking').select('user_id', { count: 'exact', head: true }).eq('chart_key', c.key).gt('score', me.score);
                        mineHtml = `<div class="mine">Você: <b>#${(count || 0) + 1}</b> · ${fmtN(me.score)} · ${fmtP(me.acc)}</div>`;
                    } else mineHtml = '<div class="mine">Você ainda não tem resultado nesta dificuldade. Conclua ela pra entrar!</div>';
                }
                const jn = JUDGES.find(j => j[0] === tela.judge)[1];
                bd.innerHTML = `<div class="song">${esc(c.label)}</div>${chips}<div class="sub">${act ? `<b style="color:${act.color}">${esc(act.name)} ${esc(act.lv)}</b> · ` : ''}${esc(typeof getModeDisplayName === 'function' ? getModeDisplayName(currentMode) : currentMode)} · julgamento ${jn} · ${rows.length ? rows.length + (rows.length === 50 ? '+' : '') + ' jogador' + (rows.length > 1 ? 'es' : '') : 'ninguém ainda'}</div>
                    ${rows.length ? `<table><tr><th>#</th><th>JOGADOR</th><th>PONTOS</th><th>PRECISÃO</th><th>NOTA</th><th>COMBO</th><th>EFEITOS</th></tr>
                    ${rows.map((r, i) => `<tr class="${i < 3 ? 'top' + (i + 1) : ''}${r.user_id === u.id ? ' me' : ''}"><td class="n">${i + 1}</td><td>${esc(r.profiles && r.profiles.display || '?')}<span class="nk">@${esc(r.profiles && r.profiles.nick || '')}</span></td><td class="sc">${fmtN(r.score)}</td><td>${fmtP(r.acc)}</td><td class="g">${gradeOf(r.acc)}</td><td>${r.max_combo}</td><td class="md">${esc(r.mods || '—')}</td></tr>`).join('')}</table>` : '<div class="msg">Ninguém jogou esta dificuldade neste julgamento ainda. Seja o primeiro! 🏆</div>'}
                    ${mineHtml}`;
                bindChips();
            } else {
                const { data: rows, error } = await sb.from('ranking').select('chart_key,title,mode,judge,score,acc,at').eq('user_id', u.id).order('at', { ascending: false }).limit(100);
                if (error) throw error;
                if (seq !== renderSeq) return;
                bd.innerHTML = rows.length ? `<div class="sub">${rows.length} música${rows.length > 1 ? 's' : ''} no ranking · as mais recentes primeiro</div>
                    <table class="rl"><tr><th>MÚSICA</th><th>MODO</th><th>JULG.</th><th>PONTOS</th><th>PRECISÃO</th><th>NOTA</th><th>QUANDO</th></tr>
                    ${rows.map(r => `<tr><td>${esc(r.title)}</td><td>${esc(r.mode.replace('K', 'B'))}</td><td>${esc((JUDGES.find(j => j[0] === r.judge) || ['', r.judge])[1])}</td><td class="sc">${fmtN(r.score)}</td><td>${fmtP(r.acc)}</td><td class="g">${gradeOf(r.acc)}</td><td>${new Date(r.at).toLocaleDateString('pt-BR')}</td></tr>`).join('')}</table>`
                    : '<div class="msg">Você ainda não tem recordes no ranking. Conclua um treino ou uma música do osu! (velocidade 100%, sem falhar) estando logado na Nuvem.</div>';
            }
        } catch (e) {
            const m = String(e && e.message || e);
            bd.innerHTML = `<div class="msg">${/ranking|relation|does not exist|schema cache/i.test(m) ? 'O ranking ainda não foi ativado no servidor (falta rodar o <b>ranking-setup.sql</b> no Supabase).' : 'Não consegui carregar o ranking: ' + esc(typeof nuvemErr === 'function' ? nuvemErr(e) : m)}</div>`;
        }
    }
    window.openRanking = abrir;
    window.rankingInfoUltimo = () => ultimo;

    // resultado: mostra a posição embaixo da barra de nível
    if (typeof window.resRender === 'function') {
        const o = window.resRender;
        window.resRender = function () {
            const r = o.apply(this, arguments);
            try {
                const box = document.querySelector('#res-root .lv-res');
                if (box && ultimo && Date.now() - ultimo.at < 600000 && !box.querySelector('.rk')) {
                    const d = document.createElement('div'); d.className = 'rk';
                    const x = ultimo.res;
                    d.textContent = !x ? '🏆 enviando pro ranking…' : x.off ? '🏆 entre na Nuvem pra ter ranking' : x.erro ? `🏆 ranking: ${x.erro}` : x.recorde ? `🏆 recorde! #${x.posicao} de ${x.total}` : `🏆 #${x.posicao} de ${x.total} (recorde mantido)`;
                    box.appendChild(d);
                }
            } catch (e) {}
            return r;
        };
    }

    setTimeout(() => { enviarPendentes().catch(() => {}); }, 8000);
})();
