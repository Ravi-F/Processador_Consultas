/**
 * HU4 – Otimização heurística da consulta.
 *
 * Heurísticas aplicadas (enunciado, item "Heurísticas Básicas"):
 *  a.i   seleções primeiro (reduzem tuplas)  → σ empurradas até as folhas,
 *        mais restritivas aplicadas antes;
 *  a.ii  projeções em seguida (reduzem atributos) → π logo acima das seleções
 *        de cada tabela e após junções intermediárias;
 *  b.i   junções mais restritivas primeiro → reordenação das folhas pela
 *        cardinalidade estimada;
 *  b.ii  evitar produto cartesiano → só junta relações conectadas por predicado;
 *  b.iii ajustar o restante da árvore.
 */
(function (QP) {
  'use strict';
  const M = QP.Metadata;
  const A = QP.Algebra;

  // ------------------------------------------------------------ estatísticas
  /** Número estimado de valores distintos de um atributo. */
  function distinct(col) {
    const t = M.TABLES[col.table];
    if (col.name === t.pk) return t.rows;
    const ref = M.fkTarget(col.name);
    if (ref) return Math.min(t.rows, M.TABLES[ref].rows);
    if (t.rows <= 100) return t.rows;
    return Math.max(1, Math.round(t.rows / 10));
  }

  function flatten(cond) {
    if (!cond) return [];
    if (cond.type === 'And') return cond.items.flatMap(flatten);
    if (cond.type === 'Group') return flatten(cond.inner);
    return [cond];
  }

  const columnsOf = (cond) => flatten(cond).flatMap((p) => [p.left, p.right]).filter((o) => o.type === 'Column');

  /** Seletividade estimada de um predicado atômico (modelo clássico System R). */
  function predSelectivity(p) {
    const cols = [p.left, p.right].filter((o) => o.type === 'Column');
    if (cols.length === 0) return 1;
    const d = Math.max(...cols.map(distinct));
    if (p.op === '=') return 1 / d;
    if (p.op === '<>') return 1 - 1 / d;
    return 1 / 3; // <, >, <=, >=
  }

  const condSelectivity = (conds) => conds.flatMap(flatten).reduce((s, p) => s * predSelectivity(p), 1);

  /** Anota cada nó com a estimativa {rows, attrs} do seu resultado. */
  function annotate(n) {
    n.children.forEach(annotate);
    const [l, r] = n.children.map((c) => c.est);
    let rows;
    let attrs;
    switch (n.kind) {
      case 'relation': rows = M.TABLES[n.table].rows; attrs = M.TABLES[n.table].columns.length; break;
      case 'selection': rows = l.rows * condSelectivity(n.conditions); attrs = l.attrs; break;
      case 'projection': rows = l.rows; attrs = n.columns.length; break;
      case 'join': rows = l.rows * r.rows * condSelectivity(n.conditions); attrs = l.attrs + r.attrs; break;
      case 'product': rows = l.rows * r.rows; attrs = l.attrs + r.attrs; break;
      default: rows = 0; attrs = 0;
    }
    n.est = { rows: Math.max(1, Math.round(rows)), attrs };
    return n;
  }

  /** Custo estimado = soma das tuplas (e do volume tuplas × atributos) de todos os nós. */
  function cost(tree) {
    let tuples = 0;
    let volume = 0;
    A.walk(tree, (n) => { tuples += n.est.rows; volume += n.est.rows * n.est.attrs; });
    return { tuples, volume };
  }

  // ---------------------------------------------------------------- helpers
  const nf = new Intl.NumberFormat('pt-BR');
  const pf = new Intl.NumberFormat('pt-BR', { maximumSignificantDigits: 3 });
  const pct = (x) => `${pf.format(x * 100)}%`;
  const relLabel = (r) => (r.alias === r.table ? r.table : `${r.table} ${r.alias}`);
  const key = A.colKey;

  // ---------------------------------------------------------------- otimizar
  function optimize(q) {
    const steps = [];

    // 1) Decomposição das condições conjuntivas em predicados atômicos
    const preds = [];
    flatten(q.where).forEach((cond) => preds.push({ cond, origin: 'WHERE' }));
    q.joins.forEach((j) => flatten(j.condition).forEach((cond) => preds.push({ cond, origin: 'ON' })));
    preds.forEach((p) => {
      p.aliases = [...new Set(columnsOf(p.cond).map((c) => c.alias))];
      p.text = A.formatCondition(p.cond);
      p.sel = predSelectivity(p.cond);
    });

    const filters = new Map(q.relations.map((r) => [r.alias, []]));
    const joinPreds = [];
    const constPreds = [];
    for (const p of preds) {
      if (p.aliases.length === 0) constPreds.push(p);
      else if (p.aliases.length === 1) filters.get(p.aliases[0]).push(p);
      else joinPreds.push(p);
    }

    steps.push({
      tag: 'Preparação',
      title: 'Decomposição das condições conjuntivas',
      description: 'As condições do WHERE e dos ON são quebradas em predicados atômicos '
        + '(σ c1 ∧ c2 (R) ≡ σ c1 (σ c2 (R))) e classificadas pelas relações que referenciam.',
      items: preds.length ? preds.map((p) => {
        const kind = p.aliases.length === 0 ? 'predicado constante'
          : p.aliases.length === 1 ? `seleção sobre ${p.aliases[0]}`
            : `junção ${p.aliases.join(' ⋈ ')}`;
        return `${p.text}  —  [${p.origin}] → ${kind}`;
      }) : ['A consulta não possui condições (WHERE/ON).'],
    });

    // 2) Heurística a.i – seleções primeiro, mais restritivas antes
    const relInfo = q.relations.map((r, idx) => {
      const fs = filters.get(r.alias).sort((a, b) => a.sel - b.sel);
      const baseRows = M.TABLES[r.table].rows;
      const size = Math.max(1, Math.round(baseRows * fs.reduce((s, f) => s * f.sel, 1)));
      return { ...r, idx, filters: fs, baseRows, size };
    });

    const selItems = [];
    relInfo.filter((r) => r.filters.length).forEach((r) => {
      r.filters.forEach((f, i) => selItems.push(
        `${relLabel(r)}: ${i + 1}º σ ${f.text}  (seletividade ≈ ${pct(f.sel)})`,
      ));
      selItems.push(`${relLabel(r)}: ${nf.format(r.baseRows)} → ≈ ${nf.format(r.size)} tuplas após as seleções`);
    });
    steps.push({
      tag: 'Heurística a.i',
      title: 'Seleções primeiro — redução de tuplas',
      description: 'Cada seleção que envolve uma única tabela é empurrada para baixo, logo acima da folha. '
        + 'Havendo várias, a mais restritiva (menor seletividade estimada) é executada primeiro.',
      items: selItems.length ? selItems : ['Nenhuma seleção sobre tabela individual para empurrar.'],
    });

    // 3) Heurísticas b.i / b.ii – ordem das junções (gulosa, sem produto cartesiano)
    const remaining = [...relInfo];
    let pool = [...joinPreds];
    const first = remaining.reduce((best, r) => (r.size < best.size ? r : best));
    remaining.splice(remaining.indexOf(first), 1);
    const order = [{ rel: first, preds: [], type: 'start', est: first.size }];
    const inSet = new Set([first.alias]);
    let curSize = first.size;
    let usedProduct = false;

    while (remaining.length) {
      let best = null;
      for (const r of remaining) {
        const ps = pool.filter((p) => p.aliases.includes(r.alias) && p.aliases.every((a) => a === r.alias || inSet.has(a)));
        if (!ps.length) continue;
        const est = Math.max(1, curSize * r.size * ps.reduce((s, p) => s * p.sel, 1));
        if (!best || est < best.est || (est === best.est && r.idx < best.rel.idx)) {
          best = { rel: r, preds: ps.sort((a, b) => a.sel - b.sel), est, type: 'join' };
        }
      }
      if (!best) {
        const r = remaining.reduce((b, x) => (x.size < b.size ? x : b));
        best = { rel: r, preds: [], est: curSize * r.size, type: 'product' };
        usedProduct = true;
      }
      remaining.splice(remaining.indexOf(best.rel), 1);
      pool = pool.filter((p) => !best.preds.includes(p));
      inSet.add(best.rel.alias);
      curSize = best.est;
      order.push(best);
    }

    const joinItems = order.map((s, i) => {
      if (s.type === 'start') return `${i + 1}º ${relLabel(s.rel)} (≈ ${nf.format(s.est)} tuplas) — ponto de partida: menor relação após as seleções`;
      if (s.type === 'join') return `${i + 1}º ⋈ ${relLabel(s.rel)} ON ${s.preds.map((p) => p.text).join(' ∧ ')}  → ≈ ${nf.format(Math.round(s.est))} tuplas`;
      return `${i + 1}º × ${relLabel(s.rel)} — produto cartesiano inevitável (nenhum predicado liga esta tabela às anteriores)`;
    });
    if (q.relations.length > 1) {
      joinItems.push(`Ordem original: ${q.relations.map(relLabel).join(', ')}  ⇒  ordem otimizada: ${order.map((s) => relLabel(s.rel)).join(', ')}`);
    }
    if (q.fromCount > 1) {
      const converted = joinPreds.filter((p) => p.origin === 'WHERE');
      if (converted.length) {
        joinItems.push(`Produto cartesiano do FROM (${q.relations.filter((r) => r.clause === 'FROM').map(relLabel).join(' × ')}) `
          + `substituído por junção usando: ${converted.map((p) => p.text).join(' ∧ ')}`);
      }
    }
    if (usedProduct) joinItems.push('⚠ Atenção: não há predicado de junção ligando todas as tabelas; o produto cartesiano foi colocado o mais tarde possível.');

    steps.push({
      tag: 'Heurísticas b.i / b.ii',
      title: 'Junções mais restritivas primeiro — evitar produto cartesiano',
      description: 'As folhas são reordenadas: começa-se pela relação com menor resultado estimado e, a cada passo, '
        + 'junta-se a relação conectada por predicado de junção que gera o menor resultado intermediário. '
        + 'Produtos cartesianos (σ sobre ×) são convertidos em junções (⋈).',
      items: q.relations.length > 1 ? joinItems : ['Consulta com uma única tabela: não há junções para ordenar.'],
    });

    // 4) Heurística a.ii – projeções logo após as seleções e após junções intermediárias
    const finalKeys = new Set(q.projection.map(key));
    const joinAttrKeys = new Set(joinPreds.flatMap((p) => columnsOf(p.cond).map(key)));
    const projItems = [];

    function branch(rel) {
      let t = A.relation(rel);
      // o predicado mais restritivo fica mais próximo da folha (executa primeiro)
      for (const f of rel.filters) t = A.selection([f.cond], t);
      const all = A.outputColumns(t);
      const needed = all.filter((c) => finalKeys.has(key(c)) || joinAttrKeys.has(key(c)));
      if (needed.length > 0 && needed.length < all.length) {
        t = A.projection(needed, t);
        projItems.push(`${relLabel(rel)}: ${all.length} → ${needed.length} atributos  π ${needed.map((c) => c.name).join(', ')}`);
      }
      return t;
    }

    let tree = branch(order[0].rel);
    for (let k = 1; k < order.length; k++) {
      const st = order[k];
      const right = branch(st.rel);
      tree = st.type === 'join' ? A.join(st.preds.map((p) => p.cond), tree, right) : A.product(tree, right);
      if (k < order.length - 1) {
        const later = new Set(finalKeys);
        order.slice(k + 1).forEach((s) => s.preds.forEach((p) => columnsOf(p.cond).forEach((c) => later.add(key(c)))));
        const produced = A.outputColumns(tree);
        const keep = produced.filter((c) => later.has(key(c)));
        if (keep.length > 0 && keep.length < produced.length) {
          tree = A.projection(keep, tree);
          projItems.push(`Após a ${k}ª junção: ${produced.length} → ${keep.length} atributos  π ${keep.map(key).join(', ')}`);
        }
      }
    }

    steps.push({
      tag: 'Heurística a.ii',
      title: 'Projeções em seguida — redução de atributos',
      description: 'Calcula-se o conjunto de atributos ainda necessários (projeção final + atributos usados em junções futuras). '
        + 'Uma projeção π é inserida logo acima das seleções de cada tabela e após as junções intermediárias.',
      items: projItems.length ? projItems : ['Nenhuma projeção intermediária reduz atributos (ex.: SELECT * ou todos os atributos são usados).'],
    });

    // 5) Heurística b.iii – ajuste final da árvore
    const finalItems = [];
    if (constPreds.length) {
      tree = A.selection(constPreds.map((p) => p.cond), tree);
      finalItems.push(`Predicados constantes mantidos acima das junções: ${constPreds.map((p) => p.text).join(' ∧ ')}`);
    }
    // evita π duplicada imediatamente abaixo da raiz
    if (tree.kind === 'projection' && !q.select.star) {
      const same = tree.columns.length === q.projection.length && tree.columns.every((c) => finalKeys.has(key(c)));
      if (same) tree = tree.children[0];
    }
    tree = A.projection(q.projection, tree, q.select.star);
    finalItems.push(`Raiz: projeção final π ${q.select.star ? '*' : q.projection.map(key).join(', ')}`);
    finalItems.push('Árvore em profundidade à esquerda (left-deep): o resultado acumulado é sempre o operando esquerdo da próxima junção.');

    steps.push({
      tag: 'Heurística b.iii',
      title: 'Ajuste do restante da árvore',
      description: 'A árvore é reconstruída com as seleções/projeções nas folhas, as junções na ordem escolhida e a projeção do SELECT na raiz.',
      items: finalItems,
    });

    return { tree, steps, order };
  }

  QP.Optimizer = { optimize, annotate, cost, distinct, predSelectivity, flatten };
})(globalThis.QP = globalThis.QP || {});
