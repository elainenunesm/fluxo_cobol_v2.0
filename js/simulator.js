// ================================================================
//  COBOL Simulator  — engine de simulação baseado no grafo Cytoscape
// ================================================================

// ── Variáveis de WORKING-STORAGE para o simulador ──────────────
var _simVarDefs = [];   // [{level,name,pic,picType,len,value,section}]
var _simVars    = {};   // { 'WS-FLAG': 'N', 'WS-COUNT': '0', ... }
var _simVarsChanged = {}; // rastreia alterações em tempo de simulação
var _simVarsInitial = {}; // valores que o usuário digitou antes de iniciar o fluxo
var _simVarsMoved   = {}; // variáveis alteradas por MOVE durante o fluxo
var _simLoopState   = {}; // rastreia estado de loops: { loopNodeId: { iters, varName, by } }
var _sim88Defs  = {};   // { 'FLAG-ATIVO': { parent: 'WS-FLAG', values: ['S','Y'] } }
var _simFiles         = {};   // { 'ARQ-ENTRADA': { fields:[], records:[], pointer:0, isOpen:false } }
var _simFileStatusMap = {};   // { 'ARQ-ENTRADA': 'WS-ST-ENTRADA' } — FILE STATUS IS <var>
var _simFileStatusMapDebug = {}; // cópia para log de diagnóstico
var _simLastReadAtEnd = false;  // resultado do último READ (true = AT END)
var _simDb2Tables   = {};  // { 'CLIENTES': { columns:[], rows:[], meta:{} } }
var _simDb2Cursors  = {};  // { 'C1': { tableName, cols, pointer, isOpen } }

// Analisa o código COBOL e extrai variáveis de DATA DIVISION
function _parseWsVars(code) {
  var result = [];
  if (!code) return result;
  // ── Pré-processamento ─────────────────────────────────────────────────────
  // Passo 1: une linhas de continuação COBOL (indicador '-' na coluna 7)
  //   Ex.:  "       05 WS-MSG PIC X(40) VALUE 'PARTE UM"
  //         "-                'PARTE DOIS'."
  var rawLines = code.split('\n');
  var _step1 = [];
  rawLines.forEach(function(rl) {
    if (rl.length >= 7 && rl[6] === '-') {
      var cont = rl.length > 11 ? rl.slice(11).trim() : '';
      if (_step1.length) {
        var prev = _step1[_step1.length - 1];
        // continuação de literal: remove a aspa de abertura e concatena ao texto anterior
        if (cont.startsWith("'") || cont.startsWith('"')) {
          _step1[_step1.length - 1] = prev.replace(/\s+$/, '') + cont.slice(1);
        } else {
          _step1[_step1.length - 1] = prev + ' ' + cont;
        }
      } else { _step1.push(rl); }
    } else { _step1.push(rl); }
  });

  // Passo 2: normaliza (remove prefixo de 6 colunas) e une linhas físicas da
  //   mesma declaração DATA DIVISION que se estendem pela linha seguinte sem '-'
  //   Ex.:  "       05 WS-CAMPO PIC X(10)"
  //         "                   VALUE 'ABC'."
  var lines = [];
  _step1.forEach(function(rl) {
    var norm = rl;
    if (rl.length >= 7) {
      var c7 = rl[6];
      if (/^[\d ]{6}/.test(rl) || (/^[A-Za-z0-9 ]{6}/.test(rl) && (c7 === ' ' || c7 === '*' || c7 === '/'))) {
        norm = rl.slice(6);
      }
    }
    var lt = norm.trim();
    if (!lt || lt[0] === '*' || lt[0] === '/' || lt.startsWith('*>') || lt.startsWith('*')) return;
    var luTest = lt.toUpperCase();
    var isNewDecl = /^\d{1,2}\s+[A-Z@#$]/.test(luTest) ||
      /^(FILE|WORKING-STORAGE|LOCAL-STORAGE|LINKAGE|SCREEN|REPORT|COMMUNICATION|PROGRAM-LIBRARY|PROCEDURE)\s+(SECTION|DIVISION)\b/.test(luTest) ||
      /^[SF]D\s+/.test(luTest);
    if (isNewDecl) { lines.push(lt); }
    else if (lines.length) { lines[lines.length - 1] += ' ' + lt; }
    else { lines.push(lt); }
  });
  // ──────────────────────────────────────────────────────────────────────────

  // sections que interessam: FILE, WORKING-STORAGE, LOCAL-STORAGE, LINKAGE
  var inSection = false;
  var currentSection = '';
  var lastNon88Name = ''; // para vincular nível 88 ao pai
  var lastFdName    = ''; // FD/SD atual dentro do FILE SECTION
  lines.forEach(function(lt) {  // lt já normalizado e trimado pelo pré-processamento
    if (!lt) return;
    var lu = lt.toUpperCase();
    // Detecta início de seção de interesse
    var secM = lu.match(/^(FILE|WORKING-STORAGE|LOCAL-STORAGE|LINKAGE)\s+SECTION\b/);
    if (secM) { inSection = true; currentSection = secM[1]; return; }
    // Fim ao entrar em outra seção ou PROCEDURE DIVISION
    if (/^(SCREEN|REPORT|COMMUNICATION|PROGRAM-LIBRARY|PROCEDURE)\s+(SECTION|DIVISION)\b/.test(lu)) {
      if (inSection) inSection = false;
      return;
    }
    // No FILE SECTION, linhas FD/SD são descritores de arquivo — extrai nome e pula
    if (inSection && currentSection === 'FILE' && /^[SF]D\s+/.test(lu)) {
      var fdLineM = lu.match(/^[SF]D\s+([A-Z][A-Z0-9-]*)/);
      if (fdLineM) lastFdName = fdLineM[1];
      return;
    }
    if (!inSection) return;
    // Parse de nível + nome + PIC + VALUE
    // Aceita: "  05 WS-NOME     PIC X(30) VALUE SPACES."
    var lvlM = lu.match(/^(\d{1,2})\s+([A-Z@#$][A-Z0-9@#$-]*)(.*)$/);
    if (!lvlM) return;
    var level   = parseInt(lvlM[1], 10);
    var name    = lvlM[2];
    var rest    = lvlM[3] || '';
    // 88 = nome de condição — armazena ligado à variável pai
    if (level === 88) {
      var v88M = rest.replace(/\.$/, '').match(/\bVALUES?\s+(.+)$/i);
      if (v88M && lastNon88Name) {
        var raw88 = v88M[1];
        var vals88 = [];
        var vRe88 = /'([^']*)'|"([^"]*)"|([^\s,]+)/g, vm88;
        while ((vm88 = vRe88.exec(raw88)) !== null) {
          var tok88 = vm88[1] !== undefined ? vm88[1] : (vm88[2] !== undefined ? vm88[2] : vm88[3]);
          if (tok88 && !/^(THRU|THROUGH|,)$/i.test(tok88)) vals88.push(tok88.toUpperCase());
        }
        if (vals88.length > 0)
          result.push({ level: 88, name: name, is88: true, parentName: lastNon88Name, values: vals88, section: currentSection });
      }
      return;
    }
    // FILLER não tem interesse para avaliação de expressões
    // mas mantemos para referência
    var isGroup = !(/\bPIC\w*\b|\bPICTURE\b/i.test(rest));
    var pic = null, picType = 'X', len = 1, defVal = null;
    if (!isGroup) {
      var picM = rest.match(/\bPIC(?:TURE)?\s+(?:IS\s+)?([^\s]+)/i);
      if (picM) {
        pic = picM[1];
        var pU = pic.toUpperCase();
        picType = (/[9S]/.test(pU) && !/X/.test(pU)) ? '9' : 'X';
        var lm = pU.match(/\((\d+)\)/);
        if (lm) len = parseInt(lm[1], 10);
        else len = (pU.match(/[X9A]/g) || []).length || 1;
      }
      // VALUE clause (pode ter string com espaços)
      var valM = rest.match(/\bVALUE\s+(?:IS\s+)?((?:'[^']*'|"[^"]*"|[^\s.]+))/i);
      if (valM) {
        var vStr = valM[1];
        var vU   = vStr.toUpperCase();
        if ((vStr.startsWith("'") && vStr.endsWith("'")) || (vStr.startsWith('"') && vStr.endsWith('"'))) {
          defVal = vStr.slice(1, -1);
        } else if (vU === 'SPACES' || vU === 'SPACE') {
          defVal = '';
        } else if (vU === 'ZEROS' || vU === 'ZEROES' || vU === 'ZERO') {
          defVal = picType === '9' ? '0' : '0';
        } else if (vU === 'HIGH-VALUES' || vU === 'HIGH-VALUE') {
          defVal = '\xFF';
        } else if (vU === 'LOW-VALUES' || vU === 'LOW-VALUE') {
          defVal = '\x00';
        } else {
          defVal = vStr;
        }
      } else {
        defVal = picType === '9' ? '0' : '';
      }
    } else {
      defVal = '';
    }
    result.push({ level: level, name: name, pic: pic, picType: picType, len: len,
                  value: defVal !== null ? defVal : '', isGroup: isGroup, section: currentSection,
                  fdName: (currentSection === 'FILE' ? lastFdName : '') });
    lastNon88Name = name; // atualiza referência para próximos nível 88
  });
  return result;
}

// Extrai FILE STATUS IS <var> de cada SELECT (varre o código inteiro)
function _parseFileStatusMap(code) {
  var map = {};
  if (!code) return map;
  // Normaliza linha a linha (remove colunas de sequência e comentários)
  var lines = code.split('\n').map(function(l) {
    if (l.length >= 7 && /^[\d ]{6}/.test(l)) l = l.slice(6);
    var lt = l.trim();
    if (!lt || lt[0] === '*' || lt.startsWith('*>')) return '';
    return lt.toUpperCase();
  }).filter(Boolean);
  var currentFd  = null;  // FD atual rastreado desde o SELECT
  var pendingFs  = false; // true quando vimos FILE STATUS IS sem variável ainda
  lines.forEach(function(lu) {
    // Para ao entrar na PROCEDURE DIVISION
    if (/^PROCEDURE\s+DIVISION\b/.test(lu)) { currentFd = null; pendingFs = false; return; }
    // Novo SELECT → novo arquivo lógico
    var mSel = lu.match(/\bSELECT\s+([A-Z][A-Z0-9-]*)/);
    if (mSel) { currentFd = mSel[1]; pendingFs = false; }
    if (!currentFd) return;
    // Se na linha anterior ficou "FILE STATUS IS" sem variável, próxima palavra não-vazia é o nome
    if (pendingFs) {
      var mPend = lu.match(/^([A-Z][A-Z0-9-]*)/);
      if (mPend) { map[currentFd] = mPend[1]; currentFd = null; pendingFs = false; return; }
    }
    // FILE STATUS IS? <varname> na mesma linha
    // Atenção: se a linha termina em "FILE STATUS IS" (sem varname), o regex
    // captura "IS" como nome — detectamos isso e tratamos como pendingFs.
    var mFs = lu.match(/\bFILE\s+STATUS\s+(?:IS\s+)?([A-Z][A-Z0-9-]*)/);
    if (mFs && mFs[1] !== 'IS') {
      map[currentFd] = mFs[1];
      currentFd = null; pendingFs = false;
      return;
    }
    // FILE STATUS IS sem variável (ou false-match em IS): variável na próxima linha
    if (mFs || /\bFILE\s+STATUS\b/.test(lu)) {
      pendingFs = true;
    }
  });
  // Diagnóstico: mostra o mapa no console do navegador
  console.log('[FILE STATUS MAP]', JSON.stringify(map));
  _simFileStatusMapDebug = map;  // guarda para exibir no log quando simulação iniciar
  return map;
}

function _simInitVars(code) {
  _simVarDefs = _parseWsVars(code);
  _simFileStatusMap = _parseFileStatusMap(code);
  _simVars = {};
  _simVarsChanged = {};
  _simVarsInitial = {};  // valores digitados pelo usuário antes de ▶
  _simVarsMoved  = {};  // variáveis alteradas pelo fluxo (MOVE)
  _sim88Defs = {};
  _simLastReadAtEnd = false;
  _simVarDefs.forEach(function(v) {
    if (v.is88) {
      _sim88Defs[v.name] = { parent: v.parentName, values: v.values };
    } else if (!v.isGroup) {
      _simVars[v.name] = v.value;
      _simVarsInitial[v.name] = v.value;
    }
  });
  _simInitFiles();
  // Garante que TODAS as variáveis FILE STATUS IS existam em _simVars,
  // mesmo que não tenham sido declaradas no WORKING-STORAGE
  Object.keys(_simFileStatusMap).forEach(function(fdName) {
    var svn = _simFileStatusMap[fdName];
    if (svn && !_simVars.hasOwnProperty(svn)) {
      _simVars[svn] = '';
    }
  });
  // Inicializa variáveis SQL implícitas (SQLCA) se o código usa EXEC SQL
  if (/\bEXEC\s+SQL\b/i.test(code)) {
    var _sqlImplicit = ['SQLCODE', 'SQLSTATE', 'SQLERRM', 'SQLERRD'];
    _sqlImplicit.forEach(function(v) {
      if (!_simVars.hasOwnProperty(v)) _simVars[v] = '';
    });
    _simDb2Tables  = _parseDb2Tables(code);
    _simDb2Cursors = _parseDb2Cursors(code, _simDb2Tables);
    // Auto-importa registros do painel Banco de Dados, como o book faz para arquivos
    _simAutoImportAllDb2();
  } else {
    _simDb2Tables  = {};
    _simDb2Cursors = {};
  }
}

// ── Arquivos de entrada simulados ──────────────────────────────
function _simInitFiles() {
  _simFiles = {};
  _simVarDefs.forEach(function(v) {
    if (v.fdName && !v.isGroup && !v.is88) {
      if (!_simFiles[v.fdName]) {
        var svName = _simFileStatusMap[v.fdName] || null;
        _simFiles[v.fdName] = { fields: [], records: [], pointer: 0, isOpen: false, statusVarName: svName };
        // Garante que a variável FILE STATUS exista em _simVars mesmo se não foi
        // declarada explicitamente no WORKING-STORAGE (PIC XX ausente ou não parseada)
        if (svName && !_simVars.hasOwnProperty(svName)) {
          _simVars[svName] = '';
        }
      }
      _simFiles[v.fdName].fields.push(v.name);
    }
  });
}

// Atualiza fd.fileStatus E a variável WS correspondente (FILE STATUS IS)
function _simSetFileStatus(fd, code) {
  fd.fileStatus = code;
  var svn = fd.statusVarName;
  if (!svn) return;
  // Força o valor em _simVars (mesmo que não estivesse lá) e anima no painel
  _simSetVarInternal(svn, code);
}

// Executa um READ simulado: preenche variáveis ou sinaliza AT END
function _simDoRead(labelU) {
  // Extrai nome do arquivo do label: READ ARQ-ENTRADA [INTO ...] [NEXT ...]
  var m = labelU.match(/^READ\s+([A-Z][A-Z0-9-]*)/);
  if (!m) { _simLastReadAtEnd = false; return; }
  var fdName = m[1].trim();
  var fd = _simFiles[fdName];
  if (!fd) { _simLastReadAtEnd = false; return; }
  // Valida: arquivo precisa estar aberto
  if (!fd.isOpen) {
    _simSetFileStatus(fd, '47');
    _simLastReadAtEnd = false;
    _simLog('\u26d4 READ ' + fdName + ' \u2192 arquivo n\u00e3o est\u00e1 aberto (FS:47)', 'sim-log-error');
    _simRefreshFilesPanel();
    return;
  }
  // Valida: modo de abertura permite leitura
  if (fd.openMode === 'OUTPUT' || fd.openMode === 'EXTEND') {
    _simSetFileStatus(fd, '47');
    _simLastReadAtEnd = false;
    _simLog('\u26d4 READ ' + fdName + ' \u2192 arquivo aberto como ' + fd.openMode + ', leitura n\u00e3o permitida (FS:47)', 'sim-log-error');
    _simRefreshFilesPanel();
    return;
  }
  if (fd.pointer >= fd.records.length) {
    _simLastReadAtEnd = true;
    _simSetFileStatus(fd, '10');  // AT END
    if (typeof _repOnFileOp === 'function') _repOnFileOp('read', fdName);
    _simLog('📂 READ ' + fdName + ' → AT END (sem mais registros)', 'sim-log-branch');
    _simRefreshFilesPanel();
    return;
  }
  var rec = fd.records[fd.pointer];
  fd.pointer++;
  _simLastReadAtEnd = false;
  _simSetFileStatus(fd, '00');  // normal
  if (typeof _repOnFileOp === 'function') _repOnFileOp('read', fdName);
  // Loga o READ antes de copiar os campos (para o log ficar na ordem certa)
  _simLog('📂 READ ' + fdName + ' → reg ' + fd.pointer + '/' + fd.records.length, 'sim-log-branch');
  // Mostra campos do registro no log de execução (Mapa de Execução)
  if (typeof _emAppendLog === 'function') {
    Object.keys(rec).forEach(function(fld) {
      var val = String(rec[fld] !== undefined && rec[fld] !== null ? rec[fld] : '\u2205');
      _emAppendLog('  \u21b3 ' + fld + ' = [' + val + ']', 'sim-log-file-var');
    });
  }
  // Registra os campos do registro diretamente no log do relatório.
  // Usa Object.keys(rec) para garantir que os campos reais do registro
  // sejam logados, independente de virem de um book ou da FILE SECTION.
  if (typeof _repOnReadRecord === 'function') _repOnReadRecord(fdName, rec, Object.keys(rec));
  // Suprime _repOnVarChange durante a cópia (já logado por _repOnReadRecord)
  if (typeof _repTagNextVarsAsFile !== 'undefined') _repTagNextVarsAsFile = true;
  // Copia campos do registro para _simVars usando as chaves reais do rec
  Object.keys(rec).forEach(function(fld) {
    _simSetVarInternal(fld, rec[fld]);
  });
  if (typeof _repTagNextVarsAsFile !== 'undefined') _repTagNextVarsAsFile = false;
  _simRefreshFilesPanel();
}

// Executa OPEN simulado: abre arquivo(s) e define file status
function _simDoOpen(labelU) {
  // OPEN { INPUT|OUTPUT|I-O|EXTEND file-name [file-name ...] }...
  // Suporta múltiplos grupos de modo na mesma instrução:
  //   OPEN INPUT ARQ-A INPUT ARQ-B OUTPUT ARQ-C
  var rest = labelU.replace(/^OPEN\s*/i, '');
  var tokens = rest.split(/[\s,]+/).filter(Boolean);
  var _modeKw = /^(INPUT|OUTPUT|I-O|EXTEND)$/i;
  var currentMode = 'I-O';   // fallback se não houver keyword
  tokens.forEach(function(tok) {
    var tokU = tok.toUpperCase();
    if (_modeKw.test(tokU)) {
      currentMode = tokU;
      return;
    }
    var fdName = tokU.replace(/[^A-Z0-9-]/g, '');
    if (!fdName) return;
    var fd = _simFiles[fdName];
    if (!fd) return;
    if (fd.isOpen) {
      _simSetFileStatus(fd, '41');
      _simLog('\u26a0 OPEN ' + fdName + ' \u2192 arquivo j\u00e1 est\u00e1 aberto (FS:41)', 'sim-log-branch');
      _simRefreshFilesPanel();
      return;
    }
    fd.isOpen    = true;
    fd.openMode  = currentMode;
    _simSetFileStatus(fd, '00');
    if (typeof _repOnFileOp === 'function') _repOnFileOp('open', fdName);
    var fsNote = fd.statusVarName ? ' \u2192 ' + fd.statusVarName + "='00'" : ' (sem FILE STATUS IS vinculado)';
    _simLog('\u2299 OPEN ' + fdName + ' [' + currentMode + '] \u2192 arquivo aberto (FS:00)' + fsNote, 'sim-log-info');
  });
  _simRefreshFilesPanel();
}

// Executa CLOSE simulado: fecha arquivo(s)
function _simDoClose(labelU) {
  // CLOSE FD1 [FD2 ...]
  var rest = labelU.replace(/^CLOSE\s*/i, '');
  var names = rest.split(/[\s,]+/).filter(Boolean);
  names.forEach(function(fdName) {
    fdName = fdName.replace(/[^A-Z0-9-]/g, '');
    if (!fdName) return;
    var fd = _simFiles[fdName];
    if (!fd) return;
    if (!fd.isOpen) {
      _simSetFileStatus(fd, '42');
      _simLog('\u26a0 CLOSE ' + fdName + ' \u2192 arquivo j\u00e1 estava fechado (FS:42)', 'sim-log-branch');
      _simRefreshFilesPanel();
      return;
    }
    fd.isOpen    = false;
    fd.openMode  = null;
    _simSetFileStatus(fd, '00');
    if (typeof _repOnFileOp === 'function') _repOnFileOp('close', fdName);
    _simLog('\u2297 CLOSE ' + fdName + ' \u2192 arquivo fechado (FS:00)', 'sim-log-info');
  });
  _simRefreshFilesPanel();
}

// ── Painel de Variáveis ─────────────────────────────────────────
// Muda a fase visual do painel: 'input' (antes de rodar) ou 'running' (em execução)
function _simSetPanelPhase(phase) {
  var panel = document.getElementById('sim-vars-panel');
  var ttl   = document.querySelector('#sim-vars-panel .sim-vars-title');
  if (!panel || !ttl) return;
  if (phase === 'running') {
    panel.classList.add('sim-phase-running');
    ttl.textContent = '▶ EXECUTANDO — VARIAVEIS EM TEMPO REAL';
  } else {
    panel.classList.remove('sim-phase-running');
    ttl.textContent = '■ VALORES INICIAIS — PREENCHA ANTES DE ▶';
  }
}

function _simSwitchTab(tab) {
  var tabVars   = document.getElementById('sim-tab-vars');
  var tabFiles  = document.getElementById('sim-tab-files');
  var tabDb2    = document.getElementById('sim-tab-db2');
  var contVars  = document.getElementById('sim-tab-vars-content');
  var contFiles = document.getElementById('sim-tab-files-content');
  var contDb2   = document.getElementById('sim-tab-db2-content');
  if (!tabVars) return;
  // Remove active de todos
  [tabVars, tabFiles, tabDb2].forEach(function(t){ if (t) t.classList.remove('active'); });
  [contVars, contFiles, contDb2].forEach(function(c){ if (c) c.classList.remove('active'); });
  if (tab === 'files') {
    if (tabFiles) tabFiles.classList.add('active');
    if (contFiles) contFiles.classList.add('active');
    _simRefreshFilesPanel();
  } else if (tab === 'db2') {
    if (tabDb2) tabDb2.classList.add('active');
    if (contDb2) contDb2.classList.add('active');
    _simRefreshDb2Panel();
  } else {
    tabVars.classList.add('active');
    if (contVars) contVars.classList.add('active');
    _simRefreshVarsPanel();
  }
}

function _simToggleVarsPanel() {
  var p = document.getElementById('sim-vars-panel');
  if (!p) return;
  if (p.classList.contains('sim-vars-visible')) {
    p.classList.remove('sim-vars-visible');
  } else {
    _simRefreshVarsPanel();
    p.classList.add('sim-vars-visible');
  }
}

// ── Painel de Arquivos ──────────────────────────────────────────
function _simRefreshFilesPanel() {
  var list = document.getElementById('sim-files-list');
  if (!list) return;
  var fds = Object.keys(_simFiles);
  if (fds.length === 0) {
    list.innerHTML = '<div class="sim-file-empty">Nenhum arquivo (FD) encontrado na FILE SECTION do código.</div>';
    return;
  }
  // monta opções de books disponíveis
  var bkOptions = '<option value="">— sem layout —</option>';
  if (typeof _bkBooks !== 'undefined' && _bkBooks) {
    _bkBooks.forEach(function(b) {
      if (b.layout && b.layout.length > 0) {
        var leafCount = b.layout.filter(function(f){ return !f.isGroup; }).length;
        var dataCount = (typeof _bkDataStore !== 'undefined' && _bkDataStore[b.id]) ? _bkDataStore[b.id].length : 0;
        var dataInfo  = dataCount > 0 ? ' | ' + dataCount + ' reg.' : '';
        bkOptions += '<option value="' + b.id + '">' + b.name + ' (' + leafCount + ' campos' + dataInfo + ')</option>';
      }
    });
  }
  var html = '';
  fds.forEach(function(fdName) {
    var fd = _simFiles[fdName];
    var ptr = fd.pointer;
    var total = fd.records.length;
    var activeFields = _simGetActiveFields(fdName);
    var isOpen   = !!fd.isOpen;
    var fsCode   = fd.fileStatus !== undefined ? String(fd.fileStatus) : null;
    var modeIcons = { 'INPUT': '&#8595; INPUT', 'OUTPUT': '&#8593; OUTPUT', 'I-O': '&#8597; I-O', 'EXTEND': '&#8659; EXTEND' };
    var modeLabel = (isOpen && fd.openMode) ? (modeIcons[fd.openMode] || fd.openMode) : '';
    var openBadge = isOpen
      ? '<span class="sim-file-open-badge sim-file-open-badge--open" title="Arquivo aberto como ' + (fd.openMode || '') + '">\u2299 ABERTO' + (modeLabel ? ' <span class="sim-file-mode-badge sim-file-mode-' + fd.openMode.replace(/[^A-Za-z]/g,'') + '">' + modeLabel + '</span>' : '') + '</span>'
      : '<span class="sim-file-open-badge sim-file-open-badge--closed" title="Arquivo fechado">\u2297 FECHADO</span>';
    var fsBadge   = fsCode !== null
      ? '<span class="sim-file-fs-badge' + (fsCode === '10' ? ' sim-file-fs-badge--atend' : fsCode !== '00' ? ' sim-file-fs-badge--err' : '') + '" title="FILE STATUS">FS:' + fsCode + '</span>'
      : '';
    html += '<div class="sim-file-block">';
    html += '<div class="sim-file-title">';
    html += '<span class="sim-file-name">&#128193; ' + fdName + '</span>';
    html += '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0">';
    html += openBadge + fsBadge;
    if (fd.isOutput && fd.records.length > 0) {
      html += '<div class="sim-file-export-wrap" id="sim-exp-' + fdName + '">';
      html += '<button class="sim-file-export-btn" onclick="_simToggleExportMenu(\'' + fdName + '\')" title="Exportar registros">&#8595; Exportar</button>';
      html += '<div class="sim-file-export-menu" id="sim-exp-menu-' + fdName + '">';
      html += '<button onclick="_simExportFile(\'' + fdName + '\',\'csv\')">\ud83d\udcc4 CSV</button>';
      html += '<button onclick="_simExportFile(\'' + fdName + '\',\'tsv\')">\ud83d\udcc4 TSV</button>';
      html += '<button onclick="_simExportFile(\'' + fdName + '\',\'xlsx\')">&#128202; Excel (XLSX)</button>';
      html += '<button onclick="_simExportFile(\'' + fdName + '\',\'json\')">{ } JSON</button>';
      html += '<button onclick="_simExportFile(\'' + fdName + '\',\'txt\')">&#8801; TXT Fixo</button>';
      html += '</div></div>';
    }
    html += '<button class="sim-file-add-btn" onclick="_simAddFileRecord(\'' + fdName + '\')">+ Registro</button>';
    html += '<span class="sim-file-ptr">&#9654; ' + ptr + '/' + total + '</span>';
    html += '</div>';
    html += '</div>';
    // barra de seleção de book layout
    html += '<div class="sim-file-book-bar">';
    html += '<span class="sim-file-book-lbl">Layout:</span>';
    html += '<select class="sim-file-book-sel" id="sim-bksel-' + fdName + '" onchange="_simSelectBookLayout(\'' + fdName + '\',this.value)">';
    html += bkOptions;
    html += '</select>';
    if (fd.bookId) {
      html += '<span class="sim-file-book-badge">' + activeFields.length + ' campos do book</span>';
    }
    html += '</div>';
    if (activeFields.length === 0) {
      html += '<div class="sim-file-empty">Sem campos definidos neste FD.</div>';
    } else {
      html += '<div class="sim-file-table-wrap"><table class="sim-file-table">';
      html += '<thead><tr><th class="sim-file-th-status"></th>';
      activeFields.forEach(function(f) {
        var meta = fd.bookId ? _simGetBookFieldMeta(fd.bookId, f) : null;
        var title = meta ? ' title="PIC: ' + (meta.pic||'') + ' | Tam: ' + (meta.size||'') + ' | In\u00edcio: ' + (meta.offset||0) + '"' : '';
        html += '<th' + title + '>' + f + '</th>';
      });
      html += '<th></th></tr></thead><tbody id="sim-file-tbody-' + fdName + '">';
      if (fd.records.length === 0) {
        html += '<tr><td colspan="' + (activeFields.length + 2) + '" class="sim-file-empty">Sem registros. Clique + Registro para adicionar.</td></tr>';
      } else {
        fd.records.forEach(function(rec, idx) {
          var rowClass, statusCell;
          if (fd.isOutput) {
            // Arquivo de saída: todos os registros já foram gravados via WRITE
            rowClass   = 'sim-file-row-written';
            statusCell = '<td class="sim-file-td-status"><span class="sim-row-badge sim-row-badge--written" title="Gravado">↑ GRAV</span></td>';
          } else {
            var isActive = (idx === ptr - 1);  // último lido
            var isNext   = (idx === ptr);        // próximo a ser lido
            var isRead   = (idx < ptr - 1);      // já lido antes
            rowClass  = isActive ? 'sim-file-row-active'
                      : isNext   ? 'sim-file-row-next'
                      : isRead   ? 'sim-file-row-read'
                      : 'sim-file-row-pending';
            statusCell = isActive
              ? '<td class="sim-file-td-status"><span class="sim-row-badge sim-row-badge--active" title="Último lido">► LIDO</span></td>'
              : isNext
              ? '<td class="sim-file-td-status"><span class="sim-row-badge sim-row-badge--next" title="Próximo READ">⏵ PRÓX</span></td>'
              : isRead
              ? '<td class="sim-file-td-status"><span class="sim-row-badge sim-row-badge--read" title="Já lido">✓</span></td>'
              : '<td class="sim-file-td-status"></td>';
          }
          html += '<tr class="' + rowClass + '">' + statusCell;
          activeFields.forEach(function(f) {
            var val = rec[f] !== undefined ? rec[f] : '';
            html += '<td><input class="sim-file-cell-input" data-fd="' + fdName + '" data-idx="' + idx + '" data-field="' + f + '" value="' + val.replace(/"/g,'&quot;') + '" onchange="_simFileSetField(this)"></td>';
          });
          html += '<td><button class="sim-file-del-btn" onclick="_simRemoveFileRecord(\'' + fdName + '\',' + idx + ')">&#10005;</button></td>';
          html += '</tr>';
        });
      }
      html += '</tbody></table></div>';
    }
    html += '</div>';
  });
  list.innerHTML = html;
  // restaura o book selecionado em cada FD (select perde valor após innerHTML)
  fds.forEach(function(fdName) {
    var fd = _simFiles[fdName];
    if (fd.bookId) {
      var sel = document.getElementById('sim-bksel-' + fdName);
      if (sel) sel.value = String(fd.bookId);
    }
  });
}

function _simGetActiveFields(fdName) {
  var fd = _simFiles[fdName];
  if (!fd) return [];
  if (fd.bookId) {
    var bf = _simGetBookFields(fd.bookId);
    if (bf && bf.length > 0) return bf;
  }
  return fd.fields;
}

function _simGetBookFields(bookId) {
  if (typeof _bkBooks === 'undefined' || !_bkBooks) return null;
  var book = _bkBooks.find(function(b){ return String(b.id) === String(bookId); });
  if (!book || !book.layout) return null;
  // Oculta campos que são alvo de REDEFINES (layout ou interno) — seus bytes já estão
  // representados pelos campos da variante/decomposição. Mostrar ambos seria
  // exibir os mesmos bytes duas vezes na grade do simulador.
  var layoutTargets = (typeof bkGetRedefGroups === 'function')
    ? Object.keys(bkGetRedefGroups(book))
    : [];
  var internalTargets = [];
  book.layout.forEach(function(f) {
    if (f.redefines && f.redefType === 'internal') internalTargets.push(f.redefines);
  });
  return book.layout.filter(function(f) {
    return !f.isGroup &&
           layoutTargets.indexOf(f.name) === -1 &&
           internalTargets.indexOf(f.name) === -1;
  }).map(function(f){ return f.name; });
}

function _simGetBookFieldMeta(bookId, fieldName) {
  if (typeof _bkBooks === 'undefined' || !_bkBooks) return null;
  var book = _bkBooks.find(function(b){ return String(b.id) === String(bookId); });
  if (!book || !book.layout) return null;
  return book.layout.find(function(f){ return f.name === fieldName; }) || null;
}

function _simSelectBookLayout(fdName, bookId) {
  var fd = _simFiles[fdName];
  if (!fd) return;
  if (bookId && fd.records.length > 0) {
    if (!confirm('Trocar o layout vai limpar os registros de "' + fdName + '".\nDeseja continuar?')) {
      var sel = document.getElementById('sim-bksel-' + fdName);
      if (sel) sel.value = fd.bookId ? String(fd.bookId) : '';
      return;
    }
  }
  fd.bookId = bookId || null;
  fd.records = [];
  // Auto-importa registros do painel "Importar Dados" do Book, se houver
  if (fd.bookId) _simAutoImportBookData(fdName);
  _simRefreshFilesPanel();
}

// Decodifica _raw diretamente pelo textOffset de TODOS os campos folha do book,
// ignorando regras de visibilidade de REDEFINES — o simulador precisa de todos os valores.
function _simDecodeRawAllFields(raw, book) {
  var rec = {};
  if (!raw || !book || !book.layout) return rec;
  book.layout.forEach(function(f) {
    if (f.isGroup) return;
    var to = (f.textOffset !== undefined) ? f.textOffset : f.offset;
    var ds = (f.displaySize !== undefined) ? f.displaySize : f.size;
    if (!ds) return;
    rec[f.name] = (raw + '          ').substring(0, Math.max(raw.length, to + ds)).substring(to, to + ds);
  });
  return rec;
}

// Importa registros de _bkDataStore do book associado ao FD
function _simAutoImportBookData(fdName) {
  var fd = _simFiles[fdName];
  if (!fd || !fd.bookId) return;
  var store = (typeof _bkDataStore !== 'undefined') && _bkDataStore[fd.bookId];
  if (!store || store.length === 0) return;

  // Usa comparação por String para evitar falha quando fd.bookId é string (vem do <select>)
  // e b.id é number (gerado por _bkNextId). Ex: '1' === 1 → false (estrito), mas String('1') === String(1) → true.
  var book = (typeof _bkBooks !== 'undefined') ? _bkBooks.find(function(b) { return String(b.id) === String(fd.bookId); }) : null;

  var activeFields = _simGetActiveFields(fdName);
  store.forEach(function(entry) {
    var decoded;
    if (entry._raw != null && book) {
      // Lê diretamente do _raw usando textOffset de TODOS os campos folha,
      // sem filtrar por variante/visibilidade — o simulador precisa de todos os valores
      // (tanto campos base quanto variante) para que READ funcione corretamente.
      decoded = _simDecodeRawAllFields(entry._raw, book);
    } else {
      decoded = (book && typeof _bkRowFields === 'function')
        ? _bkRowFields(entry, book)
        : (entry.fields || {});
    }
    var rec = {};
    Object.keys(decoded).forEach(function(f) {
      rec[f] = decoded[f] !== undefined ? decoded[f] : '';
    });
    // Garante que todas as colunas visíveis existam no rec (para exibição na grade)
    activeFields.forEach(function(f) {
      if (rec[f] === undefined) rec[f] = '';
    });
    fd.records.push(rec);
  });
  _simLog('\uD83D\uDCE5 ' + store.length + ' registro(s) do Book importado(s) para ' + fdName, 'sim-log-info');
}

function _simAddFileRecord(fdName) {
  var fd = _simFiles[fdName];
  if (!fd) return;
  var activeFields = _simGetActiveFields(fdName);
  var rec = {};
  activeFields.forEach(function(f) { rec[f] = ''; });
  fd.records.push(rec);
  _simRefreshFilesPanel();
}

function _simRemoveFileRecord(fdName, idx) {
  var fd = _simFiles[fdName];
  if (!fd) return;
  fd.records.splice(idx, 1);
  if (fd.pointer > fd.records.length) fd.pointer = fd.records.length;
  _simRefreshFilesPanel();
}

// Alterna visibilidade do menu de exportação
function _simToggleExportMenu(fdName) {
  var menu = document.getElementById('sim-exp-menu-' + fdName);
  if (!menu) return;
  var isOpen = menu.classList.contains('sim-exp-open');
  // fecha todos os outros menus abertos
  document.querySelectorAll('.sim-file-export-menu.sim-exp-open').forEach(function(m) {
    m.classList.remove('sim-exp-open');
  });
  if (!isOpen) menu.classList.add('sim-exp-open');
}

// Exporta registros do arquivo de saída no formato solicitado
function _simExportFile(fdName, fmt) {
  var menu = document.getElementById('sim-exp-menu-' + fdName);
  if (menu) menu.classList.remove('sim-exp-open');
  var fd = _simFiles[fdName];
  if (!fd || fd.records.length === 0) return;
  var fields = _simGetActiveFields(fdName);
  var rows   = fd.records;
  var fname  = fdName.replace(/[^A-Z0-9-_]/gi, '_');

  if (fmt === 'csv' || fmt === 'tsv') {
    var sep = fmt === 'tsv' ? '\t' : ',';
    var lines = [];
    lines.push(fields.map(function(f) { return _csvEsc(f, sep); }).join(sep));
    rows.forEach(function(r) {
      lines.push(fields.map(function(f) { return _csvEsc(r[f] !== undefined ? String(r[f]) : '', sep); }).join(sep));
    });
    _simDownload(fname + '.' + fmt, lines.join('\r\n'), 'text/plain;charset=utf-8');

  } else if (fmt === 'json') {
    var out = rows.map(function(r) {
      var obj = {};
      fields.forEach(function(f) { obj[f] = r[f] !== undefined ? r[f] : ''; });
      return obj;
    });
    _simDownload(fname + '.json', JSON.stringify(out, null, 2), 'application/json');

  } else if (fmt === 'txt') {
    // Formato posicional COBOL: colunas com largura máxima de cada campo
    var widths = fields.map(function(f) {
      var w = f.length;
      rows.forEach(function(r) { var v = r[f] !== undefined ? String(r[f]) : ''; if (v.length > w) w = v.length; });
      return w;
    });
    var pad = function(s, w) { s = String(s); while (s.length < w) s += ' '; return s.substring(0, w); };
    var txtLines = [];
    txtLines.push(fields.map(function(f, i) { return pad(f, widths[i]); }).join(' '));
    txtLines.push(widths.map(function(w) { return new Array(w + 1).join('-'); }).join(' '));
    rows.forEach(function(r) {
      txtLines.push(fields.map(function(f, i) { return pad(r[f] !== undefined ? r[f] : '', widths[i]); }).join(' '));
    });
    _simDownload(fname + '.txt', txtLines.join('\r\n'), 'text/plain;charset=utf-8');

  } else if (fmt === 'xlsx') {
    _simExportXLSX(fname, fields, rows);
  }
}

function _csvEsc(val, sep) {
  val = String(val);
  if (val.indexOf(sep) >= 0 || val.indexOf('"') >= 0 || val.indexOf('\n') >= 0) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

function _simDownload(filename, content, mime) {
  var blob = new Blob([content], { type: mime });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// Gera XLSX sem dependências externas (formato SpreadsheetML XML dentro de ZIP)
function _simExportXLSX(fname, fields, rows) {
  // Converte string para ArrayBuffer UTF-8
  function s2ab(s) {
    var buf = new ArrayBuffer(s.length);
    var view = new Uint8Array(buf);
    for (var i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xFF;
    return buf;
  }
  function xmlEsc(v) {
    return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  // Cabeçalho da planilha
  var sheetRows = '';
  sheetRows += '<row r="1">';
  fields.forEach(function(f, ci) {
    var col = String.fromCharCode(65 + ci);
    sheetRows += '<c r="' + col + '1" t="inlineStr"><is><t>' + xmlEsc(f) + '</t></is></c>';
  });
  sheetRows += '</row>';
  rows.forEach(function(r, ri) {
    sheetRows += '<row r="' + (ri + 2) + '">';
    fields.forEach(function(f, ci) {
      var col = String.fromCharCode(65 + ci);
      var val = r[f] !== undefined ? r[f] : '';
      var isNum = val !== '' && !isNaN(Number(val));
      if (isNum) {
        sheetRows += '<c r="' + col + (ri + 2) + '"><v>' + xmlEsc(val) + '</v></c>';
      } else {
        sheetRows += '<c r="' + col + (ri + 2) + '" t="inlineStr"><is><t>' + xmlEsc(val) + '</t></is></c>';
      }
    });
    sheetRows += '</row>';
  });
  var sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetData>' + sheetRows + '</sheetData></worksheet>';
  var wbXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheets><sheet name="' + xmlEsc(fname.substring(0,31)) + '" sheetId="1" r:id="rId1"/></sheets></workbook>';
  var relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"'
    + ' Target="worksheets/sheet1.xml"/></Relationships>';
  var ctXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '</Types>';
  // Monta ZIP simples (usando jszip se disponível, senão fallback para CSV)
  if (typeof JSZip !== 'undefined') {
    var zip = new JSZip();
    zip.file('[Content_Types].xml', ctXml);
    zip.folder('_rels').file('.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"'
      + ' Target="xl/workbook.xml"/></Relationships>');
    zip.folder('xl').file('workbook.xml', wbXml);
    zip.folder('xl/_rels').file('workbook.xml.rels', relsXml);
    zip.folder('xl/worksheets').file('sheet1.xml', sheetXml);
    zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      .then(function(blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url; a.download = fname + '.xlsx';
        document.body.appendChild(a); a.click();
        setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 1000);
      });
  } else {
    // Fallback: exporta como CSV com aviso
    _simLog('\u26a0 JSZip n\u00e3o encontrado \u2014 exportando como CSV.', 'sim-log-branch');
    var sep = ',';
    var lines = [];
    lines.push(fields.map(function(f) { return _csvEsc(f, sep); }).join(sep));
    rows.forEach(function(r) {
      lines.push(fields.map(function(f) { return _csvEsc(r[f] !== undefined ? String(r[f]) : '', sep); }).join(sep));
    });
    _simDownload(fname + '.csv', lines.join('\r\n'), 'text/plain;charset=utf-8');
  }
}

function _simFileSetField(inp) {
  var fdName = inp.dataset.fd;
  var idx    = parseInt(inp.dataset.idx, 10);
  var field  = inp.dataset.field;
  var fd = _simFiles[fdName];
  if (!fd || !fd.records[idx]) return;
  fd.records[idx][field] = inp.value;
}

// ── Painel DB2 ─────────────────────────────────────────────────

// Extrai tabelas usadas em EXEC SQL e detecta colunas via SELECT ... INTO ... FROM
function _parseDb2Tables(code) {
  var tables = {};
  if (!code) return tables;
  // Normaliza linhas (remove colunas de sequência, continuações e comentários)
  var normalized = code.split('\n').map(function(l) {
    if (l.length >= 7 && /^[\d ]{6}/.test(l)) {
      if (l[6] === '-') l = l.slice(7); // linha de continuação COBOL
      else l = l.slice(6);
    }
    var t = l.trim();
    if (!t || t[0] === '*' || t.startsWith('*>')) return '';
    return t;
  }).join(' ');
  // Extrai blocos EXEC SQL ... END-EXEC
  var execRe = /EXEC\s+SQL\s+([\s\S]+?)\s+END-EXEC/gi;
  var m;
  while ((m = execRe.exec(normalized)) !== null) {
    var sql = m[1].replace(/\s+/g, ' ').trim().toUpperCase();
    // SELECT ... INTO ... FROM table
    var selM = sql.match(/^SELECT\s+([\s\S]+?)\s+INTO\s+([\s\S]+?)\s+FROM\s+([A-Z][A-Z0-9_#@]*)(?:\s+WHERE\s+([\s\S]*))?$/i);
    if (selM) {
      var cols     = selM[1].replace(/\s+/g,'').split(',').map(function(c){ return c.trim().replace(/^:/,''); }).filter(Boolean);
      var intoVars = selM[2].replace(/\s+/g,'').split(',').map(function(v){ return v.trim().replace(/^:/,''); }).filter(Boolean);
      var tbl = selM[3];
      if (!tables[tbl]) tables[tbl] = { columns: [], rows: [], selectMaps: [] };
      cols.forEach(function(c){ if (tables[tbl].columns.indexOf(c) < 0) tables[tbl].columns.push(c); });
      tables[tbl].selectMaps.push({ cols: cols, into: intoVars });
    }
    // INSERT INTO table (cols) VALUES (...)
    var insM = sql.match(/^INSERT\s+INTO\s+([A-Z][A-Z0-9_#@]*)\s*(?:\(([^)]+)\))?/i);
    if (insM) {
      var tbl2 = insM[1];
      if (!tables[tbl2]) tables[tbl2] = { columns: [], rows: [], selectMaps: [] };
      if (insM[2]) {
        insM[2].split(',').forEach(function(c){
          var cn = c.trim().replace(/^:/,'');
          if (tables[tbl2].columns.indexOf(cn) < 0) tables[tbl2].columns.push(cn);
        });
      }
    }
    // UPDATE table SET col=:v WHERE col=:v — extrai colunas do SET e do WHERE
    var updM = sql.match(/^UPDATE\s+([A-Z][A-Z0-9_#@]*)\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]*))?$/i);
    if (updM) {
      var tblUpd = updM[1];
      if (!tables[tblUpd]) tables[tblUpd] = { columns: [], rows: [], selectMaps: [] };
      // Colunas do SET: "NOME = :WS-NOME, SALDO = :WS-SALDO"
      (updM[2] || '').split(',').forEach(function(sa) {
        var cm = sa.trim().match(/^([A-Z][A-Z0-9_#@]*)\s*=/i);
        if (cm) { var cn = cm[1].trim(); if (tables[tblUpd].columns.indexOf(cn) < 0) tables[tblUpd].columns.push(cn); }
      });
      // Colunas do WHERE: "ID = :WS-ID AND ..."
      (updM[3] || '').split(/\s+AND\s+/i).forEach(function(wc) {
        var wm = wc.trim().match(/^([A-Z][A-Z0-9_#@]*)\s*=/i);
        if (wm) { var cn = wm[1].trim(); if (tables[tblUpd].columns.indexOf(cn) < 0) tables[tblUpd].columns.push(cn); }
      });
    } else {
      // Fallback: só detecta a tabela sem colunas (UPDATE sem SET visível no label)
      var updFb = sql.match(/^UPDATE\s+([A-Z][A-Z0-9_#@]*)/i);
      if (updFb && !tables[updFb[1]]) tables[updFb[1]] = { columns: [], rows: [], selectMaps: [] };
    }
    // DELETE FROM table WHERE col=:v — extrai colunas do WHERE
    var delM = sql.match(/^DELETE\s+FROM\s+([A-Z][A-Z0-9_#@]*)(?:\s+WHERE\s+([\s\S]*))?$/i);
    if (delM) {
      var tblDel = delM[1];
      if (!tables[tblDel]) tables[tblDel] = { columns: [], rows: [], selectMaps: [] };
      (delM[2] || '').split(/\s+AND\s+/i).forEach(function(wc) {
        var wm = wc.trim().match(/^([A-Z][A-Z0-9_#@]*)\s*=/i);
        if (wm) { var cn = wm[1].trim(); if (tables[tblDel].columns.indexOf(cn) < 0) tables[tblDel].columns.push(cn); }
      });
    }
    // SELECT WHERE — extrai colunas do WHERE também (ex: WHERE ID = :WS-ID)
    if (selM) {
      var tblSel = selM[3];
      (selM[4] || '').split(/\s+AND\s+/i).forEach(function(wc) {
        var wm = wc.trim().match(/^([A-Z][A-Z0-9_#@]*)\s*=/i);
        if (wm) { var cn = wm[1].trim(); if (tables[tblSel] && tables[tblSel].columns.indexOf(cn) < 0) tables[tblSel].columns.push(cn); }
      });
    }
  }
  return tables;
}

// Extrai definições de CURSOR (DECLARE cursor CURSOR FOR SELECT ...)
function _parseDb2Cursors(code, tables) {
  var cursors = {};
  if (!code) return cursors;
  var normalized = code.split('\n').map(function(l) {
    if (l.length >= 7 && /^[\d ]{6}/.test(l)) {
      if (l[6] === '-') l = l.slice(7);
      else l = l.slice(6);
    }
    var t = l.trim();
    if (!t || t[0] === '*' || t.startsWith('*>')) return '';
    return t;
  }).join(' ');
  var execRe = /EXEC\s+SQL\s+([\s\S]+?)\s+END-EXEC/gi;
  var m;
  while ((m = execRe.exec(normalized)) !== null) {
    var sql = m[1].replace(/\s+/g, ' ').trim().toUpperCase();
    // DECLARE cursor CURSOR [WITH HOLD] FOR SELECT cols FROM table [WHERE ...] [ORDER BY ...]
    var declM = sql.match(/^DECLARE\s+([A-Z][A-Z0-9_]*)\s+CURSOR\s+(?:[\s\S]+?\s+)?FOR\s+SELECT\s+([\s\S]+?)\s+FROM\s+([A-Z][A-Z0-9_#@]*)(?:\s+WHERE\s+([\s\S]+?))?(?:\s+ORDER\s+BY\s+[\s\S]*)?$/i);
    if (declM) {
      var cursorName = declM[1];
      var rawCols    = declM[2].trim();
      var tblName    = declM[3];
      var cols = rawCols === '*' ? [] :
        rawCols.replace(/\s+/g,'').split(',').map(function(c){ return c.trim().replace(/^:/,''); }).filter(Boolean);
      if (!tables[tblName]) tables[tblName] = { columns: [], rows: [], selectMaps: [] };
      cols.forEach(function(c){ if (tables[tblName].columns.indexOf(c) < 0) tables[tblName].columns.push(c); });
      // WHERE cols também
      (declM[4] || '').split(/\s+AND\s+/i).forEach(function(wc) {
        var wm = wc.trim().match(/^([A-Z][A-Z0-9_#@]*)\s*=/i);
        if (wm) { var cn = wm[1].trim(); if (tables[tblName].columns.indexOf(cn) < 0) tables[tblName].columns.push(cn); }
      });
      cursors[cursorName] = { tableName: tblName, cols: cols, pointer: 0, isOpen: false, intoVars: [] };
    }
    // FETCH cursor INTO :v1, :v2 — guarda intoVars no cursor para uso no runtime
    var fetchM = sql.match(/^FETCH\s+([A-Z][A-Z0-9_]*)\s+INTO\s+([\s\S]+)$/i);
    if (fetchM) {
      var fcName = fetchM[1];
      var intoV  = fetchM[2].split(',').map(function(v){ return v.trim().replace(/^:/,''); }).filter(Boolean);
      if (cursors[fcName]) cursors[fcName].intoVars = intoV;
      // fallback: cria entrada rasa se ainda não existe
      else cursors[fcName] = { tableName: '', cols: [], pointer: 0, isOpen: false, intoVars: intoV };
    }
  }
  return cursors;
}

// Monta HTML do painel de tabelas DB2
function _simRefreshDb2Panel() {
  var list = document.getElementById('sim-db2-list');
  if (!list) return;
  var tableNames = Object.keys(_simDb2Tables);
  if (tableNames.length === 0) {
    list.innerHTML = '<div class="sim-file-empty">Nenhuma tabela DB2 encontrada. Use EXEC SQL SELECT no código ou importe um DDL.</div>';
    return;
  }

  // Monta opções do dropdown de tabelas do Banco de Dados (igual ao bkOptions do book)
  var dbOptions = '<option value="">— sem dados —</option>';
  if (typeof _dbTables !== 'undefined' && _dbTables) {
    _dbTables.forEach(function(t) {
      var rowCnt = (typeof _dbDataStore !== 'undefined' && _dbDataStore[t.id]) ? _dbDataStore[t.id].length : 0;
      var info = rowCnt > 0 ? ' (' + rowCnt + ' reg.)' : '';
      dbOptions += '<option value="' + t.id + '">' + t.name + info + '</option>';
    });
  }

  var html = '';
  tableNames.forEach(function(tblName) {
    var tbl  = _simDb2Tables[tblName];
    var cols = tbl.columns;
    html += '<div class="sim-db2-block">';
    html += '<div class="sim-db2-title">';
    html += '<span class="sim-db2-tname">&#128448; ' + tblName + '</span>';
    html += '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0">';
    html += '<span class="sim-db2-rowcnt">' + tbl.rows.length + ' linha(s)</span>';
    // Badges de cursor para esta tabela
    Object.keys(_simDb2Cursors).forEach(function(curName) {
      var cur = _simDb2Cursors[curName];
      if (cur.tableName !== tblName) return;
      var badge = cur.isOpen
        ? '<span class="sim-db2-cursor-badge sim-db2-cursor-badge--open" title="Cursor aberto">&#8631; ' + curName + ' ' + cur.pointer + '/' + tbl.rows.length + '</span>'
        : '<span class="sim-db2-cursor-badge sim-db2-cursor-badge--closed" title="Cursor fechado">&#8634; ' + curName + '</span>';
      html += badge;
    });
    if (cols.length > 0) {
      html += '<button class="sim-db2-addcol-btn" onclick="_simDb2AddCol(\'' + tblName + '\')">+ Col</button>';
    }
    html += '<button class="sim-db2-add-btn" onclick="_simDb2AddRow(\'' + tblName + '\')">+ Linha</button>';
    html += '</div></div>';

    // ── Barra de seleção do Banco de Dados (igual à sim-file-book-bar) ──
    html += '<div class="sim-file-book-bar">';
    html += '<span class="sim-file-book-lbl">Banco:</span>';
    html += '<select class="sim-file-book-sel" id="sim-db2sel-' + tblName + '" onchange="_simDb2SelectDbTable(\'' + tblName + '\',this.value)">';
    html += dbOptions;
    html += '</select>';
    if (tbl.dbTableId) {
      html += '<span class="sim-file-book-badge">' + tbl.rows.length + ' registros do BD</span>';
    }
    html += '</div>';

    if (cols.length === 0) {
      html += '<div class="sim-file-empty" style="margin:8px">Sem colunas. Use SELECT col FROM ' + tblName + ' no EXEC SQL ou importe DDL.</div>';
      html += '<div style="text-align:center;padding:0 8px 10px">';
      html += '<button class="sim-db2-add-btn" onclick="_simDb2AddCol(\'' + tblName + '\')">+ Adicionar Coluna</button></div>';
    } else {
      html += '<div class="sim-db2-table-wrap"><table class="sim-db2-table">';
      html += '<thead><tr>';
      cols.forEach(function(c){ html += '<th class="sim-db2-th">' + c + '</th>'; });
      html += '<th class="sim-db2-th-del"></th></tr></thead>';
      html += '<tbody>';
      if (tbl.rows.length === 0) {
        html += '<tr><td colspan="' + (cols.length + 1) + '" class="sim-file-empty">Sem linhas. Clique + Linha para adicionar.</td></tr>';
      } else {
        tbl.rows.forEach(function(row, idx) {
          // Destaca a linha que acabou de ser lida pelo FETCH
          var _isCurRow = Object.keys(_simDb2Cursors).some(function(cn) {
            var c = _simDb2Cursors[cn];
            return c.tableName === tblName && c.isOpen && c.pointer > 0 && idx === c.pointer - 1;
          });
          html += '<tr' + (_isCurRow ? ' class="sim-db2-row-current"' : '') + '>';
          cols.forEach(function(c) {
            var val = row[c] !== undefined ? String(row[c]) : '';
            html += '<td><input class="sim-db2-input" data-tbl="' + tblName + '" data-idx="' + idx + '" data-col="' + c + '" value="' + val.replace(/"/g,'&quot;') + '" oninput="_simDb2SetCell(this)"></td>';
          });
          html += '<td><button class="sim-file-del-btn" onclick="_simDb2RemoveRow(\'' + tblName + '\',' + idx + ')">&#10005;</button></td>';
          html += '</tr>';
        });
      }
      html += '</tbody></table></div>';
    }
    html += '</div>';
  });
  list.innerHTML = html;
  // Restaura o select de BD selecionado em cada tabela (innerHTML reseta o value)
  tableNames.forEach(function(tblName) {
    var tbl = _simDb2Tables[tblName];
    if (tbl.dbTableId) {
      var sel = document.getElementById('sim-db2sel-' + tblName);
      if (sel) sel.value = String(tbl.dbTableId);
    }
  });
}

function _simDb2AddRow(tblName) {
  var tbl = _simDb2Tables[tblName];
  if (!tbl) { _simDb2Tables[tblName] = { columns: [], rows: [], selectMaps: [] }; tbl = _simDb2Tables[tblName]; }
  var rec = {};
  tbl.columns.forEach(function(c){ rec[c] = ''; });
  tbl.rows.push(rec);
  _simRefreshDb2Panel();
}

function _simDb2RemoveRow(tblName, idx) {
  var tbl = _simDb2Tables[tblName];
  if (!tbl) return;
  tbl.rows.splice(idx, 1);
  _simRefreshDb2Panel();
}

function _simDb2SetCell(inputEl) {
  var tblName = inputEl.getAttribute('data-tbl');
  var idx     = parseInt(inputEl.getAttribute('data-idx'), 10);
  var col     = inputEl.getAttribute('data-col');
  var tbl = _simDb2Tables[tblName];
  if (!tbl || !tbl.rows[idx]) return;
  tbl.rows[idx][col] = inputEl.value;
}

function _simDb2AddCol(tblName) {
  var colName = prompt('Nome da nova coluna para ' + tblName + ':');
  if (!colName) return;
  colName = colName.trim().toUpperCase();
  if (!_simDb2Tables[tblName]) _simDb2Tables[tblName] = { columns: [], rows: [], selectMaps: [] };
  var tbl = _simDb2Tables[tblName];
  if (tbl.columns.indexOf(colName) >= 0) { alert('Coluna ' + colName + ' já existe.'); return; }
  tbl.columns.push(colName);
  tbl.rows.forEach(function(r){ r[colName] = ''; });
  _simRefreshDb2Panel();
}

// Importa DDL (CREATE TABLE) de um arquivo externo
function _simDb2ImportDdl(inputEl) {
  var file = inputEl.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var ddl = e.target.result.toUpperCase();
    var createRe = /CREATE\s+TABLE\s+([A-Z][A-Z0-9_#@]*)\s*\(([^)]+)\)/g;
    var m2;
    var imported = 0;
    while ((m2 = createRe.exec(ddl)) !== null) {
      var tblName = m2[1];
      var colsDef = m2[2];
      var cols = [];
      colsDef.split(',').forEach(function(def) {
        var cn = def.trim().match(/^([A-Z][A-Z0-9_#@]*)/);
        if (cn) cols.push(cn[1]);
      });
      if (!_simDb2Tables[tblName]) _simDb2Tables[tblName] = { columns: [], rows: [], selectMaps: [] };
      if (cols.length > 0) _simDb2Tables[tblName].columns = cols;
      imported++;
    }
    alert(imported > 0 ? imported + ' tabela(s) importada(s) do DDL.' : 'Nenhum CREATE TABLE encontrado no arquivo.');
    _simRefreshDb2Panel();
    inputEl.value = '';
  };
  reader.readAsText(file);
}

// ── Seleção e importação de dados do Banco de Dados para tabelas DB2 ─────────
// Padrão idêntico ao _simSelectBookLayout para arquivos.

// Chamado ao mudar o <select> de BD em cada tabela DB2
function _simDb2SelectDbTable(tblName, dbTableId) {
  var tbl = _simDb2Tables[tblName];
  if (!tbl) return;
  if (dbTableId && tbl.rows.length > 0) {
    if (!confirm('Trocar o Banco de Dados vai limpar os registros de "' + tblName + '".\nDeseja continuar?')) {
      var sel = document.getElementById('sim-db2sel-' + tblName);
      if (sel) sel.value = tbl.dbTableId ? String(tbl.dbTableId) : '';
      return;
    }
  }
  tbl.dbTableId = dbTableId ? parseInt(dbTableId, 10) : null;
  tbl.rows = [];
  // Importa registros do BD selecionado, igual ao _simAutoImportBookData
  if (tbl.dbTableId) _simDb2LoadFromDbEntry(tblName, tbl.dbTableId);
  _simRefreshDb2Panel();
}

// Importa registros de _dbDataStore[dbTableId] para _simDb2Tables[tblName]
function _simDb2LoadFromDbEntry(tblName, dbTableId) {
  if (typeof _dbTables === 'undefined' || typeof _dbDataStore === 'undefined') return 0;
  var tbl = _simDb2Tables[tblName];
  if (!tbl) return 0;
  var dbEntry = _dbTables.find(function(t) { return t.id === dbTableId; });
  if (!dbEntry) return 0;
  var store = _dbDataStore[dbEntry.id];
  if (!store || store.length === 0) return 0;
  // Sincroniza colunas do BD → tabela DB2
  (dbEntry.columns || []).forEach(function(c) {
    var colName = (typeof c === 'object' ? (c.name || '') : c).toUpperCase();
    if (colName && tbl.columns.indexOf(colName) === -1) tbl.columns.push(colName);
  });
  var imported = 0;
  store.forEach(function(entry) {
    var fields = entry.fields || entry;
    var row = {};
    tbl.columns.forEach(function(col) {
      var val = fields[col];
      if (val === undefined) {
        var colLow = col.toLowerCase();
        Object.keys(fields).forEach(function(k) {
          if (k.toLowerCase() === colLow) val = fields[k];
        });
      }
      row[col] = (val !== undefined && val !== null) ? String(val) : '';
    });
    tbl.rows.push(row);
    imported++;
  });
  return imported;
}

// Auto-importa no init: tenta associar pelo nome (igual a auto-detect do book)
function _simAutoImportAllDb2() {
  if (typeof _dbTables === 'undefined' || typeof _dbDataStore === 'undefined') return;
  var total = 0;
  Object.keys(_simDb2Tables).forEach(function(tblName) {
    var tbl = _simDb2Tables[tblName];
    if (tbl.dbTableId) { total += _simDb2LoadFromDbEntry(tblName, tbl.dbTableId); return; }
    // Tenta associar pelo nome (case-insensitive)
    var dbEntry = _dbTables.find(function(t) {
      return t.name.toUpperCase() === tblName.toUpperCase();
    });
    if (dbEntry && _dbDataStore[dbEntry.id] && _dbDataStore[dbEntry.id].length > 0) {
      tbl.dbTableId = dbEntry.id;
      total += _simDb2LoadFromDbEntry(tblName, dbEntry.id);
    }
  });
  if (total > 0)
    _simLog('\uD83D\uDCE5 ' + total + ' registro(s) do Banco de Dados importado(s) para as tabelas DB2.', 'sim-log-info');
}
// ─────────────────────────────────────────────────────────────────────────────


// Reseta ponteiros de todos os arquivos (chamado em simStop)
function _simResetFilePointers() {
  Object.keys(_simFiles).forEach(function(fd) {
    _simFiles[fd].pointer    = 0;
    _simFiles[fd].isOpen     = false;
    _simFiles[fd].openMode   = null;
    _simFiles[fd].fileStatus = undefined;
    // Limpa também a variável WS vinculada via FILE STATUS IS
    var svn = _simFiles[fd].statusVarName;
    if (svn && _simVars.hasOwnProperty(svn)) _simVars[svn] = '';
    // Limpa apenas registros de saída (gerados pelo WRITE); os de entrada permanecem
    if (_simFiles[fd].isOutput) _simFiles[fd].records = [];
  });
  _simLastReadAtEnd = false;
}

// Executa um WRITE simulado: captura valores dos campos e insere na tabela do arquivo
function _simDoWrite(labelU, isRewrite) {
  // Label: "WRITE\nARQ-SAIDA" ou "REWRITE\nARQ-SAIDA" — extrai o nome do arquivo pela 2ª linha
  var lines = labelU.split(/\r?\n/);
  var fdName = (lines[1] || lines[0]).replace(/^(?:WRITE|REWRITE)\s+/i, '').trim();
  // Se não tem FD configurado ainda, cria automaticamente com campos do FILE SECTION
  if (!_simFiles[fdName]) {
    // Procura campos com esse fdName
    var autoFields = [];
    _simVarDefs.forEach(function(v) {
      if (v.fdName === fdName && !v.isGroup && !v.is88) autoFields.push(v.name);
    });
    if (autoFields.length === 0) {
      _simLog('📄 WRITE ' + fdName + ': arquivo não encontrado na FILE SECTION.', 'sim-log-branch');
      return;
    }
    _simFiles[fdName] = { fields: autoFields, records: [], pointer: 0, isOpen: false, isOutput: true };
  }
  var fd = _simFiles[fdName];
  // Valida: arquivo precisa estar aberto
  if (!fd.isOpen) {
    _simSetFileStatus(fd, '48');
    _simLog('\u26d4 ' + (isRewrite ? 'REWRITE' : 'WRITE') + ' ' + fdName + ' \u2192 arquivo n\u00e3o est\u00e1 aberto (FS:48)', 'sim-log-error');
    _simRefreshFilesPanel();
    return;
  }
  // Valida: modo de abertura permite gravação
  if (fd.openMode === 'INPUT') {
    _simSetFileStatus(fd, '48');
    _simLog('\u26d4 ' + (isRewrite ? 'REWRITE' : 'WRITE') + ' ' + fdName + ' \u2192 arquivo aberto como INPUT, grava\u00e7\u00e3o n\u00e3o permitida (FS:48)', 'sim-log-error');
    _simRefreshFilesPanel();
    return;
  }
  fd.isOutput = true;
  // Captura snapshot dos valores atuais dos campos do FD
  var rec = {};
  fd.fields.forEach(function(f) {
    rec[f] = _simVars.hasOwnProperty(f) ? _simVars[f] : '';
  });
  if (isRewrite) {
    // REWRITE: substitui o último registro gravado (ou o do ponteiro atual)
    var replIdx = fd.records.length > 0 ? fd.records.length - 1 : 0;
    if (fd.records.length === 0) {
      fd.records.push(rec);
      _simSetFileStatus(fd, '00');
      if (typeof _repOnFileOp === 'function') _repOnFileOp('write', fdName);
      _simLog('📄 REWRITE ' + fdName + ' → nenhum registro anterior, inserido como novo (FS:00)', 'sim-log-branch');
    } else {
      fd.records[replIdx] = rec;
      _simSetFileStatus(fd, '00');
      if (typeof _repOnFileOp === 'function') _repOnFileOp('write', fdName);
      _simLog('📄 REWRITE ' + fdName + ' → reg ' + (replIdx + 1) + ' atualizado (FS:00)', 'sim-log-branch');
    }
  } else {
    fd.records.push(rec);
    _simSetFileStatus(fd, '00');
    if (typeof _repOnFileOp === 'function') _repOnFileOp('write', fdName);
    _simLog('📄 WRITE ' + fdName + ' → reg ' + fd.records.length + ' gravado (FS:00)', 'sim-log-branch');
  }
  _simRefreshFilesPanel();
  // Destaca aba ARQUIVOS brevemente se painel visível
  var tabFiles = document.getElementById('sim-tab-files');
  if (tabFiles) {
    tabFiles.style.color = '#f59e0b';
    setTimeout(function() { if (tabFiles) tabFiles.style.color = ''; }, 800);
  }
}

function _simRefreshVarsPanel(filterText) {
  var list = document.getElementById('sim-vars-list');
  if (!list) return;
  if (_simVarDefs.length === 0) {
    list.innerHTML = '<div style="color:#6b7280;font-size:11px;padding:12px 10px;">Nenhuma variável encontrada no código. Verifique se há FILE SECTION, WORKING-STORAGE SECTION ou LINKAGE SECTION na DATA DIVISION.</div>';
    return;
  }
  var q = (filterText || (document.getElementById('sim-vars-search') || {}).value || '').toUpperCase();
  var html = '';
  var lastSection = '';
  var lastFdNameRender = '';
  _simVarDefs.forEach(function(v) {
    var nameU = v.name.toUpperCase();
    if (q && nameU.indexOf(q) === -1) return;
    if (v.section !== lastSection) {
      html += '<div class="sim-var-section">' + v.section + ' SECTION</div>';
      lastSection = v.section;
      lastFdNameRender = '';
    }
    // Sub-cabeçalho do arquivo (FD) na FILE SECTION
    if (v.section === 'FILE' && v.fdName && v.fdName !== lastFdNameRender) {
      html += '<div class="sim-var-fd">\uD83D\uDCC4 ' + v.fdName + '</div>';
      lastFdNameRender = v.fdName;
    }
    if (v.isGroup) {
      html += '<div class="sim-var-group">'
        + '<span style="color:#4b5563">' + v.level.toString().padStart(2,'0') + '</span>'
        + ' <span style="color:#6b7280">' + v.name + '</span>'
        + '</div>';
      return;
    }
    var isMoved  = !!_simVarsMoved[v.name];
    var isChanged = !isMoved && !!_simVarsChanged[v.name];
    var rowClass = isMoved ? ' moved' : (isChanged ? ' changed' : '');
    var curVal = (_simVars.hasOwnProperty(v.name)) ? _simVars[v.name] : v.value;
    var initVal = _simVarsInitial.hasOwnProperty(v.name) ? _simVarsInitial[v.name] : v.value;
    var prevBadge = isMoved && initVal !== curVal
      ? '<span class="sim-var-prev">\u2190' + _escHtml(initVal) + '</span>'
      : '';
    var picLabel = v.pic ? v.pic : (v.picType === '9' ? '9' : 'X');
    var readonlyAttr = isMoved ? ' style="border-color:#21d07a77;"' : '';
    html += '<div class="sim-var-row' + rowClass + '" data-varname="' + v.name + '">'
      + '<span class="sim-var-lvl">' + v.level.toString().padStart(2,'0') + '</span>'
      + '<span class="sim-var-name" title="' + v.name + '">' + v.name + '</span>'
      + '<span class="sim-var-pic" title="PIC ' + picLabel + '">' + picLabel + '</span>'
      + '<input class="sim-var-input" type="text" value="' + _escHtml(curVal) + '"'
      + ' data-varname="' + v.name + '"'
      + ' onchange="_simSetVar(this.dataset.varname, this.value)"'
      + readonlyAttr
      + ' title="' + v.name + '">'
      + prevBadge
      + '</div>';
  });
  if (!html) html = '<div style="color:#6b7280;font-size:11px;padding:8px 10px;">Nenhuma variável encontrada.</div>';
  list.innerHTML = html;
}

function _simFilterVars(val) {
  _simRefreshVarsPanel(val);
}

function _simSetVar(name, value) {
  _simVars[name] = value;
  _simVarsChanged[name] = true;
  // Salva como valor inicial do usuário (antes de ▶)
  _simVarsInitial[name] = value;
  // Atualiza highlight da linha
  var row = document.querySelector('.sim-var-row[data-varname="' + name + '"]');
  if (row) { row.classList.add('changed'); row.classList.remove('moved'); }
}

function _simSetVarInternal(name, value) {
  // Chamado por MOVE durante o fluxo — atualiza valor e anima o campo
  var oldVal = _simVars[name];
  _simVars[name] = value;
  _simVarsMoved[name]  = true;
  _simVarsChanged[name] = true;
  if (typeof _repOnVarChange === 'function') _repOnVarChange(name, oldVal, value);
  // Atualiza somente o input do campo (sem redraw completo)
  var inp = document.querySelector('.sim-var-input[data-varname="' + name + '"]');
  if (inp) {
    inp.value = value;
    var row = inp.parentElement;
    if (row) {
      row.classList.remove('changed');
      row.classList.add('moved');
      // badge de valor anterior
      var badge = row.querySelector('.sim-var-prev');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'sim-var-prev';
        row.appendChild(badge);
      }
      badge.textContent = oldVal !== undefined && oldVal !== '' ? '←' + oldVal : '←∅';
      // Pisca
      row.classList.remove('moved-flash');
      void row.offsetWidth; // reflow
      row.classList.add('moved-flash');
    }
  }
}

// ── Avaliador de Condições COBOL ────────────────────────────────
// Retorna true/false ou null (se não consegue avaliar)
function _simEvalCond(condText) {
  if (!condText) return null;
  var text = condText.trim();
  // Normaliza quebras de linha para espaço (condições multi-linha com AND/OR)
  text = text.replace(/\r?\n/g, ' ').replace(/\s{2,}/g, ' ');
  text = text.toUpperCase();
  // Remove ponto final
  text = text.replace(/\.$/, '').trim();
  // Remove prefixo IF/WHEN que pode vir do label do nó
  text = text.replace(/^IF\s+/, '').replace(/^WHEN\s+/, '').trim();
  // Tenta avaliar OR (nível mais baixo de precedência)
  var orParts = _simSplitLogical(text, 'OR');
  if (orParts.length > 1) {
    // Expande condições abreviadas: "WS-AUX EQUAL 0 OR 1" → ["WS-AUX EQUAL 0", "WS-AUX EQUAL 1"]
    orParts = _simExpandAbbrev(orParts);
    var anyNull = false;
    for (var i = 0; i < orParts.length; i++) {
      var r = _simEvalCond(orParts[i].trim());
      if (r === true) return true;
      if (r === null) anyNull = true;
    }
    return anyNull ? null : false;
  }
  // Tenta avaliar AND
  var andParts = _simSplitLogical(text, 'AND');
  if (andParts.length > 1) {
    // Expande condições abreviadas: "WS-AUX EQUAL 0 AND 1" → ["WS-AUX EQUAL 0", "WS-AUX EQUAL 1"]
    andParts = _simExpandAbbrev(andParts);
    var anyNullA = false;
    for (var j = 0; j < andParts.length; j++) {
      var rA = _simEvalCond(andParts[j].trim());
      if (rA === false) return false;
      if (rA === null) anyNullA = true;
    }
    return anyNullA ? null : true;
  }
  // NOT prefix
  var negate = false;
  if (/^NOT\s+/.test(text)) {
    negate = true;
    text = text.slice(4).trim();
  }
  var res = _simEvalSimpleCond(text);
  if (res === null) return null;
  return negate ? !res : res;
}

// Expande condições abreviadas COBOL:
// ["WS-AUX EQUAL 0", "1", "2"]  →  ["WS-AUX EQUAL 0", "WS-AUX EQUAL 1", "WS-AUX EQUAL 2"]
// ["WS-AUX = 0", "= 1"]         →  ["WS-AUX = 0", "WS-AUX = 1"]
// Detecta se uma parte é apenas um valor avulso (sem sujeito+operador)
function _simExpandAbbrev(parts) {
  // Regex para detectar parte completa: começa com nome-de-variável seguido de operador
  var fullRe = /^[A-Z][A-Z0-9-]*(?:\([^)]+\))?\s+(?:IS\s+)?(?:NOT\s+)?(?:EQUAL|GREATER|LESS|>=|<=|>|<|=)/;
  // Regex para detectar parte com operador avulso (sem sujeito): "= 1", "EQUAL 0"
  var opOnlyRe = /^(?:IS\s+)?(?:NOT\s+)?(?:EQUAL(?:\s+TO)?|GREATER(?:\s+THAN)?|LESS(?:\s+THAN)?|>=|<=|>|<|=)\s+/;
  var lastSubject = ''; // "WS-AUX"
  var lastOp      = ''; // "EQUAL"
  var result = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].trim();
    if (fullRe.test(p)) {
      // Parte completa: extrai sujeito e operador para reutilizar
      var mFull = p.match(/^([A-Z][A-Z0-9-]*(?:\([^)]+\))?)\s+((?:IS\s+)?(?:NOT\s+)?(?:EQUAL(?:\s+TO)?|GREATER(?:\s+THAN)?|LESS(?:\s+THAN)?|>=|<=|>|<|=))\s+/);
      if (mFull) { lastSubject = mFull[1]; lastOp = mFull[2].trim(); }
      result.push(p);
    } else if (opOnlyRe.test(p)) {
      // Tem operador mas não tem sujeito: "= 1" ou "EQUAL 0"
      result.push(lastSubject ? lastSubject + ' ' + p : p);
    } else {
      // Valor avulso sem operador: "1", "'S'", "ZEROS"
      // Herda sujeito + operador do último termo completo
      result.push((lastSubject && lastOp) ? lastSubject + ' ' + lastOp + ' ' + p : p);
    }
  }
  return result;
}

// Divide expressão em partes pelo operador lógico (respeita parênteses e literais)
function _simSplitLogical(text, op) {
  var parts = [];
  var depth = 0, start = 0, i = 0;
  var opLen = op.length;
  while (i < text.length) {
    if (text[i] === '(') { depth++; i++; continue; }
    if (text[i] === ')') { depth--; i++; continue; }
    if (text[i] === "'" || text[i] === '"') {
      var q = text[i++];
      while (i < text.length && text[i] !== q) i++;
      i++; continue;
    }
    if (depth === 0 && text.slice(i, i + opLen) === op) {
      // Verifica que é palavra isolada
      var before = i > 0 ? text[i-1] : ' ';
      var after  = i + opLen < text.length ? text[i + opLen] : ' ';
      if (/\s/.test(before) && /\s/.test(after)) {
        parts.push(text.slice(start, i).trim());
        start = i + opLen;
        i = start;
        continue;
      }
    }
    i++;
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

var _SIM_FIGURATIVE = {
  'SPACES': '', 'SPACE': '', 'ZEROS': '0', 'ZEROES': '0', 'ZERO': '0',
  'HIGH-VALUES': '\xFF', 'HIGH-VALUE': '\xFF', 'LOW-VALUES': '\x00', 'LOW-VALUE': '\x00'
};

function _simEvalSimpleCond(text) {
  // Suporte a NUMERIC / ALPHABETIC (classe especial)
  var classicM = text.match(/^([A-Z][A-Z0-9-]*(?:\([^)]+\))?)\s+(?:(NOT)\s+)?(?:IS\s+)?(NUMERIC|ALPHABETIC|ALPHABETIC-LOWER|ALPHABETIC-UPPER)$/);
  if (classicM) {
    var cn = classicM[1], notFlag = !!classicM[2], cls = classicM[3];
    if (!_simVars.hasOwnProperty(cn)) return null;
    var cv = _simVars[cn];
    var ok;
    if (cls === 'NUMERIC')             ok = /^-?\d+(\.\d+)?$/.test(cv.trim());
    else if (cls === 'ALPHABETIC')     ok = /^[A-Za-z ]*$/.test(cv);
    else if (cls === 'ALPHABETIC-LOWER') ok = /^[a-z ]*$/.test(cv);
    else if (cls === 'ALPHABETIC-UPPER') ok = /^[A-Z ]*$/.test(cv);
    else return null;
    return notFlag ? !ok : ok;
  }
  // Suporte a parênteses externos: (WS-A = 1) → WS-A = 1
  if (text.charAt(0) === '(' && text.charAt(text.length - 1) === ')') {
    return _simEvalSimpleCond(text.slice(1, -1).trim());
  }
  // Condição nível 88: IF FLAG-ATIVO → verifica se pai = valor do 88
  if (/^[A-Z][A-Z0-9-]*$/.test(text)) {
    if (_sim88Defs.hasOwnProperty(text)) {
      var d88 = _sim88Defs[text];
      if (!_simVars.hasOwnProperty(d88.parent)) return null;
      var pVal = (_simVars[d88.parent] || '').trim().toUpperCase();
      return d88.values.some(function(v) { return v === pVal; });
    }
    return null; // variável isolada sem operador e sem definição 88
  }
  // Padrão: VAR [IS] [NOT] OP VALUE
  // Operadores: = | > | < | >= | <= | NOT= | NOT > | NOT <
  //             EQUAL [TO] | GREATER [THAN] | LESS [THAN] | NOT EQUAL [TO] etc.
  var opRe = /^([A-Z][A-Z0-9-]*(?:\([^)]+\))?)\s+(?:IS\s+)?(NOT\s+EQUAL(?:\s+TO)?|NOT\s*=|NOT\s*>|NOT\s*<|EQUAL(?:\s+TO)?|GREATER(?:\s+THAN)?|LESS(?:\s+THAN)?|>=|<=|>|<|=)\s+(.+)$/;
  var m = text.match(opRe);
  if (!m) return null;
  var varName = m[1].replace(/\s+/g, '');
  var op      = m[2].replace(/\s+/g, ' ').trim();
  var valStr  = m[3].trim().replace(/\.$/, '');
  if (!_simVars.hasOwnProperty(varName)) {
    console.warn('[COND] variável não encontrada em _simVars:', varName);
    return null;
  }
  var varVal = _simVars[varName] !== undefined ? String(_simVars[varName]) : '';
  // Parse o valor de comparação
  var cmpVal;
  if ((valStr.startsWith("'") && valStr.endsWith("'")) || (valStr.startsWith('"') && valStr.endsWith('"'))) {
    cmpVal = valStr.slice(1, -1);
  } else if (_SIM_FIGURATIVE.hasOwnProperty(valStr)) {
    cmpVal = _SIM_FIGURATIVE[valStr];
    // SPACES/SPACE → comparar com trim
    if (valStr === 'SPACES' || valStr === 'SPACE') {
      varVal = (varVal || '').trim();
      cmpVal = '';
    }
  } else if (/^-?\d+(\.\d+)?$/.test(valStr)) {
    cmpVal = valStr;
  } else if (/^[A-Z][A-Z0-9-]*$/.test(valStr)) {
    // Outra variável
    if (_simVars.hasOwnProperty(valStr)) cmpVal = _simVars[valStr];
    else return null;
  } else {
    return null;
  }
  // Comparação numérica ou string
  var numA = parseFloat(varVal), numB = parseFloat(cmpVal);
  var isNum = !isNaN(numA) && !isNaN(numB) && varVal.trim() !== '' && cmpVal.trim() !== '';
  // Para string: compara case-insensitive (simulador — não é COBOL de produção)
  var strA = (varVal || '').trim().toUpperCase();
  var strB = (cmpVal || '').trim().toUpperCase();
  console.log('[COND]', varName, '=', JSON.stringify(varVal), op, JSON.stringify(cmpVal), '| isNum:', isNum);
  function cmpEq()  { return isNum ? numA === numB : strA === strB; }
  function cmpGt()  { return isNum ? numA >   numB : strA >  strB; }
  function cmpLt()  { return isNum ? numA <   numB : strA <  strB; }
  if (op === '=' || op === 'EQUAL TO' || op === 'EQUAL') return cmpEq();
  if (op === 'NOT =' || op === 'NOT=' || op === 'NOT EQUAL TO' || op === 'NOT EQUAL') return !cmpEq();
  if (op === '>')                          return cmpGt();
  if (op === '<')                          return cmpLt();
  if (op === '>=')                         return cmpGt() || cmpEq();
  if (op === '<=')                         return cmpLt() || cmpEq();
  if (op === 'NOT >' || op === 'NOT>')     return !cmpGt();
  if (op === 'NOT <' || op === 'NOT<')     return !cmpLt();
  if (op === 'GREATER THAN' || op === 'GREATER') return cmpGt();
  if (op === 'LESS THAN'    || op === 'LESS')    return cmpLt();
  return null;
}

// ── Rastreamento de MOVE durante simulação ─────────────────────
// SET nome-88 TO TRUE/FALSE
function _simTrackSet(labelText) {
  if (!labelText) return;
  var lu = labelText.toUpperCase().replace(/\.$/,'').trim();
  // SET VAR1 [VAR2 ...] TO TRUE|FALSE
  var m = lu.match(/^SET\s+(.+?)\s+TO\s+(TRUE|FALSE)$/);
  if (!m) return;
  var names = m[1].trim().split(/\s+/);
  var toTrue = m[2] === 'TRUE';
  names.forEach(function(name) {
    name = name.trim();
    // Verifica se é um nome de nível 88
    if (_sim88Defs.hasOwnProperty(name)) {
      var d88 = _sim88Defs[name];
      var parent = d88.parent;
      if (!_simVars.hasOwnProperty(parent)) return;
      if (toTrue) {
        // Seta pai com o primeiro valor do 88
        var val = d88.values[0] !== undefined ? d88.values[0] : '';
        _simSetVarInternal(parent, val);
        _simLog('↪ SET ' + name + ' TO TRUE → ' + parent + ' ← \'' + val + '\'', 'sim-log-move');
      } else {
        // FALSE: limpa o pai (espaços/zeros conforme PIC)
        _simSetVarInternal(parent, '');
        _simLog('↪ SET ' + name + ' TO FALSE → ' + parent + ' ← \'\'', 'sim-log-move');
      }
    } else if (_simVars.hasOwnProperty(name)) {
      // SET var TO TRUE/FALSE como booleano numérico (menos comum)
      _simSetVarInternal(name, toTrue ? '1' : '0');
      _simLog('↪ SET ' + name + ' TO ' + m[2], 'sim-log-move');
    }
  });
}

function _simTrackMove(labelText) {
  if (!labelText) return;
  var lu = labelText.toUpperCase();
  // MOVE VALUE TO VAR  (com possível MOVE CORRESPONDING / MOVE ... TO VAR1 VAR2)
  var m = lu.match(/^MOVE\s+(.+?)\s+TO\s+(.+)$/);
  if (!m) return;
  var src = m[1].trim(), destStr = m[2].trim().replace(/\.$/, '');
  // Múltiplos destinos separados por espaço (ex: MOVE X TO A B C)
  var dests = destStr.split(/\s+/);
  // Resolve valor fonte
  var srcVal;
  if ((src.startsWith("'") && src.endsWith("'")) || (src.startsWith('"') && src.endsWith('"'))) {
    srcVal = src.slice(1, -1);
  } else if (_SIM_FIGURATIVE.hasOwnProperty(src)) {
    srcVal = _SIM_FIGURATIVE[src];
  } else if (/^-?\d+(\.\d+)?$/.test(src)) {
    srcVal = src;
  } else if (_simVars.hasOwnProperty(src)) {
    srcVal = _simVars[src];
  } else {
    return; // não consegue resolver
  }
  dests.forEach(function(dest) {
    dest = dest.replace(/\.$/, '');
    if (/^[A-Z][A-Z0-9-]*$/.test(dest) && _simVars.hasOwnProperty(dest)) {
      _simSetVarInternal(dest, srcVal);
      _simLog('↪ ' + dest + ' ← \'' + srcVal + '\'', 'sim-log-move');
    }
  });
}

// ── Resolve um operando para número (variável ou literal) ───────
function _simResolveNum(token) {
  token = (token || '').trim().replace(/\.$/, '');
  if (/^-?\d+(\.\d+)?$/.test(token)) return parseFloat(token);
  if (_simVars.hasOwnProperty(token)) {
    var v = parseFloat(_simVars[token]);
    return isNaN(v) ? null : v;
  }
  return null;
}

// Formata resultado: sem .0 quando inteiro
function _simFmtNum(n) {
  if (n === null || n === undefined || isNaN(n)) return null;
  return (n === Math.floor(n)) ? String(Math.trunc(n)) : String(Math.round(n * 1e9) / 1e9);
}

// ── ADD ──────────────────────────────────────────────────────────
// Formas suportadas:
//   ADD a b ... TO dest [dest2 ...]
//   ADD a b ... TO dest GIVING result [result2 ...]
//   ADD CORRESPONDING ignored (não rastreado)
function _simTrackAdd(lu) {
  // ADD ... TO dest GIVING result
  var mGiving = lu.match(/^ADD\s+(.+?)\s+TO\s+(.+?)\s+GIVING\s+(.+)$/);
  if (mGiving) {
    var operands = mGiving[1].trim().split(/\s+/).concat(mGiving[2].trim().split(/\s+/));
    var total = operands.reduce(function(acc, t) {
      var n = _simResolveNum(t); return (acc !== null && n !== null) ? acc + n : null;
    }, 0);
    if (total === null) return;
    var res = _simFmtNum(total);
    mGiving[3].trim().replace(/\.$/, '').split(/\s+/).forEach(function(dest) {
      if (_simVars.hasOwnProperty(dest)) {
        _simSetVarInternal(dest, res);
        _simLog('↪ ' + dest + ' ← ' + res + '  (ADD GIVING)', 'sim-log-move');
      }
    });
    return;
  }
  // ADD ... TO dest [dest2 ...]
  var mTo = lu.match(/^ADD\s+(.+?)\s+TO\s+(.+)$/);
  if (!mTo) return;
  var srcTokens = mTo[1].trim().split(/\s+/);
  var srcSum = srcTokens.reduce(function(acc, t) {
    var n = _simResolveNum(t); return (acc !== null && n !== null) ? acc + n : null;
  }, 0);
  if (srcSum === null) return;
  mTo[2].trim().replace(/\.$/, '').split(/\s+/).forEach(function(dest) {
    if (_simVars.hasOwnProperty(dest)) {
      var cur = _simResolveNum(dest);
      if (cur === null) return;
      var res = _simFmtNum(cur + srcSum);
      _simSetVarInternal(dest, res);
      _simLog('↪ ' + dest + ' ← ' + res + '  (ADD: ' + dest + ' + ' + srcSum + ')', 'sim-log-move');
    }
  });
}

// ── SUBTRACT ─────────────────────────────────────────────────────
// SUBTRACT a b ... FROM dest [dest2 ...]
// SUBTRACT a b ... FROM dest GIVING result [result2 ...]
function _simTrackSubtract(lu) {
  var mGiving = lu.match(/^SUBTRACT\s+(.+?)\s+FROM\s+(.+?)\s+GIVING\s+(.+)$/);
  if (mGiving) {
    var subtrahend = mGiving[1].trim().split(/\s+/).reduce(function(acc, t) {
      var n = _simResolveNum(t); return (acc !== null && n !== null) ? acc + n : null;
    }, 0);
    var minuend = _simResolveNum(mGiving[2].trim());
    if (subtrahend === null || minuend === null) return;
    var res = _simFmtNum(minuend - subtrahend);
    mGiving[3].trim().replace(/\.$/, '').split(/\s+/).forEach(function(dest) {
      if (_simVars.hasOwnProperty(dest)) {
        _simSetVarInternal(dest, res);
        _simLog('↪ ' + dest + ' ← ' + res + '  (SUBTRACT GIVING)', 'sim-log-move');
      }
    });
    return;
  }
  var mFrom = lu.match(/^SUBTRACT\s+(.+?)\s+FROM\s+(.+)$/);
  if (!mFrom) return;
  var sub = mFrom[1].trim().split(/\s+/).reduce(function(acc, t) {
    var n = _simResolveNum(t); return (acc !== null && n !== null) ? acc + n : null;
  }, 0);
  if (sub === null) return;
  mFrom[2].trim().replace(/\.$/, '').split(/\s+/).forEach(function(dest) {
    if (_simVars.hasOwnProperty(dest)) {
      var cur = _simResolveNum(dest); if (cur === null) return;
      var res = _simFmtNum(cur - sub);
      _simSetVarInternal(dest, res);
      _simLog('↪ ' + dest + ' ← ' + res + '  (SUBTRACT: ' + dest + ' - ' + sub + ')', 'sim-log-move');
    }
  });
}

// ── MULTIPLY ─────────────────────────────────────────────────────
// MULTIPLY a BY dest [dest2 ...]
// MULTIPLY a BY b GIVING result [result2 ...]
function _simTrackMultiply(lu) {
  var mGiving = lu.match(/^MULTIPLY\s+(.+?)\s+BY\s+(.+?)\s+GIVING\s+(.+)$/);
  if (mGiving) {
    var a = _simResolveNum(mGiving[1].trim()), b = _simResolveNum(mGiving[2].trim());
    if (a === null || b === null) return;
    var res = _simFmtNum(a * b);
    mGiving[3].trim().replace(/\.$/, '').split(/\s+/).forEach(function(dest) {
      if (_simVars.hasOwnProperty(dest)) {
        _simSetVarInternal(dest, res);
        _simLog('↪ ' + dest + ' ← ' + res + '  (MULTIPLY GIVING)', 'sim-log-move');
      }
    });
    return;
  }
  var mBy = lu.match(/^MULTIPLY\s+(.+?)\s+BY\s+(.+)$/);
  if (!mBy) return;
  var factor = _simResolveNum(mBy[1].trim()); if (factor === null) return;
  mBy[2].trim().replace(/\.$/, '').split(/\s+/).forEach(function(dest) {
    if (_simVars.hasOwnProperty(dest)) {
      var cur = _simResolveNum(dest); if (cur === null) return;
      var res = _simFmtNum(cur * factor);
      _simSetVarInternal(dest, res);
      _simLog('↪ ' + dest + ' ← ' + res + '  (MULTIPLY: ' + dest + ' * ' + factor + ')', 'sim-log-move');
    }
  });
}

// ── DIVIDE ───────────────────────────────────────────────────────
// DIVIDE a INTO dest [dest2 ...]
// DIVIDE a INTO b GIVING result [REMAINDER rem]
// DIVIDE a BY b GIVING result [REMAINDER rem]
function _simTrackDivide(lu) {
  // Com REMAINDER
  var mRem = lu.match(/^DIVIDE\s+(.+?)\s+(?:INTO|BY)\s+(.+?)\s+GIVING\s+(.+?)\s+REMAINDER\s+(.+)$/);
  if (mRem) {
    var isBy = /\bBY\b/.test(lu.substring(0, lu.indexOf('GIVING')));
    var a = _simResolveNum(mRem[1].trim()), b = _simResolveNum(mRem[2].trim());
    if (a === null || b === null) return;
    var divisor  = isBy ? b : a;
    var dividend = isBy ? a : b;
    if (divisor === 0) return;
    var quotient = Math.trunc(dividend / divisor);
    var remainder = dividend - quotient * divisor;
    var dest = mRem[3].trim().replace(/\.$/, '');
    var remDest = mRem[4].trim().replace(/\.$/, '');
    if (_simVars.hasOwnProperty(dest)) { _simSetVarInternal(dest, _simFmtNum(quotient)); _simLog('↪ ' + dest + ' ← ' + quotient + '  (DIVIDE GIVING)', 'sim-log-move'); }
    if (_simVars.hasOwnProperty(remDest)) { _simSetVarInternal(remDest, _simFmtNum(remainder)); _simLog('↪ ' + remDest + ' ← ' + remainder + '  (REMAINDER)', 'sim-log-move'); }
    return;
  }
  // GIVING sem REMAINDER
  var mGiving = lu.match(/^DIVIDE\s+(.+?)\s+(?:INTO|BY)\s+(.+?)\s+GIVING\s+(.+)$/);
  if (mGiving) {
    var byMode = /\bBY\b/.test(lu.substring(0, lu.indexOf('GIVING')));
    var va = _simResolveNum(mGiving[1].trim()), vb = _simResolveNum(mGiving[2].trim());
    if (va === null || vb === null) return;
    var div = byMode ? vb : va, dvd = byMode ? va : vb;
    if (div === 0) return;
    var res = _simFmtNum(dvd / div);
    mGiving[3].trim().replace(/\.$/, '').split(/\s+/).forEach(function(dest) {
      if (_simVars.hasOwnProperty(dest)) { _simSetVarInternal(dest, res); _simLog('↪ ' + dest + ' ← ' + res + '  (DIVIDE GIVING)', 'sim-log-move'); }
    });
    return;
  }
  // DIVIDE a INTO dest
  var mInto = lu.match(/^DIVIDE\s+(.+?)\s+INTO\s+(.+)$/);
  if (!mInto) return;
  var divisorN = _simResolveNum(mInto[1].trim()); if (divisorN === null || divisorN === 0) return;
  mInto[2].trim().replace(/\.$/, '').split(/\s+/).forEach(function(dest) {
    if (_simVars.hasOwnProperty(dest)) {
      var cur = _simResolveNum(dest); if (cur === null) return;
      var res = _simFmtNum(cur / divisorN);
      _simSetVarInternal(dest, res);
      _simLog('↪ ' + dest + ' ← ' + res + '  (DIVIDE: ' + dest + ' / ' + divisorN + ')', 'sim-log-move');
    }
  });
}

// ── COMPUTE ──────────────────────────────────────────────────────
// COMPUTE dest [ROUNDED] = expressão aritmética
// Suporta: + - * / ** e parênteses, variáveis e literais numéricos
function _simTrackCompute(lu) {
  // COMPUTE dest [ROUNDED] = expr
  var m = lu.match(/^COMPUTE\s+([A-Z][A-Z0-9-]*(?:\([^)]+\))?)\s+(?:ROUNDED\s+)?=\s+(.+)$/);
  if (!m) return;
  var dest = m[1].trim(), exprRaw = m[2].trim().replace(/\.$/, '');
  if (!_simVars.hasOwnProperty(dest)) return;
  // Substitui nomes de variáveis COBOL pelos seus valores numéricos
  var expr = exprRaw.replace(/[A-Z][A-Z0-9-]*/g, function(token) {
    if (_simVars.hasOwnProperty(token)) {
      var n = parseFloat(_simVars[token]);
      return isNaN(n) ? '0' : String(n);
    }
    return token; // literal numérico ou operador textual → mantém
  });
  // Permite apenas chars seguros: dígitos, operadores aritméticos, ponto, parênteses, espaço
  if (!/^[\d\s+\-*\/().e\^]+$/i.test(expr)) return;
  // Converte ** para ^ e avalia
  expr = expr.replace(/\*\*/g, '**'); // já OK para JS
  var result;
  try {
    // eslint-disable-next-line no-new-func
    result = Function('"use strict"; return (' + expr + ')')();
  } catch(e) { return; }
  if (typeof result !== 'number' || !isFinite(result)) return;
  var res = _simFmtNum(result);
  _simSetVarInternal(dest, res);
  _simLog('↪ ' + dest + ' ← ' + res + '  (COMPUTE: ' + exprRaw + ')', 'sim-log-move');
}

// ── DISPLAY — resolve e loga no painel ────────────────────────
function _simTrackDisplay(lbl) {
  // Remove o verbo DISPLAY e corta UPON (destino de saída)
  var raw = lbl.replace(/^DISPLAY\s+/i, '').replace(/\s+UPON\s+\S+\s*$/i, '').trim();
  // Tokeniza: literais entre aspas, ou tokens separados por espaço
  var parts = [];
  var rem = raw;
  while (rem.length > 0) {
    rem = rem.trim();
    if (!rem) break;
    if (rem[0] === "'" || rem[0] === '"') {
      var q = rem[0];
      var end = rem.indexOf(q, 1);
      if (end === -1) { parts.push(rem.slice(1)); break; }
      parts.push(rem.slice(1, end));
      rem = rem.slice(end + 1);
    } else {
      var sp = rem.search(/\s/);
      var tok = sp === -1 ? rem : rem.slice(0, sp);
      tok = tok.replace(/\.$/, '');
      if (_SIM_FIGURATIVE && _SIM_FIGURATIVE.hasOwnProperty(tok)) {
        parts.push(_SIM_FIGURATIVE[tok]);
      } else if (_simVars.hasOwnProperty(tok)) {
        parts.push(String(_simVars[tok]));
      } else {
        parts.push(tok);
      }
      rem = sp === -1 ? '' : rem.slice(sp);
    }
  }
  var output = parts.join('');
  _simLog('\uD83D\uDCFA DISPLAY: ' + output, 'sim-log-display');
}

// ── Execução SQL simulada ──────────────────────────────────────
// Formata valor do DB2 para o formato COBOL baseado no PIC da variável
// Reconhece PIC 9(n)Vmm (decimal implícito sem ponto real)
function _simDb2FmtPic(rawVal, varName) {
  if (!varName) return rawVal;
  // Busca definição da variável
  var def = null;
  for (var _di = 0; _di < _simVarDefs.length; _di++) {
    if (_simVarDefs[_di].name === varName && !_simVarDefs[_di].isGroup) { def = _simVarDefs[_di]; break; }
  }
  if (!def || def.picType !== '9' || !def.pic) return rawVal;
  var pU = def.pic.toUpperCase();
  // Detecta V (decimal implícito): ex. 9(07)V99, 9(5)V9(2)
  var vIdx = pU.indexOf('V');
  if (vIdx < 0) {
    // Apenas PIC 9: retorna como está, sem transformação
    return rawVal;
  }
  // Conta dígitos inteiros e decimais
  function _countDigits(str) {
    // Reconhece: 9(07) = 7 dígitos, 99 = 2 dígitos, S9(5) = 5 dígitos
    var n = 0;
    var re = /[9S]+(?:\((\d+)\))?/g, mc;
    while ((mc = re.exec(str)) !== null) {
      // Se tem (n), usa n; senão conta os caracteres 9/S do match (sem os parênteses)
      n += mc[1] ? parseInt(mc[1]) : mc[0].replace(/\(\d+\)/, '').length;
    }
    return n;
  }
  var intLen = _countDigits(pU.slice(0, vIdx));
  var decLen = _countDigits(pU.slice(vIdx + 1));
  var totalLen = intLen + decLen;
  // Normaliza o valor: aceita '1.00', '1,00', '100', '000000100'
  var str = String(rawVal).trim().replace(',', '.');
  var intPart, decPart;
  var dotPos = str.indexOf('.');
  if (dotPos >= 0) {
    intPart = str.slice(0, dotPos);
    decPart = str.slice(dotPos + 1);
  } else {
    // sem ponto: assume que já está no formato COBOL (todos os dígitos juntos)
    if (str.length === totalLen) return str;          // já correto
    if (str.length > totalLen) return str.slice(-totalLen); // trunca esquerda
    // valor curto: trata como inteiro puro
    intPart = str;
    decPart = '';
  }
  // Ajusta partes ao tamanho do PIC
  intPart = intPart.replace(/\D/g, '');
  decPart = decPart.replace(/\D/g, '');
  intPart = intPart.slice(-intLen).padStart(intLen, '0');
  decPart = (decPart + '00000000').slice(0, decLen);
  return intPart + decPart;
}

// Avalia WHERE simples: "COL = :hostvar" ou "COL = 'literal'"
function _simDb2EvalWhere(row, wherePart) {
  if (!wherePart) return true;
  var conditions = wherePart.split(/\s+AND\s+/);
  for (var i = 0; i < conditions.length; i++) {
    var wc = conditions[i].trim();
    var wr = wc.match(/^([A-Z][A-Z0-9_#@]*)\s*=\s*(?::([A-Z][A-Z0-9-]*)|'([^']*)'|"([^"]*)"|([-\d.]+)|([A-Z][A-Z0-9-]*))/);
    if (!wr) continue;
    var col   = wr[1];
    var wVal;
    if (wr[2]) { wVal = String(_simVars[wr[2]] !== undefined ? _simVars[wr[2]] : ''); }
    else if (wr[3] !== undefined) { wVal = wr[3]; }
    else if (wr[4] !== undefined) { wVal = wr[4]; }
    else if (wr[5] !== undefined) { wVal = wr[5]; }
    else { wVal = String(_simVars[wr[6]] !== undefined ? _simVars[wr[6]] : wr[6]); }
    var rowVal = String(row[col] !== undefined ? row[col] : '').trim();
    if (rowVal !== wVal.trim()) return false;
  }
  return true;
}

// ── Special registers DB2 ─────────────────────────────────────────
// Recebe um token já em UPPERCASE. Retorna a string resolvida ou null se não for SR.
function _simResolveSqlSpecial(raw) {
  var r = raw.trim();
  // CURRENT TIMESTAMP / CURRENT_TIMESTAMP → 'YYYY-MM-DD-HH.MM.SS.000000'
  if (/^CURRENT[_ ]TIMESTAMP$/.test(r)) {
    var n = new Date();
    var pad = function(v, l) { return String(v).padStart(l || 2, '0'); };
    return pad(n.getFullYear(), 4) + '-' + pad(n.getMonth()+1) + '-' + pad(n.getDate()) +
           '-' + pad(n.getHours()) + '.' + pad(n.getMinutes()) + '.' + pad(n.getSeconds()) +
           '.' + pad(n.getMilliseconds(), 3) + '000';
  }
  // CURRENT DATE / CURRENT_DATE → 'YYYY-MM-DD'
  if (/^CURRENT[_ ]DATE$/.test(r)) {
    var nd = new Date();
    var padD = function(v, l) { return String(v).padStart(l || 2, '0'); };
    return padD(nd.getFullYear(), 4) + '-' + padD(nd.getMonth()+1) + '-' + padD(nd.getDate());
  }
  // CURRENT TIME / CURRENT_TIME → 'HH.MM.SS'
  if (/^CURRENT[_ ]TIME$/.test(r)) {
    var nt = new Date();
    var padT = function(v) { return String(v).padStart(2, '0'); };
    return padT(nt.getHours()) + '.' + padT(nt.getMinutes()) + '.' + padT(nt.getSeconds());
  }
  // CURRENT SCHEMA / USER / SERVER → genérico
  if (/^CURRENT[_ ]SCHEMA$/.test(r)) return 'SIMSQL';
  if (/^CURRENT[_ ]USER$|^USER$/.test(r))   return 'SIMUSER';
  if (/^CURRENT[_ ]SERVER$/.test(r)) return 'SIMDB';
  return null; // não é special register
}

function _simExecuteSql(sqlLabel) {
  // Extrai o SQL puro do label (pode conter EXEC SQL / END-EXEC ou ser só o corpo)
  var sqlRaw = sqlLabel.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
  sqlRaw = sqlRaw.replace(/^EXEC\s+SQL\s*/i, '').replace(/\s*END-EXEC\s*$/i, '').trim();
  // Remove marcadores de continuação COBOL (coluna 7 = '-') que ficam como ' - '
  // após o join de linhas. Ex: "FETCH C1 INTO :A, - :B" → "FETCH C1 INTO :A, :B"
  sqlRaw = sqlRaw.replace(/,\s*-\s*:/g, ', :').replace(/\s+-\s+:/g, ' :');

  // ── INCLUDE (SQLCA etc.) → sem efeito ──────────────────────────
  if (/^INCLUDE\b/i.test(sqlRaw)) {
    _simSetVarInternal('SQLCODE', '0');
    return;
  }

  // ── DECLARE CURSOR → registra em _simDb2Cursors (parse + runtime) ──
  if (/^DECLARE\b/i.test(sqlRaw)) {
    // Garante registro mesmo que _parseDb2Cursors não tenha encontrado no fonte
    var _declM = sqlRaw.match(/^DECLARE\s+([A-Z][A-Z0-9_#@]*)\s+CURSOR\s+FOR\s+SELECT\s+([\s\S]+?)\s+FROM\s+([A-Z][A-Z0-9_#@]*)/i);
    if (_declM) {
      var _declCurName = _declM[1].trim();
      var _declCols    = _declM[2].split(',').map(function(c){
        return c.trim().replace(/^[A-Z][A-Z0-9_#@]*\.\s*/i,'').trim();
      });
      var _declTblName = _declM[3].trim();
      if (!_simDb2Cursors[_declCurName]) {
        // intoVars pode ter sido pré-populado pelo parser FETCH
        var _existInto = (_simDb2Cursors[_declCurName] || {}).intoVars || [];
        _simDb2Cursors[_declCurName] = { tableName: _declTblName, cols: _declCols, pointer: 0, isOpen: false, intoVars: _existInto };
      }
      if (!_simDb2Tables[_declTblName]) {
        _simDb2Tables[_declTblName] = { columns: _declCols.slice(), rows: [], meta: {} };
      }
    }
    _simSetVarInternal('SQLCODE', '0');
    _simLog('\u23cb SQL DECLARE CURSOR — definição registrada', 'sim-log-info');
    _simRefreshVarsPanel();
    _simRefreshDb2Panel();
    return;
  }

  // ── OPEN cursor ─────────────────────────────────────────────────
  var _openCurM = sqlRaw.match(/^OPEN\s+([A-Z][A-Z0-9_]*)/i);
  if (_openCurM) {
    var _curOpen = _openCurM[1];
    var _curDef  = _simDb2Cursors[_curOpen];
    if (_curDef) {
      _curDef.pointer = 0;
      _curDef.isOpen  = true;
      var _curTbl = _simDb2Tables[_curDef.tableName];
      _simSetVarInternal('SQLCODE', '0');
      _simLog('\u23cb SQL OPEN ' + _curOpen + ': cursor aberto em ' + _curDef.tableName + ' — ' + (_curTbl ? _curTbl.rows.length : 0) + ' linha(s) disponível (SQLCODE=0)', 'sim-log-info');
    } else {
      _simSetVarInternal('SQLCODE', '-514');
      _simLog('\u23cb SQL OPEN ' + _curOpen + ': cursor não declarado (SQLCODE=-514)', 'sim-log-error');
    }
    _simRefreshVarsPanel();
    _simRefreshDb2Panel();
    return;
  }

  // ── FETCH cursor INTO :v1, :v2, ... ─────────────────────────────
  // Flush: salva valores ainda pendentes nos inputs do painel DB2
  (document.querySelectorAll('.sim-db2-input') || []).forEach(function(inp) {
    var tn  = inp.getAttribute('data-tbl');
    var idx = parseInt(inp.getAttribute('data-idx'), 10);
    var cl  = inp.getAttribute('data-col');
    if (tn && !isNaN(idx) && cl && _simDb2Tables[tn] && _simDb2Tables[tn].rows[idx]) {
      _simDb2Tables[tn].rows[idx][cl] = inp.value;
    }
  });
  var _fetchM = sqlRaw.match(/^FETCH\s+([A-Z][A-Z0-9_]*)(?:\s+INTO\s+([\s\S]+))?$/i);
  if (_fetchM) {
    var _curFetch = _fetchM[1];
    var _curF     = _simDb2Cursors[_curFetch];
    if (!_curF) {
      _simSetVarInternal('SQLCODE', '-514');
      _simLog('\u23cb SQL FETCH ' + _curFetch + ': cursor não declarado (SQLCODE=-514)', 'sim-log-error');
      _simRefreshVarsPanel();
      return;
    }
    if (!_curF.isOpen) {
      _simSetVarInternal('SQLCODE', '-501');
      _simLog('\u23cb SQL FETCH ' + _curFetch + ': cursor não está aberto — execute OPEN primeiro (SQLCODE=-501)', 'sim-log-error');
      _simRefreshVarsPanel();
      return;
    }
    var _tblF = _simDb2Tables[_curF.tableName];
    if (!_tblF || _curF.pointer >= _tblF.rows.length) {
      _simSetVarInternal('SQLCODE', '100');
      _simLog('\u23cb SQL FETCH ' + _curFetch + ': fim dos dados (SQLCODE=100)', 'sim-log-branch');
      _simRefreshVarsPanel();
      _simRefreshDb2Panel();
      return;
    }
    var _rowF = _tblF.rows[_curF.pointer];
    _curF.pointer++;
    // INTO variables: usa do SQL runtime, senão do parse estático do fonte
    var _intoRawF  = (_fetchM[2] || '').replace(/\s+/g, ' ').trim();
    var _intoVarsF = _intoRawF
      ? _intoRawF.split(',').map(function(v){ return v.trim().replace(/^:/,''); })
                  .filter(function(v){ return /^[A-Z][A-Z0-9-]*$/.test(v); }) // descarta '-' e outros
      : (_curF.intoVars || []);
    var _fetchCols = _curF.cols.length > 0 ? _curF.cols : (_tblF ? _tblF.columns : []);
    // Loga o FETCH antes de copiar (igual ao READ de arquivo)
    _simLog('\u23cb SQL FETCH ' + _curFetch + ' \u2192 linha ' + _curF.pointer + '/' + _tblF.rows.length + ' (SQLCODE=0)', 'sim-log-branch');
    // Mostra campos da linha no Mapa de Execução (igual ao READ)
    if (typeof _emAppendLog === 'function') {
      _fetchCols.forEach(function(col, i) {
        var intoVar = _intoVarsF[i] || col;
        var val = _rowF[col] !== undefined ? String(_rowF[col]) : '\u2205';
        _emAppendLog('  \u21b3 ' + intoVar + ' = [' + val + ']', 'sim-log-file-var');
      });
    }
    // Copia campos para variáveis — respeita PIC V (decimal implicito)
    _fetchCols.forEach(function(col, i) {
      var intoVar = _intoVarsF[i];
      if (!intoVar) return;
      var rawVal = _rowF[col] !== undefined ? String(_rowF[col]) : '';
      var fmtVal = _simDb2FmtPic(rawVal, intoVar);
      _simSetVarInternal(intoVar, fmtVal);
      _simLog('  \u21b3 ' + intoVar + ' \u2190 [' + fmtVal + ']', 'sim-log-file-var');
    });
    _simSetVarInternal('SQLCODE', '0');
    _simRefreshVarsPanel();
    _simRefreshDb2Panel();
    return;
  }

  // ── CLOSE cursor ─────────────────────────────────────────────────
  var _closeCurM = sqlRaw.match(/^CLOSE\s+([A-Z][A-Z0-9_]*)/i);
  if (_closeCurM) {
    var _curClose = _closeCurM[1];
    if (_simDb2Cursors[_curClose]) {
      _simDb2Cursors[_curClose].isOpen  = false;
      _simDb2Cursors[_curClose].pointer = 0;
    }
    _simSetVarInternal('SQLCODE', '0');
    _simLog('\u23cb SQL CLOSE ' + _curClose + ': cursor fechado (SQLCODE=0)', 'sim-log-info');
    _simRefreshVarsPanel();
    _simRefreshDb2Panel();
    return;
  }

  // ── SELECT ─────────────────────────────────────────────────────
  var selM = sqlRaw.match(/^SELECT\s+([\s\S]+?)\s+INTO\s+([\s\S]+?)\s+FROM\s+([A-Z][A-Z0-9_#@]*)(?:\s+WHERE\s+([\s\S]*))?$/i);
  if (selM) {
    var cols     = selM[1].replace(/\s+/g,'').split(',').map(function(c){ return c.trim().replace(/^:/,''); }).filter(Boolean);
    var intoVars = selM[2].replace(/\s+/g,'').split(',').map(function(v){ return v.trim().replace(/^:/,''); }).filter(Boolean);
    var tblName  = selM[3];
    var where    = (selM[4] || '').trim();
    var tbl = _simDb2Tables[tblName];
    if (!tbl || tbl.rows.length === 0) {
      _simSetVarInternal('SQLCODE', '+100');
      _simLog('\u23cb SQL SELECT ' + tblName + ': tabela vazia ou não cadastrada no painel DB2 (SQLCODE=+100)', 'sim-log-branch');
      _simRefreshVarsPanel();
      return;
    }
    var matchRow = null;
    for (var ri = 0; ri < tbl.rows.length; ri++) {
      if (_simDb2EvalWhere(tbl.rows[ri], where)) { matchRow = tbl.rows[ri]; break; }
    }
    if (!matchRow) {
      _simSetVarInternal('SQLCODE', '+100');
      _simLog('\u23cb SQL SELECT ' + tblName + ': nenhuma linha satisfaz o WHERE (SQLCODE=+100)', 'sim-log-branch');
      _simRefreshVarsPanel();
      return;
    }
    cols.forEach(function(col, i) {
      var intoVar = intoVars[i];
      if (!intoVar) return;
      var val = matchRow[col] !== undefined ? String(matchRow[col]) : '';
      _simSetVarInternal(intoVar, val);
      _simLog('\u23cb SQL \u2192 ' + intoVar + ' \u2190 ' + JSON.stringify(val) + '  (' + tblName + '.' + col + ')', 'sim-log-move');
    });
    _simSetVarInternal('SQLCODE', '0');
    _simLog('\u23cb SQL SELECT OK \u2014 SQLCODE=0', 'sim-log-info');
    _simRefreshVarsPanel();
    _simRefreshDb2Panel();
    return;
  }

  // ── INSERT ─────────────────────────────────────────────────────
  var insM = sqlRaw.match(/^INSERT\s+INTO\s+([A-Z][A-Z0-9_#@]*)(?:\s*\(([^)]+)\))?\s+VALUES\s*\(([^)]+)\)/i);
  if (insM) {
    var tblName2 = insM[1];
    // Cria a tabela automaticamente se não existir no painel
    if (!_simDb2Tables[tblName2]) {
      _simDb2Tables[tblName2] = { columns: [], rows: [], selectMaps: [] };
      _simLog('\u23cb SQL INSERT: tabela ' + tblName2 + ' criada automaticamente', 'sim-log-info');
    }
    var tbl2 = _simDb2Tables[tblName2];
    var insCols = insM[2]
      ? insM[2].split(',').map(function(c){ return c.trim().replace(/^:/,''); })
      : tbl2.columns.slice();
    var insValsRaw = insM[3].split(',').map(function(v){ return v.trim(); });

    // ── Validação -117: número de colunas ≠ número de valores ───
    if (insCols.length !== insValsRaw.length) {
      _simSetVarInternal('SQLCODE', '-117');
      _simLog('\u23cb SQL INSERT ' + tblName2 + ': ' + insCols.length + ' coluna(s) x ' + insValsRaw.length + ' valor(es) — incompatível (SQLCODE=-117)', 'sim-log-error');
      _simRefreshVarsPanel();
      return;
    }

    // ── Resolve valores e valida variáveis host ──────────────────
    var insErrors = [];   // bloqueantes
    var resolvedVals = insCols.map(function(c, i) {
      var raw = insValsRaw[i] || '';
      var hm  = raw.match(/^:([A-Z][A-Z0-9-]*)$/i);
      var litM = raw.match(/^'([^']*)'$/);
      if (hm) {
        var varName2 = hm[1].toUpperCase();
        if (_simVars[varName2] === undefined) {
          // -305: variável host não existe no Working-Storage
          insErrors.push({ col: c, var: varName2, code: '-305',
            msg: '\u23cb SQL INSERT ' + tblName2 + ': variável :' + varName2 + ' não declarada em WS → coluna ' + c + ' (SQLCODE=-305)' });
          return '';
        }
        var val2 = String(_simVars[varName2]);
        if (val2.trim() === '') {
          // -407: dado vazio — bloqueia INSERT assim como DB2 faria em coluna NOT NULL
          insErrors.push({ col: c, var: varName2, code: '-407',
            msg: '\u23cb SQL INSERT ' + tblName2 + ': coluna ' + c + ' ← :' + varName2 + ' está vazia (SQLCODE=-407)' });
          return '';
        }
        return val2;
      }
      // Special registers DB2: CURRENT TIMESTAMP, CURRENT DATE, CURRENT TIME…
      var srVal = _simResolveSqlSpecial(raw);
      if (srVal !== null) return srVal;
      return litM ? litM[1] : raw;
    });

    // ── Erros bloqueantes (-305 / -407) ─────────────────────────
    if (insErrors.length > 0) {
      _simSetVarInternal('SQLCODE', insErrors[0].code);
      insErrors.forEach(function(e) { _simLog(e.msg, 'sim-log-error'); });
      _simRefreshVarsPanel();
      return;
    }

    // ── Garante que todas as colunas do INSERT existam na tabela ─
    insCols.forEach(function(c) {
      if (tbl2.columns.indexOf(c) < 0) {
        tbl2.columns.push(c);
        tbl2.rows.forEach(function(r){ r[c] = ''; });
      }
    });

    // ── Monta e insere a linha ───────────────────────────────────
    var newRow = {};
    tbl2.columns.forEach(function(c){ newRow[c] = ''; });
    insCols.forEach(function(c, i) { newRow[c] = resolvedVals[i]; });
    tbl2.rows.push(newRow);
    _simSetVarInternal('SQLCODE', '0');
    _simLog('\u23cb SQL INSERT ' + tblName2 + ': linha inserida — total ' + tbl2.rows.length + ' linha(s) (SQLCODE=0)', 'sim-log-info');
    insCols.forEach(function(c, i) {
      _simLog('  \u21b3 ' + c + ' = [' + resolvedVals[i] + ']', 'sim-log-file-var');
    });
    _simRefreshVarsPanel();
    _simRefreshDb2Panel();
    return;
  }

  // ── UPDATE ─────────────────────────────────────────────────────
  var updM = sqlRaw.match(/^UPDATE\s+([A-Z][A-Z0-9_#@]*)\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]*))?$/i);
  if (updM) {
    var tblName3 = updM[1];
    var tbl3 = _simDb2Tables[tblName3];
    if (!tbl3) { _simSetVarInternal('SQLCODE', '-204'); _simLog('\u23cb SQL UPDATE: tabela ' + tblName3 + ' não cadastrada (SQLCODE=-204)', 'sim-log-error'); _simRefreshVarsPanel(); return; }
    var setPart  = updM[2];
    var whereUpd = (updM[3] || '').trim();

    // ── Resolve e valida o SET ───────────────────────────────────
    var updErrors = [];
    var setAssigns = [];
    setPart.split(',').forEach(function(sa) {
      var sr = sa.trim().match(/^([A-Z][A-Z0-9_#@]*)\s*=\s*(?::([A-Z][A-Z0-9-]*)|'([^']*)'|([-\d.]+)|(CURRENT[_ ](?:TIMESTAMP|DATE|TIME|SCHEMA|USER|SERVER)|USER))/i);
      if (!sr) return;
      var sc = sr[1];
      if (sr[2]) {
        var vn3 = sr[2].toUpperCase();
        if (_simVars[vn3] === undefined) {
          updErrors.push('\u23cb SQL UPDATE ' + tblName3 + ': variável :' + vn3 + ' não declarada em WS → SET ' + sc + ' (SQLCODE=-305)');
        } else {
          setAssigns.push({ col: sc, val: String(_simVars[vn3]) });
        }
      } else if (sr[3] !== undefined) { setAssigns.push({ col: sc, val: sr[3] }); }
      else if (sr[4] !== undefined)   { setAssigns.push({ col: sc, val: sr[4] }); }
      else if (sr[5])                 { setAssigns.push({ col: sc, val: _simResolveSqlSpecial(sr[5].toUpperCase()) || sr[5] }); }
    });

    // ── Valida variáveis host no WHERE ───────────────────────────
    var whereHvs = whereUpd.match(/:([A-Z][A-Z0-9-]*)/gi) || [];
    whereHvs.forEach(function(hv) {
      var vn3w = hv.replace(/^:/, '').toUpperCase();
      if (_simVars[vn3w] === undefined) {
        updErrors.push('\u23cb SQL UPDATE ' + tblName3 + ': variável :' + vn3w + ' não declarada em WS → WHERE (SQLCODE=-305)');
      }
    });

    if (updErrors.length > 0) {
      _simSetVarInternal('SQLCODE', '-305');
      updErrors.forEach(function(m) { _simLog(m, 'sim-log-error'); });
      _simRefreshVarsPanel();
      return;
    }

    // ── Aplica o UPDATE linha a linha ────────────────────────────
    var updCount = 0;
    tbl3.rows.forEach(function(row, ri) {
      if (!_simDb2EvalWhere(row, whereUpd)) return;
      setAssigns.forEach(function(a) { tbl3.rows[ri][a.col] = a.val; });
      updCount++;
      setAssigns.forEach(function(a) {
        _simLog('  \u21b3 [linha ' + (ri + 1) + '] ' + a.col + ' = [' + a.val + ']', 'sim-log-file-var');
      });
    });

    // SQLCODE=0 independente de quantas linhas (comportamento DB2 searched UPDATE)
    _simSetVarInternal('SQLCODE', '0');
    if (updCount === 0) {
      _simLog('\u23cb SQL UPDATE ' + tblName3 + ': nenhuma linha correspondeu ao WHERE — 0 linhas afetadas (SQLCODE=0)', 'sim-log-warn');
    } else {
      _simLog('\u23cb SQL UPDATE ' + tblName3 + ': ' + updCount + ' linha(s) atualizada(s) (SQLCODE=0)', 'sim-log-info');
    }
    _simRefreshVarsPanel();
    _simRefreshDb2Panel();
    return;
  }

  // ── DELETE ─────────────────────────────────────────────────────
  var delM = sqlRaw.match(/^DELETE\s+FROM\s+([A-Z][A-Z0-9_#@]*)(?:\s+WHERE\s+([\s\S]*))?$/i);
  if (delM) {
    var tblName4 = delM[1];
    var tbl4 = _simDb2Tables[tblName4];
    if (!tbl4) { _simSetVarInternal('SQLCODE', '-204'); _simLog('\u23cb SQL DELETE: tabela ' + tblName4 + ' não cadastrada (SQLCODE=-204)', 'sim-log-error'); _simRefreshVarsPanel(); return; }
    var whereDel = (delM[2] || '').trim();

    // ── Valida variáveis host no WHERE ───────────────────────────
    var delErrors = [];
    var delWhereHvs = whereDel.match(/:([A-Z][A-Z0-9-]*)/gi) || [];
    delWhereHvs.forEach(function(hv) {
      var vn4 = hv.replace(/^:/, '').toUpperCase();
      if (_simVars[vn4] === undefined) {
        delErrors.push('\u23cb SQL DELETE ' + tblName4 + ': variável :' + vn4 + ' não declarada em WS → WHERE (SQLCODE=-305)');
      }
    });

    if (delErrors.length > 0) {
      _simSetVarInternal('SQLCODE', '-305');
      delErrors.forEach(function(m) { _simLog(m, 'sim-log-error'); });
      _simRefreshVarsPanel();
      return;
    }

    // ── Executa o DELETE e loga linhas removidas ─────────────────
    var before4 = tbl4.rows.length;
    var deleted4 = [];
    tbl4.rows = tbl4.rows.filter(function(row, ri) {
      if (!_simDb2EvalWhere(row, whereDel)) return true; // mantém
      deleted4.push({ idx: ri + 1, row: row });
      return false; // remove
    });
    var deletedCount = before4 - tbl4.rows.length;

    // SQLCODE=0 mesmo com 0 linhas (comportamento DB2 searched DELETE)
    _simSetVarInternal('SQLCODE', '0');
    if (deletedCount === 0) {
      _simLog('\u23cb SQL DELETE ' + tblName4 + ': nenhuma linha correspondeu ao WHERE — 0 linhas removidas (SQLCODE=0)', 'sim-log-warn');
    } else {
      _simLog('\u23cb SQL DELETE ' + tblName4 + ': ' + deletedCount + ' linha(s) removida(s) (SQLCODE=0)', 'sim-log-info');
      deleted4.forEach(function(d) {
        var cols = Object.keys(d.row);
        var summary = cols.map(function(c){ return c + '=[' + d.row[c] + ']'; }).join('  ');
        _simLog('  \u2715 [linha ' + d.idx + '] ' + summary, 'sim-log-file-var');
      });
    }
    _simRefreshVarsPanel();
    _simRefreshDb2Panel();
    return;
  }

  // COMMIT / ROLLBACK / outros → SQLCODE=0 sem efeito
  _simSetVarInternal('SQLCODE', '0');
  _simLog('\u23cb SQL: ' + sqlRaw.substring(0, 60) + '... (SQLCODE=0)', 'sim-log-info');
  _simRefreshVarsPanel();
}

var _sim = {
  running:  false,    // auto-play ativo
  paused:   false,
  step:     0,
  currentId: null,    // id do nó Cytoscape atual
  callStack: [],      // [{returnId, label}] para PERFORM/CALL
  visited:  [],       // ids visitados (para fade)
  breakpoints: new Set(),
  timer:    null,
  _branchResolve: null  // Promise resolve para modal de ramo
};

// ── Estatísticas de execução ──────────────────────────────────────────────────
var _simNodeHits = {};   // {nodeId: contagem} — quantas vezes cada nó foi acionado
var _simParaSeq  = [];   // [{id, label, tipo, step}] — sequência de nós executados

function _simSpeed() {
  var v = parseInt(document.getElementById('sim-speed').value) || 5;
  // v=1 → 2000ms , v=10 → 100ms
  return Math.round(100 + (10 - v) * 210);
}

function _simLog(msg, cls) {
  if (typeof _repCaptureLog === 'function') _repCaptureLog(msg, cls);
  if (typeof _emAppendLog === 'function') _emAppendLog(msg, cls);
  var el = document.getElementById('sim-log-text');
  if (!el) return;
  el.textContent = msg;
  el.className = 'sim-log-line' + (cls ? ' ' + cls : '');
}

function _simStepInfo() {
  var el = document.getElementById('sim-step-info');
  if (el) el.textContent = 'Passo ' + _sim.step + (_sim.callStack.length ? '  ⬡×' + _sim.callStack.length : '');
}

function _simUpdateStack() {
  var wrap = document.getElementById('sim-stack-wrap');
  var items = document.getElementById('sim-stack-items');
  if (!wrap || !items) return;
  if (_sim.callStack.length === 0) {
    wrap.classList.remove('sim-has-stack');
  } else {
    wrap.classList.add('sim-has-stack');
    items.innerHTML = _sim.callStack.map(function(f) {
      return '<span class="sim-stack-item">↩ ' + f.label + '</span>';
    }).join('');
  }
  if (typeof _emSyncStack === 'function') _emSyncStack(_sim.callStack);
}

function _simHighlight(nodeId) {
  if (!cy) return;
  if (typeof _repOnStep === 'function') _repOnStep(nodeId);
  // Remove current do nó anterior
  if (_sim.currentId && _sim.currentId !== nodeId) {
    var prev = cy.getElementById(_sim.currentId);
    prev.removeClass('sim-current');
    if (!prev.hasClass('sim-breakpoint')) {
      prev.addClass('sim-visited');
    }
    _sim.visited.push(_sim.currentId);
  }
  _sim.currentId = nodeId;
  if (!nodeId) return;
  var node = cy.getElementById(nodeId);
  node.removeClass('sim-visited');
  node.addClass('sim-current');
  // Pan/zoom para manter o nó visível
  cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 0.75) }, { duration: 180 });
}

function _simClear() {
  if (!cy) return;
  cy.nodes().removeClass('sim-current sim-visited');
  _sim.currentId = null;
  _sim.visited = [];
  _sim.callStack = [];
  _sim.step = 0;
  _simLoopState = {};
  _simNodeHits = {};
  _simParaSeq  = [];
  _simUpdateStack();
  _simStepInfo();
}

// Abre o simulador (sem iniciar ainda)
function simOpen() {
  if (!cy || cy.nodes().length === 0) {
    alert('Gere o fluxo antes de simular.');
    return;
  }
  // Inicializa variáveis WORKING-STORAGE do código atual
  var code = (document.getElementById('input') || {}).value || '';
  _simInitVars(code);
  _sim.on = true;
  document.body.classList.add('sim-active');
  document.getElementById('sim-panel').classList.add('sim-visible');
  _simSetButtons('idle');
  // Abre painel de variáveis automaticamente para que usuário preencha valores iniciais
  var vp = document.getElementById('sim-vars-panel');
  if (vp && _simVarDefs.length > 0) {
    _simRefreshVarsPanel();
    vp.classList.add('sim-vars-visible');
    _simLog('📋 PREENCHA OS VALORES INICIAIS e clique ▶ para iniciar', 'sim-log-info');
    _simSetPanelPhase('input');
  } else {
    _simLog('Clique ▶ para iniciar a simulação');
  }
  // DEBUG: exibe mapa FILE STATUS IS
  var _fsKeys = Object.keys(_simFileStatusMapDebug);
  if (_fsKeys.length > 0) {
    _simLog('🔍 DEBUG FILE STATUS: ' + _fsKeys.map(function(k){ return k + ' → ' + _simFileStatusMapDebug[k]; }).join(' | '), 'sim-log-info');
  } else {
    _simLog('🔍 DEBUG FILE STATUS: nenhum SELECT...FILE STATUS IS reconhecido no código', 'sim-log-error');
  }
  // Registra clique p/ breakpoints
  cy.on('tap', 'node', _simNodeTap);
}

function simStop(close) {
  clearTimeout(_sim.timer);
  if (typeof _repEndRun === 'function') _repEndRun(close ? 'cancelado' : 'interrompido');
  _sim.running = false;
  _sim.paused  = false;
  _closeBranchModal();

  if (!close && _sim.step > 0) {
    // Mostra modal de reinício apenas se já houve execução
    var m = document.getElementById('sim-restart-modal');
    if (m) { m.classList.add('open'); return; }
  }
  _simStopExecute(close);
}

var _simRestartDecide = function(choice) {
  var m = document.getElementById('sim-restart-modal');
  if (m) m.classList.remove('open');
  if (choice === 'continuar') {
    _simStopExecute(false, true /* keepState */);
  } else {
    _simStopExecute(false, false);
  }
};

function _simStopExecute(close, keepState) {
  _simClear();
  if (close) {
    _sim.on = false;
    _sim.breakpoints.clear();
    cy.nodes().removeClass('sim-breakpoint');
    document.body.classList.remove('sim-active');
    document.getElementById('sim-panel').classList.remove('sim-visible');
    var vp = document.getElementById('sim-vars-panel');
    if (vp) vp.classList.remove('sim-vars-visible');
    cy.off('tap', 'node', _simNodeTap);
  } else {
    if (keepState) {
      // Continuar: mantém log e variáveis, adiciona separador visual
      _simVarsMoved  = {};
      _simVarsChanged = {};
      _simResetFilePointers();
      // Separador no log do simulador
      _simLog('── Reiniciado (continuação) ──', 'sim-log-restart-sep');
      // Separador no log do Mapa de Execução
      if (typeof _emAppendLog === 'function') {
        _emAppendLog('─────────── reinício ───────────', 'em-log-sep');
      }
    } else {
      // Limpar: comportamento original
      _simLog('Reiniciado. Edite os valores e clique ▶ para rodar.', 'sim-log-info');
      _simVarsMoved  = {};
      _simVarsChanged = {};
      _simResetFilePointers();
      // Limpa log do Mapa de Execução
      if (typeof _emLogHistory !== 'undefined') _emLogHistory = [];
      var emLog = document.getElementById('em-log-list');
      if (emLog) emLog.innerHTML = '';
      // Restaura variáveis ao valor inicial do usuário
      _simVarDefs.forEach(function(v) { if (!v.isGroup) _simVars[v.name] = _simVarsInitial.hasOwnProperty(v.name) ? _simVarsInitial[v.name] : v.value; });
    }
    var vp2 = document.getElementById('sim-vars-panel');
    if (vp2) { _simRefreshVarsPanel(); vp2.classList.add('sim-vars-visible'); }
    _simSetPanelPhase('input');
    _simSetButtons('idle');
  }
}

function _simFindRoot() {
  // Preferência: nó sem predecessores visíveis (sources do grafo)
  var sources = cy.nodes().filter(function(n) {
    return n.incomers('node').length === 0 && !n.hasClass('sim-visited');
  });
  if (sources.length > 0) return sources[0].id();
  // Fallback: primeiro nó na ordem
  return cy.nodes()[0] ? cy.nodes()[0].id() : null;
}

function _simSetButtons(state) {
  var play  = document.getElementById('sim-btn-play');
  var pause = document.getElementById('sim-btn-pause');
  var step  = document.getElementById('sim-btn-step');
  var stop  = document.getElementById('sim-btn-stop');
  if (!play) return;
  if (state === 'idle') {
    play.disabled  = false;
    pause.disabled = true;
    step.disabled  = false;
    stop.disabled  = false;
  } else if (state === 'running') {
    play.disabled  = true;
    pause.disabled = false;
    step.disabled  = true;
    stop.disabled  = false;
  } else if (state === 'paused') {
    play.disabled  = false;
    pause.disabled = true;
    step.disabled  = false;
    stop.disabled  = false;
  } else if (state === 'ended') {
    play.disabled  = true;
    pause.disabled = true;
    step.disabled  = true;
    stop.disabled  = false;
  }
  if (typeof _emSyncButtons === 'function') _emSyncButtons();
}

// Retorna os sucessores válidos de um nó (pula nós merge/helper)
function _simNextNodes(nodeId) {
  if (!nodeId) return [];
  var node = cy.getElementById(nodeId);
  var succs = node.outgoers('node');
  if (succs.length === 0) return [];
  // Para nós IF/EVALUATE: retorna TODOS os sucessores imediatos, incluindo merge.
  // O avaliador precisa ver os dois ramos (SIM e Não) para escolher o correto,
  // mesmo que um deles seja um nó merge (que ocorre quando não há ELSE).
  var tipo = node.data('tipo');
  if (tipo === 'if' || tipo === 'evaluate') {
    return succs.toArray();
  }
  // Para demais nós: filtra merge e avança recursivamente
  var valid = succs.filter(function(n) {
    var t = n.data('tipo');
    return t && t !== 'merge';
  });
  if (valid.length > 0) return valid.toArray();
  // Se só há merge, avança recursivamente
  var mergeSuccs = [];
  succs.forEach(function(ms) { mergeSuccs = mergeSuccs.concat(_simNextNodes(ms.id())); });
  return mergeSuccs;
}

// Retorna label da aresta entre dois nós
function _simEdgeLabel(fromId, toId) {
  var edge = cy.getElementById(fromId).edgesTo(cy.getElementById(toId));
  return edge.length ? (edge[0].data('label') || '') : '';
}

// Avança um passo na simulação
// Retorna Promise<bool> (true = continua, false = fim)
function _simAdvance() {
  return new Promise(function(resolve) {
    // Primeiro passo: encontrar nó raiz
    if (!_sim.currentId) {
      var root = _simFindRoot();
      if (!root) { _simLog('Nenhum nó encontrado no diagrama.', 'sim-log-end'); resolve(false); return; }
      _sim.step++;
      _simHighlight(root);
      _simLogNode(root);
      _simStepInfo();
      // Verifica breakpoint logo no início
      if (cy.getElementById(root).hasClass('sim-breakpoint')) {
        _simLog('🔴 Breakpoint: ' + _simNodeLabel(root), 'sim-log-bp');
        resolve('break');
        return;
      }
      resolve(true);
      return;
    }

    var curNode = cy.getElementById(_sim.currentId);
    var tipo = curNode.data('tipo') || '';

    // Rastreia instruções que atualizam variáveis — qualquer tipo de nó
    // (SET pode aparecer dentro de AT END como nó 'io')
    {
      var lbl = curNode.data('label') || '';
      var lblU = lbl.trim().toUpperCase();
      var _tracked = false;

      // Nó 'grupo': processa cada linha do detail individualmente
      if (tipo === 'grupo') {
        var _detail = curNode.data('detail') || '';
        _detail.split('\n').forEach(function(dl) {
          var du = dl.trim().replace(/\r?\n/g,' ').replace(/\s+/g,' ').toUpperCase();
          if (!du) return;
          if (/^DISPLAY\b/.test(du))  { _simTrackDisplay(du); }
          else if (/^MOVE\b/.test(du))   { _simTrackMove(du); _tracked = true; }
          else if (/^SET\b/.test(du))    { _simTrackSet(du);  _tracked = true; }
          else if (/^ADD\b/.test(du))    { _simTrackAdd(du);  _tracked = true; }
          else if (/^SUBTRACT\b/.test(du)){ _simTrackSubtract(du); _tracked = true; }
          else if (/^MULTIPLY\b/.test(du)){ _simTrackMultiply(du); _tracked = true; }
          else if (/^DIVIDE\b/.test(du)) { _simTrackDivide(du);   _tracked = true; }
          else if (/^COMPUTE\b/.test(du)){ _simTrackCompute(du);  _tracked = true; }
        });
      } else {
        if      (/^DISPLAY\b/.test(lblU)) { _simTrackDisplay(lbl.trim().replace(/\r?\n/g,' ').replace(/\s+/g,' ').toUpperCase()); }
        else if (/^MOVE\b/.test(lblU))     { _simTrackMove(lblU);     _tracked = true; }
        else if (/^SET\b/.test(lblU))      { _simTrackSet(lblU);      _tracked = true; }
        else if (tipo === 'instrucao' || tipo === 'instr') {
          if      (/^ADD\b/.test(lblU))      { _simTrackAdd(lblU);      _tracked = true; }
          else if (/^SUBTRACT\b/.test(lblU)) { _simTrackSubtract(lblU); _tracked = true; }
          else if (/^MULTIPLY\b/.test(lblU)) { _simTrackMultiply(lblU); _tracked = true; }
          else if (/^DIVIDE\b/.test(lblU))   { _simTrackDivide(lblU);   _tracked = true; }
          else if (/^COMPUTE\b/.test(lblU))  { _simTrackCompute(lblU);  _tracked = true; }
        }
      }

      if (_tracked) {
        var _vp = document.getElementById('sim-vars-panel');
        if (_vp && !_vp.classList.contains('sim-vars-visible') && _simVarDefs.length > 0) {
          _simRefreshVarsPanel();
          _vp.classList.add('sim-vars-visible');
          _simSetPanelPhase('running');
        }
      }
    }

    // STOP / GOBACK → fim
    if (tipo === 'stop') {
      _simLog('✔ ' + (curNode.data('label') || 'STOP') + ' — Programa encerrado.', 'sim-log-end');
      _simSetButtons('ended');
      resolve(false);
      return;
    }

    var nexts = _simNextNodes(_sim.currentId);

    // Sem sucessores → verifica call stack (retorno de PERFORM)
    if (nexts.length === 0) {
      if (_sim.callStack.length > 0) {
        var frame = _sim.callStack.pop();
        _simUpdateStack();
        _simLog('↩ Retornando para ' + frame.label);
        // Avança a partir do ponto de retorno
        var retNexts = _simNextNodes(frame.returnId);
        if (retNexts.length === 0) { _simLog('✔ Fim do fluxo.', 'sim-log-end'); _simSetButtons('ended'); resolve(false); return; }
        _sim.step++;
        _simHighlight(retNexts[0].id());
        _simLogNode(retNexts[0].id());
        _simStepInfo();
        _simCheckBreak(retNexts[0].id(), resolve);
        return;
      }
      _simLog('✔ Fim do fluxo.', 'sim-log-end');
      _simSetButtons('ended');
      resolve(false);
      return;
    }

    // PERFORM: o diagrama já expande o conteúdo do parágrafo inline (conectado via arestas).
    // Não é necessário saltar — basta avançar para nexts[0] normalmente.
    // (A busca pelo nó de parágrafo foi removida pois encontrava o próprio nó PERFORM,
    //  causando loop infinito.)

    // ── LOOP deve ser avaliado ANTES do fast-path nexts.length===1,
    // pois FIM aponta para merge (filtrado) e nexts fica com só [body].
    if (tipo === 'loop') {
      // Lê as arestas DIRETAMENTE — _simNextNodes filtra nós 'merge',
      // mas FIM aponta para um merge node → precisamos bypass do filtro.
      var loopEdge = null, fimRaw = null;
      curNode.outgoers('edge').forEach(function(e) {
        var lbl = (e.data('label') || '').toUpperCase();
        if (lbl === 'LOOP') loopEdge = e.target();
        else if (lbl === 'FIM') fimRaw = e.target();
      });
      // fimRaw é o nó 'merge' — atravessa até o próximo nó real
      var fimEdge = null;
      if (fimRaw) {
        if (fimRaw.data('tipo') !== 'merge') {
          fimEdge = fimRaw;
        } else {
          // Percorre recursivamente além do merge
          var mergeNextArr = _simNextNodes(fimRaw.id());
          fimEdge = mergeNextArr.length > 0 ? mergeNextArr[0] : fimRaw;
        }
      }
      // Fallback: se não achou por label, usa posição em nexts
      if (!loopEdge) loopEdge = nexts[0] || null;
      if (!fimEdge)  fimEdge  = nexts[1]  || nexts[0] || null;

      var loopId   = curNode.id();
      var loopLabel = (curNode.data('label') || '').toUpperCase();
      var st = _simLoopState[loopId];

      // ── Inicialização na primeira visita ────────────────────
      if (!st) {
        st = _simLoopState[loopId] = { iters: 0, maxIters: 9999, done: false,
                                        varName: null, by: 1, timesN: null };
        // TIMES: PERFORM X\n5 TIMES  ou  PERFORM X\nWS-VAR TIMES
        var timesM = loopLabel.match(/(\d+|[A-Z][A-Z0-9-]*)\s+TIMES/);
        if (timesM) {
          var timesN = /^\d+$/.test(timesM[1]) ? parseInt(timesM[1]) : parseFloat(_simVars[timesM[1]] || '0');
          st.maxIters = isNaN(timesN) ? 1 : timesN;
          st.timesN   = st.maxIters;
        }
        // VARYING v FROM x BY y UNTIL cond
        var varyM = loopLabel.match(/VARYING\s+([A-Z][A-Z0-9-]*)\s+FROM\s+(-?[\d.]+|[A-Z][A-Z0-9-]*)\s+BY\s+(-?[\d.]+|[A-Z][A-Z0-9-]*)/);
        if (varyM) {
          st.varName = varyM[1];
          var fromVal = /^-?[\d.]+$/.test(varyM[2]) ? parseFloat(varyM[2]) : parseFloat(_simVars[varyM[2]] || '0');
          var byVal   = /^-?[\d.]+$/.test(varyM[3]) ? parseFloat(varyM[3]) : parseFloat(_simVars[varyM[3]] || '0');
          st.by = isNaN(byVal) ? 1 : byVal;
          // Inicializa a variável de controle agora com FROM
          if (!isNaN(fromVal)) {
            _simSetVarInternal(st.varName, _simFmtNum(fromVal));
          }
        }
      } else if (st.varName) {
        // Incrementa VARYING a cada iteração (exceto a primeira)
        var cur = parseFloat(_simVars[st.varName]);
        if (!isNaN(cur)) {
          _simSetVarInternal(st.varName, _simFmtNum(cur + st.by));
        }
      }

      // ── Avalia condição de saída ────────────────────────────
      var shouldExit = false;
      if (st.timesN !== null) {
        // TIMES: sai quando iters >= maxIters
        shouldExit = (st.iters >= st.maxIters);
      } else {
        // UNTIL: extrai condição do label.
        // Dois formatos possíveis:
        //   a) Loop nomeado:  "PERFORM PARA-X\nUNTIL cond"  → condição na linha 1+
        //   b) Loop inline:   "UNTIL cond"  ou  "VARYING v FROM x BY y UNTIL cond"  → linha 0
        var rawLabel = (curNode.data('label') || '').toUpperCase();
        var lines2   = rawLabel.split('\n');
        var condLine = '';
        for (var li = 0; li < lines2.length; li++) {
          var l2u = lines2[li].trim();
          // remove WITH TEST BEFORE/AFTER
          l2u = l2u.replace(/^WITH\s+TEST\s+(?:BEFORE|AFTER)\s+/, '');
          if (/^UNTIL\b/.test(l2u)) { condLine = l2u.replace(/^UNTIL\s+/, '').trim(); break; }
          if (/^VARYING\b/.test(l2u)) {
            // extrai UNTIL do final: "VARYING v FROM x BY y UNTIL cond"
            var untilIdx = l2u.indexOf(' UNTIL ');
            if (untilIdx > -1) { condLine = l2u.substring(untilIdx + 7).trim(); break; }
          }
        }
        // Fallback: label inteiro sem prefixo PERFORM  (ex: "UNTIL WS-AUX GREATER 12")
        if (!condLine) {
          var stripped = rawLabel.replace(/^PERFORM\s+[A-Z0-9][A-Z0-9-]*\s*/, '').trim();
          stripped = stripped.replace(/^WITH\s+TEST\s+(?:BEFORE|AFTER)\s+/, '');
          if (/^UNTIL\b/.test(stripped)) condLine = stripped.replace(/^UNTIL\s+/, '').trim();
        }
        if (condLine) {
          var evalLoop = null;
          try { evalLoop = _simEvalCond(condLine); } catch(e) { evalLoop = null; }
          if (evalLoop !== null) {
            shouldExit = evalLoop;  // UNTIL cond → sai quando cond = true
          } else {
            // Não consegue avaliar → pergunta
            var infoEl2 = document.getElementById('sim-vars-eval-info');
            if (infoEl2) { infoEl2.textContent = '? LOOP: ' + condLine.substring(0,45); infoEl2.className = ''; }
            _simAskBranch(nexts, curNode).then(function(chosen) {
              if (!chosen) { resolve(false); return; }
              if (_simLoopState[loopId] && chosen.id() === (fimEdge ? fimEdge.id() : '')) {
                _simLoopState[loopId].done = true;
              }
              _sim.step++;
              _simHighlight(chosen.id());
              _simLogNode(chosen.id());
              _simStepInfo();
              _simCheckBreak(chosen.id(), resolve);
            });
            return;
          }
        }
      }

      // ── Salvaguarda contra loop infinito ──────────────────
      var _loopMaxSafe = 500;
      if (st.iters >= _loopMaxSafe) {
        delete _simLoopState[loopId];
        _simLog('⚠ LOOP interrompido após ' + _loopMaxSafe + ' iterações (limite de segurança). Verifique as variáveis.', 'sim-log-end');
        var infoEl5 = document.getElementById('sim-vars-eval-info');
        if (infoEl5) { infoEl5.textContent = '⚠ LOOP INFINITO (' + _loopMaxSafe + ' iter)'; infoEl5.className = 'fail'; }
        _sim.step++;
        _simHighlight(fimEdge.id());
        _simLogNode(fimEdge.id());
        _simStepInfo();
        _simCheckBreak(fimEdge.id(), resolve);
        return;
      }

      // ── Decide: continua loop ou sai ──────────────────────
      if (shouldExit) {
        delete _simLoopState[loopId];
        var exitNode = fimEdge;
        if (typeof _repOnLoop === 'function') _repOnLoop((curNode.data('label') || loopId).substring(0, 80), st.iters);
        _simLog('↻ LOOP encerrado após ' + st.iters + ' iteração(ões).', 'sim-log-branch');
        var infoEl3 = document.getElementById('sim-vars-eval-info');
        if (infoEl3) { infoEl3.textContent = '✓ LOOP FIM (' + st.iters + ' iter)'; infoEl3.className = 'success'; }
        _sim.step++;
        _simHighlight(exitNode.id());
        _simLogNode(exitNode.id());
        _simStepInfo();
        _simCheckBreak(exitNode.id(), resolve);
      } else {
        st.iters++;
        var bodyNode = loopEdge;
        _simLog('↻ LOOP iter #' + st.iters + (st.varName ? '  ' + st.varName + '=' + (_simVars[st.varName] || '?') : '') + (st.timesN !== null ? '/' + st.maxIters : ''), 'sim-log-branch');
        var infoEl4 = document.getElementById('sim-vars-eval-info');
        if (infoEl4) { infoEl4.textContent = '↻ Iter #' + st.iters + (st.varName ? '  ' + st.varName + '=' + (_simVars[st.varName] || '?') : ''); infoEl4.className = ''; }
        _sim.step++;
        _simHighlight(bodyNode.id());
        _simLogNode(bodyNode.id());
        _simStepInfo();
        _simCheckBreak(bodyNode.id(), resolve);
      }
      return;
    }

    // Nó com um único sucessor → avança direto
    if (nexts.length === 1) {
      // OPEN e CLOSE executam ANTES de avançar para o próximo nó,
      // pois o próximo nó pode ser um IF que testa o FILE STATUS.
      // SQL também executa ANTES — SQLCODE deve estar setado antes do próximo IF.
      // READ e WRITE ficam pending para que a mensagem do log apareça após o label do nó.
      if (tipo === 'open') {
        var _openLbl = (curNode.data('label') || '').replace(/\r?\n/g,' ').toUpperCase();
        _simDoOpen(_openLbl);
      }
      if (tipo === 'close') {
        var _closeLbl = (curNode.data('label') || '').replace(/\r?\n/g,' ').toUpperCase();
        _simDoClose(_closeLbl);
      }
      if (tipo === 'sql') {
        // Usa detail (SQL completo) quando disponível; shortLabel serve só como fallback
        _simExecuteSql(curNode.data('detail') || curNode.data('label') || '');
      }
      var _pendIoLbl    = null;
      var _pendWriteLbl = null, _pendWriteVerb = null;
      if (tipo === 'io') {
        _pendIoLbl = (curNode.data('label') || '').replace(/\r?\n/g,' ').toUpperCase();
      }
      if (tipo === 'write') {
        _pendWriteLbl  = (curNode.data('label') || '');
        _pendWriteVerb = (curNode.data('writeVerb') || _pendWriteLbl.split('\n')[0] || '').toUpperCase();
      }
      _sim.step++;
      _simHighlight(nexts[0].id());
      _simLogNode(nexts[0].id());
      // READ e WRITE executam após o log para que a mensagem apareça por último
      if (_pendIoLbl    !== null && /^READ\b/.test(_pendIoLbl)) _simDoRead(_pendIoLbl);
      if (_pendWriteLbl !== null) _simDoWrite(_pendWriteLbl, _pendWriteVerb === 'REWRITE');
      _simStepInfo();
      _simCheckBreak(nexts[0].id(), resolve);
      return;
    }

    // Múltiplos ramos (IF, EVALUATE) → tenta avaliar automaticamente
    if (tipo === 'if') {
      var condText = curNode.data('label') || '';
      var condNorm = condText.replace(/\r?\n/g,' ').replace(/\s+/g,' ').trim().toUpperCase();
      var evalResult = null;

      // Caso especial: AT END? / INVALID KEY? — resultado do último READ
      if (condNorm === 'AT END?' || condNorm === 'INVALID KEY?') {
        evalResult = _simLastReadAtEnd;
      } else {
        // DEBUG: extrai nome de variável da condição para mostrar seu valor atual
        var _dbgVarM = condNorm.replace(/^IF\s+/,'').match(/^([A-Z][A-Z0-9-]*)/);
        if (_dbgVarM) {
          var _dbgVn = _dbgVarM[1];
          var _dbgHas = _simVars.hasOwnProperty(_dbgVn);
          var _dbgVal = _dbgHas ? _simVars[_dbgVn] : '(NÃO ESTÁ EM _simVars)';
          _simLog('🔍 DEBUG IF: ' + _dbgVn + ' = ' + JSON.stringify(_dbgVal) + (_dbgHas ? '' : ' ← variável não foi inicializada!'), 'sim-log-branch');
          // Se não está em _simVars mas deveria ser FILE STATUS, mostra dica
          if (!_dbgHas) {
            var _dbgFsVars = Object.values(_simFileStatusMapDebug);
            if (_dbgFsVars.indexOf(_dbgVn) >= 0) {
              _simLog('🔍 DEBUG: ' + _dbgVn + ' é FILE STATUS de ' + Object.keys(_simFileStatusMapDebug).find(function(k){return _simFileStatusMapDebug[k]===_dbgVn;}) + ' — mas o OPEN ainda não rodou ou parser falhou', 'sim-log-error');
            } else if (Object.keys(_simFileStatusMapDebug).length === 0) {
              _simLog('🔍 DEBUG: FILE STATUS MAP vazio — SELECT...FILE STATUS IS não foi reconhecido no código', 'sim-log-error');
            }
          }
        }
        try { evalResult = _simEvalCond(condText.toUpperCase()); } catch(e) { evalResult = null; }
      }

      if (evalResult !== null) {
        // Encontra ramo positivo (SIM/EOF/Inválida) ou negativo (Não/Continua)
        var simEdge = null, naoEdge = null;
        nexts.forEach(function(n) {
          var el = _simEdgeLabel(curNode.id(), n.id()).toUpperCase();
          if (el === 'SIM' || el === 'EOF' || el === 'INV\u00c1LIDA' || el === 'INVALIDA') simEdge = n;
          else naoEdge = n;
        });
        var chosen = evalResult ? (simEdge || nexts[0]) : (naoEdge || nexts[1] || nexts[0]);
        _simLog('⬦ Auto (' + (evalResult ? 'SIM' : 'Não') + '): ' + condText.split('\n')[0].substring(0,50), 'sim-log-branch');
        if (typeof _repOnBranch === 'function') _repOnBranch(condText.split('\n')[0].substring(0,80), evalResult ? 'SIM' : 'Não', true);
        // Mostra info de avaliação no painel de vars
        var infoEl = document.getElementById('sim-vars-eval-info');
        if (infoEl) {
          infoEl.textContent = (evalResult ? '✓ SIM' : '✗ Não') + ': ' + condText.split('\n')[0].substring(0,40);
          infoEl.className = evalResult ? 'success' : 'fail';
        }
        _sim.step++;
        // Se o ramo escolhido é um nó merge (IF sem ELSE, ramo Não vai direto ao merge),
        // pula o merge e avança para o próximo nó real sem logar o merge
        if (chosen.data('tipo') === 'merge' || !chosen.data('tipo')) {
          var _mergeNexts = _simNextNodes(chosen.id());
          if (_mergeNexts.length > 0) {
            _simHighlight(_mergeNexts[0].id());
            _simLogNode(_mergeNexts[0].id());
            _simStepInfo();
            _simCheckBreak(_mergeNexts[0].id(), resolve);
          } else {
            // Merge sem sucessores = fim do parágrafo
            _simHighlight(chosen.id());
            _simStepInfo();
            resolve(true);
          }
          return;
        }
        _simHighlight(chosen.id());
        _simLogNode(chosen.id());
        _simStepInfo();
        _simCheckBreak(chosen.id(), resolve);
        return;
      }
      // Não conseguiu avaliar → pede ao usuário
      var _dbgCond = condText.replace(/\r?\n/g,' ').trim();
      // Mostra variáveis da condição e seus valores para diagnóstico
      var _dbgVarsInCond = _dbgCond.toUpperCase().match(/\b[A-Z][A-Z0-9-]{2,}\b/g) || [];
      var _dbgVarInfo = _dbgVarsInCond.filter(function(v,i,a){return a.indexOf(v)===i;}).map(function(v){
        return v + '=' + (_simVars.hasOwnProperty(v) ? JSON.stringify(_simVars[v]) : '⚠NÃO EXISTE');
      }).join(', ');
      _simLog('⬦ IF não avaliado automaticamente: ' + _dbgCond.substring(0, 60), 'sim-log-branch');
      _simLog('   Variáveis na condição: ' + (_dbgVarInfo || '(nenhuma reconhecida)'), 'sim-log-error');
    }

    // EVALUATE: avalia automaticamente usando variáveis conhecidas
    if (tipo === 'evaluate') {
      var evLabel = (curNode.data('label') || '').replace(/\r?\n/g, ' ');
      // Extrai o sujeito: "EVALUATE WS-AUX" → "WS-AUX", "EVALUATE TRUE" → "TRUE"
      var evSubject = evLabel.replace(/^EVALUATE\s+/i, '').trim().toUpperCase();
      var evChosen = null;
      // Para cada ramo (aresta de saída): label é o texto do WHEN
      nexts.forEach(function(n) {
        if (evChosen) return;
        var whenLbl = _simEdgeLabel(curNode.id(), n.id()).trim().toUpperCase();
        if (!whenLbl || whenLbl === 'OTHER' || whenLbl === 'OUTRO') return; // OTHER = fallback
        // Avalia WHEN contra o sujeito
        if (_simEvalWhen(evSubject, whenLbl) === true) evChosen = n;
      });
      // Se nenhum WHEN bateu, procura o ramo OTHER/OUTRO
      if (!evChosen) {
        nexts.forEach(function(n) {
          if (evChosen) return;
          var whenLbl = _simEdgeLabel(curNode.id(), n.id()).trim().toUpperCase();
          if (whenLbl === 'OTHER' || whenLbl === 'OUTRO' || whenLbl === '') evChosen = n;
        });
      }
      if (evChosen) {
        var evWhenLbl = _simEdgeLabel(curNode.id(), evChosen.id());
        _simLog('⬦ EVALUATE → WHEN ' + evWhenLbl + ' (' + evSubject + ')', 'sim-log-branch');
        if (typeof _repOnBranch === 'function') _repOnBranch('EVALUATE ' + evSubject, 'WHEN ' + evWhenLbl, true);
        var infoEl2 = document.getElementById('sim-vars-eval-info');
        if (infoEl2) { infoEl2.textContent = 'WHEN ' + evWhenLbl; infoEl2.className = 'success'; }
        _sim.step++;
        _simHighlight(evChosen.id());
        _simLogNode(evChosen.id());
        _simStepInfo();
        _simCheckBreak(evChosen.id(), resolve);
        return;
      }
      _simLog('⬦ EVALUATE não avaliado automaticamente: ' + evSubject, 'sim-log-branch');
    }

    // Pergunta ao usuário (IF sem vars setadas, EVALUATE, etc.)
    _simAskBranch(nexts, curNode).then(function(chosen) {
      if (!chosen) { resolve(false); return; }
      var chosenLbl = _simEdgeLabel(curNode.id(), chosen.id()) || chosen.data('label') || '';
      if (typeof _repOnBranch === 'function') _repOnBranch((curNode.data('label') || '').substring(0, 80), chosenLbl.substring(0, 60), false);
      _sim.step++;
      // Pula merge se for o nó escolhido (ex: IF sem ELSE, ramo Não manual)
      if (chosen.data('tipo') === 'merge' || !chosen.data('tipo')) {
        var _mNexts = _simNextNodes(chosen.id());
        if (_mNexts.length > 0) {
          _simHighlight(_mNexts[0].id());
          _simLogNode(_mNexts[0].id());
          _simStepInfo();
          _simCheckBreak(_mNexts[0].id(), resolve);
        } else {
          _simHighlight(chosen.id());
          _simStepInfo();
          resolve(true);
        }
        return;
      }
      _simHighlight(chosen.id());
      _simLogNode(chosen.id());
      _simStepInfo();
      _simCheckBreak(chosen.id(), resolve);
    });
  });
}

function _simCheckBreak(nodeId, resolve) {
  if (cy.getElementById(nodeId).hasClass('sim-breakpoint')) {
    _simLog('🔴 Breakpoint: ' + _simNodeLabel(nodeId), 'sim-log-bp');
    resolve('break');
  } else {
    resolve(true);
  }
}

function _simNodeLabel(nodeId) {
  var n = cy.getElementById(nodeId);
  return (n.data('label') || n.data('target') || nodeId).split('\n')[0].substring(0, 40);
}

function _simLogNode(nodeId) {
  var n = cy.getElementById(nodeId);
  var tipo = n.data('tipo') || '';
  var lbl  = _simNodeLabel(nodeId);
  var icons = { instrucao:'▸', if:'⬦', loop:'↺', perform:'→', 'perform-section':'→', goto:'⇒',
                call:'☎', sql:'⛁', io:'⇌', read:'↓', write:'↑', open:'⊙', close:'⊗',
                stop:'■', copy:'⎘', evaluate:'◇', macro:'◈' };
  var icon = icons[tipo] || icons[tipo.split('-')[0]] || '•';
  _simLog(icon + ' [' + (tipo||'?') + ']  ' + lbl);
  if (typeof _emHighlightLine === 'function') _emHighlightLine(n.data('srcLine'), lbl);
  // ── Registra estatísticas de execução ──────────────────
  _simNodeHits[nodeId] = (_simNodeHits[nodeId] || 0) + 1;
  _simParaSeq.push({ id: nodeId, label: lbl, tipo: tipo, step: _sim.step });
}

// Avalia um WHEN de EVALUATE contra o sujeito resolvido.
// subject: string já em maiúsculas (nome de variável ou "TRUE")
// whenText: label da aresta (já em maiúsculas), ex: "1", "'S'", "1 THRU 5", "WS-TIPO = 1", "TRUE"
// Retorna true/false/null
function _simEvalWhen(subject, whenText) {
  // Resolve o valor do sujeito
  var subjectVal;
  if (subject === 'TRUE') {
    subjectVal = null; // modo EVALUATE TRUE: whenText é uma condição booleana
  } else if (_simVars.hasOwnProperty(subject)) {
    subjectVal = _simVars[subject];
  } else {
    return null; // sujeito não encontrado
  }

  // Modo EVALUATE TRUE: whenText é condição booleana (ex: "WS-A = 1 AND WS-B = 2")
  if (subject === 'TRUE') {
    try { return _simEvalCond(whenText); } catch(e) { return null; }
  }

  // Suporte a lista de valores separados por ALSO (EVALUATE A ALSO B)
  // Para simplificar: só o 1º sujeito/WHEN é avaliado se houver ALSO
  var whenSimple = whenText.split(/\s+ALSO\s+/)[0].trim();

  // WHEN THRU: "1 THRU 5" ou "1 THROUGH 5"
  var thruM = whenSimple.match(/^(.+?)\s+(?:THRU|THROUGH)\s+(.+)$/);
  if (thruM) {
    var loV = _simResolveWhenVal(thruM[1].trim(), subjectVal);
    var hiV = _simResolveWhenVal(thruM[2].trim(), subjectVal);
    if (loV === null || hiV === null) return null;
    var numSub = parseFloat(subjectVal), numLo = parseFloat(loV), numHi = parseFloat(hiV);
    if (!isNaN(numSub) && !isNaN(numLo) && !isNaN(numHi))
      return numSub >= numLo && numSub <= numHi;
    var sv = (subjectVal || '').trim().toUpperCase();
    return sv >= loV.toUpperCase() && sv <= hiV.toUpperCase();
  }

  // WHEN com operador relacional: "= 0", "> 5", "EQUAL 'S'" etc.
  var opM = whenSimple.match(/^(NOT\s+)?(?:IS\s+)?(NOT\s+EQUAL(?:\s+TO)?|NOT\s*=|NOT\s*>|NOT\s*<|EQUAL(?:\s+TO)?|GREATER(?:\s+THAN)?|LESS(?:\s+THAN)?|>=|<=|>|<|=)\s+(.+)$/);
  if (opM) {
    // Constrói expressão completa e reavalia
    var synth = subject + ' ' + (opM[1] || '') + opM[2] + ' ' + opM[3];
    try { return _simEvalCond(synth.trim()); } catch(e) { return null; }
  }

  // Valor simples: literal, número, figurativo ou variável
  var cmpVal = _simResolveWhenVal(whenSimple, subjectVal);
  if (cmpVal === null) return null;
  var nA = parseFloat(subjectVal), nB = parseFloat(cmpVal);
  if (!isNaN(nA) && !isNaN(nB))
    return nA === nB;
  return (subjectVal || '').trim().toUpperCase() === cmpVal.toUpperCase();
}

// Resolve um token de valor WHEN para string comparável
function _simResolveWhenVal(token, _subjectVal) {
  var t = token.trim().toUpperCase();
  if (_SIM_FIGURATIVE.hasOwnProperty(t)) return _SIM_FIGURATIVE[t] || '';
  if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"')))
    return token.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(token)) return token;
  if (_simVars.hasOwnProperty(t)) return _simVars[t];
  return null;
}

// ================================================================
// SESSÃO — exportar / restaurar dados do Simulador (workspace unificado)
// ================================================================
function _simGetSessionData() {
  return {
    simVarsInitial: JSON.parse(JSON.stringify(_simVarsInitial || {})),
    simFiles:       JSON.parse(JSON.stringify(_simFiles       || {})),
    simDb2Tables:   JSON.parse(JSON.stringify(_simDb2Tables   || {}))
  };
}

function _simRestoreSession(data) {
  if (!data) return;
  if (data.simVarsInitial) {
    Object.keys(_simVarsInitial).forEach(function(k) { delete _simVarsInitial[k]; });
    Object.assign(_simVarsInitial, data.simVarsInitial);
  }
  if (data.simFiles)     { _simFiles     = data.simFiles; }
  if (data.simDb2Tables) { _simDb2Tables = data.simDb2Tables; }
  _simRefreshFilesPanel();
  _simRefreshDb2Panel();
}

// Modal de escolha de ramo
function _simAskBranch(nexts, fromNode) {
  return new Promise(function(resolve) {
    var modal = document.getElementById('sim-branch-modal');
    var condEl = document.getElementById('sim-branch-cond');
    var btnsEl = document.getElementById('sim-branch-btns');
    condEl.textContent = fromNode.data('label') || 'Condição';
    btnsEl.innerHTML = '';
    nexts.forEach(function(n, i) {
      var lbl = _simEdgeLabel(fromNode.id(), n.id()) || _simNodeLabel(n.id()) || ('Ramo ' + (i+1));
      var btn = document.createElement('button');
      btn.className = 'sim-branch-btn' + (i === 0 ? ' yes' : (i === 1 ? ' no' : ''));
      btn.textContent = lbl;
      btn.onclick = function() {
        modal.classList.remove('open');
        resolve(n);
      };
      btnsEl.appendChild(btn);
    });
    // Botão cancelar
    var cancel = document.createElement('button');
    cancel.className = 'sim-branch-btn';
    cancel.textContent = 'Cancelar';
    cancel.onclick = function() { modal.classList.remove('open'); resolve(null); };
    btnsEl.appendChild(cancel);
    modal.classList.add('open');
    _simLog('⬦ Escolha o ramo...', 'sim-log-branch');
    _sim._branchResolve = function() { modal.classList.remove('open'); resolve(null); };
  });
}

function _closeBranchModal() {
  var modal = document.getElementById('sim-branch-modal');
  if (modal) modal.classList.remove('open');
  if (_sim._branchResolve) { _sim._branchResolve(); _sim._branchResolve = null; }
}

// PLAY: execução automática
function simPlay() {
  // Salva snapshot dos valores que o usuário digitou como estado inicial
  _simVarDefs.forEach(function(v) { if (!v.isGroup) _simVarsInitial[v.name] = _simVars[v.name] !== undefined ? _simVars[v.name] : v.value; });
  _simVarsMoved = {};
  if (typeof _repStartRun === 'function') _repStartRun();
  _simSetPanelPhase('running');
  _sim.running = true;
  _sim.paused  = false;
  _simSetButtons('running');
  _simLoop();
}

function _simLoop() {
  if (!_sim.running) return;
  _simAdvance().then(function(ok) {
    if (ok === true) {
      _sim.timer = setTimeout(_simLoop, _simSpeed());
    } else if (ok === 'break') {
      // Breakpoint: pausa
      _sim.running = false;
      _sim.paused  = true;
      if (typeof _repEndRun === 'function') _repEndRun('breakpoint');
      _simSetButtons('paused');
    } else {
      _sim.running = false;
      if (typeof _repEndRun === 'function') _repEndRun('concluido');
      _simSetButtons('ended');
    }
  });
}

// PAUSE
function simPause() {
  clearTimeout(_sim.timer);
  _sim.running = false;
  _sim.paused  = true;
  _simSetButtons('paused');
  _simLog('⏸ Pausado. Clique ◼ para avançar.');
}

// STEP: avança um nó
function simStep() {
  if (_sim.running) return;
  // Na primeira vez que dá step, também salva snapshot e muda fase
  if (!_sim.currentId && Object.keys(_simVarsMoved).length === 0) {
    _simVarDefs.forEach(function(v) { if (!v.isGroup) _simVarsInitial[v.name] = _simVars[v.name] !== undefined ? _simVars[v.name] : v.value; });
    _simVarsMoved = {};
    _simSetPanelPhase('running');
  }
  _sim.paused = true;
  _simSetButtons('paused');
  _simAdvance().then(function(ok) {
    if (ok === true || ok === 'break') {
      _simSetButtons('paused');
    } else {
      _simSetButtons('ended');
    }
  });
}

// Breakpoints: toggle ao clicar nó no modo simulador
function _simNodeTap(evt) {
  if (!_sim.on) return;
  var node = evt.target;
  if (!node.isNode || !node.isNode()) return;
  var id = node.id();
  if (_sim.breakpoints.has(id)) {
    _sim.breakpoints.delete(id);
    node.removeClass('sim-breakpoint');
    _simLog('Breakpoint removido: ' + _simNodeLabel(id));
  } else {
    _sim.breakpoints.add(id);
    node.addClass('sim-breakpoint');
    _simLog('🔴 Breakpoint: ' + _simNodeLabel(id));
  }
}

function simToggleBpInfo() {
  _simLog('Clique nos nós do diagrama para colocar/remover breakpoints 🔴');
}

// Teclado F8 = step
document.addEventListener('keydown', function(e) {
  if (!_sim.on) return;
  if (e.key === 'F8') { e.preventDefault(); simStep(); }
  if (e.key === 'F5') { e.preventDefault(); _sim.running ? simPause() : simPlay(); }
  if (e.key === 'Escape') { _closeBranchModal(); }
});

// Fecha menus de exportação ao clicar fora
document.addEventListener('click', function(e) {
  if (!e.target.closest('.sim-file-export-wrap')) {
    document.querySelectorAll('.sim-file-export-menu.sim-exp-open').forEach(function(m) {
      m.classList.remove('sim-exp-open');
    });
  }
});