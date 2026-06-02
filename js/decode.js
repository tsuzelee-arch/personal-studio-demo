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

  let currentAnalysis = null;
  let currentFile = null;

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
        'openai': 'ChatGPT 5.5',
        'gemini': 'Gemini 3.5 Flash',
        'geminilite': 'Gemini 2.5 Lite',
        'groq': 'Groq'
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

      if (model === 'openai') {
        const key = window.StudioSettings.getOpenAIKey();
        analysis = await window.AIService.analyzeWithOpenAI(base64, key, mimeType, lang);
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
    promptOutput.textContent = promptText;

    window.StudioState.decodeResult = { 
      palette: analysis.analysis_metadata.color_palette, 
      styleTags: [], // Kept for workflow compatibility
      promptText, 
      analysis 
    };
    
    if (window.workflowMarkReady) window.workflowMarkReady(1);
  }

  function renderPalette(palette) {
    paletteRow.innerHTML = '';
    palette.forEach(hex => {
      const block = document.createElement('div');
      block.className = 'palette-color';
      block.style.backgroundColor = hex;
      const text = document.createElement('span');
      text.className = 'color-hex';
      text.textContent = hex.toUpperCase();
      block.appendChild(text);
      paletteRow.appendChild(block);
    });
  }

  function renderMood(text) { moodText.textContent = text; }
  
  function renderMetadata(meta) {
    metaStyle.textContent = meta.estimated_style || 'N/A';
  }

  function renderElements(el) {
    elForeground.textContent = el.foreground_fx || 'N/A';
    elSubjectIdentity.textContent = el.main_subject?.identity || 'N/A';
    elSubjectClothing.textContent = el.main_subject?.clothing_or_surface || 'N/A';
    elSubjectPose.textContent = el.main_subject?.pose_and_action || 'N/A';
    elMidground.textContent = el.midground_objects || 'N/A';
    elBackground.textContent = el.background_environment || 'N/A';
  }

  function renderLighting(light, cam) {
    lightDirection.textContent = light.key_light?.direction || 'N/A';
    lightColorTemp.textContent = light.key_light?.color_temp || 'N/A';
    lightQuality.textContent = light.key_light?.quality || 'N/A';
    lightFill.textContent = light.fill_and_rim_lights || 'N/A';
    cameraLens.textContent = cam.estimated_lens || 'N/A';
    cameraDof.textContent = cam.depth_of_field || 'N/A';
    cameraAngle.textContent = cam.camera_angle || 'N/A';
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
      materialsList.appendChild(item);
    }
  }

  function renderNegativeConstraints(constraints) {
    negativeList.innerHTML = '';
    (constraints || []).forEach(text => {
      const li = document.createElement('li');
      li.textContent = text;
      negativeList.appendChild(li);
    });
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
      `[Lighting & Camera] Key light from ${light.key_light.direction} (${light.key_light.color_temp}, ${light.key_light.quality}). Fill/Rim: ${light.fill_and_rim_lights}. Shot with ${cam.estimated_lens}, ${cam.depth_of_field}, ${cam.camera_angle}.`,
      matStr ? `[Materials & Textures] ${matStr}.` : '',
      `[Color Palette] ${meta.color_palette.join(', ')}`,
      `--no ${analysis.inferred_negative_constraints.join(', ')} --v 6.0`
    ];
    return parts.filter(p => p.trim() !== '').join('\n');
  }

  // ── Button handlers ──
  copyPromptBtn.addEventListener('click', () => {
    const text = promptOutput.textContent;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => showToast('提示詞已複製！'));
  });

  sendToWorkflowBtn.addEventListener('click', () => {
    if (window.workflowReceivePrompt) window.workflowReceivePrompt(promptOutput.textContent);
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
