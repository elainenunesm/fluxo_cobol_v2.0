// =====================================================================
// BOOK COBOL — multi-book, REDEFINES correto, Início/Fim (1-based)
// =====================================================================

const BOOK_COLORS = ['#1a73e8','#0a7a5e','#6a1b9a','#e65100','#c62828','#0097a7','#558b2f','#ad1457','#37474f'];

const _BK_MAX_ROWS     = 500000; // máximo de registros em memória
const _BK_IMPORT_CHUNK = 2000;   // linhas por tick (mantém UI responsiva)
const _BK_STREAM_BYTES = 4 * 1024 * 1024; // 4 MB por chunk de leitura

let _bkBooks    = [];   // [{id, name, color, src, layout}]
let _bkActiveId = null;
let _bkNextId   = 1;

// ---- Compatibilidade com botão ribbon ----
// ================================================================
// EDITOR COPYBOOK — line numbers + syntax highlight (espelha o CICS/COBOL)
// ================================================================
function updateBookEditor() {
  const ta = document.getElementById('book-textarea');
  const hi = document.getElementById('bk-cbl-hi');
  const ln = document.getElementById('bk-cbl-ln');
  if (!ta || !hi || !ln) return;
  const lines = ta.value.split('\n');
  ln.innerHTML = lines.map((_,i) => '<div>' + (i+1) + '</div>').join('');
  hi.innerHTML = lines.map(line => {
    const cls = _cblLineClass(line);
    return '<div class="cbl-line' + cls + '">' + _cblHighlightLine(line) + '</div>';
  }).join('');
  hi.scrollTop  = ta.scrollTop;
  hi.scrollLeft = ta.scrollLeft;
  ln.scrollTop  = ta.scrollTop;
}

let _bkEditorInited = false;
function initBookEditor() {
  if (_bkEditorInited) return;
  _bkEditorInited = true;
  const ta = document.getElementById('book-textarea');
  const hi = document.getElementById('bk-cbl-hi');
  const ln = document.getElementById('bk-cbl-ln');
  if (!ta || !hi || !ln) return;
  ta.addEventListener('scroll', function() {
    hi.scrollTop  = ta.scrollTop;
    hi.scrollLeft = ta.scrollLeft;
    ln.scrollTop  = ta.scrollTop;
  });
  let hlTimer;
  ta.addEventListener('input', function() {
    clearTimeout(hlTimer);
    hlTimer = setTimeout(updateBookEditor, 30);
  });
  ta.addEventListener('keydown', function(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = this.selectionStart, end = this.selectionEnd;
      this.value = this.value.slice(0,s) + '    ' + this.value.slice(end);
      this.selectionStart = this.selectionEnd = s + 4;
      updateBookEditor();
    }
  });
  updateBookEditor();
}

function bookOpenModal() {
  document.getElementById('book-overlay').classList.add('open');
  setTimeout(() => {
    _bkKeyLoad();
    initBookEditor();
    if (!_bkBooks.length) bkAddBook();
    else { updateBookEditor(); document.getElementById('book-textarea').focus(); }
  }, 80);
}
function bookCloseModal() {
  document.getElementById('book-overlay').classList.remove('open');
}
function bookOverlayClick(e) {
  if (e.target === document.getElementById('book-overlay')) bookCloseModal();
}

// ================================================================
// GERENCIAMENTO DE BOOKS
// ================================================================
function bkGetActive() { return _bkBooks.find(b => b.id === _bkActiveId) || null; }

function bkAddBook() {
  const id    = _bkNextId++;
  const color = BOOK_COLORS[(id - 1) % BOOK_COLORS.length];
  _bkBooks.push({ id, name: 'BOOK-' + id, color, src: '', layout: [] });
  _bkActiveId = id;
  document.getElementById('book-textarea').value = '';
  document.getElementById('bk-parse-info').textContent = '';
  bkRenderBookList();
  bkRenderRight();
  updateBookEditor();
  document.getElementById('book-textarea').focus();
}

function bkAddBookWithSrc(name, src, autoparse) {
  const id    = _bkNextId++;
  const color = BOOK_COLORS[(id - 1) % BOOK_COLORS.length];
  _bkBooks.push({ id, name, color, src, layout: [] });
  _bkActiveId = id;
  document.getElementById('book-textarea').value = src;
  bkRenderBookList();
  if (autoparse) bkRunParse();
  else updateBookEditor();
}

function bkSelectBook(id) {
  bkSaveCurrentSrc();
  _bkActiveId = id;
  const book  = bkGetActive();
  if (book) {
    document.getElementById('book-textarea').value = book.src;
    document.getElementById('bk-parse-info').textContent = book.layout.length ? bkSummary(book) : '';
    updateBookEditor();
  }
  bkRenderBookList();
  bkRenderRight();
}

function bkRemoveBook(id, e) {
  e.stopPropagation();
  _bkBooks = _bkBooks.filter(b => b.id !== id);
  if (_bkActiveId === id) {
    _bkActiveId = _bkBooks.length ? _bkBooks[_bkBooks.length - 1].id : null;
    const ab = bkGetActive();
    document.getElementById('book-textarea').value = ab ? ab.src : '';
    document.getElementById('bk-parse-info').textContent = '';
    updateBookEditor();
  }
  bkRenderBookList();
  bkRenderRight();
}

function bkSaveCurrentSrc() {
  const book = bkGetActive();
  if (book) book.src = document.getElementById('book-textarea').value;
}

function bkStartRename(id, nameEl) {
  const book = _bkBooks.find(b => b.id === id);
  if (!book) return;
  const inp = document.createElement('input');
  inp.className = 'bk-name-inp';
  inp.value = book.name;
  nameEl.replaceWith(inp);
  inp.focus(); inp.select();
  function commit() {
    const v = inp.value.trim().toUpperCase();
    if (v) book.name = v;
    bkRenderBookList();
    bkRenderRight();
  }
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', ev => {
    if (ev.key === 'Enter')  { ev.preventDefault(); inp.blur(); }
    if (ev.key === 'Escape') { bkRenderBookList(); }
  });
}

function bkRenderBookList() {
  const list = document.getElementById('bk-books-list');
  if (!_bkBooks.length) {
    list.innerHTML = '<div class="bk-empty" style="font-size:11px;padding:10px;">Nenhum book. Clique em <b>+ Novo</b> ou importe um .txt.</div>';
    return;
  }
  list.innerHTML = '';
  _bkBooks.forEach(b => {
    const item = document.createElement('div');
    item.className = 'bk-item' + (b.id === _bkActiveId ? ' active' : '');
    item.onclick = () => bkSelectBook(b.id);

    const dot = document.createElement('span');
    dot.className    = 'bk-dot';
    dot.style.background = b.color;

    const nameSpan = document.createElement('span');
    nameSpan.className   = 'bk-name';
    nameSpan.textContent = b.name + (b.layout.length ? '' : ' \u25CF');
    nameSpan.title       = 'Duplo clique para renomear';
    nameSpan.ondblclick  = ev => { ev.stopPropagation(); bkStartRename(b.id, nameSpan); };

    const ren = document.createElement('button');
    ren.className = 'bk-ren';
    ren.innerHTML = '&#9998;';
    ren.title = 'Renomear book';
    ren.onclick = ev => { ev.stopPropagation(); bkStartRename(b.id, nameSpan); };

    const del = document.createElement('button');
    del.className = 'bk-del';
    del.innerHTML = '&#10005;';
    del.title = 'Remover este book';
    del.onclick = ev => bkRemoveBook(b.id, ev);

    item.appendChild(dot);
    item.appendChild(nameSpan);
    item.appendChild(ren);
    item.appendChild(del);
    list.appendChild(item);
  });
}

// ================================================================
// IMPORTAR ARQUIVO
// ================================================================
function bkTriggerFile()  { document.getElementById('book-file-input').click(); }

function bkFilesSelected(e) {
  bkLoadFiles(e.target.files || []);
  e.target.value = '';
}
function bkDragOver(e)  { e.preventDefault(); document.getElementById('book-file-zone').classList.add('drag-over'); }
function bkDragLeave()  { document.getElementById('book-file-zone').classList.remove('drag-over'); }
function bkDrop(e) {
  e.preventDefault();
  document.getElementById('book-file-zone').classList.remove('drag-over');
  bkLoadFiles((e.dataTransfer && e.dataTransfer.files) || []);
}
function bkLoadFile(file, forceNew) {
  const reader = new FileReader();
  reader.onload = ev => {
    const src  = ev.target.result || '';
    const m01  = src.match(/\b01\s+([\w-]+)/i);
    const name = m01 ? m01[1].toUpperCase() : file.name.replace(/\.[^.]+$/, '').toUpperCase();
    // Se o book ativo está completamente vazio (sem fonte e sem layout), usa ele
    const active = bkGetActive();
    if (!forceNew && active && !active.src.trim() && !active.layout.length) {
      active.name = name;
      active.src  = src;
      document.getElementById('book-textarea').value = src;
      document.getElementById('bk-parse-info').textContent = '';
      updateBookEditor();
      bkRenderBookList();
      bkRunParse();
    } else {
      bkAddBookWithSrc(name, src, true);
    }
  };
  reader.readAsText(file, 'UTF-8');
}

function bkLoadFiles(files) {
  Array.from(files).forEach((file, i) => bkLoadFile(file, i > 0));
}

// ================================================================
// PARSE / LIMPAR
// ================================================================
function bkClearBook() {
  const book = bkGetActive();
  if (book) { book.src = ''; book.layout = []; }
  document.getElementById('book-textarea').value = '';
  document.getElementById('bk-parse-info').textContent = '';
  updateBookEditor();
  bkRenderRight();
}

function bkRunParse() {
  bkSaveCurrentSrc();
  let book = bkGetActive();
  if (!book) {
    const src = document.getElementById('book-textarea').value.trim();
    if (!src) return;
    const m01 = src.match(/\b01\s+([\w-]+)/i);
    bkAddBookWithSrc(m01 ? m01[1].toUpperCase() : 'BOOK-1', src, false);
    book = bkGetActive();
  }
  const src = book.src.trim();
  if (!src) { document.getElementById('bk-parse-info').textContent = 'Cole o copybook antes de gerar.'; return; }

  // Se já tem layout gerado, pede confirmação
  if (book.layout.length) {
    if (!window.confirm(`O book "${book.name}" já tem um layout gerado.\nDeseja regerar e substituir?`)) return;
  }

  const fields = bkParseCopybook(src);
  book.layout  = bkBuildLayout(fields);

  if (!book.layout.length) {
    document.getElementById('bk-parse-info').textContent = 'Nenhum campo reconhecido. Verifique o formato.';
    return;
  }

  const root01 = book.layout.find(f => f.level === 1);
  if (root01) book.name = root01.name;

  document.getElementById('bk-parse-info').textContent = bkSummary(book);
  bkRenderBookList();
  bkRenderRight();
}

function bkSummary(book) {
  const leaves = book.layout.filter(f => !f.isGroup && !f.redefGroup);
  const total  = leaves.reduce((a, f) => a + f.size, 0);
  const redefN = book.layout.filter(f => f.redefines).length;
  return `${book.layout.length} entradas | ${leaves.length} folhas | ${redefN} REDEFINES | Total: ${total} bytes`;
}

// ================================================================
// PARSER COBOL
// ================================================================
function bkParseCopybook(src) {
  const reLine = /^\s*(\d{1,2})\s+([\w-]+)(?:\s+REDEFINES\s+([\w-]+))?\s*(?:PIC\s+([\w9XABVSPZn()/.,+\-*$]+))?\s*(?:VALUE\s+.*)?\.?\s*$/i;
  const fields = [];

  // ---- Pré-proc: junta linhas de continuação ----
  // Uma linha de continuação começa com PIC/REDEFINES/VALUE (sem número de nível)
  // e é colada ao final da linha anterior.
  const reContinuation = /^\s*(?:PIC|REDEFINES|VALUE)\b/i;
  const rawLines = src.split(/\r?\n/);
  const joined = [];
  for (const raw of rawLines) {
    // 1. Remove comentário inline estilo livre (*> ...)
    const clean   = raw.replace(/\*>.*$/, '');
    const trimmed = clean.trim();
    if (!trimmed) continue;

    // 2. Detecta linha de comentário COBOL:
    //    a) Formato fixo: coluna 7 (índice 6) = '*' ou '/'
    //    b) Sem área de sequência: linha começa com '*' ou '/' após trim
    //    c) '*' nos primeiros 6 bytes (sequência numérica ausente): qualquer col 1-6 = '*'
    const isColComment = raw.length >= 7 && (raw[6] === '*' || raw[6] === '/');
    const isAsteriskAtStart = trimmed.startsWith('*') || trimmed.startsWith('/');
    const hasAsteriskInSeqArea = !isColComment && raw.length >= 1 &&
      raw.substring(0, Math.min(6, raw.length)).indexOf('*') !== -1;
    if (isColComment || isAsteriskAtStart || hasAsteriskInSeqArea) continue;

    if (reContinuation.test(trimmed) && joined.length) {
      // Linha de continuação: anexa à linha anterior com espaço
      joined[joined.length - 1] += ' ' + trimmed;
    } else {
      joined.push(trimmed);
    }
  }

  // ---- Parse das linhas já unificadas ----
  for (const rawLine of joined) {
    // Normaliza espaço entre tipo PIC e quantidade: "PIC X (3000)" → "PIC X(3000)"
    // Válido tanto para X, 9, A, etc.
    const line = rawLine.replace(/\b(PIC\s+[\w9XABVSPZn*]+)\s+\(/gi, '$1(');
    const m = reLine.exec(line);
    if (!m) continue;
    const level = parseInt(m[1], 10);
    if (level === 66 || level === 88) continue;
    const name      = m[2].toUpperCase();
    const redefines = m[3] ? m[3].toUpperCase() : null;
    const pic       = m[4] ? m[4].toUpperCase().replace(/\.$/, '') : null;
    fields.push({ level, name, redefines, pic, size: pic ? bkPicSize(pic) : 0, isGroup: !pic });
  }
  return fields;
}

function bkPicSize(pic) {
  let p = pic.toUpperCase().replace(/\.$/, '');
  p = p.replace(/([A-Z9*])[(](\d+)[)]/g, (_, c, n) => c.repeat(parseInt(n, 10)));
  p = p.replace(/[VSP]/g, '');
  const len = p.replace(/[^0-9XABZn*]/gi, '').length;
  return len || p.length;
}

function bkFieldType(pic, isGroup) {
  if (isGroup) return 'GROUP';
  if (!pic)    return '?';
  const p = pic.toUpperCase();
  if (/^S?9/.test(p) || /9.*V/.test(p)) return 'NUM';
  if (/X/.test(p) || /^A/.test(p))      return 'ALFA';
  return 'ALFA';
}

// ================================================================
// BUILD LAYOUT — REDEFINES correto (tree-based)
// ================================================================
function bkBuildLayout(fields) {
  // 1. Constrói árvore
  const roots = [], stack = [];
  for (const f of fields) {
    while (stack.length && stack[stack.length - 1].level >= f.level) stack.pop();
    const node = { ...f, children: [], parent: stack.length ? stack[stack.length - 1] : null };
    if (node.parent) node.parent.children.push(node);
    else             roots.push(node);
    stack.push(node);
  }

  // 2. Mapa nome → nó (para resolver REDEFINES)
  // Quando dois nós têm o mesmo nome (01 X e 01 X REDEFINES Y),
  // o nodeMap deve apontar para o nó BASE (sem REDEFINES) para que
  // a resolução de offsets seja correta.
  const nodeMap = {};
  function mapAll(nodes) {
    for (const n of nodes) {
      // Só registra se ainda não existe OU se o existente tem REDEFINES (preferir o base)
      if (!nodeMap[n.name] || nodeMap[n.name].redefines) nodeMap[n.name] = n;
      mapAll(n.children);
    }
  }
  mapAll(roots);

  // 3. Tamanho total de grupo (ignora filhos REDEFINES)
  function groupSize(node) {
    if (!node.isGroup) return node.size;
    return node.children.filter(c => !c.redefines).reduce((acc, c) => acc + groupSize(c), 0);
  }

  // 4. Atribui offsets recursivamente
  function assignOffsets(nodes, parentOffset) {
    let cursor = parentOffset;
    for (const node of nodes) {
      if (node.redefines) {
        const target = nodeMap[node.redefines];
        node.offset = target !== undefined ? target.offset : parentOffset;
        // Para REDEFINES de bloco inteiro (ex: 01 A REDEFINES B), herda o
        // tamanho do bloco-alvo quando o alvo for um grupo maior que a variante.
        // Isso garante que o tamanho correto fique disponível em flatten().
        if (target && target.isGroup && !node.children.length) {
          // Bloco redefines sem filhos declarados: herda tamanho do alvo
          if (!node.size) node.size = target.size || 0;
        }
      } else {
        node.offset = cursor;
      }
      if (node.children.length) {
        assignOffsets(node.children, node.offset);
        node.size = groupSize(node);
      }
      node.end = node.offset + node.size;
      if (!node.redefines) {
        cursor += node.isGroup ? groupSize(node) : node.size;
      }
    }
  }
  assignOffsets(roots, 0);

  // 5. Achata para array
  const flat = [];
  function flatten(nodes, parentRedefGroup) {
    for (const n of nodes) {
      const redefGroup = parentRedefGroup !== null
        ? parentRedefGroup
        : (n.redefines ? n.name : null);
      // Para REDEFINES de bloco inteiro (nó raiz de redefGroup): guarda
      // o offset e o tamanho do bloco-alvo para cálculo correto de cobertura
      // em bkDataVariantCols (garante excluir TODOS os campos do alvo).
      let redefTargetOffset, redefTargetSize;
      if (n.redefines && redefGroup === n.name) {
        const tgt = nodeMap[n.redefines];
        if (tgt) {
          redefTargetOffset = tgt.offset !== undefined ? tgt.offset : 0;
          redefTargetSize   = tgt.size   >  0          ? tgt.size   : n.size;
        }
      }
      const { children, parent, ...rest } = n;
      flat.push({
        ...rest,
        type: bkFieldType(rest.pic, rest.isGroup),
        redefGroup,
        ...(redefTargetSize !== undefined && { redefTargetOffset, redefTargetSize })
      });
      flatten(n.children, redefGroup);
    }
  }
  flatten(roots, null);
  return flat;
}

// ================================================================
// RENDER
// ================================================================
function bkSwitchTab(t) {
  document.querySelectorAll('#book-modal .bk-tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('#book-modal .bk-panel').forEach(el => el.classList.remove('active'));
  document.getElementById('bk-tab-' + t).classList.add('active');
  document.getElementById('bk-panel-' + t).classList.add('active');
}

function bkBooksWithLayout() { return _bkBooks.filter(b => b.layout.length); }

function bkRenderRight() { bkRenderStats(); bkRenderTable(); bkRenderMap(); bkRenderTree(); bkRenderData(); }

// ---- STATS ----
function bkRenderStats() {
  const book = bkGetActive();
  const sb   = document.getElementById('bk-stats-bar');
  sb.style.display = 'none';
  if (!book || !book.layout.length) return;
  const leaves = book.layout.filter(f => !f.isGroup && !f.redefGroup);
  const total  = leaves.reduce((a, f) => a + f.size, 0);
  const redefN = book.layout.filter(f => f.redefines).length;
  const stats  = [
    { val: book.layout.length, lbl: 'Entradas' },
    { val: leaves.length,      lbl: 'Campos folha' },
    { val: total,              lbl: 'Bytes totais' },
    { val: redefN,             lbl: 'REDEFINES' }
  ];
  sb.innerHTML = '';
  stats.forEach(s => {
    const d = document.createElement('div');
    d.className = 'bk-stat-card';
    d.innerHTML = `<div class="bk-stat-val">${s.val}</div><div class="bk-stat-lbl">${s.lbl}</div>`;
    sb.appendChild(d);
  });
  sb.style.display = 'flex';
}

// ---- TABELA ----
function bkRenderTable() {
  const tbody = document.getElementById('bk-tbody');
  const wrap  = document.getElementById('bk-tbl-wrap');
  const empty = document.getElementById('bk-empty');
  tbody.innerHTML = '';
  const book = bkGetActive();
  if (!book || !book.layout.length) { wrap.style.display = 'none'; if (empty) empty.style.display = ''; return; }
  wrap.style.display = ''; if (empty) empty.style.display = 'none';

  let rowNum = 1;
  {
    book.layout.forEach(f => {
      const indent  = Math.max(0, (f.level - 1) * 14);
      const typeCls = f.isGroup ? 'bk-td-group' : (f.type === 'NUM' ? 'bk-td-num' : 'bk-td-alfa');
      const inicio  = f.offset + 1;
      const fim     = f.offset + f.size;
      const tr      = document.createElement('tr');
      if (f.isGroup)   tr.classList.add('bk-row-group');
      if (f.redefines) tr.classList.add('bk-row-redef');
      tr.innerHTML = `
        <td style="color:#bbb;font-size:11px;">${rowNum++}</td>
        <td>${String(f.level).padStart(2, '0')}</td>
        <td><span style="padding-left:${indent}px;">${f.name}</span></td>
        <td>${f.pic || '<em style="color:#bbb">grupo</em>'}</td>
        <td class="${typeCls}">${f.type}</td>
        <td class="bk-td-pos">${inicio}</td>
        <td>${f.size || ''}</td>
        <td class="bk-td-pos">${fim}</td>
        <td class="bk-td-redef">${f.redefines || ''}</td>
      `;
      tbody.appendChild(tr);
    });
  }
}

// ---- MAPA VISUAL ----
function bkRenderMap() {
  const mc      = document.getElementById('bk-map-content');
  const tooltip = document.getElementById('bk-tooltip');
  mc.innerHTML  = '';
  const book    = bkGetActive();
  if (!book || !book.layout.length) { mc.innerHTML = '<div class="bk-empty">Gere o layout primeiro.</div>'; return; }

  {
    const sec       = document.createElement('div');
    sec.className   = 'bk-map-section';
    const title     = document.createElement('div');
    title.className = 'bk-map-title';
    title.style.background = book.color;
    title.textContent = book.name;
    sec.appendChild(title);

    const baseLeaves = book.layout.filter(f => !f.isGroup && f.redefGroup === null);
    if (!baseLeaves.length) { sec.innerHTML += '<div class="bk-empty">Sem campos base.</div>'; mc.appendChild(sec); return; }

    const totalBytes = baseLeaves.reduce((a, f) => a + f.size, 0) || 1;
    const mapGroup   = document.createElement('div');
    mapGroup.className = 'bk-map-group';

    const baseLbl = document.createElement('div');
    baseLbl.className = 'bk-map-row-lbl';
    baseLbl.textContent = 'Base';
    mapGroup.appendChild(baseLbl);
    mapGroup.appendChild(bkBuildMapRow(baseLeaves, totalBytes, false, tooltip));

    const redefGroupNames = [...new Set(book.layout.filter(f => f.redefGroup).map(f => f.redefGroup))];
    redefGroupNames.forEach(rgName => {
      const cells   = book.layout.filter(f => !f.isGroup && f.redefGroup === rgName);
      // Procura especificamente o nó que TEM o redefines (não o primeiro com o mesmo nome)
      const rgNode  = book.layout.find(f => f.name === rgName && f.redefines);
      const lbl     = document.createElement('div');
      lbl.className = 'bk-map-row-lbl bk-map-redef';
      lbl.textContent = rgName + (rgNode ? ' REDEFINES ' + rgNode.redefines : '');
      mapGroup.appendChild(lbl);
      mapGroup.appendChild(bkBuildMapRow(cells, totalBytes, true, tooltip));
    });

    const scaleRow  = document.createElement('div');
    scaleRow.className = 'bk-map-scale';
    baseLeaves.forEach(f => {
      const tick = document.createElement('div');
      tick.className  = 'bk-map-tick';
      tick.style.flex = Math.max(1.2, (f.size / totalBytes) * 100) + ' 1 0';
      tick.textContent = f.offset + 1;
      scaleRow.appendChild(tick);
    });
    mapGroup.appendChild(scaleRow);
    sec.appendChild(mapGroup);
    mc.appendChild(sec);
  }
}

function bkBuildMapRow(cells, totalBytes, isRedef, tooltip) {
  const row = document.createElement('div');
  row.className = 'bk-map-row';
  cells.forEach(f => {
    const cell = document.createElement('div');
    cell.className = 'bk-map-cell' + (isRedef ? ' bk-map-redef-cell' : '');
    cell.style.flex = Math.max(1.2, (f.size / totalBytes) * 100) + ' 1 0';
    const lbl = document.createElement('span');
    lbl.className   = 'bk-map-cell-lbl';
    lbl.textContent = f.name;
    cell.appendChild(lbl);
    cell.addEventListener('mousemove', e => {
      tooltip.style.display = 'block';
      tooltip.style.left    = (e.clientX + 14) + 'px';
      tooltip.style.top     = (e.clientY +  8) + 'px';
      tooltip.innerHTML     = `<b>${f.name}</b><br>PIC: ${f.pic || 'grupo'}<br>Tam: ${f.size}&nbsp; In&iacute;cio: ${f.offset + 1}&nbsp; Fim: ${f.offset + f.size}${f.redefines ? '<br>REDEFINES: ' + f.redefines : ''}`;
    });
    cell.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    row.appendChild(cell);
  });
  return row;
}

// ---- ÁRVORE ----
function bkRenderTree() {
  const root = document.getElementById('bk-tree-root');
  root.innerHTML = '';
  const book = bkGetActive();
  if (!book || !book.layout.length) { root.innerHTML = '<div class="bk-empty">Gere o layout primeiro.</div>'; return; }

  bkBuildTreeRoots(book.layout).forEach(n => root.appendChild(bkRenderTreeNode(n)));
}

function bkBuildTreeRoots(flat) {
  const roots = [], stack = [];
  for (const f of flat) {
    const node = { ...f, children: [] };
    while (stack.length && stack[stack.length - 1].level >= f.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else              roots.push(node);
    stack.push(node);
  }
  return roots;
}

function bkRenderTreeNode(node) {
  const wrap = document.createElement('div');
  wrap.className = 'bk-tree-node';
  const line = document.createElement('div');
  line.className = 'bk-tree-line';
  const posInfo = node.isGroup
    ? `<span class="bk-tree-pos">(grupo&nbsp;${node.size}&nbsp;bytes&nbsp;${node.offset + 1}&ndash;${node.offset + node.size})</span>`
    : `<span class="bk-tree-pic">PIC ${node.pic}</span><span class="bk-tree-pos">(${node.size}&nbsp;bytes&nbsp;${node.offset + 1}&ndash;${node.offset + node.size})</span>`;
  line.innerHTML = `
    <span class="bk-tree-lvl">${String(node.level).padStart(2, '0')}</span>
    <span class="bk-tree-name">${node.name}</span>
    ${posInfo}
    ${node.redefines ? `<span class="bk-tree-redef">REDEFINES ${node.redefines}</span>` : ''}
  `;
  wrap.appendChild(line);
  if (node.children && node.children.length) {
    const ch = document.createElement('div');
    ch.className = 'bk-tree-children';
    node.children.forEach(c => ch.appendChild(bkRenderTreeNode(c)));
    wrap.appendChild(ch);
  }
  return wrap;
}

// ================================================================
// IMPORTAR DADOS — grade Excel-like + discriminador REDEFINES
// ================================================================

const _bkRedefSel    = {};   // {bookId: {redefTarget: chosenVariant|''}}
const _bkDataStore   = {};   // {bookId: [{fields:{}, variant:'', _raw:''}]}
const _bkDataKeyRule = {};   // {bookId: {redefTarget: {keyField:'', map:{rawVal:variantName}}}}
let   _bkDataRawVis  = false;
let   _bkDGViewH     = true; // false = vertical (cards), true = horizontal (tabela)
const _bkDGPage      = {};   // {bookId: currentPage (1-based)}
const _BK_DG_PAGE_SZ = 20;  // registros por página na grade

// ---- Persistência de regras de chave no localStorage ----
function _bkKeySave() {
  try { localStorage.setItem('cobol-flow-key-rules', JSON.stringify(_bkDataKeyRule)); } catch(e) {}
}
function _bkKeyLoad() {
  try {
    var raw = localStorage.getItem('cobol-flow-key-rules');
    if (raw) {
      var loaded = JSON.parse(raw);
      Object.assign(_bkDataKeyRule, loaded);
    }
  } catch(e) {}
}

// ---- Helpers ----
function bkGetRedefGroups(book) {
  if (!book || !book.layout) return {};
  // Apenas REDEFINES de nível 01 são redefinições de layout completo.
  // REDEFINES em níveis inferiores (03, 05...) são aliases de campo dentro
  // de um mesmo layout e NÃO criam variantes de layout.
  const topRedef = book.layout.filter(f => f.redefines && f.redefGroup === f.name && f.level === 1);
  const byTarget = {};
  topRedef.forEach(f => {
    if (!byTarget[f.redefines]) byTarget[f.redefines] = [];
    byTarget[f.redefines].push(f.name);
  });
  return byTarget;
}

function bkDataGetCols(book, variantOverride) {
  if (!book || !book.layout) return [];
  const sel    = _bkRedefSel[book.id] || {};
  const groups = bkGetRedefGroups(book);
  // Se variantOverride é o próprio target-base de um grupo, trata como null (campos base)
  const isBaseTarget = variantOverride && Object.keys(groups).includes(variantOverride);
  const effectiveVariant = isBaseTarget ? null : variantOverride;
  const hidden = new Set();
  Object.keys(groups).forEach(target => {
    const chosen = effectiveVariant || sel[target] || '';
    if (chosen) groups[target].forEach(v => { if (v !== chosen) hidden.add(v); });
    // Se está visualizando o base explicitamente, oculta todas as variantes
    if (isBaseTarget && variantOverride === target) groups[target].forEach(v => hidden.add(v));
  });
  return book.layout.filter(f => !f.isGroup && !(f.redefGroup && hidden.has(f.redefGroup)));
}

// Retorna as colunas visíveis para uma variante específica — mesma lógica do display.
// variant = null → layout base sem variantes ativas.
// variant = 'NOME-BASE' (target) → mesma coisa (base explícito).
// variant = 'PAG-CARTAO' → base sem sobreposição + cols da variante.
function bkDataVariantCols(book, variant) {
  if (!book || !book.layout) return [];
  const groups = bkGetRedefGroups(book);
  // Se variant é o próprio target-base, trata como null (exibe só campos base)
  const isBaseTarget = variant && Object.keys(groups).includes(variant);
  if (!variant || isBaseTarget) {
    // Campos base: sem redefGroup OU redefGroup de REDEFINES nível >1 (alias de campo, não variante)
    const lvl1variants = new Set(
      book.layout
        .filter(f => f.redefines && f.redefGroup === f.name && f.level === 1)
        .map(f => f.name)
    );
    return book.layout.filter(f => !f.isGroup && (!f.redefGroup || !lvl1variants.has(f.redefGroup)));
  }
  const all       = bkDataGetCols(book, variant);
  const varFields = all.filter(f => f.redefGroup === variant);
  if (!varFields.length) return all;

  // Para REDEFINES de bloco (01 REDEFINES 01): usa o tamanho do bloco-alvo
  // para excluir TODOS os campos-base sobrepostos, mesmo quando a variante
  // declara menos campos do que o registro original.
  const varRoot = book.layout.find(f => f.name === variant && f.redefGroup === variant && f.redefines);
  let minOff, maxOff;
  if (varRoot && varRoot.redefTargetSize > 0) {
    minOff = varRoot.redefTargetOffset !== undefined ? varRoot.redefTargetOffset
           : Math.min(...varFields.map(f => f.offset));
    maxOff = minOff + varRoot.redefTargetSize;
  } else {
    minOff = Math.min(...varFields.map(f => f.offset));
    maxOff = Math.max(...varFields.map(f => f.offset + f.size));
  }

  // Coleta campos configurados como chave discriminadora APENAS para o target desta variante
  const keyFields = new Set();
  let variantTarget = null;
  for (const [tgt, variants] of Object.entries(groups)) {
    if (variants.includes(variant)) { variantTarget = tgt; break; }
  }
  if (variantTarget) {
    const td = _bkKeyNormalize(book.id, variantTarget);
    const pv = td.perVariant || {};
    // Todos os campos de todas as condições de todas as variantes deste target
    Object.values(pv).forEach(conds => {
      (conds || []).forEach(c => { if (c.keyField) keyFields.add(c.keyField); });
    });
  }

  return all.filter(f => {
    if (!f.redefGroup) {
      // Campos-base que sobrepõem o espaço da variante são SEMPRE excluídos.
      // Não há exceção para campos-chave: quando o registro é uma variante,
      // seu layout próprio já contém os campos relevantes no mesmo offset.
      return !(f.offset < maxOff && (f.offset + f.size) > minOff);
    }
    return true;
  });
}

function bkDataGetRows() {
  const book = bkGetActive();
  if (!book) return [];
  if (!_bkDataStore[book.id]) _bkDataStore[book.id] = [];
  return _bkDataStore[book.id];
}

function bkDataDecodeOneLine(raw, book, variant) {
  const cols    = bkDataGetCols(book, variant || null);
  // Padeia a linha com espaços até o tamanho do registro para que campos
  // posicionais no final da linha não fiquem vazios quando o arquivo
  // teve seus espaços finais removidos por algum editor.
  const recLen  = book.layout.filter(f => !f.isGroup)
                    .reduce((m, f) => Math.max(m, f.offset + f.size), 0);
  const padded  = (raw || '').padEnd(Math.max(recLen, 1), ' ');
  const fields  = {};
  cols.forEach(f => { fields[f.name] = padded.substring(f.offset, f.offset + f.size); });
  return fields;
}

function bkDataEncodeToRaw(fields, book, variant) {
  const cols   = bkDataGetCols(book, variant || null);
  const maxLen = book.layout.filter(f => !f.isGroup)
                   .reduce((m, f) => Math.max(m, f.offset + f.size), 0);
  let raw = ' '.repeat(Math.max(maxLen, 1));
  cols.forEach(f => {
    const val = ((fields[f.name] || '') + ' '.repeat(f.size)).substring(0, f.size);
    raw = raw.substring(0, f.offset) + val + raw.substring(f.offset + f.size);
  });
  return raw;
}

// =================================================================
// MODELO DE CHAVE DISCRIMINADORA — perVariant
//
// _bkDataKeyRule[bookId][target] = {
//   perVariant: {
//     'NOME-VARIANTE': [{ keyField: 'CAMPO', value: 'VALOR' }, ...],
//     'NOME-BASE':     [{ keyField: 'CAMPO', value: 'VALOR' }],
//     ...
//   }
// }
// Cada variante (incluindo o próprio base quando é grupo) tem sua lista
// independente de condições AND que identificam aquele layout.
// =================================================================
function _bkKeyNormalize(bookId, target) {
  if (!_bkDataKeyRule[bookId]) _bkDataKeyRule[bookId] = {};
  const cur = _bkDataKeyRule[bookId][target];
  if (!cur) {
    _bkDataKeyRule[bookId][target] = { perVariant: {} };
  } else if (!cur.perVariant) {
    // Migra formato antigo {rules:[{keyField, map:{val→variant}}]} → perVariant
    const pv = {};
    const oldRules = cur.rules || (cur.keyField ? [cur] : []);
    oldRules.forEach(r => {
      if (!r.keyField || !r.map) return;
      Object.keys(r.map).forEach(val => {
        const vname = r.map[val];
        if (!pv[vname]) pv[vname] = [];
        // Só adiciona se não há condição duplicada
        if (!pv[vname].some(c => c.keyField === r.keyField && c.value === val)) {
          pv[vname].push({ keyField: r.keyField, value: val });
        }
      });
    });
    _bkDataKeyRule[bookId][target] = { perVariant: pv };
  }
  return _bkDataKeyRule[bookId][target];
}

function bkDataAutoVariant(raw, book) {
  const rules  = _bkDataKeyRule[book.id] || {};
  const groups = bkGetRedefGroups(book);
  for (const target of Object.keys(groups)) {
    const td = _bkKeyNormalize(book.id, target);
    const pv = td.perVariant || {};
    // Monta lista de candidatos: base (quando é grupo) + variantes
    const targetNode    = book.layout.find(f => f.name === target && !f.redefines);
    const targetIsGroup = targetNode && targetNode.isGroup;
    const candidates    = targetIsGroup ? [target, ...groups[target]] : groups[target];
    for (const candidate of candidates) {
      const conds = pv[candidate];
      if (!conds || !conds.length) continue;
      const activeConds = conds.filter(c => c.keyField && c.value !== undefined && c.value !== '');
      if (!activeConds.length) continue;
      // AND: todas as condições devem bater
      const allMatch = activeConds.every(c => {
        // Busca o campo preferindo o campo do próprio layout do candidato:
        // - base (candidate === target): prefere campos sem redefGroup
        // - variante (candidate !== target): prefere campos com redefGroup === candidate
        // Isso evita que campos com nomes duplicados entre base e variantes
        // sejam resolvidos com o offset errado (ex: TIPO-RE2 no base em offset 12
        // vs. TIPO-RE2 na variante em offset 0).
        const kf = book.layout.find(f =>
            f.name === c.keyField && !f.isGroup &&
            (candidate !== target ? f.redefGroup === candidate : !f.redefGroup)
          ) || book.layout.find(f => f.name === c.keyField && !f.isGroup);
        if (!kf) return false;
        const keyVal = (raw || '').substring(kf.offset, kf.offset + kf.size).trim();
        return keyVal === c.value.trim();
      });
      if (allMatch) return candidate;
    }
  }
  return null;
}

function bkDataAutoVariantFromFields(fields, book) {
  const rules  = _bkDataKeyRule[book.id] || {};
  const groups = bkGetRedefGroups(book);
  for (const target of Object.keys(groups)) {
    const td = _bkKeyNormalize(book.id, target);
    const pv = td.perVariant || {};
    const targetNode    = book.layout.find(f => f.name === target && !f.redefines);
    const targetIsGroup = targetNode && targetNode.isGroup;
    const candidates    = targetIsGroup ? [target, ...groups[target]] : groups[target];
    for (const candidate of candidates) {
      const conds = pv[candidate];
      if (!conds || !conds.length) continue;
      const activeConds = conds.filter(c => c.keyField && c.value !== undefined && c.value !== '');
      if (!activeConds.length) continue;
      const allMatch = activeConds.every(c => {
        const keyVal = ((fields && fields[c.keyField]) || '').toString().trim();
        return keyVal === c.value.trim();
      });
      if (allMatch) return candidate;
    }
  }
  return null;
}

// ---- Render da aba ----
function bkRenderData() {
  const book     = bkGetActive();
  const redefBar = document.getElementById('bk-data-redef-bar');
  const grpDiv   = document.getElementById('bk-data-redef-groups');
  const keyBar   = document.getElementById('bk-data-key-bar');
  const keyDiv   = document.getElementById('bk-data-key-groups');
  if (!redefBar) return;
  if (!book || !book.layout.length) {
    redefBar.classList.add('hidden');
    if (keyBar) keyBar.classList.add('hidden');
    _bkDGRender(null);
    return;
  }
  const groups  = bkGetRedefGroups(book);
  const targets = Object.keys(groups);
  if (targets.length === 0) {
    redefBar.classList.add('hidden');
    if (keyBar) keyBar.classList.add('hidden');
  } else {
    redefBar.classList.remove('hidden');
    if (!_bkRedefSel[book.id]) _bkRedefSel[book.id] = {};
    const sel = _bkRedefSel[book.id];
    let h = '';
    targets.forEach(target => {
      const variants = groups[target];
      const cur      = sel[target] || '';
      h += '<div class="bk-data-redef-grp"><label>Redefine&nbsp;<b>' + target + '</b>:</label>';
      h += '<select class="bk-data-redef-sel" onchange="bkRedefSelChange(' + book.id + ',\'' + target + '\',this.value)">';
      h += '<option value="">— todas —</option>';
      variants.forEach(v => {
        h += '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + v + '</option>';
      });
      h += '</select></div>';
    });
    if (grpDiv) grpDiv.innerHTML = h;
    // Barra de chave discriminadora — uma seção por variante (base inclusive)
    if (keyBar && keyDiv) {
      keyBar.classList.remove('hidden');
      let kh = '';
      targets.forEach(target => {
        const td   = _bkKeyNormalize(book.id, target);
        const pv   = td.perVariant;
        const vars = groups[target];
        // Inclui o base como opção de layout quando for grupo com filhos
        const tgtNode   = book.layout.find(f => f.name === target && !f.redefines);
        const showBase  = tgtNode && tgtNode.isGroup;
        const allLayouts = showBase ? [target, ...vars] : vars;
        // Campos base (sem redefGroup de nível 01) — comuns a todos os layouts
        const _baseLeafs = book.layout.filter(f => !f.isGroup && !f.redefGroup).map(f => f.name);
        kh += '<div class="bk-key-target-blk">';
        kh += '<div class="bk-key-target-hdr">&#128273; REDEFINE <b>' + target + '</b></div>';
        // Uma sub-seção por layout/variante
        allLayouts.forEach(layoutName => {
          const isBase  = layoutName === target;
          const conds   = pv[layoutName] || [];
          const hdrLbl  = isBase ? layoutName + ' <em style="opacity:.7">(base)</em>' : layoutName;
          // Campos disponíveis: apenas os campos do próprio layout
          const discCols = isBase
            ? _baseLeafs
            : book.layout.filter(f => !f.isGroup && f.redefGroup === layoutName).map(f => f.name);
          kh += '<div class="bk-key-variant-blk">';
          kh += '<div class="bk-key-variant-hdr">' + hdrLbl + '</div>';
          kh += '<div class="bk-key-cond-list">';
          conds.forEach((c, ci) => {
            const esc = (s) => (s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            kh += '<div class="bk-key-cond-row">';
            kh += '<select class="bk-data-key-sel" onchange="bkDataKeySetCondField(' + book.id + ',\'' + target + '\',\'' + layoutName + '\',' + ci + ',this.value)">';
            kh += '<option value="">— campo —</option>';
            discCols.forEach(col => {
              kh += '<option value="' + col + '"' + (c.keyField === col ? ' selected' : '') + '>' + col + '</option>';
            });
            kh += '</select>';
            kh += '<span class="bk-key-eq">=</span>';
            kh += '<input type="text" class="bk-key-val-inp" value="' + esc(c.value) + '" placeholder="valor"';
            kh += ' onchange="bkDataKeySetCondValue(' + book.id + ',\'' + target + '\',\'' + layoutName + '\',' + ci + ',this.value)">';
            kh += '<button class="bk-key-rule-del" title="Remover condição" onclick="bkDataKeyRemoveCond(' + book.id + ',\'' + target + '\',\'' + layoutName + '\',' + ci + ')">&#10005;</button>';
            kh += '</div>';
          });
          kh += '</div>';
          kh += '<button class="bk-key-add-btn" onclick="bkDataKeyAddCond(' + book.id + ',\'' + target + '\',\'' + layoutName + '\')">+ condição</button>';
          kh += '</div>';
        });
        kh += '</div>';
      });
      keyDiv.innerHTML = kh;
    }
  }
  _bkDGRender(book);
}

function bkRedefSelChange(bookId, target, value) {
  if (!_bkRedefSel[bookId]) _bkRedefSel[bookId] = {};
  _bkRedefSel[bookId][target] = value;
  bkRenderData();
}

function bkDataKeyAddCond(bookId, target, layoutName) {
  const td = _bkKeyNormalize(bookId, target);
  if (!td.perVariant[layoutName]) td.perVariant[layoutName] = [];
  td.perVariant[layoutName].push({ keyField: '', value: '' });
  _bkKeySave();
  _bkRecalcAllVariants(bkGetActive());
  bkRenderData();
}

function bkDataKeyRemoveCond(bookId, target, layoutName, condIdx) {
  const td = _bkKeyNormalize(bookId, target);
  if (td.perVariant[layoutName]) td.perVariant[layoutName].splice(condIdx, 1);
  _bkKeySave();
  _bkRecalcAllVariants(bkGetActive());
  bkRenderData();
}

function bkDataKeySetCondField(bookId, target, layoutName, condIdx, fieldName) {
  const td = _bkKeyNormalize(bookId, target);
  if (!td.perVariant[layoutName]) td.perVariant[layoutName] = [];
  if (!td.perVariant[layoutName][condIdx]) td.perVariant[layoutName][condIdx] = { keyField: '', value: '' };
  td.perVariant[layoutName][condIdx].keyField = fieldName;
  _bkKeySave();
  _bkRecalcAllVariants(bkGetActive());
}

function bkDataKeySetCondValue(bookId, target, layoutName, condIdx, val) {
  const td = _bkKeyNormalize(bookId, target);
  if (!td.perVariant[layoutName]) td.perVariant[layoutName] = [];
  if (!td.perVariant[layoutName][condIdx]) td.perVariant[layoutName][condIdx] = { keyField: '', value: '' };
  td.perVariant[layoutName][condIdx].value = val;
  _bkKeySave();
  _bkRecalcAllVariants(bkGetActive());
}

// Mantidos por compatibilidade (não são mais gerados pela UI, mas podem existir em saves antigos)
function bkDataKeyAddRule(bookId, target) { bkDataKeyAddCond(bookId, target, groups && groups[target] && groups[target][0] || ''); }
function bkDataKeyRemoveRule(bookId, target, ruleIdx) { /* descontinuado */ bkRenderData(); }
function bkDataKeySetField(bookId, target, ruleIdx, fieldName) { /* descontinuado */ }
function bkDataKeySetMap(bookId, target, ruleIdx, variant, rawVal) { /* descontinuado */ }

function _bkRecalcAllVariants(book) {
  if (!book) return;
  const rows = _bkDataStore[book.id];
  if (!rows || !rows.length) return;
  rows.forEach(row => {
    const newVariant = row._raw != null
      ? bkDataAutoVariant(row._raw, book)
      : bkDataAutoVariantFromFields(row.fields || {}, book);
    if (newVariant !== row.variant) {
      row.variant = newVariant;
      row.fields  = null; // invalida cache lazy — será re-decodificado na próxima exportação/leitura
    }
  });
  _bkDGRender(book); // sempre re-renderiza (regras de chave mudaram)
}

// ---- Grade de dados ----
function bkDataToggleView() {
  _bkDGViewH = !_bkDGViewH;
  const btn = document.getElementById('bk-dtb-view-btn');
  if (btn) {
    btn.textContent = _bkDGViewH ? '\u21D5 Vertical' : '\u21C4 Horizontal';
    btn.classList.toggle('bk-dtb-view-active', _bkDGViewH);
  }
  const book = bkGetActive();
  if (book) _bkDGRender(book);
}

function _bkDGRender(book) {
  const wrap        = document.getElementById('bk-data-grid-wrap');
  const footerPager = document.getElementById('bk-dg-footer-pager');
  if (!wrap) return;

  function _hidePager() { if (footerPager) { footerPager.style.display = 'none'; footerPager.innerHTML = ''; } }

  if (!book || !book.layout.length) {
    wrap.innerHTML = '<div class="bk-data-empty">Gere o layout e adicione registros.</div>';
    _hidePager();
    return;
  }
  const rows     = bkDataGetRows();
  const groups   = bkGetRedefGroups(book);
  const hasRedef = Object.keys(groups).length > 0;
  const allVars  = [];
  if (hasRedef) {
    // Inclui os targets-base que são grupos (layout próprio) + suas variantes
    Object.entries(groups).forEach(([target, variants]) => {
      const tgtNode = book.layout.find(f => f.name === target && !f.redefines);
      if (tgtNode && tgtNode.isGroup && !allVars.includes(target)) allVars.push(target);
      variants.forEach(v => { if (!allVars.includes(v)) allVars.push(v); });
    });
  }
  if (rows.length === 0) {
    wrap.innerHTML = '<div class="bk-data-empty">Sem registros. Clique <b>+ Linha</b> ou importe.</div>';
    _hidePager();
    return;
  }

  // ---- Paginação ----
  const totalRows  = rows.length;
  const totalPages = Math.ceil(totalRows / _BK_DG_PAGE_SZ);
  if (!_bkDGPage[book.id] || _bkDGPage[book.id] < 1) _bkDGPage[book.id] = 1;
  if (_bkDGPage[book.id] > totalPages) _bkDGPage[book.id] = totalPages;
  const curPage  = _bkDGPage[book.id];
  const pageFrom = (curPage - 1) * _BK_DG_PAGE_SZ;
  const pageTo   = Math.min(pageFrom + _BK_DG_PAGE_SZ, totalRows);

  // Subconjunto de índices reais desta página
  const pageIdxs = [];
  for (let i = pageFrom; i < pageTo; i++) pageIdxs.push(i);

  // ---- HTML do paginador (rodapé externo, sempre visível) ----
  function buildPagerHTML() {
    const from = pageFrom + 1;
    const to   = pageTo;
    let h = '<div class="bk-dg-pager">';
    if (totalPages > 1) {
      h += '<button class="bk-dg-pager-btn" ' + (curPage <= 1 ? 'disabled' : 'onclick="_bkDGGoPage(' + book.id + ',' + (curPage - 1) + ')"') + '>&#8592;</button>';
      const show = new Set([1, totalPages]);
      for (let p = Math.max(2, curPage - 2); p <= Math.min(totalPages - 1, curPage + 2); p++) show.add(p);
      let prev = 0;
      [...show].sort((a,b)=>a-b).forEach(p => {
        if (prev && p - prev > 1) h += '<span class="bk-dg-pager-ellipsis">…</span>';
        h += '<button class="bk-dg-pager-btn' + (p === curPage ? ' bk-dg-pager-active' : '') + '" onclick="_bkDGGoPage(' + book.id + ',' + p + ')">' + p + '</button>';
        prev = p;
      });
      h += '<button class="bk-dg-pager-btn" ' + (curPage >= totalPages ? 'disabled' : 'onclick="_bkDGGoPage(' + book.id + ',' + (curPage + 1) + ')"') + '>&#8594;</button>';
    }
    h += '<span class="bk-dg-pager-info">' + from + '–' + to + ' de ' + totalRows + ' reg. | pág. ' + curPage + '/' + totalPages + '</span>';
    h += '</div>';
    return h;
  }

  // Atualiza paginador externo
  if (footerPager) {
    footerPager.style.display = '';
    footerPager.innerHTML = buildPagerHTML();
  }

  // Alias local para manter o uso abaixo
  function pagerHTML() { return ''; }  // removido do interior do grid-wrap

  // Comprimento total do registro para leitura posicional do _raw
  const recLen = book.layout.filter(f => !f.isGroup)
                   .reduce((m, f) => Math.max(m, f.offset + f.size), 0);
  // Lê valor de uma célula pelo offset real do campo — evita sobrescrever por nomes duplicados
  function _cv(row, f) {
    if (row._raw != null) return (row._raw).padEnd(recLen, ' ').substring(f.offset, f.offset + f.size);
    const flds = row.fields || {};
    return flds[f.name] !== undefined ? flds[f.name] : '';
  }

  if (_bkDGViewH) {
    // ========== MODO HORIZONTAL: blocos consecutivos por variante (só página atual) ==========
    // Reconstrói blocos usando apenas os índices da página
    const pageRows = pageIdxs.map(i => rows[i]);
    const blocks = _bkBuildBlocksFromIdxs(book, rows, pageIdxs);

    let html = pagerHTML();
    html += '<div class="bk-dg-blocks">';
    blocks.forEach(block => {
      const varLabel = block.variant || '— padrão —';
      const isPad    = !block.variant;
      html += '<div class="bk-dg-block">';
      html += '<div class="bk-dg-block-hdr' + (isPad ? ' bk-dg-block-padrao' : '') + '">';
      html += varLabel;
      html += '<span class="bk-dg-block-badge">' + block.rows.length + ' registro(s)</span>';
      html += '</div>';
      html += '<div class="bk-dg-block-scroll"><table class="bk-dg-table"><thead><tr>';
      html += '<th class="bk-dg-th bk-dg-seq">#</th>';
      if (hasRedef) html += '<th class="bk-dg-th bk-dg-var">Layout</th>';
      block.cols.forEach(f => {
        const rc  = f.redefGroup ? ' bk-dg-th-redef' : '';
        const tip = 'PIC: ' + (f.pic || '') + ' | Tam: ' + f.size + ' | Pos: ' + (f.offset + 1) + '-' + (f.offset + f.size);
        html += '<th class="bk-dg-th' + rc + '" title="' + tip + '">' + f.name + '</th>';
      });
      html += '<th class="bk-dg-th bk-dg-act"></th></tr></thead><tbody>';
      block.rows.forEach(idx => {  // idx = índice real em rows[]
        const row = rows[idx];
        html += '<tr class="bk-dg-row">';
        html += '<td class="bk-dg-td bk-dg-seq">' + (idx + 1) + '</td>';
        if (hasRedef) {
          html += '<td class="bk-dg-td bk-dg-var"><select class="bk-dg-var-sel-h" onchange="bkDataSetVariant(' + idx + ',this.value)">';
          html += '<option value="">— padrão —</option>';
          allVars.forEach(v => {
            html += '<option value="' + v + '"' + (row.variant === v ? ' selected' : '') + '>' + v + '</option>';
          });
          html += '</select></td>';
        }
        block.cols.forEach(f => {
          const rc  = f.redefGroup ? ' bk-dg-td-redef' : '';
          const val = _cv(row, f).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
          html += '<td class="bk-dg-td' + rc + '"><input class="bk-dg-input" data-row="' + idx + '" data-field="' + f.name + '" data-offset="' + f.offset + '" data-size="' + f.size + '" value="' + val + '" oninput="bkDataSetCell(this)"></td>';
        });
        html += '<td class="bk-dg-td bk-dg-act"><button class="bk-dg-del-h" onclick="bkDataDeleteRow(' + idx + ')">&#10005;</button></td>';
        html += '</tr>';
      });
      html += '</tbody></table></div></div>';
    });
    html += '</div>';
    html += pagerHTML();
    wrap.innerHTML = html;
  } else {
    // ========== MODO VERTICAL (cards) — só página atual ==========
    let html = pagerHTML();
    html += '<div class="bk-dg-cards">';
    pageIdxs.forEach(idx => {
      const row     = rows[idx];
      const rowCols = bkDataVariantCols(book, row.variant || null);
      html += '<div class="bk-dg-card">';
      html += '<div class="bk-dg-card-hdr">';
      html += '<span class="bk-dg-seq-lbl">#' + (idx + 1) + '</span>';
      if (hasRedef) {
        html += '<select class="bk-dg-var-sel" onchange="bkDataSetVariant(' + idx + ',this.value)">';
        html += '<option value="">— padrão —</option>';
        allVars.forEach(v => {
          html += '<option value="' + v + '"' + (row.variant === v ? ' selected' : '') + '>' + v + '</option>';
        });
        html += '</select>';
      }
      html += '<button class="bk-dg-del" onclick="bkDataDeleteRow(' + idx + ')">&#10005;</button>';
      html += '</div>';
      html += '<table class="bk-dg-card-body">';
      rowCols.forEach(f => {
        const isRedef = !!f.redefGroup;
        const val = _cv(row, f).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
        const tip = 'PIC: ' + (f.pic || '') + ' | Tam: ' + f.size + ' | Pos: ' + (f.offset + 1) + '-' + (f.offset + f.size);
        html += '<tr class="bk-dg-field-row">';
        html += '<td class="bk-dg-field-name' + (isRedef ? ' redef' : '') + '" title="' + tip + '">' + f.name + '</td>';
        html += '<td class="bk-dg-field-val"><input class="bk-dg-input" data-row="' + idx + '" data-field="' + f.name + '" data-offset="' + f.offset + '" data-size="' + f.size + '" value="' + val + '" oninput="bkDataSetCell(this)"></td>';
        html += '</tr>';
      });
      html += '</table></div>';
    });
    html += '</div>';
    html += pagerHTML();
    wrap.innerHTML = html;
  }
}

// ---- Operações de linha ----
function bkDataAddRow(rawStr) {
  const book = bkGetActive();
  if (!book || !book.layout.length) return;
  if (!_bkDataStore[book.id]) _bkDataStore[book.id] = [];
  let variant = rawStr ? bkDataAutoVariant(rawStr, book) : null;
  const fields  = rawStr ? bkDataDecodeOneLine(rawStr, book, variant) : {};
  // Se não detectou pelo raw, tenta pelos campos decodificados
  if (!variant && Object.keys(fields).length) variant = bkDataAutoVariantFromFields(fields, book);
  _bkDataStore[book.id].push({ fields, variant, _raw: rawStr || null });
  _bkDGRender(book);
}

function bkDataDeleteRow(idx) {
  const book = bkGetActive(); if (!book) return;
  bkDataGetRows().splice(idx, 1);
  _bkDGRender(book);
}

function bkDataSetCell(inp) {
  const idx    = parseInt(inp.dataset.row, 10);
  const field  = inp.dataset.field;
  const offset = inp.dataset.offset !== undefined ? parseInt(inp.dataset.offset, 10) : -1;
  const size   = inp.dataset.size   !== undefined ? parseInt(inp.dataset.size, 10)   : 0;
  const val    = inp.value;
  const rows   = bkDataGetRows();
  if (!rows[idx]) return;
  if (!rows[idx].fields) rows[idx].fields = {}; // inicializa lazy
  rows[idx].fields[field] = val;
  // Atualiza o _raw posicionalmente — preserva os demais campos e resolve nomes duplicados
  if (rows[idx]._raw != null && offset >= 0 && size > 0) {
    const base   = rows[idx]._raw.padEnd(offset + size, ' ');
    const padded = (val + ' '.repeat(size)).substring(0, size);
    rows[idx]._raw = base.substring(0, offset) + padded + base.substring(offset + size);
  }
  // Se o campo editado é chave de algum REDEFINES, re-detecta variante
  const book = bkGetActive();
  if (book) {
    const rules  = _bkDataKeyRule[book.id] || {};
    const isKey  = Object.values(rules).some(r => {
      const pv = r.perVariant || {};
      return Object.values(pv).some(conds => (conds || []).some(c => c.keyField === field));
    });
    if (isKey) {
      const raw = rows[idx]._raw;
      const newVariant = raw != null
        ? bkDataAutoVariant(raw, book)
        : bkDataAutoVariantFromFields(rows[idx].fields || {}, book);
      if (newVariant !== rows[idx].variant) {
        rows[idx].variant = newVariant;
        rows[idx].fields  = null; // invalida cache lazy
        _bkDGRender(book);
      }
    }
  }
}

function bkDataSetVariant(idx, variant) {
  const book = bkGetActive(); if (!book) return;
  const rows = bkDataGetRows();
  if (!rows[idx]) return;
  rows[idx].variant = variant || null;
  if (rows[idx]._raw) rows[idx].fields = bkDataDecodeOneLine(rows[idx]._raw, book, rows[idx].variant);
  _bkDGRender(book);
}

function bkDataClear() {
  const book = bkGetActive(); if (!book) return;
  if (bkDataGetRows().length > 0 && !confirm('Limpar todos os registros?')) return;
  _bkDataStore[book.id] = [];
  _bkDGPage[book.id] = 1;
  _bkDGRender(book);
}

// ---- Área colar bruto ----
function bkDataToggleRaw() {
  _bkDataRawVis = !_bkDataRawVis;
  const bar = document.getElementById('bk-data-raw-bar');
  if (bar) bar.classList.toggle('hidden', !_bkDataRawVis);
  if (_bkDataRawVis) { const ta = document.getElementById('bk-data-raw'); if (ta) ta.focus(); }
}

function bkDataDecodeRawPaste() {
  const book = bkGetActive();
  if (!book || !book.layout.length) return;
  const ta = document.getElementById('bk-data-raw');
  if (!ta || !ta.value.trim()) return;
  const wrap  = document.getElementById('bk-data-grid-wrap');
  const lines = ta.value.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.length > 0);
  ta.value = '';
  _bkDataRawVis = false;
  const bar = document.getElementById('bk-data-raw-bar');
  if (bar) bar.classList.add('hidden');
  if (!lines.length) return;
  const recLen    = book.layout.filter(f => !f.isGroup)
                      .reduce((m, f) => Math.max(m, f.offset + f.size), 0);
  const recPad    = Math.max(recLen, 1);
  const total     = Math.min(lines.length, _BK_MAX_ROWS);
  const truncated = lines.length > _BK_MAX_ROWS;
  if (!_bkDataStore[book.id]) _bkDataStore[book.id] = [];
  function parseAndPush(raw) {
    raw = raw.padEnd(recPad, ' ');
    let variant = bkDataAutoVariant(raw, book);
    const fields = bkDataDecodeOneLine(raw, book, variant);
    if (!variant && Object.keys(fields).length) variant = bkDataAutoVariantFromFields(fields, book);
    _bkDataStore[book.id].push({ fields, variant, _raw: raw });
  }
  if (total <= 200) {
    for (let i = 0; i < total; i++) parseAndPush(lines[i]);
    _bkDGPage[book.id] = 1;
    _bkDGRender(book);
    if (truncated) _bkInjectWarn(wrap, lines.length);
  } else {
    _bkShowProgress(wrap, 0, total, 'Decodificando');
    let i = 0;
    function processChunk() {
      const end = Math.min(i + _BK_IMPORT_CHUNK, total);
      for (; i < end; i++) parseAndPush(lines[i]);
      if (i < total) {
        _bkShowProgress(wrap, i, total, 'Decodificando');
        setTimeout(processChunk, 0);
      } else {
        _bkDGPage[book.id] = 1;
        _bkDGRender(book);
        if (truncated) _bkInjectWarn(wrap, lines.length);
      }
    }
    processChunk();
  }
}

// ---- Helpers de progresso ----
function _bkFmtBytes(b) {
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b >= 1024)   return (b / 1024).toFixed(0) + ' KB';
  return b + ' B';
}

function _bkShowProgress(wrap, done, total, label) {
  const pct = total > 0 ? Math.round(done / total * 100) : 0;
  wrap.innerHTML =
    '<div class="bk-import-progress">' +
      '<div class="bk-import-progress-label">' + label + ' &mdash; ' +
        done.toLocaleString('pt-BR') + ' / ' + total.toLocaleString('pt-BR') +
        ' registros (' + pct + '%)' +
      '</div>' +
      '<div class="bk-import-progress-track">' +
        '<div class="bk-import-progress-fill" style="width:' + pct + '%"></div>' +
      '</div>' +
    '</div>';
}

function _bkShowProgressFile(wrap, doneBytes, totalBytes, rowCount, label) {
  const pct     = totalBytes > 0 ? Math.round(doneBytes / totalBytes * 100) : 0;
  const doneStr = _bkFmtBytes(doneBytes) + ' / ' + _bkFmtBytes(totalBytes);
  wrap.innerHTML =
    '<div class="bk-import-progress">' +
      '<div class="bk-import-progress-label">' + label + ' &mdash; ' +
        doneStr + ' &nbsp;|&nbsp; ' + rowCount.toLocaleString('pt-BR') + ' reg. (' + pct + '%)' +
      '</div>' +
      '<div class="bk-import-progress-track">' +
        '<div class="bk-import-progress-fill" style="width:' + pct + '%"></div>' +
      '</div>' +
    '</div>';
}

// Retorna os fields de um registro, decodificando do _raw se ainda não foram preenchidos (lazy).
// Uso: exportações e funções que precisam do dict de campos por nome.
function _bkRowFields(row, book) {
  if (!row.fields || !Object.keys(row.fields).length) {
    if (row._raw != null) row.fields = bkDataDecodeOneLine(row._raw, book, row.variant);
  }
  return row.fields || {};
}

function _bkInjectWarn(wrap, originalCount) {
  const d = document.createElement('div');
  d.className = 'bk-import-warn';
  d.innerHTML = '&#9888; Arquivo truncado: exibindo primeiros <b>' +
    _BK_MAX_ROWS.toLocaleString('pt-BR') + '</b> de <b>' +
    originalCount.toLocaleString('pt-BR') + '</b> registros.';
  wrap.insertBefore(d, wrap.firstChild);
}

// ---- Import TXT posicional ----
function bkDataTriggerTxt() { document.getElementById('bk-data-file-txt').click(); }

function bkDataImportTxtFile(inp) {
  if (!inp.files || !inp.files.length) return;
  const book = bkGetActive();
  if (!book || !book.layout.length) { alert('Gere o layout primeiro.'); inp.value = ''; return; }
  const file = inp.files[0];
  inp.value = '';
  const wrap = document.getElementById('bk-data-grid-wrap');

  const recLen   = book.layout.filter(f => !f.isGroup).reduce((m, f) => Math.max(m, f.offset + f.size), 0);
  const recPad   = Math.max(recLen, 1);
  const totalSz  = file.size;
  if (!_bkDataStore[book.id]) _bkDataStore[book.id] = [];

  let bytesDone = 0;
  let rowCount  = 0;
  let exceeded  = false;
  let remainder = '';   // fragmento de linha incompleta ao final de cada chunk

  _bkShowProgressFile(wrap, 0, totalSz, 0, 'Importando');

  function readChunk() {
    if (exceeded || bytesDone >= totalSz) { _bkFinalize(); return; }
    const slice  = file.slice(bytesDone, bytesDone + _BK_STREAM_BYTES);
    const reader = new FileReader();
    reader.onload = ev => {
      bytesDone += slice.size;
      const text  = remainder + (ev.target.result || '');
      const lines = text.split('\n');
      remainder   = lines.pop() || ''; // guarda fragmento incompleto

      for (const line of lines) {
        if (exceeded) break;
        const raw = line.replace(/\r$/, '');
        if (!raw.length) continue;
        if (rowCount >= _BK_MAX_ROWS) { exceeded = true; break; }
        const padded  = raw.padEnd(recPad, ' ');
        const variant = bkDataAutoVariant(padded, book);
        // Não decodifica fields agora — lazy quando exportar (economiza ~50% de memória)
        _bkDataStore[book.id].push({ _raw: padded, variant, fields: null });
        rowCount++;
      }

      _bkShowProgressFile(wrap, bytesDone, totalSz, rowCount, 'Importando');
      setTimeout(readChunk, 0);
    };
    reader.onerror = () => { alert('Erro ao ler o arquivo.'); };
    reader.readAsText(slice, 'latin1');
  }

  function _bkFinalize() {
    // Processa remainder (última linha sem \n)
    if (remainder.length && !exceeded && rowCount < _BK_MAX_ROWS) {
      const raw = remainder.replace(/\r$/, '');
      if (raw.length) {
        const padded  = raw.padEnd(recPad, ' ');
        const variant = bkDataAutoVariant(padded, book);
        _bkDataStore[book.id].push({ _raw: padded, variant, fields: null });
        rowCount++;
      }
    }
    _bkDGPage[book.id] = 1;
    _bkRecalcAllVariants(book);
    _bkDGRender(book);
    if (exceeded) _bkInjectWarn(wrap, '> ' + _BK_MAX_ROWS.toLocaleString('pt-BR'));
  }

  readChunk();
}

// ---- Import Excel / CSV ----
function bkDataTriggerFile() { document.getElementById('bk-data-file-exc').click(); }

function bkDataImportTableFile(inp) {
  if (!inp.files || !inp.files.length) return;
  const book = bkGetActive();
  if (!book || !book.layout.length) { alert('Gere o layout primeiro.'); inp.value = ''; return; }
  const file = inp.files[0];
  const ext  = file.name.split('.').pop().toLowerCase();
  if (ext === 'xlsx' || ext === 'xls') {
    _bkImportXlsxLazy(file, book, inp);
  } else {
    const sep = ext === 'tsv' ? '\t' : ',';
    const reader = new FileReader();
    reader.onload = e => { _bkParseCsvText(e.target.result, sep, book); inp.value = ''; };
    reader.readAsText(file, 'utf-8');
  }
}

function _bkCsvRow(line, sep) {
  const out = []; let inQ = false, cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else { inQ = !inQ; } continue; }
    if (!inQ && c === sep) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function _bkParseCsvText(text, sep, book) {
  const lines = (text || '').split('\n').map(l => l.replace(/\r$/, ''));
  if (lines.length < 2) return;
  const header     = _bkCsvRow(lines[0], sep).map(h => h.trim().toUpperCase());
  const totalLines = lines.filter((l, i) => i > 0 && l.trim()).length;
  const truncated  = totalLines > _BK_MAX_ROWS;
  let   imported   = 0;
  if (!_bkDataStore[book.id]) _bkDataStore[book.id] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (imported >= _BK_MAX_ROWS) break;
    const vals   = _bkCsvRow(lines[i], sep);
    const fields = {};
    header.forEach((h, j) => { fields[h] = vals[j] !== undefined ? vals[j] : ''; });
    const variant = bkDataAutoVariantFromFields(fields, book);
    _bkDataStore[book.id].push({ fields, variant, _raw: null });
    imported++;
  }
  _bkDGPage[book.id] = 1;
  _bkRecalcAllVariants(book);
  _bkDGRender(book);
  if (truncated) {
    const wrap = document.getElementById('bk-data-grid-wrap');
    if (wrap) _bkInjectWarn(wrap, totalLines);
  }
}

function _bkImportXlsxLazy(file, book, inp) {
  if (typeof XLSX === 'undefined') { alert('Biblioteca Excel não carregada. Recarregue a página.'); inp.value = ''; return; }
  inp.value = '';
  const r = new FileReader();
  r.onload = e => {
    try {
      const wb   = XLSX.read(e.target.result, { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
      if (!data || !data.length) { alert('Planilha sem dados.'); return; }
      const isRowEmpty = row => !row || row.every(v => v === '' || v === undefined || v === null);
      const nonEmpty = data.filter(row => !isRowEmpty(row));
      if (!nonEmpty.length) { alert('Planilha sem dados.'); return; }
      _bkShowXlsPreview(nonEmpty, book, file.size);
    } catch (err) { alert('Erro ao ler Excel: ' + err.message); }
  };
  r.readAsArrayBuffer(file);
}

function _bkShowXlsPreview(data, book, fileBytes) {
  const PREVIEW_ROWS = 8;
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const preview   = data.slice(0, PREVIEW_ROWS);
  const maxCols   = Math.max(...data.slice(0, 20).map(r => r.length), 1);

  // ---- Análise ----
  const baseCols  = bkDataGetCols(book, null);                        // campos folha do layout base
  const layoutSz  = book.layout.filter(f => !f.isGroup)
                      .reduce((m, f) => Math.max(m, f.offset + f.size), 0);  // tamanho do registro
  const sampleRaw = data.slice(0, 5)
                      .map(row => row.map(v => v != null ? String(v) : '').join(''));
  const avgRawLen = sampleRaw.length
    ? Math.round(sampleRaw.reduce((s, l) => s + l.length, 0) / sampleRaw.length) : 0;

  // Badges de análise
  function badge(type, msg) {
    const colors = { ok:'#16a34a', warn:'#d97706', err:'#dc2626' };
    const bg     = { ok:'#f0fdf4', warn:'#fffbeb', err:'#fef2f2' };
    return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;color:${colors[type]};background:${bg[type]};margin:2px 2px">${msg}</span>`;
  }
  const fmtNum = n => n.toLocaleString('pt-BR');
  let analysis = '';
  // Linhas
  if (data.length > _BK_MAX_ROWS)
    analysis += badge('err', `⚠ ${fmtNum(data.length)} linhas — limite é ${fmtNum(_BK_MAX_ROWS)}, excedente ignorado`);
  else
    analysis += badge('ok', `✓ ${fmtNum(data.length)} linhas`);
  // Colunas vs campos
  if (maxCols > baseCols.length)
    analysis += badge('warn', `⚠ Excel: ${maxCols} colunas &gt; Layout: ${baseCols.length} campos — colunas extras ignoradas`);
  else if (maxCols < baseCols.length)
    analysis += badge('warn', `⚠ Excel: ${maxCols} colunas &lt; Layout: ${baseCols.length} campos — campos faltantes ficarão vazios`);
  else
    analysis += badge('ok', `✓ ${maxCols} colunas = ${baseCols.length} campos do layout`);
  // Tamanho sequencial
  if (avgRawLen > 0 && layoutSz > 0) {
    if (avgRawLen > layoutSz)
      analysis += badge('warn', `⚠ Tamanho médio concatenado: ${avgRawLen} bytes &gt; layout: ${layoutSz} bytes`);
    else if (avgRawLen < layoutSz)
      analysis += badge('warn', `⚠ Tamanho médio concatenado: ${avgRawLen} bytes &lt; layout: ${layoutSz} bytes`);
    else
      analysis += badge('ok', `✓ Tamanho concatenado bate com layout (${layoutSz} bytes)`);
  }
  // Arquivo
  if (fileBytes) {
    const mb = (fileBytes / 1048576).toFixed(1);
    const col = fileBytes > 50 * 1048576 ? 'warn' : 'ok';
    analysis += badge(col, `Arquivo: ${mb} MB`);
  }
  // Limites do sistema
  analysis += `<div style="font-size:10px;color:#94a3b8;margin-top:6px">Suporte: até <b>${fmtNum(_BK_MAX_ROWS)}</b> linhas por importação. Arquivos XLSX até ~50 MB funcionam bem no navegador.</div>`;

  // ---- Tabela de preview ----
  let thead = '<thead><tr><th style="color:#94a3b8">#</th>';
  for (let c = 0; c < maxCols; c++) {
    const lbl = c < baseCols.length ? `<span title="${baseCols[c].name}">${String.fromCharCode(65 + (c % 26))}</span>`
                                    : `<span style="color:#f87171">${String.fromCharCode(65 + (c % 26))}</span>`;
    thead += `<th>${lbl}</th>`;
  }
  // Linha de campos do layout no cabeçalho
  thead += '</tr><tr><th></th>';
  for (let c = 0; c < maxCols; c++) {
    if (c < baseCols.length)
      thead += `<th style="font-size:9px;color:#6366f1;font-weight:600;white-space:nowrap" title="${baseCols[c].name}">${baseCols[c].name.length > 10 ? baseCols[c].name.slice(0,9)+'…' : baseCols[c].name}</th>`;
    else
      thead += `<th style="font-size:9px;color:#f87171">extra</th>`;
  }
  thead += '</tr></thead>';

  let tbody = '<tbody>';
  preview.forEach((row, ri) => {
    tbody += `<tr><td style="color:#94a3b8;font-size:10px;padding:3px 8px;user-select:none">${ri + 1}</td>`;
    for (let c = 0; c < maxCols; c++) {
      const val     = row[c] !== undefined ? String(row[c]) : '';
      const display = esc(val.length > 20 ? val.slice(0, 18) + '…' : val);
      const style   = c >= baseCols.length ? 'color:#f87171' : '';
      tbody += `<td style="${style}" title="${esc(val)}">${display}</td>`;
    }
    tbody += '</tr>';
  });
  if (data.length > PREVIEW_ROWS)
    tbody += `<tr><td colspan="${maxCols + 1}" style="text-align:center;color:#94a3b8;font-size:10px;padding:6px">… mais ${fmtNum(data.length - PREVIEW_ROWS)} linhas</td></tr>`;
  tbody += '</tbody>';

  const ov = document.createElement('div');
  ov.className = 'bk-xls-modal-overlay';
  ov.id = 'bk-xls-modal-ov';
  const modal = document.createElement('div');
  modal.className = 'bk-xls-modal';
  modal.innerHTML = `
    <div class="bk-xls-modal-title">&#128196; Pré-visualização Excel &mdash; ${fmtNum(data.length)} linhas &times; ${maxCols} colunas &mdash; Layout: ${baseCols.length} campos / ${layoutSz} bytes</div>
    <div style="padding:8px 16px 4px">${analysis}</div>
    <div class="bk-xls-preview-wrap">
      <table class="bk-xls-preview-table"><thead>${thead}</thead>${tbody}</table>
    </div>
    <div class="bk-xls-modal-sub" style="padding:6px 16px 2px">Como importar cada linha?</div>
    <div class="bk-xls-modal-actions">
      <button class="bk-xls-btn-header"   onclick="_bkXlsImportConfirm('seq')"
        title="Concatena todas as células em uma string de largura fixa e decodifica pelo layout (igual ao TXT)">
        &#128195; Sequencial (TXT)<br><span style="font-size:10px;font-weight:400;opacity:.8">Une células → decodifica por posição</span>
      </button>
      <button class="bk-xls-btn-noheader" onclick="_bkXlsImportConfirm('col')"
        title="Cada coluna do Excel corresponde a um campo do layout, na mesma ordem">
        &#9783; Por Coluna<br><span style="font-size:10px;font-weight:400;opacity:.8">Coluna A → campo 1, B → campo 2...</span>
      </button>
      <button class="bk-xls-btn-cancel"   onclick="_bkXlsModalClose()">&#x2715; Cancelar</button>
    </div>
  `;
  ov.appendChild(modal);
  document.body.appendChild(ov);
  window._bkXlsPendingData = { data, book, baseCols };
}

function _bkXlsModalClose() {
  const ov = document.getElementById('bk-xls-modal-ov');
  if (ov) ov.remove();
  window._bkXlsPendingData = null;
}

function _bkXlsImportConfirm(mode) {
  const pending = window._bkXlsPendingData;
  _bkXlsModalClose();
  if (!pending) return;
  _bkProcessXlsData(pending.data, pending.book, pending.baseCols, mode);
}

function _bkProcessXlsData(data, book, baseCols, mode) {
  const total     = Math.min(data.length, _BK_MAX_ROWS);
  const truncated = data.length > _BK_MAX_ROWS;
  if (!_bkDataStore[book.id]) _bkDataStore[book.id] = [];

  for (let i = 0; i < total; i++) {
    const row = data[i];
    if (mode === 'col') {
      // Modo por coluna: coluna 0 → campo 0, coluna 1 → campo 1...
      const fields = {};
      baseCols.forEach((f, ci) => {
        fields[f.name] = row[ci] !== undefined && row[ci] !== null ? String(row[ci]) : '';
      });
      const variant = bkDataAutoVariantFromFields(fields, book);
      _bkDataStore[book.id].push({ fields, variant, _raw: null });
    } else {
      // Modo sequencial: une células → decodifica por posição como TXT
      const raw = row.map(v => (v !== undefined && v !== null) ? String(v) : '').join('');
      let variant = bkDataAutoVariant(raw, book);
      const fields = bkDataDecodeOneLine(raw, book, variant);
      if (!variant && Object.keys(fields).length) variant = bkDataAutoVariantFromFields(fields, book);
      _bkDataStore[book.id].push({ fields, variant, _raw: raw });
    }
  }

  _bkDGPage[book.id] = 1;
  _bkRecalcAllVariants(book);
  _bkDGRender(book);
  if (truncated) {
    const wrap = document.getElementById('bk-data-grid-wrap');
    if (wrap) _bkInjectWarn(wrap, data.length);
  }
}

// ---- Export ----
function bkDataExportCsv() {
  const book = bkGetActive(); if (!book) return;
  const rows = bkDataGetRows();
  if (!rows.length) { alert('Sem dados para exportar.'); return; }
  // Agrupa linhas consecutivas por variante (igual ao display)
  const blocks = _bkBuildBlocks(book, rows);
  const lines = [];
  blocks.forEach(block => {
    lines.push('# ' + (block.variant || '— padrão —'));
    lines.push(block.cols.map(f => '"' + f.name + '"').join(','));
    block.rows.forEach(idx => {
      const flds = _bkRowFields(rows[idx], book);
      lines.push(block.cols.map(f => '"' + (flds[f.name] || '').replace(/"/g, '""') + '"').join(','));
    });
    lines.push('');
  });
  bkDownloadBlob(lines.join('\r\n'), book.name + '-dados.csv', 'text/csv;charset=utf-8;');
}

function bkDataExportTxt() {
  const withData = bkBooksWithLayout().filter(b => (_bkDataStore[b.id] || []).length > 0);
  if (!withData.length) { alert('Sem dados para exportar.'); return; }
  _bkPickBook('Exportar Dados TXT', books => {
    books.forEach(book => {
      const rows = _bkDataStore[book.id] || [];
      if (!rows.length) return;
      // Se há _raw, usa diretamente (mais rápido e preserva bytes exatos)
      const lines = rows.map(row => row._raw != null ? row._raw : bkDataEncodeToRaw(_bkRowFields(row, book), book, row.variant));
      bkDownloadBlob(lines.join('\r\n'), `${book.name}-dados.txt`, 'text/plain;charset=latin1;');
    });
  }, b => (_bkDataStore[b.id] || []).length > 0);
}

function bkDataShowXlsMenu(e) {
  _bkClosePopup();
  const book = bkGetActive(); if (!book) return;
  const rows = bkDataGetRows(); if (!rows.length) { alert('Sem dados para exportar.'); return; }
  const hasVariants = rows.some(r => r.variant);

  const ov = document.createElement('div');
  ov.className = 'bk-popup-overlay';
  ov.id = 'bk-popup-ov';
  ov.onclick = _bkClosePopup;

  const pop = document.createElement('div');
  pop.className = 'bk-popup-wrap';
  pop.id = 'bk-popup-main';

  const rect = e.currentTarget.getBoundingClientRect();
  pop.style.top  = (rect.bottom + 4) + 'px';
  pop.style.left = rect.left + 'px';

  let html = '<div class="bk-pop-title">Exportar Excel como</div>';
  html += '<button onclick="_bkClosePopup();bkDataExportXls(\'single\')">&#128196; Planilha única (todas as linhas)</button>';
  if (hasVariants) {
    html += '<button onclick="_bkClosePopup();bkDataExportXls(\'tabs\')">&#128218; Abas separadas por variante</button>';
  }
  pop.innerHTML = html;

  document.body.appendChild(ov);
  document.body.appendChild(pop);
}

function _bkClosePopup() {
  const ov  = document.getElementById('bk-popup-ov');
  const pop = document.getElementById('bk-popup-main');
  if (ov)  ov.remove();
  if (pop) pop.remove();
}

function bkDataExportXls(mode) {
  const book = bkGetActive(); if (!book) return;
  const rows = bkDataGetRows();
  if (!rows.length) { alert('Sem dados para exportar.'); return; }

  const esc  = s => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const cell = (val, type, style) =>
    `<Cell${style ? ` ss:StyleID="${style}"` : ''}><Data ss:Type="${type}">${esc(val)}</Data></Cell>`;

  let sheetsXml = '';

  if (mode === 'tabs') {
    // Uma aba por variante
    const seen = new Set();
    const unique = [];
    rows.forEach(r => { const v = r.variant || null; if (!seen.has(v)) { seen.add(v); unique.push(v); } });
    unique.forEach(variant => {
      const cols    = bkDataVariantCols(book, variant);
      const varRows = rows.filter(r => (r.variant || null) === variant);
      let tbl = `<Row>${cols.map(c => cell(c.name, 'String', 'hdr')).join('')}</Row>\n`;
      varRows.forEach(row => {
        const flds = _bkRowFields(row, book);
        tbl += `<Row>${cols.map(c => cell(flds[c.name] || '', 'String')).join('')}</Row>\n`;
      });
      const sn = esc((variant || 'padrao').substring(0, 31));
      sheetsXml += `<Worksheet ss:Name="${sn}"><Table>${tbl}</Table></Worksheet>\n`;
    });
  } else {
    // Planilha única: igual à tela — blocos consecutivos por variante,
    // cada bloco com seu próprio cabeçalho de colunas
    const blocks = _bkBuildBlocks(book, rows);
    let tbl = '';
    blocks.forEach(block => {
      // Linha de título do bloco (variante)
      const varLabel = block.variant || '— padrão —';
      tbl += `<Row><Cell ss:StyleID="hdr"><Data ss:Type="String">${esc(varLabel)}</Data></Cell></Row>\n`;
      // Cabeçalho das colunas deste bloco
      tbl += `<Row>${block.cols.map(c => cell(c.name, 'String', 'hdr')).join('')}</Row>\n`;
      // Linhas de dados
      block.rows.forEach(idx => {
        const row  = rows[idx];
        const flds = _bkRowFields(row, book);
        tbl += `<Row>${block.cols.map(c => cell(flds[c.name] || '', 'String')).join('')}</Row>\n`;
      });
      // Linha em branco separadora
      tbl += `<Row><Cell><Data ss:Type="String"></Data></Cell></Row>\n`;
    });
    const sn = esc(book.name).substring(0, 31);
    sheetsXml = `<Worksheet ss:Name="${sn}"><Table>${tbl}</Table></Worksheet>\n`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:x="urn:schemas-microsoft-com:office:excel">
  <Styles>
    <Style ss:ID="hdr">
      <Font ss:Bold="1" ss:Color="#FFFFFF"/>
      <Interior ss:Color="#1A237E" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  ${sheetsXml}
</Workbook>`;

  bkDownloadBlob(xml, book.name + '-dados.xls', 'application/vnd.ms-excel;charset=utf-8');
}

function bkDataExportJson() {
  const withData = bkBooksWithLayout().filter(b => (_bkDataStore[b.id] || []).length > 0);
  if (!withData.length) { alert('Sem dados para exportar.'); return; }
  _bkPickBook('Exportar Dados JSON', books => {
    books.forEach(book => {
      const rows = _bkDataStore[book.id] || [];
      if (!rows.length) return;
      const out = rows.map(row => {
        const cols = bkDataVariantCols(book, row.variant || null);
        const flds = _bkRowFields(row, book);
        const obj  = {};
        cols.forEach(c => { obj[c.name] = flds[c.name] !== undefined ? flds[c.name] : ''; });
        return obj;
      });
      bkDownloadBlob(JSON.stringify(out, null, 2), `${book.name}-dados.json`, 'application/json;charset=utf-8');
    });
  }, b => (_bkDataStore[b.id] || []).length > 0);
}

// Helper: agrupa linhas consecutivas de mesma variante (usado no display e nos exports)
function _bkBuildBlocks(book, rows) {
  const blocks = [];
  rows.forEach((row, idx) => {
    const v = row.variant || null;
    if (!blocks.length || blocks[blocks.length - 1].variant !== v) {
      blocks.push({ variant: v, rows: [idx], cols: bkDataVariantCols(book, v) });
    } else {
      blocks[blocks.length - 1].rows.push(idx);
    }
  });
  return blocks;
}

// Variante que recebe índices reais (para modo paginado)
function _bkBuildBlocksFromIdxs(book, rows, idxs) {
  const blocks = [];
  idxs.forEach(idx => {
    const v = rows[idx].variant || null;
    if (!blocks.length || blocks[blocks.length - 1].variant !== v) {
      blocks.push({ variant: v, rows: [idx], cols: bkDataVariantCols(book, v) });
    } else {
      blocks[blocks.length - 1].rows.push(idx);
    }
  });
  return blocks;
}

function _bkDGGoPage(bookId, page) {
  _bkDGPage[bookId] = page;
  const book = _bkBooks.find(b => b.id === bookId);
  if (book) {
    _bkDGRender(book);
    const wrap = document.getElementById('bk-data-grid-wrap');
    if (wrap) wrap.scrollTop = 0;
  }
}

function bkDataTriggerJson() { document.getElementById('bk-data-file-json').click(); }

function bkDataImportJsonFile(inp) {
  const file = inp.files[0]; if (!file) return;
  inp.value = '';
  const book = bkGetActive();
  if (!book || !book.layout || !book.layout.length) { alert('Gere o layout do copybook antes de importar dados.'); return; }
  const r = new FileReader();
  r.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) { alert('JSON inválido: esperado um array de objetos.'); return; }
      if (!_bkDataStore[book.id]) _bkDataStore[book.id] = [];
      const truncated = data.length > _BK_MAX_ROWS;
      let count = 0;
      for (const item of data) {
        if (count >= _BK_MAX_ROWS) break;
        if (typeof item !== 'object' || item === null) continue;
        const fields = {};
        Object.keys(item).forEach(k => { fields[k] = item[k] !== undefined ? String(item[k]) : ''; });
        const variant = bkDataAutoVariantFromFields(fields, book);
        _bkDataStore[book.id].push({ fields, variant, _raw: null });
        count++;
      }
      _bkDGPage[book.id] = 1;
      _bkRecalcAllVariants(book);
      _bkDGRender(book);
      if (truncated) {
        const wrap = document.getElementById('bk-data-grid-wrap');
        if (wrap) _bkInjectWarn(wrap, data.length);
      }
      if (count === 0) alert('Nenhum registro importado do JSON.');
    } catch (err) { alert('Erro ao ler JSON: ' + err.message); }
  };
  r.readAsText(file, 'utf-8');
}

// ================================================================
// EXPORTAR
// ================================================================
// Retorna seções de campos para export: se tiver REDEFINES → uma entrada por variante, senão uma entrada com todos
function _bkExportSections(book) {
  const groups = bkGetRedefGroups(book);  // { target: [variantes...] }
  const hasRedef = Object.keys(groups).length > 0;
  if (!hasRedef) return [{ label: null, fields: book.layout.filter(f => !f.isGroup) }];

  const lvl1vars = new Set(
    book.layout.filter(f => f.redefines && f.redefGroup === f.name && f.level === 1).map(f => f.name)
  );
  // Seção BASE: campos que não pertencem a variante nível-1
  const baseFields = book.layout.filter(f => !f.isGroup && (!f.redefGroup || !lvl1vars.has(f.redefGroup)));
  const sections   = [{ label: 'BASE', fields: baseFields }];
  // Uma seção por variante
  Object.entries(groups).forEach(([target, variants]) => {
    variants.forEach(v => {
      const varFields = book.layout.filter(f => !f.isGroup && f.redefGroup === v);
      sections.push({ label: v, fields: varFields });
    });
  });
  return sections;
}

// ── Helpers de export ─────────────────────────────────────────────────────
function _bkEscHtml(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Modal para escolher quais layouts exportar.
// filterFn(book) → bool — filtra a lista (ex: apenas books com dados).
// onPicked(books[]) é chamado com o array de books selecionados.
function _bkPickBook(title, onPicked, filterFn) {
  const list = (filterFn ? bkBooksWithLayout().filter(filterFn) : bkBooksWithLayout());
  if (!list.length) return;
  if (list.length === 1) { onPicked(list); return; }

  const old = document.getElementById('bk-bkpick-ov');
  if (old) old.remove();

  const ov = document.createElement('div');
  ov.className = 'bk-xls-modal-overlay';
  ov.id = 'bk-bkpick-ov';

  const modal = document.createElement('div');
  modal.className = 'bk-xls-modal';
  modal.style.maxWidth = '420px';

  let html = `<div class="bk-xls-modal-title">${_bkEscHtml(title)}</div>`;
  html += `<div class="bk-xls-modal-sub">Selecione os layouts para exportar:</div>`;
  html += `<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
    <input id="bk-bkpick-search" type="text" placeholder="Pesquisar..." style="flex:1;padding:5px 8px;border:1px solid #ccc;border-radius:6px;font-size:13px;outline:none;">
    <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;white-space:nowrap;">
      <input type="checkbox" id="bk-bkpick-all" checked> <span>Todos</span>
    </label>
  </div>`;
  html += `<ul id="bk-bkpick-list" style="list-style:none;padding:0;margin:4px 0 10px;max-height:240px;overflow-y:auto;">`;
  list.forEach((b, i) => {
    html += `<li data-name="${_bkEscHtml(b.name.toLowerCase())}"><label style="display:flex;align-items:center;gap:8px;padding:5px 4px;cursor:pointer;border-radius:4px;">
      <input type="checkbox" class="bkpick-cb" value="${i}" checked>
      <span>${_bkEscHtml(b.name)}</span>
    </label></li>`;
  });
  html += `</ul>`;
  html += `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
    <button class="bk-xls-btn-cancel" id="bk-bkpick-cancel">Cancelar</button>
    <button class="bk-xls-btn-header" id="bk-bkpick-ok">Exportar</button>
  </div>`;

  modal.innerHTML = html;
  ov.appendChild(modal);
  document.body.appendChild(ov);

  // Pesquisa
  const searchInp = document.getElementById('bk-bkpick-search');
  const allCb = document.getElementById('bk-bkpick-all');
  const ul = document.getElementById('bk-bkpick-list');

  function _filterList() {
    const term = searchInp.value.trim().toLowerCase();
    Array.from(ul.querySelectorAll('li')).forEach(li => {
      li.style.display = (!term || li.dataset.name.includes(term)) ? '' : 'none';
    });
    _syncAllCb();
  }

  function _syncAllCb() {
    const visible = Array.from(ul.querySelectorAll('li:not([style*="display: none"]) .bkpick-cb'));
    const allChecked = visible.length > 0 && visible.every(c => c.checked);
    allCb.checked = allChecked;
    allCb.indeterminate = !allChecked && visible.some(c => c.checked);
  }

  searchInp.addEventListener('input', _filterList);

  allCb.addEventListener('change', () => {
    const term = searchInp.value.trim().toLowerCase();
    Array.from(ul.querySelectorAll('li')).forEach(li => {
      if (!term || li.dataset.name.includes(term)) {
        li.querySelector('.bkpick-cb').checked = allCb.checked;
      }
    });
  });

  ul.addEventListener('change', e => { if (e.target.classList.contains('bkpick-cb')) _syncAllCb(); });

  document.getElementById('bk-bkpick-cancel').onclick = () => ov.remove();
  document.getElementById('bk-bkpick-ok').onclick = () => {
    const sel = Array.from(modal.querySelectorAll('.bkpick-cb:checked'))
                     .map(c => list[+c.value]);
    ov.remove();
    if (sel.length) onPicked(sel);
  };
}

function bkExportCSV() {
  _bkPickBook('Exportar Layout CSV', books => {
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    const HDR = ['book','secao','nivel','nome','pic','tipo','inicio','tam','fim','redefines'];
    books.forEach(book => {
      const lines = [HDR.map(q).join(',')];
      _bkExportSections(book).forEach(sec => {
        sec.fields.forEach(f => {
          lines.push([
            book.name, sec.label || '', f.level, f.name,
            f.pic || '', f.type,
            f.offset + 1, f.size || '', f.offset + f.size,
            f.redefines || ''
          ].map(q).join(','));
        });
      });
      bkDownloadBlob(lines.join('\r\n'), `${book.name}-layout.csv`, 'text/csv;charset=utf-8;');
    });
  });
}

function bkExportJSON() {
  _bkPickBook('Exportar Layout JSON', books => {
    books.forEach(b => {
      bkDownloadBlob(
        JSON.stringify({ name: b.name, layout: b.layout }, null, 2),
        `${b.name}-layout.json`, 'application/json'
      );
    });
  });
}

function bkShowLayoutXlsMenu(e) {
  _bkClosePopup();
  const btnRect = e.currentTarget.getBoundingClientRect();
  _bkPickBook('Exportar Layout Excel', books => {
    window._bkXlsPendingBooks = books;
    const ov = document.createElement('div');
    ov.className = 'bk-popup-overlay'; ov.id = 'bk-popup-ov'; ov.onclick = _bkClosePopup;
    const pop = document.createElement('div');
    pop.className = 'bk-popup-wrap'; pop.id = 'bk-popup-main';
    pop.style.top  = (btnRect.bottom + 4) + 'px';
    pop.style.left = btnRect.left + 'px';
    let html = '<div class="bk-pop-title">Exportar Layout Excel como</div>';
    html += '<button onclick="_bkClosePopup();bkExportXLS(\'single\',window._bkXlsPendingBooks)">⏣ Planilha única</button>';
    html += '<button onclick="_bkClosePopup();bkExportXLS(\'tabs\',window._bkXlsPendingBooks)">⧉ Abas separadas por variante</button>';
    pop.innerHTML = html;
    document.body.appendChild(ov);
    document.body.appendChild(pop);
  });
}

function bkExportXLS(mode, books) {
  if (!books || !books.length) books = bkBooksWithLayout();
  if (!books.length) return;
  const list = books;
  mode = mode || 'single';

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const cell = (val, type, styleId) =>
    `<Cell${styleId ? ` ss:StyleID="${styleId}"` : ''}><Data ss:Type="${type}">${esc(val)}</Data></Cell>`;

  const HDR_SINGLE = ['Book','Seção','#','Nível','Nome','PIC','Tipo','Início','Tam','Fim','REDEFINES'];
  const HDR_TABS   = ['#','Nível','Nome','PIC','Tipo','Início','Tam','Fim','REDEFINES'];

  const styles = `
  <Styles>
    <Style ss:ID="hdr"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1A237E" ss:Pattern="Solid"/></Style>
    <Style ss:ID="sec"><Font ss:Bold="1" ss:Color="#1A237E" ss:Size="11"/><Interior ss:Color="#E8EAF6" ss:Pattern="Solid"/></Style>
  </Styles>`;

  let sheets = '';

  if (mode === 'single') {
    // Uma única aba com coluna Book + Seção
    let rows = `<Row>${HDR_SINGLE.map(h => cell(h, 'String', 'hdr')).join('')}</Row>\n`;
    let rowNum = 1;
    list.forEach(book => {
      const sections = _bkExportSections(book);
      sections.forEach(sec => {
        // Linha de título de seção na coluna A
        if (sec.label) {
          rows += `<Row>
            <Cell ss:MergeAcross="${HDR_SINGLE.length - 1}" ss:StyleID="sec"><Data ss:Type="String">${esc(book.name)} — ${esc(sec.label)}</Data></Cell>
          </Row>\n`;
        }
        sec.fields.forEach(f => {
          rows += `<Row>
            ${cell(book.name,          'String')}
            ${cell(sec.label || '',    'String')}
            ${cell(rowNum++,           'Number')}
            ${cell(f.level,            'Number')}
            ${cell(f.name,             'String')}
            ${cell(f.pic || '',        'String')}
            ${cell(f.type,             'String')}
            ${cell(f.offset + 1,       'Number')}
            ${cell(f.size || '',       f.size ? 'Number' : 'String')}
            ${cell(f.offset + f.size,  'Number')}
            ${cell(f.redefines || '',  'String')}
          </Row>\n`;
        });
      });
    });
    sheets = `<Worksheet ss:Name="Layout"><Table>${rows}</Table></Worksheet>\n`;
  } else {
    // Abas separadas por book + seção
    const usedNames = {};
    list.forEach(book => {
      const sections = _bkExportSections(book);
      sections.forEach(sec => {
        let sheetName = sec.label ? `${book.name}-${sec.label}` : book.name;
        sheetName = esc(sheetName).substring(0, 31);
        if (usedNames[sheetName]) { usedNames[sheetName]++; sheetName = sheetName.substring(0, 28) + usedNames[sheetName]; }
        else usedNames[sheetName] = 1;

        let rows = '';
        if (sec.label)
          rows += `<Row><Cell ss:MergeAcross="${HDR_TABS.length}" ss:StyleID="sec"><Data ss:Type="String">${esc(book.name)} — ${esc(sec.label)}</Data></Cell></Row>\n`;
        rows += `<Row>${HDR_TABS.map(h => cell(h, 'String', 'hdr')).join('')}</Row>\n`;
        let rowNum = 1;
        sec.fields.forEach(f => {
          rows += `<Row>
            ${cell(rowNum++,           'Number')}
            ${cell(f.level,            'Number')}
            ${cell(f.name,             'String')}
            ${cell(f.pic || '',        'String')}
            ${cell(f.type,             'String')}
            ${cell(f.offset + 1,       'Number')}
            ${cell(f.size || '',       f.size ? 'Number' : 'String')}
            ${cell(f.offset + f.size,  'Number')}
            ${cell(f.redefines || '',  'String')}
          </Row>\n`;
        });
        sheets += `<Worksheet ss:Name="${sheetName}"><Table>${rows}</Table></Worksheet>\n`;
      });
    });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:x="urn:schemas-microsoft-com:office:excel">
  ${styles}
${sheets}</Workbook>`;

  const fname = list.length === 1 ? `${list[0].name}-layout.xls` : 'book-layout.xls';
  bkDownloadBlob(xml, fname, 'application/vnd.ms-excel;charset=utf-8');
}

// ================================================================
// SALVAR / CARREGAR SESSÃO COMPLETA
// ================================================================
function bkSaveSession() {
  bkSaveCurrentSrc();
  const state = {
    version: 1,
    activeId: _bkActiveId,
    nextId: _bkNextId,
    books: _bkBooks,
    dataStore: _bkDataStore,
    keyRules: _bkDataKeyRule
  };
  const json = JSON.stringify(state, null, 2);
  const dt = new Date();
  const stamp = dt.getFullYear() + ('0'+(dt.getMonth()+1)).slice(-2) + ('0'+dt.getDate()).slice(-2)
              + '-' + ('0'+dt.getHours()).slice(-2) + ('0'+dt.getMinutes()).slice(-2);
  bkDownloadBlob(json, 'cobol-session-' + stamp + '.json', 'application/json;charset=utf-8;');
}

function bkLoadSessionFile(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    try {
      const state = JSON.parse(ev.target.result);
      if (!state || !Array.isArray(state.books)) { alert('Arquivo de sessão inválido.'); return; }
      if (!window.confirm('Carregar sessão "' + file.name + '"?\nOs books atuais serão substituídos.')) return;

      _bkBooks    = state.books.map(b => ({ id: b.id, name: b.name, color: b.color, src: b.src || '', layout: b.layout || [] }));
      _bkActiveId = state.activeId;
      _bkNextId   = state.nextId || (_bkBooks.reduce((m, b) => Math.max(m, +b.id), 0) + 1);

      Object.keys(_bkDataStore).forEach(k => delete _bkDataStore[k]);
      if (state.dataStore) Object.assign(_bkDataStore, state.dataStore);

      Object.keys(_bkDataKeyRule).forEach(k => delete _bkDataKeyRule[k]);
      if (state.keyRules) Object.assign(_bkDataKeyRule, state.keyRules);
      try { localStorage.setItem('cobol-flow-key-rules', JSON.stringify(_bkDataKeyRule)); } catch(_) {}

      const active = bkGetActive();
      document.getElementById('book-textarea').value = active ? (active.src || '') : '';
      document.getElementById('bk-parse-info').textContent = '';
      bkRenderBookList();
      bkRenderRight();
      updateBookEditor();
    } catch (ex) {
      alert('Erro ao carregar sessão: ' + ex.message);
    }
  };
  reader.readAsText(file, 'utf-8');
}

function bkDownloadBlob(content, filename, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}