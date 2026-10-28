// =====================================================================================
// nivel.js — NÍVEL DO JOGADOR (Lv. 1 → 100 e além) com EXP por música.
//
//  EXP pra subir:  Lv < 100  → 95 + 9·L + 0,14·L²   (Lv 1→100 ≈ 99.929 EXP no total)
//                  Lv ≥ 100  → 24.000 · 1,08^(L−100)
//  EXP da partida: (45 + 27·★) × duração (até +10% em 10 min) × desempenho (×0,70 … ×1,15)
//                  × velocidade (música mais lenta rende menos) × repetição × 1ª conclusão
//   • falhou (HP zerou) ou treino de trecho: só a parte jogada, e menos que concluir
//   • repetir o MESMO chart muitas vezes no dia rende menos (incentiva variar)
//   • 1ª vez que conclui um chart: +20%
//   • desafio do dia +250 EXP · cada desafio semanal +500 EXP
//  Recompensas a cada 5 níveis (Beatcoins), títulos a cada 10, molduras em 25/50/75/100.
//  Tudo por perfil (e entra no backup).
// =====================================================================================
(function () {
    const KEY = 'djmaxNivel_v1';
    let st = { exp: 0, title: '', frame: '', claimed: 1, cleared: {}, day: '', today: {}, log: [] };
    const load = () => { try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {} };
    load();
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { console.warn('[nivel] não salvou', e); } };
    window.addEventListener('storage', (e) => { if (e.key && e.key.startsWith(KEY)) { load(); try { chip(); } catch (er) {} } });
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = (n) => Math.round(n).toLocaleString('pt-BR');
    const pad = (n) => String(n).padStart(2, '0');
    const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    // ---------- curva de nível ----------
    const need = (L) => L < 100 ? Math.round(95 + 9 * L + 0.14 * L * L) : Math.round(24000 * Math.pow(1.08, L - 100));
    function levelInfo(total) {
        let L = 1, left = Math.max(0, total);
        while (left >= need(L) && L < 999) { left -= need(L); L++; }
        return { lv: L, cur: left, need: need(L), pct: left / need(L) };
    }

    // ---------- recompensas ----------
    const TITLES = { 1: 'Novato', 10: 'Aprendiz do Ritmo', 20: 'Ritmista', 30: 'Groove Runner', 40: 'Virtuoso', 50: 'Mestre do Timing', 60: 'Maestro', 70: 'Fenômeno', 80: 'Lenda Viva', 90: 'Mito', 100: 'Lenda BEATMAX' };
    const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    function titleAt(L) {
        if (TITLES[L]) return TITLES[L];
        if (L > 100 && L % 10 === 0) { const n = (L - 100) / 10; return `Transcendente ${ROMAN[n] || n}`; }
        return null;
    }
    const FRAMES = {
        padrao: { lv: 1, name: 'Padrão' },
        bronze: { lv: 25, name: 'Bronze' },
        prata: { lv: 50, name: 'Prata' },
        ouro: { lv: 75, name: 'Ouro' },
        prisma: { lv: 100, name: 'Prisma (Lv 100)' },
        cosmos: { lv: 150, name: 'Cosmos (Lv 150)' }
    };
    function rewardsAt(L) {
        const r = [];
        if (L % 5 === 0) r.push({ kind: 'coins', n: L <= 100 ? 5 + L : 50 });
        const t = titleAt(L); if (t && L > 1) r.push({ kind: 'title', name: t });
        for (const [id, f] of Object.entries(FRAMES)) if (f.lv === L && L > 1) r.push({ kind: 'frame', id, name: f.name });
        return r;
    }
    const titlesUnlocked = (lv) => { const out = []; for (let L = 1; L <= lv; L++) { const t = titleAt(L); if (t) out.push({ L, t }); } return out; };
    const framesUnlocked = (lv) => Object.entries(FRAMES).filter(([, f]) => f.lv <= lv).map(([id]) => id);
    function curTitle(lv) { const all = titlesUnlocked(lv); return (all.find(x => x.t === st.title) || all[all.length - 1] || { t: 'Novato' }).t; }
    function curFrame(lv) { const ok = framesUnlocked(lv); return ok.includes(st.frame) ? st.frame : ok[ok.length - 1]; }

    // ---------- EXP da partida ----------
    const DRILL_STARS = { NM: 3, HD: 6, MX: 9, SC: 12 };
    function perfMult(acc) {
        if (acc >= 100) return 1.15;
        if (acc >= 98) return 1.10;
        if (acc >= 95) return 1.05;
        if (acc >= 90) return 1.00;
        if (acc >= 80) return 0.90;
        if (acc >= 70) return 0.80;
        return 0.70;
    }
    function starsOf(run) {
        const pat = String(run.pattern || '');
        if (pat.startsWith('custom:') && typeof findCustomChart === 'function' && typeof chartDifficulty === 'function') {
            const ch = findCustomChart(pat.slice(7));
            if (ch) {
                const lv = Math.max(1, Math.min(15, chartDifficulty(ch).level || 1));
                if (ch.source === 'osu' && !ch.editado) return lv;
                return Math.min(lv, estrelasCalc(ch));
            }
        }
        return DRILL_STARS[run.diff] || 5;
    }
    function chartShape() {
        const ns = (typeof notes !== 'undefined' && Array.isArray(notes)) ? notes : [];
        let first = Infinity, end = 0, judged = 0;
        for (const n of ns) { first = Math.min(first, n.time); end = Math.max(end, n.time, n.holdEnd || 0); if (n.hit || n.missed) judged++; }
        try { if (typeof getSongEndChartMs === 'function') { const e = getSongEndChartMs(); if (isFinite(e) && e > end) end = e; } } catch (e) {}
        const durMs = ns.length ? Math.max(0, end - Math.min(first, 2000)) : 0;
        return { durMin: durMs / 60000, progress: ns.length ? judged / ns.length : 0 };
    }
    const chartKey = (run) => String(run.pattern || '').startsWith('custom:') ? `${run.pattern}|${run.mode}` : `${run.pattern}|${run.mode}|${run.diff}`;
    // Regras anti-farm (o recorde fica só neste computador, então as regras são duras):
    //  • só dá EXP: treinos e músicas do osu! SEM edição (chart criado/editado no editor não conta)
    //  • música com menos de 30 s (ou menos de 30 notas) não dá EXP
    //  • 1ª conclusão do chart: EXP cheia +20%
    //  • depois: só 35% — a não ser que bata o recorde por pelo menos 1 ponto (ou suba de nota):
    //    aí vale a EXP cheia (sem os 20%), no máximo 2 vezes por dia por chart
    //  • falhar/treinar trecho: parte jogada × 0,8 (e 35% se o chart já foi concluído antes)
    const MIN_SEC = 30, MIN_NOTES = 30, REPEAT = 0.35, PB_STEP = 1.0, PB_PER_DAY = 2;
    // charts feitos no editor / importados de arquivo / da Nuvem
    const OWN_MIN_SEC = 60, OWN_MIN_NOTES = 100, OWN_MULT = 0.5, OWN_DAY_CAP = 1500;
    const gradeIdx = (a) => a >= 100 ? 4 : a >= 97 ? 3 : a >= 90 ? 2 : a >= 80 ? 1 : 0;
    function meuNick() { try { return (typeof nuvem !== 'undefined' && nuvem.profile && nuvem.profile.nick) || ''; } catch (e) { return ''; } }
    // tipo do chart: drill · osu (original) · own (seu / editado / arquivo) · cloud (de outro jogador pela Nuvem)
    function tipoDe(run) {
        const pat = String(run.pattern || '');
        if (!pat.startsWith('custom:')) {
            if (typeof DRILLS !== 'undefined' && DRILLS[pat] && DRILLS[pat].calibration) return { why: 'calibração não dá EXP' };
            return { tipo: 'drill' };
        }
        const ch = typeof findCustomChart === 'function' ? findCustomChart(pat.slice(7)) : null;
        if (!ch) return { why: 'chart não encontrado' };
        if (ch.source === 'osu' && !ch.editado) return { tipo: 'osu', ch };
        const from = ch.cloud && ch.cloud.from ? String(ch.cloud.from).toLowerCase() : '';
        if (from && from !== meuNick().toLowerCase()) return { tipo: 'cloud', ch };
        return { tipo: 'own', ch };
    }
    // dificuldade calculada pelo jogo (o autor não consegue inflar): toques por segundo,
    // contando acordes como um toque só, no trecho mais denso de 20 s e na média
    function estrelasCalc(ch) {
        const ns = (ch && ch.notes) || [];
        if (ns.length < 2) return 1;
        const ts = [...new Set(ns.map(n => Math.round(n.time / 15)))].sort((a, b) => a - b).map(v => v * 15);
        const dur = Math.max(10000, ts[ts.length - 1] - ts[0]);
        const media = ts.length / (dur / 1000);
        let pico = 0, j = 0;
        for (let i = 0; i < ts.length; i++) { while (ts[i] - ts[j] > 20000) j++; pico = Math.max(pico, (i - j + 1) / 20); }
        const nps = media * 0.6 + pico * 0.4;
        const chordBonus = ns.length / ts.length > 1.4 ? 1 : 0;
        return Math.max(1, Math.min(15, Math.round(nps * 1.25) + chordBonus));
    }
    function elegivel(run) { const t = tipoDe(run); return t.why || ''; }
    function computeExp(run, prevBest) {
        const stars = starsOf(run);
        const base = 45 + 27 * stars;
        const sh = chartShape();
        const nNotes = (typeof notes !== 'undefined' && Array.isArray(notes)) ? notes.length : 0;
        const k = chartKey(run);
        const today = dateKey();
        if (st.day !== today) { st.day = today; st.today = {}; st.pbToday = {}; }
        if (!st.pbToday) st.pbToday = {};
        if (typeof st.ownToday !== 'number' || st.ownDay !== today) { st.ownToday = 0; st.ownDay = today; }
        const tipo = tipoDe(run);
        const zero = (why) => ({ exp: 0, why, stars, base, durMult: 1, durMin: sh.durMin, perf: 0, partial: 0, progress: sh.progress, rateMult: 1, rep: 0, first: 1, key: k, complete: !run.failed && !run.section, failed: !!run.failed, acc: run.acc || 0 });
        if (tipo.why) return zero(tipo.why);
        const charted = tipo.tipo === 'own' || tipo.tipo === 'cloud';
        const minS = charted ? OWN_MIN_SEC : MIN_SEC, minN = charted ? OWN_MIN_NOTES : MIN_NOTES;
        const realSec = sh.durMin * 60 / Math.max(0.5, run.rate || 1);
        if (sh.durMin * 60 < minS || realSec < minS || nNotes < minN) return zero(charted ? `charts do editor/Nuvem precisam de pelo menos ${minS} s e ${minN} notas pra dar EXP` : `músicas com menos de ${MIN_SEC} s ou ${MIN_NOTES} notas não dão EXP`);
        if (tipo.tipo === 'own' && st.ownToday >= OWN_DAY_CAP) return zero(`limite diário de ${OWN_DAY_CAP} EXP dos seus charts atingido (volta amanhã)`);
        const durMult = 1 + Math.min(Math.max((sh.durMin - 2) / 8, 0), 1) * 0.10;
        const complete = !run.failed && !run.section;
        const progress = complete ? 1 : Math.max(0, Math.min(1, sh.progress));
        const perf = run.failed ? 0.70 : perfMult(run.acc || 0);
        const partial = complete ? 1 : progress * 0.8;
        const rateMult = Math.min(1, run.rate || 1);
        const n = st.today[k] || 0;
        const already = !!st.cleared[k];
        let first = 1, rep = 1, pb = false;
        if (complete && rateMult >= 1 && !already) first = tipo.tipo === 'own' ? 1 : 1.2;
        else if (already) {
            const old = prevBest && typeof prevBest.acc === 'number' ? prevBest.acc : 0;
            pb = complete && rateMult >= 1 && (run.acc || 0) > old && ((run.acc || 0) - old >= PB_STEP || gradeIdx(run.acc || 0) > gradeIdx(old)) && (st.pbToday[k] || 0) < PB_PER_DAY;
            rep = pb ? 1 : REPEAT;
        } else rep = n < 3 ? 1 : n < 6 ? 0.75 : 0.5; // ainda não concluiu: tentativas valem, mas cansam
        const own = tipo.tipo === 'own' ? OWN_MULT : 1;
        let exp = Math.max(sh.progress > 0 ? 1 : 0, Math.round(base * durMult * perf * partial * rateMult * rep * first * own));
        let capped = false;
        if (tipo.tipo === 'own') { const left = OWN_DAY_CAP - st.ownToday; if (exp > left) { exp = Math.max(0, left); capped = true; } }
        return { exp, tipo: tipo.tipo, own, capped, stars, base, durMult, durMin: sh.durMin, perf, partial, progress, rateMult, rep, first, pb, repeat: already && !pb, key: k, complete, failed: !!run.failed, acc: run.acc || 0 };
    }

    // ---------- aplicar EXP (e subir de nível) ----------
    let ctx = null;          // partida em andamento (os bônus de desafio entram nela)
    let lastGain = null;     // pra tela de resultado
    window.nivelBonus = function (amount, why) {
        amount = Math.round(amount || 0); if (amount <= 0) return;
        if (ctx) { ctx.bonus.push({ amount, why }); return; }
        load();
        applyGain({ exp: 0, bonus: [{ amount, why }], title: why });
    };
    function applyGain(g) {
        const before = levelInfo(st.exp);
        const total = g.exp + (g.bonus || []).reduce((a, b) => a + b.amount, 0);
        st.exp += total;
        const after = levelInfo(st.exp);
        g.total = total; g.before = before; g.after = after; g.at = Date.now();
        // recompensas de cada nível novo (uma vez só por marco)
        const ups = [];
        let coins = 0;
        for (let L = Math.max(before.lv, st.claimed || 1) + 1; L <= after.lv; L++) {
            const r = rewardsAt(L);
            ups.push({ L, r });
            r.forEach(x => { if (x.kind === 'coins') coins += x.n; });
        }
        st.claimed = Math.max(st.claimed || 1, after.lv);
        st.log.unshift({ at: g.at, t: g.title || '', exp: g.exp, bonus: g.bonus || [], lv: after.lv });
        st.log = st.log.slice(0, 20);
        save();
        if (ups.length) {
            if (coins && typeof window.beatcoinsAdd === 'function') window.beatcoinsAdd(coins, `⭐ LEVEL UP! Lv ${after.lv}`, ups.filter(u => u.r.some(x => x.kind === 'coins')).map(u => `Lv ${u.L}: <b>+${u.r.find(x => x.kind === 'coins').n}</b>`).join(' · '), after.lv >= 100);
            // tela de LEVEL UP só quando tem recompensa (a cada 5 níveis); nos outros, um aviso rápido
            if (ups.some(u => u.r.length)) levelUp(before.lv, after.lv, ups);
            else lvToast(`⭐ <b>Lv ${after.lv}</b>!`);
        }
        chip();
        return g;
    }

    if (typeof window.afterRunFinished === 'function') {
        const orig = window.afterRunFinished;
        window.afterRunFinished = function (failed) {
            const wasReplay = typeof replayRun !== 'undefined' && !!replayRun;
            const calib = typeof isCalibrationRun === 'function' && isCalibrationRun();
            const prevRun = typeof lastRunSummary !== 'undefined' && lastRunSummary && lastRunSummary.run;
            ctx = { bonus: [] };
            let out;
            try { out = orig.apply(this, arguments); }
            finally {
                const c = ctx; ctx = null;
                try {
                    const run = typeof lastRunSummary !== 'undefined' && lastRunSummary && lastRunSummary.run;
                    load(); // relê ANTES de marcar (o bug antigo: a releitura apagava "já concluído")
                    if (window.__bmTeste) { /* teste de visual: sem EXP */ } else if (!wasReplay && !calib && run && run !== prevRun && run.id !== st.lastRunId) {
                        const d = computeExp(run, lastRunSummary.prevBest);
                        st.lastRunId = run.id;
                        st.today[d.key] = (st.today[d.key] || 0) + 1;
                        if (d.pb) st.pbToday[d.key] = (st.pbToday[d.key] || 0) + 1;
                        if (d.tipo === 'own') st.ownToday = (st.ownToday || 0) + d.exp;
                        if (d.complete && d.rateMult >= 1 && !d.why) st.cleared[d.key] = 1;
                        let title = '';
                        try { title = typeof patternTitle === 'function' ? patternTitle(run.pattern) : run.title; } catch (e) { title = run.title || ''; }
                        lastGain = applyGain({ exp: d.exp, bonus: c.bonus, title, d, runId: run.id });
                        if (typeof resRender === 'function') setTimeout(() => { try { if (!document.getElementById('stats-overlay')?.classList.contains('hidden')) resRender(); } catch (e) {} }, 0);
                    } else if (c.bonus.length) applyGain({ exp: 0, bonus: c.bonus, title: 'Desafios' });
                } catch (e) { console.warn('[nivel]', e); }
            }
            return out;
        };
    }

    // ---------- estilo ----------
    const css = document.createElement('style');
    css.textContent = `
.lv-ring{--lvc:#64748b;position:relative;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;border:2px solid var(--lvc);color:#fff;font:900 11px Orbitron,monospace;flex-shrink:0;background:#0f172a}
.lv-ring.f-bronze{--lvc:#cd7f32;box-shadow:0 0 8px rgba(205,127,50,.55)}
.lv-ring.f-prata{--lvc:#cbd5e1;box-shadow:0 0 9px rgba(203,213,225,.6)}
.lv-ring.f-ouro{--lvc:#facc15;box-shadow:0 0 12px rgba(250,204,21,.7)}
.lv-ring.f-prisma,.lv-ring.f-cosmos{border-color:transparent;background:linear-gradient(#0f172a,#0f172a) padding-box,conic-gradient(from var(--lva,0deg),#f472b6,#facc15,#4ade80,#22d3ee,#a78bfa,#f472b6) border-box;box-shadow:0 0 14px rgba(167,139,250,.7);animation:lvSpin 4s linear infinite}
.lv-ring.f-cosmos{background:radial-gradient(circle at 30% 30%,#312e81,#0f172a) padding-box,conic-gradient(from var(--lva,0deg),#1e1b4b,#c084fc,#f0abfc,#38bdf8,#1e1b4b) border-box}
@property --lva{syntax:'<angle>';initial-value:0deg;inherits:false}
@keyframes lvSpin{to{--lva:360deg}}
#lv-chip{margin-left:6px;align-self:center;display:flex;align-items:center;gap:7px;padding:3px 10px 3px 3px;border-radius:999px;border:1px solid #475569;background:rgba(30,41,59,.8);color:#e2e8f0;cursor:pointer}
#lv-chip:hover{background:#334155}
#lv-chip .lv-ring{width:24px;height:24px;font-size:10px}
#lv-chip .tx{display:flex;flex-direction:column;gap:2px;line-height:1}
#lv-chip .tx b{font:800 11px Orbitron,monospace;color:#e0f2fe}
#lv-chip .bar{width:62px;height:4px;border-radius:3px;background:#1e293b;overflow:hidden}
#lv-chip .bar i{display:block;height:100%;background:linear-gradient(90deg,#22d3ee,#a78bfa)}
.lv-res{display:flex;flex-direction:column;gap:3px;margin-left:10px;padding-left:10px;border-left:1px solid #334155;min-width:150px}
.lv-res .r1{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font:800 12px Orbitron,monospace;color:#e0f2fe}
.lv-res .r1 em{font-style:normal;color:#86efac;font-size:13px;text-shadow:0 0 8px rgba(74,222,128,.5)}
.lv-res .bar{height:7px;border-radius:4px;background:#1e293b;overflow:hidden;position:relative}
.lv-res .bar i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#22d3ee,#a78bfa);border-radius:4px}
.lv-res .bar s{position:absolute;top:0;bottom:0;background:linear-gradient(90deg,#4ade80,#bef264);border-radius:4px;text-decoration:none;animation:lvGrow 1.1s cubic-bezier(.2,.8,.2,1) both .3s;transform-origin:left}
@keyframes lvGrow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.lv-res .r2{font:600 11px Rajdhani,sans-serif;color:#94a3b8;white-space:nowrap}
#lv-ov{position:fixed;inset:0;z-index:150;background:rgba(2,6,23,.88);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;color:#e2e8f0}
#lv-ov .bx{width:min(980px,96vw);max-height:90vh;overflow-y:auto;background:linear-gradient(180deg,#111a2e,#0b1222);border:1px solid #334155;border-radius:18px;padding:22px 26px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
#lv-ov h2{font:900 22px Orbitron,monospace;letter-spacing:.08em;color:#c4b5fd;text-align:center}
#lv-ov .hero{display:flex;align-items:center;gap:22px;margin-top:16px;padding:16px 20px;border-radius:16px;background:linear-gradient(90deg,rgba(76,29,149,.35),rgba(14,116,144,.25));border:1px solid rgba(167,139,250,.35)}
#lv-ov .hero .lv-ring{width:92px;height:92px;border-width:4px;font-size:13px;flex-direction:column}
#lv-ov .hero .lv-ring b{font-size:34px;line-height:1}
#lv-ov .hero .nm{font:900 24px Orbitron,monospace;color:#fff}
#lv-ov .hero .tt{font-weight:800;font-size:17px;color:#fde68a;letter-spacing:.04em}
#lv-ov .bigbar{height:12px;border-radius:7px;background:#1e293b;overflow:hidden;margin:10px 0 4px}
#lv-ov .bigbar i{display:block;height:100%;background:linear-gradient(90deg,#22d3ee,#a78bfa,#f472b6);border-radius:7px}
#lv-ov .cols{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:16px}
@media (max-width:860px){#lv-ov .cols{grid-template-columns:1fr}}
#lv-ov .card{border:1px solid #1e293b;border-radius:14px;background:#0f172a;padding:12px 16px}
#lv-ov .h{font:900 13px Orbitron,monospace;letter-spacing:.08em;color:#c4b5fd;margin-bottom:8px}
#lv-ov .rw{display:flex;align-items:center;gap:10px;padding:5px 0;border-top:1px solid #1e293b;font-size:14px}
#lv-ov .rw:first-of-type{border-top:0}
#lv-ov .rw .l{font:800 12px Orbitron,monospace;width:58px;color:#94a3b8}
#lv-ov .rw.got .l{color:#86efac}
#lv-ov .rw.got{opacity:.6}
#lv-ov .rw.next{background:rgba(167,139,250,.08);border-radius:8px}
#lv-ov .pill{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;border:1px solid #334155;font-weight:700;font-size:13px;margin-right:4px}
#lv-ov .dd{font-size:13.5px;color:#94a3b8;line-height:1.4}
#lv-ov .dd b{color:#e2e8f0}
#lv-ov select{background:#1e293b;border:1px solid #475569;border-radius:8px;color:#e2e8f0;padding:4px 8px;font-weight:700}
#lv-ov .frames{display:flex;gap:10px;flex-wrap:wrap}
#lv-ov .frames button{display:flex;flex-direction:column;align-items:center;gap:4px;background:none;border:1px solid transparent;border-radius:10px;padding:6px;color:#cbd5e1;font-size:12px;cursor:pointer}
#lv-ov .frames button.on{border-color:#a78bfa;background:rgba(167,139,250,.12)}
#lv-ov .frames button:disabled{opacity:.3;cursor:default}
#lv-ov .frames .lv-ring{width:40px;height:40px;font-size:13px}
#lv-ov .lg{display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-top:1px solid #1e293b;font-size:13.5px}
#lv-ov .lg:first-of-type{border-top:0}
#lv-ov .lg span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#lv-ov .lg b{color:#86efac;font-family:Orbitron,monospace;font-size:12px;white-space:nowrap}
#lv-ov .row{display:flex;justify-content:center;gap:10px;margin-top:16px}
#lv-ov button.x{padding:9px 18px;border-radius:10px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;font-weight:700;font-size:15px;cursor:pointer}
#lv-up{position:fixed;inset:0;z-index:175;display:flex;align-items:center;justify-content:center;background:rgba(2,6,23,.78);backdrop-filter:blur(6px);opacity:0;transition:opacity .35s;cursor:pointer;font-family:Rajdhani,sans-serif;overflow:hidden}
#lv-up.on{opacity:1}
#lv-up .rays{position:absolute;width:160vmax;height:160vmax;background:repeating-conic-gradient(from 0deg,rgba(167,139,250,.10) 0 8deg,transparent 8deg 20deg);animation:lvRays 30s linear infinite;mask:radial-gradient(circle,#000 0,transparent 55%);-webkit-mask:radial-gradient(circle,#000 0,transparent 55%)}
@keyframes lvRays{to{transform:rotate(360deg)}}
#lv-up .bx{position:relative;display:flex;align-items:flex-end;gap:10px;transform:scale(.8);transition:transform .5s cubic-bezier(.2,1.5,.4,1)}
#lv-up.on .bx{transform:none}
#lv-up .arya{height:min(74vh,560px);filter:drop-shadow(0 0 30px rgba(167,139,250,.45));margin-right:-40px;animation:lvArya .7s cubic-bezier(.2,1.2,.4,1) both}
@keyframes lvArya{from{transform:translateX(-60px);opacity:0}}
#lv-up .card{position:relative;margin-bottom:8vh;padding:26px 40px 20px;border-radius:22px;text-align:center;background:linear-gradient(180deg,rgba(30,27,75,.92),rgba(15,23,42,.92));border:2px solid rgba(167,139,250,.65);box-shadow:0 0 70px rgba(139,92,246,.4),0 30px 80px rgba(0,0,0,.6);min-width:min(420px,80vw)}
#lv-up .k{font:900 18px Orbitron,monospace;letter-spacing:.3em;color:#c4b5fd}
#lv-up .big{font:900 72px Orbitron,monospace;line-height:1.05;background:linear-gradient(180deg,#fff,#c4b5fd 50%,#7c3aed);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 3px 0 rgba(0,0,0,.4))}
#lv-up .from{font:800 16px Orbitron,monospace;color:#94a3b8}
#lv-up .rl{margin-top:14px;display:flex;flex-direction:column;gap:6px;align-items:center}
#lv-up .rl div{font-weight:800;font-size:17px;color:#fef3c7;padding:4px 14px;border-radius:999px;background:rgba(0,0,0,.35);border:1px solid rgba(253,230,138,.3)}
#lv-up .h2{margin-top:12px;font-size:12.5px;color:#94a3b8}
#lv-up .card.tv{width:min(560px,86vw);min-width:0;margin-bottom:0;padding:18px 26px 18px}
#lv-up .card.tv .big{font-size:56px}
#lv-up .scr{position:relative;width:100%;aspect-ratio:16/9;border-radius:12px;overflow:hidden;border:4px solid #0b0820;outline:2px solid #a78bfa;margin-bottom:12px;background:#fff;max-height:42vh}
#lv-up .scr video{width:100%;height:100%;object-fit:cover;display:block}
#lv-up .scr::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(0,0,0,.08) 0 2px,transparent 2px 4px);pointer-events:none}
#lv-up .bx{z-index:1}
#lv-up .px{position:absolute;top:0;z-index:0;width:10px;height:10px;animation:lvPx 2.6s linear infinite;pointer-events:none}
@keyframes lvPx{from{transform:translateY(-12vh)}to{transform:translateY(112vh)}}
@media (max-width:820px){#lv-up .arya{display:none}}`;
    document.head.appendChild(css);

    // ---------- chip no topo ----------
    function ringHtml(lv, frame, inner) { return `<span class="lv-ring f-${frame}">${inner != null ? inner : lv}</span>`; }
    function chip() {
        const ref = document.getElementById('perfil-badge') || document.getElementById('app-version-badge');
        if (!ref) return;
        let b = document.getElementById('lv-chip');
        if (!b) {
            b = document.createElement('button');
            b.id = 'lv-chip'; b.type = 'button';
            b.addEventListener('click', openPanel);
            ref.insertAdjacentElement('afterend', b);
        }
        const li = levelInfo(st.exp), fr = curFrame(li.lv);
        b.innerHTML = `${ringHtml(li.lv, fr)}<span class="tx"><b>Lv ${li.lv}</b><span class="bar"><i style="width:${(li.pct * 100).toFixed(1)}%"></i></span></span>`;
        b.title = `${curTitle(li.lv)} · ${fmt(li.cur)}/${fmt(li.need)} EXP pro Lv ${li.lv + 1}`;
        // moldura também no avatar do perfil
        const av = document.querySelector('#perfil-badge > span');
        if (av) av.style.boxShadow = { bronze: '0 0 0 2px #cd7f32', prata: '0 0 0 2px #cbd5e1', ouro: '0 0 0 2px #facc15, 0 0 8px #facc15', prisma: '0 0 0 2px #a78bfa, 0 0 10px #f472b6', cosmos: '0 0 0 2px #c084fc, 0 0 12px #38bdf8' }[fr] || '';
    }
    window.nivelChip = chip;

    // ---------- tela de resultado: EXP ganha ----------
    function resWidget() {
        const box = document.querySelector('#res-root .res-player');
        if (!box || box.querySelector('.lv-res')) return;
        const g = lastGain && typeof lastRunSummary !== 'undefined' && lastRunSummary && lastRunSummary.run && lastGain.d && lastGain.at > Date.now() - 6 * 3600e3 ? lastGain : null;
        const li = levelInfo(st.exp);
        const el = document.createElement('div');
        el.className = 'lv-res';
        const fr = curFrame(li.lv);
        const av = box.querySelector('span'); if (av) av.style.boxShadow = { bronze: '0 0 0 2px #cd7f32', prata: '0 0 0 2px #cbd5e1', ouro: '0 0 0 2px #facc15', prisma: '0 0 0 2px #a78bfa', cosmos: '0 0 0 2px #c084fc' }[fr] || '';
        if (g) {
            const d = g.d;
            const startPct = g.after.lv > g.before.lv ? 0 : g.before.pct;
            const parts = [`${d.stars}★ base ${d.base}`];
            if (d.durMult > 1.0005) parts.push(`duração ×${d.durMult.toFixed(3).replace('.', ',')}`);
            parts.push(`desempenho ×${d.perf.toFixed(2).replace('.', ',')}`);
            if (d.partial < 1) parts.push(`${d.failed ? 'falhou' : 'trecho'}: ${Math.round(d.progress * 100)}% jogado`);
            if (d.rateMult < 1) parts.push(`velocidade ×${d.rateMult.toFixed(2).replace('.', ',')}`);
            if (d.why) parts.length = 0, parts.push('Sem EXP: ' + d.why);
            else if (d.repeat) parts.push(`já concluída: ×${d.rep.toFixed(2).replace('.', ',')} (bata o recorde por 1 ponto pra ganhar tudo)`);
            else if (d.rep < 1) parts.push(`tentativas hoje ×${d.rep.toFixed(2).replace('.', ',')}`);
            if (d.pb) parts.push('novo recorde: EXP cheia');
            if (d.tipo === 'own') parts.push(`chart seu ×${String(d.own).replace('.', ',')} (estrelas calculadas pelo jogo)`);
            if (d.tipo === 'cloud') parts.push('chart da Nuvem (estrelas calculadas pelo jogo)');
            if (d.capped) parts.push('chegou no limite diário dos seus charts');
            if (d.first > 1) parts.push('1ª conclusão +20%');
            (g.bonus || []).forEach(b => parts.push(`${b.why} +${b.amount}`));
            el.title = parts.join(' · ');
            el.innerHTML = `<div class="r1"><span>Lv ${li.lv}${g.after.lv > g.before.lv ? ' ⬆' : ''}</span><em>+${fmt(g.total)} EXP</em></div>
                <div class="bar"><i style="width:${(startPct * 100).toFixed(1)}%"></i><s style="left:${(startPct * 100).toFixed(1)}%;width:${Math.max(0, (li.pct - startPct) * 100).toFixed(1)}%"></s></div>
                <div class="r2">${d.why ? 'sem EXP: ' + esc(d.why.split(' (')[0]) + ' · ' : d.first > 1 ? '1ª conclusão +20% · ' : d.pb ? 'novo recorde! · ' : d.repeat ? 'já concluída ×0,35 · ' : ''}${(g.bonus || []).length ? 'bônus de desafio · ' : ''}${fmt(li.cur)}/${fmt(li.need)}</div>`;
        } else {
            el.innerHTML = `<div class="r1"><span>Lv ${li.lv}</span></div><div class="bar"><i style="width:${(li.pct * 100).toFixed(1)}%"></i></div><div class="r2">${fmt(li.cur)}/${fmt(li.need)} EXP</div>`;
        }
        el.style.cursor = 'pointer';
        el.addEventListener('click', openPanel);
        box.appendChild(el);
    }
    if (typeof window.resRender === 'function') {
        const origR = window.resRender;
        window.resRender = function () { const o = origR.apply(this, arguments); try { resWidget(); } catch (e) { console.warn('[nivel res]', e); } return o; };
    }

    // ---------- LEVEL UP ----------
    const upQueue = [];
    function levelUp(from, to, ups) {
        upQueue.push({ from, to, ups });
        const tryShow = () => {
            if (!upQueue.length || document.getElementById('lv-up')) return;
            if (document.getElementById('bc-cele') || (typeof isPlaying !== 'undefined' && isPlaying)) { setTimeout(tryShow, 500); return; }
            const q = upQueue.splice(0);
            showLevelUp(q[0].from, q[q.length - 1].to, q.flatMap(x => x.ups));
        };
        setTimeout(tryShow, 1500);
    }
    function showLevelUp(from, to, ups) {
        const lines = [];
        ups.forEach(u => u.r.forEach(x => {
            if (x.kind === 'title') lines.push(`🏷️ Título: <b>${esc(x.name)}</b>`);
            if (x.kind === 'frame') lines.push(`💠 Moldura: <b>${esc(x.name)}</b>`);
        }));
        const coins = ups.reduce((a, u) => a + u.r.filter(x => x.kind === 'coins').reduce((s, x) => s + x.n, 0), 0);
        if (coins) lines.push(`<span class="bc-coin"></span> +${coins} Beatcoins`);
        const el = document.createElement('div');
        el.id = 'lv-up';
        // Arya 8-bit comemorando numa telinha no topo do cartão (se o vídeo não carregar, volta a Arya de sempre)
        el.innerHTML = `<div class="rays"></div><div class="bx"><img class="arya" src="assets/arya-lvup.webp" alt="" style="display:none">
            <div class="card tv"><div class="scr"><video autoplay muted loop playsinline preload="auto"><source src="assets/arya8-lvup.mp4" type="video/mp4"><source src="assets/arya8-lvup.webm" type="video/webm"></video></div><div class="k">LEVEL UP!</div><div class="big">Lv ${to}</div>
              <div class="from">Lv ${from} → Lv ${to}${to >= 100 && from < 100 ? ' · LENDA!' : ''}</div>
              ${lines.length ? `<div class="rl">${lines.map(l => `<div>${l}</div>`).join('')}</div>` : ''}
              <div class="h2">Enter · Esc · clique para continuar</div></div></div>`;
        document.body.appendChild(el);
        ['#f472b6', '#22d3ee', '#fde047', '#4ade80', '#a78bfa'].forEach((c, i) => { for (let j = 0; j < 8; j++) { const d = document.createElement('i'); d.className = 'px'; d.style.cssText = `left:${Math.random() * 100}vw;background:${c};animation-delay:${-Math.random() * 2.6}s;animation-duration:${2.2 + Math.random()}s`; el.appendChild(d); } });
        const vd = el.querySelector('video');
        const semVideo = () => { const sc = el.querySelector('.scr'); if (sc) sc.remove(); el.querySelector('.card').classList.remove('tv'); el.querySelector('.arya').style.display = ''; };
        if (vd) { vd.lastElementChild.addEventListener('error', semVideo); const p = vd.play(); if (p && p.catch) p.catch(() => {}); }
        lvSfx();
        let closed = false;
        const end = () => { if (closed) return; closed = true; document.removeEventListener('keydown', key, true); el.classList.remove('on'); setTimeout(() => el.remove(), 360); };
        const key = (e) => { e.preventDefault(); e.stopImmediatePropagation(); if (['Enter', 'Escape', ' ', 'NumpadEnter'].includes(e.key) && !e.repeat) end(); };
        document.addEventListener('keydown', key, true);
        el.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); end(); });
        requestAnimationFrame(() => el.classList.add('on'));
        setTimeout(end, 12000);
    }
    function lvSfx() {
        try {
            const A = typeof audio !== 'undefined' ? audio : null;
            const ctx = (A && A.ctx) || lvSfx.c || (lvSfx.c = new (window.AudioContext || window.webkitAudioContext)());
            if (ctx.state === 'suspended') ctx.resume();
            const vol = ((A && A.volume != null) ? A.volume : 0.7) * 0.14, t = ctx.currentTime;
            [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
                const o = ctx.createOscillator(), g = ctx.createGain(), t0 = t + i * 0.09;
                o.type = 'triangle'; o.frequency.value = f;
                g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + (i === 3 ? 0.7 : 0.25));
                o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + 0.8);
            });
        } catch (e) {}
    }
    function lvToast(html) {
        const t = document.createElement('div');
        t.style.cssText = 'position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:190;padding:8px 18px;border-radius:999px;background:linear-gradient(90deg,#4c1d95,#0e7490);border:1px solid #c4b5fd;color:#fff;font:800 16px Rajdhani,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5);pointer-events:none;transition:opacity .4s';
        t.innerHTML = html; document.body.appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 450); }, 2600);
    }
    window.nivelTesteLevelUp = () => showLevelUp(9, 10, [{ L: 10, r: rewardsAt(10) }]);

    // ---------- painel do nível ----------
    function openPanel() {
        load();
        const still = !!document.getElementById('lv-ov');
        document.getElementById('lv-ov')?.remove();
        const li = levelInfo(st.exp), fr = curFrame(li.lv), tt = curTitle(li.lv);
        const ov = document.createElement('div');
        ov.id = 'lv-ov';
        // próximos marcos (e os últimos conquistados)
        const marks = [];
        for (let L = 5; marks.length < 9 && L <= 400; L += 5) if (L > li.lv - 10) marks.push(L);
        const nm = (window.perfis && perfis.active && perfis.active.name) || 'Jogador';
        const titles = titlesUnlocked(li.lv);
        ov.innerHTML = `<div class="bx">
            <h2>⭐ NÍVEL</h2>
            <div class="hero">${ringHtml(li.lv, fr, `<span style="font-size:10px;color:#94a3b8">Lv</span><b>${li.lv}</b>`)}
              <div style="flex:1;min-width:0"><div class="nm">${esc(nm)}</div><div class="tt">${esc(tt)}</div>
                <div class="bigbar"><i style="width:${(li.pct * 100).toFixed(1)}%"></i></div>
                <div class="dd"><b>${fmt(li.cur)}</b> / ${fmt(li.need)} EXP pro Lv ${li.lv + 1} · faltam <b>${fmt(li.need - li.cur)}</b> · EXP total <b>${fmt(st.exp)}</b></div></div></div>
            <div class="cols">
              <div class="card"><div class="h">RECOMPENSAS</div>
                ${marks.map(L => {
                    const r = rewardsAt(L), got = L <= li.lv, nxt = !got && L - 5 < li.lv + 0.5 && L > li.lv;
                    return `<div class="rw${got ? ' got' : ''}${nxt ? ' next' : ''}"><span class="l">${got ? '✔ ' : ''}Lv ${L}</span><span>${r.map(x => x.kind === 'coins' ? `<span class="pill"><span class="bc-coin"></span>${x.n}</span>` : x.kind === 'title' ? `<span class="pill" style="border-color:#a16207;color:#fde68a">🏷️ ${esc(x.name)}</span>` : `<span class="pill" style="border-color:#7c3aed;color:#c4b5fd">💠 ${esc(x.name)}</span>`).join('')}</span></div>`;
                }).join('')}
                <div class="dd" style="margin-top:8px">Lv 100: título <b>Lenda BEATMAX</b> + moldura <b>Prisma</b>. Depois do 100 o nível continua (bem mais difícil), com novos títulos a cada 10.</div>
              </div>
              <div class="card"><div class="h">SEU VISUAL</div>
                <div class="dd" style="margin-bottom:6px">Título</div>
                <select id="lv-title">${titles.map(x => `<option ${x.t === tt ? 'selected' : ''}>${esc(x.t)}</option>`).join('')}</select>
                <div class="dd" style="margin:12px 0 6px">Moldura</div>
                <div class="frames">${Object.entries(FRAMES).map(([id, f]) => `<button data-fr="${id}" class="${id === fr ? 'on' : ''}" ${f.lv <= li.lv ? '' : 'disabled'} title="${f.lv <= li.lv ? '' : 'Libera no Lv ' + f.lv}">${ringHtml(li.lv, id)}<span>${esc(f.name.replace(/ \(.*\)/, ''))}${f.lv > li.lv ? ' 🔒' : ''}</span></button>`).join('')}</div>
                <div class="h" style="margin-top:14px">ÚLTIMOS GANHOS</div>
                ${(st.log || []).slice(0, 8).map(x => `<div class="lg"><span>${esc(x.t || '—')}</span><b>+${fmt(x.exp + (x.bonus || []).reduce((a, b) => a + b.amount, 0))}</b></div>`).join('') || '<div class="dd">Jogue uma música pra ganhar EXP!</div>'}
              </div>
            </div>
            <div class="card" style="margin-top:16px"><div class="h">COMO GANHAR EXP</div>
              <div class="dd">Cada música concluída dá <b>45 + 27 × estrelas</b> (1★ = 72 · 7★ = 234 · 15★ = 450; nos treinos NORMAL=3★, HARD=6★, EXPERT=9★, MASTER=12★).
              Músicas longas ganham até <b>+10%</b> (10 min). Desempenho: abaixo de 70% ×0,70 · 70% ×0,80 · 80% ×0,90 · 90% ×1,00 · 95% ×1,05 · 98% ×1,10 · <b>100% ×1,15</b>.
              <b>1ª conclusão</b> de um chart: EXP cheia +20%. Depois disso o chart rende só <b>35%</b> — a não ser que você <b>bata o recorde</b> por pelo menos 1 ponto (ou suba de nota): aí ganha a EXP cheia de novo (até 2 vezes por dia). Variar as músicas compensa!
              Não dão EXP: músicas com menos de <b>30 segundos</b> ou 30 notas e a calibração.
              <b>Charts do editor</b> (seus, editados ou importados de arquivo) e <b>da Nuvem</b>: precisam de 60 s e 100 notas, e as estrelas são <b>calculadas pelo jogo</b> (marcar 15★ não adianta). Os seus rendem <b>50%</b>, sem o bônus de 1ª conclusão, até <b>1.500 EXP por dia</b>; os de outros jogadores pela Nuvem rendem normal.
              Falhou (HP zerou) ou treino de trecho: só a parte jogada, e sempre menos que concluir. Música mais lenta que 100% rende proporcionalmente menos.
              Desafio do dia <b>+250 EXP</b> · cada desafio semanal <b>+500 EXP</b>.</div></div>
            <div class="row"><button class="x" data-x>Fechar</button></div></div>`;
        document.body.appendChild(ov);
        if (typeof window.beatmaxPersonagem === 'function') {
            let nx = li.lv + 1; while (!rewardsAt(nx).length && nx < li.lv + 20) nx++;
            const r = rewardsAt(nx), t = r.find(x => x.kind === 'title'), f = r.find(x => x.kind === 'frame');
            const premio = f ? 'a moldura ' + esc(f.name.replace(/ \(.*\)/, '')) : t ? 'o título ' + esc(t.name) : 'Beatcoins';
            const pct = Math.round(li.pct * 100);
            const fala = window.beatmaxFala ? window.beatmaxFala : (k, l) => l[0];
            window.beatmaxPersonagem(ov, 'echo', fala('echo', [
                `Faltam <b>${fmt(li.need - li.cur)} EXP</b> pro Lv ${li.lv + 1}. No <b>Lv ${nx}</b> você ganha ${premio}.`,
                `Análise: <b>${pct}%</b> do Lv ${li.lv} concluído. Próxima recompensa: <b>Lv ${nx}</b>.`,
                st.exp > 0 ? `Dado curioso: você já juntou <b>${fmt(st.exp)} EXP</b>. Variar as músicas rende mais.` : 'Ainda sem EXP? Qualquer música concluída já conta. Vamos começar!',
                `Primeira conclusão de um chart vale <b>+20%</b>. Recomendo testar músicas novas.`,
                `Desafio do dia <b>+250 EXP</b>, semanal <b>+500</b>. É o caminho mais rápido pro Lv ${nx}.`
            ]), '980px', !!still);
        }
        const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
        const onKey = (e) => { if (!document.getElementById('lv-ov')) return; if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); close(); } else if (!['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.stopImmediatePropagation(); };
        document.addEventListener('keydown', onKey, true);
        ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
        ov.querySelector('[data-x]').onclick = close;
        ov.querySelector('#lv-title').onchange = (e) => { st.title = e.target.value; save(); chip(); };
        ov.querySelectorAll('[data-fr]').forEach(b => b.onclick = () => { st.frame = b.dataset.fr; save(); chip(); openPanel(); });
    }
    window.openNivel = openPanel;
    window.nivelInfo = () => { const li = levelInfo(st.exp); return { lv: li.lv, exp: st.exp, title: curTitle(li.lv), frame: curFrame(li.lv) }; };
    window.nivelCalc = { need, levelInfo, computeExp, perfMult };

    document.addEventListener('DOMContentLoaded', () => setTimeout(chip, 60));
    window.addEventListener('load', () => setTimeout(chip, 80));
})();
