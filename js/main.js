
// ================= DROPDOWN TOOLBAR =================
// Renderiza o menu como popup ancorado no body (evita clip do overflow-x da toolbar)
function bkDtbToggleMenu(e, id) {
  e.stopPropagation();
  var existing = document.getElementById('bk-dtb-popup-' + id);
  if (existing) { bkDtbCloseAll(); return; }
  bkDtbCloseAll();

  var tpl = document.getElementById(id);
  if (!tpl) return;

  var rect = e.currentTarget.getBoundingClientRect();

  var ov = document.createElement('div');
  ov.id = 'bk-dtb-ov-' + id;
  ov.style.cssText = 'position:fixed;inset:0;z-index:9990;';
  ov.onclick = bkDtbCloseAll;

  var pop = document.createElement('div');
  pop.id = 'bk-dtb-popup-' + id;
  pop.className = 'bk-dtb-menu open';
  pop.style.cssText = 'position:fixed;top:' + (rect.bottom + 4) + 'px;left:' + rect.left + 'px;z-index:9991;';
  pop.innerHTML = tpl.innerHTML;

  // ao clicar num item fecha o menu
  pop.addEventListener('click', function(ev) {
    ev.stopPropagation();
    bkDtbCloseAll();
  });

  document.body.appendChild(ov);
  document.body.appendChild(pop);
}

function bkDtbCloseAll() {
  document.querySelectorAll('[id^="bk-dtb-popup-"],[id^="bk-dtb-ov-"]').forEach(function(el) { el.remove(); });
}
document.addEventListener('click', function(e) {
  if (!e.target.closest('.bk-dtb-dropdown')) bkDtbCloseAll();
});

// ================= TEMA DARK / LIGHT =================
(function() {
  const saved = localStorage.getItem('cobol-flow-tema');
  if (saved === 'dark') {
    document.body.classList.add('dark-mode');
    const icon  = document.getElementById('btn-tema-icon');
    const label = document.getElementById('btn-tema-label');
    if (icon)  icon.textContent  = '☀️';
    if (label) label.textContent = 'Light';
  } else {
    // Garante que light mode seja o padrão (limpa qualquer resquício de dark)
    document.body.classList.remove('dark-mode');
    localStorage.setItem('cobol-flow-tema', 'light');
  }
})();

function toggleTema() {
  const isDark = document.body.classList.toggle('dark-mode');
  const icon   = document.getElementById('btn-tema-icon');
  const label  = document.getElementById('btn-tema-label');
  if (isDark) {
    icon.textContent  = '☀️';
    label.textContent = 'Light';
    localStorage.setItem('cobol-flow-tema', 'dark');
  } else {
    icon.textContent  = '🌙';
    label.textContent = 'Dark';
    localStorage.setItem('cobol-flow-tema', 'light');
  }
}

// ================================================================
//  COBOL EDITOR — realce de sintaxe + numeração de linhas + goto
// ================================================================

const _CBL_KW = new Set([
  'PERFORM','THRU','THROUGH','IF','ELSE','END-IF','MOVE','TO',
  'ADD','SUBTRACT','MULTIPLY','DIVIDE','COMPUTE','GIVING','ROUNDED',
  'EVALUATE','WHEN','END-EVALUATE','CALL','USING','BY','CONTENT','REFERENCE',
  'GOBACK','STOP','RUN','CONTINUE','EXIT','SENTENCE',
  'READ','WRITE','REWRITE','DELETE','OPEN','CLOSE',
  'UNTIL','VARYING','FROM','AFTER','BEFORE','WITH','TEST',
  'NOT','AND','OR','EQUAL','GREATER','LESS','THAN',
  'ZERO','ZEROS','ZEROES','HIGH-VALUE','LOW-VALUE','QUOTE','QUOTES',
  'GO','NEXT','UPON','AT','END','ACCEPT','ACCEPTING',
  'STRING','UNSTRING','INSPECT','TALLYING','REPLACING','CONVERTING',
  'INITIALIZE','SORT','MERGE','RELEASE','RETURN','SEARCH','ALL',
  'ON','SIZE','ERROR','OVERFLOW','INVALID','KEY','END-READ',
  'END-WRITE','END-CALL','END-EVALUATE','END-PERFORM','END-STRING',
  'END-UNSTRING','END-SEARCH','END-COMPUTE','END-ADD','END-SUBTRACT',
  'END-MULTIPLY','END-DIVIDE','END-ACCEPT','FUNCTION','POINTER',
  'TRUE','FALSE','SPACES','SPACE'
]);
const _CBL_DECL = new Set([
  'PIC','PICTURE','VALUE','COMP','COMP-1','COMP-2','COMP-3','COMP-4','COMP-5',
  'BINARY','PACKED-DECIMAL','DISPLAY','USAGE','OCCURS','TIMES','DEPENDING',
  'REDEFINES','COPY','REPLACING','INDEXED','ASCENDING','DESCENDING',
  'SYNCHRONIZED','SYNC','JUSTIFIED','JUST','BLANK','EXTERNAL','GLOBAL',
  'FILLER','LEADING','TRAILING','SEPARATE','CHARACTER','SIGN'
]);

function _cblEsc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _cblTokenizeLine(line) {
  let html = ''; let i = 0; const len = line.length;
  while (i < len) {
    const ch = line[i];
    // String literal: ' ou "
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < len && line[j] !== ch) j++;
      if (j < len) j++;
      html += '<span class="cb-str">' + _cblEsc(line.slice(i,j)) + '</span>';
      i = j; continue;
    }
    // Palavra / identificador
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < len && /[A-Za-z0-9\-]/.test(line[j])) j++;
      while (j > i+1 && line[j-1] === '-') j--;
      const word = line.slice(i,j);
      const up = word.toUpperCase();
      if (_CBL_KW.has(up))   html += '<span class="cb-kw">'   + _cblEsc(word) + '</span>';
      else if (_CBL_DECL.has(up)) html += '<span class="cb-decl">' + _cblEsc(word) + '</span>';
      else html += _cblEsc(word);
      i = j; continue;
    }
    // Número isolado (não parte de identificador)
    if (/[0-9]/.test(ch) && (i === 0 || !/[A-Za-z\-]/.test(line[i-1]))) {
      let j = i;
      while (j < len && /[0-9.,]/.test(line[j])) j++;
      if (j === len || !/[A-Za-z\-]/.test(line[j])) {
        html += '<span class="cb-num">' + _cblEsc(line.slice(i,j)) + '</span>';
        i = j; continue;
      }
    }
    html += _cblEsc(ch); i++;
  }
  return html;
}

function _cblHighlightLine(raw) {
  const e = _cblEsc;
  if (!raw && raw !== 0) return '<span></span>';
  // Comentário: col 7 (índice 6) = '*' ou '/', ou linha começa com *
  const isComment =
    (raw.length >= 7 && (raw[6] === '*' || raw[6] === '/')) ||
    /^\s*\*/.test(raw);
  if (isComment) return '<span class="cb-cmt">' + e(raw) + '</span>';

  const UP = raw.toUpperCase();
  // DIVISION
  if (/\bDIVISION\./.test(UP)) return '<span class="cb-div">' + e(raw) + '</span>';
  // SECTION
  if (/\bSECTION\./.test(UP))  return '<span class="cb-sec">' + e(raw) + '</span>';
  // PROGRAM-ID / AUTHOR etc
  if (/^\s+(PROGRAM-ID|AUTHOR|DATE-WRITTEN|DATE-COMPILED|SECURITY|INSTALLATION|REMARKS)\b/.test(UP)) {
    return '<span class="cb-prog">' + e(raw) + '</span>';
  }
  // COPY statement
  if (/^\s+COPY\s/.test(UP)) {
    return raw.replace(/\bCOPY\b/gi, '<span class="cb-decl">COPY</span>');
    // above is unsafe, do full tokenize instead
  }
  // Nível de dados no início da linha
  const lvlMatch = raw.match(/^(\s+)(01|02|03|04|05|06|07|08|09|10|66|77|88)(\s)/);
  if (lvlMatch) {
    const indent = e(lvlMatch[1]);
    const lvl    = lvlMatch[2];
    const rest   = _cblTokenizeLine(raw.slice(lvlMatch[1].length + lvlMatch[2].length));
    return indent + '<span class="cb-level">' + lvl + '</span>' + rest;
  }
  // Parágrafo: col 8 (índice 7) não é espaço, termina com '.'
  if (raw.length >= 8 && raw[7] !== ' ' && /[A-Za-z0-9]/.test(raw[7])) {
    const trimmed = raw.trim();
    if (/^[\w][\w\-]*\.\s*$/.test(trimmed)) {
      return '<span class="cb-para">' + e(raw) + '</span>';
    }
  }
  return _cblTokenizeLine(raw);
}

function _cblLineClass(raw) {
  if (!raw) return '';
  const UP = raw.toUpperCase();
  if (/\bDIVISION\./.test(UP)) return ' cbl-line-div';
  if (/\bSECTION\./.test(UP))  return ' cbl-line-sec';
  return '';
}

function updateCobolEditor() {
  const ta = document.getElementById('input');
  const hi = document.getElementById('cobol-hi');
  const ln = document.getElementById('cobol-ln');
  if (!ta || !hi || !ln) return;

  const lines = ta.value.split('\n');
  // Numeração de linhas
  ln.innerHTML = lines.map((_,i) => '<div>' + (i+1) + '</div>').join('');
  // Realce
  hi.innerHTML = lines.map(line => {
    const cls = _cblLineClass(line);
    return '<div class="cbl-line' + cls + '">' + _cblHighlightLine(line) + '</div>';
  }).join('');
  // Sincronizar scroll vertical
  hi.scrollTop = ta.scrollTop;
  hi.scrollLeft = ta.scrollLeft;
  ln.scrollTop = ta.scrollTop;
}

function initCobolEditor() {
  const ta = document.getElementById('input');
  const hi = document.getElementById('cobol-hi');
  const ln = document.getElementById('cobol-ln');
  if (!ta || !hi || !ln) return;

  // Scroll sync
  ta.addEventListener('scroll', function() {
    hi.scrollTop  = ta.scrollTop;
    hi.scrollLeft = ta.scrollLeft;
    ln.scrollTop  = ta.scrollTop;
  });

  // Realce em tempo real (debounced)
  let hlTimer;
  ta.addEventListener('input', function() {
    clearTimeout(hlTimer);
    hlTimer = setTimeout(updateCobolEditor, 30);
  });

  // Tab → espaços
  ta.addEventListener('keydown', function(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = this.selectionStart, end = this.selectionEnd;
      const spaces = '    ';
      this.value = this.value.slice(0,s) + spaces + this.value.slice(end);
      this.selectionStart = this.selectionEnd = s + spaces.length;
      updateCobolEditor();
    }
  });

  updateCobolEditor();
}

// Aba: por enquanto só CICS/COBOL é funcional
function switchCblTab(tab, el) {
  document.querySelectorAll('.cobol-editor-tab').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

// Goto menu
function toggleCblGoto(e) {
  e.stopPropagation();
  const menu = document.getElementById('cobol-goto-menu');
  if (menu.classList.contains('open')) { menu.classList.remove('open'); return; }
  // Popula menu com divisões, seções e parágrafos
  const code = document.getElementById('input').value;
  const lines = code.split('\n');
  let items = [];
  lines.forEach((line, idx) => {
    const UP = line.toUpperCase();
    if (/\bDIVISION\./.test(UP))
      items.push({ label: line.trim(), type: 'div', line: idx });
    else if (/\bSECTION\./.test(UP))
      items.push({ label: line.trim(), type: 'sec', line: idx });
    else if (line.length >= 8 && line[7] !== ' ' && /[A-Za-z0-9]/.test(line[7])) {
      const t = line.trim();
      if (/^[\w][\w\-]*\.\s*$/.test(t))
        items.push({ label: t, type: 'par', line: idx });
    }
  });
  if (items.length === 0) items.push({ label: 'Nenhuma estrutura encontrada', type: 'par', line: 0 });
  menu.innerHTML = items.map(it =>
    '<div class="cobol-goto-item" onclick="jumpCblLine(' + it.line + ')">' +
    '<span class="cgi-badge ' + it.type + '">' + it.type.toUpperCase() + '</span>' +
    _cblEsc(it.label) +
    '<span class="cgi-line">L' + (it.line+1) + '</span>' +
    '</div>'
  ).join('');
  menu.classList.add('open');
  // Fechar ao clicar fora
  setTimeout(() => document.addEventListener('click', function _cl() {
    menu.classList.remove('open');
    document.removeEventListener('click', _cl);
  }), 10);
}

// ================= IR PARA PARÁGRAFO NO DIAGRAMA =================

function _fecharMenusNav() {
  var m1 = document.getElementById('diag-goto-menu');
  var m2 = document.getElementById('diag-exec-menu');
  var bd = document.getElementById('diag-nav-backdrop');
  if (m1) m1.classList.remove('open');
  if (m2) m2.classList.remove('open');
  if (bd) bd.classList.remove('open');
}

function toggleDiagGoto(e) {
  e.stopPropagation();
  // Se o clique veio de dentro do menu (item da lista), ignora — não reabre
  if (e.target && e.target.closest && e.target.closest('#diag-goto-menu')) return;
  var menu = document.getElementById('diag-goto-menu');
  var menuExec = document.getElementById('diag-exec-menu');
  var backdrop = document.getElementById('diag-nav-backdrop');
  if (menuExec) menuExec.classList.remove('open');
  if (menu.classList.contains('open')) {
    menu.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    return;
  }
  // Monta lista de nós a partir do cytoscape
  _buildDiagGotoList('');
  menu.classList.add('open');
  if (backdrop) backdrop.classList.add('open');
  // Foco no filtro apenas no desktop (mobile: evita teclado virtual)
  setTimeout(function() {
    var f = document.getElementById('diag-goto-filter');
    if (f) {
      f.value = '';
      if (window.innerWidth > 600) f.focus();
    }
  }, 30);
  // Fechar ao clicar fora (desktop)
  if (window.innerWidth > 600) {
    setTimeout(function() {
      document.addEventListener('click', function _cl() {
        menu.classList.remove('open');
        if (backdrop) backdrop.classList.remove('open');
        document.removeEventListener('click', _cl);
      });
    }, 10);
  }
}

function _buildDiagGotoList(filtro) {
  var list = document.getElementById('diag-goto-list');
  if (!list || !cy) return;
  var fil = (filtro || '').toUpperCase().trim();
  var items = [];

  // ── Índice O(n) uma única vez ────────────────────────────────
  // Prioridade do nó mais canônico para cada target:
  //   isEntry(999) > paragrafo/section(3) > section-para(2) > perform/perform-section(1) > outros(0)
  var _GOTO_PRI = {
    'paragrafo': 3, 'section': 3,
    'section-para': 2,
    'perform': 1, 'perform-section': 1,
    'perform-fall': 0
  };
  var _gotoIdx = {};  // target → { id, pri }
  cy.nodes().forEach(function(n) {
    var tgt = (n.data('target') || '').trim();
    if (!tgt || n.data('tipo') === 'merge') return;
    var pri = n.data('isEntry') ? 999 : (_GOTO_PRI[n.data('tipo')] || 0);
    var cur = _gotoIdx[tgt];
    if (!cur || pri > cur.pri) _gotoIdx[tgt] = { id: n.id(), pri: pri };
  });
  // ─────────────────────────────────────────────────────────────

  // Usa _currentMeta para ordem e badges corretos; fallback por varredura do cy
  if (_currentMeta && _currentMeta.ordemParagrafos && _currentMeta.ordemParagrafos.length) {
    var tipos = _currentMeta.tipos || {};
    _currentMeta.ordemParagrafos.forEach(function(nome) {
      if (fil && nome.toUpperCase().indexOf(fil) === -1) return;
      var t = tipos[nome];
      if (t === 'fim-paragrafo') return; // EXIT vazio, não mostrar
      var entry = _gotoIdx[nome];
      if (!entry) return; // parágrafo não renderizado no diagrama
      var badge = (t === 'section') ? 'sec' : 'para';
      items.push({ id: entry.id, label: nome, badge: badge });
    });
  } else {
    // Fallback: varredura cy, de-duping por target (usa índice já construído)
    Object.keys(_gotoIdx).forEach(function(tgt) {
      if (fil && tgt.toUpperCase().indexOf(fil) === -1) return;
      var tipo = cy.getElementById(_gotoIdx[tgt].id).data('tipo') || '';
      var badge = /section/i.test(tipo) ? 'sec' : 'para';
      items.push({ id: _gotoIdx[tgt].id, label: tgt, badge: badge });
    });
    items.sort(function(a, b) { return a.label.localeCompare(b.label); });
  }
  if (!items.length) {
    list.innerHTML = '<div class="diag-goto-item" style="color:#aaa;cursor:default">Nenhum resultado</div>';
    return;
  }
  list.innerHTML = items.map(function(it) {
    return '<div class="diag-goto-item" onclick="jumpDiagNode(\'' + it.id.replace(/'/g, "\\'") + '\')">' +
      '<span class="diag-goto-badge ' + it.badge + '">' + it.badge.toUpperCase() + '</span>' +
      it.label +
      '</div>';
  }).join('');
}

function _filtrarDiagGoto(val) {
  _buildDiagGotoList(val);
}

function jumpDiagNode(nodeId, closeMenu) {
  if (!cy) return;
  var node = cy.getElementById(nodeId);
  if (!node || !node.length) return;
  // Fecha o menu que disparou (parágrafo ou execução) + backdrop mobile
  var m = closeMenu || 'diag-goto-menu';
  var el = document.getElementById(m);
  if (el) el.classList.remove('open');
  var bd = document.getElementById('diag-nav-backdrop');
  if (bd) bd.classList.remove('open');
  // Centraliza e destaca o nó
  cy.animate({
    center: { eles: node },
    zoom: Math.max(cy.zoom(), 0.8)
  }, { duration: 350, easing: 'ease-in-out-cubic' });
  node.select();
  // Piscar borda usando classe Cytoscape
  node.flashClass('cy-flash', 1200);
  // Sincroniza o editor de código (mesmo comportamento do clique direto no nó)
  if (typeof destacarNoCobol === 'function') destacarNoCobol(node.data());
}

// ================= IR PARA EXECUÇÃO NO DIAGRAMA =================

// Mem\u00f3ria de estado expand/collapse do menu "Ir para Execu\u00e7\u00e3o".
// parName \u2192 true (expandido) | false (recolhido)
// Resetado quando um novo programa \u00e9 desenhado (ver desenhar()).
var _execExpandState = {};

// Mapa tipo -> badge (inclui par\u00e1grafo e se\u00e7\u00e3o como n\u00f3s do fluxo)
var _EXEC_BADGE_MAP = {
  'paragrafo':       { cls: 'per',  lbl: 'PAR', hdr: true  },
  'section':         { cls: 'sec',  lbl: 'SEC', hdr: true  },
  'instrucao':       { cls: 'cmd',  lbl: 'CMD'  },
  'grupo':           { cls: 'grp',  lbl: 'GRP'  },
  'if':              { cls: 'iff',  lbl: 'IF?'  },
  'loop':            { cls: 'loop', lbl: 'LOOP' },
  'evaluate':        { cls: 'eval', lbl: 'EVAL' },
  'io':              { cls: 'io',   lbl: 'I/O'  },
  'write':           { cls: 'wrt',  lbl: 'WRT'  },
  'call':            { cls: 'call', lbl: 'CALL' },
  'open':            { cls: 'opn',  lbl: 'OPN'  },
  'close':           { cls: 'cls',  lbl: 'CLS'  },
  'stop':            { cls: 'stp',  lbl: 'STOP' },
  'perform':         { cls: 'per',  lbl: 'PAR', hdr: true  },
  'perform-section': { cls: 'sec',  lbl: 'SEC', hdr: true  },
  'perform-fall':    { cls: 'fall', lbl: 'FALL' },
  'section-para':    { cls: 'sec',  lbl: 'SEC', hdr: true  },
  'sql':             { cls: 'sql',  lbl: 'SQL'  },
  'sort':            { cls: 'srt',  lbl: 'SORT' },
  'sort-input':      { cls: 'srt',  lbl: 'INP'  },
  'sort-engine':     { cls: 'srt',  lbl: 'ENG'  },
  'sort-output':     { cls: 'srt',  lbl: 'OUT'  },
  'macro-start':     { cls: 'opn',  lbl: '▶',   hdr: true  },
  'macro-end':       { cls: 'stp',  lbl: '■',   hdr: true  },
  'macro-process':   { cls: 'per',  lbl: 'PRC', hdr: true  },
  'copy':            { cls: 'cpy',  lbl: 'CPY'  },
  'search':          { cls: 'srch', lbl: 'SRCH' }
};

function toggleDiagExec(e) {
  e.stopPropagation();
  // Se o clique veio de dentro do menu (item da lista), ignora — não reabre
  if (e.target && e.target.closest && e.target.closest('#diag-exec-menu')) return;
  var menu = document.getElementById('diag-exec-menu');
  var menuGoto = document.getElementById('diag-goto-menu');
  var backdrop = document.getElementById('diag-nav-backdrop');
  if (menuGoto) menuGoto.classList.remove('open');
  if (menu.classList.contains('open')) {
    menu.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    return;
  }
  _buildDiagExecList('');
  menu.classList.add('open');
  if (backdrop) backdrop.classList.add('open');
  // Foco no filtro apenas no desktop (mobile: evita teclado virtual)
  setTimeout(function() {
    var f = document.getElementById('diag-exec-filter');
    if (f) {
      f.value = '';
      if (window.innerWidth > 600) f.focus();
    }
  }, 30);
  // Fechar ao clicar fora (desktop)
  if (window.innerWidth > 600) {
    setTimeout(function() {
      document.addEventListener('click', function _cl() {
        menu.classList.remove('open');
        if (backdrop) backdrop.classList.remove('open');
        document.removeEventListener('click', _cl);
      });
    }, 10);
  }
}

function _buildDiagExecList(filtro) {
  var list = document.getElementById('diag-exec-list');
  if (!list || !cy) return;
  var fil  = (filtro || '').toUpperCase().trim();
  var meta = _currentMeta;
  var html = '';

  // ── Índice de nós cy ──────────────────────────────────────────
  // Montado uma vez para lookups eficientes sem iterações repetidas
  var _cyParId   = {};  // target → id (entrada de parágrafo/seção)
  var _cyInstrId = {};  // "para|tipo|label60" → id
  cy.nodes().forEach(function(n) {
    var tipo = n.data('tipo') || '';
    var lbl  = (n.data('label')  || '').trim();
    var tgt  = (n.data('target') || '').trim();
    var para = (n.data('para')   || '').trim();
    if (tgt && (tipo === 'paragrafo' || tipo === 'section' || tipo === 'section-para'
        || tipo === 'perform' || tipo === 'perform-section' || tipo === 'perform-fall'
        || tipo === 'macro-start' || tipo === 'macro-process' || tipo === 'macro-end'
        || tipo === 'goto')) {
      if (!_cyParId[tgt]) _cyParId[tgt] = n.id();
    }
    if (lbl && tipo !== 'merge') {
      // Normaliza \n → espaço para garantir lookup por labels multi-linha (EVALUATE, LOOP, etc.)
      var lbl2 = lbl.replace(/\n/g, ' ');
      var k = para + '|' + tipo + '|' + lbl2.slice(0, 60);
      if (!_cyInstrId[k]) _cyInstrId[k] = n.id();
    }
  });

  // ── Dados do último parseCobol ─────────────────────────────────
  var estrutura       = (meta && meta.estrutura)       || {};
  var tipos           = (meta && meta.tipos)           || {};
  var ordemParagrafos = (meta && meta.ordemParagrafos) || [];
  var secoes          = (meta && meta.secoes)          || {};  // section → [sub-parágrafos]
  var fdMap           = (meta && meta.fdMap)           || {};
  var fdKeys          = Object.keys(fdMap);

  // ── Enriquecimento: sub-parágrafos sem nó próprio → seção pai ─
  // Quando a seção não foi expandida no diagrama (circuit-breaker / depth limit),
  // ela aparece como um único nó perform-section. Seus sub-parágrafos não têm nó
  // proprio em _cyParId e ficariam com exec-nc (não-clicável).
  // Aqui registramos esses sub-pars apontando para o nó da seção pai como fallback,
  // para que o clique no sub-par navegue até a seção mais próxima visível.
  cy.nodes().forEach(function(n) {
    var tipo = n.data('tipo') || '';
    var tgt  = (n.data('target') || '').trim();
    if ((tipo === 'section' || tipo === 'perform-section') && tgt && secoes[tgt]) {
      secoes[tgt].forEach(function(subPar) {
        if (!_cyParId[subPar]) _cyParId[subPar] = n.id();
      });
    }
  });
  // Fallback label-based: parágrafos sem target mas cujo label é o próprio nome
  cy.nodes().forEach(function(n) {
    var lbl  = (n.data('label') || '').trim();
    var tipo = n.data('tipo') || '';
    if (lbl && !_cyParId[lbl] &&
        (tipo === 'paragrafo' || tipo === 'section' || tipo === 'section-para'
         || tipo === 'perform' || tipo === 'perform-section' || tipo === 'perform-fall')) {
      _cyParId[lbl] = n.id();
    }
  });

  // ── BFS para modo filtro (lista plana) ───────────────────────
  if (fil) {
    var entryFlat = null;
    cy.nodes().forEach(function(n) { if (n.data('isEntry') && !entryFlat) entryFlat = n; });
    if (!entryFlat) {
      var allF = cy.nodes().toArray().slice();
      allF.sort(function(a, b) {
        var ca = a.data('col') != null ? a.data('col') : 0;
        var cb = b.data('col') != null ? b.data('col') : 0;
        return ca !== cb ? ca - cb : (a.position('y') || 0) - (b.position('y') || 0);
      });
      if (allF.length) entryFlat = allF[0];
    }
    var visitedF = {}, orderedF = [], qF = entryFlat ? [entryFlat] : [];
    while (qF.length) {
      var cf = qF.shift();
      if (visitedF[cf.id()]) continue;
      visitedF[cf.id()] = true;
      orderedF.push(cf);
      var sF = []; cf.outgoers('node').forEach(function(s) { sF.push(s); });
      sF.sort(function(a, b) { return (a.position('y')||0)-(b.position('y')||0); });
      sF.forEach(function(s) { if (!visitedF[s.id()]) qF.push(s); });
    }
    cy.nodes().forEach(function(n) { if (!visitedF[n.id()]) orderedF.push(n); });

    orderedF.forEach(function(n) {
      var tipo = n.data('tipo') || '';
      if (tipo === 'merge') return;
      var b = _EXEC_BADGE_MAP[tipo];
      if (!b) return;
      var label = (n.data('label') || '').trim();
      if (!label) return;
      var hay = label.toUpperCase()
        + '|' + (n.data('detail') || '').toUpperCase()
        + '|' + (n.data('para')   || '').toUpperCase()
        + '|' + (n.data('target') || '').toUpperCase();
      if (hay.indexOf(fil) === -1) return;
      var isHdr = !!b.hdr;
      var detail = (n.data('detail') || '').trim().slice(0, 60);
      var para   = n.data('para') || '';
      var det = (detail && detail !== label)
        ? '<span class="diag-exec-para">' + _escHtml(detail) + '</span>'
        : (!isHdr && para ? '<span class="diag-exec-para">' + _escHtml(para) + '</span>' : '');
      html += '<div class="diag-exec-item' + (isHdr ? ' exec-hdr' : '') + '" onclick="jumpDiagNode(\'' + n.id().replace(/'/g,"\\'") + '\',\'diag-exec-menu\')">'
        + '<span class="diag-exec-badge ' + b.cls + '">' + b.lbl + '</span>'
        + '<span class="diag-exec-lbl">' + _escHtml(label) + '</span>'
        + det + '</div>';
    });
    // FD no filtro
    fdKeys.forEach(function(rec) {
      var fd = fdMap[rec];
      if (fd.toUpperCase().indexOf(fil) === -1 && rec.toUpperCase().indexOf(fil) === -1) return;
      html += '<div class="exec-fd-item"><span class="exec-fd-badge">FD</span>'
        + '<span>' + _escHtml(fd) + '</span>'
        + '<span class="exec-fd-rec">\u2190 ' + _escHtml(rec) + '</span></div>';
    });
    list.innerHTML = html || '<div class="diag-exec-item" style="color:#aaa;cursor:default">Nenhum resultado</div>';
    return;
  }

  // ── Modo ÁRVORE hierárquica (sem filtro) ──────────────────────
  if (!meta || !meta.estrutura) {
    list.innerHTML = '<div class="diag-exec-item" style="color:#aaa;cursor:default">Analise um programa primeiro</div>';
    return;
  }

  var MAX_D = 12;

  // ── Otimizações para programas grandes ────────────────────────
  // Cache de AST por parágrafo: buildAST é puro para mesma entrada;
  // evita reparsear o mesmo parágrafo quando aparece em múltiplos caminhos PERFORM.
  var _astMemo = {};
  function _cachedAST(parName) {
    if (!_astMemo[parName]) {
      _astMemo[parName] = buildAST(estrutura[parName] || [], null, fdMap);
    }
    return _astMemo[parName];
  }

  // Índice O(1) para ordemParagrafos.indexOf — usado no perform-thru
  var _parOrdIdx = {};
  ordemParagrafos.forEach(function(p, i) { _parOrdIdx[p] = i; });

  // Cap de itens no DOM: impede congelamento em programas com centenas de parágrafos.
  // Quando atingido exibe aviso na lista mas mantém todos os headers clicáveis.
  var _ITEM_CAP  = 5000;
  var _itemCount = 0;
  var _capHit    = false;
  // ─────────────────────────────────────────────────────────────

  // Emite um item-instrução (CMD/SQL/IF/LOOP/etc.) com indentação depth
  function treeItem(depth, badgeCls, badgeLbl, label, nid, addStyle) {
    if (_capHit) return;
    if (++_itemCount > _ITEM_CAP) {
      _capHit = true;
      html += '<div class="diag-exec-item exec-nc" style="color:#94a3b8;font-style:italic;cursor:default;padding-left:10px;">'
        + '<span style="display:inline-block;width:24px;flex-shrink:0"></span>'
        + '<span class="diag-exec-lbl">… lista truncada em ' + _ITEM_CAP + ' itens (use o filtro para navegar)</span></div>';
      return;
    }
    var indent  = 10 + depth * 14;
    var onClick = nid ? 'jumpDiagNode(\'' + nid.replace(/'/g, "\\'") + '\',\'diag-exec-menu\')' : '';
    html += '<div class="diag-exec-item' + (onClick ? '' : ' exec-nc') + '" style="padding-left:' + indent + 'px;'
      + (onClick ? '' : 'cursor:default;') + (addStyle || '') + '"'
      + (onClick ? ' onclick="' + onClick + '"' : '') + '>';
    if (badgeCls) {
      html += '<span class="diag-exec-badge ' + badgeCls + '">' + badgeLbl + '</span>';
    } else {
      html += '<span style="display:inline-block;width:24px;flex-shrink:0"></span>';
    }
    html += '<span class="diag-exec-lbl">' + _escHtml(label) + '</span></div>';
  }

  // Emite cabeçalho de parágrafo/seção e recursivamente seus filhos
  var _shownPars = {};  // rastreia todos os parágrafos já emitidos (qualquer profundidade)

  function renderPar(parName, parentTipo, depth, visited) {
    if (depth > MAX_D) return;
    _shownPars[parName] = true;
    var parId  = _cyParId[parName] || null;
    var tipo   = parentTipo || tipos[parName] || 'paragrafo';
    var b      = (tipo === 'section') ? { cls: 'sec', lbl: 'SEC' } : { cls: 'per', lbl: 'PAR' };
    var nl     = (estrutura[parName] || []).length;
    var nlStr  = nl > 0 ? ' (' + nl + ' linha' + (nl !== 1 ? 's' : '') + ')' : '';
    var indent = 10 + depth * 14;

    // ── Captura HTML dos filhos num buffer separado ──
    var _savedHtml = html;
    html = '';

    if (visited[parName]) {
      treeItem(depth + 1, null, null, '\u21a9 j\u00e1 exibido', null, 'color:#94a3b8;font-style:italic;');
    } else {
      var _subPars = secoes[parName] || [];
      if (estrutura[parName] || _subPars.length) {
        var v2 = Object.assign({}, visited);
        v2[parName] = true;
        if (estrutura[parName] && estrutura[parName].length) {
          renderAstNodes(_cachedAST(parName), parName, depth + 1, v2);
        }
        _subPars.forEach(function(subPar) {
          if (!v2[subPar] && tipos[subPar] !== 'fim-paragrafo') {
            renderPar(subPar, tipos[subPar] || 'paragrafo', depth + 1, v2);
          }
        });
      }
    }

    var childHtml = html;
    html = _savedHtml;

    // ── Monta wrapper colapsável ──
    var hasChildren = childHtml.length > 0;
    // Decide estado inicial: usa memória persistente se existir; senão nivel-0 expandido, sub-pars recolhidos
    var _stateKey  = parName;
    var startColl  = hasChildren && (_execExpandState.hasOwnProperty(_stateKey)
      ? !_execExpandState[_stateKey]   // estado salvo: true=expandido ⇒ não colapsa
      : depth > 0);                    // padrão
    var toggleHtml = hasChildren
      ? '<span class="exec-grp-toggle" title="Expandir/recolher" onclick="event.stopPropagation();_toggleExecGrp(this.closest(\'.exec-par-grp\'))">' + (startColl ? '&#9654;' : '&#9660;') + '</span>'
      : '<span class="exec-grp-toggle-ph"></span>';
    var navClick = parId
      ? ' onclick="jumpDiagNode(\'' + parId.replace(/'/g, "\\'") + '\',\'diag-exec-menu\')"'
      : '';

    html += '<div class="exec-par-grp" data-par="' + _escHtml(parName) + '">';
    html += '<div class="diag-exec-item exec-hdr' + (parId ? '' : ' exec-nc') + '" style="padding-left:' + indent + 'px"' + navClick + '>'
      + toggleHtml
      + '<span class="diag-exec-badge ' + b.cls + '">' + b.lbl + '</span>'
      + '<span class="diag-exec-lbl">' + _escHtml(parName) + '</span>'
      + '<span class="diag-exec-para">' + _escHtml(nlStr) + '</span>'
      + '</div>';
    if (hasChildren) {
      html += '<div class="exec-grp-body' + (startColl ? ' collapsed' : '') + '">' + childHtml + '</div>';
    }
    html += '</div>';
  }

  function renderAstNodes(ast, parName, depth, visited) {
    if (!ast || !ast.length || depth > MAX_D) return;
    ast.forEach(function(n) { renderAstNode(n, parName, depth, visited); });
  }

  function renderAstNode(n, parName, depth, visited) {
    if (!n) return;
    var nt  = n.type || '';
    var lbl, brs, nid;

    if (nt === 'perform') {
      var tgt   = n.target;
      var ttype = tipos[tgt];
      if (ttype === 'fim-paragrafo') { treeItem(depth, 'per', 'PAR', tgt + ' [EXIT]', null); return; }
      renderPar(tgt, ttype || 'paragrafo', depth, visited);

    } else if (nt === 'perform-thru') {
      // Calcula o range de parágrafos entre n.from e n.to (inclusive)
      var _fiT = (_parOrdIdx[n.from] !== undefined) ? _parOrdIdx[n.from] : -1;
      var _tiT = (_parOrdIdx[n.to]   !== undefined) ? _parOrdIdx[n.to]   : -1;
      var _rngT = (_fiT >= 0 && _tiT >= 0 && _fiT <= _tiT)
        ? ordemParagrafos.slice(_fiT, _tiT + 1).filter(function(p) { return tipos[p] !== 'section'; })
        : [];
      // Cabeçalho com contagem (parágrafos reais + linhas)
      var _cntPars  = _rngT.filter(function(p) { return tipos[p] !== 'fim-paragrafo'; }).length;
      var _cntLines = _rngT.reduce(function(a, p) { return a + (estrutura[p] || []).length; }, 0);
      var _infoT = _rngT.length > 0
        ? ' (' + _cntPars + ' par\u00e1gr.' + (_cntLines > 0 ? ', ' + _cntLines + ' linhas' : '') + ')'
        : '';
      var _lblThru = 'PERFORM ' + n.from + ' THRU ' + n.to + (n.cond ? '  ' + n.cond : '') + _infoT;
      treeItem(depth, 'per', 'PAR', _lblThru, _cyParId[n.from] || null);
      // Expande cada parágrafo do range aninhado
      _rngT.forEach(function(p) {
        if (tipos[p] === 'fim-paragrafo') {
          _shownPars[p] = true;  // marca como mostrado mesmo sendo EXIT
          treeItem(depth + 1, 'per', 'PAR', p + '\u2002[EXIT]', _cyParId[p] || null, 'color:#94a3b8;');
        } else {
          renderPar(p, tipos[p] || 'paragrafo', depth + 1, visited);
        }
      });

    } else if (nt === 'loop') {
      lbl  = n.label.replace(/\n/g, ' ');
      nid  = _cyInstrId[parName + '|loop|' + lbl.slice(0, 60)] || null;
      treeItem(depth, 'loop', 'LOOP', lbl, nid);
      if (n.named && estrutura[n.named] && !visited[n.named] && depth < MAX_D) {
        renderPar(n.named, tipos[n.named] || 'paragrafo', depth + 1, visited);
      } else if (n.body && n.body.length) {
        renderAstNodes(n.body, parName, depth + 1, visited);
      }

    } else if (nt === 'if') {
      lbl = 'IF ' + n.label.replace(/^IF\s+/i, '').replace(/\n/g, ' ');
      nid = _cyInstrId[parName + '|if|' + n.label.replace(/\n/g, ' ').slice(0, 60)] || null;
      treeItem(depth, 'iff', 'IF?', lbl, nid);
      brs = [];
      if (n.sim && n.sim.length) brs.push({ tag: '[SIM]',  ns: n.sim });
      if (n.nao && n.nao.length) brs.push({ tag: '[N\u00c3O]', ns: n.nao });
      brs.forEach(function(br) {
        treeItem(depth + 1, null, null, br.tag, null, 'color:#64748b;font-style:italic;');
        renderAstNodes(br.ns, parName, depth + 2, visited);
      });

    } else if (nt === 'evaluate') {
      lbl = 'EVALUATE ' + (n.label || 'TRUE');
      nid = _cyInstrId[parName + '|evaluate|' + (n.label || 'EVALUATE').slice(0, 60)] || null;
      treeItem(depth, 'eval', 'EVAL', lbl, nid);
      (n.whens || []).forEach(function(w) {
        var whenLbl = '[' + (w.label || '') + ']';
        treeItem(depth + 1, null, null, whenLbl, null, 'color:#64748b;font-style:italic;');
        if (w.nodes && w.nodes.length) renderAstNodes(w.nodes, parName, depth + 2, visited);
      });

    } else if (nt === 'io') {
      // DISPLAY / ACCEPT / DELETE solitário (sem AT END/INVALID KEY)
      lbl = (n.label || '').replace(/\n/g, ' ');
      nid = _cyInstrId[parName + '|io|' + lbl.slice(0, 60)] || null;
      treeItem(depth, 'io', 'I/O', lbl, nid);

    } else if (nt === 'read') {
      lbl = (n.label || '').replace(/\n/g, ' ');
      nid = _cyInstrId[parName + '|io|' + lbl.slice(0, 60)] || null;
      treeItem(depth, 'io', 'I/O', lbl, nid);
      brs = [];
      if (n.atEnd      && n.atEnd.length)      brs.push({ tag: '[AT END]',          ns: n.atEnd });
      if (n.notAtEnd   && n.notAtEnd.length)   brs.push({ tag: '[N\u00c3O AT END]', ns: n.notAtEnd });
      if (n.invalidKey && n.invalidKey.length) brs.push({ tag: '[INVALID KEY]',     ns: n.invalidKey });
      brs.forEach(function(br) {
        treeItem(depth + 1, null, null, br.tag, null, 'color:#64748b;font-style:italic;');
        renderAstNodes(br.ns, parName, depth + 2, visited);
      });

    } else if (nt === 'call') {
      lbl = (n.label || '').replace(/\n/g, ' ');
      nid = _cyInstrId[parName + '|call|' + lbl.slice(0, 60)] || null;
      treeItem(depth, 'call', 'CALL', lbl, nid);
      brs = [];
      if (n.onException    && n.onException.length)    brs.push({ tag: '[ON EXCEPTION]',     ns: n.onException });
      if (n.notOnException && n.notOnException.length) brs.push({ tag: '[NOT ON EXCEPTION]', ns: n.notOnException });
      brs.forEach(function(br) {
        treeItem(depth + 1, null, null, br.tag, null, 'color:#64748b;font-style:italic;');
        renderAstNodes(br.ns, parName, depth + 2, visited);
      });

    } else if (nt === 'group') {
      // Grupo: um único nó cy do tipo 'grupo' com label=resumo e detail=linhas individuais
      lbl = (n.label || '').replace(/\n/g, ' ');
      nid = _cyInstrId[parName + '|grupo|' + lbl.slice(0, 60)] || null;
      // Cabeçalho do grupo — clicável (navega para o nó no diagrama)
      treeItem(depth, 'grp', 'GRP', lbl, nid);
      // Sub-itens das linhas individuais (apenas visual, sem onclick)
      (n.detail || '').split('\n').forEach(function(s) {
        if (s.trim()) treeItem(depth + 1, null, null, s.trim(), null, 'color:#64748b;');
      });

    } else if (nt === 'goto') {
      nid = _cyInstrId[parName + '|goto|GO TO: ' + n.target] || null;
      treeItem(depth, 'cmd', 'GO TO', 'GO TO ' + n.target, nid);

    } else if (nt === 'stop') {
      nid = _cyInstrId[parName + '|stop|' + (n.label || 'STOP RUN').slice(0, 60)] || null;
      treeItem(depth, 'stp', 'STOP', n.label || 'STOP RUN', nid);

    } else if (nt === 'sql') {
      lbl = (n.label || '').replace(/\n/g, ' ');
      nid = _cyInstrId[parName + '|sql|' + lbl.slice(0, 60)] || null;
      treeItem(depth, 'sql', 'SQL', lbl, nid);

    } else if (nt === 'open') {
      lbl = (n.label || '').replace(/\n/g, ' ');
      nid = _cyInstrId[parName + '|open|' + lbl.slice(0, 60)] || null;
      treeItem(depth, 'opn', 'OPN', lbl, nid);

    } else if (nt === 'close') {
      lbl = (n.label || '').replace(/\n/g, ' ');
      nid = _cyInstrId[parName + '|close|' + lbl.slice(0, 60)] || null;
      treeItem(depth, 'cls', 'CLS', lbl, nid);

    } else if (nt === 'write') {
      lbl = (n.label || '').replace(/\n/g, ' ');
      nid = _cyInstrId[parName + '|write|' + lbl.slice(0, 60)] || null;
      treeItem(depth, 'wrt', 'WRT', lbl, nid);

    } else {
      // instr e outros genéricos
      lbl = (n.label || '').replace(/\n/g, ' ');
      if (!lbl) return;
      nid = _cyInstrId[parName + '|instrucao|' + lbl.slice(0, 60)] || null;
      treeItem(depth, 'cmd', 'CMD', lbl, nid);
    }
  }

  // Acha parágrafo de entrada (mesmo critério de gerarFluxo)
  var entryNode = null;
  cy.nodes().forEach(function(n) { if (n.data('isEntry')) entryNode = n; });
  var entryPar = entryNode
    ? (entryNode.data('target') || entryNode.data('label'))
    : (ordemParagrafos[0] || '');

  if (entryPar) renderPar(entryPar, tipos[entryPar] || 'paragrafo', 0, {});

  // ── Parágrafos/seções não alcançados pelo entry point ─────────
  // Programas grandes têm seções não chamadas diretamente do entry;
  // renderiza-as em sequência após a árvore principal.
  ordemParagrafos.forEach(function(par) {
    if (_shownPars[par]) return;                 // já apareceu na árvore
    if (tipos[par] === 'fim-paragrafo') return;  // EXIT vazio, sem interesse
    // Seção cujos sub-parágrafos já foram todos exibidos na árvore principal:
    // pode ser a seção-container do entry point (ex: MAIN-SECTION que contém MAIN).
    // Evita duplicar conteúdo e exibir header não-clicável sem utilidade.
    if (tipos[par] === 'section') {
      var _subs = (secoes[par] || []).filter(function(s) { return tipos[s] !== 'fim-paragrafo'; });
      if (_subs.length > 0 && _subs.every(function(s) { return _shownPars[s]; })) return;
    }
    // Parágrafo sem nó no diagrama e sem conteúdo (ex: pseudo-entrada PROG3000 gerada
    // automaticamente após PROCEDURE DIVISION quando o código está vazio antes da 1ª seção).
    if (!_cyParId[par] && !(estrutura[par] || []).length && !(secoes[par] || []).length) return;
    renderPar(par, tipos[par] || 'paragrafo', 0, {});
  });

  // ── Seção Arquivos / FDs ──────────────────────────────────────
  if (fdKeys.length) {
    var fdByFile = {};
    fdKeys.forEach(function(rec) {
      var fd = fdMap[rec];
      if (!fdByFile[fd]) fdByFile[fd] = [];
      fdByFile[fd].push(rec);
    });
    var fdBody = '';
    Object.keys(fdByFile).forEach(function(fd) {
      fdByFile[fd].forEach(function(rec) {
        fdBody += '<div class="exec-fd-item"><span class="exec-fd-badge">FD</span>'
          + '<span>' + _escHtml(fd) + '</span>'
          + '<span class="exec-fd-rec">\u2190 ' + _escHtml(rec) + '</span></div>';
      });
    });
    html += '<div class="exec-fd-section">'
      + '<div class="exec-fd-hdr" id="exec-fd-hdr" onclick="_toggleExecFd()">'
      + '<span class="exec-grp-toggle">\u25bc</span>'
      + '<span>\uD83D\uDCC1 Arquivos / Registros</span></div>'
      + '<div class="exec-fd-body" id="exec-fd-body">' + fdBody + '</div></div>';
  }

  list.innerHTML = html || '<div class="diag-exec-item" style="color:#aaa;cursor:default">Nenhum resultado</div>';
}

function _filtrarDiagExec(val) {
  _buildDiagExecList(val);
}

// Colapsa/expande um grupo de parágrafo no menu de execução
// Expande ou recolhe todos os parágrafos do menu de execução de uma vez.
// expand=true → expande tudo; expand=false → recolhe tudo.
function _execExpandAll(expand) {
  var list = document.getElementById('diag-exec-list');
  if (!list) return;
  var grps = list.querySelectorAll('.exec-par-grp');
  grps.forEach(function(grp) {
    var body = null, tog = null;
    var kids = grp.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].classList.contains('exec-grp-body')) { body = kids[i]; }
      if (kids[i].classList.contains('diag-exec-item')) {
        var inner = kids[i].children;
        for (var j = 0; j < inner.length; j++) {
          if (inner[j].classList.contains('exec-grp-toggle')) { tog = inner[j]; break; }
        }
      }
    }
    if (!body) return;
    if (expand) body.classList.remove('collapsed');
    else        body.classList.add('collapsed');
    if (tog) tog.innerHTML = expand ? '&#9660;' : '&#9654;';
    // Persiste estado
    var parName = grp.getAttribute('data-par');
    if (parName) _execExpandState[parName] = expand;
  });
}

function _toggleExecGrp(grpEl) {
  // grpEl = .exec-par-grp wrapper
  if (!grpEl) return;
  var body = null, tog = null;
  var kids = grpEl.children;
  for (var i = 0; i < kids.length; i++) {
    if (kids[i].classList.contains('exec-grp-body')) { body = kids[i]; }
    if (kids[i].classList.contains('diag-exec-item')) {
      var inner = kids[i].children;
      for (var j = 0; j < inner.length; j++) {
        if (inner[j].classList.contains('exec-grp-toggle')) { tog = inner[j]; break; }
      }
    }
  }
  if (!body) return;
  var coll = body.classList.toggle('collapsed');
  if (tog) tog.innerHTML = coll ? '&#9654;' : '&#9660;';
  // Persiste o estado: true = expandido
  var parName = grpEl.getAttribute('data-par');
  if (parName) _execExpandState[parName] = !coll;
}

// Colapsa/expande a seção de arquivos/FDs
function _toggleExecFd() {
  var body = document.getElementById('exec-fd-body');
  var hdr  = document.getElementById('exec-fd-hdr');
  if (!body) return;
  var coll = body.classList.toggle('collapsed');
  var tog  = hdr && hdr.querySelector('.exec-grp-toggle');
  if (tog) tog.textContent = coll ? '▶' : '▼';
}

function _escHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function jumpCblLine(lineIdx) {
  const ta = document.getElementById('input');
  const lines = ta.value.split('\n');
  let pos = 0;
  for (let i = 0; i < lineIdx && i < lines.length; i++) pos += lines[i].length + 1;
  ta.focus();
  ta.setSelectionRange(pos, pos + (lines[lineIdx] || '').length);
  const hi = document.getElementById('cobol-hi');
  const ln = document.getElementById('cobol-ln');
  // Estimar scrollTop
  const lineH = parseFloat(getComputedStyle(ta).lineHeight) || 20.8;
  const scrollTo = Math.max(0, lineIdx * lineH - ta.clientHeight / 2);
  ta.scrollTop = scrollTo;
  if (hi) hi.scrollTop = scrollTo;
  if (ln) ln.scrollTop = scrollTo;
  document.getElementById('cobol-goto-menu').classList.remove('open');
}

// ===== TOAST DE NOTIFICAÇÃO =====
var _toastTimer = null;
function _toastMsg(msg, tipo, dur) {
  // tipo: 'ok' (padrão, verde) | 'erro' (vermelho)
  // dur: ms exibição (padrão 3500)
  var el = document.getElementById('ide-toast');
  if (!el) return;
  clearTimeout(_toastTimer);
  el.textContent = msg;
  el.className = 'ide-toast--show' + (tipo === 'erro' ? ' ide-toast--erro' : '');
  _toastTimer = setTimeout(function() {
    el.classList.remove('ide-toast--show');
  }, dur || 3500);
}

// ================= IMPORTAR TXT =================
function abrirImportarTxt(btnEl) {
  // Feedback visual: destaca o botão e avisa que o diálogo está abrindo
  const ribbon = btnEl && btnEl.classList.contains('ribbon-btn') ? btnEl : null;
  const lbl    = ribbon && ribbon.querySelector('.ribbon-btn-label');
  const ico    = ribbon && ribbon.querySelector('.ribbon-btn-icon');
  const origLbl = lbl ? lbl.textContent : null;
  const origIco = ico ? ico.innerHTML  : null;

  if (ribbon) {
    ribbon.classList.add('ribbon-btn--opening');
    if (ico)  ico.innerHTML  = '&#9203;';   // ⏳
    if (lbl)  lbl.textContent = 'Abrindo\u2026';  // "Abrindo…"
    ribbon.title = 'Aguarde — selecionando arquivo\u2026';
  }

  // Para o btn-importar simples (barra lateral), aplica efeito leve
  const btnSimples = document.querySelector('.btn-importar');
  if (btnSimples && !ribbon) {
    btnSimples.textContent = '&#9203; Aguarde\u2026';
    btnSimples.disabled = true;
    setTimeout(() => {
      btnSimples.innerHTML = '&#128194; Importar .txt';
      btnSimples.disabled = false;
    }, 3000);
  }

  document.getElementById('file-input').click();

  // Restaura o estado do botão ribbon após 3 s (caso o usuário cancele o diálogo)
  if (ribbon) {
    const restore = () => {
      ribbon.classList.remove('ribbon-btn--opening');
      if (ico)  ico.innerHTML  = origIco;
      if (lbl)  lbl.textContent = origLbl;
      ribbon.title = 'Importar arquivo .txt';
    };
    // Tenta detectar quando o janela recupera foco (diálogo fechado)
    const onFocus = () => { window.removeEventListener('focus', onFocus); restore(); };
    window.addEventListener('focus', onFocus);
    // Fallback: restaura forçado após 8 s se foco não voltar
    setTimeout(() => { window.removeEventListener('focus', onFocus); restore(); }, 8000);
  }
}

function importarTxt(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    let texto = e.target.result;
    // Se UTF-8 produziu caracteres de substituição, re-lê como Windows-1252
    if (texto.indexOf('\uFFFD') !== -1) {
      const reader2 = new FileReader();
      reader2.onload = function(e2) {
        document.getElementById('input').value = e2.target.result;
        updateCobolEditor();
        _toastMsg('\u2705 Programa carregado: ' + file.name);
      };
      reader2.readAsText(file, 'windows-1252');
    } else {
      document.getElementById('input').value = texto;
      updateCobolEditor();
      _toastMsg('\u2705 Programa carregado: ' + file.name);
    }
  };
  reader.readAsText(file, 'UTF-8');
  // Limpa o input para permitir reimportar o mesmo arquivo
  event.target.value = '';
}

// ================================================================
// SALVAR / ABRIR WORKSPACE COMPLETO
// ================================================================
function wsSave() {
  var ta    = document.getElementById('input');
  var state = {
    version:     3,
    savedAt:     new Date().toISOString(),
    cobolSource: ta ? ta.value : '',
    db:          (typeof _dbGetSessionData  === 'function') ? _dbGetSessionData()  : null,
    book:        (typeof _bkGetSessionData  === 'function') ? _bkGetSessionData()  : null,
    sim:         (typeof _simGetSessionData === 'function') ? _simGetSessionData() : null,
    report:      (typeof _repGetSessionData === 'function') ? _repGetSessionData() : null
  };
  var dt    = new Date();
  var stamp = dt.getFullYear()
            + ('0'+(dt.getMonth()+1)).slice(-2)
            + ('0'+dt.getDate()).slice(-2)
            + '-' + ('0'+dt.getHours()).slice(-2)
            + ('0'+dt.getMinutes()).slice(-2);
  var json  = JSON.stringify(state, null, 2);
  var a     = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8;' }));
  a.download = 'cobol-workspace-' + stamp + '.json';
  a.click();
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 2000);
  _toastMsg('💾 Workspace salvo!');
}

function wsLoadTrigger() {
  document.getElementById('ws-load-input').click();
}

function wsLoadFile(event) {
  var file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(ev) {
    try {
      var state = JSON.parse(ev.target.result);
      if (!state || !state.version) { alert('Arquivo de workspace inválido.'); return; }
      if (!window.confirm('Carregar workspace "' + file.name + '"?\nTodo o conteúdo atual será substituído.')) return;
      // Restaurar código COBOL
      if (state.cobolSource != null) {
        var ta = document.getElementById('input');
        if (ta) { ta.value = state.cobolSource; updateCobolEditor(); }
      }
      // Restaurar Banco de Dados
      if (state.db   && typeof _dbRestoreSession  === 'function') _dbRestoreSession(state.db);
      // Restaurar Book
      if (state.book && typeof _bkRestoreSession  === 'function') _bkRestoreSession(state.book);
      // Restaurar Simulador (v3+)
      if (state.sim  && typeof _simRestoreSession === 'function') _simRestoreSession(state.sim);
      // Compatibilidade v2: simVarsInitial direto
      else if (state.simVarsInitial && typeof _simVarsInitial !== 'undefined') {
        Object.keys(_simVarsInitial).forEach(function(k) { delete _simVarsInitial[k]; });
        Object.assign(_simVarsInitial, state.simVarsInitial);
      }
      // Restaurar Relatório de Investigação (v3+)
      if (state.report && typeof _repRestoreSession === 'function') _repRestoreSession(state.report);
      _toastMsg('📂 Workspace carregado: ' + file.name);
    } catch (ex) {
      alert('Erro ao carregar workspace: ' + ex.message);
    }
  };
  reader.readAsText(file, 'utf-8');
}

// ================= PARSE =================
function parseCobol(code) {
  const lines = code.split("\n");
  let estrutura = {};          // nome -> linhas[]
  let tipos = {};              // nome -> 'section' | 'paragrafo'
  let secoes = {};             // sectionNome -> [parágrafoNome, ...]
  let ordemParagrafos = [];    // todos em ordem de aparição
  let atual = null;
  let secaoAtual = null;
  let programId = null;
  let lineNumMap = {};         // nome -> índices globais de linha (0-based)
  let fdMap = {};              // nome-registro-01 → nome-arquivo (FD)
  let _lastFD = null;          // último FD encontrado (para capturar o 01 seguinte)
  let condMap88 = {};          // condition-name-88 → { parentName, values[] }
  let _lastNon88Lvl = null;    // último nome de campo não-88 (para vincular level 88)

  // Sections de outras divis�es (DATA, ENV) � ignoradas no fluxo
  const sectionsNaoProcedure = new Set([
    'CONFIGURATION', 'INPUT-OUTPUT', 'FILE', 'WORKING-STORAGE',
    'LOCAL-STORAGE', 'LINKAGE', 'REPORT', 'SCREEN',
    'COMMUNICATION', 'PROGRAM-LIBRARY'
  ]);

  // Palavras que terminam com '.' mas N�O s�o par�grafos
  const reservadasDiv = new Set([
    'IDENTIFICATION', 'ENVIRONMENT', 'DATA', 'PROCEDURE',
    'GOBACK', 'STOP', 'EXIT', 'CONTINUE', 'COPY', 'INCLUDE'
  ]);

  let inProcedure = false;

  lines.forEach((rawLine, lineIdx) => {
    // -- Formato fixo COBOL ------------------------------------------
    //  Cols 1-6  (�ndices 0-5) : n�mero de sequ�ncia  ? removidos para o parser
    //  Col  7    (�ndice  6)   : indicador  (* ou / = coment�rio, D = debug)
    //  Cols 8-11 (�ndices 7-10): Area A  � par�grafos e se��es
    //  Cols 12-72(�ndices 11-71): Area B � instru��es
    //  Cols 73-80(�ndices 72-79): identifica��o (ignorada)
    //
    //  Linhas de formato livre (sem numera��o) come�am com espa�os ou diretamente
    //  com c�digo. Detectamos formato fixo quando os 6 primeiros chars s�o d�gitos
    //  ou espa�os seguidos de um char na posi��o 6.

    if (!rawLine) return;

    // -- Normaliza��o: remove cols 1-6 (campo de numera��o de sequ�ncia COBOL) --
    // Formato padr�o : d�gitos/espa�os em cols 1-6.
    // Formato variante: alfanum�rico em cols 1-6 com indicador COBOL v�lido em col 7
    //   (espa�o = c�digo, * = coment�rio, / = form-feed).
    let normalized = rawLine;
    if (rawLine.length >= 7) {
      const _col7 = rawLine[6];
      if (/^[\d ]{6}/.test(rawLine) ||
          (/^[A-Za-z0-9 ]{6}/.test(rawLine) && (_col7 === ' ' || _col7 === '*' || _col7 === '/'))) {
        normalized = rawLine.slice(6);   // retira as 6 colunas de numera��o
      }
    }

    // -- Coment�rios ------------------------------------------------
    // Formato fixo: col 7 (agora �ndice 0 de `normalized`) = * ou /
    if (normalized.length > 0 && (normalized[0] === '*' || normalized[0] === '/')) {
      return;
    }
    // Formato livre: *> em qualquer posi��o depois do trim
    let lTrimmed = normalized.trim();
    if (!lTrimmed || lTrimmed.startsWith('*>') || lTrimmed.startsWith('*')) return;

    let l = lTrimmed.toUpperCase();

    // Captura PROGRAM-ID antes do PROCEDURE DIVISION
    if (!inProcedure) {
      const pidMatch = l.match(/^PROGRAM-ID\.?\s+([A-Z0-9][A-Z0-9-]*)/);
      if (pidMatch) { programId = pidMatch[1]; return; }
    }

    // Detecta PROCEDURE DIVISION (pode ter USING ...)
    if (/^PROCEDURE\s+DIVISION\b/.test(l)) {
      inProcedure = true;
      let entryName = programId || 'PROCEDURE';
      atual = entryName;
      estrutura[entryName] = [];
      tipos[entryName] = 'paragrafo';
      ordemParagrafos.push(entryName);
      return;
    }

    // Antes do PROCEDURE DIVISION ignora tudo (exceto FD, 01 do FILE SECTION e level 88)
    if (!inProcedure) {
      // Detecta FD/SD para construir fdMap (registro-01 → nome-arquivo)
      // SD = Sort Description; também mapeado para que RELEASE/RETURN resolvam corretamente
      const fdM = l.match(/^[SF]D\s+([A-Z][A-Z0-9-]*)/i);
      if (fdM) { _lastFD = fdM[1].toUpperCase(); _lastNon88Lvl = null; return; }
      if (_lastFD) {
        const recM = l.match(/^01\s+([A-Z][A-Z0-9-]*)/i);
        if (recM) { fdMap[recM[1].toUpperCase()] = _lastFD; _lastFD = null; }
        else if (/^\d/.test(l.trim())) { /* outra linha de nível — ignora */ }
        else { _lastFD = null; }
      }
      // Extrai level 88 condition-names de toda a DATA DIVISION
      const m88 = l.match(/^88\s+([A-Z@#$][A-Z0-9@#$-]*)\s+VALUES?\s+(.+?)\.?\s*$/i);
      if (m88 && _lastNon88Lvl) {
        const cname88 = m88[1].toUpperCase();
        const raw88v  = m88[2];
        const vals88  = [];
        const vRe88   = /'([^']*)'|"([^"]*)"|([^\s,]+)/g;
        let vm88;
        while ((vm88 = vRe88.exec(raw88v)) !== null) {
          const tok = vm88[1] !== undefined ? vm88[1] : (vm88[2] !== undefined ? vm88[2] : vm88[3]);
          if (tok && !/^(THRU|THROUGH|,|\.)$/i.test(tok)) vals88.push(tok.toUpperCase());
        }
        if (vals88.length) condMap88[cname88] = { parentName: _lastNon88Lvl, values: vals88 };
      } else {
        // Atualiza referência para campos não-88 (qualquer nível com nome)
        const lvlFieldM = l.match(/^\d{1,2}\s+([A-Z@#$][A-Z0-9@#$-]*)/i);
        if (lvlFieldM) {
          const lvNum = parseInt(l, 10);
          if (lvNum !== 88 && lvNum !== 66) _lastNon88Lvl = lvlFieldM[1].toUpperCase();
        }
      }
      return;
    }

    // Detecta SECTION dentro do PROCEDURE DIVISION
    // Aceita m�ltiplos espa�os/tabs entre o nome e a palavra SECTION,
    // e tamb�m espa�o antes do ponto final:
    //   "P1000-SECAO SECTION."
    //   "PROGRAMA        SECTION."
    //   "P1000-SECAO  SECTION"   (sem ponto final)
    //   "P1000-INICIAL    SECTION ."  (espa�o antes do ponto)
    const secMatch = l.match(/^([A-Z0-9][A-Z0-9-]*)\s+SECTION\s*\.?\s*$/);
    if (secMatch) {
      let secNome = secMatch[1];
      if (!sectionsNaoProcedure.has(secNome)) {
        secaoAtual = secNome;
        atual = secaoAtual;
        estrutura[secaoAtual] = [];
        tipos[secaoAtual] = 'section';
        secoes[secaoAtual] = [];
        ordemParagrafos.push(secaoAtual);
      }
      return;
    }

    // Aceita: "PARANAME." ou "PARANAME. EXIT." na mesma linha (ambos declaram fim de par�grafo)
    // N�o depende de isAreaA: o padr�o ^IDENTIFIER. � suficientemente espec�fico;
    // nenhuma instru��o COBOL normal tem apenas um identificador isolado na linha.
    const paraMatch = l.match(/^([A-Z0-9][A-Z0-9-]*)\.(?:\s+EXIT\.)?$/);
    if (paraMatch && !paraMatch[1].startsWith('END-')) {
      let nome = paraMatch[1];
      if (!reservadasDiv.has(nome)) {
        // Padrão A COBOL: parágrafo com mesmo nome da seção atual
        // Ex: "P1000-CALC SECTION." seguido de "P1000-CALC."
        // Neste caso o parágrafo É o corpo da seção — não registrar como parágrafo separado
        if (nome === secaoAtual) {
          atual = secaoAtual;
          return;
        }
        atual = nome;
        estrutura[nome] = [];
        tipos[nome] = 'paragrafo';
        if (secaoAtual) secoes[secaoAtual].push(nome);
        ordemParagrafos.push(nome);
        return;
      }
    }

    if (!atual) return;
    estrutura[atual].push(l);
    if (!lineNumMap[atual]) lineNumMap[atual] = [];
    lineNumMap[atual].push(lineIdx);
  });

  // P�s-processamento: paragr�fos cujo conte�do significativo � apenas EXIT
  // s�o marcadores de fim (conven��o COBOL para PERFORM THRU), n�o par�grafos reais
  Object.keys(estrutura).forEach(nome => {
    if (tipos[nome] !== 'paragrafo') return;
    const temConteudo = (estrutura[nome] || []).some(l => {
      const u = l.trim().toUpperCase().replace(/\.$/, '');
      return u && u !== 'EXIT' && u !== 'EXIT PARAGRAPH' && u !== 'EXIT SECTION';
    });
    if (!temConteudo) tipos[nome] = 'fim-paragrafo';
  });

  return { estrutura, tipos, secoes, ordemParagrafos, programId, lineNumMap, fdMap, condMap88 };
}

// ================= AST BUILDER =================
// Converte linhas de um par�grafo em uma �rvore de n�s de execu��o.
// EXIT sozinho � conven��o de limite � ignorado visualmente.
function buildAST(linhas, lineNums, fdMap) {
  fdMap = fdMap || {};
  let nodes = [];
  let i = 0;
  while (i < linhas.length) {
    let l = linhas[i].trim().replace(/\.$/, '');
    let lUp = l.toUpperCase();
    let _srcLine = lineNums ? lineNums[i] : null;
    i++;
    if (!l) continue;
    // Guarda: pula coment�rios que possam ter chegado at� aqui
    if (l.startsWith('*') || l.startsWith('*>')) continue;
    // EXIT PROGRAM � encerra o programa
    if (/^EXIT\s+PROGRAM\b/.test(lUp)) {
      nodes.push({ type: 'stop', label: 'EXIT PROGRAM', srcLine: _srcLine });
      break;
    }
    // EXIT sozinho / EXIT PARAGRAPH / EXIT SECTION � encerra o par�grafo
    if (/^EXIT(\s+(PARAGRAPH|SECTION|PERFORM))?$/.test(lUp)) break;
    if (/^STOP\s+RUN/.test(lUp) || /^GOBACK$/.test(lUp)) {
      nodes.push({ type: 'stop', label: lUp.startsWith('STOP') ? 'STOP RUN' : 'GOBACK', srcLine: _srcLine });
      break;
    }
    if (/^IF[\s(]/.test(lUp) || lUp === 'IF') {
      // Verifica se a linha original do IF já terminou com '.' (IF inline completo)
      let _ifHadPeriod = (linhas[i - 1] || '').trim().endsWith('.');

      // Coleta a condição completa.
      // AND/OR pode estar no INÍCIO da próxima linha OU no FINAL da linha/condLabel atual.
      let condLabel = l;
      while (i < linhas.length) {
        let peek    = linhas[i].trim().replace(/\.$/, '').toUpperCase();
        let peekRaw = linhas[i].trim();
        // Continua se: próxima linha começa com AND/OR  -OU-  condLabel atual termina com AND/OR
        let endsOp = /\b(AND|OR)\s*$/.test(condLabel.toUpperCase());
        if (/^(AND|OR)\b/.test(peek) || endsOp) {
          condLabel += ' ' + peek;
          if (peekRaw.endsWith('.')) _ifHadPeriod = true;
          i++;
        } else {
          break;
        }
      }

      // Detecta AÇÃO INLINE: IF <condição> <VERBO> <args>  (tudo na mesma linha)
      // Verbos COBOL que nunca aparecem dentro de uma expressão condicional:
      const _inlineVerbRe = /\s(DISPLAY|ACCEPT|MOVE|COMPUTE|PERFORM|CALL|EXEC|OPEN|CLOSE|READ|WRITE|REWRITE|DELETE|INITIALIZE|SET|EVALUATE|GOBACK|CONTINUE|STRING|UNSTRING|INSPECT|SEARCH|SORT|MULTIPLY|DIVIDE|SUBTRACT|ADD|GO\s+TO|STOP\s+RUN|NEXT\s+SENTENCE)(?=\s|$)/i;

      let sim = [], nao = [], simNums = [], naoNums = [], depth = 0, branch = 'SIM';
      let _inlineFound = false;
      let _mInline = condLabel.toUpperCase().match(_inlineVerbRe);
      if (_mInline) {
        _inlineFound = true;
        let _splitAt  = _mInline.index;  // posição do espaço antes do verbo
        let _pureCond = condLabel.substring(0, _splitAt).trim();
        _pureCond = _pureCond.replace(/\s+(AND|OR)\s*$/i, '').trim();  // remove AND/OR solto no final
        let _inlineAct = condLabel.substring(_splitAt).trim();
        // END-IF inline fecha o IF (assim como o ponto), mas só este IF — não aninha
        let _inlineHadEndIf = /\bEND-IF\b/i.test(_inlineAct);
        _inlineAct = _inlineAct.replace(/\s*\bEND-IF\b\s*$/i, '').trim();  // strip END-IF residual
        condLabel = _pureCond;
        if (_inlineAct) { sim.push(_inlineAct); simNums.push(_srcLine); }
        if (_inlineHadEndIf) _ifHadPeriod = true; // END-IF fecha este IF, não lê mais linhas
      }

      // Se o IF foi fechado pelo '.' na mesma linha (com ou sem ação inline),
      // não avança para coletar linhas seguintes (pertencem ao próximo comando)
      if (!_ifHadPeriod) {
        while (i < linhas.length) {
          let _curLN = lineNums ? lineNums[i] : null;
          let cur = linhas[i];
          let rawBl = cur.trim();
          // Ponto final fecha TODOS os escopos abertos (independente do depth)
          let periodClose = rawBl.endsWith('.');
          let bl = rawBl.replace(/\.$/, '').toUpperCase();
          // END-IF pode estar no FINAL de outra instrução (ex: MOVE X TO Y END-IF)
          let _trailingEndIf = !/^END-IF\b/.test(bl) && /\bEND-IF\s*$/.test(bl);
          if (_trailingEndIf) bl = bl.replace(/\s*\bEND-IF\s*$/, '').trim();
          i++;
          if (/^IF[\s(]/.test(bl) || bl === 'IF') depth++;
          if (/^END-IF\b/.test(bl) || _trailingEndIf) {
            // Se havia instrução antes do END-IF, empurra ao ramo corrente
            if (_trailingEndIf && bl) {
              let _instrPart = cur.trim().replace(/\s*END-IF\s*\.?\s*$/i, '').trim();
              (branch === 'SIM' ? sim : nao).push(_instrPart);
              (branch === 'SIM' ? simNums : naoNums).push(_curLN);
            } else if (!_trailingEndIf && depth > 0) {
              (branch === 'SIM' ? sim : nao).push(cur);
              (branch === 'SIM' ? simNums : naoNums).push(_curLN);
            }
            if (depth === 0) break;
            depth--;
            continue;
          }
          if (/^ELSE\b/.test(bl) && depth === 0) { branch = 'NAO'; continue; }
          if (bl) { (branch === 'SIM' ? sim : nao).push(cur); (branch === 'SIM' ? simNums : naoNums).push(_curLN); }
          if (periodClose) break; // ponto fecha o IF
        }
      }
      nodes.push({ type: 'if', label: condLabel, sim: buildAST(sim, simNums, fdMap), nao: buildAST(nao, naoNums, fdMap), srcLine: _srcLine });
      continue;
    }
    // --- PERFORM ----------------------------------------------------------------
    // Verbos que nunca s�o continua��o de condi��o UNTIL
    const _cobolVerbs = /^(END-PERFORM|END-STRING|END-UNSTRING|END-EXEC|PERFORM|IF|ELSE|EVALUATE|WHEN|MOVE|COMPUTE|ADD|SUBTRACT|MULTIPLY|DIVIDE|CALL|DISPLAY|ACCEPT|OPEN|CLOSE|READ|WRITE|REWRITE|DELETE|STRING|UNSTRING|INSPECT|SEARCH|SORT|RETURN|RELEASE|MERGE|STOP|GOBACK|GO[\s\b]|GOTO\b|EXEC\b|EXIT)\b/;
    // 1. Inline loop (sem nome de par�grafo antes da cl�usula):
    //    PERFORM [WITH TEST BEFORE|AFTER] UNTIL cond ... END-PERFORM
    //    PERFORM [WITH TEST BEFORE|AFTER] VARYING v FROM x BY y UNTIL ... END-PERFORM
    //    PERFORM n TIMES ... END-PERFORM
    const _inlineLoopRe = /^PERFORM\s+(?:WITH\s+TEST\s+(?:BEFORE|AFTER)\s+)?(?:UNTIL|VARYING)\b|^PERFORM\s+\d+\s+TIMES\b/;
    if (_inlineLoopRe.test(lUp)) {
      // Coleta condi��o possivelmente multi-linha (antes do corpo)
      let condLines = [lUp.replace(/^PERFORM\s+/, '')];
      while (i < linhas.length) {
        let pk = linhas[i].trim().replace(/\.$/, '').toUpperCase();
        if (!pk || _cobolVerbs.test(pk)) break;
        condLines.push(pk); i++;
      }
      let cond = condLines.join(' ');
      let body = [], bodyNums = [], nestDepth = 0;
      while (i < linhas.length) {
        let _curLN2 = lineNums ? lineNums[i] : null;
        let cur = linhas[i];
        let rawPl = cur.trim();
        let periodClosePl = rawPl.endsWith('.') && nestDepth === 0;
        let bl = rawPl.replace(/\.$/, '').toUpperCase();
        i++;
        if (_inlineLoopRe.test(bl)) nestDepth++;
        if (/^END-PERFORM/.test(bl)) {
          if (nestDepth === 0) break;
          nestDepth--; body.push(cur); bodyNums.push(_curLN2); continue;
        }
        if (bl) { body.push(cur); bodyNums.push(_curLN2); }
        if (periodClosePl) break; // ponto fecha o PERFORM inline
      }
      nodes.push({ type: 'loop', label: cond, body: buildAST(body, bodyNums, fdMap) });
      continue;
    }
    // EVALUATE � switch/case: consome at� END-EVALUATE
    if (/^EVALUATE\b/.test(lUp)) {
      let _evSubj = l;
      let _evWhens = [];
      let _evCurWhen = null;
      let _evDone  = false;
      let _evDepth = 0;
      while (i < linhas.length && !_evDone) {
        let _evTr  = linhas[i].trim();
        let _evPer = _evTr.endsWith('.');
        let _evUp  = _evTr.replace(/\.$/, '').toUpperCase();
        let _evLN  = lineNums ? lineNums[i] : null;
        i++;
        if (!_evUp) { if (_evPer) _evDone = true; continue; }
        if (/^EVALUATE\b/.test(_evUp)) { _evDepth++; }
        if (/^END-EVALUATE\b/.test(_evUp)) {
          if (_evDepth === 0) { _evDone = true; break; }
          _evDepth--;
          if (_evCurWhen) { _evCurWhen.bodyL.push(_evTr.replace(/\.$/, '')); _evCurWhen.bodyN.push(_evLN); }
          if (_evPer) _evDone = true;
          continue;
        }
        if (_evDepth === 0 && /^WHEN\b/.test(_evUp)) {
          if (_evCurWhen) _evWhens.push(_evCurWhen);
          _evCurWhen = { label: _evTr.replace(/\.$/, ''), bodyL: [], bodyN: [] };
        } else if (_evCurWhen) {
          _evCurWhen.bodyL.push(_evTr.replace(/\.$/, ''));
          _evCurWhen.bodyN.push(_evLN);
        }
        if (_evPer) { _evDone = true; }
      }
      if (_evCurWhen) _evWhens.push(_evCurWhen);
      let _evDetParts = [_evSubj];
      _evWhens.forEach(function(w) {
        _evDetParts.push(w.label);
        w.bodyL.forEach(function(x) { _evDetParts.push('    ' + x); });
      });
      _evDetParts.push('END-EVALUATE');
      nodes.push({
        type: 'evaluate',
        label: _evSubj,
        detail: _evDetParts.join('\n'),
        srcLine: _srcLine,
        whens: _evWhens.map(function(w) {
          return { label: w.label, nodes: buildAST(w.bodyL, w.bodyN, fdMap) };
        })
      });
      continue;
    }
    // STRING ... END-STRING � coleta todas as linhas e gera n� �nico
    if (/^STRING\b/.test(lUp)) {
      let allLines = [l];
      while (i < linhas.length) {
        let rawCur = linhas[i].trim();
        let periodCloseS = rawCur.endsWith('.');
        let cur = rawCur.replace(/\.$/, '');
        i++;
        if (/^END-STRING\b/i.test(cur)) break;
        if (cur) allLines.push(cur);
        if (periodCloseS) break; // ponto fecha o STRING
      }
      let allText = allLines.join(' ').toUpperCase();
      // Extrai primeira fonte (literal entre aspas simples ou vari�vel)
      let firstSrcM = allLines[0].match(/STRING\s+('(?:[^']|'')*'|[A-Z0-9][A-Z0-9-]*)/i);
      let firstSrc = firstSrcM ? firstSrcM[1] : '...';
      // Trunca literal longo
      if (firstSrc.length > 20) firstSrc = firstSrc.substring(0, 19) + '\u2026';
      let intoM = allText.match(/\bINTO\s+([A-Z0-9][A-Z0-9-]*)/);
      let shortLabel = 'STRING ' + firstSrc + (intoM ? ' INTO ' + intoM[1] : '');
      let fullDetail = allLines.join('\n') + '\nEND-STRING';
      nodes.push({ type: 'instr', label: shortLabel, detail: fullDetail, srcLine: _srcLine });
      continue;
    }
    // UNSTRING ... END-UNSTRING � coleta todas as linhas e gera n� �nico
    if (/^UNSTRING\b/.test(lUp)) {
      let allLinesU = [l];
      let srcM = lUp.match(/^UNSTRING\s+([A-Z0-9][A-Z0-9-]*)/);
      let src = srcM ? srcM[1] : '...';
      let intoVars = [];
      while (i < linhas.length) {
        let rawCurU = linhas[i].trim();
        let periodCloseU = rawCurU.endsWith('.');
        let cur = rawCurU.replace(/\.$/, '');
        let curUp = cur.toUpperCase();
        i++;
        if (/^END-UNSTRING\b/.test(curUp)) break;
        let intoM2 = curUp.match(/\bINTO\s+([A-Z0-9][A-Z0-9-]*)/);
        if (intoM2) intoVars.push(intoM2[1]);
        if (cur) allLinesU.push(cur);
        if (periodCloseU) break; // ponto fecha o UNSTRING
      }
      let shortLabelU = 'UNSTRING ' + src + (intoVars.length ? ' INTO ' + intoVars.join(', ') : '');
      let fullDetailU = allLinesU.join('\n') + '\nEND-UNSTRING';
      nodes.push({ type: 'instr', label: shortLabelU, detail: fullDetailU, srcLine: _srcLine });
      continue;
    }
    // EXEC SQL ... END-EXEC � comando DB2; coleta todas as linhas at� END-EXEC (ou ponto)
    if (/^EXEC\s+SQL\b/i.test(lUp)) {
      let sqlLines = [l];
      while (i < linhas.length) {
        let rawS = linhas[i].trim();
        let periodCloseSQL = rawS.endsWith('.');
        let cleanS = rawS.replace(/\.$/, '');
        i++;
        if (/^END-EXEC\b/i.test(cleanS)) break;
        if (cleanS) sqlLines.push(cleanS);
        if (periodCloseSQL) break;
      }
      // Extrai o tipo de operação SQL e normaliza para grupo visual
      let allSQL = sqlLines.join(' ').toUpperCase();
      let opM = allSQL.match(/EXEC\s+SQL\s+(\w+)/);
      let sqlOp = opM ? opM[1] : 'SQL';
      let sqlOpGroup, shortLabel;
      // ── Operações de cursor ──────────────────────────────────────────
      if (sqlOp === 'DECLARE' && /\bCURSOR\b/.test(allSQL)) {
        // DECLARE cursor-name CURSOR FOR SELECT ...
        let dcM = allSQL.match(/DECLARE\s+([A-Z][A-Z0-9_#@$-]*)\s+CURSOR/);
        let cursorName = dcM ? dcM[1] : '';
        // Tabela do SELECT interno: FROM ou JOIN
        let tblM = allSQL.match(/(?:FROM|JOIN)\s+([A-Z0-9][A-Z0-9_#@$.:-]*)/);
        let tbl = tblM ? tblM[1] : '';
        sqlOpGroup = 'CURSOR-DECLARE';
        shortLabel = 'DECLARE CURSOR\n' + (cursorName || tbl || '');
      } else if (sqlOp === 'OPEN') {
        // EXEC SQL OPEN cursor-name
        let ocM = allSQL.match(/EXEC\s+SQL\s+OPEN\s+([A-Z][A-Z0-9_#@$-]*)/);
        let cursorName = ocM ? ocM[1] : '';
        sqlOpGroup = 'CURSOR-OPEN';
        shortLabel = 'OPEN CURSOR\n' + cursorName;
      } else if (sqlOp === 'FETCH') {
        // EXEC SQL FETCH [NEXT FROM] cursor-name INTO ...
        let ftM = allSQL.match(/FETCH\s+(?:NEXT\s+FROM\s+)?([A-Z][A-Z0-9_#@$-]*)/);
        let cursorName = ftM ? ftM[1] : '';
        sqlOpGroup = 'CURSOR-FETCH';
        shortLabel = 'FETCH\n' + cursorName;
      } else if (sqlOp === 'CLOSE') {
        // EXEC SQL CLOSE cursor-name  (diferente de COBOL CLOSE arquivo)
        let clM = allSQL.match(/EXEC\s+SQL\s+CLOSE\s+([A-Z][A-Z0-9_#@$-]*)/);
        let cursorName = clM ? clM[1] : '';
        sqlOpGroup = 'CURSOR-CLOSE';
        shortLabel = 'CLOSE CURSOR\n' + cursorName;
      // ── DML ──────────────────────────────────────────────────────────
      } else if (sqlOp === 'SELECT') {
        sqlOpGroup = 'SELECT';
        let tblM = allSQL.match(/(?:FROM|JOIN)\s+([A-Z0-9][A-Z0-9_#@$.:-]*)/);
        let tbl = tblM ? tblM[1] : '';
        shortLabel = 'SELECT' + (tbl ? '\n' + tbl : '');
      } else if (sqlOp === 'INSERT') {
        sqlOpGroup = 'INSERT';
        let tblM = allSQL.match(/INSERT\s+INTO\s+([A-Z0-9][A-Z0-9_#@$.:-]*)/);
        let tbl = tblM ? tblM[1] : '';
        shortLabel = 'INSERT' + (tbl ? '\n' + tbl : '');
      } else if (sqlOp === 'UPDATE') {
        sqlOpGroup = 'UPDATE';
        let tblM = allSQL.match(/UPDATE\s+([A-Z0-9][A-Z0-9_#@$.:-]*)/);
        let tbl = tblM ? tblM[1] : '';
        shortLabel = 'UPDATE' + (tbl ? '\n' + tbl : '');
      } else if (sqlOp === 'DELETE') {
        sqlOpGroup = 'DELETE';
        let tblM = allSQL.match(/DELETE\s+(?:FROM\s+)?([A-Z][A-Z0-9_#@$.:-]*)/)
                || allSQL.match(/FROM\s+([A-Z0-9][A-Z0-9_#@$.:-]*)/);
        let tbl = tblM ? tblM[1] : '';
        shortLabel = 'DELETE' + (tbl ? '\n' + tbl : '');
      } else {
        sqlOpGroup = 'OTHER';
        shortLabel = sqlOp;
      }
      let fullDetail = sqlLines.join('\n') + '\nEND-EXEC';
      nodes.push({ type: 'sql', label: shortLabel, sqlOp: sqlOpGroup, detail: fullDetail, srcLine: _srcLine });
      continue;
    }
    const thruM = lUp.match(/^PERFORM\s+([A-Z0-9][A-Z0-9-]*)\s+THRU\s+([A-Z0-9][A-Z0-9-]*)(?:\s+(.*))?$/);
    if (thruM) {
      let rest = thruM[3] ? thruM[3].trim() : '';
      if (!rest && i < linhas.length) {
        let pk = linhas[i].trim().replace(/\.$/, '').toUpperCase();
        if (/^(UNTIL|VARYING|WITH\s+TEST)\b/.test(pk) || /^\d+\s+TIMES\b/.test(pk)) { rest = pk; i++; }
      }
      while (rest && i < linhas.length) {
        let pk2 = linhas[i].trim().replace(/\.$/, '').toUpperCase();
        if (/^(AND|OR)\b/.test(pk2)) { rest += ' ' + pk2; i++; } else break;
      }
      nodes.push({ type: 'perform-thru', from: thruM[1], to: thruM[2], cond: rest || null });
      continue;
    }
    // 3. PERFORM para UNTIL cond | VARYING ... | WITH TEST BEFORE|AFTER UNTIL cond
    const perfLoopM = lUp.match(/^PERFORM\s+([A-Z0-9][A-Z0-9-]*)\s+(UNTIL\b|VARYING\b|WITH\s+TEST\b)(.*)/);
    // 4. PERFORM para n TIMES  |  PERFORM para WS-VAR TIMES
    const perfTimesM = !perfLoopM && lUp.match(/^PERFORM\s+([A-Z0-9][A-Z0-9-]*)\s+(\d+|[A-Z0-9][A-Z0-9-]*)\s+TIMES\b/);
    if (perfLoopM || perfTimesM) {
      let m = perfLoopM || perfTimesM;
      let condPart = perfLoopM
        ? (perfLoopM[2] + (perfLoopM[3] || '')).trim()
        : (perfTimesM[2] + ' TIMES').trim();
      while (i < linhas.length) {
        let pk = linhas[i].trim().replace(/\.$/, '').toUpperCase();
        if (/^(AND|OR)\b/.test(pk)) { condPart += ' ' + pk; i++; } else break;
      }
      nodes.push({ type: 'loop', label: 'PERFORM ' + m[1] + '\n' + condPart, body: null, named: m[1] });
      continue;
    }
    // 5. PERFORM para (linha �nica) � verifica linha seguinte por UNTIL/VARYING/TIMES
    const perfM = lUp.match(/^PERFORM\s+([A-Z0-9][A-Z0-9-]*)\s*$/);
    if (perfM) {
      let rest = null;
      if (i < linhas.length) {
        let pk = linhas[i].trim().replace(/\.$/, '').toUpperCase();
        if (/^(UNTIL|VARYING|WITH\s+TEST)\b/.test(pk) || /^\d+\s+TIMES\b/.test(pk)) {
          rest = pk; i++;
          while (i < linhas.length) {
            let pk2 = linhas[i].trim().replace(/\.$/, '').toUpperCase();
            if (/^(AND|OR)\b/.test(pk2)) { rest += ' ' + pk2; i++; } else break;
          }
        }
      }
      if (rest) {
        nodes.push({ type: 'loop', label: 'PERFORM ' + perfM[1] + '\n' + rest, body: null, named: perfM[1] });
      } else {
        nodes.push({ type: 'perform', target: perfM[1] });
      }
      continue;
    }
    // Fallback: PERFORM com forma n�o coberta acima
    const perfFallM = lUp.match(/^PERFORM\s+([A-Z0-9][A-Z0-9-]*)/);
    if (perfFallM) { nodes.push({ type: 'perform', target: perfFallM[1] }); continue; }
    // GO TO / GOTO � desvio incondicional; interrompe o fluxo sequencial
    // GO TO target  ou  GOTO target (com ou sem espa�o entre GO e TO)
    const gotoM = lUp.match(/^GO(?:TO|\s+TO)\s+([A-Z0-9][A-Z0-9-]*)/);
    if (gotoM) {
      nodes.push({ type: 'goto', target: gotoM[1] });
      break;
    }
    // RETURN — leitura do arquivo sort (AT END / NOT AT END / END-RETURN)
    // Tratado como READ para fins de simulação e renderização do fluxo.
    if (/^RETURN\b/.test(lUp)) {
      let _retLbl  = l;
      let _ratEL = [], _rnotEL = [];
      let _ratEN = [], _rnotEN = [];
      let _retBlk = null, _retDone = false;
      while (i < linhas.length && !_retDone) {
        let _rrtTr  = linhas[i].trim();
        let _rrtPer = _rrtTr.endsWith('.');
        let _rrtUp  = _rrtTr.replace(/\.$/, '').toUpperCase();
        let _rrtLN  = lineNums ? lineNums[i] : null;
        i++;
        if (!_rrtUp) { if (_rrtPer) _retDone = true; continue; }
        if (/^END-RETURN\b/.test(_rrtUp)) { _retDone = true; break; }
        let _raM  = _rrtUp.match(/^AT\s+END\b(.*)/);
        let _rnaM = _rrtUp.match(/^NOT\s+AT\s+END\b(.*)/);
        if (_raM) {
          _retBlk = 'atend';
          let _il = _raM[1].trim(); if (_il) { _ratEL.push(_il); _ratEN.push(_rrtLN); }
        } else if (_rnaM) {
          _retBlk = 'notatend';
          let _il = _rnaM[1].trim(); if (_il) { _rnotEL.push(_il); _rnotEN.push(_rrtLN); }
        } else {
          if      (_retBlk === 'atend')    { _ratEL.push(_rrtUp);  _ratEN.push(_rrtLN); }
          else if (_retBlk === 'notatend') { _rnotEL.push(_rrtUp); _rnotEN.push(_rrtLN); }
        }
        if (_rrtPer) { _retDone = true; break; }
      }
      nodes.push({
        type: 'read',
        label: _retLbl,
        detail: [_retLbl,
          _ratEL.length  ? 'AT END\n    '     + _ratEL.join('\n    ')  : null,
          _rnotEL.length ? 'NOT AT END\n    ' + _rnotEL.join('\n    ') : null,
          'END-RETURN'].filter(Boolean).join('\n'),
        srcLine: _srcLine,
        atEnd:    _ratEL.length  ? buildAST(_ratEL,  _ratEN,  fdMap) : null,
        notAtEnd: _rnotEL.length ? buildAST(_rnotEL, _rnotEN, fdMap) : null,
        invalidKey: null,
      });
      continue;
    }
    // READ — multi-linha: AT END / NOT AT END / INVALID KEY / END-READ ou ponto
    if (/^READ\b/.test(lUp)) {
      let _readLbl   = l;
      let _atEL = [], _notEL = [], _invKL = [];
      let _atEN = [], _notEN = [], _invKN = [];
      let _rBlk = null;   // 'atend' | 'notatend' | 'invalidkey'
      let _rDone = false;
      while (i < linhas.length && !_rDone) {
        let _rtTr   = linhas[i].trim();
        let _rtPer  = _rtTr.endsWith('.');
        let _rtUp   = _rtTr.replace(/\.$/,'').toUpperCase();
        let _rtLN   = lineNums ? lineNums[i] : null;
        i++;
        if (!_rtUp) { if (_rtPer) _rDone = true; continue; }
        if (/^END-READ\b/.test(_rtUp)) { _rDone = true; break; }
        let _aM  = _rtUp.match(/^AT\s+END\b(.*)/);
        let _naM = _rtUp.match(/^NOT\s+AT\s+END\b(.*)/);
        let _iM  = _rtUp.match(/^INVALID\s+KEY\b(.*)/);
        let _niM = /^NOT\s+INVALID\s+KEY\b/.test(_rtUp);
        let _kM  = _rtUp.match(/^KEY\s+IS\b(.*)/);
        if (_aM) {
          _rBlk = 'atend';
          let _il = _aM[1].trim(); if (_il) { _atEL.push(_il); _atEN.push(_rtLN); }
        } else if (_naM) {
          _rBlk = 'notatend';
          let _il = _naM[1].trim(); if (_il) { _notEL.push(_il); _notEN.push(_rtLN); }
        } else if (_iM) {
          _rBlk = 'invalidkey';
          let _il = _iM[1].trim(); if (_il) { _invKL.push(_il); _invKN.push(_rtLN); }
        } else if (_niM) {
          _rBlk = 'notatend';
        } else if (_kM) {
          _readLbl += '\n' + _rtUp.replace(/\.$/, '');  _rBlk = null;
        } else {
          if      (_rBlk === 'atend')      { _atEL.push(_rtUp);  _atEN.push(_rtLN); }
          else if (_rBlk === 'notatend')   { _notEL.push(_rtUp); _notEN.push(_rtLN); }
          else if (_rBlk === 'invalidkey') { _invKL.push(_rtUp); _invKN.push(_rtLN); }
        }
        if (_rtPer) { _rDone = true; break; }
      }
      let _rdParts = [_readLbl];
      if (_atEL.length)  { _rdParts.push('AT END');      _atEL.forEach(function(x){ _rdParts.push('    '+x); }); }
      if (_notEL.length) { _rdParts.push('NOT AT END');  _notEL.forEach(function(x){ _rdParts.push('    '+x); }); }
      if (_invKL.length) { _rdParts.push('INVALID KEY'); _invKL.forEach(function(x){ _rdParts.push('    '+x); }); }
      _rdParts.push('END-READ');
      nodes.push({
        type: 'read',
        label: _readLbl,
        detail: _rdParts.join('\n'),
        srcLine: _srcLine,
        atEnd:      _atEL.length  ? buildAST(_atEL,  _atEN,  fdMap) : null,
        notAtEnd:   _notEL.length ? buildAST(_notEL, _notEN, fdMap) : null,
        invalidKey: _invKL.length ? buildAST(_invKL, _invKN, fdMap) : null,
      });
      continue;
    }
    // RETURN (SORT) — lê registro ordenado do arquivo SD; estrutura idêntica ao READ
    if (/^RETURN\b/.test(lUp)) {
      let _retLbl = l;
      let _atEL = [], _notEL = [];
      let _atEN = [], _notEN = [];
      let _rBlk2 = null, _rDone2 = false;
      while (i < linhas.length && !_rDone2) {
        let _rtTr2  = linhas[i].trim();
        let _rtPer2 = _rtTr2.endsWith('.');
        let _rtUp2  = _rtTr2.replace(/\.$/, '').toUpperCase();
        let _rtLN2  = lineNums ? lineNums[i] : null;
        i++;
        if (!_rtUp2) { if (_rtPer2) _rDone2 = true; continue; }
        if (/^END-RETURN\b/.test(_rtUp2)) { _rDone2 = true; break; }
        let _aM2  = _rtUp2.match(/^AT\s+END\b(.*)/);
        let _naM2 = _rtUp2.match(/^NOT\s+AT\s+END\b(.*)/);
        if (_aM2)       { _rBlk2 = 'atend';    let il = _aM2[1].trim();  if (il) { _atEL.push(il); _atEN.push(_rtLN2); } }
        else if (_naM2) { _rBlk2 = 'notatend'; let il = _naM2[1].trim(); if (il) { _notEL.push(il); _notEN.push(_rtLN2); } }
        else {
          if      (_rBlk2 === 'atend')    { _atEL.push(_rtUp2);  _atEN.push(_rtLN2); }
          else if (_rBlk2 === 'notatend') { _notEL.push(_rtUp2); _notEN.push(_rtLN2); }
        }
        if (_rtPer2) { _rDone2 = true; break; }
      }
      let _retParts = [_retLbl];
      if (_atEL.length)  { _retParts.push('AT END');     _atEL.forEach(function(x){ _retParts.push('    '+x); }); }
      if (_notEL.length) { _retParts.push('NOT AT END'); _notEL.forEach(function(x){ _retParts.push('    '+x); }); }
      _retParts.push('END-RETURN');
      nodes.push({
        type: 'read',
        label: _retLbl,
        detail: _retParts.join('\n'),
        srcLine: _srcLine,
        atEnd:    _atEL.length  ? buildAST(_atEL,  _atEN,  fdMap) : null,
        notAtEnd: _notEL.length ? buildAST(_notEL, _notEN, fdMap) : null,
      });
      continue;
    }
    // RELEASE — grava registro no arquivo SD (sort work file); tratado como WRITE
    if (/^RELEASE\b/.test(lUp)) {
      let _relRegM = lUp.match(/^RELEASE\s+([A-Z][A-Z0-9-]*)/);
      let _relReg  = _relRegM ? _relRegM[1] : '';
      let _relFile = fdMap[_relReg] || _relReg;  // fdMap inclui SD (pois expandimos acima)
      let _relLines = [l];
      // Consome cláusula FROM opcional na linha seguinte
      if (i < linhas.length && /^FROM\b/i.test(linhas[i].trim().toUpperCase())) {
        _relLines.push(linhas[i].trim()); i++;
      }
      nodes.push({ type: 'write', label: 'RELEASE\n' + _relFile,
                   writeVerb: 'RELEASE', fileName: _relFile, regName: _relReg,
                   detail: _relLines.join('\n'), srcLine: _srcLine });
      continue;
    }
    // OPEN → bloco Preparação (trapézio) — abre arquivo para leitura/gravação
    if (/^OPEN\b/.test(lUp)) {
      // Coleta linhas de continuação de OPEN multi-linha (modo ou nome de arquivo)
      let openLines = [l];
      while (i < linhas.length) {
        let nxt = linhas[i].trim().replace(/\.$/, '');
        let nxtUp = nxt.toUpperCase();
        // Para em linha vazia ou nova instrução (não é modo nem nome de arquivo)
        if (!nxt || (!/^(INPUT|OUTPUT|I-O|EXTEND)\b/.test(nxtUp) && !/^[A-Z][A-Z0-9-]+$/.test(nxtUp))) break;
        openLines.push(nxt);
        i++;
      }
      nodes.push({ type: 'open', label: openLines.join('\n'), srcLine: _srcLine });
      continue;
    }
    // CLOSE → bloco Terminador (oval) — fecha arquivo, finaliza processamento
    if (/^CLOSE\b/.test(lUp)) {
      // Coleta linhas de continuação de CLOSE multi-linha (apenas nomes de arquivo)
      let closeLines = [l];
      while (i < linhas.length) {
        let nxt = linhas[i].trim().replace(/\.$/, '');
        // Para em linha vazia ou token que não seja nome de arquivo simples
        if (!nxt || !/^[A-Z][A-Z0-9-]+$/.test(nxt.toUpperCase())) break;
        closeLines.push(nxt);
        i++;
      }
      nodes.push({ type: 'close', label: closeLines.join('\n'), srcLine: _srcLine });
      continue;
    }
    // CALL — chamada a subprograma estático ou dinâmico
    if (/^CALL\b/.test(lUp)) {
      // Extrai nome do programa: literal 'PROG' ou variável
      var _callM     = lUp.match(/^CALL\s+(?:'([^']+)'|"([^"]+)"|(\S+))/);
      var _callProg  = _callM ? (_callM[1] || _callM[2] || _callM[3] || '') : '';
      var _callDyn   = !/^CALL\s+['"]/.test(lUp);  // true → dinâmico (variável)
      var _callLines = [l];
      var _usingParts = [];
      var _excepL = [], _notExcepL = [];
      var _excepN = [], _notExcepN = [];
      var _cBlk   = null;  // 'exception' | 'notexception'
      var _cDone  = false;
      // Verbos que NÃO são continuação do CALL — ao encontrá-los fora de bloco, para
      var _callBreakRe = /^(MOVE|COMPUTE|ADD|SUBTRACT|MULTIPLY|DIVIDE|IF\b|ELSE\b|EVALUATE|PERFORM|OPEN|CLOSE|READ|WRITE|REWRITE|DELETE|STRING|UNSTRING|INSPECT|SEARCH|SORT|DISPLAY|ACCEPT|INITIALIZE|SET|GO\s+TO|GOTO|STOP\s+RUN|GOBACK|EXIT\b|EXEC\b)/;
      while (i < linhas.length && !_cDone) {
        var _cRaw = linhas[i].trim();
        var _cPer = _cRaw.endsWith('.');
        var _cUp  = _cRaw.replace(/\.$/, '').toUpperCase();
        var _cLN  = lineNums ? lineNums[i] : null;
        if (!_cUp) { i++; if (_cPer) _cDone = true; continue; }
        if (/^END-CALL\b/.test(_cUp)) { i++; _cDone = true; break; }
        // Se estamos fora dos blocos ON/NOT ON EXCEPTION e a linha é um novo verbo → para sem consumir
        if (_cBlk === null && _callBreakRe.test(_cUp)) { _cDone = true; break; }
        i++;
        var _onExM  = _cUp.match(/^ON\s+EXCEPTION\b(.*)?/);
        var _notExM = _cUp.match(/^NOT\s+ON\s+EXCEPTION\b(.*)?/);
        if (_onExM) {
          _cBlk = 'exception';
          var _il = (_onExM[1] || '').trim(); if (_il) { _excepL.push(_il); _excepN.push(_cLN); }
        } else if (_notExM) {
          _cBlk = 'notexception';
          var _il = (_notExM[1] || '').trim(); if (_il) { _notExcepL.push(_il); _notExcepN.push(_cLN); }
        } else if (_cBlk === 'exception') {
          _excepL.push(_cRaw.replace(/\.$/, '')); _excepN.push(_cLN);
        } else if (_cBlk === 'notexception') {
          _notExcepL.push(_cRaw.replace(/\.$/, '')); _notExcepN.push(_cLN);
        } else {
          // linha de continuação válida: USING, BY CONTENT/REFERENCE/VALUE, nome de variável
          var _uM = _cUp.match(/\bUSING\b(.*)/);
          if (_uM) { var _ut = _uM[1].trim(); if (_ut) _usingParts.push(_ut); }
          else if (/^BY\s+(CONTENT|REFERENCE|VALUE)\b/.test(_cUp)) { /* ignora — só cláusula */ }
          else { _usingParts.push(_cUp); }
          _callLines.push(_cRaw);
        }
        if (_cPer && _cBlk === null) { _cDone = true; break; }  // ponto fora de bloco fecha
      }
      // Label: CALL 'PROG' ou CALL VAR (dinâmico)
      var _callShort = 'CALL \'' + _callProg + '\''
      if (_callDyn) _callShort = 'CALL ' + _callProg + '\n(dinâmico)';
      if (_usingParts.length) _callShort += '\nUSING ' + _usingParts.join(' ');
      var _callDetail = _callLines.join('\n');
      if (_excepL.length || _notExcepL.length) _callDetail += '\n...';
      nodes.push({
        type: 'call',
        label: _callShort,
        callProg: _callProg,
        callDynamic: _callDyn,
        usingStr: _usingParts.join(' '),
        detail: _callDetail,
        srcLine: _srcLine,
        onException:    _excepL.length    ? buildAST(_excepL,    _excepN,    fdMap) : null,
        notOnException: _notExcepL.length ? buildAST(_notExcepL, _notExcepN, fdMap) : null,
      });
      continue;
    }
    // WRITE / REWRITE — identifica arquivo via fdMap
    if (/^(WRITE|REWRITE)\b/.test(lUp)) {
      var _verb = /^REWRITE\b/.test(lUp) ? 'REWRITE' : 'WRITE';
      var _regM = lUp.match(/^(?:WRITE|REWRITE)\s+([A-Z][A-Z0-9-]*)/);
      var _reg  = _regM ? _regM[1] : '';
      var _file = fdMap[_reg] || _reg;
      var _wLines = [l];
      while (i < linhas.length) {
        var _wRaw = linhas[i].trim();
        var _wUp  = _wRaw.replace(/\.$/, '').toUpperCase();
        if (/^END-WRITE\b/.test(_wUp)) { i++; break; }
        if (/^(FROM|AFTER|BEFORE|ADVANCING|INVALID|NOT|AT|END|WITH|LINES?)\b/.test(_wUp)) {
          _wLines.push(_wRaw); i++;
        } else { break; }
        if (_wRaw.endsWith('.')) break;
      }
      var _wLabel  = _verb + '\n' + _file;
      var _wDetail = _wLines.join('\n');
      nodes.push({ type: 'write', label: _wLabel, writeVerb: _verb, fileName: _file, regName: _reg, detail: _wDetail, srcLine: _srcLine });
      continue;
    }
    // SORT — interno (INPUT/OUTPUT PROCEDURE) ou externo (USING/GIVING)
    if (/^SORT\b/.test(lUp)) {
      var _sortFileName = (lUp.match(/^SORT\s+([A-Z][A-Z0-9-]*)/) || [])[1] || '';
      var _sortLines = [l];
      var _sortKeys = [], _sortInputProc = null, _sortOutputProc = null;
      var _sortUsing = [], _sortGiving = [];
      var _sortDone = false;
      // Verbos que NÃO são continuação do SORT
      var _sortBreakRe = /^(PERFORM|IF\b|ELSE\b|EVALUATE|MOVE|COMPUTE|ADD|SUBTRACT|MULTIPLY|DIVIDE|CALL|DISPLAY|ACCEPT|OPEN|CLOSE|READ|WRITE|REWRITE|DELETE|STRING|UNSTRING|INSPECT|SEARCH|EXEC\b|GO\s+TO|GOTO\b|STOP\s+RUN|GOBACK|EXIT\b|INITIALIZE)/;
      // Parse de uma linha de continuação do SORT
      var _parseSortLine = function(uLine) {
        var keyM = uLine.match(/^ON\s+(ASCENDING|DESCENDING)(?:\s+KEY)?\s+(.*)/);
        if (keyM) {
          var fields2 = keyM[2].trim().split(/\s+/).filter(function(f){ return f && !/^(ON|ASCENDING|DESCENDING|KEY|INPUT|OUTPUT|USING|GIVING|PROCEDURE|IS)$/i.test(f); });
          fields2.forEach(function(f){ _sortKeys.push(keyM[1].charAt(0) + ':' + f); });
          return;
        }
        var inM = uLine.match(/^INPUT\s+PROCEDURE(?:\s+IS)?\s+([A-Z][A-Z0-9-]*)/);
        if (inM) { _sortInputProc = inM[1]; return; }
        var outM = uLine.match(/^OUTPUT\s+PROCEDURE(?:\s+IS)?\s+([A-Z][A-Z0-9-]*)/);
        if (outM) { _sortOutputProc = outM[1]; return; }
        var usingM = uLine.match(/^USING\s+(.*)/);
        if (usingM) { _sortUsing = usingM[1].trim().split(/\s+/).filter(Boolean); return; }
        var givingM = uLine.match(/^GIVING\s+(.*)/);
        if (givingM) { _sortGiving = givingM[1].trim().split(/\s+/).filter(Boolean); return; }
      };
      // Processa o restante da primeira linha após SORT arq-nome
      var _afterSort = lUp.replace(/^SORT\s+[A-Z][A-Z0-9-]*\s*/, '');
      if (_afterSort.trim()) _parseSortLine(_afterSort.trim());
      // Consome linhas de continuação
      while (i < linhas.length && !_sortDone) {
        var _sRaw = linhas[i].trim();
        var _sPer = _sRaw.endsWith('.');
        var _sUp  = _sRaw.replace(/\.$/, '').toUpperCase();
        if (!_sUp) { i++; if (_sPer) { _sortDone = true; } continue; }
        if (_sortBreakRe.test(_sUp)) { _sortDone = true; break; }
        i++;
        _parseSortLine(_sUp);
        _sortLines.push(_sRaw);
        if (_sPer) { _sortDone = true; break; }
      }
      // Constrói label visual
      var _isInternalSort = !!(_sortInputProc || _sortOutputProc);
      var _sortLabel = 'SORT\n' + _sortFileName;
      if (_sortKeys.length) {
        _sortLabel += '\n' + _sortKeys.map(function(k){
          var p = k.split(':');
          return (p[0] === 'A' ? '↑' : '↓') + ' ' + p[1];
        }).join('  ');
      }
      if (!_isInternalSort) {
        if (_sortUsing.length)  _sortLabel += '\nUSING '  + _sortUsing.join(' ');
        if (_sortGiving.length) _sortLabel += '\nGIVING ' + _sortGiving.join(' ');
      }
      nodes.push({
        type: 'sort',
        label: _sortLabel,
        sortFile: _sortFileName,
        sortKeys: _sortKeys,
        inputProc: _sortInputProc,
        outputProc: _sortOutputProc,
        using: _sortUsing,
        giving: _sortGiving,
        isInternal: _isInternalSort,
        detail: _sortLines.join('\n'),
        srcLine: _srcLine
      });
      continue;
    }
    // SEARCH [ALL] — busca em tabela interna; coleta AT END e WHENs
    if (/^SEARCH\b/.test(lUp)) {
      var _srchAll = /^SEARCH\s+ALL\b/.test(lUp);
      var _srchM   = lUp.match(/^SEARCH(?:\s+ALL)?\s+([A-Z][A-Z0-9-]*)/);
      var _srchTbl = _srchM ? _srchM[1] : '?';
      var _srchAtEndL = [], _srchAtEndN = [];
      var _srchWhens  = []; // [{condition, bodyL, bodyN}]
      var _srchCurBlk = null; // null | 'atend' | {type:'when', idx}
      var _srchDone   = false;
      while (i < linhas.length && !_srchDone) {
        var _stTr  = linhas[i].trim();
        var _stPer = _stTr.endsWith('.');
        var _stUp  = _stTr.replace(/\.$/, '').toUpperCase().trim();
        var _stLN  = lineNums ? lineNums[i] : null;
        i++;
        if (!_stUp) { if (_stPer) _srchDone = true; continue; }
        if (/^END-SEARCH\b/.test(_stUp)) { _srchDone = true; break; }
        var _aM = _stUp.match(/^AT\s+END\b(.*)/);
        var _wM = _stUp.match(/^WHEN\b(.*)/);
        if (_aM) {
          _srchCurBlk = 'atend';
          var _aIl = _aM[1].trim(); if (_aIl) { _srchAtEndL.push(_aIl); _srchAtEndN.push(_stLN); }
        } else if (_wM) {
          _srchWhens.push({ condition: _wM[1].trim() || '?', bodyL: [], bodyN: [] });
          _srchCurBlk = { type: 'when', idx: _srchWhens.length - 1 };
        } else {
          if (_srchCurBlk === 'atend') {
            _srchAtEndL.push(_stUp); _srchAtEndN.push(_stLN);
          } else if (_srchCurBlk && _srchCurBlk.type === 'when') {
            var _cW = _srchWhens[_srchCurBlk.idx];
            // Linha AND/OR sem corpo ainda → estende a condição
            if (_cW.bodyL.length === 0 && /^(AND|OR)\b/.test(_stUp)) {
              _cW.condition += ' ' + _stUp;
            } else {
              _cW.bodyL.push(_stTr.replace(/\.$/, '')); _cW.bodyN.push(_stLN);
            }
          }
        }
        if (_stPer) { _srchDone = true; break; }
      }
      var _srchLbl = (_srchAll ? 'SEARCH ALL' : 'SEARCH') + '\n' + _srchTbl;
      var _srchParts = [l];
      if (_srchAtEndL.length) { _srchParts.push('AT END'); _srchAtEndL.forEach(function(x){ _srchParts.push('    '+x); }); }
      _srchWhens.forEach(function(w) {
        _srchParts.push('WHEN ' + w.condition);
        w.bodyL.forEach(function(x){ _srchParts.push('    '+x); });
      });
      _srchParts.push('END-SEARCH');
      nodes.push({
        type: 'search',
        label: _srchLbl,
        detail: _srchParts.join('\n'),
        srcLine: _srcLine,
        searchAll: _srchAll,
        searchTable: _srchTbl,
        atEnd:  _srchAtEndL.length ? buildAST(_srchAtEndL, _srchAtEndN, fdMap) : null,
        whens:  _srchWhens.map(function(w) {
          return { condition: w.condition,
                   body: w.bodyL.length ? buildAST(w.bodyL, w.bodyN, fdMap) : null };
        })
      });
      continue;
    }
    // Demais operações de I/O → paralelogramo (DISPLAY, ACCEPT, DELETE…)
    if (/^(DISPLAY|ACCEPT|DELETE)\b/.test(lUp)) {
      nodes.push({ type: 'io', label: l, srcLine: _srcLine });
      continue;
    }
    // MOVE � o TO pode estar na mesma linha ou na linha seguinte
    if (/^MOVE\b/.test(lUp)) {
      let moveLine = l;
      // Se n�o h� TO na linha atual, consome a pr�xima linha que come�a com TO
      if (!/\bTO\b/.test(lUp) && i < linhas.length) {
        let pkTo = linhas[i].trim().replace(/\.$/, '');
        if (/^TO\b/i.test(pkTo)) {
          moveLine = l + ' ' + pkTo.toUpperCase();
          i++;
        }
      }
      nodes.push({ type: 'instr', label: moveLine, srcLine: _srcLine });
      continue;
    }
    // COPY / INCLUDE — módulo externo (copybook) na PROCEDURE DIVISION
    // Nota: EXEC SQL INCLUDE já é tratado pelo bloco SQL acima; aqui só COPY nativo e ++INCLUDE IBM
    const copyM = lUp.match(/^(?:\+\+)?(?:COPY|INCLUDE)\s+([A-Z0-9][A-Z0-9@#$-]*)/);
    if (copyM && !/^EXEC\s+SQL\b/.test(lUp)) {
      nodes.push({ type: 'copy', name: copyM[1], label: 'COPY ' + copyM[1], srcLine: _srcLine });
      continue;
    }
    // END-IF orfao (o IF ja foi fechado por '.' dentro do corpo) — ignorar silenciosamente
    if (/^END-IF\b/.test(lUp)) continue;
    nodes.push({ type: 'instr', label: l, srcLine: _srcLine });
  }

  // -- Agrupar instrucoes/IOs consecutivos em bloco unico ----------------
  // Sequencias de 2+ instrucoes simples (MOVE, COMPUTE, ADD, DISPLAY, etc.) sao
  // consolidadas num no retangular unico para reduzir o tamanho do fluxo.
  var _grouped = [];
  var _gi = 0;
  while (_gi < nodes.length) {
    var _t = nodes[_gi].type;
    if (_t === 'instr' || _t === 'io') {
      var _grp = [];
      while (_gi < nodes.length && (nodes[_gi].type === 'instr' || nodes[_gi].type === 'io')) {
        _grp.push(nodes[_gi]);
        _gi++;
      }
      if (_grp.length >= 2) {
        var _MAX_DISP = 5;
        var _allLabels = _grp.map(function(n) { return n.label; });
        var _dispLabels = _allLabels.length > _MAX_DISP
          ? _allLabels.slice(0, _MAX_DISP - 1).concat(['(+' + (_allLabels.length - _MAX_DISP + 1) + ' mais)'])
          : _allLabels;
        // Gera resumo para o label (exibido no bloco)
        var _verbos = {};
        _grp.forEach(function(n) {
          var v = n.label.trim().split(/\s+/)[0].toUpperCase();
          _verbos[v] = (_verbos[v] || 0) + 1;
        });
        var _resumoParts = Object.keys(_verbos).map(function(v) {
          return _verbos[v] > 1 ? v + ' \xd7' + _verbos[v] : v;
        });
        var _resumo = '\u25a6 ' + _resumoParts.join('  \u00b7  ') + '  (' + _grp.length + ' linha' + (_grp.length > 1 ? 's' : '') + ')';
        _grouped.push({
          type: 'group',
          label: _resumo,
          detail: _allLabels.join('\n'),
          lineCount: 1,
          srcLine: _grp[0].srcLine != null ? _grp[0].srcLine : null
        });
      } else {
        _grouped = _grouped.concat(_grp);
      }
    } else {
      _grouped.push(nodes[_gi]);
      _gi++;
    }
  }
  nodes = _grouped;
  // -----------------------------------------------------------------

  return nodes;
}

// ================= AST ? ELEMENTS =================
// Renderiza uma sequ�ncia de n�s AST; retorna [firstId, lastId]
function renderSeq(ast, els, uid, meta, cs, depth) {
  // Guarda absoluta: conta o n�mero de frames renderSeq ativos na pilha de chamadas.
  // Cobre TODOS os caminhos recursivos (IF, LOOP inline, PERFORM, THRU),
  // independente de depth ou _ifDepth. Limite 120 � 240 frames JS � seguro em qualquer motor.
  meta._renderDepth = (meta._renderDepth || 0) + 1;
  if (meta._renderDepth > 120) {
    meta._renderDepth--;
    return [null, null];
  }
  let first = null, prev = null, last = null;
  for (let n of ast) {
    let [nf, nl] = renderNode(n, els, uid, meta, cs, depth);
    if (!nf) continue;
    if (!first) first = nf;
    if (prev) els.push({ data: { source: prev, target: nf } });
    last = nl || nf;
    prev = last;
  }
  meta._renderDepth--;
  return [first, last];
}

function renderNode(n, els, uid, meta, cs, depth) {
  const { estrutura, tipos, secoes, ordemParagrafos, maxDepth } = meta;
  // col() retorna a coluna atual para tagear n�s no layout horizontal por par�grafo
  const _col = () => meta.currentCol || 0;

  // Guarda combinada: profundidade total PERFORM + IF aninhados.
  // Cada n�vel coloca 2 frames JS na pilha (renderSeq + renderNode).
  // Limite 90 = m�ximo ~180 frames de recurs�o, seguro em qualquer motor JS.
  if (depth + (meta._ifDepth || 0) >= 90) return [null, null];

  if (n.type === 'group') {
    let id = uid('grp');
    els.push({ data: { id, label: n.label, tipo: 'grupo', col: _col(), detail: n.detail || null, para: meta.currentPara || '', srcLine: n.srcLine != null ? n.srcLine : undefined } });
    return [id, id];
  }

  if (n.type === 'instr') {
    let id = uid('i');
    els.push({ data: { id, label: n.label, tipo: 'instrucao', col: _col(), detail: n.detail || null, para: meta.currentPara || '', srcLine: n.srcLine != null ? n.srcLine : undefined } });
    return [id, id];
  }

  if (n.type === 'read') {
    let readId = uid('io');
    els.push({ data: { id: readId, label: n.label, tipo: 'io', detail: n.detail || n.label,
                       col: _col(), para: meta.currentPara || '',
                       srcLine: n.srcLine != null ? n.srcLine : undefined } });
    let _hasRBlocks = n.atEnd || n.notAtEnd || n.invalidKey;
    if (!_hasRBlocks) return [readId, readId];
    // Nó de decisão: AT END? ou INVALID KEY?
    let _useInv  = !!(n.invalidKey && n.invalidKey.length);
    let eofDecId = uid('if');
    let eofLbl   = _useInv ? 'INVALID\nKEY?' : 'AT END?';
    els.push({ data: { id: eofDecId, label: eofLbl, tipo: 'if', col: _col(), para: meta.currentPara || '' } });
    els.push({ data: { source: readId, target: eofDecId } });
    let mRId = uid('mg');
    els.push({ data: { id: mRId, label: '', tipo: 'merge', col: _col() } });
    meta._ifDepth = (meta._ifDepth || 0) + 1;
    // Ramo SIM: AT END ou INVALID KEY
    let _simBR = _useInv ? n.invalidKey : (n.atEnd || []);
    if (_simBR && _simBR.length) {
      let [rsf, rsl] = renderSeq(_simBR, els, uid, meta, cs, depth);
      if (rsf) {
        els.push({ data: { source: eofDecId, target: rsf, label: _useInv ? 'Inválida' : 'EOF' } });
        els.push({ data: { source: rsl || rsf, target: mRId } });
      } else {
        els.push({ data: { source: eofDecId, target: mRId, label: _useInv ? 'Inválida' : 'EOF' } });
      }
    } else {
      els.push({ data: { source: eofDecId, target: mRId, label: _useInv ? 'Inválida' : 'EOF' } });
    }
    // Ramo NÃO: NOT AT END ou continua
    let _naoBR = n.notAtEnd || [];
    if (_naoBR.length) {
      let [rnf, rnl] = renderSeq(_naoBR, els, uid, meta, cs, depth);
      if (rnf) {
        els.push({ data: { source: eofDecId, target: rnf, label: 'Continua' } });
        els.push({ data: { source: rnl || rnf, target: mRId } });
      } else {
        els.push({ data: { source: eofDecId, target: mRId, label: 'Continua' } });
      }
    } else {
      els.push({ data: { source: eofDecId, target: mRId, label: 'Continua' } });
    }
    meta._ifDepth--;
    return [readId, mRId];
  }

  if (n.type === 'search') {
    // Nó principal: representa o SEARCH / SEARCH ALL
    let searchId = uid('srch');
    els.push({ data: { id: searchId, label: n.label, tipo: 'search',
                       searchAll: n.searchAll ? 'true' : 'false',
                       col: _col(), para: meta.currentPara || '',
                       detail: n.detail || n.label,
                       srcLine: n.srcLine != null ? n.srcLine : undefined } });
    // Sem WHENs → nó simples
    if (!n.whens || n.whens.length === 0) return [searchId, searchId];

    let mSrchId = uid('mg');
    els.push({ data: { id: mSrchId, label: '', tipo: 'merge', col: _col() } });
    meta._ifDepth = (meta._ifDepth || 0) + 1;

    // Encadeia WHENs: WHEN1 → (SIM → body, NÃO → WHEN2 → ... → AT END)
    let _srchLastEntry = searchId;
    n.whens.forEach(function(when, idx) {
      let whenDecId = uid('if');
      let whenLbl = 'WHEN\n' + when.condition;
      els.push({ data: { id: whenDecId, label: whenLbl, tipo: 'if',
                         col: _col(), para: meta.currentPara || '' } });
      // Ligação do nó anterior a este WHEN
      els.push({ data: { source: _srchLastEntry, target: whenDecId,
                         label: idx === 0 ? '' : 'Não' } });
      // Ramo SIM → corpo do WHEN
      if (when.body && when.body.length) {
        let [wf, wl] = renderSeq(when.body, els, uid, meta, cs, depth);
        if (wf) {
          els.push({ data: { source: whenDecId, target: wf, label: 'SIM' } });
          els.push({ data: { source: wl || wf, target: mSrchId } });
        } else {
          els.push({ data: { source: whenDecId, target: mSrchId, label: 'SIM' } });
        }
      } else {
        els.push({ data: { source: whenDecId, target: mSrchId, label: 'SIM' } });
      }
      _srchLastEntry = whenDecId;
    });

    // Ramo AT END (Não do último WHEN)
    if (n.atEnd && n.atEnd.length) {
      let [af, al] = renderSeq(n.atEnd, els, uid, meta, cs, depth);
      if (af) {
        els.push({ data: { source: _srchLastEntry, target: af, label: 'AT END' } });
        els.push({ data: { source: al || af, target: mSrchId } });
      } else {
        els.push({ data: { source: _srchLastEntry, target: mSrchId, label: 'AT END' } });
      }
    } else {
      els.push({ data: { source: _srchLastEntry, target: mSrchId, label: 'AT END' } });
    }

    meta._ifDepth--;
    return [searchId, mSrchId];
  }

  if (n.type === 'io') {
    let id = uid('io');
    els.push({ data: { id, label: n.label, tipo: 'io', col: _col(), para: meta.currentPara || '', srcLine: n.srcLine != null ? n.srcLine : undefined } });
    return [id, id];
  }
  if (n.type === 'open') {
    let id = uid('open');
    els.push({ data: { id, label: n.label, tipo: 'open', col: _col(), para: meta.currentPara || '', srcLine: n.srcLine != null ? n.srcLine : undefined } });
    return [id, id];
  }

  if (n.type === 'close') {
    let id = uid('close');
    els.push({ data: { id, label: n.label, tipo: 'close', col: _col(), para: meta.currentPara || '', srcLine: n.srcLine != null ? n.srcLine : undefined } });
    return [id, id];
  }

  if (n.type === 'stop') {
    let id = uid('stop');
    els.push({ data: { id, label: n.label, tipo: 'stop', col: _col(), para: meta.currentPara || '', srcLine: n.srcLine != null ? n.srcLine : undefined } });
    return [id, id];
  }

  if (n.type === 'if') {
    let ifId = uid('if');
    els.push({ data: { id: ifId, label: n.label, tipo: 'if', col: _col(), para: meta.currentPara || '', srcLine: n.srcLine != null ? n.srcLine : undefined } });
    let mId = uid('mg');
    els.push({ data: { id: mId, label: '', tipo: 'merge', col: _col() } });
    // Guarda de profundidade de IFs aninhados: evita stack overflow em programas com
    // centenas de IFs encadeados. Limite pr�tico: 80 n�veis de aninhamento.
    meta._ifDepth = (meta._ifDepth || 0) + 1;
    const _ifSafe = meta._ifDepth <= 80;
    if (_ifSafe && n.sim && n.sim.length) {
      let [sf, sl] = renderSeq(n.sim, els, uid, meta, cs, depth);
      els.push({ data: { source: ifId, target: sf, label: 'SIM' } });
      els.push({ data: { source: sl || sf, target: mId } });
    } else {
      els.push({ data: { source: ifId, target: mId, label: 'SIM' } });
    }
    if (_ifSafe && n.nao && n.nao.length) {
      let [nf2, nl2] = renderSeq(n.nao, els, uid, meta, cs, depth);
      els.push({ data: { source: ifId, target: nf2, label: 'Não' } });
      els.push({ data: { source: nl2 || nf2, target: mId } });
    } else {
      els.push({ data: { source: ifId, target: mId, label: 'Não' } });
    }
    meta._ifDepth--;
    return [ifId, mId];
  }

  if (n.type === 'perform') {
    let { target } = n;
    let eSection = tipos && tipos[target] === 'section';
    let id = uid('p');
    const _callerCol = _col();
    // Se n�o vai expandir, fica como n� inline na coluna do chamador (sem alocar nova coluna)
    if (depth >= meta.maxDepth || cs.has(target)) {
      els.push({ data: { id, label: target, tipo: eSection ? 'perform-section' : 'perform', target, col: _callerCol } });
      return [id, id];
    }
    const _callerPara = meta.currentPara;
    // Vai expandir � nova coluna APENAS para depth===0 (chamadas diretas do bloco de entrada).
    // PERFORMs em depth>0 ficam inline na coluna do pai: sem arestas de retorno da direita p/ esquerda.
    const _newCol = (depth === 0) ? ++meta.colCounter : _callerCol;
    meta.currentCol = _newCol;
    els.push({ data: { id, label: target, tipo: eSection ? 'perform-section' : 'perform', target, col: _newCol } });
    let ns = new Set(cs);
    ns.add(target);
    if (eSection) {
      let pars = (secoes && secoes[target]) || [];
      let last = id;
      // Renderiza o conte�do direto da section (instru��es antes do primeiro sub-par�grafo)
      let secDireto = estrutura[target] || [];
      if (secDireto.length > 0) {
        meta.currentCol = _newCol;
        let [sfc, slc] = renderSeq(buildAST(secDireto, meta.lineNumMap ? meta.lineNumMap[target] : null, meta.fdMap), els, uid, meta, ns, depth + 1);
        if (sfc) els.push({ data: { source: last, target: sfc } });
        if (slc) last = slc;
      }
      // Renderiza sub-par�grafos reais, pulando marcadores EXIT (fim-paragrafo)
      pars.forEach(par => {
        if (tipos[par] === 'fim-paragrafo') return;
        const _parCol = (depth === 0) ? ++meta.colCounter : _newCol;
        meta.currentCol = _parCol;
        const _prevParaSec = meta.currentPara;
        meta.currentPara = par;  // nós filhos ficam com para=par correto
        let pid = uid('sp');
        els.push({ data: { id: pid, label: par, tipo: 'section-para', target: par, col: _parCol } });
        els.push({ data: { source: last, target: pid } });
        let [fc, lc] = renderSeq(buildAST(estrutura[par] || [], meta.lineNumMap ? meta.lineNumMap[par] : null, meta.fdMap), els, uid, meta, ns, depth + 1);
        if (fc) els.push({ data: { source: pid, target: fc } });
        last = lc || pid;
        meta.currentPara = _prevParaSec;
      });
      meta.currentCol = _callerCol;
      return [id, last];
    } else {
      meta.currentPara = target;
      let [fc, lc] = renderSeq(buildAST(estrutura[target] || [], meta.lineNumMap ? meta.lineNumMap[target] : null, meta.fdMap), els, uid, meta, ns, depth + 1);
      meta.currentCol = _callerCol;
      meta.currentPara = _callerPara;
      if (fc) els.push({ data: { source: id, target: fc } });
      return [id, lc || id];
    }
  }

  if (n.type === 'perform-thru') {
    let { from, to, cond } = n;
    let id = uid('pt');
    let thruLabel = from + ' THRU ' + to + (cond ? '\n' + cond : '');
    const _callerColThru = _col();
    els.push({ data: { id, label: thruLabel, tipo: cond ? 'loop' : 'perform', target: from, col: _callerColThru } });
    // N�o expande se atingiu profundidade m�xima ou cap de elementos
    if (depth >= meta.maxDepth ) return [id, id];
    let fi = (ordemParagrafos || []).indexOf(from);
    let ti = (ordemParagrafos || []).indexOf(to);
    if (fi < 0 || ti < 0 || fi > ti) return [id, id];
    let range = ordemParagrafos.slice(fi, ti + 1).filter(p => tipos[p] !== 'section' && tipos[p] !== 'fim-paragrafo');
    let ns = new Set(cs);
    range.forEach(p => ns.add(p));
    let last = id;
    range.forEach(par => {
      // Perform-thru expande inline; n�o cria colunas separadas
      const _parColThru = _callerColThru;
      meta.currentCol = _parColThru;
      const _prevParaThru = meta.currentPara;
      meta.currentPara = par;  // nós filhos ficam com para=par correto
      let pid = uid('p');
      els.push({ data: { id: pid, label: par, tipo: 'perform-fall', target: par, col: _parColThru } });
      els.push({ data: { source: last, target: pid } });
      let [fc, lc] = renderSeq(buildAST(estrutura[par] || [], meta.lineNumMap ? meta.lineNumMap[par] : null, meta.fdMap), els, uid, meta, ns, depth + 1);
      if (fc) els.push({ data: { source: pid, target: fc } });
      last = lc || pid;
      meta.currentPara = _prevParaThru;
    });
    meta.currentCol = _callerColThru;
    return [id, last];
  }

  if (n.type === 'loop') {
    const _loopCol = _col();
    let loopId = uid('loop');
    els.push({ data: { id: loopId, label: n.label, tipo: 'loop', col: _loopCol, para: meta.currentPara || '' } });
    let mId = uid('mg');
    els.push({ data: { id: mId, label: '', tipo: 'merge', col: _loopCol } });
    if (n.body && n.body.length) {
      // Loop inline com corpo � fica na mesma coluna
      let [bf, bl_] = renderSeq(n.body, els, uid, meta, cs, depth);
      if (bf) {
        els.push({ data: { source: loopId, target: bf, label: 'LOOP', minLen: 2 } });
        if (bl_) els.push({ data: { source: bl_, target: loopId } });
      }
    } else if (n.named) {
      // Loop com par�grafo nomeado � par�grafo chamado vai para nova coluna
      let target = n.named;
      let eSection = tipos && tipos[target] === 'section';
      let pid = uid('p');
      els.push({ data: { id: pid, label: target, tipo: eSection ? 'perform-section' : 'perform', target, col: _loopCol } });
      els.push({ data: { source: loopId, target: pid, label: 'LOOP', minLen: 2 } });
      let bodyLast = pid;
      if (depth < meta.maxDepth && !cs.has(target)) {
        // Corpo do loop fica inline na mesma coluna do n� loop
        meta.currentCol = _loopCol;
        let ns = new Set(cs); ns.add(target);
        let [fc, lc] = renderSeq(buildAST(estrutura[target] || [], meta.lineNumMap ? meta.lineNumMap[target] : null, meta.fdMap), els, uid, meta, ns, depth + 1);
        meta.currentCol = _loopCol;
        if (fc) els.push({ data: { source: pid, target: fc } });
        bodyLast = lc || pid;
      }
      els.push({ data: { source: bodyLast, target: loopId } });
    }
    els.push({ data: { source: loopId, target: mId, label: 'FIM', minLen: 2 } });
    return [loopId, mId];
  }

  if (n.type === 'evaluate') {
    // Label compacto: extrai variável/expressão após EVALUATE
    let _evLbl = n.label.replace(/^EVALUATE\s+/i, 'EVALUATE\n');
    let _evCol = _col();
    let evId = uid('ev');
    els.push({ data: { id: evId, label: _evLbl, tipo: 'evaluate',
                       detail: n.detail || n.label,
                       col: _evCol, para: meta.currentPara || '',
                       srcLine: n.srcLine != null ? n.srcLine : undefined } });
    let _whens = n.whens || [];
    if (!_whens.length) return [evId, evId];
    // Nó de merge — todos os ramos convergem aqui, na mesma coluna do losango
    let mEvId = uid('mg');
    els.push({ data: { id: mEvId, label: '', tipo: 'merge', col: _evCol } });
    meta._ifDepth = (meta._ifDepth || 0) + 1;
    let _savedCol = meta.currentCol;
    // Passa depth+1 para que PERFORMs dentro de WHEN não aloquem novas colunas
    // (coluna nova só é alocada quando depth===0; com depth+1 expande normalmente sem bagunça)
    _whens.forEach(function(w) {
      meta.currentCol = _evCol;
      let _wLbl = w.label.replace(/^WHEN\s+/i, '').trim() || w.label;
      if (_wLbl.toUpperCase() === 'OTHER') _wLbl = 'OUTRO';
      if (w.nodes && w.nodes.length) {
        let [wf, wl] = renderSeq(w.nodes, els, uid, meta, cs, depth + 1);
        if (wf) {
          els.push({ data: { source: evId, target: wf, label: _wLbl } });
          els.push({ data: { source: wl || wf, target: mEvId } });
        } else {
          els.push({ data: { source: evId, target: mEvId, label: _wLbl } });
        }
      } else {
        els.push({ data: { source: evId, target: mEvId, label: _wLbl } });
      }
    });
    meta.currentCol = _savedCol;
    meta._ifDepth--;
    return [evId, mEvId];
  }

  if (n.type === 'goto') {
    let id = uid('gt');
    els.push({ data: { id, label: 'GO TO: ' + n.target, tipo: 'goto', target: n.target, col: _col(), para: meta.currentPara || '' } });
    return [id, id];
  }

  if (n.type === 'call') {
    let callId = uid('call');
    els.push({ data: { id: callId, label: n.label, tipo: 'call', callDynamic: n.callDynamic ? 'true' : 'false',
                       col: _col(), detail: n.detail || n.label, para: meta.currentPara || '',
                       srcLine: n.srcLine != null ? n.srcLine : undefined } });
    let _hasBlocks = n.onException || n.notOnException;
    if (!_hasBlocks) return [callId, callId];
    // Nó de decisão ON EXCEPTION?
    let _cDecId = uid('if');
    els.push({ data: { id: _cDecId, label: 'ON\nEXCEPTION?', tipo: 'if', col: _col(), para: meta.currentPara || '' } });
    els.push({ data: { source: callId, target: _cDecId } });
    let mCId = uid('mg');
    els.push({ data: { id: mCId, label: '', tipo: 'merge', col: _col() } });
    meta._ifDepth = (meta._ifDepth || 0) + 1;
    // Ramo EXCEPTION (SIM)
    if (n.onException && n.onException.length) {
      let [ef, el_] = renderSeq(n.onException, els, uid, meta, cs, depth);
      if (ef) {
        els.push({ data: { source: _cDecId, target: ef, label: 'Exceção' } });
        els.push({ data: { source: el_ || ef, target: mCId } });
      } else {
        els.push({ data: { source: _cDecId, target: mCId, label: 'Exceção' } });
      }
    } else {
      els.push({ data: { source: _cDecId, target: mCId, label: 'Exceção' } });
    }
    // Ramo NOT ON EXCEPTION (NÃO)
    if (n.notOnException && n.notOnException.length) {
      let [nef, nel] = renderSeq(n.notOnException, els, uid, meta, cs, depth);
      if (nef) {
        els.push({ data: { source: _cDecId, target: nef, label: 'OK' } });
        els.push({ data: { source: nel || nef, target: mCId } });
      } else {
        els.push({ data: { source: _cDecId, target: mCId, label: 'OK' } });
      }
    } else {
      els.push({ data: { source: _cDecId, target: mCId, label: 'OK' } });
    }
    meta._ifDepth--;
    return [callId, mCId];
  }

  if (n.type === 'write') {
    let id = uid('writ');
    els.push({ data: { id, label: n.label, tipo: 'write', writeVerb: n.writeVerb || 'WRITE', col: _col(), detail: n.detail || null, para: meta.currentPara || '', srcLine: n.srcLine != null ? n.srcLine : undefined } });
    return [id, id];
  }

  if (n.type === 'sql') {
    let id = uid('sql');
    els.push({ data: { id, label: n.label, tipo: 'sql', sqlOp: n.sqlOp || 'OTHER', col: _col(), detail: n.detail || null, para: meta.currentPara || '', srcLine: n.srcLine != null ? n.srcLine : undefined } });
    return [id, id];
  }

  if (n.type === 'copy') {
    let id = uid('cpy');
    els.push({ data: { id, label: 'COPY\n' + n.name, tipo: 'copy', target: n.name,
                       col: _col(), para: meta.currentPara || '',
                       srcLine: n.srcLine != null ? n.srcLine : undefined } });
    return [id, id];
  }

  // ── SORT interno / externo ──────────────────────────────────────
  if (n.type === 'sort') {
    const _sortColAnchor = _col();
    let sortId = uid('sort');
    els.push({ data: { id: sortId, label: n.label, tipo: 'sort',
                       sortFile: n.sortFile || '',
                       col: _sortColAnchor, detail: n.detail || n.label,
                       para: meta.currentPara || '',
                       srcLine: n.srcLine != null ? n.srcLine : undefined } });
    // SORT externo (USING/GIVING): nó único
    if (!n.isInternal) return [sortId, sortId];

    // SORT interno: SORT → INPUT PROCEDURE → ⚙ ENGINE → OUTPUT PROCEDURE
    let _sortLast = sortId;
    const _sortSavedPara = meta.currentPara;

    // ── INPUT PROCEDURE ─────────────────────────────────────────
    if (n.inputProc) {
      const _inSec = meta.tipos && meta.tipos[n.inputProc] === 'section';
      let inpId = uid('sort-inp');
      els.push({ data: { id: inpId, label: 'INPUT PROCEDURE\n' + n.inputProc,
                         tipo: 'sort-input', target: n.inputProc,
                         col: _sortColAnchor, para: meta.currentPara || '' } });
      els.push({ data: { source: _sortLast, target: inpId, label: 'INPUT→RELEASE' } });
      if (depth < meta.maxDepth && !cs.has(n.inputProc)) {
        const _inNs = new Set(cs);
        _inNs.add(n.inputProc);
        meta.currentPara = n.inputProc;
        const _inAst = buildAST(meta.estrutura[n.inputProc] || [],
                                 meta.lineNumMap ? meta.lineNumMap[n.inputProc] : null,
                                 meta.fdMap);
        const [_inF, _inL] = renderSeq(_inAst, els, uid, meta, _inNs, depth + 1);
        if (_inF) { els.push({ data: { source: inpId, target: _inF } }); }
        _sortLast = _inL || inpId;
      } else {
        _sortLast = inpId;
      }
      meta.currentPara = _sortSavedPara;
    }

    // ── ENGINE SORT ─────────────────────────────────────────────
    let engId = uid('sort-eng');
    els.push({ data: { id: engId, label: '⚙ SORT ENGINE\nDFSORT / SYNCSORT',
                       tipo: 'sort-engine', col: _sortColAnchor,
                       para: meta.currentPara || '',
                       sortFile: n.sortFile || '',
                       sortKeys: JSON.stringify(n.sortKeys || []) } });
    els.push({ data: { source: _sortLast, target: engId, label: 'RELEASE' } });
    _sortLast = engId;

    // ── OUTPUT PROCEDURE ────────────────────────────────────────
    if (n.outputProc) {
      let outId = uid('sort-out');
      els.push({ data: { id: outId, label: 'OUTPUT PROCEDURE\n' + n.outputProc,
                         tipo: 'sort-output', target: n.outputProc,
                         col: _sortColAnchor, para: meta.currentPara || '' } });
      els.push({ data: { source: _sortLast, target: outId, label: 'RETURN' } });
      if (depth < meta.maxDepth && !cs.has(n.outputProc)) {
        const _outNs = new Set(cs);
        _outNs.add(n.outputProc);
        meta.currentPara = n.outputProc;
        const _outAst = buildAST(meta.estrutura[n.outputProc] || [],
                                  meta.lineNumMap ? meta.lineNumMap[n.outputProc] : null,
                                  meta.fdMap);
        const [_outF, _outL] = renderSeq(_outAst, els, uid, meta, _outNs, depth + 1);
        if (_outF) { els.push({ data: { source: outId, target: _outF } }); }
        _sortLast = _outL || outId;
      } else {
        _sortLast = outId;
      }
      meta.currentPara = _sortSavedPara;
    }

    return [sortId, _sortLast];
  }

  return [null, null];
}

// ================= GARANTE PLACEHOLDER (nunca chamada) =================
function getFallThroughChain(nome, meta, thruTarget) {
  const { estrutura, tipos, ordemParagrafos } = meta;
  if (!ordemParagrafos || !tipos) return [nome];

  // Section � delimitada � n�o tem fall-through
  if (tipos[nome] === 'section') return [nome];

  let idx = ordemParagrafos.indexOf(nome);
  if (idx < 0) return [nome];

  let chain = [];
  for (let i = idx; i < ordemParagrafos.length; i++) {
    let p = ordemParagrafos[i];
    // Para ao encontrar outra section (boundary)
    if (i > idx && tipos[p] === 'section') break;

    let isExitPar = (estrutura[p] || []).some(l => /^EXIT\.?$/.test(l.trim()));

    // Par�grafos EXIT s�o marcadores de limite � n�o aparecem como n�s visuais
    if (!isExitPar) chain.push(p);

    // Para quando atinge o limite: THRU target especificado, ou par�grafo EXIT
    if ((thruTarget && p === thruTarget) || isExitPar) break;
  }
  return [nome];
}

// ================= DETALHE =================
function montarDetalhe(nome, meta) {
  const { estrutura, tipos, secoes } = meta;
  if (!estrutura[nome]) return nome;
  if (tipos && tipos[nome] === 'section') {
    let pars = secoes[nome] || [];
    let txt = '[SECTION] ' + nome + ':\n\n';
    pars.forEach(p => {
      txt += p + ':\n';
      (estrutura[p] || []).forEach(l => txt += '   ' + l + '\n');
      txt += '\n';
    });
    return txt.trim();
  }
  let txt = '[PARÁGRAFO] ' + nome + ':\n\n';
  (estrutura[nome] || []).forEach(l => txt += '   ' + l + '\n');
  return txt.trim();
}

// ================= FLUXO =================
function gerarFluxo(estrutura, tipos, secoes, meta) {
  let els = [];
  let c = 0;
  function uid(p) { return (p || 'n') + '_' + (++c); }

  const op = meta.ordemParagrafos || [];

  // Prioridade:
  // 1. Par�grafo chamado MAIN
  // 2. Primeiro par�grafo (n�o-section) com conte�do � geralmente � o ponto de entrada
  //    do PROCEDURE DIVISION, que cont�m os PERFORMs para as sections/par�grafos
  // 3. Primeira section (fallback para programas sem par�grafo de entrada expl�cito)
  // 4. Qualquer par�grafo n�o-section
  // 5. Primeira chave
  let temSections = op.some(p => tipos[p] === 'section');
  let main = op.find(p => p === 'MAIN')
          || op.find(p => tipos[p] !== 'section' && tipos[p] !== 'fim-paragrafo' && (estrutura[p] || []).length > 0)
          || (temSections ? op.find(p => tipos[p] === 'section') : null)
          || op.find(p => tipos[p] !== 'section' && tipos[p] !== 'fim-paragrafo')
          || Object.keys(estrutura)[0];
  if (!main) return els;

  // Inicializa contadores de coluna para o layout horizontal por par�grafo
  meta.colCounter    = 0;
  meta.currentCol    = 0;
  meta._ifDepth      = 0;   // guarda de profundidade de IFs aninhados
  meta._renderDepth  = 0;   // guarda absoluta de frames renderSeq ativos

  // Auto-reduz maxDepth SOMENTE no modo "Completo (inteligente)" = value 30.
  // "Tudo (pode ser lento)" = value 999 → usuário quer expandir tudo → respeitado sem redução.
  // Outros valores explícitos (6, 3, 2, 1, 0) → respeitados exatamente.
  var _nPars = op.length;
  var _modoInteligente = (meta.maxDepth === 30); // somente o padrão inteligente
  if (_modoInteligente && _nPars > 30) {
    // Redução automática inteligente para programas grandes
    meta.maxDepth = _nPars <= 80  ? 6   // médio (≤80 parágrafos)
                  : _nPars <= 200 ? 3   // grande (≤200 parágrafos)
                  :                 2;  // muito grande (200+)
  }
  // se value=999 (Tudo): meta.maxDepth=999 → renderNode nunca atinge o limite → expande tudo
  // se value=6/3/2/1/0:  meta.maxDepth inalterado

  meta.currentPara = main;
  let entryId = uid(main);
  els.push({ data: { id: entryId, label: main, tipo: tipos[main] || 'paragrafo', target: main, col: 0, isEntry: true } });
  window._entryNodeId = entryId;

  if (tipos[main] === 'section') {
    // Section como entry point
    let pars = (secoes && secoes[main]) || [];
    let last = entryId;
    let ns = new Set([main]);
    // Primeiro renderiza conte�do direto da section (antes do primeiro sub-par�grafo)
    let secDiretoMain = estrutura[main] || [];
    if (secDiretoMain.length > 0) {
      meta.currentCol = 0;
      let [sfc, slc] = renderSeq(buildAST(secDiretoMain, meta.lineNumMap ? meta.lineNumMap[main] : null, meta.fdMap), els, uid, meta, ns, 0);
      if (sfc) els.push({ data: { source: last, target: sfc } });
      if (slc) last = slc;
    }
    // Depois renderiza sub-par�grafos, pulando marcadores EXIT (fim-paragrafo)
    pars.forEach(par => {
      if (tipos[par] === 'fim-paragrafo') return;
      const _parCol = ++meta.colCounter;
      meta.currentCol = _parCol;
      let pid = uid('sp');
      els.push({ data: { id: pid, label: par, tipo: 'section-para', target: par, col: _parCol } });
      els.push({ data: { source: last, target: pid } });
      let nsLocal = new Set(ns);
      nsLocal.add(par);
      let [fc, lc] = renderSeq(buildAST(estrutura[par] || [], meta.lineNumMap ? meta.lineNumMap[par] : null, meta.fdMap), els, uid, meta, nsLocal, 0);
      if (fc) els.push({ data: { source: pid, target: fc } });
      last = lc || pid;
    });
    meta.currentCol = 0;
  } else {
    let [fc] = renderSeq(buildAST(estrutura[main] || [], meta.lineNumMap ? meta.lineNumMap[main] : null, meta.fdMap), els, uid, meta, new Set([main]), 0);
    if (fc) els.push({ data: { source: entryId, target: fc } });
  }

  return els;
}

// ================= CY =================
let cy;
let _currentMeta = null;   // meta do �ltimo parseCobol � usado pelo listener do textarea
let _ignorarCursorMove = false;  // bloqueia onCursorMove quando o foco vem do diagrama

function desenhar(elements, meta) {
  const estrutura = meta.estrutura;

  // Reseta memória de expand/collapse ao carregar novo programa
  _execExpandState = {};

  if (cy) cy.destroy();

  cy = cytoscape({
    container: document.getElementById("cy"),
    elements,

    // Performance para diagramas grandes
    textureOnViewport: true,
    hideEdgesOnViewport: true,
    motionBlur: true,
    motionBlurOpacity: 0.12,
    pixelRatio: 1,
    wheelSensitivity: 0.3,
    minZoom: 0.05,
    maxZoom: 4,
    boxSelectionEnabled: false,
    selectionType: 'single',
    style: [
      {
        selector: 'node',
        style: {
          'shape': 'round-rectangle',
          'background-color': '#ffffff',
          'border-color': '#b0bec5',
          'border-width': 1.5,
          'label': 'data(label)',
          'text-valign': 'center',
          'text-halign': 'center',
          'font-size': '11.5px',
          'font-family': 'Segoe UI, Arial, sans-serif',
          'color': '#263238',
          'width': 170,
          'height': 38,
          'padding': '8px',
          'text-wrap': 'ellipsis',
          'text-max-width': '155px'
        }
      },
      {
        selector: 'node:selected',
        style: { 'overlay-opacity': 0, 'border-width': 0 }
      },
      {
        selector: 'node.cy-cursor-hl',
        style: {
          'border-width': 3,
          'border-color': '#f57c00',
          'border-style': 'solid',
          'overlay-color': '#f57c00',
          'overlay-opacity': 0.10,
          'overlay-padding': 5
        }
      },
      {
        selector: 'node.cy-flash',
        style: {
          'border-width': 4,
          'border-color': '#ffdd00',
          'border-style': 'solid',
          'overlay-color': '#ffdd00',
          'overlay-opacity': 0.20,
          'overlay-padding': 6
        }
      },
      {
        selector: 'node.cy-has-comment',
        style: { 'border-width': 2, 'border-color': '#ff6f00', 'border-style': 'dashed' }
      },
      {
        selector: 'node.cy-entry-node',
        style: {
          'border-width': 3,
          'border-color': '#1b6b2f',
          'border-style': 'solid',
          'background-color': '#d4edda',
          'color': '#1b4332',
          'font-weight': 700
        }
      },
      /* -- SIMULADOR: nó atual, visitado, breakpoint -- */
      {
        selector: 'node.sim-current',
        style: {
          'overlay-color': '#fbbf24',
          'overlay-opacity': 0.45,
          'overlay-padding': 8,
          'border-width': 3.5,
          'border-color': '#fbbf24',
          'border-style': 'solid',
          'z-index': 999
        }
      },
      {
        selector: 'node.sim-visited',
        style: {
          'opacity': 0.45
        }
      },
      {
        selector: 'node.sim-breakpoint',
        style: {
          'border-width': 3,
          'border-color': '#ef4444',
          'border-style': 'solid',
          'overlay-color': '#ef4444',
          'overlay-opacity': 0.20,
          'overlay-padding': 5
        }
      },
      {
        selector: 'node.sim-breakpoint.sim-current',
        style: {
          'overlay-color': '#fbbf24',
          'overlay-opacity': 0.55,
          'border-color': '#ef4444'
        }
      },
      /* -- PAR�GRAFOS / SE��ES (n�s de chamada) -- */
      {
        selector: 'node[tipo="paragrafo"], node[tipo="perform"]',
        style: {
          'shape': 'round-rectangle',
          'background-color': '#1e3a5f',
          'border-color': '#0d2137',
          'border-width': 0,
          'color': '#ffffff',
          'font-size': '12px',
          'font-weight': 700,
          'width': 175,
          'height': 40
        }
      },
      {
        selector: 'node[tipo="section"], node[tipo="perform-section"]',
        style: {
          'shape': 'round-rectangle',
          'background-color': '#14532d',
          'border-color': '#052e16',
          'border-width': 0,
          'color': '#ffffff',
          'font-size': '12px',
          'font-weight': 700,
          'width': 175,
          'height': 40
        }
      },
      {
        selector: 'node[tipo="section-para"]',
        style: {
          'shape': 'round-rectangle',
          'background-color': '#166534',
          'border-color': '#052e16',
          'border-width': 0,
          'color': '#d1fae5',
          'font-size': '11.5px',
          'font-weight': '600',
          'width': 170,
          'height': 38
        }
      },
      /* -- INSTRU��O / GRUPO -- */
      {
        selector: 'node[tipo="instrucao"]',
        style: {
          'shape': 'round-rectangle',
          'background-color': '#f8fafc',
          'border-color': '#94a3b8',
          'border-width': 1,
          'color': '#334155',
          'font-size': '11px',
          'font-family': 'Cascadia Code, Fira Code, Consolas, monospace',
          'width': 190,
          'height': 32,
          'text-wrap': 'ellipsis',
          'text-max-width': '176px'
        }
      },
      {
        selector: 'node[tipo="grupo"]',
        style: {
          'shape': 'round-rectangle',
          'background-color': '#f1f5f9',
          'border-color': '#64748b',
          'border-width': 1.5,
          'color': '#1e293b',
          'font-size': '11px',
          'font-family': 'Cascadia Code, Fira Code, Consolas, monospace',
          'width': 210,
          'text-wrap': 'wrap',
          'text-max-width': '196px',
          'text-valign': 'center',
          'text-halign': 'center'
        }
      },
      /* -- DESVIO CONDICIONAL -- */
      {
        selector: 'node[tipo="if"]',
        style: {
          'shape': 'diamond',
          'background-color': '#fffbeb',
          'border-color': '#d97706',
          'border-width': 2,
          'color': '#92400e',
          'font-size': '11px',
          'font-family': 'Segoe UI, Arial, sans-serif',
          'width': 170,
          'height': 80,
          'text-wrap': 'wrap',
          'text-max-width': '140px'
        }
      },
      {
        selector: 'node[tipo="merge"]',
        style: {
          'shape': 'ellipse',
          'background-color': '#94a3b8',
          'border-color': '#64748b',
          'border-width': 1,
          'width': 12,
          'height': 12,
          'label': ''
        }
      },
      /* -- LOOP -- */
      {
        selector: 'node[tipo="loop"]',
        style: {
          'shape': 'hexagon',
          'background-color': '#f5f3ff',
          'border-color': '#7c3aed',
          'border-width': 2,
          'color': '#4c1d95',
          'font-size': '11px',
          'font-family': 'Segoe UI, Arial, sans-serif',
          'width': 195,
          'height': 62,
          'text-wrap': 'wrap',
          'text-max-width': '178px',
          'font-weight': '600'
        }
      },
      /* -- I/O (DISPLAY / ACCEPT — genérico) -- */
      {
        selector: 'node[tipo="io"]',
        style: {
          'shape': 'rhomboid',
          'background-color': '#ecfeff',
          'border-color': '#0891b2',
          'border-width': 2,
          'color': '#164e63',
          'font-size': '11px',
          'font-family': 'Cascadia Code, Fira Code, Consolas, monospace',
          'width': 195,
          'height': 38,
          'text-wrap': 'ellipsis',
          'text-max-width': '176px'
        }
      },
      /* -- WRITE / REWRITE — gravação em arquivo sequencial -- */
      {
        selector: 'node[tipo="write"]',
        style: {
          'shape': 'rhomboid',
          'background-color': '#fef9c3',
          'border-color': '#ca8a04',
          'border-width': 2,
          'color': '#78350f',
          'font-size': '11px',
          'font-weight': 700,
          'font-family': 'Cascadia Code, Fira Code, Consolas, monospace',
          'width': 195,
          'height': 52,
          'text-wrap': 'wrap',
          'text-max-width': '176px'
        }
      },
      { selector: 'node[tipo="write"][writeVerb="REWRITE"]',
        style: { 'background-color': '#fdf4ff', 'border-color': '#9333ea', 'color': '#4a044e' } },
      /* -- CALL — subprograma (processo pré-definido: bordas duplas) -- */
      {
        selector: 'node[tipo="call"]',
        style: {
          'shape': 'round-rectangle',
          'background-color': '#eff6ff',
          'border-color': '#1d4ed8',
          'border-width': 3,
          'color': '#1e3a8a',
          'font-size': '11px',
          'font-weight': 700,
          'font-family': 'Cascadia Code, Fira Code, Consolas, monospace',
          'width': 195,
          'min-height': 48,
          'padding': '10px',
          'text-wrap': 'wrap',
          'text-max-width': '176px',
          'border-style': 'double'
        }
      },
      { selector: 'node[tipo="call"][callDynamic="true"]',
        style: { 'background-color': '#f0fdf4', 'border-color': '#15803d', 'color': '#14532d' } },
      /* -- OPEN (Preparação — octógono/cut-rectangle) -- */
      {
        selector: 'node[tipo="open"]',
        style: {
          'shape': 'cut-rectangle',
          'background-color': '#e0f2f1',
          'border-color': '#00695c',
          'border-width': 2.5,
          'color': '#004d40',
          'font-size': '11px',
          'font-family': 'Cascadia Code, Fira Code, Consolas, monospace',
          'font-weight': 700,
          'width': 195,
          'min-height': 44,
          'padding': '12px',
          'text-wrap': 'wrap',
          'text-max-width': '172px'
        }
      },
      /* -- CLOSE (Terminador — ellipse/oval) -- */
      {
        selector: 'node[tipo="close"]',
        style: {
          'shape': 'ellipse',
          'background-color': '#fce4ec',
          'border-color': '#880e4f',
          'border-width': 2.5,
          'color': '#4a0022',
          'font-size': '11px',
          'font-family': 'Cascadia Code, Fira Code, Consolas, monospace',
          'font-weight': 700,
          'width': 195,
          'min-height': 44,
          'padding': '12px',
          'text-wrap': 'wrap',
          'text-max-width': '172px'
        }
      },
      /* -- STOP / GOBACK -- */
      {
        selector: 'node[tipo="stop"]',
        style: {
          'shape': 'round-rectangle',
          'background-color': '#450a0a',
          'border-color': '#7f1d1d',
          'border-width': 0,
          'color': '#fef2f2',
          'font-weight': 700,
          'width': 170,
          'height': 36
        }
      },
      /* -- PERFORM FALL-THROUGH -- */
      {
        selector: 'node[tipo="perform-fall"]',
        style: {
          'background-color': '#fff7ed',
          'border-color': '#c2410c',
          'border-width': 1.5,
          'border-style': 'dashed',
          'color': '#7c2d12'
        }
      },
      /* -- EVALUATE -- */
      {
        selector: 'node[tipo="evaluate"]',
        style: {
          'shape': 'diamond',
          'background-color': '#fdf2f8',
          'border-color': '#a21caf',
          'border-width': 2.5,
          'color': '#701a75',
          'font-size': '10px',
          'font-family': 'Cascadia Code, Fira Code, Consolas, monospace',
          'font-weight': 700,
          'text-wrap': 'wrap',
          'text-max-width': '130px',
          'width': 190,
          'height': 80
        }
      },
      /* =================== MACRO-FLUXO =================== */
      /* -- Início/Fim do programa -- */
      {
        selector: 'node[tipo="macro-start"], node[tipo="macro-end"]',
        style: {
          'shape': 'round-rectangle',
          'border-width': 3,
          'font-size': '12px',
          'font-weight': 700,
          'text-wrap': 'wrap',
          'text-max-width': '160px',
          'width': 180,
          'height': 44
        }
      },
      {
        selector: 'node[tipo="macro-start"]',
        style: {
          'background-color': '#e8f5e9',
          'border-color': '#2e7d32',
          'color': '#1b5e20'
        }
      },
      {
        selector: 'node[tipo="macro-end"]',
        style: {
          'background-color': '#fce4ec',
          'border-color': '#880e4f',
          'color': '#4a0d27'
        }
      },
      /* -- Parágrafos/seções no macro-fluxo (retângulo azul) -- */
      {
        selector: 'node[tipo="macro-process"]',
        style: {
          'shape': 'rectangle',
          'background-color': '#e3f2fd',
          'border-color': '#1565c0',
          'border-width': 2,
          'color': '#0d2b6e',
          'font-size': '11px',
          'font-weight': 700,
          'text-wrap': 'wrap',
          'text-max-width': '160px',
          'width': 180,
          'height': 48
        }
      },
      /* -- Arquivo de entrada: 'tag' = documento com aba, estilo arquivo legado -- */
      {
        selector: 'node[tipo="macro-file-in"]',
        style: {
          'shape': 'tag',
          'background-color': '#e0f7fa',
          'border-color': '#006064',
          'border-width': 2.5,
          'color': '#004d56',
          'font-size': '12px',
          'font-weight': 700,
          'text-halign': 'center',
          'text-valign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': '130px',
          'width': 150,
          'height': 60
        }
      },
      /* -- Arquivo de saída: mesma forma tag, cor laranja -- */
      {
        selector: 'node[tipo="macro-file-out"]',
        style: {
          'shape': 'tag',
          'background-color': '#fff8e1',
          'border-color': '#e65100',
          'border-width': 2.5,
          'color': '#7a2800',
          'font-size': '12px',
          'font-weight': 700,
          'text-halign': 'center',
          'text-valign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': '130px',
          'width': 150,
          'height': 60
        }
      },
      /* -- Arquivo I-O: tag roxo (leitura e escrita) -- */
      {
        selector: 'node[tipo="macro-file-io"]',
        style: {
          'shape': 'tag',
          'background-color': '#f3e5f5',
          'border-color': '#6a1b9a',
          'border-width': 2.5,
          'color': '#380060',
          'font-size': '12px',
          'font-weight': 700,
          'text-halign': 'center',
          'text-valign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': '130px',
          'width': 150,
          'height': 60
        }
      },
      /* -- Seção de I/O no macro-fluxo (cabeçalho de grupo) -- */
      {
        selector: 'node[tipo="macro-io-hdr"]',
        style: {
          'shape': 'round-rectangle',
          'background-color': '#f1f5fd',
          'border-color': '#90a4ae',
          'border-width': 1.5,
          'border-style': 'dashed',
          'color': '#37474f',
          'font-size': '10px',
          'font-style': 'italic',
          'text-wrap': 'wrap',
          'text-max-width': '140px',
          'width': 160,
          'height': 36
        }
      },
      /* -- Tabela de entrada (SELECT) = cilindro azul -- */
      {
        selector: 'node[tipo="macro-table-in"]',
        style: {
          'shape': 'barrel',
          'background-color': '#e3f2fd',
          'border-color': '#1565c0',
          'border-width': 2.5,
          'color': '#0d2b6e',
          'font-size': '11px',
          'font-weight': 700,
          'text-halign': 'center',
          'text-valign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': '130px',
          'width': 150,
          'height': 60
        }
      },
      /* -- Tabela de saída (INSERT/UPDATE/DELETE) = cilindro vermelho -- */
      {
        selector: 'node[tipo="macro-table-out"]',
        style: {
          'shape': 'barrel',
          'background-color': '#fce4ec',
          'border-color': '#c62828',
          'border-width': 2.5,
          'color': '#7f0000',
          'font-size': '11px',
          'font-weight': 700,
          'text-halign': 'center',
          'text-valign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': '130px',
          'width': 150,
          'height': 60
        }
      },
      /* -- Tabela de entrada (SELECT) = cilindro azul -- */
      {
        selector: 'node[tipo="macro-table-in"]',
        style: {
          'shape': 'barrel',
          'background-color': '#e3f2fd',
          'border-color': '#1565c0',
          'border-width': 2.5,
          'color': '#0d2b6e',
          'font-size': '11px',
          'font-weight': 700,
          'text-halign': 'center',
          'text-valign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': '130px',
          'width': 150,
          'height': 60
        }
      },
      /* -- Tabela de saída (INSERT/UPDATE/DELETE) = cilindro vermelho -- */
      {
        selector: 'node[tipo="macro-table-out"]',
        style: {
          'shape': 'barrel',
          'background-color': '#fce4ec',
          'border-color': '#c62828',
          'border-width': 2.5,
          'color': '#7f0000',
          'font-size': '11px',
          'font-weight': 700,
          'text-halign': 'center',
          'text-valign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': '130px',
          'width': 150,
          'height': 60
        }
      },
      { selector: 'node[tipo="macro-table-out"][tableOp="INSERT"]', style: { 'background-color': '#e8f5e9', 'border-color': '#2e7d32', 'color': '#1b5e20' } },
      { selector: 'node[tipo="macro-table-out"][tableOp="UPDATE"]', style: { 'background-color': '#fff8e1', 'border-color': '#f57f17', 'color': '#e65100' } },
      { selector: 'node[tipo="macro-table-out"][tableOp="DELETE"]', style: { 'background-color': '#fce4ec', 'border-color': '#c62828', 'color': '#7f0000' } },
      /* =================== FIM MACRO-FLUXO =================== */
      /* -- GO TO -- */
      {
        selector: 'node[tipo="goto"]',
        style: {
          'shape': 'round-rectangle',
          'background-color': '#3b0764',
          'border-color': '#2e1065',
          'border-width': 0,
          'color': '#e9d5ff',
          'font-size': '11.5px',
          'font-weight': 700,
          'font-family': 'Segoe UI, Arial, sans-serif',
          'width': 185,
          'height': 38
        }
      },
      /* -- SQL -- */
      {
        selector: 'node[tipo="sql"]',
        style: {
          'shape': 'barrel',
          'background-color': '#1e293b',
          'border-color': '#0f172a',
          'border-width': 1,
          'color': '#e2e8f0',
          'font-size': '11px',
          'font-weight': 700,
          'font-family': 'Cascadia Code, Fira Code, Consolas, monospace',
          'width': 185,
          'height': 68,
          'text-wrap': 'wrap',
          'text-max-width': '172px'
        }
      },
      { selector: 'node[tipo="sql"][sqlOp="SELECT"]',        style: { 'background-color': '#1d4ed8', 'border-color': '#1e3a8a' } },
      { selector: 'node[tipo="sql"][sqlOp="INSERT"]',        style: { 'background-color': '#15803d', 'border-color': '#14532d' } },
      { selector: 'node[tipo="sql"][sqlOp="UPDATE"]',        style: { 'background-color': '#c2410c', 'border-color': '#7c2d12' } },
      { selector: 'node[tipo="sql"][sqlOp="DELETE"]',        style: { 'background-color': '#b91c1c', 'border-color': '#7f1d1d' } },
      /* -- Cursor SQL: DECLARE / OPEN / FETCH / CLOSE -- */
      { selector: 'node[tipo="sql"][sqlOp="CURSOR-DECLARE"]', style: { 'background-color': '#5b21b6', 'border-color': '#3b0764', 'color': '#ede9fe' } },
      { selector: 'node[tipo="sql"][sqlOp="CURSOR-OPEN"]',    style: { 'background-color': '#0e7490', 'border-color': '#164e63', 'color': '#cffafe' } },
      { selector: 'node[tipo="sql"][sqlOp="CURSOR-FETCH"]',   style: { 'background-color': '#92400e', 'border-color': '#78350f', 'color': '#fef3c7' } },
      { selector: 'node[tipo="sql"][sqlOp="CURSOR-CLOSE"]',   style: { 'background-color': '#374151', 'border-color': '#1f2937', 'color': '#f3f4f6' } },
      /* -- COPY / INCLUDE (módulo externo / copybook) -- */
      {
        selector: 'node[tipo="copy"]',
        style: {
          'shape': 'round-rectangle',
          'background-color': '#3d1d00',
          'border-color': '#d97706',
          'border-width': 2.5,
          'border-style': 'dashed',
          'color': '#fef3c7',
          'font-size': '11.5px',
          'font-weight': 700,
          'font-family': 'Segoe UI, Arial, sans-serif',
          'width': 185,
          'height': 48,
          'text-wrap': 'wrap',
          'text-max-width': '172px'
        }
      },
      /* -- SEARCH / SEARCH ALL — busca em tabela interna -------- */
      {
        selector: 'node[tipo="search"]',
        style: {
          'shape': 'round-rectangle',
          'background-color': '#431407',
          'border-color': '#f97316',
          'border-width': 2.5,
          'color': '#fed7aa',
          'font-size': '11px',
          'font-weight': 700,
          'font-family': 'Cascadia Code, Fira Code, Consolas, monospace',
          'width': 195,
          'min-height': 48,
          'padding': '10px',
          'text-wrap': 'wrap',
          'text-max-width': '176px'
        }
      },
      { selector: 'node[tipo="search"][searchAll="true"]',
        style: { 'background-color': '#3b0764', 'border-color': '#c084fc', 'color': '#e9d5ff' } },
      /* -- SORT principal (losango oblongo) -------------------- */
      {
        selector: 'node[tipo="sort"]',
        style: {
          'shape': 'round-rectangle',
          'background-color': '#042f2e',
          'border-color': '#0d9488',
          'border-width': 3,
          'color': '#99f6e4',
          'font-size': '11px',
          'font-weight': 700,
          'font-family': 'Cascadia Code, Fira Code, Consolas, monospace',
          'width': 200,
          'min-height': 52,
          'padding': '12px',
          'text-wrap': 'wrap',
          'text-max-width': '180px'
        }
      },
      /* -- INPUT PROCEDURE do SORT (trapézio esquerdo) --------- */
      {
        selector: 'node[tipo="sort-input"]',
        style: {
          'shape': 'rhomboid',
          'background-color': '#083344',
          'border-color': '#38bdf8',
          'border-width': 2,
          'color': '#bae6fd',
          'font-size': '11px',
          'font-weight': 700,
          'font-family': 'Cascadia Code, Fira Code, Consolas, monospace',
          'width': 200,
          'min-height': 48,
          'padding': '10px',
          'text-wrap': 'wrap',
          'text-max-width': '180px'
        }
      },
      /* -- ENGINE SORT (cilindro): representa DFSORT/SYNCSORT -- */
      {
        selector: 'node[tipo="sort-engine"]',
        style: {
          'shape': 'barrel',
          'background-color': '#14532d',
          'border-color': '#22c55e',
          'border-width': 2,
          'color': '#bbf7d0',
          'font-size': '11px',
          'font-weight': 700,
          'font-family': 'Segoe UI, Arial, sans-serif',
          'width': 200,
          'height': 60,
          'text-wrap': 'wrap',
          'text-max-width': '180px'
        }
      },
      /* -- OUTPUT PROCEDURE do SORT (trapézio direito) --------- */
      {
        selector: 'node[tipo="sort-output"]',
        style: {
          'shape': 'rhomboid',
          'background-color': '#2d1657',
          'border-color': '#a78bfa',
          'border-width': 2,
          'color': '#ede9fe',
          'font-size': '11px',
          'font-weight': 700,
          'font-family': 'Cascadia Code, Fira Code, Consolas, monospace',
          'width': 200,
          'min-height': 48,
          'padding': '10px',
          'text-wrap': 'wrap',
          'text-max-width': '180px'
        }
      },
      /* -- ARESTAS -- */
      {
        selector: 'edge',
        style: {
          'target-arrow-shape': 'triangle',
          'target-arrow-color': '#64748b',
          'line-color': '#94a3b8',
          'width': 1.5,
          'curve-style': 'taxi',
          'taxi-direction': 'downward',
          'taxi-turn': 30,
          'taxi-turn-min-distance': 10,
          'label': 'data(label)',
          'font-size': '10.5px',
          'font-family': 'Segoe UI, Arial, sans-serif',
          'font-weight': 700,
          'color': '#b45309',
          'text-background-color': '#fffbeb',
          'text-background-opacity': 1,
          'text-background-padding': '3px',
          'text-border-color': '#fcd34d',
          'text-border-width': 1,
          'text-border-opacity': 1
        }
      },
      {
        selector: 'edge[label]',
        style: {
          'line-color': '#f59e0b',
          'target-arrow-color': '#d97706',
          'width': 2,
          'curve-style': 'bezier'
        }
      }
    ],

    layout: { name: 'preset' }  // posi��es aplicadas logo abaixo via _rodarLayout()
  });

  // Executa o layout dagre protegido por try-catch (veja _rodarLayout).
  _rodarLayout();

  // Para modo horizontal: primeiro ajusta loops (em TB), depois rotaciona tudo 90�.
  // Para demais modos: apenas ajusta loops no eixo vertical.
  var _layoutModo = ((document.getElementById('layout-select') || {}).value || 'tb');
  var _isMacro    = ((document.getElementById('view-select')   || {}).value === 'macro');
  if (_isMacro) {
    aplicarLayoutMacro();
  } else if (_layoutModo === 'lr') {
    if (cy.nodes().length <= 800) aplicarPosLayoutLoop();
    aplicarLayoutColunas();
    if (cy.edges().length <= 2000) _ajustarArestasLongas();
  } else {
    if (cy.nodes().length <= 800) aplicarPosLayoutLoop();
    if (cy.edges().length <= 2000) _ajustarArestasLongas();
  }

  // Zoom inicial inteligente:
  // Se o diagrama for muito grande, usa zoom fixo para n�o esmagar os n�s;
  // caso contr�rio, fit para caber na tela confortavelmente.
  // Em ambos os casos, posiciona a view mostrando o PRIMEIRO n� (entrada do fluxo).
  (function zoomInicial() {
    var bb = cy.elements().boundingBox();
    var cw = cy.width();  var ch = cy.height();
    var zoomFitW = (cw - 100) / (bb.w || 1);
    var zoomFitH = (ch - 100) / (bb.h || 1);
    var zoomFitAll = Math.min(zoomFitW, zoomFitH);

    // N� de entrada: o que tem menor Y (topo do fluxo)
    var firstNode = cy.nodes().filter(function(n){
      return n.data('tipo') !== 'merge';
    }).min(function(n){ return n.position().y; }).ele;

    if (zoomFitAll >= 0.6) {
      // Diagrama pequeno: fit normal, depois posiciona o primeiro n� no topo
      cy.fit(undefined, 50);
      if (firstNode && firstNode.length) {
        cy.animate({
          zoom: Math.min(cy.zoom(), 1.0),
          center: { eles: firstNode }
        }, { duration: 250 });
      }
    } else {
      // Diagrama grande: zoom 0.6, posiciona o primeiro n� no topo-centro da tela
      var zoom0 = 0.6;
      cy.zoom(zoom0);
      if (firstNode && firstNode.length) {
        var fp = firstNode.renderedPosition();
        cy.panBy({
          x: (cw / 2) - fp.x,
          y: 60 - fp.y
        });
      } else {
        cy.center();
      }
    }
    atualizarZoomLabel();
  })();

  atualizarZoomLabel();

  // Marca o n� de entrada com classe visual e habilita o bot�o In�cio
  (function marcarEntrada() {
    var entryNode = cy.getElementById(window._entryNodeId || '');
    if (entryNode && entryNode.length) {
      entryNode.addClass('cy-entry-node');
    }
    var btnI = document.getElementById('btn-inicio');
    if (btnI) btnI.disabled = false;
  })();

  cy.on("zoom", function() { atualizarZoomLabel(); });

  // ---- Cursores: mãozinha no canvas, pointer nos nós ----
  var cyContainer = document.getElementById('cy');
  cy.on('mouseover', 'node', function() { cyContainer.style.cursor = 'pointer'; });
  cy.on('mouseout',  'node', function() { cyContainer.style.cursor = 'grab'; });
  cy.on('grab',      'node', function() { cyContainer.style.cursor = 'grabbing'; });
  cy.on('free',      'node', function() { cyContainer.style.cursor = 'grab'; });
  cy.on('mousedown', function(evt) { if (evt.target === cy) cyContainer.style.cursor = 'grabbing'; });
  cy.on('mouseup',   function(evt) { if (evt.target === cy) cyContainer.style.cursor = 'grab'; });

  // ---- Performance durante pan: oculta labels para arrastar mais leve ----
  var _panTimer = null;
  cy.on('viewport', function() {
    if (_panTimer) clearTimeout(_panTimer);
    cy.batch(function() {
      cy.nodes().style({ 'label': '' });
      cy.edges().style({ 'label': '' });
    });
    _panTimer = setTimeout(function() {
      cy.batch(function() {
        cy.nodes().style({ 'label': 'data(label)' });
        cy.edges().style({ 'label': 'data(label)' });
      });
    }, 120);
  });
  // -------------------------------------------------------

  cy.on("tap", "node", function(evt) {
    let data = evt.target.data();
    let el = document.getElementById("details");
    if (data.target && meta.estrutura && meta.estrutura[data.target]) {
      el.innerText = montarDetalhe(data.target, meta);
    } else if (data.tipo === 'instrucao' || data.tipo === 'grupo' || data.tipo === 'if' || data.tipo === 'stop'
            || data.tipo === 'loop'     || data.tipo === 'io'   || data.tipo === 'evaluate'
            || data.tipo === 'goto'     || data.tipo === 'sql'  || data.tipo === 'write'
            || data.tipo === 'call'
            || data.tipo === 'open'     || data.tipo === 'close') {
      el.innerText = data.detail || data.label || '';
    } else if (data.tipo && data.tipo.startsWith('macro-')) {
      // Nós do macro-fluxo: mostra info do arquivo/parágrafo
      if (data.fileName) {
        el.innerText = 'Arquivo: ' + data.fileName + '\nModo: ' + (data.fileMode || '?');
      } else if (data.para) {
        el.innerText = montarDetalhe(data.para, meta);
      } else {
        el.innerText = data.label || '';
      }
    } else {
      el.innerHTML = '<span style="color:#aaa;font-size:11px;">Clique em um nó para ver detalhes</span>';
    }
    // Remove destaque do cursor (ser� reaplicado quando cursor mover no textarea)
    cy.elements().removeClass('cy-cursor-hl');
    if (window._resetLastPara) window._resetLastPara();
    destacarNoCobol(data);
    // Atualiza painel de coment�rios (se estiver aberto)
    if (window.abrirComentarioPorNo) {
      var nodeId    = data.id;
      var nodeLabel = data.label || data.target || data.id;
      window.abrirComentarioPorNo(nodeId, nodeLabel);
    }
  });

  // Clique em �rea vazia do diagrama: limpa destaque sem mover nada
  cy.on('tap', function(evt) {
    if (evt.target === cy) {
      cy.elements().removeClass('cy-cursor-hl');
      if (window._resetLastPara) window._resetLastPara();
    }
  });
}

// ================= MACRO-FLUXO =================
// Gera um diagrama de alto nível mostrando:
//   arquivos de entrada → sequência de parágrafos principais → arquivos de saída
function gerarMacroFluxo(meta) {
  var estrutura       = meta.estrutura;
  var tipos           = meta.tipos;
  var ordemParagrafos = meta.ordemParagrafos;
  if (!ordemParagrafos || !ordemParagrafos.length) return [];

  // ── 1. Coletar arquivos abertos em todo o PROCEDURE DIVISION
  // Mapa: nome-arquivo → 'INPUT' | 'OUTPUT' | 'I-O' | 'EXTEND'
  var fileMap   = {};  // nome → modo final
  var fileOrder = [];  // preserva ordem de aparição

  ordemParagrafos.forEach(function(nome) {
    if (tipos[nome] === 'fim-paragrafo') return;
    var linhasP = estrutura[nome] || [];
    for (var li = 0; li < linhasP.length; li++) {
      var up0 = linhasP[li].trim().toUpperCase().replace(/\.$/, '');
      if (!/^OPEN\b/.test(up0)) continue;
      // Coleta tokens desta linha + linhas de continuação
      var allParts = up0.replace(/^OPEN\s+/, '').split(/\s+/);
      li++;
      while (li < linhasP.length) {
        var nxtUp = linhasP[li].trim().toUpperCase().replace(/\.$/, '');
        if (!nxtUp || (!/^(INPUT|OUTPUT|I-O|EXTEND)\b/.test(nxtUp) && !/^[A-Z][A-Z0-9-]+$/.test(nxtUp))) break;
        allParts = allParts.concat(nxtUp.split(/\s+/));
        li++;
      }
      li--; // o for irá incrementar
      var mode = null;
      allParts.forEach(function(tok) {
        if (tok === 'INPUT' || tok === 'OUTPUT' || tok === 'I-O' || tok === 'EXTEND') {
          mode = tok;
        } else if (mode && /^[A-Z][A-Z0-9-]*$/.test(tok)) {
          if (!fileMap[tok]) {
            fileMap[tok] = mode;
            fileOrder.push(tok);
          }
        }
      });
    }
  });

  // ── 1b. Coletar tabelas SQL de todos os parágrafos
  //    SELECT / DECLARE CURSOR → entrada (col 0)  |  INSERT/UPDATE/DELETE → saída (col 2)
  var tableIn       = {};
  var tableInOrder  = [];
  var tableInParaList = {};  // tbl → [parágrafos que lêem]
  // saída: um registro por (parágrafo × tabela × operação) — cada um gera bloco separado
  var tableOutWriters = [];  // [{tbl, op, para}, ...]
  var tableOutSeen    = {};  // "para|tbl|op" → true  (dedup)
  ordemParagrafos.forEach(function(nome) {
    if (tipos[nome] === 'fim-paragrafo') return;
    var paraText = (estrutura[nome] || []).join(' ').toUpperCase();
    var sqlRe = /EXEC\s+SQL\s+([\s\S]*?)END-EXEC/g;
    var m;
    while ((m = sqlRe.exec(paraText)) !== null) {
      var body = m[1].replace(/\s+/g, ' ').trim();
      var opM = body.match(/^([A-Z]+)/);
      var sqlOp = opM ? opM[1] : '';
      var tbl = '';
      var tM;
      var _wk;

      if (sqlOp === 'SELECT') {
        tM = body.match(/\bFROM\s+([A-Z][A-Z0-9_#@$.]*)/);
        if (!tM) tM = body.match(/\bJOIN\s+([A-Z][A-Z0-9_#@$.]*)/);
        tbl = tM ? tM[1] : '';
        if (tbl) {
          if (!tableIn[tbl]) { tableIn[tbl] = true; tableInOrder.push(tbl); tableInParaList[tbl] = []; }
          tableInParaList[tbl].push(nome);
        }

      } else if (sqlOp === 'DECLARE' && /\bCURSOR\b/.test(body)) {
        tM = body.match(/\bFROM\s+([A-Z][A-Z0-9_#@$.]*)/);
        if (!tM) tM = body.match(/\bJOIN\s+([A-Z][A-Z0-9_#@$.]*)/);
        tbl = tM ? tM[1] : '';
        if (tbl) {
          if (!tableIn[tbl]) { tableIn[tbl] = true; tableInOrder.push(tbl); tableInParaList[tbl] = []; }
          tableInParaList[tbl].push(nome);
        }

      } else if (sqlOp === 'INSERT') {
        tM = body.match(/^INSERT\s+INTO\s+([A-Z][A-Z0-9_#@$.]*)/);
        tbl = tM ? tM[1] : '';
        if (tbl) {
          _wk = nome + '|' + tbl + '|INSERT';
          if (!tableOutSeen[_wk]) { tableOutSeen[_wk] = true; tableOutWriters.push({ tbl: tbl, op: 'INSERT', para: nome }); }
        }

      } else if (sqlOp === 'UPDATE') {
        tM = body.match(/^UPDATE\s+([A-Z][A-Z0-9_#@$.]*)/);
        tbl = tM ? tM[1] : '';
        if (tbl) {
          _wk = nome + '|' + tbl + '|UPDATE';
          if (!tableOutSeen[_wk]) { tableOutSeen[_wk] = true; tableOutWriters.push({ tbl: tbl, op: 'UPDATE', para: nome }); }
        }

      } else if (sqlOp === 'DELETE') {
        tM = body.match(/^DELETE\s+FROM\s+([A-Z][A-Z0-9_#@$.]*)/);
        if (!tM) tM = body.match(/^DELETE\s+([A-Z][A-Z0-9_#@$.]*)/);
        tbl = tM ? tM[1] : '';
        if (tbl) {
          _wk = nome + '|' + tbl + '|DELETE';
          if (!tableOutSeen[_wk]) { tableOutSeen[_wk] = true; tableOutWriters.push({ tbl: tbl, op: 'DELETE', para: nome }); }
        }
      }
    }
  });

  // ── 2. Sequência principal de parágrafos (segue PERFORMs da entrada, 1 nível)
  var entryName = null;
  for (var _ei = 0; _ei < ordemParagrafos.length; _ei++) {
    var _en = ordemParagrafos[_ei];
    if (tipos[_en] !== 'fim-paragrafo' && estrutura[_en] && estrutura[_en].length) {
      entryName = _en;
      break;
    }
  }
  if (!entryName) return [];

  var mainSeq  = [];
  var _visited = {};

  function _collect(nome) {
    if (_visited[nome] || !estrutura[nome]) return;
    _visited[nome] = true;
    mainSeq.push(nome);
    (estrutura[nome] || []).forEach(function(linha) {
      var up = linha.trim().toUpperCase().replace(/\.$/, '');
      var m  = up.match(/^PERFORM\s+([A-Z][A-Z0-9-]*)/);
      if (m && estrutura[m[1]] && !_visited[m[1]]) _collect(m[1]);
    });
  }
  _collect(entryName);

  // ── 3. Separar arquivos por modo
  var filesIn  = fileOrder.filter(function(f) { return fileMap[f] === 'INPUT'; });
  var filesOut = fileOrder.filter(function(f) { return fileMap[f] === 'OUTPUT' || fileMap[f] === 'EXTEND'; });
  var filesIO  = fileOrder.filter(function(f) { return fileMap[f] === 'I-O'; });

  // ── 4. Três colunas:
  //    col 0 (esquerda)  = arquivos de entrada → seta → 1º programa
  //    col 1 (centro)    = programas encadeados verticalmente
  //    col 2 (direita)   = último programa → seta → arquivos de saída
  var els  = [];
  var _cnt = 0;

  function _node(tipo, label, col, extra) {
    var id = 'm_' + (++_cnt);
    els.push({ data: Object.assign({ id: id, label: label, tipo: tipo, col: col }, extra || {}) });
    return id;
  }
  function _edge(src, tgt) {
    els.push({ data: { source: src, target: tgt } });
  }

  // Programas (col 1) encadeados verticalmente
  var firstProcId = null;
  var lastProcId  = null;
  var procIdMap   = {};  // nome → id do nó
  mainSeq.forEach(function(nome) {
    var icon = tipos[nome] === 'section' ? '\u00a7 ' : '';
    var pid  = _node('macro-process', icon + nome, 1, { para: nome });
    procIdMap[nome] = pid;
    if (lastProcId) _edge(lastProcId, pid);
    if (!firstProcId) firstProcId = pid;
    lastProcId = pid;
  });

  // Arquivos de entrada (col 0) → apontam para o 1º programa
  if (firstProcId) {
    filesIn.forEach(function(f) {
      var fid = _node('macro-file-in', f, 0, { fileMode: 'INPUT', fileName: f });
      _edge(fid, firstProcId);
    });
    filesIO.forEach(function(f) {
      var fid = _node('macro-file-io', f, 0, { fileMode: 'I-O', fileName: f });
      _edge(fid, firstProcId);
    });
    // Tabelas SELECT/DECLARE CURSOR → cada parágrafo que lê
    tableInOrder.forEach(function(t) {
      var readers = tableInParaList[t] || [];
      var fid = _node('macro-table-in', 'SELECT\n' + t, 0, { tableOp: 'SELECT', tableName: t, para: readers[0] || null, detail: 'FROM ' + t });
      if (readers.length > 0) {
        readers.forEach(function(para) {
          var tgtId = (procIdMap[para]) ? procIdMap[para] : firstProcId;
          _edge(fid, tgtId);
        });
      } else {
        _edge(fid, firstProcId);
      }
    });
  }

  // Arquivos de saída (col 2) ← parágrafo que faz WRITE
  if (lastProcId) {
    // Arquivos OUTPUT/EXTEND: um nó por (parágrafo × arquivo) via scanner WRITE
    // Se não houver WRITE detectado para um arquivo, usa lastProcId como fallback
    filesOut.forEach(function(f) {
      var fid = _node('macro-file-out', f, 2, { fileMode: 'OUTPUT', fileName: f });
      _edge(lastProcId, fid);
    });
    filesIO.forEach(function(f) {
      var fid = _node('macro-file-io', f, 2, { fileMode: 'I-O', fileName: f });
      _edge(lastProcId, fid);
    });
    // Tabelas — um bloco separado por (parágrafo × tabela × operação)
    tableOutWriters.forEach(function(entry) {
      var opDetail = entry.op === 'INSERT' ? ('INSERT INTO ' + entry.tbl) :
                     entry.op === 'UPDATE' ? ('UPDATE ' + entry.tbl) :
                     ('DELETE FROM ' + entry.tbl);
      var fid = _node('macro-table-out', entry.op + '\n' + entry.tbl, 2, { tableOp: entry.op, tableName: entry.tbl, para: entry.para, detail: opDetail });
      var srcId = (procIdMap[entry.para]) ? procIdMap[entry.para] : lastProcId;
      _edge(srcId, fid);
    });
  }

  return els;
}

// ================= RUN =================

// ================= DESTAQUE NO COBOL INPUT =================
/**
 * Ao clicar num n� do diagrama, localiza o trecho correspondente
 * na textarea e seleciona + rola at� ele.
 */
// Retorna {start, end} em char-offset do par�grafo 'nome' no c�digo
function _rangeParagrafo(linhas, nome) {
  var paraStart = -1;
  var paraEnd   = -1;
  var charPos = 0;
  var inBlock = false;
  for (var i = 0; i < linhas.length; i++) {
    var lineUp = linhas[i].trim().toUpperCase().replace(/\.$/, '');
    if (!inBlock) {
      if (lineUp === nome) { paraStart = charPos; inBlock = true; }
    } else {
      if (lineUp && /^[A-Z][A-Z0-9-]{2,}$/.test(lineUp)) { paraEnd = charPos; break; }
    }
    charPos += linhas[i].length + 1;
  }
  if (paraStart >= 0 && paraEnd < 0) paraEnd = charPos;
  return { start: paraStart, end: paraEnd };
}

function destacarNoCobol(data) {
  const ta = document.getElementById('input');
  if (!ta) return;
  const code = ta.value;
  const linhas = code.split('\n');

  let searchKey = '';
  let paraMode  = false;
  let parentPara = data.para || null;  // par�grafo-pai do n� (evita falsos positivos)

  // ── Atalho: usa srcLine diretamente (linha exata no c�digo fonte) ──
  if (!paraMode && data.srcLine != null) {
    var _cPos = 0;
    for (var _si = 0; _si < data.srcLine; _si++) {
      _cPos += (linhas[_si] || '').length + 1;
    }
    // Para blocos multi-linha (EXEC SQL, STRING, PERFORM inline etc.) avança
    // até encontrar END-EXEC / END-STRING / END-PERFORM / END-EVALUATE ou '.'.
    var _firstLineUp = (linhas[data.srcLine] || '').trim().toUpperCase();
    var _isExecSQL   = /^EXEC\s+SQL\b/.test(_firstLineUp);
    var _ePos;
    if (_isExecSQL) {
      // Avança linha a linha até END-EXEC ou ponto final
      var _blkPos = _cPos;
      var _blkLine = data.srcLine;
      while (_blkLine < linhas.length) {
        var _bl = (linhas[_blkLine] || '').trim();
        _blkPos += (linhas[_blkLine] || '').length + 1;
        _blkLine++;
        if (/^END-EXEC\b/i.test(_bl.replace(/\.$/, '')) || _bl.endsWith('.')) break;
      }
      _ePos = _blkPos - 1;  // inclui END-EXEC mas não o \n seguinte
    } else {
      var _nlEnd = code.indexOf('\n', _cPos);
      _ePos = _nlEnd >= 0 ? _nlEnd : code.length;
    }
    _ignorarCursorMove = true;
    ta.focus();
    ta.setSelectionRange(_cPos, _ePos);
    setTimeout(function() { _ignorarCursorMove = false; }, 100);
    var _lh = ta.scrollHeight / Math.max((code.match(/\n/g)||[]).length + 1, 1);
    ta.scrollTop = Math.max(0, (data.srcLine * _lh) - (ta.clientHeight / 2) + (_lh / 2));
    ta.style.transition = 'box-shadow 0.1s';
    ta.style.boxShadow = '0 0 0 3px #1565c0';
    clearTimeout(ta._flashTimer);
    ta._flashTimer = setTimeout(function() { ta.style.boxShadow = ''; setTimeout(function() { ta.style.transition = ''; }, 200); }, 500);
    return;
  }

  if (data.target) {
    searchKey = data.target.trim().toUpperCase();
    paraMode  = true;
    parentPara = null; // para modo busca o pr�prio cabe�alho � sem restri��o
  } else if (data.detail) {
    const detailLines = data.detail.split('\n').map(function(s){ return s.trim(); }).filter(Boolean);
    // Se a primeira linha é apenas "EXEC SQL" (genérico), usa a segunda linha para
    // evitar bater em "EXEC SQL INCLUDE SQLCA END-EXEC" na WORKING-STORAGE
    var fl = (detailLines[0] || '').toUpperCase();
    if (/^EXEC\s+SQL$/i.test(fl) && detailLines[1]) {
      searchKey = detailLines[1].toUpperCase();
    } else {
      searchKey = fl;
    }
  } else if (data.label) {
    searchKey = data.label.trim().toUpperCase().replace(/\.$/, '').replace(/\.\.\.$/, '').trim();
  }

  if (!searchKey) return;

  // --- Restringe busca ao par�grafo-pai quando dispon�vel ---
  var searchFrom = 0;
  var searchTo   = code.length;
  if (!paraMode && parentPara) {
    var rng = _rangeParagrafo(linhas, parentPara);
    if (rng.start >= 0) { searchFrom = rng.start; searchTo = rng.end; }
  }

  // --- Localiza a linha no textarea ---
  var startChar = -1;
  var charPos = 0;

  for (var i = 0; i < linhas.length; i++) {
    var lineStart = charPos;
    charPos += linhas[i].length + 1;
    if (lineStart < searchFrom || lineStart >= searchTo) continue;
    var lineUp = linhas[i].trim().toUpperCase().replace(/\.$/, '');
    if (paraMode) {
      if (lineUp === searchKey) { startChar = lineStart; break; }
    } else {
      var probe = searchKey.substring(0, 30);
      if (lineUp.startsWith(probe)) { startChar = lineStart; break; }
      // Fallback: probe completo com indexOf (evita falsos positivos entre nomes parecidos)
      if (probe.length > 6 && lineUp.indexOf(probe) !== -1) { startChar = lineStart; break; }
    }
  }

  // Fallback global: se n�o achou no par�grafo, busca no c�digo inteiro
  if (startChar === -1 && !paraMode && parentPara) {
    charPos = 0;
    for (var ii = 0; ii < linhas.length; ii++) {
      var ls2 = charPos;
      charPos += linhas[ii].length + 1;
      var lu2 = linhas[ii].trim().toUpperCase().replace(/\.$/, '');
      var pr2 = searchKey.substring(0, 30);
      if (lu2.startsWith(pr2)) { startChar = ls2; break; }
      if (pr2.length > 6 && lu2.indexOf(pr2) !== -1) { startChar = ls2; break; }
    }
  }

  if (startChar === -1) return;

  // --- Determina o fim da sele��o ---
  var endChar;

  if (paraMode) {
    // Seleciona at� antes do pr�ximo cabe�alho de par�grafo/se��o
    var cp2 = 0;
    var inBlock = false;
    endChar = code.length;
    for (var j = 0; j < linhas.length; j++) {
      if (cp2 >= startChar) {
        if (!inBlock) { inBlock = true; }
        else {
          var t = linhas[j].trim().toUpperCase().replace(/\.$/, '');
          // Linha de cabe�alho: palavra de 3+ chars, apenas letras/d�gitos/h�fen,
          // na coluna 7-8 (COBOL), sem verbo no in�cio
          if (t && /^[A-Z][A-Z0-9-]{2,}$/.test(t)) { endChar = cp2; break; }
        }
      }
      cp2 += linhas[j].length + 1;
    }
  } else {
    // Instru��o: seleciona quantas linhas tiver o detail
    var nDetailLines = data.detail ? data.detail.split('\n').length : 1;
    var pos = startChar;
    for (var k = 0; k < nDetailLines && pos < code.length; k++) {
      var nl = code.indexOf('\n', pos);
      if (nl === -1) { pos = code.length; break; }
      pos = nl + 1;
    }
    endChar = pos;
  }

  // --- Aplica sele��o e rola o textarea para centralizar o trecho ---
  // Sinaliza que o foco/clique seguinte no textarea � program�tico (n�o do usu�rio)
  _ignorarCursorMove = true;
  ta.focus();
  ta.setSelectionRange(startChar, endChar);
  // Libera o flag ap�s os eventos de foco/click serem processados
  setTimeout(function() { _ignorarCursorMove = false; }, 100);

  // Calcula linha alvo a partir do offset inicial
  var beforeSel = code.substring(0, startChar);
  var lineNum = (beforeSel.match(/\n/g) || []).length;
  var totalLines = (code.match(/\n/g) || []).length + 1;

  // Usa scrollHeight real da textarea (mais confi�vel do que getComputedStyle)
  var lh = ta.scrollHeight / Math.max(totalLines, 1);
  var targetScroll = Math.max(0, (lineNum * lh) - (ta.clientHeight / 2) + (lh / 2));

  // Aplica scroll imediatamente
  ta.scrollTop = targetScroll;

  // Flash visual na textarea para indicar a sincroniza��o
  ta.style.transition = 'box-shadow 0.1s';
  ta.style.boxShadow = '0 0 0 3px #1565c0';
  clearTimeout(ta._flashTimer);
  ta._flashTimer = setTimeout(function() {
    ta.style.boxShadow = '';
    setTimeout(function() { ta.style.transition = ''; }, 200);
  }, 500);
}

// ================ EXPORTAR ================

function toggleExportMenu() {
  var menu = document.getElementById('export-menu');
  var isOpen = menu.classList.toggle('open');
  // No mobile o ribbon tem overflow-x:auto que clipa position:absolute.
  // Usa position:fixed calculado pelo bounding rect do botão.
  // O ribbon fica no TOPO, então o menu abre ABAIXO do botão (top = r.bottom).
  if (isOpen && window.innerWidth <= 600) {
    var btn = document.getElementById('export-wrap');
    var r = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top      = (r.bottom + 4) + 'px';
    menu.style.bottom   = 'auto';
    // Alinha pela direita; se não caber, alinha pela esquerda do botão
    var menuW = 210;
    var rightEdge = window.innerWidth - r.right;
    if (rightEdge + menuW > window.innerWidth) rightEdge = window.innerWidth - menuW - 4;
    menu.style.right    = Math.max(4, rightEdge) + 'px';
    menu.style.left     = 'auto';
    menu.style.zIndex   = '99999';
    menu.style.minWidth = '200px';
  } else if (!isOpen) {
    menu.style.position = '';
    menu.style.top      = '';
    menu.style.bottom   = '';
    menu.style.right    = '';
    menu.style.left     = '';
    menu.style.zIndex   = '';
    menu.style.minWidth = '';
  }
}
function fecharExportMenu() {
  document.getElementById('export-menu').classList.remove('open');
}
// Fecha ao clicar fora
document.addEventListener('click', function(e) {
  var wrap = document.getElementById('export-wrap');
  if (wrap && !wrap.contains(e.target)) fecharExportMenu();
});

/** Faz download de um blob/dataURL com o nome especificado */
function _download(urlOrData, nome) {
  var a = document.createElement('a');
  a.href = urlOrData;
  a.download = nome;
  a.style.display = 'none';
  // Necess�rio em FF mobile e Android: elemento deve estar no DOM para click funcionar
  document.body.appendChild(a);
  a.click();
  setTimeout(function() {
    document.body.removeChild(a);
    // Libera object URL se for blob: (PNG, SVG, HTML)
    if (typeof urlOrData === 'string' && urlOrData.indexOf('blob:') === 0) {
      URL.revokeObjectURL(urlOrData);
    }
  }, 300);
}

/** Retorna nome base para exporta��o (program-id ou timestamp) */
function _exportNome() {
  var ta = (document.getElementById('input') || {}).value || '';
  var m = ta.match(/PROGRAM-ID\.?\s+([A-Z0-9][A-Z0-9-]*)/i);
  return (m ? m[1] : 'fluxo-cobol').toLowerCase();
}

/** Exporta o diagrama atual como PNG */
function exportarPNG() {
  if (!cy) { alert('Gere o fluxo primeiro.'); return; }
  var png = cy.png({ full: true, scale: 2, bg: '#ffffff' });
  _download(png, _exportNome() + '.png');
}

/** Exporta o diagrama atual como SVG */
function exportarSVG() {
  if (!cy) { alert('Gere o fluxo primeiro.'); return; }
  var svg = cy.svg ? cy.svg({ full: true, scale: 1 }) : null;
  if (!svg) {
    alert('SVG n\u00e3o dispon\u00edvel nesta vers\u00e3o do Cytoscape.\nUse a exporta\u00e7\u00e3o PNG.');
    return;
  }
  var blob = new Blob([svg], { type: 'image/svg+xml' });
  _download(URL.createObjectURL(blob), _exportNome() + '.svg');
}

/** Exporta um relat�rio HTML completo:
 *  - cabe�alho com nome do programa e data
 *  - �ndice de se��es/par�grafos com tipo e contagem de linhas
 *  - imagem do diagrama embutida em base64
 *  - legenda de cores
 */
// === Helper: árvore por ordem de declaração com conteúdo AST ===
function _buildParTree(prog, estrutura, tipos, ordemParagrafos) {
  // Monta lista de parágrafos reais; fim-paragrafo fica agregado ao parágrafo anterior
  var items = [];  // { nome, linhas, fim: nome|null }
  var lastPar = null;
  (ordemParagrafos || []).forEach(function(n) {
    var t = tipos[n] || 'paragrafo';
    if (t === 'section') return;
    if (t === 'fim-paragrafo') {
      if (lastPar) { lastPar.fim = n; }
      return;
    }
    var item = { nome: n, linhas: (estrutura[n] || []).length, fim: null };
    items.push(item);
    lastPar = item;
  });

  var lines = [prog];

  items.forEach(function(item, pi) {
    var isLast = pi === items.length - 1;
    var con = isLast ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ';
    var np  = isLast ? '     ' : '\u2502    ';

    var nl = item.linhas;
    lines.push(' ' + con + item.nome + '   (' + nl + ' linha' + (nl !== 1 ? 's' : '') + ')');

    var _ast = buildAST(estrutura[item.nome] || [], null);
    var hasFim = !!item.fim;
    _ast.forEach(function(an, ai) {
      _renderAstNode(an, ' ' + np, ai === _ast.length - 1 && !hasFim, lines);
    });
    if (hasFim) {
      lines.push(' ' + np + '\u2514\u2500\u2500 ' + item.fim);
    }
  });

  return lines;
}
// === Helper: constrói a árvore de EXECUÇÃO seguindo PERFORM calls ===
// expandThru=false → resumido (PERFORM THRU como folha)
// expandThru=true  → expandido (PERFORM THRU abre o conteúdo do parágrafo destino)
function _buildExecFlow(prog, estrutura, tipos, ordemParagrafos, expandThru) {
  var lines = [];
  var MAX_D = 20;

  function renderNodes(ast, pf, visited, depth) {
    if (!ast || !ast.length || depth > MAX_D) return;
    ast.forEach(function(n, ni) {
      renderN(n, pf, ni === ast.length - 1, visited, depth);
    });
  }

  function renderN(n, pf, last, visited, depth) {
    var con = last ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ';
    var np  = pf + (last ? '     ' : '\u2502    ');

    if (n.type === 'perform') {
      var tgt = n.target;
      var ttype = tipos[tgt];
      var nl = (estrutura[tgt] || []).length;

      if (ttype === 'fim-paragrafo') {
        lines.push(pf + con + 'PERFORM ' + tgt + '   [EXIT]');
        return;
      }

      if (ttype === 'section') {
        // Coleta parágrafos membros da section (em ordemParagrafos, entre esta section e a próxima)
        var _secPars = [];
        var _inSec = false;
        for (var _si = 0; _si < (ordemParagrafos || []).length; _si++) {
          var _sn = ordemParagrafos[_si];
          if (_sn === tgt) { _inSec = true; continue; }
          if (_inSec) {
            if (tipos[_sn] === 'section') break;
            if (tipos[_sn] !== 'fim-paragrafo') _secPars.push(_sn);
          }
        }
        var _secTotalL = _secPars.reduce(function(s, p) { return s + (estrutura[p] || []).length; }, 0) + nl;
        var _secDesc = _secPars.length + ' par\u00e1gr.' + (_secTotalL > 0 ? ', ' + _secTotalL + ' linhas' : '');
        lines.push(pf + con + 'PERFORM ' + tgt + '  [SECTION \u2014 ' + _secDesc + ']');
        if (visited[tgt]) {
          lines.push(np + '\u2514\u2500\u2500 \u21a9 j\u00e1 exibido');
          return;
        }
        if (depth < MAX_D) {
          var _vSec = Object.assign({}, visited); _vSec[tgt] = true;
          if (nl > 0) renderNodes(buildAST(estrutura[tgt] || [], null), np, _vSec, depth + 1);
          _secPars.forEach(function(_pn, _pi) {
            var _pLast = _pi === _secPars.length - 1;
            var _pCon  = _pLast ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ';
            var _pNp   = np + (_pLast ? '     ' : '\u2502    ');
            var _pNl   = (estrutura[_pn] || []).length;
            lines.push(np + _pCon + _pn + '   (' + _pNl + ' linha' + (_pNl !== 1 ? 's' : '') + ')');
            if (!_vSec[_pn] && _pNl > 0 && depth < MAX_D) {
              var _vPar = Object.assign({}, _vSec); _vPar[_pn] = true;
              renderNodes(buildAST(estrutura[_pn] || [], null), _pNp, _vPar, depth + 1);
            }
          });
        }
        return;
      }

      if (!estrutura[tgt]) {
        lines.push(pf + con + 'PERFORM ' + tgt);
        return;
      }
      lines.push(pf + con + 'PERFORM ' + tgt + '   (' + nl + ' linha' + (nl !== 1 ? 's' : '') + ')');
      if (visited[tgt]) {
        lines.push(np + '\u2514\u2500\u2500 \u21a9 j\u00e1 exibido');
        return;
      }
      if (!expandThru) {
        // Modo resumido: PERFORM é folha — não expande o corpo
        return;
      }
      if (depth < MAX_D) {
        var v2 = Object.assign({}, visited); v2[tgt] = true;
        renderNodes(buildAST(estrutura[tgt] || [], null), np, v2, depth + 1);
      }
    } else if (n.type === 'perform-thru') {
      if (expandThru && tipos[n.from] !== 'fim-paragrafo') {
        var condSuffix = n.cond ? '  ' + n.cond : '';
        // Coleta todos os parágrafos entre from e to (inclusive)
        var _thruPars = [], _inRange = false;
        for (var _ti = 0; _ti < (ordemParagrafos || []).length; _ti++) {
          var _tn = ordemParagrafos[_ti];
          if (_tn === n.from) _inRange = true;
          if (_inRange && tipos[_tn] !== 'section') _thruPars.push(_tn);
          if (_inRange && _tn === n.to) break;
        }
        var _thruTotal = _thruPars.reduce(function(s, p) { return s + (estrutura[p] || []).length; }, 0);
        lines.push(pf + con + 'PERFORM ' + n.from + ' THRU ' + n.to + condSuffix + '   (' + _thruPars.length + ' parágr., ' + _thruTotal + ' linhas)');
        if (visited[n.from]) {
          lines.push(np + '\u2514\u2500\u2500 \u21a9 j\u00e1 exibido');
        } else if (depth < MAX_D) {
          var vT = Object.assign({}, visited);
          _thruPars.forEach(function(_tn2, _ti2) {
            var _tLast = _ti2 === _thruPars.length - 1;
            var _tCon  = _tLast ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ';
            var _tNp   = np + (_tLast ? '     ' : '\u2502    ');
            var _tType = tipos[_tn2];
            if (_tType === 'fim-paragrafo') {
              lines.push(np + _tCon + _tn2 + '   [EXIT]');
              return;
            }
            var _tNl = (estrutura[_tn2] || []).length;
            lines.push(np + _tCon + _tn2 + '   (' + _tNl + ' linha' + (_tNl !== 1 ? 's' : '') + ')');
            if (!vT[_tn2] && _tNl > 0) {
              var _vT2 = Object.assign({}, vT); _vT2[_tn2] = true;
              renderNodes(buildAST(estrutura[_tn2] || [], null), _tNp, _vT2, depth + 1);
            }
          });
        }
      } else {
        lines.push(pf + con + 'PERFORM ' + n.from + ' THRU ' + n.to + (n.cond ? '  ' + n.cond : ''));
      }
    } else if (n.type === 'loop') {
      var lbl = n.label.replace(/\n/g, ' ');
      lines.push(pf + con + lbl);
      var named = n.named;
      if (named && estrutura[named] && !visited[named] && depth < MAX_D) {
        if (expandThru) {
          var v3 = Object.assign({}, visited); v3[named] = true;
          renderNodes(buildAST(estrutura[named] || [], null), np, v3, depth + 1);
        }
      } else if (n.body && n.body.length) {
        renderNodes(n.body, np, visited, depth);
      }
    } else if (n.type === 'group') {
      var itens = (n.detail || '').split('\n').filter(function(s) { return s.trim(); });
      itens.forEach(function(s, si) {
        var isLastItem = si === itens.length - 1;
        lines.push(pf + ((isLastItem && last) ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ') + s.trim());
      });
    } else if (n.type === 'if') {
      lines.push(pf + con + 'IF ' + n.label.replace(/^IF\s+/i, ''));
      var brs = [];
      if (n.sim && n.sim.length) brs.push({ tag: '[SIM]',  ns: n.sim });
      if (n.nao && n.nao.length) brs.push({ tag: '[N\u00c3O]', ns: n.nao });
      brs.forEach(function(br, bi) {
        var bl = bi === brs.length - 1;
        lines.push(np + (bl ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ') + br.tag);
        renderNodes(br.ns, np + (bl ? '     ' : '\u2502    '), visited, depth);
      });
    } else if (n.type === 'read') {
      lines.push(pf + con + (n.label || '').replace(/\n/g, ' | '));
      var rdBrs = [];
      if (n.atEnd      && n.atEnd.length)      rdBrs.push({ tag: '[AT END]',      ns: n.atEnd });
      if (n.notAtEnd   && n.notAtEnd.length)   rdBrs.push({ tag: '[N\u00c3O AT END]',   ns: n.notAtEnd });
      if (n.invalidKey && n.invalidKey.length) rdBrs.push({ tag: '[INVALID KEY]',   ns: n.invalidKey });
      rdBrs.forEach(function(br, bi) {
        var bl = bi === rdBrs.length - 1;
        lines.push(np + (bl ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ') + br.tag);
        renderNodes(br.ns, np + (bl ? '     ' : '\u2502    '), visited, depth);
      });
    } else if (n.type === 'call') {
      lines.push(pf + con + (n.label || '').replace(/\n/g, ' | '));
      var cBrs = [];
      if (n.onException    && n.onException.length)    cBrs.push({ tag: '[ON EXCEPTION]',     ns: n.onException });
      if (n.notOnException && n.notOnException.length) cBrs.push({ tag: '[NOT ON EXCEPTION]', ns: n.notOnException });
      cBrs.forEach(function(br, bi) {
        var bl = bi === cBrs.length - 1;
        lines.push(np + (bl ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ') + br.tag);
        renderNodes(br.ns, np + (bl ? '     ' : '\u2502    '), visited, depth);
      });
    } else if (n.type === 'goto') {
      lines.push(pf + con + 'GO TO ' + n.target);
    } else if (n.type === 'evaluate') {
      lines.push(pf + con + (n.label || 'EVALUATE'));
      var evWs = n.whens || [];
      evWs.forEach(function(w, wi) {
        var wlast = wi === evWs.length - 1;
        var wlbl = w.label || ('WHEN #' + (wi + 1));
        lines.push(np + (wlast ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ') + '[' + wlbl + ']');
        if (w.nodes && w.nodes.length) {
          renderNodes(w.nodes, np + (wlast ? '     ' : '\u2502    '), visited, depth);
        }
      });
    } else if (n.type === 'stop') {
      lines.push(pf + con + (n.label || 'STOP'));
    } else {
      // Nó genérico (instr, open, close, write, call, read, sql, etc.)
      // Label pode ser multi-linha — indenta as continuações
      var lbl2 = (n.label || '').replace(/\n/g, ' | ');
      if (lbl2) lines.push(pf + con + lbl2);
    }
  }

  lines.push(prog);
  // Encontra o ponto de entrada: estrutura[prog] se tiver conteúdo,
  // senão usa o primeiro parágrafo com conteúdo em ordemParagrafos
  var _entryLines = (estrutura[prog] || []);
  var _entryName  = prog;
  if (_entryLines.length === 0 && ordemParagrafos) {
    for (var _oi = 0; _oi < ordemParagrafos.length; _oi++) {
      var _on = ordemParagrafos[_oi];
      if (_on !== prog && tipos[_on] !== 'fim-paragrafo' && (estrutura[_on] || []).length > 0) {
        _entryLines = estrutura[_on]; _entryName = _on; break;
      }
    }
  }
  if (_entryLines.length > 0) {
    var visited0 = {}; visited0[prog] = true; visited0[_entryName] = true;
    renderNodes(buildAST(_entryLines, null), ' ', visited0, 0);
  }
  return lines;
}

function _renderAstNode(n, pf, last, lines) {
  var con = last ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ';
  var np  = pf + (last ? '     ' : '\u2502    ');
  var lbl;
  if (n.type === 'group') {
    // Expande todas as instruções do grupo individualmente
    var itens = (n.detail || '').split('\n').filter(function(s){ return s.trim(); });
    itens.forEach(function(s, si) {
      var isLast = si === itens.length - 1;
      lines.push(pf + ((isLast && last) ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ') + s.trim());
    });
  } else if (n.type === 'if') {
    lbl = n.label.replace(/^IF\s+/i, '');
    lines.push(pf + con + 'IF ' + lbl);
    var brs = [];
    if (n.sim && n.sim.length) brs.push({ tag:'[SIM]', ns:n.sim });
    if (n.nao && n.nao.length) brs.push({ tag:'[N\u00c3O]', ns:n.nao });
    brs.forEach(function(br,bi) {
      var bl = bi === brs.length - 1;
      lines.push(np + (bl ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ') + br.tag);
      var bnp = np + (bl ? '     ' : '\u2502    ');
      (br.ns||[]).forEach(function(a2,ai){ _renderAstNode(a2, bnp, ai===br.ns.length-1, lines); });
    });
  } else if (n.type === 'loop') {
    lbl = n.label.replace(/\n/g,' ');
    lines.push(pf + con + lbl);
    if (n.body && n.body.length)
      n.body.forEach(function(a2,ai){ _renderAstNode(a2, np, ai===n.body.length-1, lines); });
  } else if (n.type === 'perform') {
    lines.push(pf + con + 'PERFORM ' + n.target);
  } else if (n.type === 'perform-thru') {
    lines.push(pf + con + 'PERFORM ' + n.from + ' THRU ' + n.to + (n.cond ? '  '+n.cond : ''));
  } else if (n.type === 'goto') {
    lines.push(pf + con + 'GO TO ' + n.target);
  } else if (n.type === 'read') {
    lbl = (n.label || '').replace(/\n/g, ' | ');
    lines.push(pf + con + lbl);
    var rdBrs2 = [];
    if (n.atEnd      && n.atEnd.length)      rdBrs2.push({ tag: '[AT END]',      ns: n.atEnd });
    if (n.notAtEnd   && n.notAtEnd.length)   rdBrs2.push({ tag: '[N\u00c3O AT END]',   ns: n.notAtEnd });
    if (n.invalidKey && n.invalidKey.length) rdBrs2.push({ tag: '[INVALID KEY]',   ns: n.invalidKey });
    rdBrs2.forEach(function(br, bi) {
      var bl = bi === rdBrs2.length - 1;
      lines.push(np + (bl ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ') + br.tag);
      (br.ns||[]).forEach(function(a2, ai) { _renderAstNode(a2, np + (bl ? '     ' : '\u2502    '), ai === br.ns.length - 1, lines); });
    });
  } else if (n.type === 'call') {
    lbl = (n.label || '').replace(/\n/g, ' | ');
    lines.push(pf + con + lbl);
    var cBrs2 = [];
    if (n.onException    && n.onException.length)    cBrs2.push({ tag: '[ON EXCEPTION]',     ns: n.onException });
    if (n.notOnException && n.notOnException.length) cBrs2.push({ tag: '[NOT ON EXCEPTION]', ns: n.notOnException });
    cBrs2.forEach(function(br, bi) {
      var bl = bi === cBrs2.length - 1;
      lines.push(np + (bl ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ') + br.tag);
      (br.ns||[]).forEach(function(a2, ai) { _renderAstNode(a2, np + (bl ? '     ' : '\u2502    '), ai === br.ns.length - 1, lines); });
    });
  } else {
    lbl = (n.label || '').replace(/\n/g, ' | ');
    lines.push(pf + con + lbl);
  }
}

function exportarHTML(opts) {
  opts = opts || {};
  var _incIndice      = opts.indice      !== false;
  var _incMapaDecl    = opts.mapaDecl    !== false;
  var _incMapaExecRes = !!opts.mapaExecRes;
  var _incMapaExecExp = !!opts.mapaExecExp;
  var _incComents     = opts.comentarios !== false;
  var _incDiagrama    = opts.diagrama    !== false;
  var _incLegenda     = opts.legenda     !== false;

  if (!cy) { alert('Gere o fluxo primeiro.'); return; }

  var code = (document.getElementById('input') || {}).value || '';
  var meta = parseCobol(code);
  var { estrutura, tipos, secoes, ordemParagrafos, programId } = meta;
  var prog = programId || _exportNome().toUpperCase();
  var data = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
  var hora = new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });

  // Tenta SVG vetorial (qualidade perfeita). Fallback: PNG em alta escala.
  var diagramaEmbed = '';   // string a injetar no dv-inner
  var diagramaAviso = '';
  var _usouSVG = false;
  var _dimsW = 0, _dimsH = 0;
  try {
    if (typeof cy.svg === 'function') {
      var _svgStr = cy.svg({ full: true }) || '';
      _svgStr = _svgStr.replace(/<\?xml[^?]*\?>/i, '').trim();
      if (_svgStr && _svgStr.length > 100) {
        // Extrai dimensões originais para o fit()
        var _wm = _svgStr.match(/\bwidth=["']([\d.]+)["']/i);
        var _hm = _svgStr.match(/\bheight=["']([\d.]+)["']/i);
        if (_wm) _dimsW = parseFloat(_wm[1]);
        if (_hm) _dimsH = parseFloat(_hm[1]);
        // Se não tiver dimensões, usa bounding box
        if (!_dimsW || !_dimsH) {
          var _svgBB = cy.elements().boundingBox();
          _dimsW = Math.ceil(_svgBB.w + 80);
          _dimsH = Math.ceil(_svgBB.h + 80);
        }
        // Garante viewBox
        if (!/viewBox/i.test(_svgStr)) {
          _svgStr = _svgStr.replace('<svg', '<svg viewBox="0 0 ' + _dimsW + ' ' + _dimsH + '"');
        }
        // Mantém width/height (necessários para renderização correta no browser)
        diagramaEmbed = _svgStr;
        _usouSVG = true;
      }
    }
  } catch(e) { _usouSVG = false; }

  if (!_usouSVG) {
    // Fallback PNG com escala calculada para nunca exceder 9000px em nenhuma dimensão
    try {
      var _bb = cy.elements().boundingBox();
      var _bW = Math.ceil(_bb.w + 80);
      var _bH = Math.ceil(_bb.h + 80);
      var _scc = Math.min(2, 9000 / _bW, 9000 / _bH);
      _scc = Math.max(0.02, _scc);
      var _png = cy.png({ full: true, scale: _scc, bg: '#ffffff' }) || '';
      if (_png && _png.length > 500) {
        _dimsW = Math.round(_bW * _scc);
        _dimsH = Math.round(_bH * _scc);
        diagramaEmbed = '<img src="' + _png + '" style="display:block;width:' + _dimsW + 'px;height:' + _dimsH + 'px" alt="Diagrama">';
      }
    } catch(e) {}
    // Fallback garantido: captura viewport com fit
    if (!diagramaEmbed) {
      try {
        var _pz = cy.zoom(); var _pp = cy.pan();
        cy.fit(cy.elements(), 20);
        var _vpng = cy.png({ bg: '#ffffff' }) || '';
        cy.zoom(_pz); cy.pan(_pp);
        if (_vpng && _vpng.length > 500) {
          var _el = document.getElementById('cy');
          _dimsW = _el ? _el.offsetWidth : 800;
          _dimsH = _el ? _el.offsetHeight : 600;
          diagramaEmbed = '<img src="' + _vpng + '" style="display:block;width:' + _dimsW + 'px;height:' + _dimsH + 'px" alt="Diagrama">';
        }
      } catch(e2) {}
    }
  }

  if (!diagramaEmbed) {
    diagramaAviso = '<p style="color:#c62828;font-size:13px;font-family:Segoe UI,Arial,sans-serif;">'
      + '&#9888;&#65039; N&#227;o foi poss&#237;vel gerar o diagrama. Use <strong>Exportar PNG</strong> separadamente.</p>';
  }

  // Monta tabela de parágrafos
  // Coleta comentários registrados nos nós
  var _coms = (typeof window._getComments === 'function') ? (window._getComments() || {}) : {};
  var _escHtml = function(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };

  var rows = '';
  var secAtual = '';
  (ordemParagrafos || []).forEach(function(nome) {
    var t = tipos[nome] || 'paragrafo';
    var linhas = (estrutura[nome] || []).length;
    var esSection = t === 'section';
    // Verifica se algum nó desse parágrafo tem comentário (id do nó = nome)
    var temCom = !!_coms[nome];
    var badge = esSection
      ? '<span style="background:#1565c0;color:#fff;padding:1px 7px;border-radius:10px;font-size:11px">SECTION</span>'
      : (t === 'fim-paragrafo'
          ? '<span style="background:#90a4ae;color:#fff;padding:1px 7px;border-radius:10px;font-size:11px">FIM</span>'
          : '<span style="background:#43a047;color:#fff;padding:1px 7px;border-radius:10px;font-size:11px">PAR&#193;GRAFO</span>');
    var comBadge = temCom ? ' <span title="Tem coment&#225;rio" style="cursor:pointer;font-size:13px" onclick="scrollToCom(\'' + _escHtml(nome) + '\')" >&#128204;</span>' : '';
    if (esSection) secAtual = nome;
    rows += '<tr style="' + (esSection ? 'background:#e3f2fd;font-weight:700' : '') + '" id="row-' + _escHtml(nome) + '">' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee">' + _escHtml(nome) + comBadge + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">' + badge + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;color:#555">' +
        (esSection ? '&mdash;' : linhas + ' linha' + (linhas !== 1 ? 's' : '')) + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee;color:#888;font-size:12px">' +
        (esSection ? '' : (secAtual && secAtual !== nome ? secAtual : '&mdash;')) + '</td>' +
      '</tr>';
  });

  // Gera cards de comentários
  var comIds = Object.keys(_coms);
  var comCards = '';
  comIds.forEach(function(id) {
    var c = _coms[id];
    var txt = _escHtml(c.texto || '').replace(/\n/g, '<br>');
    comCards += '<div class="com-card" id="com-' + _escHtml(id) + '">' +
      '<div class="com-card-header" onclick="toggleCom(this)">' +
      '<span class="com-pin">&#128204;</span>' +
      '<span class="com-label">' + _escHtml(c.label || id) + '</span>' +
      '<span class="com-arrow">&#9660;</span>' +
      '</div>' +
      '<div class="com-body"><p>' + txt + '</p></div>' +
      '</div>';
  });
  var comSection = comCards
    ? '<div class="sec-card" id="sec-comentarios"><div class="sec-hdr open" onclick="toggleSec(this)"><span class="sec-title">&#128204; Coment&#225;rios (' + comIds.length + ')</span><span class="sec-arrow">&#9660;</span></div><div class="sec-body"><div class="com-list">' + comCards + '</div></div></div>'
    : '';

  // --- Mapa de parágrafos: declaração + fluxo de execução ---
  var _preStyle = 'font-family:\'Courier New\',monospace;font-size:13px;background:#f8f9fb;border:1px solid #e0e0e0;border-radius:6px;padding:16px 18px;line-height:1.5;overflow-x:auto';
  var _mapaTree =
      (_incMapaDecl
        ? '<div class="sec-card"><div class="sec-hdr open" onclick="toggleSec(this)"><span class="sec-title">Mapa de Par&#225;grafos &#8212; Declara&#231;&#227;o</span><span class="sec-arrow">&#9660;</span></div><div class="sec-body">'
          + '<pre style="' + _preStyle + '">'
          + _buildParTree(prog, estrutura, tipos, ordemParagrafos).join('\n')
          + '</pre>'
          + '</div></div>'
        : '')
    + (_incMapaExecRes
        ? '<div class="sec-card"><div class="sec-hdr open" onclick="toggleSec(this)"><span class="sec-title">Mapa de Par&#225;grafos &#8212; Fluxo de Execu&#231;&#227;o (Resumido)</span><span class="sec-arrow">&#9660;</span></div><div class="sec-body">'
          + '<pre style="' + _preStyle + '">'
          + _buildExecFlow(prog, estrutura, tipos, ordemParagrafos, false).join('\n')
          + '</pre>'
          + '</div></div>'
        : '')
    + (_incMapaExecExp
        ? '<div class="sec-card"><div class="sec-hdr open" onclick="toggleSec(this)"><span class="sec-title">Mapa de Par&#225;grafos &#8212; Fluxo de Execu&#231;&#227;o (Expandido)</span><span class="sec-arrow">&#9660;</span></div><div class="sec-body">'
          + '<pre style="' + _preStyle + '">'
          + _buildExecFlow(prog, estrutura, tipos, ordemParagrafos, true).join('\n')
          + '</pre>'
          + '</div></div>'
        : '');

  var html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1.0">'
    + '<title>Documenta&#231;&#227;o &mdash; ' + prog + '</title>'
    + '<style>'
    + 'body{font-family:Segoe UI,Arial,sans-serif;margin:0;padding:0;color:#222;background:#f4f6f8}'
    + 'header{background:#1a237e;color:#fff;padding:28px 40px}'
    + 'header h1{margin:0 0 6px;font-size:22px;letter-spacing:1px}'
    + 'header p{margin:0;font-size:13px;opacity:.8}'
    + 'main{max-width:1200px;margin:32px auto;padding:0 24px}'
    + 'h2{font-size:16px;color:#1a237e;border-bottom:2px solid #c5cae9;padding-bottom:6px;margin-top:36px}'
    + '.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:8px;box-shadow:0 1px 6px rgba(0,0,0,.08)}'
    + 'table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;min-width:420px}'
    + 'th{background:#283593;color:#fff;padding:9px 10px;font-size:13px;text-align:left}'
    + '.dv-wrap{background:#fff;border-radius:8px;box-shadow:0 1px 6px rgba(0,0,0,.08);overflow:hidden}'
    + '.dv-toolbar{display:flex;align-items:center;gap:8px;padding:8px 14px;background:#f5f5f5;border-bottom:1px solid #e0e0e0;flex-wrap:wrap}'
    + '.dv-toolbar button{border:1px solid #ccc;background:#fff;border-radius:4px;padding:6px 14px;font-size:13px;cursor:pointer;font-family:Segoe UI,Arial,sans-serif;transition:background .1s;min-height:36px;-webkit-tap-highlight-color:transparent}'
    + '.dv-toolbar button:hover{background:#e8eaf6}'
    + '.dv-toolbar .dv-zoom-lbl{font-size:12px;color:#555;min-width:48px;text-align:center;font-family:monospace}'
    + '.dv-toolbar .dv-hint{font-size:11px;color:#aaa;margin-left:auto}'
    + '.dv-canvas{width:100%;height:72vh;min-height:320px;overflow:hidden;position:relative;cursor:grab;background:#f8f9fb;'
    +   'background-image:radial-gradient(circle,#d0d5de 1px,transparent 1px);background-size:22px 22px;touch-action:none}'
    + '.dv-canvas.dragging{cursor:grabbing}'
    + '.dv-inner{position:absolute;top:0;left:0;transform-origin:0 0;transition:none}'
    + '.dv-inner img{display:block;max-width:none;max-height:none}'
    + '.dv-inner svg{display:block}'
    + '.legenda{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}'
    + '.leg-item{display:flex;align-items:center;gap:6px;font-size:12px}'
    + '.leg-cor{width:18px;height:18px;border-radius:3px;flex-shrink:0}'
    + 'footer{text-align:center;color:#aaa;font-size:11px;padding:32px 0 20px}'
    + '.com-list{display:flex;flex-direction:column;gap:10px;margin-top:8px}'
    + '.com-card{background:#fff;border-radius:8px;box-shadow:0 1px 6px rgba(0,0,0,.08);overflow:hidden}'
    + '.com-card-header{display:flex;align-items:center;gap:10px;padding:11px 16px;cursor:pointer;user-select:none;background:#fffde7;border-left:4px solid #ffc107;transition:background .15s}'
    + '.com-card-header:hover{background:#fff8e1}'
    + '.com-card-header.open{background:#fff3cd}'
    + '.com-pin{font-size:15px;flex-shrink:0}'
    + '.com-label{font-weight:600;font-size:13px;color:#333;flex:1}'
    + '.com-arrow{font-size:11px;color:#999;transition:transform .2s}'
    + '.com-card-header.open .com-arrow{transform:rotate(180deg)}'
    + '.com-body{display:none;padding:12px 18px 14px 18px;border-top:1px solid #f5f5f5;font-size:13px;line-height:1.6;color:#444;white-space:pre-wrap}'
    + '.com-body.open{display:block}'
    + '.com-highlight{outline:3px solid #ffc107!important;transition:outline .3s}'
    + '.sec-card{margin-top:28px}'
    + '.sec-hdr{display:flex;align-items:center;justify-content:space-between;font-size:15px;font-weight:600;color:#1a237e;border-bottom:2px solid #c5cae9;padding-bottom:6px;cursor:pointer;user-select:none;gap:8px}'
    + '.sec-hdr:hover{color:#283593}'
    + '.sec-hdr .sec-title{flex:1}'
    + '.sec-hdr .sec-arrow{font-size:12px;color:#999;transition:transform .2s}'
    + '.sec-hdr.open .sec-arrow{transform:rotate(180deg)}'
    + '.sec-body.collapsed{display:none}'
    + '.sec-ctrl{display:flex;gap:10px;margin:10px 0 4px;justify-content:flex-end}'
    + '.sec-ctrl button{border:1px solid #c5cae9;background:#e8eaf6;border-radius:4px;padding:4px 14px;font-size:12px;cursor:pointer;color:#1a237e;font-family:Segoe UI,Arial,sans-serif}'
    + '.sec-ctrl button:hover{background:#c5cae9}'
    + '@media(max-width:700px){'
    +   'header{padding:16px 16px}'
    +   'header h1{font-size:17px}'
    +   'header p{font-size:11px}'
    +   'main{padding:0 10px;margin:14px auto}'
    +   '.dv-canvas{height:58vw;min-height:260px}'
    +   '.dv-toolbar{gap:4px;padding:6px 8px}'
    +   '.dv-toolbar button{padding:5px 10px;font-size:12px}'
    +   '.dv-hint{display:none!important}'
    +   'th{font-size:11px;padding:7px 6px}'
    +   '.sec-hdr{font-size:13px}'
    +   '.com-label{font-size:12px}'
    +   '.sec-ctrl{flex-wrap:wrap}'
    +   'pre{font-size:11px!important}'
    + '}'
    + '</style>'
    + '<script>'
    + '(function(){'
    + 'function initViewer(){'
    + '  var canvas=document.getElementById("dv-canvas");'
    + '  var inner=document.getElementById("dv-inner");'
    + '  var lbl=document.getElementById("dv-zoom-lbl");'
    + '  if(!canvas||!inner)return;'
    + '  var scale=1,tx=0,ty=0,dragging=false,sx=0,sy=0,stx=0,sty=0;'
    + '  function fit(){'
    + '    var cw=canvas.clientWidth,ch=canvas.clientHeight;'
    + '    var iw=parseFloat(inner.dataset.w)||inner.scrollWidth;'
    + '    var ih=parseFloat(inner.dataset.h)||inner.scrollHeight;'
    + '    if(!iw||!ih)return;'
    + '    scale=Math.min(cw/iw,ch/ih)*0.92;'
    + '    tx=(cw-iw*scale)/2; ty=20;'
    + '    apply();'
    + '  }'
    + '  function apply(){'
    + '    scale=Math.max(0.05,Math.min(5,scale));'
    + '    inner.style.transform="translate("+tx+"px,"+ty+"px) scale("+scale+")";'
    + '    lbl.textContent=Math.round(scale*100)+"%";'
    + '  }'
    + '  var _homeTx=0,_homeTy=0,_homeScale=1;'
    + '  function saveHome(){_homeTx=tx;_homeTy=ty;_homeScale=scale;}'
    + '  function goHome(){tx=_homeTx;ty=_homeTy;scale=_homeScale;apply();}'
    + '  document.getElementById("dv-fit").onclick=fit;'
    + '  document.getElementById("dv-home").onclick=goHome;'
    + '  document.getElementById("dv-zin").onclick=function(){var cw=canvas.clientWidth,ch=canvas.clientHeight;var mx=cw/2,my=ch/2;var f=1.25;tx=mx-(mx-tx)*f;ty=my-(my-ty)*f;scale*=f;apply();};'
    + '  document.getElementById("dv-zout").onclick=function(){var cw=canvas.clientWidth,ch=canvas.clientHeight;var mx=cw/2,my=my=ch/2;var f=1/1.25;tx=mx-(mx-tx)*f;ty=my-(my-ty)*f;scale*=f;apply();};'
    + '  canvas.addEventListener("wheel",function(e){'
    + '    e.preventDefault();'
    + '    var rect=canvas.getBoundingClientRect();'
    + '    var mx=e.clientX-rect.left,my=e.clientY-rect.top;'
    + '    var factor=e.deltaY<0?1.12:1/1.12;'
    + '    tx=mx-(mx-tx)*factor; ty=my-(my-ty)*factor;'
    + '    scale*=factor; apply();'
    + '  },{passive:false});'
    + '  canvas.addEventListener("mousedown",function(e){'
    + '    dragging=true;sx=e.clientX;sy=e.clientY;stx=tx;sty=ty;'
    + '    canvas.classList.add("dragging");e.preventDefault();'
    + '  });'
    + '  window.addEventListener("mousemove",function(e){'
    + '    if(!dragging)return;'
    + '    tx=stx+(e.clientX-sx);ty=sty+(e.clientY-sy);apply();'
    + '  });'
    + '  window.addEventListener("mouseup",function(){dragging=false;canvas.classList.remove("dragging");});'
    // Touch: pan com 1 dedo, pinch-zoom com 2 dedos
    + '  var _t1x=0,_t1y=0,_t1tx=0,_t1ty=0,_pinchD=0;'
    + '  canvas.addEventListener("touchstart",function(e){'
    + '    e.preventDefault();'
    + '    if(e.touches.length===1){dragging=true;_t1x=e.touches[0].clientX;_t1y=e.touches[0].clientY;_t1tx=tx;_t1ty=ty;}'
    + '    else if(e.touches.length===2){dragging=false;_pinchD=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);}'
    + '  },{passive:false});'
    + '  canvas.addEventListener("touchmove",function(e){'
    + '    e.preventDefault();'
    + '    if(e.touches.length===1&&dragging){tx=_t1tx+(e.touches[0].clientX-_t1x);ty=_t1ty+(e.touches[0].clientY-_t1y);apply();}'
    + '    else if(e.touches.length===2&&_pinchD>0){'
    + '      var d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);'
    + '      var rect=canvas.getBoundingClientRect();'
    + '      var mx=((e.touches[0].clientX+e.touches[1].clientX)/2)-rect.left;'
    + '      var my=((e.touches[0].clientY+e.touches[1].clientY)/2)-rect.top;'
    + '      var f=d/_pinchD;tx=mx-(mx-tx)*f;ty=my-(my-ty)*f;scale*=f;apply();_pinchD=d;'
    + '    }'
    + '  },{passive:false});'
    + '  canvas.addEventListener("touchend",function(){dragging=false;_pinchD=0;});'
    + '  setTimeout(function(){fit();saveHome();},60);'
    + '}'
    + 'document.addEventListener("DOMContentLoaded",initViewer);'
    + '})();'
    + 'function toggleCom(hdr){'
    + '  hdr.classList.toggle("open");'
    + '  var body=hdr.nextElementSibling;'
    + '  if(body){body.style.display=body.style.display==="block"?"none":"block";}'
    + '}'
    + 'function toggleSec(hdr){'
    + '  hdr.classList.toggle("open");'
    + '  var body=hdr.nextElementSibling;'
    + '  if(body) body.classList.toggle("collapsed");'
    + '}'
    + 'function expandAll(){document.querySelectorAll(".sec-hdr").forEach(function(h){h.classList.add("open");var b=h.nextElementSibling;if(b)b.classList.remove("collapsed");});}'
    + 'function collapseAll(){document.querySelectorAll(".sec-hdr").forEach(function(h){h.classList.remove("open");var b=h.nextElementSibling;if(b)b.classList.add("collapsed");});}'
    + 'document.addEventListener("DOMContentLoaded",function(){expandAll();});'
    + 'function scrollToCom(id){'
    + '  var el=document.getElementById("com-"+id);'
    + '  if(!el)return;'
    + '  el.scrollIntoView({behavior:"smooth",block:"center"});'
    + '  var hdr=el.querySelector(".com-card-header");'
    + '  if(hdr&&!hdr.classList.contains("open")){toggleCom(hdr);}'
    + '  el.classList.add("com-highlight");'
    + '  setTimeout(function(){el.classList.remove("com-highlight");},2000);'
    + '}'
    + '<\/script>'
    + '</head><body>'
    + '<header>'
    + '<h1>Documenta&#231;&#227;o de Fluxo COBOL &mdash; ' + prog + '</h1>'
    + '<p>Gerado em ' + data + ' &#224;s ' + hora + ' &nbsp;|&nbsp; COBOL Flow Visualizer v.1.1 &mdash; Sistema criado por <a href="https://www.linkedin.com/in/elainemirellanunes/" target="_blank" style="color:#fff;text-decoration:underline">Elaine Nunes</a></p>'
    + '</header><main>'
    + '<div class="sec-ctrl"><button onclick="expandAll()">&#8862; Expandir tudo</button><button onclick="collapseAll()">&#8863; Recolher tudo</button></div>'
    + (_incIndice
        ? '<div class="sec-card"><div class="sec-hdr open" onclick="toggleSec(this)"><span class="sec-title">&#205;ndice de Se&#231;&#245;es e Par&#225;grafos</span><span class="sec-arrow">&#9660;</span></div><div class="sec-body">'
          + '<div class="tbl-wrap"><table><thead><tr><th>Nome</th><th style="width:110px;text-align:center">Tipo</th><th style="width:90px;text-align:center">Linhas</th><th>Se&#231;&#227;o pai</th></tr></thead>'
          + '<tbody>' + rows + '</tbody></table></div>'
          + '</div></div>'
        : '')
    + ((_incMapaDecl || _incMapaExecRes || _incMapaExecExp) ? _mapaTree : '')
    + (_incComents ? comSection : '')
    + (_incDiagrama
        ? '<div class="sec-card"><div class="sec-hdr open" onclick="toggleSec(this)"><span class="sec-title">Diagrama de Fluxo</span><span class="sec-arrow">&#9660;</span></div><div class="sec-body">'
          + (diagramaEmbed
              ? '<div class="dv-wrap">'
                + '<div class="dv-toolbar">'
                + '<button id="dv-fit" title="Ajustar ao tamanho da tela">&#8853; Fit</button>'
                + '<button id="dv-home" title="Voltar para a posi&#231;&#227;o inicial">&#8962; In&#237;cio</button>'
                + '<button id="dv-zin" title="Zoom in">&#xff0b;</button>'
                + '<span class="dv-zoom-lbl" id="dv-zoom-lbl">100%</span>'
                + '<button id="dv-zout" title="Zoom out">&#xff0d;</button>'
                + '<span class="dv-hint">&#128432; Scroll para zoom &nbsp;&nbsp; &#128432; Arraste para mover</span>'
                + '</div>'
                + '<div class="dv-canvas" id="dv-canvas">'
                + '<div class="dv-inner" id="dv-inner" data-w="' + _dimsW + '" data-h="' + _dimsH + '">' + diagramaEmbed + '</div>'
                + '</div>'
                + '</div>'
              : ('<div style="padding:20px">' + diagramaAviso + '</div>'))
          + '</div></div>'
        : '')
    + (_incLegenda
        ? '<div class="sec-card"><div class="sec-hdr open" onclick="toggleSec(this)"><span class="sec-title">Legenda</span><span class="sec-arrow">&#9660;</span></div><div class="sec-body">'
          + '<div class="legenda">'
          + '<div class="leg-item"><div class="leg-cor" style="background:#90a4ae"></div>Instru&#231;&#227;o</div>'
          + '<div class="leg-item"><div class="leg-cor" style="background:#e3f2fd;border:2px solid #90caf9"></div>Decis&#227;o (IF)</div>'
          + '<div class="leg-item"><div class="leg-cor" style="background:#fdf2f8;border:2.5px solid #a21caf;clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%)"></div>EVALUATE (sele&#231;&#227;o)</div>'
          + '<div class="leg-item"><div class="leg-cor" style="background:#1565c0"></div>PERFORM / Loop</div>'
          + '<div class="leg-item"><div class="leg-cor" style="background:#ecfeff;border:2px solid #0891b2"></div>I/O &#8212; READ / WRITE / DISPLAY</div>'
          + '<div class="leg-item"><div class="leg-cor" style="background:#e0f2f1;border:2px solid #00695c"></div>Prepara&#231;&#227;o &#8212; OPEN (trap&#233;zio)</div>'
          + '<div class="leg-item"><div class="leg-cor" style="background:#fce4ec;border:2px solid #880e4f;border-radius:50%"></div>Terminador &#8212; CLOSE (oval)</div>'
          + '<div class="leg-item"><div class="leg-cor" style="background:#7c3aed"></div>GO TO</div>'
          + '<div class="leg-item"><div class="leg-cor" style="background:#1565c0"></div>SQL SELECT (DB2)</div>'
          + '<div class="leg-item"><div class="leg-cor" style="background:#2e7d32"></div>SQL INSERT (DB2)</div>'
          + '<div class="leg-item"><div class="leg-cor" style="background:#e65100"></div>SQL UPDATE (DB2)</div>'
          + '<div class="leg-item"><div class="leg-cor" style="background:#c62828"></div>SQL DELETE (DB2)</div>'
          + '<div class="leg-item"><div class="leg-cor" style="background:#b71c1c"></div>STOP / GOBACK</div>'
          + '<div class="leg-item"><div class="leg-cor" style="background:#3d1d00;border:2.5px dashed #d97706"></div>COPY / INCLUDE (m&#243;dulo externo)</div>'
          + '</div>'
          + '</div></div>'
        : '')
    + '</main><footer>COBOL Flow Visualizer v.1.1 &mdash; Sistema criado por <a href="https://www.linkedin.com/in/elainemirellanunes/" target="_blank" style="color:#aaa">Elaine Nunes</a> &mdash; ' + data + '</footer>'
    + '</body></html>';

  var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  _download(URL.createObjectURL(blob), _exportNome() + '-documentacao.html');
}

/** =====================================================
 *  EXPORTAR RELATÓRIO WORD (.doc)
 *  Layout A4 Paisagem para o diagrama — mais espaço horizontal.
 *  Fatias com 60px de overlap nas bordas para não cortar nós.
 *  Número de página desenhado direto no Canvas (sem elementos
 *  HTML entre imagens que causam espaço branco indesejado).
 * ===================================================== */
function exportarWord(opts) {
  opts = opts || {};
  var _incIndice      = opts.indice      !== false;
  var _incMapaDecl    = opts.mapaDecl    !== false;
  var _incMapaExecRes = !!opts.mapaExecRes;
  var _incMapaExecExp = !!opts.mapaExecExp;
  var _incComents     = opts.comentarios !== false;
  var _incDiagrama    = opts.diagrama    !== false;
  var _incLegenda     = opts.legenda     !== false;

  if (!cy) { alert('Gere o fluxo primeiro.'); return; }

  var code  = (document.getElementById('input') || {}).value || '';
  var meta  = parseCobol(code);
  var { estrutura, tipos, ordemParagrafos, programId } = meta;
  var prog  = programId || _exportNome().toUpperCase();
  var data  = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
  var hora  = new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });

  var _coms = (typeof window._getComments === 'function') ? (window._getComments() || {}) : {};
  var _esc  = function(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };

  // --- Tabela de índice ---
  var tRows = '';
  var secAtual = '';
  (ordemParagrafos || []).forEach(function(nome) {
    var t = tipos[nome] || 'paragrafo';
    var linhas = (estrutura[nome] || []).length;
    var esSection = t === 'section';
    var temCom = !!_coms[nome];
    var cor = esSection ? '#1a237e' : '#222';
    var bg  = esSection ? '#dce4f5' : (tRows.split('<tr').length % 2 === 0 ? '#f9f9f9' : '#fff');
    var tipo = esSection ? 'SECTION' : (t === 'fim-paragrafo' ? 'FIM' : 'PAR\u00C1GRAFO');
    if (esSection) secAtual = nome;
    tRows += '<tr style="background:' + bg + ';color:' + cor + ';' + (esSection ? 'font-weight:bold' : '') + '">'
      + '<td style="padding:5px 10px;border:1px solid #ccc">' + _esc(nome) + (temCom ? ' &#128204;' : '') + '</td>'
      + '<td style="padding:5px 10px;border:1px solid #ccc;text-align:center">' + tipo + '</td>'
      + '<td style="padding:5px 10px;border:1px solid #ccc;text-align:center">' + (esSection ? '&mdash;' : linhas + ' linha' + (linhas !== 1 ? 's' : '')) + '</td>'
      + '<td style="padding:5px 10px;border:1px solid #ccc;color:#666">' + (esSection ? '' : (secAtual && secAtual !== nome ? _esc(secAtual) : '&mdash;')) + '</td>'
      + '</tr>';
  });

  // --- Comentários ---
  var comHtml = '';
  var comIds = Object.keys(_coms);
  if (comIds.length) {
    comHtml += '<h2 style="color:#1a237e;font-size:14pt;margin-top:24pt">&#128204; Coment&#225;rios (' + comIds.length + ')</h2>';
    comIds.forEach(function(id) {
      var c = _coms[id];
      comHtml += '<div style="border-left:4px solid #ffc107;background:#fffde7;padding:10px 14px;margin-bottom:10px">'
        + '<div style="font-weight:bold;color:#333;margin-bottom:6px">&#128204; ' + _esc(c.label || id) + '</div>'
        + '<div style="font-size:11pt;color:#444;line-height:1.6">' + _esc(c.texto || '').replace(/\n/g, '<br>') + '</div>'
        + '</div>';
    });
  }

  // -------------------------------------------------------------------
  // Dimensões alvo para A4 paisagem a 150dpi:
  //   A4 landscape: 297mm × 210mm | margens 2cm topo/baixo, 2.5cm lados
  //   Usável W: (297-50)mm = 247mm → 247*150/25.4 ≈ 1460px
  //   Usável H: (210-40)mm = 170mm → 170*150/25.4 ≈ 1004px
  // -------------------------------------------------------------------
  var PAGE_W_PX = 1460;
  var PAGE_H_PX = 1004;
  var OVERLAP   = 60;   // px de sobreposição entre fatias para não cortar nós

  var pngSrc = '';
  var pngNatW = 0, pngNatH = 0;
  try {
    var _bb = cy.elements().boundingBox();
    var diagW = _bb.w + 80;
    var diagH = _bb.h + 80;
    // Calcula escala que garante AMBAS dimensões ≤ 9000px (seguro em todos browsers)
    var MAX_DIM = 9000;
    var _sc = Math.min(PAGE_W_PX / diagW, MAX_DIM / diagW, MAX_DIM / diagH);
    _sc = Math.max(0.02, _sc); // nunca abaixo de 2%
    var _tryPng = cy.png({ full: true, scale: _sc, bg: '#ffffff' }) || '';
    if (_tryPng && _tryPng.length > 500) {
      pngSrc  = _tryPng;
      pngNatW = Math.round(diagW * _sc);
      pngNatH = Math.round(diagH * _sc);
    }
  } catch(e) {}

  // Fallback garantido: fit do grafo no viewport atual e captura sem full:true
  // Funciona para qualquer tamanho pois é limitado pelo canvas da tela
  if (!pngSrc) {
    try {
      var _prevZoom = cy.zoom();
      var _prevPan  = cy.pan();
      cy.fit(cy.elements(), 20);
      var _vpPng = cy.png({ bg: '#ffffff' }) || '';
      cy.zoom(_prevZoom);
      cy.pan(_prevPan);
      if (_vpPng && _vpPng.length > 500) {
        var _cyEl = document.getElementById('cy');
        pngSrc  = _vpPng;
        pngNatW = _cyEl ? _cyEl.offsetWidth  : 800;
        pngNatH = _cyEl ? _cyEl.offsetHeight : 600;
      }
    } catch(e2) {}
  }

  // --- Mapa de parágrafos: declaração + fluxo de execução ---
  var _wPreStyle = 'font-family:\'Courier New\',monospace;font-size:10pt;background:#f8f9fb;border:1px solid #e0e0e0;border-radius:4px;padding:12px 14px;line-height:1.5';
  var _wH2Style  = 'color:#1a237e;font-size:13pt;border-bottom:2px solid #c5cae9;padding-bottom:4pt;margin-top:20pt';
  var _mapaWordTree =
      (_incMapaDecl
        ? '<h2 style="' + _wH2Style + '">Mapa de Par&#225;grafos &#8212; Declara&#231;&#227;o</h2>'
          + '<pre style="' + _wPreStyle + '">'
          + _buildParTree(prog, estrutura, tipos, ordemParagrafos).join('\n')
          + '</pre>'
        : '')
    + (_incMapaExecRes
        ? '<h2 style="' + _wH2Style + '">Mapa de Par&#225;grafos &#8212; Fluxo de Execu&#231;&#227;o (Resumido)</h2>'
          + '<pre style="' + _wPreStyle + '">'
          + _buildExecFlow(prog, estrutura, tipos, ordemParagrafos, false).join('\n')
          + '</pre>'
        : '')
    + (_incMapaExecExp
        ? '<h2 style="' + _wH2Style + '">Mapa de Par&#225;grafos &#8212; Fluxo de Execu&#231;&#227;o (Expandido)</h2>'
          + '<pre style="' + _wPreStyle + '">'
          + _buildExecFlow(prog, estrutura, tipos, ordemParagrafos, true).join('\n')
          + '</pre>'
        : '');

  var css = '@page{size:A4 portrait;margin:2cm 2.5cm}'
    + '@page DiagramPage{size:A4 landscape;margin:1.5cm 2cm}'
    + 'body{font-family:"Calibri",Arial,sans-serif;font-size:11pt;color:#222;margin:0}'
    + 'h1{font-size:16pt;color:#1a237e;margin-bottom:4pt}'
    + 'h2{font-size:13pt;color:#1a237e;border-bottom:2px solid #c5cae9;padding-bottom:4pt;margin-top:20pt}'
    + 'table{border-collapse:collapse;width:100%;font-size:10pt}'
    + 'th{background:#1a237e;color:#fff;padding:6px 10px;border:1px solid #1a237e;text-align:left}'
    + '.pgbreak{page-break-before:always;margin:0;padding:0}'
    + '.diag-section{page:DiagramPage}'
    + '.slice-wrap{margin:0;padding:0;line-height:0;font-size:0;display:block}'
    + '.slice-wrap img{width:100%;height:auto;display:block;margin:0;padding:0;border:0;vertical-align:top}';

  var _html = '<!DOCTYPE html>'
    + '<html xmlns:o="urn:schemas-microsoft-com:office:office"'
    + ' xmlns:w="urn:schemas-microsoft-com:office:word"'
    + ' xmlns="http://www.w3.org/TR/REC-html40">'
    + '<head><meta charset="UTF-8">'
    + '<title>Documenta&#231;&#227;o &mdash; ' + prog + '</title>'
    + '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View>'
    + '<w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->'
    + '<style>' + css + '</style></head><body>'
    + '<h1>Documenta&#231;&#227;o de Fluxo COBOL &mdash; ' + prog + '</h1>'
    + '<p style="color:#666;font-size:10pt">Gerado em ' + data + ' &#224;s ' + hora + ' &nbsp;|&nbsp; COBOL Flow Visualizer v.1.1 &mdash; Sistema criado por Elaine Nunes (linkedin.com/in/elainemirellanunes)</p>'
    + (_incIndice
        ? '<h2>&#205;ndice de Se&#231;&#245;es e Par&#225;grafos</h2>'
          + '<table><thead><tr>'
          + '<th>Nome</th><th style="width:100px;text-align:center">Tipo</th>'
          + '<th style="width:80px;text-align:center">Linhas</th><th>Se&#231;&#227;o pai</th>'
          + '</tr></thead><tbody>' + tRows + '</tbody></table>'
        : '')
    + ((_incMapaDecl || _incMapaExecRes || _incMapaExecExp) ? _mapaWordTree : '')
    + (_incComents ? comHtml : '');

  var _legendaHtml = '<h2 style="color:#1a237e;font-size:13pt;border-bottom:2px solid #c5cae9;padding-bottom:4pt;margin-top:20pt">Legenda</h2>'
    + '<table style="width:auto;border-collapse:collapse;font-size:10pt"><tbody>'
    + '<tr><td style="padding:4px 8px;border:1px solid #ccc"><span style="display:inline-block;width:14px;height:14px;background:#90a4ae;vertical-align:middle;margin-right:6px"></span>Instru&#231;&#227;o</td>'
    + '<td style="padding:4px 8px;border:1px solid #ccc"><span style="display:inline-block;width:14px;height:14px;background:#e3f2fd;border:1px solid #90caf9;vertical-align:middle;margin-right:6px"></span>Decis&#227;o (IF)</td>'
    + '<td style="padding:4px 8px;border:1px solid #ccc"><span style="display:inline-block;width:14px;height:14px;background:#fdf2f8;border:1px solid #a21caf;vertical-align:middle;margin-right:6px;transform:rotate(45deg)"></span>EVALUATE (sele&#231;&#227;o)</td></tr>'
    + '<tr><td style="padding:4px 8px;border:1px solid #ccc"><span style="display:inline-block;width:14px;height:14px;background:#1565c0;vertical-align:middle;margin-right:6px"></span>PERFORM / Loop</td>'
    + '<td style="padding:4px 8px;border:1px solid #ccc"><span style="display:inline-block;width:14px;height:14px;background:#e0f2f1;border:1px solid #00695c;vertical-align:middle;margin-right:6px"></span>Prepara&#231;&#227;o (OPEN)</td>'
    + '<td style="padding:4px 8px;border:1px solid #ccc"><span style="display:inline-block;width:14px;height:14px;background:#fce4ec;border:1px solid #880e4f;border-radius:50%;vertical-align:middle;margin-right:6px"></span>Terminador (CLOSE)</td></tr>'
    + '<tr><td style="padding:4px 8px;border:1px solid #ccc"><span style="display:inline-block;width:14px;height:14px;background:#7c3aed;vertical-align:middle;margin-right:6px"></span>GO TO</td>'
    + '<td style="padding:4px 8px;border:1px solid #ccc"><span style="display:inline-block;width:14px;height:14px;background:#b71c1c;vertical-align:middle;margin-right:6px"></span>STOP / GOBACK</td>'
    + '<td></td></tr>'
    + '</tbody></table>'
    + '<p style="text-align:center;color:#aaa;font-size:9pt;margin-top:24pt">COBOL Flow Visualizer v.1.1 &mdash; Sistema criado por Elaine Nunes (linkedin.com/in/elainemirellanunes) &mdash; ' + data + '</p>';

  function _finalizar(imgBlocks) {
    var diagDiv = _incDiagrama
      ? '<div class="pgbreak diag-section">'
        + '<p style="font-size:12pt;font-weight:bold;color:#1a237e;margin:0 0 8pt 0">Diagrama de Fluxo &mdash; ' + prog + '</p>'
        + imgBlocks + '</div>'
      : '';
    var doc = _html + diagDiv + (_incLegenda ? _legendaHtml : '') + '</body></html>';
    var blob = new Blob([doc], { type: 'application/msword;charset=utf-8' });
    _download(URL.createObjectURL(blob), _exportNome() + '-documentacao.doc');
  }

  if (!_incDiagrama) {
    _finalizar('');
    return;
  }

  if (!pngSrc) {
    _finalizar('<p style="color:#c62828">N&#227;o foi poss&#237;vel gerar o diagrama.</p>');
    return;
  }

  // Diagrama cabe em 1 página paisagem
  if (pngNatH <= PAGE_H_PX) {
    _finalizar('<div class="slice-wrap"><img src="' + pngSrc + '"></div>');
    return;
  }

  // Fatia com overlap usando Canvas
  var _img = new Image();
  _img.onload = function() {
    var totalH = _img.height;
    var totalW = _img.width;
    // Passo efetivo: cada fatia exibe PAGE_H_PX mas avança PAGE_H_PX - OVERLAP
    var step    = PAGE_H_PX - OVERLAP;
    var totalPags = Math.ceil((totalH - OVERLAP) / step);
    var blocks  = '';
    var pagina  = 1;

    for (var y = 0; y < totalH; y += step) {
      var fH = Math.min(PAGE_H_PX, totalH - y);
      var cvs = document.createElement('canvas');
      cvs.width  = totalW;
      cvs.height = fH;
      var ctx = cvs.getContext('2d');
      // Fundo branco
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cvs.width, fH);
      // Copia fatia da imagem
      ctx.drawImage(_img, 0, y, totalW, fH, 0, 0, totalW, fH);
      // Número de página no canto inferior direito da fatia
      var label = pagina + ' / ' + totalPags;
      ctx.font = 'bold ' + Math.round(totalW * 0.012) + 'px Calibri,Arial,sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, totalW - 10, fH - 6);

      var fatia = cvs.toDataURL('image/png');
      // Primeira fatia não tem quebra de página (já herdou do pai .pgbreak)
      var pgClass = pagina === 1 ? 'slice-wrap' : 'slice-wrap pgbreak';
      blocks += '<div class="' + pgClass + '"><img src="' + fatia + '"></div>';
      pagina++;
    }
    _finalizar(blocks);
  };
  _img.onerror = function() {
    _finalizar('<p style="color:#c62828">Erro ao processar o diagrama.</p>');
  };
  _img.src = pngSrc;
}

/** =====================================================
 *  GERAR ESTRUTURA COBOL (.cbl)
 *  Reconstr&#243;i o fonte COBOL no formato fixo IBM (80 colunas),
 *  igual ao padr&#227;o do Visual Studio / IBM COBOL for VS Code:
 *    Col 1-6  : n&#250;mero de sequ&#234;ncia  (000100, 000110, &#8230;)
 *    Col 7    : indicador  (' ' = c&#243;digo  |  '*' = coment&#225;rio)
 *    Col 8+   : &#193;rea A  (DIVISION, SECTION, nomes de par&#225;grafos)
 *    Col 12+  : &#193;rea B  (instru&#231;&#245;es &#8212; recuadas 4 espa&#231;os da col 8)
 * ===================================================== */
function exportarCobol() {
  var code = (document.getElementById('input') || {}).value || '';
  if (!code.trim()) {
    alert('N\u00e3o h\u00e1 c\u00f3digo COBOL para exportar. Cole ou importe um programa e tente novamente.');
    fecharExportMenu();
    return;
  }

  var meta = _currentMeta || parseCobol(code);
  var prog = (meta.programId || _exportNome()).toUpperCase();

  /* Gerador de sequ\u00eancias IBM */
  var _sq = 100;
  function NS()  { var s = String(_sq).padStart(6, '0'); _sq += 10; return s; }
  function sep() { return NS() + '*' + '-'.repeat(65); }
  function bk()  { return NS() + ' '; }
  function aA(t) { return NS() + ' ' + t; }           /* \u00c1rea A col 8 */
  function aB(t) { return NS() + ' ' + '    ' + t; }  /* \u00c1rea B col 12 */
  function co(t) { return NS() + '*' + '  ' + t; }    /* Coment\u00e1rio col 7 */

  var hoje  = new Date();
  var dtStr = ('0' + hoje.getDate()).slice(-2) + '.'
            + ('0' + (hoje.getMonth() + 1)).slice(-2) + '.'
            + hoje.getFullYear();

  var temLinkage  = /LINKAGE\s+SECTION/i.test(code);
  var lksM        = code.match(/PROCEDURE\s+DIVISION\s+USING\s+([A-Z0-9][A-Z0-9-]*)/i);
  var usingClause = lksM  ? ' USING ' + lksM[1].toUpperCase()
                          : (temLinkage ? ' USING LKS-PARAMETRO' : '');

  var out = [];

  /* IDENTIFICATION DIVISION */
  out.push(sep()); out.push(aA('IDENTIFICATION DIVISION.')); out.push(sep());
  out.push(aA('PROGRAM-ID.       ' + prog + '.'));
  out.push(sep());
  out.push(co('PROGRAMA      : ' + prog));
  out.push(co('LINGUAGEM     : COBOL'));
  out.push(co('GERADO EM     : ' + dtStr + '  (COBOL Flow Visualizer)'));
  out.push(sep());
  out.push(bk());

  /* ENVIRONMENT DIVISION */
  out.push(sep()); out.push(aA('ENVIRONMENT DIVISION.')); out.push(sep());
  out.push(aA('CONFIGURATION SECTION.'));
  out.push(aB('SPECIAL-NAMES.    DECIMAL-POINT IS COMMA.'));
  out.push(aA('INPUT-OUTPUT SECTION.'));
  out.push(aA('FILE-CONTROL.'));
  out.push(bk());

  /* DATA DIVISION: copia o bloco original removendo/reemitindo sequ\u00eancias */
  out.push(sep()); out.push(aA('DATA DIVISION.')); out.push(sep());
  (function emitirDataDiv() {
    var linhas  = code.split('\n');
    var dentro  = false;
    var temData = false;
    var _isSecHdr = /^(FILE|WORKING-STORAGE|LOCAL-STORAGE|LINKAGE|SCREEN|REPORT|COMMUNICATION)\s+SECTION\b/;
    for (var i = 0; i < linhas.length; i++) {
      var raw  = linhas[i];
      var norm = raw;
      if (raw.length >= 7) {
        var c7 = raw[6];
        if (/^[\d ]{6}/.test(raw) ||
            (/^[A-Za-z0-9 ]{6}/.test(raw) && (c7 === ' ' || c7 === '*' || c7 === '/'))) {
          norm = raw.slice(6);
        }
      }
      var u = norm.trim().toUpperCase();
      if (!dentro && /^DATA\s+DIVISION\b/.test(u))      { dentro = true; temData = true; continue; }
      if (dentro  && /^PROCEDURE\s+DIVISION\b/.test(u)) { break; }
      if (!dentro) continue;
      if (!norm.trim())                                  { out.push(bk()); continue; }
      var c0 = norm.trim().charAt(0);
      if (c0 === '*' || c0 === '/')                      { out.push(co(norm.trim().replace(/^[*/]\s*/, ''))); continue; }
      if (_isSecHdr.test(u.replace(/\.$/, ''))) {
        out.push(sep()); out.push(aA(norm.trim())); out.push(sep());
      } else {
        out.push(aB(norm.trim()));
      }
    }
    if (!temData) {
      out.push(aA('FILE SECTION.')); out.push(bk());
      out.push(sep()); out.push(aA('WORKING-STORAGE SECTION.')); out.push(sep()); out.push(bk());
      if (temLinkage) {
        out.push(sep()); out.push(aA('LINKAGE SECTION.')); out.push(sep()); out.push(bk());
      }
    }
  })();
  out.push(bk());

  /* PROCEDURE DIVISION */
  out.push(sep()); out.push(aA('PROCEDURE DIVISION' + usingClause + '.')); out.push(sep());
  out.push(bk());

  var estrutura       = meta.estrutura       || {};
  var tipos           = meta.tipos           || {};
  var ordemParagrafos = meta.ordemParagrafos || [];

  ordemParagrafos.forEach(function(nome) {
    var tipo   = tipos[nome] || 'paragrafo';
    var linhas = estrutura[nome] || [];
    out.push(sep());
    if (tipo === 'section') {
      out.push(aA(nome + ' SECTION.')); out.push(sep());
      linhas.forEach(function(l) { if (l.trim()) out.push(aB(l)); });
    } else if (tipo === 'fim-paragrafo') {
      out.push(aA(nome + '.')); out.push(sep());
      out.push(aB('EXIT.'));
    } else {
      out.push(aA(nome + '.')); out.push(sep());
      linhas.filter(function(l) {
        var u = l.trim().toUpperCase().replace(/\.$/, '');
        return l.trim() && u !== 'EXIT' && u !== 'EXIT PARAGRAPH' && u !== 'EXIT SECTION';
      }).forEach(function(l) { out.push(aB(l)); });
    }
    out.push(bk());
  });

  var cblBlob = new Blob([out.join('\n')], { type: 'text/plain;charset=utf-8' });
  _download(URL.createObjectURL(cblBlob), prog.toLowerCase() + '.cbl');
  fecharExportMenu();
}

/** =====================================================
 *  SESS\u00c3O: exportar e importar tudo
 *  Formato: JSON com { version, program, cobol, layout,
 *           zoom, pan, positions, comments }
 * ===================================================== */
function exportarSessao() {
  var cobol = (document.getElementById('input') || {}).value || '';
  var layout = (document.getElementById('layout-select') || {}).value || 'tb';
  var depthSel = (document.getElementById('depth-select') || {}).value || '30';
  var positions = {};
  var zoom = 1, pan = { x: 0, y: 0 };
  if (cy) {
    zoom = cy.zoom();
    pan  = cy.pan();
    cy.nodes().forEach(function(no) {
      positions[no.id()] = no.position();
    });
  }
  var comments = window._getComments ? window._getComments() : {};
  var prog = cobol.match(/PROGRAM-ID\.?\s+([A-Z0-9][A-Z0-9-]*)/i);
  // Serializa books: salva fonte e layout (sem referências circulares)
  var booksData = (typeof _bkBooks !== 'undefined' ? _bkBooks : []).map(function(b) {
    return { id: b.id, name: b.name, color: b.color, src: b.src, layout: b.layout };
  });
  var sessao = {
    version:   '1.0',
    program:   prog ? prog[1].toUpperCase() : 'COBOL',
    savedAt:   new Date().toISOString(),
    cobol:     cobol,
    layout:    layout,
    maxDepth:  parseInt(depthSel, 10) || (_currentMeta && _currentMeta.maxDepth) || 30,
    zoom:      zoom,
    pan:       pan,
    positions: positions,
    comments:  comments,
    books:     booksData,
    booksNextId: (typeof _bkNextId !== 'undefined' ? _bkNextId : 1),
    bkKeyRules: (typeof _bkDataKeyRule !== 'undefined' ? JSON.parse(JSON.stringify(_bkDataKeyRule)) : {}),
    bkDataStore: (typeof _bkDataStore !== 'undefined' ? JSON.parse(JSON.stringify(_bkDataStore)) : {}),
    simVarsInitial: (typeof _simVarsInitial !== 'undefined' ? JSON.parse(JSON.stringify(_simVarsInitial)) : {})
  };
  var json = JSON.stringify(sessao, null, 2);
  var nome = (sessao.program || 'sessao').toLowerCase() + '-fluxo.json';
  fecharExportMenu();

  // Tenta showSaveFilePicker (Chrome/Edge desktop) � permite escolher pasta
  if (window.showSaveFilePicker) {
    window.showSaveFilePicker({
      suggestedName: nome,
      types: [{ description: 'Sess\u00e3o COBOL Flow (JSON)', accept: { 'application/json': ['.json'] } }]
    }).then(function(handle) {
      return handle.createWritable();
    }).then(function(writable) {
      return writable.write(json).then(function() { return writable.close(); });
    }).catch(function(err) {
      if (err.name !== 'AbortError') { _downloadJsonSeguro(json, nome); }
    });
  } else {
    _downloadJsonSeguro(json, nome);
  }
}

/**
 * Download de JSON seguro para todos os browsers.
 * Usa Blob URL (sem limite de tamanho), com data URL como fallback para iOS/mobile.
 */
function _downloadJsonSeguro(json, nome) {
  try {
    // Blob URL: sem limite de tamanho (funciona em todos os browsers modernos)
    var blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    var url  = URL.createObjectURL(blob);
    _download(url, nome);
  } catch(e) {
    try {
      // Fallback data URL para ambientes sem createObjectURL (iOS antigo)
      var dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
      _download(dataUrl, nome);
    } catch(e2) {
      // Último recurso: exibe o JSON em janela para o usuário copiar
      var w = window.open('', '_blank');
      if (w) {
        w.document.write('<pre style="font-size:13px;word-break:break-all">' +
          json.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</pre>');
        w.document.title = nome;
      }
    }
  }
}

function importarSessao(event) {
  var file = event.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var sessao;
    try {
      // Remove BOM (\uFEFF) que alguns sistemas mobile adicionam ao salvar
      var text = e.target.result.replace(/^\uFEFF/, '');
      sessao = JSON.parse(text);
    }
    catch(err) { alert('Arquivo de sess\u00e3o inv\u00e1lido (JSON corrompido).\n\nDetalhe: ' + err.message); return; }
    if (!sessao || !sessao.cobol) { alert('Arquivo de sess\u00e3o inv\u00e1lido (campo cobol ausente).'); return; }

    // -- LIMPEZA COMPLETA antes de restaurar ------------------
    // 1) Limpa textarea
    var ta = document.getElementById('input');
    if (ta) ta.value = '';

    // 2) Destroi diagrama
    if (cy) { cy.destroy(); cy = null; }
    var cyDiv = document.getElementById('cy');
    if (cyDiv) cyDiv.innerHTML = '';

    // 3) Limpa painel de detalhes
    var det = document.getElementById('details');
    if (det) det.innerHTML = '<span style="color:#aaa;font-size:11px;">Clique em um n&#243; para ver detalhes</span>';

    // 4) Limpa coment�rios
    if (window._setComments) window._setComments({});

    // 5) Reseta estado do painel de coment�rios (campo de edi��o)
    var cmTA = document.getElementById('comments-textarea');
    if (cmTA) { cmTA.value = ''; cmTA.disabled = true; }
    var cmName = document.getElementById('comments-node-name');
    if (cmName) { cmName.textContent = 'nenhum selecionado'; cmName.style.fontStyle = 'italic'; cmName.style.color = '#bbb'; }
    var cmSv = document.getElementById('btn-comment-save');
    if (cmSv) cmSv.disabled = true;
    var cmDl = document.getElementById('btn-comment-del');
    if (cmDl) cmDl.disabled = true;
    var cmPv = document.getElementById('comments-current-preview');
    if (cmPv) cmPv.style.display = 'none';
    if (window._resetLastPara) window._resetLastPara();
    // ---------------------------------------------------------

    // Restaura código COBOL
    if (ta) { ta.value = sessao.cobol; updateCobolEditor(); }

    // Restaura layout
    var sel = document.getElementById('layout-select');
    if (sel && sessao.layout) sel.value = sessao.layout;

    // Restaura maxDepth salvo (evita que fluxo seja cortado ao reabrir sessão)
    if (sessao.maxDepth) {
      window._maxDepthOverride = sessao.maxDepth;
      var dSel = document.getElementById('depth-select');
      if (dSel) {
        var _dv;
        if      (sessao.maxDepth >= 100) _dv = '999'; // "Tudo (pode ser lento)"
        else if (sessao.maxDepth >= 10) _dv = '30';
        else if (sessao.maxDepth >= 5)  _dv = '6';
        else if (sessao.maxDepth >= 3)  _dv = '3';
        else if (sessao.maxDepth >= 2)  _dv = '2';
        else if (sessao.maxDepth >= 1)  _dv = '1';
        else                            _dv = '0';
        dSel.value = _dv;
      }
    }

    // Gera fluxo
    analisar();

    // Restaura posi��es, zoom, pan e coment�rios ap�s o layout estabilizar
    setTimeout(function() {
      if (cy && sessao.positions && Object.keys(sessao.positions).length) {
        cy.startBatch();
        cy.nodes().forEach(function(no) {
          var pos = sessao.positions[no.id()];
          if (pos) no.position(pos);
        });
        cy.endBatch();
      }
      if (cy) {
        cy.zoom(sessao.zoom || 1);
        cy.pan(sessao.pan   || { x: 0, y: 0 });
      }
      if (window._setComments && sessao.comments) {
        window._setComments(sessao.comments);
      }
      if (window._refreshParaOffsets) window._refreshParaOffsets();

      // Restaura books
      if (sessao.books && Array.isArray(sessao.books) && typeof _bkBooks !== 'undefined') {
        _bkBooks    = sessao.books;
        _bkNextId   = sessao.booksNextId || (_bkBooks.length ? Math.max.apply(null, _bkBooks.map(function(b){return b.id;})) + 1 : 1);
        _bkActiveId = _bkBooks.length ? _bkBooks[_bkBooks.length - 1].id : null;
        // Restaura regras de chave discriminadora
        if (sessao.bkKeyRules && typeof _bkDataKeyRule !== 'undefined') {
          Object.keys(_bkDataKeyRule).forEach(function(k){ delete _bkDataKeyRule[k]; });
          Object.assign(_bkDataKeyRule, JSON.parse(JSON.stringify(sessao.bkKeyRules)));
          _bkKeySave();
        }
        var ab = bkGetActive();
        var ta2 = document.getElementById('book-textarea');
        if (ta2) { ta2.value = ab ? ab.src : ''; if (typeof updateBookEditor === 'function') updateBookEditor(); }
        var pi = document.getElementById('bk-parse-info');
        if (pi) pi.textContent = (ab && ab.layout.length) ? bkSummary(ab) : '';
        // Restaura dados importados nos books
        if (sessao.bkDataStore && typeof _bkDataStore !== 'undefined') {
          Object.keys(_bkDataStore).forEach(function(k){ delete _bkDataStore[k]; });
          Object.assign(_bkDataStore, JSON.parse(JSON.stringify(sessao.bkDataStore)));
        }
        bkRenderBookList();
        bkRenderRight();
      }
      // Restaura valores iniciais do simulador
      if (sessao.simVarsInitial && typeof _simVarsInitial !== 'undefined') {
        Object.keys(_simVarsInitial).forEach(function(k){ delete _simVarsInitial[k]; });
        Object.assign(_simVarsInitial, JSON.parse(JSON.stringify(sessao.simVarsInitial)));
      }
    }, 400);
  };
  reader.readAsText(file, 'UTF-8');  // encoding explícito evita problemas em mobile
  event.target.value = '';
}

function _mostrarErroFluxo(titulo, msg, dica) {
  document.getElementById('cy-erro-titulo').textContent = titulo;
  document.getElementById('cy-erro-msg').textContent   = msg || '';
  document.getElementById('cy-erro-dica').textContent  = dica || '';
  document.getElementById('cy-erro').classList.add('ativo');
}

// Atualiza barra de progresso e etapa no overlay de carregamento
function _setProgresso(pct, etapa) {
  var bar  = document.getElementById('cy-loading-bar');
  var step = document.getElementById('cy-loading-step');
  if (bar)  bar.style.width  = pct + '%';
  if (step) step.textContent = etapa || '';
}

function analisar() {
  const code = document.getElementById("input").value;
  if (!code || !code.trim()) {
    _mostrarErroFluxo(
      'Nenhum c\u00f3digo para analisar',
      'O campo de c\u00f3digo est\u00e1 vazio.',
      'Cole ou importe um programa COBOL e clique em Gerar Fluxo.'
    );
    return;
  }

  // Oculta painel de erro anterior
  document.getElementById('cy-erro').classList.remove('ativo');

  // ── Limpeza ao importar novo mapa ────────────────────────────
  // Para o simulador se estiver rodando (mantém books intactos)
  if (typeof simStop === 'function' && window._sim && _sim.on) simStop(true);
  // Fecha mapa de execução se aberto
  var _emOvl = document.getElementById('exec-map-overlay');
  if (_emOvl && _emOvl.classList.contains('em-open')) execMapClose();
  // Limpa modal de reinício se aberto
  var _rmOvl = document.getElementById('sim-restart-modal');
  if (_rmOvl) _rmOvl.classList.remove('open');
  // Limpa log do mapa de execução
  if (typeof _emLogHistory !== 'undefined') _emLogHistory = [];
  var _emLogEl = document.getElementById('em-log-list');
  if (_emLogEl) _emLogEl.innerHTML = '';
  // Limpa breakpoints do diagrama anterior
  if (typeof _emBreakLines !== 'undefined') _emBreakLines.clear();
  // Limpa comentários do diagrama
  if (typeof window._setComments === 'function') window._setComments({});
  // ─────────────────────────────────────────────────────────────

  // Conta linhas para exibir info no overlay
  const nLinhas = code.split('\n').length;
  const subEl = document.getElementById('cy-loading-sub');
  if (subEl) subEl.textContent = nLinhas.toLocaleString('pt-BR') + ' linha' + (nLinhas !== 1 ? 's' : '') + ' \u2014 aguarde...';

  // Mobile: j\u00e1 muda para aba Diagrama antes de processar
  if (typeof mobTab === 'function' && window.innerWidth <= 600) { mobTab('flow'); }

  // Oculta barra de navegação enquanto regenera
  var _dgbEl = document.getElementById('diag-nav-bar');
  if (_dgbEl) _dgbEl.classList.remove('visible');

  // Exibe overlay e inicializa progresso
  const loadEl = document.getElementById('cy-loading');
  if (loadEl) loadEl.classList.add('ativo');
  _setProgresso(0, '');

  // -- Etapa 1: Parse COBOL --
  setTimeout(function() {
    _setProgresso(10, 'Lendo estrutura do programa...');
    var sel, maxDepth, meta;
    setTimeout(function() {
      try {
        _setProgresso(20, 'Identificando par\u00e1grafos e se\u00e7\u00f5es...');
        sel = document.getElementById("depth-select");
        maxDepth = sel ? parseInt(sel.value, 10) : (window._maxDepthOverride || 30);
        window._maxDepthOverride = null;
        meta = parseCobol(code);
        meta.maxDepth = maxDepth;
        _currentMeta = meta;
      } catch(err) {
        _mostrarErroFluxo(
          'Erro ao analisar o programa',
          err && err.message ? err.message : String(err),
          'Verifique se o c\u00f3digo COBOL est\u00e1 bem formado e tente novamente.'
        );
        if (loadEl) loadEl.classList.remove('ativo');
        return;
      }

      // -- Etapa 2: Gerar fluxo --
      _setProgresso(35, 'Construindo grafo de fluxo...');
      setTimeout(function() {
        var fluxo;
        try {
          _setProgresso(55, 'Expandindo PERFORM e estruturas de controle...');
          const { estrutura, tipos, secoes } = meta;
          const _viewSel = document.getElementById('view-select');
          const _viewMode = _viewSel ? _viewSel.value : 'detail';
          fluxo = (_viewMode === 'macro')
            ? gerarMacroFluxo(meta)
            : gerarFluxo(estrutura, tipos, secoes, meta);
        } catch(err) {
          _mostrarErroFluxo(
            'Erro ao gerar o fluxo',
            err && err.message ? err.message : String(err),
            'Verifique se o c\u00f3digo COBOL est\u00e1 bem formado e tente novamente. Se o problema persistir, simplifique o trecho que causa o erro.'
          );
          if (loadEl) loadEl.classList.remove('ativo');
          return;
        }

        // Verifica se o fluxo gerou n\u00f3s reais
        const nosReais = fluxo.filter(function(e){ return e.data && e.data.id && !e.data.source; });
        if (!nosReais.length) {
          const temProc = /PROCEDURE\s+DIVISION/i.test(code);
          const msg     = !temProc
            ? 'PROCEDURE DIVISION n\u00e3o encontrado no c\u00f3digo.'
            : 'O PROCEDURE DIVISION foi encontrado mas nenhum par\u00e1grafo ou instru\u00e7\u00e3o foi detectado.';
          const dica = !temProc
            ? 'Verifique se o c\u00f3digo cont\u00e9m a linha "PROCEDURE DIVISION" (obrigat\u00f3ria para gerar o fluxo).'
            : 'Certifique-se de que os par\u00e1grafos est\u00e3o no formato correto: NOME-DO-PARAGRAFO. ou NOME-DO-PARAGRAFO SECTION.';
          _mostrarErroFluxo('Fluxo vazio \u2014 nenhum n\u00f3 gerado', msg, dica);
          if (loadEl) loadEl.classList.remove('ativo');
          return;
        }

        // -- Etapa 3: Renderizar diagrama --
        _setProgresso(70, 'Renderizando ' + nosReais.length + ' n\u00f3s no diagrama...');
        setTimeout(function() {
          try {
            _setProgresso(85, 'Aplicando layout e posicionando elementos...');
            desenhar(fluxo, meta);
          } catch(err) {
            _mostrarErroFluxo(
              'Erro ao renderizar o diagrama',
              err && err.message ? err.message : String(err),
              'O fluxo foi gerado mas houve falha ao desenhar. Tente o layout Compacto.'
            );
            if (loadEl) loadEl.classList.remove('ativo');
            return;
          }

          // -- Etapa 4: Finalizar --
          _setProgresso(95, 'Finalizando...');
          setTimeout(function() {
            if (window._refreshParaOffsets) window._refreshParaOffsets();
            _atualizarIDE(meta);
            if (typeof _repAnalyzeFlow === 'function') _repAnalyzeFlow();
            _setProgresso(100, 'Pronto!');
            var _dgb = document.getElementById('diag-nav-bar');
            if (_dgb) _dgb.classList.add('visible');
            setTimeout(function() {
              if (loadEl) loadEl.classList.remove('ativo');
              _setProgresso(0, '');
            }, 300);
          }, 20);
        }, 20);
      }, 20);
    }, 20);
  }, 30);
}

/**
 * Executa o layout dagre com fallback para breadthfirst.
 * O dagre usa DFS recursivo internamente (rankers network-simplex e longest-path):
 * em grafos grandes (500+ n�s encadeados) isso estoura a pilha JS com
 * "Maximum call stack size exceeded" antes de qualquer guarda no c�digo de renderiza��o.
 * Executando o layout aqui, fora do construtor do cytoscape, podemos capturar o erro
 * e acionar o breadthfirst (completamente iterativo, nunca estoura) como fallback.
 */
function _rodarLayout() {
  if (!cy) return;
  try {
    cy.layout(getLayoutConfig()).run();
  } catch (eLayout) {
    try {
      cy.layout({
        name: 'breadthfirst',
        directed: true,
        fit: true,
        padding: 40,
        spacingFactor: 1.0
      }).run();
    } catch (eFallback) { /* mant�m posi��es atuais como �ltimo recurso */ }
  }
}

// Retorna config do layout conforme sele��o do usu�rio
function getLayoutConfig() {
  const v = (document.getElementById('layout-select') || {}).value || 'tb';

  // Espa�amento adaptativo: grafos maiores recebem valores menores para compactar o fluxo.
  // Escala linear entre (nMin, espMin) e (nMax, espMax).
  function _escalar(nNodes, nMin, nMax, espMin, espMax) {
    if (nNodes <= nMin) return espMax;
    if (nNodes >= nMax) return espMin;
    var t = (nNodes - nMin) / (nMax - nMin);
    return Math.round(espMax - t * (espMax - espMin));
  }
  var nNodes = cy ? cy.nodes().length : 0;
  // Quando há nós EVALUATE, aumenta nodeSep para acomodar fan-out com múltiplos ramos WHEN
  var nEvaluate = cy ? cy.nodes('[tipo="evaluate"]').length : 0;
  var nodeSepAdapt = _escalar(nNodes, 20, 200, 20, 80);
  if (nEvaluate > 0) nodeSepAdapt = Math.max(nodeSepAdapt, 50);
  var rankSepAdapt = _escalar(nNodes, 20, 200, 28, 55);
  var edgeSepAdapt = _escalar(nNodes, 20, 200, 8,  25);
  if (nEvaluate > 0) edgeSepAdapt = Math.max(edgeSepAdapt, 18);

  const base = {
    fit: true, animate: false, padding: 40,
    minLen: function(edge) {
      if (edge.data('minLen')) return edge.data('minLen');
      return edge.data('label') ? 2 : 1;
    }
  };

  // Para grafos grandes o dagre fica lento (O(V×E×logV)).
  // Breadthfirst é O(V+E) e suporta milhares de nós sem travar.
  if (nNodes > 800) {
    return { name: 'breadthfirst', directed: true, fit: true, padding: 40,
             spacingFactor: 1.1, animate: false };
  }

  if (v === 'lr') {
    // Usamos dagre TB como base; aplicarLayoutColunas() separa os par�grafos em colunas verticais
    // dispostas da esquerda para a direita conforme a ordem de chamada no COBOL.
    return Object.assign({}, base, {
      name: 'dagre', rankDir: 'TB',
      nodeSep: nodeSepAdapt, rankSep: rankSepAdapt, edgeSep: edgeSepAdapt,
      ranker: 'network-simplex'
    });
  }
  if (v === 'grid') {
    return Object.assign({}, base, {
      name: 'dagre', rankDir: 'TB',
      nodeSep: Math.max(16, nodeSepAdapt - 10), rankSep: Math.max(20, rankSepAdapt - 8), edgeSep: Math.max(6, edgeSepAdapt - 4),
      ranker: 'longest-path'
    });
  }
  if (v === 'compact') {
    return Object.assign({}, base, {
      name: 'dagre', rankDir: 'TB',
      nodeSep: Math.max(12, nodeSepAdapt - 20), rankSep: Math.max(16, rankSepAdapt - 14), edgeSep: Math.max(4, edgeSepAdapt - 6),
      ranker: 'tight-tree'
    });
  }
  // tb (padr�o)
  return Object.assign({}, base, {
    name: 'dagre', rankDir: 'TB',
    nodeSep: nodeSepAdapt, rankSep: rankSepAdapt, edgeSep: edgeSepAdapt,
    ranker: 'network-simplex'
  });
}

// Layout de colunas por par�grafo � layout "cobra":
// Passo 1: Posiciona cada coluna no eixo X lado a lado, come�ando em PAD_TOP.
// Passo 2: Alinha o in�cio (cabe�alho) de cada coluna N com o fim (?) da coluna N-1,
//          fazendo o fluxo continuar verticalmente de uma coluna para a pr�xima.
// Layout exclusivo para Macro-Fluxo:
// Empilha os nós verticalmente em cada coluna (col 0 = entradas, col 1 = processos, col 2 = saídas).
// Não usa Dagre para posicionamento final — aplica posições manuais diretamente.
function aplicarLayoutMacro() {
  if (!cy) return;

  var COL_X    = [160, 480, 800];   // X central de cada coluna
  var NODE_H   = 50;                // altura estimada por nó
  var NODE_GAP = 30;                // espaço vertical entre nós da mesma coluna
  var FIRST_Y  = 60;                // Y do primeiro processo

  // --- Col 1: processos — ordena pelo Y atual (Dagre já sequenciou) ---
  var col1 = cy.nodes().filter(function(n) { return n.data('col') === 1; });
  var col1arr = col1.toArray().sort(function(a, b) {
    return a.position('y') - b.position('y');
  });
  var y1 = FIRST_Y;
  col1arr.forEach(function(n) {
    var nh = (n.height() || NODE_H);
    n.position({ x: COL_X[1], y: y1 + nh / 2 });
    y1 += nh + NODE_GAP;
  });
  var firstProcY = col1arr.length ? col1arr[0].position('y') : FIRST_Y;
  var lastProcY  = col1arr.length ? col1arr[col1arr.length - 1].position('y') : FIRST_Y;
  var midProcY   = (firstProcY + lastProcY) / 2;

  // --- Col 0: entradas — empilha centrada no meio de col 1 ---
  var col0arr = cy.nodes().filter(function(n) { return n.data('col') === 0; }).toArray();
  var h0 = col0arr.reduce(function(s, n) { return s + (n.height() || NODE_H) + NODE_GAP; }, -NODE_GAP);
  var y0 = midProcY - h0 / 2;
  col0arr.forEach(function(n) {
    var nh = (n.height() || NODE_H);
    n.position({ x: COL_X[0], y: y0 + nh / 2 });
    y0 += nh + NODE_GAP;
  });

  // --- Col 2: saídas — empilha centrada no Y do último processo ---
  var col2arr = cy.nodes().filter(function(n) { return n.data('col') === 2; }).toArray();
  var h2 = col2arr.reduce(function(s, n) { return s + (n.height() || NODE_H) + NODE_GAP; }, -NODE_GAP);
  var y2 = lastProcY - h2 / 2;
  col2arr.forEach(function(n) {
    var nh = (n.height() || NODE_H);
    n.position({ x: COL_X[2], y: y2 + nh / 2 });
    y2 += nh + NODE_GAP;
  });

  // Arestas entre colunas diferentes: bezier suave
  cy.edges().forEach(function(e) {
    var sc = e.source().data('col') != null ? e.source().data('col') : 0;
    var tc = e.target().data('col') != null ? e.target().data('col') : 0;
    if (sc !== tc) e.style({ 'curve-style': 'bezier' });
  });
}

function aplicarLayoutColunas() {
  if (!cy) return;
  var allNodes = cy.nodes();
  if (!allNodes.length) return;

  // Agrupar n�s por coluna
  var colGroups = {};
  allNodes.forEach(function(n) {
    var c = n.data('col') != null ? n.data('col') : 0;
    if (!colGroups[c]) colGroups[c] = [];
    colGroups[c].push(n);
  });

  var indices = Object.keys(colGroups).map(Number).sort(function(a, b) { return a - b; });
  if (!indices.length) return;

  var GAP = 80;
  var PAD_TOP = 60;
  var currentX = 60;

  // === PASSO 1: Posicionar X e resetar Y de cada coluna para PAD_TOP ===
  indices.forEach(function(ci) {
    var group = colGroups[ci];
    if (!group.length) return;

    var minX = Infinity, maxX = -Infinity, minY = Infinity;
    group.forEach(function(n) {
      var p = n.position();
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
    });

    var maxHalfW = 0;
    group.forEach(function(n) {
      var hw = (n.width() || 160) / 2;
      if (hw > maxHalfW) maxHalfW = hw;
    });

    var halfSpan = (maxX - minX) / 2;
    var newCenterX = currentX + maxHalfW + halfSpan;
    var dx = newCenterX - (minX + maxX) / 2;
    var dy = PAD_TOP - minY;

    group.forEach(function(n) {
      n.position({ x: n.position().x + dx, y: n.position().y + dy });
    });

    currentX = newCenterX + halfSpan + maxHalfW + GAP;
  });

  // === PASSO 2: Layout "cobra" � alinha in�cio de col N com o fim de col N-1 ===
  // Encontra a aresta que cruza de col N-1 para col N e alinha o n� destino ao n� fonte.
  var maxColIdx = indices[indices.length - 1];
  for (var ci2 = 1; ci2 <= maxColIdx; ci2++) {
    var group2 = colGroups[ci2];
    if (!group2 || !group2.length) continue;

    // Procura aresta vindo da coluna imediatamente anterior
    var entryEdge = null;
    cy.edges().forEach(function(e) {
      if (entryEdge) return;
      var sc = e.source().data('col') != null ? e.source().data('col') : 0;
      var tc = e.target().data('col') != null ? e.target().data('col') : 0;
      if (sc === ci2 - 1 && tc === ci2) entryEdge = e;
    });
    // Fallback: qualquer aresta de coluna anterior para esta
    if (!entryEdge) {
      cy.edges().forEach(function(e) {
        if (entryEdge) return;
        var sc = e.source().data('col') != null ? e.source().data('col') : 0;
        var tc = e.target().data('col') != null ? e.target().data('col') : 0;
        if (sc < ci2 && tc === ci2) entryEdge = e;
      });
    }
    if (!entryEdge) continue;

    // Alinha o n� de entrada desta coluna com o n� de sa�da da coluna anterior
    var sourceY = entryEdge.source().position().y;
    var targetY = entryEdge.target().position().y;
    var dy2 = sourceY - targetY;
    if (Math.abs(dy2) > 0.5) {
      group2.forEach(function(n) {
        n.position({ x: n.position().x, y: n.position().y + dy2 });
      });
    }
  }

  // Arestas entre colunas distintas ficam em bezier
  cy.edges().forEach(function(e) {
    var sc = e.source().data('col') != null ? e.source().data('col') : 0;
    var tc = e.target().data('col') != null ? e.target().data('col') : 0;
    if (sc !== tc) {
      e.style({ 'curve-style': 'bezier' });
    }
  });
}

// Repositionamento p�s-layout: separa merge do loop para abaixo do corpo
function aplicarPosLayoutLoop() {
  if (!cy) return;
  cy.nodes('[tipo="loop"]').forEach(function(loopNode) {
    var fimEdges  = loopNode.outgoers('edge').filter(function(e){ return e.data('label') === 'FIM';  });
    var loopEdges = loopNode.outgoers('edge').filter(function(e){ return e.data('label') === 'LOOP'; });
    if (!fimEdges.length || !loopEdges.length) return;
    var mergeNode = fimEdges[0].target();
    var bodyFirst = loopEdges[0].target();
    var loopNodeId = loopNode.id();
    var visited = new Set([loopNodeId]);
    // Sempre TB antes de qualquer rota��o � eixo de loop � sempre Y
    var axisIsHorizontal = false;
    var maxPos = loopNode.position().y;
    // Iterativo (pilha expl�cita) � evita stack overflow em grafos grandes
    var stack = [bodyFirst];
    while (stack.length) {
      var cur = stack.pop();
      if (visited.has(cur.id())) continue;
      visited.add(cur.id());
      var p = axisIsHorizontal ? cur.position().x : cur.position().y;
      if (p > maxPos) maxPos = p;
      cur.outgoers('node').forEach(function(child) { stack.push(child); });
    }
    var nTotal = cy ? cy.nodes().length : 0;
    var GAP = nTotal > 80 ? 40 : nTotal > 40 ? 60 : 90;
    var target = maxPos + GAP;
    var current = axisIsHorizontal ? mergeNode.position().x : mergeNode.position().y;
    var delta = target - current;
    if (delta <= 0) return;
    if (axisIsHorizontal) {
      mergeNode.position('x', mergeNode.position().x + delta);
      mergeNode.successors('node').forEach(function(n){ n.position('x', n.position().x + delta); });
    } else {
      mergeNode.position('y', mergeNode.position().y + delta);
      mergeNode.successors('node').forEach(function(n){ n.position('y', n.position().y + delta); });
    }
  });
}

// Detecta arestas longas (distância entre nós > limiar) e aplica curva bezier lateral.
// Evita que setas longas passem sobre nós intermediários no layout TB.
function _ajustarArestasLongas() {
  if (!cy) return;
  var DIST_LIMIAR = 220; // px: arestas acima disto recebem curva lateral
  cy.edges().forEach(function(e) {
    if (e.data('label')) return; // arestas com label (IF/LOOP/FIM) já têm estilo próprio
    var sp = e.source().position();
    var tp = e.target().position();
    if (!sp || !tp) return;
    var dist = Math.sqrt(
      (tp.x - sp.x) * (tp.x - sp.x) + (tp.y - sp.y) * (tp.y - sp.y)
    );
    if (dist > DIST_LIMIAR) {
      // Curva proporcional ao comprimento, máximo 180px de desvio lateral
      var cpDist = Math.min(50 + dist * 0.18, 180);
      e.style({
        'curve-style': 'bezier',
        'control-point-distances': cpDist,
        'control-point-weights': 0.5
      });
    }
  });
}

// Reorganiza sem regerar o fluxo (aplica s� novo layout)
function reorganizar() {
  if (!cy) return;

  var loadEl = document.getElementById('cy-loading');
  var subEl  = document.getElementById('cy-loading-sub');
  if (subEl) subEl.textContent = 'Reorganizando layout...';
  if (loadEl) loadEl.classList.add('ativo');
  _setProgresso(10, 'Calculando novo layout...');

  setTimeout(function() {
    _setProgresso(40, 'Aplicando dagre...');
    _rodarLayout();
    var _modo = ((document.getElementById('layout-select') || {}).value || 'tb');
    _setProgresso(70, 'Ajustando posições...');
    setTimeout(function() {
      if (_modo === 'lr') {
        aplicarPosLayoutLoop();
        aplicarLayoutColunas();
        _ajustarArestasLongas();
      } else {
        aplicarPosLayoutLoop();
        _ajustarArestasLongas();
      }
      cy.fit(undefined, 50);
      cy.center();
      atualizarZoomLabel();
      _setProgresso(100, 'Pronto!');
      var _dgb = document.getElementById('diag-nav-bar');
      if (_dgb) _dgb.classList.add('visible');
      setTimeout(function() {
        if (loadEl) loadEl.classList.remove('ativo');
        _setProgresso(0, '');
      }, 300);
    }, 50);
  }, 30);
}

// ================= ZOOM CONTROLS =================
function atualizarZoomLabel() {
  if (!cy) return;
  var pct = Math.round(cy.zoom() * 100) + "%";
  document.getElementById("zoom-level").textContent = pct;
  var sbZoom = document.getElementById("sb-zoom");
  if (sbZoom) sbZoom.textContent = pct;
}

/* ===== IDE STATUS / TITLEBAR ===== */
function _atualizarIDE(meta) {
  if (!meta) return;
  var prog = (meta.programId || '').trim() || '—';
  var nos  = typeof cy !== 'undefined' && cy ? cy.nodes().length : 0;
  var arestas = typeof cy !== 'undefined' && cy ? cy.edges().length : 0;

  // Titlebar
  var progEl = document.getElementById('ide-prog-name');
  if (progEl) progEl.textContent = prog === '—' ? '—' : prog;

  // Badge na titlebar
  var badge = document.getElementById('ide-node-badge');
  if (badge) {
    if (nos > 0) { badge.textContent = nos + ' nós'; badge.classList.add('visible'); }
    else { badge.textContent = ''; badge.classList.remove('visible'); }
  }

  // Status bar
  var sbProg = document.getElementById('sb-program');
  if (sbProg) sbProg.textContent = prog !== '—' ? prog : 'Nenhum programa aberto';
  var sbNodes = document.getElementById('sb-nodes');
  if (sbNodes) sbNodes.textContent = nos > 0 ? nos + ' nós · ' + arestas + ' ligações' : '—';

  // Canvas header info
  var canvasInfo = document.getElementById('ide-canvas-info');
  if (canvasInfo && nos > 0) canvasInfo.textContent = nos + ' nós';
}


function zoomIn() {
  if (!cy) return;
  cy.zoom({ level: cy.zoom() * 1.2, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  atualizarZoomLabel();
}

function zoomOut() {
  if (!cy) return;
  cy.zoom({ level: cy.zoom() / 1.2, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  atualizarZoomLabel();
}

function zoomFit() {
  if (!cy) return;
  cy.fit(undefined, 50);
  cy.center();
  atualizarZoomLabel();
}

// Navega at� o n� de entrada do fluxo com zoom confort�vel
function irParaInicio() {
  if (!cy) return;
  var id = window._entryNodeId;
  var entryNode = id ? cy.getElementById(id) : null;
  if (!entryNode || !entryNode.length) {
    // Fallback: n� com menor Y que n�o seja merge
    entryNode = cy.nodes().filter(function(n){ return n.data('tipo') !== 'merge'; })
                   .min(function(n){ return n.position().y; }).ele;
  }
  if (!entryNode || !entryNode.length) { cy.fit(undefined, 50); atualizarZoomLabel(); return; }

  var targetZoom = Math.min(Math.max(cy.zoom(), 0.8), 1.2);
  cy.animate({
    zoom: targetZoom,
    center: { eles: entryNode }
  }, { duration: 400, easing: 'ease-in-out-cubic',
    complete: function() {
      // Pisca o n� para chamar aten��o
      entryNode.flashClass('cy-cursor-hl', 800);
      atualizarZoomLabel();
    }
  });
}

// ================= NAVEGA��O: textarea ? diagrama =================
/**
 * Ao mover o cursor no textarea, detecta em qual par�grafo/se��o ele est�
 * e destaca o n� correspondente no diagrama Cytoscape.
 */
(function() {
  var ta = document.getElementById('input');
  if (!ta) return;

  // �ndice de posi��o de in�cio de cada par�grafo no texto:
  // { nome ? charOffset } � recalculado a cada gera��o.
  var _paraOffsets = null;
  var _lastPara = null;

  /** Reconstr�i o mapa nome?charOffset a partir do _currentMeta */
  function buildParaOffsets() {
    if (!_currentMeta) return null;
    var code = ta.value;
    var linhas = code.split('\n');
    var offsets = {};
    var charPos = 0;
    for (var i = 0; i < linhas.length; i++) {
      var raw = linhas[i];
      var trimmed = raw.trim().toUpperCase().replace(/\.$/, '');
      // Cabe�alho de par�grafo/se��o: nome sem espa�os, sem verbos COBOL
      if (_currentMeta.ordemParagrafos && _currentMeta.ordemParagrafos.indexOf(trimmed) !== -1) {
        offsets[trimmed] = charPos;
      }
      charPos += raw.length + 1;
    }
    return offsets;
  }

  /** Retorna o nome do par�grafo onde o cursor est� posicionado */
  function paraEmCursor(cursorPos) {
    if (!_paraOffsets || !_currentMeta) return null;
    var op = _currentMeta.ordemParagrafos || [];
    var ultimo = null;
    for (var pi = 0; pi < op.length; pi++) {
      var name = op[pi];
      var off = _paraOffsets[name];
      if (off == null) continue;
      if (off <= cursorPos) ultimo = name;
      else break;
    }
    return ultimo;
  }

  /** Ao mover cursor no textarea: destaca o n� no diagrama SEM mover o viewport */
  function destacarNoDiagrama(nomeParagrafo) {
    if (!_currentMeta || !nomeParagrafo) return;
    if (nomeParagrafo === _lastPara) return;
    _lastPara = nomeParagrafo;

    // Atualiza o painel de detalhes
    var el = document.getElementById('details');
    if (el) el.innerText = montarDetalhe(nomeParagrafo, _currentMeta);

    // Destaca visualmente o n� � N�O move o viewport
    if (cy) {
      cy.elements().removeClass('cy-cursor-hl');
      var no = cy.nodes('[target="' + nomeParagrafo + '"]');
      if (no && no.length) no.addClass('cy-cursor-hl');
    }
  }

  function onCursorMove() {
    if (_ignorarCursorMove) return;
    if (!_currentMeta || !cy) return;
    if (!_paraOffsets) _paraOffsets = buildParaOffsets();
    var para = paraEmCursor(ta.selectionStart);
    if (para) destacarNoDiagrama(para);
  }

  /** Retorna o indice de linha (0-based) onde o cursor esta */
  function cursorLineIndex() {
    return ta.value.substring(0, ta.selectionStart).split('\n').length - 1;
  }

  /**
   * Ao CLICAR no codigo: tenta encontrar o no exato pela srcLine e faz
   * pan+zoom ate ele. Se nao houver match exato, cai para destaque de paragrafo.
   */
  function onCursorClick() {
    if (_ignorarCursorMove) return;
    if (!_currentMeta || !cy) return;

    var lineIdx = cursorLineIndex();

    // Busca no com srcLine === lineIdx (instrucao, grupo, io, stop, if)
    var matched = cy.nodes().filter(function(n) {
      return n.data('srcLine') === lineIdx;
    });

    if (matched.length) {
      cy.elements().removeClass('cy-cursor-hl');
      cy.elements().removeClass('cy-src-hl');
      var alvo = matched.first();
      // Pan ate o no sem mexer no zoom atual
      cy.animate(
        { center: { eles: alvo } },
        { duration: 320, easing: 'ease-in-out-cubic',
          complete: function() {
            // Destaque forte por 1.2s, depois volta ao cursor-hl suave
            alvo.addClass('cy-src-hl');
            setTimeout(function() {
              alvo.removeClass('cy-src-hl');
              alvo.addClass('cy-cursor-hl');
            }, 1200);
          }
        }
      );
      return;
    }

    // Fallback: destaca somente o paragrafo (sem pan)
    if (!_paraOffsets) _paraOffsets = buildParaOffsets();
    var para = paraEmCursor(ta.selectionStart);
    if (para) destacarNoDiagrama(para);
  }

  // Reconstroi offsets quando o texto muda (import/digitacao)
  ta.addEventListener('input', function() { _paraOffsets = null; _lastPara = null; });

  // Click -> navega ate o no no diagrama; keyup/select -> apenas destaca paragrafo
  ta.addEventListener('click',   onCursorClick);
  ta.addEventListener('keyup',   onCursorMove);
  ta.addEventListener('select',  onCursorMove);

  // Exp�e refresh para ser chamado ap�s Gerar Fluxo
  window._refreshParaOffsets = function() { _paraOffsets = null; _lastPara = null; };
  // Exp�e reset do _lastPara para o handler de clique no diagrama
  window._resetLastPara = function() { _lastPara = null; };
})();

// ================= DIVISOR HORIZONTAL (detalhes) =================
(function() {
  var handle     = document.getElementById('details-divider');
  var details    = document.getElementById('details');
  var cyEl       = document.getElementById('cy');
  var rightPanel = details.parentElement;
  var dragging   = false;
  var startY, startDetailsH, startCyH;

  handle.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;            // so botao esquerdo
    dragging       = true;
    startY         = e.clientY;
    startDetailsH  = details.getBoundingClientRect().height;
    startCyH       = cyEl.getBoundingClientRect().height;
    handle.classList.add('active');
    document.body.style.cursor     = 'row-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    var dy    = startY - e.clientY;        // positivo = arrastar para cima = detalhe maior
    var minCy = 80;                        // canvas nunca fica abaixo de 80px
    var minDt = 40;
    var maxDy = startCyH - minCy;         // quanto posso subir
    var minDy = -(startDetailsH - minDt); // quanto posso descer
    dy = Math.max(minDy, Math.min(maxDy, dy));
    // Define alturas explicitamente para que o flex nao interfira
    details.style.height    = (startDetailsH + dy) + 'px';
    details.style.maxHeight = 'none';
    cyEl.style.flex         = 'none';
    cyEl.style.height       = (startCyH - dy) + 'px';
  });

  document.addEventListener('mouseup', function() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('active');
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
    if (window.cy) window.cy.resize();
  });

  // Touch: no mobile faz TAP para alternar colapsado/expandido; no desktop permite arrastar.
  var _touchMoved = false;
  handle.addEventListener('touchstart', function(e) {
    _touchMoved = false;
    startY = e.touches[0].clientY;
    if (window.innerWidth > 600) {
      dragging = true;
      startH = details.getBoundingClientRect().height;
      handle.classList.add('active');
      document.body.style.userSelect = 'none';
    }
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', function(e) {
    if (Math.abs(e.touches[0].clientY - startY) > 8) _touchMoved = true;
    if (window.innerWidth <= 600 || !dragging || !handle.classList.contains('active')) return;
    var dy = startY - e.touches[0].clientY;
    var rightH = rightPanel.getBoundingClientRect().height;
    var newH = Math.max(48, Math.min(rightH - 80, startH + dy));
    details.style.maxHeight = 'none';
    details.style.height = newH + 'px';
    if (window.cy) window.cy.resize();
  }, { passive: false });

  document.addEventListener('touchend', function() {
    if (window.innerWidth <= 600) {
      if (!_touchMoved) {
        // TAP: alterna entre colapsado (60px) e expandido (42% do painel)
        details.style.maxHeight = 'none';
        var curH = details.getBoundingClientRect().height;
        var rightH = rightPanel.getBoundingClientRect().height;
        var expandedH = Math.round(rightH * 0.42);
        details.style.height = (curH < expandedH - 20) ? expandedH + 'px' : '60px';
        handle.title = (curH < expandedH - 20) ? 'Toque para recolher' : 'Toque para expandir';
        if (window.cy) window.cy.resize();
      }
      _touchMoved = false;
      return;
    }
    if (!dragging || !handle.classList.contains('active')) return;
    dragging = false;
    handle.classList.remove('active');
    document.body.style.userSelect = '';
    if (window.cy) window.cy.resize();
  });
})();

// ================= DIVISOR ARRAST�VEL =================
(function() {
  const divider   = document.getElementById("divider");
  const leftPanel = document.getElementById("left-panel");
  const container = document.querySelector(".container");
  let dragging = false;

  /** Retorna true quando estamos no modo mobile empilhado (flex-direction: column) */
  function isMobile() {
    return window.getComputedStyle(container).flexDirection === 'column';
  }

  function onStart(e) {
    dragging = true;
    divider.classList.add("active");
    document.body.style.cursor = isMobile() ? "row-resize" : "col-resize";
    e.preventDefault();
  }

  function onMove(e) {
    if (!dragging) return;
    var clientX = e.touches ? e.touches[0].clientX : e.clientX;
    var clientY = e.touches ? e.touches[0].clientY : e.clientY;
    var rect = container.getBoundingClientRect();
    if (isMobile()) {
      // Modo mobile: arrasta para redimensionar ALTURA
      var newH = clientY - rect.top;
      var minH = 120;
      var maxH = rect.height * 0.75;
      newH = Math.max(minH, Math.min(maxH, newH));
      leftPanel.style.height = newH + "px";
    } else {
      // Modo desktop: painel COBOL está à direita — calcula pela borda esquerda do painel
      var cPanelEl = document.getElementById('comments-panel');
      var cDivEl   = document.getElementById('comments-divider');
      var cW = (cPanelEl ? cPanelEl.offsetWidth : 0) + (cDivEl ? cDivEl.offsetWidth : 0);
      var available = rect.width - cW;
      var newW = available - (clientX - rect.left);
      var minW = 180;
      var maxW = available * 0.65;
      newW = Math.max(minW, Math.min(maxW, newW));
      leftPanel.style.width = newW + "px";
    }
    if (cy) cy.resize();
  }

  function onEnd() {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove("active");
    document.body.style.cursor = "";
    if (cy) { cy.resize(); cy.fit(undefined, 50); atualizarZoomLabel(); }
  }

  // Mouse
  divider.addEventListener("mousedown", onStart);
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup",   onEnd);

  // Touch (mobile)
  divider.addEventListener("touchstart", onStart, { passive: false });
  document.addEventListener("touchmove",  onMove,  { passive: false });
  document.addEventListener("touchend",   onEnd);

  // Ao redimensionar a janela, redefine a dimens�o for�ada e reajusta o diagrama
  window.addEventListener('resize', function() {
    if (isMobile()) {
      leftPanel.style.width  = '';   // anula o width inline do modo desktop
    } else {
      leftPanel.style.height = '';   // anula o height inline do modo mobile
    }
    if (cy) { cy.resize(); cy.fit(undefined, 50); atualizarZoomLabel(); }
  });
})();

// ================= PAINEL DE COMENT�RIOS =================
(function() {
  // Armazena: nodeId ? { label, texto }
  var _comments = {};
  // N� atualmente selecionado no painel
  var _activeNodeId   = null;
  var _activeNodeLabel = null;

  var _panelOpen = false;
  var _savedTimer = null;

  // Aba ativa: 'bloco' | 'geral'
  var _abaAtiva = 'bloco';

  // Elementos
  function elPanel()     { return document.getElementById('comments-panel'); }
  function elDivider()   { return document.getElementById('comments-divider'); }
  function elBtn()       { return document.getElementById('btn-comentarios'); }
  function elNodeName()  { return document.getElementById('comments-node-name'); }
  function elTA()        { return document.getElementById('comments-textarea'); }
  function elSave()      { return document.getElementById('btn-comment-save'); }
  function elDel()       { return document.getElementById('btn-comment-del'); }
  function elSavedMsg()  { return document.getElementById('comments-saved-msg'); }
  function elList()      { return document.getElementById('comments-list'); }
  function elPreview()   { return document.getElementById('comments-current-preview'); }
  function elBadge()     { return document.getElementById('comments-badge'); }

  /** Troca entre as abas Bloco / Geral */
  function mudarAbaComentario(aba) {
    _abaAtiva = aba;
    ['bloco','geral'].forEach(function(a) {
      document.getElementById('tab-' + a).classList.toggle('active', a === aba);
      document.getElementById('pane-' + a).classList.toggle('active', a === aba);
    });
    if (aba === 'geral') renderizarLista();
  }
  window.mudarAbaComentario = mudarAbaComentario;

  /** Abre ou fecha o painel */
  function toggleComentarios() {
    _panelOpen = !_panelOpen;
    var panel   = elPanel();
    var divider = elDivider();
    var btn     = elBtn();
    if (_panelOpen) {
      panel.classList.add('open');
      divider.classList.add('open');
      btn.classList.add('active');
    } else {
      panel.classList.remove('open');
      divider.classList.remove('open');
      btn.classList.remove('active');
    }
    if (cy) { cy.resize(); }
  }
  window.toggleComentarios = toggleComentarios;

  /** Ativado quando um n� � clicado � popula a aba Bloco e muda para ela */
  function abrirComentarioPorNo(nodeId, nodeLabel) {
    _activeNodeId    = nodeId;
    _activeNodeLabel = nodeLabel || nodeId;
    var ta  = elTA();
    var nm  = elNodeName();
    var sv  = elSave();
    var dl  = elDel();
    var pv  = elPreview();
    if (!ta || !nm) return;
    var existing = _comments[nodeId] ? _comments[nodeId].texto : '';
    nm.textContent = _activeNodeLabel;
    nm.style.fontStyle = 'normal';
    nm.style.color = '#333';
    ta.value       = existing;
    ta.disabled    = false;
    sv.disabled    = false;
    dl.disabled    = !existing;
    // Mostra preview do coment�rio existente abaixo do textarea
    if (pv) {
      if (existing) {
        pv.textContent = existing;
        pv.style.display = 'block';
      } else {
        pv.style.display = 'none';
      }
    }
    // Esconde msg de salvo ao mudar n�
    var msg = elSavedMsg();
    if (msg) msg.style.display = 'none';
    // Muda para aba Bloco automaticamente
    if (_panelOpen) mudarAbaComentario('bloco');
  }
  window.abrirComentarioPorNo = abrirComentarioPorNo;

  /** Salva o coment�rio do n� ativo */
  function salvarComentario() {
    if (!_activeNodeId) return;
    var texto = elTA().value.trim();
    if (texto) {
      _comments[_activeNodeId] = { label: _activeNodeLabel, texto: texto };
      elDel().disabled = false;
      var pv = elPreview();
      if (pv) { pv.textContent = texto; pv.style.display = 'block'; }
    } else {
      delete _comments[_activeNodeId];
      elDel().disabled = true;
      var pv2 = elPreview();
      if (pv2) pv2.style.display = 'none';
    }
    renderizarLista();
    atualizarBadge();
    atualizarIndicadorNo(_activeNodeId, !!texto);
    // Mostra msg salvo
    clearTimeout(_savedTimer);
    var msg = elSavedMsg();
    if (msg) {
      msg.style.display = 'inline';
      _savedTimer = setTimeout(function() { msg.style.display = 'none'; }, 1500);
    }
  }
  window.salvarComentario = salvarComentario;

  /** Exclui o coment�rio do n� ativo */
  function excluirComentario() {
    if (!_activeNodeId) return;
    delete _comments[_activeNodeId];
    elTA().value = '';
    elDel().disabled = true;
    var pv = elPreview();
    if (pv) pv.style.display = 'none';
    atualizarIndicadorNo(_activeNodeId, false);
    atualizarBadge();
    renderizarLista();
  }
  window.excluirComentario = excluirComentario;

  /** Adiciona/remove a classe cy-has-comment no n� do diagrama */
  function atualizarIndicadorNo(nodeId, temComentario) {
    if (!cy) return;
    var no = cy.getElementById(nodeId);
    if (!no || !no.length) return;
    if (temComentario) no.addClass('cy-has-comment');
    else               no.removeClass('cy-has-comment');
  }

  /** Atualiza o badge com contagem de coment�rios */
  function atualizarBadge() {
    var badge = elBadge();
    if (!badge) return;
    var total = Object.keys(_comments).length;
    if (total > 0) {
      badge.textContent = total;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  /** Renderiza a lista na aba Geral */
  function renderizarLista() {
    var lista = elList();
    if (!lista) return;
    var ids = Object.keys(_comments);
    if (!ids.length) {
      lista.innerHTML = '<div class="comments-empty">Nenhum coment&#225;rio ainda.<br><small style="color:#ccc">Clique em um bloco no diagrama e salve um coment&#225;rio.</small></div>';
      return;
    }
    lista.innerHTML = ids.map(function(id) {
      var c = _comments[id];
      var esc = function(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
      return '<div class="comment-item" onclick="selecionarComentarioPorId(\'' + id.replace(/'/g,"\\'") + '\')" title="Clique para editar">'
           + '<div class="comment-item-title">&#128204; ' + esc(c.label) + '</div>'
           + '<div class="comment-item-text">'  + esc(c.texto) + '</div>'
           + '</div>';
    }).join('');
  }

  /** Clique em item da lista (aba Geral) ? abre no diagrama e vai para aba Bloco */
  function selecionarComentarioPorId(nodeId) {
    if (!_comments[nodeId]) return;
    abrirComentarioPorNo(nodeId, _comments[nodeId].label);
    // Centraliza o n� no diagrama
    if (cy) {
      var no = cy.getElementById(nodeId);
      if (no && no.length) cy.animate({ center: { eles: no } }, { duration: 300, easing: 'ease-out-cubic' });
    }
  }
  window.selecionarComentarioPorId = selecionarComentarioPorId;

  // Exp�e acesso aos comments para exportar/importar sess�o
  window._getComments = function() { return _comments; };
  window._setComments = function(obj) {
    _comments = obj || {};
    renderizarLista();
    atualizarBadge();
    // Reaplica indicadores visuais nos n�s
    if (cy) {
      cy.nodes().forEach(function(no) {
        var id = no.id();
        if (_comments[id]) no.addClass('cy-has-comment');
        else               no.removeClass('cy-has-comment');
      });
    }
  };
  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.key === 'Enter' && document.activeElement === elTA()) {
      salvarComentario();
    }
  });
})();

// ================= NAVEGA��O MOBILE (TAB BAR) =================
function mobTab(aba) {
  var container = document.querySelector('.container');
  container.classList.remove('mob-code', 'mob-flow');
  container.classList.add('mob-' + aba);
  var tabCode = document.getElementById('mob-tab-code');
  var tabFlow = document.getElementById('mob-tab-flow');
  if (tabCode) tabCode.classList.toggle('active', aba === 'code');
  if (tabFlow) tabFlow.classList.toggle('active', aba === 'flow');
  // Ao exibir o diagrama, reajusta o Cytoscape
  if (aba === 'flow' && cy) {
    setTimeout(function() {
      cy.resize();
      if (typeof atualizarZoomLabel === 'function') atualizarZoomLabel();
    }, 60);
  }
}

// Inicializa a aba ativa conforme tamanho da janela
(function() {
  function initTabs() {
    if (window.innerWidth <= 600) {
      mobTab('code');   // come�a no C�digo para o usu�rio ver/editar antes de gerar
    } else {
      var container = document.querySelector('.container');
      container.classList.remove('mob-code', 'mob-flow');
    }
  }
  initTabs();
  // Ao redimensionar (ex: rota��o de tela), mant�m abas corretas
  window.addEventListener('resize', function() {
    var container = document.querySelector('.container');
    if (window.innerWidth > 600) {
      // Voltou para desktop: remove classes de aba
      container.classList.remove('mob-code', 'mob-flow');
    } else {
      // Entrou no modo mobile: garante que uma aba esteja activa
      if (!container.classList.contains('mob-code') &&
          !container.classList.contains('mob-flow')) {
        mobTab('code');
      }
    }
  });
})();

// ================= ESTRUTURA DO C&#211;DIGO (Outline - VS Code) =================
var _outlineOpen = false;

function toggleOutline() {
  _outlineOpen = !_outlineOpen;
  var body    = document.getElementById('outline-body');
  var chevron = document.getElementById('outline-chevron');
  if (body)    body.classList.toggle('open', _outlineOpen);
  if (chevron) chevron.classList.toggle('open', _outlineOpen);
}

function buildOutline() {
  var code = (document.getElementById('input') || {}).value || '';
  var meta = _currentMeta;
  if (!meta && code.trim()) meta = parseCobol(code);
  if (!meta) return;
  _renderOutline(code, meta);
  var op    = meta.ordemParagrafos || {};
  var tipos = meta.tipos || {};
  var count = (op || []).filter(function(n) { return tipos[n] !== 'fim-paragrafo'; }).length;
  var badge = document.getElementById('outline-cbadge');
  if (badge) { badge.textContent = count; badge.style.display = count ? '' : 'none'; }
}

/* ---- helper: gera o indent com guias visuais ---- */
function _oIndent(depth, guides) {
  if (!depth) return '';
  var h = '';
  for (var _g = 0; _g < depth; _g++) {
    var cls = (guides && guides.indexOf(_g) >= 0) ? 'outline-indent-seg guide' : 'outline-indent-seg';
    h += '<span class="' + cls + '"></span>';
  }
  return '<span class="outline-indent">' + h + '</span>';
}

/* ---- helper: gera uma linha de item ---- */
function _oRow(depth, tipo, label, count, target, guides) {
  var _icons = {
    'div':  '<span class="oi oi-div">D</span>',
    'prog': '<span class="oi oi-prog">P</span>',
    'sec':  '<span class="oi oi-sec">S</span>',
    'para': '<span class="oi oi-para">&#182;</span>',
    'fim':  '<span class="oi oi-fim">&#8864;</span>',
    'var':  '<span class="oi oi-var">v</span>',
    'info': '<span class="oi oi-info">&#9656;</span>',
    'more': '<span class="oi oi-more">&hellip;</span>'
  };
  var _lblClass = {
    'div': '', 'prog': 'lbl-prog', 'sec': 'lbl-section',
    'para': 'lbl-para', 'fim': 'lbl-fim', 'var': 'lbl-var',
    'info': 'lbl-info', 'more': 'lbl-more'
  };
  var icon    = _icons[tipo] || '<span class="oi">&#183;</span>';
  var lblCls  = _lblClass[tipo] || '';
  var bdg     = count != null ? '<span class="oi-badge">' + count + '</span>' : '';
  var tgt     = target ? String(target).replace(/'/g, "\\'") : '';
  var click   = tgt ? ' onclick="outlineClick(\'' + tgt + '\')"' : '';
  var clickId = tgt ? ' data-otarget="' + String(target).replace(/"/g,'') + '"' : '';
  var cls     = 'outline-row' + (tgt ? ' outline-clickable' : '');
  return '<div class="' + cls + '"' + click + clickId + '>'
       + '<div class="outline-row-inner">'
       + _oIndent(depth, guides || [])
       + icon
       + '<span class="outline-lbl ' + lblCls + '">' + (label || '') + '</span>'
       + bdg
       + '</div></div>';
}

/* ---- helper: bloco de grupo (uma DIVISION com cabeçalho fixo recolhível) ---- */
var _outlineDivState = {};   /* id -> booleano aberto */
function _oDivGroup(id, icon, label, badge, rowsHtml) {
  var open = _outlineDivState[id] !== false;  /* padrão: aberto */
  var chev = open ? '<span class="outline-div-chevron open">&#9658;</span>'
                  : '<span class="outline-div-chevron">&#9658;</span>';
  var bdg  = badge ? ' <span class="outline-div-badge">' + badge + '</span>' : '';
  var bod  = open ? '<div class="outline-div-body" id="odbody-' + id + '">' + rowsHtml + '</div>'
                  : '<div class="outline-div-body" id="odbody-' + id + '" style="display:none">' + rowsHtml + '</div>';
  return '<div class="outline-group">'
       + '<div class="outline-div-header" onclick="toggleOutlineDiv(\'' + id + '\')">'
       +   chev
       +   '<span class="oi ' + icon + '" style="margin-right:5px">' + label.charAt(0) + '</span>'
       +   '<span class="outline-div-label">' + label + '</span>'
       +   bdg
       + '</div>'
       + bod
       + '</div>';
}

function toggleOutlineDiv(id) {
  var body = document.getElementById('odbody-' + id);
  var hdr  = body && body.previousElementSibling;
  if (!body) return;
  var open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  _outlineDivState[id] = !open;
  var chev = hdr && hdr.querySelector('.outline-div-chevron');
  if (chev) chev.classList.toggle('open', !open);
}

function _renderOutline(code, meta) {
  var tree = document.getElementById('outline-tree');
  if (!tree) return;

  function normLine(raw) {
    if (raw.length >= 7) {
      var c7 = raw[6];
      if (/^[\d ]{6}/.test(raw) ||
          (/^[A-Za-z0-9 ]{6}/.test(raw) && (c7 === ' ' || c7 === '*' || c7 === '/')))
        return raw.slice(6);
    }
    return raw;
  }

  var linhas = code.split('\n');
  var tipos  = meta.tipos           || {};
  var op     = meta.ordemParagrafos || [];
  var prog   = (meta.programId || 'PROGRAMA').toUpperCase();
  var html   = '';

  /* ── IDENTIFICATION DIVISION ── */
  if (/IDENTIFICATION\s+DIVISION/i.test(code)) {
    var idRows = '';
    idRows += _oRow(0, 'prog', prog, null, null, []);
    var authM = code.match(/AUTHOR\.?\s+(.+)/i);
    if (authM) idRows += _oRow(0, 'info', authM[1].trim().replace(/\.$/, ''), null, null, []);
    var dateM = code.match(/DATE-WRITTEN\.?\s+(.+)/i);
    if (dateM) idRows += _oRow(0, 'info', dateM[1].trim().replace(/\.$/, ''), null, null, []);
    html += _oDivGroup('id', 'oi-div', 'IDENTIFICATION DIVISION', null, idRows);
  }

  /* ── ENVIRONMENT DIVISION ── */
  if (/ENVIRONMENT\s+DIVISION/i.test(code)) {
    var envRows = '';
    if (/DECIMAL-POINT\s+IS\s+COMMA/i.test(code))
      envRows += _oRow(0, 'info', 'DECIMAL-POINT IS COMMA', null, null, []);
    if (/INPUT-OUTPUT\s+SECTION/i.test(code))
      envRows += _oRow(0, 'sec', 'INPUT-OUTPUT SECTION', null, null, []);
    if (!envRows) envRows = '<div class="outline-empty" style="font-size:11px;padding:8px 12px">(sem detalhes)</div>';
    html += _oDivGroup('env', 'oi-div', 'ENVIRONMENT DIVISION', null, envRows);
  }

  /* ── DATA DIVISION ── */
  if (/DATA\s+DIVISION/i.test(code)) {
    var dataSecs = [], vars01 = {}, inData = false, curSec = null;
    var _secRe = /^(FILE|WORKING-STORAGE|LOCAL-STORAGE|LINKAGE|SCREEN|REPORT)\s+SECTION\b/;
    for (var _di = 0; _di < linhas.length; _di++) {
      var _du = normLine(linhas[_di]).trim().toUpperCase().replace(/\.$/, '');
      if (/^DATA\s+DIVISION\b/.test(_du))      { inData = true; continue; }
      if (/^PROCEDURE\s+DIVISION\b/.test(_du)) { break; }
      if (!inData) continue;
      var _sm = _du.match(_secRe);
      if (_sm) { curSec = _sm[1] + ' SECTION'; dataSecs.push(curSec); vars01[curSec] = []; continue; }
      if (curSec && /^01\s+/.test(_du)) {
        var _vm = _du.match(/^01\s+([A-Z0-9][A-Z0-9-]*)/);
        if (_vm) vars01[curSec].push(_vm[1]);
      }
    }
    var _dataTot = dataSecs.reduce(function(s, sec) { return s + (vars01[sec] || []).length; }, 0);
    var dataRows = '';
    dataSecs.forEach(function(sec) {
      var secVars = vars01[sec] || [];
      dataRows += _oRow(0, 'sec', sec, secVars.length || null, null, []);
      secVars.slice(0, 10).forEach(function(v) {
        dataRows += _oRow(1, 'var', v, null, v, [0]);
      });
      if (secVars.length > 10)
        dataRows += _oRow(1, 'more', '(+' + (secVars.length - 10) + ' vari\u00e1veis)', null, null, [0]);
    });
    if (!dataRows) dataRows = '<div class="outline-empty" style="font-size:11px;padding:8px 12px">(sem vari\u00e1veis)</div>';
    html += _oDivGroup('data', 'oi-div', 'DATA DIVISION', _dataTot || null, dataRows);
  }

  /* ── PROCEDURE DIVISION ── */
  var _lksM    = code.match(/PROCEDURE\s+DIVISION\s+USING\s+([A-Z0-9][A-Z0-9-]*)/i);
  var _procAll = op.filter(function(n) { return tipos[n] !== 'fim-paragrafo'; });
  var procRows = '';
  if (_lksM) procRows += _oRow(0, 'info', 'USING ' + _lksM[1].toUpperCase(), null, null, []);

  var _lastSec = null;
  op.forEach(function(nome) {
    var tp   = tipos[nome] || 'paragrafo';
    var cnt  = (meta.estrutura[nome] || []).filter(function(l){ return l.trim(); }).length;
    if (tp === 'section') {
      _lastSec = nome;
      procRows += _oRow(0, 'sec', nome, cnt || null, nome, []);
    } else if (tp === 'fim-paragrafo') {
      procRows += _oRow(_lastSec ? 1 : 0, 'fim', nome, null, nome, _lastSec ? [0] : []);
    } else {
      procRows += _oRow(_lastSec ? 1 : 0, 'para', nome, cnt || null, nome, _lastSec ? [0] : []);
    }
  });
  if (!procRows) procRows = '<div class="outline-empty" style="font-size:11px;padding:8px 12px">(sem par\u00e1grafos)</div>';
  html += _oDivGroup('proc', 'oi-div', 'PROCEDURE DIVISION', _procAll.length || null, procRows);

  tree.innerHTML = html || '<div class="outline-empty">Nenhuma estrutura detectada.</div>';
}

function outlineClick(nome) {
  /* 0. Marca item ativo no outline */
  var tree = document.getElementById('outline-tree');
  if (tree) {
    tree.querySelectorAll('.outline-row.outline-active').forEach(function(el) { el.classList.remove('outline-active'); });
    tree.querySelectorAll('[data-otarget="' + nome + '"]').forEach(function(el) { el.classList.add('outline-active'); });
  }

  /* 1. Navega no diagrama: pan + zoom até o nó, com flash de destaque */
  if (cy) {
    cy.elements().removeClass('cy-cursor-hl');
    var _no = cy.nodes('[target="' + nome + '"]');
    if (_no && _no.length) {
      var _alvo = _no.first();
      var _zoomAlvo = Math.max(cy.zoom(), 0.9);
      cy.animate(
        { zoom: _zoomAlvo, center: { eles: _alvo } },
        {
          duration: 380,
          easing: 'ease-in-out-cubic',
          complete: function() {
            _alvo.addClass('cy-cursor-hl');
            _alvo.flashClass('cy-src-hl', 900);
            atualizarZoomLabel();
          }
        }
      );
    }
  }

  /* 2. Sincroniza o textarea silenciosamente (sem roubar foco) */
  _ignorarCursorMove = true;
  var ta = document.getElementById('input');
  if (ta) {
    var code   = ta.value;
    var linhas = code.split('\n');
    var charPos = 0;
    for (var _i = 0; _i < linhas.length; _i++) {
      var _u = linhas[_i].trim().toUpperCase().replace(/\.$/, '');
      if (_u === nome) {
        ta.setSelectionRange(charPos, charPos + linhas[_i].length);
        var _lh = ta.scrollHeight / Math.max((code.match(/\n/g) || []).length + 1, 1);
        ta.scrollTop = Math.max(0, _i * _lh - ta.clientHeight / 2);
        break;
      }
      charPos += linhas[_i].length + 1;
    }
  }
  setTimeout(function() { _ignorarCursorMove = false; }, 150);

  /* 3. Atualiza painel de detalhes */
  if (_currentMeta && _currentMeta.estrutura && _currentMeta.estrutura[nome]) {
    var _el = document.getElementById('details');
    if (_el) _el.innerText = montarDetalhe(nome, _currentMeta);
  }
}

// ===== INICIALIZAÇÃO DO EDITOR COBOL =====
document.addEventListener('DOMContentLoaded', function() {
  initCobolEditor();
});

// ===== MODAL DE OPÇÕES DE EXPORTAÇÃO =====
var _expTipo = 'html';
function abrirDialogExportar(tipo) {
  _expTipo = tipo || 'html';
  var isDiagramaDisp = true; // ambos formatos suportam diagrama
  var el = document.getElementById('exp-modal');
  if (!el) return;
  document.getElementById('exp-fmt-html').classList.toggle('active', _expTipo === 'html');
  document.getElementById('exp-fmt-word').classList.toggle('active', _expTipo === 'word');
  el.classList.add('open');
}
function fecharDialogExportar() {
  var el = document.getElementById('exp-modal');
  if (el) el.classList.remove('open');
}
function _expSetFmt(tipo) {
  _expTipo = tipo;
  document.getElementById('exp-fmt-html').classList.toggle('active', tipo === 'html');
  document.getElementById('exp-fmt-word').classList.toggle('active', tipo === 'word');
}
function confirmarExportar() {
  var opts = {
    indice:      document.getElementById('exp-chk-indice').checked,
    mapaDecl:    document.getElementById('exp-chk-mapa-decl').checked,
    mapaExecRes: document.getElementById('exp-chk-mapa-exec-res').checked,
    mapaExecExp: document.getElementById('exp-chk-mapa-exec-exp').checked,
    comentarios: document.getElementById('exp-chk-coments').checked,
    diagrama:    document.getElementById('exp-chk-diagrama').checked,
    legenda:     document.getElementById('exp-chk-legenda').checked
  };
  fecharDialogExportar();
  if (_expTipo === 'html') exportarHTML(opts);
  else exportarWord(opts);
}

// =================================================================
//  MAPA DE EXECUÇÃO
// =================================================================
var _emLogHistory = [];
var _emBreakLines = new Set(); // 1-based line numbers with breakpoints

function execMapOpen() {
  if (!cy || cy.nodes().length === 0) {
    alert('Gere o fluxo antes de abrir o Mapa de Execução.');
    return;
  }
  _emLogHistory = [];
  var logEl = document.getElementById('em-log-list');
  if (logEl) logEl.innerHTML = '';
  var stackEl = document.getElementById('em-stack-items');
  if (stackEl) stackEl.innerHTML = '';
  var stackWrap = document.getElementById('em-stack-wrap');
  if (stackWrap) stackWrap.classList.remove('em-has-stack');

  // Sync speed slider
  var mainSpeed = document.getElementById('sim-speed');
  var emSpeed   = document.getElementById('em-speed');
  if (mainSpeed && emSpeed) emSpeed.value = mainSpeed.value;

  // Render COBOL code
  var code = (document.getElementById('input') || {}).value || '';
  _emRenderCode(code);

  // Program name
  var prog = code.match(/PROGRAM-ID\.?\s+([A-Z0-9][A-Z0-9-]*)/i);
  var pnEl = document.getElementById('em-prog-name');
  if (pnEl) pnEl.textContent = prog ? prog[1].toUpperCase() : '';

  document.getElementById('exec-map-overlay').classList.add('em-open');
  document.body.classList.add('exec-map-active');
  simOpen();
  _emSyncButtons();
}

function execMapClose() {
  document.getElementById('exec-map-overlay').classList.remove('em-open');
  document.body.classList.remove('exec-map-active');
  var vp = document.getElementById('sim-vars-panel');
  if (vp) vp.classList.remove('sim-vars-visible');
  simStop(true);
}

// ── Exportar Log do Mapa de Execução ─────────────────────────────

var _emExportItems = [];

function emExportOpen() {
  if (!_emLogHistory || !_emLogHistory.length) {
    alert('Nenhuma entrada no log para exportar. Execute uma simulação primeiro.');
    return;
  }
  _emExportItems = _emLogHistory.map(function (e, i) {
    return { idx: i, msg: e.msg, cls: e.cls || '', checked: true };
  });

  var listEl = document.getElementById('em-exp-log-list');
  listEl.innerHTML = '';
  _emExportItems.forEach(function (item) {
    var row = document.createElement('label');
    row.className = 'em-exp-log-row';
    var cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.checked = true;
    cb.dataset.idx = item.idx;
    cb.addEventListener('change', function () {
      _emExportItems[item.idx].checked = this.checked;
      _emExpUpdateCount();
    });
    var txt = document.createElement('span');
    txt.className   = 'em-exp-log-text' + (item.cls ? ' ' + item.cls : '');
    txt.textContent = item.msg;
    row.appendChild(cb);
    row.appendChild(txt);
    listEl.appendChild(row);
  });

  document.getElementById('em-exp-comment').value = '';
  _emExpUpdateCount();
  document.getElementById('em-export-overlay').classList.add('open');
}

function emExportClose() {
  document.getElementById('em-export-overlay').classList.remove('open');
}

function emExportSelectAll(checked) {
  _emExportItems.forEach(function (item) { item.checked = checked; });
  document.querySelectorAll('#em-exp-log-list input[type=checkbox]').forEach(function (cb) { cb.checked = checked; });
  _emExpUpdateCount();
}

function _emExpUpdateCount() {
  var sel = _emExportItems.filter(function (i) { return i.checked; }).length;
  var el = document.getElementById('em-exp-sel-count');
  if (el) el.textContent = sel + ' / ' + _emExportItems.length + ' entradas';
}

function emExportDo(format) {
  var comment  = (document.getElementById('em-exp-comment').value || '').trim();
  var selected = _emExportItems.filter(function (i) { return i.checked; });
  if (!selected.length) { alert('Selecione ao menos uma entrada para exportar.'); return; }

  var code  = (document.getElementById('input') || {}).value || '';
  var progM = code.match(/PROGRAM-ID\.?\s+([A-Z0-9][A-Z0-9-]*)/i);
  var prog  = progM ? progM[1].toUpperCase() : 'PROGRAMA';
  var date  = new Date().toLocaleString('pt-BR');

  if (format === 'txt')  _emExportTxt (selected, comment, prog, date);
  if (format === 'html') _emExportHtml(selected, comment, prog, date);
  if (format === 'word') _emExportWord(selected, comment, prog, date);
  emExportClose();
}

function _emExportTxt(entries, comment, prog, date) {
  var SEP  = '================================================================';
  var SEP2 = '────────────────────────────────────────────────────────';
  var lines = [
    SEP,
    '  LOG DE EXECUÇÃO — MAPA DE EXECUÇÃO — COBOL Flow',
    SEP,
    'Programa  : ' + prog,
    'Gerado em : ' + date,
    ''
  ];
  if (comment) {
    lines.push('COMENTÁRIO / OBSERVAÇÃO:');
    comment.split('\n').forEach(function (l) { lines.push('  ' + l); });
    lines.push('');
    lines.push(SEP2);
    lines.push('');
  }
  entries.forEach(function (e) { lines.push(e.msg); });
  lines.push('');
  lines.push(SEP);
  lines.push('  Gerado por COBOL Flow — Mapa de Execução');
  lines.push(SEP);

  _emDownload(lines.join('\n'), prog + '_execlog.txt', 'text/plain;charset=utf-8');
}

function _emExportHtml(entries, comment, prog, date) {
  var clrMap = {
    'sim-log-info'    : '#4338ca',
    'sim-log-branch'  : '#92400e',
    'sim-log-end'     : '#15803d',
    'sim-log-move'    : '#374151',
    'sim-log-display' : '#065f46',
    'sim-log-bp'      : '#dc2626',
    'sim-log-file-var': '#047857',
    'sim-log-sep'     : '#9ca3af',
    'sim-log-section' : '#3730a3',
    'sim-log-var'     : '#0e7490',
    'sim-log-detail'  : '#6b7280',
    'sim-log-warn'    : '#b45309',
    'sim-log-sort'    : '#0d9488',
    'sim-log-search'  : '#ea580c'
  };

  var rows = entries.map(function (e) {
    var c  = clrMap[e.cls] || '#1f2937';
    var fw = e.cls === 'sim-log-section' ? 'font-weight:700;' : '';
    var fs = (e.cls === 'sim-log-detail' || e.cls === 'sim-log-move') ? 'font-size:11px;' : '';
    return '<div style="padding:1px 0;white-space:pre-wrap;font-family:monospace;color:' + c + ';' + fw + fs + '">' + _emEscHtml(e.msg) + '</div>';
  }).join('\n');

  var commentBlock = '';
  if (comment) {
    commentBlock = '<div style="background:#fffbeb;border-left:3px solid #d97706;padding:10px 14px;margin-bottom:16px;color:#78350f;white-space:pre-wrap;font-family:monospace;font-size:13px;border-radius:4px;">'
      + '<strong style="display:block;margin-bottom:6px;font-size:11px;color:#92400e;text-transform:uppercase;letter-spacing:.5px;">Comentário</strong>'
      + _emEscHtml(comment) + '</div>';
  }

  var html = '<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n<meta charset="UTF-8">\n'
    + '<title>Log Exec Map \u2014 ' + prog + '</title>\n'
    + '<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#ffffff;color:#1f2937;font-family:\'Segoe UI\',Arial,sans-serif;padding:24px}'
    + 'h1{color:#3730a3;font-size:16px;font-weight:700;margin-bottom:4px}.meta{color:#6b7280;font-size:11px;margin-bottom:18px}'
    + '.log{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;font-size:12px;line-height:1.8}</style>\n</head>\n<body>\n'
    + '<h1>\u26a1 Log de Execu\u00e7\u00e3o \u2014 ' + _emEscHtml(prog) + '</h1>\n'
    + '<div class="meta">Gerado em ' + date + ' &nbsp;&middot;&nbsp; COBOL Flow \u2014 Mapa de Execu\u00e7\u00e3o</div>\n'
    + commentBlock
    + '<div class="log">\n' + rows + '\n</div>\n</body>\n</html>';

  _emDownload(html, prog + '_execlog.html', 'text/html;charset=utf-8');
}

function _emExportWord(entries, comment, prog, date) {
  // RTF — abre direto no Word (fundo branco, cores escuras de alto contraste)
  var clrIdx = {
    'sim-log-info'    : 2,
    'sim-log-branch'  : 3,
    'sim-log-end'     : 4,
    'sim-log-move'    : 5,
    'sim-log-display' : 6,
    'sim-log-bp'      : 7,
    'sim-log-file-var': 8,
    'sim-log-sep'     : 9,
    'sim-log-section' : 10,
    'sim-log-var'     : 11,
    'sim-log-detail'  : 12,
    'sim-log-warn'    : 3,
    'sim-log-sort'    : 14,
    'sim-log-search'  : 15
  };
  // Tabela de cores dark-on-white (cf1..cf14)
  // cf1  = #1f2937 default text       cf2  = #4338ca info (indigo escuro)
  // cf3  = #92400e branch/warn        cf4  = #15803d end (verde escuro)
  // cf5  = #374151 move               cf6  = #065f46 display (teal escuro)
  // cf7  = #dc2626 bp (vermelho)      cf8  = #047857 file-var (verde menta)
  // cf9  = #6b7280 sep (cinza)        cf10 = #3730a3 section (indigo bold)
  // cf11 = #0e7490 var (ciano escuro) cf12 = #6b7280 detail (cinza)
  // cf13 = #78350f comentário (marrom) cf14 = #0d9488 sort (teal) cf15 = #ea580c search (laranja)
  var rtf = [
    '{\\rtf1\\ansi\\ansicpg1252\\deff0',
    '{\\fonttbl{\\f0\\fmodern\\fcharset0 Courier New;}{\\f1\\fswiss\\fcharset0 Segoe UI;}}',
    '{\\colortbl;\\red31\\green41\\blue55;\\red67\\green56\\blue202;\\red146\\green64\\blue14;\\red21\\green128\\blue61;\\red55\\green65\\blue81;\\red6\\green95\\blue70;\\red220\\green38\\blue38;\\red4\\green120\\blue87;\\red107\\green114\\blue128;\\red55\\green48\\blue163;\\red14\\green116\\blue144;\\red107\\green114\\blue128;\\red120\\green53\\blue15;\\red13\\green148\\blue136;\\red234\\green88\\blue12;}',
    '\\widowctrl\\wpaper12240\\wpapr15840\\margl1440\\margr1440\\margt1440\\margb1440',
    '\\f1\\fs26\\b\\cf2 ' + _emRtfEsc('LOG DE EXECUÇÃO — ' + prog) + '\\b0\\par',
    '\\cf9\\fs18 ' + _emRtfEsc('Gerado em ' + date + ' · COBOL Flow — Mapa de Execução') + '\\cf1\\par\\par'
  ];

  if (comment) {
    rtf.push('\\cf13\\b ' + _emRtfEsc('COMENTÁRIO:') + '\\b0\\par');
    comment.split('\n').forEach(function (l) {
      rtf.push('\\cf13 ' + _emRtfEsc('  ' + l) + '\\par');
    });
    rtf.push('\\cf1\\par');
  }

  rtf.push('\\f0\\fs18');
  entries.forEach(function (e) {
    var ci   = clrIdx[e.cls] || 1;
    var bold = e.cls === 'sim-log-section' ? '\\b ' : '';
    rtf.push('\\cf' + ci + ' ' + bold + _emRtfEsc(e.msg) + (bold ? '\\b0' : '') + '\\par');
  });
  rtf.push('}');

  _emDownload(rtf.join('\n'), prog + '_execlog.rtf', 'application/rtf');
}

function _emRtfEsc(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\{/g,  '\\{')
    .replace(/\}/g,  '\\}')
    .replace(/[^\x00-\x7F]/g, function (c) { return '\\u' + c.charCodeAt(0) + '?'; });
}

function _emDownload(content, filename, mime) {
  var blob = new Blob([content], { type: mime });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}


function _emRenderCode(code) {
  var el = document.getElementById('em-code-body');
  if (!el) return;
  _emBreakLines.clear();
  var lines = code.split('\n');
  var html = lines.map(function(line, i) {
    var lineNum = i + 1;
    var hi = (typeof _cblHighlightLine === 'function') ? _cblHighlightLine(line) : _emEscHtml(line);
    return '<div class="em-code-line" id="em-line-' + lineNum + '" onclick="execMapToggleLineBp(' + lineNum + ')">'
         + '<span class="em-ln">' + lineNum + '</span>'
         + '<span class="em-lc">' + hi + '</span>'
         + '</div>';
  }).join('');
  el.innerHTML = html;
}

function _emEscHtml(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Toggle breakpoint on a code line (called by onclick on em-code-line divs)
function execMapToggleLineBp(lineNum) {
  var el = document.getElementById('em-line-' + lineNum);
  if (!el) return;
  if (_emBreakLines.has(lineNum)) {
    _emBreakLines.delete(lineNum);
    el.classList.remove('em-bp');
  } else {
    _emBreakLines.add(lineNum);
    el.classList.add('em-bp');
  }
}

// Called from _simLog (via hook in simulator.js)
function _emAppendLog(msg, cls) {
  var overlay = document.getElementById('exec-map-overlay');
  if (!overlay || !overlay.classList.contains('em-open')) return;
  _emLogHistory.push({ msg: msg, cls: cls || '' });
  var logEl = document.getElementById('em-log-list');
  if (!logEl) return;
  // Remove destaque antigo
  var prev = logEl.querySelector('.em-log-cur');
  if (prev) prev.classList.remove('em-log-cur');
  var div = document.createElement('div');
  div.className = 'em-log-line em-log-cur' + (cls ? ' ' + cls : '');
  div.textContent = msg;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  // Sync step info
  _emSyncStepInfo();
}

// Called from _simLogNode hook – lineIdx is 0-based from node data('srcLine'), fallbackName for lookup
function _emHighlightLine(lineIdx, fallbackName) {
  var codeEl = document.getElementById('em-code-body');
  if (!codeEl) return;
  codeEl.querySelectorAll('.em-code-line.em-active').forEach(function(el) { el.classList.remove('em-active'); });
  var lineEl = null;

  // 1) Try exact line from srcLine (0-based → 1-based id)
  if (lineIdx != null && lineIdx >= 0) {
    lineEl = document.getElementById('em-line-' + (lineIdx + 1));
  }

  // 2) Fallback: use lineNumMap to find paragraph header line
  if (!lineEl && fallbackName && window._currentMeta && _currentMeta.lineNumMap) {
    var nameUp = fallbackName.toUpperCase().split('\n')[0].trim().replace(/\s+.*$/, '');
    var idxArr = _currentMeta.lineNumMap[nameUp];
    if (idxArr && idxArr.length) {
      lineEl = document.getElementById('em-line-' + (idxArr[0] + 1));
    }
  }

  // 3) Last resort: regex text search (header SECTION/PARAGRAPH)
  if (!lineEl && fallbackName) {
    var safe = fallbackName.replace(/[.*+?()[\]{}|^$\\]/g, '\\$&').split('\n')[0].trim();
    var re = new RegExp('(?:^|\\s)' + safe + '(?:\\.|\\s|$)', 'i');
    var lines = codeEl.querySelectorAll('.em-code-line');
    lines.forEach(function(el) {
      var lc = el.querySelector('.em-lc');
      if (!lineEl && lc && re.test(lc.textContent)) lineEl = el;
    });
  }

  if (!lineEl) return;
  lineEl.classList.add('em-active');
  lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Check breakpoint
  var lineNum = parseInt(lineEl.id.replace('em-line-', ''), 10);
  if (!isNaN(lineNum) && _emBreakLines.has(lineNum)) {
    if (typeof simPause === 'function') simPause();
    _emAppendLog('\uD83D\uDD34 Breakpoint na linha ' + lineNum, 'sim-log-bp');
  }
}

// Called from _simUpdateStack (via hook in simulator.js)
function _emSyncStack(callStack) {
  var wrap  = document.getElementById('em-stack-wrap');
  var items = document.getElementById('em-stack-items');
  if (!wrap || !items) return;
  if (!callStack || callStack.length === 0) {
    wrap.classList.remove('em-has-stack');
    return;
  }
  wrap.classList.add('em-has-stack');
  items.innerHTML = callStack.map(function(f) {
    return '<span class="em-stack-item">\u21a9 ' + _emEscHtml(f.label) + '</span>';
  }).join('');
}

function _emSyncStepInfo() {
  var el = document.getElementById('em-step-info');
  var si = document.getElementById('sim-step-info');
  if (el && si) el.textContent = si.textContent;
}

function _emSyncButtons() {
  var map = { 'em-btn-play': 'sim-btn-play', 'em-btn-pause': 'sim-btn-pause', 'em-btn-step': 'sim-btn-step' };
  Object.keys(map).forEach(function(emId) {
    var emBtn  = document.getElementById(emId);
    var simBtn = document.getElementById(map[emId]);
    if (emBtn && simBtn) emBtn.disabled = simBtn.disabled;
  });
}

function _emToggleVars() {
  if (typeof _simToggleVarsPanel === 'function') _simToggleVarsPanel();
}

// Drag to resize em-left
(function() {
  var bar, startX, startW;
  document.addEventListener('mousedown', function(e) {
    if (e.target && e.target.id === 'em-resize-bar') {
      bar = e.target;
      startX = e.clientX;
      startW = document.getElementById('em-left').offsetWidth;
      bar.classList.add('dragging');
      e.preventDefault();
    }
  });
  document.addEventListener('mousemove', function(e) {
    if (!bar) return;
    var dx = e.clientX - startX;
    var left = document.getElementById('em-left');
    if (left) left.style.width = Math.max(220, Math.min(startW + dx, window.innerWidth * 0.7)) + 'px';
  });
  document.addEventListener('mouseup', function() {
    if (bar) { bar.classList.remove('dragging'); bar = null; }
  });
})();
