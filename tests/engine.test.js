const E = require('../js/engine.js');
const assert = require('assert');

function wb(cells, sheets) {
  const w = E.createWorkbook();
  w.sheets[0].cells = cells || {};
  if (sheets) w.sheets = sheets;
  return w;
}
function val(formula, cells, sheet) {
  const w = wb(cells);
  return E.evaluateFormula(formula, sheet || 'Hoja1', w);
}
function disp(formula, cells, fmt) {
  const w = wb(cells);
  const cell = { f: formula, __addr: 'Z1', style: { nf: fmt } };
  return E.cellDisplay(cell, w, 'Hoja1');
}

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('ok  ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + ' -> ' + e.message); }
}

const cells = {
  A1: { v: 10 }, A2: { v: 20 }, A3: { v: 30 }, A4: { v: 'texto' },
  B1: { v: 1 }, B2: { v: 2 }, B3: { v: 3 },
  C1: { f: '=A1+A2' },
  C2: { f: '=SUM(A1:A3)' },
  C3: { f: '=AVERAGE(A1:A3)' },
  C4: { f: '=IF(A1>5,"si","no")' },
  C5: { f: '=C1*2' },
  C6: { f: '=VLOOKUP(20,A1:B3,2,TRUE)' },
  C7: { f: '=COUNTA(A1:A4)' },
  C8: { f: '=COUNTIF(A1:A3,">15")' },
};

t('suma simple', () => assert.strictEqual(val('=1+2*3', cells), 7));
t('parentesis', () => assert.strictEqual(val('=(1+2)*3', cells), 9));
t('potencia', () => assert.strictEqual(val('=2^10', cells), 1024));
t('referencia', () => assert.strictEqual(val('=A1', cells), 10));
t('formula encadenada', () => assert.strictEqual(val('=C1', cells), 30));
t('SUMA rango', () => assert.strictEqual(val('=SUM(A1:A3)', cells), 60));
t('PROMEDIO', () => assert.strictEqual(val('=AVERAGE(A1:A3)', cells), 20));
t('SI', () => assert.strictEqual(val('=IF(A1>5,"si","no")', cells), 'si'));
t('CONCATENAR', () => assert.strictEqual(val('=CONCATENATE("a",A4,"b")', cells), 'atextob'));
t('CONTARA', () => assert.strictEqual(val('=COUNTA(A1:A4)', cells), 4));
t('CONTAR.SI', () => assert.strictEqual(val('=COUNTIF(A1:A3,">15")', cells), 2));
t('SUMAR.SI', () => assert.strictEqual(val('=SUMIF(A1:A3,">15")', cells), 50));
t('texto', () => assert.strictEqual(val('=UPPER("hola")', cells), 'HOLA'));
t('izquierda', () => assert.strictEqual(val('=LEFT("abcdef",3)', cells), 'abc'));
t('extrae', () => assert.strictEqual(val('=MID("abcdef",2,3)', cells), 'bcd'));
t('redondear', () => assert.strictEqual(val('=ROUND(3.14159,2)', cells), 3.14));
t('residuo', () => assert.strictEqual(val('=MOD(10,3)', cells), 1));
t('division cero', () => { const v = val('=1/0', cells); assert(E.isErr(v), 'debe ser error'); });
t('ciclo detectado', () => {
  const c = { A1: { f: '=B1' }, B1: { f: '=A1' } };
  const v = val('=A1', c);
  assert(E.isErr(v) && /CIRC/.test(v.code), 'esperaba CIRC, vino ' + JSON.stringify(v));
});
t('hoja cruzada', () => {
  const w = E.createWorkbook();
  w.sheets = [
    { name: 'Hoja1', cells: { A1: { v: 5 } } },
    { name: 'Datos', cells: { A1: { f: '=Hoja1!A1*3' } } }
  ];
  assert.strictEqual(E.evaluateFormula('=Hoja1!A1*2', 'Datos', w), 10);
  assert.strictEqual(E.evaluateFormula('=A1', 'Datos', w), 15);
});
t('formato moneda', () => assert.strictEqual(E.formatValue(1234.5, '$#,##0.00'), '$1,234.50'));
t('formato porcentaje', () => assert.strictEqual(E.formatValue(0.25, '0%'), '25%'));
t('formato fecha', () => {
  const serial = E.serialFromDate(new Date(2026, 0, 5));
  assert.strictEqual(E.formatValue(serial, 'dd/mm/yyyy'), '05/01/2026');
});
t('VLOOKUP', () => assert.strictEqual(val('=VLOOKUP(20,A1:B3,2,TRUE)', cells), 2));
t('INDICE', () => assert.strictEqual(val('=INDEX(A1:A3,2)', cells), 20));
t('error propagado', () => { const v = val('=A1/0+1', cells); assert(E.isErr(v)); });

console.log('\n' + pass + ' ok, ' + fail + ' fallos');
process.exit(fail ? 1 : 0);
