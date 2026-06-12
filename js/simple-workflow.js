/**
 * Simple Workflow (簡易工具流) — Group + IDE Layout Engine
 * Features:
 *  - Infinite absolute-positioned canvas with Pan & Zoom
 *  - Groups: user-defined colored regions that act as super-nodes
 *  - Click-to-connect & Drag-to-connect for both nodes and groups
 *  - Topological sort execution (graph-based, not X-axis)
 *  - Save / Load state to LocalStorage
 *  - Left asset browser + Right prompt quickbar
 */
(function () {
  'use strict';

  const canvas = document.getElementById('swfCanvas');
  const zoomWrapper = document.getElementById('swfZoomWrapper');
  const nodesContainer = document.getElementById('swfNodesContainer');
  const edgesSvg = document.getElementById('swfEdgesSvg');
  if (!canvas || !zoomWrapper || !nodesContainer) return;

  // ── State ──
  let idCounter = 0;
  const nodes = {};       // id → nodeData
  const groups = {};      // id → groupData
  const edges = [];       // { id, source, target }
  
  let selectedEntityId = null;

  let zoomLevel = 1;
  const ZOOM_MIN = 0.2, ZOOM_MAX = 3, ZOOM_STEP = 0.1;
  
  // Pan state
  let isPanning = false;
  let panStartX = 0, panStartY = 0;
  let scrollStartX = 0, scrollStartY = 0;
  let panX = 0, panY = 0;

  // Space panning state
  let isSpaceHeld = false;

  // Connection state
  let activeOutPort = null;

  // ── Undo / Redo ──
  const undoStack = [];
  const redoStack = [];
  const UNDO_MAX = 30;
  let undoLock = false; // prevent saving state during undo/redo restoration

  function saveUndoState() {
    if (undoLock) return;
    try {
      const snap = JSON.stringify(serializeState());
      undoStack.push(snap);
      if (undoStack.length > UNDO_MAX) undoStack.shift();
      redoStack.length = 0; // clear redo on new action
    } catch(e) { console.warn('Undo save failed:', e); }
  }

  function undo() {
    if (undoStack.length === 0) { if (window.showToast) window.showToast('⚠️ 沒有可復原的操作'); return; }
    try {
      const currentSnap = JSON.stringify(serializeState());
      redoStack.push(currentSnap);
      const prev = undoStack.pop();
      undoLock = true;
      loadWorkflowData(prev, true);
      undoLock = false;
      if (window.showToast) window.showToast('↩ 已復原');
    } catch(e) { undoLock = false; console.warn('Undo failed:', e); }
  }

  function redo() {
    if (redoStack.length === 0) { if (window.showToast) window.showToast('⚠️ 沒有可重做的操作'); return; }
    try {
      const currentSnap = JSON.stringify(serializeState());
      undoStack.push(currentSnap);
      const next = redoStack.pop();
      undoLock = true;
      loadWorkflowData(next, true);
      undoLock = false;
      if (window.showToast) window.showToast('↪ 已重做');
    } catch(e) { undoLock = false; console.warn('Redo failed:', e); }
  }

  // ── Helpers ──
  function uid(prefix) { return (prefix || 'swf') + '_' + Date.now() + '_' + (++idCounter); }

  /** Check if entity is a group */
  function isGroup(id) { return !!groups[id]; }
  /** Get entity (node or group) */
  function getEntity(id) { return nodes[id] || groups[id] || null; }
  /** Get port element for entity */
  function getPortEl(id, type) {
    const ent = getEntity(id);
    if (!ent) return null;
    if (isGroup(id)) return ent.el.querySelector(type === 'out' ? '.swf-group-port-out' : '.swf-group-port-in');
    return ent.el.querySelector(type === 'out' ? '.swf-port-out' : '.swf-port-in');
  }

  function selectEntity(id) {
    selectedEntityId = id;
    document.querySelectorAll('.swf-selected').forEach(el => el.classList.remove('swf-selected'));
    if (id) {
      const ent = getEntity(id);
      if (ent && ent.el) ent.el.classList.add('swf-selected');
    }
  }

  // ═══════════════════════════════════════════
  // ── ZOOM & PAN ──
  // ═══════════════════════════════════════════
  function applyZoomAndPan() {
    zoomWrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
    const label = document.getElementById('swfZoomLabel');
    if (label) label.textContent = Math.round(zoomLevel * 100) + '%';
  }

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const targetX = (mouseX - panX) / zoomLevel;
    const targetY = (mouseY - panY) / zoomLevel;
    zoomLevel += (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
    zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomLevel));
    panX = mouseX - targetX * zoomLevel;
    panY = mouseY - targetY * zoomLevel;
    applyZoomAndPan();
    scheduleEdgeRender();
  }, { passive: false });

  canvas.addEventListener('mousedown', (e) => {
    // Middle mouse button always pans; Left click pans on empty area or when Space is held
    if (e.button === 1 || (e.button === 0 && (isSpaceHeld || e.target === canvas || e.target === zoomWrapper || e.target === edgesSvg || e.target === nodesContainer))) {
      isPanning = true;
      selectEntity(null);
      panStartX = e.clientX; panStartY = e.clientY;
      scrollStartX = panX; scrollStartY = panY;
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (isPanning) {
      panX = scrollStartX + (e.clientX - panStartX);
      panY = scrollStartY + (e.clientY - panStartY);
      applyZoomAndPan(); scheduleEdgeRender();
    }
    if (window.__swfTempEdge) {
      window.__swfTempEdge.currentX = e.clientX;
      window.__swfTempEdge.currentY = e.clientY;
      scheduleEdgeRender();
    }
  });

  window.addEventListener('mouseup', () => {
    if (isPanning) { isPanning = false; canvas.style.cursor = 'grab'; }
    if (window.__swfTempEdge) { window.__swfTempEdge = null; scheduleEdgeRender(); }
  });

  document.getElementById('swfZoomIn')?.addEventListener('click', () => {
    zoomLevel = Math.min(ZOOM_MAX, zoomLevel + ZOOM_STEP); applyZoomAndPan(); scheduleEdgeRender();
  });
  document.getElementById('swfZoomOut')?.addEventListener('click', () => {
    zoomLevel = Math.max(ZOOM_MIN, zoomLevel - ZOOM_STEP); applyZoomAndPan(); scheduleEdgeRender();
  });
  document.getElementById('swfZoomReset')?.addEventListener('click', () => {
    zoomLevel = 1; panX = 0; panY = 0; applyZoomAndPan(); scheduleEdgeRender();
  });

  // ═══════════════════════════════════════════
  // ── KEYBOARD SHORTCUTS ──
  // ═══════════════════════════════════════════
  window.addEventListener('keydown', (e) => {
    const panel = document.getElementById('panel-simple-workflow');
    if (!panel || !panel.classList.contains('active')) return; // Only active on SWF panel

    const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable;

    // Space key: enable pan mode
    if (e.code === 'Space' && !isInput) {
      e.preventDefault();
      if (!isSpaceHeld) {
        isSpaceHeld = true;
        canvas.style.cursor = 'grab';
      }
    }

    // Delete / Backspace: remove selected entity
    if (!isInput && (e.key === 'Delete' || e.key === 'Backspace')) {
      if (selectedEntityId) {
        saveUndoState();
        if (isGroup(selectedEntityId)) {
          promptRemoveGroup(selectedEntityId);
        } else {
          removeNode(selectedEntityId);
        }
        selectedEntityId = null;
      }
    }

    // Ctrl+Z: Undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    }
    // Ctrl+Y or Ctrl+Shift+Z: Redo
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      if (e.key === 'y' || e.shiftKey) {
        e.preventDefault();
        redo();
      }
    }

    // Ctrl+C: Copy selected node/group
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !isInput) {
      e.preventDefault();
      if (selectedEntityId) {
        window.__swfClipboard = { id: selectedEntityId, isGroup: isGroup(selectedEntityId) };
        if (window.showToast) window.showToast('📋 已複製');
      }
    }
    // Ctrl+V: Paste copied node/group
    if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !isInput) {
      e.preventDefault();
      if (window.__swfClipboard) {
        saveUndoState();
        if (window.__swfClipboard.isGroup) {
          duplicateGroup(window.__swfClipboard.id);
        } else {
          const srcNode = nodes[window.__swfClipboard.id];
          if (srcNode) duplicateNode(srcNode);
        }
      }
    }

    // Ctrl+Enter: Execute All
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      executeAll();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      isSpaceHeld = false;
      if (!isPanning) canvas.style.cursor = 'grab';
    }
  });

  // ═══════════════════════════════════════════
  // ── MODEL PARAMETERS DEFINITIONS ──
  // ═══════════════════════════════════════════
  const MODEL_PARAMS = {
    nanobanana2: {
      label: 'Nano Banana 2',
      params: [
        { key: 'aspectRatio', label: 'Aspect Ratio', type: 'select', options: ['1:1','16:9','9:16','4:3','3:4','3:2','2:3','4:5','5:4','21:9'], default: '1:1' },
        { key: 'imageSize', label: 'Image Size', type: 'select', options: [{ v: '', l: 'Default' }, { v: '512', l: '512px' }, { v: '1K', l: '1K' }, { v: '2K', l: '2K' }, { v: '4K', l: '4K' }], default: '' },
        { key: 'temperature', label: 'Temperature', type: 'range', min: 0, max: 2, step: 0.05, default: 0.4 },
      ]
    },
    nanobanana: {
      label: 'Nano Banana Pro',
      params: [
        { key: 'aspectRatio', label: 'Aspect Ratio', type: 'select', options: ['1:1','16:9','9:16','4:3','3:4','3:2','2:3','4:5','5:4','21:9'], default: '1:1' },
        { key: 'imageSize', label: 'Image Size', type: 'select', options: [{ v: '', l: 'Default' }, { v: '512', l: '512px' }, { v: '1K', l: '1K' }, { v: '2K', l: '2K' }, { v: '4K', l: '4K' }], default: '' },
        { key: 'temperature', label: 'Temperature', type: 'range', min: 0, max: 2, step: 0.05, default: 0.4 },
      ]
    },
    gptimage: {
      label: 'GPT Image 2.0',
      params: [
        { key: 'gptImageSize', label: 'Image Size (尺寸)', type: 'select', options: [{ v: '1024x1024', l: '1024×1024' }, { v: '1536x1024', l: '1536×1024' }, { v: '1024x1536', l: '1024×1536' }, { v: 'auto', l: 'Auto' }], default: '1024x1024' },
        { key: 'quality', label: 'Quality (品質)', type: 'select', options: [{ v: 'low', l: 'Low' }, { v: 'medium', l: 'Medium' }, { v: 'high', l: 'High' }, { v: 'auto', l: 'Auto' }], default: 'low' },
        { key: 'gptBackground', label: 'Background (背景)', type: 'select', options: [{ v: 'auto', l: 'Auto' }, { v: 'opaque', l: 'Opaque' }], default: 'auto' },
        { key: 'gptFidelity', label: 'Fidelity (還原度)', type: 'select', options: [{ v: 'high', l: 'High' }, { v: 'low', l: 'Low' }], default: 'high' },
      ]
    }
  };

  function buildParamsHTML(modelKey, savedParams) {
    const def = MODEL_PARAMS[modelKey]; if (!def) return '';
    const p = savedParams || {};
    return def.params.map(param => {
      if (param.type === 'select') {
        const opts = param.options.map(o => {
          const val = typeof o === 'string' ? o : o.v;
          const lbl = typeof o === 'string' ? o : o.l;
          const selected = (p[param.key] || param.default) === val ? 'selected' : '';
          return `<option value="${val}" ${selected}>${lbl}</option>`;
        }).join('');
        return `<div class="swf-param-row"><label>${param.label}</label><select data-param="${param.key}">${opts}</select></div>`;
      } else if (param.type === 'range') {
        const val = p[param.key] ?? param.default;
        return `<div class="swf-param-row"><label>${param.label}</label><div class="swf-slider-row"><input type="range" data-param="${param.key}" min="${param.min}" max="${param.max}" step="${param.step}" value="${val}"><span class="swf-slider-val">${Number(val).toFixed(2)}</span></div></div>`;
      }
      return '';
    }).join('');
  }

  // ═══════════════════════════════════════════
  // ── GROUP CREATION ──
  // ═══════════════════════════════════════════
  const GROUP_COLORS = ['#00c8b4', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];

  let swfSpawnOffset = 0;

  function calculateNextGroupPosition() {
    const rect = document.querySelector('.swf-canvas').getBoundingClientRect();
    const localX = (rect.width / 2 - panX) / zoomLevel - 240;
    const localY = (rect.height / 2 - panY) / zoomLevel - 160;
    swfSpawnOffset = (swfSpawnOffset + 30) % 150;
    return { x: Math.round(localX + swfSpawnOffset), y: Math.round(localY + swfSpawnOffset) };
  }

  function createGroup(initialX, initialY, w, h, color, title) {
    const id = uid('grp');
    const pos = (initialX !== undefined) ? { x: initialX, y: initialY } : calculateNextGroupPosition();
    const gw = w || 480;
    const gh = h || 320;
    const gc = color || GROUP_COLORS[Object.keys(groups).length % GROUP_COLORS.length];
    const gt = title || '群組 ' + (Object.keys(groups).length + 1);

    const el = document.createElement('div');
    el.className = 'swf-group';
    el.dataset.groupId = id;
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';
    el.style.width = gw + 'px';
    el.style.height = gh + 'px';
    // Use CSS custom properties so dark mode doesn't override with !important
    el.style.setProperty('--dyn-grp-color', gc);
    el.style.setProperty('--dyn-grp-bg', hexToRgba(gc, 0.08));

    el.innerHTML = `
      <div class="swf-group-port swf-group-port-in" data-port="in" data-node="${id}" title="群組接收端"></div>
      <div class="swf-group-port swf-group-port-out" data-port="out" data-node="${id}" title="群組輸出端"></div>
      <button class="swf-group-sidebar-toggle" title="上游圖片管理">📁</button>
      <div class="swf-group-sidebar">
        <div class="swf-gs-header">
          <span>📁 上游圖片</span>
          <button class="swf-gs-close">✕</button>
        </div>
        <div class="swf-gs-controls">
          <label class="swf-gs-checkbox-label"><input type="checkbox" class="swf-gs-receive-cb" checked> 接收上游圖片</label>
          <div style="margin-top: 6px; display: flex; gap: 4px; justify-content: space-between;">
            <button class="swf-gs-select-all" style="font-size: 10px; cursor: pointer; padding: 2px 4px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface);">全選</button>
            <button class="swf-gs-apply-btn" style="font-size: 10px; cursor: pointer; background: var(--accent, #1783FF); color: #fff; border: none; border-radius: 4px; padding: 2px 6px;">📥 套用至內部圖生圖</button>
          </div>
        </div>
        <div class="swf-gs-images"></div>
      </div>
      <div class="swf-group-header" style="background:${hexToRgba(gc, 0.15)};">
        <input class="swf-group-title" value="${gt}" spellcheck="false">
        <input type="color" class="swf-group-color-picker" value="${gc}" title="群組顏色">
        <div class="swf-group-actions">
          <button class="swf-grp-sync-btn" title="統一內部節點參數">🔄</button>
          <button class="swf-grp-dup-btn" title="複製群組">📋</button>
          <button class="swf-grp-run-btn" title="同步執行群組">▶</button>
          <button class="swf-grp-del-btn" title="刪除群組">✕</button>
        </div>
      </div>
      <div class="swf-group-resize"></div>
    `;

    nodesContainer.appendChild(el);

    const groupData = { id, el, x: pos.x, y: pos.y, width: gw, height: gh, color: gc, title: gt, resultImages: [], receiveUpstream: true, excludedImages: [], sidebarOpen: false };
    groups[id] = groupData;

    // Entity Selection
    el.addEventListener('mousedown', () => selectEntity(id));

    // Events
    setupGroupDrag(groupData);
    setupGroupResize(groupData);
    setupGroupEvents(groupData);
    setupPortEvents(el, id);
    scheduleEdgeRender();
    return groupData;
  }

  function hexToRgba(hex, alpha) {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function setupGroupEvents(group) {
    const el = group.el;
    el.querySelector('.swf-group-color-picker').addEventListener('input', (e) => {
      group.color = e.target.value;
      el.style.setProperty('--dyn-grp-color', group.color);
      el.style.setProperty('--dyn-grp-bg', hexToRgba(group.color, 0.08));
      el.querySelector('.swf-group-header').style.background = hexToRgba(group.color, 0.15);
    });
    el.querySelector('.swf-group-title').addEventListener('change', (e) => { group.title = e.target.value; });
    el.querySelector('.swf-grp-del-btn').addEventListener('click', () => { saveUndoState(); promptRemoveGroup(group.id); });
    el.querySelector('.swf-grp-run-btn').addEventListener('click', () => executeGroup(group.id));
    el.querySelector('.swf-grp-dup-btn').addEventListener('click', () => { saveUndoState(); duplicateGroup(group.id); });
    el.querySelector('.swf-grp-sync-btn').addEventListener('click', () => syncGroupParams(group.id));

    // Sidebar toggle
    el.querySelector('.swf-group-sidebar-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      group.sidebarOpen = !group.sidebarOpen;
      el.classList.toggle('sidebar-open', group.sidebarOpen);
      if (group.sidebarOpen) renderGroupSidebar(group);
    });
    el.querySelector('.swf-gs-close').addEventListener('click', (e) => {
      e.stopPropagation();
      group.sidebarOpen = false;
      el.classList.remove('sidebar-open');
    });
    el.querySelector('.swf-gs-receive-cb').addEventListener('change', (e) => {
      group.receiveUpstream = e.target.checked;
      propagateVisualImages();
      renderGroupSidebar(group);
    });

    // Select All
    el.querySelector('.swf-gs-select-all').addEventListener('click', () => {
      const checkboxes = el.querySelectorAll('.swf-gs-img-cb');
      const allChecked = Array.from(checkboxes).every(cb => cb.checked);
      checkboxes.forEach(cb => cb.checked = !allChecked);
    });

    // Apply to I2I
    el.querySelector('.swf-gs-apply-btn').addEventListener('click', () => {
      const checkboxes = el.querySelectorAll('.swf-gs-img-cb:checked');
      if (checkboxes.length === 0) {
        if (window.showToast) window.showToast('⚠️ 請先勾選要套用的圖片');
        return;
      }
      const selectedSrcs = Array.from(checkboxes).map(cb => cb.dataset.src);
      
      const members = getGroupMembers(group.id).filter(n => n.type === 'i2i');
      if (members.length === 0) {
        if (window.showToast) window.showToast('⚠️ 群組內沒有圖生圖(I2I)節點');
        return;
      }

      saveUndoState(); // Single undo history entry for batch update
      let appliedCount = 0;

      members.forEach(node => {
        let changed = false;
        selectedSrcs.forEach(src => {
          if (node.data.images.length < 16 && !node.data.images.includes(src)) {
            node.data.images.push(src);
            node.data.uploadedImages.push(src); // Treat as uploaded to persist it in this node
            changed = true;
          }
        });
        if (changed) {
          renderImageThumbs(node);
          appliedCount++;
        }
      });

      if (window.showToast) {
        if (appliedCount > 0) window.showToast(`✅ 已將圖片套用至 ${appliedCount} 個節點`);
        else window.showToast(`⚠️ 圖片皆已存在或達到 16 張上限`);
      }
    });
  }

  /** Render the group sidebar with upstream images */
  function renderGroupSidebar(group) {
    const container = group.el.querySelector('.swf-gs-images');
    if (!container) return;
    container.innerHTML = '';

    // Collect all upstream images flowing into this group
    const upstreamImages = [];
    edges.filter(e => e.target === group.id).forEach(e => {
      const src = getEntity(e.source);
      if (src && src.resultImages && src.resultImages.length > 0) {
        src.resultImages.forEach(img => upstreamImages.push(img));
      }
    });

    // Filter out excluded images
    const visibleImages = upstreamImages.filter(img => !group.excludedImages.includes(img));

    if (!group.receiveUpstream) {
      container.innerHTML = '<div class="swf-gs-empty">已關閉接收上游圖片</div>';
      return;
    }

    if (visibleImages.length === 0) {
      container.innerHTML = '<div class="swf-gs-empty">無上游圖片</div>';
      return;
    }

    visibleImages.forEach(imgSrc => {
      const wrapper = document.createElement('div');
      wrapper.className = 'swf-gs-img-wrapper';
      const img = document.createElement('img');
      img.src = imgSrc;
      img.className = 'swf-gs-img';
      img.draggable = true;
      img.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/swf-image-src', imgSrc);
        e.dataTransfer.effectAllowed = 'copy';
      });
      img.addEventListener('click', () => {
        if (window.AssetsService && window.AssetsService.openLightBox) window.AssetsService.openLightBox(imgSrc, '上游圖片', false);
      });
      const delBtn = document.createElement('button');
      delBtn.className = 'swf-gs-img-del';
      delBtn.textContent = '✕';
      delBtn.title = '排除此圖片';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        group.excludedImages.push(imgSrc);
        propagateVisualImages();
        renderGroupSidebar(group);
      });
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'swf-gs-img-cb';
      cb.dataset.src = imgSrc;
      cb.style.cssText = 'position: absolute; top: 0; left: 0; z-index: 3; cursor: pointer; width: 14px; height: 14px; margin: 2px;';
      cb.addEventListener('click', e => e.stopPropagation());

      wrapper.appendChild(img);
      wrapper.appendChild(cb);
      wrapper.appendChild(delBtn);
      container.appendChild(wrapper);
    });
  }

  function setupGroupDrag(group) {
    const header = group.el.querySelector('.swf-group-header');
    let isDragging = false, offsetX = 0, offsetY = 0, memberOffsets = [];

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.swf-group-actions') || e.target.tagName === 'INPUT') return;
      isDragging = true;
      group.el.style.zIndex = '2';
      const rect = group.el.getBoundingClientRect();
      offsetX = (e.clientX - rect.left) / zoomLevel;
      offsetY = (e.clientY - rect.top) / zoomLevel;
      // Capture member offsets for co-drag
      const members = getGroupMembers(group.id);
      memberOffsets = members.map(n => ({ node: n, dx: n.x - group.x, dy: n.y - group.y }));
      e.stopPropagation();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const wrapperRect = zoomWrapper.getBoundingClientRect();
      let newX = (e.clientX - wrapperRect.left) / zoomLevel - offsetX;
      let newY = (e.clientY - wrapperRect.top) / zoomLevel - offsetY;
      newX = Math.round(newX / 20) * 20;
      newY = Math.round(newY / 20) * 20;
      group.x = newX;
      group.y = newY;
      group.el.style.left = group.x + 'px';
      group.el.style.top = group.y + 'px';
      // Move members along
      memberOffsets.forEach(mo => {
        mo.node.x = group.x + mo.dx;
        mo.node.y = group.y + mo.dy;
        mo.node.el.style.left = mo.node.x + 'px';
        mo.node.el.style.top = mo.node.y + 'px';
      });
      scheduleEdgeRender();
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) { isDragging = false; group.el.style.zIndex = '1'; }
    });
  }

  function setupGroupResize(group) {
    const handle = group.el.querySelector('.swf-group-resize');
    let isResizing = false, startX = 0, startY = 0, startW = 0, startH = 0;

    handle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX; startY = e.clientY;
      startW = group.width; startH = group.height;
      e.stopPropagation(); e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      let newW = startW + (e.clientX - startX) / zoomLevel;
      let newH = startH + (e.clientY - startY) / zoomLevel;
      group.width = Math.max(300, newW);
      group.height = Math.max(200, newH);
      group.el.style.width = group.width + 'px';
      group.el.style.height = group.height + 'px';
      scheduleEdgeRender();
    });

    window.addEventListener('mouseup', () => { isResizing = false; });
  }

  /** Dynamic Membership: node is inside group if its center point is within group bounding box */
  function getGroupMembers(groupId) {
    const g = groups[groupId]; if (!g) return [];
    const members = [];
    for (const nid in nodes) {
      const n = nodes[nid];
      const nw = n.el.offsetWidth || 320;
      const nh = n.el.offsetHeight || 200;
      const cx = n.x + nw / 2;
      const cy = n.y + nh / 2;
      if (cx >= g.x && cx <= (g.x + g.width) && cy >= g.y && cy <= (g.y + g.height)) {
        members.push(n);
      }
    }
    return members;
  }

  function removeGroup(id) {
    const g = groups[id]; if (!g) return;
    g.el.remove();
    delete groups[id];
    for (let i = edges.length - 1; i >= 0; i--) {
      if (edges[i].source === id || edges[i].target === id) edges.splice(i, 1);
    }
    if (selectedEntityId === id) selectEntity(null);
    scheduleEdgeRender();
  }

  function promptRemoveGroup(id) {
    const g = groups[id]; if (!g) return;
    const members = getGroupMembers(id);
    if (members.length > 0) {
      if (confirm(`群組「${g.title}」內包含 ${members.length} 個節點。\n是否要連同內部的節點一起刪除？\n\n[確定] 刪除群組與內部節點\n[取消] 僅刪除群組外框`)) {
        members.forEach(m => removeNode(m.id));
      }
    }
    removeGroup(id);
  }

  /** Feature 6: Duplicate entire group with all member nodes and internal edges */
  function duplicateGroup(groupId) {
    const g = groups[groupId]; if (!g) return;
    const members = getGroupMembers(groupId);
    const offsetX = 60, offsetY = 60;

    // Create new group
    const newGroup = createGroup(g.x + offsetX, g.y + offsetY, g.width, g.height, g.color, g.title + ' (複本)');

    // Clone member nodes and build old→new ID map
    const idMap = {};
    members.forEach(srcNode => {
      const relX = srcNode.x - g.x;
      const relY = srcNode.y - g.y;
      const newNode = createMacroNode(srcNode.type, newGroup.x + relX, newGroup.y + relY);
      idMap[srcNode.id] = newNode.id;
      // Copy data
      newNode.data.model = srcNode.data.model;
      newNode.data.images = [...srcNode.data.images];
      newNode.data.params = { ...srcNode.data.params };
      newNode.el.querySelector('.swf-model-sel').value = srcNode.data.model;
      newNode.el.querySelector('.swf-params-area').innerHTML = buildParamsHTML(srcNode.data.model, srcNode.data.params);
      wireParamInputs(newNode);
      const sp = srcNode.el.querySelector('.swf-prompt-editor'), tp = newNode.el.querySelector('.swf-prompt-editor');
      if (sp && tp) tp.innerHTML = sp.innerHTML;
      renderImageThumbs(newNode);
    });

    // Clone internal edges
    const memberIdSet = new Set(members.map(m => m.id));
    edges.filter(e => memberIdSet.has(e.source) && memberIdSet.has(e.target)).forEach(e => {
      const newSrc = idMap[e.source], newTgt = idMap[e.target];
      if (newSrc && newTgt) addEdge(newSrc, newTgt);
    });

    if (window.showToast) window.showToast('✅ 已複製群組 "' + g.title + '"');
  }

  /** Feature 7: Sync all member nodes via Modal */
  let currentSyncGroupId = null;

  function syncGroupParams(groupId) {
    const members = getGroupMembers(groupId);
    if (members.length === 0) {
      if (window.showToast) window.showToast('⚠️ 群組內沒有節點');
      return;
    }
    currentSyncGroupId = groupId;
    
    // Default to the first node's parameters
    const source = members[0];
    const model = source.data.model || 'nanobanana2';
    const params = { ...source.data.params };
    
    // Populate modal
    const modal = document.getElementById('swfSyncParamsModal');
    const sel = document.getElementById('swfSyncModelSel');
    const container = document.getElementById('swfSyncParamsContainer');
    
    if (!modal || !sel || !container) return;
    
    sel.value = model;
    container.innerHTML = buildParamsHTML(model, params);
    
    // Wire up inputs within the modal to keep track of changed params internally
    // We can just rely on the inputs being there, and scrape them when confirmed
    // But we need to make sure the selects work. The HTML structure from buildParamsHTML handles basic selects.
    
    modal.classList.remove('hidden');
  }

  function applySyncParams() {
    if (!currentSyncGroupId) return;
    const members = getGroupMembers(currentSyncGroupId);
    if (members.length === 0) return;
    
    const sel = document.getElementById('swfSyncModelSel');
    const container = document.getElementById('swfSyncParamsContainer');
    const model = sel.value;
    
    // Scrape params from modal
    const newParams = {};
    const selects = container.querySelectorAll('select');
    selects.forEach(s => {
      const field = s.dataset.param;
      if (field) newParams[field] = s.value;
    });
    const inputs = container.querySelectorAll('input[type="range"]');
    inputs.forEach(i => {
      const field = i.dataset.param;
      if (field) newParams[field] = parseFloat(i.value);
    });
    
    // Apply to all members
    for (let i = 0; i < members.length; i++) {
      const n = members[i];
      n.data.model = model;
      n.data.params = { ...newParams };
      n.el.querySelector('.swf-model-sel').value = model;
      n.el.querySelector('.swf-params-area').innerHTML = buildParamsHTML(model, newParams);
      wireParamInputs(n);
    }
    
    if (window.showToast) window.showToast(`✅ 已將 ${members.length} 個節點統一為 ${MODEL_PARAMS[model]?.label || model}`);
    closeSyncModal();
  }

  function closeSyncModal() {
    currentSyncGroupId = null;
    document.getElementById('swfSyncParamsModal')?.classList.add('hidden');
  }

  // ═══════════════════════════════════════════
  // ── MACRO NODE CREATION ──
  // ═══════════════════════════════════════════
  function calculateNextPosition() {
    const rect = document.querySelector('.swf-canvas').getBoundingClientRect();
    const localX = (rect.width / 2 - panX) / zoomLevel - 160;
    const localY = (rect.height / 2 - panY) / zoomLevel - 100;
    swfSpawnOffset = (swfSpawnOffset + 30) % 150;
    return { x: Math.round(localX + swfSpawnOffset), y: Math.round(localY + swfSpawnOffset) };
  }

  function createMacroNode(type, initialX, initialY) {
    const id = uid('n');
    const isI2I = type === 'i2i';
    let pos = (initialX !== undefined) ? { x: initialX, y: initialY } : calculateNextPosition();

    const el = document.createElement('div');
    el.className = 'swf-macro';
    el.dataset.nodeId = id;
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';

    const headerTitle = isI2I ? '圖生圖 (I2I)' : '文生圖 (T2I)';
    const defaultModel = 'nanobanana2';
    const modelOptionsHTML = Object.entries(MODEL_PARAMS).map(([k, v]) =>
      `<option value="${k}" ${k === defaultModel ? 'selected' : ''}>${v.label}</option>`
    ).join('');

    el.innerHTML = `
      <div class="swf-port swf-port-in" data-port="in" data-node="${id}" title="接收連線"></div>
      <div class="swf-port swf-port-out" data-port="out" data-node="${id}" title="發起連線"></div>
      <div class="swf-macro-header">
        <span>${headerTitle}</span>
        <div class="swf-macro-actions">
          <button class="swf-collapse-btn" title="摺疊/展開">🔽</button>
          <button class="swf-dup-btn" title="複製">📋</button>
          <button class="swf-del-btn" title="刪除">&times;</button>
        </div>
      </div>
      <div class="swf-macro-body">
        <div class="swf-model-section"><label>Model</label><select class="swf-model-sel">${modelOptionsHTML}</select></div>
        <div class="swf-params-area">${buildParamsHTML(defaultModel, {})}</div>
        ${isI2I ? `<div><div class="swf-section-label">參考圖片 (拖曳排序 / 拖入提示詞)</div><div class="swf-images-area" data-node="${id}"><input type="file" class="swf-file-input" accept="image/*" multiple hidden><button class="swf-upload-btn" title="上傳圖片">+</button></div></div>` : ''}
        <div><div class="swf-section-label">提示詞 (Prompt)</div><div class="swf-prompt-editor" contenteditable="true" data-placeholder="輸入提示詞，可拖入圖片縮圖..." data-node="${id}"></div></div>
        <div class="swf-preview-area" data-node="${id}"><span class="swf-preview-placeholder">生成結果將顯示於此</span><img class="swf-preview-img" style="display:none;"><button class="swf-download-btn" title="下載">📥</button></div>
        <button class="swf-run-btn" data-node="${id}">▶ 生成</button>
      </div>
      <div class="swf-node-resize" title="調整大小"></div>
    `;

    nodesContainer.appendChild(el);
    const nodeData = { 
      id, type, el, x: pos.x, y: pos.y, 
      width: 320, isCollapsed: false,
      data: { model: defaultModel, images: [], uploadedImages: [], excludedIncomingImages: [], params: {}, promptHeight: 0 }, 
      resultImages: [] 
    };
    nodes[id] = nodeData;
    
    // Entity Selection
    el.addEventListener('mousedown', () => selectEntity(id));
    
    setupMacroEvents(nodeData);
    setupNodeDrag(nodeData);
    setupNodeResize(nodeData);
    setupPortEvents(el, id);
    
    // Setup ResizeObserver to update edges when node size changes (e.g. prompt editor vertical resize)
    const ro = new ResizeObserver(() => {
      if (nodeData.el.isConnected) scheduleEdgeRender();
    });
    ro.observe(nodeData.el);

    scheduleEdgeRender();
    return nodeData;
  }

  // ═══════════════════════════════════════════
  // ── NODE DRAG ──
  // ═══════════════════════════════════════════
  function setupNodeDrag(node) {
    const header = node.el.querySelector('.swf-macro-header');
    let isDraggingNode = false, offsetX = 0, offsetY = 0;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.swf-macro-actions')) return;
      isDraggingNode = true;
      node.el.classList.add('swf-dragging-node');
      const rect = node.el.getBoundingClientRect();
      offsetX = (e.clientX - rect.left) / zoomLevel;
      offsetY = (e.clientY - rect.top) / zoomLevel;
      e.stopPropagation();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDraggingNode) return;
      const wrapperRect = zoomWrapper.getBoundingClientRect();
      let newX = (e.clientX - wrapperRect.left) / zoomLevel - offsetX;
      let newY = (e.clientY - wrapperRect.top) / zoomLevel - offsetY;
      newX = Math.round(newX / 20) * 20;
      newY = Math.round(newY / 20) * 20;
      node.x = newX; node.y = newY;
      node.el.style.left = node.x + 'px'; node.el.style.top = node.y + 'px';
      scheduleEdgeRender();
    });

    window.addEventListener('mouseup', () => {
      if (isDraggingNode) { isDraggingNode = false; node.el.classList.remove('swf-dragging-node'); }
    });
  }

  // ═══════════════════════════════════════════
  // ── NODE RESIZE ──
  // ═══════════════════════════════════════════
  function setupNodeResize(node) {
    const handle = node.el.querySelector('.swf-node-resize');
    if (!handle) return;
    let isResizing = false, startX = 0, startW = 0;

    handle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startW = node.width || 320;
      e.stopPropagation(); e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      let newW = startW + (e.clientX - startX) / zoomLevel;
      node.width = Math.max(260, newW);
      node.el.style.width = node.width + 'px';
      // ResizeObserver handles scheduleEdgeRender automatically
    });

    window.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        saveUndoState(); // Save state after resize completes
      }
    });
  }

  // ═══════════════════════════════════════════
  // ── MACRO NODE EVENTS ──
  // ═══════════════════════════════════════════
  function setupMacroEvents(node) {
    const el = node.el, id = node.id;
    el.querySelector('.swf-del-btn').addEventListener('click', () => { saveUndoState(); removeNode(id); });
    el.querySelector('.swf-dup-btn').addEventListener('click', () => { saveUndoState(); duplicateNode(node); });

    const collapseBtn = el.querySelector('.swf-collapse-btn');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        node.isCollapsed = !node.isCollapsed;
        if (node.isCollapsed) {
          el.classList.add('swf-collapsed');
          collapseBtn.textContent = '▶';
        } else {
          el.classList.remove('swf-collapsed');
          collapseBtn.textContent = '🔽';
        }
        // Save state immediately for auto-save, if auto-save hooks into these changes. 
        // We will just call scheduleEdgeRender which is enough.
        scheduleEdgeRender();
      });
      if (node.isCollapsed) {
        el.classList.add('swf-collapsed');
        collapseBtn.textContent = '▶';
      }
    }

    el.querySelectorAll('.swf-section-label').forEach(label => {
      label.addEventListener('click', (e) => {
        const parent = e.target.parentElement;
        parent.classList.toggle('swf-section-collapsed');
        scheduleEdgeRender();
      });
    });

    const modelSel = el.querySelector('.swf-model-sel');
    modelSel.addEventListener('change', (e) => {
      node.data.model = e.target.value; node.data.params = {};
      el.querySelector('.swf-params-area').innerHTML = buildParamsHTML(e.target.value, {});
      wireParamInputs(node);
    });
    wireParamInputs(node);

    // Image upload (I2I)
    const imagesArea = el.querySelector('.swf-images-area');
    if (imagesArea) {
      const fileInput = imagesArea.querySelector('.swf-file-input');
      const uploadBtn = imagesArea.querySelector('.swf-upload-btn');
      uploadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => {
        saveUndoState();
        Array.from(e.target.files).forEach(file => {
          if (node.data.images.length >= 16) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            const dataUrl = ev.target.result;
            node.data.images.push(dataUrl);
            node.data.uploadedImages.push(dataUrl);
            renderImageThumbs(node);
          };
          reader.readAsDataURL(file);
        }); fileInput.value = '';
      });
      imagesArea.addEventListener('dragover', (e) => { e.preventDefault(); imagesArea.classList.add('drag-over'); });
      imagesArea.addEventListener('dragleave', () => imagesArea.classList.remove('drag-over'));
      imagesArea.addEventListener('drop', (e) => {
        e.preventDefault(); imagesArea.classList.remove('drag-over');

        // Check if this is an internal reorder (same node)
        const sourceNode = e.dataTransfer.getData('text/swf-source-node');
        if (sourceNode === node.id && e.dataTransfer.getData('text/swf-image-index')) {
          return; // Let setupImageSorting handle it
        }

        // External drop: from sidebar, asset browser, or file system
        const imgSrc = e.dataTransfer.getData('text/swf-image-src');
        if (imgSrc && node.data.images.length < 16) {
          saveUndoState();
          node.data.images.push(imgSrc);
          node.data.uploadedImages.push(imgSrc);
          renderImageThumbs(node);
          return;
        }

        // Handle asset drops
        const assetJson = e.dataTransfer.getData('text/ide-asset') || e.dataTransfer.getData('text/swf-asset');
        if (assetJson) {
          try {
            const asset = JSON.parse(assetJson);
            if (asset.data && node.data.images.length < 16) {
              saveUndoState();
              node.data.images.push(asset.data);
              node.data.uploadedImages.push(asset.data);
              renderImageThumbs(node);
            }
          } catch (err) { /* ignore */ }
          return;
        }
        if (e.dataTransfer.files.length > 0) {
          saveUndoState();
          Array.from(e.dataTransfer.files).forEach(file => {
            if (!file.type.startsWith('image/') || node.data.images.length >= 16) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
              const dataUrl = ev.target.result;
              node.data.images.push(dataUrl);
              node.data.uploadedImages.push(dataUrl);
              renderImageThumbs(node);
            };
            reader.readAsDataURL(file);
          });
        }
      });
      setupImageSorting(node);
    }

    // Prompt editor
    const promptEditor = el.querySelector('.swf-prompt-editor');
    promptEditor.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/swf-image-src') || e.dataTransfer.types.includes('text/swf-prompt')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    });
    promptEditor.addEventListener('drop', (e) => {
      const imgSrc = e.dataTransfer.getData('text/swf-image-src');
      const promptText = e.dataTransfer.getData('text/swf-prompt');
      if (imgSrc) {
        e.preventDefault(); promptEditor.focus();
        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
          const range = sel.getRangeAt(0); range.collapse(false);
          const img = document.createElement('img');
          img.src = imgSrc; img.className = 'inline-prompt-thumb'; img.draggable = false;
          range.insertNode(img); range.setStartAfter(img); range.collapse(true);
          sel.removeAllRanges(); sel.addRange(range);
        }
      } else if (promptText) {
        e.preventDefault(); promptEditor.focus();
        document.execCommand('insertText', false, promptText);
      }
    });

    el.querySelector('.swf-download-btn').addEventListener('click', () => {
      const img = el.querySelector('.swf-preview-img');
      if (!img.src) return;
      const a = document.createElement('a'); a.href = img.src; a.download = 'swf_' + Date.now() + '.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });
    el.querySelector('.swf-preview-img').addEventListener('click', function () {
      if (this.src && window.AssetsService?.openLightBox) window.AssetsService.openLightBox(this.src, 'Generated', false);
    });
    el.querySelector('.swf-run-btn').addEventListener('click', async () => await executeSingleNode(node));
  }

  function wireParamInputs(node) {
    const area = node.el.querySelector('.swf-params-area'); if (!area) return;
    area.querySelectorAll('select[data-param]').forEach(inp => {
      inp.addEventListener('change', () => { node.data.params[inp.dataset.param] = inp.value; });
      node.data.params[inp.dataset.param] = inp.value;
    });
    area.querySelectorAll('input[type="range"][data-param]').forEach(slider => {
      const valSpan = slider.parentElement.querySelector('.swf-slider-val');
      slider.addEventListener('input', () => {
        node.data.params[slider.dataset.param] = parseFloat(slider.value);
        if (valSpan) valSpan.textContent = Number(slider.value).toFixed(2);
      });
      node.data.params[slider.dataset.param] = parseFloat(slider.value);
    });
  }

  function renderImageThumbs(node) {
    const area = node.el.querySelector('.swf-images-area'); if (!area) return;
    const uploadBtn = area.querySelector('.swf-upload-btn');
    area.querySelectorAll('.swf-img-thumb-wrapper, .swf-empty-hint').forEach(t => t.remove());

    if (node.data.images.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'swf-empty-hint'; hint.textContent = '上傳或從上游接收圖片';
      area.insertBefore(hint, uploadBtn);
    } else {
      node.data.images.forEach((src, idx) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'swf-img-thumb-wrapper';
        wrapper.draggable = true;
        wrapper.dataset.imgIndex = idx;

        const img = document.createElement('img');
        img.className = 'swf-img-thumb'; img.src = src; img.draggable = false;

        // Determine if this is an uploaded image or upstream image
        const isUploaded = node.data.uploadedImages.includes(src);

        // Delete button
        const delBtn = document.createElement('button');
        delBtn.className = 'swf-img-thumb-del';
        delBtn.textContent = '✕';
        delBtn.title = isUploaded ? '刪除此圖片' : '排除此上游圖片';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          saveUndoState();
          // Remove from main array
          node.data.images.splice(idx, 1);
          if (isUploaded) {
            // Remove from uploadedImages
            const uIdx = node.data.uploadedImages.indexOf(src);
            if (uIdx >= 0) node.data.uploadedImages.splice(uIdx, 1);
          } else {
            // Add to excluded incoming so it won't be re-added on propagation
            if (!node.data.excludedIncomingImages.includes(src)) {
              node.data.excludedIncomingImages.push(src);
            }
          }
          renderImageThumbs(node);
          propagateVisualImages();
        });

        // Source indicator
        if (!isUploaded) {
          const badge = document.createElement('span');
          badge.className = 'swf-img-upstream-badge';
          badge.textContent = '⬆';
          badge.title = '上游圖片';
          wrapper.appendChild(badge);
        }

        wrapper.appendChild(img);
        wrapper.appendChild(delBtn);

        // Drag events for reordering
        wrapper.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/swf-image-index', String(idx));
          e.dataTransfer.setData('text/swf-image-src', src);
          e.dataTransfer.setData('text/swf-source-node', node.id);
          wrapper.classList.add('dragging');
        });
        wrapper.addEventListener('dragend', () => wrapper.classList.remove('dragging'));

        area.insertBefore(wrapper, uploadBtn);
      });
    }
    uploadBtn.style.display = node.data.images.length >= 16 ? 'none' : 'flex';
  }

  function setupImageSorting(node) {
    const area = node.el.querySelector('.swf-images-area'); if (!area) return;
    let dragIdx = null;
    area.addEventListener('dragover', (e) => {
      e.preventDefault();
      const target = e.target.closest('.swf-img-thumb-wrapper');
      if (target && dragIdx !== null) {
        const ti = parseInt(target.dataset.imgIndex);
        if (!isNaN(ti) && ti !== dragIdx && ti >= 0 && ti < node.data.images.length) {
          const tmp = node.data.images[dragIdx]; node.data.images[dragIdx] = node.data.images[ti]; node.data.images[ti] = tmp;
          dragIdx = ti; renderImageThumbs(node);
        }
      }
    });
    area.addEventListener('dragstart', (e) => {
      const wrapper = e.target.closest('.swf-img-thumb-wrapper');
      if (wrapper) dragIdx = parseInt(wrapper.dataset.imgIndex);
    });
    area.addEventListener('dragend', () => { dragIdx = null; });
  }

  // ═══════════════════════════════════════════
  // ── UNIFIED PORT EVENTS (for both Nodes & Groups) ──
  // ═══════════════════════════════════════════
  function setupPortEvents(el, entityId) {
    el.querySelectorAll('.swf-port, .swf-group-port').forEach(port => {
      port.addEventListener('mousedown', (e) => {
        e.stopPropagation(); e.preventDefault();
        if (port.dataset.port === 'out') {
          window.__swfTempEdge = { sourceNodeId: entityId, currentX: e.clientX, currentY: e.clientY };
          scheduleEdgeRender();
        }
      });
      port.addEventListener('mouseenter', () => port.classList.add('swf-port-hover'));
      port.addEventListener('mouseleave', () => port.classList.remove('swf-port-hover'));
      port.addEventListener('mouseup', (e) => {
        e.stopPropagation();
        if (window.__swfTempEdge && port.dataset.port === 'in') {
          if (window.__swfTempEdge.sourceNodeId !== entityId) {
            addEdge(window.__swfTempEdge.sourceNodeId, entityId);
          }
        }
        window.__swfTempEdge = null; scheduleEdgeRender();
      });
      port.addEventListener('click', (e) => { e.stopPropagation(); handlePortClick(port, entityId); });
    });
  }

  // ═══════════════════════════════════════════
  // ── EDGE SYSTEM (Unified for Nodes + Groups) ──
  // ═══════════════════════════════════════════
  function handlePortClick(port, entityId) {
    const isOut = port.dataset.port === 'out';
    if (isOut) {
      if (activeOutPort) activeOutPort.classList.remove('swf-port-active');
      activeOutPort = port; port.classList.add('swf-port-active');
      if (window.showToast) window.showToast('已選擇發起端，請點擊另一端的接收端口', 1500);
    } else {
      if (!activeOutPort) { if (window.showToast) window.showToast('請先點擊發出端口 (右側)', 1500); return; }
      const outId = activeOutPort.dataset.node;
      if (outId === entityId) { if (window.showToast) window.showToast('無法連接自己', 1500); return; }
      addEdge(outId, entityId);
      activeOutPort.classList.remove('swf-port-active'); activeOutPort = null;
    }
  }

  canvas.addEventListener('click', (e) => {
    if (activeOutPort && !e.target.classList.contains('swf-port') && !e.target.classList.contains('swf-group-port')) {
      activeOutPort.classList.remove('swf-port-active'); activeOutPort = null;
    }
  });

  function addEdge(source, target) {
    // Prevent duplicates
    if (edges.find(e => e.source === source && e.target === target)) return;
    // Prevent self-loop
    if (source === target) return;
    // Prevent connecting a group to a node that is inside it (and vice-versa)
    if (isGroup(source)) {
      const members = getGroupMembers(source);
      if (members.find(m => m.id === target)) {
        if (window.showToast) window.showToast('❌ 無法將群組連接到其內部的節點', 2000); return;
      }
    }
    if (isGroup(target)) {
      const members = getGroupMembers(target);
      if (members.find(m => m.id === source)) {
        if (window.showToast) window.showToast('❌ 無法將群組連接到其內部的節點', 2000); return;
      }
    }
    edges.push({ id: `e_${source}_${target}`, source, target });
    scheduleEdgeRender();
    propagateVisualImages();
  }

  function removeEdge(edgeId) {
    const idx = edges.findIndex(e => e.id === edgeId);
    if (idx >= 0) edges.splice(idx, 1);
    scheduleEdgeRender();
    propagateVisualImages();
  }

  /** Visually propagate all images downwards to instantly update node thumbnails when edges change */
  function propagateVisualImages() {
    // Determine group relationships
    const groupMemberSets = {};
    for (const gid in groups) { groupMemberSets[gid] = new Set(getGroupMembers(gid).map(m => m.id)); }

    for (const nid in nodes) {
      const n = nodes[nid];

      let groupIdIfAny = null;
      for (const gid in groupMemberSets) {
        if (groupMemberSets[gid].has(nid)) { groupIdIfAny = gid; break; }
      }
      
      const memberIds = groupIdIfAny ? groupMemberSets[groupIdIfAny] : new Set();
      
      // Collect raw upstream images for this node
      let rawUpstream = [];

      // Direct edges to this node (from outside group or standalone)
      edges.filter(e => e.target === nid).forEach(e => {
        const src = getEntity(e.source);
        if (src && src.resultImages && src.resultImages.length > 0) rawUpstream.push(...src.resultImages);
      });

      // If it's an entry node inside a group, also grab the group's incoming images
      if (groupIdIfAny) {
        const g = groups[groupIdIfAny];
        const isEntry = !edges.some(e => e.target === nid && memberIds.has(e.source));
        if (isEntry && g && g.receiveUpstream) {
          const groupUpstream = [];
          edges.filter(e => e.target === groupIdIfAny).forEach(e => {
            const src = getEntity(e.source);
            if (src && src.resultImages && src.resultImages.length > 0) groupUpstream.push(...src.resultImages);
          });
          // Apply group-level exclusion
          const filtered = groupUpstream.filter(img => !g.excludedImages.includes(img));
          rawUpstream.push(...filtered);
        }
      }

      // Apply node-level exclusion
      const activeUpstream = rawUpstream.filter(img => !n.data.excludedIncomingImages.includes(img));

      // Merge into unified images array while preserving user order:
      // 1. Keep existing items in images that are still valid (uploaded or active upstream)
      const validSet = new Set([...n.data.uploadedImages, ...activeUpstream]);
      const preservedImages = n.data.images.filter(img => validSet.has(img));
      
      // 2. Find new upstream images not already in preserved list
      const preservedSet = new Set(preservedImages);
      const newUpstream = activeUpstream.filter(img => !preservedSet.has(img));

      // 3. Final merged array: preserved order + new upstream appended
      n.data.images = [...preservedImages, ...newUpstream];
      
      renderImageThumbs(n);
    }

    // Also refresh any open group sidebars
    for (const gid in groups) {
      if (groups[gid].sidebarOpen) renderGroupSidebar(groups[gid]);
    }
  }

  function renderEdges() {
    const wrapperRect = zoomWrapper.getBoundingClientRect();
    let html = '';
    edges.forEach(edge => {
      const sp = getPortEl(edge.source, 'out'), tp = getPortEl(edge.target, 'in');
      if (!sp || !tp) return;
      const r1 = sp.getBoundingClientRect(), r2 = tp.getBoundingClientRect();
      const x1 = (r1.left - wrapperRect.left + r1.width / 2) / zoomLevel;
      const y1 = (r1.top - wrapperRect.top + r1.height / 2) / zoomLevel;
      const x2 = (r2.left - wrapperRect.left + r2.width / 2) / zoomLevel;
      const y2 = (r2.top - wrapperRect.top + r2.height / 2) / zoomLevel;
      const offset = Math.max(Math.abs(x2 - x1) * 0.4, 60);
      const isGroupEdge = isGroup(edge.source) || isGroup(edge.target);
      const color = isGroupEdge ? '#22d3ee' : 'var(--node-edge-color, #a0a0a0)';
      const sw = isGroupEdge ? 4 / zoomLevel : 3 / zoomLevel;
      html += `<path d="M ${x1} ${y1} C ${x1 + offset} ${y1}, ${x2 - offset} ${y2}, ${x2} ${y2}"
        fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"
        data-edge-id="${edge.id}" style="pointer-events:stroke; cursor:pointer;" />`;
    });

    // Temp drag edge
    if (window.__swfTempEdge) {
      const sp = getPortEl(window.__swfTempEdge.sourceNodeId, 'out');
      if (sp) {
        const r1 = sp.getBoundingClientRect();
        const x1 = (r1.left - wrapperRect.left + r1.width / 2) / zoomLevel;
        const y1 = (r1.top - wrapperRect.top + r1.height / 2) / zoomLevel;
        const x2 = (window.__swfTempEdge.currentX - wrapperRect.left) / zoomLevel;
        const y2 = (window.__swfTempEdge.currentY - wrapperRect.top) / zoomLevel;
        const offset = Math.max(Math.abs(x2 - x1) * 0.4, 60);
        html += `<path d="M ${x1} ${y1} C ${x1 + offset} ${y1}, ${x2 - offset} ${y2}, ${x2} ${y2}"
          fill="none" stroke="#4ade80" stroke-width="${3 / zoomLevel}" stroke-dasharray="${6/zoomLevel},${4/zoomLevel}" stroke-linecap="round" />`;
      }
    }

    edgesSvg.innerHTML = html;
    edgesSvg.querySelectorAll('path[data-edge-id]').forEach(p => {
      p.addEventListener('dblclick', () => removeEdge(p.dataset.edgeId));
    });
  }

  let edgeRenderScheduled = false;
  function scheduleEdgeRender() {
    if (edgeRenderScheduled) return;
    edgeRenderScheduled = true;
    requestAnimationFrame(() => { renderEdges(); edgeRenderScheduled = false; });
  }
  window.addEventListener('resize', scheduleEdgeRender);
  setInterval(scheduleEdgeRender, 600);

  // ═══════════════════════════════════════════
  // ── NODE MANAGEMENT ──
  // ═══════════════════════════════════════════
  function removeNode(id) {
    const node = nodes[id]; if (!node) return;
    node.el.remove(); delete nodes[id];
    for (let i = edges.length - 1; i >= 0; i--) {
      if (edges[i].source === id || edges[i].target === id) edges.splice(i, 1);
    }
    if (selectedEntityId === id) selectEntity(null);
    scheduleEdgeRender();
  }

  function duplicateNode(srcNode) {
    const newNode = createMacroNode(srcNode.type, srcNode.x, srcNode.y + srcNode.el.offsetHeight + 20);
    if (!newNode) return;
    newNode.data.model = srcNode.data.model;
    newNode.data.images = [...srcNode.data.images];
    newNode.data.params = { ...srcNode.data.params };
    newNode.el.querySelector('.swf-model-sel').value = srcNode.data.model;
    newNode.el.querySelector('.swf-params-area').innerHTML = buildParamsHTML(srcNode.data.model, srcNode.data.params);
    wireParamInputs(newNode);
    const sp = srcNode.el.querySelector('.swf-prompt-editor'), tp = newNode.el.querySelector('.swf-prompt-editor');
    if (sp && tp) tp.innerHTML = sp.innerHTML;
    renderImageThumbs(newNode);
  }

  // ═══════════════════════════════════════════
  // ── EXECUTION ENGINE (Topological Sort) ──
  // ═══════════════════════════════════════════
  function extractPromptData(node) {
    const editor = node.el.querySelector('.swf-prompt-editor');
    if (!editor) return { text: '', inlineImages: [] };
    let text = ''; const inlineImages = [];
    editor.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) text += child.textContent;
      else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.tagName === 'IMG' && child.classList.contains('inline-prompt-thumb')) inlineImages.push(child.src);
        else if (child.tagName === 'BR') text += '\n';
        else text += child.textContent || '';
      }
    });
    return { text: text.trim(), inlineImages };
  }

  /**
   * Execute a single node
   * @param {Object} node - The node to execute
   * @param {boolean} skipImageReset - When true (called from executeGroup), don't reset node images
   */
  async function executeSingleNode(node, skipImageReset) {
    const runBtn = node.el.querySelector('.swf-run-btn');
    const placeholder = node.el.querySelector('.swf-preview-placeholder');
    const imgEl = node.el.querySelector('.swf-preview-img');
    const dlBtn = node.el.querySelector('.swf-download-btn');

    runBtn.disabled = true; runBtn.textContent = 'Generating...';
    node.el.classList.add('swf-executing');
    placeholder.style.display = 'flex'; placeholder.textContent = 'Generating... (0s)';
    imgEl.style.display = 'none'; dlBtn.style.display = 'none';

    let secs = 0;
    const timer = setInterval(() => { secs++; placeholder.textContent = `Generating... (${secs}s)`; }, 1000);

    // Propagate upstream images (skip if called from group execution where images are pre-set)
    if (!skipImageReset) {
      // Collect upstream images for standalone node execution
      let rawUpstream = [];
      edges.filter(e => e.target === node.id).forEach(e => {
        const src = getEntity(e.source);
        if (src && src.resultImages && src.resultImages.length > 0) rawUpstream.push(...src.resultImages);
      });
      const activeUpstream = rawUpstream.filter(img => !node.data.excludedIncomingImages.includes(img));
      // Merge preserving order
      const validSet = new Set([...node.data.uploadedImages, ...activeUpstream]);
      const preserved = node.data.images.filter(img => validSet.has(img));
      const preservedSet = new Set(preserved);
      const newUp = activeUpstream.filter(img => !preservedSet.has(img));
      node.data.images = [...preserved, ...newUp];
    }
    renderImageThumbs(node);

    try {
      const { text, inlineImages } = extractPromptData(node);
      if (!text.trim()) throw new Error('提示詞不能為空');

      const model = node.data.model || 'nanobanana2';
      const params = node.data.params || {};
      let apiKey = '';
      if (model === 'gptimage') apiKey = window.StudioSettings?.getOpenAIKey?.();
      else apiKey = window.StudioSettings?.getNanobananaKey?.();
      if (!apiKey) throw new Error('API Key 尚未設定 (' + model + ')');

      // Use unified images array directly — order is exactly what user sees
      const allRefs = [...node.data.images, ...inlineImages];
      let imageUrl = '';
      if (model === 'gptimage') {
        imageUrl = await window.AIService.generateWithGPTImage(text, apiKey, params.gptImageSize || '1024x1024', allRefs[0] || null, {
          quality: params.quality || 'low', background: params.gptBackground || 'auto', input_fidelity: params.gptFidelity || 'high'
        });
      } else if (model === 'nanobanana2') {
        imageUrl = await window.AIService.generateWithNanoBanana2(text, apiKey, allRefs.length > 0 ? allRefs : null, null, {
          aspectRatio: params.aspectRatio || '1:1', imageSize: params.imageSize || '', temperature: params.temperature ?? 0.4,
        });
      } else {
        imageUrl = await window.AIService.generateWithNanoBanana(text, apiKey, {
          aspectRatio: params.aspectRatio || '1:1', imageSize: params.imageSize || '', temperature: params.temperature ?? 0.4,
        });
      }

      imgEl.src = imageUrl; imgEl.style.display = 'block';
      placeholder.style.display = 'none'; dlBtn.style.display = 'block';
      node.resultImages = [imageUrl];
      if (window.AssetsService) window.AssetsService.saveAsset('SWF_' + Date.now(), imageUrl, '已完成');
      if (window.showToast) window.showToast('✅ 生成完成');
    } catch (err) {
      console.error(err);
      placeholder.textContent = '❌ ' + err.message;
      if (window.showToast) window.showToast('❌ ' + err.message);
    } finally {
      clearInterval(timer);
      runBtn.disabled = false; runBtn.textContent = '▶ 生成';
      node.el.classList.remove('swf-executing');
      propagateVisualImages(); // visually push the generated image to downstream nodes immediately
    }
  }

  /** Group execution: find entry & exit nodes, aggregate results */
  async function executeGroup(groupId) {
    const group = groups[groupId]; if (!group) return;
    const members = getGroupMembers(groupId);
    if (members.length === 0) {
      if (window.showToast) window.showToast('⚠️ 群組內沒有節點', 2000); return;
    }

    group.el.classList.add('swf-group-executing');

    // Get images sent to the group's own input port, filtered by group settings
    let groupIncomingImages = [];
    if (group.receiveUpstream) {
      edges.filter(e => e.target === groupId).forEach(e => {
        const src = getEntity(e.source);
        if (src && src.resultImages && src.resultImages.length > 0) groupIncomingImages.push(...src.resultImages);
      });
      // Apply group-level exclusion
      groupIncomingImages = groupIncomingImages.filter(img => !group.excludedImages.includes(img));
    }

    const memberIds = new Set(members.map(m => m.id));

    // Topological sort within group — pass skipImageReset=true so group-assigned images aren't cleared
    const sorted = topoSort(members.map(m => m.id));
    for (const batch of sorted) {
      await Promise.all(batch.map(id => {
        const n = nodes[id];
        if (!n) return Promise.resolve();

        // Check if node is an entry node (no internal upstream dependencies)
        const isEntry = !edges.some(e => e.target === n.id && memberIds.has(e.source));

        // Gather upstream images for this specific node execution
        let rawUpstream = [];
        
        // 1. Direct external edges (Node outside -> Node inside)
        edges.filter(e => e.target === n.id && !memberIds.has(e.source)).forEach(e => {
          const src = getEntity(e.source);
          if (src && src.resultImages && src.resultImages.length > 0) rawUpstream.push(...src.resultImages);
        });

        // 2. If it's an entry node, it also receives the group's filtered incoming images
        if (isEntry) {
          rawUpstream.push(...groupIncomingImages);
        }

        // 3. Direct internal edges (Node inside -> Node inside)
        edges.filter(e => e.target === n.id && memberIds.has(e.source)).forEach(e => {
          const src = nodes[e.source];
          if (src && src.resultImages && src.resultImages.length > 0) rawUpstream.push(...src.resultImages);
        });

        // Apply node-level exclusion
        const activeUpstream = rawUpstream.filter(img => !n.data.excludedIncomingImages.includes(img));

        // Merge into unified images array preserving user order
        const validSet = new Set([...n.data.uploadedImages, ...activeUpstream]);
        const preserved = n.data.images.filter(img => validSet.has(img));
        const preservedSet = new Set(preserved);
        const newUp = activeUpstream.filter(img => !preservedSet.has(img));
        n.data.images = [...preserved, ...newUp];

        // Execute passing true for skipImageReset so it doesn't clear our carefully gathered images
        return executeSingleNode(n, true);
      }));
    }

    // Aggregate exit node results
    const exitNodes = members.filter(m => !edges.some(e => e.source === m.id && memberIds.has(e.target)));
    group.resultImages = [];
    exitNodes.forEach(n => { if (n.resultImages && n.resultImages.length > 0) group.resultImages.push(...n.resultImages); });

    group.el.classList.remove('swf-group-executing');
    if (window.showToast) window.showToast(`✅ 群組 "${group.title}" 執行完畢 (${group.resultImages.length} 張圖片)`);
    propagateVisualImages(); // visually push the group's aggregated images to downstream nodes immediately
  }

  /** Topological sort (Kahn's algorithm) for a subset of node IDs */
  function topoSort(nodeIds) {
    const idSet = new Set(nodeIds);
    const inDegree = {};
    const adj = {};
    nodeIds.forEach(id => { inDegree[id] = 0; adj[id] = []; });
    edges.forEach(e => {
      if (idSet.has(e.source) && idSet.has(e.target)) {
        adj[e.source].push(e.target);
        inDegree[e.target]++;
      }
    });

    const batches = [];
    let queue = nodeIds.filter(id => inDegree[id] === 0);
    while (queue.length > 0) {
      batches.push([...queue]);
      const next = [];
      queue.forEach(id => {
        adj[id].forEach(target => {
          inDegree[target]--;
          if (inDegree[target] === 0) next.push(target);
        });
      });
      queue = next;
    }
    return batches;
  }

  /** Execute all: topological sort across all entities */
  async function executeAll() {
    const runAllBtn = document.getElementById('swfRunAll');
    runAllBtn.disabled = true; runAllBtn.textContent = '執行中...';

    // Build list of all executable entities (standalone nodes + groups)
    // Nodes inside groups are handled by executeGroup
    const standaloneNodeIds = [];
    const groupMemberSets = {};
    for (const gid in groups) { groupMemberSets[gid] = new Set(getGroupMembers(gid).map(m => m.id)); }
    for (const nid in nodes) {
      let insideGroup = false;
      for (const gid in groupMemberSets) { if (groupMemberSets[gid].has(nid)) { insideGroup = true; break; } }
      if (!insideGroup) standaloneNodeIds.push(nid);
    }
    const allEntityIds = [...standaloneNodeIds, ...Object.keys(groups)];

    if (allEntityIds.length === 0) {
      runAllBtn.disabled = false; runAllBtn.textContent = '▶ 執行全部'; return;
    }

    const sorted = topoSort(allEntityIds);
    for (const batch of sorted) {
      await Promise.all(batch.map(id => {
        if (isGroup(id)) return executeGroup(id);
        if (nodes[id]) return executeSingleNode(nodes[id]);
        return Promise.resolve();
      }));
    }

    runAllBtn.disabled = false; runAllBtn.textContent = '▶ 執行全部';
    if (window.showToast) window.showToast('✅ 全部工作流執行完畢');
  }

  // ═══════════════════════════════════════════
  // ── SAVE / LOAD ──
  // ═══════════════════════════════════════════
  function serializeState() {
    const nodesData = {};
    for (const id in nodes) {
      const n = nodes[id];
      const promptEl = n.el.querySelector('.swf-prompt-editor');
      nodesData[id] = {
        id: n.id, type: n.type, x: n.x, y: n.y,
        width: n.width, isCollapsed: n.isCollapsed, promptHeight: promptEl ? promptEl.offsetHeight : 0,
        model: n.data.model, params: { ...n.data.params },
        uploadedImages: [...n.data.uploadedImages],
        excludedIncomingImages: [...n.data.excludedIncomingImages],
        // Don't save images (base64) to avoid localStorage quota
        promptHTML: promptEl ? promptEl.innerHTML : ''
      };
    }
    const groupsData = {};
    for (const id in groups) {
      const g = groups[id];
      groupsData[id] = {
        id: g.id, x: g.x, y: g.y, width: g.width, height: g.height, color: g.color, title: g.title,
        receiveUpstream: g.receiveUpstream, excludedImages: [...g.excludedImages]
      };
    }
    return { nodes: nodesData, groups: groupsData, edges: edges.map(e => ({ ...e })), panX, panY, zoomLevel, version: 3 };
  }

  function saveWorkflow() {
    const name = prompt('請輸入工作流名稱：', '未命名工作流');
    if (!name || !name.trim()) return;
    const cleanName = name.trim();

    try {
      const dataStr = JSON.stringify(serializeState());
      const sizeKB = (new Blob([dataStr]).size / 1024).toFixed(1);
      if (sizeKB > 4096) {
        if (window.showToast) window.showToast('⚠️ 資料過大 (' + sizeKB + 'KB)，可能無法完整儲存', 3000);
      }

      let library = [];
      try { library = JSON.parse(localStorage.getItem('swf_library')) || []; } catch(e){}
      
      const existing = library.find(x => x.name === cleanName);
      if (existing) {
        if (!confirm(`已存在同名工作流 "${cleanName}"，是否覆蓋？`)) return;
        existing.data = dataStr;
        existing.time = Date.now();
      } else {
        library.push({ id: Date.now(), name: cleanName, data: dataStr, time: Date.now() });
      }
      
      localStorage.setItem('swf_library', JSON.stringify(library));
      if (window.showToast) window.showToast(`✅ 已儲存 "${cleanName}" (${sizeKB} KB)`);
    } catch (err) {
      console.error('Save failed:', err);
      if (window.showToast) window.showToast('❌ 儲存失敗：' + err.message);
    }
  }

  function loadWorkflowData(raw, isUndoRestore) {
    try {
      let state;
      try { state = JSON.parse(raw); } catch (parseErr) {
        console.error('JSON parse failed:', parseErr);
        if (window.showToast) window.showToast('❌ 儲存的資料格式損壞', 2000); return;
      }
      if (!state || typeof state !== 'object') {
        if (window.showToast) window.showToast('❌ 儲存的資料格式無效', 2000); return;
      }

      // Clear current
      for (const id in nodes) { nodes[id].el.remove(); delete nodes[id]; }
      for (const id in groups) { groups[id].el.remove(); delete groups[id]; }
      edges.length = 0;

      // Restore zoom/pan
      panX = state.panX || 0; panY = state.panY || 0;
      zoomLevel = state.zoomLevel || 1;
      applyZoomAndPan();

      // ID remap helper — createGroup/createMacroNode generate new IDs,
      // so we need to map saved IDs to the new ones for edge restoration.
      const idRemap = {};

      // Restore groups
      if (state.groups) {
        for (const savedId in state.groups) {
          const gd = state.groups[savedId];
          try {
            const g = createGroup(gd.x, gd.y, gd.width, gd.height, gd.color, gd.title);
            idRemap[savedId] = g.id;
            // Restore v3 fields with backward compatibility
            g.receiveUpstream = gd.receiveUpstream !== undefined ? gd.receiveUpstream : true;
            g.excludedImages = Array.isArray(gd.excludedImages) ? [...gd.excludedImages] : [];
            // Sync checkbox state
            const cb = g.el.querySelector('.swf-gs-receive-cb');
            if (cb) cb.checked = g.receiveUpstream;
          } catch (e) { console.warn('Failed to restore group:', savedId, e); }
        }
      }

      // Restore nodes
      if (state.nodes) {
        for (const savedId in state.nodes) {
          const nd = state.nodes[savedId];
          try {
            const n = createMacroNode(nd.type || 't2i', nd.x, nd.y);
            idRemap[savedId] = n.id;
            
            // Restore dimensions and collapse state
            n.width = nd.width || 320;
            n.el.style.width = n.width + 'px';
            n.isCollapsed = !!nd.isCollapsed;
            if (n.isCollapsed) {
              n.el.classList.add('swf-collapsed');
              const collapseBtn = n.el.querySelector('.swf-collapse-btn');
              if (collapseBtn) collapseBtn.textContent = '▶';
            }
            const promptEl = n.el.querySelector('.swf-prompt-editor');
            if (promptEl && nd.promptHeight) promptEl.style.height = nd.promptHeight + 'px';
            
            n.data.model = nd.model || 'nanobanana2';
            n.data.params = nd.params || {};
            // Restore v3 fields with backward compatibility
            n.data.uploadedImages = Array.isArray(nd.uploadedImages) ? [...nd.uploadedImages] : [];
            n.data.excludedIncomingImages = Array.isArray(nd.excludedIncomingImages) ? [...nd.excludedIncomingImages] : [];
            n.el.querySelector('.swf-model-sel').value = n.data.model;
            n.el.querySelector('.swf-params-area').innerHTML = buildParamsHTML(n.data.model, n.data.params);
            wireParamInputs(n);
            if (nd.promptHTML) n.el.querySelector('.swf-prompt-editor').innerHTML = nd.promptHTML;
          } catch (e) { console.warn('Failed to restore node:', savedId, e); }
        }
      }

      // Restore edges using remapped IDs
      if (state.edges) {
        state.edges.forEach(e => {
          const newSrc = idRemap[e.source] || e.source;
          const newTgt = idRemap[e.target] || e.target;
          // Only add if both entities exist
          if (getEntity(newSrc) && getEntity(newTgt)) {
            addEdge(newSrc, newTgt);
          }
        });
      }

      requestAnimationFrame(scheduleEdgeRender);
      if (!isUndoRestore && window.showToast) window.showToast('✅ 已讀取儲存的工作流');

      // Visually propagate
      propagateVisualImages();
    } catch (err) {
      console.error('Load failed:', err);
      if (window.showToast) window.showToast('❌ 讀取失敗：' + err.message);
    }
  }

  function loadWorkflow() {
    let library = [];
    try { library = JSON.parse(localStorage.getItem('swf_library')) || []; } catch(e){}
    
    // Also support loading from the old swf_saved_data if library is empty
    const oldSaved = localStorage.getItem('swf_saved_data');
    if (oldSaved && !library.find(x => x.name === '舊版備份 (swf_saved_data)')) {
      library.push({ id: 'old_backup', name: '舊版備份 (swf_saved_data)', data: oldSaved, time: Date.now() });
    }

    if (library.length === 0) {
      if (window.showToast) window.showToast('沒有已儲存的工作流', 2000); 
      return;
    }

    // Sort by newest
    library.sort((a, b) => b.time - a.time);

    const listContainer = document.getElementById('swfLibList');
    if (!listContainer) return;

    listContainer.innerHTML = library.map(w => {
      const d = new Date(w.time);
      const dateStr = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
      return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: rgba(0,0,0,0.03); border-radius: 6px; border: 1px solid var(--border);">
          <div>
            <div style="font-weight: 600; font-size: 14px; color: var(--text);">${w.name}</div>
            <div style="font-size: 11px; color: var(--muted); margin-top: 4px;">${dateStr}</div>
          </div>
          <div style="display: flex; gap: 6px;">
            <button class="btn-primary swf-lib-load-btn" data-id="${w.id}" style="padding: 4px 10px; font-size: 12px;">讀取</button>
            <button class="btn-ghost swf-lib-del-btn" data-id="${w.id}" style="padding: 4px 10px; font-size: 12px; color: #ef4444;">刪除</button>
          </div>
        </div>
      `;
    }).join('');

    const modal = document.getElementById('swfLibraryModal');
    if (modal) modal.classList.remove('hidden');

    // Bind buttons
    listContainer.querySelectorAll('.swf-lib-load-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const target = library.find(x => String(x.id) === String(id));
        if (target) {
          loadWorkflowData(target.data);
          modal.classList.add('hidden');
          if (window.showToast) window.showToast(`✅ 已讀取 "${target.name}"`);
        }
      });
    });

    listContainer.querySelectorAll('.swf-lib-del-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.dataset.id;
        const targetIdx = library.findIndex(x => String(x.id) === String(id));
        if (targetIdx >= 0) {
          if (!confirm(`確定要刪除 "${library[targetIdx].name}" 嗎？`)) return;
          library.splice(targetIdx, 1);
          localStorage.setItem('swf_library', JSON.stringify(library.filter(x => x.id !== 'old_backup')));
          if (id === 'old_backup') localStorage.removeItem('swf_saved_data');
          e.target.closest('div').parentElement.remove();
          if (library.length === 0) modal.classList.add('hidden');
        }
      });
    });
  }

  // ═══════════════════════════════════════════
  // ── ASSET BROWSER (Left Pane) ──
  // ═══════════════════════════════════════════
  let swfActiveFolder = '已完成';

  async function renderSwfFolders() {
    const folderList = document.getElementById('swfFolderList'); if (!folderList) return;
    const folders = window.AssetsService?.getFolders?.() || ['已完成'];
    folderList.innerHTML = '';
    folders.forEach(name => {
      const btn = document.createElement('button');
      btn.className = 'swf-folder-item' + (name === swfActiveFolder ? ' active' : '');
      btn.textContent = name;
      btn.addEventListener('click', () => { swfActiveFolder = name; renderSwfFolders(); renderSwfAssets(); });
      folderList.appendChild(btn);
    });
  }

  async function renderSwfAssets() {
    const grid = document.getElementById('swfAssetsGrid'); if (!grid) return;
    try {
      const all = await window.AssetsService?.getAllAssets?.() || [];
      const assets = all.filter(a => a.folder === swfActiveFolder);
      grid.innerHTML = '';
      if (assets.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);font-size:11px;padding:20px;">此資料夾目前沒有資產</div>';
        return;
      }
      assets.forEach(asset => {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;flex-direction:column;';
        const thumb = document.createElement('div');
        thumb.className = 'swf-asset-thumb'; thumb.draggable = true;
        thumb.innerHTML = `<img src="${asset.data}" alt="${asset.name}" loading="lazy">`;
        thumb.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/swf-asset', JSON.stringify({ id: asset.id, data: asset.data, name: asset.name }));
          e.dataTransfer.setData('text/swf-image-src', asset.data);
          e.dataTransfer.effectAllowed = 'copy';
        });
        thumb.addEventListener('click', () => { window.AssetsService?.openLightBox?.(asset.data, asset.name, false); });
        const label = document.createElement('div');
        label.className = 'swf-asset-name'; label.textContent = asset.name;
        wrapper.appendChild(thumb); wrapper.appendChild(label);
        grid.appendChild(wrapper);
      });
    } catch (e) { console.error('SWF Assets render error:', e); }
  }

  // ═══════════════════════════════════════════
  // ── PROMPT QUICK-BAR (Right Pane) ──
  // ═══════════════════════════════════════════
  function initSwfPromptQuickBar() {
    const quickBar = document.getElementById('swfPromptQuickBar');
    if (!quickBar || !window.PromptsService) return;

    quickBar.innerHTML = '';
    
    let popover = document.getElementById('swfQuickbarPopover');
    if (!popover) {
      popover = document.createElement('div');
      popover.id = 'swfQuickbarPopover';
      popover.className = 'quickbar-popover';
      
      const header = document.createElement('div');
      header.className = 'quickbar-popover-header';
      
      const title = document.createElement('span');
      title.id = 'swfQuickbarPopoverTitle';
      header.appendChild(title);
      
      const closeBtn = document.createElement('button');
      closeBtn.className = 'quickbar-popover-close';
      closeBtn.innerHTML = '&#x2715;';
      closeBtn.addEventListener('click', () => hidePopover(true));
      header.appendChild(closeBtn);
      
      popover.appendChild(header);
      
      const body = document.createElement('div');
      body.id = 'swfQuickbarPopoverBody';
      body.className = 'quickbar-popover-body';
      popover.appendChild(body);
      
      quickBar.appendChild(popover);
    }

    let activeCategory = null;
    let isPinned = false;
    let pinTimer = null;
    
    const categories = window.PromptsService.getAllCategories();
    
    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'quickbar-cat-btn';
      btn.innerHTML = `<span class="quickbar-cat-text">${cat}</span><div class="quickbar-timer-bar"></div>`;
      
      btn.addEventListener('mouseenter', () => {
        if (isPinned && activeCategory === cat) return;
        showPopover(cat, btn);
        startPinTimer(cat, btn);
      });
      
      btn.addEventListener('mouseleave', () => {
        cancelPinTimer();
        if (!isPinned) hidePopover();
      });
      
      btn.addEventListener('click', () => {
        if (isPinned && activeCategory === cat) hidePopover(true);
        else {
          cancelPinTimer();
          isPinned = true;
          showPopover(cat, btn);
        }
      });
      
      quickBar.appendChild(btn);
    });
    
    document.addEventListener('click', (e) => {
      if (isPinned && !quickBar.contains(e.target) && !popover.contains(e.target)) {
        hidePopover(true);
      }
    });
    
    function showPopover(category, btnEl) {
      activeCategory = category;
      const titleEl = document.getElementById('swfQuickbarPopoverTitle');
      const bodyEl = document.getElementById('swfQuickbarPopoverBody');
      
      document.querySelectorAll('#swfPromptQuickBar .quickbar-cat-btn').forEach(b => {
        b.classList.remove('active', 'pinned', 'timer-active');
      });
      if (btnEl) btnEl.classList.add('pinned');
      
      titleEl.textContent = category;
      bodyEl.innerHTML = '';
      
      const prompts = window.PromptsService.getPromptsByCategory(category);
      if (prompts.length === 0) {
        bodyEl.innerHTML = '<div style="color:var(--text-light);font-size:12px;text-align:center;margin-top:20px;">無儲存的提示詞</div>';
      } else {
        prompts.forEach(p => {
          const item = document.createElement('div');
          item.className = 'quickbar-prompt-item';
          item.draggable = true;
          
          const pTitle = document.createElement('div');
          pTitle.className = 'quickbar-prompt-title';
          pTitle.textContent = p.title || '未命名';
          item.appendChild(pTitle);
          
          item.addEventListener('click', () => {
            if (navigator.clipboard) {
              navigator.clipboard.writeText(p.content);
              if (window.showToast) window.showToast('✅ 已複製提示詞');
            }
            hidePopover(true);
          });

          item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/swf-prompt', p.content);
            e.dataTransfer.effectAllowed = 'copy';
          });
          
          bodyEl.appendChild(item);
        });
      }
      popover.classList.add('visible');
    }
    
    function hidePopover(force = false) {
      if (force || !isPinned) {
        isPinned = false;
        activeCategory = null;
        popover.classList.remove('visible');
        document.querySelectorAll('#swfPromptQuickBar .quickbar-cat-btn').forEach(b => {
          b.classList.remove('active', 'pinned', 'timer-active');
        });
      }
    }
    
    function startPinTimer(cat, btn) {
      cancelPinTimer();
      btn.classList.add('timer-active');
      pinTimer = setTimeout(() => {
        btn.classList.remove('timer-active');
        isPinned = true;
        if (activeCategory !== cat) showPopover(cat, btn);
      }, 400);
    }
    
    function cancelPinTimer() {
      if (pinTimer) {
        clearTimeout(pinTimer);
        pinTimer = null;
      }
      document.querySelectorAll('#swfPromptQuickBar .quickbar-cat-btn').forEach(b => b.classList.remove('timer-active'));
    }
  }

  // Initialize the quick bar when the panel loads
  setTimeout(initSwfPromptQuickBar, 300);

  // ═══════════════════════════════════════════
  // ── TOOLBAR BINDINGS ──
  // ═══════════════════════════════════════════
  document.getElementById('swfAddT2I')?.addEventListener('click', () => createMacroNode('t2i'));
  document.getElementById('swfAddI2I')?.addEventListener('click', () => createMacroNode('i2i'));
  document.getElementById('swfAddGroup')?.addEventListener('click', () => createGroup());
  document.getElementById('swfRunAll')?.addEventListener('click', executeAll);
  document.getElementById('swfSaveBtn')?.addEventListener('click', saveWorkflow);
  document.getElementById('swfLoadBtn')?.addEventListener('click', loadWorkflow);

  // Toggle side panels
  document.getElementById('swfAssetToggle')?.addEventListener('click', () => {
    const panel = document.getElementById('swfLeftAssets');
    const isHidden = panel.style.display === 'none';
    panel.style.display = isHidden ? 'flex' : 'none';
    if (isHidden) { renderSwfFolders(); renderSwfAssets(); }
  });
  document.getElementById('swfAssetClose')?.addEventListener('click', () => {
    document.getElementById('swfLeftAssets').style.display = 'none';
  });
  document.getElementById('swfPromptToggle')?.addEventListener('click', () => {
    const panel = document.getElementById('swfPromptQuickBar');
    if (panel) panel.classList.toggle('active');
  });

  // Sync Modal Bindings
  document.getElementById('swfSyncModalCloseBtn')?.addEventListener('click', closeSyncModal);
  document.getElementById('swfSyncModalCancelBtn')?.addEventListener('click', closeSyncModal);
  document.getElementById('swfSyncModalConfirmBtn')?.addEventListener('click', applySyncParams);
  
  document.getElementById('swfSyncModelSel')?.addEventListener('change', (e) => {
    const container = document.getElementById('swfSyncParamsContainer');
    if (container) {
      container.innerHTML = buildParamsHTML(e.target.value, {});
      // Setup range sliders for the modal
      container.querySelectorAll('input[type="range"]').forEach(input => {
        input.addEventListener('input', ev => {
          const valEl = ev.target.nextElementSibling;
          if (valEl) valEl.textContent = parseFloat(ev.target.value).toFixed(2);
        });
      });
    }
  });

  // ═══════════════════════════════════════════
  // ── AUTO-SAVE & INIT ──
  // ═══════════════════════════════════════════
  let lastSavedStateStr = '';

  function triggerAutoSave() {
    try {
      const stateStr = JSON.stringify(serializeState());
      if (stateStr !== lastSavedStateStr) {
        localStorage.setItem('swf_autosave_state', stateStr);
        lastSavedStateStr = stateStr;
      }
    } catch (e) {
      console.warn('Auto-save failed:', e);
    }
  }

  setInterval(triggerAutoSave, 3000);

  // Init
  setTimeout(() => {
    try {
      const autosaveStr = localStorage.getItem('swf_autosave_state');
      if (autosaveStr) {
        console.log('Loading auto-saved state...');
        loadWorkflowData(autosaveStr, false);
        lastSavedStateStr = autosaveStr;
      } else {
        createMacroNode('t2i', 40, 40);
      }
    } catch (err) {
      console.error('Failed to load autosave, clearing it:', err);
      localStorage.removeItem('swf_autosave_state');
      createMacroNode('t2i', 40, 40);
    }
  }, 100);

  // Expose API
  window.SimpleWorkflow = {
    createMacroNode, createGroup, executeAll, executeSingleNode, executeGroup,
    duplicateGroup, syncGroupParams,
    saveWorkflow, loadWorkflow,
    getNodes: () => nodes, getGroups: () => groups, getEdges: () => edges,
    renderSwfAssets, initSwfPromptQuickBar
  };

})();
