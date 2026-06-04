(function() {
  const cardPreview    = document.getElementById('cardPreview');
  const previewPlaceholder = document.getElementById('previewPlaceholder');
  const imageInput     = document.getElementById('imageInput');
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
  const elCreativeTheme = document.getElementById('elCreativeTheme');
  const metaStyle      = document.getElementById('metaStyle');
  const elDimensions   = document.getElementById('elDimensions');
  
  const elForeground   = document.getElementById('elForeground');
  const elSubjectIdentity = document.getElementById('elSubjectIdentity');
  const elSubjectSource   = document.getElementById('elSubjectSource');
  const elSubjectClothing = document.getElementById('elSubjectClothing');
  const elSubjectPose  = document.getElementById('elSubjectPose');
  const elMidground    = document.getElementById('elMidground');
  const elBackground   = document.getElementById('elBackground');
  const elComposition  = document.getElementById('elComposition');
  
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
  const translationsCache = {}; // keyed by language code

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
  imageInput.addEventListener('change', e => { if (e.target.files[0]) loadImage(e.target.files[0]); });

  cardPreview.addEventListener('dragover', e => { e.preventDefault(); cardPreview.style.border = '2px dashed #007aff'; });
  cardPreview.addEventListener('dragleave', () => cardPreview.style.border = '');
  cardPreview.addEventListener('drop', e => {
    e.preventDefault();
    cardPreview.style.border = '';
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadImage(file);
  });

  // Paste image directly (Ctrl+V) when decode panel is active
  document.addEventListener('paste', (e) => {
    const panelActive = document.getElementById('panel-decode')?.classList.contains('active');
    if (!panelActive) return;
    const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    if (file) loadImage(file);
  });

  resetDecodeBtn.addEventListener('click', resetDecode);

  function resetDecode() {
    decodeLoading.classList.add('hidden');
    previewImg.style.display = 'none';
    previewImg.src = '';
    previewPlaceholder.style.display = 'flex';
    imageInput.value = '';
    currentAnalysis = null;
    currentFile = null;
    currentImageThumb = null;
    window.StudioState.decodeResult = null;
    Object.keys(translationsCache).forEach(k => delete translationsCache[k]);
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
      previewPlaceholder.style.display = 'none';
      previewImg.style.display = 'block';
      previewImg.src = url;
      // Add lightbox on click
      previewImg.onclick = () => {
        if (window.AssetsService) {
          window.AssetsService.openLightBox(url, '解構影像', true);
        }
      };
      previewImg.style.cursor = 'pointer';
      currentImageThumb = makeThumbnail(img);
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
      previewImg.style.display = 'none';
      previewImg.src = '';
      previewPlaceholder.style.display = 'flex';
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
      if (window.StudioSettings && window.StudioSettings.getOutputLanguage) {
        translationsCache[window.StudioSettings.getOutputLanguage()] = analysis;
      }
      finishLoadingAnimation(() => renderAnalysis(analysis));
      showToast(`✅ 視覺解構完成`);

    } catch (err) {
      console.error('AI analysis failed:', err);
      stopLoadingAnimation();
      decodeLoading.classList.add('hidden');
      previewImg.style.display = 'none';
      previewImg.src = '';
      previewPlaceholder.style.display = 'flex';
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

  function finishLoadingAnimation(onVisible) {
    if (loadingInterval) clearInterval(loadingInterval);
    loadingBarFill.style.width = '100%';
    setTimeout(() => {
      decodeLoading.classList.add('hidden');
      decodeResult.classList.remove('hidden');
      expandAllSections();
      if (onVisible) onVisible();
      // Re-run autoResize now that elements are visible (scrollHeight is valid)
      decodeResult.querySelectorAll('textarea.editable-field').forEach(autoResize);
      setTimeout(() => {
        if (!decodeResult.classList.contains('hidden')) {
          decodeResult.querySelectorAll('textarea.editable-field').forEach(autoResize);
        }
      }, 450);
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

  // Auto-resize a textarea to fit its content
  function autoResize(el) {
    if (el && el.tagName === 'TEXTAREA') {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }

  // ── Add-to-vault helper ──
  // valueOrGetter: string value OR () => string (read at click time for editable fields)
  // thumbnail (optional): overrides the default decoded-image thumbnail.
  //   - omit  → uses the current decoded image (persistable data-URL)
  //   - object { type: 'palette', colors: [...] } → renders colour swatches
  //   - null  → no thumbnail
  function addVaultButton(container, title, schemaKey, valueOrGetter, thumbnail) {
    const peekValue = typeof valueOrGetter === 'function' ? valueOrGetter() : valueOrGetter;
    if (!container || !peekValue || peekValue === 'N/A' || peekValue === 'null') return;
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
      const value = typeof valueOrGetter === 'function' ? valueOrGetter() : valueOrGetter;
      if (!value || value === 'N/A' || value === 'null') {
        showToast('沒有內容可存入');
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
    renderMetadata(analysis.analysis_metadata, analysis.image_dimensions_and_resolution);
    renderElements(analysis.separated_elements_breakdown);
    renderLighting(analysis.lighting_physics, analysis.camera_simulation);
    renderMaterials(analysis.material_and_texture_notes);
    renderNegativeConstraints(analysis.inferred_negative_constraints);

    const promptText = buildPromptText(analysis);
    if (window.EditorService) {
      window.EditorService.setContent('promptOutput', promptText);
    } else if (promptOutput) {
      promptOutput.value = promptText;
    }

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
      block.className = 'swatch';
      block.style.backgroundColor = hex;
      const text = document.createElement('span');
      text.className = 'swatch-hex';
      text.textContent = hex.toUpperCase();
      const del = document.createElement('button');
      del.className = 'palette-delete-btn';
      del.title = '移除此色';
      del.textContent = '×';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = currentAnalysis.analysis_metadata.color_palette.indexOf(hex);
        if (idx !== -1) currentAnalysis.analysis_metadata.color_palette.splice(idx, 1);
        renderPalette(currentAnalysis.analysis_metadata.color_palette);
        // Re-attach vault button after re-render
        const paletteCard = paletteRow.closest('.dash-card');
        const pal = currentAnalysis.analysis_metadata.color_palette;
        if (paletteCard && pal.length) {
          addVaultButton(paletteCard, '色彩色盤', 'color_palette', pal.join(', '), { type: 'palette', colors: pal.slice() });
        }
      });
      block.appendChild(text);
      block.appendChild(del);
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
    moodText.value = text;
    autoResize(moodText);
    addVaultButton(moodText.parentElement, '氛圍描述', 'mood_and_atmosphere', () => moodText.value);
  }

  function renderMetadata(meta, dim) {
    elCreativeTheme.value = meta.creative_theme || 'N/A';
    autoResize(elCreativeTheme);
    addVaultButton(elCreativeTheme.parentElement, '創作主題', 'creative_theme', () => elCreativeTheme.value);

    metaStyle.value = meta.estimated_style || 'N/A';
    autoResize(metaStyle);
    addVaultButton(metaStyle.parentElement, '風格推估', 'estimated_style', () => metaStyle.value);

    elDimensions.value = dim || 'N/A';
    autoResize(elDimensions);
    addVaultButton(elDimensions.parentElement, '圖像尺寸', 'image_dimensions', () => elDimensions.value);
  }

  function renderElements(el) {
    elForeground.value = el.foreground_fx || 'N/A';
    autoResize(elForeground);
    addVaultButton(elForeground.parentElement, '前景特效', 'foreground_fx', () => elForeground.value);

    elSubjectIdentity.value = el.main_subject?.identity || 'N/A';
    autoResize(elSubjectIdentity);
    addVaultButton(elSubjectIdentity.closest('.subject-item'), '主體身分', 'identity', () => elSubjectIdentity.value);

    elSubjectSource.value = el.main_subject?.character_source || 'N/A';
    autoResize(elSubjectSource);
    addVaultButton(elSubjectSource.closest('.subject-item'), '角色出處', 'character_source', () => elSubjectSource.value);

    elSubjectClothing.value = el.main_subject?.clothing_or_surface || 'N/A';
    autoResize(elSubjectClothing);
    addVaultButton(elSubjectClothing.closest('.subject-item'), '服裝/表面', 'clothing_or_surface', () => elSubjectClothing.value);

    elSubjectPose.value = el.main_subject?.pose_and_action || 'N/A';
    autoResize(elSubjectPose);
    addVaultButton(elSubjectPose.closest('.subject-item'), '姿勢與動作', 'pose_and_action', () => elSubjectPose.value);

    elMidground.value = el.midground_objects || 'N/A';
    autoResize(elMidground);
    addVaultButton(elMidground.parentElement, '中景物件', 'midground_objects', () => elMidground.value);

    elBackground.value = el.background_environment || 'N/A';
    autoResize(elBackground);
    addVaultButton(elBackground.parentElement, '背景環境', 'background_environment', () => elBackground.value);

    elComposition.value = el.main_visual_composition || 'N/A';
    autoResize(elComposition);
    addVaultButton(elComposition.parentElement, '主視覺構圖', 'main_visual_composition', () => elComposition.value);

    const otherVal = el.other_elements && el.other_elements !== 'null' ? el.other_elements : null;
    if (elOtherSection) elOtherSection.style.display = otherVal ? '' : 'none';
    if (elOther) {
      elOther.value = otherVal || '';
      autoResize(elOther);
      if (otherVal) addVaultButton(elOther.parentElement, '其他元素', 'other_elements', () => elOther.value);
    }
  }

  function renderLighting(light, cam) {
    lightDirection.value = light.key_light?.direction || 'N/A';
    lightColorTemp.value = light.key_light?.color_temp || 'N/A';
    lightQuality.value = light.key_light?.quality || 'N/A';
    lightFill.value = light.fill_and_rim_lights || 'N/A';
    autoResize(lightFill);

    // Read current field values at click time so edits are captured
    const lightSection = lightFill.closest('.lighting-section');
    if (lightSection) addVaultButton(lightSection, '光影參數', 'lighting',
      () => `Direction: ${lightDirection.value}, Color Temp: ${lightColorTemp.value}, Quality: ${lightQuality.value}, Fill/Rim: ${lightFill.value}`
    );

    cameraLens.value = cam.estimated_lens || 'N/A';
    cameraDof.value = cam.depth_of_field || 'N/A';
    cameraAngle.value = cam.camera_angle || 'N/A';

    const camItem = cameraAngle.closest('.camera-item');
    if (camItem) addVaultButton(camItem, '攝影參數', 'camera',
      () => `Lens: ${cameraLens.value}, DoF: ${cameraDof.value}, Angle: ${cameraAngle.value}`
    );
  }

  function renderMaterials(mats) {
    materialsList.innerHTML = '';
    for (const [key, value] of Object.entries(mats || {})) {
      const item = document.createElement('div');
      item.className = 'material-item';
      const name = document.createElement('div');
      name.className = 'material-name';
      name.textContent = key.replace(/_/g, ' ');
      const desc = document.createElement('textarea');
      desc.className = 'material-desc editable-field';
      desc.value = value;
      autoResize(desc);
      item.appendChild(name);
      item.appendChild(desc);
      const keyLabel = key.replace(/_/g, ' ');
      addVaultButton(item, keyLabel, 'material', () => `${keyLabel}: ${desc.value}`);
      materialsList.appendChild(item);
    }
  }

  function renderNegativeConstraints(constraints) {
    negativeList.innerHTML = '';
    const list = constraints || [];
    list.forEach(text => {
      const li = document.createElement('li');
      const ta = document.createElement('textarea');
      ta.className = 'negative-text editable-field';
      ta.value = text;
      autoResize(ta);
      ta.addEventListener('input', () => autoResize(ta));
      li.appendChild(ta);
      // Per-item vault button reads live textarea value
      addVaultButton(li, `負面約束：${text}`, 'negative', () => ta.value);
      negativeList.appendChild(li);
    });

    // Whole-group vault button reads live textarea values
    const negCard = negativeList.closest('.dash-card');
    if (negCard && list.length) {
      addVaultButton(negCard, '負面約束（整組）', 'negative', () =>
        Array.from(negativeList.querySelectorAll('textarea.negative-text')).map(t => t.value).join(', ')
      );
    }
  }

  // ── Prompt builder ──
  function buildPromptText(analysis) {
    const meta = analysis.analysis_metadata;
    const el = analysis.separated_elements_breakdown;
    const light = analysis.lighting_physics;
    const cam = analysis.camera_simulation;
    const mats = analysis.material_and_texture_notes || {};

    const matStr = Object.values(mats).join(', ');
    const subject = [el.main_subject.identity, el.main_subject.character_source, el.main_subject.clothing_or_surface, el.main_subject.pose_and_action]
      .filter(s => s && s !== 'null' && s !== 'N/A').join(', ');
    const env = [el.foreground_fx, el.midground_objects, el.background_environment, el.main_visual_composition]
      .filter(s => s && s !== 'null' && s !== 'N/A').join(', ');

    const parts = [
      meta.creative_theme && meta.creative_theme !== 'null' && meta.creative_theme !== 'N/A' ? meta.creative_theme : '',
      `${meta.estimated_style}, ${meta.mood_and_atmosphere}`,
      subject,
      env,
      (el.other_elements && el.other_elements !== 'null') ? el.other_elements : '',
      `key light ${light.key_light.direction}, ${light.key_light.color_temp}, ${light.key_light.quality}, ${light.fill_and_rim_lights}`,
      `${cam.estimated_lens}, ${cam.depth_of_field}, ${cam.camera_angle}`,
      matStr,
      meta.color_palette.join(', '),
      `--no ${analysis.inferred_negative_constraints.join(', ')}`
    ];
    return parts.filter(p => p && p.trim() !== '').join(', ');
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
        if (window.EditorService) {
          window.EditorService.setContent('promptOutput', state.originalPromptText);
        } else if (promptOutput) {
          promptOutput.value = state.originalPromptText;
        }
        toNaturalBtn.textContent = '轉換為自然語言';
        showToast('已切換回結構化提示詞');
        return;
      }

      if (state.naturalPromptText) {
        state.isNaturalLanguage = true;
        state.promptText = state.naturalPromptText;
        if (window.EditorService) {
          window.EditorService.setContent('promptOutput', state.naturalPromptText);
        } else if (promptOutput) {
          promptOutput.value = state.naturalPromptText;
        }
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
        if (window.EditorService) {
          window.EditorService.setContent('promptOutput', newPrompt);
        } else if (promptOutput) {
          promptOutput.value = newPrompt;
        }
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
    const text = window.EditorService ? window.EditorService.getContent('promptOutput') : promptOutput.value;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => showToast('提示詞已複製！'));
  });

  sendToWorkflowBtn.addEventListener('click', () => {
    const text = window.EditorService ? window.EditorService.getContent('promptOutput') : promptOutput.value;
    if (window.workflowReceivePrompt) window.workflowReceivePrompt(text);
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

  // ── Language switch: translate existing decode result on-the-fly ──
  const languageSelect = document.getElementById('languageSelect');
  if (languageSelect) {
    languageSelect.addEventListener('change', async () => {
      if (!currentAnalysis) return;
      const lang = languageSelect.value;
      const model = modelSelect ? modelSelect.value : 'gemini';
      if (!window.StudioSettings.hasApiKey(model)) {
        showToast('❌ 請先設定 API Key', 3000);
        return;
      }
      updateLoadingText('正在翻譯解析結果...');
      startLoadingAnimation();
      decodeResult.classList.add('hidden');
      decodeLoading.classList.remove('hidden');
      try {
        let translated;
        if (translationsCache[lang]) {
          translated = translationsCache[lang];
        } else {
          let key = '';
          if (model.startsWith('openai')) key = window.StudioSettings.getOpenAIKey();
          else if (model === 'geminilite') key = window.StudioSettings.getGeminiliteKey();
          else key = window.StudioSettings.getGeminiKey();
          translated = await window.AIService.translateAnalysis(currentAnalysis, lang, key, model);
          translationsCache[lang] = translated;
        }
        currentAnalysis = translated;
        // Reset natural language state since the language changed
        if (window.StudioState.decodeResult) {
          window.StudioState.decodeResult.isNaturalLanguage = false;
          window.StudioState.decodeResult.naturalPromptText = null;
        }
        if (document.getElementById('toNaturalBtn')) {
          document.getElementById('toNaturalBtn').textContent = '轉換為自然語言';
        }
        finishLoadingAnimation(() => {
          renderAnalysis(translated);
          showToast('✅ 翻譯完成');
        });
      } catch (err) {
        console.error('Translation failed:', err);
        stopLoadingAnimation();
        decodeLoading.classList.add('hidden');
        decodeResult.classList.remove('hidden');
        showToast('❌ 翻譯失敗：' + err.message, 5000);
      }
    });
  }

  // Initialize Rich Editor
  setTimeout(() => {
    if (window.EditorService) window.EditorService.setupRichPromptEditor('promptOutput');
  }, 500);
})();
