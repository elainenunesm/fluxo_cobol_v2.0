// ================================================================
//  COBOL Flow — Relatório de Investigação
//  Arquivo: js/report.js
//  Carregado APÓS js/simulator.js no index.html.html
// ================================================================

'use strict';

// ── Estado Global ────────────────────────────────────────────────
var _repScenarios  = [];    // histórico de cenários concluídos
var _repCurrent    = null;  // cenário em andamento
var _repScenarioId = 0;     // contador sequencial

// ── Funções de Início / Fim de Cenário ───────────────────────────

function _repStartRun() {
  _repScenarioId++;
  _repCurrent = {
    id              : _repScenarioId,
    startTime       : new Date(),
    endTime         : null,
    status          : 'em-andamento',
    steps           : 0,
    nodesVisited    : [],        // [ {id, tipo, label} ]
    nodesVisitedSet : {},        // para contar únicos
    paragraphs      : {},        // { paragName: count }
    branches        : [],        // [ {condition, result, wasAuto} ]
    autoResolvedBranches : 0,
    manualBranches  : 0,
    loops           : [],        // [ {label, iterations} ]
    totalLoopIterations  : 0,
    fileOps         : {},        // { fdName: {reads,writes,opens,closes} }
    varsChanged     : [],        // [ {name, from, to, op} ]
    log             : []         // [ {text, cls, time} ]
  };
}

function _repEndRun(status) {
  if (!_repCurrent) return;
  if (_repCurrent.status !== 'em-andamento') return; // já finalizado
  _repCurrent.endTime = new Date();
  _repCurrent.status  = status || 'concluido';
  // Captura estatísticas de execução do simulador (nodeHits / sequência de passos)
  _repCurrent.nodeHits = (typeof _simNodeHits !== 'undefined') ? JSON.parse(JSON.stringify(_simNodeHits)) : {};
  _repCurrent.paraSeq  = (typeof _simParaSeq  !== 'undefined') ? _simParaSeq.slice() : [];
  _repScenarios.push(_repCurrent);
  _repCurrent = null;
  // Garante que não armazena mais de 50 cenários (evita vazamento de memória)
  if (_repScenarios.length > 50) _repScenarios.shift();
  // Atualiza badge de contagem no botão se modal já existir
  _repUpdateBadge();
}

function _repUpdateBadge() {
  var btn = document.getElementById('btn-relatorio');
  if (btn) {
    var n = _repScenarios.length;
    btn.title = 'Relatório de Investigação' + (n > 0 ? ' (' + n + ' cenário' + (n > 1 ? 's' : '') + ')' : '');
    var lbl = btn.querySelector('.rep-badge');
    if (lbl) {
      lbl.textContent = n > 0 ? String(n) : '';
      lbl.style.display = n > 0 ? 'inline-block' : 'none';
    }
  }
}

// ── Hooks chamados pelo simulator.js ────────────────────────────

/**
 * Chamado em _simHighlight(nodeId) — registra cada passo.
 */
function _repOnStep(nodeId) {
  if (!_repCurrent || !window.cy) return;
  _repCurrent.steps++;
  var node  = cy.getElementById(nodeId);
  var tipo  = (node && node.data('tipo'))  || '';
  var label = (node && node.data('label')) || nodeId;
  _repCurrent.nodesVisited.push({ id: nodeId, tipo: tipo, label: label.substring(0, 80) });
  _repCurrent.nodesVisitedSet[nodeId] = true;
  // Verifica se é uma seção/parágrafo
  if (tipo === 'para' || tipo === 'section') {
    _repCurrent.paragraphs[label] = (_repCurrent.paragraphs[label] || 0) + 1;
  }
}

/**
 * Chamado em _simDoRead, _simDoWrite, _simDoOpen, _simDoClose.
 * Apenas mantém contadores — a mensagem detalhada já vem via _repCaptureLog / _simLog.
 * @param {string} type  - 'read' | 'write' | 'open' | 'close'
 * @param {string} fdName
 */
function _repOnFileOp(type, fdName) {
  if (!_repCurrent) return;
  if (!_repCurrent.fileOps[fdName]) {
    _repCurrent.fileOps[fdName] = { reads: 0, writes: 0, opens: 0, closes: 0 };
  }
  var fo = _repCurrent.fileOps[fdName];
  if      (type === 'read')  fo.reads++;
  else if (type === 'write') fo.writes++;
  else if (type === 'open')  fo.opens++;
  else if (type === 'close') fo.closes++;
}

/**
 * Chamado quando uma condição IF/EVALUATE é resolvida.
 * @param {string}  condition - texto da condição
 * @param {string}  result    - ramo escolhido (SIM/NÃO ou valor)
 * @param {boolean} wasAuto   - true se resolvida automaticamente
 */
function _repOnBranch(condition, result, wasAuto) {
  if (!_repCurrent) return;
  _repCurrent.branches.push({
    condition: String(condition).substring(0, 120),
    result   : String(result).substring(0, 60),
    wasAuto  : !!wasAuto,
    step     : _repCurrent.steps
  });
  if (wasAuto) _repCurrent.autoResolvedBranches++;
  else         _repCurrent.manualBranches++;
}

/**
 * Chamado quando um loop é finalizado.
 * @param {string} label      - label do nó de loop
 * @param {number} iterations - número de iterações realizadas
 */
function _repOnLoop(label, iterations) {
  if (!_repCurrent) return;
  _repCurrent.loops.push({ label: String(label).substring(0, 80), iterations: iterations });
  _repCurrent.totalLoopIterations += iterations;
}

/**
 * Chamado em _simLog para capturar cada linha de log.
 * @param {string} msg
 * @param {string} cls
 */
function _repCaptureLog(msg, cls) {
  if (!_repCurrent) return;
  var type = 'step';
  var m = msg || '';
  // Detecta tipo pela classe CSS ou pelo conteúdo da mensagem
  if (cls === 'sim-log-info') {
    // OPEN / CLOSE têm classe sim-log-info
    type = 'file';
  } else if (cls === 'sim-log-branch') {
    // READ/WRITE e desvios e loops todos usam sim-log-branch →
    // distingue pelo conteúdo
    var mu = m.toUpperCase();
    if (mu.indexOf('READ ') >= 0 || mu.indexOf('WRITE ') >= 0 || mu.indexOf('REWRITE ') >= 0) {
      type = 'file';
    } else if (mu.indexOf('LOOP ') >= 0 || m.indexOf('\u21bb') >= 0) {
      type = 'loop';
    } else {
      type = 'branch';
    }
  }
  _repCurrent.log.push({
    text : msg,
    cls  : cls || '',
    type : type,
    time : new Date().toLocaleTimeString('pt-BR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  });
}

/**
 * Chamado em _simSetVarInternal para capturar mudanças em variáveis.
 * @param {string} name
 * @param {*}      from
 * @param {*}      to
 */
function _repOnVarChange(name, from, to) {
  if (!_repCurrent) return;
  var fromStr = String(from !== undefined && from !== null ? from : '∅');
  var toStr   = String(to   !== undefined && to   !== null ? to   : '∅');
  _repCurrent.varsChanged.push({
    name : name,
    from : fromStr,
    to   : toStr,
    step : _repCurrent.steps
  });
  // Suprime log individual quando é cópia de READ (já aparece via _repOnReadRecord)
  if (_repTagNextVarsAsFile) return;
  _repCurrent.log.push({
    text : '  ✎ MOVE  ' + name + '  [' + fromStr + '] → [' + toStr + ']',
    cls  : 'rep-log-var',
    type : 'var',
    time : new Date().toLocaleTimeString('pt-BR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  });
}

/**
 * Registra os campos do registro lido diretamente no log (chamado de _simDoRead).
 * @param {string}   fdName  - nome do arquivo
 * @param {Object}   rec     - objeto com os valores do registro
 * @param {string[]} fields  - lista de campos do FD
 */
function _repOnReadRecord(fdName, rec, fields) {
  if (!_repCurrent || !rec) return;
  var time = new Date().toLocaleTimeString('pt-BR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  // fields já vem de Object.keys(rec), mas garantimos via fallback
  var keys = (fields && fields.length > 0) ? fields : Object.keys(rec);
  keys.forEach(function(fld) {
    var val = String(rec[fld] !== undefined && rec[fld] !== null ? rec[fld] : '∅');
    _repCurrent.log.push({
      text : '  ↳ ' + fld + ' = [' + val + ']',
      cls  : 'rep-log-file-var',
      type : 'file-var',
      time : time
    });
  });
}

// ── Modal ─────────────────────────────────────────────────────────

var _repActiveTab          = 'overview';    // 'overview' | 'execsummary' | 'validation' | 'scenarios' | 'stats' | 'log'
var _repLogFilter          = 'all';         // 'all'|'step'|'var'|'file'|'branch'|'loop'
var _repTagNextVarsAsFile  = false;         // true enquanto vars pertencem a um READ em curso
var _repValidation = null;        // resultado de _repAnalyzeFlow()
var _repActiveScenario = null;    // id do cenário expandido

function repOpenModal() {
  var overlay = document.getElementById('rep-overlay');
  if (!overlay) {
    _repBuildModalDOM();
    overlay = document.getElementById('rep-overlay');
  }
  // Garante que a análise estática está atualizada antes de renderizar
  if (!_repValidation && window.cy && cy.nodes().length > 0) {
    _repAnalyzeFlow();
  }
  _repActiveTab = 'overview';
  _repRenderAll();
  // Ativa visualmente a aba overview
  var tabs = ['overview','execsummary','validation','scenarios','stats','log','statslog'];
  tabs.forEach(function(t) {
    var btn  = document.getElementById('rep-tab-' + t);
    var pane = document.getElementById('rep-pane-' + t);
    if (btn)  btn.classList.toggle('rep-tab-active',  t === 'overview');
    if (pane) pane.classList.toggle('rep-pane-active', t === 'overview');
  });
  overlay.classList.add('rep-open');
  document.addEventListener('keydown', _repEscKey);
}

function _repCloseModal() {
  var overlay = document.getElementById('rep-overlay');
  if (overlay) overlay.classList.remove('rep-open');
  document.removeEventListener('keydown', _repEscKey);
}

function _repEscKey(e) {
  if (e.key === 'Escape') _repCloseModal();
}

function _repBuildModalDOM() {
  var host = document.createElement('div');
  host.id = 'rep-overlay';
  host.innerHTML =
    '<div id="rep-modal">' +
      '<div class="rep-header">' +
        '<span class="rep-header-icon">&#128203;</span>' +
        '<span class="rep-header-title">Relatório de Investigação</span>' +
        '<button class="rep-close" onclick="_repCloseModal()" title="Fechar">&#10005;</button>' +
      '</div>' +
      '<div class="rep-tabs">' +
        '<button class="rep-tab rep-tab-active" id="rep-tab-overview"    onclick="_repShowTab(\'overview\')">&#127760; Visão Geral</button>' +
        '<button class="rep-tab" id="rep-tab-execsummary" onclick="_repShowTab(\'execsummary\')">&#9654; Resumo de Execução</button>' +
        '<button class="rep-tab" id="rep-tab-validation"  onclick="_repShowTab(\'validation\')">&#9745; Validações</button>' +
        '<button class="rep-tab" id="rep-tab-scenarios"   onclick="_repShowTab(\'scenarios\')">&#128194; Cenários</button>' +
        '<button class="rep-tab" id="rep-tab-stats"       onclick="_repShowTab(\'stats\')">&#128200; Estatísticas</button>' +
        '<button class="rep-tab" id="rep-tab-log"         onclick="_repShowTab(\'log\')">&#128220; Log Completo</button>' +
        '<button class="rep-tab" id="rep-tab-statslog"    onclick="_repShowTab(\'statslog\')">&#128202; Estat\u00edstica Log</button>' +
      '</div>' +
      '<div class="rep-body">' +
        '<div id="rep-pane-overview"     class="rep-pane rep-pane-active"></div>' +
        '<div id="rep-pane-execsummary"  class="rep-pane"></div>' +
        '<div id="rep-pane-validation"   class="rep-pane"></div>' +
        '<div id="rep-pane-scenarios"    class="rep-pane"></div>' +
        '<div id="rep-pane-stats"        class="rep-pane"></div>' +
        '<div id="rep-pane-log"          class="rep-pane"></div>' +
        '<div id="rep-pane-statslog"     class="rep-pane"></div>' +
      '</div>' +
      '<div class="rep-footer">' +
        '<button class="rep-btn rep-btn-sec" onclick="_repClearAll()" title="Apaga todo o histórico de cenários">&#128465; Limpar Tudo</button>' +
        '<div style="flex:1"></div>' +
        '<button class="rep-btn rep-btn-sec" onclick="_repExportJSON()" title="Exportar todos os cenários como JSON">&#8595; JSON</button>' +
        '<button class="rep-btn rep-btn-sec" onclick="_repExportTXT()"  title="Exportar relatório resumido como texto">&#8595; Texto</button>' +
        '<button class="rep-btn rep-btn-pri" onclick="_repCloseModal()">Fechar</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(host);
  host.addEventListener('click', function(e) { if (e.target === host) _repCloseModal(); });
}

function _repShowTab(tab) {
  _repActiveTab = tab;
  var tabs  = ['overview', 'execsummary', 'scenarios', 'validation', 'stats', 'log', 'statslog'];
  tabs.forEach(function(t) {
    var btn  = document.getElementById('rep-tab-' + t);
    var pane = document.getElementById('rep-pane-' + t);
    if (!btn || !pane) return;
    if (t === tab) {
      btn.classList.add('rep-tab-active');
      pane.classList.add('rep-pane-active');
    } else {
      btn.classList.remove('rep-tab-active');
      pane.classList.remove('rep-pane-active');
    }
  });
  _repRenderAll();
}

function _repRenderAll() {
  if (_repActiveTab === 'overview')     _repRenderOverview();
  if (_repActiveTab === 'execsummary')  _repRenderExecSummary();
  if (_repActiveTab === 'scenarios')    _repRenderScenarios();
  if (_repActiveTab === 'validation')   _repRenderValidation();
  if (_repActiveTab === 'stats')        _repRenderStats();
  if (_repActiveTab === 'log')          _repRenderLog();
  if (_repActiveTab === 'statslog')     _repRenderStatsLog();
}

// ── Aba: Estatística Log — sequência e hits por execução ──────────────────────
function _repRenderStatsLog() {
  var pane = document.getElementById('rep-pane-statslog');
  if (!pane) return;

  var scenariosWithSeq = _repScenarios.filter(function(s){ return s.paraSeq && s.paraSeq.length > 0; });
  if (scenariosWithSeq.length === 0) {
    pane.innerHTML = '<div class="rep-empty"><div class="rep-empty-icon">&#128202;</div><div>Nenhum dado dispon\u00edvel. Execute pelo menos um cen\u00e1rio para ver a sequ\u00eancia de execu\u00e7\u00e3o.</div></div>';
    return;
  }

  var html = '<div class="rep-stats-wrap">';
  // Mostra do mais recente para o mais antigo
  for (var si = scenariosWithSeq.length - 1; si >= 0; si--) {
    html += _repRenderStatsSeq(scenariosWithSeq[si]);
    if (si > 0) html += '<div class="rep-section-title-sep"></div>';
  }
  html += '</div>';
  pane.innerHTML = html;
}

// ── Aba: Visão Geral ─────────────────────────────────────────────

function _repRenderOverview() {
  var pane = document.getElementById('rep-pane-overview');
  if (!pane) return;

  var hasCy  = window.cy && cy.nodes().length > 0;
  var hasSc  = _repScenarios.length > 0;
  var prog   = hasCy ? _repDetectProgramName() : '—';

  var html = '<div class="rep-overview-wrap">';

  // ── Cabeçalho do programa ──
  html += '<div class="rep-ov-prog-header">';
  html += '<span class="rep-ov-prog-icon">&#128218;</span>';
  html += '<div class="rep-ov-prog-info">';
  html += '<div class="rep-ov-prog-name">' + _repEscHtml(prog) + '</div>';
  html += '<div class="rep-ov-prog-sub">COBOL Flow — Análise estrutural do programa</div>';
  html += '</div>';

  // Badge de status do fluxo
  if (!hasCy) {
    html += '<span class="rep-ov-badge rep-ov-badge--warn">&#9888; Fluxo não gerado</span>';
  } else {
    html += '<span class="rep-ov-badge rep-ov-badge--ok">&#9679; Fluxo ativo</span>';
  }
  html += '</div>'; // prog-header

  if (hasCy) {
    var nodes  = cy.nodes();
    var edges  = cy.edges();

    // Contagens por tipo
    var tipos = {};
    nodes.forEach(function(n) { var t = n.data('tipo') || 'other'; tipos[t] = (tipos[t]||0)+1; });

    var nPara    = (tipos['para']||0) + (tipos['paragrafo']||0) + (tipos['section']||0);
    var nIf      = tipos['if']    || 0;
    var nEval    = tipos['evaluate'] || 0;
    var nLoop    = tipos['loop']  || 0;
    var nRead    = tipos['read']  || 0;
    var nWrite   = tipos['write'] || 0;
    var nCall    = tipos['call']  || 0;
    var nSql     = tipos['sql']   || 0;
    var nGoto    = tipos['goto']  || 0;
    var nStop    = tipos['stop']  || 0;
    var nOpen    = tipos['open']  || 0;
    var nClose   = tipos['close'] || 0;
    var nTotal   = nodes.length;
    var nEdges   = edges.length;

    // Índice de complexidade simples (McCabe simplificado)
    var complexity = nIf + nEval + nLoop + nGoto + 1;
    var complexLbl = complexity <= 5  ? '&#128994; Baixa'  :
                     complexity <= 10 ? '&#128993; Média'  :
                     complexity <= 20 ? '&#128308; Alta'   : '&#128308; Muito Alta';

    // ── KPIs principais ──
    html += '<div class="rep-section-title">Estrutura do Programa</div>';
    html += '<div class="rep-kpi-row">';
    html += _repKpi('Total de nós',       nTotal);
    html += _repKpi('Conexões',           nEdges);
    html += _repKpi('Parágrafos/Seções',  nPara);
    html += _repKpi('Condições IF',       nIf);
    html += _repKpi('EVALUATE',           nEval);
    html += _repKpi('Loops',              nLoop);
    html += '</div>';

    html += '<div class="rep-kpi-row">';
    html += _repKpi('READ',    nRead);
    html += _repKpi('WRITE',   nWrite);
    html += _repKpi('CALL',    nCall);
    html += _repKpi('SQL',     nSql);
    html += _repKpi('GO TO',   nGoto);
    html += _repKpi('STOP RUN',nStop);
    html += '</div>';

    // ── Complexidade ──
    html += '<div class="rep-section-title">Complexidade Ciclomática (estimativa)</div>';
    html += '<div class="rep-ov-complexity">';
    html += '<span class="rep-ov-complexity-val">' + complexity + '</span>';
    html += '<span class="rep-ov-complexity-lbl">' + complexLbl + '</span>';
    html += '<span class="rep-ov-complexity-hint">IFs(' + nIf + ') + EVALUATEs(' + nEval + ') + Loops(' + nLoop + ') + GOTOs(' + nGoto + ') + 1</span>';
    html += '</div>';

    // ── Lista de parágrafos ──
    var paraNodes = nodes.filter(function(n){
      var t = n.data('tipo'); return t === 'para' || t === 'paragrafo' || t === 'section';
    });
    if (paraNodes.length > 0) {
      html += '<div class="rep-section-title">Parágrafos / Seções (' + paraNodes.length + ')</div>';
      html += '<div class="rep-ov-para-grid">';
      paraNodes.forEach(function(n) {
        var lbl   = _repEscHtml((n.data('label') || n.id()).split('\n')[0].trim());
        var tipo  = n.data('tipo') === 'section' ? 'SEC' : 'PAR';
        var tipoCls = n.data('tipo') === 'section' ? 'rep-ov-para-sec' : 'rep-ov-para-par';
        html += '<div class="rep-ov-para-item">' +
          '<span class="rep-ov-para-tag ' + tipoCls + '">' + tipo + '</span>' +
          '<span class="rep-ov-para-name" title="' + lbl + '">' + lbl + '</span>' +
          '</div>';
      });
      html += '</div>';
    }

    // ── CALLs externos ──
    var callNodes = nodes.filter(function(n){ return n.data('tipo') === 'call'; });
    if (callNodes.length > 0) {
      html += '<div class="rep-section-title">Programas Chamados via CALL (' + callNodes.length + ')</div>';
      html += '<div class="rep-ov-call-list">';
      callNodes.forEach(function(n) {
        var lbl = (n.data('label') || '').replace(/^CALL\s+/i,'').split('\n')[0].trim();
        html += '<span class="rep-ov-call-badge" title="' + _repEscHtml(lbl) + '">' + _repEscHtml(lbl.substring(0,40)) + '</span>';
      });
      html += '</div>';
    }

  } else {
    html += '<div class="rep-empty" style="margin-top:32px;">' +
      '<div class="rep-empty-icon">&#128209;</div>' +
      '<div>Nenhum fluxo gerado ainda.</div>' +
      '<div class="rep-empty-hint">Importe o código COBOL e clique em <b>&#9654; Gerar Fluxo</b> para ver a visão geral do programa.</div>' +
      '</div>';
  }

  // ── Histórico de simulações (resumo rápido) ──
  if (hasSc) {
    var last = _repScenarios[_repScenarios.length - 1];
    var dur  = (last.startTime && last.endTime) ? ((last.endTime - last.startTime) / 1000).toFixed(1) + 's' : '--';
    html += '<div class="rep-section-title">Última Simulação</div>';
    html += '<div class="rep-ov-last-run">';
    html += '<div class="rep-ov-last-row"><span>Cenário</span><b>#' + last.id + '</b></div>';
    html += '<div class="rep-ov-last-row"><span>Status</span><b>' + _repEscHtml(last.status) + '</b></div>';
    html += '<div class="rep-ov-last-row"><span>Passos</span><b>' + last.steps + '</b></div>';
    html += '<div class="rep-ov-last-row"><span>Nós únicos</span><b>' + Object.keys(last.nodesVisitedSet).length + '</b></div>';
    html += '<div class="rep-ov-last-row"><span>Ramos</span><b>' + last.branches.length + '</b></div>';
    html += '<div class="rep-ov-last-row"><span>Duração</span><b>' + dur + '</b></div>';
    html += '<button class="rep-btn rep-btn-xs rep-ov-goto-btn" onclick="_repShowTab(\'execsummary\')" style="margin-top:10px;">&#9654; Ver Resumo de Execução</button>';
    html += '</div>';
  }

  html += '</div>'; // overview-wrap
  pane.innerHTML = html;
}

// ── Aba: Resumo de Execução ──────────────────────────────────────

function _repRenderExecSummary() {
  var pane = document.getElementById('rep-pane-execsummary');
  if (!pane) return;

  // Usa o cenário em andamento ou o mais recente concluído
  var sc = _repCurrent || (_repScenarios.length > 0 ? _repScenarios[_repScenarios.length - 1] : null);

  if (!sc) {
    pane.innerHTML =
      '<div class="rep-empty">' +
        '<div class="rep-empty-icon">&#9654;</div>' +
        '<div>Nenhuma execução registrada ainda.</div>' +
        '<div class="rep-empty-hint">Execute a simulação (&#9654;) para gerar o resumo de execução.</div>' +
      '</div>';
    return;
  }

  var isLive  = (sc === _repCurrent);
  var tStart  = sc.startTime instanceof Date ? sc.startTime.toLocaleString('pt-BR') : '--';
  var tEnd    = sc.endTime   instanceof Date ? sc.endTime.toLocaleString('pt-BR')   : (isLive ? '(em andamento)' : '--');
  var dur     = (sc.startTime && sc.endTime) ? ((sc.endTime - sc.startTime) / 1000).toFixed(2) + 's' : (isLive ? '...' : '--');
  var statusMap = { 'concluido': '&#9989; Concluído', 'interrompido': '&#9209; Interrompido',
                    'cancelado': '&#10060; Cancelado', 'em-andamento': '&#9654; Em andamento', 'breakpoint': '&#9208; Breakpoint' };
  var statusHtml = statusMap[sc.status] || _repEscHtml(sc.status);
  var uniqueNodes = Object.keys(sc.nodesVisitedSet).length;

  var html = '<div class="rep-exsum-wrap">';

  // ── Cabeçalho do cenário ──
  html += '<div class="rep-exsum-header' + (isLive ? ' rep-exsum-live' : '') + '">';
  html += '<div class="rep-exsum-title">' + (isLive ? '&#128994; ' : '') + 'Cenário #' + sc.id + (isLive ? ' &mdash; Em andamento' : '') + '</div>';
  html += '<div class="rep-exsum-status">' + statusHtml + '</div>';
  html += '</div>';

  // ── Linha do tempo ──
  html += '<div class="rep-exsum-timeline">';
  html += '<div class="rep-exsum-tl-item"><span class="rep-exsum-tl-lbl">&#9201; Início</span><span class="rep-exsum-tl-val">' + tStart + '</span></div>';
  html += '<div class="rep-exsum-tl-sep">&#8594;</div>';
  html += '<div class="rep-exsum-tl-item"><span class="rep-exsum-tl-lbl">&#9201; Fim</span><span class="rep-exsum-tl-val">' + tEnd + '</span></div>';
  html += '<div class="rep-exsum-tl-dur"><span class="rep-exsum-tl-lbl">Duração</span><span class="rep-exsum-tl-val rep-exsum-tl-dur-val">' + dur + '</span></div>';
  html += '</div>';

  // ── KPIs ──
  html += '<div class="rep-section-title">Métricas de Execução</div>';
  html += '<div class="rep-kpi-row">';
  html += _repKpi('Passos totais',       sc.steps);
  html += _repKpi('Nós únicos',          uniqueNodes);
  html += _repKpi('Ramos IF/EVALUATE',   sc.branches.length);
  html += _repKpi('Auto-resolvidos',     sc.autoResolvedBranches);
  html += _repKpi('Manuais',             sc.manualBranches);
  html += _repKpi('Loops',               sc.loops.length);
  html += _repKpi('Iter. em loops',      sc.totalLoopIterations);
  html += _repKpi('Vars alteradas',      sc.varsChanged.length);
  html += '</div>';

  // ── Parágrafos executados ──
  var paraKeys = Object.keys(sc.paragraphs);
  if (paraKeys.length > 0) {
    html += '<div class="rep-section-title">Parágrafos Executados (' + paraKeys.length + ')</div>';
    html += '<div class="rep-exsum-para-row">';
    // Ordena por count décrescente
    paraKeys.sort(function(a,b){ return sc.paragraphs[b] - sc.paragraphs[a]; });
    paraKeys.forEach(function(p) {
      var cnt = sc.paragraphs[p];
      html += '<span class="rep-para-badge" title="' + _repEscHtml(p) + ' (' + cnt + 'x)">' +
              _repEscHtml(p.substring(0, 30)) + ' <sup>' + cnt + 'x</sup></span>';
    });
    html += '</div>';
  }

  // ── Caminho de execução (últimos 30 nós) ──
  if (sc.nodesVisited.length > 0) {
    html += '<div class="rep-section-title">Caminho de Execução (' + sc.nodesVisited.length + ' passos' + (sc.nodesVisited.length > 30 ? ', últimos 30' : '') + ')</div>';
    html += '<div class="rep-exsum-path">';
    var slice = sc.nodesVisited.length > 30 ? sc.nodesVisited.slice(-30) : sc.nodesVisited;
    if (sc.nodesVisited.length > 30) {
      html += '<span class="rep-exsum-path-ell">&#8230; (' + (sc.nodesVisited.length - 30) + ' passos anteriores omitidos)</span>';
    }
    var tipoClsMap = { 'if':'rep-exsum-node-if','loop':'rep-exsum-node-loop','para':'rep-exsum-node-para',
      'paragrafo':'rep-exsum-node-para','section':'rep-exsum-node-sec',
      'stop':'rep-exsum-node-stop','call':'rep-exsum-node-call','sql':'rep-exsum-node-sql',
      'read':'rep-exsum-node-file','write':'rep-exsum-node-file','open':'rep-exsum-node-file','close':'rep-exsum-node-file' };
    slice.forEach(function(n, i) {
      var cls = 'rep-exsum-node ' + (tipoClsMap[n.tipo] || '');
      var lbl = (n.label || n.id).split('\n')[0].trim().substring(0, 35);
      if (i > 0) html += '<span class="rep-exsum-node-arrow">&#8594;</span>';
      html += '<span class="' + cls + '" title="' + _repEscHtml(n.label || n.id) + '">' + _repEscHtml(lbl) + '</span>';
    });
    html += '</div>';
  }

  // ── Desvios tomados ──
  if (sc.branches.length > 0) {
    html += '<div class="rep-section-title">Desvios Tomados (' + sc.branches.length + ')</div>';
    html += '<table class="rep-table rep-table-compact"><thead><tr><th>Passo</th><th>Condição</th><th>Resultado</th><th>Modo</th></tr></thead><tbody>';
    sc.branches.slice(0, 25).forEach(function(b) {
      html += '<tr>' +
        '<td class="rep-td-num">' + b.step + '</td>' +
        '<td class="rep-td-cond">' + _repEscHtml(b.condition.substring(0,60)) + '</td>' +
        '<td class="rep-td-res">'  + _repEscHtml(b.result) + '</td>' +
        '<td>' + (b.wasAuto ? '<span class="rep-auto-badge">AUTO</span>' : '<span class="rep-manual-badge">MANUAL</span>') + '</td></tr>';
    });
    if (sc.branches.length > 25) {
      html += '<tr><td colspan="4" class="rep-exsum-more">&#8230; mais ' + (sc.branches.length - 25) + ' desvios — ver aba Cenários</td></tr>';
    }
    html += '</tbody></table>';
  }

  // ── Variáveis mais alteradas ──
  if (sc.varsChanged.length > 0) {
    // Agrupa por nome, pega o último valor
    var varMap = {};
    sc.varsChanged.forEach(function(v) { varMap[v.name] = v; });
    var varList = Object.keys(varMap).map(function(k){ return varMap[k]; }).slice(0, 15);
    html += '<div class="rep-section-title">Variáveis Alteradas — Valores Finais (top ' + varList.length + ')</div>';
    html += '<table class="rep-table rep-table-compact"><thead><tr><th>Variável</th><th>Último valor</th><th>Passo</th></tr></thead><tbody>';
    varList.forEach(function(v) {
      html += '<tr>' +
        '<td class="rep-td-var">' + _repEscHtml(v.name) + '</td>' +
        '<td class="rep-td-val rep-td-val-new"><b>' + _repEscHtml(v.to) + '</b></td>' +
        '<td class="rep-td-num">' + v.step + '</td></tr>';
    });
    if (sc.varsChanged.length > 15) {
      html += '<tr><td colspan="3" class="rep-exsum-more">&#8230; ' + (sc.varsChanged.length - 15) + ' alterações adicionais — ver aba Cenários</td></tr>';
    }
    html += '</tbody></table>';
  }

  // ── Operações em arquivos ──
  var fdNames = Object.keys(sc.fileOps);
  if (fdNames.length > 0) {
    html += '<div class="rep-section-title">Operações em Arquivos</div>';
    html += '<table class="rep-table rep-table-compact"><thead><tr><th>Arquivo</th><th>Opens</th><th>Reads</th><th>Writes</th><th>Closes</th></tr></thead><tbody>';
    fdNames.forEach(function(fd) {
      var fo = sc.fileOps[fd];
      html += '<tr><td><b>' + _repEscHtml(fd) + '</b></td>' +
        '<td class="rep-td-num">' + fo.opens  + '</td>' +
        '<td class="rep-td-num">' + fo.reads  + '</td>' +
        '<td class="rep-td-num">' + fo.writes + '</td>' +
        '<td class="rep-td-num">' + fo.closes + '</td></tr>';
    });
    html += '</tbody></table>';
  }

  // ── Seletor de cenário (se houver mais de 1) ──
  if (_repScenarios.length > 1) {
    html += '<div class="rep-section-title" style="margin-top:28px;">Outros cenários disponíveis</div>';
    html += '<div class="rep-exsum-scenario-list">';
    _repScenarios.slice().reverse().forEach(function(s) {
      var active = (sc.id === s.id) ? ' rep-exsum-sc-active' : '';
      var d = (s.startTime && s.endTime) ? ((s.endTime - s.startTime) / 1000).toFixed(1) + 's' : '--';
      html += '<div class="rep-exsum-sc-item' + active + '" onclick="_repExsumSelectScenario(' + s.id + ')">' +
        '<b>#' + s.id + '</b> &nbsp; ' + _repEscHtml(s.status) + ' &nbsp; ' + s.steps + ' passos &nbsp; ' + d +
        '</div>';
    });
    html += '</div>';
  }

  html += '</div>'; // exsum-wrap
  pane.innerHTML = html;
}

var _repExsumSelectedId = null;
function _repExsumSelectScenario(id) {
  // Temporariamente exibe o cenário com o id selecionado
  _repExsumSelectedId = id;
  var pane = document.getElementById('rep-pane-execsummary');
  if (!pane) return;
  // Reutiliza a renderização mas com o cenário selecionado
  var origCurrent = _repCurrent;
  var found = _repScenarios.find(function(s){ return s.id === id; });
  if (!found) return;
  _repCurrent = null; // temporário para forçar cenário específico
  var scBak = _repScenarios;
  // Reordena para que o selecionado seja último (=mais recente na lógica de _repRenderExecSummary)
  _repScenarios = [found];
  _repRenderExecSummary();
  _repScenarios = scBak;
  _repCurrent = origCurrent;
}

// ── Aba: Cenários ────────────────────────────────────────────────

function _repRenderScenarios() {
  var pane = document.getElementById('rep-pane-scenarios');
  if (!pane) return;

  if (_repScenarios.length === 0) {
    pane.innerHTML =
      '<div class="rep-empty">' +
        '<div class="rep-empty-icon">&#128202;</div>' +
        '<div>Nenhum cenário registrado ainda.</div>' +
        '<div class="rep-empty-hint">Execute a simulação (▶) para gerar um cenário.</div>' +
      '</div>';
    return;
  }

  var html = '<div class="rep-scenario-list">';

  // Cenário em andamento (se houver)
  if (_repCurrent) {
    html += _repScenarioCard(_repCurrent, true);
  }

  // Cenários concluídos (mais recente primeiro)
  var rev = _repScenarios.slice().reverse();
  rev.forEach(function(sc) {
    html += _repScenarioCard(sc, false);
  });

  html += '</div>';
  pane.innerHTML = html;
}

function _repScenarioCard(sc, isLive) {
  var tStart = sc.startTime instanceof Date ? sc.startTime.toLocaleTimeString('pt-BR') : '--';
  var tEnd   = sc.endTime   instanceof Date ? sc.endTime.toLocaleTimeString('pt-BR')   : '--';
  var dur    = (sc.startTime && sc.endTime)
    ? ((sc.endTime - sc.startTime) / 1000).toFixed(1) + 's'
    : (isLive ? '...' : '--');
  var statusCls  = 'rep-status-' + sc.status.replace(/[^a-z]/g, '-');
  var statusLbl  = { 'concluido': '✔ Concluído', 'interrompido': '⏹ Interrompido', 'cancelado': '✕ Cancelado', 'em-andamento': '▶ Em andamento', 'breakpoint': '⏸ Breakpoint' };
  var lbl        = statusLbl[sc.status] || sc.status;
  var isExpanded = (_repActiveScenario === sc.id);
  var uniqueNodes = Object.keys(sc.nodesVisitedSet).length;

  var html = '<div class="rep-sc-card' + (isLive ? ' rep-sc-live' : '') + '" id="rep-sc-' + sc.id + '">';
  html += '<div class="rep-sc-header" onclick="_repToggleScenario(' + sc.id + ')">';
  html += '<span class="rep-sc-num">#' + sc.id + '</span>';
  html += '<span class="rep-sc-status ' + statusCls + '">' + lbl + '</span>';
  html += '<span class="rep-sc-meta">' + tStart + ' → ' + tEnd + ' (' + dur + ')</span>';
  html += '<span class="rep-sc-kpi"><b>' + sc.steps + '</b> passos &nbsp; <b>' + uniqueNodes + '</b> nós únicos &nbsp; <b>' + sc.branches.length + '</b> ramos</span>';
  html += '<span class="rep-sc-toggle">' + (isExpanded ? '▲' : '▼') + '</span>';
  html += '</div>'; // header

  if (isExpanded) {
    html += '<div class="rep-sc-body">';

    // KPIs
    html += '<div class="rep-kpi-row">';
    html += _repKpi('Passos totais',     sc.steps);
    html += _repKpi('Nós únicos',        uniqueNodes);
    html += _repKpi('Ramos auto',        sc.autoResolvedBranches);
    html += _repKpi('Ramos manuais',     sc.manualBranches);
    html += _repKpi('Loops',             sc.loops.length);
    html += _repKpi('Iter. loops',       sc.totalLoopIterations);
    html += _repKpi('Ops. arquivos',     _repTotalFileOps(sc));
    html += _repKpi('Vars alteradas',    sc.varsChanged.length);
    html += '</div>';

    // Parágrafos visitados
    var paraKeys = Object.keys(sc.paragraphs);
    if (paraKeys.length > 0) {
      html += '<div class="rep-section-title">Parágrafos / Seções Visitados</div>';
      html += '<div class="rep-para-list">';
      paraKeys.forEach(function(p) {
        html += '<span class="rep-para-badge" title="' + _repEscHtml(p) + '">' + _repEscHtml(p) + ' <sup>' + sc.paragraphs[p] + 'x</sup></span>';
      });
      html += '</div>';
    }

    // Ramos de desvio
    if (sc.branches.length > 0) {
      html += '<div class="rep-section-title">Ramos de Desvio</div>';
      html += '<table class="rep-table"><thead><tr><th>Passo</th><th>Condição</th><th>Resultado</th><th>Modo</th></tr></thead><tbody>';
      sc.branches.forEach(function(b) {
        html += '<tr><td class="rep-td-num">' + b.step + '</td>' +
          '<td class="rep-td-cond">' + _repEscHtml(b.condition) + '</td>' +
          '<td class="rep-td-res">'  + _repEscHtml(b.result)    + '</td>' +
          '<td>' + (b.wasAuto ? '<span class="rep-auto-badge">AUTO</span>' : '<span class="rep-manual-badge">MANUAL</span>') + '</td></tr>';
      });
      html += '</tbody></table>';
    }

    // Loops
    if (sc.loops.length > 0) {
      html += '<div class="rep-section-title">Loops</div>';
      html += '<table class="rep-table"><thead><tr><th>Label</th><th>Iterações</th></tr></thead><tbody>';
      sc.loops.forEach(function(lp) {
        html += '<tr><td>' + _repEscHtml(lp.label) + '</td><td class="rep-td-num">' + lp.iterations + '</td></tr>';
      });
      html += '</tbody></table>';
    }

    // Operações em arquivos
    var fdNames = Object.keys(sc.fileOps);
    if (fdNames.length > 0) {
      html += '<div class="rep-section-title">Operações em Arquivos</div>';
      html += '<table class="rep-table"><thead><tr><th>Arquivo</th><th>Opens</th><th>Closes</th><th>Reads</th><th>Writes</th></tr></thead><tbody>';
      fdNames.forEach(function(fd) {
        var fo = sc.fileOps[fd];
        html += '<tr><td><b>' + _repEscHtml(fd) + '</b></td>' +
          '<td class="rep-td-num">' + fo.opens  + '</td>' +
          '<td class="rep-td-num">' + fo.closes + '</td>' +
          '<td class="rep-td-num">' + fo.reads  + '</td>' +
          '<td class="rep-td-num">' + fo.writes + '</td></tr>';
      });
      html += '</tbody></table>';
    }

    // Variáveis alteradas
    if (sc.varsChanged.length > 0) {
      html += '<div class="rep-section-title">Variáveis Alteradas (' + sc.varsChanged.length + ')</div>';
      html += '<div style="max-height:200px;overflow-y:auto;">';
      html += '<table class="rep-table rep-table-compact"><thead><tr><th>Passo</th><th>Variável</th><th>De</th><th>Para</th></tr></thead><tbody>';
      // Mostra os últimos 100 se for muito extenso
      var vc = sc.varsChanged.length > 100 ? sc.varsChanged.slice(-100) : sc.varsChanged;
      if (sc.varsChanged.length > 100) {
        html += '<tr><td colspan="4" style="text-align:center;opacity:.6;font-style:italic">... ' + (sc.varsChanged.length - 100) + ' registros anteriores omitidos ...</td></tr>';
      }
      vc.forEach(function(v) {
        html += '<tr><td class="rep-td-num">' + v.step + '</td>' +
          '<td class="rep-td-var">' + _repEscHtml(v.name) + '</td>' +
          '<td class="rep-td-val">' + _repEscHtml(v.from) + '</td>' +
          '<td class="rep-td-val rep-td-val-new">' + _repEscHtml(v.to) + '</td></tr>';
      });
      html += '</tbody></table>';
      html += '</div>';
    }

    // Log do cenário
    if (sc.log.length > 0) {
      html += '<div class="rep-section-title">Log deste Cenário (' + sc.log.length + ' linhas)</div>';
      html += '<div class="rep-log-mini">';
      sc.log.forEach(function(l) {
        var cls = l.cls ? ' class="' + _repEscHtml(l.cls) + '"' : '';
        html += '<div' + cls + '><span class="rep-log-time">' + l.time + '</span> ' + _repEscHtml(l.text) + '</div>';
      });
      html += '</div>';
    }

    html += '</div>'; // sc-body
  }

  html += '</div>'; // sc-card
  return html;
}

function _repToggleScenario(id) {
  _repActiveScenario = (_repActiveScenario === id) ? null : id;
  _repRenderScenarios();
}

function _repKpi(label, value) {
  return '<div class="rep-kpi"><div class="rep-kpi-val">' + String(value) + '</div><div class="rep-kpi-lbl">' + label + '</div></div>';
}

function _repTotalFileOps(sc) {
  var tot = 0;
  Object.keys(sc.fileOps).forEach(function(fd) {
    var fo = sc.fileOps[fd];
    tot += fo.reads + fo.writes + fo.opens + fo.closes;
  });
  return tot;
}

// ── Aba: Estatísticas ─────────────────────────────────────────────

function _repRenderStats() {
  var pane = document.getElementById('rep-pane-stats');
  if (!pane) return;

  if (_repScenarios.length === 0) {
    pane.innerHTML = '<div class="rep-empty"><div class="rep-empty-icon">&#128200;</div><div>Nenhum dado disponível. Execute pelo menos um cenário.</div></div>';
    return;
  }

  var total       = _repScenarios.length;
  var concluidos  = _repScenarios.filter(function(s){ return s.status === 'concluido'; }).length;
  var interrompidos = total - concluidos;
  var allSteps    = _repScenarios.map(function(s){ return s.steps; });
  var allDurs     = _repScenarios
    .filter(function(s){ return s.startTime && s.endTime; })
    .map(function(s){ return (s.endTime - s.startTime) / 1000; });
  var allBranches = _repScenarios.map(function(s){ return s.branches.length; });
  var allVars     = _repScenarios.map(function(s){ return s.varsChanged.length; });

  var avgSteps = allSteps.length ? (allSteps.reduce(function(a,b){return a+b;},0) / allSteps.length).toFixed(1) : '--';
  var maxSteps = allSteps.length ? Math.max.apply(null, allSteps) : '--';
  var minSteps = allSteps.length ? Math.min.apply(null, allSteps) : '--';
  var avgDur   = allDurs.length  ? (allDurs.reduce(function(a,b){return a+b;},0)  / allDurs.length ).toFixed(2) + 's' : '--';
  var maxDur   = allDurs.length  ? Math.max.apply(null, allDurs).toFixed(2) + 's' : '--';

  // Nós mais visitados (agregado)
  var nodeCount = {};
  _repScenarios.forEach(function(sc) {
    sc.nodesVisited.forEach(function(n) {
      nodeCount[n.label] = (nodeCount[n.label] || 0) + 1;
    });
  });
  var topNodes = Object.keys(nodeCount)
    .map(function(k){ return { label: k, count: nodeCount[k] }; })
    .sort(function(a,b){ return b.count - a.count; })
    .slice(0, 15);

  // Arquivos mais acessados
  var fileAccess = {};
  _repScenarios.forEach(function(sc) {
    Object.keys(sc.fileOps).forEach(function(fd) {
      if (!fileAccess[fd]) fileAccess[fd] = { reads:0, writes:0, opens:0, closes:0 };
      var fo = sc.fileOps[fd];
      fileAccess[fd].reads  += fo.reads;
      fileAccess[fd].writes += fo.writes;
      fileAccess[fd].opens  += fo.opens;
      fileAccess[fd].closes += fo.closes;
    });
  });

  // Variáveis mais alteradas
  var varCount = {};
  _repScenarios.forEach(function(sc) {
    sc.varsChanged.forEach(function(v) {
      varCount[v.name] = (varCount[v.name] || 0) + 1;
    });
  });
  var topVars = Object.keys(varCount)
    .map(function(k){ return { name: k, count: varCount[k] }; })
    .sort(function(a,b){ return b.count - a.count; })
    .slice(0, 20);

  var autoTotal   = _repScenarios.reduce(function(a,s){ return a + s.autoResolvedBranches; }, 0);
  var manualTotal = _repScenarios.reduce(function(a,s){ return a + s.manualBranches; }, 0);
  var loopTotal   = _repScenarios.reduce(function(a,s){ return a + s.totalLoopIterations; }, 0);

  var html = '<div class="rep-stats-wrap">';

  // Resumo geral
  html += '<div class="rep-section-title">Resumo Geral</div>';
  html += '<div class="rep-kpi-row">';
  html += _repKpi('Total de cenários',  total);
  html += _repKpi('Concluídos',         concluidos);
  html += _repKpi('Interrompidos',      interrompidos);
  html += _repKpi('Média de passos',    avgSteps);
  html += _repKpi('Máx. passos',        maxSteps);
  html += _repKpi('Mín. passos',        minSteps);
  html += _repKpi('Duração média',      avgDur);
  html += _repKpi('Duração máx.',       maxDur);
  html += '</div>';

  // Desvios
  html += '<div class="rep-section-title">Desvios (IF / EVALUATE)</div>';
  html += '<div class="rep-kpi-row">';
  html += _repKpi('Total ramos',   autoTotal + manualTotal);
  html += _repKpi('Automáticos',   autoTotal);
  html += _repKpi('Manuais',       manualTotal);
  html += _repKpi('Iter. em loops',loopTotal);
  html += '</div>';

  // Top nós visitados
  if (topNodes.length > 0) {
    html += '<div class="rep-section-title">Nós Mais Executados (top 15)</div>';
    html += '<div class="rep-stats-bar-list">';
    var maxCnt = topNodes[0].count;
    topNodes.forEach(function(n, i) {
      var pct = maxCnt > 0 ? Math.round((n.count / maxCnt) * 100) : 0;
      html += '<div class="rep-stats-bar-row">' +
        '<div class="rep-stats-bar-rank">' + (i+1) + '</div>' +
        '<div class="rep-stats-bar-label" title="' + _repEscHtml(n.label) + '">' + _repEscHtml(n.label.substring(0, 40)) + '</div>' +
        '<div class="rep-stats-bar-track"><div class="rep-stats-bar-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="rep-stats-bar-val">' + n.count + '</div>' +
        '</div>';
    });
    html += '</div>';
  }

  // Variáveis mais alteradas
  if (topVars.length > 0) {
    html += '<div class="rep-section-title">Variáveis Mais Alteradas (top 20)</div>';
    html += '<div class="rep-stats-bar-list">';
    var maxVcnt = topVars[0].count;
    topVars.forEach(function(v, i) {
      var pct = maxVcnt > 0 ? Math.round((v.count / maxVcnt) * 100) : 0;
      html += '<div class="rep-stats-bar-row">' +
        '<div class="rep-stats-bar-rank">' + (i+1) + '</div>' +
        '<div class="rep-stats-bar-label rep-td-var" title="' + _repEscHtml(v.name) + '">' + _repEscHtml(v.name) + '</div>' +
        '<div class="rep-stats-bar-track"><div class="rep-stats-bar-fill rep-stats-bar-fill--var" style="width:' + pct + '%"></div></div>' +
        '<div class="rep-stats-bar-val">' + v.count + '</div>' +
        '</div>';
    });
    html += '</div>';
  }

  // Operações em arquivos
  var fdNames = Object.keys(fileAccess);
  if (fdNames.length > 0) {
    html += '<div class="rep-section-title">Operações Acumuladas em Arquivos</div>';
    html += '<table class="rep-table"><thead><tr><th>Arquivo</th><th>Opens</th><th>Closes</th><th>Reads</th><th>Writes</th><th>Total</th></tr></thead><tbody>';
    fdNames.forEach(function(fd) {
      var fo  = fileAccess[fd];
      var tot = fo.opens + fo.closes + fo.reads + fo.writes;
      html += '<tr><td><b>' + _repEscHtml(fd) + '</b></td>' +
        '<td class="rep-td-num">' + fo.opens  + '</td>' +
        '<td class="rep-td-num">' + fo.closes + '</td>' +
        '<td class="rep-td-num">' + fo.reads  + '</td>' +
        '<td class="rep-td-num">' + fo.writes + '</td>' +
        '<td class="rep-td-num rep-td-val-new"><b>' + tot + '</b></td></tr>';
    });
    html += '</tbody></table>';
  }

  html += '</div>'; // stats-wrap
  pane.innerHTML = html;
}

function _repRenderStatsSeq(sc) {
  if (!sc || !sc.paraSeq || sc.paraSeq.length === 0) return '';
  var nodeHits = sc.nodeHits || {};
  var html = '';

  // Sequência de execução
  html += '<div class="rep-section-title">&#128221; Sequência de execução — Cenário #' + sc.id + ' (' + sc.paraSeq.length + ' passo(s))</div>';
  html += '<div class="rep-stats-seq-wrap">';
  html += '<table class="rep-table rep-stats-seq-table">';
  html += '<thead><tr><th style="width:48px">Passo</th><th style="width:80px">Tipo</th><th>Nó</th><th style="width:54px">Hits</th></tr></thead><tbody>';
  sc.paraSeq.forEach(function(s) {
    var hits = nodeHits[s.id] || 1;
    html += '<tr>' +
      '<td class="rep-td-num">' + s.step + '</td>' +
      '<td><span class="rep-badge-tipo">' + _repEscHtml(s.tipo || '?') + '</span></td>' +
      '<td class="rep-td-label">' + _repEscHtml(s.label) + '</td>' +
      '<td class="rep-td-num rep-td-hits">' + hits + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  html += '</div>';

  // Ranking por acionamentos
  var entries = Object.keys(nodeHits).map(function(id) {
    var entry = sc.paraSeq.find(function(s){ return s.id === id; });
    return { label: entry ? entry.label : id, tipo: entry ? (entry.tipo||'?') : '?', hits: nodeHits[id] };
  }).sort(function(a,b){ return b.hits - a.hits; });

  if (entries.length > 0) {
    html += '<div class="rep-section-title">&#128202; Acionamentos por nó — ' + entries.length + ' nó(s)</div>';
    html += '<div class="rep-stats-bar-list">';
    var maxH = entries[0].hits;
    entries.forEach(function(e, i) {
      var pct = maxH > 0 ? Math.round((e.hits / maxH) * 100) : 0;
      html += '<div class="rep-stats-bar-row">' +
        '<div class="rep-stats-bar-rank">' + (i+1) + '</div>' +
        '<div class="rep-stats-bar-label" title="' + _repEscHtml(e.label) + '">' + _repEscHtml(e.label.substring(0,36)) + '</div>' +
        '<div class="rep-stats-bar-track"><div class="rep-stats-bar-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="rep-stats-bar-val">' + e.hits + '</div>' +
        '</div>';
    });
    html += '</div>';
  }
  return html;
}

// ── Aba: Log Completo ─────────────────────────────────────────────

function _repSetLogFilter(f) {
  _repLogFilter = f;
  _repRenderLog();
}

function _repRenderLog() {
  var pane = document.getElementById('rep-pane-log');
  if (!pane) return;

  // Agrega todos os logs de todos os cenários
  var allLog = [];
  _repScenarios.forEach(function(sc) {
    allLog.push({ text: '══ Cenário #' + sc.id + ' — ' + sc.status.toUpperCase() + ' ══', cls: 'rep-log-header', type: '_header', time: sc.startTime ? sc.startTime.toLocaleTimeString('pt-BR') : '' });
    sc.log.forEach(function(l) { allLog.push(l); });
  });
  if (_repCurrent && _repCurrent.log.length > 0) {
    allLog.push({ text: '══ Cenário #' + _repCurrent.id + ' — EM ANDAMENTO ══', cls: 'rep-log-header rep-log-live', type: '_header', time: _repCurrent.startTime ? _repCurrent.startTime.toLocaleTimeString('pt-BR') : '' });
    _repCurrent.log.forEach(function(l) { allLog.push(l); });
  }

  if (allLog.length === 0) {
    pane.innerHTML = '<div class="rep-empty"><div class="rep-empty-icon">&#128220;</div><div>Nenhum log registrado ainda.</div></div>';
    return;
  }

  // Contadores por tipo para os badges dos botões
  var counts = { step: 0, var: 0, file: 0, 'file-var': 0, branch: 0, loop: 0 };
  allLog.forEach(function(l) { if (l.type && counts[l.type] !== undefined) counts[l.type]++; });

  // Filtra (headers sempre aparecem)
  var filtered = allLog.filter(function(l) {
    if (l.type === '_header') return true;
    if (_repLogFilter === 'all') return true;
    if (_repLogFilter === 'file') return l.type === 'file' || l.type === 'file-var';
    if (_repLogFilter === 'var')  return l.type === 'var'  || l.type === 'file-var';
    return l.type === _repLogFilter;
  });

  var filterDefs = [
    { key: 'all',    icon: '☰',  label: 'Tudo',       count: allLog.filter(function(l){return l.type!=='_header';}).length },
    { key: 'step',   icon: '▸',  label: 'Passos',     count: counts.step },
    { key: 'var',    icon: '✎',  label: 'Variáveis',  count: counts.var + counts['file-var'] },
    { key: 'file',   icon: '📂', label: 'Arquivos',   count: counts.file + counts['file-var'] },
    { key: 'branch', icon: '⬦',  label: 'Desvios',    count: counts.branch },
    { key: 'loop',   icon: '↻',  label: 'Loops',      count: counts.loop }
  ];

  var html = '<div class="rep-log-toolbar">';
  filterDefs.forEach(function(f) {
    var active = (_repLogFilter === f.key) ? ' rep-log-filter-active' : '';
    html += '<button class="rep-btn rep-btn-xs rep-log-filter-btn' + active + '" onclick="_repSetLogFilter(\'' + f.key + '\')">'
         + f.icon + ' ' + f.label
         + (f.count > 0 ? ' <span class="rep-log-badge">' + f.count + '</span>' : '')
         + '</button>';
  });
  html += '<div style="flex:1"></div>';
  html += '<button class="rep-btn rep-btn-xs" onclick="_repCopyLog()" title="Copiar log para clipboard">&#128203;</button>';
  html += '<button class="rep-btn rep-btn-xs" onclick="_repDownloadLog()" title="Baixar como .txt">&#8595; .txt</button>';
  html += '<span class="rep-log-count">' + filtered.filter(function(l){return l.type!=='_header';}).length + ' entradas</span>';
  html += '</div>';

  html += '<div class="rep-log-full" id="rep-log-full-el">';
  filtered.forEach(function(l) {
    var cls = 'rep-log-line';
    if (l.cls) cls += ' ' + l.cls;
    var icon = '';
    if      (l.type === 'var')      { cls += ' rep-log-line-var';      icon = '<span class="rep-log-type-icon rep-log-icon-var">✎</span>'; }
    else if (l.type === 'file')     { cls += ' rep-log-line-file';     icon = '<span class="rep-log-type-icon rep-log-icon-file">📂</span>'; }
    else if (l.type === 'file-var') { cls += ' rep-log-line-file-var'; icon = '<span class="rep-log-type-icon rep-log-icon-file-var">↳</span>'; }
    else if (l.type === 'branch')   { cls += ' rep-log-line-branch';   icon = '<span class="rep-log-type-icon rep-log-icon-branch">⬦</span>'; }
    else if (l.type === 'loop')     { cls += ' rep-log-line-loop';     icon = '<span class="rep-log-type-icon rep-log-icon-loop">↻</span>'; }
    html += '<div class="' + cls + '">'
           + '<span class="rep-log-time">' + (l.time || '') + '</span>'
           + icon
           + '<span class="rep-log-text">' + _repEscHtml(l.text) + '</span>'
           + '</div>';
  });
  html += '</div>';
  pane.innerHTML = html;
}

function _repCopyLog() {
  var el = document.querySelector('.rep-log-full');
  if (!el) return;
  var txt = '';
  el.querySelectorAll('.rep-log-line').forEach(function(d) { txt += d.textContent + '\n'; });
  navigator.clipboard.writeText(txt).then(function() {
    // feedback visual breve
    var btn = document.querySelector('.rep-log-toolbar .rep-btn');
    if (btn) { var orig = btn.textContent; btn.textContent = '✓ Copiado'; setTimeout(function(){ btn.textContent = orig; }, 1200); }
  }).catch(function() { alert('Não foi possível copiar. Use Ctrl+A no painel de log.'); });
}

function _repDownloadLog() {
  var el = document.querySelector('.rep-log-full');
  if (!el) return;
  var txt = '';
  el.querySelectorAll('.rep-log-line').forEach(function(d) { txt += d.textContent + '\n'; });
  _repDownload('cobol-flow-log.txt', txt, 'text/plain');
}

// ── Limpar histórico ──────────────────────────────────────────────

function _repClearAll() {
  if (_repScenarios.length === 0) return;
  if (!confirm('Apagar todo o histórico de cenários (' + _repScenarios.length + ')?')) return;
  _repScenarios = [];
  _repScenarioId = 0;
  _repActiveScenario = null;
  _repUpdateBadge();
  _repRenderAll();
}

// ── Exportação ───────────────────────────────────────────────────

function _repExportJSON() {
  if (_repScenarios.length === 0) { alert('Nenhum cenário para exportar.'); return; }
  var data = JSON.stringify(_repScenarios.map(function(sc) {
    return {
      id             : sc.id,
      status         : sc.status,
      inicio         : sc.startTime ? sc.startTime.toISOString() : null,
      fim            : sc.endTime   ? sc.endTime.toISOString()   : null,
      duracaoSegundos: (sc.startTime && sc.endTime) ? ((sc.endTime - sc.startTime) / 1000) : null,
      passos         : sc.steps,
      nosUnicos      : Object.keys(sc.nodesVisitedSet).length,
      paragrafos     : sc.paragraphs,
      ramos          : sc.branches,
      loops          : sc.loops,
      totalItersLoop : sc.totalLoopIterations,
      arquivos       : sc.fileOps,
      variaveisAlteradas : sc.varsChanged,
      log            : sc.log
    };
  }), null, 2);
  _repDownload('cobol-flow-relatorio.json', data, 'application/json');
}

function _repExportTXT() {
  if (_repScenarios.length === 0) { alert('Nenhum cenário para exportar.'); return; }
  var lines = [];
  lines.push('COBOL Flow — Relatório de Investigação');
  lines.push('Gerado em: ' + new Date().toLocaleString('pt-BR'));
  lines.push('='.repeat(60));
  _repScenarios.forEach(function(sc) {
    lines.push('');
    lines.push('CENÁRIO #' + sc.id + ' — ' + sc.status.toUpperCase());
    lines.push('  Início : ' + (sc.startTime ? sc.startTime.toLocaleString('pt-BR') : '--'));
    lines.push('  Fim    : ' + (sc.endTime   ? sc.endTime.toLocaleString('pt-BR')   : '--'));
    if (sc.startTime && sc.endTime) {
      lines.push('  Duração: ' + ((sc.endTime - sc.startTime) / 1000).toFixed(2) + 's');
    }
    lines.push('  Passos : ' + sc.steps + '  |  Nós únicos: ' + Object.keys(sc.nodesVisitedSet).length);
    lines.push('  Ramos  : ' + sc.branches.length + ' (auto:' + sc.autoResolvedBranches + ' manual:' + sc.manualBranches + ')');
    lines.push('  Loops  : ' + sc.loops.length + ' (' + sc.totalLoopIterations + ' iters)');
    if (sc.branches.length > 0) {
      lines.push('  -- Ramos --');
      sc.branches.forEach(function(b) {
        lines.push('    [passo ' + b.step + '] ' + b.condition + ' → ' + b.result + ' (' + (b.wasAuto ? 'auto' : 'manual') + ')');
      });
    }
    if (Object.keys(sc.fileOps).length > 0) {
      lines.push('  -- Arquivos --');
      Object.keys(sc.fileOps).forEach(function(fd) {
        var fo = sc.fileOps[fd];
        lines.push('    ' + fd + ': opens=' + fo.opens + ' closes=' + fo.closes + ' reads=' + fo.reads + ' writes=' + fo.writes);
      });
    }
    lines.push('-'.repeat(60));
  });
  _repDownload('cobol-flow-relatorio.txt', lines.join('\n'), 'text/plain');
}

// ── Utilidades ────────────────────────────────────────────────────

function _repDownload(filename, content, mimeType) {
  var blob = new Blob([content], { type: mimeType });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function() {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}

// ================================================================
// SESSÃO — exportar / restaurar dados do Relatório (workspace unificado)
// ================================================================
function _repGetSessionData() {
  return {
    scenarios:  JSON.parse(JSON.stringify(_repScenarios)),
    scenarioId: _repScenarioId
  };
}

function _repRestoreSession(data) {
  if (!data) return;
  if (Array.isArray(data.scenarios)) _repScenarios = data.scenarios;
  if (data.scenarioId) _repScenarioId = data.scenarioId;
  _repUpdateBadge();
}

function _repEscHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ================================================================
//  CENÁRIOS DE VALIDAÇÃO — Análise estática do grafo
// ================================================================

/**
 * Chamado após a geração do fluxo (por main.js).
 * Percorre todos os nós de cy e produz cenários de teste sugeridos.
 */
function _repAnalyzeFlow() {
  if (!window.cy || cy.nodes().length === 0) { _repValidation = null; return; }

  var val = {
    generatedAt : new Date(),
    programName : _repDetectProgramName(),
    scenarios   : []      // array de { id, category, priority, title, desc, objective, steps, nodeId, tag }
  };
  var sid = 0;
  function addScenario(category, priority, title, desc, objective, steps, nodeId, tag) {
    val.scenarios.push({ id: ++sid, category: category, priority: priority,
      title: title, desc: desc, objective: objective, steps: steps, nodeId: nodeId || null, tag: tag || '' });
  }

  var nodes = cy.nodes();

  // ── Coleta de elementos ─────────────────────────────────────────
  var ifNodes        = nodes.filter(function(n){ return n.data('tipo') === 'if'; });
  var evaluateNodes  = nodes.filter(function(n){ return n.data('tipo') === 'evaluate'; });
  var loopNodes      = nodes.filter(function(n){ return n.data('tipo') === 'loop'; });
  var readNodes      = nodes.filter(function(n){ return n.data('tipo') === 'read' || (n.data('tipo') === 'io' && /^READ\s/i.test(n.data('label') || '')); });
  var writeNodes     = nodes.filter(function(n){ return n.data('tipo') === 'write' || (n.data('tipo') === 'io' && /^(?:WRITE|REWRITE)\s/i.test(n.data('label') || '')); });
  var openNodes      = nodes.filter(function(n){ return n.data('tipo') === 'open'; });
  var closeNodes     = nodes.filter(function(n){ return n.data('tipo') === 'close'; });
  var callNodes      = nodes.filter(function(n){ return n.data('tipo') === 'call'; });
  var stopNodes      = nodes.filter(function(n){ return n.data('tipo') === 'stop'; });
  var paraNodes      = nodes.filter(function(n){ return n.data('tipo') === 'paragrafo' || n.data('tipo') === 'para' || n.data('tipo') === 'section'; });
  var sqlNodes       = nodes.filter(function(n){ return n.data('tipo') === 'sql'; });
  var gotoNodes      = nodes.filter(function(n){ return n.data('tipo') === 'goto'; });

  // Extrai nomes de arquivos únicos (de READ/WRITE/OPEN/CLOSE labels)
  var fileNames = {};
  nodes.forEach(function(n) {
    var lbl = (n.data('label') || '').toUpperCase();
    var m;
    m = lbl.match(/^(?:READ|WRITE|REWRITE|OPEN\s+\w+|CLOSE)\s+([A-Z][A-Z0-9-]*)/);
    if (m) fileNames[m[1]] = true;
  });
  var files = Object.keys(fileNames);

  // ── CENÁRIO 1: Fluxo principal (caminho feliz) ──────────────────
  addScenario('Funcional', 'Alta',
    'Fluxo Principal — Caminho Feliz',
    'Executa o programa completo com dados válidos e sem erros.',
    'Verificar que o programa completa normalmente (STOP RUN) processando todos os registros de entrada.',
    [
      'Preparar arquivo(s) de entrada com registros válidos',
      'Configurar variáveis de Working-Storage com valores esperados',
      'Executar a simulação (▶)',
      'Verificar que todos os IFs tomam o ramo esperado (SIM)',
      'Verificar que os arquivos de saída contêm os registros gravados corretamente',
      'Confirmar que o programa chegou ao nó STOP RUN'
    ],
    null, 'caminho-feliz');

  // ── CENÁRIO 2: Arquivo(s) vazio(s) ─────────────────────────────
  if (readNodes.length > 0) {
    readNodes.forEach(function(n) {
      var lbl = (n.data('label') || '').split('\n')[0].trim();
      var m = lbl.match(/READ\s+([A-Z][A-Z0-9-]*)/i);
      var fdName = m ? m[1] : lbl;
      addScenario('Arquivo', 'Alta',
        'Arquivo Vazio — ' + fdName,
        'Testa o comportamento quando o arquivo "' + fdName + '" não possui registros.',
        'Garantir que a condição AT END é tratada corretamente e o programa não encerra em erro.',
        [
          'Deixar o arquivo "' + fdName + '" sem nenhum registro no painel ARQUIVOS',
          'Executar a simulação',
          'Verificar que a condição AT END é acionada no nó READ ' + fdName,
          'Confirmar que o fluxo prossegue pelo ramo AT END sem erros',
          'Verificar FILE STATUS = 10 no cabeçalho do arquivo'
        ],
        n.id(), 'arquivo-vazio');
    });
  }

  // ── CENÁRIO 3: AT END com múltiplos registros ───────────────────
  if (readNodes.length > 0) {
    readNodes.forEach(function(n) {
      var lbl = (n.data('label') || '').split('\n')[0].trim();
      var m = lbl.match(/READ\s+([A-Z][A-Z0-9-]*)/i);
      var fdName = m ? m[1] : lbl;
      addScenario('Arquivo', 'Média',
        'Esgotamento de Registros — ' + fdName,
        'Testa o comportamento após leitura do último registro de "' + fdName + '".',
        'Verificar que o loop de leitura encerra corretamente quando não há mais registros.',
        [
          'Carregar múltiplos registros no arquivo "' + fdName + '"',
          'Executar a simulação em modo automático',
          'Observar a leitura de cada registro no painel ARQUIVOS',
          'Verificar que, após o último registro, AT END é acionado',
          'Confirmar que o programa encerra ou retorna ao controle corretamente'
        ],
        n.id(), 'at-end');
    });
  }

  // ── CENÁRIO 4: Condições IF ─────────────────────────────────────
  ifNodes.forEach(function(n) {
    var cond = (n.data('label') || '').replace(/^IF\s*/i, '').split('\n')[0].trim().substring(0, 80);
    addScenario('Condição', 'Alta',
      'IF Verdadeiro — ' + cond.substring(0, 50),
      'Testa o ramo SIM da condição IF "' + cond + '".',
      'Garantir que o ramo positivo (SIM) executa corretamente.',
      [
        'Configurar variáveis de modo que "' + cond + '" seja VERDADEIRO',
        'Executar a simulação ou avançar passo a passo até este nó',
        'Confirmar que o simulador toma o ramo "SIM" automaticamente',
        'Verificar o resultado esperado ao final do ramo'
      ],
      n.id(), 'if-sim');
    addScenario('Condição', 'Alta',
      'IF Falso — ' + cond.substring(0, 50),
      'Testa o ramo NÃO / ELSE da condição IF "' + cond + '".',
      'Garantir que o ramo negativo (NÃO/ELSE) executa corretamente.',
      [
        'Configurar variáveis de modo que "' + cond + '" seja FALSO',
        'Executar a simulação ou avançar passo a passo até este nó',
        'Confirmar que o simulador toma o ramo "Não" automaticamente',
        'Verificar o resultado esperado ao final do ramo ELSE'
      ],
      n.id(), 'if-nao');
  });

  // ── CENÁRIO 5: EVALUATE ─────────────────────────────────────────
  evaluateNodes.forEach(function(n) {
    var subj = (n.data('label') || '').replace(/^EVALUATE\s*/i, '').split('\n')[0].trim().substring(0, 60);
    // Lista ramos (arestas de saída)
    var ramos = n.outgoers('edge').map(function(e) { return (e.data('label') || '').trim(); }).filter(Boolean);
    ramos.forEach(function(r) {
      addScenario('Condição', 'Alta',
        'EVALUATE ' + subj.substring(0,30) + ' — WHEN ' + r.substring(0, 30),
        'Testa o ramo WHEN "' + r + '" do EVALUATE "' + subj + '".',
        'Garantir que o ramo WHEN "' + r + '" executa corretamente quando o sujeito satisfaz a condição.',
        [
          'Configurar "' + subj + '" com valor que satisfaça WHEN ' + r,
          'Executar a simulação até o nó EVALUATE',
          'Confirmar que o ramo "' + r + '" é selecionado automaticamente',
          'Verificar o resultado esperado ao final do ramo'
        ],
        n.id(), 'evaluate-when');
    });
    // Cenário OTHER se existir
    if (ramos.some(function(r){ return /^OTHER$|^OUTRO$|^$/i.test(r.trim()); }) ||
        n.outgoers('edge').length > ramos.length) {
      addScenario('Condição', 'Média',
        'EVALUATE ' + subj.substring(0,30) + ' — WHEN OTHER',
        'Testa o ramo OTHER do EVALUATE "' + subj + '".',
        'Verificar que o ramo padrão (OTHER) trata corretamente valores não esperados.',
        [
          'Configurar "' + subj + '" com valor que NÃO corresponda a nenhum WHEN específico',
          'Executar a simulação até o nó EVALUATE',
          'Confirmar que o ramo OTHER é selecionado',
          'Verificar que o programa trata o caso genérico sem erro'
        ],
        n.id(), 'evaluate-other');
    }
  });

  // ── CENÁRIO 6: Loops ────────────────────────────────────────────
  loopNodes.forEach(function(n) {
    var lbl = (n.data('label') || '').split('\n')[0].trim().substring(0, 60);
    addScenario('Loop', 'Alta',
      'Loop Zero Iterações — ' + lbl.substring(0, 40),
      'Testa o loop "' + lbl + '" com condição de saída verdadeira imediatamente (0 iterações).',
      'Garantir que o loop com zero iterações não causa erro e o fluxo prossegue.',
      [
        'Configurar variáveis de controle do loop de modo que a condição de saída seja verdadeira já na primeira verificação',
        'Executar a simulação',
        'Verificar log: "LOOP encerrado após 0 iteração(ões)"',
        'Confirmar que o fluxo prosseguiu após o loop sem erro'
      ],
      n.id(), 'loop-zero');
    addScenario('Loop', 'Alta',
      'Loop N Iterações — ' + lbl.substring(0, 40),
      'Testa o loop "' + lbl + '" executando múltiplas iterações.',
      'Verificar que cada iteração processa dados corretamente e o loop encerra na condição esperada.',
      [
        'Configurar variáveis para que o loop execute pelo menos 3 iterações',
        'Executar a simulação em modo automático',
        'Observar o log: "LOOP iter #N" a cada iteração',
        'Verificar que as variáveis alteradas em cada iteração têm os valores esperados',
        'Confirmar que o loop encerrou corretamente'
      ],
      n.id(), 'loop-n');
    addScenario('Loop', 'Baixa',
      'Loop Máximo de Iterações — ' + lbl.substring(0, 40),
      'Testa o comportamento do loop "' + lbl + '" quando atinge o limite máximo de iterações.',
      'Evitar loops infinitos; verificar que o simulador interrompe e exibe log adequado.',
      [
        'Configurar variáveis de modo que a condição de saída nunca seja atingida naturalmente',
        'Executar em modo automático',
        'Verificar que o simulador interrompe o loop automaticamente',
        'Verificar msg no log sobre limite de iterações'
      ],
      n.id(), 'loop-max');
  });

  // ── CENÁRIO 7: OPEN/CLOSE sem correspondência ───────────────────
  if (openNodes.length > 0 || closeNodes.length > 0) {
    files.forEach(function(fd) {
      addScenario('Arquivo', 'Média',
        'Sequência OPEN→CLOSE — ' + fd,
        'Verifica que o arquivo "' + fd + '" é aberto e fechado corretamente.',
        'Garantir que o OPEN ocorre antes de qualquer READ/WRITE e o CLOSE ocorre ao final.',
        [
          'Executar a simulação completa',
          'Observar o painel ARQUIVOS e verificar badge "⊙ ABERTO" após o nó OPEN',
          'Verificar FILE STATUS = 00 após o OPEN',
          'Confirmar que badge muda para "⊗ FECHADO" após o nó CLOSE',
          'Verificar FILE STATUS = 00 após o CLOSE'
        ],
        null, 'open-close');
    });
  }

  // ── CENÁRIO 8: Gravação de arquivo de saída ─────────────────────
  if (writeNodes.length > 0) {
    writeNodes.forEach(function(n) {
      var lbl = (n.data('label') || '').replace(/\r?\n/g, ' ').trim().substring(0, 60);
      addScenario('Arquivo', 'Alta',
        'Gravação Correta — ' + lbl.substring(0, 45),
        'Verifica que o nó "' + lbl + '" grava o registro com os campos corretos.',
        'Garantir que os valores das variáveis no momento do WRITE correspondem ao esperado.',
        [
          'Configurar variáveis de entrada com valores conhecidos',
          'Executar a simulação até alcançar este WRITE',
          'Verificar no painel ARQUIVOS, aba de saída, o registro gravado',
          'Conferir cada campo do registro com o valor esperado',
          'Exportar o arquivo de saída e comparar com resultado esperado'
        ],
        n.id(), 'write-correto');
    });
  }

  // ── CENÁRIO 9: CALLs externos ────────────────────────────────────
  if (callNodes.length > 0) {
    callNodes.forEach(function(n) {
      var prog = (n.data('label') || '').replace(/^CALL\s+/i, '').split('\n')[0].trim().substring(0, 50);
      addScenario('Interface', 'Média',
        'CALL — ' + prog.substring(0, 40),
        'Testa a chamada ao programa externo "' + prog + '".',
        'Verificar que os parâmetros (USING) são passados corretamente e o retorno é tratado.',
        [
          'Configurar as variáveis USING antes do CALL',
          'Executar a simulação até o nó CALL',
          'Observar no log de simulação a passagem pelo CALL',
          'Verificar variáveis de retorno após o CALL',
          'Testar com RETURN-CODE = 0 (sucesso) e RETURN-CODE ≠ 0 (erro)'
        ],
        n.id(), 'call');
    });
  }

  // ── CENÁRIO 10: SQL ──────────────────────────────────────────────
  if (sqlNodes.length > 0) {
    sqlNodes.forEach(function(n) {
      var lbl = (n.data('label') || '').replace(/\r?\n/g, ' ').trim().substring(0, 60);
      addScenario('Banco de Dados', 'Alta',
        'SQL — ' + lbl.substring(0, 40),
        'Testa a instrução SQL "' + lbl + '".',
        'Verificar o tratamento de SQLCODE para sucesso (0), não encontrado (+100) e erro (< 0).',
        [
          'Configurar SQLCODE = 0 (simulando sucesso) e verificar fluxo',
          'Configurar SQLCODE = +100 (simulando NOT FOUND) e verificar ramo de exceção',
          'Configurar SQLCODE < 0 (simulando erro) e verificar tratamento de erro',
          'Verificar que SQLCA é inspecionada corretamente após a instrução'
        ],
        n.id(), 'sql');
    });
  }

  // ── CENÁRIO 11: GOTO ────────────────────────────────────────────
  if (gotoNodes.length > 0) {
    gotoNodes.forEach(function(n) {
      var target = (n.data('label') || '').replace(/^GO\s+TO\s*/i, '').trim().substring(0, 50);
      addScenario('Fluxo', 'Média',
        'GO TO — ' + target.substring(0, 40),
        'Testa o desvio incondicional GO TO para "' + target + '".',
        'Garantir que o controle é transferido corretamente para o parágrafo de destino.',
        [
          'Executar a simulação até alcançar este GO TO',
          'Verificar no log que o próximo nó destacado é "' + target + '"',
          'Confirmar que nenhuma instrução entre o GO TO e "' + target + '" é executada',
          'Verificar se há possibilidade de loop infinito neste desvio'
        ],
        n.id(), 'goto');
    });
  }

  // ── CENÁRIO 12: STOP RUN ────────────────────────────────────────
  if (stopNodes.length > 0) {
    stopNodes.forEach(function(n) {
      addScenario('Qualidade', 'Baixa',
        'Ponto de Término — STOP RUN',
        'Verifica que o programa termina normalmente no nó STOP RUN.',
        'Garantir que todos os arquivos foram fechados e recursos liberados antes do STOP RUN.',
        [
          'Executar a simulação completa',
          'Verificar que todos os arquivos mostram badge "⊗ FECHADO" antes do STOP RUN',
          'Verificar status "✔ Concluído" no relatório de cenários',
          'Confirmar que o número de passos está dentro do esperado'
        ],
        n.id(), 'stop-run');
    });
  }

  // ── CENÁRIO 13: Cobertura de parágrafos ─────────────────────────
  if (paraNodes.length > 1) {
    addScenario('Cobertura', 'Média',
      'Cobertura de Parágrafos (' + paraNodes.length + ' parágrafos)',
      'Verifica se todos os ' + paraNodes.length + ' parágrafos/seções do programa são alcançados.',
      'Identificar parágrafos não executados (dead code) no caminho normal de execução.',
      [
        'Executar a simulação completa',
        'Abrir aba Estatísticas do Relatório',
        'Verificar o top de nós mais executados',
        'Identificar parágrafos que não aparecem na lista (não executados)',
        'Criar cenário específico que force a execução dos parágrafos ausentes'
      ],
      null, 'cobertura');
  }

  // ── CENÁRIO 14: Valor de variável fora de range ─────────────────
    addScenario('Robustez', 'Baixa',
      'Variáveis com Valores Extremos',
      'Testa o comportamento do programa com valores extremos ou inesperados nas variáveis de entrada.',
      'Verificar que o programa trata corretamente zero, negativo, máximo e espaços.',
      [
        'Preencher variáveis numéricas com valor 0 e executar',
        'Preencher variáveis numéricas com valor máximo e executar',
        'Preencher variáveis alfanuméricas com espaços em branco e executar',
        'Observar como cada condição IF se comporta com esses valores',
        'Verificar se os resultados gravados nos arquivos de saída são coerentes'
      ],
      null, 'valores-extremos');

  _repValidation = val;
}

// ── Detecta nome do programa no grafo ───────────────────────────
function _repDetectProgramName() {
  if (!window.cy) return 'Programa COBOL';
  // Tenta obter do primeiro nó de entrada (isEntry)
  var entry = cy.nodes('[?isEntry]').first();
  if (entry && entry.length) return entry.data('label') || 'Programa COBOL';
  return 'Programa COBOL';
}

// ── Renderizador da aba Validações ──────────────────────────────
var _repValFilter     = 'all';    // filtro de categoria ativo
var _repValPriFilter  = 'all';    // filtro de prioridade
var _repValExpanded   = {};       // { id: true } cenários expandidos
var _repValPage       = 1;        // página atual
var _repValPageSize   = 20;       // itens por página

function _repRenderValidation() {
  var pane = document.getElementById('rep-pane-validation');
  if (!pane) return;

  if (!_repValidation || _repValidation.scenarios.length === 0) {
    pane.innerHTML =
      '<div class="rep-empty">' +
        '<div class="rep-empty-icon">&#9745;</div>' +
        '<div>Nenhum cenário de validação disponível.</div>' +
        '<div class="rep-empty-hint">Gere o fluxo primeiro (botão ▶ Gerar ou Ctrl+Enter) para que os cenários sejam extraídos automaticamente do programa.</div>' +
      '</div>';
    return;
  }

  var all = _repValidation.scenarios;
  var cats = ['all'];
  var catsLabels = { 'all': 'Todos' };
  all.forEach(function(s) {
    if (cats.indexOf(s.category) === -1) { cats.push(s.category); catsLabels[s.category] = s.category; }
  });

  // Filtra
  var filtered = all.filter(function(s) {
    var catOk = (_repValFilter === 'all' || s.category === _repValFilter);
    var priOk = (_repValPriFilter === 'all' || s.priority === _repValPriFilter);
    return catOk && priOk;
  });

  var html = '';

  // Cabeçalho de resumo e geração
  html += '<div class="rep-val-header">';
  html += '<div class="rep-val-meta">';
  html += '<span class="rep-val-prog">&#9745; ' + _repEscHtml(_repValidation.programName) + '</span>';
  html += '<span class="rep-val-gen">Gerado em: ' + (_repValidation.generatedAt instanceof Date ? _repValidation.generatedAt.toLocaleString('pt-BR') : '--') + '</span>';
  html += '<span class="rep-val-total"><b>' + all.length + '</b> cenários identificados</span>';
  html += '</div>';
  html += '<button class="rep-btn rep-btn-xs" onclick="_repExportValidation()" title="Exportar cenários de validação como texto">&#8595; Exportar</button>';
  html += '</div>';

  // KPI por prioridade
  var nAlta  = all.filter(function(s){ return s.priority === 'Alta'; }).length;
  var nMedia = all.filter(function(s){ return s.priority === 'Média'; }).length;
  var nBaixa = all.filter(function(s){ return s.priority === 'Baixa'; }).length;
  html += '<div class="rep-kpi-row" style="margin-bottom:14px">';
  html += _repKpi('Alta', nAlta);
  html += _repKpi('Média', nMedia);
  html += _repKpi('Baixa', nBaixa);
  html += _repKpi('Total', all.length);
  html += '</div>';

  // Filtros de categoria
  html += '<div class="rep-val-filters">';
  html += '<span class="rep-val-filter-lbl">Categoria:</span>';
  cats.forEach(function(c) {
    var active = (_repValFilter === c) ? ' rep-val-filter-active' : '';
    html += '<button class="rep-val-filter-btn' + active + '" onclick="_repSetValFilter(\'' + c + '\')">' + _repEscHtml(catsLabels[c]) + '</button>';
  });
  html += '<span class="rep-val-filter-lbl" style="margin-left:12px">Prioridade:</span>';
  ['all','Alta','Média','Baixa'].forEach(function(p) {
    var active = (_repValPriFilter === p) ? ' rep-val-filter-active' : '';
    var lbl = p === 'all' ? 'Todas' : p;
    html += '<button class="rep-val-filter-btn' + active + ' rep-val-filter-' + (p === 'all' ? 'all' : p.toLowerCase()) + '" onclick="_repSetValPriFilter(\'' + p + '\')">' + lbl + '</button>';
  });
  html += '</div>';

  if (filtered.length === 0) {
    html += '<div class="rep-empty" style="padding:30px"><div>Nenhum cenário para o filtro selecionado.</div></div>';
    pane.innerHTML = html;
    return;
  }

  // Paginação
  var totalPages = Math.ceil(filtered.length / _repValPageSize);
  if (_repValPage > totalPages) _repValPage = totalPages;
  if (_repValPage < 1) _repValPage = 1;
  var pageStart = (_repValPage - 1) * _repValPageSize;
  var pageItems = filtered.slice(pageStart, pageStart + _repValPageSize);

  // Controles de paginação (topo)
  html += _repValPagerHTML(filtered.length, totalPages);

  // Lista da página atual
  html += '<div class="rep-val-list">';
  pageItems.forEach(function(sc) {
    var isExp = !!_repValExpanded[sc.id];
    var priCls = 'rep-val-pri-' + sc.priority.toLowerCase().replace('é','e').replace('ó','o');
    html += '<div class="rep-val-item" id="rep-val-item-' + sc.id + '">';
    html += '<div class="rep-val-item-header" onclick="_repToggleVal(' + sc.id + ')">';
    html += '<span class="rep-val-id">#' + sc.id + '</span>';
    html += '<span class="rep-val-cat">' + _repEscHtml(sc.category) + '</span>';
    html += '<span class="rep-val-title">' + _repEscHtml(sc.title) + '</span>';
    html += '<span class="rep-val-pri ' + priCls + '">' + _repEscHtml(sc.priority) + '</span>';
    if (sc.nodeId) {
      html += '<button class="rep-val-goto" onclick="event.stopPropagation();_repGoToNode(\'' + sc.nodeId + '\')" title="Destacar nó no diagrama">&#9654; Ver no fluxo</button>';
    }
    html += '<span class="rep-sc-toggle">' + (isExp ? '▲' : '▼') + '</span>';
    html += '</div>'; // header
    if (isExp) {
      html += '<div class="rep-val-body">';
      html += '<div class="rep-val-desc"><b>Descrição:</b> ' + _repEscHtml(sc.desc) + '</div>';
      html += '<div class="rep-val-obj"><b>Objetivo:</b> ' + _repEscHtml(sc.objective) + '</div>';
      html += '<div class="rep-section-title" style="margin-top:10px">Passos de Teste</div>';
      html += '<ol class="rep-val-steps">';
      sc.steps.forEach(function(st) {
        html += '<li>' + _repEscHtml(st) + '</li>';
      });
      html += '</ol>';
      html += '</div>';
    }
    html += '</div>'; // item
  });
  html += '</div>'; // val-list

  pane.innerHTML = html;
}

/** Gera HTML do paginador */
function _repValPagerHTML(total, totalPages) {
  if (totalPages <= 1) return '';
  var cur = _repValPage;
  var from = (_repValPage - 1) * _repValPageSize + 1;
  var to   = Math.min(_repValPage * _repValPageSize, total);
  var html = '<div class="rep-val-pager">';
  // Botão anterior
  html += '<button class="rep-val-pager-btn" ' + (cur <= 1 ? 'disabled' : 'onclick="_repValGoPage(' + (cur-1) + ')"') + '>&#8592;</button>';
  // Páginas numeradas (janela ao redor da atual)
  var showPages = [];
  showPages.push(1);
  for (var i = Math.max(2, cur - 2); i <= Math.min(totalPages - 1, cur + 2); i++) showPages.push(i);
  if (totalPages > 1) showPages.push(totalPages);
  var prev = 0;
  showPages.forEach(function(p) {
    if (prev && p - prev > 1) html += '<span class="rep-val-pager-ellipsis">…</span>';
    html += '<button class="rep-val-pager-btn' + (p === cur ? ' rep-val-pager-active' : '') + '" onclick="_repValGoPage(' + p + ')">' + p + '</button>';
    prev = p;
  });
  // Botão próximo
  html += '<button class="rep-val-pager-btn" ' + (cur >= totalPages ? 'disabled' : 'onclick="_repValGoPage(' + (cur+1) + ')"') + '>&#8594;</button>';
  // Info
  html += '<span class="rep-val-pager-info">' + from + '–' + to + ' de ' + total + '</span>';
  html += '</div>';
  return html;
}

function _repSetValFilter(cat) {
  _repValFilter = cat;
  _repValPage = 1;
  _repRenderValidation();
}
function _repSetValPriFilter(pri) {
  _repValPriFilter = pri;
  _repValPage = 1;
  _repRenderValidation();
}
function _repValGoPage(p) {
  _repValPage = p;
  _repRenderValidation();
  // Sobe ao topo do pane
  var pane = document.getElementById('rep-pane-validation');
  if (pane) pane.scrollTop = 0;
}
function _repToggleVal(id) {
  _repValExpanded[id] = !_repValExpanded[id];
  _repRenderValidation();
}

/** Destaca o nó no diagrama e fecha o modal */
function _repGoToNode(nodeId) {
  if (!window.cy) return;
  var node = cy.getElementById(nodeId);
  if (!node || node.length === 0) return;
  _repCloseModal();
  cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 1.2) }, { duration: 300 });
  node.flashClass('sim-current', 1800);
}

function _repExportValidation() {
  if (!_repValidation || _repValidation.scenarios.length === 0) {
    alert('Nenhum cenário disponível.'); return;
  }
  var lines = [];
  lines.push('COBOL Flow — Cenários de Validação');
  lines.push('Programa: ' + _repValidation.programName);
  lines.push('Gerado em: ' + (_repValidation.generatedAt instanceof Date ? _repValidation.generatedAt.toLocaleString('pt-BR') : '--'));
  lines.push('Total de cenários: ' + _repValidation.scenarios.length);
  lines.push('='.repeat(70));

  var cats = {};
  _repValidation.scenarios.forEach(function(s) {
    if (!cats[s.category]) cats[s.category] = [];
    cats[s.category].push(s);
  });

  Object.keys(cats).forEach(function(cat) {
    lines.push('');
    lines.push('━━ ' + cat.toUpperCase() + ' ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    cats[cat].forEach(function(sc) {
      lines.push('');
      lines.push('  CT-' + String(sc.id).padStart(3,'0') + ' [' + sc.priority + '] ' + sc.title);
      lines.push('  Objetivo: ' + sc.objective);
      lines.push('  Passos:');
      sc.steps.forEach(function(st, i) {
        lines.push('    ' + (i+1) + '. ' + st);
      });
      lines.push('  ' + '-'.repeat(65));
    });
  });

  _repDownload('cobol-flow-validacoes.txt', lines.join('\n'), 'text/plain');
}
