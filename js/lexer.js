/**
 * HU1 – Análise léxica.
 *
 * A string SQL é normalizada (espaços repetidos são ignorados) e quebrada em
 * tokens usando uma lista de expressões regulares "sticky" (/y), que tentam
 * casar exatamente na posição corrente da entrada.
 */
(function (QP) {
  'use strict';

  /** Erro de validação com fase e posição (para destacar na interface). */
  class SQLError extends Error {
    constructor(message, phase, pos = null, length = 1) {
      super(message);
      this.name = 'SQLError';
      this.phase = phase;
      this.pos = pos;
      this.length = length;
    }
  }

  // Comandos/operadores aceitos no trabalho
  const KEYWORDS = new Set(['SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'ON', 'AND', 'AS']);

  // Palavras SQL conhecidas, porém fora do escopo do trabalho
  const UNSUPPORTED = new Set([
    'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN', 'IS', 'NULL', 'EXISTS', 'GROUP', 'BY', 'ORDER', 'HAVING',
    'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'NATURAL', 'UNION', 'DISTINCT', 'LIMIT', 'TOP',
    'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'INTO', 'VALUES', 'SET',
  ]);

  // Especificação dos tokens (ordem importa)
  const RULES = [
    { type: 'WHITESPACE', regex: /\s+/y },
    { type: 'STRING', regex: /'(?:[^']|'')*'/y },
    { type: 'NUMBER', regex: /-?\d+(?:\.\d+)?(?![A-Za-z_0-9.])/y },
    { type: 'OPERATOR', regex: /<>|<=|>=|=|<|>/y },
    { type: 'IDENT', regex: /[A-Za-z_][A-Za-z0-9_]*/y },
    { type: 'COMMA', regex: /,/y },
    { type: 'DOT', regex: /\./y },
    { type: 'LPAREN', regex: /\(/y },
    { type: 'RPAREN', regex: /\)/y },
    { type: 'STAR', regex: /\*/y },
    { type: 'SEMICOLON', regex: /;/y },
  ];

  /** HU1: ignora repetições de espaços em branco / quebras de linha. */
  function normalize(sql) {
    return String(sql == null ? '' : sql).replace(/\s+/g, ' ').trim();
  }

  function tokenize(input) {
    const tokens = [];
    let pos = 0;

    while (pos < input.length) {
      let matched = null;
      let rule = null;
      for (const r of RULES) {
        r.regex.lastIndex = pos;
        const m = r.regex.exec(input);
        if (m) { matched = m[0]; rule = r; break; }
      }

      if (!matched) {
        const ch = input[pos];
        if (ch === "'") {
          throw new SQLError('Texto (string) não foi fechado: falta o apóstrofo final.', 'léxico', pos, input.length - pos);
        }
        if (ch === '!' && input[pos + 1] === '=') {
          throw new SQLError("Operador '!=' não é aceito. Use '<>' para diferente.", 'léxico', pos, 2);
        }
        if (/\d/.test(ch)) {
          const bad = /^[\w.]+/.exec(input.slice(pos))[0];
          throw new SQLError(`Token inválido '${bad}': identificadores não podem começar com dígito.`, 'léxico', pos, bad.length);
        }
        throw new SQLError(`Caractere inválido '${ch}' na posição ${pos + 1}. Operadores aceitos: =, >, <, <=, >=, <>, AND, ( ).`, 'léxico', pos, 1);
      }

      if (rule.type !== 'WHITESPACE') {
        let type = rule.type;
        let value = matched;
        if (type === 'IDENT') {
          const upper = matched.toUpperCase(); // HU1: case-insensitive
          if (KEYWORDS.has(upper)) {
            type = 'KEYWORD';
            value = upper;
          } else if (UNSUPPORTED.has(upper)) {
            throw new SQLError(
              `A palavra-chave '${matched}' não é suportada. Comandos aceitos: SELECT, FROM, WHERE, JOIN, ON e o operador lógico AND.`,
              'léxico', pos, matched.length,
            );
          }
        }
        tokens.push({ type, value, raw: matched, pos });
      }
      pos += matched.length;
    }

    tokens.push({ type: 'EOF', value: '', raw: '', pos: input.length });
    return tokens;
  }

  QP.SQLError = SQLError;
  QP.Lexer = { normalize, tokenize, KEYWORDS, UNSUPPORTED, RULES };
})(globalThis.QP = globalThis.QP || {});
