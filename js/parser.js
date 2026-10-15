/**
 * HU1 – Análise sintática.
 *
 * 1) Validação estrutural com expressão regular (SELECT … FROM … [WHERE …]).
 * 2) Parser descendente recursivo que percorre os tokens e gera a AST,
 *    seguindo a gramática abaixo (suporta 0..N JOINs e parênteses).
 */
(function (QP) {
  'use strict';
  const { SQLError } = QP;

  const GRAMMAR = [
    'consulta   ::= SELECT lista_sel FROM tabela { "," tabela } { juncao } [ WHERE condicao ] [ ";" ]',
    'lista_sel  ::= "*" | atributo { "," atributo }',
    'juncao     ::= [ INNER ] JOIN tabela ON condicao',
    'tabela     ::= IDENT [ [ AS ] IDENT ]',
    'condicao   ::= fator { AND fator }',
    'fator      ::= "(" condicao ")" | comparacao',
    'comparacao ::= operando OP operando',
    'operando   ::= atributo | NUMERO | STRING',
    'atributo   ::= IDENT [ "." IDENT ]',
    'OP         ::= "=" | "<>" | "<" | ">" | "<=" | ">="',
  ].join('\n');

  // Estrutura geral da consulta (case-insensitive)
  const STRUCTURE_REGEX = /^SELECT\b\s*(.+?)\s*\bFROM\b\s*(.+?)(?:\s*\bWHERE\b\s*(.+?))?\s*;?$/i;
  const JOIN_REGEX = /\b(?:INNER\s+)?JOIN\s+([A-Za-z_]\w*)(?:\s+(?:AS\s+)?(?!ON\b)([A-Za-z_]\w*))?\s+ON\b/gi;

  function describe(tok) {
    return tok.type === 'EOF' ? 'fim da consulta' : `'${tok.raw}'`;
  }

  class Parser {
    constructor(tokens) {
      this.tokens = tokens;
      this.i = 0;
    }

    peek(offset = 0) { return this.tokens[Math.min(this.i + offset, this.tokens.length - 1)]; }
    next() { const t = this.peek(); if (t.type !== 'EOF') this.i++; return t; }
    is(type) { return this.peek().type === type; }
    isKeyword(kw) { const t = this.peek(); return t.type === 'KEYWORD' && t.value === kw; }

    error(message, tok = this.peek()) {
      throw new SQLError(`${message}, mas foi encontrado ${describe(tok)}.`, 'sintático', tok.pos, Math.max(1, tok.raw.length));
    }
    expect(type, what) { if (!this.is(type)) this.error(`Esperado ${what}`); return this.next(); }
    expectKeyword(kw) { if (!this.isKeyword(kw)) this.error(`Esperado '${kw}'`); return this.next(); }

    // consulta
    parseQuery() {
      this.expectKeyword('SELECT');
      const select = this.parseSelectList();
      this.expectKeyword('FROM');

      const from = [this.parseTableRef()];
      while (this.is('COMMA')) { this.next(); from.push(this.parseTableRef()); }

      const joins = [];
      while (this.isKeyword('JOIN') || this.isKeyword('INNER')) {
        if (this.isKeyword('INNER')) this.next();
        this.expectKeyword('JOIN');
        const table = this.parseTableRef();
        this.expectKeyword('ON');
        const condition = this.parseCondition();
        joins.push({ table, condition });
      }

      let where = null;
      if (this.isKeyword('WHERE')) { this.next(); where = this.parseCondition(); }
      if (this.is('SEMICOLON')) this.next();
      if (!this.is('EOF')) this.error('Esperado fim da consulta, JOIN ou WHERE');

      return { type: 'Query', select, from, joins, where };
    }

    // lista_sel
    parseSelectList() {
      if (this.is('STAR')) { this.next(); return { star: true, columns: [] }; }
      const columns = [this.parseColumnRef()];
      while (this.is('COMMA')) { this.next(); columns.push(this.parseColumnRef()); }
      return { star: false, columns };
    }

    // atributo
    parseColumnRef() {
      const first = this.expect('IDENT', 'nome de atributo');
      if (this.is('DOT')) {
        this.next();
        const col = this.expect('IDENT', "nome de atributo após '.'");
        return { type: 'Column', qualifier: first.raw, name: col.raw, pos: first.pos, end: col.pos + col.raw.length };
      }
      return { type: 'Column', qualifier: null, name: first.raw, pos: first.pos, end: first.pos + first.raw.length };
    }

    // tabela
    parseTableRef() {
      const t = this.expect('IDENT', 'nome de tabela');
      let alias = null;
      if (this.isKeyword('AS')) { this.next(); alias = this.expect('IDENT', 'alias da tabela').raw; }
      else if (this.is('IDENT')) alias = this.next().raw;
      return { name: t.raw, alias, pos: t.pos, end: t.pos + t.raw.length };
    }

    // condicao ::= fator { AND fator }
    parseCondition() {
      const items = [this.parseFactor()];
      while (this.isKeyword('AND')) { this.next(); items.push(this.parseFactor()); }
      return items.length === 1 ? items[0] : { type: 'And', items };
    }

    // fator ::= "(" condicao ")" | comparacao
    parseFactor() {
      if (this.is('LPAREN')) {
        this.next();
        const inner = this.parseCondition();
        this.expect('RPAREN', "')' para fechar o parêntese");
        return { type: 'Group', inner };
      }
      return this.parseComparison();
    }

    // comparacao ::= operando OP operando
    parseComparison() {
      const left = this.parseOperand();
      const op = this.expect('OPERATOR', 'operador de comparação (=, <>, <, >, <=, >=)');
      const right = this.parseOperand();
      return { type: 'Compare', op: op.value, left, right };
    }

    // operando ::= atributo | NUMERO | STRING
    parseOperand() {
      const t = this.peek();
      if (t.type === 'NUMBER') { this.next(); return { type: 'Literal', kind: 'number', value: t.raw }; }
      if (t.type === 'STRING') { this.next(); return { type: 'Literal', kind: 'string', value: t.raw }; }
      if (t.type === 'IDENT') return this.parseColumnRef();
      return this.error('Esperado atributo, número ou texto');
    }
  }

  function parse(tokens) {
    return new Parser(tokens).parseQuery();
  }

  /** Validação estrutural por expressão regular. */
  function checkStructure(normalized) {
    const m = STRUCTURE_REGEX.exec(normalized);
    if (!m) {
      // Tenta obter um diagnóstico mais preciso via lexer/parser
      parse(QP.Lexer.tokenize(normalized));
      throw new SQLError('A consulta não segue a estrutura SELECT <atributos> FROM <tabelas> [JOIN … ON …] [WHERE <condições>].',
        'estrutural', 0, normalized.length);
    }
    const joins = [];
    JOIN_REGEX.lastIndex = 0;
    let j;
    while ((j = JOIN_REGEX.exec(m[2]))) joins.push(j[1]);
    return { pattern: STRUCTURE_REGEX.toString(), select: m[1], from: m[2], where: m[3] || null, joins };
  }

  QP.Parser = { parse, checkStructure, GRAMMAR, STRUCTURE_REGEX };
})(globalThis.QP = globalThis.QP || {});
