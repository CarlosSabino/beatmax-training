// =====================================================================================
// resultado.js — tela de conclusão no estilo "resultado do DJMAX" (design próprio).
//
//  esquerda : detalhes do julgamento (MAX 100% … MAX 1%, BREAK), efeitos (speed, mods) e skin
//  centro   : emblema do rank com o anel (MAX 100% / MAX 1~90% / BREAK), precisão, pontuação
//  direita  : recorde + últimas partidas, timing (FAST/SLOW e ajuste), pontos fracos (treinar o
//             trecho em loop) e replays
//  rodapé   : F5 recomeçar · R replay · D análise detalhada · Enter OK
//
// Nada da análise antiga se perde: o painel de antes continua inteiro na aba "Análise
// detalhada" (tecla D) — mapa da música, precisão por lane, gráfico de timing, escada de BPM.
// Os botões daqui só "apertam" os de lá, então tudo o que já existia continua funcionando.
// =====================================================================================
const RES_STEPS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 1];
const res = { view: 'main', el: null };

function resEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function resStepColor(p) {
    if (p === 100) return '#facc15';
    if (p >= 70) return '#f5b941';
    if (p >= 40) return '#f59e8b';
    if (p >= 10) return '#f472b6';
    return '#e879f9';
}

function resEnsure() {
    const ov = document.getElementById('stats-overlay');
    if (!ov) return null;
    if (res.el && ov.contains(res.el)) return res.el;
    const css = document.createElement('style');
    css.textContent = `
#stats-overlay.res-on{padding:0!important;align-items:stretch!important;justify-content:stretch!important;background:radial-gradient(ellipse at 50% 40%,#1b2133 0%,#0b0f1a 55%,#05070d 100%)!important}
#stats-overlay.res-on>div:not(#res-root){display:none}
#stats-overlay.res-on.res-detail>div:not(#res-root){display:flex;position:relative;z-index:2;margin:118px auto 70px;max-height:calc(100% - 196px)}
#stats-overlay.res-on.res-detail #res-root{pointer-events:none}
#stats-overlay.res-on.res-detail #res-root .res-top,#stats-overlay.res-on.res-detail #res-root .res-foot{pointer-events:auto}
#stats-overlay.res-on.res-detail #res-root .res-body{visibility:hidden}
#res-root{position:absolute;inset:0;display:flex;flex-direction:column;color:#e5e7eb;font-family:Rajdhani,'Barlow Condensed',sans-serif;overflow:hidden}
#res-root .res-top{display:flex;align-items:center;gap:18px;padding:12px 28px;background:linear-gradient(90deg,rgba(30,41,59,.9),rgba(15,23,42,.6) 60%,rgba(76,29,149,.35));border-bottom:1px solid rgba(148,163,184,.15);flex-shrink:0}
#res-root .res-mode{display:flex;align-items:center;gap:8px;padding-left:12px;border-left:4px solid #818cf8}
#res-root .res-mode b{font:900 52px/1 Orbitron,monospace;color:#fff}
#res-root .res-mode span{font:700 18px/1.05 Rajdhani,sans-serif;color:#cbd5e1;letter-spacing:.06em}
#res-root .res-song{flex:1;min-width:0;text-align:center}
#res-root .res-song .t{font-weight:800;font-size:22px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#res-root .res-song .s{font-size:14px;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#res-root .res-diff{display:inline-block;margin-top:3px;padding:0 8px;border:2px solid #f43f5e;color:#fda4af;font:800 13px Orbitron,monospace;border-radius:4px}
#res-root .res-player{display:flex;align-items:center;gap:8px;padding:6px 12px;border:1px solid #334155;border-radius:10px;background:rgba(15,23,42,.7);font-weight:700}
#res-root .res-body{flex:1;display:grid;grid-template-columns:minmax(260px,24%) 1fr minmax(280px,26%);gap:28px;padding:22px 36px 10px;min-height:0;overflow:auto}
#res-root .res-card{background:rgba(30,41,59,.55);border:1px solid rgba(148,163,184,.12);border-radius:6px;padding:16px 22px}
#res-root .res-h{font-weight:800;font-size:19px;color:#cbd5e1;letter-spacing:.03em;border-bottom:1px solid rgba(148,163,184,.25);padding-bottom:4px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:baseline}
#res-root .res-row{display:flex;justify-content:space-between;font-weight:800;font-size:19px;line-height:1.38}
#res-root .res-row.dim{opacity:.4}
#res-root .res-center{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:0}
#res-root .res-emblem{position:relative;width:min(36vh,330px);aspect-ratio:1}
#res-root .res-emblem svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
#res-root .res-spin{transform-origin:50% 50%;animation:resSpin 18s linear infinite}
@keyframes resSpin{to{transform:rotate(360deg)}}
#res-root .res-tag{position:absolute;text-align:right;font-weight:900;line-height:1;white-space:nowrap}
#res-root .res-tag b{display:block;font-size:34px}
#res-root .res-tag i{display:inline-block;font-style:normal;font-size:15px;padding:2px 8px;color:#fff;clip-path:polygon(8px 0,100% 0,100% 100%,0 100%)}
#res-root .res-acc{font:800 34px Rajdhani,sans-serif;color:#fff;margin-top:6px}
#res-root .res-score-l{display:inline-block;padding:1px 22px 1px 10px;background:#475569;color:#fff;font-weight:800;font-size:17px;clip-path:polygon(0 0,85% 0,100% 100%,0 100%)}
#res-root .res-score{font:300 clamp(56px,9vh,96px)/1 'Barlow Condensed',Rajdhani,sans-serif;color:#fff;letter-spacing:.02em}
#res-root .res-badge{margin-top:8px;padding:3px 14px;border-radius:4px;font:900 15px Orbitron,monospace;letter-spacing:.08em}
#res-root .res-spd{width:66px;height:66px;border-radius:8px;background:linear-gradient(180deg,#e11d48,#9f1239);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;box-shadow:inset 0 0 0 2px rgba(255,255,255,.15)}
#res-root .res-spd small{font:700 9px Orbitron,monospace;letter-spacing:.25em;opacity:.85}
#res-root .res-spd b{font:800 26px/1 'Barlow Condensed',sans-serif}
#res-root .res-chip{padding:3px 8px;border-radius:5px;border:1px solid #475569;background:rgba(15,23,42,.6);font-weight:700;font-size:13px;color:#e2e8f0}
#res-root .res-btn{padding:5px 12px;border-radius:6px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;font-weight:700;font-size:13px;cursor:pointer}
#res-root .res-btn:hover{background:#334155}
#res-root .res-btn.pk{border-color:#ec4899;background:rgba(236,72,153,.18);color:#fbcfe8}
#res-root .res-btn.cy{border-color:#22d3ee;background:rgba(34,211,238,.15);color:#a5f3fc}
#res-root .res-weak{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px dashed rgba(148,163,184,.15);font-weight:700;font-size:15px}
#res-root .res-foot{display:flex;justify-content:flex-end;align-items:center;gap:26px;padding:10px 36px 14px;border-top:1px solid rgba(148,163,184,.12);flex-shrink:0;font-weight:800;font-size:16px}
#res-root .res-foot button{display:flex;align-items:center;gap:8px;background:none;border:0;color:#e5e7eb;font:inherit;cursor:pointer}
#res-root .res-foot button:hover{color:#fff}
#res-root .res-foot kbd{display:inline-block;min-width:26px;padding:1px 5px;border-radius:3px;background:#e5e7eb;color:#111827;font:800 11px Rajdhani,sans-serif;text-align:center}
#res-root .res-detail-btn.on{color:#67e8f9}
@media (max-height:860px){#res-root .res-row{font-size:15px;line-height:1.28}#res-root .res-card{padding:10px 16px}#res-root .res-h{font-size:16px;margin-bottom:5px}
#res-root .res-emblem{width:min(31vh,300px)}#res-root .res-score{font-size:clamp(44px,8vh,80px)}#res-root .res-acc{font-size:28px}#res-root .res-body{padding:14px 28px 8px;gap:20px}
#res-root .res-top{padding:8px 24px}#res-root .res-mode b{font-size:40px}#res-root .res-tag b{font-size:26px}#res-root .res-spd{width:54px;height:54px}#res-root .res-spd b{font-size:21px}
#stats-overlay.res-on.res-detail>div:not(#res-root){margin:92px auto 60px;max-height:calc(100% - 160px)}}
@media (max-width:1100px){#res-root .res-body{grid-template-columns:1fr;padding:16px}}
`;
    document.head.appendChild(css);
    const root = document.createElement('div');
    root.id = 'res-root';
    ov.appendChild(root);
    res.el = root;
    return root;
}

function resJudgeCounts() {
    const results = typeof noteResultsFrom === 'function' && lastRunSummary ? noteResultsFrom(lastRunSummary.events) : [];
    const counts = new Map(RES_STEPS.map(s => [s, 0]));
    let brk = 0;
    if (results.length) {
        results.forEach(r => {
            if (r.b || !r.p) { brk++; return; }
            const step = RES_STEPS.find(s => r.p >= s) || 1;
            counts.set(step, counts.get(step) + 1);
        });
    } else if (typeof stats !== 'undefined') { // sem eventos (partida antiga): usa o resumo
        counts.set(100, stats.judgments.max100); counts.set(90, stats.judgments.max90); brk = stats.judgments.break;
    }
    return { counts, brk, total: results.length };
}

function resModsText() {
    const out = [];
    const nm = (id, v) => { const o = document.querySelector(`#${id} option[value="${v}"]`); return o ? o.textContent : v; };
    if (typeof randomMod !== 'undefined' && randomMod !== 'none') out.push(nm('mod-random', randomMod));
    if (typeof speedMod !== 'undefined' && speedMod !== 'none') out.push(nm('mod-speed', speedMod));
    if (typeof faderMod !== 'undefined' && faderMod !== 'none') out.push(nm('mod-fader', faderMod));
    if (typeof coverMod !== 'undefined' && coverMod !== 'none') out.push(nm('mod-cover', coverMod));
    if (typeof gameRate === 'number' && Math.abs(gameRate - 1) > 0.001) out.push(`Música ${Math.round(gameRate * 100)}%`);
    if (typeof noFailMode !== 'undefined' && noFailMode) out.push('No Fail');
    return out;
}

// emblema: letra do rank + anel dividido (MAX 100% / MAX 1~90% / BREAK)
function resEmblemSvg(acc, c100, cMid, brk) {
    const total = Math.max(1, c100 + cMid + brk);
    const R = 44, C = 2 * Math.PI * R;
    const segs = [[c100, '#fbbf24'], [cMid, '#ec4899'], [brk, '#ef4444']];
    let off = 0;
    const arcs = segs.map(([n, col]) => {
        const len = C * n / total;
        const a = `<circle cx="50" cy="50" r="${R}" fill="none" stroke="${col}" stroke-width="5.5" stroke-dasharray="${Math.max(0, len - (n && len > 1.5 ? 0.8 : 0)).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 50 50)"/>`;
        off += len;
        return n ? a : '';
    }).join('');
    const letter = acc >= 100 ? 'P' : acc >= 97 ? 'S' : acc >= 90 ? 'A' : acc >= 80 ? 'B' : 'C';
    const grad = { P: ['#a5f3fc', '#22d3ee'], S: ['#fde68a', '#f59e0b'], A: ['#fde047', '#f59e0b'], B: ['#c4b5fd', '#8b5cf6'], C: ['#cbd5e1', '#64748b'] }[letter];
    return `<svg viewBox="0 0 100 100">
      <defs><linearGradient id="resG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${grad[0]}"/><stop offset="1" stop-color="${grad[1]}"/></linearGradient>
      <radialGradient id="resGlow"><stop offset="0" stop-color="${grad[1]}" stop-opacity=".35"/><stop offset="1" stop-color="${grad[1]}" stop-opacity="0"/></radialGradient></defs>
      <circle cx="50" cy="50" r="49" fill="url(#resGlow)"/>
      <circle cx="50" cy="50" r="${R}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="5.5"/>
      ${arcs}
      <g class="res-spin"><path d="M50 2 L52 48 L98 50 L52 52 L50 98 L48 52 L2 50 L48 48 Z" fill="${grad[0]}" opacity=".18"/></g>
      <text x="50" y="${letter === 'P' ? 63 : 66}" text-anchor="middle" font-family="Orbitron,monospace" font-weight="900" font-size="${letter === 'P' ? 30 : 46}" fill="url(#resG)" stroke="#0b0f1a" stroke-width="1.2" paint-order="stroke">${letter === 'P' ? 'PERFECT' : letter}</text>
    </svg>`;
}

function resRender() {
    const root = resEnsure();
    if (!root || typeof stats === 'undefined') return;
    const ov = document.getElementById('stats-overlay');
    ov.classList.add('res-on');
    ov.classList.toggle('res-detail', res.view === 'detail');
    const sum = typeof lastRunSummary !== 'undefined' ? lastRunSummary : null;
    const run = sum && sum.run;
    const acc = totalPossibleScore > 0 ? Math.min(100, currentEarnedScore / totalPossibleScore * 100) : 0;
    const score = totalPossibleScore > 0 ? Math.max(0, Math.round(1e6 * currentEarnedScore / totalPossibleScore)) : 0;
    const { counts, brk } = resJudgeCounts();
    const c100 = counts.get(100), cMid = RES_STEPS.filter(s => s !== 100).reduce((a, s) => a + counts.get(s), 0);
    const si = typeof songInfoFor === 'function' ? songInfoFor(currentPatternType) : { title: '' };
    const mainLanes = parseInt(currentMode, 10) || 4; // 4B/5B/6B/8B (o 8B conta as TRACK L/R)
    const failed = !!(run && run.failed);
    const perf = acc >= 100, mc = !failed && brk === 0;
    const badge = failed ? ['FAILED', '#7f1d1d', '#fecaca'] : perf ? ['★ PERFECT PLAY ★', 'rgba(34,211,238,.18)', '#a5f3fc'] : mc ? ['◆ MAX COMBO ◆', 'rgba(245,158,11,.18)', '#fde68a'] : null;
    const isRec = sum && sum.isRecord;
    const prof = typeof perfis !== 'undefined' ? perfis.active : null;
    const gearName = (typeof GEAR_THEMES !== 'undefined' && GEAR_THEMES[gearSkin] && GEAR_THEMES[gearSkin].label) || (document.querySelector(`#main-gear-skin option[value="${gearSkin}"]`) || {}).textContent || gearSkin;
    const noteName = (document.querySelector(`#main-note-shape option[value="${noteShape}"]`) || {}).textContent || noteShape;
    const mods = resModsText();

    // recorde + últimas partidas deste treino/modo/dificuldade
    let recHtml = '<div style="color:#94a3b8;font-weight:700">—</div>';
    if (run) {
        const prev = sum.prevBest;
        if (failed) recHtml = '<div style="color:#fca5a5;font-weight:700">Partida não concluída — não conta como recorde.</div>';
        else if (!sum.countsForRecord) recHtml = `<div style="color:#cbd5e1;font-weight:700">${run.section ? 'Treino de trecho' : `Música a ${Math.round(run.rate * 100)}%`} — recorde só conta a 100% e com a música inteira.</div>`;
        else if (isRec) recHtml = `<div style="font:900 22px Orbitron,monospace;color:#fbbf24">NOVO RECORDE!</div><div style="color:#cbd5e1;font-weight:700">${prev ? `antes ${fmtPct(prev.acc)} · <span style="color:#86efac">+${(run.acc - prev.acc).toFixed(2)}%</span>` : 'primeira vez aqui'}</div>`;
        else if (prev) recHtml = `<div style="display:flex;justify-content:space-between;font-weight:800;font-size:20px"><span style="color:#cbd5e1">Recorde</span><span style="color:#fde68a">${fmtPct(prev.acc)}</span></div><div style="color:#94a3b8;font-weight:700">faltou ${(prev.acc - run.acc).toFixed(2)}% · ${fmtDate(prev.at)}</div>`;
        const key = typeof recordKey === 'function' ? recordKey(run) : '';
        const last = (typeof runHistory !== 'undefined' ? runHistory : []).filter(r => recordKey(r) === key && !r.section).slice(-8);
        if (last.length >= 2) {
            const w = 220, h = 40, lo = Math.min(...last.map(r => r.acc)) - 1, hi = Math.max(...last.map(r => r.acc)) + 1;
            const pts = last.map((r, i) => `${(i / (last.length - 1) * w).toFixed(1)},${(h - (r.acc - lo) / Math.max(0.5, hi - lo) * h).toFixed(1)}`).join(' ');
            recHtml += `<div style="margin-top:6px;color:#94a3b8;font-size:12px;font-weight:700">ÚLTIMAS ${last.length} PARTIDAS</div>
              <svg viewBox="-4 -4 ${w + 8} ${h + 8}" style="width:100%;height:48px"><polyline points="${pts}" fill="none" stroke="#22d3ee" stroke-width="2"/>${last.map((r, i) => `<circle cx="${(i / (last.length - 1) * w).toFixed(1)}" cy="${(h - (r.acc - lo) / Math.max(0.5, hi - lo) * h).toFixed(1)}" r="${i === last.length - 1 ? 4 : 2.5}" fill="${r.failed ? '#ef4444' : i === last.length - 1 ? '#fde68a' : '#22d3ee'}"/>`).join('')}</svg>`;
        }
    }

    // timing
    const early = stats.earlyHits || 0, late = stats.lateHits || 0, tot = Math.max(1, early + late);
    const meanText = (document.getElementById('timing-mean-text') || {}).innerText || '';
    const applyBtn = document.getElementById('btn-apply-judge-offset');
    const canApply = applyBtn && !applyBtn.classList.contains('hidden');
    const undoBtn = document.getElementById('btn-calib-undo');
    const canUndo = undoBtn && !undoBtn.classList.contains('hidden');

    // pontos fracos (trechos com pior precisão)
    const segs = (sum && sum.segs) || [];
    const weak = segs.map((s, i) => ({ s, i })).filter(x => x.s.n >= 3 && x.s.acc != null && x.s.acc < 99.5).sort((a, b) => a.s.acc - b.s.acc).slice(0, 3);
    const weakHtml = weak.length ? weak.map(x => `<div class="res-weak"><span>${fmtClock(x.s.from - 2000)}–${fmtClock(x.s.to - 2000)} <span style="color:${accColor(x.s.acc)}">${fmtPct(x.s.acc)}</span>${x.s.brk ? ` <span style="color:#f87171">· ${x.s.brk} break</span>` : ''}</span><button class="res-btn pk" data-weak="${x.i}">Treinar em loop</button></div>`).join('')
        : `<div style="color:#86efac;font-weight:700">${segs.length ? 'Nenhum trecho fraco — tudo acima de 99,5%!' : '—'}</div>`;

    const showReplay = !!document.querySelector('#replay-bar button');
    // escada de BPM: os botões dela (avançar/repetir/encerrar) aparecem aqui também
    const lad = document.getElementById('ladder-box');
    const ladHtml = lad ? `<div class="res-card" style="border-color:${document.getElementById('btn-ladder-next') ? '#10b981' : '#f59e0b'}"><div class="res-h">ESCADA DE BPM</div>
        <div style="font-weight:700;font-size:14px;color:#e2e8f0">${resEsc((lad.querySelector('span') || lad).textContent)}</div>
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${['btn-ladder-next', 'btn-ladder-retry', 'btn-ladder-stop'].filter(id => document.getElementById(id)).map(id => `<button class="res-btn ${id === 'btn-ladder-stop' ? '' : 'cy'}" data-click="${id}">${resEsc(document.getElementById(id).textContent)}</button>`).join('')}</div></div>` : '';

    root.innerHTML = `
      <div class="res-top">
        <div class="res-mode"><b>${mainLanes}</b><span>BUTTON${String(currentPatternType || '').startsWith('custom:') ? '' : '<br>' + resEsc(drillDiffLabel(currentDifficulty))}</span></div>
        <div class="res-song"><div class="t">${resEsc(si.title || '')}</div><div class="s">${resEsc([si.sub, si.version].filter(Boolean).join(' · ') || si.meta || '')}</div>
          ${(() => { const ch = String(currentPatternType || '').startsWith('custom:') && typeof findCustomChart === 'function' ? findCustomChart(currentPatternType.slice(7)) : null;
              if (ch && typeof chartDifficulty === 'function') { const d = chartDifficulty(ch), t = DIFF_BY_ID[d.tier]; return `<span class="res-diff" style="background:${t.color};color:#020617">${t.name} ${d.auto ? '≈' : ''}${d.level}</span>`; }
              return `<span class="res-diff">${drillDiffLabel(currentDifficulty)}</span>`; })()}</div>
        ${prof ? `<div class="res-player"><span style="width:26px;height:26px;border-radius:50%;border:2px solid ${prof.color};color:${prof.color};display:flex;align-items:center;justify-content:center;font:900 12px Orbitron,monospace">${resEsc((prof.name || '?').charAt(0).toUpperCase())}</span>${resEsc(prof.name)}</div>` : ''}
      </div>
      <div class="res-body">
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="res-card">
            <div class="res-h">DETALHES DO JULGAMENTO</div>
            ${RES_STEPS.map(s => `<div class="res-row ${counts.get(s) ? '' : 'dim'}" style="color:${resStepColor(s)}"><span>MAX ${s}%</span><span>${counts.get(s)}</span></div>`).join('')}
            <div class="res-row ${brk ? '' : 'dim'}" style="color:#dc2626"><span>BREAK</span><span>${brk}</span></div>
          </div>
          <div class="res-card">
            <div class="res-h">EFEITOS</div>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
              <div class="res-spd"><small>SPEED</small><b>${Number(scrollSpeed).toFixed(1)}</b></div>
              ${mods.length ? mods.map(m => `<span class="res-chip">${resEsc(m)}</span>`).join('') : '<span style="color:#64748b;font-weight:700">sem modificadores</span>'}
            </div>
            <div class="res-h" style="margin-top:12px">SKIN</div>
            <div style="display:flex;gap:16px;font-weight:700;color:#cbd5e1"><span><small style="color:#64748b">GEAR</small><br>${resEsc(gearName)}</span><span><small style="color:#64748b">NOTA</small><br>${resEsc(noteName)}</span></div>
          </div>
        </div>
        <div class="res-center">
          <div class="res-emblem">
            ${resEmblemSvg(acc, c100, cMid, brk)}
            <div class="res-tag" style="left:-34%;top:40%;color:#facc15"><b>${c100}</b><i style="background:#a16207">MAX 100%</i></div>
            <div class="res-tag" style="right:-36%;top:40%;color:#f472b6;text-align:left"><b>${cMid}</b><i style="background:#9d174d">MAX 1~90%</i></div>
            <div class="res-tag" style="right:-6%;top:-6%;color:#ef4444"><b>${brk}</b><i style="background:#7f1d1d">BREAK</i></div>
            <div class="res-tag" style="right:-34%;bottom:4%;color:#fde047"><b>${stats.maxCombo || 0}</b><i style="background:#854d0e">MAX COMBO</i></div>
          </div>
          <div class="res-acc">${acc.toFixed(2).replace('.', ',')}%</div>
          ${badge ? `<div class="res-badge" style="background:${badge[1]};color:${badge[2]};border:1px solid ${badge[2]}">${badge[0]}</div>` : ''}
          <div style="height:10px"></div>
          <div style="display:flex;flex-direction:column;align-items:flex-start"><div class="res-score-l">SCORE</div><div class="res-score">${score}</div></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px">
          ${ladHtml}
          <div class="res-card"><div class="res-h">RECORDE</div>${recHtml}</div>
          <div class="res-card">
            <div class="res-h"><span>TIMING</span><span style="font-size:13px;color:#94a3b8">FAST ${early} · SLOW ${late}</span></div>
            <div style="display:flex;height:9px;border-radius:9px;overflow:hidden;background:#0f172a"><div style="width:${early / tot * 100}%;background:#f59e0b"></div><div style="width:${late / tot * 100}%;background:#a855f7"></div></div>
            <div style="font-size:13px;color:#cbd5e1;margin-top:6px;font-weight:600;line-height:1.3">${resEsc(meanText)}</div>
            ${(() => { const f = typeof fluidezResumo === 'function' ? fluidezResumo() : null; const a = typeof audioSaidaInfo === 'function' ? audioSaidaInfo() : null;
                return (f ? `<div style="font-size:12.5px;margin-top:5px;font-weight:700;color:${f.level === 'ok' ? '#86efac' : f.level === 'warn' ? '#fde68a' : '#fca5a5'}" title="Travada = quadro que demorou bem mais que o normal (o jogo engasgou). Muitas travadas atrapalham a sincronia: feche outros programas/abas ou desligue o vídeo de fundo.">${resEsc(f.text)}</div>` : '')
                    + (a && a.slow ? `<div style="font-size:12px;margin-top:3px;color:#fbbf24;font-weight:700">🎧 Saída de áudio: ${a.ms}ms (Bluetooth?)</div>` : ''); })()}
            ${canApply || canUndo ? `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${canApply ? `<button class="res-btn cy" data-act="apply">${resEsc(applyBtn.textContent.trim())}</button>` : ''}${canUndo ? '<button class="res-btn" data-act="undo">Desfazer calibração</button>' : ''}</div>` : ''}
          </div>
          <div class="res-card"><div class="res-h">PONTOS FRACOS</div>${weakHtml}</div>
        </div>
      </div>
      <div class="res-foot">
        <button data-act="retry"><kbd>F5</kbd>RECOMEÇAR</button>
        ${showReplay ? '<button data-act="replay"><kbd>R</kbd>REPLAY</button>' : ''}
        <button data-act="detail" class="res-detail-btn ${res.view === 'detail' ? 'on' : ''}"><kbd>D</kbd>${res.view === 'detail' ? 'VOLTAR AO RESUMO' : 'ANÁLISE DETALHADA'}</button>
        <button data-act="ok"><kbd>⏎</kbd>OK</button>
      </div>`;
    root.querySelectorAll('[data-act]').forEach(b => b.onclick = () => resAct(b.dataset.act));
    root.querySelectorAll('[data-click]').forEach(b => b.onclick = () => { document.getElementById(b.dataset.click)?.click(); setTimeout(resRender, 50); });
    root.querySelectorAll('[data-weak]').forEach(b => b.onclick = () => {
        resultSelection = { a: +b.dataset.weak, b: +b.dataset.weak };
        if (typeof drawSegmentMap === 'function') drawSegmentMap();
        document.getElementById('btn-train-section')?.click();
    });
}

function resAct(a) {
    if (a === 'retry') document.getElementById('btn-retry')?.click();
    else if (a === 'ok') document.getElementById('btn-back-menu')?.click();
    else if (a === 'replay') document.querySelector('#replay-bar button')?.click();
    else if (a === 'detail') { res.view = res.view === 'detail' ? 'main' : 'detail'; resRender(); }
    else if (a === 'apply') { document.getElementById('btn-apply-judge-offset')?.click(); setTimeout(resRender, 30); }
    else if (a === 'undo') { document.getElementById('btn-calib-undo')?.click(); setTimeout(resRender, 30); }
}

// música de fundo: a prévia da própria música, baixinho
function resMusic(on) {
    if (typeof playPrevia !== 'function') return;
    if (on && typeof currentPatternType === 'string' && currentPatternType.startsWith('custom:')) playPrevia(currentPatternType.slice(7));
    else if (!on && typeof stopPrevia === 'function') stopPrevia();
}

(function resHooks() {
    const origShow = window.showAnalysis;
    window.showAnalysis = function () {
        const out = origShow.apply(this, arguments);
        res.view = 'main';
        try { resRender(); } catch (e) { console.error('[resultado]', e); }
        return out;
    };
    // o resumo da partida (recorde, trechos, replay) fica pronto logo depois
    const origAfter = window.afterRunFinished;
    if (typeof origAfter === 'function') window.afterRunFinished = function () {
        const out = origAfter.apply(this, arguments);
        try { resRender(); resMusic(true); } catch (e) { console.error('[resultado]', e); }
        setTimeout(() => { try { if (!document.getElementById('stats-overlay').classList.contains('hidden')) resRender(); } catch (e) {} }, 600); // replay salvo
        return out;
    };
    const ov = document.getElementById('stats-overlay');
    if (ov && typeof MutationObserver !== 'undefined') new MutationObserver(() => { if (ov.classList.contains('hidden')) { resMusic(false); window.__resFechadoEm = performance.now(); } }).observe(ov, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('keydown', (e) => {
        const o = document.getElementById('stats-overlay');
        if (!o || o.classList.contains('hidden') || !o.classList.contains('res-on')) return;
        if (document.querySelector('#history-modal:not(.hidden), #perfil-ov, #bc-cele, #bc-ov, #sair-ov, #nov-ov, #lv-up, #lv-ov, #rk-ov, #col-ov')) return;
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        if (e.code === 'F5' || e.code === 'F8') { e.preventDefault(); e.stopImmediatePropagation(); resAct('retry'); }
        else if (e.code === 'KeyR' && !e.repeat) { e.preventDefault(); resAct('replay'); }
        else if (e.code === 'KeyD' && !e.repeat) { e.preventDefault(); resAct('detail'); }
        else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !document.getElementById('btn-ladder-next') && !document.getElementById('btn-ladder-retry')) {
            // só confirma e volta pro menu: segura o Enter aqui pra ele não chegar no "Enter começa" da lista
            e.preventDefault(); e.stopImmediatePropagation();
            if (e.repeat) return;
            window.__resFechadoEm = performance.now(); resAct('ok');
        }
    }, true);
})();
