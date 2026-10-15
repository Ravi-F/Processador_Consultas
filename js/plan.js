/**
 * HU5 – Plano de execução.
 *
 * A ordem de execução segue o grafo otimizado: percurso em pós-ordem
 * (filhos antes do pai, esquerda antes da direita). Cada operação gera uma
 * tabela temporária Tn consumida pelo operador pai.
 */
(function (QP) {
  'use strict';
  const A = QP.Algebra;

  function describe(n, inputs) {
    switch (n.kind) {
      case 'relation':
        return {
          operation: 'Leitura da tabela', symbol: '▤',
          detail: `Varrer a tabela ${n.table}${n.alias !== n.table ? ` (alias ${n.alias})` : ''}`,
        };
      case 'selection':
        return { operation: 'Seleção', symbol: 'σ', detail: `Filtrar ${inputs[0]} mantendo as tuplas com ${A.formatConditions(n.conditions)}` };
      case 'projection':
        return {
          operation: 'Projeção', symbol: 'π',
          detail: `Manter de ${inputs[0]} ${n.star ? 'todos os atributos (*)' : `apenas: ${A.formatColumns(n)}`}`,
        };
      case 'join':
        return { operation: 'Junção', symbol: '⋈', detail: `Juntar ${inputs[0]} com ${inputs[1]} onde ${A.formatConditions(n.conditions)}` };
      case 'product':
        return { operation: 'Produto cartesiano', symbol: '×', detail: `Combinar todas as tuplas de ${inputs[0]} com ${inputs[1]}` };
      default:
        return { operation: n.kind, symbol: '?', detail: '' };
    }
  }

  function build(tree) {
    const steps = [];
    (function visit(n) {
      const inputs = n.children.map(visit);
      const index = steps.length + 1;
      const output = `T${index}`;
      n.step = index;
      steps.push({ index, nodeId: n.id, kind: n.kind, inputs, output, est: n.est, ...describe(n, inputs) });
      return output;
    })(tree);
    steps[steps.length - 1].final = true;
    return steps;
  }

  function toText(steps) {
    return steps.map((s) => {
      const io = `${s.inputs.length ? s.inputs.join(', ') : '—'} → ${s.output}`;
      return `${String(s.index).padStart(2, ' ')}. [${s.operation}] ${s.detail}  (${io})${s.final ? '  ← resultado final' : ''}`;
    }).join('\n');
  }

  QP.Plan = { build, toText };
})(globalThis.QP = globalThis.QP || {});
