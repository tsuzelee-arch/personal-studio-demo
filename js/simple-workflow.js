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

  const SWF_DEBUG = localStorage.getItem('ps_debug') === '1';

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
  /**
   * A group's images offered to downstream consumers = ONLY the final generated image
   * of each independent sub-workflow inside it (the group's exit nodes — the last node
   * of every chain / 序號). This deliberately excludes:
   *   - member reference / uploaded images (#3: adding a reference image upstream must
   *     NOT push it downstream), and
   *   - intermediate mid-chain node outputs (#4: only the last generated image flows,
   *     not the in-process images).
   * Example: a group with 序號1 (a 3-node chain) + 序號2 (1 node) sends 2 images —
   * 序號1's final node result and 序號2's result.
   */
  function getGroupOutputImages(group) {
    const out = [];
    getGroupExitNodes(group.id).forEach(n => {
      if (n.resultImages) out.push(...n.resultImages);
    });
    return [...new Set(out)];
  }
  function getSourceOutputImages(id) {
    const ent = getEntity(id);
    if (!ent) return [];
    return isGroup(id) ? getGroupOutputImages(ent) : (ent.resultImages || []);
  }

  // Downstream-receive priority of a source entity. Reference images sit at 0;
  // groups carry a configurable priority (default 1); non-group nodes are 0.
  function srcPriority(id) { return isGroup(id) ? (groups[id]?.receivePriority ?? 1) : 0; }

  // Upstream edges feeding a target, stable-sorted by source priority then edge order.
  function sortedUpstreamEdges(targetId) {
    return edges.map((e, i) => ({ e, i }))
      .filter(x => x.e.target === targetId)
      .sort((a, b) => (srcPriority(a.e.source) - srcPriority(b.e.source)) || (a.i - b.i));
  }

  // Assemble a node's reference-image array from prioritized upstream contributions
  // and the node's own uploaded images (priority 0). contribs = [{priority, images}].
  // Order = priority ascending; the node's reference images anchor at priority 0
  // (before equal-priority upstream), so a negative-priority group precedes them.
  // First occurrence wins on dedupe; node-level excluded incoming images are dropped.
  function assembleNodeImages(node, contribs) {
    const uploadedSet = new Set(node.data.uploadedImages);
    const refOrdered = node.data.images.filter(img => uploadedSet.has(img));
    node.data.uploadedImages.forEach(img => { if (!refOrdered.includes(img)) refOrdered.push(img); });

    const items = [{ priority: 0, seq: -1, images: refOrdered }];
    contribs.forEach((c, i) => items.push({ priority: c.priority, seq: i, images: c.images || [] }));
    items.sort((a, b) => (a.priority - b.priority) || (a.seq - b.seq));

    const out = [], seen = new Set();
    for (const it of items) {
      for (const img of it.images) {
        if (!seen.has(img)) { seen.add(img); out.push(img); }
      }
    }
    return out.filter(img => !node.data.excludedIncomingImages.includes(img));
  }
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
    // Clear reference image selection when selecting a node or group
    document.querySelectorAll('.swf-img-thumb-selected').forEach(el => el.classList.remove('swf-img-thumb-selected'));
    window.__swfSelectedImage = null;
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

    // Delete / Backspace: remove selected entity or selected image
    if (!isInput && (e.key === 'Delete' || e.key === 'Backspace')) {
      if (window.__swfSelectedImage) {
        const selImg = window.__swfSelectedImage;
        const node = nodes[selImg.nodeId];
        if (node) {
          e.preventDefault();
          saveUndoState();
          node.data.images.splice(selImg.index, 1);
          const isUploaded = node.data.uploadedImages.includes(selImg.src);
          if (isUploaded) {
            const uIdx = node.data.uploadedImages.indexOf(selImg.src);
            if (uIdx >= 0) node.data.uploadedImages.splice(uIdx, 1);
          } else {
            if (!node.data.excludedIncomingImages.includes(selImg.src)) {
              node.data.excludedIncomingImages.push(selImg.src);
            }
          }
          renderImageThumbs(node);
          propagateVisualImages();
          window.__swfSelectedImage = null;
          if (window.showToast) window.showToast('🗑 已刪除參考圖片');
        }
      } else if (selectedEntityId) {
        saveUndoState();
        if (isGroup(selectedEntityId)) {
          promptRemoveGroup(selectedEntityId);
        } else {
          removeNode(selectedEntityId);
        }
        selectedEntityId = null;
      }
    }

    // Ctrl+Z: Undo (skip when typing in any input/textarea/contenteditable)
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && !isInput) {
      e.preventDefault();
      undo();
    }
    // Ctrl+Y or Ctrl+Shift+Z: Redo (same guard)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && !isInput) {
      e.preventDefault();
      redo();
    }

    // Ctrl+C: Copy selected node/group or selected image
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !isInput) {
      if (window.__swfSelectedImage) {
        e.preventDefault();
        copyDataURLToClipboard(window.__swfSelectedImage.src);
      } else if (selectedEntityId) {
        e.preventDefault();
        window.__swfClipboard = { id: selectedEntityId, isGroup: isGroup(selectedEntityId) };
        if (window.showToast) window.showToast('📋 已複製');
      }
    }

    // Ctrl+Enter: Execute All (only when not typing)
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !isInput) {
      e.preventDefault();
      executeAll();
    }
  });

  window.addEventListener('paste', async (e) => {
    const panel = document.getElementById('panel-simple-workflow');
    if (!panel || !panel.classList.contains('active')) return;

    const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if (isInput) return;

    const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
    let hasImage = false;

    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          hasImage = true;
          const file = item.getAsFile();
          e.preventDefault();
          try {
            const dataUrl = await window.StudioUtils.fileToDataURL(file);
            await handlePastedImage(dataUrl);
          } catch (err) {
            console.error('File to data URL failed:', err);
          }
          break;
        }
      }
    }

    if (!hasImage) {
      if (window.__swfImageClipboard) {
        e.preventDefault();
        await handlePastedImage(window.__swfImageClipboard);
      } else if (window.__swfClipboard) {
        e.preventDefault();
        saveUndoState();
        if (window.__swfClipboard.isGroup) {
          duplicateGroup(window.__swfClipboard.id);
        } else {
          const srcNode = nodes[window.__swfClipboard.id];
          if (srcNode) duplicateNode(srcNode);
        }
      }
    }
  });

  function getSimpleWorkflowViewportCenter() {
    const rect = canvas.getBoundingClientRect();
    const cx = (rect.width / 2 - panX) / zoomLevel - 160;
    const cy = (rect.height / 2 - panY) / zoomLevel - 100;
    return [Math.round(cx), Math.round(cy)];
  }

  async function handlePastedImage(dataUrl) {
    if (selectedEntityId && !isGroup(selectedEntityId)) {
      const node = nodes[selectedEntityId];
      if (node && node.type === 'i2i') {
        if (node.data.images.length >= 16) {
          if (window.showToast) window.showToast('⚠️ 參考圖片已達 16 張上限');
          return;
        }
        saveUndoState();
        await addNodeImage(node, dataUrl);
        if (window.showToast) window.showToast('✅ 已貼上圖片至所選節點');
        return;
      }
    }

    saveUndoState();
    const [cx, cy] = getSimpleWorkflowViewportCenter();
    const node = createMacroNode('i2i', cx, cy);
    await addNodeImage(node, dataUrl);
    selectEntity(node.id);
    if (window.showToast) window.showToast('✅ 已貼上圖片並建立圖生圖節點');
  }

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
        { key: 'aspectRatio', label: 'Aspect Ratio', type: 'select', options: ['1:1','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9','21:9','1:4','4:1','1:8','8:1'], default: '1:1' },
        { key: 'imageSize', label: 'Image Size', type: 'select', options: [{ v: '', l: 'Default' }, { v: '512', l: '512px' }, { v: '1K', l: '1K' }, { v: '2K', l: '2K' }, { v: '4K', l: '4K' }], default: '' },
        { key: 'temperature', label: 'Temperature', type: 'range', min: 0, max: 2, step: 0.05, default: 0.4 },
        { key: 'thinkingLevel', label: 'Thinking (思考)', type: 'select', options: [{ v: 'none', l: 'None' }, { v: 'minimal', l: 'Minimal' }, { v: 'high', l: 'High' }], default: 'none' },
      ]
    },
    nanobanana: {
      label: 'Nano Banana Pro',
      params: [
        { key: 'aspectRatio', label: 'Aspect Ratio', type: 'select', options: ['1:1','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9','21:9','1:4','4:1','1:8','8:1'], default: '1:1' },
        { key: 'imageSize', label: 'Image Size', type: 'select', options: [{ v: '', l: 'Default' }, { v: '512', l: '512px' }, { v: '1K', l: '1K' }, { v: '2K', l: '2K' }, { v: '4K', l: '4K' }], default: '' },
        { key: 'temperature', label: 'Temperature', type: 'range', min: 0, max: 2, step: 0.05, default: 0.4 },
        { key: 'thinkingLevel', label: 'Thinking (思考)', type: 'select', options: [{ v: 'none', l: 'None' }, { v: 'minimal', l: 'Minimal' }, { v: 'high', l: 'High' }], default: 'none' },
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
    },
    preprocess: {
      label: '預處理 (圖像處理)',
      // params handled specially in buildParamsHTML → buildImageProcessParamsHTML
      params: []
    }
  };

  // 圖像處理 parameter block, shared by the node's 預處理 mode. Uses data-param so
  // wireParamInputs binds the values into node.data.params; consumed by
  // window.ImageProcess.processImageInMemory at run time.
  function buildImageProcessParamsHTML(p) {
    p = p || {};
    const sel = (key, def, opts) => {
      const cur = p[key] ?? def;
      const o = opts.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('');
      return `<select data-param="${key}">${o}</select>`;
    };
    // Params are grouped so only the selected 處理功能's relevant ones show (no overlap):
    // fit modes (contain/cover/stretch) use resolution/align/bg; refcrop uses cropRefLine.
    // updateImageProcessParamVisibility toggles these on render and on change.
    return `
      <div class="swf-param-row"><label>處理功能</label>${sel('fitMode', 'contain', [['contain', '縮放適配 (Contain)'], ['cover', '縮放填充 (Cover)'], ['stretch', '拉伸填充 (Stretch)'], ['refcrop', '參考線裁切 (Ref Crop)'], ['stitch', '拼合圖片'], ['desaturate', '去除飽和度 (灰階)']])}</div>
      <div class="swf-ip-fit-params">
        <div class="swf-param-row"><label>目標解析度</label>${sel('resolution', '1024', [['512', '512 × 512'], ['1024_512', '1024 × 512'], ['512_1024', '512 × 1024'], ['1024', '1024 × 1024'], ['2048', '2048 × 2048']])}</div>
        <div class="swf-param-row"><label>對齊基準</label>${sel('align', 'center', [['center', 'Center'], ['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right'], ['top-left', 'Top-Left'], ['top-right', 'Top-Right'], ['bottom-left', 'Bottom-Left'], ['bottom-right', 'Bottom-Right']])}</div>
        <div class="swf-param-row"><label>背景填充顏色</label>${sel('bg', '#FFFFFF', [['#FFFFFF', '白色'], ['#000000', '黑色'], ['#00FF00', '綠色'], ['#0000FF', '藍色'], ['transparent', '透明'], ['custom', '自訂顏色']])}</div>
        <div class="swf-param-row swf-ip-bgpicker-row"><label>自訂背景色</label><input type="color" data-param="bgPicker" value="${p.bgPicker || '#FFFFFF'}"></div>
      </div>
      <div class="swf-ip-crop-params">
        <div class="swf-param-row"><label>裁切參考線</label>${sel('cropRefLine', 'crosshair', [['crosshair', '十字線 (4 等份)'], ['thirds', '井字線 (9 等份)'], ['vcenter', '中間豎切 (左右各半)'], ['hcenter', '中間橫切 (上下各半)']])}</div>
      </div>
      <div class="swf-ip-stitch-params">
        <div class="swf-param-row"><label>拼合方向</label>${sel('stitchDir', 'horizontal', [['horizontal', '水平排列'], ['vertical', '垂直排列'], ['grid', '網格']])}</div>
        <div class="swf-param-row swf-ip-stitch-grid-cols"><label>欄數</label><input type="number" data-param="stitchGridCols" value="${p.stitchGridCols || 2}" min="1" style="width:60px;"></div>
        <div class="swf-param-row"><label>間距 (px)</label><input type="number" data-param="stitchGap" value="${p.stitchGap || 0}" min="0" style="width:60px;"></div>
        <div class="swf-param-row"><label>對齊方式</label>${sel('stitchAlign', 'center', [['center', '置中'], ['start', '起始'], ['end', '末端']])}</div>
        <div class="swf-param-row"><label>尺寸模式</label>${sel('stitchSize', 'original', [['original', '保持原尺寸'], ['uniform', '以首張為準縮放']])}</div>
        <div class="swf-param-row"><label>背景顏色</label>${sel('stitchBg', '#FFFFFF', [['#FFFFFF', '白色'], ['#000000', '黑色'], ['transparent', '透明'], ['custom', '自訂顏色']])}</div>
        <div class="swf-param-row swf-ip-stitch-bgpicker"><label>自訂背景色</label><input type="color" data-param="stitchBgPicker" value="${p.stitchBgPicker || '#FFFFFF'}"></div>
      </div>
    `;
  }

  // Show only the params relevant to the selected 處理功能 (and the custom-bg picker
  // only when 背景=自訂). No-op when the area isn't an image-process param block.
  function updateImageProcessParamVisibility(area) {
    const fitSel = area.querySelector('select[data-param="fitMode"]');
    if (!fitSel) return;
    const mode = fitSel.value;
    const isFit    = mode === 'contain' || mode === 'cover' || mode === 'stretch';
    const isStitch = mode === 'stitch';
    const fitBox   = area.querySelector('.swf-ip-fit-params');
    const cropBox  = area.querySelector('.swf-ip-crop-params');
    const stitchBox = area.querySelector('.swf-ip-stitch-params');
    if (fitBox)    fitBox.style.display    = isFit    ? '' : 'none';
    if (cropBox)   cropBox.style.display   = mode === 'refcrop' ? '' : 'none';
    if (stitchBox) stitchBox.style.display = isStitch ? '' : 'none';
    // fit bg picker
    const bgSel = area.querySelector('select[data-param="bg"]');
    const pickerRow = area.querySelector('.swf-ip-bgpicker-row');
    if (pickerRow) pickerRow.style.display = (isFit && bgSel && bgSel.value === 'custom') ? '' : 'none';
    // stitch sub-visibility
    if (isStitch) {
      const dirSel  = area.querySelector('select[data-param="stitchDir"]');
      const bgsSel  = area.querySelector('select[data-param="stitchBg"]');
      const gridRow = area.querySelector('.swf-ip-stitch-grid-cols');
      const bgpRow  = area.querySelector('.swf-ip-stitch-bgpicker');
      if (gridRow) gridRow.style.display = (dirSel && dirSel.value === 'grid') ? '' : 'none';
      if (bgpRow)  bgpRow.style.display  = (bgsSel && bgsSel.value === 'custom') ? '' : 'none';
    }
  }

  // Attach the visibility toggling to an image-process param block that isn't wired by
  // wireParamInputs (e.g. the group 統一參數 panel, which uses wireModalSliders).
  function wireImageProcessVisibility(area) {
    if (!area) return;
    area.querySelectorAll('select[data-param="fitMode"], select[data-param="bg"]').forEach(s =>
      s.addEventListener('change', () => updateImageProcessParamVisibility(area)));
    updateImageProcessParamVisibility(area);
  }

  function buildParamsHTML(modelKey, savedParams) {
    const p = savedParams || {};
    if (modelKey === 'preprocess') return buildImageProcessParamsHTML(p);
    if (modelKey === 'comfyui') {
      const serverUrl = p.serverUrl ?? 'http://127.0.0.1:8188';
      const workflowJson = p.workflowJson ?? '';
      const positivePromptNodeId = p.positivePromptNodeId ?? '';
      const inputNodeIds = p.inputNodeIds ?? '';
      const outputNodeId = p.outputNodeId ?? '';
      return `
        <div class="swf-param-row">
          <label>ComfyUI API 地址</label>
          <input type="text" data-param="serverUrl" value="${serverUrl}" placeholder="http://127.0.0.1:8188" style="width:100%;">
        </div>
        <div class="swf-param-row">
          <label style="display:flex; justify-content:space-between; align-items:center;">
            <span>API 工作流 JSON</span>
            <span style="font-size:10px; font-weight:normal; color:var(--muted);">Dev Mode -> Save (API format)</span>
          </label>
          <textarea data-param="workflowJson" placeholder="貼上從 ComfyUI 匯出的 API JSON 格式..." style="width:100%; height:120px; font-family:monospace; font-size:11px; resize:vertical; background:var(--node-input-bg, #fafafa); border:1px solid var(--node-input-border, #d0d0d0); color:var(--node-text, #333); border-radius:4px; padding:4px; box-sizing:border-box;">${workflowJson}</textarea>
        </div>
        <div class="swf-param-row-group" style="border-top:1px solid var(--border); margin-top:8px; padding-top:8px;">
          <div class="swf-param-row" style="display:flex; justify-content:space-between; align-items:center;">
            <label style="font-weight:bold; margin-bottom:0;">節點對應設定</label>
            <button class="btn-ghost btn-xs swf-comfy-autodetect" type="button" style="padding:2px 6px; font-size:11px; height:20px; border:1px solid var(--border); border-radius:4px; background:var(--bg-deep); cursor:pointer;">🪄 自動偵測</button>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:6px;">
            <div class="swf-param-row">
              <label title="提示詞所屬的 CLIPTextEncode 節點 ID">提示詞節點 ID</label>
              <input type="text" data-param="positivePromptNodeId" value="${positivePromptNodeId}" placeholder="例如: 6" style="width:100%;">
            </div>
            <div class="swf-param-row">
              <label title="最終輸出的 SaveImage/PreviewImage 節點 ID">輸出節點 ID</label>
              <input type="text" data-param="outputNodeId" value="${outputNodeId}" placeholder="例如: 15" style="width:100%;">
            </div>
          </div>
          <div class="swf-param-row" style="margin-top:6px;">
            <label title="輸入參考圖片所對應的 LoadImage 節點 ID (多個以逗號分隔，順序對應)">輸入圖片節點 ID (多個以逗號隔開)</label>
            <input type="text" data-param="inputNodeIds" value="${inputNodeIds}" placeholder="例如: 9, 12" style="width:100%;">
          </div>
          <div class="swf-comfy-detection-status" style="font-size:10px; color:var(--muted); margin-top:4px; min-height:14px;"></div>
        </div>
      `;
    }
    const def = MODEL_PARAMS[modelKey]; if (!def) return '';
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
    let pos = (initialX !== undefined) ? { x: initialX, y: initialY } : calculateNextGroupPosition();
    const gw = w || 480;
    const gh = h || 320;
    // Place in free space so groups never spawn overlapping (skip during load,
    // which positions groups explicitly and tolerates legacy overlaps).
    if (!isLoadingWorkflow) pos = findFreeGroupSpot(pos.x, pos.y, gw, gh, id);
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
      <button class="swf-group-sidebar-toggle" title="上游圖片管理"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>
      <button class="swf-grp-sync-btn swf-left-tab-btn" title="統一內部節點參數"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><circle cx="8" cy="6" r="2"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="16" cy="12" r="2"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="10" cy="18" r="2"/></svg></button>
      <button class="swf-grp-dup-btn swf-left-tab-btn" title="複製群組"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
      <button class="swf-grp-lock-btn swf-left-tab-btn" title="鎖定群組成員（不再接收/帶走其他節點）"><svg class="swf-lock-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg><svg class="swf-lock-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></button>
      <button class="swf-grp-fit-btn swf-left-tab-btn" title="自動調整範圍以囊括所有節點"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>
      <button class="swf-grp-automation-btn swf-left-tab-btn" title="完成後自動化"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 4v4M9 13h.01M15 13h.01M2 14h2M20 14h2"/></svg></button>
      <div class="swf-group-sidebar">
        <div class="swf-panel-resize" title="拖動調整寬度"></div>
        <div class="swf-gs-header">
          <span>📁 上游圖片</span>
          <button class="swf-gs-close">✕</button>
        </div>
        <div class="swf-gs-controls">
          <label class="swf-gs-checkbox-label"><input type="checkbox" class="swf-gs-receive-cb" checked> 接收上游圖片</label>
          <div class="swf-gs-mode-row">
            <label class="swf-gs-mode-opt"><input type="radio" class="swf-gs-mode-radio" name="gsmode_${id}" value="all" checked> 全部接收</label>
            <label class="swf-gs-mode-opt"><input type="radio" class="swf-gs-mode-radio" name="gsmode_${id}" value="ordered"> 順序配對</label>
          </div>
          <div class="swf-gs-folder-row" style="margin-top: 8px; border-top: 1px solid var(--border); padding-top: 8px; display: flex; flex-direction: column; gap: 4px;">
            <label style="font-size: 11px; display: block; color: var(--muted);">接收來自文件夾圖片</label>
            <select class="swf-group-import-folder" style="width: 100%; box-sizing: border-box; background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: 4px; padding: 4px; font-size: 11px; height: 26px;">
              <option value="">(無)</option>
            </select>
          </div>
          <div style="margin-top: 6px; display: flex; gap: 4px; justify-content: space-between;">
            <button class="swf-gs-select-all" style="font-size: 10px; cursor: pointer; padding: 2px 4px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface);">全選</button>
            <button class="swf-gs-apply-btn" style="font-size: 10px; cursor: pointer; background: var(--warm); color: var(--ink); border: none; border-radius: 4px; padding: 2px 6px;">📥 全部套用</button>
          </div>
        </div>
        <div class="swf-gs-images"></div>
      </div>
      <div class="swf-group-params-sidebar">
        <div class="swf-panel-resize" title="拖動調整寬度"></div>
        <div class="swf-gs-header">
          <span>⚙ 統一參數</span>
          <button class="swf-gps-close">✕</button>
        </div>
        <div class="swf-gps-body">
          <label class="swf-gps-label">模型與處理</label>
          <select class="swf-gps-model swf-gps-input">
            <option value="nanobanana2">Nano Banana 2</option>
            <option value="nanobanana">Nano Banana Pro</option>
            <option value="gptimage">GPT Image 2.0</option>
            <option value="preprocess">預處理 (圖像處理)</option>
          </select>
          <label class="swf-gps-label">儲存資料夾</label>
          <select class="swf-gps-folder swf-gps-input"></select>
          <label class="swf-gps-label">檔案命名前綴</label>
          <input type="text" class="swf-gps-prefix swf-gps-input" placeholder="留空＝1, 2, 3…">
          <label class="swf-gps-label">檔案命名後綴</label>
          <input type="text" class="swf-gps-suffix swf-gps-input" placeholder="留空＝無">
          <label class="swf-gps-check"><input type="checkbox" class="swf-gps-overwrite" checked> 覆蓋同名檔案</label>
          <label class="swf-gps-label">統一提示詞</label>
          <div class="swf-gps-prompt swf-prompt-editor" contenteditable="true" data-placeholder="留空＝不變更各節點文本"></div>
          <div class="swf-gps-params"></div>
          <button class="swf-gps-apply">套用至所有節點</button>
        </div>
      </div>
      <div class="swf-group-automation-sidebar">
        <div class="swf-panel-resize" title="拖動調整寬度"></div>
        <div class="swf-gs-header">
          <span>🤖 完成後自動化</span>
          <button class="swf-gas-close">✕</button>
        </div>
        <div class="swf-gps-body">
          <label class="swf-gps-check"><input type="checkbox" class="swf-gas-enable"> 生成完成後自動執行</label>
          <label class="swf-gps-label">處理功能</label>
          <select class="swf-gas-fitmode swf-gps-input">
            <option value="contain">縮放適配 (Contain - 背景色填充)</option>
            <option value="cover">縮放填充 (Cover - 裁切溢出)</option>
            <option value="stretch">拉伸填充 (Stretch - 非等比例)</option>
            <option value="refcrop">參考線裁切 (Reference Crop)</option>
            <option value="desaturate">去除飽和度 (灰階)</option>
          </select>
          <div class="swf-gas-fit-params">
            <label class="swf-gps-label">目標解析度</label>
            <select class="swf-gas-resolution swf-gps-input">
              <option value="512">512 × 512</option>
              <option value="1024_512">1024 × 512</option>
              <option value="512_1024">512 × 1024</option>
              <option value="1024">1024 × 1024</option>
              <option value="2048">2048 × 2048</option>
            </select>
            <label class="swf-gps-label">對齊基準</label>
            <select class="swf-gas-align swf-gps-input">
              <option value="center">Center (居中)</option>
              <option value="top">Top (靠上)</option>
              <option value="bottom">Bottom (靠下)</option>
              <option value="left">Left (靠左)</option>
              <option value="right">Right (靠右)</option>
              <option value="top-left">Top-Left</option>
              <option value="top-right">Top-Right</option>
              <option value="bottom-left">Bottom-Left</option>
              <option value="bottom-right">Bottom-Right</option>
            </select>
            <label class="swf-gps-label">背景填充顏色</label>
            <select class="swf-gas-bg swf-gps-input">
              <option value="#FFFFFF">白色</option>
              <option value="#000000">黑色</option>
              <option value="#00FF00">綠色</option>
              <option value="#0000FF">藍色</option>
              <option value="transparent">透明</option>
              <option value="custom">自訂顏色</option>
            </select>
            <input type="color" class="swf-gas-bgpicker swf-gps-input" value="#FFFFFF" style="display:none;">
          </div>
          <div class="swf-gas-crop-params" style="display:none;">
            <label class="swf-gps-label">裁切參考線類型</label>
            <select class="swf-gas-cropref swf-gps-input">
              <option value="crosshair">十字線 (裁切為 4 等份)</option>
              <option value="thirds">井字線 (裁切為 9 等份)</option>
            </select>
          </div>
          <div class="swf-gas-note">每張生成圖會先在記憶體套用以上處理，再由本群組節點的儲存路徑存檔（不另存到其他資料夾）。</div>
        </div>
      </div>
      <div class="swf-group-header" style="background:${hexToRgba(gc, 0.15)};">
        <input type="color" class="swf-group-color-picker" value="${gc}" title="群組顏色">
        <input class="swf-group-title" value="${gt}" spellcheck="false">
        <span class="swf-grp-priority-wrap" title="下游接收優先級（參考圖=0，數字越小越前）">
          <span class="swf-grp-priority-label">接受優先級</span>
          <input type="number" class="swf-grp-priority" value="1" step="1">
        </span>
        <span class="swf-grp-spacer"></span>
        <div class="swf-group-actions">
          <button class="swf-grp-run-btn" title="同步執行群組"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>同步執行</button>
          <button class="swf-grp-collapse-btn" title="摺疊/展開群組"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
          <button class="swf-grp-del-btn" title="關閉/刪除群組"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
      </div>
      <div class="swf-group-collapsed-thumbs" title="此群組已完成的圖片"></div>
      <div class="swf-group-resize"></div>
    `;

    nodesContainer.appendChild(el);

    const groupData = { id, el, x: pos.x, y: pos.y, width: gw, height: gh, color: gc, title: gt, resultImages: [], receiveUpstream: true, excludedImages: [], sidebarOpen: false, paramsSidebarOpen: false, automationSidebarOpen: false, upstreamMode: 'all', receivePriority: 1, collapsed: false, expandedHeight: null, _collapsedMembers: null, locked: false, lockedMemberIds: null, importFolder: '', postAutomationConfig: { fitMode: 'contain', resolution: '1024', align: 'center', bg: '#FFFFFF', bgPicker: '#FFFFFF', cropRefLine: 'crosshair' }, postAutomationEnabled: false, _folderBlobUrls: [] };
    groups[id] = groupData;

    // Entity Selection
    el.addEventListener('mousedown', () => selectEntity(id));

    // Events
    setupGroupDrag(groupData);
    setupGroupResize(groupData);
    setupGroupEvents(groupData);
    setupPortEvents(el, id);
    scheduleEdgeRender();
    updateSwfFolderSelects();
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

  function findComfyNodes(workflowJson) {
    const loadImages = [];
    const saveImages = [];
    const promptNodes = [];
    try {
      const data = typeof workflowJson === 'string' ? JSON.parse(workflowJson) : workflowJson;
      for (const [id, node] of Object.entries(data)) {
        if (node.class_type === 'LoadImage') {
          loadImages.push(id);
        }
        if (node.class_type === 'SaveImage' || node.class_type === 'PreviewImage') {
          saveImages.push(id);
        }
        if (node.class_type === 'CLIPTextEncode') {
          promptNodes.push(id);
        }
      }
    } catch (e) {
      // invalid json
    }
    return { loadImages, saveImages, promptNodes };
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
    const priorityInput = el.querySelector('.swf-grp-priority');
    if (priorityInput) {
      priorityInput.value = group.receivePriority ?? 1;
      priorityInput.addEventListener('change', (e) => {
        group.receivePriority = parseInt(e.target.value, 10) || 0;
        e.target.value = group.receivePriority;
        propagateVisualImages();
      });
      // Don't let clicks/drags on the number field start a group drag
      priorityInput.addEventListener('mousedown', (e) => e.stopPropagation());
    }
    el.querySelector('.swf-grp-del-btn').addEventListener('click', () => { saveUndoState(); promptRemoveGroup(group.id); });
    el.querySelector('.swf-grp-run-btn').addEventListener('click', () => executeGroup(group.id));
    el.querySelector('.swf-grp-collapse-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleGroupCollapse(group); });
    el.querySelector('.swf-grp-lock-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleGroupLock(group); });
    el.querySelector('.swf-grp-fit-btn').addEventListener('click', (e) => { e.stopPropagation(); autoFitGroup(group); });
    el.querySelector('.swf-grp-dup-btn').addEventListener('click', () => { saveUndoState(); duplicateGroup(group.id); });

    // 統一參數 slide-out toggle (mutually exclusive with the 上游圖片 sidebar)
    el.querySelector('.swf-grp-sync-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (getGroupMembers(group.id).length === 0) {
        if (window.showToast) window.showToast('⚠️ 群組內沒有節點'); return;
      }
      group.paramsSidebarOpen = !group.paramsSidebarOpen;
      if (group.paramsSidebarOpen) {
        group.sidebarOpen = false; el.classList.remove('sidebar-open');
        group.automationSidebarOpen = false; el.classList.remove('automation-sidebar-open');
        renderGroupParamsSidebar(group);
        if (group.paramsSidebarWidth) applyPanelWidth(el.querySelector('.swf-group-params-sidebar'), group.paramsSidebarWidth);
      }
      el.classList.toggle('params-sidebar-open', group.paramsSidebarOpen);
    });
    el.querySelector('.swf-gps-close').addEventListener('click', (e) => {
      e.stopPropagation();
      group.paramsSidebarOpen = false;
      el.classList.remove('params-sidebar-open');
    });
    el.querySelector('.swf-gps-model').addEventListener('change', (e) => {
      const paramsBox = el.querySelector('.swf-gps-params');
      paramsBox.innerHTML = buildParamsHTML(e.target.value, {});
      wireModalSliders(paramsBox);
      wireImageProcessVisibility(paramsBox);
    });
    el.querySelector('.swf-gps-apply').addEventListener('click', (e) => {
      e.stopPropagation();
      applyGroupParamsSidebar(group);
    });
    // 統一提示詞 — same rich-text editor as node prompts (color tags, inline thumbs, paste from prompt library)
    setupPromptEditor(el.querySelector('.swf-gps-prompt'));
    // Left-edge width resize for all three slide-out panels.
    setupPanelResize(group, '.swf-group-sidebar', 'sidebarWidth');
    setupPanelResize(group, '.swf-group-params-sidebar', 'paramsSidebarWidth');
    setupPanelResize(group, '.swf-group-automation-sidebar', 'automationSidebarWidth');

    // 完成後自動化 slide-out toggle (mutually exclusive with the other two panels)
    el.querySelector('.swf-grp-automation-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      group.automationSidebarOpen = !group.automationSidebarOpen;
      if (group.automationSidebarOpen) {
        group.sidebarOpen = false; el.classList.remove('sidebar-open');
        group.paramsSidebarOpen = false; el.classList.remove('params-sidebar-open');
        renderGroupAutomationSidebar(group);
        if (group.automationSidebarWidth) applyPanelWidth(el.querySelector('.swf-group-automation-sidebar'), group.automationSidebarWidth);
      }
      el.classList.toggle('automation-sidebar-open', group.automationSidebarOpen);
    });
    el.querySelector('.swf-gas-close').addEventListener('click', (e) => {
      e.stopPropagation();
      group.automationSidebarOpen = false;
      el.classList.remove('automation-sidebar-open');
    });
    el.querySelector('.swf-gas-enable').addEventListener('change', (e) => {
      group.postAutomationEnabled = e.target.checked;
    });
    el.querySelector('.swf-gas-fitmode').addEventListener('change', (e) => {
      group.postAutomationConfig.fitMode = e.target.value;
      updateAutomationParamVisibility(el);
    });
    el.querySelector('.swf-gas-resolution').addEventListener('change', (e) => {
      group.postAutomationConfig.resolution = e.target.value;
    });
    el.querySelector('.swf-gas-align').addEventListener('change', (e) => {
      group.postAutomationConfig.align = e.target.value;
    });
    el.querySelector('.swf-gas-bg').addEventListener('change', (e) => {
      group.postAutomationConfig.bg = e.target.value;
      updateAutomationParamVisibility(el);
    });
    el.querySelector('.swf-gas-bgpicker').addEventListener('input', (e) => {
      group.postAutomationConfig.bgPicker = e.target.value;
    });
    el.querySelector('.swf-gas-cropref').addEventListener('change', (e) => {
      group.postAutomationConfig.cropRefLine = e.target.value;
    });

    // 上游圖片 sidebar toggle (mutually exclusive with the 統一參數 / 自動化 panels)
    el.querySelector('.swf-group-sidebar-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      group.sidebarOpen = !group.sidebarOpen;
      if (group.sidebarOpen) {
        group.paramsSidebarOpen = false; el.classList.remove('params-sidebar-open');
        group.automationSidebarOpen = false; el.classList.remove('automation-sidebar-open');
        renderGroupSidebar(group);
        if (group.sidebarWidth) applyPanelWidth(el.querySelector('.swf-group-sidebar'), group.sidebarWidth);
      }
      el.classList.toggle('sidebar-open', group.sidebarOpen);
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
    el.querySelectorAll('.swf-gs-mode-radio').forEach(r => {
      r.addEventListener('change', (e) => {
        if (e.target.checked) { group.upstreamMode = e.target.value; propagateVisualImages(); renderGroupSidebar(group); }
      });
    });

    const importFolderSelect = el.querySelector('.swf-group-import-folder');
    if (importFolderSelect) {
      importFolderSelect.addEventListener('change', (e) => {
        group.importFolder = e.target.value;
        resolveGroupFolderImages();
      });
      importFolderSelect.addEventListener('mousedown', (e) => e.stopPropagation());
    }

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

    // Sync radio buttons to current mode
    group.el.querySelectorAll('.swf-gs-mode-radio').forEach(r => { r.checked = r.value === (group.upstreamMode || 'all'); });

    if (!group.receiveUpstream) {
      container.innerHTML = '<div class="swf-gs-empty">已關閉接收上游圖片</div>';
      return;
    }

    // Ordered mode: show per-node assignment preview instead of flat image list
    if (group.upstreamMode === 'ordered') {
      const entryNodes = getGroupEntryNodes(group.id);
      const hasUpstream = edges.some(e => e.target === group.id);
      if (!hasUpstream) {
        container.innerHTML = '<div class="swf-gs-empty">無上游連結</div>';
        return;
      }
      entryNodes.forEach((n, idx) => {
        const slot = document.createElement('div');
        slot.className = 'swf-gs-ordered-slot';
        const label = document.createElement('div');
        label.className = 'swf-gs-ordered-label';
        label.textContent = `節點 ${idx + 1}：${n.data.model || n.type}`;
        slot.appendChild(label);
        // Collect images this node would receive
        edges.filter(e => e.target === group.id).forEach(srcEdge => {
          let imgs = [];
          if (isGroup(srcEdge.source)) {
            const exitNodes = getGroupExitNodes(srcEdge.source);
            if (idx < exitNodes.length) imgs = exitNodes[idx].resultImages || [];
          } else if (idx === 0) {
            imgs = getSourceOutputImages(srcEdge.source);
          }
          imgs.filter(img => !group.excludedImages.includes(img)).forEach(imgSrc => {
            const wrapper = document.createElement('div');
            wrapper.className = 'swf-gs-img-wrapper';
            const img = document.createElement('img');
            img.src = imgSrc; img.className = 'swf-gs-img';
            wrapper.appendChild(img);
            slot.appendChild(wrapper);
          });
        });
        if (slot.children.length === 1) {
          const hint = document.createElement('div');
          hint.className = 'swf-gs-empty';
          hint.style.cssText = 'font-size:10px;padding:4px 0';
          hint.textContent = '（等待上游執行）';
          slot.appendChild(hint);
        }
        container.appendChild(slot);
      });
      return;
    }

    // All mode: flat image list
    const upstreamImages = [];
    edges.filter(e => e.target === group.id).forEach(e => {
      getSourceOutputImages(e.source).forEach(img => upstreamImages.push(img));
    });
    const visibleImages = upstreamImages.filter(img => !group.excludedImages.includes(img));

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
        if (window.AssetManager && window.AssetManager.openLightBox) window.AssetManager.openLightBox(imgSrc, '上游圖片', false);
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

  // True if the box (x,y,w,h) intersects any group other than exceptId. Used to
  // keep groups from overlapping so geometric membership stays unambiguous.
  function groupBoxOverlaps(x, y, w, h, exceptId) {
    for (const gid in groups) {
      if (gid === exceptId) continue;
      const o = groups[gid];
      if (x < o.x + o.width && x + w > o.x && y < o.y + o.height && y + h > o.y) return true;
    }
    return false;
  }

  // Find a non-overlapping position near (x,y) by nudging right/down in steps.
  function findFreeGroupSpot(x, y, w, h, exceptId) {
    if (!groupBoxOverlaps(x, y, w, h, exceptId)) return { x, y };
    const step = 40;
    for (let i = 1; i <= 200; i++) {
      const nx = x + i * step;
      if (!groupBoxOverlaps(nx, y, w, h, exceptId)) return { x: nx, y };
      const ny = y + i * step;
      if (!groupBoxOverlaps(x, ny, w, h, exceptId)) return { x, y: ny };
    }
    return { x, y };
  }

  function setupGroupDrag(group) {
    const header = group.el.querySelector('.swf-group-header');
    let isDragging = false, offsetX = 0, offsetY = 0, memberOffsets = [], dragSnapshotted = false;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.swf-group-actions, .swf-grp-collapse-btn, .swf-grp-priority-wrap') || e.target.tagName === 'INPUT') return;
      isDragging = true;
      dragSnapshotted = false;
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
      if (newX === group.x && newY === group.y) return; // no grid-position change yet
      // Snapshot once, on the first actual move, capturing the pre-drag positions.
      if (!dragSnapshotted) { saveUndoState(); dragSnapshotted = true; }
      // Resolve per-axis so the group slides/stops against neighbors instead of overlapping.
      if (!groupBoxOverlaps(newX, group.y, group.width, group.height, group.id)) group.x = newX;
      if (!groupBoxOverlaps(group.x, newY, group.width, group.height, group.id)) group.y = newY;
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
      let newW = Math.max(300, startW + (e.clientX - startX) / zoomLevel);
      let newH = Math.max(200, startH + (e.clientY - startY) / zoomLevel);
      // Clamp growth so the group doesn't expand into a neighbor (keep current size on that axis).
      if (newW > group.width && groupBoxOverlaps(group.x, group.y, newW, group.height, group.id)) newW = group.width;
      if (newH > group.height && groupBoxOverlaps(group.x, group.y, group.width, newH, group.id)) newH = group.height;
      group.width = newW;
      group.height = newH;
      group.el.style.width = group.width + 'px';
      group.el.style.height = group.height + 'px';
      scheduleEdgeRender();
    });

    window.addEventListener('mouseup', () => { isResizing = false; });
  }

  // The three group slide-out panels (上游圖片 / 統一參數 / 完成後自動化) all sit to the
  // LEFT of the group (CSS left:-230, width:220 → right edge anchored 10px off the group's
  // left). Dragging a panel's left-edge handle leftward widens it; the right edge stays
  // fixed by setting left = -(width + 10). Shared by all three panels.
  const PANEL_GAP = 10, PANEL_MIN_W = 180, PANEL_MAX_W = 480;
  function applyPanelWidth(panel, w) {
    if (!panel) return;
    panel.style.width = w + 'px';
    panel.style.left = -(w + PANEL_GAP) + 'px';
  }
  function setupPanelResize(group, panelSelector, storeKey) {
    const panel = group.el.querySelector(panelSelector);
    const handle = panel && panel.querySelector('.swf-panel-resize');
    if (!handle || !panel) return;
    let isResizing = false, startX = 0, startW = 0;

    handle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startW = panel.offsetWidth;
      e.stopPropagation(); e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      // Drag left (clientX decreases) → wider; /zoomLevel matches the zoomed wrapper.
      const newW = Math.max(PANEL_MIN_W, Math.min(PANEL_MAX_W, startW + (startX - e.clientX) / zoomLevel));
      group[storeKey] = newW;
      applyPanelWidth(panel, newW);
    });

    window.addEventListener('mouseup', () => { isResizing = false; });
  }

  /** Dynamic Membership: node is inside group if its center point is within group bounding box.
   *  While collapsed, members are hidden (display:none) so geometry is unreliable — return the
   *  snapshot taken at collapse time instead (filtered to nodes that still exist). */
  function getGroupMembers(groupId) {
    const g = groups[groupId]; if (!g) return [];
    if (g.collapsed && g._collapsedMembers) {
      return g._collapsedMembers.filter(n => nodes[n.id]);
    }
    // Locked: membership is frozen to the snapshot — geometry (new/overlapping nodes) is ignored.
    if (g.locked && g.lockedMemberIds) {
      return g.lockedMemberIds.map(nid => nodes[nid]).filter(Boolean);
    }
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

  /** Entry nodes = members with no internal upstream edge (sorted left→right by X) */
  function getGroupEntryNodes(groupId) {
    const members = getGroupMembers(groupId);
    const memberSet = new Set(members.map(m => m.id));
    return members
      .filter(m => !edges.some(e => e.target === m.id && memberSet.has(e.source)))
      .sort((a, b) => a.x - b.x);
  }

  /** Exit nodes = members with no internal downstream edge (sorted left→right by X) */
  function getGroupExitNodes(groupId) {
    const members = getGroupMembers(groupId);
    const memberSet = new Set(members.map(m => m.id));
    return members
      .filter(m => !edges.some(e => e.source === m.id && memberSet.has(e.target)))
      .sort((a, b) => a.x - b.x);
  }

  /** 1-based pairing index of a node among its group's entry nodes, or null if
   *  the node is not an entry node of any group. Shared by the order badge and
   *  the auto-save filename so both always agree. */
  function getNodeGroupNumber(node) {
    for (const gid in groups) {
      const idx = getGroupEntryNodes(gid).findIndex(m => m.id === node.id);
      if (idx >= 0) return idx + 1;
    }
    return null;
  }

  /** If this node belongs to a group with "完成後自動化" enabled, return that
   *  group's inline automation config; else null. The image is transformed
   *  in-memory and saved through the node's own save path (single save location). */
  function getNodePostAutomationConfig(node) {
    for (const gid in groups) {
      const g = groups[gid];
      if (!g.postAutomationEnabled || !g.postAutomationConfig) continue;
      if (getGroupMembers(gid).some(m => m.id === node.id)) {
        return g.postAutomationConfig;
      }
    }
    return null;
  }

  /** Refresh the order badges on all nodes. Entry nodes of a group show their
   *  1-based pairing index (left→right by X); everything else hides the badge.
   *  Called from renderEdges() so it stays in sync as nodes move. */
  function updateGroupNumbers() {
    const numbered = new Set();
    for (const gid in groups) {
      getGroupEntryNodes(gid).forEach((n, i) => {
        const badge = n.el.querySelector('.swf-order-badge');
        if (badge) {
          const txt = String(i + 1);
          if (badge.textContent !== txt) badge.textContent = txt;
          if (badge.style.display !== '') badge.style.display = '';
        }
        numbered.add(n.id);
      });
    }
    for (const nid in nodes) {
      if (numbered.has(nid)) continue;
      const badge = nodes[nid].el.querySelector('.swf-order-badge');
      if (badge && badge.style.display !== 'none') badge.style.display = 'none';
    }
  }

  const GROUP_HEADER_H = 44;
  const COLLAPSED_THUMBS_H = 64; // extra height for the completed-image strip when collapsed

  // The group's completed (generated) images: its aggregated results + each member's results.
  function getGroupResultImages(group) {
    const out = [...(group.resultImages || [])];
    getGroupMembers(group.id).forEach(n => { if (n.resultImages) out.push(...n.resultImages); });
    return [...new Set(out)];
  }

  // Render the completed-image thumbnail strip shown under the header while collapsed,
  // and size the collapsed group to fit it (header only when there are no results).
  function renderCollapsedGroupThumbs(group) {
    const box = group.el.querySelector('.swf-group-collapsed-thumbs');
    if (!box) return;
    const imgs = getGroupResultImages(group);
    box.innerHTML = '';
    imgs.forEach(src => {
      const im = document.createElement('img');
      im.src = src;
      im.className = 'swf-grp-collapsed-thumb';
      im.title = '點擊放大';
      im.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.AssetManager && window.AssetManager.openLightBox) window.AssetManager.openLightBox(src, '群組結果', false);
      });
      box.appendChild(im);
    });
    group.el.classList.toggle('swf-grp-has-thumbs', imgs.length > 0);
    if (group.collapsed) {
      const h = GROUP_HEADER_H + (imgs.length ? COLLAPSED_THUMBS_H : 0);
      group.height = h;
      group.el.style.height = h + 'px';
    }
  }

  // Collapse hides member nodes and shrinks the group to its header bar (plus a strip
  // of completed images); expand restores.
  function toggleGroupCollapse(group) {
    group.collapsed = !group.collapsed;
    if (group.collapsed) {
      group._collapsedMembers = getGroupMembers(group.id);
      group.expandedHeight = group.height;
      group._collapsedMembers.forEach(n => { n.el.style.display = 'none'; });
      group.el.classList.add('swf-group-collapsed');
      renderCollapsedGroupThumbs(group); // sets height to fit header + result strip
    } else {
      group.el.classList.remove('swf-group-collapsed');
      group.height = group.expandedHeight || 320;
      group.el.style.height = group.height + 'px';
      (group._collapsedMembers || []).forEach(n => { if (nodes[n.id]) n.el.style.display = ''; });
      group._collapsedMembers = null;
    }
    // Reflect chevron state
    const chev = group.el.querySelector('.swf-grp-collapse-btn');
    if (chev) chev.classList.toggle('collapsed', group.collapsed);
    scheduleEdgeRender();
  }

  // Lock freezes the current member set: no new nodes are accepted and overlapping
  // nodes aren't carried away; only bound members move with the group.
  function toggleGroupLock(group) {
    group.locked = !group.locked;
    if (group.locked) {
      group.lockedMemberIds = getGroupMembers(group.id).map(m => m.id);
    } else {
      group.lockedMemberIds = null;
    }
    group.el.classList.toggle('swf-group-locked', group.locked);
    if (!isLoadingWorkflow && window.showToast) window.showToast(group.locked ? '🔒 已鎖定群組成員' : '🔓 已解除鎖定', 1500);
    scheduleEdgeRender();
  }

  // Resize the group so its box encloses every member node (header sits above them).
  function autoFitGroup(group) {
    if (group.collapsed) toggleGroupCollapse(group); // expand first
    const members = getGroupMembers(group.id);
    if (members.length === 0) { if (window.showToast) window.showToast('⚠️ 群組內沒有節點', 1500); return; }
    const PAD = 24;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    members.forEach(n => {
      const w = n.el.offsetWidth || 320, h = n.el.offsetHeight || 200;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + h);
    });
    group.x = Math.round(minX - PAD);
    group.y = Math.round(minY - PAD - GROUP_HEADER_H);
    group.width = Math.max(400, Math.round((maxX - minX) + PAD * 2));
    group.height = Math.max(260, Math.round((maxY - minY) + PAD * 2 + GROUP_HEADER_H));
    group.el.style.left = group.x + 'px';
    group.el.style.top = group.y + 'px';
    group.el.style.width = group.width + 'px';
    group.el.style.height = group.height + 'px';
    if (group.locked) group.lockedMemberIds = members.map(m => m.id); // keep snapshot fresh
    scheduleEdgeRender();
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
    const offsetX = g.width + 40, offsetY = 0;

    // Create new group
    const newGroup = createGroup(g.x + offsetX, g.y + offsetY, g.width, g.height, g.color, g.title + ' (複本)');
    newGroup.postAutomationConfig = { ...(g.postAutomationConfig || {}) };
    newGroup.postAutomationEnabled = !!g.postAutomationEnabled;

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
      copyNodeState(srcNode, newNode);
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

  /** Feature 7: Unify member-node params via the group's 統一參數 slide-out panel */

  // Populate the group's 統一參數 slide-out panel from its first member node.
  function renderGroupParamsSidebar(group) {
    const el = group.el;
    const members = getGroupMembers(group.id);
    const source = members[0];
    const model = source ? (source.data.model || 'nanobanana2') : 'nanobanana2';
    const params = source ? { ...source.data.params } : {};

    const modelSel = el.querySelector('.swf-gps-model');
    if (modelSel) modelSel.value = model;
    const paramsBox = el.querySelector('.swf-gps-params');
    if (paramsBox) { paramsBox.innerHTML = buildParamsHTML(model, params); wireModalSliders(paramsBox); wireImageProcessVisibility(paramsBox); }

    const folderSel = el.querySelector('.swf-gps-folder');
    if (folderSel) {
      const curFolder = source ? (source.el.querySelector('.swf-node-folder')?.value || '') : '';
      folderSel.innerHTML = buildNodeFolderOptionsHTML(curFolder);
    }
    const prefixInput = el.querySelector('.swf-gps-prefix');
    if (prefixInput) prefixInput.value = source ? (source.data.namePrefix || '') : '';
    const suffixInput = el.querySelector('.swf-gps-suffix');
    if (suffixInput) suffixInput.value = source ? (source.data.nameSuffix || '') : '';
    const overwriteInput = el.querySelector('.swf-gps-overwrite');
    if (overwriteInput) overwriteInput.checked = source ? (source.data.overwrite !== false) : true;
    // Mirror the first member's prompt as rich content (color tags + inline thumbs).
    const promptEd = el.querySelector('.swf-gps-prompt');
    if (promptEd) {
      promptEd.innerHTML = '';
      const sp = source ? source.el.querySelector('.swf-prompt-editor') : null;
      if (sp) sp.childNodes.forEach(c => { const safe = sanitizePromptNode(c); if (safe) promptEd.appendChild(safe); });
      if (window.RichTextService) window.RichTextService.updatePlaceholder(promptEd);
    }
  }

  // Apply the 統一參數 panel's values to every member node of the group.
  function applyGroupParamsSidebar(group) {
    const members = getGroupMembers(group.id);
    if (members.length === 0) { if (window.showToast) window.showToast('⚠️ 群組內沒有節點'); return; }
    const el = group.el;
    const model = el.querySelector('.swf-gps-model').value;
    const paramsBox = el.querySelector('.swf-gps-params');

    const newParams = {};
    paramsBox.querySelectorAll('select[data-param]').forEach(s => { newParams[s.dataset.param] = s.value; });
    paramsBox.querySelectorAll('input[type="range"][data-param]').forEach(i => { newParams[i.dataset.param] = parseFloat(i.value); });
    paramsBox.querySelectorAll('input[type="checkbox"][data-param]').forEach(i => { newParams[i.dataset.param] = i.checked; });
    paramsBox.querySelectorAll('input[type="color"][data-param]').forEach(i => { newParams[i.dataset.param] = i.value; });

    const folder = el.querySelector('.swf-gps-folder')?.value ?? '';
    const namePrefix = (el.querySelector('.swf-gps-prefix')?.value ?? '').trim();
    const nameSuffix = (el.querySelector('.swf-gps-suffix')?.value ?? '').trim();
    const overwrite = el.querySelector('.swf-gps-overwrite')?.checked !== false;
    // Unified prompt: copy rich content (color tags / inline thumbs) into each member
    // only when non-empty, so an empty field doesn't wipe everyone's prompts.
    const unifiedPromptEd = el.querySelector('.swf-gps-prompt');
    const unifiedPromptHasContent = !!unifiedPromptEd && (unifiedPromptEd.textContent.trim() ||
      unifiedPromptEd.querySelector('img, .editor-color-tag, .editor-img-tag'));

    for (const n of members) {
      n.data.model = model;
      n.data.params = { ...newParams };
      n.data.namePrefix = namePrefix;
      n.data.nameSuffix = nameSuffix;
      n.data.overwrite = overwrite;
      n.el.querySelector('.swf-model-sel').value = model;
      n.el.querySelector('.swf-params-area').innerHTML = buildParamsHTML(model, newParams);
      wireParamInputs(n);
      const nf = n.el.querySelector('.swf-node-folder');
      if (nf) nf.value = folder;
      const owCb = n.el.querySelector('.swf-overwrite-cb');
      if (owCb) owCb.checked = overwrite;
      if (unifiedPromptHasContent) {
        const pEl = n.el.querySelector('.swf-prompt-editor');
        if (pEl) {
          pEl.innerHTML = '';
          unifiedPromptEd.childNodes.forEach(c => { const safe = sanitizePromptNode(c); if (safe) pEl.appendChild(safe); });
          if (window.RichTextService) window.RichTextService.updatePlaceholder(pEl);
          pEl.dispatchEvent(new Event('input'));
        }
      }
    }

    if (window.showToast) window.showToast(`✅ 已將 ${members.length} 個節點統一為 ${MODEL_PARAMS[model]?.label || model}`);
  }

  // Show/hide the 完成後自動化 param blocks: fit params for contain/cover/stretch,
  // crop params for refcrop; custom-colour picker only when bg = custom.
  function updateAutomationParamVisibility(el) {
    const fitMode = el.querySelector('.swf-gas-fitmode')?.value || 'contain';
    const isFit = fitMode === 'contain' || fitMode === 'cover' || fitMode === 'stretch';
    const fitBox = el.querySelector('.swf-gas-fit-params');
    const cropBox = el.querySelector('.swf-gas-crop-params');
    if (fitBox) fitBox.style.display = isFit ? '' : 'none';
    if (cropBox) cropBox.style.display = fitMode === 'refcrop' ? '' : 'none';
    const bg = el.querySelector('.swf-gas-bg')?.value;
    const picker = el.querySelector('.swf-gas-bgpicker');
    if (picker) picker.style.display = bg === 'custom' ? '' : 'none';
  }

  // Populate the 完成後自動化 panel from the group's inline automation config.
  function renderGroupAutomationSidebar(group) {
    const el = group.el;
    const cfg = group.postAutomationConfig || {};
    const setVal = (sel, v) => { const n = el.querySelector(sel); if (n != null && v != null) n.value = v; };
    setVal('.swf-gas-fitmode', cfg.fitMode || 'contain');
    setVal('.swf-gas-resolution', cfg.resolution || '1024');
    setVal('.swf-gas-align', cfg.align || 'center');
    setVal('.swf-gas-bg', cfg.bg || '#FFFFFF');
    setVal('.swf-gas-bgpicker', cfg.bgPicker || '#FFFFFF');
    setVal('.swf-gas-cropref', cfg.cropRefLine || 'crosshair');
    const cb = el.querySelector('.swf-gas-enable');
    if (cb) cb.checked = !!group.postAutomationEnabled;
    updateAutomationParamVisibility(el);
  }

  // Wire range sliders inside a params panel. Uses manual pointer
  // tracking (same as wireParamInputs) because input[type=range] events are
  // unreliable in some browsers; here it also guarantees live display updates.
  function wireModalSliders(container) {
    container.querySelectorAll('input[type="range"]').forEach(slider => {
      slider.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        const doUpdate = (ev) => {
          const rect = slider.getBoundingClientRect();
          const min = parseFloat(slider.min);
          const max = parseFloat(slider.max);
          const step = parseFloat(slider.step) || 1;
          const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
          let val = Math.round((min + ratio * (max - min)) / step) * step;
          val = Math.max(min, Math.min(max, parseFloat(val.toFixed(10))));
          slider.value = val;
          const valEl = slider.nextElementSibling;
          if (valEl && valEl.classList.contains('swf-slider-val')) valEl.textContent = val.toFixed(2);
        };
        doUpdate(e);
        const onMove = (ev) => doUpdate(ev);
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
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
    const isComfy = type === 'comfyui';
    let pos = (initialX !== undefined) ? { x: initialX, y: initialY } : calculateNextPosition();

    const el = document.createElement('div');
    el.className = 'swf-macro';
    el.dataset.nodeId = id;
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';

    const headerTitle = isComfy ? 'ComfyUI' : (isI2I ? '圖生圖 (I2I)' : '文生圖 (T2I)');
    const defaultModel = isComfy ? 'comfyui' : 'nanobanana2';
    const modelOptionsHTML = Object.entries(MODEL_PARAMS).map(([k, v]) =>
      `<option value="${k}" ${k === defaultModel ? 'selected' : ''}>${v.label}</option>`
    ).join('');

    el.innerHTML = `
      <div class="swf-port swf-port-in" data-port="in" data-node="${id}" title="接收連線"></div>
      <div class="swf-port swf-port-out" data-port="out" data-node="${id}" title="發起連線"></div>
      <div class="swf-macro-header">
        <span class="swf-order-badge" style="display:none"></span>
        <span>${headerTitle}</span>
        <div class="swf-macro-actions">
          <button class="swf-collapse-btn" title="摺疊/展開"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
          <button class="swf-dup-btn" title="複製"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
          <button class="swf-del-btn" title="刪除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
      </div>
      <div class="swf-macro-body">
        <div style="display:flex; gap: 8px; margin-bottom: 8px;">
          <div class="swf-model-section" style="flex:1; ${isComfy ? 'display:none;' : ''}"><label style="font-size: 11px; display: block; color: var(--muted); margin-bottom: 4px;">模型與處理</label><select class="swf-model-sel" style="width:100%; box-sizing:border-box;">${modelOptionsHTML}</select></div>
          ${isComfy ? `
          <div class="swf-comfy-label-section" style="flex:1;">
            <label style="font-size: 11px; display: block; color: var(--muted); margin-bottom: 4px;">類型</label>
            <div style="width: 100%; box-sizing: border-box; background: var(--bg-deep, #eef2f7); border: 1px solid var(--border); color: var(--accent, #1783FF); border-radius: 4px; padding: 4px 8px; font-size: 12px; height: 26px; line-height: 16px; font-weight: bold; text-align: center;">ComfyUI API</div>
          </div>
          ` : ''}
          <div class="swf-folder-section" style="flex:1;"><label style="font-size: 11px; display: block; color: var(--muted); margin-bottom: 4px;">儲存資料夾</label><select class="swf-node-folder" title="選擇儲存資料夾" style="width: 100%; box-sizing: border-box; background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: 4px; padding: 4px; font-size: 12px; height: 26px;"><option value="">預設 (根目錄)</option></select></div>
        </div>
        <div class="swf-params-area">${buildParamsHTML(defaultModel, {})}</div>
        ${(isI2I || isComfy) ? `<div><div class="swf-section-label">參考圖片 (拖曳排序 / 拖入提示詞)</div><div class="swf-images-area" data-node="${id}"><input type="file" class="swf-file-input" accept="image/*" multiple hidden><button class="swf-upload-btn" title="上傳圖片">+</button></div></div>` : ''}
        <div class="swf-prompt-section"><div class="swf-section-label swf-prompt-label">提示詞 (Prompt)</div><div class="swf-prompt-editor" id="swf-prompt-${id}" contenteditable="true" data-placeholder="輸入提示詞，可拖入圖片縮圖..." data-node="${id}"></div></div>
        <div class="swf-preview-area" data-node="${id}"><span class="swf-preview-placeholder">生成結果將顯示於此</span><img class="swf-preview-img" style="display:none;"><button class="swf-download-btn" title="下載">📥</button></div>
        <button class="swf-run-btn" data-node="${id}">▶ 生成</button>
        <label class="swf-overwrite-row" title="關閉時，同名檔案會自動加上 _1, _2… 而不覆蓋"><input type="checkbox" class="swf-overwrite-cb"> 覆蓋同名檔案</label>
      </div>
      <div class="swf-node-resize" title="調整大小"></div>
    `;

    nodesContainer.appendChild(el);
    const nodeData = { 
      id, type, el, x: pos.x, y: pos.y, 
      width: 320, isCollapsed: false,
      data: { model: defaultModel, images: [], uploadedImages: [], fsaPaths: {}, excludedIncomingImages: [], params: {}, promptHeight: 0, namePrefix: '', nameSuffix: '', overwrite: false },
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
    updateSwfFolderSelects();
    return nodeData;
  }

  // ═══════════════════════════════════════════
  // ── NODE DRAG ──
  // ═══════════════════════════════════════════
  function setupNodeDrag(node) {
    const header = node.el.querySelector('.swf-macro-header');
    let isDraggingNode = false, offsetX = 0, offsetY = 0, dragSnapshotted = false;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.swf-macro-actions')) return;
      isDraggingNode = true;
      dragSnapshotted = false;
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
      if (newX === node.x && newY === node.y) return; // no grid-position change yet
      // Snapshot once, on the first actual move, capturing the pre-drag position.
      if (!dragSnapshotted) { saveUndoState(); dragSnapshotted = true; }
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
        el.classList.toggle('swf-collapsed', node.isCollapsed);
        scheduleEdgeRender();
      });
      if (node.isCollapsed) {
        el.classList.add('swf-collapsed');
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
    if (modelSel) {
      modelSel.addEventListener('change', (e) => {
        node.data.model = e.target.value; node.data.params = {};
        el.querySelector('.swf-params-area').innerHTML = buildParamsHTML(e.target.value, {});
        wireParamInputs(node);
      });
    }
    wireParamInputs(node);

    // ComfyUI autodetect wiring
    const autodetectBtn = el.querySelector('.swf-comfy-autodetect');
    if (autodetectBtn) {
      autodetectBtn.addEventListener('click', () => {
        const jsonText = node.data.params.workflowJson || '';
        const statusEl = el.querySelector('.swf-comfy-detection-status');
        try {
          if (!jsonText.trim()) {
            throw new Error('請先貼上 API 工作流 JSON');
          }
          const data = JSON.parse(jsonText);
          const detected = findComfyNodes(data);
          
          const positiveInput = el.querySelector('input[data-param="positivePromptNodeId"]');
          const outputInput = el.querySelector('input[data-param="outputNodeId"]');
          const inputNodeInput = el.querySelector('input[data-param="inputNodeIds"]');
          
          if (positiveInput && detected.promptNodes.length > 0) {
            positiveInput.value = detected.promptNodes[0];
            node.data.params.positivePromptNodeId = detected.promptNodes[0];
          }
          if (outputInput && detected.saveImages.length > 0) {
            outputInput.value = detected.saveImages[0];
            node.data.params.outputNodeId = detected.saveImages[0];
          }
          if (inputNodeInput && detected.loadImages.length > 0) {
            inputNodeInput.value = detected.loadImages.join(', ');
            node.data.params.inputNodeIds = detected.loadImages.join(', ');
          }
          
          if (statusEl) {
            statusEl.style.color = 'var(--primary, #1783FF)';
            statusEl.textContent = `偵測成功！提示詞節點: ${detected.promptNodes[0] || '無'}，輸出節點: ${detected.saveImages[0] || '無'}，輸入圖片節點: ${detected.loadImages.join(',') || '無'}`;
          }
        } catch (err) {
          if (statusEl) {
            statusEl.style.color = 'var(--danger, #ff4d4f)';
            statusEl.textContent = '偵測失敗：' + err.message;
          }
        }
      });
    }

    const overwriteCb = el.querySelector('.swf-overwrite-cb');
    if (overwriteCb) {
      overwriteCb.addEventListener('change', (e) => { node.data.overwrite = e.target.checked; });
    }

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
          window.StudioUtils.fileToDataURL(file).then(dataUrl => addNodeImage(node, dataUrl)).catch(() => {});
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
          blobUrlToDataUrl(imgSrc).then(dataUrl => addNodeImage(node, dataUrl));
          return;
        }

        // Handle asset drops
        const assetJson = e.dataTransfer.getData('text/ide-asset') || e.dataTransfer.getData('text/swf-asset');
        if (assetJson) {
          try {
            const asset = JSON.parse(assetJson);
            if (asset.type === 'fsa' && asset.path && node.data.images.length < 16) {
              // Normally unreachable: Asset Manager drags also set text/swf-image-src,
              // which is handled (with blob→dataURL conversion) by the earlier branch.
              // Kept as a defensive fallback for asset payloads without an image src.
              const blobUrl = e.dataTransfer.getData('text/swf-image-src');
              if (blobUrl) {
                saveUndoState();
                blobUrlToDataUrl(blobUrl).then(dataUrl => addNodeImage(node, dataUrl));
              }
            } else if (asset.data && node.data.images.length < 16) {
              saveUndoState();
              addNodeImage(node, asset.data);
            }
          } catch (err) { /* ignore */ }
          return;
        }
        if (e.dataTransfer.files.length > 0) {
          saveUndoState();
          Array.from(e.dataTransfer.files).forEach(file => {
            if (!file.type.startsWith('image/') || node.data.images.length >= 16) return;
            window.StudioUtils.fileToDataURL(file).then(dataUrl => addNodeImage(node, dataUrl)).catch(() => {});
          });
        }
      });
      setupImageSorting(node);
    }

    // Prompt editor — rich-text wiring (placeholder + paste sanitize + image/prompt drop)
    setupPromptEditor(el.querySelector('.swf-prompt-editor'));

    el.querySelector('.swf-download-btn').addEventListener('click', () => {
      const img = el.querySelector('.swf-preview-img');
      if (!img.src) return;
      const a = document.createElement('a'); a.href = img.src; a.download = 'swf_' + Date.now() + '.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });
    const previewImg = el.querySelector('.swf-preview-img');
    previewImg.addEventListener('click', function () {
      if (this.src && window.AssetManager?.openLightBox) window.AssetManager.openLightBox(this.src, 'Generated', false);
    });
    // Route result-image drags through our clean image path (sets a custom type)
    // so dropping into a prompt inserts a thumbnail rather than a base64 text dump.
    previewImg.addEventListener('dragstart', (e) => {
      if (!previewImg.src) return;
      e.dataTransfer.setData('text/swf-image-src', previewImg.src);
      e.dataTransfer.effectAllowed = 'copy';
    });
    el.querySelector('.swf-run-btn').addEventListener('click', async () => await executeSingleNode(node));
  }

  // Wire a contenteditable prompt editor with the rich-text behaviour shared by
  // node prompts and the group's 統一提示詞: placeholder + paste sanitize (enhance),
  // plus accepting image/prompt drops as clean inline thumbnails / text.
  function setupPromptEditor(promptEditor) {
    if (!promptEditor) return;
    if (window.EditorService && window.EditorService.enhanceRichEditor) {
      window.EditorService.enhanceRichEditor(promptEditor);
    } else if (window.RichTextService) {
      window.RichTextService.enhance(promptEditor);
    }
    promptEditor.addEventListener('dragover', (e) => {
      const t = e.dataTransfer.types;
      // Accept our custom image/prompt drags AND native image drags (files / URLs)
      // so the drop fires and we can convert them to a clean inline thumbnail
      // instead of letting the browser dump a base64 dataURL as plain text.
      if (t.includes('text/swf-image-src') || t.includes('text/swf-prompt') ||
          t.includes('Files') || t.includes('text/uri-list')) {
        e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
      }
    });
    promptEditor.addEventListener('drop', (e) => {
      const imgSrc = e.dataTransfer.getData('text/swf-image-src');
      const promptText = e.dataTransfer.getData('text/swf-prompt');
      if (imgSrc) {
        e.preventDefault(); promptEditor.focus();
        // 轉成 dataURL（並壓縮）後再插入，避免 blob: URL 被 Asset Manager 重繪 revoke 而破圖，
        // 同時壓縮以免內嵌圖撐爆 promptHTML 的 localStorage 配額
        blobUrlToDataUrl(imgSrc).then(compressForStore).then(dataUrl => {
          insertImageThumbIntoPrompt(promptEditor, dataUrl, imgSrc.split('/').pop().split('.')[0] || 'img');
        });
      } else if (e.dataTransfer.files && e.dataTransfer.files.length &&
                 Array.from(e.dataTransfer.files).some(f => f.type.startsWith('image/'))) {
        // Native OS image file drop
        e.preventDefault(); promptEditor.focus();
        const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'));
        window.StudioUtils.fileToDataURL(file).then(compressForStore).then(dataUrl => {
          insertImageThumbIntoPrompt(promptEditor, dataUrl, file.name.split('.')[0] || 'img');
        }).catch(() => {});
      } else if (!promptText) {
        // Native image-element drag (e.g. another app) exposes a URL — capture it
        // and block the default base64-text insertion.
        const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
        if (uri && /^(data:image\/|https?:|blob:)/.test(uri.trim())) {
          e.preventDefault(); promptEditor.focus();
          blobUrlToDataUrl(uri.trim()).then(compressForStore).then(dataUrl => {
            insertImageThumbIntoPrompt(promptEditor, dataUrl, 'img');
          }).catch(() => {});
        }
      }
      if (promptText) {
        e.preventDefault(); promptEditor.focus();
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(promptText));
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          promptEditor.textContent += promptText;
        }
        promptEditor.dispatchEvent(new Event('input'));
      }
    });
  }

  // Insert an image as a non-editable inline thumbnail tag into a prompt editor at
  // the current selection (or appended). Shared by all drop paths.
  function insertImageThumbIntoPrompt(promptEditor, dataUrl, assetName) {
    const tagSpan = document.createElement('span');
    tagSpan.className = 'editor-img-tag';
    tagSpan.contentEditable = 'false';
    // Show the thumbnail only — the underlying filename is a meaningless UUID, so
    // it's kept in alt (for accessibility/extraction) but never displayed as text.
    tagSpan.innerHTML = `<img src="${dataUrl}" class="inline-prompt-thumb" alt="${assetName || 'img'}">`;
    const sel = window.getSelection();
    let range = null;
    if (sel && sel.rangeCount > 0 && promptEditor.contains(sel.anchorNode)) {
      range = sel.getRangeAt(0); range.collapse(false);
    } else {
      range = document.createRange();
      range.selectNodeContents(promptEditor); range.collapse(false);
    }
    range.insertNode(tagSpan); range.setStartAfter(tagSpan); range.collapse(true);
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    // Range 插入不會觸發 input 事件，手動更新 placeholder 狀態
    if (window.RichTextService) window.RichTextService.updatePlaceholder(promptEditor);
  }

  // blob: URL 是暫時性的，Asset Manager grid 重繪（如 saveAsset 後）會 revokeObjectURL，
  // 因此不可存進 node 狀態。一律轉成持久的 base64 dataURL。
  // Thin alias over the shared util; kept so existing call sites read cleanly.
  // (Failure preserves the original src — ai-service still has a defensive guard.)
  function blobUrlToDataUrl(src) {
    return window.StudioUtils.blobUrlToDataURL(src);
  }

  function convertToPngBlob(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((pngBlob) => {
          if (pngBlob) resolve(pngBlob);
          else reject(new Error('Canvas toBlob failed'));
        }, 'image/png');
      };
      img.onerror = () => reject(new Error('Failed to load image for canvas conversion'));
      img.src = dataUrl;
    });
  }

  async function copyDataURLToClipboard(dataUrl) {
    window.__swfImageClipboard = dataUrl;
    try {
      const pngBlob = await convertToPngBlob(dataUrl);
      await navigator.clipboard.write([
        new ClipboardItem({
          [pngBlob.type]: pngBlob
        })
      ]);
      if (window.showToast) window.showToast('📋 已複製圖片至剪貼簿');
    } catch (err) {
      console.warn('Failed to copy image to system clipboard:', err);
      if (window.showToast) window.showToast('📋 已複製圖片 (僅限工作流內部貼上)');
    }
  }

  function wireParamInputs(node) {
    const area = node.el.querySelector('.swf-params-area'); if (!area) return;
    area.querySelectorAll('select[data-param]').forEach(inp => {
      inp.addEventListener('change', () => {
        node.data.params[inp.dataset.param] = inp.value;
        if (['fitMode', 'bg', 'stitchDir', 'stitchBg'].includes(inp.dataset.param)) updateImageProcessParamVisibility(area);
      });
      node.data.params[inp.dataset.param] = inp.value;
    });
    area.querySelectorAll('input[type="text"][data-param], textarea[data-param]').forEach(inp => {
      inp.addEventListener('input', () => { node.data.params[inp.dataset.param] = inp.value; });
      if (node.data.params[inp.dataset.param] !== undefined) {
        inp.value = node.data.params[inp.dataset.param];
      } else {
        node.data.params[inp.dataset.param] = inp.value;
      }
    });
    area.querySelectorAll('input[type="range"][data-param]').forEach(slider => {
      slider.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        const doUpdate = (ev) => {
          const rect = slider.getBoundingClientRect();
          const min = parseFloat(slider.min);
          const max = parseFloat(slider.max);
          const step = parseFloat(slider.step) || 1;
          const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
          let val = Math.round((min + ratio * (max - min)) / step) * step;
          val = Math.max(min, Math.min(max, parseFloat(val.toFixed(10))));
          slider.value = val;
          node.data.params[slider.dataset.param] = val;
          const valSpan = slider.nextElementSibling;
          if (valSpan && valSpan.classList.contains('swf-slider-val')) valSpan.textContent = val.toFixed(2);
        };
        doUpdate(e);
        const onMove = (ev) => doUpdate(ev);
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      node.data.params[slider.dataset.param] = parseFloat(slider.value);
    });
    area.querySelectorAll('input[type="checkbox"][data-param]').forEach(inp => {
      inp.addEventListener('change', () => { node.data.params[inp.dataset.param] = inp.checked; });
      if (node.data.params[inp.dataset.param] !== undefined) inp.checked = !!node.data.params[inp.dataset.param];
      else node.data.params[inp.dataset.param] = inp.checked;
    });
    area.querySelectorAll('input[type="color"][data-param]').forEach(inp => {
      inp.addEventListener('input', () => { node.data.params[inp.dataset.param] = inp.value; });
      if (node.data.params[inp.dataset.param] !== undefined) inp.value = node.data.params[inp.dataset.param];
      else node.data.params[inp.dataset.param] = inp.value;
    });
    applyModelModeUI(node);
    updateImageProcessParamVisibility(area);
  }

  // In 預處理 mode the node runs image processing (no AI prompt), so hide the prompt
  // section; the params area already shows the 圖像處理 controls via buildParamsHTML.
  function applyModelModeUI(node) {
    const isPre = node.data.model === 'preprocess';
    const promptSection = node.el.querySelector('.swf-prompt-section');
    if (promptSection) promptSection.style.display = isPre ? 'none' : '';
  }

  // Shrink an image dataURL for storage (<=1024px, JPEG) so saved workflows stay
  // under the localStorage quota. Falls back to the original on any failure.
  function compressForStore(dataUrl) {
    if (!window.AIService || !window.AIService.compressImage) return Promise.resolve(dataUrl);
    return window.AIService.compressImage(dataUrl, 1024, 0.82, 'image/jpeg').catch(() => dataUrl);
  }

  // Add a reference image to a node: compress, store, re-render. Single entry point
  // for all I2I image intake (upload / drop / asset) so nothing stores raw full-size
  // base64 (the cause of the swf_library quota error).
  async function addNodeImage(node, dataUrl) {
    const img = await compressForStore(dataUrl);
    node.data.images.push(img);
    node.data.uploadedImages.push(img);
    renderImageThumbs(node);
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
        if (window.__swfSelectedImage && window.__swfSelectedImage.nodeId === node.id && window.__swfSelectedImage.index === idx) {
          wrapper.classList.add('swf-img-thumb-selected');
        }
        wrapper.draggable = true;
        wrapper.dataset.imgIndex = idx;

        const img = document.createElement('img');
        img.className = 'swf-img-thumb'; img.src = src; img.draggable = false;

        // Determine if this is an uploaded image or upstream image
        const isUploaded = node.data.uploadedImages.includes(src);

        // Copy button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'swf-img-thumb-copy';
        copyBtn.title = '複製此圖片';
        copyBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 10px; height: 10px;">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        `;
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          copyDataURLToClipboard(src);
        });

        // Delete button
        const delBtn = document.createElement('button');
        delBtn.className = 'swf-img-thumb-del';
        delBtn.textContent = '✕';
        delBtn.title = isUploaded ? '刪除此圖片' : '排除此上游圖片';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          saveUndoState();
          if (window.__swfSelectedImage && window.__swfSelectedImage.nodeId === node.id && window.__swfSelectedImage.index === idx) {
            window.__swfSelectedImage = null;
          }
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
        wrapper.appendChild(copyBtn);
        wrapper.appendChild(delBtn);

        // Selection click
        wrapper.addEventListener('click', (e) => {
          e.stopPropagation();
          document.querySelectorAll('.swf-selected').forEach(el => el.classList.remove('swf-selected'));
          selectedEntityId = null;

          document.querySelectorAll('.swf-img-thumb-selected').forEach(el => el.classList.remove('swf-img-thumb-selected'));
          wrapper.classList.add('swf-img-thumb-selected');
          window.__swfSelectedImage = { nodeId: node.id, index: idx, src: src };
        });

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
            addEdge(window.__swfTempEdge.sourceNodeId, entityId, true);
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
      addEdge(outId, entityId, true);
      activeOutPort.classList.remove('swf-port-active'); activeOutPort = null;
    }
  }

  canvas.addEventListener('click', (e) => {
    if (activeOutPort && !e.target.classList.contains('swf-port') && !e.target.classList.contains('swf-group-port')) {
      activeOutPort.classList.remove('swf-port-active'); activeOutPort = null;
    }
    // Clear reference image selection when clicking elsewhere on the canvas
    document.querySelectorAll('.swf-img-thumb-selected').forEach(el => el.classList.remove('swf-img-thumb-selected'));
    window.__swfSelectedImage = null;
  });

  function addEdge(source, target, recordUndo = false) {
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
    // Snapshot once, only for user-initiated connects that actually add an edge
    // (internal callers — duplicate/load — pass recordUndo=false).
    if (recordUndo) saveUndoState();
    edges.push({ id: `e_${source}_${target}`, source, target });
    scheduleEdgeRender();
    propagateVisualImages();
  }

  function removeEdge(edgeId) {
    const idx = edges.findIndex(e => e.id === edgeId);
    if (idx >= 0) { saveUndoState(); edges.splice(idx, 1); }
    scheduleEdgeRender();
    propagateVisualImages();
  }

  /** Visually propagate all images downwards to instantly update node thumbnails when edges change */
  // Compute a node's active upstream reference images, accounting for group
  // membership. An entry node of a group also receives the group's incoming
  // images (per the group's upstream mode) — these arrive via the group's port,
  // not a direct edge to the node, so callers that only inspect direct edges miss
  // them. Node-level exclusions are applied. Returns an ordered list (caller
  // de-dupes via Set merge). Shared by propagateVisualImages and executeSingleNode
  // so a standalone re-run of a group member keeps the same upstream references.
  function collectNodeUpstreamContribs(node) {
    const nid = node.id;
    let groupId = null;
    for (const gid in groups) {
      if (getGroupMembers(gid).some(m => m.id === nid)) { groupId = gid; break; }
    }
    const memberIds = groupId ? new Set(getGroupMembers(groupId).map(m => m.id)) : new Set();

    const contribs = [];
    // Direct edges to this node (external sources and internal member edges),
    // visited in priority order. Each source contributes at its own priority.
    sortedUpstreamEdges(nid).forEach(({ e }) => {
      contribs.push({ priority: srcPriority(e.source), images: getSourceOutputImages(e.source) });
    });

    // Entry node of a group also receives the group's incoming images.
    if (groupId) {
      const g = groups[groupId];
      const isEntry = !edges.some(e => e.target === nid && memberIds.has(e.source));
      if (isEntry && g) {
        // Feed images from group's import folder if configured
        if (g.importFolder && g._folderBlobUrls && g._folderBlobUrls.length > 0) {
          contribs.push({ priority: g.receivePriority ?? 1, images: g._folderBlobUrls });
        }
        if (g.receiveUpstream) {
        if (g.upstreamMode === 'ordered') {
          const entryNodes = getGroupEntryNodes(groupId);
          const nodeIndex = entryNodes.findIndex(m => m.id === nid);
          sortedUpstreamEdges(groupId).forEach(({ e: srcEdge }) => {
            if (isGroup(srcEdge.source)) {
              const exitNodes = getGroupExitNodes(srcEdge.source);
              if (nodeIndex >= 0 && nodeIndex < exitNodes.length) {
                contribs.push({ priority: srcPriority(srcEdge.source),
                  images: (exitNodes[nodeIndex].resultImages || []).filter(img => !g.excludedImages.includes(img)) });
              }
            } else if (nodeIndex === 0) {
              contribs.push({ priority: srcPriority(srcEdge.source),
                images: getSourceOutputImages(srcEdge.source).filter(img => !g.excludedImages.includes(img)) });
            }
          });
        } else {
          sortedUpstreamEdges(groupId).forEach(({ e }) => {
            contribs.push({ priority: srcPriority(e.source),
              images: getSourceOutputImages(e.source).filter(img => !g.excludedImages.includes(img)) });
          });
        }
      }
    }
  }

    return contribs;
  }

  function propagateVisualImages() {
    for (const nid in nodes) {
      const n = nodes[nid];
      // Group-aware, priority-ordered assembly (entry nodes also receive group images).
      n.data.images = assembleNodeImages(n, collectNodeUpstreamContribs(n));
      renderImageThumbs(n);
    }

    // Also refresh any open group sidebars and collapsed groups' completed-image strips
    for (const gid in groups) {
      if (groups[gid].sidebarOpen) renderGroupSidebar(groups[gid]);
      if (groups[gid].collapsed) renderCollapsedGroupThumbs(groups[gid]);
    }
  }

  async function resolveGroupFolderImages() {
    if (!window.AssetManager || !window.AssetManager.isConnected()) return;
    for (const gid in groups) {
      const g = groups[gid];
      if (g.importFolder && g.importFolder !== '') {
        const files = window.AssetManager.getImagesInFolder(g.importFolder);
        
        // Revoke old folder blob URLs to prevent memory leaks
        if (g._folderBlobUrls && g._folderBlobUrls.length > 0) {
          g._folderBlobUrls.forEach(url => {
            try { URL.revokeObjectURL(url); } catch(e){}
          });
        }
        
        const urls = [];
        for (const file of files) {
          const url = await window.AssetManager.getFileBlobUrlByPath(file.path);
          if (url) urls.push(url);
        }
        g._folderBlobUrls = urls;
      } else {
        if (g._folderBlobUrls && g._folderBlobUrls.length > 0) {
          g._folderBlobUrls.forEach(url => {
            try { URL.revokeObjectURL(url); } catch(e){}
          });
        }
        g._folderBlobUrls = [];
      }
    }
    propagateVisualImages();
  }

  function renderEdges() {
    const wrapperRect = zoomWrapper.getBoundingClientRect();
    let html = '';
    const isNodeHidden = (id) => !isGroup(id) && nodes[id] && nodes[id].el.style.display === 'none';
    edges.forEach(edge => {
      // Skip edges touching nodes hidden inside a collapsed group.
      if (isNodeHidden(edge.source) || isNodeHidden(edge.target)) return;
      const sp = getPortEl(edge.source, 'out'), tp = getPortEl(edge.target, 'in');
      if (!sp || !tp) return;
      const r1 = sp.getBoundingClientRect(), r2 = tp.getBoundingClientRect();
      const x1 = (r1.left - wrapperRect.left + r1.width / 2) / zoomLevel;
      const y1 = (r1.top - wrapperRect.top + r1.height / 2) / zoomLevel;
      const x2 = (r2.left - wrapperRect.left + r2.width / 2) / zoomLevel;
      const y2 = (r2.top - wrapperRect.top + r2.height / 2) / zoomLevel;
      const offset = Math.max(Math.abs(x2 - x1) * 0.4, 60);
      const isGroupEdge = isGroup(edge.source) || isGroup(edge.target);
      const color = isGroupEdge ? 'var(--group-edge-color, rgba(34,211,238,0.7))' : 'var(--node-edge-color, #a0a0a0)';
      // Thinner lines; scale down when zoomed out (Math.max(zoomLevel,1)) so they don't
      // dominate the overview, but stay a constant readable width once zoomed in.
      const sw = (isGroupEdge ? 2 : 1.5) / Math.max(zoomLevel, 1);
      const d = `M ${x1} ${y1} C ${x1 + offset} ${y1}, ${x2 - offset} ${y2}, ${x2} ${y2}`;
      // Wide transparent hit area (easy to double-click) + thin visible line on top.
      const hitSw = Math.max(18 / zoomLevel, sw);
      html += `<path d="${d}" fill="none" stroke="transparent" stroke-width="${hitSw}" stroke-linecap="round"
        data-edge-id="${edge.id}" style="pointer-events:stroke; cursor:pointer;" />`;
      html += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"
        style="pointer-events:none;" />`;
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
          fill="none" stroke="#4ade80" stroke-width="${2 / Math.max(zoomLevel, 1)}" stroke-dasharray="${6/zoomLevel},${4/zoomLevel}" stroke-linecap="round" />`;
      }
    }

    edgesSvg.innerHTML = html;
    edgesSvg.querySelectorAll('path[data-edge-id]').forEach(p => {
      p.addEventListener('dblclick', () => removeEdge(p.dataset.edgeId));
    });

    updateGroupNumbers();
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

  // Copy a node's current visual/operational state (collapse, width, folder,
  // filename prefix/suffix, overwrite, per-section collapse) onto a freshly
  // created duplicate. Shared by duplicateNode and duplicateGroup so both
  // copy paths stay in sync. Does NOT copy prompt/model/params/images — those
  // are handled by the callers.
  function copyNodeState(srcNode, newNode) {
    // Collapse state
    newNode.isCollapsed = srcNode.isCollapsed;
    newNode.el.classList.toggle('swf-collapsed', !!newNode.isCollapsed);

    // Width
    if (srcNode.width) {
      newNode.width = srcNode.width;
      newNode.el.style.width = newNode.width + 'px';
    }

    // Save folder / filename prefix-suffix / overwrite
    newNode.data.namePrefix = srcNode.data.namePrefix || '';
    newNode.data.nameSuffix = srcNode.data.nameSuffix || '';
    newNode.data.overwrite = srcNode.data.overwrite === true;
    const srcFolder = srcNode.el.querySelector('.swf-node-folder');
    const dstFolder = newNode.el.querySelector('.swf-node-folder');
    if (srcFolder && dstFolder) dstFolder.value = srcFolder.value;
    const dstOverwrite = newNode.el.querySelector('.swf-overwrite-cb');
    if (dstOverwrite) dstOverwrite.checked = newNode.data.overwrite;

    // Per-section collapse state (prompt / reference-image sections)
    const srcSections = srcNode.el.querySelectorAll('.swf-section-label');
    const dstSections = newNode.el.querySelectorAll('.swf-section-label');
    srcSections.forEach((srcLabel, i) => {
      const dstLabel = dstSections[i];
      if (!dstLabel) return;
      const collapsed = srcLabel.parentElement.classList.contains('swf-section-collapsed');
      dstLabel.parentElement.classList.toggle('swf-section-collapsed', collapsed);
    });

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
    if (sp && tp) {
      tp.innerHTML = '';
      sp.childNodes.forEach(child => {
        const safe = sanitizePromptNode(child);
        if (safe) tp.appendChild(safe);
      });
      if (window.RichTextService) window.RichTextService.updatePlaceholder(tp);
    }
    copyNodeState(srcNode, newNode);
    renderImageThumbs(newNode);
  }

  // 複製提示詞內容時的白名單消毒：只保留文字、<br>、行容器與 inline 縮圖，
  // 其餘元素攤平成純文字，防止任意 HTML 被複製進新節點。
  function sanitizePromptNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    if (node.tagName === 'BR') return document.createElement('br');
    if (node.tagName === 'IMG' && node.classList.contains('inline-prompt-thumb')) {
      const img = document.createElement('img');
      img.src = node.src;
      img.className = 'inline-prompt-thumb';
      img.draggable = false;
      return img;
    }
    if (node.tagName === 'SPAN' && (node.classList.contains('editor-img-tag') || node.classList.contains('editor-color-tag'))) {
      return node.cloneNode(true);
    }
    if (node.tagName === 'DIV' || node.tagName === 'P' || node.tagName === 'SPAN') {
      const wrap = document.createElement(node.tagName === 'SPAN' ? 'span' : 'div');
      node.childNodes.forEach(c => {
        const safe = sanitizePromptNode(c);
        if (safe) wrap.appendChild(safe);
      });
      return wrap;
    }
    return document.createTextNode(node.textContent || '');
  }

  // ═══════════════════════════════════════════
  // ── EXECUTION ENGINE (Topological Sort) ──
  // ═══════════════════════════════════════════
  function extractPromptData(node) {
    const editor = node.el.querySelector('.swf-prompt-editor');
    if (!editor) return { text: '', inlineImages: [] };
    let text = ''; const inlineImages = [];
    
    function traverse(el) {
      el.childNodes.forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) text += child.textContent;
        else if (child.nodeType === Node.ELEMENT_NODE) {
          if (child.tagName === 'IMG' && child.classList.contains('inline-prompt-thumb')) {
            inlineImages.push(child.src);
          } else if (child.classList.contains('editor-img-tag')) {
            const img = child.querySelector('img');
            if (img) inlineImages.push(img.src);
          } else if (child.tagName === 'BR') {
            text += '\n';
          } else {
            traverse(child);
          }
        }
      });
    }
    traverse(editor);
    
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

    // Propagate upstream images (skip if called from group execution where images are pre-set).
    // Priority-ordered assembly so a standalone re-run keeps the same ordering as propagate.
    if (!skipImageReset) {
      node.data.images = assembleNodeImages(node, collectNodeUpstreamContribs(node));
    }
    renderImageThumbs(node);

    try {
      const { text, inlineImages } = extractPromptData(node);
      const model = node.data.model || 'nanobanana2';
      const params = node.data.params || {};

      if (!text.trim() && model !== 'comfyui' && model !== 'preprocess') throw new Error('提示詞不能為空');

      // Use unified images array directly — order is exactly what user sees
      const allRefs = [...node.data.images, ...inlineImages];
      let imageUrl = '';
      let preprocessResults = null; // 預處理 mode may produce multiple outputs (e.g. refcrop)

      if (model === 'preprocess') {
        // 預處理: run the 圖像處理 script on every incoming image (upstream + uploaded)
        // instead of AI generation. No prompt, no API.
        if (!window.ImageProcess?.processImageInMemory) throw new Error('圖像處理模組尚未載入');
        if (allRefs.length === 0) throw new Error('預處理需要輸入圖片（請從上游連線或上傳參考圖）');
        const cfg = {
          fitMode: params.fitMode || 'contain',
          resolution: params.resolution || '1024',
          align: params.align || 'center',
          bg: params.bg || '#FFFFFF',
          bgPicker: params.bgPicker || '#FFFFFF',
          cropRefLine: params.cropRefLine || 'crosshair',
          stitchDir: params.stitchDir || 'horizontal',
          stitchGap: params.stitchGap || 0,
          stitchAlign: params.stitchAlign || 'center',
          stitchSize: params.stitchSize || 'original',
          stitchBg: params.stitchBg || '#FFFFFF',
          stitchBgPicker: params.stitchBgPicker || '#FFFFFF',
          stitchGridCols: params.stitchGridCols || 2,
        };
        if (cfg.fitMode === 'stitch') {
          if (!window.ImageProcess?.stitchImagesFromUrls) throw new Error('拼合功能尚未載入');
          if (allRefs.length < 2) throw new Error('拼合需要至少 2 張輸入圖片');
          const stitchedUrl = await window.ImageProcess.stitchImagesFromUrls(allRefs, cfg);
          preprocessResults = [stitchedUrl];
          imageUrl = stitchedUrl;
        } else {
          const processed = [];
          for (const src of allRefs) {
            const outs = await window.ImageProcess.processImageInMemory(src, cfg);
            if (Array.isArray(outs)) processed.push(...outs);
          }
          if (!processed.length) throw new Error('預處理未產生結果');
          preprocessResults = processed;
          imageUrl = processed[0];
        }
      } else if (model === 'comfyui') {
        const serverUrl = params.serverUrl || 'http://127.0.0.1:8188';
        const cleanUrl = serverUrl.trim().replace(/\/+$/, '');
        const workflowJsonStr = params.workflowJson || '';
        const positivePromptNodeId = params.positivePromptNodeId || '';
        const outputNodeId = params.outputNodeId || '';
        const inputNodeIdsStr = params.inputNodeIds || '';

        if (!workflowJsonStr.trim()) throw new Error('API 工作流 JSON 不能為空');
        if (!outputNodeId.trim()) throw new Error('輸出節點 ID 不能為空');

        let workflowJson;
        try {
          workflowJson = JSON.parse(workflowJsonStr);
        } catch (e) {
          throw new Error('API 工作流 JSON 格式錯誤：' + e.message);
        }

        placeholder.textContent = `Uploading references...`;

        if (!window.__swfComfyUploadCache) {
          window.__swfComfyUploadCache = {};
        }

        const uploadImageToComfy = async (dataUrl, index) => {
          const cacheKey = dataUrl.substring(0, 100) + '_' + dataUrl.length;
          if (window.__swfComfyUploadCache[cacheKey]) {
            return window.__swfComfyUploadCache[cacheKey];
          }
          try {
            const res = await fetch(dataUrl);
            const blob = await res.blob();
            const formData = new FormData();
            formData.append('image', blob, `swf_input_${Date.now()}_${index}_${Math.floor(Math.random()*1000)}.png`);
            formData.append('overwrite', 'true');

            const uploadRes = await fetch(`${cleanUrl}/upload/image`, {
              method: 'POST',
              body: formData
            });
            if (!uploadRes.ok) {
              const errTxt = await uploadRes.text().catch(() => '');
              throw new Error(`上傳失敗: ${uploadRes.statusText} ${errTxt}`);
            }
            const uploadData = await uploadRes.json();
            window.__swfComfyUploadCache[cacheKey] = uploadData.name;
            return uploadData.name;
          } catch (err) {
            throw new Error(`上傳圖片到 ComfyUI 失敗 (請確認 ComfyUI 開啟了 CORS --enable-cors-header): ${err.message}`);
          }
        };

        const inputNodeIds = inputNodeIdsStr.split(',').map(s => s.trim()).filter(Boolean);
        const limit = Math.min(allRefs.length, inputNodeIds.length);
        for (let i = 0; i < limit; i++) {
          const nodeId = inputNodeIds[i];
          const filename = await uploadImageToComfy(allRefs[i], i);
          if (workflowJson[nodeId]) {
            if (!workflowJson[nodeId].inputs) workflowJson[nodeId].inputs = {};
            workflowJson[nodeId].inputs.image = filename;
          }
        }

        if (positivePromptNodeId.trim() && text.trim()) {
          const promptNodeId = positivePromptNodeId.trim();
          if (workflowJson[promptNodeId]) {
            if (!workflowJson[promptNodeId].inputs) workflowJson[promptNodeId].inputs = {};
            workflowJson[promptNodeId].inputs.text = text;
          }
        }

        const clientId = window.crypto?.randomUUID ? window.crypto.randomUUID() : Math.random().toString(36).substring(2);

        placeholder.textContent = `Queueing workflow...`;
        let promptId = '';
        try {
          const promptRes = await fetch(`${cleanUrl}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: workflowJson,
              client_id: clientId
            })
          });
          if (!promptRes.ok) {
            const errTxt = await promptRes.text().catch(() => '');
            throw new Error(`${promptRes.statusText} ${errTxt}`);
          }
          const promptData = await promptRes.json();
          promptId = promptData.prompt_id;
        } catch (err) {
          throw new Error(`ComfyUI 連線排程失敗 (請確認 ComfyUI 開啟了 CORS --enable-cors-header): ${err.message}`);
        }

        placeholder.textContent = `Generating... (${secs}s) - 佇列中`;

        imageUrl = await new Promise((resolve, reject) => {
          let ws;
          let pollInterval;
          let isDone = false;

          const cleanUp = () => {
            isDone = true;
            if (ws) {
              try { ws.close(); } catch(e){}
            }
            if (pollInterval) {
              clearInterval(pollInterval);
            }
          };

          try {
            const wsProtocol = cleanUrl.startsWith('https://') ? 'wss://' : 'ws://';
            const wsHost = cleanUrl.replace(/^https?:\/\//, '');
            ws = new WebSocket(`${wsProtocol}${wsHost}/ws?clientId=${clientId}`);
            
            ws.onmessage = async (event) => {
              try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'progress') {
                  const val = msg.data.value;
                  const max = msg.data.max;
                  placeholder.textContent = `Generating... (${secs}s) - 步數: ${val}/${max}`;
                }
                if (msg.type === 'executing') {
                  if (msg.data.node === null && msg.data.prompt_id === promptId) {
                    cleanUp();
                    fetchHistoryAndResolve();
                  } else if (msg.data.prompt_id === promptId) {
                    placeholder.textContent = `Generating... (${secs}s) - 執行節點: ${msg.data.node}`;
                  }
                }
                if (msg.type === 'execution_error' && msg.data.prompt_id === promptId) {
                  cleanUp();
                  reject(new Error(`ComfyUI 執行出錯: ${msg.data.exception_message || '未知錯誤'}`));
                }
              } catch (e) {
                console.warn('WS message parsing failed:', e);
              }
            };

            ws.onerror = (e) => {
              console.warn('ComfyUI WS connection error, falling back to HTTP Polling');
              startPolling();
            };

            ws.onclose = () => {
              if (!isDone) {
                console.warn('ComfyUI WS closed prematurely, falling back to HTTP Polling');
                startPolling();
              }
            };
          } catch (e) {
            console.warn('ComfyUI WS setup failed, falling back to HTTP Polling');
            startPolling();
          }

          function startPolling() {
            if (pollInterval) return;
            pollInterval = setInterval(async () => {
              try {
                const res = await fetch(`${cleanUrl}/history/${promptId}`);
                if (!res.ok) return;
                const history = await res.json();
                if (history && history[promptId]) {
                  cleanUp();
                  resolveHistoryImage(history[promptId]);
                }
              } catch (err) {
                console.warn('Polling history error:', err);
              }
            }, 1500);
          }

          async function fetchHistoryAndResolve() {
            try {
              const res = await fetch(`${cleanUrl}/history/${promptId}`);
              if (!res.ok) {
                const errTxt = await res.text().catch(() => '');
                reject(new Error(`取得歷史紀錄失敗: ${res.status} ${errTxt}`));
                return;
              }
              const history = await res.json();
              if (history && history[promptId]) {
                resolveHistoryImage(history[promptId]);
              } else {
                reject(new Error('未在 ComfyUI 歷史紀錄中找到該次執行的結果'));
              }
            } catch (err) {
              reject(err);
            }
          }

          async function resolveHistoryImage(promptHistory) {
            try {
              const outputs = promptHistory.outputs;
              if (!outputs || !outputs[outputNodeId]) {
                const available = Object.keys(outputs || {}).join(', ') || '無';
                reject(new Error(`找不到輸出節點 "${outputNodeId}"。該次執行產出的節點為: [${available}]，請確認節點對應設定是否正確。`));
                return;
              }
              const outputNode = outputs[outputNodeId];
              const images = outputNode.images;
              if (!images || images.length === 0) {
                reject(new Error(`節點 "${outputNodeId}" 的輸出圖片清單為空`));
                return;
              }

              const imgInfo = images[0];
              const viewUrl = `${cleanUrl}/view?filename=${encodeURIComponent(imgInfo.filename)}&subfolder=${encodeURIComponent(imgInfo.subfolder || '')}&type=${imgInfo.type || 'output'}`;
              
              const imgRes = await fetch(viewUrl);
              if (!imgRes.ok) {
                reject(new Error(`下載生成圖片失敗: ${imgRes.statusText}`));
                return;
              }
              const imgBlob = await imgRes.blob();
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = () => reject(new Error('讀取圖片 Blob 失敗'));
              reader.readAsDataURL(imgBlob);
            } catch (err) {
              reject(err);
            }
          }
        });
      } else {
        const keyProvider = (model === 'gptimage') ? 'openai' : 'nanobanana';
        const keyMode = window.StudioSettings?.getKeyMode?.(keyProvider) || 'single';
        // single / round-robin → one active key (rotation handled inside the getter);
        // failover → try every key in priority order until one succeeds.
        let attemptKeys;
        if (keyMode === 'failover') {
          attemptKeys = window.StudioSettings?.getApiKeys?.(keyProvider) || [];
        } else {
          const active = (model === 'gptimage')
            ? window.StudioSettings?.getOpenAIKey?.()
            : window.StudioSettings?.getNanobananaKey?.();
          attemptKeys = active ? [active] : [];
        }
        if (!attemptKeys.length) throw new Error('API Key 尚未設定 (' + model + ')');

        const genOnce = async (apiKey) => {
          if (model === 'gptimage') {
            return await window.AIService.generateWithGPTImage(text, apiKey, params.gptImageSize || '1024x1024', allRefs.length > 0 ? allRefs : null, {
              quality: params.quality || 'low', background: params.gptBackground || 'auto', input_fidelity: params.gptFidelity || 'high'
            });
          } else if (model === 'nanobanana2') {
            return await window.AIService.generateWithNanoBanana2(text, apiKey, allRefs.length > 0 ? allRefs : null, null, {
              aspectRatio: params.aspectRatio || '1:1', imageSize: params.imageSize || '', temperature: params.temperature ?? 0.4,
              thinkingLevel: params.thinkingLevel || 'none',
            });
          } else {
            return await window.AIService.generateWithNanoBanana(text, apiKey, {
              aspectRatio: params.aspectRatio || '1:1', imageSize: params.imageSize || '', temperature: params.temperature ?? 0.4,
              thinkingLevel: params.thinkingLevel || 'none',
            });
          }
        };

        // Try keys in order; on failure, fall back to the next (failover mode).
        let lastErr = null;
        for (let ki = 0; ki < attemptKeys.length; ki++) {
          try {
            imageUrl = await genOnce(attemptKeys[ki]);
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            if (ki < attemptKeys.length - 1 && window.showToast) {
              window.showToast(`⚠️ 金鑰 ${ki + 1} 失敗，改用金鑰 ${ki + 2}…`, 2000);
            }
          }
        }
        if (lastErr) throw lastErr;
      }

      // Post-generation automation: if this node belongs to a group with a bound
      // "完成後自動化" script, transform the freshly generated image in-memory NOW —
      // before it is displayed / propagated / saved — so the node's own save path
      // stays the single save location (the script's output folder is ignored).
      let savedImages = preprocessResults || [imageUrl];
      // 預處理 already IS the image-processing step — don't re-apply 完成後自動化 on top.
      const autoCfg = (model === 'preprocess') ? null : getNodePostAutomationConfig(node);
      if (autoCfg && window.ImageProcess?.processImageInMemory) {
        try {
          const results = await window.ImageProcess.processImageInMemory(imageUrl, autoCfg);
          if (Array.isArray(results) && results.length) savedImages = results;
        } catch (e) {
          console.error('Post-automation failed:', e);
          if (window.showToast) window.showToast('⚠️ 完成後自動化失敗，存原圖：' + e.message, 3000);
        }
      }

      imgEl.src = savedImages[0]; imgEl.style.display = 'block';
      placeholder.style.display = 'none'; dlBtn.style.display = 'block';
      node.resultImages = [...savedImages];

      let targetFolder = '';
      const nodeInput = node.el.querySelector('.swf-node-folder');
      if (nodeInput && nodeInput.value.trim()) {
        targetFolder = nodeInput.value.trim();
      } else {
        // Inherit from parent group if exists
        let parentGroup = null;
        for (const gid in groups) {
          const g = groups[gid];
          if (node.x >= g.x && node.y >= g.y && node.x + node.width <= g.x + g.width && node.y + node.el.offsetHeight <= g.y + g.height) {
            parentGroup = g; break;
          }
        }
        if (parentGroup) {
          const groupInput = parentGroup.el.querySelector('.swf-group-folder');
          if (groupInput && groupInput.value.trim()) {
            targetFolder = groupInput.value.trim();
          }
        }
      }
      if (!targetFolder || targetFolder === '已完成') targetFolder = '根目錄';

      // Filename: slot-based on the node's group number (re-run overwrites its
      // own slot), with a configurable prefix + suffix (per-node, else the global default).
      const num = getNodeGroupNumber(node);
      const prefix = (node.data.namePrefix || '').trim()
                  || (window.StudioSettings?.getFilenamePattern?.() || '');
      const suffix = (node.data.nameSuffix || '').trim();
      const baseName = (num != null)
        ? `${prefix}${num}${suffix}`
        : `${prefix || 'SWF'}_${Date.now()}${suffix}`;
      if (window.AssetManager) {
        // When automation produced multiple parts (e.g. refcrop), suffix each file _1.._N.
        for (let i = 0; i < savedImages.length; i++) {
          const outName = savedImages.length === 1 ? baseName : `${baseName}_${i + 1}`;
          await window.AssetManager.saveAsset(outName, savedImages[i], targetFolder, node.data.overwrite === true);
          window.dispatchEvent(new CustomEvent('node-saved-asset', {
            detail: { filename: outName, folder: targetFolder, node }
          }));
        }
      }
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

    const memberIds = new Set(members.map(m => m.id));

    // Topological sort within group — pass skipImageReset=true so group-assigned images aren't cleared
    const sorted = topoSort(members.map(m => m.id));
    for (const batch of sorted) {
      await Promise.all(batch.map(id => {
        const n = nodes[id];
        if (!n) return Promise.resolve();

        // Priority-ordered, group-aware assembly: direct/internal edges + the group's
        // distributed incoming images (per upstream mode), interleaved with the node's
        // own reference images at priority 0. Fresh member resultImages are read here
        // because earlier batches have already executed.
        n.data.images = assembleNodeImages(n, collectNodeUpstreamContribs(n));

        // Execute passing true for skipImageReset so it doesn't clear our carefully gathered images
        return executeSingleNode(n, true);
      }));
    }

    // Aggregate exit node results
    const exitNodes = members.filter(m => !edges.some(e => e.source === m.id && memberIds.has(e.target)));
    group.resultImages = [];
    exitNodes.forEach(n => { if (n.resultImages && n.resultImages.length > 0) group.resultImages.push(...n.resultImages); });

    group.el.classList.remove('swf-group-executing');
    if (group.collapsed) renderCollapsedGroupThumbs(group); // refresh completed-image strip
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
  // Replace heavy inline base64 image srcs with a 1x1 transparent placeholder, so
  // saved prompt HTML carries no image payload (keeps the tag wrapper + label intact).
  const BLANK_INLINE_IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  function stripInlineImageData(html) {
    return html.replace(/(<img\b[^>]*\bsrc=")data:[^"]*(")/gi, '$1' + BLANK_INLINE_IMG + '$2');
  }

  // forStorage=true drops all base64 image payloads so the serialized JSON stays
  // tiny for localStorage (saveWorkflow / autosave) — sidesteps the swf_library
  // quota error. In-memory undo/redo snapshots call with false to keep images.
  function serializeState(forStorage = false) {
    const nodesData = {};
    for (const id in nodes) {
      const n = nodes[id];
      const promptEl = n.el.querySelector('.swf-prompt-editor');
      const folderInput = n.el.querySelector('.swf-node-folder');
      const promptHTML = promptEl ? promptEl.innerHTML : '';
      nodesData[id] = {
        id: n.id, type: n.type, x: n.x, y: n.y,
        width: n.width, isCollapsed: n.isCollapsed, promptHeight: promptEl ? promptEl.offsetHeight : 0,
        model: n.data.model, params: { ...n.data.params },
        // For localStorage we drop every base64 image payload to dodge the quota
        // error: reference images, excluded-image lists, and inline prompt thumbs.
        uploadedImages: forStorage ? [] : [...n.data.uploadedImages],
        fsaPaths: { ...n.data.fsaPaths },
        excludedIncomingImages: forStorage ? [] : [...n.data.excludedIncomingImages],
        folder: folderInput ? folderInput.value : '',
        namePrefix: n.data.namePrefix || '',
        nameSuffix: n.data.nameSuffix || '',
        overwrite: n.data.overwrite === true,
        // Generated result images: kept for in-memory undo/redo snapshots so that
        // undoing an unrelated edit does NOT wipe already-generated images.
        // Dropped for localStorage (forStorage) to avoid the quota error.
        resultImages: forStorage ? [] : [...(n.resultImages || [])],
        promptHTML: forStorage ? stripInlineImageData(promptHTML) : promptHTML
      };
    }
    const groupsData = {};
    for (const id in groups) {
      const g = groups[id];
      const folderInput = g.el.querySelector('.swf-group-folder');
      const importFolderSelect = g.el.querySelector('.swf-group-import-folder');
      groupsData[id] = {
        id: g.id, x: g.x, y: g.y, width: g.width,
        // Persist the expanded height even when collapsed, so geometry/membership restore correctly.
        height: g.collapsed ? (g.expandedHeight || 320) : g.height, color: g.color, title: g.title,
        receiveUpstream: g.receiveUpstream, upstreamMode: g.upstreamMode || 'all', excludedImages: forStorage ? [] : [...g.excludedImages],
        receivePriority: g.receivePriority ?? 1, collapsed: !!g.collapsed, locked: !!g.locked,
        resultImages: forStorage ? [] : [...(g.resultImages || [])],
        postAutomationConfig: { ...(g.postAutomationConfig || {}) }, postAutomationEnabled: !!g.postAutomationEnabled,
        folder: folderInput ? folderInput.value : '',
        importFolder: importFolderSelect ? importFolderSelect.value : (g.importFolder || ''),
        sidebarWidth: g.sidebarWidth || null,
        paramsSidebarWidth: g.paramsSidebarWidth || null,
        automationSidebarWidth: g.automationSidebarWidth || null
      };
    }
    return { nodes: nodesData, groups: groupsData, edges: edges.map(e => ({ ...e })), panX, panY, zoomLevel, version: 3 };
  }

  function saveWorkflow() {
    const name = prompt('請輸入工作流名稱：', '未命名工作流');
    if (!name || !name.trim()) return;
    const cleanName = name.trim();

    try {
      const dataStr = JSON.stringify(serializeState(true));
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

  // Re-display a node's generated result image (preview + download button) from
  // node.resultImages. Used when restoring undo/redo snapshots so already-generated
  // images survive a restore instead of being wiped.
  function showNodeResultPreview(node) {
    const imgEl = node.el.querySelector('.swf-preview-img');
    const placeholder = node.el.querySelector('.swf-preview-placeholder');
    const dlBtn = node.el.querySelector('.swf-download-btn');
    if (!imgEl) return;
    if (node.resultImages && node.resultImages.length > 0) {
      imgEl.src = node.resultImages[0];
      imgEl.style.display = 'block';
      if (placeholder) placeholder.style.display = 'none';
      if (dlBtn) dlBtn.style.display = 'block';
    }
  }

  let isLoadingWorkflow = false;
  function loadWorkflowData(raw, isUndoRestore) {
    isLoadingWorkflow = true;
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
            g.upstreamMode = gd.upstreamMode || 'all';
            g.importFolder = gd.importFolder || '';
            g.excludedImages = Array.isArray(gd.excludedImages) ? [...gd.excludedImages] : [];
            g.receivePriority = gd.receivePriority ?? 1;
            g.postAutomationConfig = gd.postAutomationConfig || { fitMode: 'contain', resolution: '1024', align: 'center', bg: '#FFFFFF', bgPicker: '#FFFFFF', cropRefLine: 'crosshair' };
            g.postAutomationEnabled = !!gd.postAutomationEnabled;
            g.resultImages = Array.isArray(gd.resultImages) ? [...gd.resultImages] : [];
            if (gd.sidebarWidth) { g.sidebarWidth = gd.sidebarWidth; applyPanelWidth(g.el.querySelector('.swf-group-sidebar'), gd.sidebarWidth); }
            if (gd.paramsSidebarWidth) { g.paramsSidebarWidth = gd.paramsSidebarWidth; applyPanelWidth(g.el.querySelector('.swf-group-params-sidebar'), gd.paramsSidebarWidth); }
            if (gd.automationSidebarWidth) { g.automationSidebarWidth = gd.automationSidebarWidth; applyPanelWidth(g.el.querySelector('.swf-group-automation-sidebar'), gd.automationSidebarWidth); }
            const folderInput = g.el.querySelector('.swf-group-folder');
            if (folderInput) folderInput.value = gd.folder || '';
            
            const importFolderSelect = g.el.querySelector('.swf-group-import-folder');
            if (importFolderSelect) importFolderSelect.value = g.importFolder;
            
            // Sync checkbox + mode radio state
            const cb = g.el.querySelector('.swf-gs-receive-cb');
            if (cb) cb.checked = g.receiveUpstream;
            g.el.querySelectorAll('.swf-gs-mode-radio').forEach(r => { r.checked = r.value === g.upstreamMode; });
            const prioInput = g.el.querySelector('.swf-grp-priority');
            if (prioInput) prioInput.value = g.receivePriority;
            if (gd.collapsed) g._restoreCollapsed = true; // re-collapse after members exist
            if (gd.locked) g._restoreLocked = true; // re-lock after members exist
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
            }
            const promptEl = n.el.querySelector('.swf-prompt-editor');
            if (promptEl && nd.promptHeight) promptEl.style.height = nd.promptHeight + 'px';
            
            n.data.model = nd.model || 'nanobanana2';
            n.data.params = nd.params || {};
            // Restore v3 fields with backward compatibility
            n.data.uploadedImages = Array.isArray(nd.uploadedImages) ? [...nd.uploadedImages] : [];
            n.data.fsaPaths = nd.fsaPaths || {};
            n.data.excludedIncomingImages = Array.isArray(nd.excludedIncomingImages) ? [...nd.excludedIncomingImages] : [];
            
            // Re-populate initial images from uploadedImages
            n.data.images = [...n.data.uploadedImages];
            
            // Dynamic FSA Path resolution for blob URLs
            let fsaNeedsConnection = false;
            for (let i = 0; i < n.data.uploadedImages.length; i++) {
               const img = n.data.uploadedImages[i];
               if (img.startsWith('blob:') && n.data.fsaPaths[img]) {
                  const path = n.data.fsaPaths[img];
                  if (window.AssetManager && window.AssetManager.isConnected()) {
                     window.AssetManager.getFileBlobUrlByPath(path).then(newUrl => {
                        if (newUrl) {
                           const imgIdx = n.data.images.indexOf(n.data.uploadedImages[i]);
                           if (imgIdx !== -1) n.data.images[imgIdx] = newUrl;
                           n.data.uploadedImages[i] = newUrl;
                           delete n.data.fsaPaths[img];
                           n.data.fsaPaths[newUrl] = path;
                           renderImageThumbs(n);
                        }
                     }).catch(err => {
                        console.warn('FSA Path resolution failed', err);
                     });
                  } else {
                     fsaNeedsConnection = true;
                  }
               }
            }
            if (fsaNeedsConnection && window.showToast) {
               window.showToast('⚠️ 工具流包含本機影像，請先在資產庫「恢復連線」', 4000);
            }
            n.data.namePrefix = nd.namePrefix || '';
            n.data.nameSuffix = nd.nameSuffix || '';
            n.data.overwrite = nd.overwrite === true;
            const owCb = n.el.querySelector('.swf-overwrite-cb');
            if (owCb) owCb.checked = n.data.overwrite;
            n.el.querySelector('.swf-model-sel').value = n.data.model;
            const folderInput = n.el.querySelector('.swf-node-folder');
            if (folderInput) folderInput.value = nd.folder || '';
            n.el.querySelector('.swf-params-area').innerHTML = buildParamsHTML(n.data.model, n.data.params);
            wireParamInputs(n);
            if (nd.promptHTML) {
              const pEl = n.el.querySelector('.swf-prompt-editor');
              pEl.innerHTML = nd.promptHTML;
              if (window.RichTextService) window.RichTextService.updatePlaceholder(pEl);
            }
            // Restore generated result images + preview (in-memory undo/redo snapshots).
            n.resultImages = Array.isArray(nd.resultImages) ? [...nd.resultImages] : [];
            showNodeResultPreview(n);
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

      // Re-lock groups that were saved locked (snapshot geometric members now they exist,
      // BEFORE any re-collapse hides them).
      for (const gid in groups) {
        if (groups[gid]._restoreLocked) {
          delete groups[gid]._restoreLocked;
          groups[gid].locked = false; // toggle flips to true and snapshots members
          toggleGroupLock(groups[gid]);
        }
      }

      // Re-collapse groups that were saved collapsed (now that their members exist).
      for (const gid in groups) {
        if (groups[gid]._restoreCollapsed) {
          delete groups[gid]._restoreCollapsed;
          groups[gid].collapsed = false; // toggle will flip to true and snapshot members
          toggleGroupCollapse(groups[gid]);
        }
      }

      // Visually propagate
      propagateVisualImages();

      // Background sync for blob URLs (fixes broken localdir images on reload)
      (async () => {
        let changed = false;
        for (const id in nodes) {
           const n = nodes[id];
           for (let i = 0; i < n.data.uploadedImages.length; i++) {
              const img = n.data.uploadedImages[i];
              if (img && img.data && img.data.startsWith('blob:')) {
                 const newAsset = await window.AssetManager?.getAsset?.(img.id);
                 if (newAsset && newAsset.data) {
                    img.data = newAsset.data;
                    changed = true;
                 }
              }
           }
        }
        if (changed) propagateVisualImages();
      })();
    } catch (err) {
      console.error('Load failed:', err);
      if (window.showToast) window.showToast('❌ 讀取失敗：' + err.message);
    } finally {
      isLoadingWorkflow = false;
    }
  }

  // ==========================================
  // IDE Asset Left Panel V2 Integration
  // ==========================================
  
  // Expose this for other parts to refresh the dropdowns if needed
  window.renderSwfFoldersV2 = async function() {
    let paths = [];
    try {
      paths = await window.AssetManager?.getAllPaths?.() || ['根目錄', '已完成'];
    } catch(e) {
      paths = ['根目錄', '已完成'];
    }
    
    // Update all target dropdowns in nodes
    document.querySelectorAll('.swf-group-folder').forEach(sel => {
      const currentVal = sel.value;
      sel.innerHTML = '';
      paths.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        sel.appendChild(opt);
      });
      if (paths.includes(currentVal)) {
        sel.value = currentVal;
      }
    });
  };

  function setupSwfAssetPanel() {
    const btn = document.getElementById('swfAssetToggle');
    const panel = document.getElementById('swfLeftAssets');
    const closeBtn = document.getElementById('swfAssetClose');

    if (btn && panel) {
      btn.addEventListener('click', () => {
        const isHidden = panel.style.display === 'none';
        if (isHidden) {
          panel.style.display = 'flex';
          btn.classList.add('active');
          if (window.AssetManager) {
             window.AssetManager.refreshUI();
          }
        } else {
          panel.style.display = 'none';
          btn.classList.remove('active');
        }
      });
    }

    if (closeBtn && panel) {
      closeBtn.addEventListener('click', () => {
        panel.style.display = 'none';
        if (btn) btn.classList.remove('active');
      });
    }
  }

  // Setup asset panel on load
  setupSwfAssetPanel();

  // Resizer: drag to resize left asset pane
  (function setupAssetPaneResizer() {
    const resizer = document.getElementById('swfAssetResizer');
    const pane = document.getElementById('swfLeftAssets');
    if (!resizer || !pane) return;
    let startX, startW;
    resizer.addEventListener('mousedown', e => {
      startX = e.clientX;
      startW = pane.offsetWidth;
      resizer.classList.add('dragging');
      const onMove = e => {
        const w = Math.min(360, Math.max(160, startW + e.clientX - startX));
        pane.style.width = w + 'px';
      };
      const onUp = () => {
        resizer.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  })();

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
  // (Now handled by AssetManager V2 injected above)
  // ═══════════════════════════════════════════

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
      if (btnEl) {
        btnEl.classList.add('pinned');
        // Align popover with the clicked button
        const btnTop = btnEl.offsetTop;
        popover.style.top = btnTop + 'px';
      }
      
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
  document.getElementById('swfAddT2I')?.addEventListener('click', () => { saveUndoState(); createMacroNode('t2i'); });
  document.getElementById('swfAddI2I')?.addEventListener('click', () => { saveUndoState(); createMacroNode('i2i'); });
  document.getElementById('swfAddComfyUI')?.addEventListener('click', () => { saveUndoState(); createMacroNode('comfyui'); });
  document.getElementById('swfAddGroup')?.addEventListener('click', () => { saveUndoState(); createGroup(); });
  document.getElementById('swfRunAll')?.addEventListener('click', executeAll);
  document.getElementById('swfSaveBtn')?.addEventListener('click', saveWorkflow);
  document.getElementById('swfLoadBtn')?.addEventListener('click', loadWorkflow);

  // Toggle side panels (Left handled by setupSwfAssetPanel)
  // (Asset close handled by setupSwfAssetPanel)
  document.getElementById('swfPromptToggle')?.addEventListener('click', () => {
    const panel = document.getElementById('swfPromptQuickBar');
    if (panel) panel.classList.toggle('active');
  });

  // Clicking the canvas closes the prompt quickbar
  document.getElementById('swfCanvas')?.addEventListener('click', () => {
    document.getElementById('swfPromptQuickBar')?.classList.remove('active');
  });

  // Library (Load Workflow) Modal — close via ✕ or backdrop click (bound once here;
  // loadWorkflow() only wires the dynamic load/delete buttons).
  document.getElementById('swfLibModalCloseBtn')?.addEventListener('click', () => {
    document.getElementById('swfLibraryModal')?.classList.add('hidden');
  });
  document.getElementById('swfLibraryModal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });
  
  // ═══════════════════════════════════════════
  // ── DYNAMIC FOLDER SELECTS ──
  // ═══════════════════════════════════════════
  // <option> HTML for a node save-folder selector (also used by the unified-params
  // modal folder picker). Group-level folder was removed; folder is now set per node
  // via the 統一群組參數 modal, so the default ("") resolves to the root directory.
  function buildNodeFolderOptionsHTML(selected) {
    const paths = (window.AssetManager && window.AssetManager.getAllFolderPaths) ? window.AssetManager.getAllFolderPaths() : [];
    const opts = [{ v: '', l: '預設 (根目錄)' }, { v: '根目錄', l: '存至根目錄' }, ...paths.map(p => ({ v: p, l: p }))];
    return opts.map(o => `<option value="${o.v}" ${o.v === (selected || '') ? 'selected' : ''}>${o.l}</option>`).join('');
  }

  function updateSwfFolderSelects() {
    document.querySelectorAll('.swf-node-folder, .swf-gps-folder, .swf-group-import-folder').forEach(sel => {
      sel.innerHTML = buildNodeFolderOptionsHTML(sel.value);
    });
  }
  
  window.addEventListener('assets-tree-updated', () => {
    updateSwfFolderSelects();
    resolveGroupFolderImages();
  });

  // ═══════════════════════════════════════════
  // ── AUTO-SAVE & INIT ──
  // ═══════════════════════════════════════════
  let lastSavedStateStr = '';

  function triggerAutoSave() {
    try {
      const stateStr = JSON.stringify(serializeState(true));
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
        if (SWF_DEBUG) console.log('Loading auto-saved state...');
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

  // ── Auto-Revive Broken FSA Images on Restore ──
  window.addEventListener('assets-restored', () => {
    if (!window.AssetManager || !window.AssetManager.isConnected()) return;
    for (const id in nodes) {
      const n = nodes[id];
      if (!n.data.fsaPaths) continue;
      for (let i = 0; i < n.data.uploadedImages.length; i++) {
        const img = n.data.uploadedImages[i];
        if (img.startsWith('blob:') && n.data.fsaPaths[img]) {
          const path = n.data.fsaPaths[img];
          window.AssetManager.getFileBlobUrlByPath(path).then(newUrl => {
            if (newUrl) {
              const imgIdx = n.data.images.indexOf(n.data.uploadedImages[i]);
              if (imgIdx !== -1) n.data.images[imgIdx] = newUrl;
              n.data.uploadedImages[i] = newUrl;
              delete n.data.fsaPaths[img];
              n.data.fsaPaths[newUrl] = path;
              renderImageThumbs(n);
            }
          });
        }
      }
    }
  });

  // Expose API
  window.SimpleWorkflow = {
    createMacroNode, createGroup, executeAll, executeSingleNode, executeGroup,
    duplicateGroup,
    saveWorkflow, loadWorkflow,
    getNodes: () => nodes, getGroups: () => groups, getEdges: () => edges,
    renderSwfAssets, initSwfPromptQuickBar,
    propagateVisualImages, resolveGroupFolderImages
  };

})();
