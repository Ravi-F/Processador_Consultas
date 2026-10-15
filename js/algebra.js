/**
 * HU2 / HU3 – Álgebra relacional e grafo (árvore) de operadores em memória.
 *
 * Nós do grafo:
 *   relation   – folha (tabela)
 *   selection  – σ (seleção)
 *   projection – π (projeção)
 *   join       – ⋈ (junção com condição)
 *   product    – × (produto cartesiano)
 * As arestas são os vínculos pai → filhos (children) e representam o fluxo
 * dos resultados intermediários das folhas até a raiz (última projeção).
 */
(function (QP) {
  'use strict';

  let seq = 0;
  const resetIds = () => { seq = 0; };
  const node = (kind, props, children) => Object.assign({ id: `n${++seq}`, kind, children }, props);

  const relation = (rel) => node('relation', { table: rel.table, alias: rel.alias }, []);
  const selection = (conditions, child) => node('selection', { conditions }, [child]);
  const projection = (columns, child, star = false) => node('projection', { columns, star }, [child]);
  const join = (conditions, left, right) => node('join', { conditions }, [left, right]);
  const product = (left, right) => node('product', {}, [left, right]);

  // ---------------------------------------------------------------- formatação
  const OP_SYMBOL = { '=': '=', '<>': '≠', '<': '<', '>': '>', '<=': '≤', '>=': '≥' };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const colKey = (c) => `${c.alias}.${c.name}`;

  function formatOperand(o, html) {
    if (o.type === 'Column') return html ? `<span class="ra-col">${esc(colKey(o))}</span>` : colKey(o);
    return html ? `<span class="ra-lit">${esc(o.value)}</span>` : o.value;
  }

  const AND = (html) => (html ? ' <span class="ra-and">∧</span> ' : ' ∧ ');

  function formatCondition(c, html = false) {
    switch (c.type) {
      case 'Compare': {
        const op = OP_SYMBOL[c.op];
        return `${formatOperand(c.left, html)} ${html ? `<span class="ra-cmp">${esc(op)}</span>` : op} ${formatOperand(c.right, html)}`;
      }
      case 'And': return c.items.map((i) => formatCondition(i, html)).join(AND(html));
      case 'Group': return `(${formatCondition(c.inner, html)})`;
      default: return '';
    }
  }

  const formatConditions = (list, html = false) => list.map((c) => formatCondition(c, html)).join(AND(html));

  function formatColumns(n, html = false) {
    if (n.star) return '*';
    return n.columns.map((c) => (html ? `<span class="ra-col">${esc(colKey(c))}</span>` : colKey(c))).join(', ');
  }

  /** Converte a árvore em expressão de álgebra relacional (texto ou HTML). */
  function toExpression(n, html = false) {
    const t = (s) => (html ? esc(s) : s);
    const sub = (s) => (html ? `<sub>${s}</sub>` : `[${s}]`);
    const op = (sym, cls) => (html ? `<span class="ra-op ra-op--${cls}">${sym}</span>` : sym);
    const rel = (s) => (html ? `<span class="ra-rel">${esc(s)}</span>` : s);
    const [l, r] = n.children;

    switch (n.kind) {
      case 'relation':
        return n.alias === n.table ? rel(n.table) : `${op('ρ', 'rho')}${sub(t(n.alias))}(${rel(n.table)})`;
      case 'selection':
        return `${op('σ', 'sel')}${sub(formatConditions(n.conditions, html))}(${toExpression(l, html)})`;
      case 'projection':
        return `${op('π', 'proj')}${sub(formatColumns(n, html))}(${toExpression(l, html)})`;
      case 'join':
        return `(${toExpression(l, html)} ${op('⋈', 'join')}${sub(formatConditions(n.conditions, html))} ${toExpression(r, html)})`;
      case 'product':
        return `(${toExpression(l, html)} ${op('×', 'prod')} ${toExpression(r, html)})`;
      default: return '';
    }
  }

  // ------------------------------------------------------------- utilitários
  function walk(n, fn, depth = 0) {
    fn(n, depth);
    n.children.forEach((c) => walk(c, fn, depth + 1));
  }

  function countNodes(n) {
    let count = 0;
    walk(n, () => { count++; });
    return count;
  }

  function height(n) {
    return 1 + Math.max(0, ...n.children.map(height));
  }

  /** Atributos produzidos por um nó. */
  function outputColumns(n) {
    switch (n.kind) {
      case 'relation':
        return QP.Metadata.TABLES[n.table].columns.map((c) => ({ type: 'Column', alias: n.alias, table: n.table, name: c }));
      case 'selection': return outputColumns(n.children[0]);
      case 'projection': return n.columns.slice();
      default: return n.children.flatMap(outputColumns);
    }
  }

  /**
   * HU2 – Tradução direta (canônica) da consulta resolvida:
   *   π_SELECT( σ_WHERE( ((R1 × R2) ⋈_ON1 R3) ⋈_ON2 R4 ... ) )
   */
  function buildCanonical(q) {
    let tree = null;
    q.relations.filter((r) => r.clause === 'FROM').forEach((rel) => {
      const leaf = relation(rel);
      tree = tree ? product(tree, leaf) : leaf;
    });
    for (const j of q.joins) tree = join([j.condition], tree, relation(j.relation));
    if (q.where) tree = selection([q.where], tree);
    return projection(q.projection, tree, q.select.star);
  }

  QP.Algebra = {
    resetIds, relation, selection, projection, join, product,
    buildCanonical, toExpression, formatCondition, formatConditions, formatColumns,
    outputColumns, colKey, walk, countNodes, height, OP_SYMBOL, esc,
  };
})(globalThis.QP = globalThis.QP || {});
