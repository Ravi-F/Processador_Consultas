/**
 * HU3 – Renderização do grafo de operadores em SVG.
 *
 * Layout em árvore: folhas (tabelas) embaixo, raiz (projeção final) no topo.
 * As arestas apontam no sentido do fluxo dos resultados intermediários
 * (filho → pai) e, quando há plano, são rotuladas com a temporária Tn.
 */
(function (QP) {
  'use strict';
  const A = QP.Algebra;
  const NS = 'http://www.w3.org/2000/svg';

  const META = {
    relation: { label: 'Tabela', symbol: '▤', cls: 'rel' },
    selection: { label: 'Seleção', symbol: 'σ', cls: 'sel' },
    projection: { label: 'Projeção', symbol: 'π', cls: 'proj' },
    join: { label: 'Junção', symbol: '⋈', cls: 'join' },
    product: { label: 'Produto cartesiano', symbol: '×', cls: 'prod' },
  };

  const C = { charW: 7.1, lineH: 16, padX: 14, headerH: 34, footerH: 24, hGap: 30, vGap: 62, margin: 28, maxChars: 34, minW: 140 };
  const nf = new Intl.NumberFormat('pt-BR');
  const nfc = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
  const fmtRows = (n) => (n >= 1e6 ? nfc.format(n) : nf.format(n));

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v));
    if (parent) parent.appendChild(e);
    return e;
  }

  function wrapText(text, max) {
    const lines = [];
    let cur = '';
    for (const w of String(text).split(' ')) {
      if (!cur) cur = w;
      else if ((`${cur} ${w}`).length <= max) cur += ` ${w}`;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function content(n) {
    const m = META[n.kind];
    let title = m.label;
    let body = [];
    switch (n.kind) {
      case 'relation': title = n.table; if (n.alias !== n.table) body = [`alias: ${n.alias}`]; break;
      case 'selection':
      case 'join': body = n.conditions.flatMap((c) => wrapText(A.formatCondition(c), C.maxChars)); break;
      case 'projection': body = wrapText(A.formatColumns(n), C.maxChars); break;
      case 'product': body = ['sem condição de junção']; break;
      default: break;
    }
    const footer = n.est ? `≈ ${fmtRows(n.est.rows)} tuplas · ${n.est.attrs} atr.` : '';
    return { m, title, body, footer };
  }

  function layout(tree) {
    const levels = [];
    const info = new Map();
    (function measure(n, depth) {
      const c = content(n);
      const longest = Math.max(c.title.length + 4, ...c.body.map((l) => l.length), c.footer.length);
      const w = Math.max(C.minW, Math.ceil(longest * C.charW + C.padX * 2));
      const h = C.headerH + (c.body.length ? c.body.length * C.lineH + 8 : 0) + (c.footer ? C.footerH : 0);
      const it = { n, c, w, h, depth };
      info.set(n.id, it);
      (levels[depth] = levels[depth] || []).push(it);
      n.children.forEach((ch) => measure(ch, depth + 1));
      it.kids = n.children.map((ch) => info.get(ch.id));
      it.kidsW = it.kids.reduce((s, k) => s + k.subW, 0) + Math.max(0, it.kids.length - 1) * C.hGap;
      it.subW = Math.max(w, it.kidsW);
    })(tree, 0);

    const levelY = [];
    let y = C.margin;
    levels.forEach((lv, d) => { levelY[d] = y; y += Math.max(...lv.map((i) => i.h)) + C.vGap; });

    (function place(it, left) {
      it.cx = left + it.subW / 2;
      it.x = it.cx - it.w / 2;
      it.y = levelY[it.depth];
      let cl = left + (it.subW - it.kidsW) / 2;
      it.kids.forEach((k) => { place(k, cl); cl += k.subW + C.hGap; });
    })(info.get(tree.id), C.margin);

    return { info, width: info.get(tree.id).subW + C.margin * 2, height: y - C.vGap + C.margin, maxDepth: levels.length - 1 };
  }

  function enablePan(viewport) {
    if (viewport.dataset.pan) return;
    viewport.dataset.pan = '1';
    let start = null;
    viewport.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, l: viewport.scrollLeft, t: viewport.scrollTop };
      viewport.classList.add('is-panning');
    });
    window.addEventListener('mousemove', (e) => {
      if (!start) return;
      viewport.scrollLeft = start.l - (e.clientX - start.x);
      viewport.scrollTop = start.t - (e.clientY - start.y);
    });
    window.addEventListener('mouseup', () => { start = null; viewport.classList.remove('is-panning'); });
  }

  function render(viewport, tree, opts = {}) {
    const L = layout(tree);
    viewport.innerHTML = '';
    const uid = `g${Math.random().toString(36).slice(2, 8)}`;
    const svg = el('svg', { viewBox: `0 0 ${L.width} ${L.height}`, class: 'op-graph', role: 'img', 'aria-label': opts.label || 'Grafo de operadores' });
    const defs = el('defs', {}, svg);
    const marker = el('marker', { id: `${uid}-arrow`, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0,0 L10,5 L0,10 z', class: 'edge-arrow' }, marker);

    const gEdges = el('g', { class: 'edges' }, svg);
    const gNodes = el('g', { class: 'nodes' }, svg);

    for (const it of L.info.values()) {
      for (const k of it.kids) {
        const x1 = k.cx; const y1 = k.y; const x2 = it.cx; const y2 = it.y + it.h;
        const my = (y1 + y2) / 2;
        const d = `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
        el('path', { d, class: 'edge', 'marker-end': `url(#${uid}-arrow)` }, gEdges);
        el('path', { d, class: 'edge-flow' }, gEdges);
        if (opts.showSteps && k.n.step) {
          const g = el('g', { class: 'edge-label', transform: `translate(${(x1 + x2) / 2},${my})` }, gEdges);
          el('rect', { x: -16, y: -9, width: 32, height: 18, rx: 9 }, g);
          const t = el('text', { 'text-anchor': 'middle', dy: '4' }, g);
          t.textContent = `T${k.n.step}`;
        }
      }
    }

    for (const it of L.info.values()) {
      const { n, c } = it;
      const outer = el('g', { class: `gnode gnode--${c.m.cls}`, transform: `translate(${it.x},${it.y})`, 'data-node-id': n.id }, gNodes);
      const g = el('g', { class: 'gnode__inner', style: `animation-delay:${(L.maxDepth - it.depth) * 90}ms` }, outer);
      el('title', {}, g).textContent = [`${c.m.label}: ${c.title}`, ...c.body, c.footer].filter(Boolean).join('\n');
      el('rect', { class: 'gnode__bg', width: it.w, height: it.h, rx: 12 }, g);
      el('rect', { class: 'gnode__accent', x: 10, width: it.w - 20, height: 3, rx: 1.5 }, g);
      el('text', { class: 'gnode__symbol', x: C.padX, y: 24 }, g).textContent = c.m.symbol;
      el('text', { class: 'gnode__title', x: C.padX + 22, y: 23 }, g).textContent = c.title;
      c.body.forEach((line, i) => {
        el('text', { class: 'gnode__body', x: C.padX, y: C.headerH + 12 + i * C.lineH }, g).textContent = line;
      });
      if (c.footer) {
        el('line', { class: 'gnode__sep', x1: C.padX, x2: it.w - C.padX, y1: it.h - C.footerH, y2: it.h - C.footerH }, g);
        el('text', { class: 'gnode__footer', x: C.padX, y: it.h - 8 }, g).textContent = c.footer;
      }
      if (opts.showSteps && n.step) {
        const b = el('g', { class: 'gnode__step', transform: `translate(${it.w - 6},6)` }, g);
        el('circle', { r: 12 }, b);
        el('text', { 'text-anchor': 'middle', dy: '4' }, b).textContent = n.step;
      }
    }

    viewport.appendChild(svg);
    enablePan(viewport);

    const ctrl = {
      scale: 1,
      svg,
      setScale(s) {
        this.scale = Math.min(2.5, Math.max(0.2, s));
        svg.setAttribute('width', Math.round(L.width * this.scale));
        svg.setAttribute('height', Math.round(L.height * this.scale));
      },
      zoom(f) { this.setScale(this.scale * f); },
      fit() {
        const w = viewport.clientWidth - 24;
        const h = viewport.clientHeight - 24;
        if (w <= 0) return;
        this.setScale(Math.max(0.45, Math.min(1.15, w / L.width, h > 80 ? h / L.height : Infinity)));
      },
      highlight(id) {
        svg.querySelectorAll('.gnode.is-hl').forEach((e) => e.classList.remove('is-hl'));
        const e = id && svg.querySelector(`[data-node-id="${id}"]`);
        if (e) e.classList.add('is-hl');
        svg.classList.toggle('has-hl', !!e);
      },
    };
    ctrl.setScale(1);

    if (opts.onHover) {
      svg.addEventListener('mouseover', (e) => {
        const g = e.target.closest('.gnode');
        opts.onHover(g ? g.dataset.nodeId : null);
      });
      svg.addEventListener('mouseleave', () => opts.onHover(null));
    }
    return ctrl;
  }

  QP.GraphRenderer = { render, META };
})(globalThis.QP = globalThis.QP || {});
