(function() {
  const STORAGE_KEY = 'personal-studio-prompts';
  const CATEGORIES = ['全部', 'Midjourney', 'SD', 'General', 'Style', '其他'];
  const CAT_CLASS = { Midjourney: 'cat-mj', SD: 'cat-sd', General: 'cat-general', Style: 'cat-style', '其他': 'cat-other' };

  const SEED_PROMPTS = [
    { id: 1, title: '電影光效人像', category: 'Midjourney', content: 'cinematic portrait, golden hour lighting, shallow depth of field, film grain, analog photography, warm tones, 35mm lens, highly detailed skin, --ar 2:3 --v 6' },
    { id: 2, title: '極簡建築空間', category: 'Midjourney', content: 'minimalist architecture interior, concrete walls, natural light, shadows, brutalist style, wide angle, muted palette, editorial photography --ar 16:9 --v 6' },
    { id: 3, title: '水彩插畫風格', category: 'SD', content: 'watercolor illustration, loose brushstrokes, paper texture, soft edges, pastel colors, Japanese aesthetic, artbook style, (masterpiece:1.2), high quality' },
    { id: 4, title: '科幻概念設計', category: 'SD', content: 'sci-fi concept art, cyberpunk city, neon lights, rain, holographic displays, dark atmosphere, (Greg Rutkowski style:0.8), 8k, ultra detailed' },
    { id: 5, title: '自然寫實風景', category: 'General', content: 'photorealistic landscape, golden light, misty mountains, forest, morning fog, award winning photography, National Geographic style, ultra detailed' },
    { id: 6, title: '油畫質感肖像', category: 'Style', content: 'oil painting portrait, visible brushstrokes, Renaissance lighting, chiaroscuro, warm earth tones, museum quality, impasto technique, classical art style' },
  ];

  let prompts = [];
  let editingId = null;
  let activeCategory = '全部';
  let searchQuery = '';

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      prompts = raw ? JSON.parse(raw) : SEED_PROMPTS;
    } catch {
      prompts = [...SEED_PROMPTS];
    }
    if (!prompts.length) prompts = [...SEED_PROMPTS];
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
      const catCls = CAT_CLASS[p.category] || 'cat-other';
      card.innerHTML = `
        <div class="prompt-card-header">
          <div class="prompt-card-title">${escHtml(p.title)}</div>
          <div class="prompt-card-actions">
            <button class="icon-btn copy-btn" title="複製" data-id="${p.id}">&#x2398;</button>
            <button class="icon-btn edit-btn" title="編輯" data-id="${p.id}">&#x270E;</button>
            <button class="icon-btn danger del-btn" title="刪除" data-id="${p.id}">&#x2715;</button>
          </div>
        </div>
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
    CATEGORIES.forEach(cat => {
      const chip = document.createElement('div');
      chip.className = 'chip' + (cat === activeCategory ? ' active' : '');
      chip.textContent = cat;
      chip.addEventListener('click', () => {
        activeCategory = cat;
        renderChips();
        render();
      });
      chips.appendChild(chip);
    });
  }

  function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function openModal(id) {
    editingId = id || null;
    const modal = document.getElementById('promptModal');
    document.getElementById('modalTitle').textContent = id ? '編輯提示詞' : '新增提示詞';
    if (id) {
      const p = prompts.find(x => x.id === id);
      document.getElementById('promptTitleInput').value = p.title;
      document.getElementById('promptCategoryInput').value = p.category;
      document.getElementById('promptContentInput').value = p.content;
    } else {
      document.getElementById('promptTitleInput').value = '';
      document.getElementById('promptCategoryInput').value = 'Midjourney';
      document.getElementById('promptContentInput').value = '';
    }
    modal.classList.remove('hidden');
    document.getElementById('promptTitleInput').focus();
  }

  function closeModal() {
    document.getElementById('promptModal').classList.add('hidden');
    editingId = null;
  }

  function saveModal() {
    const title = document.getElementById('promptTitleInput').value.trim();
    const category = document.getElementById('promptCategoryInput').value;
    const content = document.getElementById('promptContentInput').value.trim();
    if (!title || !content) { showToast('請填寫標題與內容'); return; }
    if (editingId) {
      const p = prompts.find(x => x.id === editingId);
      if (p) { p.title = title; p.category = category; p.content = content; }
    } else {
      prompts.unshift({ id: nextId(), title, category, content });
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

  // Event bindings
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

  // Init
  load();
  renderChips();
  render();
})();
