/**
 * settings.js — API Key management and Settings panel logic
 */
(function() {
  const STORAGE_KEYS = {
    openaiKey: 'ps_openai_key',
    geminiKey: 'ps_gemini_key',
    nanoKey: 'ps_nano_key',
    gptImageKey: 'ps_gpt_image_key',
    selectedModel: 'ps_selected_model'
  };

  // ── DOM refs ──
  const openaiKeyInput  = document.getElementById('openaiKeyInput');
  const geminiKeyInput  = document.getElementById('geminiKeyInput');
  const nanoKeyInput    = document.getElementById('nanoKeyInput');
  const gptImageKeyInput = document.getElementById('gptImageKeyInput');

  const saveOpenaiBtn   = document.getElementById('saveOpenaiBtn');
  const saveGeminiBtn   = document.getElementById('saveGeminiBtn');
  const saveNanoBtn     = document.getElementById('saveNanoBtn');
  const saveGptImageBtn = document.getElementById('saveGptImageBtn');

  const testOpenaiBtn   = document.getElementById('testOpenaiBtn');
  const testGeminiBtn   = document.getElementById('testGeminiBtn');
  const testNanoBtn     = document.getElementById('testNanoBtn');
  const testGptImageBtn = document.getElementById('testGptImageBtn');

  const openaiStatus    = document.getElementById('openaiStatus');
  const geminiStatus    = document.getElementById('geminiStatus');
  const nanoStatus      = document.getElementById('nanoStatus');
  const gptImageStatus  = document.getElementById('gptImageStatus');

  const modelSelect     = document.getElementById('modelSelect');

  // ── Load saved keys ──
  function loadSettings() {
    const oKey = localStorage.getItem(STORAGE_KEYS.openaiKey) || '';
    const gKey = localStorage.getItem(STORAGE_KEYS.geminiKey) || '';
    const nKey = localStorage.getItem(STORAGE_KEYS.nanoKey) || '';
    const giKey = localStorage.getItem(STORAGE_KEYS.gptImageKey) || '';
    const model = localStorage.getItem(STORAGE_KEYS.selectedModel) || 'gemini';

    if (openaiKeyInput) openaiKeyInput.value = oKey;
    if (geminiKeyInput) geminiKeyInput.value = gKey;
    if (nanoKeyInput) nanoKeyInput.value = nKey;
    if (gptImageKeyInput) gptImageKeyInput.value = giKey;
    if (modelSelect)    modelSelect.value = model;
  }

  // ── Save keys ──
  function saveOpenaiKey() {
    const key = openaiKeyInput.value.trim();
    localStorage.setItem(STORAGE_KEYS.openaiKey, key);
    showToast(key ? 'ChatGPT API Key 已儲存' : 'ChatGPT API Key 已清除');
    updateStatusIndicator(openaiStatus, 'saved');
  }

  function saveGeminiKey() {
    const key = geminiKeyInput.value.trim();
    localStorage.setItem(STORAGE_KEYS.geminiKey, key);
    showToast(key ? 'Gemini API Key 已儲存' : 'Gemini API Key 已清除');
    updateStatusIndicator(geminiStatus, 'saved');
  }

  function saveNanoKey() {
    const key = nanoKeyInput.value.trim();
    localStorage.setItem(STORAGE_KEYS.nanoKey, key);
    showToast(key ? 'Nano Banana API Key 已儲存' : 'Nano Banana API Key 已清除');
    updateStatusIndicator(nanoStatus, 'saved');
  }

  function saveGptImageKey() {
    const key = gptImageKeyInput.value.trim();
    localStorage.setItem(STORAGE_KEYS.gptImageKey, key);
    showToast(key ? 'GPT Image API Key 已儲存' : 'GPT Image API Key 已清除');
    updateStatusIndicator(gptImageStatus, 'saved');
  }

  // ── Test connections ──
  async function testOpenAI() {
    const key = openaiKeyInput.value.trim();
    if (!key) { showToast('請先輸入 ChatGPT API Key'); return; }

    updateStatusIndicator(openaiStatus, 'testing');
    testOpenaiBtn.disabled = true;
    testOpenaiBtn.textContent = '測試中...';

    try {
      await window.AIService.testOpenAI(key);
      updateStatusIndicator(openaiStatus, 'success');
      showToast('✅ ChatGPT 連線成功！');
    } catch (err) {
      updateStatusIndicator(openaiStatus, 'error', err.message);
      showToast('❌ ChatGPT 連線失敗：' + err.message, 4000);
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

  async function testNano() {
    const key = nanoKeyInput.value.trim();
    if (!key) { showToast('請先輸入 Nano Banana API Key'); return; }

    updateStatusIndicator(nanoStatus, 'testing');
    testNanoBtn.disabled = true;
    testNanoBtn.textContent = '測試中...';

    try {
      await window.AIService.testNano(key);
      updateStatusIndicator(nanoStatus, 'success');
      showToast('✅ Nano Banana 連線成功！');
    } catch (err) {
      updateStatusIndicator(nanoStatus, 'error', err.message);
      showToast('❌ Nano Banana 連線失敗：' + err.message, 4000);
    } finally {
      testNanoBtn.disabled = false;
      testNanoBtn.textContent = '測試連線';
    }
  }

  async function testGptImage() {
    const key = gptImageKeyInput.value.trim();
    if (!key) { showToast('請先輸入 GPT Image API Key'); return; }

    updateStatusIndicator(gptImageStatus, 'testing');
    testGptImageBtn.disabled = true;
    testGptImageBtn.textContent = '測試中...';

    try {
      await window.AIService.testGptImage(key);
      updateStatusIndicator(gptImageStatus, 'success');
      showToast('✅ GPT Image 連線成功！');
    } catch (err) {
      updateStatusIndicator(gptImageStatus, 'error', err.message);
      showToast('❌ GPT Image 連線失敗：' + err.message, 4000);
    } finally {
      testGptImageBtn.disabled = false;
      testGptImageBtn.textContent = '測試連線';
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

  // ── Button event listeners ──
  if (saveOpenaiBtn) saveOpenaiBtn.addEventListener('click', saveOpenaiKey);
  if (saveGeminiBtn) saveGeminiBtn.addEventListener('click', saveGeminiKey);
  if (saveNanoBtn) saveNanoBtn.addEventListener('click', saveNanoKey);
  if (saveGptImageBtn) saveGptImageBtn.addEventListener('click', saveGptImageKey);

  if (testOpenaiBtn) testOpenaiBtn.addEventListener('click', testOpenAI);
  if (testGeminiBtn) testGeminiBtn.addEventListener('click', testGemini);
  if (testNanoBtn) testNanoBtn.addEventListener('click', testNano);
  if (testGptImageBtn) testGptImageBtn.addEventListener('click', testGptImage);

  // ── Public getters ──
  window.StudioSettings = {
    getOpenAIKey:    () => localStorage.getItem(STORAGE_KEYS.openaiKey) || '',
    getGeminiKey:    () => localStorage.getItem(STORAGE_KEYS.geminiKey) || '',
    getNanoKey:      () => localStorage.getItem(STORAGE_KEYS.nanoKey) || '',
    getGptImageKey:  () => localStorage.getItem(STORAGE_KEYS.gptImageKey) || '',
    getSelectedModel:() => localStorage.getItem(STORAGE_KEYS.selectedModel) || 'gemini',
    hasApiKey: function(model) {
      if (model === 'openai') return !!this.getOpenAIKey();
      if (model === 'gemini') return !!this.getGeminiKey();
      if (model === 'nano') return !!this.getNanoKey();
      if (model === 'gptImage') return !!this.getGptImageKey();
      return false;
    }
  };

  // ── Initialize ──
  loadSettings();

})();
