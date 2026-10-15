/**
 * HU1 – Metadados do modelo de dados de referência (Imagem 01).
 *
 * Apenas as tabelas/atributos listados aqui podem ser usados nas consultas.
 * Cada tabela também possui uma chave primária (pk) e uma cardinalidade
 * estimada (rows) – usadas pelo otimizador (HU4) para estimar a seletividade
 * das seleções/junções e escolher as operações mais restritivas primeiro.
 */
(function (QP) {
  'use strict';

  const TABLES = {
    Categoria: {
      pk: 'idCategoria', rows: 50,
      columns: ['idCategoria', 'Descricao'],
    },
    Produto: {
      pk: 'idProduto', rows: 2000,
      columns: ['idProduto', 'Nome', 'Descricao', 'Preco', 'QuantEstoque', 'Categoria_idCategoria'],
    },
    TipoCliente: {
      pk: 'idTipoCliente', rows: 5,
      columns: ['idTipoCliente', 'Descricao'],
    },
    Cliente: {
      pk: 'idCliente', rows: 10000,
      columns: ['idCliente', 'Nome', 'Email', 'Nascimento', 'Senha', 'TipoCliente_idTipoCliente', 'DataRegistro'],
    },
    TipoEndereco: {
      pk: 'idTipoEndereco', rows: 4,
      columns: ['idTipoEndereco', 'Descricao'],
    },
    Endereco: {
      pk: 'idEndereco', rows: 15000,
      columns: ['idEndereco', 'EnderecoPadrao', 'Logradouro', 'Numero', 'Complemento', 'Bairro', 'Cidade', 'UF',
        'CEP', 'TipoEndereco_idTipoEndereco', 'Cliente_idCliente'],
    },
    Telefone: {
      pk: 'Numero', rows: 18000,
      columns: ['Numero', 'Cliente_idCliente'],
    },
    Status: {
      pk: 'idStatus', rows: 6,
      columns: ['idStatus', 'Descricao'],
    },
    Pedido: {
      pk: 'idPedido', rows: 50000,
      columns: ['idPedido', 'Status_idStatus', 'DataPedido', 'ValorTotalPedido', 'Cliente_idCliente'],
    },
    Pedido_has_Produto: {
      pk: 'idPedidoProduto', rows: 150000,
      columns: ['idPedidoProduto', 'Pedido_idPedido', 'Produto_idProduto', 'Quantidade', 'PrecoUnitario'],
    },
  };

  // Índice case-insensitive (HU1: ignorar maiúsculas/minúsculas)
  const tableIndex = new Map(Object.keys(TABLES).map((name) => [name.toLowerCase(), name]));

  /** Retorna o nome canônico da tabela ou null. */
  function findTable(name) {
    return tableIndex.get(String(name).toLowerCase()) || null;
  }

  /** Retorna o nome canônico do atributo na tabela ou null. */
  function findColumn(table, column) {
    const t = TABLES[table];
    if (!t) return null;
    const lc = String(column).toLowerCase();
    return t.columns.find((c) => c.toLowerCase() === lc) || null;
  }

  /** Detecta chave estrangeira pela convenção Tabela_idTabela. */
  const FK_REGEX = /^([A-Za-z]+)_id([A-Za-z]+)$/;
  function fkTarget(column) {
    const m = FK_REGEX.exec(column);
    return m ? findTable(m[1]) : null;
  }

  QP.Metadata = {
    TABLES,
    findTable,
    findColumn,
    fkTarget,
    tableNames: () => Object.keys(TABLES),
    getColumns: (table) => TABLES[table].columns.slice(),
    getRowCount: (table) => TABLES[table].rows,
  };
})(globalThis.QP = globalThis.QP || {});
