(function() {
  const STORAGE_KEY = 'personal-studio-prompts';
  const CUSTOM_CAT_KEY = 'personal-studio-custom-categories';

  // ── Dynamic category extraction from SYSTEM_PROMPT schema ──
  // Maps JSON keys from the AI response schema to human-readable category names
  const SCHEMA_CATEGORY_MAP = {
    'identity':               { label: '身分 (Identity)',          catClass: 'cat-identity' },
    'clothing_or_surface':    { label: '服裝 (Clothing)',          catClass: 'cat-clothing' },
    'pose_and_action':        { label: '姿勢 (Pose)',             catClass: 'cat-pose' },
    'foreground_fx':          { label: '前景 (Foreground)',        catClass: 'cat-foreground' },
    'midground_objects':      { label: '中景 (Midground)',        catClass: 'cat-midground' },
    'background_environment': { label: '背景 (Background)',       catClass: 'cat-background' },
    'estimated_style':        { label: '風格 (Style)',            catClass: 'cat-style' },
    'mood_and_atmosphere':    { label: '氛圍 (Mood)',             catClass: 'cat-mood' },
    'lighting':               { label: '光影 (Lighting)',          catClass: 'cat-lighting' },
    'camera':                 { label: '攝影 (Camera)',           catClass: 'cat-camera' },
    'material':               { label: '材質 (Material)',         catClass: 'cat-material' },
    'negative':               { label: '負面約束 (Negative)',      catClass: 'cat-negative' },
    'color_palette':          { label: '色盤 (Palette)',          catClass: 'cat-color_palette' },
    'other_elements':         { label: '其他元素 (Other)',        catClass: 'cat-other_elements' }
  };

  function getDefaultCategories() {
    // Start with schema-derived categories
    const cats = Object.values(SCHEMA_CATEGORY_MAP).map(v => v.label);
    return cats;
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

  function getAllCategories() {
    return ['全部', ...getDefaultCategories(), ...loadCustomCategories()];
  }

  function getCategoryOptions() {
    // All categories except '全部' for the select dropdown
    return [...getDefaultCategories(), ...loadCustomCategories()];
  }

  function getCatClass(category) {
    // Check schema map first
    for (const [, val] of Object.entries(SCHEMA_CATEGORY_MAP)) {
      if (val.label === category) return val.catClass;
    }
    // Custom categories
    return 'cat-custom';
  }

  function isCustomCategory(cat) {
    return loadCustomCategories().includes(cat);
  }

  // ── Prompt data ──
  let prompts = [];
  let editingId = null;
  let activeCategory = '全部';
  let searchQuery = '';
  let modalThumbnail = null; // thumbnail being edited in the open modal

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

  function render() {
    const grid = document.getElementById('promptsGrid');
    const empty = document.getElementById('promptsEmpty');
    const filtered = prompts.filter(p => {
      const matchCat = activeCategory === '全部' || p.category === activeCategory;
      const q = searchQuery.toLowerCase();
      const matchQ = !q || p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
      return matchCat && matchQ;
    });

    grid.innerHTML = '';
    if (!filtered.length) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    filtered.forEach(p => {
      const card = document.createElement('div');
      card.className = 'prompt-card';
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
      grid.appendChild(card);
    });

    grid.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = prompts.find(x => x.id === +btn.dataset.id);
        if (p) navigator.clipboard.writeText(p.content).then(() => showToast('已複製提示詞！'));
      });
    });
    grid.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openModal(+btn.dataset.id));
    });
    grid.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', () => deletePrompt(+btn.dataset.id));
    });
  }

  function renderChips() {
    const chips = document.getElementById('categoryChips');
    chips.innerHTML = '';
    const allCats = getAllCategories();

    allCats.forEach(cat => {
      const chip = document.createElement('div');
      chip.className = 'chip' + (cat === activeCategory ? ' active' : '');
      
      const label = document.createElement('span');
      label.textContent = cat;
      chip.appendChild(label);

      // Add delete button for custom categories
      if (isCustomCategory(cat)) {
        const del = document.createElement('button');
        del.className = 'chip-delete';
        del.innerHTML = '&#x2715;';
        del.title = '刪除此分類';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteCategory(cat);
        });
        chip.appendChild(del);
      }

      chip.addEventListener('click', () => {
        activeCategory = cat;
        renderChips();
        render();
      });
      chips.appendChild(chip);
    });

    // Add "+ 新增分類" chip
    const addChip = document.createElement('div');
    addChip.className = 'chip chip-add';
    addChip.textContent = '+ 新增分類';
    addChip.addEventListener('click', () => addCategory());
    chips.appendChild(addChip);
  }

  function addCategory() {
    const name = prompt('請輸入新分類名稱：');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();

    // Check for duplicates
    const allCats = getAllCategories();
    if (allCats.includes(trimmed)) {
      showToast('此分類已存在');
      return;
    }

    const custom = loadCustomCategories();
    custom.push(trimmed);
    saveCustomCategories(custom);
    renderChips();
    populateCategorySelect();
    showToast(`已新增分類「${trimmed}」`);
  }

  function deleteCategory(cat) {
    if (!confirm(`確定刪除分類「${cat}」？該分類下的提示詞將被歸類至「其他」。`)) return;
    const custom = loadCustomCategories().filter(c => c !== cat);
    saveCustomCategories(custom);

    // Reassign prompts in deleted category
    prompts.forEach(p => {
      if (p.category === cat) p.category = '其他';
    });
    save();

    if (activeCategory === cat) activeCategory = '全部';
    renderChips();
    populateCategorySelect();
    render();
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

  function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Render a card/modal thumbnail. Supports an image data-URL string or a
  // palette object { type: 'palette', colors: [...] } rendered as swatches.
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
    document.getElementById('promptTitleInput').focus();
  }

  function closeModal() {
    document.getElementById('promptModal').classList.add('hidden');
    editingId = null;
    modalThumbnail = null;
  }

  // Render the thumbnail preview area inside the modal (if present in DOM)
  function renderModalThumbnail() {
    const wrap = document.getElementById('promptThumbPreview');
    if (!wrap) return;
    if (!modalThumbnail) {
      wrap.classList.add('hidden');
      wrap.innerHTML = '';
      return;
    }
    wrap.classList.remove('hidden');
    wrap.innerHTML = `
      <label class="form-label">縮略圖預覽</label>
      ${thumbnailHtml(modalThumbnail)}
      <button type="button" class="btn-ghost btn-sm" id="promptThumbClear">移除縮略圖</button>
    `;
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
    if (editingId) {
      const p = prompts.find(x => x.id === editingId);
      if (p) { p.title = title; p.category = category; p.content = content; p.thumbnail = modalThumbnail || null; }
    } else {
      prompts.unshift({ id: nextId(), title, category, content, thumbnail: modalThumbnail || null });
    }
    save();
    closeModal();
    render();
    showToast(editingId ? '已更新' : '已新增提示詞');
  }

  function deletePrompt(id) {
    if (!confirm('確定刪除此提示詞？')) return;
    prompts = prompts.filter(p => p.id !== id);
    save();
    render();
    showToast('已刪除');
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
    render();
  });

  // ── Public API for external modules (e.g., decode.js) ──
  window.PromptsService = {
    openAddModal: function(prefill) {
      // Switch to prompts panel then open modal
      if (window.switchPanel) window.switchPanel('prompts');
      setTimeout(() => openModal(null, prefill), 100);
    },
    getCategoryForSchemaKey: function(key) {
      const entry = SCHEMA_CATEGORY_MAP[key];
      return entry ? entry.label : null;
    }
  };

  // ── Init ──
  load();
  renderChips();
  render();
})();
