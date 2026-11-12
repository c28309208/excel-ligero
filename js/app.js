/* Excel Ligero — interfaz: rejilla, edición, formato, hojas, importar/exportar y conexiones. */
(function () {
  'use strict';

  const E = window.XLEngine;
  const ROWS = 100;
  const COLS = 26;
  const COLW = 96;
  const STORE_KEY = 'excel-ligero:workbook:v1';
  const UNDO_MAX = 60;

  // ------------------------------------------------------------ estado
  let wb = loadWorkbook() || E.createWorkbook();
  wb.connections = wb.connections || [];
  let sel = { anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } };
  let editing = null;
  let undoStack = [];
  let redoStack = [];
  let saveTimer = null;
  let dragging = false;

  const $ = (id) => document.getElementById(id);
  const sheetEl = $('sheet');
  const gridWrap = $('grid-wrap');
  const formulaInput = $('formula-input');
  const nameBox = $('name-box');
  const statusMsg = $('status-msg');
  const statusCalc = $('status-calc');
  const tabsEl = $('sheet-tabs');

  const cur = () => wb.sheets[wb.active];
  const addr = (r, c) => E.toA1(r, c);
  const cellOf = (r, c) => cur().cells[addr(r, c)];
  const rawOf = (cell) => !cell ? '' : (cell.f ? cell.f : (cell.v === undefined ? '' : String(cell.v)));

  function setStatus(msg) { statusMsg.textContent = msg; }

  // ------------------------------------------------------------ persistencia
  function saveWorkbook() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(wb)); } catch (e) { /* cuota llena */ }
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveWorkbook, 400);
  }
  function loadWorkbook() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const w = JSON.parse(raw);
      if (!w || !Array.isArray(w.sheets) || !w.sheets.length) return null;
      w.sheets.forEach(s => { s.cells = s.cells || {}; s.cols = s.cols || {}; });
      return w;
    } catch (e) { return null; }
  }

  // ------------------------------------------------------------ undo
  function snapshot() { return JSON.stringify({ sheets: wb.sheets, active: wb.active, connections: wb.connections }); }
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack.length = 0;
  }
  function applySnapshot(json) {
    const s = JSON.parse(json);
    wb.sheets = s.sheets;
    wb.active = Math.min(s.active || 0, wb.sheets.length - 1);
    wb.connections = s.connections || [];
    clampSelection();
    render();
    scheduleSave();
  }
  function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); applySnapshot(undoStack.pop()); setStatus('Deshecho'); }
  function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); applySnapshot(redoStack.pop()); setStatus('Rehecho'); }

  // ------------------------------------------------------------ edición
  function commitValue(r, c, raw) {
    const s = cur();
    const a = addr(r, c);
    const old = s.cells[a];
    if (raw === '' || raw === null || raw === undefined) { delete s.cells[a]; return; }
    const st = old && old.style ? { style: old.style } : {};
    if (typeof raw === 'string' && raw.charAt(0) === '=') {
      s.cells[a] = Object.assign({ f: raw }, st);
    } else if (typeof raw === 'number') {
      s.cells[a] = Object.assign({ v: raw }, st);
    } else if (typeof raw === 'boolean') {
      s.cells[a] = Object.assign({ v: raw }, st);
    } else {
      const t = String(raw).trim();
      if (t !== '' && !isNaN(Number(t)) && /^-?\d+(\.\d+)?$/.test(t)) s.cells[a] = Object.assign({ v: Number(t) }, st);
      else if (/^(verdadero|true)$/i.test(t)) s.cells[a] = Object.assign({ v: true }, st);
      else if (/^(falso|false)$/i.test(t)) s.cells[a] = Object.assign({ v: false }, st);
      else s.cells[a] = Object.assign({ v: String(raw) }, st);
    }
  }

  function setCell(raw) {
    if (!editing) return;
    const { r, c } = editing;
    const s = cur();
    const before = rawOf(s.cells[addr(r, c)]);
    if (before === raw) { stopEdit(); return; }
    pushUndo();
    commitValue(r, c, raw);
    stopEdit();
    scheduleSave();
    render();
    setStatus('Celda ' + addr(r, c) + ' actualizada');
  }

  function clearSelection() {
    const range = selRange();
    pushUndo();
    for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) delete cur().cells[addr(r, c)];
    scheduleSave();
    render();
    setStatus('Contenido borrado');
  }

  // ------------------------------------------------------------ rejilla
  function selRange() {
    const a = sel.anchor, f = sel.focus;
    return { r1: Math.min(a.r, f.r), r2: Math.max(a.r, f.r), c1: Math.min(a.c, f.c), c2: Math.max(a.c, f.c) };
  }

  function isActive(r, c) {
    const f = sel.focus;
    return f.r === r && f.c === c;
  }
  function inRange(r, c) {
    const rg = selRange();
    return r >= rg.r1 && r <= rg.r2 && c >= rg.c1 && c <= rg.c2;
  }

  function displayFor(cell, r, c, cache, visiting) {
    if (!cell) return '';
    if (cell.f) {
      const v = E.cellValue(wb, cur().name, r, c, cache, visiting);
      return E.formatValue(v, cell.style && cell.style.nf);
    }
    return E.formatValue(cell.v, cell.style && cell.style.nf);
  }

  function render() {
    if (editing) return;
    const s = cur();
    const cache = new Map();
    const visiting = new Set();
    const cols = s.cols || {};

    let html = '<thead><tr><th class="corner"></th>';
    for (let c = 0; c < COLS; c++) {
      const w = cols[c] || COLW;
      html += '<th data-c="' + c + '" style="width:' + w + 'px;min-width:' + w + 'px">' + E.colName(c) + '</th>';
    }
    html += '</tr></thead><tbody>';

    for (let r = 0; r < ROWS; r++) {
      html += '<tr><th>' + (r + 1) + '</th>';
      for (let c = 0; c < COLS; c++) {
        const cell = s.cells[addr(r, c)];
        const text = displayFor(cell, r, c, cache, visiting);
        const isErr = text && text.charAt(0) === '#';
        const num = cell && ((cell.f && !isErr) || typeof cell.v === 'number');
        let style = 'width:' + (cols[c] || COLW) + 'px;min-width:' + (cols[c] || COLW) + 'px;';
        if (cell && cell.style) {
          const st = cell.style;
          if (st.b) style += 'font-weight:700;';
          if (st.i) style += 'font-style:italic;';
          if (st.u) style += 'text-decoration:underline;';
          if (st.color) style += 'color:' + st.color + ';';
          if (st.bg) style += 'background:' + st.bg + ';';
          if (st.align) style += 'text-align:' + st.align + ';';
        }
        const cls = 'cell' + (num ? ' num' : '') + (isActive(r, c) ? ' active' : '') + (inRange(r, c) ? ' in-range' : '');
        html += '<td class="' + cls + '" data-r="' + r + '" data-c="' + c + '" style="' + style + '">' +
          (isErr ? '<span class="err">' + escapeHtml(text) + '</span>' : escapeHtml(text)) + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody>';
    sheetEl.innerHTML = html;

    tabsEl.innerHTML = wb.sheets.map((sh, i) =>
      '<button class="sheet-tab' + (i === wb.active ? ' active' : '') + '" data-i="' + i + '">' +
      escapeHtml(sh.name) + '<span class="x" data-del="' + i + '" title="Renombrar">✎</span></button>').join('');

    updateFormulaBar();
    updateStatusCalc();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  function updateFormulaBar() {
    const f = sel.focus;
    nameBox.value = addr(f.r, f.c);
    const cell = cellOf(f.r, f.c);
    formulaInput.value = rawOf(cell);
    const nf = (cell && cell.style && cell.style.nf) || 'General';
    const fmtSel = $('num-format');
    fmtSel.value = nf;
    if (fmtSel.value !== nf) fmtSel.value = 'General';
  }

  function updateStatusCalc() {
    const rg = selRange();
    const cache = new Map(); const visiting = new Set();
    let sum = 0, count = 0, nums = [];
    for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) {
      const cell = cur().cells[addr(r, c)];
      if (!cell) continue;
      let v;
      if (cell.f) v = E.cellValue(wb, cur().name, r, c, cache, visiting);
      else v = cell.v;
      if (typeof v === 'number' && isFinite(v)) { sum += v; count++; nums.push(v); }
    }
    const area = (rg.r2 - rg.r1 + 1) * (rg.c2 - rg.c1 + 1);
    if (count > 0) {
      const avg = sum / count;
      statusCalc.textContent = 'Suma: ' + E.formatValue(sum) + ' · Promedio: ' + E.formatValue(avg) + ' · Cuenta: ' + count;
    } else {
      statusCalc.textContent = area > 1 ? 'Celdas seleccionadas: ' + area : '';
    }
  }

  // ------------------------------------------------------------ selección
  function clampSelection() {
    sel.anchor.r = Math.max(0, Math.min(ROWS - 1, sel.anchor.r));
    sel.anchor.c = Math.max(0, Math.min(COLS - 1, sel.anchor.c));
    sel.focus.r = Math.max(0, Math.min(ROWS - 1, sel.focus.r));
    sel.focus.c = Math.max(0, Math.min(COLS - 1, sel.focus.c));
    if (wb.active >= wb.sheets.length) wb.active = 0;
  }

  function select(r, c, extend) {
    if (extend) sel.focus = { r, c };
    else { sel.anchor = { r, c }; sel.focus = { r, c }; }
    clampSelection();
    render();
    scrollToCell(sel.focus.r, sel.focus.c);
  }

  function scrollToCell(r, c) {
    const td = sheetEl.querySelector('td[data-r="' + r + '"][data-c="' + c + '"]');
    if (!td) return;
    const wrap = gridWrap;
    const top = td.offsetTop - 26, left = td.offsetLeft - 44;
    if (top < wrap.scrollTop) wrap.scrollTop = top;
    if (top + 24 > wrap.scrollTop + wrap.clientHeight) wrap.scrollTop = top + 24 - wrap.clientHeight;
    if (left < wrap.scrollLeft) wrap.scrollLeft = left;
    if (left + td.offsetWidth > wrap.scrollLeft + wrap.clientWidth) wrap.scrollLeft = left + td.offsetWidth - wrap.clientWidth;
  }

  // ------------------------------------------------------------ edición inline
  function startEdit(initial) {
    if (editing) return;
    const { r, c } = sel.focus;
    const td = sheetEl.querySelector('td[data-r="' + r + '"][data-c="' + c + '"]');
    if (!td) return;
    const cell = cellOf(r, c);
    const raw = initial !== undefined ? initial : rawOf(cell);
    editing = { r, c, td, original: rawOf(cell) };
    td.classList.add('editing');
    td.contentEditable = 'true';
    td.textContent = raw;
    td.focus();
    const range = document.createRange();
    range.selectNodeContents(td);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
    setStatus('Editando ' + addr(r, c) + ' — Enter para confirmar, Esc para cancelar');
  }

  function stopEdit() {
    if (!editing) return;
    const td = editing.td;
    td.contentEditable = 'false';
    td.classList.remove('editing');
    editing = null;
    gridWrap.focus();
  }

  function cancelEdit() {
    if (!editing) return;
    stopEdit();
    render();
  }

  function commitEdit() {
    if (!editing) return;
    const raw = editing.td.textContent.replace(/\u00a0/g, ' ').trim();
    stopEdit();
    const r = sel.focus.r, c = sel.focus.c;
    const cell = cellOf(r, c);
    if (raw === rawOf(cell)) { render(); return; }
    pushUndo();
    commitValue(r, c, raw);
    scheduleSave();
    render();
    setStatus('Celda ' + addr(r, c) + ' actualizada');
  }

  function move(dr, dc, extend) {
    const f = sel.focus;
    select(clampR(f.r + dr), clampC(f.c + dc), extend);
  }
  const clampR = (r) => Math.max(0, Math.min(ROWS - 1, r));
  const clampC = (c) => Math.max(0, Math.min(COLS - 1, c));

  // ------------------------------------------------------------ portapapeles
  function selectedMatrix() {
    const rg = selRange();
    const cache = new Map(); const visiting = new Set();
    const rows = [];
    for (let r = rg.r1; r <= rg.r2; r++) {
      const line = [];
      for (let c = rg.c1; c <= rg.c2; c++) {
        const cell = cur().cells[addr(r, c)];
        if (!cell) line.push('');
        else if (cell.f) line.push(E.formatValue(E.cellValue(wb, cur().name, r, c, cache, visiting), cell.style && cell.style.nf));
        else line.push(E.formatValue(cell.v, cell.style && cell.style.nf));
      }
      rows.push(line);
    }
    return rows;
  }

  async function copySelection() {
    const rows = selectedMatrix();
    const text = rows.map(r => r.join('\t')).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copiado (' + rows.length + '×' + (rows[0] ? rows[0].length : 0) + ')');
    } catch (e) {
      setStatus('No se pudo copiar al portapapeles');
    }
  }

  function pasteMatrix(text) {
    const rows = text.replace(/\r/g, '').split('\n');
    if (rows.length && rows[rows.length - 1] === '') rows.pop();
    const matrix = rows.map(l => l.split('\t'));
    if (!matrix.length) return;
    pushUndo();
    const start = sel.focus;
    for (let i = 0; i < matrix.length && start.r + i < ROWS; i++) {
      for (let j = 0; j < matrix[i].length && start.c + j < COLS; j++) {
        commitValue(start.r + i, start.c + j, matrix[i][j]);
      }
    }
    scheduleSave();
    render();
    setStatus('Pegado (' + matrix.length + ' filas)');
  }

  // ------------------------------------------------------------ formato
  function forEachSelected(fn) {
    const rg = selRange();
    for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) fn(r, c);
  }

  function applyStyle(patch) {
    if (editing) commitEdit();
    pushUndo();
    forEachSelected((r, c) => {
      const a = addr(r, c);
      const cell = cur().cells[a] || { v: '' };
      cell.style = Object.assign({}, cell.style || {}, patch);
      cur().cells[a] = cell;
    });
    scheduleSave();
    render();
    setStatus('Formato aplicado');
  }

  function toggleStyle(prop) {
    const f = sel.focus;
    const cell = cellOf(f.r, f.c);
    const current = !!(cell && cell.style && cell.style[prop]);
    applyStyle({ [prop]: !current });
  }

  // ------------------------------------------------------------ hojas
  function addSheet() {
    pushUndo();
    const name = 'Hoja' + (wb.sheets.length + 1);
    wb.sheets.push({ name: name, cells: {}, cols: {}, rows: {} });
    wb.active = wb.sheets.length - 1;
    sel = { anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } };
    scheduleSave();
    render();
    setStatus('Hoja "' + name + '" creada');
  }

  function delSheet() {
    if (wb.sheets.length <= 1) { setStatus('No puedes borrar la única hoja'); return; }
    if (!confirm('¿Borrar la hoja "' + cur().name + '"?')) return;
    pushUndo();
    wb.sheets.splice(wb.active, 1);
    wb.active = Math.max(0, wb.active - 1);
    sel = { anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } };
    scheduleSave();
    render();
    setStatus('Hoja borrada');
  }

  function renameSheet(i) {
    const name = prompt('Nombre de la hoja', wb.sheets[i].name);
    if (!name) return;
    const clean = name.trim().slice(0, 31);
    if (!clean) return;
    if (wb.sheets.some((s, j) => j !== i && s.name.toLowerCase() === clean.toLowerCase())) {
      alert('Ya existe una hoja con ese nombre');
      return;
    }
    pushUndo();
    wb.sheets[i].name = clean;
    scheduleSave();
    render();
  }

  // ------------------------------------------------------------ importar / exportar
  function sheetToAoa(s) {
    const cache = new Map(); const visiting = new Set();
    let maxR = 0, maxC = 0;
    const out = [];
    for (let r = 0; r < ROWS; r++) {
      const line = [];
      for (let c = 0; c < COLS; c++) {
        const cell = s.cells[addr(r, c)];
        let v = '';
        if (cell) {
          if (cell.f) v = E.cellValue(wb, s.name, r, c, cache, visiting);
          else v = cell.v === undefined ? '' : cell.v;
          if (typeof v === 'object' && v && v.__err) v = v.code;
          if (v !== '' && v !== null && v !== undefined) { maxR = Math.max(maxR, r + 1); maxC = Math.max(maxC, c + 1); }
        }
        line.push(v);
      }
      out.push(line);
    }
    return out.slice(0, Math.max(1, maxR)).map(row => row.slice(0, Math.max(1, maxC)));
  }

  function exportXlsx() {
    if (typeof XLSX === 'undefined') { setStatus('No se cargó el lector xlsx'); return; }
    const out = XLSX.utils.book_new();
    const cache = new Map();
    for (const s of wb.sheets) {
      const ws = {};
      let maxR = 0, maxC = 0;
      for (const a in s.cells) {
        const cell = s.cells[a];
        const p = E.parseAddr(a);
        if (!p) continue;
        const target = XLSX.utils.encode_cell({ r: p.r, c: p.c });
        if (cell.f) {
          const v = E.cellValue(wb, s.name, p.r, p.c, cache, new Set());
          ws[target] = { t: 'n', f: cell.f.replace(/^=/, ''), v: (typeof v === 'number' && isFinite(v)) ? v : 0 };
        } else if (typeof cell.v === 'number') {
          ws[target] = { t: 'n', v: cell.v };
        } else if (typeof cell.v === 'boolean') {
          ws[target] = { t: 'b', v: cell.v };
        } else if (cell.v !== undefined && cell.v !== '') {
          ws[target] = { t: 's', v: String(cell.v) };
        } else continue;
        maxR = Math.max(maxR, p.r); maxC = Math.max(maxC, p.c);
      }
      ws['!ref'] = E.toA1(0, 0) + ':' + E.toA1(Math.max(0, maxR), Math.max(0, maxC));
      XLSX.utils.book_append_sheet(out, ws, s.name.slice(0, 31));
    }
    const name = 'excel-ligero-' + new Date().toISOString().slice(0, 10) + '.xlsx';
    XLSX.writeFile(out, name, { compression: true });
    setStatus('Descargado ' + name);
  }

  function exportCsv() {
    const rows = sheetToAoa(cur());
    const csv = rows.map(row => row.map(v => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (cur().name || 'hoja') + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setStatus('CSV descargado');
  }

  function importFile(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const book = XLSX.read(data, { type: 'array', cellFormula: true, cellStyles: false });
        pushUndo();
        const sheets = book.SheetNames.map((name) => {
          const ws = book.Sheets[name];
          const s = { name: name.slice(0, 31), cells: {}, cols: {}, rows: {} };
          const ref = ws['!ref'] || 'A1';
          const range = XLSX.utils.decode_range(ref);
          for (let r = range.s.r; r <= range.e.r && r < ROWS; r++) {
            for (let c = range.s.c; c <= range.e.c && c < COLS; c++) {
              const src = ws[XLSX.utils.encode_cell({ r: r, c: c })];
              if (!src) continue;
              const a = addr(r, c);
              if (src.f) s.cells[a] = { f: '=' + src.f };
              else if (src.v !== undefined && src.v !== null && src.v !== '') s.cells[a] = { v: src.v };
            }
          }
          if (ws['!cols']) ws['!cols'].forEach((col, i) => { if (col && col.wpx) s.cols[i] = Math.max(40, Math.min(400, col.wpx)); });
          return s;
        });
        wb.sheets = sheets.length ? sheets : [E.createWorkbook().sheets[0]];
        wb.active = 0;
        sel = { anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } };
        scheduleSave();
        render();
        setStatus('Abierto: ' + file.name + ' (' + wb.sheets.length + ' hoja(s))');
      } catch (err) {
        console.error(err);
        alert('No pude leer el archivo: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ------------------------------------------------------------ conexiones
  function parseCsv(text, sep) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    sep = sep || ',';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === sep) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function parseJson(text) {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) {
      if (data.data && Array.isArray(data.data)) return parseJson(JSON.stringify(data.data));
      throw new Error('El JSON debe ser una lista');
    }
    if (data.length && typeof data[0] === 'object' && !Array.isArray(data[0])) {
      const keys = Array.from(new Set(data.flatMap(o => Object.keys(o))));
      return [keys].concat(data.map(o => keys.map(k => o[k] === undefined || o[k] === null ? '' : o[k])));
    }
    return data.map(r => Array.isArray(r) ? r : [r]);
  }

  async function fetchData(url, type) {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    let t = type;
    if (!t || t === 'auto') {
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.indexOf('json') >= 0) t = 'json';
      else if (/\.json(\?|$)/i.test(url)) t = 'json';
      else t = 'csv';
    }
    let matrix;
    if (t === 'json') matrix = parseJson(text);
    else {
      const sep = (text.indexOf(';') >= 0 && text.indexOf(';') < text.indexOf(',')) ? ';' : ',';
      matrix = parseCsv(text, sep);
    }
    return matrix;
  }

  function writeMatrix(sheetIndex, matrix) {
    const s = wb.sheets[sheetIndex];
    s.cells = {};
    for (let r = 0; r < matrix.length && r < ROWS; r++) {
      for (let c = 0; c < matrix[r].length && c < COLS; c++) {
        let v = matrix[r][c];
        if (v === null || v === undefined || v === '') continue;
        if (typeof v === 'string') {
          const n = Number(v);
          if (v.trim() !== '' && !isNaN(n) && /^-?\d+(\.\d+)?$/.test(v.trim())) v = n;
        }
        s.cells[addr(r, c)] = { v: v };
      }
    }
  }

  async function runConnection(url, sheetIndex, type, silent) {
    setStatus('Conectando con ' + url + '…');
    try {
      const matrix = await fetchData(url, type);
      if (!matrix.length) throw new Error('Sin datos');
      pushUndo();
      writeMatrix(sheetIndex, matrix);
      scheduleSave();
      render();
      setStatus('Datos cargados: ' + matrix.length + ' filas × ' + (matrix[0] ? matrix[0].length : 0) + ' columnas');
      return true;
    } catch (e) {
      console.error(e);
      if (!silent) alert('No pude traer los datos.\n\n' + e.message + '\n\nSi el sitio no permite CORS, descarga el archivo y usa "Abrir".');
      setStatus('Error de conexión: ' + e.message);
      return false;
    }
  }

  function saveConnection(url, sheetName, type) {
    wb.connections = wb.connections.filter(c => !(c.url === url && c.sheet === sheetName));
    wb.connections.push({ url: url, sheet: sheetName, type: type, at: Date.now() });
    scheduleSave();
  }

  async function refreshConnections() {
    const list = wb.connections.slice();
    if (!list.length) { setStatus('No hay conexiones guardadas'); return; }
    for (const c of list) {
      const idx = wb.sheets.findIndex(s => s.name === c.sheet);
      if (idx >= 0) await runConnection(c.url, idx, c.type, true);
    }
    scheduleSave();
    setStatus('Conexiones actualizadas (' + list.length + ')');
  }

  // ------------------------------------------------------------ UI: eventos
  function bindToolbar() {
    $('toolbar').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-cmd]');
      if (!btn) return;
      const cmd = btn.dataset.cmd;
      if (editing) commitEdit();
      switch (cmd) {
        case 'undo': undo(); break;
        case 'redo': redo(); break;
        case 'bold': toggleStyle('b'); break;
        case 'italic': toggleStyle('i'); break;
        case 'underline': toggleStyle('u'); break;
        case 'align-left': applyStyle({ align: 'left' }); break;
        case 'align-center': applyStyle({ align: 'center' }); break;
        case 'align-right': applyStyle({ align: 'right' }); break;
        case 'clear': clearSelection(); break;
        case 'sum': insertSum(); break;
        case 'add-sheet': addSheet(); break;
        case 'del-sheet': delSheet(); break;
      }
    });

    $('fg-color').addEventListener('input', (e) => applyStyle({ color: e.target.value }));
    $('bg-color').addEventListener('input', (e) => applyStyle({ bg: e.target.value }));
    $('num-format').addEventListener('change', (e) => applyStyle({ nf: e.target.value }));

    $('btn-new').addEventListener('click', () => {
      if (!confirm('¿Empezar un libro nuevo? Se pierde lo no guardado.')) return;
      pushUndo();
      wb = E.createWorkbook();
      wb.connections = [];
      wb.active = 0;
      sel = { anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } };
      scheduleSave();
      render();
      setStatus('Libro nuevo');
    });
    $('btn-open').addEventListener('click', () => $('file-input').click());
    $('file-input').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importFile(f);
      e.target.value = '';
    });
    $('btn-save').addEventListener('click', exportXlsx);
    $('btn-csv').addEventListener('click', exportCsv);
    $('btn-connect').addEventListener('click', openConnectModal);
    $('btn-refresh').addEventListener('click', refreshConnections);
    $('help-close').addEventListener('click', () => { $('help-modal').hidden = true; });
    $('help-modal').addEventListener('click', (e) => { if (e.target.id === 'help-modal') $('help-modal').hidden = true; });
    $('conn-cancel').addEventListener('click', () => { $('connect-modal').hidden = true; });
    $('connect-modal').addEventListener('click', (e) => { if (e.target.id === 'connect-modal') $('connect-modal').hidden = true; });
    $('conn-ok').addEventListener('click', async () => {
      const url = $('conn-url').value.trim();
      if (!url) return;
      const sheetIdx = Number($('conn-sheet').value);
      const type = $('conn-type').value;
      $('connect-modal').hidden = true;
      const ok = await runConnection(url, sheetIdx, type, false);
      if (ok) saveConnection(url, wb.sheets[sheetIdx].name, type);
    });
    document.querySelector('.brand').addEventListener('dblclick', () => { $('help-modal').hidden = false; });
  }

  function insertSum() {
    const rg = selRange();
    if (rg.r1 === rg.r2 && rg.c1 === rg.c2) {
      const f = sel.focus;
      let r = f.r - 1;
      while (r >= 0 && cellOf(r, f.c)) r--;
      if (r + 1 <= f.r - 1) {
        const a = E.toA1(r + 1, f.c), b = E.toA1(f.r - 1, f.c);
        commitCellAt(f.r, f.c, '=SUMA(' + a + ':' + b + ')');
      } else startEdit('=SUMA(');
      return;
    }
    const target = { r: rg.r2 + 1, c: rg.c1 };
    const f = '=SUMA(' + E.toA1(rg.r1, rg.c1) + ':' + E.toA1(rg.r2, rg.c2) + ')';
    if (target.r < ROWS) {
      commitCellAt(target.r, target.c, f);
      select(target.r, target.c, false);
    }
  }

  function commitCellAt(r, c, raw) {
    pushUndo();
    commitValue(r, c, raw);
    scheduleSave();
    render();
  }

  function openConnectModal() {
    const selEl = $('conn-sheet');
    selEl.innerHTML = wb.sheets.map((s, i) => '<option value="' + i + '">' + escapeHtml(s.name) + '</option>').join('');
    selEl.value = String(wb.active);
    $('conn-url').value = '';
    $('connect-modal').hidden = false;
    setTimeout(() => $('conn-url').focus(), 30);
  }

  function bindGrid() {
    sheetEl.addEventListener('mousedown', (e) => {
      const td = e.target.closest('td[data-r]');
      if (!td) return;
      if (editing) { commitEdit(); }
      const r = Number(td.dataset.r), c = Number(td.dataset.c);
      dragging = true;
      select(r, c, e.shiftKey);
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const td = e.target.closest && e.target.closest('td[data-r]');
      if (!td) return;
      const r = Number(td.dataset.r), c = Number(td.dataset.c);
      if (r !== sel.focus.r || c !== sel.focus.c) { sel.focus = { r: r, c: c }; render(); }
    });
    document.addEventListener('mouseup', () => { dragging = false; });

    sheetEl.addEventListener('dblclick', (e) => {
      const td = e.target.closest('td[data-r]');
      if (!td) return;
      select(Number(td.dataset.r), Number(td.dataset.c), false);
      startEdit();
    });

    tabsEl.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) { e.stopPropagation(); renameSheet(Number(del.dataset.del)); return; }
      const tab = e.target.closest('.sheet-tab');
      if (!tab) return;
      wb.active = Number(tab.dataset.i);
      sel = { anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } };
      render();
    });

    formulaInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const r = sel.focus.r, c = sel.focus.c;
        const raw = formulaInput.value;
        if (rawOf(cellOf(r, c)) !== raw) {
          pushUndo();
          commitValue(r, c, raw);
          scheduleSave();
          render();
          setStatus('Celda ' + addr(r, c) + ' actualizada');
        }
        formulaInput.blur();
        gridWrap.focus();
      } else if (e.key === 'Escape') {
        updateFormulaBar();
        gridWrap.focus();
      }
    });
  }

  function bindGlobalKeys() {
    document.addEventListener('keydown', (e) => {
      // edición inline
      if (editing) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const r = editing.r, c = editing.c;
          commitEdit();
          select(clampR(r + 1), c, false);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          const r = editing.r, c = editing.c;
          commitEdit();
          select(r, clampC(c + 1), false);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelEdit();
        }
        return;
      }
      if (document.activeElement === formulaInput) return;
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;

      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (ctrl && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleStyle('b'); return; }
      if (ctrl && e.key.toLowerCase() === 'i') { e.preventDefault(); toggleStyle('i'); return; }
      if (ctrl && e.key.toLowerCase() === 'u') { e.preventDefault(); toggleStyle('u'); return; }
      if (ctrl && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); return; }
      if (ctrl && e.key.toLowerCase() === 'x') { e.preventDefault(); copySelection(); clearSelection(); return; }

      const k = e.key;
      if (k === 'ArrowUp') { e.preventDefault(); move(-1, 0, e.shiftKey); return; }
      if (k === 'ArrowDown') { e.preventDefault(); move(1, 0, e.shiftKey); return; }
      if (k === 'ArrowLeft') { e.preventDefault(); move(0, -1, e.shiftKey); return; }
      if (k === 'ArrowRight') { e.preventDefault(); move(0, 1, e.shiftKey); return; }
      if (k === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1, false); return; }
      if (k === 'Enter') { e.preventDefault(); startEdit(); return; }
      if (k === 'F2') { e.preventDefault(); startEdit(); return; }
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); clearSelection(); return; }
      if (k === 'PageDown') { e.preventDefault(); move(20, 0, e.shiftKey); return; }
      if (k === 'PageUp') { e.preventDefault(); move(-20, 0, e.shiftKey); return; }
      if (k === 'Home') { e.preventDefault(); select(e.ctrlKey ? 0 : sel.focus.r, 0, false); return; }
      if (k.length === 1 && !ctrl && !e.altKey) { e.preventDefault(); startEdit(k); return; }
    });

    document.addEventListener('paste', (e) => {
      if (editing || (document.activeElement && document.activeElement.tagName === 'INPUT')) return;
      const text = e.clipboardData && e.clipboardData.getData('text/plain');
      if (text) { e.preventDefault(); pasteMatrix(text); }
    });
  }

  function ensureRefreshButton() {
    if ($('btn-refresh')) return;
    const group = document.createElement('div');
    group.className = 'group';
    group.innerHTML = '<button id="btn-refresh" title="Volver a traer los datos de las URLs guardadas">Actualizar URL</button>';
    $('toolbar').appendChild(group);
  }

  // ------------------------------------------------------------ arranque
  function init() {
    ensureRefreshButton();
    bindToolbar();
    bindGrid();
    bindGlobalKeys();
    render();
    gridWrap.tabIndex = 0;
    gridWrap.focus();
    setStatus('Listo · se guarda solo en este navegador');
  }

  init();
})();
