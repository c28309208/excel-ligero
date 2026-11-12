/* Motor de hoja de cálculo: fórmulas, referencias, rangos y funciones.
   Sin dependencias. Expone window.XLEngine y module.exports (para pruebas). */
(function (global) {
  'use strict';

  const ERR = {
    DIV0: '#¡DIV/0!', VALUE: '#¡VALOR!', REF: '#¡REF!', NAME: '#¡NOMBRE?',
    NUM: '#¡NUM!', NA: '#N/A', CYCLE: '#¡CIRC!', PARSE: '#¡ERROR!'
  };

  function isErr(v) { return v && typeof v === 'object' && v.__err; }
  function err(code) { return { __err: true, code: code }; }
  function isRange(v) { return v && typeof v === 'object' && v.__range; }

  // ---------------------------------------------------------------- direcciones
  function colName(c) {
    let s = '';
    c = c + 1;
    while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
    return s;
  }
  function colIndex(letters) {
    let n = 0;
    letters = letters.toUpperCase();
    for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }
  function parseAddr(addr) {
    const m = /^([A-Za-z]{1,3})(\d{1,7})$/.exec(addr.trim());
    if (!m) return null;
    return { r: parseInt(m[2], 10) - 1, c: colIndex(m[1]) };
  }
  function toA1(r, c) { return colName(c) + (r + 1); }

  // ---------------------------------------------------------------- tokenizador
  function tokenize(src) {
    const out = [];
    let i = 0;
    const n = src.length;
    const numRe = /^\d+(\.\d+)?([eE][+-]?\d+)?/;
    const numDotRe = /^\.\d+([eE][+-]?\d+)?/;
    const refRe = /^(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_\.]*))!)?(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})/;
    const fnRe = /^([A-Za-z_][A-Za-z0-9_\.]*)\s*\(/;
    const errRe = /^#([A-Za-z0-9\/]+[!?]?)/;

    while (i < n) {
      const ch = src[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }

      if (ch === '"') {
        let s = '';
        i++;
        while (i < n) {
          if (src[i] === '"') {
            if (src[i + 1] === '"') { s += '"'; i += 2; continue; }
            i++; break;
          }
          s += src[i++];
        }
        out.push({ t: 'str', v: s });
        continue;
      }

      if ((ch >= '0' && ch <= '9') || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        const rest = src.slice(i);
        const m = (ch === '.' ? numDotRe : numRe).exec(rest);
        if (!m) throw new SyntaxError('Número inválido en ' + i);
        out.push({ t: 'num', v: parseFloat(m[0]) });
        i += m[0].length;
        continue;
      }

      if (ch === '(') { out.push({ t: 'op', v: '(' }); i++; continue; }
      if (ch === ')') { out.push({ t: 'op', v: ')' }); i++; continue; }
      if (ch === ',') { out.push({ t: 'op', v: ',' }); i++; continue; }
      if (ch === ';') { out.push({ t: 'op', v: ',' }); i++; continue; }
      if (ch === ':') { out.push({ t: 'op', v: ':' }); i++; continue; }
      if (ch === '+') { out.push({ t: 'op', v: '+' }); i++; continue; }
      if (ch === '-') { out.push({ t: 'op', v: '-' }); i++; continue; }
      if (ch === '*') { out.push({ t: 'op', v: '*' }); i++; continue; }
      if (ch === '/') { out.push({ t: 'op', v: '/' }); i++; continue; }
      if (ch === '^') { out.push({ t: 'op', v: '^' }); i++; continue; }
      if (ch === '&') { out.push({ t: 'op', v: '&' }); i++; continue; }
      if (ch === '%') { out.push({ t: 'op', v: '%' }); i++; continue; }
      if (ch === '=') { out.push({ t: 'op', v: '=' }); i++; continue; }
      if (ch === '<') {
        if (src[i + 1] === '=') { out.push({ t: 'op', v: '<=' }); i += 2; continue; }
        if (src[i + 1] === '>') { out.push({ t: 'op', v: '<>' }); i += 2; continue; }
        out.push({ t: 'op', v: '<' }); i++; continue;
      }
      if (ch === '>') {
        if (src[i + 1] === '=') { out.push({ t: 'op', v: '>=' }); i += 2; continue; }
        out.push({ t: 'op', v: '>' }); i++; continue;
      }

      if (ch === '#') {
        const m = errRe.exec(src.slice(i));
        if (m) {
          const raw = ('#' + m[1]).toUpperCase();
          const map = { '#DIV/0!': ERR.DIV0, '#VALUE!': ERR.VALUE, '#REF!': ERR.REF, '#NAME?': ERR.NAME, '#N/A': ERR.NA, '#NUM!': ERR.NUM };
          out.push({ t: 'err', v: map[raw] || ERR.NUM });
          i += m[0].length;
          continue;
        }
      }

      if (ch === "'" || /[A-Za-z_]/.test(ch)) {
        // función
        const fm = fnRe.exec(src.slice(i));
        if (fm) {
          out.push({ t: 'fn', v: fm[1].toUpperCase() });
          i += fm[0].length;
          out.push({ t: 'op', v: '(' });
          continue;
        }
        const rm = refRe.exec(src.slice(i));
        if (rm) {
          const sheet = rm[1] !== undefined ? rm[1].replace(/''/g, "'") : (rm[2] || null);
          out.push({ t: 'ref', sheet: sheet, r: parseInt(rm[6], 10) - 1, c: colIndex(rm[4]), absR: rm[5] === '$', absC: rm[3] === '$' });
          i += rm[0].length;
          continue;
        }
        const rest = src.slice(i);
        const boolM = /^(TRUE|FALSE)\b/i.exec(rest);
        if (boolM) { out.push({ t: 'bool', v: boolM[1].toUpperCase() === 'TRUE' }); i += boolM[0].length; continue; }
        const word = /^[A-Za-z_][A-Za-z0-9_\.]*/.exec(rest);
        if (word) { out.push({ t: 'name', v: word[0] }); i += word[0].length; continue; }
      }

      throw new SyntaxError('Carácter inesperado "' + ch + '" en ' + i);
    }
    return out;
  }

  // ---------------------------------------------------------------- parser
  function parse(tokens) {
    let pos = 0;
    const peek = () => tokens[pos];
    const eat = (v) => {
      const tk = tokens[pos];
      if (!tk || tk.t !== 'op' || tk.v !== v) throw new SyntaxError('Se esperaba ' + v);
      pos++;
    };
    const atOp = (list) => { const tk = tokens[pos]; return tk && tk.t === 'op' && list.indexOf(tk.v) >= 0; };

    function expr() { return compare(); }
    function compare() {
      let l = concat();
      while (atOp(['=', '<>', '<', '>', '<=', '>='])) {
        const op = tokens[pos++].v;
        l = { t: 'bin', op: op, l: l, r: concat() };
      }
      return l;
    }
    function concat() {
      let l = add();
      while (atOp(['&'])) { pos++; l = { t: 'bin', op: '&', l: l, r: add() }; }
      return l;
    }
    function add() {
      let l = mul();
      while (atOp(['+', '-'])) { const op = tokens[pos++].v; l = { t: 'bin', op: op, l: l, r: mul() }; }
      return l;
    }
    function mul() {
      let l = unary();
      while (atOp(['*', '/'])) { const op = tokens[pos++].v; l = { t: 'bin', op: op, l: l, r: unary() }; }
      return l;
    }
    function unary() {
      if (atOp(['-'])) { pos++; return { t: 'neg', v: unary() }; }
      if (atOp(['+'])) { pos++; return unary(); }
      return power();
    }
    function power() {
      const base = postfix();
      if (atOp(['^'])) { pos++; return { t: 'bin', op: '^', l: base, r: unary() }; }
      return base;
    }
    function postfix() {
      let v = primary();
      while (atOp(['%'])) { pos++; v = { t: 'pct', v: v }; }
      return v;
    }
    function primary() {
      const tk = peek();
      if (!tk) throw new SyntaxError('Fórmula incompleta');
      if (tk.t === 'num') { pos++; return { t: 'num', v: tk.v }; }
      if (tk.t === 'str') { pos++; return { t: 'str', v: tk.v }; }
      if (tk.t === 'bool') { pos++; return { t: 'bool', v: tk.v }; }
      if (tk.t === 'err') { pos++; return { t: 'err', v: tk.v }; }
      if (tk.t === 'ref') {
        pos++;
        // rango?
        if (atOp([':'])) {
          const save = pos;
          pos++;
          const tk2 = peek();
          if (tk2 && tk2.t === 'ref') {
            pos++;
            return { t: 'range', a: tk, b: tk2 };
          }
          pos = save;
        }
        return { t: 'ref', v: tk };
      }
      if (tk.t === 'fn') {
        pos++;
        eat('(');
        const args = [];
        if (!(peek() && peek().t === 'op' && peek().v === ')')) {
          args.push(expr());
          while (atOp([','])) { pos++; args.push(expr()); }
        }
        eat(')');
        return { t: 'call', name: tk.v, args: args };
      }
      if (tk.t === 'op' && tk.v === '(') { pos++; const e = expr(); eat(')'); return e; }
      throw new SyntaxError('Token inesperado');
    }

    const ast = expr();
    if (pos < tokens.length) throw new SyntaxError('Sobra texto en la fórmula');
    return ast;
  }

  // ---------------------------------------------------------------- coerciones
  function toNum(v) {
    if (isErr(v)) return v;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'string') {
      const s = v.trim().replace(/\s/g, '').replace(',', '.');
      if (s === '') return 0;
      const n = Number(s);
      if (!isNaN(n)) return n;
      return err(ERR.VALUE);
    }
    return err(ERR.VALUE);
  }
  function toBool(v) {
    if (isErr(v)) return v;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      const u = v.trim().toUpperCase();
      if (u === 'VERDADERO' || u === 'TRUE') return true;
      if (u === 'FALSO' || u === 'FALSE') return false;
      return err(ERR.VALUE);
    }
    return false;
  }
  function toText(v) {
    if (isErr(v)) return v.code;
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
    if (typeof v === 'number') return formatGeneral(v);
    return String(v);
  }
  function formatGeneral(n) {
    if (!isFinite(n)) return String(n);
    if (Math.abs(n) >= 1e11 || (Math.abs(n) < 1e-9 && n !== 0)) return n.toExponential(6).replace('e+', 'E+').replace('e-', 'E-');
    const s = String(parseFloat(n.toPrecision(15)));
    return s;
  }

  // ---------------------------------------------------------------- fechas
  const MS_DAY = 86400000;
  const EPOCH = Date.UTC(1899, 11, 30);
  function serialFromDate(d) {
    const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
    return (utc - EPOCH) / MS_DAY;
  }
  function dateFromSerial(s) {
    return new Date(EPOCH + Math.round(s * MS_DAY));
  }

  // ---------------------------------------------------------------- funciones
  function flatten(args, ctx) {
    const out = [];
    for (const a of args) {
      if (isRange(a)) {
        for (let r = a.r1; r <= a.r2; r++) for (let c = a.c1; c <= a.c2; c++) out.push(ctx.get(a.sheet, r, c));
      } else out.push(a);
    }
    return out;
  }
  function firstErr(vals) {
    for (const v of vals) if (isErr(v)) return v;
    return null;
  }
  function numsOnly(vals) {
    const out = [];
    for (const v of vals) {
      if (isErr(v)) return { err: v };
      if (typeof v === 'number') out.push(v);
      else if (typeof v === 'boolean') out.push(v ? 1 : 0);
      else if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) out.push(Number(v));
    }
    return { nums: out };
  }

  function criteriaMatcher(crit, ctx) {
    if (isErr(crit)) return () => false;
    if (typeof crit === 'number' || typeof crit === 'boolean') return (v) => Number(v) === Number(crit);
    let s = String(crit);
    let op = '=';
    const m = /^(<=|>=|<>|=|<|>)(.*)$/.exec(s);
    if (m) { op = m[1]; s = m[2]; }
    s = s.trim();
    const isNum = s !== '' && !isNaN(Number(s));
    const target = isNum ? Number(s) : s.toLowerCase();
    const hasWild = !isNum && /[*?]/.test(s);
    let re = null;
    if (hasWild) {
      const rx = s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
      re = new RegExp('^' + rx + '$', 'i');
    }
    return function (v) {
      if (isErr(v)) return false;
      let val = v;
      if (typeof val === 'string' && isNum) { if (val.trim() === '') return false; const n = Number(val); if (isNaN(n)) return op === '<>'; val = n; }
      if (typeof val === 'boolean' && isNum) val = val ? 1 : 0;
      if (typeof val === 'number' && !isNum) { if (op === '<>') return true; return false; }
      if (isNum) {
        switch (op) {
          case '=': return val === target;
          case '<>': return val !== target;
          case '>': return val > target;
          case '<': return val < target;
          case '>=': return val >= target;
          case '<=': return val <= target;
        }
      }
      const t = String(val).toLowerCase();
      if (re) return re.test(String(val));
      switch (op) {
        case '=': return t === target;
        case '<>': return t !== target;
        case '>': return t > target;
        case '<': return t < target;
        case '>=': return t >= target;
        case '<=': return t <= target;
      }
      return false;
    };
  }

  function roundTo(n, d) {
    const f = Math.pow(10, d || 0);
    return Math.round((n + (n >= 0 ? 1e-12 : -1e-12)) * f) / f;
  }

  const FNS = {
    SUMA: 'SUM', SUM: 'SUM',
    SUM: function (args, ctx) {
      const v = numsOnly(flatten(args, ctx)); if (v.err) return v.err;
      return v.nums.reduce((a, b) => a + b, 0);
    },
    PROMEDIO: 'AVERAGE', AVERAGE: 'AVERAGE',
    AVERAGE: function (args, ctx) {
      const v = numsOnly(flatten(args, ctx)); if (v.err) return v.err;
      if (!v.nums.length) return err(ERR.DIV0);
      return v.nums.reduce((a, b) => a + b, 0) / v.nums.length;
    },
    MIN: function (args, ctx) {
      const v = numsOnly(flatten(args, ctx)); if (v.err) return v.err;
      return v.nums.length ? Math.min.apply(null, v.nums) : 0;
    },
    MAX: function (args, ctx) {
      const v = numsOnly(flatten(args, ctx)); if (v.err) return v.err;
      return v.nums.length ? Math.max.apply(null, v.nums) : 0;
    },
    CONTAR: 'COUNT', COUNT: 'COUNT',
    COUNT: function (args, ctx) {
      const v = numsOnly(flatten(args, ctx)); if (v.err) return v.err;
      return v.nums.length;
    },
    CONTARA: 'COUNTA', COUNTA: function (args, ctx) {
      const f = flatten(args, ctx);
      let k = 0;
      for (const x of f) if (!isErr(x) && x !== '' && x !== null && x !== undefined) k++;
      return k;
    },
    CONTARBLANCO: 'COUNTBLANK', COUNTBLANK: function (args, ctx) {
      const f = flatten(args, ctx);
      let k = 0;
      for (const x of f) if (!isErr(x) && (x === '' || x === null || x === undefined)) k++;
      return k;
    },
    SI: 'IF', IF: function (args, ctx) {
      if (!args.length) return err(ERR.VALUE);
      const c = toBool(args[0]);
      if (isErr(c)) return c;
      if (c) return args.length > 1 ? args[1] : 0;
      return args.length > 2 ? args[2] : 0;
    },
    SIERROR: 'IFERROR', IFERROR: function (args, ctx) {
      if (isErr(args[0])) return args.length > 1 ? args[1] : '';
      return args[0];
    },
    Y: 'AND', AND: function (args, ctx) {
      const f = flatten(args, ctx);
      const e = firstErr(f); if (e) return e;
      for (const v of f) { if (v === '' || v === null) continue; const b = toBool(v); if (isErr(b)) return b; if (!b) return false; }
      return true;
    },
    O: 'OR', OR: function (args, ctx) {
      const f = flatten(args, ctx);
      const e = firstErr(f); if (e) return e;
      for (const v of f) { if (v === '' || v === null) continue; const b = toBool(v); if (isErr(b)) return b; if (b) return true; }
      return false;
    },
    NO: 'NOT', NOT: function (args) { const b = toBool(args[0]); return isErr(b) ? b : !b; },
    ABS: function (args) { const n = toNum(args[0]); return isErr(n) ? n : Math.abs(n); },
    REDONDEAR: 'ROUND', ROUND: function (args) {
      const n = toNum(args[0]); if (isErr(n)) return n;
      const d = args.length > 1 ? toNum(args[1]) : 0; if (isErr(d)) return d;
      return roundTo(n, d);
    },
    REDONDEAR_MAS: 'ROUNDUP', ROUNDUP: function (args) {
      const n = toNum(args[0]); if (isErr(n)) return n;
      const d = args.length > 1 ? toNum(args[1]) : 0; if (isErr(d)) return d;
      const f = Math.pow(10, d);
      return (n >= 0 ? Math.ceil(n * f - 1e-12) : -Math.ceil(Math.abs(n) * f - 1e-12)) / f;
    },
    REDONDEAR_MENOS: 'ROUNDDOWN', ROUNDDOWN: function (args) {
      const n = toNum(args[0]); if (isErr(n)) return n;
      const d = args.length > 1 ? toNum(args[1]) : 0; if (isErr(d)) return d;
      const f = Math.pow(10, d);
      return (n >= 0 ? Math.floor(n * f + 1e-12) : -Math.floor(Math.abs(n) * f + 1e-12)) / f;
    },
    ENTERO: 'INT', INT: function (args) { const n = toNum(args[0]); return isErr(n) ? n : Math.floor(n); },
    RESIDUO: 'MOD', MOD: function (args) {
      const a = toNum(args[0]), b = toNum(args[1]);
      if (isErr(a)) return a; if (isErr(b)) return b;
      if (b === 0) return err(ERR.DIV0);
      return a - b * Math.floor(a / b);
    },
    POTENCIA: 'POWER', POWER: function (args) {
      const a = toNum(args[0]), b = toNum(args[1]);
      if (isErr(a)) return a; if (isErr(b)) return b;
      const r = Math.pow(a, b);
      return isNaN(r) ? err(ERR.NUM) : r;
    },
    RAIZ: 'SQRT', SQRT: function (args) {
      const n = toNum(args[0]); if (isErr(n)) return n;
      return n < 0 ? err(ERR.NUM) : Math.sqrt(n);
    },
    EXP: function (args) { const n = toNum(args[0]); return isErr(n) ? n : Math.exp(n); },
    LN: function (args) { const n = toNum(args[0]); if (isErr(n)) return n; return n <= 0 ? err(ERR.NUM) : Math.log(n); },
    LOG: function (args) {
      const n = toNum(args[0]); if (isErr(n)) return n;
      const b = args.length > 1 ? toNum(args[1]) : 10; if (isErr(b)) return b;
      return n <= 0 || b <= 1 ? err(ERR.NUM) : Math.log(n) / Math.log(b);
    },
    PI: function () { return Math.PI; },
    ALEATORIO: 'RAND', RAND: function () { return Math.random(); },
    ALEATORIOENTRE: 'RANDBETWEEN', RANDBETWEEN: function (args) {
      const a = Math.ceil(toNum(args[0])), b = Math.floor(toNum(args[1]));
      if (isErr(a)) return a; if (isErr(b)) return b;
      return a + Math.floor(Math.random() * (b - a + 1));
    },
    CONCATENAR: 'CONCATENATE', CONCATENATE: function (args, ctx) {
      const f = flatten(args, ctx);
      const e = firstErr(f); if (e) return e;
      return f.map(toText).join('');
    },
    CONCAT: function (args, ctx) { return FNS.CONCATENATE(args, ctx); },
    LARGO: 'LEN', LEN: function (args) {
      const t = toText(args[0]); return isErr(args[0]) ? args[0] : t.length;
    },
    IZQUIERDA: 'LEFT', LEFT: function (args) {
      if (isErr(args[0])) return args[0];
      const s = toText(args[0]);
      const k = args.length > 1 ? toNum(args[1]) : 1; if (isErr(k)) return k;
      return s.substring(0, Math.max(0, Math.round(k)));
    },
    DERECHA: 'RIGHT', RIGHT: function (args) {
      if (isErr(args[0])) return args[0];
      const s = toText(args[0]);
      const k = args.length > 1 ? toNum(args[1]) : 1; if (isErr(k)) return k;
      k = Math.max(0, Math.round(k));
      return k >= s.length ? s : s.substring(s.length - k);
    },
    EXTRAE: 'MID', MID: function (args) {
      if (isErr(args[0])) return args[0];
      const s = toText(args[0]);
      const start = toNum(args[1]), len = toNum(args[2]);
      if (isErr(start)) return start; if (isErr(len)) return len;
      if (start < 1 || len < 0) return err(ERR.VALUE);
      return s.substr(Math.round(start) - 1, Math.round(len));
    },
    MAYUSC: 'UPPER', UPPER: function (args) { return isErr(args[0]) ? args[0] : toText(args[0]).toUpperCase(); },
    MINUSC: 'LOWER', LOWER: function (args) { return isErr(args[0]) ? args[0] : toText(args[0]).toLowerCase(); },
    ESPACIOS: 'TRIM', TRIM: function (args) {
      if (isErr(args[0])) return args[0];
      return toText(args[0]).replace(/\s+/g, ' ').trim();
    },
    ENCONTRAR: 'FIND', FIND: function (args) {
      const needle = toText(args[0]), hay = toText(args[1]);
      const start = args.length > 2 ? toNum(args[2]) : 1;
      if (isErr(start)) return start;
      const idx = hay.indexOf(needle, Math.round(start) - 1);
      return idx < 0 ? err(ERR.VALUE) : idx + 1;
    },
    SUSTITUIR: 'SUBSTITUTE', SUBSTITUTE: function (args) {
      const s = toText(args[0]), from = toText(args[1]), to = toText(args[2]);
      return s.split(from).join(to);
    },
    VALOR: 'VALUE', VALUE: function (args) {
      const n = toNum(args[0]);
      return isErr(n) ? err(ERR.VALUE) : n;
    },
    TEXTO: 'TEXT', TEXT: function (args) {
      const v = args[0];
      const fmt = args.length > 1 ? toText(args[1]) : 'General';
      return formatValue(v, fmt);
    },
    HOY: 'TODAY', TODAY: function () {
      const d = new Date();
      return Math.floor(serialFromDate(d));
    },
    AHORA: 'NOW', NOW: function () { return serialFromDate(new Date()); },
    ANIO: 'YEAR', YEAR: function (args) {
      const n = toNum(args[0]); if (isErr(n)) return n;
      return dateFromSerial(n).getUTCFullYear();
    },
    MES: 'MONTH', MONTH: function (args) {
      const n = toNum(args[0]); if (isErr(n)) return n;
      return dateFromSerial(n).getUTCMonth() + 1;
    },
    DIA: 'DAY', DAY: function (args) {
      const n = toNum(args[0]); if (isErr(n)) return n;
      return dateFromSerial(n).getUTCDate();
    },
    FECHA: 'DATE', DATE: function (args) {
      const y = toNum(args[0]), m = toNum(args[1]), d = toNum(args[2]);
      if (isErr(y)) return y; if (isErr(m)) return m; if (isErr(d)) return d;
      const dt = new Date(Date.UTC(y, m - 1, d));
      return serialFromDate(dt);
    },
    BUSCARV: 'VLOOKUP', VLOOKUP: function (args, ctx) {
      if (!isRange(args[1])) return err(ERR.VALUE);
      const key = args[0];
      const col = toNum(args[2]); if (isErr(col)) return col;
      const exact = args.length > 3 ? !toBool(args[3]) : true;
      const rg = args[1];
      let found = null;
      for (let r = rg.r1; r <= rg.r2; r++) {
        const v = ctx.get(rg.sheet, r, rg.c1);
        const eq = compareValues(v, key) === 0;
        if (eq) { found = r; break; }
        if (!exact && compareValues(v, key) < 0) found = r;
      }
      if (found === null) return err(ERR.NA);
      return ctx.get(rg.sheet, found, rg.c1 + Math.round(col) - 1);
    },
    INDICE: 'INDEX', INDEX: function (args, ctx) {
      if (!isRange(args[0])) return err(ERR.VALUE);
      const rg = args[0];
      const row = toNum(args[1]); if (isErr(row)) return row;
      const col = args.length > 2 ? toNum(args[2]) : 1; if (isErr(col)) return col;
      const r = rg.r1 + Math.round(row) - 1;
      const c = rg.c1 + Math.round(col) - 1;
      if (r < rg.r1 || r > rg.r2 || c < rg.c1 || c > rg.c2) return err(ERR.REF);
      return ctx.get(rg.sheet, r, c);
    },
    COINCIDIR: 'MATCH', MATCH: function (args, ctx) {
      if (!isRange(args[1])) return err(ERR.VALUE);
      const key = args[0]; const rg = args[1];
      const type = args.length > 2 ? toNum(args[2]) : 1;
      if (isErr(type)) return type;
      let found = -1;
      for (let i = 0; i <= (rg.r2 - rg.r1); i++) {
        const v = ctx.get(rg.sheet, rg.r1 + i, rg.c1);
        const cmp = compareValues(v, key);
        if (cmp === 0) return i + 1;
        if (type > 0 && cmp < 0) found = i + 1;
      }
      return found > 0 ? found : err(ERR.NA);
    },
    CONTAR_SI: 'COUNTIF', COUNTIF: function (args, ctx) {
      if (!isRange(args[0])) return err(ERR.VALUE);
      const rg = args[0]; const test = criteriaMatcher(args[1]);
      let k = 0;
      for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) if (test(ctx.get(rg.sheet, r, c))) k++;
      return k;
    },
    SUMAR_SI: 'SUMIF', SUMIF: function (args, ctx) {
      if (!isRange(args[0])) return err(ERR.VALUE);
      const rg = args[0]; const test = criteriaMatcher(args[1]);
      const sumRg = args.length > 2 && isRange(args[2]) ? args[2] : rg;
      let total = 0;
      for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) {
        if (test(ctx.get(rg.sheet, r, c))) {
          const val = ctx.get(sumRg.sheet, sumRg.r1 + (r - rg.r1), sumRg.c1 + (c - rg.c1));
          const n = toNum(val); if (!isErr(n)) total += n;
        }
      }
      return total;
    },
    PROMEDIO_SI: 'AVERAGEIF', AVERAGEIF: function (args, ctx) {
      if (!isRange(args[0])) return err(ERR.VALUE);
      const rg = args[0]; const test = criteriaMatcher(args[1]);
      const sumRg = args.length > 2 && isRange(args[2]) ? args[2] : rg;
      let total = 0, k = 0;
      for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) {
        if (test(ctx.get(rg.sheet, r, c))) {
          const n = toNum(ctx.get(sumRg.sheet, sumRg.r1 + (r - rg.r1), sumRg.c1 + (c - rg.c1)));
          if (!isErr(n)) { total += n; k++; }
        }
      }
      return k ? total / k : err(ERR.DIV0);
    },
    MEDIANA: 'MEDIAN', MEDIAN: function (args, ctx) {
      const v = numsOnly(flatten(args, ctx)); if (v.err) return v.err;
      if (!v.nums.length) return err(ERR.NUM);
      const s = v.nums.slice().sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    },
    MAYOR: 'LARGE', LARGE: function (args, ctx) {
      if (!isRange(args[0])) return err(ERR.VALUE);
      const rg = args[0]; const k = toNum(args[1]);
      if (isErr(k)) return k;
      const vals = [];
      for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) {
        const n = toNum(ctx.get(rg.sheet, r, c)); if (!isErr(n)) vals.push(n);
      }
      vals.sort((a, b) => b - a);
      return vals[Math.round(k) - 1] !== undefined ? vals[Math.round(k) - 1] : err(ERR.NUM);
    },
    MENOR: 'SMALL', SMALL: function (args, ctx) {
      if (!isRange(args[0])) return err(ERR.VALUE);
      const rg = args[0]; const k = toNum(args[1]);
      if (isErr(k)) return k;
      const vals = [];
      for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) {
        const n = toNum(ctx.get(rg.sheet, r, c)); if (!isErr(n)) vals.push(n);
      }
      vals.sort((a, b) => a - b);
      return vals[Math.round(k) - 1] !== undefined ? vals[Math.round(k) - 1] : err(ERR.NUM);
    },
    SUMAPRODUCTO: 'SUMPRODUCT', SUMPRODUCT: function (args, ctx) {
      const arrays = args.map(a => { if (!isRange(a)) return [toNum(a)]; const out = []; for (let r = a.r1; r <= a.r2; r++) for (let c = a.c1; c <= a.c2; c++) out.push(toNum(ctx.get(a.sheet, r, c))); return out; });
      let total = 0;
      const len = Math.max.apply(null, arrays.map(a => a.length));
      for (let i = 0; i < len; i++) {
        let p = 1;
        for (const arr of arrays) { const v = arr[i]; if (isErr(v)) return v; p *= (v === undefined ? 0 : v); }
        total += p;
      }
      return total;
    }
  };

  // alias español → canónico
  const ALIAS = {
    SUMA: 'SUM', PROMEDIO: 'AVERAGE', CONTAR: 'COUNT', CONTARA: 'COUNTA', CONTARBLANCO: 'COUNTBLANK',
    SI: 'IF', SIERROR: 'IFERROR', Y: 'AND', O: 'OR', NO: 'NOT', REDONDEAR: 'ROUND',
    REDONDEAR_MAS: 'ROUNDUP', REDONDEAR_MENOS: 'ROUNDDOWN', ENTERO: 'INT', RESIDUO: 'MOD',
    POTENCIA: 'POWER', RAIZ: 'SQRT', ALEATORIO: 'RAND', ALEATORIOENTRE: 'RANDBETWEEN',
    CONCATENAR: 'CONCATENATE', LARGO: 'LEN', IZQUIERDA: 'LEFT', DERECHA: 'RIGHT', EXTRAE: 'MID',
    MAYUSC: 'UPPER', MINUSC: 'LOWER', ESPACIOS: 'TRIM', ENCONTRAR: 'FIND', SUSTITUIR: 'SUBSTITUTE',
    VALOR: 'VALUE', TEXTO: 'TEXT', HOY: 'TODAY', AHORA: 'NOW', ANIO: 'YEAR', MES: 'MONTH',
    DIA: 'DAY', FECHA: 'DATE', BUSCARV: 'VLOOKUP', INDICE: 'INDEX', COINCIDIR: 'MATCH',
    CONTAR_SI: 'COUNTIF', SUMAR_SI: 'SUMIF', PROMEDIO_SI: 'AVERAGEIF', MEDIANA: 'MEDIAN',
    MAYOR: 'LARGE', MENOR: 'SMALL', SUMAPRODUCTO: 'SUMPRODUCT'
  };

  function compareValues(a, b) {
    if (isErr(a)) return NaN;
    const an = (typeof a === 'number') || (typeof a === 'string' && a.trim() !== '' && !isNaN(Number(a)));
    const bn = (typeof b === 'number') || (typeof b === 'string' && b.trim() !== '' && !isNaN(Number(b)));
    if (typeof a === 'boolean' || typeof b === 'boolean') {
      const av = typeof a === 'boolean' ? (a ? 1 : 0) : a, bv = typeof b === 'boolean' ? (b ? 1 : 0) : b;
      return Number(av) === Number(bv) ? 0 : (Number(av) < Number(bv) ? -1 : 1);
    }
    if (an && bn) { const x = Number(a), y = Number(b); return x === y ? 0 : (x < y ? -1 : 1); }
    const sa = String(a === undefined || a === null ? '' : a).toLowerCase();
    const sb = String(b === undefined || b === null ? '' : b).toLowerCase();
    return sa === sb ? 0 : (sa < sb ? -1 : 1);
  }

  // ---------------------------------------------------------------- evaluador
  function evaluateAst(node, ctx) {
    switch (node.t) {
      case 'num': return node.v;
      case 'str': return node.v;
      case 'bool': return node.v;
      case 'err': return node.v;
      case 'pct': { const v = toNum(evaluateAst(node.v, ctx)); return isErr(v) ? v : v / 100; }
      case 'neg': { const v = toNum(evaluateAst(node.v, ctx)); return isErr(v) ? v : -v; }
      case 'ref': return ctx.cell(node.v);
      case 'range': {
        const a = node.a, b = node.b;
        const s1 = a.sheet || ctx.sheet, s2 = b.sheet || ctx.sheet;
        if (s1 !== s2) return err(ERR.REF);
        return { __range: true, sheet: s1, r1: Math.min(a.r, b.r), r2: Math.max(a.r, b.r), c1: Math.min(a.c, b.c), c2: Math.max(a.c, b.c) };
      }
      case 'bin': {
        const op = node.op;
        if (op === '&') {
          const l = evaluateAst(node.l, ctx), r = evaluateAst(node.r, ctx);
          const e = isErr(l) ? l : (isErr(r) ? r : null); if (e) return e;
          return toText(l) + toText(r);
        }
        const l = evaluateAst(node.l, ctx);
        if (isErr(l)) return l;
        const r = evaluateAst(node.r, ctx);
        if (isErr(r)) return r;
        if (op === '=') return compareValues(l, r) === 0;
        if (op === '<>') return compareValues(l, r) !== 0;
        if (op === '<') return compareValues(l, r) < 0;
        if (op === '>') return compareValues(l, r) > 0;
        if (op === '<=') return compareValues(l, r) <= 0;
        if (op === '>=') return compareValues(l, r) >= 0;
        const a = toNum(l), b = toNum(r);
        if (isErr(a)) return a; if (isErr(b)) return b;
        if (op === '+') return a + b;
        if (op === '-') return a - b;
        if (op === '*') return a * b;
        if (op === '/') return b === 0 ? err(ERR.DIV0) : a / b;
        if (op === '^') { const p = Math.pow(a, b); return isNaN(p) ? err(ERR.NUM) : p; }
        return err(ERR.VALUE);
      }
      case 'call': {
        const name = node.name.toUpperCase();
        const canon = FNS[name] && typeof FNS[name] !== 'string' ? name : (ALIAS[name] || name);
        let fn = FNS[canon];
        if (typeof fn === 'string') fn = FNS[fn];
        if (typeof fn !== 'function') return err(ERR.NAME);
        const args = node.args.map(a => evaluateAst(a, ctx));
        try { return fn(args, ctx); } catch (e) { return err(ERR.VALUE); }
      }
    }
    return err(ERR.VALUE);
  }

  // ---------------------------------------------------------------- libro
  function createWorkbook() {
    return {
      sheets: [{ name: 'Hoja1', cells: {}, cols: {}, rows: {} }],
      active: 0
    };
  }
  function findSheet(wb, name) {
    if (!name) return wb.sheets[wb.active];
    const lower = String(name).toLowerCase();
    return wb.sheets.find(s => s.name.toLowerCase() === lower) || null;
  }

  function evaluateFormula(text, sheetName, wb) {
    const body = text.charAt(0) === '=' ? text.slice(1) : text;
    let ast;
    try { ast = parse(tokenize(body)); } catch (e) { return err(ERR.PARSE); }
    const cache = new Map();
    const visiting = new Set();
    const ctx = {
      sheet: sheetName,
      get: function (sheet, r, c) {
        return cellValue(wb, sheet, r, c, cache, visiting);
      },
      cell: function (ref) {
        const sheet = ref.sheet || sheetName;
        return cellValue(wb, sheet, ref.r, ref.c, cache, visiting);
      }
    };
    let v;
    try { v = evaluateAst(ast, ctx); } catch (e) { v = err(ERR.VALUE); }
    if (isRange(v)) return err(ERR.VALUE);
    return v;
  }

  function cellValue(wb, sheetName, r, c, cache, visiting) {
    const sheet = findSheet(wb, sheetName);
    if (!sheet) return err(ERR.REF);
    const addr = toA1(r, c);
    const key = sheet.name.toLowerCase() + '!' + addr;
    if (cache.has(key)) return cache.get(key);
    const cell = sheet.cells[addr];
    if (!cell) return '';
    if (cell.f) {
      if (visiting.has(key)) return err(ERR.CYCLE);
      visiting.add(key);
      let v;
      try {
        const body = cell.f.charAt(0) === '=' ? cell.f.slice(1) : cell.f;
        const ast = parse(tokenize(body));
        const ctx = {
          sheet: sheet.name,
          get: function (s, rr, cc) { return cellValue(wb, s, rr, cc, cache, visiting); },
          cell: function (ref) { return cellValue(wb, ref.sheet || sheet.name, ref.r, ref.c, cache, visiting); }
        };
        v = evaluateAst(ast, ctx);
        if (isRange(v)) v = err(ERR.VALUE);
      } catch (e) {
        v = err(ERR.PARSE);
      }
      visiting.delete(key);
      if (typeof v === 'number' && !isFinite(v)) v = err(ERR.NUM);
      cache.set(key, v);
      return v;
    }
    const v = cell.v === undefined ? '' : cell.v;
    cache.set(key, v);
    return v;
  }

  function cellDisplay(cell, wb, sheetName) {
    const addr = cell.__addr;
    let v;
    if (cell.f) v = evaluateFormula(cell.f, sheetName, wb);
    else v = cell.v === undefined ? '' : cell.v;
    return formatValue(v, cell.style && cell.style.nf);
  }

  // ---------------------------------------------------------------- formato
  function formatValue(v, fmt) {
    if (isErr(v)) return v.code;
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
    if (typeof v !== 'number') return String(v);
    fmt = (fmt || 'General').trim();
    if (!fmt || fmt.toLowerCase() === 'general') return formatGeneral(v);
    const f = fmt.toLowerCase();
    if (f.indexOf('%') >= 0) {
      const dec = (f.match(/0\.(0+)%/) || [])[1];
      return (v * 100).toFixed(dec ? dec.length : 0).replace('.', ',') + '%';
    }
    if (/d|m|y|h|s/.test(f) && /[\/\-:]/.test(f)) {
      const d = dateFromSerial(v);
      const pad = n => String(n).padStart(2, '0');
      const fecha = (sep) => pad(d.getUTCDate()) + sep + pad(d.getUTCMonth() + 1) + sep + d.getUTCFullYear();
      const iso = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
      const hora = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
      let out;
      if (/yyy[y]?[-]/.test(f)) out = iso;
      else if (/dd[\/\-]mm/.test(f)) out = fecha('/');
      else if (/mm[\/\-]dd/.test(f)) out = pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate()) + '/' + d.getUTCFullYear();
      else out = fecha('/');
      if (/hh|\[h\]/.test(f)) out += ' ' + hora;
      return out;
    }
    const money = /[$€]/.test(fmt);
    const decMatch = f.match(/0\.(0+)/);
    const dec = decMatch ? decMatch[1].length : (f.indexOf('0') >= 0 && f.indexOf('.') < 0 ? 0 : 2);
    const thousands = f.indexOf('#,##') >= 0 || f.indexOf('#.##') >= 0;
    let out = Math.abs(v).toFixed(dec);
    if (thousands) {
      const parts = out.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      out = parts.join('.');
    }
    if (v < 0) out = '-' + out;
    if (money) out = (fmt.indexOf('$') >= 0 ? '$' : '€') + out;
    return out;
  }

  // ---------------------------------------------------------------- API
  const API = {
    ERR: ERR, isErr: isErr, isRange: isRange,
    tokenize: tokenize, parse: parse, evaluate: evaluateAst,
    evaluateFormula: evaluateFormula, cellValue: cellValue, cellDisplay: cellDisplay,
    formatValue: formatValue, formatGeneral: formatGeneral,
    createWorkbook: createWorkbook, findSheet: findSheet,
    toA1: toA1, parseAddr: parseAddr, colName: colName, colIndex: colIndex,
    dateFromSerial: dateFromSerial, serialFromDate: serialFromDate,
    FUNCTIONS: Object.keys(FNS)
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.XLEngine = API;
})(typeof window !== 'undefined' ? window : globalThis);
