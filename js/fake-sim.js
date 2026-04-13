// ================================================================
//  FAKE SIMULATION v2 — Caminhos categorizados, variáveis exatas,
//  filtros por cenário e explicação narrativa de cada caminho.
// ================================================================

// ── Categorias de caminho ─────────────────────────────────────────
var _FS_CATEGORIES = {
  normal       : { label: 'Fim Normal',       icon: '✔',  color: '#22c55e' },
  abend        : { label: 'Abend / Erro',     icon: '💥', color: '#ef4444' },
  truncado     : { label: 'Profundidade Máx.',icon: '⚠️', color: '#94a3b8' },
  'file-read'  : { label: 'Leitura Arquivo',  icon: '📂', color: '#3b82f6' },
  'file-write' : { label: 'Gravação Arquivo', icon: '📝', color: '#8b5cf6' },
  'file-eof'   : { label: 'Fim de Arquivo',   icon: '📭', color: '#f59e0b' },
  'file-error' : { label: 'Erro de Arquivo',  icon: '🚫', color: '#f87171' },
  sql          : { label: 'SQL / DB2',        icon: '🛢',  color: '#06b6d4' },
  'sql-error'  : { label: 'Erro SQL',         icon: '💢', color: '#f97316' },
  'sql-notfound'       : { label: 'SQL Sem Dados',    icon: '🔍', color: '#78716c' },
  'parada-erro'        : { label: 'Parada por Erro',   icon: '🛑', color: '#b91c1c' },
  'saida-antecipada'   : { label: 'Saída Antecipada', icon: '⚡', color: '#f59e0b' },
  call         : { label: 'CALL Externo',     icon: '📞', color: '#a78bfa' },
  loop         : { label: 'Entra em Loop',    icon: '🔁', color: '#34d399' },
  straight     : { label: 'Caminho Reto',     icon: '➡',  color: '#9ca3af' },
  validacao    : { label: 'Retor. Validação', icon: '🔎', color: '#64748b' }
};

var _fakeSimPaths          = [];
var _fakeSimSelectedPath   = null;
var _fakeSimBranchQueue    = [];
var _fakeSimBranchQueueIdx = 0;
var _fakeSimActive         = false;
var _fakeSimGeneratedVars  = {};
var _fakeSimActiveFilter   = 'all';

// ── Abertura do modal ─────────────────────────────────────────────
function fakeSimOpen() {
  if (!cy || cy.nodes().length === 0) {
    alert('Gere o fluxo antes de usar Simulação Fake.');
    return;
  }
  var code = (document.getElementById('input') || {}).value || '';
  _simInitVars(code);
  if (typeof parseCobol === 'function') {
    var _fsPc88 = parseCobol(code);
    if (_fsPc88 && _fsPc88.condMap88) _simMergeCond88(_fsPc88.condMap88);
  }

  document.getElementById('fake-sim-overlay').classList.add('open');
  document.getElementById('fake-sim-paths-list').innerHTML =
    '<div class="fake-sim-loading"><span class="fsl-spinner"></span><span id="fsl-status">Iniciando análise…</span></div>';
  document.getElementById('fake-sim-path-count').textContent = '';
  document.getElementById('fake-sim-vars-preview').innerHTML = '';
  document.getElementById('fake-sim-filter-bar').innerHTML   = '';
  _fakeSimActiveFilter = 'all';

  _fakeSimDiscoverPathsAsync(
    function onProgress(found, stackSize) {
      var statusEl = document.getElementById('fsl-status');
      if (statusEl) statusEl.textContent = found + ' caminho(s) encontrado(s)… (fila: ' + stackSize + ')';
    },
    function onDone(paths) {
      _fakeSimPaths = paths;
      _fakeSimRenderFilterBar();
      _fakeSimRenderPathList();
    }
  );
}

function fakeSimClose() {
  document.getElementById('fake-sim-overlay').classList.remove('open');
  _fakeSimSelectedPath = null;
}

function fakeSimOverlayClick(e) {
  if (e.target === document.getElementById('fake-sim-overlay')) fakeSimClose();
}

// ── DFS iterativo assíncrono — processa em chunks para não travar a UI ───
// onProgress(found, stackSize) : chamado a cada chunk
// onDone(paths)                : chamado quando termina
function _fakeSimDiscoverPathsAsync(onProgress, onDone) {
  var MAX_PATHS = 150;
  var MAX_DEPTH = 500;
  var CHUNK     = 250; // frames por tick do event loop

  var _fsSrcs = cy.nodes().filter(function(n) { return n.incomers('node').length === 0; });
  var root = _fsSrcs.length > 0 ? _fsSrcs[0].id() : (cy.nodes()[0] ? cy.nodes()[0].id() : null);

  var paths = [];
  if (!root) { onDone(paths); return; }

  var _initMeta = {
    categories: [], openedFiles: [], readFiles: [], writtenFiles: [],
    sqlOps: [], callPrograms: [], narrative: [],
    fileOpenModes: {},
    varMoves: [], sortFiles: [], tableSearches: [],
    stopNodeId: null, stopLabel: '',
    abend: false, truncated: false, enteredLoop: false,
    hitEof: false, hitFileError: false,
    hitSqlError: false, hitSqlNotFound: false,
    hasClassFailure: false
  };

  // Pilha explícita: cada entrada é um "frame" da chamada recursiva original
  var stack = [{ nodeId: root, visitedLoops: new Set(), branches: [], nodeSeq: [], depth: 0, meta: _initMeta }];

  function tick() {
    var count = 0;
    while (stack.length > 0 && paths.length < MAX_PATHS && count < CHUNK) {
      count++;
      var fr = stack.pop();
      var nodeId = fr.nodeId, visitedLoops = fr.visitedLoops;
      var branches = fr.branches, nodeSeq = fr.nodeSeq;
      var depth = fr.depth, meta = fr.meta;

      if (depth > MAX_DEPTH) {
        var mTrunc = _fsCloneMeta(meta);
        mTrunc.truncated = true;
        _fakeSimFinalizePath(nodeSeq, branches, mTrunc, paths);
        continue;
      }
      if (!nodeId) continue;
      var node = cy.getElementById(nodeId);
      if (!node || node.length === 0) continue;

      var tipo   = node.data('tipo') || '';
      var label  = (node.data('label') || '').replace(/\r?\n/g, ' ');
      var labelU = label.toUpperCase();
      nodeSeq = nodeSeq.concat([nodeId]);

      var m = _fsCloneMeta(meta);

      // ── SEARCH — rastreia tabelas internas pesquisadas ────────────
      if (tipo === 'search') {
        var _srchTblFs = (node.data('searchTable') || '').trim();
        if (_srchTblFs && !m.tableSearches.includes(_srchTblFs)) m.tableSearches.push(_srchTblFs);
      }

      // ── SORT — rastreia arquivo SD (sort work file) ──────────────
      if (tipo === 'sort' || tipo === 'sort-input' || tipo === 'sort-engine' || tipo === 'sort-output') {
        var _sfNode = (node.data('sortFile') || '').trim();
        if (_sfNode && !m.sortFiles.includes(_sfNode)) m.sortFiles.push(_sfNode);
      }
      // RELEASE: alimenta arquivo SD
      if (tipo === 'write' && /^RELEASE\b/.test(labelU)) {
        var _sfRel = labelU.match(/RELEASE\s+([A-Z][A-Z0-9-]*)/);
        if (_sfRel) {
          var _sfRelFd = _sfRel[1];
          if (!m.sortFiles.includes(_sfRelFd)) m.sortFiles.push(_sfRelFd);
          if (!m.writtenFiles.includes(_sfRelFd)) m.writtenFiles.push(_sfRelFd);
        }
      }
      // RETURN: lê do arquivo SD (análogo ao READ para arquivos FD)
      if (tipo === 'io' && /^RETURN\s+([A-Z][A-Z0-9-]*)/.test(labelU)) {
        var _sfRetM = labelU.match(/^RETURN\s+([A-Z][A-Z0-9-]*)/);
        if (_sfRetM) {
          var _sfRetFd = _sfRetM[1];
          if (!m.sortFiles.includes(_sfRetFd)) m.sortFiles.push(_sfRetFd);
          if (!m.readFiles.includes(_sfRetFd)) m.readFiles.push(_sfRetFd);
        }
      }

      if (tipo === 'open') {
        // Extrai TODOS os pares modo+arquivo da instrução OPEN
        var openRest = labelU.replace(/^OPEN\s*/,'');
        var curMode = 'INPUT'; // fallback
        var openToks = openRest.split(/[\s,]+/).filter(Boolean);
        openToks.forEach(function(tok) {
          if (/^(INPUT|OUTPUT|I-O|EXTEND)$/.test(tok)) { curMode = tok; return; }
          var fdN = tok.replace(/[^A-Z0-9-]/g,'');
          if (!fdN) return;
          if (!m.openedFiles.includes(fdN)) m.openedFiles.push(fdN);
          var prev = m.fileOpenModes[fdN];
          var prio = { 'I-O':4, 'EXTEND':3, 'INPUT':2, 'OUTPUT':1 };
          if (!prev || (prio[curMode]||0) > (prio[prev]||0)) {
            m.fileOpenModes[fdN] = curMode;
          }
        });
      }
      if (tipo === 'io' || tipo === 'read' || /^READ\b/.test(labelU)) {
        var fdR = labelU.match(/READ\s+([A-Z][A-Z0-9-]*)/);
        if (fdR && !m.readFiles.includes(fdR[1])) m.readFiles.push(fdR[1]);
      }
      if (tipo === 'write' || /^(?:WRITE|REWRITE)\b/.test(labelU)) {
        var fdW = labelU.match(/(?:WRITE|REWRITE)\s+([A-Z][A-Z0-9-]*)/);
        if (fdW && !m.writtenFiles.includes(fdW[1])) m.writtenFiles.push(fdW[1]);
      }
      if (tipo === 'sql') {
        var sqlV = (node.data('detail') || label).replace(/\s+/g, ' ').trim().substring(0, 70);
        if (!m.sqlOps.length || m.sqlOps[m.sqlOps.length - 1] !== sqlV) m.sqlOps.push(sqlV);
      }
      if (tipo === 'call') {
        var callM = labelU.match(/CALL\s+['"]?([A-Z0-9][A-Z0-9-]*)['"]?/);
        if (callM && !m.callPrograms.includes(callM[1])) m.callPrograms.push(callM[1]);
      }
      // Rastreia MOVE e SET para resolver valores de host vars no WHERE
      if (/^MOVE\s/.test(labelU)) {
        var mvM = labelU.replace(/\.$/, '').match(/^MOVE\s+(.+?)\s+TO\s+(.+)$/);
        if (mvM) {
          var mvSrc = mvM[1].trim();
          mvM[2].trim().split(/\s+/).forEach(function(dest) {
            dest = dest.replace(/\.$/, '');
            if (/^[A-Z][A-Z0-9-]*$/.test(dest)) m.varMoves.push({ src: mvSrc, dest: dest });
          });
        }
      }
      if (/^SET\s/.test(labelU)) {
        var setM = labelU.replace(/\.$/, '').match(/^SET\s+(.+?)\s+TO\s+(TRUE|FALSE)$/);
        if (setM) {
          setM[1].trim().split(/\s+/).forEach(function(name88) {
            m.varMoves.push({ src: '__88__' + setM[2], dest: name88 });
          });
        }
      }
      // Encerramento anormal
      if (/\bABEND(?:AR)?\b|\bCEE3ABD\b|\bABNORMAL\b|\bROTINA-(?:ERRO|ABEND)\b|\bFIM-(?:ABEND|ERRO)\b|\bENCERRA-(?:ERRO|ABEND)\b|\bFINALIZAR-(?:ERRO|ABEND)\b/.test(labelU)) {
        m.abend = true;
        m.stopNodeId = nodeId;
        m.stopLabel  = labelU;
        _fakeSimFinalizePath(nodeSeq, branches, m, paths);
        continue;
      }

      // ── Fim do caminho ────────────────────────────────────────────
      if (tipo === 'stop' || tipo === 'goback') {
        m.stopNodeId = nodeId;
        m.stopLabel  = labelU;
        _fakeSimFinalizePath(nodeSeq, branches, m, paths);
        continue;
      }

      var nexts = _simNextNodes(nodeId);
      if (nexts.length === 0) {
        m.stopNodeId = nodeId;
        m.stopLabel  = labelU;
        _fakeSimFinalizePath(nodeSeq, branches, m, paths);
        continue;
      }

      // ── LOOP ──────────────────────────────────────────────────────
      if (tipo === 'loop') {
        var loopBody = null, loopExit = null;
        node.outgoers('edge').forEach(function (e) {
          var lbl = (e.data('label') || '').toUpperCase();
          if      (lbl === 'LOOP') loopBody = e.target();
          else if (lbl === 'FIM')  {
            loopExit = e.target();
            if (loopExit && loopExit.data('tipo') === 'merge') {
              var mn = _simNextNodes(loopExit.id());
              if (mn.length > 0) loopExit = mn[0];
            }
          }
        });
        if (!loopBody && nexts.length > 0) loopBody = nexts[0];
        if (!loopExit && nexts.length > 1) loopExit = nexts[1];
        var newVL = new Set(visitedLoops);
        newVL.add(nodeId);
        // Empurra loopExit antes para que loopBody seja processado primeiro (LIFO)
        if (loopExit) {
          var mNL = _fsCloneMeta(m);
          mNL.narrative.push('Sai do loop imediatamente: ' + label.substring(0, 40));
          stack.push({ nodeId: loopExit.id(), visitedLoops: newVL, branches: branches, nodeSeq: nodeSeq, depth: depth + 1, meta: mNL });
        }
        if (loopBody && !visitedLoops.has(nodeId)) {
          var mL = _fsCloneMeta(m);
          mL.enteredLoop = true;
          mL.narrative.push('Entra no loop: ' + label.substring(0, 50));
          stack.push({ nodeId: loopBody.id(), visitedLoops: newVL, branches: branches, nodeSeq: nodeSeq, depth: depth + 1, meta: mL });
        }
        continue;
      }

      // ── IF / EVALUATE ─────────────────────────────────────────────
      if ((tipo === 'if' || tipo === 'evaluate') && nexts.length > 1) {
        nexts.forEach(function (next) {
          if (paths.length >= MAX_PATHS) return;
          var edgeLbl  = _simEdgeLabel(nodeId, next.id());
          var edgeLblU = edgeLbl.toUpperCase().trim();
          var branch = {
            nodeId    : nodeId,
            condition : label,
            tipo      : tipo,
            chosenEdge: next.id(),
            edgeLabel : edgeLbl
          };
          var mB = _fsCloneMeta(m);
          if (edgeLblU === 'EOF' || edgeLblU === 'AT END' || edgeLblU === 'FIM DE ARQUIVO') {
            mB.hitEof = true;
            mB.narrative.push('Chega ao fim do arquivo (AT END): ' + label.substring(0, 45));
          } else if (edgeLblU === 'INVÁLIDA' || edgeLblU === 'INVALIDA' || edgeLblU === 'INVALID KEY') {
            mB.hitFileError = true;
            mB.narrative.push('Chave inválida no arquivo: ' + label.substring(0, 45));
          } else {
            var condU = label.toUpperCase();
            if (/\bST[-_]?\b|\bSTATUS\b|\b[A-Z][A-Z0-9-]*-ST\b/.test(condU)
                && (edgeLblU === 'SIM' || edgeLblU === 'TRUE')) {
              if (/[=\s]['"]?10['"]?\b/.test(condU)) {
                mB.hitEof = true;
              } else if (!/=[=\s]*['"]?00['"]?/.test(condU)) {
                mB.hitFileError = true;
              }
            }
            if (/SQLCODE|SQLERR|SQLSTATE/.test(condU)
                && (edgeLblU === 'SIM' || edgeLblU === 'TRUE')) {
              if (/[=\s]100\b/.test(condU)) {
                mB.hitSqlNotFound = true;
              } else if (!/=\s*0\b/.test(condU)) {
                mB.hitSqlError = true;
              }
            }
            if ((edgeLblU === 'SIM' || edgeLblU === 'TRUE' || edgeLblU === 'VERDADEIRO') &&
                /\b(?:IS\s+)?NOT\s+(?:NUMERIC|ALPHABETIC(?:-LOWER|-UPPER)?|ALPHA|ZEROS?|ZEROES?|SPACES?)/.test(condU)) {
              mB.hasClassFailure = true;
            }
            mB.narrative.push(
              (tipo === 'if' ? 'IF ' : 'EVALUATE ') + label.substring(0, 50) + ' → ' + (edgeLbl || '?')
            );
          }
          var nextTarget = next;
          if (nextTarget.data('tipo') === 'merge') {
            var mns = _simNextNodes(next.id());
            if (mns.length > 0) nextTarget = mns[0]; else return;
          }
          stack.push({ nodeId: nextTarget.id(), visitedLoops: visitedLoops, branches: branches.concat([branch]), nodeSeq: nodeSeq, depth: depth + 1, meta: mB });
        });
        continue;
      }

      // ── Nó único ──────────────────────────────────────────────────
      stack.push({ nodeId: nexts[0].id(), visitedLoops: visitedLoops, branches: branches, nodeSeq: nodeSeq, depth: depth + 1, meta: m });
    }

    onProgress(paths.length, stack.length);

    if (stack.length > 0 && paths.length < MAX_PATHS) {
      setTimeout(tick, 0); // cede o event loop e continua no próximo tick
    } else {
      _fakeSimPostProcess(paths);
      onDone(paths);
    }
  }

  setTimeout(tick, 0);
}

// ── Pós-processamento extraído: marca saídas antecipadas ──────────
function _fakeSimPostProcess(paths) {
  var stopCounts = {};
  paths.forEach(function(p) {
    var sid = p.meta.stopNodeId;
    if (sid) stopCounts[sid] = (stopCounts[sid] || 0) + 1;
  });
  var stopIds = Object.keys(stopCounts);
  if (stopIds.length > 1) {
    var primaryStop = null;
    var maxScore = -1;
    stopIds.forEach(function(sid) {
      var procCount = paths.filter(function(p) {
        return p.meta.stopNodeId === sid &&
               (p.meta.readFiles.length || p.meta.writtenFiles.length || p.meta.sqlOps.length);
      }).length;
      var score = procCount * 10000 + (stopCounts[sid] || 0);
      if (score > maxScore) { maxScore = score; primaryStop = sid; }
    });
    if (!primaryStop) {
      primaryStop = stopIds.sort(function(a,b){ return stopCounts[b]-stopCounts[a]; })[0];
    }
    paths.forEach(function(p) {
      if (p.meta.stopNodeId && p.meta.stopNodeId !== primaryStop && !p.meta.abend) {
        if (p.categories.indexOf('saida-antecipada') < 0) {
          p.categories.push('saida-antecipada');
        }
        p.categories = p.categories.filter(function(c){ return c !== 'normal' && c !== 'straight'; });
        if (p.categories.length === 0) p.categories.push('saida-antecipada');
      }
    });
  }
}

function _fsCloneMeta(m) {
  var modesClone = {};
  Object.keys(m.fileOpenModes || {}).forEach(function(k){ modesClone[k] = m.fileOpenModes[k]; });
  return {
    categories  : m.categories.slice(),
    openedFiles : m.openedFiles.slice(),
    readFiles   : m.readFiles.slice(),
    writtenFiles: m.writtenFiles.slice(),
    sqlOps      : m.sqlOps.slice(),
    callPrograms: m.callPrograms.slice(),
    narrative   : m.narrative.slice(),
    fileOpenModes  : modesClone,
    varMoves       : m.varMoves.slice(),
    sortFiles      : (m.sortFiles || []).slice(),
    tableSearches  : (m.tableSearches || []).slice(),
    stopNodeId     : m.stopNodeId,
    stopLabel      : m.stopLabel,
    abend          : m.abend,
    truncated      : m.truncated || false,
    enteredLoop    : m.enteredLoop,
    hitEof         : m.hitEof,
    hitFileError   : m.hitFileError,
    hitSqlError    : m.hitSqlError,
    hitSqlNotFound : m.hitSqlNotFound,
    hasClassFailure: m.hasClassFailure
  };
}

function _fakeSimFinalizePath(nodeSeq, branches, meta, paths) {
  var cats = [];
  if (meta.abend)              cats.push('abend');
  if (meta.truncated)          cats.push('truncado');
  if (meta.hitEof)             cats.push('file-eof');
  if (meta.hitFileError)       cats.push('file-error');
  if (meta.hitSqlError)        cats.push('sql-error');
  if (meta.hitSqlNotFound)     cats.push('sql-notfound');
  // Parada por erro: programa termina via STOP RUN mas motivado por erro de arquivo/SQL (não ABEND)
  if (!meta.abend && (meta.hitFileError || meta.hitSqlError)) cats.push('parada-erro');
  if (meta.readFiles.length)   cats.push('file-read');
  if (meta.writtenFiles.length)cats.push('file-write');
  if (meta.sqlOps.length)      cats.push('sql');
  if (meta.callPrograms.length)cats.push('call');
  if (meta.enteredLoop)        cats.push('loop');
  // Retorno por validação: campo não numérico/alfabético sem processamento real
  if (meta.hasClassFailure &&
      !meta.readFiles.length && !meta.writtenFiles.length &&
      !meta.sqlOps.length && !meta.callPrograms.length &&
      !meta.enteredLoop && !meta.abend &&
      !meta.hitEof && !meta.hitFileError && !meta.hitSqlError && !meta.hitSqlNotFound) {
    cats.push('validacao');
  }
  if (cats.length === 0) cats.push(branches.length === 0 ? 'straight' : 'normal');
  paths.push({ id: paths.length + 1, branches: branches, nodes: nodeSeq, categories: cats, meta: meta });
}

// ── Geração de variáveis EXATAS ───────────────────────────────────
//  Para cada desvio (IF/EVALUATE) do caminho, calcula o valor que
//  a variável precisa ter para que AQUELE ramo seja tomado.
function _fakeSimGenerateVarsForPath(path) {
  // Partimos dos defaults de DATA DIVISION
  var vars = {};
  _simVarDefs.forEach(function (v) {
    if (!v.isGroup && !v.is88) {
      vars[v.name] = (v.value !== null && v.value !== undefined) ? v.value : (v.picType === '9' ? '0' : '');
    }
  });

  path.branches.forEach(function (b) {
    var edgeLblU = (b.edgeLabel || '').toUpperCase().trim();
    var isSim    = ['SIM','EOF','INVALIDA','INVÁLIDA','TRUE','VERDADEIRO','AT END'].indexOf(edgeLblU) >= 0;
    var isEof    = edgeLblU === 'EOF' || edgeLblU === 'AT END' || edgeLblU === 'FIM DE ARQUIVO';
    var isInvKey = edgeLblU === 'INVALIDA' || edgeLblU === 'INVÁLIDA' || edgeLblU === 'INVALID KEY';

    if (b.tipo === 'if') {
      var rawCond = (b.condition || '').replace(/^IF\s+/i, '').trim();
      var condU   = rawCond.toUpperCase();

      // Ramo AT END / EOF: ajusta file status
      if (isEof) {
        var fsEof = _fsFindFsVarInCond(condU);
        if (fsEof) vars[fsEof] = '10'; else {
          // Seta todos os file status conhecidos
          Object.values(_simFileStatusMap || {}).forEach(function (sv) { if (sv && vars.hasOwnProperty(sv)) vars[sv] = '10'; });
        }
        return;
      }
      // INVALID KEY: file status = '23'
      if (isInvKey) {
        var fsInv = _fsFindFsVarInCond(condU);
        if (fsInv) vars[fsInv] = '23';
        return;
      }

      var negated  = /^NOT\s+/.test(condU);
      var cleanU   = negated ? condU.replace(/^NOT\s+/, '') : condU;
      var wantTrue = isSim ? !negated : negated; // wantTrue = a condição precisa ser verdadeira

      // ── Level 88 simples ─────────────────────────────────────
      var m88 = cleanU.match(/^([A-Z][A-Z0-9-]*)$/);
      if (m88) {
        var def88 = _simVarDefs.find(function (d) { return d.is88 && d.name === m88[1]; });
        if (def88 && def88.parentName) {
          if (wantTrue) {
            vars[def88.parentName] = def88.values[0] || 'S';
          } else {
            var parentDef = _simVarDefs.find(function (d) { return d.name === def88.parentName && !d.isGroup; });
            vars[def88.parentName] = _fsOtherValue88(def88.values, parentDef);
          }
          return;
        }
      }

      // ── Condição de classe: NUMERIC / ALPHABETIC / ZEROS / SPACES ────
      //  Formas: "varname NUMERIC", "varname NOT NUMERIC", etc.
      //  (o NOT aqui está DENTRO da expressão, não no início — lida por classM[2])
      var classM = cleanU.match(
        /^([A-Z][A-Z0-9-]*)\s+(?:IS\s+)?(NOT\s+)?(NUMERIC|ALPHABETIC(?:-LOWER|-UPPER)?|ALPHA|ZEROS?|ZEROES?|SPACES?|HIGH-VALUES?|LOW-VALUES?)$/
      );
      if (classM) {
        var varCls    = classM[1].trim();
        var notCls    = !!classM[2];            // tem NOT antes da classe?
        var clsKw     = classM[3].replace(/-LOWER$|-UPPER$/,'').toUpperCase();
        var vdefCls   = _simVarDefs.find(function(d){ return d.name === varCls && !d.isGroup; });
        // needTrue = a classe BASE (sem o NOT) precisa ser verdadeira?
        // Equivale a wantTrue XOR notCls
        var needTrue  = wantTrue ? !notCls : notCls;
        if (vdefCls) {
          var len = vdefCls.len || 3;
          if (clsKw === 'NUMERIC') {
            // needTrue → variável precisa ter valor NUMÉRICO (apenas dígitos)
            vars[varCls] = needTrue
              ? _fsNumStr(0, vdefCls)                          // ex.: '000'
              : 'ABC'.substring(0, Math.max(1, len));         // ex.: 'ABC'
          } else if (clsKw === 'ALPHABETIC' || clsKw === 'ALPHA') {
            vars[varCls] = needTrue
              ? 'ABCD'.substring(0, Math.max(1, len))
              : _fsNumStr(1, vdefCls);                         // ex.: '001'
          } else if (/^ZEROS?$|^ZEROES?$/.test(clsKw)) {
            vars[varCls] = needTrue
              ? (vdefCls.picType === '9' ? _fsNumStr(0, vdefCls) : '0'.repeat(Math.max(1, len)))
              : (vdefCls.picType === '9' ? _fsNumStr(1, vdefCls) : '1'.padEnd(len, ' '));
          } else if (/^SPACES?$/.test(clsKw)) {
            vars[varCls] = needTrue
              ? ' '.repeat(Math.max(1, len))
              : 'X'.padEnd(len, ' ');
          }
        }
        return;
      }

      // ── VAR operador VALUE ───────────────────────────────────
      var opM = cleanU.match(
        /^([A-Z][A-Z0-9-]*)\s*(NOT\s+EQUAL(?:\s+TO)?|NOT\s+GREATER|NOT\s+LESS|NOT\s*=|NOT\s*>|NOT\s*<|>=|<=|>|<|=|EQUAL(?:\s+TO)?|GREATER(?:\s+THAN)?(?:\s+OR\s+EQUAL(?:\s+TO)?)?|LESS(?:\s+THAN)?(?:\s+OR\s+EQUAL(?:\s+TO)?)?)\s*(.+)$/
      );
      if (opM) {
        var varN   = opM[1].trim();
        var op     = opM[2].trim();
        var rhsRaw = opM[3].trim().replace(/\.$/, '');
        // Resolve literal ou variável
        var rhs = rhsRaw.replace(/^['"]|['"]$/g, '');
        var rhsAsVar = _simVarDefs.find(function (d) { return d.name === rhs && !d.isGroup; });
        if (rhsAsVar) rhs = vars[rhs] !== undefined ? vars[rhs] : rhs;
        var vdef   = _simVarDefs.find(function (d) { return d.name === varN && !d.isGroup; });
        var rhsNum = parseFloat(rhs);
        var opNot  = /^NOT/.test(op);

        if (vdef) {
          if (wantTrue) {
            if (/^(=|EQUAL)/i.test(op) && !opNot)                   vars[varN] = rhs;
            else if (/^(NOT\s*=|NOT\s+EQUAL)/i.test(op))            vars[varN] = _fsOtherStr(vdef, rhs);
            else if (/GREATER.*OR|>=/i.test(op) && !isNaN(rhsNum))  vars[varN] = _fsNumStr(rhsNum,     vdef);
            else if (/^(>|GREATER[^O])/i.test(op) && !isNaN(rhsNum))vars[varN] = _fsNumStr(rhsNum + 1, vdef);
            else if (/LESS.*OR|<=/i.test(op) && !isNaN(rhsNum))     vars[varN] = _fsNumStr(rhsNum,     vdef);
            else if (/^(<|LESS[^O])/i.test(op) && !isNaN(rhsNum))   vars[varN] = _fsNumStr(rhsNum - 1, vdef);
            else vars[varN] = rhs;
          } else {
            if (/^(=|EQUAL)/i.test(op) && !opNot)                   vars[varN] = _fsOtherStr(vdef, rhs);
            else if (/^(NOT\s*=|NOT\s+EQUAL)/i.test(op))            vars[varN] = rhs;
            else if (/^(>|GREATER)/i.test(op) && !isNaN(rhsNum))    vars[varN] = _fsNumStr(rhsNum,     vdef);
            else if (/^(<|LESS)/i.test(op) && !isNaN(rhsNum))       vars[varN] = _fsNumStr(rhsNum,     vdef);
            else vars[varN] = rhs;
          }
        } else {
          // Variável não encontrada em _simVarDefs (p.ex.: de COPY não expandido)
          // Assign mínimo para que apareça no painel de variáveis
          if (wantTrue) vars[varN] = rhs;
          else if (/^(=|EQUAL)/i.test(op) && !opNot) vars[varN] = (rhs === '' ? 'N' : (rhs === 'N' ? 'S' : 'N'));
          else vars[varN] = rhs;
        }
        return;
      }

      // ── Variável sozinha (IF WS-FLAG) ────────────────────────
      var vSolo = cleanU.match(/^([A-Z][A-Z0-9-]*)$/);
      if (vSolo) {
        var vdSolo = _simVarDefs.find(function (d) { return d.name === vSolo[1] && !d.isGroup; });
        if (vdSolo) {
          vars[vSolo[1]] = wantTrue
            ? (vdSolo.picType === '9' ? '1' : 'S')
            : (vdSolo.picType === '9' ? '0' : ' ');
        } else {
          // Variável não encontrada (COPY) — valor sintético
          vars[vSolo[1]] = wantTrue ? 'S' : 'N';
        }
      }

    } else if (b.tipo === 'evaluate') {
      var evalSubj = (b.condition || '').replace(/^EVALUATE\s+/i, '').trim().toUpperCase();
      if (evalSubj === 'TRUE' || !evalSubj) {
        // EVALUATE TRUE WHEN <level88-name> — resolve pai e seta valor
        var when88Raw = (b.edgeLabel || '').trim().toUpperCase();
        if (when88Raw && when88Raw !== 'OTHER' && when88Raw !== 'OUTRO') {
          var negated88 = /^NOT\s+/.test(when88Raw);
          var when88Name = negated88 ? when88Raw.replace(/^NOT\s+/, '') : when88Raw;
          var def88ev = _simVarDefs.find(function (d) { return d.is88 && d.name === when88Name; });
          if (def88ev && def88ev.parentName) {
            if (!negated88) {
              vars[def88ev.parentName] = def88ev.values[0] || 'S';
            } else {
              var parentDef88 = _simVarDefs.find(function (d) { return d.name === def88ev.parentName && !d.isGroup; });
              vars[def88ev.parentName] = _fsOtherValue88(def88ev.values, parentDef88);
            }
          }
        }
      } else if (evalSubj) {
        var vdefEv = _simVarDefs.find(function (d) { return d.name === evalSubj && !d.isGroup; });
        if (vdefEv && b.edgeLabel && edgeLblU !== 'OTHER' && edgeLblU !== 'OUTRO') {
          var whenVal = (b.edgeLabel || '').trim().replace(/^['"]|['"]$/g, '');
          // THRU → usa o menor valor do intervalo
          var thruM = whenVal.match(/^(.+?)\s+(?:THRU|THROUGH)\s+/i);
          if (thruM) whenVal = thruM[1].trim().replace(/^['"]|['"]$/g, '');
          vars[evalSubj] = whenVal;
        }
      }
    }
  });

  // Pós-processamento: garante FILE STATUS correto pelo caminho
  if (path.meta.hitEof) {
    Object.values(_simFileStatusMap || {}).forEach(function (sv) {
      if (sv && vars.hasOwnProperty(sv) && (vars[sv] === '' || vars[sv] === '00')) vars[sv] = '10';
    });
  }
  if (path.meta.hitFileError) {
    Object.values(_simFileStatusMap || {}).forEach(function (sv) {
      if (sv && vars.hasOwnProperty(sv) && (vars[sv] === '' || vars[sv] === '00')) vars[sv] = '23';
    });
  }
  if (path.meta.hitSqlError && vars.hasOwnProperty('SQLCODE') && (vars['SQLCODE'] === '' || vars['SQLCODE'] === '0'))
    vars['SQLCODE'] = '-1';

  return vars;
}

// ── Helpers de valor ──────────────────────────────────────────────
function _fsFindFsVarInCond(condU) {
  var found = null;
  Object.values(_simFileStatusMap || {}).forEach(function (sv) {
    if (sv && condU.indexOf(sv) >= 0) found = sv;
  });
  return found;
}

function _fsOtherValue88(values, vdef) {
  var cands = vdef && vdef.picType === '9' ? ['0','1','2','3','9'] : ['N','X','Z','A','0'];
  for (var i = 0; i < cands.length; i++) if (!values.includes(cands[i])) return cands[i];
  return 'N';
}

function _fsOtherStr(vdef, cur) {
  if (!vdef) return cur === 'N' ? 'S' : 'N';
  if (vdef.picType === '9') {
    var n = parseFloat(cur);
    return isNaN(n) ? '999' : String(n + 99);
  }
  if (cur === 'S') return 'N';
  if (cur === '00' || cur === '0') return '99';
  return cur.length > 0 ? (cur[0] === 'X' ? 'Y' : 'X') : 'X';
}

function _fsNumStr(n, vdef) {
  n = isNaN(n) ? 0 : Math.max(0, Math.floor(n));
  var s = String(n);
  if (vdef && vdef.pic) {
    var lm = vdef.pic.match(/\((\d+)\)/);
    var len = lm ? parseInt(lm[1]) : (vdef.len || 4);
    while (s.length < len) s = '0' + s;
  }
  return s;
}

function _fsEsc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Narrativa legível ────────────────────────────────────────────
function _fakeSimBuildStory(path) {
  var m = path.meta;
  var p = [];
  var cats = path.categories;
  var isEarlyExit = cats.indexOf('saida-antecipada') >= 0;

  var isParadaErro = cats.indexOf('parada-erro') >= 0;

  if (m.truncated) {
    p.push('⚠️ <b>Caminho incompleto</b> — o programa é grande demais para exploração completa. As operações abaixo foram encontradas até o ponto de corte.');
  } else if (m.abend) {
    p.push('💥 Termina em <b>ABEND — encerramento anormal explícito</b> (ABEND/ABENDAR/CEE3ABD ou rotina de abort chamada pelo programa).');
  } else if (isParadaErro && isEarlyExit) {
    var errTipo = m.hitFileError ? 'status de arquivo ≠ \'00\'' : 'SQLCODE ≠ 0';
    p.push('🛑 <b>Parada antecipada por erro no programa</b> — ' + errTipo + ' levou o programa a encerrar antes do fluxo principal. Não é ABEND, mas também não é saída normal.');
  } else if (isParadaErro) {
    var errTipo2 = m.hitFileError && m.hitSqlError ? 'erro de arquivo e SQL' : m.hitFileError ? 'erro de arquivo (status ≠ \'00\')' : 'erro SQL (SQLCODE ≠ 0)';
    p.push('🛑 <b>Parada por erro no programa</b> — o programa encerrou via STOP RUN após detectar ' + errTipo2 + '. Não é crash (ABEND), mas é uma saída motivada por falha.');
  } else if (isEarlyExit && m.hasClassFailure) {
    p.push('⚡ <b>Saída antecipada por validação</b> — dado inválido (p.ex.: não numérico) leva a STOP RUN antes do fim principal.');
  } else if (isEarlyExit) {
    p.push('⚡ <b>Saída antecipada</b> — o programa termina em um STOP RUN que não é o encerramento principal do fluxo feliz.');
  } else if (m.hasClassFailure && !m.readFiles.length && !m.writtenFiles.length && !m.sqlOps.length) {
    p.push('🔎 <b>Retorno antecipado por validação</b> — campo com dado inválido (p.ex.: não numérico) provoca saída imediata sem processar.');
  } else if (m.hitFileError) {
    p.push('🚫 <b>Caminho de erro de arquivo</b> — status ≠ \'00\' e ≠ \'10\' indica falha real de I/O.');
  } else if (m.hitSqlError) {
    p.push('💢 <b>Caminho de erro SQL</b> — SQLCODE ≠ 0 e ≠ 100 indica falha real no banco de dados.');
  } else if (m.hitEof && !m.writtenFiles.length && !m.sqlOps.length) {
    p.push('📭 <b>Sem dados no arquivo</b> — status \'10\' (AT END) sem processamento real: comportamento esperado quando o arquivo está vazio.');
  } else if (m.hitSqlNotFound && !m.writtenFiles.length && !m.readFiles.length) {
    p.push('🔍 <b>Sem dados no banco</b> — SQLCODE=100 (NOT FOUND) sem processamento real: comportamento esperado quando não há registros.');
  } else if (m.writtenFiles.length || m.readFiles.length || m.sqlOps.length) {
    p.push('✅ <b>Caminho de processamento principal</b> — termina normalmente (STOP RUN / GOBACK).');
  } else {
    p.push('O programa termina <b>normalmente</b> (STOP RUN / GOBACK).');
  }
  if (m.openedFiles.length)  p.push('Abre: <b>' + m.openedFiles.join(', ') + '</b>.');
  if (m.readFiles.length)    p.push('Lê de: <b>' + m.readFiles.join(', ') + '</b>.');
  if (m.writtenFiles.length) p.push('Grava em: <b>' + m.writtenFiles.join(', ') + '</b>.');
  if (m.hitEof)              p.push('📭 Atinge <b>fim de arquivo</b> (AT END) — status \'10\'.');
  if (m.hitFileError)        p.push('🚫 Ocorre <b>erro de arquivo</b> — status ≠ \'00\' e ≠ \'10\'.');
  if (m.sqlOps.length)       p.push('🛢 Executa SQL: <i>' + m.sqlOps[0].substring(0,60) + (m.sqlOps.length > 1 ? ' …' : '') + '</i>');
  if (m.hitSqlError)         p.push('💢 Ocorre <b>erro SQL</b> — SQLCODE ≠ 0 e ≠ 100.');
  if (m.hitSqlNotFound)      p.push('🔍 DB2 retorna <b>SQLCODE=100</b> (NOT FOUND) — sem registros no banco.');
  if (m.callPrograms.length) p.push('📞 Chama: <b>' + m.callPrograms.join(', ') + '</b>.');
  if (m.enteredLoop)         p.push('🔁 Executa pelo menos <b>1 iteração</b> de loop.');
  if (path.branches.length === 0) p.push('Caminho <b>linear</b> sem desvios condicionais.');
  else                            p.push(path.branches.length + ' desvio(s) condicional(is).');
  return p.join(' ');
}

// ── Barra de filtros ─────────────────────────────────────────────
function _fakeSimRenderFilterBar() {
  var bar = document.getElementById('fake-sim-filter-bar');
  if (!bar) return;
  var counts = { all: _fakeSimPaths.length };
  _fakeSimPaths.forEach(function (p) {
    p.categories.forEach(function (c) { counts[c] = (counts[c] || 0) + 1; });
  });
  var chips = [{ key:'all', label:'Todos', icon:'🔍', color:'#9ca3af' }];
  Object.keys(_FS_CATEGORIES).forEach(function (k) {
    if (counts[k]) chips.push({ key:k, label:_FS_CATEGORIES[k].label, icon:_FS_CATEGORIES[k].icon, color:_FS_CATEGORIES[k].color });
  });
  bar.innerHTML = chips.map(function (c) {
    return '<button class="fs-chip' + (c.key === _fakeSimActiveFilter ? ' active' : '') + '"'
      + ' style="--chip-color:' + c.color + '"'
      + ' onclick="_fakeSimSetFilter(\'' + c.key + '\')">'
      + c.icon + '&nbsp;' + _fsEsc(c.label)
      + ' <span class="fs-chip-count">' + (counts[c.key] || 0) + '</span>'
      + '</button>';
  }).join('');
}

function _fakeSimSetFilter(cat) {
  _fakeSimActiveFilter = cat;
  document.querySelectorAll('.fs-chip').forEach(function (el) {
    var onc = el.getAttribute('onclick') || '';
    el.classList.toggle('active', onc.indexOf("'" + cat + "'") >= 0);
  });
  _fakeSimRenderPathList();
}

// ── Lista de caminhos ─────────────────────────────────────────────
// Retorna a categoria mais importante de um caminho para fins de cor de destaque
function _fsMostImportantCat(cats) {
  var priority = ['abend','parada-erro','file-error','sql-error','saida-antecipada','validacao','sql-notfound','file-eof','file-write','file-read','sql','call','loop','normal','straight'];
  for (var i = 0; i < priority.length; i++) {
    if (cats.indexOf(priority[i]) >= 0) return priority[i];
  }
  return cats[0] || 'normal';
}

function _fakeSimRenderPathList() {
  var list    = document.getElementById('fake-sim-paths-list');
  var countEl = document.getElementById('fake-sim-path-count');
  var filtered = _fakeSimActiveFilter === 'all'
    ? _fakeSimPaths
    : _fakeSimPaths.filter(function (p) { return p.categories.indexOf(_fakeSimActiveFilter) >= 0; });

  if (countEl) countEl.textContent = filtered.length + ' de ' + _fakeSimPaths.length + ' caminho(s)';

  if (!filtered.length) {
    list.innerHTML = '<div class="fake-sim-empty">Nenhum caminho nesta categoria.</div>';
    return;
  }

  list.innerHTML = '';
  filtered.forEach(function (path) {
    var div = document.createElement('div');
    div.className = 'fake-sim-path-item';
    div.dataset.pathId = path.id;
    // Cor de borda esquerda reflete a categoria principal do caminho
    var mainCat   = _fsMostImportantCat(path.categories);
    var accentClr = (_FS_CATEGORIES[mainCat] || {}).color || '#2a2a40';
    div.style.setProperty('--card-accent', accentClr);

    var catBadges = path.categories.map(function (c) {
      var ci = _FS_CATEGORIES[c];
      if (!ci) return '';
      return '<span class="fs-cat-badge" style="border-color:' + ci.color + ';color:' + ci.color + '">'
           + ci.icon + '&nbsp;' + ci.label + '</span>';
    }).join('');

    var branchTags = path.branches.length === 0
      ? '<span class="fake-sim-tag direct">Caminho linear</span>'
      : path.branches.slice(0, 5).map(function (b) {
          var cond = (b.condition || '').replace(/^IF\s+/i,'').replace(/^EVALUATE\s+/i,'').replace(/\r?\n/g,' ').substring(0, 34);
          var lbl  = (b.edgeLabel || '?').substring(0, 12);
          var lu   = lbl.toUpperCase();
          var condFull = (b.condition || '').toUpperCase();
          var cls;
          if (lu === 'NÃO' || lu === 'NAO' || lu === 'FALSE') {
            cls = 'no';
          } else if (lu === 'SIM' || lu === 'EOF' || lu === 'TRUE' || lu === 'AT END') {
            // NOT NUMERIC / NOT ALPHABETIC → SIM = dado inválido: usar warn (âmbar) em vez de verde
            cls = /\bNOT\s+(NUMERIC|ALPHABETIC|ALPHA|EQUAL|ZERO|ZEROS|SPACE|SPACES)\b/.test(condFull) ? 'warn' : 'yes';
          } else {
            cls = 'other';
          }
          return '<span class="fake-sim-tag ' + cls + '">' + _fsEsc(cond) + ' <b>→ ' + _fsEsc(lbl) + '</b></span>';
        }).join('') + (path.branches.length > 5 ? '<span class="fake-sim-tag">+' + (path.branches.length - 5) + '</span>' : '');

    div.innerHTML =
      '<div class="fake-sim-path-hdr">'
        + '<span class="fake-sim-path-num">Caminho&nbsp;' + path.id + '</span>'
        + '<span class="fake-sim-path-stats">' + path.nodes.length + ' nós &middot; ' + path.branches.length + ' desvio(s)</span>'
      + '</div>'
      + '<div class="fake-sim-path-cats">' + catBadges + '</div>'
      + '<div class="fake-sim-path-branches">' + branchTags + '</div>';

    div.onclick = function () {
      document.querySelectorAll('.fake-sim-path-item.selected').forEach(function (el) { el.classList.remove('selected'); });
      div.classList.add('selected');
      _fakeSimSelectedPath = path;
      _fakeSimRenderDetail(path);
    };
    list.appendChild(div);
  });

  if (list.firstChild) list.firstChild.click();
}

// ── Painel direito: detalhe completo ─────────────────────────────
function _fakeSimRenderDetail(path) {
  var preview = document.getElementById('fake-sim-vars-preview');
  if (!preview) return;

  var vars = _fakeSimGenerateVarsForPath(path);

  // Quais variáveis são chave (determinam os desvios)?
  var keyNames = new Set();
  path.branches.forEach(function (b) {
    var condU = (b.condition || '').replace(/^IF\s+/i,'').replace(/^EVALUATE\s+/i,'').toUpperCase();
    var mOp = condU.match(/^(?:NOT\s+)?([A-Z][A-Z0-9-]*)/);
    if (mOp) keyNames.add(mOp[1]);
    // Pai de level 88
    var m88 = condU.match(/^(?:NOT\s+)?([A-Z][A-Z0-9-]*)$/);
    if (m88) {
      var def88 = _simVarDefs.find(function (d) { return d.is88 && d.name === m88[1]; });
      if (def88 && def88.parentName) keyNames.add(def88.parentName);
    }
  });
  Object.values(_simFileStatusMap || {}).forEach(function (sv) { if (sv && vars.hasOwnProperty(sv)) keyNames.add(sv); });
  if (path.meta.sqlOps.length && vars.hasOwnProperty('SQLCODE')) keyNames.add('SQLCODE');

  // Linhas da tabela: apenas variáveis-chave ou que mudaram em relação ao default
  var rows = [];
  _simVarDefs.forEach(function (v) {
    if (!v.isGroup && !v.is88 && vars.hasOwnProperty(v.name)) {
      var defV    = (v.value !== null && v.value !== undefined) ? v.value : (v.picType === '9' ? '0' : '');
      var isKey   = keyNames.has(v.name);
      var changed = vars[v.name] !== defV;
      if (isKey || changed) {
        rows.push({ name: v.name, val: vars[v.name], defVal: defV, pic: v.pic || (v.picType === '9' ? '9' : 'X'), section: v.section || '-', isKey, changed });
      }
    }
  });

  // Inclui variáveis de COPY não expandido: estão em keyNames e em vars mas não em _simVarDefs
  var _simVarNames = new Set(_simVarDefs.map(function(v){ return v.name; }));
  keyNames.forEach(function(kn) {
    if (!_simVarNames.has(kn) && vars.hasOwnProperty(kn) && !rows.some(function(r){ return r.name === kn; })) {
      rows.push({ name: kn, val: vars[kn], defVal: '?', pic: '?', section: '(COPY)', isKey: true, changed: false });
    }
  });

  var cobolCode = rows
    .filter(function (r) { return r.isKey || r.changed; })
    .map(function (r) {
      var vd = _simVarDefs.find(function (d) { return d.name === r.name && !d.isGroup; });
      var isAlpha = !vd || vd.picType !== '9';
      var val = r.val === '' ? ' ' : r.val;
      return '           MOVE ' + (isAlpha ? "'" + val + "'" : val) + ' TO ' + r.name + '.';
    }).join('\n');

  var tableHtml = rows.length === 0
    ? '<div class="fake-sim-vars-note">✓ Nenhuma variável precisa ser ajustada — use os valores padrão do programa.</div>'
    : '<table class="fake-sim-vars-table">'
      + '<thead><tr><th></th><th>Variável</th><th>Valor necessário</th><th>Default</th><th>PIC</th><th>Seção</th></tr></thead>'
      + '<tbody>'
      + rows.map(function (r) {
          var rowCls = r.isKey ? 'fsk-key' : 'fsk-changed';
          var icon   = r.isKey ? '🔑' : '✏';
          return '<tr class="' + rowCls + '">'
            + '<td class="fsk-icon-col" title="' + (r.isKey ? 'Variável chave' : 'Modificada pelo caminho') + '">' + icon + '</td>'
            + '<td>' + _fsEsc(r.name) + '</td>'
            + '<td class="fake-sim-val-cell">' + _fsEsc(r.val === '' ? '(vazio)' : r.val) + '</td>'
            + '<td class="fsk-defval">' + _fsEsc(r.defVal === '' ? '(vazio)' : r.defVal) + '</td>'
            + '<td class="fake-sim-pic-cell">' + _fsEsc(r.pic) + '</td>'
            + '<td class="fake-sim-sec-cell">' + _fsEsc(r.section) + '</td>'
            + '</tr>';
        }).join('')
      + '</tbody></table>';

  preview.innerHTML =
    '<div class="fake-sim-story">' + _fakeSimBuildStory(path) + '</div>'
    + '<div class="fake-sim-vars-title"><span>🔑 = variável que determina o desvio&nbsp;&nbsp;✏ = alterada pelo caminho</span></div>'
    + tableHtml
    + (cobolCode
      ? '<div class="fake-sim-cobol-box">'
          + '<div class="fake-sim-cobol-hdr">💾 COBOL para ambiente real (cole no programa chamador):</div>'
          + '<pre class="fake-sim-cobol-pre">' + _fsEsc(cobolCode) + '</pre>'
        + '</div>'
      : '')
    + _fakeSimRenderDataPreview(path);
}

// ================================================================
//  GERAÇÃO DE DADOS FICTÍCIOS — Arquivos e Banco de Dados
// ================================================================

// Banco de valores plausíveis por padrão de nome de campo
var _FS_FAKE_POOL = {
  NOME    : ['JOAO SILVA','MARIA SOUZA','CARLOS PEREIRA','ANA LIMA','PAULO SANTOS'],
  NOMES   : ['JOAO SILVA','MARIA SOUZA','CARLOS PEREIRA','ANA LIMA','PAULO SANTOS'],
  CPF     : ['12345678901','98765432100','11122233344','55566677788','99988877766'],
  CNPJ    : ['12345678000190','98765432000100','11222333000181','55666777000112'],
  DATA    : ['20260412','20260101','20251231','20260315','20260601'],
  DT      : ['20260412','20260101','20251231','20260315','20260601'],
  DTVENC  : ['20260630','20270101','20261231'],
  DTNASC  : ['19800101','19750615','19921020','20000229','19650501'],
  SALDO   : ['0000000150000','0000001234567','0000000050000','0000002000000','0000000099900'],
  VALOR   : ['0000000150000','0000001234567','0000000050000','0000002000000'],
  VLR     : ['0000000150000','0000001234567','0000000050000'],
  SALARIO : ['0000003500000','0000005000000','0000001800000','0000012000000'],
  CEP     : ['01310100','04538133','30140071','80010020','69010010'],
  UF      : ['SP','RJ','MG','RS','BA'],
  ESTADO  : ['SP','RJ','MG','RS','BA'],
  CIDADE  : ['SAO PAULO','RIO DE JANEIRO','BELO HORIZONTE','PORTO ALEGRE'],
  CIDADE2 : ['CAMPINAS','CURITIBA','FORTALEZA','SALVADOR'],
  ENDERECO: ['RUA DAS FLORES 123','AV PAULISTA 1500','RUA BETA 77','AV BRASIL 2000'],
  CODIGO  : ['0001','0002','0003','0004','0005'],
  COD     : ['001','002','003','004','005'],
  CD      : ['001','002','003','004','005'],
  NUM     : ['00001','00002','00003','00004','00005'],
  NR      : ['00001','00002','00003','00004','00005'],
  SEQ     : ['000001','000002','000003','000004','000005'],
  NSQ     : ['000001','000002','000003','000004','000005'],
  AGENCIA : ['0001','0041','0237','1234','5678'],
  CONTA   : ['000012345','000067890','000098765','000011111'],
  PRODUTO : ['PROD-001','PROD-002','PROD-003','PROD-004','PROD-005'],
  TIPO    : ['D','C','H','T','01','02','03','A','B'],
  TP      : ['D','C','H','T','01','02','03','A','B'],
  STATUS  : ['A','I','P','A','A'],
  SIT     : ['A','I','P'],
  FLAG    : ['S','N','S','S','N'],
  IND     : ['S','N','S','S','N'],
  MENSAGEM: ['OK','PROCESSADO COM SUCESSO','ERRO GENERICO','NAO ENCONTRADO'],
  MSG     : ['OK','PROCESSADO','ERRO','N/A'],
  OBS     : ['OBSERVACAO TESTE 01','LIVRE 02','CAMPO LIVRE 03'],
  DESCR   : ['DESCRICAO DO ITEM 001','PRODUTO XPTO','SERVICO ALFA','ITEM BETA'],
  DESC    : ['DESCRICAO 001','PRODUTO 002','SERVICO 003'],
  NOME_EMP: ['EMPRESA ALPHA LTDA','EMPRESA BETA S/A','CIA GAMA COMERCIO'],
  QTDE    : ['00010','00025','00003','00100','00001'],
  QTD     : ['00010','00025','00003','00100'],
  PERC    : ['00100','01500','03000','00050'],
  RATE    : ['00100','01500','03000','00050']
};

// Gera um valor fictício para um campo com base no nome e PIC.
// fdName (opcional) — restringe a busca em _simVarDefs ao FD correto.
function _fsGenFakeValue(fieldName, idx, fdName) {
  var fn  = fieldName.toUpperCase().replace(/^(?:WS|REG|FD|ARQ|TB|TAB|TBL|IN|OUT|CD|NR|DT|SW|FL|IND|WRK|AUX|CTR|CNT)-?/, '');
  fn = fn.replace(/-\d+$/, '').replace(/-[A-Z]$/, '');

  // Busca a definição PIC para formatar corretamente
  var vdefPic = null;
  if (fdName) {
    vdefPic = _simVarDefs.find(function(d){ return d.name === fieldName && !d.isGroup && d.fdName === fdName; });
  }
  if (!vdefPic) {
    vdefPic = _simVarDefs.find(function(d){ return d.name === fieldName && !d.isGroup; });
  }

  // FILLER: usa VALUE definido no COBOL em vez de valor fictício.
  // FILLER não pode ser referenciado por nome — usar seu VALUE definido é mais fiel ao programa real.
  // Se não há definição encontrada (ex: arquivo via book sem entry no FILE SECTION), retorna ''
  // (espaços, que é o valor mais comum para padding FILLER).
  if (fieldName === 'FILLER') {
    if (vdefPic) {
      var _fv = (vdefPic.value !== null && vdefPic.value !== undefined) ? String(vdefPic.value) : '';
      var _fl = vdefPic.len || 1;
      if (vdefPic.picType === '9') {
        _fv = _fv.replace(/\D/g, '') || '0';
        while (_fv.length < _fl) _fv = '0' + _fv;
        return _fv.slice(-_fl);
      }
      return (_fv + ' '.repeat(_fl)).slice(0, _fl).trimEnd();
    }
    return ''; // sem definição PIC → espaço (padding)
  }

  // Aplica o comprimento do PIC ao valor escolhido
  function _applyPic(raw) {
    if (!vdefPic) return raw;
    var len = vdefPic.len || raw.length || 5;
    if (vdefPic.picType === '9') {
      // Somente dígitos, preenchido com zeros à esquerda
      var digits = raw.replace(/\D/g, '') || '0';
      while (digits.length < len) digits = '0' + digits;
      return digits.substring(digits.length - len);
    } else {
      // Alfanumérico: trunca ou preenche com espaços à direita
      return (raw + ' '.repeat(len)).substring(0, len).trimEnd();
    }
  }

  var keys = Object.keys(_FS_FAKE_POOL);
  if (_FS_FAKE_POOL[fn]) {
    return _applyPic(_FS_FAKE_POOL[fn][idx % _FS_FAKE_POOL[fn].length]);
  }
  for (var i = 0; i < keys.length; i++) {
    if (fn.indexOf(keys[i]) >= 0 || (keys[i].length >= 4 && fn.indexOf(keys[i].substring(0, 4)) >= 0)) {
      return _applyPic(_FS_FAKE_POOL[keys[i]][idx % _FS_FAKE_POOL[keys[i]].length]);
    }
  }
  // Gera com base na definição
  if (vdefPic) {
    var len2 = vdefPic.len || 5;
    if (vdefPic.picType === '9') {
      var n = (idx + 1) * 7 + 100;
      var s = String(n);
      while (s.length < len2) s = '0' + s;
      return s.substring(s.length - len2);
    } else {
      var base = 'FICTICIO' + (idx + 1);
      return (base + ' '.repeat(len2)).substring(0, len2).trimEnd();
    }
  }
  return String(idx + 1).padStart(5, '0');
}

// Gera N registros fictícios para um FD de arquivo respeitando o layout/PIC
function _fakeSimGenFileRecords(fdName, howMany) {
  var fd = _simFiles[fdName];
  if (!fd) return [];
  var fields = (fd.bookId && typeof _simGetBookFields === 'function')
    ? (_simGetBookFields(fd.bookId) || fd.fields)
    : fd.fields;
  var recs = [];
  for (var i = 0; i < howMany; i++) {
    var rec = {};
    // Passa fdName para que _fsGenFakeValue possa restringir a busca de PIC
    fields.forEach(function(f) { rec[f] = _fsGenFakeValue(f, i, fdName); });
    recs.push(rec);
  }
  return recs;
}

// Gera N linhas fictícias para uma tabela DB2
function _fakeSimGenDb2Rows(tableName, howMany) {
  var tbl = _simDb2Tables[tableName];
  if (!tbl) return [];
  // Fallback: se colunas não foram identificadas (ex: SELECT *),
  // usa as variáveis do INTO da primeira selectMap como nomes de coluna
  if (!tbl.columns.length && tbl.selectMaps && tbl.selectMaps.length && tbl.selectMaps[0].into.length) {
    tbl.columns = tbl.selectMaps[0].into.slice();
  }
  if (!tbl.columns.length) return [];
  var rows = [];
  for (var i = 0; i < howMany; i++) {
    var row = {};
    tbl.columns.forEach(function(col) { row[col] = _fsGenFakeValue(col, i); });
    rows.push(row);
  }
  return rows;
}

// Classifica um arquivo do caminho: 'input', 'output', 'io' ou 'extend'
// Regra: usa o modo do OPEN detectado no DFS como fonte primária.
//   INPUT, I-O, EXTEND → arquivo pré-existente (tem registros)
//   OUTPUT             → arquivo vazio (programa cria/sobrescreve)
// Fallback: deriva de readFiles/writtenFiles quando OPEN não foi encontrado.
function _fsFdMode(fdName, path) {
  var openMode = (path.meta.fileOpenModes || {})[fdName];
  if (openMode) {
    if (openMode === 'OUTPUT')  return 'output';
    if (openMode === 'EXTEND')  return 'extend';
    if (openMode === 'I-O')     return 'io';
    return 'input'; // INPUT
  }
  // Fallback por operações detectadas
  var isRead    = path.meta.readFiles.indexOf(fdName) >= 0;
  var isWritten = path.meta.writtenFiles.indexOf(fdName) >= 0;
  if (isRead && isWritten) return 'io';
  if (isWritten)           return 'output';
  if (isRead)              return 'input';
  if (path.meta.openedFiles.indexOf(fdName) >= 0) return 'input';
  return null;
}

// Injeta dados fictícios nos arquivos e BD conforme o caminho selecionado
function _fakeSimInjectData(path) {
  var isEofPath = path.meta.hitEof;

  // ── Arquivos ─────────────────────────────────────────────────
  Object.keys(_simFiles).forEach(function(fdName) {
    var fd   = _simFiles[fdName];
    var mode = _fsFdMode(fdName, path);

    // Arquivos SD (sort work): sempre reset — são preenchidos pelo RELEASE durante a simulação
    if (fd.isSD) {
      fd.records = [];
      fd.pointer = 0;
      return;
    }

    if (!mode) return; // arquivo não usado neste caminho

    if (mode === 'output') {
      // OUTPUT: arquivo é criado/sobrescrito pelo programa — sem registros iniciais
      fd.records = [];
      fd.pointer = 0;
      return;
    }

    // INPUT, I-O, EXTEND: arquivo pré-existente — precisa de registros carregados
    if (fd.fields.length === 0) return; // sem layout conhecido

    // EOF → 3 registros (loop consome todos e chega ao fim)
    var qty = isEofPath ? 3 : 2;
    if (fd.records.length === 0) {
      fd.records = _fakeSimGenFileRecords(fdName, qty);
      fd.pointer = 0;
    }

    // ── Patching: sobrepõe campos do registro com os valores derivados das condições ──
    // _fakeSimGeneratedVars contém os valores de TODAS as variáveis (default + condições).
    // Só aplica campos cujo valor gerado DIFERE do default da definição PIC — isso garante
    // que apenas campos exigidos pelas condições de desvio sejam sobrescritos, preservando
    // os valores variados gerados por _fakeSimGenFileRecords para os demais campos.
    if (Object.keys(_fakeSimGeneratedVars).length > 0 && fd.records.length > 0) {
      // Pre-computa defaults para distinguir valores explícitos de defaults
      var _defVals = {};
      _simVarDefs.forEach(function(vd) {
        if (!vd.isGroup && !vd.is88) {
          _defVals[vd.name] = (vd.value !== null && vd.value !== undefined)
            ? String(vd.value)
            : (vd.picType === '9' ? '0' : '');
        }
      });
      fd.records.forEach(function(rec) {
        Object.keys(rec).forEach(function(fld) {
          if (_fakeSimGeneratedVars.hasOwnProperty(fld)) {
            var genVal = String(_fakeSimGeneratedVars[fld]);
            var defVal = _defVals.hasOwnProperty(fld) ? _defVals[fld] : null;
            // Só sobrescreve se o valor foi explicitamente alterado das condições do caminho
            if (defVal === null || genVal !== defVal) {
              rec[fld] = _fakeSimGeneratedVars[fld];
            }
          }
        });
      });
    }
  });

  // ── Tabelas DB2 ───────────────────────────────────────────────
  Object.keys(_simDb2Tables).forEach(function(tblName) {
    var tbl = _simDb2Tables[tblName];
    if (!tbl) return;
    // Quando não há colunas conhecidas, tenta derivá-las de:
    // 1) selectMaps[0].into (variáveis do INTO)
    // 2) whereMaps (colunas da cláusula WHERE)
    // 3) variáveis de WORKING-STORAGE que batem pelo nome (sem prefixo WS-)
    if (!tbl.columns.length) {
      if (tbl.selectMaps && tbl.selectMaps.length && tbl.selectMaps[0].into.length) {
        tbl.columns = tbl.selectMaps[0].into.slice();
      } else if (tbl.whereMaps && tbl.whereMaps.length) {
        // Usa os nomes das colunas do WHERE como estrutura mínima
        var wCols = [];
        tbl.whereMaps.forEach(function(wm) {
          Object.keys(wm).forEach(function(col) { if (wCols.indexOf(col) < 0) wCols.push(col); });
        });
        if (wCols.length) tbl.columns = wCols;
      }
    }
    // Pula somente se nenhum mecanismo conseguiu determinar colunas
    if (!tbl.columns.length) return;
    if (tbl.rows && tbl.rows.length > 0) return;
    var isUsed = path.meta.sqlOps.some(function(op){ return op.toUpperCase().indexOf(tblName) >= 0; });
    if (!isUsed && path.meta.sqlOps.length === 0) isUsed = true;
    if (!isUsed) return;
    var qty = path.meta.hitSqlError ? 0 : 2;
    tbl.rows = _fakeSimGenDb2Rows(tblName, qty);
    // Sincroniza colunas-chave do WHERE com as variáveis geradas para o caminho.
    // Resolve a cadeia de movimentações: se WS-CHAVE recebeu MOVE WS-COD TO WS-CHAVE,
    // o valor efetivo de WS-CHAVE no momento do SELECT é o valor de WS-COD.
    if (tbl.rows.length && tbl.whereMaps && tbl.whereMaps.length) {
      var varMoves = path.meta.varMoves || [];
      // Constrói um dicionário de último valor por variável, seguindo as movimentações em ordem
      function _resolveVar(varName) {
        var val = _fakeSimGeneratedVars[varName];
        // Percorre os moves em ordem, aplicando os que impactam varName
        varMoves.forEach(function(mv) {
          if (mv.dest !== varName) return;
          if (/^[A-Z][A-Z0-9-]*$/.test(mv.src)) {
            // fonte é outra variável — resolve recursivamente (sem loop)
            var srcVal = _fakeSimGeneratedVars[mv.src];
            if (srcVal !== undefined) val = srcVal;
          } else if (/^['"]/.test(mv.src)) {
            val = mv.src.slice(1, -1);
          } else if (/^\d+$/.test(mv.src)) {
            val = mv.src;
          }
        });
        return val;
      }
      tbl.rows.forEach(function(row) {
        tbl.whereMaps.forEach(function(wm) {
          Object.keys(wm).forEach(function(col) {
            var hostVar = wm[col];
            var resolved = _resolveVar(hostVar);
            if (resolved !== undefined) row[col] = resolved;
          });
        });
      });
    }
  });
}

// Renderiza preview dos dados fictícios no painel direito
function _fakeSimRenderDataPreview(path) {
  var out = '';

  // ── Arquivos ─────────────────────────────────────────────────
  // Reúne todos os arquivos usados neste caminho com seu modo
  var allFds = [];
  var seen   = {};
  var collect = function(arr, fallbackMode) {
    arr.forEach(function(f) {
      if (!seen[f] && _simFiles[f]) {
        seen[f] = true;
        allFds.push({ fdName: f, mode: _fsFdMode(f, path) || fallbackMode });
      }
    });
  };
  // Arquivos SD de SORT interno — processados PRIMEIRO para ter prioridade;
  // caso contrário seriam adicionados como INPUT/OUTPUT por readFiles/writtenFiles
  (path.meta.sortFiles || []).forEach(function(f) {
    if (!seen[f] && _simFiles[f]) {
      seen[f] = true;
      allFds.push({ fdName: f, mode: 'sort' });
    }
  });
  collect(path.meta.readFiles,    'input');
  collect(path.meta.writtenFiles, 'output');
  collect(path.meta.openedFiles,  'input');

  if (allFds.length) {
    out += '<div class="fs-data-section">';
    out += '<div class="fs-data-sec-hdr">📂 Arquivos</div>';

    allFds.forEach(function(entry) {
      var fdName = entry.fdName;
      var mode   = entry.mode;   // 'input' | 'output' | 'io'
      var fd = _simFiles[fdName];
      if (!fd) return;

      var fields = (fd.bookId && typeof _simGetBookFields === 'function')
        ? (_simGetBookFields(fd.bookId) || fd.fields)
        : fd.fields;

      // Etiqueta e ícone pelo modo
      var modeLabel, modeIcon, modeCls;
      if (mode === 'output') {
        modeLabel = 'SAÍDA';         modeIcon = '▶'; modeCls = 'fs-fd-mode-output';
      } else if (mode === 'io') {
        modeLabel = 'ENTRADA/SAÍDA'; modeIcon = '⇄'; modeCls = 'fs-fd-mode-io';
      } else if (mode === 'extend') {
        modeLabel = 'EXTEND';         modeIcon = '↩'; modeCls = 'fs-fd-mode-extend';
      } else if (mode === 'sort') {
        modeLabel = 'SORT (SD)';     modeIcon = '⇅'; modeCls = 'fs-fd-mode-sort';
      } else {
        modeLabel = 'ENTRADA';        modeIcon = '◀'; modeCls = 'fs-fd-mode-input';
      }

      out += '<div class="fs-data-fd-name">';
      out += _fsEsc(fdName);
      out += ' <span class="fs-fd-mode-badge ' + modeCls + '">' + modeIcon + '&nbsp;' + modeLabel + '</span>';

      if (mode === 'sort') {
        // Sort work file (SD): preenchido via RELEASE durante a simulação
        out += ' <span class="fs-data-qty">trabalho SORT</span>';
        out += '</div>';
        out += '<div class="fs-data-empty fs-data-sort-note">⇅ Arquivo de trabalho do <b>SORT (SD)</b> — começa vazio. É preenchido pelo RELEASE na INPUT PROCEDURE e consumido pelo RETURN na OUTPUT PROCEDURE. Os registros aparecem no painel de arquivos durante a execução.</div>';
        return;
      }

      if (mode === 'output') {
        // Arquivo de saída: começa vazio, programa grava
        out += ' <span class="fs-data-qty">0 reg.</span>';
        out += '</div>';
        out += '<div class="fs-data-empty fs-data-output-note">▶ Arquivo de <b>saída</b> — começa vazio. O programa grava os registros durante a execução.</div>';
        return;
      }

      if (mode === 'extend') {
        // EXTEND: arquivo pré-existente; programa adiciona registros ao final
        if (!fields.length) {
          out += '</div><div class="fs-data-empty">(layout não identificado)</div>';
          return;
        }
        var recsExt = fd.records.length ? fd.records : _fakeSimGenFileRecords(fdName, 2);
        out += ' <span class="fs-data-qty">' + recsExt.length + ' reg. existentes</span></div>';
        out += '<div class="fs-data-table-wrap"><table class="fs-data-table">';
        out += '<thead><tr>' + fields.map(function(f){ return '<th>' + _fsEsc(f) + '</th>'; }).join('') + '</tr></thead>';
        out += '<tbody>';
        recsExt.forEach(function(r){
          out += '<tr>' + fields.map(function(f){ var v = r[f] !== undefined ? r[f] : ''; return '<td>' + _fsEsc(v) + '</td>'; }).join('') + '</tr>';
        });
        out += '</tbody></table></div>';
        out += '<div class="fs-data-empty fs-data-extend-note">↩ Arquivo aberto em <b>EXTEND</b> — programa adiciona registros ao final.</div>';
        return;
      }

      // Entrada ou I-O: exibe registros
      if (!fields.length) {
        out += '</div><div class="fs-data-empty">(layout não identificado)</div>';
        return;
      }
      var recs = fd.records.length ? fd.records : _fakeSimGenFileRecords(fdName, path.meta.hitEof ? 3 : 2);
      out += ' <span class="fs-data-qty">' + recs.length + ' reg.</span></div>';
      out += '<div class="fs-data-table-wrap"><table class="fs-data-table">';
      out += '<thead><tr>' + fields.map(function(f){ return '<th>' + _fsEsc(f) + '</th>'; }).join('') + '</tr></thead>';
      out += '<tbody>';
      recs.forEach(function(r){
        out += '<tr>' + fields.map(function(f){ var v = r[f] !== undefined ? r[f] : ''; return '<td>' + _fsEsc(v) + '</td>'; }).join('') + '</tr>';
      });
      out += '</tbody></table></div>';
      if (mode === 'io') {
        out += '<div class="fs-data-empty fs-data-io-note">⇄ Arquivo <b>entrada/saída</b> — os registros acima são a entrada; o programa também grava nele.</div>';
      }
    });
    out += '</div>';
  }

  // ── Tabelas DB2 ───────────────────────────────────────────────
  if (path.meta.sqlOps.length) {
    // Inclui tabelas com colunas conhecidas + tabelas referenciadas no path mas sem colunas
    var db2Names = Object.keys(_simDb2Tables).filter(function(t){
      if (_simDb2Tables[t].columns.length > 0) return true;
      return path.meta.sqlOps.some(function(op){ return op.toUpperCase().indexOf(t) >= 0; });
    });
    if (db2Names.length) {
      out += '<div class="fs-data-section">';
      out += '<div class="fs-data-sec-hdr">🛢 Dados de Banco de Dados (DB2)</div>';
      if (path.meta.hitSqlError) {
        out += '<div class="fs-data-empty">Tabelas <b>vazias</b> — caminho de <b>erro SQL</b> (SQLCODE ≠ 0 e ≠ 100).</div>';
      } else if (path.meta.hitSqlNotFound) {
        out += '<div class="fs-data-empty">Tabelas <b>vazias</b> — caminho sem dados esperado: SQLCODE=100 (NOT FOUND).</div>';
      }
      db2Names.forEach(function(tblName) {
        var tbl = _simDb2Tables[tblName];
        var rows = tbl.rows && tbl.rows.length ? tbl.rows : (path.meta.hitSqlError ? [] : _fakeSimGenDb2Rows(tblName, 2));
        out += '<div class="fs-data-fd-name">' + _fsEsc(tblName) + ' <span class="fs-data-qty">' + rows.length + ' linha(s)</span></div>';
        if (!tbl.columns.length) {
          out += '<div class="fs-data-empty">⚠ Colunas não identificadas — use <b>SELECT COL1, COL2</b> (não SELECT *) ou importe o DDL.</div>';
        } else if (rows.length) {
          out += '<div class="fs-data-table-wrap"><table class="fs-data-table">';
          out += '<thead><tr>' + tbl.columns.map(function(c){ return '<th>' + _fsEsc(c) + '</th>'; }).join('') + '</tr></thead>';
          out += '<tbody>';
          rows.forEach(function(r){
            out += '<tr>' + tbl.columns.map(function(c){ var v = r[c] !== undefined ? r[c] : ''; return '<td>' + _fsEsc(v) + '</td>'; }).join('') + '</tr>';
          });
          out += '</tbody></table></div>';
        }
      });
      out += '</div>';
    }
  }

  return out;
}

// ── Escolher onde executar ────────────────────────────────────────
function fakeSimAskMode() {
  if (!_fakeSimSelectedPath) { alert('Selecione um caminho para executar.'); return; }
  var path = _fakeSimSelectedPath;
  var catLabels = path.categories.map(function (c) {
    return _FS_CATEGORIES[c] ? _FS_CATEGORIES[c].icon + ' ' + _FS_CATEGORIES[c].label : c;
  }).join(' | ');
  var infoEl = document.getElementById('fake-sim-run-modal-path');
  if (infoEl) infoEl.textContent = 'Caminho ' + path.id + '  [' + catLabels + ']';
  var modal = document.getElementById('fake-sim-run-modal');
  if (modal) modal.classList.add('open');
}

function fakeSimRunModalClose() {
  var modal = document.getElementById('fake-sim-run-modal');
  if (modal) modal.classList.remove('open');
}

function fakeSimRunMode(mode) {
  fakeSimRunModalClose();
  fakeSimRun(mode);
}

// ── Executar caminho selecionado ──────────────────────────────────
function fakeSimRun(mode) {
  if (!_fakeSimSelectedPath) { alert('Selecione um caminho para executar.'); return; }
  var path = _fakeSimSelectedPath;
  _fakeSimGeneratedVars = _fakeSimGenerateVarsForPath(path);

  _fakeSimBranchQueue    = path.branches.map(function (b) {
    return { nodeId: b.nodeId, chosenEdge: b.chosenEdge, edgeLabel: b.edgeLabel };
  });
  _fakeSimBranchQueueIdx = 0;
  _fakeSimActive         = true;

  fakeSimClose();
  if (mode === 'execmap') {
    execMapOpen();
  } else {
    simOpen();
  }

  // Injeta dados fictícios em arquivos e BD antes de iniciar
  _fakeSimInjectData(path);

  Object.keys(_fakeSimGeneratedVars).forEach(function (k) {
    if (_simVars.hasOwnProperty(k)) {
      _simVars[k]        = _fakeSimGeneratedVars[k];
      _simVarsInitial[k] = _fakeSimGeneratedVars[k];
    }
  });
  _simRefreshVarsPanel();

  var _SEP = '────────────────────────────────────────────────────';

  // ── Cabeçalho ────────────────────────────────────────────────
  var catLabels = path.categories.map(function (c) {
    return _FS_CATEGORIES[c] ? _FS_CATEGORIES[c].icon + ' ' + _FS_CATEGORIES[c].label : c;
  }).join(' | ');
  _simLog(_SEP, 'sim-log-sep');
  _simLog('🎭 FAKE SIM — CAMINHO ' + path.id + '   [' + catLabels + ']', 'sim-log-info');
  _simLog(_SEP, 'sim-log-sep');

  // ── Narrativa ─────────────────────────────────────────────────
  var story = _fakeSimBuildStory(path).replace(/<[^>]+>/g, '');
  _simLog('📖 ' + story, 'sim-log-info');

  // ── Variáveis: antes → depois ─────────────────────────────────
  var varChanges = [];
  _simVarDefs.forEach(function (v) {
    if (!v.isGroup && !v.is88 && _fakeSimGeneratedVars.hasOwnProperty(v.name)) {
      var defV = (v.value !== null && v.value !== undefined) ? v.value : (v.picType === '9' ? '0' : '');
      var newV = _fakeSimGeneratedVars[v.name];
      if (String(newV) !== String(defV)) varChanges.push({ name: v.name, before: defV, after: newV });
    }
  });
  if (varChanges.length) {
    _simLog(_SEP, 'sim-log-sep');
    _simLog('📋 VARIÁVEIS AJUSTADAS  (default → simulação)', 'sim-log-section');
    var maxNm = varChanges.reduce(function (m, e) { return Math.max(m, e.name.length); }, 0);
    varChanges.forEach(function (e) {
      var pad  = ' '.repeat(Math.max(0, maxNm - e.name.length));
      var bVal = JSON.stringify(String(e.before));
      var aVal = JSON.stringify(String(e.after));
      _simLog('   ' + e.name + pad + '   ' + bVal + '  →  ' + aVal, 'sim-log-var');
    });
  }

  // ── Arquivos ──────────────────────────────────────────────────
  var fileKeys = Object.keys(_simFiles || {}).filter(function (fd) { return !!_fsFdMode(fd, path); });
  if (fileKeys.length) {
    _simLog(_SEP, 'sim-log-sep');
    _simLog('📂 ARQUIVOS', 'sim-log-section');
    fileKeys.forEach(function (fdName) {
      var fd    = _simFiles[fdName];
      var mode  = (_fsFdMode(fdName, path) || '').toUpperCase();
      var recs  = fd.records || [];
      var recLabel = mode === 'OUTPUT'  ? '(vazio — criado pelo programa)'
                   : mode === 'EXTEND' ? recs.length + ' reg(s) + append'
                   : recs.length + ' registro(s)';
      _simLog('   ' + fdName + '  [' + mode + ']  ' + recLabel, 'sim-log-var');
      if (mode !== 'OUTPUT' && recs.length) {
        recs.slice(0, 3).forEach(function (rec) {
          var line = typeof rec === 'string' ? rec : JSON.stringify(rec);
          if (line.length > 80) line = line.slice(0, 77) + '…';
          _simLog('      ' + line, 'sim-log-detail');
        });
        if (recs.length > 3) _simLog('      … mais ' + (recs.length - 3) + ' registro(s)', 'sim-log-detail');
      }
    });
  }

  // ── DB2 ───────────────────────────────────────────────────────
  var db2Keys = Object.keys(_simDb2Tables || {}).filter(function (t) {
    return (_simDb2Tables[t].columns || []).length > 0;
  });
  if (db2Keys.length) {
    _simLog(_SEP, 'sim-log-sep');
    _simLog('🛢 DB2', 'sim-log-section');
    db2Keys.forEach(function (tblName) {
      var tbl      = _simDb2Tables[tblName];
      var rowCount = (tbl.rows || []).length;
      _simLog('   ' + tblName + '  ' + rowCount + ' linha(s)', 'sim-log-var');
      if (tbl.rows && tbl.rows.length) {
        tbl.rows.slice(0, 3).forEach(function (row) {
          var cols = Object.keys(row).map(function (k) { return k + '=' + JSON.stringify(row[k]); }).join('  ');
          if (cols.length > 100) cols = cols.slice(0, 97) + '…';
          _simLog('      ' + cols, 'sim-log-detail');
        });
        if (tbl.rows.length > 3) _simLog('      … mais ' + (tbl.rows.length - 3) + ' linha(s)', 'sim-log-detail');
      }
    });
  }

  // ── Variáveis após execução ───────────────────────────────────
  // Aplica todos os MOVEs do caminho sobre os valores de simulação
  // para calcular o estado final de cada variável
  var varMovesFinal = (path.meta && path.meta.varMoves) ? path.meta.varMoves : [];
  if (varMovesFinal.length) {
    var finalVars = {};
    // copia valores iniciais de simulação
    Object.keys(_fakeSimGeneratedVars).forEach(function (k) {
      finalVars[k] = _fakeSimGeneratedVars[k];
    });
    // aplica MOVEs em sequência
    varMovesFinal.forEach(function (mv) {
      if (!mv.dest) return;
      var src = mv.src;
      var val;
      if (/^['"]/.test(src)) {
        val = src.slice(1, -1);
      } else if (/^\d+$/.test(src)) {
        val = src;
      } else if (/^SPACES?$/.test(src)) {
        val = '';
      } else if (/^ZEROS?$/.test(src) || /^ZEROES$/.test(src)) {
        val = '0';
      } else if (/^HIGH-VALUES?$/.test(src)) {
        val = '\xFF\xFF\xFF';
      } else if (/^LOW-VALUES?$/.test(src)) {
        val = '\x00\x00\x00';
      } else if (/^[A-Z][A-Z0-9-]*$/.test(src) && finalVars.hasOwnProperty(src)) {
        val = finalVars[src];
      }
      if (val !== undefined) finalVars[mv.dest] = val;
    });
    // mostra apenas variáveis que mudaram após a execução
    var postChanges = [];
    Object.keys(finalVars).forEach(function (nm) {
      var simVal   = _fakeSimGeneratedVars[nm];
      var afterVal = finalVars[nm];
      if (String(afterVal) !== String(simVal)) {
        postChanges.push({ name: nm, before: simVal, after: afterVal });
      }
    });
    if (postChanges.length) {
      _simLog(_SEP, 'sim-log-sep');
      _simLog('🔄 VARIÁVEIS APÓS EXECUÇÃO  (simulação → final)', 'sim-log-section');
      var maxNm2 = postChanges.reduce(function (m, e) { return Math.max(m, e.name.length); }, 0);
      postChanges.forEach(function (e) {
        var pad  = ' '.repeat(Math.max(0, maxNm2 - e.name.length));
        var bVal = JSON.stringify(String(e.before));
        var aVal = JSON.stringify(String(e.after));
        _simLog('   ' + e.name + pad + '   ' + bVal + '  →  ' + aVal, 'sim-log-var');
      });
    }
  }

  _simLog(_SEP, 'sim-log-sep');
  _simLog('▶ Dados prontos — clique ▶ para iniciar a simulação.', 'sim-log-info');
}

// ── Exportar ─────────────────────────────────────────────────────
function fakeSimExportDoc() {
  if (!_fakeSimSelectedPath) { alert('Selecione um caminho primeiro.'); return; }
  _fakeSimWriteDoc([_fakeSimSelectedPath], false);
}

function fakeSimExportAllPaths() {
  if (!_fakeSimPaths.length) { alert('Abra a Simulação Fake para descobrir os caminhos primeiro.'); return; }
  _fakeSimWriteDoc(_fakeSimPaths, true);
}

function _fakeSimWriteDoc(paths, allMode) {
  var code  = (document.getElementById('input') || {}).value || '';
  var progM = code.match(/PROGRAM-ID\.?\s+([A-Z0-9][A-Z0-9-]*)/i);
  var prog  = progM ? progM[1].toUpperCase() : 'PROGRAMA';
  var date  = new Date().toLocaleString('pt-BR');

  var lines = [
    '================================================================',
    allMode ? '  DOCUMENTAÇÃO COMPLETA — TODOS OS CAMINHOS — COBOL Flow'
            : '  DOCUMENTAÇÃO DE SIMULAÇÃO FAKE — COBOL Flow',
    '================================================================',
    'Programa  : ' + prog,
    'Gerado em : ' + date,
    allMode ? 'Total de caminhos: ' + paths.length : '',
    ''
  ];

  paths.forEach(function (path) {
    var vars = _fakeSimGenerateVarsForPath(path);
    var cats = path.categories.map(function (c) {
      return _FS_CATEGORIES[c] ? _FS_CATEGORIES[c].icon + ' ' + _FS_CATEGORIES[c].label : c;
    }).join(' | ');

    lines.push('================================================================');
    lines.push('  CAMINHO ' + path.id + '  |  ' + path.nodes.length + ' nós  |  ' + path.branches.length + ' desvio(s)');
    lines.push('  Categorias: ' + cats);
    lines.push('================================================================');
    lines.push('');
    lines.push('  DESCRIÇÃO:');
    lines.push('  ' + _fakeSimBuildStory(path).replace(/<[^>]+>/g, ''));
    lines.push('');

    if (path.meta.openedFiles.length)  lines.push('  Arquivos abertos : ' + path.meta.openedFiles.join(', '));
    if (path.meta.readFiles.length)    lines.push('  Arquivos lidos   : ' + path.meta.readFiles.join(', '));
    if (path.meta.writtenFiles.length) lines.push('  Arquivos gravados: ' + path.meta.writtenFiles.join(', '));
    if (path.meta.callPrograms.length) lines.push('  Programas CALL   : ' + path.meta.callPrograms.join(', '));
    if (path.meta.sqlOps.length)       lines.push('  SQL              : ' + path.meta.sqlOps[0].substring(0, 70));
    lines.push('');

    if (path.branches.length) {
      lines.push('  DESVIOS:');
      path.branches.forEach(function (b, i) {
        lines.push('    ' + (i+1) + '. ' + (b.condition || '').substring(0, 65));
        lines.push('          → ' + (b.edgeLabel || '?'));
      });
      lines.push('');
    }

    lines.push('  VARIÁVEIS NECESSÁRIAS:');
    lines.push('  ' + _fsPad('🔑/✏', 4) + _fsPad('Variável', 30) + _fsPad('Valor', 20) + _fsPad('Default', 15) + 'PIC');
    lines.push('  ' + '-'.repeat(82));

    var anyRow = false;
    var keyNms = new Set();
    path.branches.forEach(function (b) {
      var cu = (b.condition || '').replace(/^IF\s+/i,'').replace(/^EVALUATE\s+/i,'').toUpperCase();
      var mo = cu.match(/^(?:NOT\s+)?([A-Z][A-Z0-9-]*)/);
      if (mo) keyNms.add(mo[1]);
    });
    Object.values(_simFileStatusMap || {}).forEach(function (sv) { if (sv) keyNms.add(sv); });

    _simVarDefs.forEach(function (v) {
      if (!v.isGroup && !v.is88 && vars.hasOwnProperty(v.name)) {
        var defV = (v.value !== null && v.value !== undefined) ? v.value : (v.picType === '9' ? '0' : '');
        if (vars[v.name] !== defV || keyNms.has(v.name)) {
          anyRow = true;
          var mark = keyNms.has(v.name) ? '🔑 ' : '✏  ';
          lines.push('  ' + _fsPad(mark, 4) + _fsPad(v.name, 30) + _fsPad(vars[v.name] === '' ? '(vazio)' : vars[v.name], 20)
            + _fsPad(defV === '' ? '(vazio)' : defV, 15) + (v.pic || '-'));
        }
      }
    });
    if (!anyRow) lines.push('  (sem variáveis a alterar — use valores padrão)');
    lines.push('');

    lines.push('  COBOL DE INICIALIZAÇÃO:');
    var hasMoves = false;
    _simVarDefs.forEach(function (v) {
      if (!v.isGroup && !v.is88 && vars.hasOwnProperty(v.name)) {
        var defV = (v.value !== null && v.value !== undefined) ? v.value : (v.picType === '9' ? '0' : '');
        if (vars[v.name] !== defV) {
          hasMoves = true;
          var isAlpha = v.picType !== '9';
          var val = vars[v.name] === '' ? ' ' : vars[v.name];
          lines.push('           MOVE ' + (isAlpha ? "'" + val + "'" : val) + ' TO ' + v.name + '.');
        }
      }
    });
    if (!hasMoves) lines.push('           * Nenhum MOVE necessário');
    lines.push('');
  });

  lines.push('================================================================');
  lines.push('  Gerado por COBOL Flow — Simulação Fake v2');
  lines.push('================================================================');

  var blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href     = url;
  a.download = allMode ? prog + '_todos_caminhos.txt' : prog + '_caminho' + paths[0].id + '_simulacao.txt';
  a.click();
  URL.revokeObjectURL(url);
}

function _fsPad(s, n) {
  s = String(s == null ? '' : s);
  while (s.length < n) s += ' ';
  return s.substring(0, n);
}

// ══════════════════════════════════════════════════════════════════
// ── EXECUÇÃO EM LOTE — todos os caminhos sem UI ───────────────────
// ══════════════════════════════════════════════════════════════════

var _fakeSimBatchRunning = false;
var _fakeSimBatchDone    = 0;
var _fakeSimBatchTotal   = 0;

/**
 * Ponto de entrada: executa TODOS os caminhos descobertos em modo
 * headless (sem abrir o simulador). Ao terminar, abre o Relatório
 * de Investigação agrupado por caminho.
 */
function fakeSimRunAll() {
  if (!window.cy || cy.nodes().length === 0) {
    alert('Gere o fluxo antes de usar Executar Todos.');
    return;
  }
  // Garante que os caminhos foram descobertos
  if (!_fakeSimPaths || _fakeSimPaths.length === 0) {
    alert('Abra a Simulação Fake primeiro para descobrir os caminhos, depois clique em Executar Todos.');
    return;
  }
  if (_fakeSimBatchRunning) {
    alert('Já há uma execução em lote em andamento.');
    return;
  }
  if (!confirm('Executar todos os ' + _fakeSimPaths.length + ' caminho(s) automaticamente?\n\nOs resultados serão salvos no Relatório de Investigação.')) return;

  _fakeSimBatchRunning = true;
  _fakeSimBatchDone    = 0;
  _fakeSimBatchTotal   = _fakeSimPaths.length;

  // Fecha o modal da Fake Sim se aberto
  fakeSimClose();

  // Inicia overlay de progresso
  _fakeSimBatchShowProgress();

  // ── RESTART COMPLETO: limpa relatório e estado do simulador ──
  // Limpa cenários de execuções anteriores
  if (typeof _repScenarios !== 'undefined') {
    _repScenarios  = [];
    _fakeSimBatchOrigMaxScenarios = 999; // temporariamente ilimitado
  }
  if (typeof _repCurrent !== 'undefined')    _repCurrent    = null;
  if (typeof _repScenarioId !== 'undefined') _repScenarioId = 0;

  // Reinicializa variáveis do programa do zero (parseando o código novamente)
  var code = (document.getElementById('input') || {}).value || '';
  _simInitVars(code);
  if (typeof parseCobol === 'function') {
    var _fsBatchPc88 = parseCobol(code);
    if (_fsBatchPc88 && _fsBatchPc88.condMap88) _simMergeCond88(_fsBatchPc88.condMap88);
  }

  // Salva snapshot limpo das vars e das tabelas DB2 (ANTES de qualquer injeção)
  // para que cada caminho comece a partir do mesmo estado inicial
  _fakeSimBatchCleanVars = Object.assign({}, _simVars || {});
  _fakeSimBatchCleanVarsInitial = Object.assign({}, _simVarsInitial || {});
  _fakeSimBatchCleanDb2  = JSON.parse(JSON.stringify(_simDb2Tables || {}));

  // Ativa o simulador em modo headless (sem UI)
  _simHeadless = true;
  _sim.on      = true;

  _fakeSimBatchRunIdx(0);
}

var _fakeSimBatchOrigMaxScenarios = 50;
var _fakeSimBatchCleanVars        = null; // snapshot limpo de _simVars (pós _simInitVars)
var _fakeSimBatchCleanVarsInitial = null; // snapshot limpo de _simVarsInitial
var _fakeSimBatchCleanDb2         = null; // snapshot limpo de _simDb2Tables

/**
 * Executa o caminho no índice `idx` da lista; ao terminar, avança para idx+1.
 */
function _fakeSimBatchRunIdx(idx) {
  if (idx >= _fakeSimPaths.length) {
    _fakeSimBatchFinish();
    return;
  }

  _fakeSimBatchDone = idx;
  _fakeSimBatchUpdateProgress(idx, _fakeSimBatchTotal);

  _fakeSimRunOneHeadless(_fakeSimPaths[idx], function() {
    // Pausa mínima entre execuções para não travar o evento loop do browser
    setTimeout(function() {
      _fakeSimBatchRunIdx(idx + 1);
    }, 4);
  });
}

/**
 * Executa um único caminho em modo headless (sem abrir modal do simulador).
 * Chama `onDone` quando a execução terminar.
 */
function _fakeSimRunOneHeadless(path, onDone) {
  // ── 1. Prepara branch queue e variáveis, como fakeSimRun faz ──
  _fakeSimSelectedPath   = path;
  _fakeSimGeneratedVars  = _fakeSimGenerateVarsForPath(path);
  _fakeSimBranchQueue    = path.branches.map(function(b) {
    return { nodeId: b.nodeId, chosenEdge: b.chosenEdge, edgeLabel: b.edgeLabel };
  });
  _fakeSimBranchQueueIdx = 0;
  _fakeSimActive         = true;

  // ── 2. Reseta estado do simulador sem abrir UI ──
  //    Restaura vars e DB2 ao estado limpo do início do lote,
  //    garantindo que cada caminho começa do zero (não herda lixo do anterior).
  clearTimeout(_sim.timer);
  _sim.currentId  = null;
  _sim.step       = 0;
  _sim.callStack  = [];
  _sim.visited    = [];
  _sim.running    = false;
  _sim.paused     = false;
  _simVarsMoved   = {};
  _simVarsChanged = {};
  _simLoopState   = {};
  _simNodeHits    = {};
  _simParaSeq     = [];
  // Restaura variáveis e tabelas DB2 ao estado inicial do lote
  if (_fakeSimBatchCleanVars) {
    _simVars        = Object.assign({}, _fakeSimBatchCleanVars);
    _simVarsInitial = Object.assign({}, _fakeSimBatchCleanVarsInitial || _fakeSimBatchCleanVars);
  }
  if (_fakeSimBatchCleanDb2) {
    _simDb2Tables = JSON.parse(JSON.stringify(_fakeSimBatchCleanDb2));
  }
  if (typeof _simResetFilePointers === 'function') _simResetFilePointers();

  // ── 3. Aplica variáveis geradas para este caminho ──
  Object.keys(_fakeSimGeneratedVars).forEach(function(k) {
    if (_simVars.hasOwnProperty(k)) {
      _simVars[k]        = _fakeSimGeneratedVars[k];
      _simVarsInitial[k] = _fakeSimGeneratedVars[k];
    }
  });

  // ── 4. Injeta dados fictícios (arquivos, DB2) — APÓS restaurar estado limpo ──
  // Deve ser chamada depois da restauração para não ser sobrescrita.
  // Usa _fakeSimGeneratedVars (já calculado) para fazer patch das chaves WHERE.
  _fakeSimInjectData(path);

  // ── 5. Snapshot inicial DB2 (normalmente feito em simPlay) ──
  _simDb2TablesInitial = {};
  Object.keys(_simDb2Tables || {}).forEach(function(tbl) {
    var t = _simDb2Tables[tbl];
    _simDb2TablesInitial[tbl] = {
      columns: (t.columns || []).slice(),
      rows: (t.rows || []).map(function(r) { return Object.assign({}, r); })
    };
  });

  // ── 6. Define callback de término ANTES de iniciar ──
  _simOnRunComplete = function() {
    // Marca o cenário mais recente com as informações do caminho
    if (typeof _repScenarios !== 'undefined' && _repScenarios.length > 0) {
      var sc = _repScenarios[_repScenarios.length - 1];
      sc.fakePath = { id: path.id, categories: path.categories.slice() };
    }
    _fakeSimActive = false;
    onDone();
  };

  // ── 7. Dispara play headless ──
  //    (simPlay chama _repStartRun internamente)
  simPlay();
}

/**
 * Chamado quando todos os caminhos terminaram.
 */
function _fakeSimBatchFinish() {
  _fakeSimBatchRunning = false;
  _simHeadless = false;
  _sim.on      = false;
  _fakeSimActive = false;

  _fakeSimBatchHideProgress();

  // Abre o relatório de investigação agrupado por caminho
  if (typeof repOpenModal === 'function') {
    repOpenModal();
    // Muda para a aba Cenários (Por Caminho) após abrir
    setTimeout(function() {
      if (typeof _repShowTab === 'function') _repShowTab('scenarios');
    }, 80);
  }
}

// ── Overlay de progresso ──────────────────────────────────────────

function _fakeSimBatchShowProgress() {
  var existing = document.getElementById('fsb-progress-overlay');
  if (existing) { existing.style.display = 'flex'; return; }

  var el = document.createElement('div');
  el.id = 'fsb-progress-overlay';
  el.innerHTML =
    '<div id="fsb-progress-box">' +
      '<div id="fsb-progress-title">&#9654;&#9654; Executando todos os caminhos…</div>' +
      '<div id="fsb-progress-bar-wrap"><div id="fsb-progress-bar"></div></div>' +
      '<div id="fsb-progress-label">Preparando…</div>' +
    '</div>';
  document.body.appendChild(el);
}

function _fakeSimBatchUpdateProgress(done, total) {
  var bar   = document.getElementById('fsb-progress-bar');
  var label = document.getElementById('fsb-progress-label');
  if (!bar || !label) return;
  var pct = total > 0 ? Math.round((done / total) * 100) : 0;
  bar.style.width = pct + '%';
  label.textContent = 'Caminho ' + (done + 1) + ' de ' + total + ' (' + pct + '%)';
}

function _fakeSimBatchHideProgress() {
  var el = document.getElementById('fsb-progress-overlay');
  if (el) el.style.display = 'none';
}
