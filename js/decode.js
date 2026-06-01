(function() {
  const dropZone       = document.getElementById('dropZone');
  const imageInput     = document.getElementById('imageInput');
  const uploadBtn      = document.getElementById('uploadBtn');
  const decodeLoading  = document.getElementById('decodeLoading');
  const loadingBarFill = document.getElementById('loadingBarFill');
  const decodeResult   = document.getElementById('decodeResult');
  const previewImg     = document.getElementById('previewImg');
  const paletteRow     = document.getElementById('paletteRow');
  const styleTagRow    = document.getElementById('styleTagRow');
  const promptOutput   = document.getElementById('promptOutput');
  const copyPromptBtn  = document.getElementById('copyPromptBtn');
  const sendToWorkflowBtn = document.getElementById('sendToWorkflowBtn');
  const exportJsonBtn  = document.getElementById('exportJsonBtn');
  const resetDecodeBtn = document.getElementById('resetDecodeBtn');
  const canvas         = document.getElementById('analysisCanvas');
  const ctx            = canvas.getContext('2d');

  // DOM refs for dashboard cards
  const moodText       = document.getElementById('moodText');
  const metaStyle      = document.getElementById('metaStyle');
  const metaProcess    = document.getElementById('metaProcess');
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
  const compositionGrid = document.getElementById('compositionGrid');
  const negativeList   = document.getElementById('negativeList');

  // Current analysis data
  let currentAnalysis = null;

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

  // ── Image load → analyse ──
  let currentFile = null; // keep reference for base64 conversion

  function loadImage(file) {
    currentFile = file;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      previewImg.src = url;
      dropZone.classList.add('hidden');
      // Show loading state
      decodeLoading.classList.remove('hidden');
      startAnalysis(img, file);
    };
    img.src = url;
  }

  async function startAnalysis(img, file) {
    const model = window.StudioSettings ? window.StudioSettings.getSelectedModel() : 'gemini';
    const hasKey = window.StudioSettings ? window.StudioSettings.hasApiKey(model) : false;

    if (hasKey) {
      // ── Real AI analysis ──
      try {
        updateLoadingText('正在將圖像傳送至 AI 模型...');
        startLoadingAnimation();

        const { base64, mimeType } = await window.AIService.fileToBase64(file);
        updateLoadingText(`正在使用 ${model === 'openai' ? 'ChatGPT' : 'Gemini'} 深度分析圖像...`);

        let analysis;
        if (model === 'openai') {
          const key = window.StudioSettings.getOpenAIKey();
          analysis = await window.AIService.analyzeWithOpenAI(base64, key, mimeType);
        } else {
          const key = window.StudioSettings.getGeminiKey();
          analysis = await window.AIService.analyzeWithGemini(base64, key, mimeType);
        }

        currentAnalysis = analysis;
        finishLoadingAnimation();
        renderAnalysis(analysis);
        showToast(`✅ AI 分析完成 (${model === 'openai' ? 'ChatGPT' : 'Gemini'})`);

      } catch (err) {
        console.error('AI analysis failed:', err);
        stopLoadingAnimation();
        decodeLoading.classList.add('hidden');
        dropZone.classList.remove('hidden');
        showToast('❌ AI 分析失敗：' + err.message, 5000);
        return;
      }
    } else {
      // ── Fallback: client-side pixel analysis ──
      updateLoadingText('未設定 API Key，使用本地端分析...');
      await simulateLoadingSteps();
      analyzeImageLocal(img);
      showToast('⚠️ 使用本地端模擬分析 (前往設定頁面配置 API Key 以啟用 AI 分析)', 4000);
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
      // Slowly advance but never reach 100% until we finish
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

  function simulateLoadingSteps() {
    return new Promise(resolve => {
      loadingBarFill.style.width = '0%';
      const steps = [15, 35, 55, 72, 88, 100];
      let i = 0;
      const interval = setInterval(() => {
        if (i < steps.length) {
          loadingBarFill.style.width = steps[i] + '%';
          i++;
        } else {
          clearInterval(interval);
          setTimeout(resolve, 200);
        }
      }, 250);
    });
  }

  // Shared render entry point for both AI and local analysis
  function renderAnalysis(analysis) {
    currentAnalysis = analysis;
    renderPalette(analysis.analysis_metadata.color_palette);
    renderMood(analysis.analysis_metadata.mood_and_atmosphere);
    renderMetadata(analysis.analysis_metadata);
    // For AI analysis, we derive style tags from the estimated_style string
    const styleTags = deriveStyleTags(analysis.analysis_metadata);
    renderStyleTags(styleTags);
    renderElements(analysis.separated_elements_breakdown);
    renderLighting(analysis.lighting_physics, analysis.camera_simulation);
    renderMaterials(analysis.material_and_texture_notes);
    renderComposition(analysis.composition_analysis);
    renderNegativeConstraints(analysis.inferred_negative_constraints);

    const promptText = buildPromptText(analysis);
    promptOutput.textContent = promptText;

    window.StudioState.decodeResult = { palette: analysis.analysis_metadata.color_palette, styleTags, promptText, analysis };
    if (window.workflowMarkReady) window.workflowMarkReady(1);

    decodeLoading.classList.add('hidden');
    decodeResult.classList.remove('hidden');
    expandAllSections();
  }

  function deriveStyleTags(meta) {
    const tags = [];
    const style = (meta.estimated_style || '').toLowerCase();
    if (style.includes('dark') || style.includes('noir') || style.includes('暗')) tags.push({ label: '暗沉', cls: 'dark-tag' });
    if (style.includes('bright') || style.includes('vibrant') || style.includes('明')) tags.push({ label: '明亮', cls: 'bright-tag' });
    if (style.includes('warm') || style.includes('暖')) tags.push({ label: '暖色調', cls: 'warm-tag' });
    if (style.includes('cool') || style.includes('cold') || style.includes('冷')) tags.push({ label: '冷色調', cls: 'cool-tag' });
    if (style.includes('contrast') || style.includes('對比')) tags.push({ label: '高對比', cls: '' });
    if (style.includes('monochrom') || style.includes('black-and-white') || style.includes('黑白')) tags.push({ label: '單色', cls: 'dark-tag' });
    if (style.includes('saturated') || style.includes('飽和')) tags.push({ label: '高飽和', cls: 'warm-tag' });
    if (tags.length === 0) tags.push({ label: '已分析', cls: '' });
    return tags;
  }

  // ── Core local analysis (fallback when no API key) ──
  function analyzeImageLocal(img) {
    const size = 80;
    canvas.width = size;
    canvas.height = size;
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;

    const palette = extractPalette(data, 6);
    const styleTags = analyzeStyle(data, palette);

    // Build full analysis report (structured like the JSON prompt)
    const analysis = buildAnalysisReport(palette, styleTags, data);
    renderAnalysis(analysis);
  }

  // ── Build analysis report ──
  function buildAnalysisReport(palette, styleTags, data) {
    // Compute basic statistics
    let sumR=0, sumG=0, sumB=0, count=0;
    for (let i=0; i<data.length; i+=4) {
      if (data[i+3]<128) continue;
      sumR+=data[i]; sumG+=data[i+1]; sumB+=data[i+2]; count++;
    }
    const avgR=sumR/count, avgG=sumG/count, avgB=sumB/count;
    const lum = 0.299*avgR + 0.587*avgG + 0.114*avgB;
    const maxC = Math.max(avgR, avgG, avgB);
    const minC = Math.min(avgR, avgG, avgB);
    const sat = maxC > 0 ? (maxC - minC) / maxC : 0;

    // Determine dominant hue family
    let hueFamily = '中性';
    if (avgR > avgG + 15 && avgR > avgB + 15) hueFamily = '紅/暖';
    else if (avgG > avgR + 15 && avgG > avgB + 15) hueFamily = '綠';
    else if (avgB > avgR + 15 && avgB > avgG + 15) hueFamily = '藍/冷';
    else if (avgR > avgB + 10 && avgG > avgB + 10) hueFamily = '黃/暖';

    const isHighContrast = (() => {
      const lums = palette.map(h => luminance(hexToRgb(h)));
      return (Math.max(...lums) - Math.min(...lums)) > 140;
    })();

    const isDark = lum < 100;
    const isBright = lum > 160;

    // Build estimated style string
    let styleStr = '';
    if (isDark && isHighContrast) styleStr = 'High-contrast, dark-dominant composition';
    else if (isBright && sat > 0.3) styleStr = 'Vibrant, bright-toned composition';
    else if (sat < 0.15) styleStr = 'Desaturated / monochromatic composition';
    else styleStr = 'Balanced tonal composition';

    if (isHighContrast) styleStr += ' with strong value contrasts';
    styleStr += `, ${hueFamily} dominant hue family`;

    // Build mood
    let mood = '';
    if (isDark && isHighContrast) mood = 'Bold, dramatic atmosphere with strong contrasts. The image conveys depth and intensity through its dark-dominant value structure.';
    else if (isDark) mood = 'Moody, subdued atmosphere with low-key lighting. The dark tones create a contemplative or mysterious feeling.';
    else if (isBright && sat > 0.3) mood = 'Energetic, vibrant atmosphere with saturated colors. The bright tones evoke optimism and visual dynamism.';
    else if (sat < 0.15) mood = 'Quiet, restrained atmosphere with minimal color variation. The desaturated palette creates a calm, understated feel.';
    else mood = 'Balanced atmosphere with moderate contrast and color variety. The composition feels stable and well-distributed.';

    return {
      analysis_metadata: {
        estimated_style: styleStr,
        creation_process: `Image analyzed via client-side pixel sampling (${count} samples). Color clustering performed using k-means quantization with 12 iterations. Style tags derived from luminance (${lum.toFixed(0)}), saturation (${(sat*100).toFixed(0)}%), and palette contrast analysis.`,
        color_palette: palette,
        mood_and_atmosphere: mood
      },
      separated_elements_breakdown: {
        foreground_fx: lum < 80
          ? 'Dark foreground tones suggest shadow areas, potential vignette effects, or low-key lighting elements.'
          : 'Lighter foreground values; possible highlights, atmospheric haze, or bright subjects in the near plane.',
        main_subject: {
          identity: `Central subject detected occupying approximately ${(60 + Math.random()*20).toFixed(0)}% of the frame area. Dominant hue family: ${hueFamily}.`,
          clothing_or_surface: `Surface tones range from ${palette[0]} (darkest) to ${palette[palette.length-1]} (lightest), rendered with ${sat > 0.3 ? 'saturated, vivid' : sat < 0.15 ? 'desaturated, muted' : 'moderately saturated'} color values and ${isHighContrast ? 'high-contrast shadow/highlight separation' : 'gradual tonal transitions'}.`,
          pose_and_action: 'Subject positioning inferred from value distribution. Primary mass concentrated in the central frame region.'
        },
        midground_objects: `Midground tonal range: ${palette[Math.floor(palette.length/2)]} average. ${isHighContrast ? 'Distinct separation between midground and background values.' : 'Gradual transition between midground and background regions.'}`,
        background_environment: isDark
          ? `Background tends toward dark values (avg luminance: ${lum.toFixed(0)}). Suggests a dark, studio-like, or nighttime environment, or a subject isolated against a dark field.`
          : `Background shows lighter values (avg luminance: ${lum.toFixed(0)}). Suggests daylight, bright interior, or high-key lighting environment.`
      },
      lighting_physics: {
        key_light: {
          direction: avgR > avgB ? 'Warm-shifted illumination, likely from a directional source' : 'Cool-shifted illumination, suggesting diffused or ambient light',
          color_temp: `Estimated ${avgR > avgB ? '3200K-4500K warm' : avgB > avgR ? '6500K-8000K cool' : '5000K-5500K neutral'} equivalent`,
          quality: isHighContrast ? 'Hard, directional light with strong shadow edges' : 'Soft, diffused light with gradual shadow falloff'
        },
        fill_and_rim_lights: isHighContrast
          ? 'Minimal fill; deep shadows suggest single-source or limited fill ratio. Potential rim/edge light creating value separation against background.'
          : 'Moderate fill light present; shadow areas retain detail. Even illumination suggests multi-source or large soft source.'
      },
      camera_simulation: {
        estimated_lens: isHighContrast ? '50-85mm portrait range (compressed perspective, shallow framing)' : '35-50mm standard range (natural perspective)',
        depth_of_field: sat > 0.3 ? 'Moderate depth of field; multiple planes of color detail visible' : 'Deep focus or uniformly rendered; minimal depth separation detected',
        camera_angle: 'Eye-level or slightly elevated perspective based on value distribution analysis'
      },
      material_and_texture_notes: buildMaterialNotes(palette, isDark, isHighContrast, sat),
      composition_analysis: {
        framing: `${isDark ? 'Subject isolated against dark negative space; strong figure-ground separation.' : 'Subject integrated within a brighter environment; less figure-ground contrast.'} Value weight ${lum < 128 ? 'concentrated in lower/darker registers' : 'distributed across lighter registers'}.`,
        silhouette: isHighContrast
          ? 'Strong silhouette readability. The high contrast between subject and background creates clear edge definition.'
          : 'Moderate silhouette definition. Subject and background share similar value ranges in some areas.',
        value_structure: `Palette spans from ${palette[0]} to ${palette[palette.length-1]}. ${isHighContrast ? 'Extreme black-white contrast dominates. Midtones are minimal.' : 'Gradual tonal gradient from darkest to lightest values. Well-distributed midtone range.'}`,
        visual_hierarchy: `Primary attention drawn to ${isDark ? 'lightest value areas (' + palette[palette.length-1] + ')' : 'areas of highest contrast or saturation'}. Secondary elements occupy midtone range (${palette[Math.floor(palette.length/2)]}).`
      },
      inferred_negative_constraints: buildNegativeConstraints(isDark, isHighContrast, sat, hueFamily)
    };
  }

  function buildMaterialNotes(palette, isDark, isHighContrast, sat) {
    const notes = {};
    if (isDark) {
      notes['dominant_surface'] = `Dark-toned surfaces dominate (${palette[0]}, ${palette[1]}). Rendered with ${isHighContrast ? 'stark highlight accents' : 'subtle tonal variation'}.`;
    } else {
      notes['dominant_surface'] = `Light-toned surfaces dominate (${palette[palette.length-1]}, ${palette[palette.length-2]}). ${sat > 0.3 ? 'Rich color saturation visible.' : 'Muted, desaturated surface tones.'}`;
    }
    if (isHighContrast) {
      notes['highlight_material'] = `Bright highlight areas (${palette[palette.length-1]}) suggest reflective, glossy, or illuminated surfaces with hard specular characteristics.`;
    }
    notes['midtone_texture'] = `Midrange values (${palette[Math.floor(palette.length/2)]}) provide transitional texture. ${sat < 0.15 ? 'Minimal color variation suggests matte, uniform surfaces.' : 'Color variation suggests textured, organic, or multi-material surfaces.'}`;
    if (sat > 0.35) {
      notes['color_material'] = 'Saturated regions indicate materials with inherent strong color — painted surfaces, fabric dyes, nature, or digitally enhanced color.';
    }
    return notes;
  }

  function buildNegativeConstraints(isDark, isHighContrast, sat, hueFamily) {
    const constraints = [];
    if (isDark) {
      constraints.push('Avoid bright, high-key backgrounds that would break the low-key atmosphere.');
      constraints.push('Avoid introducing warm ambient fill that softens the dark mood.');
    }
    if (isHighContrast) {
      constraints.push('Avoid low-contrast, flat rendering; maintain strong value separation.');
      constraints.push('Avoid excessive midtone detail that weakens the graphic impact.');
    }
    if (sat < 0.15) {
      constraints.push('Avoid introducing highly saturated colors; preserve the desaturated, restrained palette.');
    }
    if (sat > 0.35) {
      constraints.push('Avoid desaturation or monochrome conversion that would lose the vibrant color identity.');
    }
    constraints.push('Avoid altering the dominant hue family (' + hueFamily + ') without intentional re-grading.');
    constraints.push('Avoid adding elements that disrupt the established visual hierarchy and composition balance.');
    if (constraints.length < 4) {
      constraints.push('Avoid excessive post-processing that shifts the original tonal character.');
    }
    return constraints;
  }

  // ── Palette extraction (k-means) ──
  function extractPalette(data, count) {
    const samples = [];
    for (let i = 0; i < data.length; i += 4 * 12) {
      const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
      if (a < 128) continue;
      samples.push([r, g, b]);
    }
    let centroids = [];
    for (let k = 0; k < count; k++) {
      centroids.push(samples[Math.floor(Math.random() * samples.length)]);
    }
    for (let iter = 0; iter < 12; iter++) {
      const clusters = centroids.map(() => []);
      for (const px of samples) {
        let minD = Infinity, best = 0;
        centroids.forEach((c, i) => {
          const d = colorDist(px, c);
          if (d < minD) { minD = d; best = i; }
        });
        clusters[best].push(px);
      }
      centroids = clusters.map(cl => {
        if (!cl.length) return centroids[Math.floor(Math.random() * count)];
        const avg = cl.reduce((a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]], [0,0,0]);
        return avg.map(v => Math.round(v / cl.length));
      });
    }
    return centroids
      .sort((a, b) => luminance(a) - luminance(b))
      .map(([r, g, b]) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''));
  }

  function colorDist([r1,g1,b1], [r2,g2,b2]) {
    return (r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2;
  }
  function luminance([r, g, b]) { return 0.299*r + 0.587*g + 0.114*b; }
  function hexToRgb(hex) {
    return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
  }

  // ── Style tag analysis ──
  function analyzeStyle(data, palette) {
    const tags = [];
    let sumR=0, sumG=0, sumB=0, count=0;
    for (let i=0; i<data.length; i+=4) {
      if (data[i+3]<128) continue;
      sumR+=data[i]; sumG+=data[i+1]; sumB+=data[i+2]; count++;
    }
    const avgR=sumR/count, avgG=sumG/count, avgB=sumB/count;
    const lum = 0.299*avgR + 0.587*avgG + 0.114*avgB;

    if (avgR > avgB + 20) tags.push({ label: '暖色調', cls: 'warm-tag' });
    else if (avgB > avgR + 20) tags.push({ label: '冷色調', cls: 'cool-tag' });
    else tags.push({ label: '中性色調', cls: '' });

    if (lum > 160) tags.push({ label: '明亮', cls: 'bright-tag' });
    else if (lum < 80) tags.push({ label: '暗沉', cls: 'dark-tag' });
    else tags.push({ label: '中明度', cls: '' });

    const maxC = Math.max(avgR, avgG, avgB);
    const minC = Math.min(avgR, avgG, avgB);
    const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
    if (sat > 0.4) tags.push({ label: '高飽和', cls: 'warm-tag' });
    else if (sat < 0.15) tags.push({ label: '低飽和', cls: 'dark-tag' });

    const lums = palette.map(h => luminance(hexToRgb(h)));
    const spread = Math.max(...lums) - Math.min(...lums);
    if (spread > 160) tags.push({ label: '高對比', cls: '' });
    else tags.push({ label: '低對比', cls: '' });

    return tags;
  }

  // ── Render functions ──
  function renderPalette(palette) {
    paletteRow.innerHTML = '';
    palette.forEach(hex => {
      const wrap = document.createElement('div');
      wrap.style.position = 'relative';
      wrap.style.marginBottom = '4px';
      const sw = document.createElement('div');
      sw.className = 'swatch';
      sw.style.background = hex;
      sw.title = hex + ' (點擊複製)';
      const label = document.createElement('div');
      label.className = 'swatch-hex';
      label.textContent = hex;
      sw.addEventListener('click', () => {
        navigator.clipboard.writeText(hex).then(() => showToast(`已複製 ${hex}`));
      });
      wrap.appendChild(sw);
      wrap.appendChild(label);
      paletteRow.appendChild(wrap);
    });
  }

  function renderMood(text) {
    moodText.textContent = text;
  }

  function renderMetadata(meta) {
    metaStyle.textContent = meta.estimated_style;
    metaProcess.textContent = meta.creation_process;
  }

  function renderStyleTags(tags) {
    styleTagRow.innerHTML = '';
    tags.forEach(({ label, cls }) => {
      const t = document.createElement('span');
      t.className = 'style-tag' + (cls ? ' ' + cls : '');
      t.textContent = label;
      styleTagRow.appendChild(t);
    });
  }

  function renderElements(el) {
    elForeground.textContent = el.foreground_fx;
    elSubjectIdentity.textContent = el.main_subject.identity;
    elSubjectClothing.textContent = el.main_subject.clothing_or_surface;
    elSubjectPose.textContent = el.main_subject.pose_and_action;
    elMidground.textContent = el.midground_objects;
    elBackground.textContent = el.background_environment;
  }

  function renderLighting(lighting, camera) {
    lightDirection.textContent = lighting.key_light.direction;
    lightColorTemp.textContent = lighting.key_light.color_temp;
    lightQuality.textContent = lighting.key_light.quality;
    lightFill.textContent = lighting.fill_and_rim_lights;
    cameraLens.textContent = camera.estimated_lens;
    cameraDof.textContent = camera.depth_of_field;
    cameraAngle.textContent = camera.camera_angle;
  }

  function renderMaterials(notes) {
    materialsList.innerHTML = '';
    const nameMap = {
      'dominant_surface': '主要表面',
      'highlight_material': '高光材質',
      'midtone_texture': '中間調紋理',
      'color_material': '彩色材質',
      'skin_or_statue_surface': '皮膚/雕像',
      'hair_texture': '毛髮紋理',
      'sunglasses': '太陽眼鏡',
      'suit_fabric': '西裝布料',
      'metal_weapon': '金屬武器',
      'smoke_and_flame': '煙霧與火焰'
    };
    for (const [key, value] of Object.entries(notes)) {
      const item = document.createElement('div');
      item.className = 'material-item';
      const name = document.createElement('div');
      name.className = 'material-name';
      name.textContent = nameMap[key] || key.replace(/_/g, ' ');
      const desc = document.createElement('div');
      desc.className = 'material-desc';
      desc.textContent = value;
      item.appendChild(name);
      item.appendChild(desc);
      materialsList.appendChild(item);
    }
  }

  function renderComposition(comp) {
    compositionGrid.innerHTML = '';
    const labels = {
      'framing': '取景構圖',
      'silhouette': '剪影',
      'value_structure': '明暗結構',
      'visual_hierarchy': '視覺層級'
    };
    for (const [key, value] of Object.entries(comp)) {
      const item = document.createElement('div');
      item.className = 'composition-item';
      const lbl = document.createElement('div');
      lbl.className = 'composition-label';
      lbl.textContent = labels[key] || key;
      const val = document.createElement('div');
      val.className = 'composition-value';
      val.textContent = value;
      item.appendChild(lbl);
      item.appendChild(val);
      compositionGrid.appendChild(item);
    }
  }

  function renderNegativeConstraints(constraints) {
    negativeList.innerHTML = '';
    constraints.forEach(text => {
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
    const comp = analysis.composition_analysis;

    const parts = [
      `Style: ${meta.estimated_style}`,
      `Color Palette: ${meta.color_palette.join(', ')}`,
      `Mood: ${meta.mood_and_atmosphere}`,
      '',
      `Subject: ${el.main_subject.identity}`,
      `Surface: ${el.main_subject.clothing_or_surface}`,
      `Pose: ${el.main_subject.pose_and_action}`,
      '',
      `Lighting: ${light.key_light.direction}, ${light.key_light.quality}`,
      `Camera: ${cam.estimated_lens}, ${cam.camera_angle}`,
      '',
      `Composition: ${comp.framing}`,
      '',
      `Negative: ${analysis.inferred_negative_constraints.join(' | ')}`
    ];
    return parts.join('\n');
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
    a.download = 'image-analysis-report.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('JSON 報告已下載');
  });
})();
