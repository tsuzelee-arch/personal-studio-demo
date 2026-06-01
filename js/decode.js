(function() {
  const dropZone    = document.getElementById('dropZone');
  const imageInput  = document.getElementById('imageInput');
  const uploadBtn   = document.getElementById('uploadBtn');
  const decodeResult = document.getElementById('decodeResult');
  const previewImg  = document.getElementById('previewImg');
  const paletteRow  = document.getElementById('paletteRow');
  const styleTagRow = document.getElementById('styleTagRow');
  const promptOutput = document.getElementById('promptOutput');
  const copyPromptBtn = document.getElementById('copyPromptBtn');
  const sendToWorkflowBtn = document.getElementById('sendToWorkflowBtn');
  const resetDecodeBtn = document.getElementById('resetDecodeBtn');
  const canvas      = document.getElementById('analysisCanvas');
  const ctx         = canvas.getContext('2d');

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
    dropZone.classList.remove('hidden');
    imageInput.value = '';
    window.StudioState.decodeResult = null;
  }

  function loadImage(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      previewImg.src = url;
      analyzeImage(img);
      dropZone.classList.add('hidden');
      decodeResult.classList.remove('hidden');
    };
    img.src = url;
  }

  function analyzeImage(img) {
    const size = 80;
    canvas.width = size;
    canvas.height = size;
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;

    const palette = extractPalette(data, 6);
    const styleTags = analyzeStyle(data, palette);
    const promptText = buildPromptText(palette, styleTags);

    renderPalette(palette);
    renderTags(styleTags);
    promptOutput.textContent = promptText;

    window.StudioState.decodeResult = { palette, styleTags, promptText };
    // Mark workflow step 2 ready
    if (window.workflowMarkReady) window.workflowMarkReady(1);
  }

  function extractPalette(data, count) {
    // Simple median-cut-like quantization: sample pixels, cluster by similarity
    const samples = [];
    for (let i = 0; i < data.length; i += 4 * 12) {
      const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
      if (a < 128) continue;
      samples.push([r, g, b]);
    }

    // k-means with random init
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

    // Sort by luminance (dark to light) and return hex codes
    return centroids
      .sort((a, b) => luminance(a) - luminance(b))
      .map(([r, g, b]) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''));
  }

  function colorDist([r1,g1,b1], [r2,g2,b2]) {
    return (r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2;
  }
  function luminance([r, g, b]) { return 0.299*r + 0.587*g + 0.114*b; }

  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return [r, g, b];
  }

  function analyzeStyle(data, palette) {
    const tags = [];
    // Average color
    let sumR=0, sumG=0, sumB=0, count=0;
    for (let i=0; i<data.length; i+=4) {
      if (data[i+3]<128) continue;
      sumR+=data[i]; sumG+=data[i+1]; sumB+=data[i+2]; count++;
    }
    const avgR=sumR/count, avgG=sumG/count, avgB=sumB/count;
    const lum = 0.299*avgR + 0.587*avgG + 0.114*avgB;

    // Warm vs cool
    if (avgR > avgB + 20) tags.push({ label: '暖色調', cls: 'warm-tag' });
    else if (avgB > avgR + 20) tags.push({ label: '冷色調', cls: 'cool-tag' });
    else tags.push({ label: '中性色調', cls: '' });

    // Bright vs dark
    if (lum > 160) tags.push({ label: '明亮', cls: 'bright-tag' });
    else if (lum < 80) tags.push({ label: '暗沉', cls: 'dark-tag' });
    else tags.push({ label: '中明度', cls: '' });

    // Saturation estimate
    const maxC = Math.max(avgR, avgG, avgB);
    const minC = Math.min(avgR, avgG, avgB);
    const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
    if (sat > 0.4) tags.push({ label: '高飽和', cls: 'warm-tag' });
    else if (sat < 0.15) tags.push({ label: '低飽和', cls: 'dark-tag' });

    // High contrast (spread of palette lums)
    const lums = palette.map(h => luminance(hexToRgb(h)));
    const spread = Math.max(...lums) - Math.min(...lums);
    if (spread > 160) tags.push({ label: '高對比', cls: '' });
    else tags.push({ label: '低對比', cls: '' });

    return tags;
  }

  function buildPromptText(palette, styleTags) {
    const tagStr = styleTags.map(t => t.label).join('、');
    const colorStr = palette.join(', ');
    return `color palette: ${colorStr}\nstyle: ${tagStr}\n\n— 建議提示詞起點 —\n${tagStr} photography, ${palette[0]} dominant, ${palette[palette.length-1]} highlight, cinematic lighting, high detail`;
  }

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

  function renderTags(tags) {
    styleTagRow.innerHTML = '';
    tags.forEach(({ label, cls }) => {
      const t = document.createElement('span');
      t.className = 'style-tag' + (cls ? ' ' + cls : '');
      t.textContent = label;
      styleTagRow.appendChild(t);
    });
  }

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
})();
