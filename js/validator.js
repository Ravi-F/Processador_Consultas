/**
 * HU1 – Análise semântica.
 *
 * Verifica se as tabelas existem no modelo, se os aliases são únicos e se cada
 * atributo referenciado (SELECT, ON, WHERE) existe nas tabelas da consulta.
 * Produz uma consulta "resolvida", com nomes canônicos, usada pelas HU2–HU5.
 */
(function (QP) {
  'use strict';
  const M = QP.Metadata;
  const { SQLError } = QP;

  function validate(ast) {
    const scope = [];
    const references = [];

    const err = (msg, node) => new SQLError(msg, 'semântico',
      node && node.pos != null ? node.pos : null,
      node && node.end != null ? node.end - node.pos : 1);

    function declare(ref, clause) {
      const table = M.findTable(ref.name);
      if (!table) {
        throw err(`Tabela '${ref.name}' não existe no modelo de dados. Tabelas disponíveis: ${M.tableNames().join(', ')}.`, ref);
      }
      const alias = ref.alias || table;
      const key = alias.toLowerCase();
      if (scope.some((e) => e.key === key)) {
        throw err(`A tabela/alias '${alias}' foi declarada mais de uma vez. Use aliases diferentes (ex.: ${table} t1, ${table} t2).`, ref);
      }
      const other = ref.alias && M.findTable(ref.alias);
      if (other && other !== table) {
        throw err(`O alias '${ref.alias}' conflita com o nome da tabela ${other}.`, ref);
      }
      const entry = { table, alias, key, clause, rows: M.TABLES[table].rows };
      scope.push(entry);
      return entry;
    }

    const column = (entry, name) => ({ type: 'Column', alias: entry.alias, table: entry.table, name });

    function resolveColumn(col, visible, clause) {
      let entry;
      let name;
      if (col.qualifier) {
        const q = col.qualifier.toLowerCase();
        entry = visible.find((e) => e.key === q);
        if (!entry) {
          const byTable = visible.filter((e) => e.table.toLowerCase() === q);
          if (byTable.length === 1) entry = byTable[0];
        }
        if (!entry) {
          throw err(`Tabela ou alias '${col.qualifier}' não foi declarado ${clause === 'ON' ? 'antes deste JOIN' : 'no FROM/JOIN'}.`, col);
        }
        name = M.findColumn(entry.table, col.name);
        if (!name) {
          throw err(`Atributo '${col.name}' não existe na tabela ${entry.table}. Atributos: ${M.TABLES[entry.table].columns.join(', ')}.`, col);
        }
      } else {
        const matches = visible.filter((e) => M.findColumn(e.table, col.name));
        if (matches.length === 0) {
          throw err(`Atributo '${col.name}' não existe em nenhuma tabela da consulta (${visible.map((e) => e.table).join(', ')}).`, col);
        }
        if (matches.length > 1) {
          throw err(`Atributo '${col.name}' é ambíguo: existe em ${matches.map((e) => e.alias).join(' e ')}. Qualifique-o (ex.: ${matches[0].alias}.${col.name}).`, col);
        }
        entry = matches[0];
        name = M.findColumn(entry.table, col.name);
      }
      const resolved = column(entry, name);
      references.push({
        raw: col.qualifier ? `${col.qualifier}.${col.name}` : col.name,
        resolved: `${entry.table}.${name}`,
        alias: entry.alias,
        clause,
      });
      return resolved;
    }

    function resolveOperand(o, visible, clause) {
      return o.type === 'Column' ? resolveColumn(o, visible, clause) : { ...o };
    }

    function resolveCondition(c, visible, clause) {
      switch (c.type) {
        case 'And': return { type: 'And', items: c.items.map((i) => resolveCondition(i, visible, clause)) };
        case 'Group': return { type: 'Group', inner: resolveCondition(c.inner, visible, clause) };
        case 'Compare': return {
          type: 'Compare', op: c.op,
          left: resolveOperand(c.left, visible, clause),
          right: resolveOperand(c.right, visible, clause),
        };
        default: throw err('Condição inválida.', null);
      }
    }

    // 1) Declara as tabelas (FROM e JOINs)
    ast.from.forEach((ref) => declare(ref, 'FROM'));
    const joinEntries = ast.joins.map((j) => ({ entry: declare(j.table, 'JOIN'), ast: j }));

    // 2) SELECT
    let projection;
    if (ast.select.star) {
      projection = scope.flatMap((e) => M.TABLES[e.table].columns.map((c) => column(e, c)));
    } else {
      projection = [];
      const seen = new Set();
      for (const c of ast.select.columns) {
        const r = resolveColumn(c, scope, 'SELECT');
        const k = `${r.alias}.${r.name}`;
        if (!seen.has(k)) { seen.add(k); projection.push(r); }
      }
    }

    // 3) ON – só enxerga as tabelas declaradas até o JOIN correspondente
    const joins = joinEntries.map(({ entry, ast: j }) => {
      const visible = scope.slice(0, scope.indexOf(entry) + 1);
      return { relation: entry, condition: resolveCondition(j.condition, visible, 'ON') };
    });

    // 4) WHERE
    const where = ast.where ? resolveCondition(ast.where, scope, 'WHERE') : null;

    return {
      relations: scope,
      fromCount: ast.from.length,
      joins,
      where,
      select: { star: ast.select.star },
      projection,
      references,
    };
  }

  QP.Validator = { validate };
})(globalThis.QP = globalThis.QP || {});
