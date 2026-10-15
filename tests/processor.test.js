const test = require('node:test');
const assert = require('node:assert/strict');
const QP = require('./load');

const run = (sql) => QP.Processor.process(sql);
const kinds = (tree) => { const out = []; QP.Algebra.walk(tree, (n) => out.push(n.kind)); return out; };
const findAll = (tree, kind) => { const out = []; QP.Algebra.walk(tree, (n) => { if (n.kind === kind) out.push(n); }); return out; };

// ------------------------------------------------------------------ HU1
test('HU1: consulta simples válida', () => {
  const r = run('SELECT Nome, Email FROM Cliente WHERE idCliente = 10');
  assert.ok(r.ok, r.error && r.error.message);
  assert.equal(r.query.projection.length, 2);
});

test('HU1: ignora maiúsculas/minúsculas e espaços repetidos', () => {
  const r = run('  select   nome ,EMAIL\n\n  from    cliente   where  IDCLIENTE   =  10 ');
  assert.ok(r.ok, r.error && r.error.message);
  assert.equal(r.normalized, 'select nome ,EMAIL from cliente where IDCLIENTE = 10');
  assert.deepEqual(r.query.projection.map((c) => c.name), ['Nome', 'Email']);
});

test('HU1: tabela inexistente', () => {
  const r = run('SELECT Nome FROM Funcionario');
  assert.equal(r.ok, false);
  assert.equal(r.error.phase, 'semântico');
  assert.match(r.error.message, /Funcionario/);
});

test('HU1: atributo inexistente', () => {
  const r = run('SELECT Nome, Salario FROM Cliente');
  assert.equal(r.ok, false);
  assert.match(r.error.message, /Salario/);
});

test('HU1: atributo ambíguo exige qualificação', () => {
  const r = run('SELECT Descricao FROM Produto JOIN Categoria ON Produto.Categoria_idCategoria = Categoria.idCategoria');
  assert.equal(r.ok, false);
  assert.match(r.error.message, /ambíguo/);
});

test('HU1: operadores fora do escopo são rejeitados', () => {
  assert.equal(run('SELECT Nome FROM Cliente WHERE idCliente = 1 OR idCliente = 2').ok, false);
  assert.equal(run('SELECT Nome FROM Cliente WHERE idCliente != 1').ok, false);
  assert.equal(run('SELECT Nome FROM Cliente WHERE idCliente LIKE 1').ok, false);
});

test('HU1: todos os operadores válidos e parênteses', () => {
  const r = run("SELECT Nome FROM Produto WHERE (Preco >= 10 AND Preco <= 50) AND QuantEstoque > 0 AND Preco < 100 AND idProduto <> 3 AND Nome = 'X'");
  assert.ok(r.ok, r.error && r.error.message);
});

test('HU1: erros de sintaxe', () => {
  assert.equal(run('SELECT FROM Cliente').ok, false);
  assert.equal(run('SELECT Nome Cliente').ok, false);
  assert.equal(run('SELECT Nome FROM Cliente WHERE (idCliente = 1').ok, false);
  assert.equal(run('SELECT Nome FROM Cliente JOIN Pedido').ok, false);
  assert.equal(run('').ok, false);
});

test('HU1: 0, 1 e N JOINs com aliases', () => {
  const r = run(`SELECT c.Nome, pr.Nome FROM Cliente c
    JOIN Pedido p ON c.idCliente = p.Cliente_idCliente
    INNER JOIN Pedido_has_Produto AS pp ON p.idPedido = pp.Pedido_idPedido
    JOIN Produto pr ON pp.Produto_idProduto = pr.idProduto`);
  assert.ok(r.ok, r.error && r.error.message);
  assert.equal(r.query.relations.length, 4);
  assert.equal(r.query.joins.length, 3);
});

test('HU1: ON não pode referenciar tabela declarada depois', () => {
  const r = run('SELECT Cliente.Nome FROM Cliente JOIN Pedido ON Pedido.idPedido = Produto.idProduto JOIN Produto ON Produto.idProduto = 1');
  assert.equal(r.ok, false);
});

// ------------------------------------------------------------------ HU2
test('HU2: álgebra relacional contém π, σ e ⋈ preservando condições', () => {
  const r = run('SELECT Cliente.Nome FROM Cliente JOIN Pedido ON Cliente.idCliente = Pedido.Cliente_idCliente WHERE Pedido.ValorTotalPedido >= 500');
  assert.ok(r.ok);
  const t = r.algebra.canonicalText;
  assert.match(t, /^π\[Cliente\.Nome\]\(σ\[Pedido\.ValorTotalPedido ≥ 500\]\(\(Cliente ⋈\[Cliente\.idCliente = Pedido\.Cliente_idCliente\] Pedido\)\)\)$/);
});

// ------------------------------------------------------------------ HU3
test('HU3: folhas são tabelas e a raiz é a projeção final', () => {
  const r = run('SELECT c.Nome FROM Cliente c JOIN Pedido p ON c.idCliente = p.Cliente_idCliente');
  for (const tree of [r.canonicalTree, r.optimizedTree]) {
    assert.equal(tree.kind, 'projection');
    QP.Algebra.walk(tree, (n) => { if (!n.children.length) assert.equal(n.kind, 'relation'); });
  }
});

// ------------------------------------------------------------------ HU4
test('HU4: seleções são empurradas para logo acima das folhas', () => {
  const r = run("SELECT c.Nome FROM Cliente c JOIN Pedido p ON c.idCliente = p.Cliente_idCliente WHERE p.ValorTotalPedido > 100 AND c.Nome = 'Ana'");
  const sels = findAll(r.optimizedTree, 'selection');
  assert.equal(sels.length, 2);
  sels.forEach((s) => assert.equal(s.children[0].kind, 'relation'));
});

test('HU4: seleção mais restritiva executa primeiro', () => {
  const r = run("SELECT Nome FROM Cliente WHERE Nascimento > '2000-01-01' AND idCliente = 5");
  const sels = findAll(r.optimizedTree, 'selection'); // pré-ordem: externa primeiro
  assert.equal(sels.length, 2);
  assert.match(QP.Algebra.formatConditions(sels[1].conditions), /idCliente = 5/); // mais interna
});

test('HU4: produto cartesiano é convertido em junção', () => {
  const r = run("SELECT c.Nome, e.Cidade FROM Cliente c, Endereco e WHERE c.idCliente = e.Cliente_idCliente AND e.UF = 'SP'");
  assert.ok(kinds(r.canonicalTree).includes('product'));
  assert.ok(!kinds(r.optimizedTree).includes('product'));
  assert.equal(findAll(r.optimizedTree, 'join').length, 1);
});

test('HU4: projeções intermediárias reduzem atributos', () => {
  const r = run('SELECT c.Nome, p.DataPedido FROM Cliente c JOIN Pedido p ON c.idCliente = p.Cliente_idCliente');
  const projs = findAll(r.optimizedTree, 'projection');
  assert.ok(projs.length >= 3, 'π na raiz + π em cada tabela');
  const pCliente = projs.find((p) => p.columns.every((c) => c.alias === 'c'));
  assert.deepEqual(pCliente.columns.map((c) => c.name), ['idCliente', 'Nome']);
});

test('HU4: junção mais restritiva primeiro (tabela filtrada inicia)', () => {
  const r = run(`SELECT c.Nome FROM Cliente c JOIN Pedido p ON c.idCliente = p.Cliente_idCliente
    JOIN Status s ON p.Status_idStatus = s.idStatus WHERE c.idCliente = 7`);
  let leftmost = r.optimizedTree;
  while (leftmost.children.length) leftmost = leftmost.children[0];
  assert.equal(leftmost.table, 'Cliente');
});

test('HU4: custo estimado otimizado é menor que o canônico', () => {
  const r = run("SELECT c.Nome, e.Cidade FROM Cliente c, Endereco e WHERE c.idCliente = e.Cliente_idCliente AND e.UF = 'SP'");
  assert.ok(r.cost.optimized.tuples < r.cost.canonical.tuples);
});

test('HU4: sem projeção duplicada para consulta de uma tabela', () => {
  const r = run('SELECT Nome FROM Cliente');
  assert.deepEqual(kinds(r.optimizedTree), ['projection', 'relation']);
});

// ------------------------------------------------------------------ HU5
test('HU5: plano segue pós-ordem do grafo otimizado e termina na raiz', () => {
  const r = run("SELECT c.Nome FROM Cliente c JOIN Pedido p ON c.idCliente = p.Cliente_idCliente WHERE p.ValorTotalPedido > 100");
  assert.equal(r.plan.length, QP.Algebra.countNodes(r.optimizedTree));
  assert.equal(r.plan[0].kind, 'relation');
  const last = r.plan[r.plan.length - 1];
  assert.equal(last.kind, 'projection');
  assert.ok(last.final);
  // cada entrada referencia somente saídas de passos anteriores
  r.plan.forEach((s) => s.inputs.forEach((i) => assert.ok(Number(i.slice(1)) < s.index)));
});
