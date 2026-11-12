const { JSDOM, VirtualConsole } = require('jsdom');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail || e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

(async () => {
  const dom = await JSDOM.fromURL('http://127.0.0.1:8123/', {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const { window } = dom;
  await new Promise(r => window.addEventListener('load', r));
  await new Promise(r => setTimeout(r, 500));

  const d = window.document;
  const tds = d.querySelectorAll('td[data-r]').length;
  const tabs = d.querySelectorAll('.sheet-tab').length;
  const engine = !!window.XLEngine;
  const xlsx = typeof window.XLSX !== 'undefined';

  let nameAfter = null, calcText = '', wrote = null;
  const td = d.querySelector('td[data-r="1"][data-c="1"]');
  if (td) {
    td.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    nameAfter = d.getElementById('name-box').value;

    // escribir 5 en B2 mediante la barra de fÃ³rmulas
    const fi = d.getElementById('formula-input');
    fi.value = '5';
    fi.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 900));
    wrote = window.localStorage.getItem('excel-ligero:workbook:v1');
  }
  const wbStored = wrote ? JSON.parse(wrote) : null;
  const b2 = wbStored && wbStored.sheets[0].cells.B2 ? wbStored.sheets[0].cells.B2.v : null;

  const wb = window.XLEngine.createWorkbook();
  wb.sheets[0].cells.A1 = { v: 10 };
  wb.sheets[0].cells.A2 = { v: 32 };
  wb.sheets[0].cells.A3 = { f: '=SUMA(A1:A2)' };
  const total = window.XLEngine.evaluateFormula('=A3*2', 'Hoja1', wb);

  const result = { engine, xlsx, tds, tabs, nameAfter, b2, total, errors };
  console.log(JSON.stringify(result, null, 2));
  const ok = engine && xlsx && tds >= 2600 && tabs === 1 && nameAfter === 'B2' && b2 === 5 && total === 84 && errors.length === 0;
  console.log(ok ? 'SMOKE OK' : 'SMOKE FAIL');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });

