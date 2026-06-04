(function() {
  const STORAGE_KEY = 'personal-studio-prompts';
  const CUSTOM_CAT_KEY = 'personal-studio-custom-categories';
  const CAT_ORDER_KEY = 'personal-studio-cat-order';

  // ── Dynamic category extraction from SYSTEM_PROMPT schema ──
  const SCHEMA_CATEGORY_MAP = {
    'creative_theme':         { label: '創作主題',                catClass: 'cat-pinned-theme' },
    'identity':               { label: '身分 (Identity)',          catClass: 'cat-identity' },
    'character_source':       { label: '角色出處 (Source)',        catClass: 'cat-identity' },
    'clothing_or_surface':    { label: '服裝 (Clothing)',          catClass: 'cat-clothing' },
    'pose_and_action':        { label: '姿勢 (Pose)',             catClass: 'cat-pose' },
    'foreground_fx':          { label: '前景 (Foreground)',        catClass: 'cat-foreground' },
    'midground_objects':      { label: '中景 (Midground)',        catClass: 'cat-midground' },
    'background_environment': { label: '背景 (Background)',       catClass: 'cat-background' },
    'main_visual_composition':{ label: '主視覺構圖 (Composition)', catClass: 'cat-custom' },
    'estimated_style':        { label: '風格 (Style)',            catClass: 'cat-style' },
    'mood_and_atmosphere':    { label: '氛圍 (Mood)',             catClass: 'cat-mood' },
    'lighting':               { label: '光影 (Lighting)',          catClass: 'cat-lighting' },
    'camera':                 { label: '攝影 (Camera)',           catClass: 'cat-camera' },
    'image_dimensions':       { label: '圖像尺寸 (Dimensions)',    catClass: 'cat-custom' },
    'material':               { label: '材質 (Material)',         catClass: 'cat-material' },
    'negative':               { label: '負面約束 (Negative)',      catClass: 'cat-negative' },
    'color_palette':          { label: '色盤 (Palette)',          catClass: 'cat-color_palette' },
    'other_elements':         { label: '其他元素 (Other)',        catClass: 'cat-other_elements' }
  };

  // Pinned categories always at top (not draggable)
  const PINNED_CATEGORIES = ['創作主題', '編輯模式'];

  function getDefaultCategories() {
    return Object.values(SCHEMA_CATEGORY_MAP)
      .map(v => v.label)
      .filter(label => !PINNED_CATEGORIES.includes(label));
  }

  function loadCustomCategories() {
    try {
      const raw = localStorage.getItem(CUSTOM_CAT_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  function saveCustomCategories(cats) {
    localStorage.setItem(CUSTOM_CAT_KEY, JSON.stringify(cats));
  }

  function loadCategoryOrder() {
    try {
      const raw = localStorage.getItem(CAT_ORDER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function saveCategoryOrder(order) {
    localStorage.setItem(CAT_ORDER_KEY, JSON.stringify(order));
  }

  // Build ordered list of all non-pinned categories
  function getOrderedCategories() {
    const defaults = getDefaultCategories();
    const custom = loadCustomCategories();
    const all = [...defaults, ...custom];
    const saved = loadCategoryOrder();
    if (saved && saved.length > 0) {
      // Use saved order, but also include any new categories not in saved
      const ordered = [];
      saved.forEach(c => { if (all.includes(c)) ordered.push(c); });
      all.forEach(c => { if (!ordered.includes(c)) ordered.push(c); });
      return ordered;
    }
    return all;
  }

  // Full category list: "全部" + pinned + ordered
  function getAllCategories() {
    return ['全部', ...PINNED_CATEGORIES, ...getOrderedCategories()];
  }

  function getCategoryOptions() {
    return [...PINNED_CATEGORIES, ...getOrderedCategories()];
  }

  function getCatClass(category) {
    for (const [, val] of Object.entries(SCHEMA_CATEGORY_MAP)) {
      if (val.label === category) return val.catClass;
    }
    if (PINNED_CATEGORIES.includes(category)) return 'cat-pinned-theme';
    return 'cat-custom';
  }

  function isCustomCategory(cat) {
    return loadCustomCategories().includes(cat);
  }

  function isPinned(cat) {
    return cat === '全部' || PINNED_CATEGORIES.includes(cat);
  }

  // ── Prompt data ──
  let prompts = [];
  let editingId = null;
  let activeCategory = '全部';
  let searchQuery = '';
  let modalThumbnail = null;
  let cropperInstance = null;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      prompts = raw ? JSON.parse(raw) : [];
    } catch {
      prompts = [];
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
  }

  function nextId() {
    return prompts.length ? Math.max(...prompts.map(p => p.id)) + 1 : 1;
  }

  function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function thumbnailHtml(thumb) {
    if (!thumb) return '';
    if (typeof thumb === 'object' && thumb.type === 'palette' && Array.isArray(thumb.colors)) {
      const swatches = thumb.colors
        .map(c => `<span class="prompt-card-swatch" style="background:${escHtml(String(c))}" title="${escHtml(String(c))}"></span>`)
        .join('');
      return `<div class="prompt-card-swatches">${swatches}</div>`;
    }
    if (typeof thumb === 'string') {
      return `<div class="prompt-card-thumbnail"><img src="${escHtml(thumb)}" alt="thumbnail" loading="lazy"></div>`;
    }
    return '';
  }

  // ── Render Sidebar ──
  function renderSidebar() {
    const sidebar = document.getElementById('categorySidebar');
    if (!sidebar) return;
    sidebar.innerHTML = '';

    const allCats = getAllCategories();

    allCats.forEach((cat, idx) => {
      // Add divider after pinned categories
      if (idx === 1 + PINNED_CATEGORIES.length) {
        const div = document.createElement('div');
        div.className = 'cat-sidebar-divider';
        sidebar.appendChild(div);
      }

      const item = document.createElement('div');
      item.className = 'cat-sidebar-item' + (cat === activeCategory ? ' active' : '');
      if (isPinned(cat)) item.classList.add('cat-pinned');

      // Count
      const count = cat === '全部' ? prompts.length : prompts.filter(p => p.category === cat).length;

      // Drag handle for non-pinned
      const dragHandle = isPinned(cat) ? '' : '<span class="cat-drag-handle">⠿</span>';

      item.innerHTML = `${dragHandle}<span class="cat-label">${escHtml(cat)}</span><span class="cat-count">${count}</span>`;

      // Click to filter
      item.addEventListener('click', () => {
        activeCategory = cat;
        renderSidebar();
        renderPromptRows();
      });

      // Drag & drop for reordering (non-pinned only)
      if (!isPinned(cat)) {
        item.draggable = true;
        item.dataset.cat = cat;

        item.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/cat-reorder', cat);
          e.dataTransfer.effectAllowed = 'move';
          item.classList.add('dragging');
        });
        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
          sidebar.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });
        item.addEventListener('dragover', (e) => {
          const data = e.dataTransfer.types;
          if (data.includes('text/cat-reorder')) {
            e.preventDefault();
            item.classList.add('drag-over');
          }
        });
        item.addEventListener('dragleave', () => {
          item.classList.remove('drag-over');
        });
        item.addEventListener('drop', (e) => {
          e.preventDefault();
          item.classList.remove('drag-over');
          const draggedCat = e.dataTransfer.getData('text/cat-reorder');
          if (draggedCat && draggedCat !== cat) {
            reorderCategory(draggedCat, cat);
          }
        });
      }

      sidebar.appendChild(item);
    });

    // Add "+ 新增分類" at bottom
    const addItem = document.createElement('div');
    addItem.className = 'cat-sidebar-add';
    addItem.textContent = '+ 新增分類';
    addItem.addEventListener('click', addCategory);
    sidebar.appendChild(addItem);
  }

  function reorderCategory(draggedCat, targetCat) {
    const ordered = getOrderedCategories();
    const fromIdx = ordered.indexOf(draggedCat);
    const toIdx = ordered.indexOf(targetCat);
    if (fromIdx === -1 || toIdx === -1) return;
    ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, draggedCat);
    saveCategoryOrder(ordered);
    renderSidebar();
  }

  // ── Render Prompt Rows (Grouped by Category, Horizontal Scroll) ──
  function renderPromptRows() {
    const container = document.getElementById('promptsRows');
    const empty = document.getElementById('promptsEmpty');
    if (!container) return;
    container.innerHTML = '';

    const q = searchQuery.toLowerCase();
    const filtered = prompts.filter(p => {
      const matchQ = !q || p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
      return matchQ;
    });

    if (filtered.length === 0) {
      if (empty) empty.classList.remove('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');

    // Determine which categories to show
    let catsToShow;
    if (activeCategory === '全部') {
      // Show all categories that have prompts
      const allCats = [...PINNED_CATEGORIES, ...getOrderedCategories()];
      // Deduplicate
      catsToShow = [...new Set(allCats)].filter(cat => filtered.some(p => p.category === cat));
    } else {
      catsToShow = [activeCategory];
    }

    if (catsToShow.length === 0 && activeCategory !== '全部') {
      // Show empty for this category
      if (empty) empty.classList.remove('hidden');
      return;
    }

    catsToShow.forEach(cat => {
      const catPrompts = filtered.filter(p => p.category === cat);
      if (catPrompts.length === 0) return;

      const group = document.createElement('div');
      group.className = 'prompt-row-group';

      const header = document.createElement('div');
      header.className = 'prompt-row-header';
      header.innerHTML = `<span class="prompt-row-label">${escHtml(cat)}</span><span class="prompt-row-count">(${catPrompts.length})</span>`;
      group.appendChild(header);

      const scroll = document.createElement('div');
      scroll.className = 'prompt-row-scroll';

      catPrompts.forEach((p, i) => {
        const card = document.createElement('div');
        card.className = 'prompt-card';
        card.style.animationDelay = `${i * 0.04}s`;
        card.draggable = true;
        card.dataset.promptId = p.id;

        const catCls = getCatClass(p.category);
        card.innerHTML = `
          <div class="prompt-card-header">
            <div class="prompt-card-title">${escHtml(p.title)}</div>
            <div class="prompt-card-actions">
              <button class="icon-btn copy-btn" title="複製" data-id="${p.id}">&#x2398;</button>
              <button class="icon-btn edit-btn" title="編輯" data-id="${p.id}">&#x270E;</button>
              <button class="icon-btn danger del-btn" title="刪除" data-id="${p.id}">&#x2715;</button>
            </div>
          </div>
          ${thumbnailHtml(p.thumbnail)}
          <span class="prompt-card-cat ${catCls}">${escHtml(p.category)}</span>
          <div class="prompt-card-text">${escHtml(p.content)}</div>
        `;

        // Drag to Forge
        card.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/prompt-id', String(p.id));
          e.dataTransfer.setData('text/plain', `${p.category}: "${p.content}"`);
          e.dataTransfer.effectAllowed = 'copy';
          card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => {
          card.classList.remove('dragging');
        });

        // Button handlers
        card.querySelector('.copy-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(`${p.category}: "${p.content}"`).then(() => showToast('已複製提示詞！'));
        });
        card.querySelector('.edit-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          openModal(p.id);
        });
        card.querySelector('.del-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          deletePrompt(p.id);
        });

        scroll.appendChild(card);
      });

      group.appendChild(scroll);
      container.appendChild(group);
    });
  }

  // ── Category Management ──
  function addCategory() {
    const name = prompt('請輸入新分類名稱：');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    const allCats = getAllCategories();
    if (allCats.includes(trimmed)) {
      showToast('此分類已存在');
      return;
    }
    const custom = loadCustomCategories();
    custom.push(trimmed);
    saveCustomCategories(custom);
    renderSidebar();
    populateCategorySelect();
    showToast(`已新增分類「${trimmed}」`);
  }

  function deleteCategory(cat) {
    if (!confirm(`確定刪除分類「${cat}」？該分類下的提示詞將被歸類至「其他元素 (Other)」。`)) return;
    const custom = loadCustomCategories().filter(c => c !== cat);
    saveCustomCategories(custom);
    prompts.forEach(p => { if (p.category === cat) p.category = '其他元素 (Other)'; });
    save();
    if (activeCategory === cat) activeCategory = '全部';
    renderSidebar();
    populateCategorySelect();
    renderPromptRows();
    showToast(`已刪除分類「${cat}」`);
  }

  function populateCategorySelect() {
    const select = document.getElementById('promptCategoryInput');
    if (!select) return;
    const options = getCategoryOptions();
    select.innerHTML = '';
    options.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      select.appendChild(opt);
    });
  }

  // ── Modal ──
  function openModal(id, prefill) {
    editingId = id || null;
    const modal = document.getElementById('promptModal');
    document.getElementById('modalTitle').textContent = id ? '編輯提示詞' : '新增提示詞';
    populateCategorySelect();

    if (id) {
      const p = prompts.find(x => x.id === id);
      document.getElementById('promptTitleInput').value = p.title;
      document.getElementById('promptCategoryInput').value = p.category;
      document.getElementById('promptContentInput').value = p.content;
      modalThumbnail = p.thumbnail || null;
    } else if (prefill) {
      document.getElementById('promptTitleInput').value = prefill.title || '';
      document.getElementById('promptCategoryInput').value = prefill.category || getCategoryOptions()[0];
      document.getElementById('promptContentInput').value = prefill.content || '';
      modalThumbnail = prefill.thumbnail || null;
    } else {
      document.getElementById('promptTitleInput').value = '';
      document.getElementById('promptCategoryInput').value = getCategoryOptions()[0];
      document.getElementById('promptContentInput').value = '';
      modalThumbnail = null;
    }
    renderModalThumbnail();
    modal.classList.remove('hidden');
    
    // Initialize rich editor if available
    if (window.EditorService) {
      window.EditorService.setupRichPromptEditor('promptContentInput');
      window.EditorService.setContent('promptContentInput', document.getElementById('promptContentInput').value);
    }
    
    document.getElementById('promptTitleInput').focus();
  }

  function destroyCropper() {
    if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
  }

  function closeModal() {
    document.getElementById('promptModal').classList.add('hidden');
    destroyCropper();
    editingId = null;
    modalThumbnail = null;
  }

  function renderModalThumbnail() {
    const wrap = document.getElementById('promptThumbPreview');
    if (!wrap) return;
    destroyCropper();
    if (!modalThumbnail) {
      wrap.classList.add('hidden');
      wrap.innerHTML = '';
      return;
    }
    wrap.classList.remove('hidden');
    if (typeof modalThumbnail === 'string') {
      wrap.innerHTML = `
        <label class="form-label">裁切縮略圖 (1:1)</label>
        <div class="cropper-wrap"><img id="cropperImg" src="${escHtml(modalThumbnail)}" alt="crop"></div>
        <button type="button" class="btn-ghost btn-sm" id="promptThumbClear">移除縮略圖</button>
      `;
      const img = document.getElementById('cropperImg');
      if (img && typeof Cropper !== 'undefined') {
        cropperInstance = new Cropper(img, {
          aspectRatio: 1, viewMode: 1, dragMode: 'move',
          guides: false, center: true, background: false, autoCropArea: 0.8
        });
      }
    } else {
      wrap.innerHTML = `
        <label class="form-label">縮略圖預覽</label>
        ${thumbnailHtml(modalThumbnail)}
        <button type="button" class="btn-ghost btn-sm" id="promptThumbClear">移除縮略圖</button>
      `;
    }
    const clearBtn = document.getElementById('promptThumbClear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      modalThumbnail = null;
      renderModalThumbnail();
    });
  }

  function saveModal() {
    const title = document.getElementById('promptTitleInput').value.trim();
    const category = document.getElementById('promptCategoryInput').value;
    const content = document.getElementById('promptContentInput').value.trim();
    if (!title || !content) { showToast('請填寫標題與內容'); return; }

    let thumbToSave = modalThumbnail;
    if (cropperInstance) {
      const canvas = cropperInstance.getCroppedCanvas({ width: 320, height: 320 });
      if (canvas) thumbToSave = canvas.toDataURL('image/jpeg', 0.82);
    }

    if (editingId) {
      const p = prompts.find(x => x.id === editingId);
      if (p) { p.title = title; p.category = category; p.content = content; p.thumbnail = thumbToSave || null; }
    } else {
      prompts.unshift({ id: nextId(), title, category, content, thumbnail: thumbToSave || null });
    }
    save();
    closeModal();
    renderSidebar();
    renderPromptRows();
    showToast(editingId ? '已更新' : '已新增提示詞');
  }

  function deletePrompt(id) {
    if (!confirm('確定刪除此提示詞？')) return;
    prompts = prompts.filter(p => p.id !== id);
    save();
    renderSidebar();
    renderPromptRows();
    showToast('已刪除');
  }

  // ── Forge Logic ──
  function initForge() {
    const dropZone = document.getElementById('forgeDropZone');
    const textarea = document.getElementById('forgeTextarea');
    const clearBtn = document.getElementById('forgeClearBtn');
    const copyBtn = document.getElementById('forgeCopyBtn');
    const toNaturalBtn = document.getElementById('forgeToNaturalBtn');
    const toSdTagsBtn = document.getElementById('forgeToSdTagsBtn');

    if (!dropZone || !textarea) return;

    // Drop zone highlight
    dropZone.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/prompt-id') || e.dataTransfer.types.includes('text/plain')) {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      }
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const promptId = e.dataTransfer.getData('text/prompt-id');
      if (promptId) {
        const p = prompts.find(x => x.id === +promptId);
        if (p) {
          const current = textarea.value.trim();
          const droppedText = `${p.category}: "${p.content}"`;
          const newVal = current ? current + '\n\n' + droppedText : droppedText;
          textarea.value = newVal;
          if (window.EditorService) window.EditorService.setContent('forgeTextarea', newVal);
          showToast(`已加入「${p.title}」到熔爐`);
        }
      } else {
        const text = e.dataTransfer.getData('text/plain');
        if (text) {
          const current = textarea.value.trim();
          const newVal = current ? current + '\n\n' + text : text;
          textarea.value = newVal;
          if (window.EditorService) window.EditorService.setContent('forgeTextarea', newVal);
        }
      }
    });

    // Clear
    if (clearBtn) clearBtn.addEventListener('click', () => {
      textarea.value = '';
      if (window.EditorService) window.EditorService.setContent('forgeTextarea', '');
      showToast('熔爐已清空');
    });

    // Copy
    if (copyBtn) copyBtn.addEventListener('click', () => {
      if (!textarea.value.trim()) { showToast('熔爐為空'); return; }
      navigator.clipboard.writeText(textarea.value).then(() => showToast('已複製熔爐內容！'));
    });

    // Initialize rich editor for forge
    if (window.EditorService) {
      window.EditorService.setupRichPromptEditor('forgeTextarea');
      
      // Update forgeTextarea assignment to use setContent
      const originalDrop = dropZone.addEventListener;
      // We will handle setContent inside the drop handler directly since we need to update rich text
    }

    // Convert to Natural Language
    if (toNaturalBtn) toNaturalBtn.addEventListener('click', async () => {
      const text = textarea.value.trim();
      if (!text) { showToast('請先加入提示詞到熔爐'); return; }
      await forgeConvert(text, 'natural', toNaturalBtn);
    });

    // Convert to SD Tags
    if (toSdTagsBtn) toSdTagsBtn.addEventListener('click', async () => {
      const text = textarea.value.trim();
      if (!text) { showToast('請先加入提示詞到熔爐'); return; }
      await forgeConvert(text, 'sdtags', toSdTagsBtn);
    });
  }

  async function forgeConvert(text, mode, btn) {
    const textarea = document.getElementById('forgeTextarea');

    // Determine which AI to use
    const geminiKey = localStorage.getItem('ps_gemini_key');
    const openaiKey = localStorage.getItem('ps_openai_key');
    const activeModel = localStorage.getItem('ps_active_model') || 'gemini';

    let apiKey, modelName;
    if (activeModel.startsWith('openai') && openaiKey) {
      apiKey = openaiKey;
      modelName = activeModel;
    } else if (geminiKey) {
      apiKey = geminiKey;
      modelName = 'gemini';
    } else {
      showToast('請先在設定中配置 API 金鑰');
      return;
    }

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ 轉換中...';

    try {
      let result;
      if (mode === 'natural') {
        result = await window.AIService.rewriteToNaturalLanguage(text, apiKey, modelName);
      } else {
        // SD Tags conversion
        result = await convertToSdTags(text, apiKey, modelName);
      }
      textarea.value = result;
      showToast(mode === 'natural' ? '✅ 已轉換為自然語言' : '✅ 已轉換為 SD Tags');
    } catch (err) {
      console.error('Forge convert error:', err);
      showToast('❌ 轉換失敗：' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  async function convertToSdTags(text, apiKey, model) {
    const sdPrompt = `You are an expert Stable Diffusion / Danbooru tag engineer. Convert the following visual description into a clean, comma-separated list of Danbooru-style tags for Stable Diffusion.

RULES:
- Use lowercase English tags separated by commas.
- Include quality tags like "masterpiece, best quality" at the start.
- Include negative tags at the end prefixed with "--no".
- Use established Danbooru conventions (e.g., "1girl", "blue_eyes", "long_hair").
- Output ONLY the tag list, no explanation.

Text to convert:
${text}`;

    const OPENAI_MODELS = { 'openai': 'gpt-5.5', 'openai-54': 'gpt-5.4', 'openai-54mini': 'gpt-5.4-mini', 'openai-4o': 'gpt-4o' };
    const openaiModelId = OPENAI_MODELS[model];

    if (openaiModelId) {
      const url = 'https://api.openai.com/v1/chat/completions';
      const body = {
        model: openaiModelId,
        messages: [{ role: 'user', content: sdPrompt }],
        ...(openaiModelId === 'gpt-4o' && { temperature: 0.3 })
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error('API Error');
      const data = await res.json();
      return data.choices[0].message.content.trim();
    } else {
      const modelName = model === 'geminilite' ? 'gemini-2.5-flash-lite' : 'gemini-3.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{ role: 'user', parts: [{ text: sdPrompt }] }],
        generationConfig: { temperature: 0.3 }
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('API Error');
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text.trim() || '';
    }
  }

  // ── Event bindings ──
  document.getElementById('addPromptBtn').addEventListener('click', () => openModal(null));
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  document.getElementById('modalSave').addEventListener('click', saveModal);
  document.getElementById('promptModal').addEventListener('click', e => {
    if (e.target === document.getElementById('promptModal')) closeModal();
  });
  document.getElementById('promptSearch').addEventListener('input', e => {
    searchQuery = e.target.value;
    renderPromptRows();
  });

  // ── Public API for external modules (e.g., decode.js) ──
  window.PromptsService = {
    openAddModal: function(prefill) {
      if (window.switchPanel) window.switchPanel('prompts');
      setTimeout(() => openModal(null, prefill), 100);
    },
    getCategoryForSchemaKey: function(key) {
      const entry = SCHEMA_CATEGORY_MAP[key];
      return entry ? entry.label : null;
    },
    setModalPaletteColor: function(hexColor) {
      const modal = document.getElementById('promptModal');
      if (!modal || modal.classList.contains('hidden')) return;

      if (!modalThumbnail || typeof modalThumbnail !== 'object' || modalThumbnail.type !== 'palette') {
        modalThumbnail = { type: 'palette', colors: [] };
      }
      
      if (!modalThumbnail.colors.includes(hexColor)) {
        modalThumbnail.colors.push(hexColor);
      }
      renderModalThumbnail();
    }
  };

  // ── Init ──
  load();
  renderSidebar();
  renderPromptRows();
  initForge();
})();
