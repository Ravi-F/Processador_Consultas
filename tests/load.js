/* Carrega os módulos do navegador (scripts clássicos) no Node.js. */
const path = require('path');

globalThis.QP = {};
['metadata', 'lexer', 'parser', 'validator', 'algebra', 'optimizer', 'plan', 'processor']
  .forEach((f) => require(path.join(__dirname, '..', 'js', `${f}.js`)));

module.exports = globalThis.QP;
