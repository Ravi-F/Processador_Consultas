/**
 * Orquestra o pipeline completo do Processador de Consultas:
 * entrada → normalização → regex → léxico → sintático → semântico (HU1)
 * → álgebra relacional (HU2) → grafo (HU3) → otimização (HU4) → plano (HU5).
 */
(function (QP) {
  'use strict';
  const { SQLError, Lexer, Parser, Validator, Algebra, Optimizer, Plan } = QP;

  const PHASES = [
    { id: 'normalize', name: 'Normalização', method: 'Espaços/quebras de linha repetidos colapsados com a regex /\\s+/g' },
    { id: 'structure', name: 'Validação estrutural', method: 'Expressão regular SELECT … FROM … [WHERE …] (case-insensitive)' },
    { id: 'lexer', name: 'Análise léxica', method: 'Tokenizador por expressões regulares sticky (/y); palavras-chave sem distinção de caixa' },
    { id: 'parser', name: 'Análise sintática', method: 'Parser descendente recursivo sobre a gramática (0..N JOINs, AND, parênteses)' },
    { id: 'semantic', name: 'Análise semântica', method: 'Existência de tabelas, aliases e atributos conferida nos metadados' },
    { id: 'algebra', name: 'Álgebra relacional', method: 'Tradução da AST para a árvore canônica π / σ / ⋈ / ×' },
    { id: 'optimize', name: 'Otimização heurística', method: 'Seleções e projeções empurradas, junções reordenadas, sem produto cartesiano' },
    { id: 'plan', name: 'Plano de execução', method: 'Percurso pós-ordem do grafo otimizado' },
  ];

  function process(sql) {
    const r = { input: sql, phases: [], ok: false };

    const run = (id, fn) => {
      const meta = PHASES.find((p) => p.id === id);
      try {
        const value = fn();
        r.phases.push({ ...meta, ok: true });
        return value;
      } catch (e) {
        const error = e instanceof SQLError ? e : new SQLError(`Erro interno: ${e.message}`, meta.name);
        r.phases.push({ ...meta, ok: false, error });
        throw error;
      }
    };

    try {
      Algebra.resetIds();
      r.normalized = run('normalize', () => {
        const n = Lexer.normalize(sql);
        if (!n) throw new SQLError('A consulta está vazia. Digite um comando SELECT.', 'de entrada');
        return n;
      });
      r.structure = run('structure', () => Parser.checkStructure(r.normalized));
      r.tokens = run('lexer', () => Lexer.tokenize(r.normalized));
      r.ast = run('parser', () => Parser.parse(r.tokens));
      r.query = run('semantic', () => Validator.validate(r.ast));

      r.canonicalTree = run('algebra', () => Optimizer.annotate(Algebra.buildCanonical(r.query)));
      const opt = run('optimize', () => Optimizer.optimize(r.query));
      r.optimizedTree = Optimizer.annotate(opt.tree);
      r.optimizationSteps = opt.steps;
      r.plan = run('plan', () => Plan.build(r.optimizedTree));

      r.algebra = {
        canonicalText: Algebra.toExpression(r.canonicalTree),
        canonicalHtml: Algebra.toExpression(r.canonicalTree, true),
        optimizedText: Algebra.toExpression(r.optimizedTree),
        optimizedHtml: Algebra.toExpression(r.optimizedTree, true),
      };
      r.cost = { canonical: Optimizer.cost(r.canonicalTree), optimized: Optimizer.cost(r.optimizedTree) };
      r.ok = true;
    } catch (e) {
      r.error = e instanceof SQLError ? e : new SQLError(String(e && e.message), 'interno');
    }
    return r;
  }

  QP.Processor = { process, PHASES };
})(globalThis.QP = globalThis.QP || {});
