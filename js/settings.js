/**
 * settings.js — API Key management and Settings panel logic
 */
(function() {
  const STORAGE_KEYS = {
    openaiKey: 'ps_openai_key',
    geminiKey: 'ps_gemini_key',
    geminiliteKey: 'ps_geminilite_key',
    nanobananaKey: 'ps_nanobanana_key',
    gptimageKey: 'ps_gptimage_key',
    selectedModel: 'ps_selected_model',
    outputLanguage: 'ps_output_language'
  };

  // ── DOM refs ──
  const openaiKeyInput  = document.getElementById('openaiKeyInput');
  const geminiKeyInput  = document.getElementById('geminiKeyInput');
  const geminiliteKeyInput = document.getElementById('geminiliteKeyInput');
  const nanobananaKeyInput = document.getElementById('nanobananaKeyInput');
  const gptimageKeyInput = document.getElementById('gptimageKeyInput');
  const saveOpenaiBtn   = document.getElementById('saveOpenaiBtn');
  const saveGeminiBtn   = document.getElementById('saveGeminiBtn');
  const saveGeminiliteBtn = document.getElementById('saveGeminiliteBtn');
  const saveNanobananaBtn = document.getElementById('saveNanobananaBtn');
  const saveGptimageBtn = document.getElementById('saveGptimageBtn');
  const testOpenaiBtn   = document.getElementById('testOpenaiBtn');
  const testGeminiBtn   = document.getElementById('testGeminiBtn');
  const testGeminiliteBtn = document.getElementById('testGeminiliteBtn');
  const openaiStatus    = document.getElementById('openaiStatus');
  const geminiStatus    = document.getElementById('geminiStatus');
  const geminiliteStatus = document.getElementById('geminiliteStatus');
  const nanobananaStatus = document.getElementById('nanobananaStatus');
  const gptimageStatus = document.getElementById('gptimageStatus');
  const modelSelect     = document.getElementById('modelSelect');
  const languageSelect  = document.getElementById('languageSelect');

  // ── Load saved keys ──
  function loadSettings() {
    const oKey = localStorage.getItem(STORAGE_KEYS.openaiKey) || '';
    const gKey = localStorage.getItem(STORAGE_KEYS.geminiKey) || '';
    const glKey = localStorage.getItem(STORAGE_KEYS.geminiliteKey) || '';
    const nbKey = localStorage.getItem(STORAGE_KEYS.nanobananaKey) || '';
    const giKey = localStorage.getItem(STORAGE_KEYS.gptimageKey) || '';
    const model = localStorage.getItem(STORAGE_KEYS.selectedModel) || 'gemini';
    const lang = localStorage.getItem(STORAGE_KEYS.outputLanguage) || '繁體中文';

    if (openaiKeyInput) openaiKeyInput.value = oKey;
    if (geminiKeyInput) geminiKeyInput.value = gKey;
    if (geminiliteKeyInput) geminiliteKeyInput.value = glKey;
    if (nanobananaKeyInput) nanobananaKeyInput.value = nbKey;
    if (gptimageKeyInput) gptimageKeyInput.value = giKey;
    if (modelSelect)    modelSelect.value = model;
    if (languageSelect) languageSelect.value = lang;
  }

  // ── Save keys ──
  function saveOpenaiKey() {
    const key = openaiKeyInput.value.trim();
    localStorage.setItem(STORAGE_KEYS.openaiKey, key);
    showToast(key ? 'OpenAI API Key 已儲存' : 'OpenAI API Key 已清除');
    updateStatusIndicator(openaiStatus, 'saved');
  }

  function saveGeminiKey() {
    const key = geminiKeyInput.value.trim();
    localStorage.setItem(STORAGE_KEYS.geminiKey, key);
    showToast(key ? 'Gemini API Key 已儲存' : 'Gemini API Key 已清除');
    updateStatusIndicator(geminiStatus, 'saved');
  }

  function saveGeminiliteKey() {
    const key = geminiliteKeyInput.value.trim();
    localStorage.setItem(STORAGE_KEYS.geminiliteKey, key);
    showToast(key ? 'Gemini 2.5 Lite API Key 已儲存' : 'Gemini 2.5 Lite API Key 已清除');
    updateStatusIndicator(geminiliteStatus, 'saved');
  }

  function saveNanobananaKey() {
    const key = nanobananaKeyInput.value.trim();
    localStorage.setItem(STORAGE_KEYS.nanobananaKey, key);
    showToast(key ? 'Nano Banana API Key 已儲存' : 'Nano Banana API Key 已清除');
    updateStatusIndicator(nanobananaStatus, 'saved');
  }

  function saveGptimageKey() {
    const key = gptimageKeyInput.value.trim();
    localStorage.setItem(STORAGE_KEYS.gptimageKey, key);
    showToast(key ? 'GPT Image API Key 已儲存' : 'GPT Image API Key 已清除');
    updateStatusIndicator(gptimageStatus, 'saved');
  }

  // ── Test connections ──
  async function testOpenAI() {
    const key = openaiKeyInput.value.trim();
    if (!key) { showToast('請先輸入 OpenAI API Key'); return; }

    updateStatusIndicator(openaiStatus, 'testing');
    testOpenaiBtn.disabled = true;
    testOpenaiBtn.textContent = '測試中...';

    try {
      await window.AIService.testOpenAI(key);
      updateStatusIndicator(openaiStatus, 'success');
      showToast('✅ OpenAI 連線成功！');
    } catch (err) {
      updateStatusIndicator(openaiStatus, 'error', err.message);
      showToast('❌ OpenAI 連線失敗：' + err.message, 4000);
    } finally {
      testOpenaiBtn.disabled = false;
      testOpenaiBtn.textContent = '測試連線';
    }
  }

  async function testGemini() {
    const key = geminiKeyInput.value.trim();
    if (!key) { showToast('請先輸入 Gemini API Key'); return; }

    updateStatusIndicator(geminiStatus, 'testing');
    testGeminiBtn.disabled = true;
    testGeminiBtn.textContent = '測試中...';

    try {
      await window.AIService.testGemini(key);
      updateStatusIndicator(geminiStatus, 'success');
      showToast('✅ Gemini 連線成功！');
    } catch (err) {
      updateStatusIndicator(geminiStatus, 'error', err.message);
      showToast('❌ Gemini 連線失敗：' + err.message, 4000);
    } finally {
      testGeminiBtn.disabled = false;
      testGeminiBtn.textContent = '測試連線';
    }
  }

  async function testGeminilite() {
    const key = geminiliteKeyInput.value.trim();
    if (!key) { showToast('請先輸入 Gemini 2.5 Lite API Key'); return; }

    updateStatusIndicator(geminiliteStatus, 'testing');
    testGeminiliteBtn.disabled = true;
    testGeminiliteBtn.textContent = '測試中...';

    try {
      await window.AIService.testGeminilite(key);
      updateStatusIndicator(geminiliteStatus, 'success');
      showToast('✅ Gemini Lite 連線成功！');
    } catch (err) {
      updateStatusIndicator(geminiliteStatus, 'error', err.message);
      showToast('❌ Gemini Lite 連線失敗：' + err.message, 4000);
    } finally {
      testGeminiliteBtn.disabled = false;
      testGeminiliteBtn.textContent = '測試連線';
    }
  }

  // ── Status indicator ──
  function updateStatusIndicator(el, state, message) {
    if (!el) return;
    el.className = 'conn-status';
    switch (state) {
      case 'saved':
        el.classList.add('status-saved');
        el.innerHTML = '<span class="status-dot"></span> 已儲存';
        break;
      case 'testing':
        el.classList.add('status-testing');
        el.innerHTML = '<span class="status-dot"></span> 測試中...';
        break;
      case 'success':
        el.classList.add('status-success');
        el.innerHTML = '<span class="status-dot"></span> 連線成功';
        break;
      case 'error':
        el.classList.add('status-error');
        el.innerHTML = `<span class="status-dot"></span> 連線失敗${message ? '：' + message.substring(0, 60) : ''}`;
        break;
      default:
        el.innerHTML = '';
    }
  }

  // ── Model selection ──
  if (modelSelect) {
    modelSelect.addEventListener('change', () => {
      localStorage.setItem(STORAGE_KEYS.selectedModel, modelSelect.value);
    });
  }

  if (languageSelect) {
    languageSelect.addEventListener('change', () => {
      localStorage.setItem(STORAGE_KEYS.outputLanguage, languageSelect.value);
    });
  }

  // ── Button event listeners ──
  if (saveOpenaiBtn) saveOpenaiBtn.addEventListener('click', saveOpenaiKey);
  if (saveGeminiBtn) saveGeminiBtn.addEventListener('click', saveGeminiKey);
  if (saveGeminiliteBtn) saveGeminiliteBtn.addEventListener('click', saveGeminiliteKey);
  if (saveNanobananaBtn) saveNanobananaBtn.addEventListener('click', saveNanobananaKey);
  if (saveGptimageBtn) saveGptimageBtn.addEventListener('click', saveGptimageKey);
  if (testOpenaiBtn) testOpenaiBtn.addEventListener('click', testOpenAI);
  if (testGeminiBtn) testGeminiBtn.addEventListener('click', testGemini);
  if (testGeminiliteBtn) testGeminiliteBtn.addEventListener('click', testGeminilite);

  // ── Public getters ──
  window.StudioSettings = {
    getOpenAIKey:    () => localStorage.getItem(STORAGE_KEYS.openaiKey) || '',
    getGeminiKey:    () => localStorage.getItem(STORAGE_KEYS.geminiKey) || '',
    getGeminiliteKey:() => localStorage.getItem(STORAGE_KEYS.geminiliteKey) || '',
    getNanobananaKey: () => localStorage.getItem(STORAGE_KEYS.nanobananaKey) || '',
    getGptimageKey:   () => localStorage.getItem(STORAGE_KEYS.gptimageKey) || '',
    getSelectedModel:() => localStorage.getItem(STORAGE_KEYS.selectedModel) || 'gemini',
    getOutputLanguage:() => localStorage.getItem(STORAGE_KEYS.outputLanguage) || '繁體中文',
    hasApiKey: function(model) {
      if (model.startsWith('openai')) return !!this.getOpenAIKey();
      if (model === 'gemini') return !!this.getGeminiKey();
      if (model === 'geminilite') return !!this.getGeminiliteKey();
      if (model === 'groq') return !!this.getGroqKey();
      if (model === 'nanobanana') return !!this.getNanobananaKey();
      if (model === 'gptimage') return !!this.getGptimageKey();
      return false;
    }
  };

  // ── Initialize ──
  loadSettings();

})();
