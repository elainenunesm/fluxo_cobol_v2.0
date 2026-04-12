// =====================================================================
// BANCO DE DADOS — DDL / DCLGEN parser + visualizador + gerador COBOL
// Suporta: CREATE TABLE (DDL), EXEC SQL DECLARE (DCLGEN), grupo 01 puro
// Reconhece: COMP, COMP-3, COMP-1, COMP-2, BINARY, VARCHAR, LOB, etc.
// =====================================================================

let _dbTables   = [];   // [{ id, name, source, rawSql, columns, cobolCode, hasImportedCobol }]
let _dbActiveId = null;
let _dbNextId   = 1;
let _dbActiveTab = 'cols'; // 'cols' | 'cobol'

// ========================= MODAL =========================

function dbOpenModal() {
  var ov = document.getElementById('db-overlay');
  if (!ov) return;
  ov.classList.add('open');
  _dbRenderTableList();
  if (!_dbTables.length) {
    _dbShowEmptyMain();
  } else {
    if (!_dbActiveId) _dbActiveId = _dbTables[0].id;
    _dbShowTab(_dbActiveTab);
    _dbRenderTableList();
  }
}
function dbCloseModal() {
  var ov = document.getElementById('db-overlay');
  if (ov) ov.classList.remove('open');
}
function dbOverlayClick(e) {
  if (e.target === document.getElementById('db-overlay')) dbCloseModal();
}

// ========================= IMPORT =========================

function dbTriggerImport() {
  document.getElementById('db-file-input').click();
}

function dbImportFile(event) {
  var files = event.target.files;
  if (!files || !files.length) return;
  var total = files.length, done = 0;

  Array.from(files).forEach(function(file) {
    // Try UTF-8 first, fallback to latin1
    var reader = new FileReader();
    reader.onload = function(e) {
      var src = e.target.result;
      // Detect garbled encoding heuristic: if >5% replacement chars, try latin1
      var badChars = (src.match(/\ufffd/g) || []).length;
      if (badChars > src.length * 0.05) {
        var r2 = new FileReader();
        r2.onload = function(e2) { _dbProcessImport(file.name, e2.target.result, finish); };
        r2.readAsText(file, 'windows-1252');
      } else {
        _dbProcessImport(file.name, src, finish);
      }
    };
    reader.readAsText(file, 'UTF-8');
  });

  function finish() {
    done++;
    if (done === total) {
      _dbRenderTableList();
      if (_dbTables.length) {
        _dbActiveId = _dbTables[_dbTables.length - 1].id;
        _dbShowTab(_dbActiveTab);
      }
      if (typeof _toastMsg === 'function')
        _toastMsg('✅ ' + total + ' arquivo(s) importado(s).');
    }
  }
  event.target.value = '';
}

function _dbProcessImport(filename, src, callback) {
  var results = _dbParseAuto(src, filename);
  if (results && results.length) {
    results.forEach(function(t) {
      _dbTables.push({
        id:               _dbNextId++,
        name:             t.name,
        source:           t.source,
        rawSql:           t.rawSql || '',
        columns:          t.columns || [],
        cobolCode:        t.cobolCode || '',
        hasImportedCobol: !!t.hasImportedCobol
      });
    });
  } else {
    alert('Arquivo "' + filename + '" não contém DDL (CREATE TABLE) nem DCLGEN reconhecível.');
  }
  if (callback) callback();
}

// ========================= AUTO-DETECT =========================

function _dbParseAuto(src) {
  if (/EXEC\s+SQL\s+DECLARE\s+/i.test(src)) return _dbParseDCLGEN(src);
  if (/CREATE\s+TABLE\b/i.test(src))         return _dbParseDDL(src);
  if (/^\s*01\s+/im.test(src))               return _dbParseCobolOnly(src);
  return null;
}

// ========================= DDL PARSER =========================

function _dbParseDDL(src) {
  // Remove comments
  src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  var tables = [];

  // Find all CREATE TABLE tokens
  var rx = /CREATE\s+TABLE\s+(?:[\w]+\.)?(\w+)\s*\(/gi;
  var m;
  while ((m = rx.exec(src)) !== null) {
    var tableName = m[1].toUpperCase();
    var openIdx   = m.index + m[0].length - 1; // position of '('
    var body      = _dbExtractParenBody(src, openIdx);
    if (!body) continue;
    var columns   = _dbParseColumnDefs(body);
    var cobolCode = _dbGenerateCobol(tableName, columns);
    tables.push({ name: tableName, source: 'ddl', rawSql: m[0] + body + ')', columns: columns, cobolCode: cobolCode });
  }
  return tables.length ? tables : null;
}

// ========================= DCLGEN PARSER =========================

function _dbParseDCLGEN(src) {
  var tables = [];

  // Match: EXEC SQL DECLARE tablename TABLE ( ... ) END-EXEC
  var rx = /EXEC\s+SQL\s+DECLARE\s+(?:[\w]+\.)?(\w+)\s+TABLE\s*\(/gi;
  var m;
  while ((m = rx.exec(src)) !== null) {
    var tableName = m[1].toUpperCase();
    var openIdx   = m.index + m[0].length - 1;
    var body      = _dbExtractParenBody(src, openIdx);
    if (!body) continue;
    var columns   = _dbParseColumnDefs(body);

    // Look for the 01 COBOL group immediately after the END-EXEC block
    var afterDecl = src.substring(openIdx + body.length + 1);
    var grpRx     = /01\s+([\w-]+)\s*\.\s*([\s\S]*?)(?=\s*01\s|\s*$)/i;
    var grpM      = afterDecl.match(grpRx);
    var importedCobol = null;
    if (grpM) {
      importedCobol = ('       01  ' + grpM[1].toUpperCase() + '.\n' + grpM[2]).replace(/\t/g, '    ');
      // Update column COBOL info from imported declarations
      _dbMergeCobolToColumns(columns, grpM[2]);
    }
    var cobolCode = importedCobol || _dbGenerateCobol(tableName, columns);

    tables.push({
      name:             tableName,
      source:           'dclgen',
      rawSql:           m[0] + body + ') END-EXEC',
      columns:          columns,
      cobolCode:        cobolCode,
      hasImportedCobol: !!importedCobol
    });
  }
  return tables.length ? tables : null;
}

// ========================= COBOL-ONLY PARSER (pure 01 group) =========================

function _dbParseCobolOnly(src) {
  var tables = [];
  var rx = /^\s*(01)\s+([\w-]+)\s*\.([\s\S]*?)(?=^\s*01\s|\s*$)/gmi;
  var m;
  while ((m = rx.exec(src)) !== null) {
    var grpName = m[2].toUpperCase();
    var body    = m[3];
    var cols    = _dbParseCobolGroup(body);
    if (!cols.length) continue;
    var tableName = grpName.replace(/^DCL/, '');
    tables.push({
      name:             tableName,
      source:           'cobol',
      rawSql:           '',
      columns:          cols,
      cobolCode:        ('       01  ' + grpName + '.\n' + body).replace(/\t/g, '    '),
      hasImportedCobol: true
    });
  }
  return tables.length ? tables : null;
}

// ========================= COLUMN DEFINITION PARSER =========================

function _dbParseColumnDefs(body) {
  var columns = [];
  var pkCols  = {};

  // Find PRIMARY KEY table constraint: PRIMARY KEY (col1, col2)
  var pkRx = /PRIMARY\s+KEY\s*\(([^)]+)\)/gi, pkM;
  while ((pkM = pkRx.exec(body)) !== null) {
    pkM[1].split(',').forEach(function(c) { pkCols[c.trim().toUpperCase()] = true; });
  }

  // Split by commas that are NOT inside parentheses
  var lines = _dbSplitColumns(body);

  lines.forEach(function(line) {
    line = line.trim();
    if (!line) return;
    // Skip table-level constraints
    if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|INDEX)\b/i.test(line)) return;

    // Column: name TYPE[(len[,scale])] [NOT NULL] [DEFAULT ...] [PRIMARY KEY] ...
    var cx = line.match(/^([\w"#@$-]+)\s+([\w\s]+?)\s*(?:\(\s*(\d+)\s*(?:,\s*(\d+))?\s*\))?(?:\s+(.*))?$/i);
    if (!cx) return;

    var colName = cx[1].replace(/['"]/g, '').toUpperCase();
    var sqlType = cx[2].trim().toUpperCase();
    var len     = cx[3] ? parseInt(cx[3]) : null;
    var scale   = cx[4] ? parseInt(cx[4]) : null;
    var rest    = cx[5] || '';
    var notNull = /NOT\s+NULL/i.test(line);
    var isPK    = /PRIMARY\s+KEY/i.test(rest) || !!pkCols[colName];
    var isIdent = /GENERATED|IDENTITY/i.test(rest);
    var dfltM   = /DEFAULT\s+(.+?)(?:\s+NOT\s+NULL|\s+PRIMARY|\s+GENERATED|$)/i.exec(rest);
    var dflt    = dfltM ? dfltM[1].trim() : null;

    // Handle compound types like "CHARACTER VARYING", "DOUBLE PRECISION"
    var fullType = sqlType;
    var cobolInfo = _dbSqlTypeToCobol(colName, fullType, len, scale);

    columns.push({
      name: colName, sqlType: fullType, len: len, scale: scale,
      notNull: notNull, isPK: isPK, isIdentity: isIdent, default: dflt,
      pic: cobolInfo.pic, usage: cobolInfo.usage,
      isVar: cobolInfo.isVar, cobolLines: cobolInfo.lines
    });
  });
  return columns;
}

// Split column defs respecting nested parens
function _dbSplitColumns(body) {
  var parts = [], depth = 0, cur = '';
  for (var i = 0; i < body.length; i++) {
    var ch = body[i];
    if (ch === '(') { depth++; cur += ch; }
    else if (ch === ')') { depth--; cur += ch; }
    else if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

// Find matching closing paren starting at openIdx
function _dbExtractParenBody(src, openIdx) {
  var depth = 0, i = openIdx;
  while (i < src.length) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) return src.substring(openIdx + 1, i); }
    i++;
  }
  return null;
}

// ========================= COBOL GROUP PARSER =========================

function _dbParseCobolGroup(body) {
  var columns = [];
  var lines = body.split('\n');
  lines.forEach(function(line) {
    // COBOL formato fixo: 1º char dígito → area de sequência → strip 6 bytes, checar col 7
    // 1º char espaço → formato livre → usa linha completa
    var code;
    if (line.length >= 7 && line[0] >= '0' && line[0] <= '9') {
      if (line[6] === '*' || line[6] === '/') return;
      code = line.substring(7);
    } else {
      code = line;
    }
    var t = code.replace(/\t/g,'    ').trim();
    if (!t || /^\*/.test(t)) return;
    // level name PIC ... [USAGE ...].
    var m = t.match(/^(\d{2})\s+([\w-]+)\s+(.+?)\.?\s*$/i);
    if (!m) return;
    var level = parseInt(m[1]);
    if (level < 5 || level > 49) return;
    var varName    = m[2].toUpperCase();
    var clauseStr  = m[3].trim();
    var picM      = clauseStr.match(/PIC(?:TURE)?\s+(?:IS\s+)?([\w()\.\/9XAZBsPVzb]+)/i);
    var usageM    = clauseStr.match(/USAGE\s+(?:IS\s+)?([\w-]+)/i) || clauseStr.match(/\b(COMP(?:-[0-9])?|BINARY|DISPLAY|POINTER)\b/i);
    var pic       = picM  ? picM[1].toUpperCase()   : '';
    var usage     = usageM ? usageM[1].toUpperCase() : '';
    var isInd     = /-IND$/.test(varName);
    columns.push({
      name: varName, sqlType: '', len: null, scale: null,
      notNull: false, isPK: false, isIdentity: false, isIndicator: isInd,
      pic: pic, usage: usage, isVar: false,
      cobolLines: ['           ' + String(m[1]).padStart(2,'0') + '  ' + varName + '   ' + clauseStr + '.']
    });
  });
  return columns;
}

// Merge COBOL group declarations back into column objects (enrich pic/usage)
function _dbMergeCobolToColumns(columns, cobolBody) {
  var lines = cobolBody.split('\n');
  lines.forEach(function(line) {
    // COBOL formato fixo: 1º char dígito → area de sequência → strip 6 bytes, checar col 7
    // 1º char espaço → formato livre → usa linha completa
    var code2;
    if (line.length >= 7 && line[0] >= '0' && line[0] <= '9') {
      if (line[6] === '*' || line[6] === '/') return;
      code2 = line.substring(7);
    } else {
      code2 = line;
    }
    var t = code2.replace(/\t/g,'    ').trim();
    var m = t.match(/^(\d{2})\s+([\w-]+)\s+(.+?)\.?\s*$/i);
    if (!m) return;
    var varName = m[2].toUpperCase();
    var clauseStr = m[3].trim();
    var picM  = clauseStr.match(/PIC(?:TURE)?\s+(?:IS\s+)?([\w()\.\/9XAZBsPVzb]+)/i);
    var usgM  = clauseStr.match(/USAGE\s+(?:IS\s+)?([\w-]+)/i) || clauseStr.match(/\b(COMP(?:-[0-9])?|BINARY|DISPLAY)\b/i);
    var col   = columns.find(function(c) { return c.name === varName || _dbCobolVarName(c.name) === varName; });
    if (col) {
      if (picM)  col.pic   = picM[1].toUpperCase();
      if (usgM)  col.usage = usgM[1].toUpperCase();
      col.cobolLines = ['           ' + m[1] + '  ' + varName + '   ' + clauseStr + '.'];
    }
  });
}

// ========================= SQL → COBOL TYPE MAPPING =========================

function _dbSqlTypeToCobol(colName, sqlType, len, scale) {
  var vn = _dbCobolVarName(colName);
  var t  = sqlType.toUpperCase();
  // Normalize compound types
  if (/CHARACTER\s+VARYING|CHAR\s+VARYING/.test(t))   t = 'VARCHAR';
  if (/DOUBLE\s+PRECISION/.test(t))                    t = 'DOUBLE';
  if (/CHARACTER|CHAR$/.test(t))                       t = 'CHAR';

  switch (t) {

    case 'CHAR':
    case 'CHARACTER': {
      var n = len || 1;
      return { pic: 'X(' + n + ')', usage: '', isVar: false,
        lines: ['           10  ' + _pad(vn,30) + ' PIC X(' + n + ').'] };
    }

    case 'VARCHAR':
    case 'CHARACTER VARYING':
    case 'CHAR VARYING': {
      var n = len || 1;
      return { pic: 'X(' + n + ')', usage: 'VARCHAR', isVar: true,
        lines: [
          '           10  ' + vn + '.',
          '               49  ' + _pad(vn + '-LEN', 28) + ' PIC S9(4) USAGE COMP.',
          '               49  ' + _pad(vn + '-DATA', 28) + ' PIC X(' + n + ').'
        ]};
    }

    case 'INT':
    case 'INTEGER':
      return { pic: 'S9(9)', usage: 'COMP', isVar: false,
        lines: ['           10  ' + _pad(vn,30) + ' PIC S9(9)  USAGE COMP.'] };

    case 'SMALLINT':
      return { pic: 'S9(4)', usage: 'COMP', isVar: false,
        lines: ['           10  ' + _pad(vn,30) + ' PIC S9(4)  USAGE COMP.'] };

    case 'BIGINT':
      return { pic: 'S9(18)', usage: 'COMP', isVar: false,
        lines: ['           10  ' + _pad(vn,30) + ' PIC S9(18) USAGE COMP.'] };

    case 'DECIMAL':
    case 'DEC':
    case 'NUMERIC':
    case 'NUM': {
      var p = len  || 9;
      var s = scale != null ? scale : 0;
      var intP = p - s;
      var pic  = 'S9(' + intP + ')' + (s > 0 ? 'V9(' + s + ')' : '');
      return { pic: pic, usage: 'COMP-3', isVar: false,
        lines: ['           10  ' + _pad(vn,30) + ' PIC ' + pic + ' USAGE COMP-3.'] };
    }

    case 'FLOAT':
    case 'REAL':
      return { pic: '', usage: 'COMP-1', isVar: false,
        lines: ['           10  ' + _pad(vn,30) + ' USAGE COMP-1.'] };

    case 'DOUBLE':
    case 'DOUBLE PRECISION':
      return { pic: '', usage: 'COMP-2', isVar: false,
        lines: ['           10  ' + _pad(vn,30) + ' USAGE COMP-2.'] };

    case 'DATE':
      return { pic: 'X(10)', usage: '', isVar: false,
        lines: ['           10  ' + _pad(vn,30) + ' PIC X(10).'] };

    case 'TIME':
      return { pic: 'X(8)', usage: '', isVar: false,
        lines: ['           10  ' + _pad(vn,30) + ' PIC X(8).'] };

    case 'TIMESTAMP':
      return { pic: 'X(26)', usage: '', isVar: false,
        lines: ['           10  ' + _pad(vn,30) + ' PIC X(26).'] };

    case 'CLOB':
    case 'BLOB':
    case 'DBCLOB': {
      var n = len || 32704;
      return { pic: 'X(' + n + ')', usage: 'LOB', isVar: true,
        lines: ['           10  ' + _pad(vn,30) + ' PIC X(' + n + ').  *> ' + t] };
    }

    case 'ROWID':
    case 'XML':
      return { pic: 'X(40)', usage: '', isVar: false,
        lines: ['           10  ' + _pad(vn,30) + ' PIC X(40).  *> ' + t] };

    default: {
      var n = len || 1;
      return { pic: 'X(' + n + ')', usage: '', isVar: false,
        lines: ['           10  ' + _pad(vn,30) + ' PIC X(' + n + ').  *> ' + t] };
    }
  }
}

function _dbCobolVarName(sqlName) {
  return sqlName.replace(/_/g, '-').replace(/[^A-Z0-9-]/gi, '').toUpperCase().substring(0, 30);
}
function _pad(s, n) { return (s + '                              ').substring(0, n); }

// ========================= COBOL CODE GENERATOR =========================

function _dbGenerateCobol(tableName, columns) {
  var groupName = ('DCL' + tableName).substring(0, 30);
  var lines = ['       01  ' + groupName + '.'];
  columns.forEach(function(col) {
    if (col.cobolLines && col.cobolLines.length) {
      col.cobolLines.forEach(function(l) { lines.push(l); });
    }
  });
  return lines.join('\n');
}

// ========================= RENDER: TABLE LIST =========================

function _dbRenderTableList() {
  var list = document.getElementById('db-tables-list');
  if (!list) return;
  var cnt  = document.getElementById('db-tables-cnt');
  if (cnt) cnt.textContent = _dbTables.length ? '(' + _dbTables.length + ')' : '';
  if (!_dbTables.length) {
    list.innerHTML = '<div class="db-list-empty">Nenhuma tabela importada.<br>Clique em <b>＋ Importar</b>.</div>';
    return;
  }
  list.innerHTML = _dbTables.map(function(t) {
    var active = t.id === _dbActiveId;
    var srcIcon = { ddl: '🗒', dclgen: '🔗', cobol: '📋' }[t.source] || '📋';
    return '<div class="db-table-item' + (active ? ' db-table-item--active' : '') + '" onclick="_dbSelectTable(' + t.id + ')">' +
      '<span class="db-ti-icon">' + srcIcon + '</span>' +
      '<span class="db-ti-name" title="' + _dbEsc(t.name) + '">' + _dbEsc(t.name) + '</span>' +
      '<span class="db-ti-meta">' + t.columns.length + '</span>' +
      '<span class="db-ti-del" onclick="event.stopPropagation();_dbDeleteTable(' + t.id + ')" title="Remover">✕</span>' +
      '</div>';
  }).join('');
}

function _dbSelectTable(id) {
  _dbActiveId = id;
  _dbRenderTableList();
  _dbShowTab(_dbActiveTab);
}

function _dbDeleteTable(id) {
  _dbTables = _dbTables.filter(function(t) { return t.id !== id; });
  if (_dbActiveId === id) _dbActiveId = _dbTables.length ? _dbTables[0].id : null;
  _dbRenderTableList();
  if (_dbActiveId) _dbShowTab(_dbActiveTab); else _dbShowEmptyMain();
}

// ========================= RENDER: TABS =========================

function _dbShowTab(tab) {
  _dbActiveTab = tab;
  ['cols','cobol','data'].forEach(function(t) {
    var btn = document.getElementById('db-tab-' + t);
    if (btn) btn.classList.toggle('db-tab--active', t === tab);
  });
  var pane = document.getElementById('db-main-pane');
  if (pane) pane.classList.toggle('db-pane-data', tab === 'data');
  if (tab === 'cols')  _dbRenderCols();
  if (tab === 'cobol') _dbRenderCobol();
  if (tab === 'data')  _dbRenderData();
}

function _dbShowEmptyMain() {
  var pane = document.getElementById('db-main-pane');
  if (pane) pane.innerHTML = '<div class="db-empty-main">Importe um arquivo <b>DDL</b> (.sql, .ddl)<br>ou <b>DCLGEN</b> (.cpy, .dclgen) para começar.</div>';
}

// ========================= RENDER: COLUMNS TAB =========================

function _dbRenderCols() {
  var pane = document.getElementById('db-main-pane');
  if (!pane) return;
  var t = _dbTables.find(function(x) { return x.id === _dbActiveId; });
  if (!t) { _dbShowEmptyMain(); return; }

  var srcLabel = { ddl: '🗒 DDL', dclgen: '🔗 DCLGEN', cobol: '📋 COBOL' }[t.source] || t.source;
  var html = '<div class="db-cols-wrap">';
  html += '<div class="db-tblhdr">';
  html += '<span class="db-tblhdr-name">🗄 ' + _dbEsc(t.name) + '</span>';
  html += '<span class="db-tblhdr-src db-src-' + t.source + '">' + srcLabel + '</span>';
  html += '<span class="db-tblhdr-cnt">' + t.columns.length + ' colunas</span>';
  html += '</div>';

  if (!t.columns.length) {
    html += '<div class="db-empty-main">Nenhuma coluna identificada.</div></div>';
    pane.innerHTML = html; return;
  }

  html += '<div class="db-col-scroll"><table class="db-col-table">';
  html += '<thead><tr><th>#</th><th>Coluna</th><th>Tipo SQL</th><th>Tam</th><th>Esc.</th><th title="NOT NULL">NN</th><th>PK</th><th>PIC / USAGE COBOL</th></tr></thead>';
  html += '<tbody>';
  t.columns.forEach(function(col, i) {
    var picCell = (col.pic ? ('PIC ' + col.pic) : '') + (col.usage ? (' ' + col.usage) : '');
    var isInd   = col.isIndicator;
    html += '<tr' + (isInd ? ' class="db-col-row-ind"' : '') + '>';
    html += '<td class="db-col-num">' + (i + 1) + '</td>';
    html += '<td class="db-col-name">';
    if (col.isPK)        html += '<span class="db-pk-icon" title="Primary Key">🔑</span>';
    if (col.isIdentity)  html += '<span class="db-id-icon" title="Identity/Generated">⚙</span>';
    if (isInd)           html += '<span class="db-ind-icon" title="Indicator Variable">ⓘ</span>';
    html += _dbEsc(col.name) + '</td>';
    html += '<td class="db-col-sqltype"><span class="db-sqltype-badge db-sql-' + col.sqlType.replace(/\s+/g,'_') + '">' + _dbEsc(col.sqlType || '—') + '</span></td>';
    html += '<td class="db-col-len">' + (col.len  != null ? col.len   : '—') + '</td>';
    html += '<td class="db-col-scale">' + (col.scale != null ? col.scale : '—') + '</td>';
    html += '<td class="db-col-null">'  + (col.notNull ? '<span class="db-nn-badge">NN</span>' : '<span class="db-null-badge">N</span>') + '</td>';
    html += '<td class="db-col-pk">'    + (col.isPK ? '<span class="db-pk-check">✓</span>' : '') + '</td>';
    html += '<td class="db-col-pic"><code class="db-pic-code">' + _dbEsc(picCell.trim() || '—') + '</code></td>';
    html += '</tr>';
  });
  html += '</tbody></table></div></div>';
  pane.innerHTML = html;
}

// ========================= RENDER: COBOL TAB =========================

function _dbRenderCobol() {
  var pane = document.getElementById('db-main-pane');
  if (!pane) return;
  var t = _dbTables.find(function(x) { return x.id === _dbActiveId; });
  if (!t) { _dbShowEmptyMain(); return; }

  var code    = t.cobolCode || _dbGenerateCobol(t.name, t.columns);
  var srcTag  = t.hasImportedCobol
    ? '<span class="db-cobol-src-tag db-cobol-src-imp">DCLGEN original</span>'
    : '<span class="db-cobol-src-tag">gerado automaticamente</span>';

  var html = '<div class="db-cobol-wrap">';
  html += '<div class="db-cobol-toolbar">';
  html += '<span class="db-cobol-title">📝 Variáveis COBOL — ' + _dbEsc(t.name) + ' ' + srcTag + '</span>';
  html += '<div class="db-cobol-btns">';
  html += '<button class="db-btn" onclick="_dbCopyCobol()" title="Copiar para área de transferência">📋 Copiar</button>';
  html += '<button class="db-btn db-btn--book" onclick="_dbEnviarParaBook()" title="Abrir no Book como novo copybook">📚 Abrir no Book</button>';
  html += '</div></div>';

  var lines = code.split('\n');
  html += '<div class="db-cobol-view">';
  html += '<div class="db-cobol-ln">' + lines.map(function(_, i) { return '<div>' + (i + 1) + '</div>'; }).join('') + '</div>';
  html += '<div class="db-cobol-code">' + lines.map(function(line) {
    return '<div class="db-cobol-line">' + _dbHlLine(line) + '</div>';
  }).join('') + '</div>';
  html += '</div></div>';
  pane.innerHTML = html;
}

// Simple COBOL syntax highlight
function _dbHlLine(line) {
  var s = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Comments (*>)  
  s = s.replace(/(\*&gt;.*)/g, '<span class="db-hl-cmt">$1</span>');
  // Keywords
  s = s.replace(/\b(PICTURE|PIC|USAGE|IS|COMP(?:-[0-9])?|BINARY|DISPLAY|POINTER|VALUE|SIGN|SEPARATE|LEADING|TRAILING|JUST(?:IFIED)?|RIGHT|LEFT|BLANK|WHEN|ZERO|ZEROS|SPACES|HIGH-VALUE|LOW-VALUE|NULL(?:S)?)\b/g,
    '<span class="db-hl-kw">$1</span>');
  // Level numbers at start
  s = s.replace(/^(\s+)(\d{2})(\s)/, '$1<span class="db-hl-lvl">$2</span>$3');
  // PIC string chars
  s = s.replace(/\b(S9\(\d+\)|9\(\d+\)|X\(\d+\)|A\(\d+\)|Z\(\d+\)|V9\(\d+\)|S9|V9|9|X|A|Z|V|S|P|B)\b/g,
    '<span class="db-hl-pic">$1</span>');
  return s;
}

// ========================= ACTIONS =========================

function _dbCopyCobol() {
  var t = _dbTables.find(function(x) { return x.id === _dbActiveId; });
  if (!t) return;
  var code = t.cobolCode || _dbGenerateCobol(t.name, t.columns);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(function() {
      if (typeof _toastMsg === 'function') _toastMsg('✅ Código COBOL copiado!');
    });
  } else {
    var ta = document.createElement('textarea');
    ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    if (typeof _toastMsg === 'function') _toastMsg('✅ Código COBOL copiado!');
  }
}

function _dbEnviarParaBook() {
  var t = _dbTables.find(function(x) { return x.id === _dbActiveId; });
  if (!t) return;
  var code = t.cobolCode || _dbGenerateCobol(t.name, t.columns);
  dbCloseModal();
  setTimeout(function() {
    if (typeof bookOpenModal === 'function') bookOpenModal();
    setTimeout(function() {
      if (typeof bkAddBookWithSrc === 'function') {
        bkAddBookWithSrc(t.name, code, true);
      } else {
        var ta = document.getElementById('book-textarea');
        if (ta) { ta.value = code; if (typeof updateBookEditor === 'function') updateBookEditor(); }
      }
      if (typeof _toastMsg === 'function') _toastMsg('✅ Variáveis enviadas para o Book: ' + t.name);
    }, 250);
  }, 120);
}

function _dbAllCobolToClipboard() {
  var all = _dbTables.map(function(t) {
    return (t.cobolCode || _dbGenerateCobol(t.name, t.columns));
  }).join('\n\n');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(all).then(function() {
      if (typeof _toastMsg === 'function') _toastMsg('✅ Todas as tabelas copiadas (' + _dbTables.length + ')!');
    });
  }
}

// ========================= HELPERS =========================

function _dbEsc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _dbDropFile(event) {
  event.preventDefault();
  var files = event.dataTransfer && event.dataTransfer.files;
  if (!files || !files.length) return;
  var fakeEvt = { target: { files: files, value: '' } };
  dbImportFile(fakeEvt);
}

// ================================================================
// DADOS — grade de dados por tabela (importar / editar / exportar)
// ================================================================

var _dbDataStore  = {}; // {tableId: [{fields:{colName:val}}]}
var _dbDataPage   = {}; // {tableId: currentPage (1-based)}
var _DB_PAGE_SZ   = 20;
var _dbDataRawVis = false;
var _dbFmtStore   = {}; // {tableId: {colName: {type,decimals,thousands,...}}}

// Colunas visíveis: exclui indicadores
function _dbDataGetCols(t) {
  return (t.columns || []).filter(function(c) { return !c.isIndicator; });
}

function _dbGetDataRows(tableId) {
  if (!_dbDataStore[tableId]) _dbDataStore[tableId] = [];
  return _dbDataStore[tableId];
}

// ---- Render principal da aba Dados ----
function _dbRenderData() {
  var pane = document.getElementById('db-main-pane');
  if (!pane) return;
  var t = _dbTables.find(function(x) { return x.id === _dbActiveId; });
  if (!t) { _dbShowEmptyMain(); return; }

  var rows = _dbGetDataRows(t.id);
  var cols = _dbDataGetCols(t);
  var tid  = t.id;

  var html = '<div class="db-data-wrap">';

  // ---- Toolbar ----
  html += '<div class="db-data-toolbar">';
  // + Linha
  html += '<div class="bk-dtb-group"><button class="db-dtb-btn db-dtb-primary" onclick="_dbDataAddRow(' + tid + ')">&#43; Linha</button></div>';

  // Importar ▾
  html += '<div class="bk-dtb-group"><div class="bk-dtb-dropdown">';
  html += '<button class="db-dtb-btn" onclick="bkDtbToggleMenu(event,\'db-imp-menu\')">&#128230; Importar &#9660;</button>';
  html += '<div class="bk-dtb-menu" id="db-imp-menu">';
  html += '<div class="bk-dtb-menu-sec">TXT Posicional</div>';
  html += '<button class="bk-dtb-menu-item" onclick="_dbDataTriggerTxt()">&#128462; Padr&atilde;o (posicional)</button>';
  html += '<div class="bk-dtb-menu-div"></div>';
  html += '<div class="bk-dtb-menu-sec">Planilha / Estruturado</div>';
  html += '<button class="bk-dtb-menu-item" onclick="document.getElementById(\'db-data-file-csv\').click()">&#128202; Excel / CSV</button>';
  html += '<button class="bk-dtb-menu-item" onclick="document.getElementById(\'db-data-file-json\').click()">&#128195; JSON</button>';
  html += '<button class="bk-dtb-menu-item" onclick="_dbDataToggleRaw()">&#128196; Bruto (colar)</button>';
  html += '</div></div></div>';

  // Formatos
  html += '<div class="bk-dtb-group"><button class="db-dtb-btn bk-dtb-btn-fmt" onclick="_dbOpenFmtDialog(' + tid + ')">&#9881; Formatos</button></div>';

  // Exportar ▾
  html += '<div class="bk-dtb-group"><div class="bk-dtb-dropdown">';
  html += '<button class="db-dtb-btn" onclick="bkDtbToggleMenu(event,\'db-exp-menu\')">&#8659; Exportar &#9660;</button>';
  html += '<div class="bk-dtb-menu" id="db-exp-menu">';
  html += '<button class="bk-dtb-menu-item" onclick="_dbDataExportCsv()">&#8659; CSV</button>';
  html += '<button class="bk-dtb-menu-item" onclick="_dbDataExportTxt()">&#8659; TXT posicional</button>';
  html += '<button class="bk-dtb-menu-item" onclick="_dbDataExportXls()">&#8659; Excel</button>';
  html += '<button class="bk-dtb-menu-item" onclick="_dbDataExportJson()">&#8659; JSON</button>';
  html += '</div></div></div>';

  // Limpar + contador (margem automática)
  html += '<div class="bk-dtb-group" style="margin-left:auto;border-right:none;">';
  html += '<span class="db-data-cnt">' + rows.length + ' reg.</span>';
  html += '<button class="db-dtb-btn db-dtb-danger" onclick="_dbDataClear(' + tid + ')">&#128465; Limpar</button>';
  html += '</div>';
  html += '</div>'; // toolbar

  // ---- Área de colar bruto ----
  html += '<div id="db-data-raw-bar" class="db-data-raw-bar' + (_dbDataRawVis ? '' : ' hidden') + '">';
  html += '<textarea id="db-data-raw-ta" class="db-data-raw-ta" rows="4" placeholder="Cole linhas CSV (sep: v\u00edrgula, ponto-e-v\u00edrgula ou tab). A primeira linha pode ser cabe\u00e7alho com nomes das colunas."></textarea>';
  html += '<div class="db-data-raw-btns">';
  html += '<button class="db-dtb-btn" onclick="_dbDataDecodeRaw(' + tid + ')">&#10004; Importar</button>';
  html += '<button class="db-dtb-btn" onclick="_dbDataToggleRaw()">Cancelar</button>';
  html += '</div></div>';

  // ---- Grade ----
  if (!rows.length) {
    html += '<div class="db-data-grid-wrap"><div class="db-data-empty">Sem registros. Clique <b>+ Linha</b> ou use <b>Importar</b>.</div></div>';
  } else {
    var totalRows  = rows.length;
    var totalPages = Math.max(1, Math.ceil(totalRows / _DB_PAGE_SZ));
    if (!_dbDataPage[tid] || _dbDataPage[tid] < 1) _dbDataPage[tid] = 1;
    if (_dbDataPage[tid] > totalPages)              _dbDataPage[tid] = totalPages;
    var curPage = _dbDataPage[tid];
    var from    = (curPage - 1) * _DB_PAGE_SZ;
    var to      = Math.min(from + _DB_PAGE_SZ, totalRows);

    html += '<div class="db-data-grid-wrap">';
    html += '<table class="db-data-grid-tbl"><thead><tr>';
    html += '<th class="db-dg-th db-dg-seq">#</th>';
    cols.forEach(function(col) {
      var tip = _dbEsc(col.sqlType + (col.len != null ? '(' + col.len + (col.scale != null ? ',' + col.scale : '') + ')' : '') + (col.notNull ? ' NOT NULL' : '') + (col.isPK ? ' [PK]' : ''));
      var pk  = col.isPK ? ' <span class="db-dg-pk" title="Primary Key">&#128273;</span>' : '';
      html += '<th class="db-dg-th" title="' + tip + '">' + _dbEsc(col.name) + pk + '</th>';
    });
    html += '<th class="db-dg-th db-dg-act-h"></th></tr></thead><tbody>';

    for (var i = from; i < to; i++) {
      var row = rows[i];
      html += '<tr class="db-dg-row">';
      html += '<td class="db-dg-td db-dg-seq">' + (i + 1) + '</td>';
      cols.forEach(function(col) {
        var rawVal = (row.fields || {})[col.name];
        var val    = String(rawVal !== undefined && rawVal !== null ? rawVal : '');
        val = val.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
        html += '<td class="db-dg-td"><input class="db-dg-inp" data-tbl="' + tid + '" data-row="' + i + '" data-col="' + _dbEsc(col.name) + '" value="' + val + '" oninput="_dbDataSetCell(this)"></td>';
      });
      html += '<td class="db-dg-td db-dg-act-td"><button class="db-dg-del-btn" onclick="_dbDataDeleteRow(' + tid + ',' + i + ')">&#10005;</button></td>';
      html += '</tr>';
    }
    html += '</tbody></table>';

    // Paginador
    if (totalPages > 1) {
      html += '<div class="db-dg-pager">';
      html += '<button class="db-dg-pgr-btn"' + (curPage <= 1 ? ' disabled' : ' onclick="_dbDataGoPage(' + tid + ',' + (curPage - 1) + ')"') + '>&#8592;</button>';
      var showPages = [1, totalPages];
      for (var pp = Math.max(2, curPage - 2); pp <= Math.min(totalPages - 1, curPage + 2); pp++) {
        if (showPages.indexOf(pp) === -1) showPages.push(pp);
      }
      showPages.sort(function(a,b){ return a - b; });
      var prevPg = 0;
      showPages.forEach(function(pg) {
        if (prevPg && pg - prevPg > 1) html += '<span class="db-dg-pgr-ellipsis">\u2026</span>';
        html += '<button class="db-dg-pgr-btn' + (pg === curPage ? ' db-dg-pgr-active' : '') + '" onclick="_dbDataGoPage(' + tid + ',' + pg + ')">' + pg + '</button>';
        prevPg = pg;
      });
      html += '<button class="db-dg-pgr-btn"' + (curPage >= totalPages ? ' disabled' : ' onclick="_dbDataGoPage(' + tid + ',' + (curPage + 1) + ')"') + '>&#8594;</button>';
      html += '<span class="db-dg-pgr-info">' + (from + 1) + '\u2013' + to + ' de ' + totalRows + ' reg.</span>';
      html += '</div>';
    }
    html += '</div>'; // grid-wrap
  }
  html += '</div>'; // data-wrap
  pane.innerHTML = html;
}

// ---- CRUD ----
function _dbDataAddRow(tableId) {
  var rows = _dbGetDataRows(tableId);
  rows.push({ fields: {} });
  var totalPages = Math.max(1, Math.ceil(rows.length / _DB_PAGE_SZ));
  _dbDataPage[tableId] = totalPages;
  _dbRenderData();
}

function _dbDataDeleteRow(tableId, idx) {
  var rows = _dbGetDataRows(tableId);
  rows.splice(idx, 1);
  _dbRenderData();
}

function _dbDataSetCell(inp) {
  var tableId = parseInt(inp.dataset.tbl, 10);
  var rowIdx  = parseInt(inp.dataset.row, 10);
  var colName = inp.dataset.col;
  var rows = _dbGetDataRows(tableId);
  if (!rows[rowIdx]) return;
  if (!rows[rowIdx].fields) rows[rowIdx].fields = {};
  rows[rowIdx].fields[colName] = inp.value;
}

function _dbDataGoPage(tableId, page) {
  _dbDataPage[tableId] = page;
  _dbRenderData();
}

function _dbDataClear(tableId) {
  var rows = _dbGetDataRows(tableId);
  if (rows.length > 0 && !confirm('Limpar todos os registros desta tabela?')) return;
  _dbDataStore[tableId] = [];
  _dbDataPage[tableId]  = 1;
  _dbDataRawVis         = false;
  _dbRenderData();
}

function _dbDataToggleRaw() {
  _dbDataRawVis = !_dbDataRawVis;
  var bar = document.getElementById('db-data-raw-bar');
  if (!bar) return;
  bar.classList.toggle('hidden', !_dbDataRawVis);
  if (_dbDataRawVis) { var ta = document.getElementById('db-data-raw-ta'); if (ta) ta.focus(); }
}

// ---- Import CSV ----
function _dbDataImportCsvFile(inp) {
  if (!inp.files || !inp.files.length) return;
  var t = _dbTables.find(function(x) { return x.id === _dbActiveId; });
  if (!t) { inp.value = ''; return; }
  var file  = inp.files[0];
  var isXls = /\.(xlsx|xls)$/i.test(file.name);
  inp.value = '';
  if (isXls) { _dbDataImportXlsxFile(file, t); return; }
  var reader = new FileReader();
  reader.onload = function(e) { _dbDataParseCsvText(e.target.result, t); };
  reader.onerror = function() { alert('Erro ao ler o arquivo.'); };
  reader.readAsText(file, 'UTF-8');
}

function _dbDataParseCsvText(text, t) {
  var cols  = _dbDataGetCols(t);
  var lines = text.split(/\r?\n/).filter(function(l) { return l.trim(); });
  if (!lines.length) return;
  // Auto-detecta separador
  var firstLine = lines[0];
  var sep = firstLine.indexOf(';') !== -1 ? ';' : (firstLine.indexOf('\t') !== -1 ? '\t' : ',');

  function parseRow(line) {
    var result = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === sep && !inQ) { result.push(cur); cur = ''; }
      else cur += ch;
    }
    result.push(cur);
    return result;
  }

  var firstRow  = parseRow(firstLine);
  var colNames  = cols.map(function(c) { return c.name.toLowerCase(); });
  var isHeader  = firstRow.some(function(h) { return colNames.indexOf(h.trim().toLowerCase()) !== -1; });
  var headers   = isHeader ? firstRow.map(function(h) { return h.trim().toUpperCase(); }) : cols.map(function(c) { return c.name; });
  var startLine = isHeader ? 1 : 0;

  var rows = _dbGetDataRows(t.id);
  for (var li = startLine; li < lines.length; li++) {
    var cells  = parseRow(lines[li]);
    var fields = {};
    headers.forEach(function(hdr, hi) { if (cells[hi] !== undefined) fields[hdr] = cells[hi]; });
    rows.push({ fields: fields });
  }
  _dbDataPage[t.id] = 1;
  _dbRenderData();
  if (typeof _toastMsg === 'function') _toastMsg('\u2705 ' + (lines.length - startLine) + ' registros importados.');
}

// ---- Import Excel (XLSX via JSZip) ----
function _dbDataImportXlsxFile(file, t) {
  if (typeof JSZip === 'undefined') { alert('Biblioteca JSZip n\u00e3o dispon\u00edvel. Use o formato CSV.'); return; }
  var reader = new FileReader();
  reader.onload = function(e) {
    JSZip.loadAsync(e.target.result).then(function(zip) {
      var sheetEntry = zip.file('xl/worksheets/sheet1.xml');
      var ssEntry    = zip.file('xl/sharedStrings.xml');
      if (!sheetEntry) { alert('N\u00e3o foi poss\u00edvel ler a planilha. Use CSV.'); return; }
      var sheetP = sheetEntry.async('text');
      var ssP    = ssEntry ? ssEntry.async('text') : Promise.resolve(null);
      Promise.all([sheetP, ssP]).then(function(res) { _dbDataParseXlsxXml(res[0], res[1], t); });
    }).catch(function(err) { alert('Erro ao ler Excel: ' + err.message); });
  };
  reader.readAsArrayBuffer(file);
}

function _dbDataParseXlsxXml(sheetXml, ssXml, t) {
  // Shared strings
  var ss = [];
  if (ssXml) {
    var siRx = /<si>[\s\S]*?<\/si>/g, siM;
    while ((siM = siRx.exec(ssXml)) !== null) {
      var tRx = /<t[^>]*>([^<]*)<\/t>/g, tM, parts = [];
      while ((tM = tRx.exec(siM[0])) !== null) parts.push(tM[1]);
      ss.push(parts.join(''));
    }
  }
  // Rows
  var rows2d = [];
  var rowRx  = /<row[^>]*>([\s\S]*?)<\/row>/g, rowM;
  while ((rowM = rowRx.exec(sheetXml)) !== null) {
    var cellData = {}, maxIdx = 0;
    var cellRx   = /<c ([^>]*)>([\s\S]*?)<\/c>/g, cm;
    while ((cm = cellRx.exec(rowM[1])) !== null) {
      var attrs  = cm[1], inner = cm[2];
      var tAttr  = (attrs.match(/\bt="([^"]+)"/) || [])[1] || '';
      var refArr = attrs.match(/r="([A-Z]+)\d+"/) || [];
      var colRef = refArr[1] || 'A';
      var colIdx = 0;
      for (var ci2 = 0; ci2 < colRef.length; ci2++) colIdx = colIdx * 26 + (colRef.charCodeAt(ci2) - 64);
      colIdx--; // 0-based
      var vM  = inner.match(/<v>([^<]*)<\/v>/);
      var val = '';
      if (vM) {
        val = vM[1];
        if (tAttr === 's') val = ss[parseInt(val, 10)] || '';
      } else {
        var isM = inner.match(/<is>[\s\S]*?<t[^>]*>([^<]*)<\/t>/);
        if (isM) val = isM[1];
      }
      cellData[colIdx] = val;
      if (colIdx > maxIdx) maxIdx = colIdx;
    }
    var arr = [];
    for (var ci3 = 0; ci3 <= maxIdx; ci3++) arr.push(cellData[ci3] !== undefined ? cellData[ci3] : '');
    rows2d.push(arr);
  }
  if (!rows2d.length) return;
  var cols    = _dbDataGetCols(t);
  var colNames = cols.map(function(c) { return c.name.toLowerCase(); });
  var first    = rows2d[0];
  var isHeader = first && first.some(function(h) { return h && colNames.indexOf(String(h).toLowerCase()) !== -1; });
  var headers  = isHeader ? first.map(function(h) { return String(h || '').trim().toUpperCase(); }) : cols.map(function(c) { return c.name; });
  var startRow = isHeader ? 1 : 0;
  var dbRows   = _dbGetDataRows(t.id);
  for (var ri = startRow; ri < rows2d.length; ri++) {
    var cells = rows2d[ri];
    var fields = {};
    headers.forEach(function(hdr, hi) { if (cells[hi] !== undefined) fields[hdr] = cells[hi]; });
    if (Object.keys(fields).length) dbRows.push({ fields: fields });
  }
  _dbDataPage[t.id] = 1;
  _dbRenderData();
  if (typeof _toastMsg === 'function') _toastMsg('\u2705 ' + (rows2d.length - startRow) + ' registros importados do Excel.');
}

// ---- Import JSON ----
function _dbDataImportJsonFile(inp) {
  if (!inp.files || !inp.files.length) return;
  var t = _dbTables.find(function(x) { return x.id === _dbActiveId; });
  if (!t) { inp.value = ''; return; }
  var file = inp.files[0];
  inp.value = '';
  var reader = new FileReader();
  reader.onload = function(e) {
    try { _dbDataParseJson(JSON.parse(e.target.result), t); }
    catch(err) { alert('JSON inv\u00e1lido: ' + err.message); }
  };
  reader.readAsText(file, 'UTF-8');
}

function _dbDataParseJson(data, t) {
  var arr = Array.isArray(data) ? data : (data.rows || data.data || (typeof data === 'object' ? [data] : []));
  if (!arr.length) { alert('JSON n\u00e3o cont\u00e9m registros.'); return; }
  var cols   = _dbDataGetCols(t);
  var colMap = {};
  cols.forEach(function(c) { colMap[c.name.toLowerCase()] = c.name; });
  var rows = _dbGetDataRows(t.id);
  arr.forEach(function(obj) {
    var fields = {};
    Object.keys(obj || {}).forEach(function(k) {
      var mapped = colMap[k.toLowerCase()];
      if (mapped) fields[mapped] = String(obj[k] !== null && obj[k] !== undefined ? obj[k] : '');
    });
    rows.push({ fields: fields });
  });
  _dbDataPage[t.id] = 1;
  _dbRenderData();
  if (typeof _toastMsg === 'function') _toastMsg('\u2705 ' + arr.length + ' registros importados do JSON.');
}

// ---- Colar bruto ----
function _dbDataDecodeRaw(tableId) {
  var ta = document.getElementById('db-data-raw-ta');
  if (!ta || !ta.value.trim()) return;
  var t = _dbTables.find(function(x) { return x.id === tableId; });
  if (!t) return;
  _dbDataParseCsvText(ta.value, t);
  ta.value      = '';
  _dbDataRawVis = false;
  var bar = document.getElementById('db-data-raw-bar');
  if (bar) bar.classList.add('hidden');
}

// ---- Aplicar formato de exportação ----
function _dbApplyFmt(tableId, colName, val) {
  var fmts = _dbFmtStore[tableId];
  if (!fmts) return String(val || '');
  var cfg = fmts[colName];
  if (!cfg || !cfg.type || cfg.type === 'none') return String(val || '');
  // Reutiliza _bkApplyFieldFmt do copybook.js (mesma página)
  if (typeof _bkApplyFieldFmt === 'function') return _bkApplyFieldFmt(String(val || ''), cfg);
  return String(val || '');
}

// ---- TXT Posicional ----
function _dbColDisplayLen(col) {
  var t = (col.sqlType || '').toUpperCase().replace(/[\s]+/g, '_');
  if (col.len != null) {
    var extra = (col.scale != null && col.scale > 0) ? col.scale + 1 : 0; // ponto decimal
    return col.len + extra + ((/DECIMAL|NUMERIC|DEC|NUM/.test(t)) ? 2 : 0); // sinal + ponto
  }
  if (/BIGINT/.test(t))   return 20;
  if (/SMALLINT/.test(t)) return 6;
  if (/INTEGER|INT\b/.test(t)) return 11;
  if (/DOUBLE|FLOAT|REAL/.test(t)) return 20;
  if (/TIMESTAMP/.test(t)) return 26;
  if (/DATE/.test(t)) return 10;
  if (/TIME/.test(t)) return 8;
  return col.len || 10;
}

function _dbDataTriggerTxt() { document.getElementById('db-data-file-txt').click(); }

function _dbDataImportTxtFile(inp) {
  if (!inp.files || !inp.files.length) return;
  var t = _dbTables.find(function(x) { return x.id === _dbActiveId; });
  if (!t) { inp.value = ''; return; }
  var file = inp.files[0];
  inp.value = '';
  var cols = _dbDataGetCols(t);
  // Computa faixas posicionais
  var ranges = [], pos = 0;
  cols.forEach(function(col) {
    var w = _dbColDisplayLen(col);
    ranges.push({ col: col, from: pos, to: pos + w });
    pos += w;
  });
  var reader = new FileReader();
  reader.onload = function(e) {
    var lines = (e.target.result || '').split(/\r?\n/).filter(function(l) { return l.trim().length > 0; });
    var rows = _dbGetDataRows(t.id);
    lines.forEach(function(line) {
      var fields = {};
      ranges.forEach(function(r) {
        fields[r.col.name] = line.length > r.from ? line.substring(r.from, r.to) : '';
      });
      rows.push({ fields: fields });
    });
    _dbDataPage[t.id] = 1;
    _dbRenderData();
    if (typeof _toastMsg === 'function') _toastMsg('\u2705 ' + lines.length + ' registros importados do TXT.');
  };
  reader.onerror = function() { alert('Erro ao ler arquivo.'); };
  reader.readAsText(file, 'latin1');
}

// ---- Export TXT Posicional ----
function _dbDataExportTxt() {
  var t = _dbTables.find(function(x) { return x.id === _dbActiveId; });
  if (!t) return;
  var cols = _dbDataGetCols(t);
  var rows = _dbGetDataRows(t.id);
  if (!rows.length) { alert('Sem dados para exportar.'); return; }
  var widths = cols.map(function(col) { return _dbColDisplayLen(col); });
  var lines = rows.map(function(row) {
    return cols.map(function(col, i) {
      var v = _dbApplyFmt(t.id, col.name, (row.fields || {})[col.name] || '');
      var w = widths[i];
      return (v + ' '.repeat(w + 1)).substring(0, w);
    }).join('');
  });
  _dbDataDownload(t.name + '-dados.txt', lines.join('\r\n'), 'text/plain;charset=latin1;');
}

// ---- Export CSV ----
function _dbDataExportCsv() {
  var t = _dbTables.find(function(x) { return x.id === _dbActiveId; });
  if (!t) return;
  var cols = _dbDataGetCols(t);
  var rows = _dbGetDataRows(t.id);
  if (!rows.length) { alert('Sem dados para exportar.'); return; }
  function qesc(v) { v = String(v); return (/[,"\n]/.test(v)) ? '"' + v.replace(/"/g,'""') + '"' : v; }
  var lines = [cols.map(function(c) { return qesc(c.name); }).join(',')];
  rows.forEach(function(row) {
    lines.push(cols.map(function(c) {
      return qesc(_dbApplyFmt(t.id, c.name, (row.fields || {})[c.name] || ''));
    }).join(','));
  });
  _dbDataDownload(t.name + '-dados.csv', lines.join('\r\n'), 'text/csv;charset=utf-8;');
}

// ---- Export JSON ----
function _dbDataExportJson() {
  var t = _dbTables.find(function(x) { return x.id === _dbActiveId; });
  if (!t) return;
  var cols = _dbDataGetCols(t);
  var rows = _dbGetDataRows(t.id);
  if (!rows.length) { alert('Sem dados para exportar.'); return; }
  var out = rows.map(function(row) {
    var obj = {};
    cols.forEach(function(c) { obj[c.name] = _dbApplyFmt(t.id, c.name, (row.fields || {})[c.name] || ''); });
    return obj;
  });
  _dbDataDownload(t.name + '-dados.json', JSON.stringify(out, null, 2), 'application/json');
}

// ---- Export XLS (XML Spreadsheet) ----
function _dbDataExportXls() {
  var t = _dbTables.find(function(x) { return x.id === _dbActiveId; });
  if (!t) return;
  var cols = _dbDataGetCols(t);
  var rows = _dbGetDataRows(t.id);
  if (!rows.length) { alert('Sem dados para exportar.'); return; }
  function xe(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  var xml = '<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n';
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"';
  xml += ' xmlns:x="urn:schemas-microsoft-com:office:excel">';
  xml += '<Styles><Style ss:ID="hdr"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#166534" ss:Pattern="Solid"/></Style></Styles>';
  xml += '<Worksheet ss:Name="' + xe(t.name.substring(0,31)) + '"><Table>';
  xml += '<Row>' + cols.map(function(c) { return '<Cell ss:StyleID="hdr"><Data ss:Type="String">' + xe(c.name) + '</Data></Cell>'; }).join('') + '</Row>';
  rows.forEach(function(row) {
    xml += '<Row>' + cols.map(function(c) {
      var v = _dbApplyFmt(t.id, c.name, (row.fields || {})[c.name] || '');
      return '<Cell><Data ss:Type="String">' + xe(v) + '</Data></Cell>';
    }).join('') + '</Row>';
  });
  xml += '</Table></Worksheet></Workbook>';
  _dbDataDownload(t.name + '-dados.xls', xml, 'application/vnd.ms-excel;charset=utf-8;');
}

// ---- Formatos de exportação ----
function _dbOpenFmtDialog(tableId) {
  var t = _dbTables.find(function(x) { return x.id === tableId; });
  if (!t) return;
  var cols = _dbDataGetCols(t);
  if (!_dbFmtStore[tableId]) _dbFmtStore[tableId] = {};
  var fmts = _dbFmtStore[tableId];

  var TYPE_LABELS = [
    ['none',  '— nenhum —'],
    ['trim',  'Trim (apara espaços)'],
    ['num',   'Numérico'],
    ['mask',  'Máscara'],
    ['date',  'Data'],
    ['cpf',   'CPF (###.###.###-##)'],
    ['cnpj',  'CNPJ (##.###.###/####-##)']
  ];

  var old = document.getElementById('bk-popup-ov');
  if (old) old.remove();
  var oldp = document.getElementById('bk-popup-main');
  if (oldp) oldp.remove();

  var ov = document.createElement('div');
  ov.className = 'bk-popup-overlay'; ov.id = 'bk-popup-ov';
  ov.onclick = function(e) { if (e.target === ov) _dbFmtClose(); };

  var pop = document.createElement('div');
  pop.className = 'bk-popup-wrap bk-fmt-dialog'; pop.id = 'bk-popup-main';

  function buildExtra(fname) {
    var cfg = fmts[fname] || { type: 'none' };
    var ty  = cfg.type || 'none';
    if (ty === 'num') {
      return '<span class="bk-fmt-extra">'
        + 'Dec: <input type="number" min="0" max="18" value="' + (cfg.decimals || 0) + '" style="width:40px" data-f="' + fname + '" data-p="decimals">'
        + '<label><input type="checkbox" data-f="' + fname + '" data-p="thousands"' + (cfg.thousands ? ' checked' : '') + '> Milhar</label>'
        + '<label><input type="checkbox" data-f="' + fname + '" data-p="abs"' + (cfg.abs ? ' checked' : '') + '> Abs</label>'
        + '</span>';
    }
    if (ty === 'mask') {
      return '<span class="bk-fmt-extra">Máscara: <input type="text" value="' + _dbEsc(cfg.mask || '') + '" placeholder="ex: ###.###-##" style="width:120px" data-f="' + fname + '" data-p="mask"></span>';
    }
    if (ty === 'date') {
      var DPTS = (typeof _BK_DATE_FMTS !== 'undefined') ? _BK_DATE_FMTS : [['YYYYMMDD','AAAAMMDD'],['DDMMYYYY','DDMMAAAA'],['DD/MM/YYYY','DD/MM/AAAA'],['YYYY-MM-DD','AAAA-MM-DD']];
      var fromOpts = DPTS.map(function(d) { return '<option value="' + d[0] + '"' + ((cfg.dateFrom || 'YYYYMMDD') === d[0] ? ' selected' : '') + '>' + d[1] + '</option>'; }).join('');
      var toOpts   = DPTS.map(function(d) { return '<option value="' + d[0] + '"' + ((cfg.dateTo || 'DD/MM/YYYY') === d[0] ? ' selected' : '') + '>' + d[1] + '</option>'; }).join('');
      return '<span class="bk-fmt-extra">De:&nbsp;<select class="bk-fmt-sel" data-f="' + fname + '" data-p="dateFrom">' + fromOpts + '</select>&nbsp;Para:&nbsp;<select class="bk-fmt-sel" data-f="' + fname + '" data-p="dateTo">' + toOpts + '</select></span>';
    }
    return '';
  }

  var rowsHtml = cols.map(function(col) {
    var cfg  = fmts[col.name] || { type: 'none' };
    var opts = TYPE_LABELS.map(function(tl) { return '<option value="' + tl[0] + '"' + (cfg.type === tl[0] ? ' selected' : '') + '>' + tl[1] + '</option>'; }).join('');
    var sqlInfo = (col.sqlType || '') + (col.len != null ? '(' + col.len + (col.scale != null ? ',' + col.scale : '') + ')' : '');
    return '<tr class="bk-fmt-row" data-fname="' + col.name + '">'
      + '<td class="bk-fmt-name">' + _dbEsc(col.name) + '</td>'
      + '<td class="bk-fmt-pic">' + _dbEsc(sqlInfo) + '</td>'
      + '<td><select class="bk-fmt-sel" data-f="' + col.name + '" onchange="_dbFmtSelChange(this,' + tableId + ')">' + opts + '</select></td>'
      + '<td class="bk-fmt-extra-td" id="db-fmt-extra-' + col.name + '">' + buildExtra(col.name) + '</td>'
      + '</tr>';
  }).join('');

  pop.innerHTML = '<div class="bk-pop-title" style="display:flex;justify-content:space-between;align-items:center;">'
    + '<span>&#9881; Formatos de exporta&ccedil;&atilde;o &mdash; ' + _dbEsc(t.name) + '</span>'
    + '<button class="db-dtb-btn" style="font-size:11px;padding:2px 8px" onclick="_dbFmtClose()">&#10005;</button>'
    + '</div>'
    + '<div style="max-height:60vh;overflow-y:auto;">'
    + '<table class="bk-fmt-table"><thead><tr><th>Coluna</th><th>Tipo SQL</th><th>Formato</th><th>Par&acirc;metros</th></tr></thead>'
    + '<tbody>' + rowsHtml + '</tbody></table></div>'
    + '<div style="display:flex;gap:8px;padding:8px 0 0;justify-content:flex-end;">'
    + '<button class="db-dtb-btn" onclick="_dbFmtSaveDialog(' + tableId + ')">&#128190; Salvar</button>'
    + '<button class="db-dtb-btn db-dtb-danger" onclick="_dbFmtClear(' + tableId + ')">&#128465; Limpar todos</button>'
    + '<button class="db-dtb-btn" onclick="_dbFmtClose()">Cancelar</button>'
    + '</div>';

  document.body.appendChild(ov);
  document.body.appendChild(pop);
}

function _dbFmtClose() {
  var ov = document.getElementById('bk-popup-ov'); if (ov) ov.remove();
  var p  = document.getElementById('bk-popup-main'); if (p) p.remove();
}

function _dbFmtSelChange(sel, tableId) {
  var fname = sel.dataset.f;
  var type  = sel.value;
  if (!_dbFmtStore[tableId]) _dbFmtStore[tableId] = {};
  _dbFmtStore[tableId][fname] = { type: type };
  var td = document.getElementById('db-fmt-extra-' + fname);
  if (!td) return;
  var html = '';
  var cfg  = _dbFmtStore[tableId][fname];
  if (type === 'num') {
    html = '<span class="bk-fmt-extra">Dec: <input type="number" min="0" max="18" value="0" style="width:40px" data-f="' + fname + '" data-p="decimals">'
      + '<label><input type="checkbox" data-f="' + fname + '" data-p="thousands"> Milhar</label>'
      + '<label><input type="checkbox" data-f="' + fname + '" data-p="abs"> Abs</label></span>';
  } else if (type === 'mask') {
    html = '<span class="bk-fmt-extra">Máscara: <input type="text" value="" placeholder="ex: ###.###-##" style="width:120px" data-f="' + fname + '" data-p="mask"></span>';
  } else if (type === 'date') {
    var DPTS = (typeof _BK_DATE_FMTS !== 'undefined') ? _BK_DATE_FMTS : [['YYYYMMDD','AAAAMMDD'],['DDMMYYYY','DDMMAAAA'],['DD/MM/YYYY','DD/MM/AAAA'],['YYYY-MM-DD','AAAA-MM-DD']];
    var fromOpts = DPTS.map(function(d) { return '<option value="' + d[0] + '">' + d[1] + '</option>'; }).join('');
    var toOpts   = DPTS.map(function(d) { return '<option value="' + d[0] + '"' + (d[0] === 'DD/MM/YYYY' ? ' selected' : '') + '>' + d[1] + '</option>'; }).join('');
    html = '<span class="bk-fmt-extra">De:&nbsp;<select class="bk-fmt-sel" data-f="' + fname + '" data-p="dateFrom">' + fromOpts + '</select>&nbsp;Para:&nbsp;<select class="bk-fmt-sel" data-f="' + fname + '" data-p="dateTo">' + toOpts + '</select></span>';
  }
  td.innerHTML = html;
}

function _dbFmtSaveDialog(tableId) {
  if (!_dbFmtStore[tableId]) _dbFmtStore[tableId] = {};
  var fmts = _dbFmtStore[tableId];
  // Tipos (selects sem data-p)
  document.querySelectorAll('.bk-fmt-sel:not([data-p])').forEach(function(sel) {
    var f = sel.dataset.f; if (!f) return;
    if (!fmts[f]) fmts[f] = {};
    fmts[f].type = sel.value;
  });
  // Parâmetros (inputs com data-p)
  document.querySelectorAll('[data-p]').forEach(function(inp) {
    var f = inp.dataset.f, p = inp.dataset.p;
    if (!f || !p || !fmts[f]) return;
    if (inp.type === 'checkbox') fmts[f][p] = inp.checked;
    else if (inp.type === 'number') fmts[f][p] = parseInt(inp.value, 10) || 0;
    else fmts[f][p] = inp.value;
  });
  // Remove entradas 'none'
  Object.keys(fmts).forEach(function(k) { if (!fmts[k].type || fmts[k].type === 'none') delete fmts[k]; });
  _dbFmtClose();
  if (typeof _toastMsg === 'function') _toastMsg('\u2705 Formatos salvos.');
}

function _dbFmtClear(tableId) {
  _dbFmtStore[tableId] = {};
  _dbFmtClose();
}

function _dbDataDownload(filename, content, mimeType) {
  var blob = new Blob([content], { type: mimeType });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(function() { URL.revokeObjectURL(url); document.body.removeChild(a); }, 1000);
}

// ================================================================
// SESSÃO — exportar / restaurar dados do Banco de Dados
// ================================================================
function _dbGetSessionData() {
  return {
    tables:    _dbTables,
    activeId:  _dbActiveId,
    nextId:    _dbNextId,
    dataStore: _dbDataStore
  };
}

function _dbRestoreSession(data) {
  if (!data) return;
  _dbTables   = Array.isArray(data.tables) ? data.tables : [];
  _dbActiveId = data.activeId || null;
  _dbNextId   = data.nextId   || (_dbTables.reduce(function(m, t) { return Math.max(m, t.id || 0); }, 0) + 1);
  if (data.dataStore && typeof data.dataStore === 'object') Object.assign(_dbDataStore, data.dataStore);
  _dbRenderTableList();
  if (_dbActiveId) {
    _dbShowTab(_dbActiveTab);
  } else {
    _dbShowEmptyMain();
  }
}
