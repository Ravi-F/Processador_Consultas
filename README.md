# ⚙️ Processador de Consultas SQL

> Um processador completo de consultas SQL com análise léxica, parser descendente recursivo, conversão para álgebra relacional, construção e renderização gráfica de grafos de operadores em SVG, otimização por heurísticas e geração de plano de execução.

[![CI](https://github.com/Ravi-F/Processador_Consultas/actions/workflows/ci.yml/badge.svg)](https://github.com/Ravi-F/Processador_Consultas/actions/workflows/ci.yml)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 📌 Sumário

- [Visão Geral](#-visão-geral)
- [Funcionalidades e Histórias de Usuário (HU)](#-funcionalidades-e-histórias-de-usuário-hu)
  - [HU1 – Validação da Consulta SQL](#hu1--validação-da-consulta-sql)
  - [HU2 – Conversão para Álgebra Relacional](#hu2--conversão-para-álgebra-relacional)
  - [HU3 – Grafo de Operadores (Representação Gráfica)](#hu3--grafo-de-operadores-representação-gráfica)
  - [HU4 – Otimização Heurística](#hu4--otimização-heurística)
  - [HU5 – Plano de Execução](#hu5--plano-de-execução)
- [Interface Gráfica e Visualização](#-interface-gráfica-e-visualização)
- [Arquitetura e Estrutura do Projeto](#-arquitetura-e-estrutura-do-projeto)
- [Modelo de Dados (Catálogo)](#-modelo-de-dados-catálogo)
- [Gramática e Regras de Sintaxe](#-gramática-e-regras-de-sintaxe)
- [Como Executar Localmente](#-como-executar-localmente)
- [Executando Testes e Linter](#-executando-testes-e-linter)
- [Consultas de Exemplo](#-consultas-de-exemplo)

---

## 📖 Visão Geral

Este projeto simula o núcleo do subsistema de processamento e otimização de consultas de um Sistema de Gerenciamento de Banco de Dados Relacional (SGBD).

O fluxo completo transforma uma instrução SQL bruta em etapas determinísticas de execução:

```
 Consulta SQL
      │
      ▼
 [ Validação (HU1) ] ───────── Normalização, Regex, Léxico, Parser e Semântica
      │
      ▼
 [ Álgebra Relacional (HU2) ] ── π, σ, ⋈, ×, ρ
      │
      ▼
 [ Grafo Canônico (HU3) ] ───── Construção em árvore (folhas = tabelas, raiz = π)
      │
      ▼
 [ Otimização Heurística (HU4) ] Pushdown de σ e π, conversão de × em ⋈, reordenação
      │
      ▼
 [ Plano de Execução (HU5) ] ── Pós-ordem, resultados intermediários T₁, T₂, ..., Tₙ
```

---

## 🚀 Funcionalidades e Histórias de Usuário (HU)

### HU1 – Validação da Consulta SQL
- **Normalização:** remoção de espaços redundantes, quebras de linha e padronização preservando literais de texto.
- **Validação Estrutural:** verificação via expressões regulares das cláusulas fundamentais (`SELECT`, `FROM`, `JOIN ... ON ...`, `WHERE`).
- **Análise Léxica:** identificação e validação de tokens (`KEYWORD`, `IDENTIFIER`, `NUMBER`, `STRING`, `OPERATOR`, `PUNCTUATION`).
- **Parser Descendente Recursivo:** construção de Árvore Sintática Abstrata (AST) validando a gramática formal.
- **Validação Semântica:**
  - Checagem da existência de tabelas e atributos no catálogo do banco;
  - Detecção de atributos ambíguos não qualificados entre tabelas presentes na consulta;
  - Validação de escopo: cláusulas `ON` não podem referenciar tabelas declaradas posteriormente;
  - Restrição de operadores: aceita `=`, `<>`, `<`, `>`, `<=`, `>=`, `AND`, parênteses e alias (`AS`); rejeita operadores fora do escopo (`OR`, `LIKE`, `IN`, `BETWEEN`, `!=`).

### HU2 – Conversão para Álgebra Relacional
- Tradução canônica direta da consulta para notação formal de Álgebra Relacional:
  - `SELECT` $\to$ Projeção ($\pi$)
  - `WHERE` $\to$ Seleção ($\sigma$)
  - `JOIN ... ON` $\to$ Junção ($\Join$)
  - Múltiplas tabelas no `FROM` $\to$ Produto Cartesiano ($\times$)
  - Aliases $\to$ Renomeação ($\rho$)
  - Preservação exata das condições lógicas conjuntas com $\land$.
- Saída formatada tanto em **texto Unicode** quanto em **HTML com renderização matemática** e tabela de correspondência das cláusulas.

### HU3 – Grafo de Operadores (Representação Gráfica)
- Construção de grafo orientado em formato de árvore:
  - **Folhas (base):** tabelas do modelo de dados;
  - **Nós intermediários:** seleções ($\sigma$), junções ($\Join$) e projeções parciais;
  - **Raiz (topo):** projeção final ($\pi$).
- **Renderização SVG Dinâmica:**
  - Estilização específica por tipo de operador com ícones e métricas de cardinalidade estimada;
  - Arestas direcionadas com fluxo de dados animado dos nós filhos para os pais;
  - Suporte completo a **Pan** (arraste com mouse), **Zoom In**, **Zoom Out** e **Ajuste à tela (Fit)**;
  - Alternância de visualização entre o **Grafo Canônico** e o **Grafo Otimizado**.

### HU4 – Otimização Heurística
Transformação da árvore canônica em uma árvore otimizada aplicando as heurísticas clássicas de otimização relacional:
1. **Decomposição e Pushdown de Seleções ($\sigma$):** empurra as seleções conjuntivas para o nível mais baixo possível da árvore (logo acima das relações de origem);
2. **Prioridade para Seleções Mais Restritivas:** executa primeiro os filtros com menor seletividade estimada para reduzir tuplas precocemente;
3. **Conversão de Produto Cartesiano em Junção:** substitui operadores $\times$ por $\Join$ quando existe condição de junção no `WHERE`;
4. **Pushdown de Projeções Intermediárias ($\pi$):** elimina colunas desnecessárias logo após a leitura das relações, mantendo apenas atributos necessários para seleções, junções subsequentes e a projeção final;
5. **Reordenação de Junções:** prioriza iniciar a cadeia de junções pela relação que sofreu maior redução de tuplas;
6. **Cálculo de Custos:** estimativa de custo comparativa em **tuplas intermediárias** e **volume em bytes**, calculando a porcentagem de ganho e redução.

### HU5 – Plano de Execução
- Geração determinística de uma lista ordenada de passos a partir do percurso em **pós-ordem** do grafo otimizado.
- Cada etapa produz um resultado intermediário temporário ($T_1, T_2, \dots, T_n$), culminando no resultado final da consulta.
- Detalhamento de cada etapa com:
  - Identificador e operador relacional;
  - Origem dos dados (tabela em disco ou saídas temporárias anteriores);
  - Condição ou lista de projeção aplicada;
  - Estimativa de tuplas resultantes e atributos em trânsito;
  - **Interatividade bidirecional:** ao passar o cursor sobre uma etapa do plano, o nó correspondente no grafo SVG é destacado em tempo real.

---

## 💻 Interface Gráfica e Visualização

A aplicação disponibiliza uma interface visual desenvolvida com HTML5, CSS moderno e JavaScript Vanilla:

- **Sidebar do Editor:**
  - Campo de edição SQL com realce de sintaxe em tempo real;
  - Botão de execução rápida (<kbd>Ctrl + Enter</kbd>) e botão de limpeza;
  - Indicador de status em tempo real (*badge* que valida enquanto você digita);
  - Chips de consultas de exemplo clicáveis;
  - Catálogo de tabelas com filtro de busca e inserção rápida de atributos e tabelas com um clique.
- **Painel Central em Abas:**
  - `[1] Validação`: detalhamento de cada uma das 5 fases de validação com AST expansível em JSON;
  - `[2] Álgebra Relacional`: expressões canônica e otimizada com notação formal e botões de cópia;
  - `[3] Grafo de Operadores`: exibição interativa do SVG com ferramentas de navegação e legenda;
  - `[4] Otimização`: comparativo gráfico com barras de custo e histórico das regras heurísticas aplicadas;
  - `[5] Plano de Execução`: visualização do plano passo a passo integrado lado a lado com o grafo SVG interativo.

---

## 📂 Arquitetura e Estrutura do Projeto

```
Processador_Consultas/
├── .github/
│   └── workflows/
│       └── ci.yml             # Pipeline de Integração Contínua (CI) no GitHub Actions
├── css/
│   └── styles.css             # Design system, layout responsivo e animações da UI
├── js/
│   ├── metadata.js            # Catálogo e dicionário de dados (tabelas, PK/FK e cardinalidades)
│   ├── lexer.js               # Analisador léxico e definição de tokens
│   ├── parser.js              # Parser descendente recursivo e gramática
│   ├── validator.js           # Normalização, validação regex e semântica
│   ├── algebra.js             # Modelagem e formatação da Álgebra Relacional
│   ├── optimizer.js           # Motor de otimização por heurísticas e cálculo de custos
│   ├── plan.js                # Gerador do plano de execução (pós-ordem)
│   ├── processor.js           # Orquestrador do pipeline unificado (HU1–HU5)
│   ├── graph-renderer.js      # Renderizador do grafo de operadores em SVG (Pan/Zoom/Flow)
│   └── app.js                 # Inicializador e controlador da interface gráfica
├── tests/
│   ├── load.js                # Carregador de módulos para o ambiente Node.js
│   └── processor.test.js      # Bateria de testes automatizados unitários (HU1–HU5)
├── index.html                 # Página principal da aplicação
└── package.json               # Configurações do projeto e scripts npm
```

---

## 🗄️ Modelo de Dados (Catálogo)

O catálogo inclui 10 tabelas relacionais com dados estatísticos fictícios para avaliação heurística:

| Tabela | Chave Primária (PK) | Chaves Estrangeiras (FK) | Tuplas Estimadas |
|---|---|---|---|
| **TipoCliente** | `idTipoCliente` | — | 5 |
| **Cliente** | `idCliente` | `TipoCliente_idTipoCliente` | 100.000 |
| **Endereco** | `idEndereco` | `Cliente_idCliente` | 120.000 |
| **Telefone** | `idTelefone` | `Cliente_idCliente` | 150.000 |
| **Status** | `idStatus` | — | 8 |
| **FormaPagamento**| `idFormaPagamento` | — | 6 |
| **Pedido** | `idPedido` | `Cliente_idCliente`, `Status_idStatus`, `FormaPagamento_idFormaPagamento` | 500.000 |
| **Categoria** | `idCategoria` | — | 50 |
| **Produto** | `idProduto` | `Categoria_idCategoria` | 20.000 |
| **Pedido_has_Produto** | — | `Pedido_idPedido`, `Produto_idProduto` | 1.500.000 |

---

## 📝 Gramática e Regras de Sintaxe

O processador aceita consultas com a seguinte estrutura básica:

```sql
SELECT [DISTINCT] ( * | coluna [, coluna ...] )
FROM tabela [alias] [, tabela [alias] ...]
[ [INNER] JOIN tabela [alias] ON condicao ... ]
[ WHERE condicao [ AND condicao ... ] ]
```

### Operadores Aceitos:
- **Comparação:** `=`, `<>`, `<`, `>`, `<=`, `>=`
- **Conjunção:** `AND`
- **Agrupamento:** Parênteses `( ... )`
- **Identificadores:** Nomes de tabelas e atributos qualificados (`Tabela.Coluna`) ou com alias (`t.coluna`)
- **Literais:** Números inteiros/decimais e strings delimitadas por aspas simples (`'texto'`)

---

## 🛠️ Como Executar Localmente

### Pré-requisitos
- **Node.js** (versão 18 ou superior)
- Um navegador web moderno (Chrome, Firefox, Edge, Safari)

### 1. Clonar o repositório
```bash
git clone https://github.com/Ravi-F/Processador_Consultas.git
cd Processador_Consultas
```

### 2. Iniciar a aplicação
O projeto utiliza um servidor estático local:

```bash
npm start
```
Após executar, acesse o endereço indicado no terminal (por padrão `http://localhost:5173`) no seu navegador.

> **Dica:** Você também pode abrir o arquivo `index.html` diretamente em seu navegador sem necessidade de servidor.

---

## 🧪 Executando Testes e Linter

### Testes Automatizados (Node Test Runner)
Executa 20 testes unitários cobrindo todos os cenários das histórias de usuário (HU1 a HU5):
```bash
npm test
```

### Verificação de Sintaxe (Linter)
Verifica a integridade e sintaxe de todos os arquivos JavaScript com o verificador do Node.js:
```bash
npm run lint
```

---

## 💡 Consultas de Exemplo

Experimente testar estas consultas no editor:

#### 1. Seleção Simples em Uma Tabela
```sql
SELECT Nome, Email
FROM Cliente
WHERE idCliente = 10
```

#### 2. Junção com Filtros Concomitantes
```sql
SELECT Cliente.Nome, Pedido.DataPedido, Pedido.ValorTotalPedido
FROM Cliente
JOIN Pedido ON Cliente.idCliente = Pedido.Cliente_idCliente
WHERE Pedido.ValorTotalPedido > 500
```

#### 3. Múltiplos JOINs com Aliases e Várias Condições
```sql
SELECT c.Nome, p.DataPedido, pr.Nome, cat.Descricao
FROM Cliente c
JOIN Pedido p ON c.idCliente = p.Cliente_idCliente
JOIN Pedido_has_Produto pp ON p.idPedido = pp.Pedido_idPedido
JOIN Produto pr ON pp.Produto_idProduto = pr.idProduto
JOIN Categoria cat ON pr.Categoria_idCategoria = cat.idCategoria
WHERE cat.Descricao = 'Eletrônicos' 
  AND p.ValorTotalPedido >= 1000
  AND c.TipoCliente_idTipoCliente = 2
```

#### 4. Produto Cartesiano no FROM (Convertido em Junção pela Otimização)
```sql
SELECT c.Nome, e.Cidade, e.UF
FROM Cliente c, Endereco e
WHERE c.idCliente = e.Cliente_idCliente
  AND e.UF = 'SP' 
  AND c.Nascimento >= '1990-01-01'
```

---

## 📄 Licença

Este projeto está sob a licença [MIT](LICENSE).
