(function() {
  const dropZone       = document.getElementById('dropZone');
  const imageInput     = document.getElementById('imageInput');
  const uploadBtn      = document.getElementById('uploadBtn');
  const decodeLoading  = document.getElementById('decodeLoading');
  const loadingBarFill = document.getElementById('loadingBarFill');
  const decodeResult   = document.getElementById('decodeResult');
  const previewImg     = document.getElementById('previewImg');
  const paletteRow     = document.getElementById('paletteRow');
  const promptOutput   = document.getElementById('promptOutput');
  const copyPromptBtn  = document.getElementById('copyPromptBtn');
  const sendToWorkflowBtn = document.getElementById('sendToWorkflowBtn');
  const exportJsonBtn  = document.getElementById('exportJsonBtn');
  const toNaturalBtn  = document.getElementById('toNaturalBtn');
  const resetDecodeBtn = document.getElementById('resetDecodeBtn');
  const modelSelect    = document.getElementById('modelSelect');

  // DOM refs for dashboard cards
  const moodText       = document.getElementById('moodText');
  const metaStyle      = document.getElementById('metaStyle');
  
  const elForeground   = document.getElementById('elForeground');
  const elSubjectIdentity = document.getElementById('elSubjectIdentity');
  const elSubjectClothing = document.getElementById('elSubjectClothing');
  const elSubjectPose  = document.getElementById('elSubjectPose');
  const elMidground    = document.getElementById('elMidground');
  const elBackground   = document.getElementById('elBackground');
  
  const lightDirection = document.getElementById('lightDirection');
  const lightColorTemp = document.getElementById('lightColorTemp');
  const lightQuality   = document.getElementById('lightQuality');
  const lightFill      = document.getElementById('lightFill');
  
  const cameraLens     = document.getElementById('cameraLens');
  const cameraDof      = document.getElementById('cameraDof');
  const cameraAngle    = document.getElementById('cameraAngle');
  
  const materialsList  = document.getElementById('materialsList');
  const negativeList   = document.getElementById('negativeList');
  const elOther        = document.getElementById('elOther');
  const elOtherSection = document.getElementById('elOtherSection');

  let currentAnalysis = null;
  let currentFile = null;
  let currentImageThumb = null; // downscaled data-URL of the decoded image (for vault thumbnails)

  // Produce a small, persistable JPEG data-URL so localStorage stays light
  // and the thumbnail survives page reloads (blob: URLs do not).
  function makeThumbnail(imgEl, maxSize = 320) {
    try {
      const w = imgEl.naturalWidth || imgEl.width;
      const h = imgEl.naturalHeight || imgEl.height;
      if (!w || !h) return null;
      const scale = Math.min(1, maxSize / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext('2d').drawImage(imgEl, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.72);
    } catch {
      return null; // e.g. tainted canvas — fall back to no thumbnail
    }
  }

  // ── Initialization ──
  // Sync selected model from settings
  if (window.StudioSettings && modelSelect) {
    modelSelect.value = window.StudioSettings.getSelectedModel();
    modelSelect.addEventListener('change', () => {
      localStorage.setItem('ps_selected_model', modelSelect.value);
    });
  }

  // ── Upload / Drag-drop handlers ──
  uploadBtn.addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', e => { if (e.target.files[0]) loadImage(e.target.files[0]); });

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadImage(file);
  });
  dropZone.addEventListener('click', e => { if (e.target !== uploadBtn) imageInput.click(); });

  resetDecodeBtn.addEventListener('click', resetDecode);

  function resetDecode() {
    decodeResult.classList.add('hidden');
    decodeLoading.classList.add('hidden');
    dropZone.classList.remove('hidden');
    imageInput.value = '';
    currentAnalysis = null;
    currentFile = null;
    currentImageThumb = null;
    window.StudioState.decodeResult = null;
  }

  // ── Collapsible toggle ──
  document.querySelectorAll('.dash-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const body = document.getElementById(targetId);
      if (!body) return;
      const isExpanded = body.classList.contains('expanded');
      body.classList.toggle('expanded');
      btn.textContent = isExpanded ? '展開 ▾' : '收合 ▴';
    });
  });

  // ── Image load & AI analysis ──
  function loadImage(file) {
    currentFile = file;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      previewImg.src = url;
      currentImageThumb = makeThumbnail(img);
      dropZone.classList.add('hidden');
      decodeLoading.classList.remove('hidden');
      startAnalysis(file);
    };
    img.src = url;
  }

  async function startAnalysis(file) {
    const model = modelSelect ? modelSelect.value : 'gemini';
    const hasKey = window.StudioSettings ? window.StudioSettings.hasApiKey(model) : false;

    if (!hasKey) {
      decodeLoading.classList.add('hidden');
      dropZone.classList.remove('hidden');
      const modelNames = {
        'openai':        'GPT-5.5',
        'openai-54':     'GPT-5.4',
        'openai-54mini': 'GPT-5.4 Mini',
        'openai-4o':     'GPT-4o',
        'gemini':        'Gemini 3.5 Flash',
        'geminilite':    'Gemini 2.5 Lite',
        'groq':          'Groq'
      };
      showToast(`❌ 請先前往設定面板輸入 ${modelNames[model] || model} 的 API Key`, 4000);
      return;
    }

    try {
      updateLoadingText('正在將圖像傳送至 AI 模型...');
      startLoadingAnimation();

      const { base64, mimeType } = await window.AIService.fileToBase64(file);
      updateLoadingText(`正在使用 ${model} 進行深度視覺解構...`);

      let analysis;
      const lang = window.StudioSettings.getOutputLanguage();

      if (model.startsWith('openai')) {
        const key = window.StudioSettings.getOpenAIKey();
        analysis = await window.AIService.analyzeWithOpenAI(base64, key, mimeType, lang, model);
      } else if (model === 'geminilite') {
        const key = window.StudioSettings.getGeminiliteKey();
        analysis = await window.AIService.analyzeWithGeminilite(base64, key, mimeType, lang);
      } else {
        const key = window.StudioSettings.getGeminiKey();
        analysis = await window.AIService.analyzeWithGemini(base64, key, mimeType, 'gemini-3.5-flash', lang);
      }

      currentAnalysis = analysis;
      finishLoadingAnimation();
      renderAnalysis(analysis);
      showToast(`✅ 視覺解構完成`);

    } catch (err) {
      console.error('AI analysis failed:', err);
      stopLoadingAnimation();
      decodeLoading.classList.add('hidden');
      dropZone.classList.remove('hidden');
      showToast('❌ 分析失敗：' + err.message, 5000);
    }
  }

  function updateLoadingText(text) {
    const el = document.querySelector('.loading-text');
    if (el) el.textContent = text;
  }

  let loadingInterval = null;
  function startLoadingAnimation() {
    loadingBarFill.style.width = '0%';
    let progress = 0;
    loadingInterval = setInterval(() => {
      progress += (90 - progress) * 0.03;
      loadingBarFill.style.width = Math.min(progress, 90) + '%';
    }, 200);
  }

  function finishLoadingAnimation() {
    if (loadingInterval) clearInterval(loadingInterval);
    loadingBarFill.style.width = '100%';
    setTimeout(() => {
      decodeLoading.classList.add('hidden');
      decodeResult.classList.remove('hidden');
      expandAllSections();
    }, 300);
  }

  function stopLoadingAnimation() {
    if (loadingInterval) clearInterval(loadingInterval);
    loadingBarFill.style.width = '0%';
  }

  function expandAllSections() {
    document.querySelectorAll('.dash-collapsible').forEach(el => {
      el.classList.add('expanded');
    });
    document.querySelectorAll('.dash-toggle').forEach(btn => {
      btn.textContent = '收合 ▴';
    });
  }

  // ── Add-to-vault helper ──
  // thumbnail (optional): overrides the default decoded-image thumbnail.
  //   - omit  → uses the current decoded image (previewImg.src)
  //   - object { type: 'palette', colors: [...] } → renders colour swatches
  //   - null  → no thumbnail
  function addVaultButton(container, title, schemaKey, value, thumbnail) {
    if (!container || !value || value === 'N/A' || value === 'null') return;
    // Remove only a direct-child vault button (not those in descendant elements)
    const existing = container.querySelector(':scope > .add-to-vault-btn');
    if (existing) existing.remove();

    const btn = document.createElement('button');
    btn.className = 'add-to-vault-btn';
    btn.innerHTML = '📥 存入詞庫';
    btn.title = `將「${title}」存入提示詞庫`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!window.PromptsService) {
        showToast('提示詞庫模組尚未載入');
        return;
      }
      // Default thumbnail = the currently decoded image (persistable data-URL)
      let thumb = thumbnail;
      if (thumb === undefined) {
        thumb = currentImageThumb || null;
      }
      const category = window.PromptsService.getCategoryForSchemaKey(schemaKey);
      window.PromptsService.openAddModal({
        title: title,
        category: category || '其他',
        content: value,
        thumbnail: thumb
      });
    });
    container.appendChild(btn);
  }

  // ── Rendering Functions ──
  function renderAnalysis(analysis) {
    renderPalette(analysis.analysis_metadata.color_palette);
    renderMood(analysis.analysis_metadata.mood_and_atmosphere);
    renderMetadata(analysis.analysis_metadata);
    renderElements(analysis.separated_elements_breakdown);
    renderLighting(analysis.lighting_physics, analysis.camera_simulation);
    renderMaterials(analysis.material_and_texture_notes);
    renderNegativeConstraints(analysis.inferred_negative_constraints);

    const promptText = buildPromptText(analysis);
    promptOutput.value = promptText;

    window.StudioState.decodeResult = { 
      palette: analysis.analysis_metadata.color_palette, 
      styleTags: [], // Kept for workflow compatibility
      promptText, 
      originalPromptText: promptText,
      isNaturalLanguage: false,
      naturalPromptText: null,
      analysis 
    };
    if (document.getElementById('toNaturalBtn')) {
      document.getElementById('toNaturalBtn').textContent = '轉換為自然語言';
    }
    
    if (window.workflowMarkReady) window.workflowMarkReady(1);
  }

  function renderPalette(palette) {
    paletteRow.innerHTML = '';
    (palette || []).forEach(hex => {
      const block = document.createElement('div');
      block.className = 'palette-color';
      block.style.backgroundColor = hex;
      const text = document.createElement('span');
      text.className = 'color-hex';
      text.textContent = hex.toUpperCase();
      block.appendChild(text);
      paletteRow.appendChild(block);
    });

    // Allow saving the whole palette to the vault (thumbnail = colour swatches)
    const paletteCard = paletteRow.closest('.dash-card');
    if (paletteCard && palette && palette.length) {
      addVaultButton(
        paletteCard,
        '色彩色盤',
        'color_palette',
        palette.join(', '),
        { type: 'palette', colors: palette.slice() }
      );
    }
  }

  function renderMood(text) {
    moodText.textContent = text;
    addVaultButton(moodText.parentElement, '氛圍描述', 'mood_and_atmosphere', text);
  }
  
  function renderMetadata(meta) {
    metaStyle.textContent = meta.estimated_style || 'N/A';
    addVaultButton(metaStyle.parentElement, '風格推估', 'estimated_style', meta.estimated_style);
  }

  function renderElements(el) {
    elForeground.textContent = el.foreground_fx || 'N/A';
    addVaultButton(elForeground.parentElement, '前景特效', 'foreground_fx', el.foreground_fx);

    elSubjectIdentity.textContent = el.main_subject?.identity || 'N/A';
    addVaultButton(elSubjectIdentity.closest('.subject-item'), '主體身分', 'identity', el.main_subject?.identity);

    elSubjectClothing.textContent = el.main_subject?.clothing_or_surface || 'N/A';
    addVaultButton(elSubjectClothing.closest('.subject-item'), '服裝/表面', 'clothing_or_surface', el.main_subject?.clothing_or_surface);

    elSubjectPose.textContent = el.main_subject?.pose_and_action || 'N/A';
    addVaultButton(elSubjectPose.closest('.subject-item'), '姿勢與動作', 'pose_and_action', el.main_subject?.pose_and_action);

    elMidground.textContent = el.midground_objects || 'N/A';
    addVaultButton(elMidground.parentElement, '中景物件', 'midground_objects', el.midground_objects);

    elBackground.textContent = el.background_environment || 'N/A';
    addVaultButton(elBackground.parentElement, '背景環境', 'background_environment', el.background_environment);

    const otherVal = el.other_elements && el.other_elements !== 'null' ? el.other_elements : null;
    if (elOtherSection) elOtherSection.style.display = otherVal ? '' : 'none';
    if (elOther) {
      elOther.textContent = otherVal || '';
      if (otherVal) addVaultButton(elOther.parentElement, '其他元素', 'other_elements', otherVal);
    }
  }

  function renderLighting(light, cam) {
    lightDirection.textContent = light.key_light?.direction || 'N/A';
    lightColorTemp.textContent = light.key_light?.color_temp || 'N/A';
    lightQuality.textContent = light.key_light?.quality || 'N/A';
    lightFill.textContent = light.fill_and_rim_lights || 'N/A';

    // Combine all lighting info for vault
    const lightingText = `Direction: ${light.key_light?.direction || 'N/A'}, Color Temp: ${light.key_light?.color_temp || 'N/A'}, Quality: ${light.key_light?.quality || 'N/A'}, Fill/Rim: ${light.fill_and_rim_lights || 'N/A'}`;
    const lightSection = lightFill.closest('.lighting-section');
    if (lightSection) addVaultButton(lightSection, '光影參數', 'lighting', lightingText);

    cameraLens.textContent = cam.estimated_lens || 'N/A';
    cameraDof.textContent = cam.depth_of_field || 'N/A';
    cameraAngle.textContent = cam.camera_angle || 'N/A';

    // Combine all camera info for vault
    const cameraText = `Lens: ${cam.estimated_lens || 'N/A'}, DoF: ${cam.depth_of_field || 'N/A'}, Angle: ${cam.camera_angle || 'N/A'}`;
    const camItem = cameraAngle.closest('.camera-item');
    if (camItem) addVaultButton(camItem, '攝影參數', 'camera', cameraText);
  }

  function renderMaterials(mats) {
    materialsList.innerHTML = '';
    for (const [key, value] of Object.entries(mats || {})) {
      const item = document.createElement('div');
      item.className = 'material-item';
      const name = document.createElement('div');
      name.className = 'material-name';
      name.textContent = key.replace(/_/g, ' ');
      const desc = document.createElement('div');
      desc.className = 'material-desc';
      desc.textContent = value;
      item.appendChild(name);
      item.appendChild(desc);
      addVaultButton(item, key.replace(/_/g, ' '), 'material', `${key.replace(/_/g, ' ')}: ${value}`);
      materialsList.appendChild(item);
    }
  }

  function renderNegativeConstraints(constraints) {
    negativeList.innerHTML = '';
    const list = constraints || [];
    list.forEach(text => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.className = 'negative-text';
      span.textContent = text;
      li.appendChild(span);
      // Per-item vault button (single constraint)
      addVaultButton(li, `負面約束：${text}`, 'negative', text);
      negativeList.appendChild(li);
    });

    // Whole-group vault button (all constraints merged)
    const negCard = negativeList.closest('.dash-card');
    if (negCard && list.length) {
      addVaultButton(negCard, '負面約束（整組）', 'negative', list.join(', '));
    }
  }

  // ── Prompt builder ──
  function buildPromptText(analysis) {
    const meta = analysis.analysis_metadata;
    const el = analysis.separated_elements_breakdown;
    const light = analysis.lighting_physics;
    const cam = analysis.camera_simulation;
    const mats = analysis.material_and_texture_notes || {};

    let matStr = Object.values(mats).join(', ');

    const parts = [
      `/imagine prompt:`,
      `[Style & Vibe] ${meta.estimated_style}. ${meta.mood_and_atmosphere}.`,
      `[Subject] ${el.main_subject.identity}, wearing/surfaced with ${el.main_subject.clothing_or_surface}, posing as ${el.main_subject.pose_and_action}.`,
      `[Environment] Foreground: ${el.foreground_fx}. Midground: ${el.midground_objects}. Background: ${el.background_environment}.`,
      (el.other_elements && el.other_elements !== 'null') ? `[Other Elements] ${el.other_elements}.` : '',
      `[Lighting & Camera] Key light from ${light.key_light.direction} (${light.key_light.color_temp}, ${light.key_light.quality}). Fill/Rim: ${light.fill_and_rim_lights}. Shot with ${cam.estimated_lens}, ${cam.depth_of_field}, ${cam.camera_angle}.`,
      matStr ? `[Materials & Textures] ${matStr}.` : '',
      `[Color Palette] ${meta.color_palette.join(', ')}`,
      `--no ${analysis.inferred_negative_constraints.join(', ')} --v 6.0`
    ];
    return parts.filter(p => p.trim() !== '').join('\n');
  }

  // ── Button handlers ──
  if (toNaturalBtn) {
    toNaturalBtn.addEventListener('click', async () => {
      const state = window.StudioState.decodeResult;
      if (!state || !state.originalPromptText) {
        showToast('目前沒有可轉換的提示詞');
        return;
      }
      
      if (state.isNaturalLanguage) {
        state.isNaturalLanguage = false;
        state.promptText = state.originalPromptText;
        promptOutput.value = state.originalPromptText;
        toNaturalBtn.textContent = '轉換為自然語言';
        showToast('已切換回結構化提示詞');
        return;
      }

      if (state.naturalPromptText) {
        state.isNaturalLanguage = true;
        state.promptText = state.naturalPromptText;
        promptOutput.value = state.naturalPromptText;
        toNaturalBtn.textContent = '切換回結構化提示詞';
        showToast('已切換為自然語言');
        return;
      }
      
      const prevText = toNaturalBtn.textContent;
      toNaturalBtn.textContent = '轉換中...';
      toNaturalBtn.disabled = true;
      
      try {
        const model = modelSelect ? modelSelect.value : 'gemini';
        let key = '';
        if (model.startsWith('openai')) key = window.StudioSettings.getOpenAIKey();
        else if (model === 'geminilite') key = window.StudioSettings.getGeminiliteKey();
        else key = window.StudioSettings.getGeminiKey();
        
        const lang = window.StudioSettings.getOutputLanguage();
        
        const newPrompt = await window.AIService.rewriteToNaturalLanguage(state.originalPromptText, key, model, lang);
        
        state.naturalPromptText = newPrompt;
        state.isNaturalLanguage = true;
        state.promptText = newPrompt;
        promptOutput.value = newPrompt;
        toNaturalBtn.textContent = '切換回結構化提示詞';
        showToast('✅ 轉換成功！');
      } catch (e) {
        console.error(e);
        showToast('❌ 轉換失敗：' + e.message, 5000);
        toNaturalBtn.textContent = prevText;
      } finally {
        toNaturalBtn.disabled = false;
      }
    });
  }

  if (promptOutput) {
    promptOutput.addEventListener('input', (e) => {
      const state = window.StudioState.decodeResult;
      if (state) {
        state.promptText = e.target.value;
        if (state.isNaturalLanguage) {
          state.naturalPromptText = e.target.value;
        } else {
          state.originalPromptText = e.target.value;
        }
      }
    });
  }

  copyPromptBtn.addEventListener('click', () => {
    const text = promptOutput.value;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => showToast('提示詞已複製！'));
  });

  sendToWorkflowBtn.addEventListener('click', () => {
    if (window.workflowReceivePrompt) window.workflowReceivePrompt(promptOutput.value);
    switchPanel('workflow');
    showToast('已送至工作流 Step 3');
  });

  exportJsonBtn.addEventListener('click', () => {
    if (!currentAnalysis) return;
    const json = JSON.stringify(currentAnalysis, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'visual-decompiler-report.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('JSON 報告已下載');
  });
})();
