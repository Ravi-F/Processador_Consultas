/**
 * Interface gráfica – liga o editor SQL ao pipeline e renderiza cada etapa.
 */
(function (QP) {
  'use strict';
  const M = QP.Metadata;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('pt-BR');
  const nfc = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
  const fmt = (n) => (n >= 1e6 ? nfc.format(n) : nf.format(Math.round(n)));

  const EXAMPLES = [
    { label: 'Seleção simples', sql: 'SELECT Nome, Email\nFROM Cliente\nWHERE idCliente = 10' },
    { label: 'JOIN + filtro', sql: 'SELECT Cliente.Nome, Pedido.DataPedido, Pedido.ValorTotalPedido\nFROM Cliente\nJOIN Pedido ON Cliente.idCliente = Pedido.Cliente_idCliente\nWHERE Pedido.ValorTotalPedido > 500' },
    { label: 'Múltiplos JOINs', sql: "SELECT c.Nome, p.DataPedido, pr.Nome, cat.Descricao\nFROM Cliente c\nJOIN Pedido p ON c.idCliente = p.Cliente_idCliente\nJOIN Pedido_has_Produto pp ON p.idPedido = pp.Pedido_idPedido\nJOIN Produto pr ON pp.Produto_idProduto = pr.idProduto\nJOIN Categoria cat ON pr.Categoria_idCategoria = cat.idCategoria\nWHERE cat.Descricao = 'Eletrônicos' AND p.ValorTotalPedido >= 1000\n  AND c.TipoCliente_idTipoCliente = 2" },
    { label: 'Produto cartesiano → junção', sql: "SELECT c.Nome, e.Cidade, e.UF\nFROM Cliente c, Endereco e\nWHERE c.idCliente = e.Cliente_idCliente\n  AND e.UF = 'SP' AND c.Nascimento >= '1990-01-01'" },
    { label: 'Caixa mista + parênteses', sql: 'select   P.nome ,  p.PRECO, c.descricao\n  from produto   p   inner join CATEGORIA c\n    on ( p.categoria_idcategoria = c.idcategoria )\n where ( p.preco >= 100 and p.preco <= 500 ) and p.quantestoque > 0' },
    { label: 'Status do pedido', sql: "SELECT Pedido.idPedido, Status.Descricao, Cliente.Email\nFROM Pedido\nJOIN Status ON Pedido.Status_idStatus = Status.idStatus\nJOIN Cliente ON Pedido.Cliente_idCliente = Cliente.idCliente\nWHERE Status.Descricao <> 'Cancelado' AND Pedido.DataPedido > '2024-01-01'" },
    { label: 'Atributo inexistente', sql: 'SELECT Nome, Salario FROM Cliente', error: true },
    { label: 'Atributo ambíguo', sql: 'SELECT Descricao\nFROM Produto\nJOIN Categoria ON Produto.Categoria_idCategoria = Categoria.idCategoria', error: true },
    { label: 'Operador OR', sql: 'SELECT Nome FROM Cliente WHERE idCliente = 1 OR idCliente = 2', error: true },
  ];

  const TAB_PHASES = {
    validation: ['normalize', 'structure', 'lexer', 'parser', 'semantic'],
    algebra: ['algebra'],
    graph: ['optimize'],
    optimization: ['optimize'],
    plan: ['plan'],
  };

  const ALL_COLUMNS = new Set(M.tableNames().flatMap((t) => M.TABLES[t].columns.map((c) => c.toLowerCase())));
  const state = { result: null, tab: 'validation', graphMode: 'optimized', graphCtrl: null, planCtrl: null };
  let els;

  // --------------------------------------------------------------- editor
  function highlightSQL(text) {
    const re = /('(?:[^']|'')*'?)|(-?\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)|(<>|<=|>=|!=|=|<|>)|([(),.;*])/g;
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      out += esc(text.slice(last, m.index));
      last = m.index + m[0].length;
      const v = esc(m[0]);
      if (m[1]) out += `<span class="tk-str">${v}</span>`;
      else if (m[2]) out += `<span class="tk-num">${v}</span>`;
      else if (m[3]) {
        const up = m[0].toUpperCase();
        if (QP.Lexer.KEYWORDS.has(up)) out += `<span class="tk-kw">${v}</span>`;
        else if (QP.Lexer.UNSUPPORTED.has(up)) out += `<span class="tk-bad">${v}</span>`;
        else if (M.findTable(m[0])) out += `<span class="tk-tbl">${v}</span>`;
        else if (ALL_COLUMNS.has(m[0].toLowerCase())) out += `<span class="tk-col">${v}</span>`;
        else out += `<span class="tk-id">${v}</span>`;
      } else if (m[4]) out += `<span class="tk-op">${v}</span>`;
      else out += `<span class="tk-punc">${v}</span>`;
    }
    return `${out + esc(text.slice(last))}\n`;
  }

  function syncHighlight() {
    els.hl.innerHTML = highlightSQL(els.input.value);
    els.hl.scrollTop = els.input.scrollTop;
  }

  function insertAtCursor(text) {
    const { input } = els;
    const { selectionStart: s, selectionEnd: e, value } = input;
    const before = value.slice(0, s);
    const pad = before && !/[\s(,]$/.test(before) ? ' ' : '';
    input.setRangeText(pad + text, s, e, 'end');
    input.focus();
    syncHighlight();
    scheduleLive();
  }

  let liveTimer = null;
  function scheduleLive() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => updateLive(QP.Processor.process(els.input.value)), 260);
  }

  function updateLive(r) {
    const b = els.live;
    if (!els.input.value.trim()) { b.className = 'badge badge--idle'; b.textContent = 'aguardando'; return; }
    if (r.ok) { b.className = 'badge badge--ok'; b.textContent = '✓ consulta válida'; } else {
      b.className = 'badge badge--err';
      b.textContent = `✗ erro ${r.error.phase}`;
      b.title = r.error.message;
    }
  }

  // ---------------------------------------------------------------- tabs
  function activate(tab) {
    state.tab = tab;
    $$('.tab').forEach((t) => { const on = t.dataset.tab === tab; t.classList.toggle('is-active', on); t.setAttribute('aria-selected', on); });
    $$('.panel').forEach((p) => p.classList.toggle('is-active', p.id === `panel-${tab}`));
    requestAnimationFrame(() => {
      if (tab === 'graph' && state.graphCtrl) state.graphCtrl.fit();
      if (tab === 'plan' && state.planCtrl) state.planCtrl.fit();
    });
  }

  function renderTabsStatus(r) {
    $$('.tab').forEach((t) => {
      const ids = TAB_PHASES[t.dataset.tab];
      const ph = r.phases.filter((p) => ids.includes(p.id));
      let st = 'idle';
      if (ph.some((p) => !p.ok)) st = 'err';
      else if (ph.length === ids.length) st = 'ok';
      t.dataset.status = st;
    });
  }

  // ------------------------------------------------------------- render
  const empty = (title, text) => `<div class="empty"><div class="empty__icon">⌁</div><h3>${title}</h3><p>${text}</p></div>`;
  const blocked = () => empty('Etapa indisponível', 'Corrija os erros de validação da consulta para gerar esta etapa.');

  function renderError(r) {
    const box = els.errorBox;
    if (r.ok) { box.hidden = true; return; }
    const e = r.error;
    let q = '';
    if (r.normalized && e.pos != null) {
      const s = e.pos; const en = Math.min(r.normalized.length, s + (e.length || 1));
      q = `<code class="err-query">${esc(r.normalized.slice(0, s))}<mark>${esc(r.normalized.slice(s, en) || ' ')}</mark>${esc(r.normalized.slice(en))}</code>`;
    }
    box.innerHTML = `<div class="error-box__title">Erro ${esc(e.phase)}</div><p>${esc(e.message)}</p>${q}`;
    box.hidden = false;
  }

  function renderValidation(r) {
    const phases = QP.Processor.PHASES.slice(0, 5).map((meta) => {
      const p = r.phases.find((x) => x.id === meta.id);
      const st = !p ? 'pending' : p.ok ? 'ok' : 'err';
      const icon = { ok: '✓', err: '✗', pending: '•' }[st];
      return `<li class="phase phase--${st}"><span class="phase__icon">${icon}</span><div><strong>${meta.name}</strong><small>${esc(meta.method)}</small>${p && !p.ok ? `<em>${esc(p.error.message)}</em>` : ''}</div></li>`;
    }).join('');

    let html = `<div class="panel-head"><h3>Etapas de validação (HU1)</h3><span class="muted small">a consulta passa por 5 verificações em sequência</span></div><ol class="phase-list">${phases}</ol>`;

    if (r.normalized) {
      html += `<div class="block"><h4>Consulta normalizada <span class="muted small">(espaços repetidos removidos)</span></h4><code class="code-line">${esc(r.normalized)}</code></div>`;
    }
    if (r.structure) {
      const s = r.structure;
      html += `<div class="block"><h4>Validação estrutural por expressão regular</h4><code class="code-line code-line--regex">${esc(s.pattern)}</code>
        <table class="table"><tbody>
        <tr><th>SELECT</th><td><code>${esc(s.select)}</code></td></tr>
        <tr><th>FROM</th><td><code>${esc(s.from)}</code></td></tr>
        <tr><th>WHERE</th><td>${s.where ? `<code>${esc(s.where)}</code>` : '<span class="muted">—</span>'}</td></tr>
        <tr><th>JOINs</th><td>${s.joins.length ? `${s.joins.length} detectado(s): ${s.joins.map((j) => `<code>${esc(j)}</code>`).join(' ')}` : '<span class="muted">nenhum</span>'}</td></tr>
        </tbody></table></div>`;
    }
    if (r.tokens) {
      const toks = r.tokens.filter((t) => t.type !== 'EOF');
      html += `<div class="block"><h4>Tokens (${toks.length}) <span class="muted small">análise léxica por regex</span></h4><div class="tokens">${
        toks.map((t) => `<span class="tok tok--${t.type.toLowerCase()}" title="${t.type} @ ${t.pos}"><b>${esc(t.raw)}</b><i>${t.type}</i></span>`).join('')}</div></div>`;
    }
    if (r.query) {
      const q = r.query;
      html += `<div class="block grid-2">
        <div><h4>Tabelas reconhecidas</h4><table class="table"><thead><tr><th>Tabela</th><th>Alias</th><th>Origem</th><th>Tuplas (est.)</th></tr></thead><tbody>${
        q.relations.map((e) => `<tr><td><span class="pill pill--rel">${esc(e.table)}</span></td><td><code>${esc(e.alias)}</code></td><td>${e.clause}</td><td>${nf.format(e.rows)}</td></tr>`).join('')}</tbody></table></div>
        <div><h4>Atributos verificados</h4><table class="table"><thead><tr><th>Referência</th><th>Resolvido</th><th>Cláusula</th></tr></thead><tbody>${
        q.references.length ? q.references.map((ref) => `<tr><td><code>${esc(ref.raw)}</code></td><td><span class="ok-text">✓</span> ${esc(ref.resolved)}</td><td>${ref.clause}</td></tr>`).join('')
          : '<tr><td colspan="3" class="muted">SELECT * — todos os atributos das tabelas</td></tr>'}</tbody></table></div></div>`;
    }
    if (r.ast) {
      const json = JSON.stringify(r.ast, (k, v) => (['pos', 'end'].includes(k) ? undefined : v), 2);
      html += `<details class="block details"><summary>Árvore sintática (AST) gerada pelo parser</summary><pre class="code-block">${esc(json)}</pre></details>`;
    }
    html += `<details class="block details"><summary>Gramática utilizada pelo parser descendente recursivo</summary><pre class="code-block">${esc(QP.Parser.GRAMMAR)}</pre></details>`;
    els.panels.validation.innerHTML = html;
  }

  function renderAlgebra(r) {
    if (!r.ok) { els.panels.algebra.innerHTML = blocked(); return; }
    const q = r.query;
    const A = QP.Algebra;
    const rows = [];
    rows.push(['SELECT', q.select.star ? '*' : q.projection.map(A.colKey).join(', '), `π <sub>${q.select.star ? '*' : esc(q.projection.map(A.colKey).join(', '))}</sub>`, 'Projeção']);
    const fromRels = q.relations.filter((e) => e.clause === 'FROM');
    if (fromRels.length > 1) rows.push(['FROM', fromRels.map((e) => e.table).join(', '), esc(fromRels.map((e) => e.alias).join(' × ')), 'Produto cartesiano']);
    q.joins.forEach((j) => rows.push([`JOIN ${j.relation.table}`, `ON ${A.formatCondition(j.condition)}`, `⋈ <sub>${esc(A.formatCondition(j.condition))}</sub> ${esc(j.relation.alias)}`, 'Junção']));
    if (q.where) rows.push(['WHERE', A.formatCondition(q.where), `σ <sub>${esc(A.formatCondition(q.where))}</sub>`, 'Seleção']);

    els.panels.algebra.innerHTML = `
      <div class="panel-head"><h3>Conversão SQL → Álgebra Relacional (HU2)</h3></div>
      <article class="ra-card">
        <header><span class="tag">Tradução direta</span><h4>Expressão canônica</h4><button class="btn btn--ghost btn--sm" data-copy="canonical" type="button">Copiar</button></header>
        <div class="ra-expr">${r.algebra.canonicalHtml}</div>
      </article>
      <article class="ra-card ra-card--opt">
        <header><span class="tag tag--ok">Após heurísticas</span><h4>Expressão otimizada</h4><button class="btn btn--ghost btn--sm" data-copy="optimized" type="button">Copiar</button></header>
        <div class="ra-expr">${r.algebra.optimizedHtml}</div>
      </article>
      <div class="block"><h4>Mapeamento de cada cláusula</h4>
        <table class="table"><thead><tr><th>Cláusula SQL</th><th>Conteúdo</th><th>Álgebra relacional</th><th>Operador</th></tr></thead><tbody>
        ${rows.map(([c, t, ra, op]) => `<tr><td><code>${esc(c)}</code></td><td class="mono small">${esc(t)}</td><td class="ra-inline">${ra}</td><td>${op}</td></tr>`).join('')}
        </tbody></table>
        <p class="muted small">Notação: σ seleção · π projeção · ⋈ junção · × produto cartesiano · ρ renomeação (alias) · ∧ conjunção (AND). Os operadores =, ≠ (&lt;&gt;), &lt;, &gt;, ≤, ≥ são preservados.</p>
      </div>`;
    $$('[data-copy]', els.panels.algebra).forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy === 'canonical' ? r.algebra.canonicalText : r.algebra.optimizedText)));
  }

  function renderGraph(r) {
    const vp = els.graphViewport;
    if (!r.ok) { vp.innerHTML = blocked(); state.graphCtrl = null; els.graphInfo.textContent = ''; return; }
    const opt = state.graphMode === 'optimized';
    const tree = opt ? r.optimizedTree : r.canonicalTree;
    state.graphCtrl = QP.GraphRenderer.render(vp, tree, { showSteps: opt, label: opt ? 'Grafo de operadores otimizado' : 'Grafo de operadores canônico' });
    const c = opt ? r.cost.optimized : r.cost.canonical;
    els.graphInfo.innerHTML = `${QP.Algebra.countNodes(tree)} nós · altura ${QP.Algebra.height(tree)} · custo ≈ <b>${fmt(c.tuples)}</b> tuplas intermediárias`;
    if (state.tab === 'graph') requestAnimationFrame(() => state.graphCtrl && state.graphCtrl.fit());
  }

  function renderOptimization(r) {
    if (!r.ok) { els.panels.optimization.innerHTML = blocked(); return; }
    const a = r.cost.canonical.tuples;
    const b = r.cost.optimized.tuples;
    const gain = a > 0 ? Math.max(0, (1 - b / a) * 100) : 0;
    const max = Math.log10(Math.max(a, b, 10));
    const bar = (v) => Math.max(4, (Math.log10(Math.max(v, 1)) / max) * 100);
    const va = r.cost.canonical.volume;
    const vb = r.cost.optimized.volume;

    els.panels.optimization.innerHTML = `
      <div class="panel-head"><h3>Otimização heurística (HU4)</h3><span class="muted small">custo estimado com estatísticas fictícias do catálogo</span></div>
      <div class="cost-grid">
        <div class="cost"><span>Árvore canônica</span><strong>${fmt(a)}</strong><small>tuplas intermediárias · volume ${fmt(va)}</small><div class="bar"><i style="width:${bar(a)}%"></i></div></div>
        <div class="cost cost--ok"><span>Árvore otimizada</span><strong>${fmt(b)}</strong><small>tuplas intermediárias · volume ${fmt(vb)}</small><div class="bar"><i style="width:${bar(b)}%"></i></div></div>
        <div class="cost cost--gain"><span>Redução estimada</span><strong>${gain >= 99.99 && gain < 100 ? '>99,99' : nf.format(Math.round(gain * 100) / 100)}%</strong><small>menos tuplas processadas</small></div>
      </div>
      <div class="opt-steps">${r.optimizationSteps.map((s, i) => `
        <article class="opt-step" style="animation-delay:${i * 70}ms">
          <div class="opt-step__num">${i + 1}</div>
          <div class="opt-step__body">
            <span class="tag">${esc(s.tag)}</span>
            <h4>${esc(s.title)}</h4>
            <p>${esc(s.description)}</p>
            <ul>${s.items.map((it) => `<li>${esc(it)}</li>`).join('')}</ul>
          </div>
        </article>`).join('')}</div>`;
  }

  function highlightPlan(id) {
    $$('.plan-step', els.planList).forEach((li) => li.classList.toggle('is-hl', li.dataset.nodeId === id));
    if (state.planCtrl) state.planCtrl.highlight(id);
  }

  function renderPlan(r) {
    if (!r.ok) {
      els.planList.innerHTML = `<li class="plan-empty">${blocked()}</li>`;
      els.planViewport.innerHTML = '';
      state.planCtrl = null;
      return;
    }
    const cls = { relation: 'rel', selection: 'sel', projection: 'proj', join: 'join', product: 'prod' };
    els.planList.innerHTML = r.plan.map((s, i) => `
      <li class="plan-step plan-step--${cls[s.kind]}${s.final ? ' is-final' : ''}" data-node-id="${s.nodeId}" style="animation-delay:${i * 45}ms">
        <span class="plan-step__idx">${s.index}</span>
        <div class="plan-step__body">
          <div class="plan-step__head"><span class="sym">${s.symbol}</span><strong>${esc(s.operation)}</strong>
            <span class="io">${s.inputs.length ? s.inputs.join(', ') : esc(s.kind === 'relation' ? 'disco' : '—')} → <b>${s.output}</b></span></div>
          <p>${esc(s.detail)}</p>
          <span class="est">≈ ${fmt(s.est.rows)} tuplas · ${s.est.attrs} atributos${s.final ? ' · <b>resultado final</b>' : ''}</span>
        </div>
      </li>`).join('');
    state.planCtrl = QP.GraphRenderer.render(els.planViewport, r.optimizedTree, { showSteps: true, onHover: highlightPlan });
    $$('.plan-step', els.planList).forEach((li) => {
      li.addEventListener('mouseenter', () => highlightPlan(li.dataset.nodeId));
      li.addEventListener('mouseleave', () => highlightPlan(null));
    });
    if (state.tab === 'plan') requestAnimationFrame(() => state.planCtrl && state.planCtrl.fit());
  }

  function process() {
    const r = QP.Processor.process(els.input.value);
    state.result = r;
    renderTabsStatus(r);
    renderError(r);
    renderValidation(r);
    renderAlgebra(r);
    renderGraph(r);
    renderOptimization(r);
    renderPlan(r);
    updateLive(r);
    if (!r.ok) activate('validation');
    els.workspace.classList.remove('flash');
    void els.workspace.offsetWidth;
    els.workspace.classList.add('flash');
  }

  // -------------------------------------------------------------- misc UI
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('is-on');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => els.toast.classList.remove('is-on'), 1800);
  }

  function copy(text) {
    const done = () => toast('Copiado para a área de transferência');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } finally { ta.remove(); }
  }

  function renderExamples() {
    els.examples.innerHTML = EXAMPLES.map((e, i) => `<button type="button" class="chip${e.error ? ' chip--err' : ''}" data-ex="${i}" id="example-${i}">${e.error ? '⚠ ' : ''}${esc(e.label)}</button>`).join('');
    els.examples.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-ex]');
      if (!b) return;
      els.input.value = EXAMPLES[b.dataset.ex].sql;
      syncHighlight();
      process();
    });
  }

  function renderSchema() {
    const names = M.tableNames();
    $('#stat-tables').textContent = names.length;
    $('#stat-columns').textContent = names.reduce((s, t) => s + M.TABLES[t].columns.length, 0);
    els.schema.innerHTML = names.map((t) => {
      const meta = M.TABLES[t];
      return `<details class="schema-table" data-table="${t}">
        <summary><span class="schema-table__name">${t}</span><span class="muted small">${meta.columns.length} atr.</span><button type="button" class="icon-btn icon-btn--sm" data-insert="${t}" title="Inserir tabela">+</button></summary>
        <div class="schema-cols">${meta.columns.map((c) => {
          const kind = c === meta.pk ? 'pk' : M.fkTarget(c) ? 'fk' : '';
          return `<button type="button" class="col-btn ${kind ? `col-btn--${kind}` : ''}" data-insert="${t}.${c}" data-col="${c.toLowerCase()}">${kind ? `<i>${kind.toUpperCase()}</i>` : ''}${c}</button>`;
        }).join('')}</div></details>`;
    }).join('');
    els.schema.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-insert]');
      if (!b) return;
      ev.preventDefault();
      insertAtCursor(b.dataset.insert);
    });
    $('#schema-filter').addEventListener('input', (ev) => {
      const q = ev.target.value.trim().toLowerCase();
      $$('.schema-table', els.schema).forEach((d) => {
        const tableHit = d.dataset.table.toLowerCase().includes(q);
        let colHit = false;
        $$('.col-btn', d).forEach((c) => { const hit = !q || c.dataset.col.includes(q); c.classList.toggle('is-dim', !!q && !hit && !tableHit); colHit = colHit || (q && hit); });
        d.hidden = !!q && !tableHit && !colHit;
        d.open = !!q && colHit;
      });
    });
  }

  function bindEvents() {
    els.input.addEventListener('input', () => { syncHighlight(); scheduleLive(); });
    els.input.addEventListener('scroll', () => { els.hl.scrollTop = els.input.scrollTop; });
    els.input.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); process(); }
      if (e.key === 'Tab') { e.preventDefault(); insertAtCursor('  '); }
    });
    $('#btn-process').addEventListener('click', process);
    $('#btn-clear').addEventListener('click', () => { els.input.value = ''; syncHighlight(); updateLive({}); els.input.focus(); });
    $$('.tab').forEach((t) => t.addEventListener('click', () => activate(t.dataset.tab)));
    $$('.segmented button').forEach((b) => b.addEventListener('click', () => {
      state.graphMode = b.dataset.mode;
      $$('.segmented button').forEach((x) => x.classList.toggle('is-active', x === b));
      if (state.result) renderGraph(state.result);
    }));
    $('#graph-zoom-in').addEventListener('click', () => state.graphCtrl && state.graphCtrl.zoom(1.2));
    $('#graph-zoom-out').addEventListener('click', () => state.graphCtrl && state.graphCtrl.zoom(1 / 1.2));
    $('#graph-zoom-fit').addEventListener('click', () => state.graphCtrl && state.graphCtrl.fit());
    $('#btn-copy-plan').addEventListener('click', () => state.result && state.result.ok && copy(QP.Plan.toText(state.result.plan)));
    window.addEventListener('resize', () => {
      clearTimeout(bindEvents.t);
      bindEvents.t = setTimeout(() => { if (state.tab === 'graph' && state.graphCtrl) state.graphCtrl.fit(); if (state.tab === 'plan' && state.planCtrl) state.planCtrl.fit(); }, 150);
    });
  }

  function init() {
    els = {
      input: $('#sql-input'), hl: $('#sql-highlight'), live: $('#live-status'), errorBox: $('#error-box'),
      examples: $('#examples'), schema: $('#schema'), workspace: $('#workspace'), toast: $('#toast'),
      graphViewport: $('#graph-viewport'), graphInfo: $('#graph-info'), planList: $('#plan-list'), planViewport: $('#plan-graph-viewport'),
      panels: { validation: $('#panel-validation'), algebra: $('#panel-algebra'), optimization: $('#panel-optimization') },
    };
    renderExamples();
    renderSchema();
    bindEvents();
    els.input.value = EXAMPLES[2].sql;
    syncHighlight();
    process();
  }

  document.addEventListener('DOMContentLoaded', init);
})(globalThis.QP = globalThis.QP || {});
