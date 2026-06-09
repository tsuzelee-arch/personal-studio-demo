(function () {
  'use strict';

  const WL_KEY = 'ps_workflows';
  const WL_CAT_KEY = 'ps_workflow_cats';
  const DEFAULT_CATS = ['文生圖', '圖生圖', '多步驟'];

  let workflows = [];
  let customCats = [];
  let activeCat = '全部';
  let searchQuery = '';
  let editingId = null;
  let lastLoadedId = null;

  // ── Storage ──────────────────────────────────────────────────────────────
  function loadStorage() {
    try { workflows = JSON.parse(localStorage.getItem(WL_KEY)) || []; } catch (_) { workflows = []; }
    try { customCats = JSON.parse(localStorage.getItem(WL_CAT_KEY)) || []; } catch (_) { customCats = []; }
  }

  function persist() {
    localStorage.setItem(WL_KEY, JSON.stringify(workflows));
    localStorage.setItem(WL_CAT_KEY, JSON.stringify(customCats));
  }

  function nextId() {
    return workflows.length ? Math.max(...workflows.map(w => w.id)) + 1 : 1;
  }

  function allNonAllCats() {
    return [...DEFAULT_CATS, ...customCats.filter(c => !DEFAULT_CATS.includes(c))];
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────
  function saveWorkflow(name, category, description) {
    if (!window.getGraphDataDump) return;
    const data = window.getGraphDataDump();
    workflows.unshift({
      id: nextId(),
      name,
      category,
      description: description || '',
      nodeCount: data.nodes.length,
      data,
      createdAt: Date.now()
    });
    persist();
    render();
    if (window.showToast) window.showToast('✅ 工作流已儲存至庫');
  }

  function updateWorkflow(id, name, category, description) {
    const wl = workflows.find(w => w.id === id);
    if (!wl) return;
    wl.name = name;
    wl.category = category;
    wl.description = description || '';
    persist();
    render();
    if (window.showToast) window.showToast('✅ 已更新');
  }

  function deleteWorkflow(id) {
    workflows = workflows.filter(w => w.id !== id);
    persist();
    render();
  }

  function loadWorkflow(id) {
    const wl = workflows.find(w => w.id === id);
    if (!wl || !window.wfLoadData) return;
    window.wfLoadData(wl.data);
    window.switchPanel('workflow');
    lastLoadedId = id;
    if (window.showToast) window.showToast(`✅ 已載入：${wl.name}`);
  }

  function saveProgress() {
    if (!lastLoadedId) {
      if (window.showToast) window.showToast('⚠️ 尚未載入任何 workflow，請先從列表載入');
      return;
    }
    const wl = workflows.find(w => w.id === lastLoadedId);
    if (!wl || !window.getGraphDataDump) return;
    const data = window.getGraphDataDump();
    wl.data = data;
    wl.nodeCount = data.nodes.length;
    persist();
    render();
    if (window.showToast) window.showToast(`✅ 進度已保存：${wl.name}`);
  }

  function openOverwriteModal() {
    if (workflows.length === 0) {
      if (window.showToast) window.showToast('⚠️ 列表中沒有已儲存的 workflow');
      return;
    }
    const sel = document.getElementById('wlOverwriteSelect');
    if (!sel) return;
    sel.innerHTML = workflows.map(wl =>
      `<option value="${wl.id}"${wl.id === lastLoadedId ? ' selected' : ''}>${escHtml(wl.name)} (${escHtml(wl.category)})</option>`
    ).join('');
    document.getElementById('wlOverwriteModal')?.classList.remove('hidden');
  }

  function overwriteWorkflow(id) {
    const wl = workflows.find(w => w.id === id);
    if (!wl || !window.getGraphDataDump) return;
    const data = window.getGraphDataDump();
    wl.data = data;
    wl.nodeCount = data.nodes.length;
    persist();
    render();
    if (window.showToast) window.showToast(`✅ 已覆蓋：${wl.name}`);
  }

  // ── Filtering ─────────────────────────────────────────────────────────────
  function filtered() {
    const q = searchQuery.toLowerCase();
    return workflows.filter(w => {
      const matchCat = activeCat === '全部' || w.category === activeCat;
      const matchQ = !q || w.name.toLowerCase().includes(q) || (w.description || '').toLowerCase().includes(q);
      return matchCat && matchQ;
    });
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderSidebar() {
    const sidebar = document.getElementById('wlCategorySidebar');
    if (!sidebar) return;
    sidebar.innerHTML = '';
    const cats = ['全部', ...allNonAllCats()];
    cats.forEach(cat => {
      const count = cat === '全部' ? workflows.length : workflows.filter(w => w.category === cat).length;
      const item = document.createElement('div');
      item.className = 'cat-sidebar-item' + (cat === activeCat ? ' active' : '');
      item.innerHTML = `<span class="cat-label">${escHtml(cat)}</span><span class="cat-count">${count}</span>`;
      item.addEventListener('click', () => { activeCat = cat; renderSidebar(); renderCards(); });
      sidebar.appendChild(item);
    });
    const addBtn = document.createElement('div');
    addBtn.className = 'cat-sidebar-add';
    addBtn.textContent = '+ 新增分類';
    addBtn.addEventListener('click', () => {
      const name = prompt('輸入新分類名稱：');
      if (name && name.trim() && !allNonAllCats().includes(name.trim())) {
        customCats.push(name.trim());
        persist();
        renderSidebar();
        populateCatSelect();
      }
    });
    sidebar.appendChild(addBtn);
  }

  function renderCards() {
    const container = document.getElementById('wlContent');
    if (!container) return;
    const items = filtered();
    if (items.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">🗂</div><div class="empty-text">沒有工作流，點擊右上角儲存目前工作流</div></div>';
      bindCardEvents(container);
      return;
    }

    if (activeCat !== '全部') {
      container.innerHTML = renderGroup(activeCat, items);
    } else {
      // Group by category, maintaining insertion order
      const groups = {};
      items.forEach(w => {
        if (!groups[w.category]) groups[w.category] = [];
        groups[w.category].push(w);
      });
      container.innerHTML = Object.entries(groups).map(([cat, wls]) => renderGroup(cat, wls)).join('');
    }
    bindCardEvents(container);
  }

  function renderGroup(cat, items) {
    return `
      <div class="prompt-row-group">
        <div class="prompt-row-header">
          <span class="prompt-row-label">${escHtml(cat)}</span>
          <span class="prompt-row-count">${items.length}</span>
        </div>
        <div class="prompt-row-scroll">
          ${items.map(renderCard).join('')}
        </div>
      </div>`;
  }

  function renderCard(wl) {
    const date = new Date(wl.createdAt).toLocaleDateString('zh-TW');
    const meta = wl.description || `${wl.nodeCount} 個節點 · ${date}`;
    return `
      <div class="prompt-card wl-card" data-wl-id="${wl.id}" draggable="true">
        <div class="prompt-card-header">
          <div class="prompt-card-title">${escHtml(wl.name)}</div>
          <div class="prompt-card-actions">
            <button class="icon-btn wl-edit-btn" title="編輯" data-id="${wl.id}">✏️</button>
            <button class="icon-btn danger wl-del-btn" title="刪除" data-id="${wl.id}" data-name="${escHtml(wl.name)}">✕</button>
          </div>
        </div>
        <span class="prompt-card-cat cat-custom">${escHtml(wl.category)}</span>
        <div class="prompt-card-text">${escHtml(meta)}</div>
      </div>`;
  }

  function bindCardEvents(container) {
    container.querySelectorAll('.wl-card').forEach(card => {
      // Click anywhere on card (except action buttons) → load
      card.addEventListener('click', e => {
        if (e.target.closest('.wl-edit-btn, .wl-del-btn')) return;
        loadWorkflow(+card.dataset.wlId);
      });

      // Drag to canvas
      card.addEventListener('dragstart', e => {
        e.dataTransfer.setData('wl-id', card.dataset.wlId);
        e.dataTransfer.effectAllowed = 'copy';
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });

    container.querySelectorAll('.wl-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm(`確定刪除「${btn.dataset.name}」？`)) deleteWorkflow(+btn.dataset.id);
      });
    });
    container.querySelectorAll('.wl-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openModal(+btn.dataset.id));
    });
  }

  function renderQuickBar() {
    const body = document.getElementById('wfListQbBody');
    if (!body) return;
    const search = (document.getElementById('wfListQbSearch')?.value || '').toLowerCase();
    const items = workflows.filter(w =>
      !search || w.name.toLowerCase().includes(search) || (w.description || '').toLowerCase().includes(search)
    );
    if (items.length === 0) {
      body.innerHTML = `<div class="wf-list-qb-empty">沒有儲存的工作流</div>`;
      return;
    }
    body.innerHTML = items.map(wl => {
      const date = new Date(wl.createdAt).toLocaleDateString('zh-TW');
      return `<div class="wf-list-qb-item" data-wl-id="${wl.id}">
        <div class="wf-list-qb-name">${escHtml(wl.name)}</div>
        <div class="wf-list-qb-meta">${escHtml(wl.category)} · ${wl.nodeCount} 個節點 · ${date}</div>
      </div>`;
    }).join('');
    body.querySelectorAll('.wf-list-qb-item').forEach(item => {
      item.addEventListener('click', () => {
        loadWorkflow(+item.dataset.wlId);
        document.getElementById('wfWorkflowQuickBar')?.classList.remove('active');
      });
    });
  }

  function render() {
    renderSidebar();
    renderCards();
    renderQuickBar();
  }

  // ── Modal ─────────────────────────────────────────────────────────────────
  function populateCatSelect(selectedCat) {
    const sel = document.getElementById('wlSaveCat');
    if (!sel) return;
    const cats = allNonAllCats();
    sel.innerHTML = cats.map(c => `<option value="${escHtml(c)}"${c === selectedCat ? ' selected' : ''}>${escHtml(c)}</option>`).join('');
  }

  function openModal(id) {
    editingId = id || null;
    const modal = document.getElementById('wlSaveModal');
    const title = document.getElementById('wlModalTitle');
    if (!modal) return;

    if (editingId) {
      const wl = workflows.find(w => w.id === editingId);
      if (!wl) return;
      document.getElementById('wlSaveName').value = wl.name;
      document.getElementById('wlSaveDesc').value = wl.description || '';
      populateCatSelect(wl.category);
      if (title) title.textContent = '編輯工作流';
    } else {
      document.getElementById('wlSaveName').value = '';
      document.getElementById('wlSaveDesc').value = '';
      populateCatSelect();
      if (title) title.textContent = '儲存工作流至庫';
    }

    modal.classList.remove('hidden');
    setTimeout(() => document.getElementById('wlSaveName').focus(), 50);
  }

  function closeModal() {
    const modal = document.getElementById('wlSaveModal');
    if (modal) modal.classList.add('hidden');
    editingId = null;
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    loadStorage();

    // Modal confirm
    document.getElementById('wlSaveConfirmBtn')?.addEventListener('click', () => {
      const name = document.getElementById('wlSaveName').value.trim();
      if (!name) { alert('請輸入工作流名稱'); return; }
      const category = document.getElementById('wlSaveCat').value;
      const description = document.getElementById('wlSaveDesc').value.trim();
      if (editingId) {
        updateWorkflow(editingId, name, category, description);
      } else {
        saveWorkflow(name, category, description);
      }
      closeModal();
    });

    // Modal cancel / close
    document.getElementById('wlModalClose')?.addEventListener('click', closeModal);
    document.getElementById('wlModalCancel')?.addEventListener('click', closeModal);
    document.getElementById('wlSaveModal')?.addEventListener('click', e => { if (e.target.id === 'wlSaveModal') closeModal(); });

    // Enter key in name field submits
    document.getElementById('wlSaveName')?.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('wlSaveConfirmBtn').click(); });

    // Search
    document.getElementById('wlSearch')?.addEventListener('input', e => { searchQuery = e.target.value; renderCards(); });

    // "儲存目前工作流" in library panel header
    document.getElementById('wlSaveCurrentBtn')?.addEventListener('click', () => openModal(null));

    // "保存進度" — update last-loaded workflow's data
    document.getElementById('wfSaveProgressBtn')?.addEventListener('click', saveProgress);

    // "覆蓋workflow" — pick any saved workflow to overwrite
    document.getElementById('wfOverwriteBtn')?.addEventListener('click', openOverwriteModal);
    document.getElementById('wlOverwriteConfirm')?.addEventListener('click', () => {
      const id = +document.getElementById('wlOverwriteSelect').value;
      if (id) overwriteWorkflow(id);
      document.getElementById('wlOverwriteModal')?.classList.add('hidden');
    });
    document.getElementById('wlOverwriteClose')?.addEventListener('click', () => {
      document.getElementById('wlOverwriteModal')?.classList.add('hidden');
    });
    document.getElementById('wlOverwriteCancel')?.addEventListener('click', () => {
      document.getElementById('wlOverwriteModal')?.classList.add('hidden');
    });
    document.getElementById('wlOverwriteModal')?.addEventListener('click', e => {
      if (e.target.id === 'wlOverwriteModal') document.getElementById('wlOverwriteModal').classList.add('hidden');
    });

    // "workflow列表" quickbar toggle
    document.getElementById('wfWorkflowListBtn')?.addEventListener('click', () => {
      document.getElementById('wfWorkflowQuickBar')?.classList.toggle('active');
    });
    document.getElementById('wfWorkflowListClose')?.addEventListener('click', () => {
      document.getElementById('wfWorkflowQuickBar')?.classList.remove('active');
    });
    document.getElementById('wfListQbSearch')?.addEventListener('input', renderQuickBar);

    // Drop onto workflow canvas to load a dragged card
    const canvas = document.getElementById('workflowCanvas');
    if (canvas) {
      canvas.addEventListener('dragover', e => {
        if (e.dataTransfer.types.includes('wl-id')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          canvas.classList.add('wl-drag-over');
        }
      });
      canvas.addEventListener('dragleave', () => canvas.classList.remove('wl-drag-over'));
      canvas.addEventListener('drop', e => {
        canvas.classList.remove('wl-drag-over');
        const id = +e.dataTransfer.getData('wl-id');
        if (id) loadWorkflow(id);
      });
    }

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.WorkflowLibrary = { openSaveModal: () => openModal(null), render };
})();
