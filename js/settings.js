/**
 * settings.js — API Key management and Settings panel logic
 *
 * Security model (intentional): this app can be served as a pure static site
 * (GitHub Pages) with no backend, so AI API keys are stored ONLY in this
 * browser's localStorage on this device and are sent DIRECTLY from the browser
 * to the AI provider (OpenAI / Google) — never to the personal-studio server.
 * The server-side /api/ai proxy (server/routes/ai.js) is kept for a future
 * server-backed deployment but is not used by this static frontend.
 * Implication: keys are only as safe as this device/browser; clear them here to
 * remove them. Do not enter keys on a shared or untrusted machine.
 *
 * Multi-key model: each provider holds an ordered list of { key, priority }
 * (smaller priority number = tried first) plus a usage mode:
 *   - 'single'     : always use the highest-priority key
 *   - 'failover'   : use highest-priority key; on error/quota, auto-switch to next
 *   - 'roundrobin' : rotate keys on each request to spread usage
 * Failover requires the consumer to loop over getApiKeys(provider); single and
 * round-robin are honored transparently by the getXxxKey() getters.
 */
(function() {
  const STORAGE_KEYS = {
    selectedModel:   'ps_selected_model',
    outputLanguage:  'ps_output_language',
    localAssetPaths: 'ps_local_asset_paths',
    gdriveClientId:  'ps_gdrive_client_id',
    filenamePrefix:  'ps_swf_name_prefix',
    replicateCorsProxy: 'ps_replicate_cors_proxy',
    gcp_project_id:  'ps_gcp_project_id',
    gcp_region:      'ps_gcp_region',
    gcp_gcs_bucket:  'ps_gcp_gcs_bucket',
    gcp_sa_key:      'ps_gcp_sa_key',
    openai_batch:    'ps_openai_batch_mode',
    gemini_batch:    'ps_gemini_batch_mode',
    batch_jobs:      'ps_batch_jobs'
  };

  // Legacy single-key storage — migrated into the per-provider arrays on first
  // load, and kept in sync (top-priority key) for any old reader.
  const LEGACY_KEY = {
    openai:     'ps_openai_key',
    gemini:     'ps_gemini_key',
    geminilite: 'ps_geminilite_key',
    nanobanana: 'ps_nanobanana_key',
    replicate:  'ps_replicate_key',
    fal:        'ps_fal_key'
  };

  const PROVIDERS = {
    openai:     { label: 'OpenAI',           placeholder: 'sk-...',         testFn: 'testOpenAI' },
    gemini:     { label: 'Gemini',           placeholder: 'AIza...',        testFn: 'testGemini' },
    geminilite: { label: 'Gemini 2.5 Lite',  placeholder: 'AIza...',        testFn: 'testGeminilite' },
    nanobanana: { label: 'Nano Banana Pro',  placeholder: 'AIza... / nb-...', testFn: 'testNanobanana' },
    replicate:  { label: 'Replicate',        placeholder: 'r8_...',         testFn: 'testReplicate' },
    fal:        { label: 'fal.ai',           placeholder: 'key_...',        testFn: 'testFal' }
  };
  const PROVIDER_IDS = Object.keys(PROVIDERS);
  const keysStorageKey = (p) => `ps_keys_${p}`;
  const modeStorageKey = (p) => `ps_keymode_${p}`;
  const rrIndex = {}; // round-robin rotation cursor (in-memory, per session)

  const toast = (msg, dur) => { if (window.showToast) window.showToast(msg, dur); };

  // ── Storage helpers ──
  function loadKeys(provider) {
    let arr = null;
    try { arr = JSON.parse(localStorage.getItem(keysStorageKey(provider))); } catch (e) {}
    if (!Array.isArray(arr)) {
      // Migrate from the legacy single-key slot.
      const legacy = (localStorage.getItem(LEGACY_KEY[provider]) || '').trim();
      arr = legacy ? [{ key: legacy, priority: 1 }] : [];
    }
    return arr.map((k, i) => ({ key: String(k.key || ''), priority: Number(k.priority) || (i + 1) }));
  }

  function saveKeys(provider, arr) {
    const clean = arr.map((k, i) => ({ key: String(k.key || ''), priority: Number(k.priority) || (i + 1) }));
    localStorage.setItem(keysStorageKey(provider), JSON.stringify(clean));
    // Keep the legacy single-key slot in sync (highest-priority non-empty key).
    const top = clean.filter(k => k.key.trim()).sort((a, b) => a.priority - b.priority)[0];
    localStorage.setItem(LEGACY_KEY[provider], top ? top.key.trim() : '');
  }

  function getMode(provider) { return localStorage.getItem(modeStorageKey(provider)) || 'single'; }
  function setMode(provider, mode) { localStorage.setItem(modeStorageKey(provider), mode); }

  // Ordered list of non-empty key strings (highest priority first).
  function sortedKeys(provider) {
    return loadKeys(provider)
      .filter(k => k.key && k.key.trim())
      .sort((a, b) => (a.priority || 1) - (b.priority || 1))
      .map(k => k.key.trim());
  }

  // The single key to use for one request, honoring single / round-robin mode.
  // (Failover is handled by consumers that loop over getApiKeys.)
  function activeKey(provider) {
    const keys = sortedKeys(provider);
    if (!keys.length) return '';
    if (getMode(provider) === 'roundrobin') {
      rrIndex[provider] = ((rrIndex[provider] ?? -1) + 1) % keys.length;
      return keys[rrIndex[provider]];
    }
    return keys[0];
  }

  // ── UI rendering ──
  function buildKeyRow(provider, k, idx) {
    const row = document.createElement('div');
    row.className = 'key-row';
    const isProviderDisabled = (provider === 'replicate' || provider === 'fal');

    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'form-input key-input';
    input.placeholder = PROVIDERS[provider].placeholder;
    input.value = k.key || '';
    if (isProviderDisabled) {
      input.disabled = true;
      input.style.opacity = '0.5';
    }

    const prio = document.createElement('input');
    prio.type = 'number';
    prio.className = 'key-priority';
    prio.min = '1';
    prio.step = '1';
    prio.value = Number(k.priority) || (idx + 1);
    prio.title = '優先級（數字越小越優先）';
    if (isProviderDisabled) {
      prio.disabled = true;
      prio.style.opacity = '0.5';
    }

    const testBtn = document.createElement('button');
    testBtn.type = 'button';
    testBtn.className = 'btn-ghost btn-sm key-test-btn';
    testBtn.textContent = '測試';
    if (isProviderDisabled) {
      testBtn.disabled = true;
      testBtn.style.opacity = '0.5';
    }

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-ghost btn-sm key-del-btn ico';
    delBtn.title = '刪除此金鑰';
    delBtn.innerHTML = window.Icons ? window.Icons.get('close') : '';
    if (isProviderDisabled) {
      delBtn.disabled = true;
      delBtn.style.opacity = '0.5';
    }

    const status = document.createElement('span');
    status.className = 'conn-status key-status';

    row.append(input, prio, testBtn, delBtn, status);
    return row;
  }

  function renderProvider(provider) {
    const listEl = document.getElementById(`keyList_${provider}`);
    if (!listEl) return;
    const keys = loadKeys(provider);
    if (keys.length === 0) keys.push({ key: '', priority: 1 });
    listEl.innerHTML = '';
    keys.forEach((k, i) => listEl.appendChild(buildKeyRow(provider, k, i)));
    const modeSel = document.querySelector(`.key-mode-select[data-provider="${provider}"]`);
    if (modeSel) modeSel.value = getMode(provider);
  }

  function collectKeys(provider) {
    const listEl = document.getElementById(`keyList_${provider}`);
    if (!listEl) return [];
    return [...listEl.querySelectorAll('.key-row')].map((r, i) => ({
      key: r.querySelector('.key-input').value.trim(),
      priority: Number(r.querySelector('.key-priority').value) || (i + 1)
    })).filter(k => k.key);
  }

  function saveProvider(provider) {
    const keys = collectKeys(provider);
    saveKeys(provider, keys);
    const modeSel = document.querySelector(`.key-mode-select[data-provider="${provider}"]`);
    if (modeSel) setMode(provider, modeSel.value);
    renderProvider(provider);
    const n = keys.length;
    toast(n ? `${PROVIDERS[provider].label}：已儲存 ${n} 把金鑰` : `${PROVIDERS[provider].label}：金鑰已清除`);
  }

  async function testRow(provider, row) {
    const key = row.querySelector('.key-input').value.trim();
    const statusEl = row.querySelector('.key-status');
    const btn = row.querySelector('.key-test-btn');
    if (!key) { toast(`請先輸入 ${PROVIDERS[provider].label} API Key`); return; }
    const fn = window.AIService && window.AIService[PROVIDERS[provider].testFn];
    if (!fn) { toast('測試功能尚未就緒'); return; }

    updateStatusIndicator(statusEl, 'testing');
    btn.disabled = true; btn.classList.add('btn-loading'); const old = btn.textContent; btn.textContent = '測試中...';
    try {
      await fn(key);
      updateStatusIndicator(statusEl, 'success');
      toast(`✅ ${PROVIDERS[provider].label} 連線成功！`);
    } catch (err) {
      updateStatusIndicator(statusEl, 'error', err.message);
      toast(`❌ ${PROVIDERS[provider].label} 連線失敗：` + err.message, 4000);
    } finally {
      btn.disabled = false; btn.classList.remove('btn-loading'); btn.textContent = old;
    }
  }

  // ── Event delegation for all provider settings sections ──
  PROVIDER_IDS.forEach(provider => {
    const card = document.getElementById(`keyList_${provider}`)?.closest('.settings-section');
    if (!card) return;

    card.addEventListener('click', (e) => {
      if (provider === 'replicate' || provider === 'fal') return;
      const addBtn = e.target.closest('.key-add-btn');
      if (addBtn) {
        const listEl = document.getElementById(`keyList_${provider}`);
        const nextPriority = listEl.querySelectorAll('.key-row').length + 1;
        listEl.appendChild(buildKeyRow(provider, { key: '', priority: nextPriority }, nextPriority - 1));
        return;
      }
      const saveBtn = e.target.closest('.key-save-btn');
      if (saveBtn) { saveProvider(provider); return; }
      const delBtn = e.target.closest('.key-del-btn');
      if (delBtn) {
        const row = delBtn.closest('.key-row');
        const listEl = document.getElementById(`keyList_${provider}`);
        row.remove();
        if (listEl.querySelectorAll('.key-row').length === 0) {
          listEl.appendChild(buildKeyRow(provider, { key: '', priority: 1 }, 0));
        }
        return;
      }
      const testBtn = e.target.closest('.key-test-btn');
      if (testBtn) { testRow(provider, testBtn.closest('.key-row')); return; }
    });

    const modeSel = document.querySelector(`.key-mode-select[data-provider="${provider}"]`);
    if (modeSel) {
      modeSel.addEventListener('change', () => {
        if (provider === 'replicate' || provider === 'fal') return;
        setMode(provider, modeSel.value);
      });
    }
  });

  // ── File-name prefix (unchanged) ──
  const swfNamePrefixInput = document.getElementById('swfNamePrefixInput');
  const saveNamePrefixBtn  = document.getElementById('saveNamePrefixBtn');
  const namePrefixStatus   = document.getElementById('namePrefixStatus');
  function saveNamePrefix() {
    const prefix = (swfNamePrefixInput?.value || '').trim();
    localStorage.setItem(STORAGE_KEYS.filenamePrefix, prefix);
    toast(prefix ? `檔名前綴已設為「${prefix}」` : '檔名前綴已清除（預設 1, 2, 3…）');
    updateStatusIndicator(namePrefixStatus, 'saved');
  }
  if (saveNamePrefixBtn) saveNamePrefixBtn.addEventListener('click', saveNamePrefix);

  // ── Model / language selectors (unchanged) ──
  const modelSelect    = document.getElementById('modelSelect');
  const languageSelect = document.getElementById('languageSelect');
  if (modelSelect) modelSelect.addEventListener('change', () => {
    localStorage.setItem(STORAGE_KEYS.selectedModel, modelSelect.value);
  });
  if (languageSelect) languageSelect.addEventListener('change', () => {
    localStorage.setItem(STORAGE_KEYS.outputLanguage, languageSelect.value);
  });

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

  // ── Load saved values into the UI ──
  function loadSettings() {
    PROVIDER_IDS.forEach(renderProvider);
    if (modelSelect)    modelSelect.value = localStorage.getItem(STORAGE_KEYS.selectedModel) || 'gemini';
    if (languageSelect) languageSelect.value = localStorage.getItem(STORAGE_KEYS.outputLanguage) || '繁體中文';
    if (swfNamePrefixInput) swfNamePrefixInput.value = localStorage.getItem(STORAGE_KEYS.filenamePrefix) || '';
    
    const repProxyInput = document.getElementById('replicateCorsProxy');
    if (repProxyInput) repProxyInput.value = localStorage.getItem(STORAGE_KEYS.replicateCorsProxy) || '';
  }

  // ── Public getters ──
  window.StudioSettings = {
    // Active-key getters honor single / round-robin mode (back-compat names).
    getOpenAIKey:      () => activeKey('openai'),
    getGeminiKey:      () => activeKey('gemini'),
    getGeminiliteKey:  () => activeKey('geminilite'),
    getNanobananaKey:  () => activeKey('nanobanana'),
    getReplicateKey:   () => activeKey('replicate'),
    getFalKey:         () => activeKey('fal'),
    getReplicateCorsProxy: () => localStorage.getItem(STORAGE_KEYS.replicateCorsProxy) || '',
    // Multi-key extensions: ordered key list (for failover loops) + the mode.
    getApiKeys:        (provider) => sortedKeys(provider),
    getKeyMode:        (provider) => getMode(provider),
    getSelectedModel:  () => localStorage.getItem(STORAGE_KEYS.selectedModel) || 'gemini',
    getOutputLanguage: () => localStorage.getItem(STORAGE_KEYS.outputLanguage) || '繁體中文',
    getLocalAssetPaths: () => {
      const raw = localStorage.getItem(STORAGE_KEYS.localAssetPaths) || '';
      return raw.split('\n').map(p => p.trim()).filter(Boolean);
    },
    getGdriveClientId: () => localStorage.getItem(STORAGE_KEYS.gdriveClientId) || '',
    getFilenamePattern: () => localStorage.getItem(STORAGE_KEYS.filenamePrefix) || '',
    getGcpConfig: () => ({
      projectId: localStorage.getItem(STORAGE_KEYS.gcp_project_id) || '',
      region:    localStorage.getItem(STORAGE_KEYS.gcp_region) || 'us-central1',
      bucket:    localStorage.getItem(STORAGE_KEYS.gcp_gcs_bucket) || '',
      saKeyJson: localStorage.getItem(STORAGE_KEYS.gcp_sa_key) || ''
    }),
    isBatchMode: (provider) => {
      if (provider === 'openai') return localStorage.getItem(STORAGE_KEYS.openai_batch) === '1';
      if (provider === 'gemini') return localStorage.getItem(STORAGE_KEYS.gemini_batch) === '1';
      return false;
    },
    getBatchJobs,
    saveBatchJob,
    updateBatchJob,
    hasApiKey: function(model) {
      if (model.startsWith('openai')) return sortedKeys('openai').length > 0;
      if (model === 'gemini')      return sortedKeys('gemini').length > 0;
      if (model === 'geminilite')  return sortedKeys('geminilite').length > 0;
      if (model === 'groq')        return false;
      if (model === 'nanobanana')  return sortedKeys('nanobanana').length > 0;
      if (model === 'gptimage')    return sortedKeys('openai').length > 0;
      if (model === 'replicate')   return sortedKeys('replicate').length > 0;
      if (model === 'fal')         return sortedKeys('fal').length > 0;
      return false;
    }
  };

  // ── Theme toggle (unchanged) ──
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  function updateThemeUI() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (themeToggleBtn) themeToggleBtn.innerHTML = (window.Icons ? '<span class="ico">' + window.Icons.get(isDark ? 'sun' : 'moon') + '</span> ' : '') + (isDark ? '切換日間模式' : '切換夜間模式');
  }
  if (themeToggleBtn) {
    const toggleTheme = () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (isDark) {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('ps_theme', 'light');
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('ps_theme', 'dark');
      }
      updateThemeUI();
    };
    themeToggleBtn.addEventListener('click', toggleTheme);
    themeToggleBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleTheme();
      }
    });
    updateThemeUI();
  }

  // ── Replicate CORS Proxy input listener ──
  const repProxyInput = document.getElementById('replicateCorsProxy');
  if (repProxyInput) {
    repProxyInput.addEventListener('input', () => {
      localStorage.setItem(STORAGE_KEYS.replicateCorsProxy, repProxyInput.value.trim());
    });
  }

  // ── Vertex AI settings ──
  function loadVertexAiSettings() {
    const pid = document.getElementById('gcpProjectId');
    const reg = document.getElementById('gcpRegion');
    const bkt = document.getElementById('gcpBucket');
    const saKey = document.getElementById('gcpSaKey');
    const oaiBatch = document.getElementById('openAiBatchToggle');
    const gemBatch = document.getElementById('geminiBatchToggle');
    if (pid) pid.value = localStorage.getItem(STORAGE_KEYS.gcp_project_id) || '';
    if (reg) reg.value = localStorage.getItem(STORAGE_KEYS.gcp_region) || 'us-central1';
    if (bkt) bkt.value = localStorage.getItem(STORAGE_KEYS.gcp_gcs_bucket) || '';
    if (saKey) saKey.value = localStorage.getItem(STORAGE_KEYS.gcp_sa_key) || '';
    if (oaiBatch) oaiBatch.checked = localStorage.getItem(STORAGE_KEYS.openai_batch) === '1';
    if (gemBatch) gemBatch.checked = localStorage.getItem(STORAGE_KEYS.gemini_batch) === '1';
  }

  const saveVertexBtn = document.getElementById('saveVertexAiBtn');
  if (saveVertexBtn) {
    saveVertexBtn.addEventListener('click', () => {
      const pid   = document.getElementById('gcpProjectId')?.value.trim() || '';
      const reg   = document.getElementById('gcpRegion')?.value.trim() || 'us-central1';
      const bkt   = document.getElementById('gcpBucket')?.value.trim() || '';
      const saKey = document.getElementById('gcpSaKey')?.value.trim() || '';
      localStorage.setItem(STORAGE_KEYS.gcp_project_id, pid);
      localStorage.setItem(STORAGE_KEYS.gcp_region, reg);
      localStorage.setItem(STORAGE_KEYS.gcp_gcs_bucket, bkt);
      localStorage.setItem(STORAGE_KEYS.gcp_sa_key, saKey);
      toast('Vertex AI 設定已儲存');
      const st = document.getElementById('vertexSaveStatus');
      if (st) updateStatusIndicator(st, 'saved');
    });
  }

  const testVertexBtn = document.getElementById('testVertexAiBtn');
  if (testVertexBtn) {
    testVertexBtn.addEventListener('click', async () => {
      const statusEl = document.getElementById('vertexSaveStatus');
      testVertexBtn.disabled = true;
      const old = testVertexBtn.textContent;
      testVertexBtn.textContent = '測試中...';
      updateStatusIndicator(statusEl, 'testing');
      try {
        const gcpConfig = window.StudioSettings.getGcpConfig();
        await window.AIService.testVertexAi(gcpConfig);
        updateStatusIndicator(statusEl, 'success');
        toast('✅ Vertex AI 連線成功！');
      } catch (err) {
        updateStatusIndicator(statusEl, 'error', err.message);
        toast('❌ Vertex AI 連線失敗：' + err.message, 4000);
      } finally {
        testVertexBtn.disabled = false;
        testVertexBtn.textContent = old;
      }
    });
  }

  const oaiBatchToggle = document.getElementById('openAiBatchToggle');
  if (oaiBatchToggle) {
    oaiBatchToggle.addEventListener('change', () => {
      localStorage.setItem(STORAGE_KEYS.openai_batch, oaiBatchToggle.checked ? '1' : '');
    });
  }
  const gemBatchToggle = document.getElementById('geminiBatchToggle');
  if (gemBatchToggle) {
    gemBatchToggle.addEventListener('change', () => {
      localStorage.setItem(STORAGE_KEYS.gemini_batch, gemBatchToggle.checked ? '1' : '');
    });
  }

  // ── Batch job persistence helpers ──
  function getBatchJobs() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.batch_jobs) || '[]'); } catch { return []; }
  }
  function saveBatchJob(job) {
    const jobs = getBatchJobs();
    jobs.unshift(job);
    localStorage.setItem(STORAGE_KEYS.batch_jobs, JSON.stringify(jobs.slice(0, 50)));
    renderBatchJobs();
  }
  function updateBatchJob(jobId, patch) {
    const jobs = getBatchJobs().map(j => j.id === jobId ? { ...j, ...patch } : j);
    localStorage.setItem(STORAGE_KEYS.batch_jobs, JSON.stringify(jobs));
    renderBatchJobs();
  }

  function renderBatchJobs() {
    const listEl = document.getElementById('batchJobList');
    if (!listEl) return;
    const jobs = getBatchJobs();
    if (!jobs.length) { listEl.innerHTML = '<div class="batch-empty">尚無批次工作</div>'; return; }
    listEl.innerHTML = '';
    jobs.forEach(job => {
      const row = document.createElement('div');
      row.className = 'batch-job-row';
      const stateClass = { pending:'pending', validating:'pending', in_progress:'running',
        JOB_STATE_PENDING:'pending', JOB_STATE_RUNNING:'running',
        completed:'done', JOB_STATE_SUCCEEDED:'done',
        failed:'error', JOB_STATE_FAILED:'error', cancelled:'error' }[job.status] || 'pending';
      const label = { pending:'排隊中', validating:'驗證中', in_progress:'處理中',
        JOB_STATE_PENDING:'排隊中', JOB_STATE_RUNNING:'執行中',
        completed:'完成', JOB_STATE_SUCCEEDED:'完成',
        failed:'失敗', JOB_STATE_FAILED:'失敗', cancelled:'已取消' }[job.status] || job.status;
      const ts = job.submittedAt ? new Date(job.submittedAt).toLocaleString('zh-TW', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
      row.innerHTML = `
        <span class="batch-provider-badge batch-badge-${job.provider}">${job.provider === 'openai' ? 'OpenAI' : 'Vertex'}</span>
        <span class="batch-job-status batch-job-status-${stateClass}"><span class="status-dot"></span>${label}</span>
        <span class="batch-job-meta">${ts}・${(job.nodeIds||[]).length} 節點</span>
        <span class="batch-job-actions">
          ${(stateClass === 'done') ? `<button class="btn-ghost btn-sm batch-fetch-btn" data-jobid="${job.id}">取得結果</button>` : ''}
          ${(stateClass === 'pending' || stateClass === 'running') ? `<button class="btn-ghost btn-sm batch-refresh-btn" data-jobid="${job.id}">刷新</button><button class="btn-ghost btn-sm batch-cancel-btn" data-jobid="${job.id}">取消</button>` : ''}
        </span>`;
      listEl.appendChild(row);
    });
  }

  // Delegate batch job action clicks to the list container
  const batchListEl = document.getElementById('batchJobList');
  if (batchListEl) {
    batchListEl.addEventListener('click', async (e) => {
      const fetchBtn = e.target.closest('.batch-fetch-btn');
      const refreshBtn = e.target.closest('.batch-refresh-btn');
      const cancelBtn = e.target.closest('.batch-cancel-btn');
      const jobId = (fetchBtn || refreshBtn || cancelBtn)?.dataset.jobid;
      if (!jobId) return;
      const job = getBatchJobs().find(j => j.id === jobId);
      if (!job) return;

      if (refreshBtn) {
        try {
          let newStatus;
          if (job.provider === 'openai') {
            const apiKey = window.StudioSettings.getOpenAIKey();
            const s = await window.AIService.getOpenAIBatchStatus(job.batchId, apiKey);
            newStatus = s.status;
            updateBatchJob(jobId, { status: newStatus, outputFileId: s.outputFileId });
          } else {
            const gcpConfig = window.StudioSettings.getGcpConfig();
            const s = await window.AIService.getVertexBatchStatus(job.jobName, gcpConfig);
            newStatus = s.state;
            updateBatchJob(jobId, { status: newStatus, outputUri: s.outputUri });
          }
          toast('狀態已更新：' + newStatus);
        } catch (err) { toast('刷新失敗：' + err.message, 3000); }
      }

      if (cancelBtn) {
        try {
          if (job.provider === 'openai') {
            const apiKey = window.StudioSettings.getOpenAIKey();
            await window.AIService.cancelOpenAIBatch(job.batchId, apiKey);
          }
          updateBatchJob(jobId, { status: 'cancelled' });
          toast('批次已取消');
        } catch (err) { toast('取消失敗：' + err.message, 3000); }
      }

      if (fetchBtn) {
        try {
          if (!window.SWF || typeof window.SWF.applyBatchResults !== 'function') {
            toast('請先切換到工作流面板再取得結果', 3000); return;
          }
          await window.SWF.applyBatchResults(jobId);
          toast('✅ 結果已回填到工作流節點');
        } catch (err) { toast('取得結果失敗：' + err.message, 4000); }
      }
    });
  }

  // ── Initialize ──
  loadSettings();
  loadVertexAiSettings();

})();
