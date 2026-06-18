(() => {
  'use strict';

  // ──────────── State ────────────
  const state = {
    images: [],
    processing: false,
    pendingImport: null
  };

  // ──────────── DOM Elements ────────────
  const dom = {
    btnAssetToggle: document.getElementById('ipBtnAssetToggle'),
    leftAssets: document.getElementById('ipLeftAssets'),
    assetClose: document.getElementById('ipAssetClose'),
    assetResizer: document.getElementById('ipAssetResizer'),
    
    btnStitch: document.getElementById('ipBtnStitch'),
    btnScript: document.getElementById('ipBtnScript'),
    btnProcess: document.getElementById('ipBtnProcess'),
    btnUpload: document.getElementById('ipBtnUpload'),
    btnUnify: document.getElementById('ipBtnUnify'),
    btnClear: document.getElementById('ipBtnClear'),
    btnClearInspector: document.getElementById('ipBtnClearInspector'),
    
    // Conflict modal elements
    importConflictModal: document.getElementById('ipImportConflictModal'),
    importConflictClose: document.getElementById('ipImportConflictClose'),
    importConflictCancel: document.getElementById('ipImportConflictCancel'),
    importConflictReplace: document.getElementById('ipImportConflictReplace'),
    importConflictAppend: document.getElementById('ipImportConflictAppend'),
    
    fileInput: document.getElementById('ipFileInput'),
    progressContainer: document.getElementById('ipProgressContainer'),
    progressText: document.getElementById('ipProgressText'),
    progressPercent: document.getElementById('ipProgressPercent'),
    progressFill: document.getElementById('ipProgressFill'),
    gallery: document.getElementById('ipGallery'),
    imageCount: document.getElementById('ipImageCount'),

    // Global Inspector Elements
    globalResolution: document.getElementById('ipGlobalResolution'),
    globalCustomResGroup: document.getElementById('ipGlobalCustomResGroup'),
    globalCustomWidth: document.getElementById('ipGlobalCustomWidth'),
    globalCustomHeight: document.getElementById('ipGlobalCustomHeight'),
    globalBg: document.getElementById('ipGlobalBg'),
    globalBgPicker: document.getElementById('ipGlobalBgPicker'),
    globalRefLine: document.getElementById('ipGlobalRefLine'),
    globalOutputDir: document.getElementById('ipGlobalOutputDir'),

    // Stitch Modal Elements
    stitchModal: document.getElementById('ipStitchModal'),
    stitchModalClose: document.getElementById('ipStitchModalClose'),
    stitchModalCancel: document.getElementById('ipStitchModalCancel'),
    stitchModalConfirm: document.getElementById('ipStitchModalConfirm'),
    stitchDir: document.getElementById('ipStitchDir'),
    stitchGridColsGroup: document.getElementById('ipStitchGridColsGroup'),
    stitchGridCols: document.getElementById('ipStitchGridCols'),
    stitchGap: document.getElementById('ipStitchGap'),
    stitchBg: document.getElementById('ipStitchBg'),
    stitchBgPicker: document.getElementById('ipStitchBgPicker'),
    stitchAlign: document.getElementById('ipStitchAlign'),
    stitchSize: document.getElementById('ipStitchSize'),

    // Script Modal Elements
    scriptModal: document.getElementById('ipScriptModal'),
    scriptModalClose: document.getElementById('ipScriptModalClose'),
    scriptModalCancel: document.getElementById('ipScriptModalCancel'),
    scriptBtnExecute: document.getElementById('ipScriptBtnExecute'),
    scriptSourceDir: document.getElementById('ipScriptSourceDir'),
    scriptOutputDir: document.getElementById('ipScriptOutputDir'),
    scriptResolution: document.getElementById('ipScriptResolution'),
    scriptFitMode: document.getElementById('ipScriptFitMode'),
    scriptAlign: document.getElementById('ipScriptAlign'),
    scriptBg: document.getElementById('ipScriptBg'),
    scriptBgPicker: document.getElementById('ipScriptBgPicker'),
    scriptStitchParams: document.getElementById('ipScriptStitchParams'),
    scriptStitchDir: document.getElementById('ipScriptStitchDir'),
    scriptStitchGridColsGroup: document.getElementById('ipScriptStitchGridColsGroup'),
    scriptStitchGridCols: document.getElementById('ipScriptStitchGridCols'),
    scriptStitchGap: document.getElementById('ipScriptStitchGap'),
    scriptStitchAlign: document.getElementById('ipScriptStitchAlign'),
    scriptStitchSize: document.getElementById('ipScriptStitchSize'),
    scriptCropParams: document.getElementById('ipScriptCropParams'),
    scriptCropRefLine: document.getElementById('ipScriptCropRefLine'),
    scriptPrefixFilter: document.getElementById('ipScriptPrefixFilter'),
    scriptResBgParams: document.getElementById('ipScriptResBgParams'),
    scriptAlignBgParams: document.getElementById('ipScriptAlignBgParams'),
    scriptAutoRun: document.getElementById('ipScriptAutoRun'),
    scriptKeyword: document.getElementById('ipScriptKeyword'),
    scriptPresetCards: document.getElementById('ipScriptPresetCards'),
    scriptPresetSave: document.getElementById('ipScriptPresetSave'),
    scriptPresetCount: document.getElementById('ipScriptPresetCount')
  };

  // Helper: Escape HTML
  function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
  }

  // ──────────── Draw Canvas ────────────
  function drawCanvas(ctx, img, drawSizeX, drawSizeY, scale, offsetX, offsetY, bgColor) {
    // 1. Fill background or clear if transparent
    if (bgColor === 'transparent') {
      ctx.clearRect(0, 0, drawSizeX, drawSizeY);
    } else {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, drawSizeX, drawSizeY);
    }

    const w = img.naturalWidth;
    const h = img.naturalHeight;

    // 2. Fit image centered in canvas space at scale = 1
    const fitScale = Math.min(drawSizeX / w, drawSizeY / h);
    const baseWidth = w * fitScale;
    const baseHeight = h * fitScale;

    // Apply scale multiplier
    const finalWidth = baseWidth * scale;
    const finalHeight = baseHeight * scale;

    // Calculate top-left rendering position with offset
    const dx = (drawSizeX - finalWidth) / 2 + offsetX;
    const dy = (drawSizeY - finalHeight) / 2 + offsetY;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, dx, dy, finalWidth, finalHeight);
  }

  // ──────────── Draw Preview Canvas for a specific card ────────────
  function drawPreview(imgObj) {
    const card = document.querySelector(`.ip-card[data-id="${imgObj.id}"]`);
    if (!card) return;

    const canvas = card.querySelector('.ip-card-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    drawCanvas(ctx, imgObj.imgElement, canvas.width, canvas.height, imgObj.scale, imgObj.offsetX, imgObj.offsetY, imgObj.bgColor);
  }

  // ──────────── Directory Traversal Helpers ────────────
  function traverseDirectoryEntry(entry) {
    return new Promise((resolve) => {
      if (entry.isFile) {
        entry.file((file) => {
          resolve([file]);
        }, () => {
          resolve([]);
        });
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const getAllEntries = () => {
          return new Promise((resolveEntries) => {
            let allEntries = [];
            const readBatch = () => {
              dirReader.readEntries(async (results) => {
                if (results.length === 0) {
                  resolveEntries(allEntries);
                } else {
                  allEntries = allEntries.concat(results);
                  readBatch();
                }
              }, () => {
                resolveEntries(allEntries);
              });
            };
            readBatch();
          });
        };

        getAllEntries().then(async (entries) => {
          const promises = entries.map(childEntry => traverseDirectoryEntry(childEntry));
          const fileLists = await Promise.all(promises);
          resolve(fileLists.flat());
        });
      } else {
        resolve([]);
      }
    });
  }

  async function handleDroppedItems(items) {
    showProgress(true);
    updateProgress('正在讀取資料夾與檔案...', 5);
    
    const promises = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry();
        if (entry) {
          promises.push(traverseDirectoryEntry(entry));
        }
      }
    }
    
    try {
      const results = await Promise.all(promises);
      const allFiles = results.flat();
      await handleFiles(allFiles);
    } catch (err) {
      console.error('遍歷拖拽項目時出錯:', err);
      if (window.showToast) window.showToast('⚠️ 讀取拖拽項目時出錯');
    } finally {
      showProgress(false);
    }
  }

  // ──────────── Image File Loader ────────────
  function loadAndAddImage(file) {
    const id = 'ip_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    const url = URL.createObjectURL(file);

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const defaultBg = '#FFFFFF';
        state.images.push({
          id,
          file,
          imgElement: img,
          originalUrl: url,
          scale: 1.0,
          offsetX: 0,
          offsetY: 0,
          bgColor: defaultBg,
          selected: true,
          croppedBlob: null,
          status: 'pending',
          errorMessage: '',
          targetWidth: 1024,
          targetHeight: 1024,
          resolutionPreset: '1024',
          refLine: 'none',
          outputFolder: '根目錄'
        });
        resolve();
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });
  }

  // ──────────── FSA Asset Loader ────────────
  async function handleFsaAsset(path, name) {
    if (!window.AssetManager) return;
    try {
      const handle = window.AssetManager.getFileHandleByPath(path);
      if (!handle) {
        throw new Error('找不到該檔案的控制代碼');
      }
      const file = await handle.getFile();
      await loadAndAddImage(file);
      renderGallery();
      updateActionButtons();
    } catch (err) {
      console.error('載入本機資產失敗:', err);
      if (window.showToast) {
        window.showToast('⚠️ 本機目錄連線已逾期，請點擊資源管理器上方的 🔌 恢復連線！', 4000);
      }
    }
  }

  // ──────────── Batch File Processor ────────────
  async function handleFiles(files) {
    const fileArray = Array.from(files);
    
    showProgress(true);
    updateProgress('正在加載檔案...', 10);

    const imageFiles = fileArray.filter(f => f.type.startsWith('image/'));
    const zipFiles = fileArray.filter(f => f.name.endsWith('.zip'));

    let addedCount = 0;

    // 1. Process loose image files
    for (let i = 0; i < imageFiles.length; i++) {
      try {
        updateProgress(`正在讀取圖片 ${i + 1}/${imageFiles.length}...`, 10 + (i / imageFiles.length) * 40);
        await loadAndAddImage(imageFiles[i]);
        addedCount++;
      } catch (err) {
        console.error(err);
        if (window.showToast) window.showToast(`載入圖片 ${imageFiles[i].name} 失敗`);
      }
    }

    // 2. Process ZIP files
    for (let i = 0; i < zipFiles.length; i++) {
      try {
        updateProgress(`正在解壓縮 ZIP 壓縮檔案...`, 50);
        const zip = await JSZip.loadAsync(zipFiles[i]);
        const zipEntries = Object.entries(zip.files).filter(([name, data]) => {
          if (data.dir) return false;
          const lower = name.toLowerCase();
          return lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp');
        });

        for (let j = 0; j < zipEntries.length; j++) {
          const [filename, fileData] = zipEntries[j];
          updateProgress(`正在提取壓縮檔圖片 ${j + 1}/${zipEntries.length}...`, 60 + (j / zipEntries.length) * 35);
          
          const blob = await fileData.async('blob');
          const ext = filename.toLowerCase().split('.').pop();
          const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
          const imgFile = new File([blob], filename.split('/').pop(), { type: mimeType });
          
          await loadAndAddImage(imgFile);
          addedCount++;
        }
      } catch (err) {
        console.error(err);
        if (window.showToast) window.showToast(`解壓 ZIP 檔 ${zipFiles[i].name} 失敗`);
      }
    }

    updateProgress('載入完成', 100);
    setTimeout(() => showProgress(false), 800);

    renderGallery();
    updateActionButtons();
    if (addedCount > 0 && window.showToast) {
      window.showToast(`已成功載入 ${addedCount} 張圖片`);
    }
  }

  // ──────────── Render Preview Gallery ────────────
  function renderGallery() {
    if (state.images.length === 0) {
      dom.gallery.innerHTML = `
        <div class="empty-state" id="ipEmptyState">
          <div class="empty-icon">📭</div>
          <p>尚未上傳任何圖片，請使用右上方上傳或由本機資產拖曳新增</p>
        </div>`;
      dom.imageCount.textContent = '0 張圖片';
      return;
    }

    const folders = AssetManager.isConnected() ? AssetManager.getAllFolderPaths() : ['根目錄'];

    dom.imageCount.textContent = `${state.images.length} 張圖片`;
    dom.gallery.innerHTML = '';

    state.images.forEach((imgObj) => {
      const card = document.createElement('div');
      card.className = `ip-card ${imgObj.selected ? '' : 'disabled'}`;
      card.dataset.id = imgObj.id;

      const isCustomBg = !['#FFFFFF', '#000000', '#00FF00', '#0000FF', 'transparent'].includes(imgObj.bgColor);

      const res = { width: imgObj.targetWidth, height: imgObj.targetHeight };
      const maxDim = 400;

      let Dw, Dh;
      if (res.width >= res.height) {
        Dw = maxDim;
        Dh = maxDim * (res.height / res.width);
      } else {
        Dh = maxDim;
        Dw = maxDim * (res.width / res.height);
      }

      card.innerHTML = `
        <div class="ip-card-header">
          <div class="ip-card-header-actions">
            <label>
              <input type="checkbox" class="ip-card-select" ${imgObj.selected ? 'checked' : ''} />
              啟用
            </label>
          </div>
          <button class="btn-delete" title="刪除項目">🗑️</button>
        </div>
        <div class="ip-card-canvas-wrap ${imgObj.bgColor === 'transparent' ? 'checkerboard' : ''}" style="aspect-ratio: ${res.width} / ${res.height};">
          <canvas class="ip-card-canvas" width="${Dw}" height="${Dh}"></canvas>
          <div class="ip-grid-overlay ${imgObj.refLine !== 'none' ? imgObj.refLine + ' active' : ''}"></div>
          <div class="ip-card-zoom-controls">
            <span class="zoom-icon">🔍</span>
            <input type="range" class="ip-card-zoom-slider" min="0.1" max="5.0" step="0.05" value="${imgObj.scale}" />
          </div>
        </div>
        <div class="ip-card-body">
          <div class="ip-card-filename" title="${escHtml(imgObj.file.name)}">${escHtml(imgObj.file.name)}</div>
          <div class="ip-card-meta-row">
            <div class="ip-card-dimensions">${imgObj.imgElement.naturalWidth} × ${imgObj.imgElement.naturalHeight}</div>
            <div class="ip-card-status pending">等待處理</div>
          </div>
          
          <!-- 每張圖的輸出設定區 -->
          <div class="ip-card-controls">
            <!-- 解析度選單 -->
            <div class="ip-control-row">
              <label>解析度：</label>
              <select class="ip-card-res-select">
                <option value="512" ${imgObj.resolutionPreset === '512' ? 'selected' : ''}>512 × 512</option>
                <option value="1024_512" ${imgObj.resolutionPreset === '1024_512' ? 'selected' : ''}>1024 × 512</option>
                <option value="512_1024" ${imgObj.resolutionPreset === '512_1024' ? 'selected' : ''}>512 × 1024</option>
                <option value="1024" ${imgObj.resolutionPreset === '1024' ? 'selected' : ''}>1024 × 1024</option>
                <option value="2048" ${imgObj.resolutionPreset === '2048' ? 'selected' : ''}>2048 × 2048</option>
                <option value="custom" ${imgObj.resolutionPreset === 'custom' ? 'selected' : ''}>自訂</option>
              </select>
            </div>
            <!-- 自訂寬高輸入框 -->
            <div class="ip-card-custom-res" style="${imgObj.resolutionPreset === 'custom' ? 'display: flex;' : 'display: none;'} gap: 4px; align-items: center; margin-top: 4px;">
              <input type="number" class="ip-card-custom-width" value="${imgObj.targetWidth}" placeholder="寬">
              <span>×</span>
              <input type="number" class="ip-card-custom-height" value="${imgObj.targetHeight}" placeholder="高">
            </div>
            <!-- 背景填充與滴管 -->
            <div class="ip-control-row" style="margin-top: 8px;">
              <label>背景：</label>
              <select class="ip-card-bg-select" style="flex: 1;">
                <option value="#FFFFFF" ${imgObj.bgColor === '#FFFFFF' ? 'selected' : ''}>白色</option>
                <option value="#000000" ${imgObj.bgColor === '#000000' ? 'selected' : ''}>黑色</option>
                <option value="#00FF00" ${imgObj.bgColor === '#00FF00' ? 'selected' : ''}>綠幕</option>
                <option value="#0000FF" ${imgObj.bgColor === '#0000FF' ? 'selected' : ''}>藍幕</option>
                <option value="transparent" ${imgObj.bgColor === 'transparent' ? 'selected' : ''}>透明</option>
                <option value="custom" ${isCustomBg ? 'selected' : ''}>自訂</option>
              </select>
              <input type="color" class="ip-card-bg-picker" value="${isCustomBg ? imgObj.bgColor : '#FFFFFF'}" style="${isCustomBg ? '' : 'display:none;'} width: 24px; height: 24px; padding: 0;" />
              <button class="btn-eyedropper" title="吸取顏色" style="${window.EyeDropper ? '' : 'display:none;'} padding: 2px;">💉</button>
            </div>
            <!-- 參考輔助對齊線 -->
            <div class="ip-control-row" style="margin-top: 8px;">
              <label>輔助線：</label>
              <select class="ip-card-ref-select">
                <option value="none" ${imgObj.refLine === 'none' ? 'selected' : ''}>無</option>
                <option value="crosshair" ${imgObj.refLine === 'crosshair' ? 'selected' : ''}>十字線</option>
                <option value="thirds" ${imgObj.refLine === 'thirds' ? 'selected' : ''}>井字線</option>
              </select>
            </div>
            <!-- 輸出資料夾 -->
            <div class="ip-control-row" style="margin-top: 8px;">
              <label>輸出至：</label>
              <select class="ip-card-output-select" style="flex: 1;">
                ${folders.map(f => `<option value="${f}" ${imgObj.outputFolder === f ? 'selected' : ''}>${f}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
      `;

      dom.gallery.appendChild(card);

      // Render the image onto preview canvas
      const canvas = card.querySelector('.ip-card-canvas');
      const ctx = canvas.getContext('2d');
      drawCanvas(ctx, imgObj.imgElement, Dw, Dh, imgObj.scale, imgObj.offsetX, imgObj.offsetY, imgObj.bgColor);

      // ──────────── Panning (Drag) Events ────────────
      let isDragging = false;
      let startX, startY;

      const onMove = (e) => {
        if (!isDragging) return;
        const cx = e.clientX || e.touches?.[0]?.clientX;
        const cy = e.clientY || e.touches?.[0]?.clientY;
        const dx = cx - startX;
        const dy = cy - startY;

        imgObj.offsetX += dx * (canvas.width / canvas.clientWidth);
        imgObj.offsetY += dy * (canvas.height / canvas.clientHeight);

        startX = cx;
        startY = cy;
        drawPreview(imgObj);
      };

      const onStart = (e) => {
        isDragging = true;
        startX = e.clientX || e.touches?.[0]?.clientX;
        startY = e.clientY || e.touches?.[0]?.clientY;
        window.addEventListener('mousemove', onMove);
        window.addEventListener('touchmove', onMove);
        window.addEventListener('mouseup', onEnd);
        window.addEventListener('touchend', onEnd);
      };

      const onEnd = () => {
        isDragging = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('mouseup', onEnd);
        window.removeEventListener('touchend', onEnd);
      };

      canvas.addEventListener('mousedown', onStart);
      canvas.addEventListener('touchstart', onStart, { passive: true });

      // ──────────── Zoom (Wheel) Event ────────────
      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        let newScale = imgObj.scale + delta;
        newScale = Math.max(0.1, Math.min(newScale, 5.0));
        imgObj.scale = newScale;
        card.querySelector('.ip-card-zoom-slider').value = newScale;
        drawPreview(imgObj);
      });

      // ──────────── Zoom Slider Event ────────────
      card.querySelector('.ip-card-zoom-slider').addEventListener('input', (e) => {
        imgObj.scale = parseFloat(e.target.value);
        drawPreview(imgObj);
      });

      // ──────────── Checkbox Toggle Event ────────────
      card.querySelector('.ip-card-select').addEventListener('change', (e) => {
        imgObj.selected = e.target.checked;
        card.classList.toggle('disabled', !imgObj.selected);
        updateActionButtons();
      });

      // ──────────── Individual Card Background select ────────────
      const bgSelect = card.querySelector('.ip-card-bg-select');
      const bgPicker = card.querySelector('.ip-card-bg-picker');
      const btnEye = card.querySelector('.btn-eyedropper');
      const canvasWrap = card.querySelector('.ip-card-canvas-wrap');

      const applyBgChange = (newBg) => {
        imgObj.bgColor = newBg;
        canvasWrap.classList.toggle('checkerboard', newBg === 'transparent');
        drawPreview(imgObj);
      };

      bgSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'custom') {
          bgPicker.style.display = 'inline-block';
          applyBgChange(bgPicker.value);
        } else {
          bgPicker.style.display = 'none';
          applyBgChange(val);
        }
      });

      bgPicker.addEventListener('input', (e) => {
        bgSelect.value = 'custom';
        applyBgChange(e.target.value);
      });

      if (btnEye && window.EyeDropper) {
        btnEye.addEventListener('click', async () => {
          try {
            const eyeDropper = new window.EyeDropper();
            const result = await eyeDropper.open();
            bgPicker.value = result.sRGBHex;
            bgPicker.style.display = 'inline-block';
            bgSelect.value = 'custom';
            applyBgChange(result.sRGBHex);
          } catch (err) {
            console.error('Eyedropper closed or failed', err);
          }
        });
      }

      // ──────────── Card Resolution Select Event ────────────
      const resSelect = card.querySelector('.ip-card-res-select');
      const customResDiv = card.querySelector('.ip-card-custom-res');
      const customWidth = card.querySelector('.ip-card-custom-width');
      const customHeight = card.querySelector('.ip-card-custom-height');

      const applyResolutionChange = () => {
        const val = resSelect.value;
        imgObj.resolutionPreset = val;
        
        if (val === 'custom') {
          customResDiv.style.display = 'flex';
          let w = parseInt(customWidth.value, 10);
          let h = parseInt(customHeight.value, 10);
          if (isNaN(w) || w < 64) w = 1024;
          if (w > 8192) w = 8192;
          if (isNaN(h) || h < 64) h = 1024;
          if (h > 8192) h = 8192;
          imgObj.targetWidth = w;
          imgObj.targetHeight = h;
        } else {
          customResDiv.style.display = 'none';
          if (val === '1024_512') { imgObj.targetWidth = 1024; imgObj.targetHeight = 512; }
          else if (val === '512_1024') { imgObj.targetWidth = 512; imgObj.targetHeight = 1024; }
          else if (val === '512') { imgObj.targetWidth = 512; imgObj.targetHeight = 512; }
          else if (val === '2048') { imgObj.targetWidth = 2048; imgObj.targetHeight = 2048; }
          else { imgObj.targetWidth = 1024; imgObj.targetHeight = 1024; } // '1024'
        }

        const maxDim = 400;
        let Dw, Dh;
        if (imgObj.targetWidth >= imgObj.targetHeight) {
          Dw = maxDim;
          Dh = maxDim * (imgObj.targetHeight / imgObj.targetWidth);
        } else {
          Dh = maxDim;
          Dw = maxDim * (imgObj.targetWidth / imgObj.targetHeight);
        }
        canvas.width = Dw;
        canvas.height = Dh;
        canvasWrap.style.aspectRatio = `${imgObj.targetWidth} / ${imgObj.targetHeight}`;
        drawPreview(imgObj);
      };

      resSelect.addEventListener('change', applyResolutionChange);

      const handleCustomInput = () => {
        let w = parseInt(customWidth.value, 10);
        let h = parseInt(customHeight.value, 10);
        if (isNaN(w) || w < 64) w = 64;
        if (w > 8192) w = 8192;
        if (isNaN(h) || h < 64) h = 64;
        if (h > 8192) h = 8192;
        imgObj.targetWidth = w;
        imgObj.targetHeight = h;

        const maxDim = 400;
        let Dw, Dh;
        if (w >= h) {
          Dw = maxDim;
          Dh = maxDim * (h / w);
        } else {
          Dh = maxDim;
          Dw = maxDim * (w / h);
        }
        canvas.width = Dw;
        canvas.height = Dh;
        canvasWrap.style.aspectRatio = `${w} / ${h}`;
        drawPreview(imgObj);
      };

      customWidth.addEventListener('input', handleCustomInput);
      customHeight.addEventListener('input', handleCustomInput);

      // ──────────── Card Reference Line Event ────────────
      const refSelect = card.querySelector('.ip-card-ref-select');
      const overlay = card.querySelector('.ip-grid-overlay');

      const applyRefLine = () => {
        const val = refSelect.value;
        imgObj.refLine = val;
        overlay.className = 'ip-grid-overlay';
        if (val !== 'none') {
          overlay.classList.add(val, 'active');
        }
      };

      refSelect.addEventListener('change', applyRefLine);

      // ──────────── Card Output Folder select ────────────
      const outputSelect = card.querySelector('.ip-card-output-select');
      if (outputSelect) {
        outputSelect.addEventListener('change', (e) => {
          imgObj.outputFolder = e.target.value;
        });
      }

      // ──────────── Delete Event ────────────
      card.querySelector('.btn-delete').addEventListener('click', () => {
        if (confirm('確定要刪除此圖片預覽嗎？')) {
          URL.revokeObjectURL(imgObj.originalUrl);
          state.images = state.images.filter(x => x.id !== imgObj.id);
          renderGallery();
          updateActionButtons();
        }
      });
    });
  }

  // ──────────── Update Button States ────────────
  function updateActionButtons() {
    const hasImages = state.images.length > 0;
    const selectedCount = state.images.filter(img => img.selected).length;
    const hasProcessed = state.images.some(img => img.croppedBlob);

    dom.btnProcess.disabled = (selectedCount === 0) || state.processing;
    if (dom.btnExport) {
      dom.btnExport.disabled = !hasProcessed || state.processing;
    }
    dom.btnClear.disabled = !hasImages || state.processing;
    dom.btnStitch.disabled = (selectedCount < 2) || state.processing;
    if (dom.btnUnify) {
      dom.btnUnify.disabled = (state.images.length < 2) || state.processing;
    }
  }

  // ──────────── Unify Parameters ────────────
  function unifyParameters() {
    if (state.images.length === 0) return;
    
    const resolutionPreset = dom.globalResolution.value;
    let targetWidth = 1024;
    let targetHeight = 1024;
    
    if (resolutionPreset === 'custom') {
      let w = parseInt(dom.globalCustomWidth.value, 10);
      let h = parseInt(dom.globalCustomHeight.value, 10);
      if (isNaN(w) || w < 64) w = 64;
      if (w > 8192) w = 8192;
      if (isNaN(h) || h < 64) h = 64;
      if (h > 8192) h = 8192;
      
      // Update inputs with clamped values
      dom.globalCustomWidth.value = w;
      dom.globalCustomHeight.value = h;
      
      targetWidth = w;
      targetHeight = h;
    } else {
      if (resolutionPreset === '1024_512') { targetWidth = 1024; targetHeight = 512; }
      else if (resolutionPreset === '512_1024') { targetWidth = 512; targetHeight = 1024; }
      else if (resolutionPreset === '512') { targetWidth = 512; targetHeight = 512; }
      else if (resolutionPreset === '2048') { targetWidth = 2048; targetHeight = 2048; }
      else { targetWidth = 1024; targetHeight = 1024; } // '1024'
    }
    
    let bgColor = dom.globalBg.value;
    if (bgColor === 'custom') {
      bgColor = dom.globalBgPicker.value;
    }
    
    const refLine = dom.globalRefLine.value;
    const outputFolder = dom.globalOutputDir.value;
    
    state.images.forEach((imgObj) => {
      imgObj.resolutionPreset = resolutionPreset;
      imgObj.targetWidth = targetWidth;
      imgObj.targetHeight = targetHeight;
      imgObj.bgColor = bgColor;
      imgObj.refLine = refLine;
      imgObj.outputFolder = outputFolder;
    });
    
    renderGallery();
    updateActionButtons();
    if (window.showToast) {
      window.showToast('✨ 已套用全域參數至所有圖片預覽卡片！');
    }
  }

  // ──────────── Progress Helper ────────────
  function showProgress(show) {
    dom.progressContainer.style.display = show ? 'block' : 'none';
  }

  function updateProgress(text, percent) {
    dom.progressText.textContent = text;
    if (percent !== null && percent !== undefined) {
      dom.progressPercent.textContent = `${Math.round(percent)}%`;
      dom.progressFill.style.width = `${percent}%`;
    }
  }

  // ──────────── Save individual high-res canvas crop to blob ────────────
  function generateFinalCrop(imgObj) {
    const res = { width: imgObj.targetWidth, height: imgObj.targetHeight };
    return new Promise((resolve) => {
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = res.width;
      exportCanvas.height = res.height;
      const exportCtx = exportCanvas.getContext('2d');

      const maxDim = 400;
      let Dw, Dh;
      if (res.width >= res.height) {
        Dw = maxDim;
        Dh = maxDim * (res.height / res.width);
      } else {
        Dh = maxDim;
        Dw = maxDim * (res.width / res.height);
      }

      // Proportional scale factor from screen Dw/Dh to high-res output
      const ratio = res.width / Dw;

      drawCanvas(
        exportCtx,
        imgObj.imgElement,
        res.width,
        res.height,
        imgObj.scale,
        imgObj.offsetX * ratio,
        imgObj.offsetY * ratio,
        imgObj.bgColor
      );

      exportCanvas.toBlob((blob) => {
        imgObj.croppedBlob = blob;
        resolve(blob);
      }, 'image/png');
    });
  }

  // ──────────── Process All Images ────────────
  async function processAll() {
    if (state.processing) return;
    
    if (!AssetManager.isConnected()) {
      alert('請先點擊左側「資產庫」連結本機資料夾，並給予讀寫權限，方可直接儲存至本機資料夾！');
      return;
    }

    const selectedImages = state.images.filter(x => x.selected);
    if (selectedImages.length === 0) {
      if (window.showToast) window.showToast('請先選取至少一張圖片！');
      return;
    }

    state.processing = true;
    updateActionButtons();
    showProgress(true);

    const total = selectedImages.length;

    // Lock cards that are being processed
    selectedImages.forEach(imgObj => {
      const card = document.querySelector(`.ip-card[data-id="${imgObj.id}"]`);
      if (card) {
        card.classList.add('locked');
        const statusEl = card.querySelector('.ip-card-status');
        statusEl.textContent = '處理中...';
        statusEl.className = 'ip-card-status processing';
      }
    });

    for (let i = 0; i < total; i++) {
      const imgObj = selectedImages[i];
      updateProgress(`正在裁切並存入本地庫 ${i + 1}/${total}...`, (i / total) * 100);

      let blobUrl = null;
      try {
        await generateFinalCrop(imgObj);
        
        if (imgObj.croppedBlob) {
          blobUrl = URL.createObjectURL(imgObj.croppedBlob);
          const originalName = imgObj.file.name;
          const baseName = originalName.substring(0, originalName.lastIndexOf('.')) || originalName;
          const finalName = `${baseName}_cropped`;
          
          await AssetManager.saveAsset(finalName, blobUrl, imgObj.outputFolder);
        }
        
        const card = document.querySelector(`.ip-card[data-id="${imgObj.id}"]`);
        if (card) {
          card.classList.remove('locked');
          const statusEl = card.querySelector('.ip-card-status');
          statusEl.textContent = '✅ 已儲存';
          statusEl.className = 'ip-card-status success';
        }
      } catch (err) {
        console.error(err);
        imgObj.status = 'error';
        const card = document.querySelector(`.ip-card[data-id="${imgObj.id}"]`);
        if (card) {
          card.classList.remove('locked');
          const statusEl = card.querySelector('.ip-card-status');
          statusEl.textContent = '❌ 錯誤';
          statusEl.className = 'ip-card-status error';
        }
        if (window.showToast) window.showToast(`圖片 ${imgObj.file.name} 儲存失敗：${err.message}`);
      } finally {
        if (blobUrl) {
          URL.revokeObjectURL(blobUrl);
        }
      }
    }

    updateProgress('所有圖片處理完成並已存入本機！', 100);
    setTimeout(() => showProgress(false), 1200);

    state.processing = false;
    updateActionButtons();
    if (window.showToast) window.showToast('批次裁切並儲存完成！');
  }

  // ──────────── Export ZIP ────────────
  async function exportZip() {
    const processedImages = state.images.filter(x => x.selected && x.croppedBlob);
    if (processedImages.length === 0) {
      if (window.showToast) window.showToast('沒有已處理的圖片可供導出');
      return;
    }

    if (dom.btnExport) dom.btnExport.disabled = true;
    if (window.showToast) window.showToast('正在打包資料集 ZIP...');

    try {
      const zip = new JSZip();
      
      processedImages.forEach((imgObj) => {
        const originalName = imgObj.file.name;
        const nameWithoutExt = originalName.substring(0, originalName.lastIndexOf('.')) || originalName;
        zip.file(`${nameWithoutExt}_cropped.png`, imgObj.croppedBlob);
      });

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      saveAs(zipBlob, 'cropped_images.zip');
      
      if (window.showToast) window.showToast('ZIP 導出成功！');
    } catch (err) {
      console.error(err);
      if (window.showToast) window.showToast('壓縮打包失敗：' + err.message);
    } finally {
      if (dom.btnExport) dom.btnExport.disabled = false;
      updateActionButtons();
    }
  }

  // ──────────── Clear All ────────────
  function performClearAll(silent = false) {
    if (silent || confirm('確定要清除所有上傳的圖片與已處理的裁切結果嗎？此動作無法復原。')) {
      state.images.forEach(imgObj => {
        if (imgObj.originalUrl) {
          URL.revokeObjectURL(imgObj.originalUrl);
        }
      });
      state.images = [];
      renderGallery();
      updateActionButtons();
      return true;
    }
    return false;
  }

  function clearAll() {
    performClearAll(false);
  }

  // ──────────── Image Stitching Logic ────────────
  async function stitchSelectedImages() {
    const selected = state.images.filter(img => img.selected);
    if (selected.length < 2) return;

    const direction = dom.stitchDir.value;
    const gap = parseInt(dom.stitchGap.value, 10) || 0;
    const align = dom.stitchAlign.value;
    const sizeMode = dom.stitchSize.value;
    
    let bgColor = dom.stitchBg.value;
    if (bgColor === 'custom') {
      bgColor = dom.stitchBgPicker.value;
    }

    // Lock UI and close modal
    dom.stitchModal.classList.add('hidden');

    showProgress(true);
    updateProgress('正在進行圖片拼合...', 30);

    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const count = selected.length;
      
      // Determine individual rendering dimensions
      let dimensions = [];
      if (sizeMode === 'uniform') {
        const refImg = selected[0].imgElement;
        const refW = refImg.naturalWidth;
        const refH = refImg.naturalHeight;
        
        selected.forEach(imgObj => {
          if (direction === 'horizontal') {
            // Scale to match height of the first image
            const scaleFactor = refH / imgObj.imgElement.naturalHeight;
            dimensions.push({
              w: imgObj.imgElement.naturalWidth * scaleFactor,
              h: refH,
              img: imgObj.imgElement
            });
          } else if (direction === 'vertical') {
            // Scale to match width of the first image
            const scaleFactor = refW / imgObj.imgElement.naturalWidth;
            dimensions.push({
              w: refW,
              h: imgObj.imgElement.naturalHeight * scaleFactor,
              img: imgObj.imgElement
            });
          } else {
            // Grid: Scale all to exactly match the first image's size
            dimensions.push({
              w: refW,
              h: refH,
              img: imgObj.imgElement
            });
          }
        });
      } else {
        // Original size model
        selected.forEach(imgObj => {
          dimensions.push({
            w: imgObj.imgElement.naturalWidth,
            h: imgObj.imgElement.naturalHeight,
            img: imgObj.imgElement
          });
        });
      }

      let canvasW = 0;
      let canvasH = 0;

      if (direction === 'horizontal') {
        canvasW = dimensions.reduce((sum, d) => sum + d.w, 0) + (count - 1) * gap;
        canvasH = Math.max(...dimensions.map(d => d.h));
      } else if (direction === 'vertical') {
        canvasW = Math.max(...dimensions.map(d => d.w));
        canvasH = dimensions.reduce((sum, d) => sum + d.h, 0) + (count - 1) * gap;
      } else {
        // Grid mode
        const cols = parseInt(dom.stitchGridCols.value, 10) || 2;
        const rows = Math.ceil(count / cols);
        
        // Compute column widths and row heights
        let colWidths = Array(cols).fill(0);
        let rowHeights = Array(rows).fill(0);

        dimensions.forEach((d, idx) => {
          const c = idx % cols;
          const r = Math.floor(idx / cols);
          colWidths[c] = Math.max(colWidths[c], d.w);
          rowHeights[r] = Math.max(rowHeights[r], d.h);
        });

        canvasW = colWidths.reduce((sum, w) => sum + w, 0) + (cols - 1) * gap;
        canvasH = rowHeights.reduce((sum, h) => sum + h, 0) + (rows - 1) * gap;

        // Store grid row/col matrices for drawing
        canvas.gridMeta = { colWidths, rowHeights, cols };
      }

      // Safeguard: Limit max dimension to 16384px to prevent canvas context crash
      const MAX_CANVAS_DIM = 16384;
      if (canvasW > MAX_CANVAS_DIM || canvasH > MAX_CANVAS_DIM) {
        throw new Error(`拼合畫布尺寸過大 (${canvasW}x${canvasH})，已超過最大限制 ${MAX_CANVAS_DIM}px，請選擇「以首張圖片為準進行縮放對齊」縮小尺寸。`);
      }

      canvas.width = canvasW;
      canvas.height = canvasH;

      // Draw background
      if (bgColor === 'transparent') {
        ctx.clearRect(0, 0, canvasW, canvasH);
      } else {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvasW, canvasH);
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Draw images
      if (direction === 'horizontal') {
        let curX = 0;
        dimensions.forEach(d => {
          let dy = 0;
          if (align === 'center') dy = (canvasH - d.h) / 2;
          else if (align === 'end') dy = canvasH - d.h;
          
          ctx.drawImage(d.img, curX, dy, d.w, d.h);
          curX += d.w + gap;
        });
      } else if (direction === 'vertical') {
        let curY = 0;
        dimensions.forEach(d => {
          let dx = 0;
          if (align === 'center') dx = (canvasW - d.w) / 2;
          else if (align === 'end') dx = canvasW - d.w;

          ctx.drawImage(d.img, dx, curY, d.w, d.h);
          curY += d.h + gap;
        });
      } else {
        // Grid drawing
        const { colWidths, rowHeights, cols } = canvas.gridMeta;
        dimensions.forEach((d, idx) => {
          const c = idx % cols;
          const r = Math.floor(idx / cols);

          // Get starting coordinate X and Y of cell
          let cellX = 0;
          for (let i = 0; i < c; i++) cellX += colWidths[i] + gap;
          
          let cellY = 0;
          for (let i = 0; i < r; i++) cellY += rowHeights[i] + gap;

          // Align inside cell (colWidths[c] x rowHeights[r])
          let dx = cellX;
          if (align === 'center') dx += (colWidths[c] - d.w) / 2;
          else if (align === 'end') dx += colWidths[c] - d.w;

          let dy = cellY;
          if (align === 'center') dy += (rowHeights[r] - d.h) / 2;
          else if (align === 'end') dy += rowHeights[r] - d.h;

          ctx.drawImage(d.img, dx, dy, d.w, d.h);
        });
      }

      updateProgress('生成影像中...', 80);

      // Convert to blob and append as a new card
      canvas.toBlob(async (blob) => {
        const fileName = `stitched_${Date.now()}.png`;
        const file = new File([blob], fileName, { type: 'image/png' });
        
        await loadAndAddImage(file);
        
        updateProgress('拼合完成', 100);
        setTimeout(() => showProgress(false), 500);
        
        renderGallery();
        updateActionButtons();
        if (window.showToast) window.showToast('✅ 圖片拼合成功！已加入預覽庫中。');
      }, 'image/png');

    } catch (err) {
      console.error(err);
      showProgress(false);
      alert('拼合失敗：' + err.message);
    }
  }

  // Pure-logic stitch used by node preprocess (no DOM, returns dataURL).
  async function stitchImagesFromUrls(urls, cfg) {
    if (!urls || urls.length < 2) throw new Error('拼合需要至少 2 張圖片');
    cfg = cfg || {};
    const direction = cfg.stitchDir || 'horizontal';
    const gap       = parseInt(cfg.stitchGap, 10) || 0;
    const align     = cfg.stitchAlign || 'center';
    const sizeMode  = cfg.stitchSize || 'original';
    const cols      = Math.max(1, parseInt(cfg.stitchGridCols, 10) || 2);
    let bgColor     = cfg.stitchBg || '#FFFFFF';
    if (bgColor === 'custom') bgColor = cfg.stitchBgPicker || '#FFFFFF';

    const imgs = await Promise.all(urls.map(u => loadImageElement(u)));
    const count = imgs.length;

    let dimensions = [];
    if (sizeMode === 'uniform') {
      const refW = imgs[0].naturalWidth;
      const refH = imgs[0].naturalHeight;
      imgs.forEach(img => {
        if (direction === 'horizontal') {
          const s = refH / img.naturalHeight;
          dimensions.push({ w: img.naturalWidth * s, h: refH, img });
        } else if (direction === 'vertical') {
          const s = refW / img.naturalWidth;
          dimensions.push({ w: refW, h: img.naturalHeight * s, img });
        } else {
          dimensions.push({ w: refW, h: refH, img });
        }
      });
    } else {
      imgs.forEach(img => dimensions.push({ w: img.naturalWidth, h: img.naturalHeight, img }));
    }

    let canvasW = 0, canvasH = 0;
    let gridMeta = null;
    if (direction === 'horizontal') {
      canvasW = dimensions.reduce((s, d) => s + d.w, 0) + (count - 1) * gap;
      canvasH = Math.max(...dimensions.map(d => d.h));
    } else if (direction === 'vertical') {
      canvasW = Math.max(...dimensions.map(d => d.w));
      canvasH = dimensions.reduce((s, d) => s + d.h, 0) + (count - 1) * gap;
    } else {
      const rows = Math.ceil(count / cols);
      const colWidths  = Array(cols).fill(0);
      const rowHeights = Array(rows).fill(0);
      dimensions.forEach((d, i) => {
        colWidths[i % cols]         = Math.max(colWidths[i % cols], d.w);
        rowHeights[Math.floor(i / cols)] = Math.max(rowHeights[Math.floor(i / cols)], d.h);
      });
      canvasW = colWidths.reduce((s, w) => s + w, 0) + (cols - 1) * gap;
      canvasH = rowHeights.reduce((s, h) => s + h, 0) + (rows - 1) * gap;
      gridMeta = { colWidths, rowHeights, cols };
    }

    const MAX = 16384;
    if (canvasW > MAX || canvasH > MAX) throw new Error(`拼合畫布尺寸過大 (${canvasW}×${canvasH})，請改用「以首張為準縮放對齊」`);

    const canvas = document.createElement('canvas');
    canvas.width = canvasW; canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    if (bgColor === 'transparent') ctx.clearRect(0, 0, canvasW, canvasH);
    else { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, canvasW, canvasH); }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (direction === 'horizontal') {
      let x = 0;
      dimensions.forEach(d => {
        let dy = align === 'center' ? (canvasH - d.h) / 2 : align === 'end' ? canvasH - d.h : 0;
        ctx.drawImage(d.img, x, dy, d.w, d.h);
        x += d.w + gap;
      });
    } else if (direction === 'vertical') {
      let y = 0;
      dimensions.forEach(d => {
        let dx = align === 'center' ? (canvasW - d.w) / 2 : align === 'end' ? canvasW - d.w : 0;
        ctx.drawImage(d.img, dx, y, d.w, d.h);
        y += d.h + gap;
      });
    } else {
      const { colWidths, rowHeights } = gridMeta;
      dimensions.forEach((d, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        let cx = 0; for (let k = 0; k < c; k++) cx += colWidths[k] + gap;
        let cy = 0; for (let k = 0; k < r; k++) cy += rowHeights[k] + gap;
        let dx = cx + (align === 'center' ? (colWidths[c] - d.w) / 2 : align === 'end' ? colWidths[c] - d.w : 0);
        let dy = cy + (align === 'center' ? (rowHeights[r] - d.h) / 2 : align === 'end' ? rowHeights[r] - d.h : 0);
        ctx.drawImage(d.img, dx, dy, d.w, d.h);
      });
    }

    return canvas.toDataURL('image/png');
  }

  // ──────────── Automation Script Pipeline ────────────
  function calculateFitLayout(imgW, imgH, targetW, targetH, fitMode, alignment) {
    if (fitMode === 'stretch') {
      return { dx: 0, dy: 0, dw: targetW, dh: targetH };
    }
    const ratioW = targetW / imgW;
    const ratioH = targetH / imgH;

    const scale = fitMode === 'cover' ? Math.max(ratioW, ratioH) : Math.min(ratioW, ratioH);
    const dw = imgW * scale;
    const dh = imgH * scale;

    let alignX = 0.5; // default center
    let alignY = 0.5;

    if (alignment.includes('left')) alignX = 0;
    else if (alignment.includes('right')) alignX = 1;

    if (alignment.includes('top')) alignY = 0;
    else if (alignment.includes('bottom')) alignY = 1;

    const dx = (targetW - dw) * alignX;
    const dy = (targetH - dh) * alignY;

    return { dx, dy, dw, dh };
  }

  async function executeAutomation(triggerNode = null) {
    if (!AssetManager.isConnected()) {
      alert('請先至左側「資產庫」點擊「連結本機工作夾」並提供讀寫授權！');
      return;
    }

    const sourceDir = dom.scriptSourceDir.value;
    const outputDir = dom.scriptOutputDir.value;
    
    if (!sourceDir || !outputDir) {
      alert('請選擇有效的來源與輸出資料夾。');
      return;
    }

    const files = AssetManager.getImagesInFolder(sourceDir);
    if (files.length === 0) {
      if (!triggerNode) {
        alert(`資料夾「${sourceDir}」中沒有找到任何影像檔案！`);
      }
      return;
    }

    const fitMode = dom.scriptFitMode.value;

    if (dom.scriptModal && !dom.scriptModal.classList.contains('hidden')) {
      dom.scriptModal.classList.add('hidden');
    }
    showProgress(true);
    updateProgress('正在啟動自動化處理...', 0);

    let successCount = 0;
    const existingImages = AssetManager.getImagesInFolder(outputDir);
    const processedBlobUrls = [];

    function getFilePrefix(filename) {
      const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.')) || filename;
      const match = nameWithoutExt.match(/^(.*?)[_-]?\d+$/);
      return match ? match[1] : nameWithoutExt;
    }

    async function loadImageFromFileEntry(fileEntry) {
      const fileObj = await fileEntry.handle.getFile();
      const url = URL.createObjectURL(fileObj);
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve({ img, url });
        img.onerror = (e) => {
          URL.revokeObjectURL(url);
          reject(e);
        };
        img.src = url;
      });
    }

    try {
      if (fitMode === 'stitch') {
        const prefixGroups = {};
        files.forEach(file => {
          if (file.name.includes('_stitched') || file.name.includes('_processed') || file.name.includes('_crop_')) return;
          const prefix = getFilePrefix(file.name);
          if (!prefixGroups[prefix]) prefixGroups[prefix] = [];
          prefixGroups[prefix].push(file);
        });

        const prefixes = Object.keys(prefixGroups);
        const totalGroups = prefixes.length;

        for (let idx = 0; idx < totalGroups; idx++) {
          const prefix = prefixes[idx];
          const groupFiles = prefixGroups[prefix];
          if (groupFiles.length < 2) continue;

          updateProgress(`正在拼合前綴「${prefix}」的圖片...`, (idx / totalGroups) * 100);

          const loadedImages = [];
          for (const fileEntry of groupFiles) {
            try {
              const loaded = await loadImageFromFileEntry(fileEntry);
              loadedImages.push(loaded);
            } catch (err) {
              console.error('Failed to load image for stitching:', fileEntry.name, err);
            }
          }

          if (loadedImages.length < 2) {
            loadedImages.forEach(l => URL.revokeObjectURL(l.url));
            continue;
          }

          const direction = dom.scriptStitchDir.value;
          const gap = parseInt(dom.scriptStitchGap.value, 10) || 0;
          const align = dom.scriptStitchAlign.value;
          const sizeMode = dom.scriptStitchSize.value;
          
          let bgColor = dom.scriptBg.value;
          if (bgColor === 'custom') bgColor = dom.scriptBgPicker.value;

          const dimensions = [];
          if (sizeMode === 'uniform') {
            const refW = loadedImages[0].img.naturalWidth;
            const refH = loadedImages[0].img.naturalHeight;
            loadedImages.forEach(l => {
              if (direction === 'horizontal') {
                const scale = refH / l.img.naturalHeight;
                dimensions.push({ w: l.img.naturalWidth * scale, h: refH, img: l.img });
              } else if (direction === 'vertical') {
                const scale = refW / l.img.naturalWidth;
                dimensions.push({ w: refW, h: l.img.naturalHeight * scale, img: l.img });
              } else {
                dimensions.push({ w: refW, h: refH, img: l.img });
              }
            });
          } else {
            loadedImages.forEach(l => {
              dimensions.push({ w: l.img.naturalWidth, h: l.img.naturalHeight, img: l.img });
            });
          }

          let canvasW = 0, canvasH = 0;
          const count = loadedImages.length;

          if (direction === 'horizontal') {
            canvasW = dimensions.reduce((sum, d) => sum + d.w, 0) + (count - 1) * gap;
            canvasH = Math.max(...dimensions.map(d => d.h));
          } else if (direction === 'vertical') {
            canvasW = Math.max(...dimensions.map(d => d.w));
            canvasH = dimensions.reduce((sum, d) => sum + d.h, 0) + (count - 1) * gap;
          } else {
            const cols = parseInt(dom.scriptStitchGridCols.value, 10) || 2;
            const rows = Math.ceil(count / cols);
            let colWidths = Array(cols).fill(0);
            let rowHeights = Array(rows).fill(0);
            dimensions.forEach((d, idx) => {
              const c = idx % cols;
              const r = Math.floor(idx / cols);
              colWidths[c] = Math.max(colWidths[c], d.w);
              rowHeights[r] = Math.max(rowHeights[r], d.h);
            });
            canvasW = colWidths.reduce((sum, w) => sum + w, 0) + (cols - 1) * gap;
            canvasH = rowHeights.reduce((sum, h) => sum + h, 0) + (rows - 1) * gap;
            dimensions.gridMeta = { colWidths, rowHeights, cols };
          }

          const MAX_CANVAS_DIM = 16384;
          if (canvasW > MAX_CANVAS_DIM || canvasH > MAX_CANVAS_DIM) {
            console.warn(`Stitched canvas size ${canvasW}x${canvasH} exceeds limits.`);
            loadedImages.forEach(l => URL.revokeObjectURL(l.url));
            continue;
          }

          const canvas = document.createElement('canvas');
          canvas.width = canvasW;
          canvas.height = canvasH;
          const ctx = canvas.getContext('2d');

          if (bgColor === 'transparent') {
            ctx.clearRect(0, 0, canvasW, canvasH);
          } else {
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, canvasW, canvasH);
          }

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          if (direction === 'horizontal') {
            let curX = 0;
            dimensions.forEach(d => {
              let dy = 0;
              if (align === 'center') dy = (canvasH - d.h) / 2;
              else if (align === 'end') dy = canvasH - d.h;
              ctx.drawImage(d.img, curX, dy, d.w, d.h);
              curX += d.w + gap;
            });
          } else if (direction === 'vertical') {
            let curY = 0;
            dimensions.forEach(d => {
              let dx = 0;
              if (align === 'center') dx = (canvasW - d.w) / 2;
              else if (align === 'end') dx = canvasW - d.w;
              ctx.drawImage(d.img, dx, curY, d.w, d.h);
              curY += d.h + gap;
            });
          } else {
            const { colWidths, rowHeights, cols } = dimensions.gridMeta;
            dimensions.forEach((d, idx) => {
              const c = idx % cols;
              const r = Math.floor(idx / cols);
              let cellX = 0; for (let i = 0; i < c; i++) cellX += colWidths[i] + gap;
              let cellY = 0; for (let i = 0; i < r; i++) cellY += rowHeights[i] + gap;
              let dx = cellX;
              if (align === 'center') dx += (colWidths[c] - d.w) / 2;
              else if (align === 'end') dx += colWidths[c] - d.w;
              let dy = cellY;
              if (align === 'center') dy += (rowHeights[r] - d.h) / 2;
              else if (align === 'end') dy += rowHeights[r] - d.h;
              ctx.drawImage(d.img, dx, dy, d.w, d.h);
            });
          }

          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          const exportUrl = URL.createObjectURL(blob);

          const outputBase = `${prefix}_stitched`;
          let finalOutputName = outputBase;
          let counter = 1;
          while (existingImages.some(img => img.name === `${finalOutputName}.png`)) {
            finalOutputName = `${outputBase}_${counter}`;
            counter++;
          }

          await AssetManager.saveAsset(finalOutputName, exportUrl, outputDir);
          
          const savedBlobUrl = await AssetManager.getFileBlobUrlByPath(`${outputDir}/${finalOutputName}.png`);
          if (savedBlobUrl) processedBlobUrls.push(savedBlobUrl);

          URL.revokeObjectURL(exportUrl);
          loadedImages.forEach(l => URL.revokeObjectURL(l.url));
          successCount++;
        }

      } else if (fitMode === 'refcrop') {
        const prefixFilter = dom.scriptPrefixFilter.value.trim();
        const cropType = dom.scriptCropRefLine.value;

        for (let i = 0; i < files.length; i++) {
          const fileEntry = files[i];
          if (fileEntry.name.includes('_stitched') || fileEntry.name.includes('_processed') || fileEntry.name.includes('_crop_')) continue;
          if (prefixFilter && !fileEntry.name.startsWith(prefixFilter)) continue;

          updateProgress(`正在裁切圖片 (${i + 1}/${files.length}): ${fileEntry.name}...`, (i / files.length) * 100);

          let loaded = null;
          try {
            loaded = await loadImageFromFileEntry(fileEntry);
            const W = loaded.img.naturalWidth;
            const H = loaded.img.naturalHeight;

            const cropParts = [];
            const baseName = fileEntry.name.substring(0, fileEntry.name.lastIndexOf('.')) || fileEntry.name;

            if (cropType === 'crosshair') {
              const halfW = Math.round(W / 2);
              const halfH = Math.round(H / 2);
              cropParts.push({ x: 0, y: 0, w: halfW, h: halfH, suffix: 'tl' });
              cropParts.push({ x: halfW, y: 0, w: W - halfW, h: halfH, suffix: 'tr' });
              cropParts.push({ x: 0, y: halfH, w: halfW, h: H - halfH, suffix: 'bl' });
              cropParts.push({ x: halfW, y: halfH, w: W - halfW, h: H - halfH, suffix: 'br' });
            } else {
              const xCoords = [0, Math.round(W / 3), Math.round(2 * W / 3), W];
              const yCoords = [0, Math.round(H / 3), Math.round(2 * H / 3), H];
              let index = 1;
              for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 3; c++) {
                  cropParts.push({
                    x: xCoords[c],
                    y: yCoords[r],
                    w: xCoords[c + 1] - xCoords[c],
                    h: yCoords[r + 1] - yCoords[r],
                    suffix: `part_${index++}`
                  });
                }
              }
            }

            for (const part of cropParts) {
              const canvas = document.createElement('canvas');
              canvas.width = part.w;
              canvas.height = part.h;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(loaded.img, part.x, part.y, part.w, part.h, 0, 0, part.w, part.h);

              const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
              const exportUrl = URL.createObjectURL(blob);
              const outputName = `${baseName}_crop_${part.suffix}`;

              let finalOutputName = outputName;
              let counter = 1;
              while (existingImages.some(img => img.name === `${finalOutputName}.png`)) {
                finalOutputName = `${outputName}_${counter}`;
                counter++;
              }

              await AssetManager.saveAsset(finalOutputName, exportUrl, outputDir);
              
              const savedBlobUrl = await AssetManager.getFileBlobUrlByPath(`${outputDir}/${finalOutputName}.png`);
              if (savedBlobUrl) processedBlobUrls.push(savedBlobUrl);

              URL.revokeObjectURL(exportUrl);
            }

            successCount++;
          } catch (err) {
            console.error('Failed to crop image:', fileEntry.name, err);
          } finally {
            if (loaded) URL.revokeObjectURL(loaded.url);
          }
        }

      } else if (fitMode === 'desaturate') {
        // 去除飽和度：每張圖原尺寸轉灰階後存檔
        for (let i = 0; i < files.length; i++) {
          const fileEntry = files[i];
          updateProgress(`正在處理圖片 (${i + 1}/${files.length}): ${fileEntry.name}...`, (i / files.length) * 100);
          let loaded = null;
          try {
            loaded = await loadImageFromFileEntry(fileEntry);
            const canvas = document.createElement('canvas');
            canvas.width = loaded.img.naturalWidth;
            canvas.height = loaded.img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.filter = 'grayscale(1)';
            ctx.drawImage(loaded.img, 0, 0);

            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            const exportUrl = URL.createObjectURL(blob);

            const origName = fileEntry.name;
            const baseName = origName.substring(0, origName.lastIndexOf('.')) || origName;
            const outputBase = `${baseName}_processed`;
            let finalOutputName = outputBase;
            let counter = 1;
            while (existingImages.some(img => img.name === `${finalOutputName}.png`)) {
              finalOutputName = `${outputBase}_${counter}`;
              counter++;
            }

            await AssetManager.saveAsset(finalOutputName, exportUrl, outputDir);
            const savedBlobUrl = await AssetManager.getFileBlobUrlByPath(`${outputDir}/${finalOutputName}.png`);
            if (savedBlobUrl) processedBlobUrls.push(savedBlobUrl);
            URL.revokeObjectURL(exportUrl);
            successCount++;
          } catch (err) {
            console.error('Failed to desaturate image:', fileEntry.name, err);
          } finally {
            if (loaded) URL.revokeObjectURL(loaded.url);
          }
        }
      } else {
        const resVal = dom.scriptResolution.value;
        let targetW = 1024, targetH = 1024;
        if (resVal === '512') { targetW = 512; targetH = 512; }
        else if (resVal === '1024_512') { targetW = 1024; targetH = 512; }
        else if (resVal === '512_1024') { targetW = 512; targetH = 1024; }
        else if (resVal === '2048') { targetW = 2048; targetH = 2048; }

        const align = dom.scriptAlign.value;
        let bgColor = dom.scriptBg.value;
        if (bgColor === 'custom') bgColor = dom.scriptBgPicker.value;

        for (let i = 0; i < files.length; i++) {
          const fileEntry = files[i];
          updateProgress(`正在處理圖片 (${i + 1}/${files.length}): ${fileEntry.name}...`, (i / files.length) * 100);

          let loaded = null;
          try {
            loaded = await loadImageFromFileEntry(fileEntry);
            const canvas = document.createElement('canvas');
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d');

            if (bgColor === 'transparent') {
              ctx.clearRect(0, 0, targetW, targetH);
            } else {
              ctx.fillStyle = bgColor;
              ctx.fillRect(0, 0, targetW, targetH);
            }

            const layout = calculateFitLayout(loaded.img.naturalWidth, loaded.img.naturalHeight, targetW, targetH, fitMode, align);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(loaded.img, layout.dx, layout.dy, layout.dw, layout.dh);

            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            const exportUrl = URL.createObjectURL(blob);

            const origName = fileEntry.name;
            const baseName = origName.substring(0, origName.lastIndexOf('.')) || origName;
            const outputBase = `${baseName}_processed`;
            
            let finalOutputName = outputBase;
            let counter = 1;
            while (existingImages.some(img => img.name === `${finalOutputName}.png`)) {
              finalOutputName = `${outputBase}_${counter}`;
              counter++;
            }

            await AssetManager.saveAsset(finalOutputName, exportUrl, outputDir);
            
            const savedBlobUrl = await AssetManager.getFileBlobUrlByPath(`${outputDir}/${finalOutputName}.png`);
            if (savedBlobUrl) processedBlobUrls.push(savedBlobUrl);

            URL.revokeObjectURL(exportUrl);
            successCount++;
          } catch (err) {
            console.error('Failed to resize image:', fileEntry.name, err);
          } finally {
            if (loaded) URL.revokeObjectURL(loaded.url);
          }
        }
      }

      // Propagate processed images downstream in SimpleWorkflow if triggerNode exists
      if (triggerNode && processedBlobUrls.length > 0) {
        const groupsObj = window.SimpleWorkflow?.getGroups?.() || {};
        let parentGroup = null;
        for (const gid in groupsObj) {
          const g = groupsObj[gid];
          if (triggerNode.x >= g.x && triggerNode.y >= g.y && 
              triggerNode.x + triggerNode.width <= g.x + g.width && 
              triggerNode.y + (triggerNode.el?.offsetHeight || 0) <= g.y + g.height) {
            parentGroup = g;
            break;
          }
        }
        
        const sourceEntity = parentGroup || triggerNode;
        if (sourceEntity) {
          sourceEntity.resultImages = [...processedBlobUrls];
          if (window.SimpleWorkflow?.propagateVisualImages) {
            window.SimpleWorkflow.propagateVisualImages();
          }
        }
      }

    } catch (err) {
      console.error(err);
      alert('自動化處理出錯：' + err.message);
    }

    updateProgress('自動化處理完成', 100);
    setTimeout(() => showProgress(false), 1200);

    await AssetManager.refreshUI();
    
    if (window.showToast) {
      window.showToast(`🤖 自動化腳本執行完畢！已成功處理 ${successCount} 個項目並存入本機！`);
    }
  }

  // ──────────── Populate folders dropdown for Script Modal ────────────
  // ──────────── 自動化腳本「檔案設定」預設集 ────────────
  // 持久化到「連結的本機工作夾」根目錄的 JSON 檔（耐久，不像 localStorage 易被清空）。
  // 記憶體快取供同步渲染；變更時非同步寫回磁碟。舊的 localStorage 僅用於一次性搬移救回。
  const SCRIPT_PRESETS_KEY = 'ps_ip_automation_scripts'; // legacy（僅讀取以搬移）
  const SCRIPT_PRESETS_FILE = 'studio_automation_scripts.json';
  let scriptPresetsCache = null;       // null = 尚未自磁碟載入
  let scriptPresetsLoading = null;     // 載入中的 Promise（避免重複）

  function getSavedScripts() {
    return Array.isArray(scriptPresetsCache) ? scriptPresetsCache : [];
  }

  // 設定快取並非同步寫回磁碟。
  function saveSavedScripts(arr) {
    scriptPresetsCache = Array.isArray(arr) ? arr : [];
    persistScriptPresets();
  }

  async function persistScriptPresets() {
    if (!AssetManager.isConnected()) {
      if (window.showToast) window.showToast('⚠️ 尚未連結本機資料夾，腳本暫存於本次工作階段，連結後將寫入磁碟', 3500);
      return;
    }
    try {
      await AssetManager.writeWorkspaceTextFile(SCRIPT_PRESETS_FILE, JSON.stringify(scriptPresetsCache || [], null, 2));
    } catch (e) {
      console.error('Persist script presets failed:', e);
      if (window.showToast) window.showToast('❌ 腳本寫入磁碟失敗：' + e.message, 3500);
    }
  }

  // 自磁碟載入腳本到快取；檔案不存在時，從舊 localStorage 搬移救回並寫成檔案。
  async function loadScriptPresetsFromDisk() {
    if (!AssetManager.isConnected()) { if (!scriptPresetsCache) scriptPresetsCache = []; return; }
    try {
      const text = await AssetManager.readWorkspaceTextFile(SCRIPT_PRESETS_FILE);
      if (text != null) {
        const arr = JSON.parse(text);
        scriptPresetsCache = Array.isArray(arr) ? arr : [];
      } else {
        // 檔案不存在 → 嘗試從舊 localStorage 搬移
        let legacy = [];
        try { legacy = JSON.parse(localStorage.getItem(SCRIPT_PRESETS_KEY) || '[]'); } catch {}
        scriptPresetsCache = Array.isArray(legacy) ? legacy : [];
        if (scriptPresetsCache.length) {
          await persistScriptPresets();
          if (window.showToast) window.showToast(`📦 已將 ${scriptPresetsCache.length} 個舊腳本搬移到本機工作夾`, 3000);
        }
      }
    } catch (e) {
      console.warn('Load script presets failed:', e);
      if (!scriptPresetsCache) scriptPresetsCache = [];
    }
    renderScriptPresets();
  }

  // 確保已嘗試載入一次（連結後）。
  function ensureScriptPresetsLoaded() {
    if (scriptPresetsCache !== null) return Promise.resolve();
    if (!scriptPresetsLoading) scriptPresetsLoading = loadScriptPresetsFromDisk().finally(() => { scriptPresetsLoading = null; });
    return scriptPresetsLoading;
  }

  // 擷取目前腳本表單的所有欄位成一個設定物件。
  function gatherScriptConfig() {
    return {
      sourceDir: dom.scriptSourceDir.value,
      outputDir: dom.scriptOutputDir.value,
      resolution: dom.scriptResolution.value,
      fitMode: dom.scriptFitMode.value,
      align: dom.scriptAlign.value,
      bg: dom.scriptBg.value,
      bgPicker: dom.scriptBgPicker.value,
      stitchDir: dom.scriptStitchDir.value,
      stitchGridCols: dom.scriptStitchGridCols.value,
      stitchGap: dom.scriptStitchGap.value,
      stitchAlign: dom.scriptStitchAlign.value,
      stitchSize: dom.scriptStitchSize.value,
      cropRefLine: dom.scriptCropRefLine.value,
      prefixFilter: dom.scriptPrefixFilter.value,
      keyword: dom.scriptKeyword.value,
      autoRun: !!dom.scriptAutoRun.checked
    };
  }

  // 只有當下拉選單仍有該選項時才設定資料夾（資料夾清單依連結而異）。
  function setSelectIfOptionExists(sel, value) {
    if (value == null) return;
    if (Array.from(sel.options).some(o => o.value === value)) sel.value = value;
  }

  // 把設定物件寫回腳本表單，並派發 change 事件讓相依區塊正確顯示/隱藏。
  function applyScriptConfig(cfg) {
    if (!cfg) return;
    setSelectIfOptionExists(dom.scriptSourceDir, cfg.sourceDir);
    setSelectIfOptionExists(dom.scriptOutputDir, cfg.outputDir);
    if (cfg.resolution != null) dom.scriptResolution.value = cfg.resolution;
    if (cfg.fitMode != null) dom.scriptFitMode.value = cfg.fitMode;
    if (cfg.align != null) dom.scriptAlign.value = cfg.align;
    if (cfg.bg != null) dom.scriptBg.value = cfg.bg;
    if (cfg.bgPicker != null) dom.scriptBgPicker.value = cfg.bgPicker;
    if (cfg.stitchDir != null) dom.scriptStitchDir.value = cfg.stitchDir;
    if (cfg.stitchGridCols != null) dom.scriptStitchGridCols.value = cfg.stitchGridCols;
    if (cfg.stitchGap != null) dom.scriptStitchGap.value = cfg.stitchGap;
    if (cfg.stitchAlign != null) dom.scriptStitchAlign.value = cfg.stitchAlign;
    if (cfg.stitchSize != null) dom.scriptStitchSize.value = cfg.stitchSize;
    if (cfg.cropRefLine != null) dom.scriptCropRefLine.value = cfg.cropRefLine;
    if (cfg.prefixFilter != null) dom.scriptPrefixFilter.value = cfg.prefixFilter;
    if (cfg.keyword != null) dom.scriptKeyword.value = cfg.keyword;
    dom.scriptAutoRun.checked = !!cfg.autoRun;
    dom.scriptFitMode.dispatchEvent(new Event('change'));
    dom.scriptStitchDir.dispatchEvent(new Event('change'));
    dom.scriptBg.dispatchEvent(new Event('change'));
  }

  // 人類可讀的腳本功能名稱（卡片副標題用）。
  const SCRIPT_FIT_LABELS = {
    contain: '縮放適配', cover: '縮放填充', stretch: '拉伸填充',
    stitch: '圖片拼合', refcrop: '參考線裁切'
  };

  let activeScriptPresetName = null;

  // 卡片式渲染：每張卡 = 一個已儲存腳本，點擊載入、右上角 ✕ 刪除。
  function renderScriptPresets() {
    const list = getSavedScripts();
    if (dom.scriptPresetCount) dom.scriptPresetCount.textContent = list.length;
    const box = dom.scriptPresetCards;
    if (!box) return;
    box.innerHTML = '';
    if (list.length === 0) {
      box.innerHTML = '<div class="ip-preset-empty">尚無已儲存腳本，設定好參數後按「💾 儲存目前設定」。</div>';
      return;
    }
    list.forEach(item => {
      const card = document.createElement('div');
      card.className = 'ip-preset-card' + (item.name === activeScriptPresetName ? ' active' : '');
      const fit = SCRIPT_FIT_LABELS[item.config?.fitMode] || item.config?.fitMode || '';
      const res = item.config?.resolution || '';
      const autoOn = !!item.config?.autoRun;
      card.innerHTML =
        `<button class="ip-preset-card-del" title="刪除">✕</button>` +
        `<div class="ip-preset-card-name"></div>` +
        `<div class="ip-preset-card-meta">${escHtml(fit)}${res ? ' · ' + escHtml(String(res)) : ''}</div>` +
        `<div class="ip-preset-card-actions">` +
          `<button class="ip-preset-run" title="馬上用此腳本執行">▶ 馬上執行</button>` +
          `<label class="ip-preset-auto" title="偵測到符合關鍵字的新圖片時自動執行此腳本"><input type="checkbox" class="ip-preset-auto-cb" ${autoOn ? 'checked' : ''}> 自動執行</label>` +
        `</div>`;
      card.querySelector('.ip-preset-card-name').textContent = item.name;
      card.title = '點擊載入並編輯此腳本';
      // 點卡片本體（非按鈕/開關）→ 載入並開啟模態框編輯
      card.addEventListener('click', (e) => {
        if (e.target.closest('.ip-preset-card-del, .ip-preset-run, .ip-preset-auto')) return;
        loadScriptPreset(item.name, true);
      });
      card.querySelector('.ip-preset-card-del').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteScriptPreset(item.name);
      });
      card.querySelector('.ip-preset-run').addEventListener('click', (e) => {
        e.stopPropagation();
        runScriptPreset(item.name);
      });
      card.querySelector('.ip-preset-auto-cb').addEventListener('change', (e) => {
        e.stopPropagation();
        setScriptPresetAutoRun(item.name, e.target.checked);
      });
      box.appendChild(card);
    });
  }

  function saveCurrentScriptPreset() {
    const name = (prompt('請輸入腳本名稱（同名將覆寫）：', activeScriptPresetName || '') || '').trim();
    if (!name) return;
    const list = getSavedScripts();
    const idx = list.findIndex(i => i.name === name);
    const entry = { name, savedAt: Date.now(), config: gatherScriptConfig() };
    if (idx >= 0) list[idx] = entry; else list.push(entry);
    saveSavedScripts(list);
    activeScriptPresetName = name;
    renderScriptPresets();
    if (window.showToast) window.showToast(`💾 已儲存腳本「${name}」`);
  }

  // 載入腳本到表單；openModal=true 時同時開啟模態框供編輯。
  function loadScriptPreset(name, openModal) {
    const item = getSavedScripts().find(i => i.name === name);
    if (!item) return;
    if (AssetManager.isConnected()) populateScriptFolders();
    applyScriptConfig(item.config);
    activeScriptPresetName = name;
    renderScriptPresets();
    if (openModal && dom.scriptModal) dom.scriptModal.classList.remove('hidden');
    if (window.showToast) window.showToast(`📤 已載入腳本「${name}」`);
  }

  // 立即用指定腳本執行批次（不需先開模態框）。
  async function runScriptPreset(name) {
    const item = getSavedScripts().find(i => i.name === name);
    if (!item) return;
    if (!AssetManager.isConnected()) {
      alert('請先至「資產庫」連結本機資料夾，此自動化腳本功能直讀本機硬碟檔案！');
      return;
    }
    populateScriptFolders();
    applyScriptConfig(item.config);
    activeScriptPresetName = name;
    renderScriptPresets();
    await executeAutomation();
  }

  // 切換某腳本的「自動執行」並持久化（每張腳本獨立）。
  function setScriptPresetAutoRun(name, on) {
    const list = getSavedScripts();
    const item = list.find(i => i.name === name);
    if (!item) return;
    item.config = item.config || {};
    item.config.autoRun = !!on;
    saveSavedScripts(list);
    if (window.showToast) window.showToast(on ? `🔄 已開啟「${name}」自動執行` : `⏸ 已關閉「${name}」自動執行`);
  }

  function deleteScriptPreset(name) {
    if (!confirm(`確定刪除腳本「${name}」？`)) return;
    saveSavedScripts(getSavedScripts().filter(i => i.name !== name));
    if (activeScriptPresetName === name) activeScriptPresetName = null;
    renderScriptPresets();
    if (window.showToast) window.showToast(`🗑 已刪除腳本「${name}」`);
  }

  function populateScriptFolders() {
    if (!AssetManager.isConnected()) return;

    const folders = AssetManager.getAllFolderPaths();
    
    dom.scriptSourceDir.innerHTML = '';
    dom.scriptOutputDir.innerHTML = '';

    folders.forEach(path => {
      const opt1 = document.createElement('option');
      opt1.value = path;
      opt1.textContent = path;
      dom.scriptSourceDir.appendChild(opt1);

      const opt2 = document.createElement('option');
      opt2.value = path;
      opt2.textContent = path;
      dom.scriptOutputDir.appendChild(opt2);
    });

    // Default to active folder if possible
    const active = AssetManager.getActiveFolder();
    if (folders.includes(active)) {
      dom.scriptSourceDir.value = active;
      dom.scriptOutputDir.value = active;
    }
  }

  // ──────────── Populate folders dropdown for Global Output Dir ────────────
  function populateGlobalOutputDir() {
    if (!dom.globalOutputDir) return;
    const folders = AssetManager.isConnected() ? AssetManager.getAllFolderPaths() : ['根目錄'];
    const currentVal = dom.globalOutputDir.value || '根目錄';
    
    dom.globalOutputDir.innerHTML = '';
    folders.forEach(path => {
      const opt = document.createElement('option');
      opt.value = path;
      opt.textContent = path;
      dom.globalOutputDir.appendChild(opt);
    });
    
    if (folders.includes(currentVal)) {
      dom.globalOutputDir.value = currentVal;
    } else {
      dom.globalOutputDir.value = '根目錄';
    }
  }

  // ──────────── Execute Pending Import ────────────
  async function executePendingImport(action) {
    const pending = state.pendingImport;
    if (!pending) return;

    if (action === 'replace') {
      performClearAll(true); // silent clear
    }

    if (pending.type === 'files') {
      await handleFiles(pending.data);
    } else if (pending.type === 'fsa-folder') {
      showProgress(true);
      updateProgress('正在讀取資料夾內所有影像...', 0);
      try {
        const filesToLoad = AssetManager.getImagesUnderFolder(pending.path);
        let addedCount = 0;
        for (let i = 0; i < filesToLoad.length; i++) {
          try {
            updateProgress(`正在加載影像 ${i + 1}/${filesToLoad.length}...`, (i / filesToLoad.length) * 100);
            const file = await filesToLoad[i].handle.getFile();
            await loadAndAddImage(file);
            addedCount++;
          } catch (err) {
            console.error('載入圖片失敗:', err);
          }
        }
        updateProgress('載入完成', 100);
        setTimeout(() => showProgress(false), 800);
        renderGallery();
        updateActionButtons();
        if (addedCount > 0 && window.showToast) {
          window.showToast(`已成功載入資料夾「${pending.name}」下 ${addedCount} 張圖片`);
        }
      } catch (err) {
        console.error('讀取資料夾失敗:', err);
        showProgress(false);
      }
    } else if (pending.type === 'fsa-file') {
      await handleFsaAsset(pending.path, pending.name);
    } else if (pending.type === 'entries') {
      showProgress(true);
      updateProgress('正在讀取資料夾與檔案...', 5);
      const promises = pending.data.map(entry => traverseDirectoryEntry(entry));
      try {
        const results = await Promise.all(promises);
        const allFiles = results.flat();
        await handleFiles(allFiles);
      } catch (err) {
        console.error('遍歷拖拽項目時出錯:', err);
        if (window.showToast) window.showToast('⚠️ 讀取拖拽項目時出錯');
      } finally {
        showProgress(false);
      }
    }

    state.pendingImport = null;
    if (dom.importConflictModal) {
      dom.importConflictModal.classList.add('hidden');
    }
  }

  // ──────────── Workspace Drop Handler ────────────
  async function handleWorkspaceDrop(e) {
    e.preventDefault();
    const workspace = document.querySelector('.ip-center-workspace');
    if (workspace) workspace.classList.remove('dragover');

    // If modal is visible, block drop
    if (dom.importConflictModal && !dom.importConflictModal.classList.contains('hidden')) {
      return;
    }

    let pending = null;

    // 1. Check for internal FSA folder drop
    if (e.dataTransfer.types.includes('text/ide-asset-folder')) {
      const payloadStr = e.dataTransfer.getData('text/ide-asset-folder');
      try {
        const payload = JSON.parse(payloadStr);
        if (payload && payload.path) {
          pending = { type: 'fsa-folder', path: payload.path, name: payload.name };
        }
      } catch (err) {
        console.error('解析內部拖拽資料夾失敗:', err);
      }
    }
    // 2. Check for internal FSA asset drop
    else if (e.dataTransfer.types.includes('text/ide-asset')) {
      const payloadStr = e.dataTransfer.getData('text/ide-asset');
      try {
        const payload = JSON.parse(payloadStr);
        if (payload && payload.type === 'fsa' && payload.path) {
          pending = { type: 'fsa-file', path: payload.path, name: payload.name };
        }
      } catch (err) {
        console.error('解析內部拖拽資產失敗:', err);
      }
    }
    // 3. Handle standard files/folders from OS
    else {
      let entries = [];
      if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        for (let i = 0; i < e.dataTransfer.items.length; i++) {
          const item = e.dataTransfer.items[i];
          if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry();
            if (entry) {
              entries.push(entry);
            }
          }
        }
      }
      if (entries.length > 0) {
        pending = { type: 'entries', data: entries };
      } else if (e.dataTransfer.files.length > 0) {
        pending = { type: 'files', data: Array.from(e.dataTransfer.files) };
      }
    }

    if (!pending) return;

    // Check if workspace contains images
    if (state.images.length > 0) {
      state.pendingImport = pending;
      if (dom.importConflictModal) {
        dom.importConflictModal.classList.remove('hidden');
      }
    } else {
      state.pendingImport = pending;
      await executePendingImport('append');
    }
  }

  // ──────────── Initialization & Bindings ────────────
  function init() {
    if (dom.btnUpload) {
      dom.btnUpload.addEventListener('click', () => dom.fileInput.click());
    }

    if (dom.btnUnify) {
      dom.btnUnify.addEventListener('click', unifyParameters);
    }

    if (dom.globalResolution) {
      dom.globalResolution.addEventListener('change', (e) => {
        if (dom.globalCustomResGroup) {
          dom.globalCustomResGroup.style.display = e.target.value === 'custom' ? 'flex' : 'none';
        }
      });
    }

    if (dom.globalBg) {
      dom.globalBg.addEventListener('change', (e) => {
        if (dom.globalBgPicker) {
          dom.globalBgPicker.style.display = e.target.value === 'custom' ? 'inline-block' : 'none';
        }
      });
    }

    dom.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleFiles(e.target.files);
      }
      e.target.value = '';
    });

    // Modals open/close triggers
    dom.btnStitch.addEventListener('click', () => {
      dom.stitchModal.classList.remove('hidden');
    });

    dom.stitchModalClose.addEventListener('click', () => {
      dom.stitchModal.classList.add('hidden');
    });

    dom.stitchModalCancel.addEventListener('click', () => {
      dom.stitchModal.classList.add('hidden');
    });

    dom.stitchDir.addEventListener('change', (e) => {
      dom.stitchGridColsGroup.style.display = e.target.value === 'grid' ? 'block' : 'none';
    });

    dom.stitchBg.addEventListener('change', (e) => {
      dom.stitchBgPicker.style.display = e.target.value === 'custom' ? 'block' : 'none';
    });

    dom.stitchModalConfirm.addEventListener('click', stitchSelectedImages);

    dom.btnScript.addEventListener('click', () => {
      if (!AssetManager.isConnected()) {
        alert('請先至「資產庫」連結本機資料夾，此自動化腳本功能直讀本機硬碟檔案！');
        return;
      }
      populateScriptFolders();
      ensureScriptPresetsLoaded();
      renderScriptPresets();
      dom.scriptModal.classList.remove('hidden');
    });

    if (dom.scriptPresetSave) dom.scriptPresetSave.addEventListener('click', saveCurrentScriptPreset);

    dom.scriptModalClose.addEventListener('click', () => {
      dom.scriptModal.classList.add('hidden');
    });

    dom.scriptModalCancel.addEventListener('click', () => {
      dom.scriptModal.classList.add('hidden');
    });

    dom.scriptBg.addEventListener('change', (e) => {
      dom.scriptBgPicker.style.display = e.target.value === 'custom' ? 'block' : 'none';
    });

    dom.scriptFitMode.addEventListener('change', (e) => {
      const mode = e.target.value;
      if (mode === 'stitch') {
        dom.scriptStitchParams.style.display = 'block';
        dom.scriptCropParams.style.display = 'none';
        dom.scriptResBgParams.style.display = 'none';
        dom.scriptAlignBgParams.style.display = 'none';
      } else if (mode === 'refcrop') {
        dom.scriptStitchParams.style.display = 'none';
        dom.scriptCropParams.style.display = 'block';
        dom.scriptResBgParams.style.display = 'none';
        dom.scriptAlignBgParams.style.display = 'none';
      } else if (mode === 'desaturate') {
        // 去除飽和度無額外參數
        dom.scriptStitchParams.style.display = 'none';
        dom.scriptCropParams.style.display = 'none';
        dom.scriptResBgParams.style.display = 'none';
        dom.scriptAlignBgParams.style.display = 'none';
      } else {
        dom.scriptStitchParams.style.display = 'none';
        dom.scriptCropParams.style.display = 'none';
        dom.scriptResBgParams.style.display = 'block';
        dom.scriptAlignBgParams.style.display = 'block';
      }
    });

    dom.scriptStitchDir.addEventListener('change', (e) => {
      dom.scriptStitchGridColsGroup.style.display = e.target.value === 'grid' ? 'block' : 'none';
    });

    dom.scriptBtnExecute.addEventListener('click', () => executeAutomation());

    // 初始渲染側欄（先空畫，連結後自磁碟載入並重繪）
    renderScriptPresets();
    ensureScriptPresetsLoaded();

    // --- Auto-trigger on Node Saved Asset：逐一比對已儲存腳本（每張獨立 autoRun + keyword）---
    let autoRunTimeout = null;

    window.addEventListener('node-saved-asset', (event) => {
      if (state.processing || state.isProcessingAutomation) return;

      const { filename, node } = event.detail;
      if (filename.includes('_processed') || filename.includes('_stitched') || filename.includes('_crop_')) {
        return; // Skip output files to prevent infinite loops
      }

      // 找出所有「開啟自動執行 + 關鍵字命中」的腳本
      const matches = getSavedScripts().filter(s =>
        s.config && s.config.autoRun && s.config.keyword && filename.includes(s.config.keyword.trim())
      );
      if (matches.length === 0) return;

      if (autoRunTimeout) clearTimeout(autoRunTimeout);
      autoRunTimeout = setTimeout(async () => {
        state.isProcessingAutomation = true;
        try {
          for (const s of matches) {
            if (window.showToast) window.showToast(`🤖 自動偵測到圖片，執行腳本「${s.name}」...`);
            if (AssetManager.isConnected()) populateScriptFolders();
            applyScriptConfig(s.config);
            await executeAutomation(node);
          }
        } catch (e) {
          console.error('Auto trigger execution failed:', e);
        } finally {
          state.isProcessingAutomation = false;
        }
      }, 800);
    });

    // Action buttons click
    dom.btnProcess.addEventListener('click', processAll);
    dom.btnClear.addEventListener('click', clearAll);
    if (dom.btnClearInspector) {
      dom.btnClearInspector.addEventListener('click', () => performClearAll(false));
    }

    // Conflict modal action bindings
    if (dom.importConflictReplace) {
      dom.importConflictReplace.addEventListener('click', () => executePendingImport('replace'));
    }
    if (dom.importConflictAppend) {
      dom.importConflictAppend.addEventListener('click', () => executePendingImport('append'));
    }
    if (dom.importConflictCancel) {
      dom.importConflictCancel.addEventListener('click', () => {
        state.pendingImport = null;
        if (dom.importConflictModal) dom.importConflictModal.classList.add('hidden');
      });
    }
    if (dom.importConflictClose) {
      dom.importConflictClose.addEventListener('click', () => {
        state.pendingImport = null;
        if (dom.importConflictModal) dom.importConflictModal.classList.add('hidden');
      });
    }

    // Watch for AssetManager link focus restores to re-sync directories
    window.addEventListener('assets-tree-updated', () => {
      populateGlobalOutputDir();
      if (!dom.scriptModal.classList.contains('hidden')) {
        populateScriptFolders();
      }
      renderGallery();
      ensureScriptPresetsLoaded(); // 連結/重整工作夾後自磁碟載入腳本（僅首次）
    });

    // Sidebar Toggle
    if (dom.btnAssetToggle && dom.leftAssets) {
      dom.btnAssetToggle.addEventListener('click', () => {
        const isHidden = dom.leftAssets.style.display === 'none';
        if (isHidden) {
          dom.leftAssets.style.display = 'flex';
          if (dom.assetResizer) dom.assetResizer.style.display = 'block';
          dom.btnAssetToggle.classList.add('active');
          if (window.AssetManager) {
            window.AssetManager.refreshUI();
          }
        } else {
          dom.leftAssets.style.display = 'none';
          if (dom.assetResizer) dom.assetResizer.style.display = 'none';
          dom.btnAssetToggle.classList.remove('active');
        }
      });
    }

    if (dom.assetClose && dom.leftAssets) {
      dom.assetClose.addEventListener('click', () => {
        dom.leftAssets.style.display = 'none';
        if (dom.assetResizer) dom.assetResizer.style.display = 'none';
        if (dom.btnAssetToggle) dom.btnAssetToggle.classList.remove('active');
      });
    }

    // Resizer Dragging
    if (dom.assetResizer && dom.leftAssets) {
      let startX, startW;
      dom.assetResizer.addEventListener('mousedown', e => {
        startX = e.clientX;
        startW = dom.leftAssets.offsetWidth;
        dom.assetResizer.classList.add('dragging');
        document.body.classList.add('is-resizing');

        const onMove = e => {
          const w = Math.min(360, Math.max(160, startW + e.clientX - startX));
          dom.leftAssets.style.width = w + 'px';
        };

        const onUp = () => {
          dom.assetResizer.classList.remove('dragging');
          document.body.classList.remove('is-resizing');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }

    // Unified OS + FSA drag and drop on center workspace
    const workspace = document.querySelector('.ip-center-workspace');
    if (workspace) {
      workspace.addEventListener('dragover', (e) => {
        e.preventDefault();
        workspace.classList.add('dragover');
      });

      workspace.addEventListener('dragleave', (e) => {
        if (e.target === workspace || e.target.id === 'ipGallery' || e.target.id === 'ipEmptyState') {
          workspace.classList.remove('dragover');
        }
      });

      workspace.addEventListener('drop', handleWorkspaceDrop);
    }

    // Populate initial dropdown values
    populateGlobalOutputDir();
  }

  // Bind init events
  init();

  // Expose public API
  // ──────────── 記憶體內單張影像轉換 ────────────
  // 供 Simple Workflow 群組「完成後自動化」呼叫：直接對一張 dataURL/blobURL 套用
  // 腳本的影像轉換，回傳處理後的 dataURL 陣列。不讀來源資料夾、不寫輸出資料夾
  // （存檔交給呼叫端，維持單一存檔路徑）。stitch（多圖合併）對單張不適用，原樣回傳。
  function loadImageElement(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function processImageInMemory(srcUrl, config) {
    config = config || {};
    const fitMode = config.fitMode || 'contain';
    if (fitMode === 'stitch') return [srcUrl]; // 多圖合併不適用單張節點輸出

    const img = await loadImageElement(srcUrl);

    if (fitMode === 'desaturate') {
      // 去除飽和度：原尺寸轉灰階，不縮放、不裁切
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.filter = 'grayscale(1)';
      ctx.drawImage(img, 0, 0);
      return [canvas.toDataURL('image/png')];
    }

    if (fitMode === 'refcrop') {
      const W = img.naturalWidth, H = img.naturalHeight;
      const cropParts = [];
      if ((config.cropRefLine || 'crosshair') === 'crosshair') {
        const halfW = Math.round(W / 2), halfH = Math.round(H / 2);
        cropParts.push({ x: 0, y: 0, w: halfW, h: halfH });
        cropParts.push({ x: halfW, y: 0, w: W - halfW, h: halfH });
        cropParts.push({ x: 0, y: halfH, w: halfW, h: H - halfH });
        cropParts.push({ x: halfW, y: halfH, w: W - halfW, h: H - halfH });
      } else {
        const xs = [0, Math.round(W / 3), Math.round(2 * W / 3), W];
        const ys = [0, Math.round(H / 3), Math.round(2 * H / 3), H];
        for (let r = 0; r < 3; r++)
          for (let c = 0; c < 3; c++)
            cropParts.push({ x: xs[c], y: ys[r], w: xs[c + 1] - xs[c], h: ys[r + 1] - ys[r] });
      }
      return cropParts.map(part => {
        const canvas = document.createElement('canvas');
        canvas.width = part.w; canvas.height = part.h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, part.x, part.y, part.w, part.h, 0, 0, part.w, part.h);
        return canvas.toDataURL('image/png');
      });
    }

    // contain / cover / stretch → 縮放適配到目標解析度 + 背景填充
    let targetW = 1024, targetH = 1024;
    const resVal = config.resolution;
    if (resVal === '512') { targetW = 512; targetH = 512; }
    else if (resVal === '1024_512') { targetW = 1024; targetH = 512; }
    else if (resVal === '512_1024') { targetW = 512; targetH = 1024; }
    else if (resVal === '2048') { targetW = 2048; targetH = 2048; }

    let bgColor = config.bg;
    if (bgColor === 'custom') bgColor = config.bgPicker || '#FFFFFF';

    const canvas = document.createElement('canvas');
    canvas.width = targetW; canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (bgColor === 'transparent') ctx.clearRect(0, 0, targetW, targetH);
    else { ctx.fillStyle = bgColor || '#FFFFFF'; ctx.fillRect(0, 0, targetW, targetH); }

    const layout = calculateFitLayout(img.naturalWidth, img.naturalHeight, targetW, targetH, fitMode, config.align || 'center');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, layout.dx, layout.dy, layout.dw, layout.dh);
    return [canvas.toDataURL('image/png')];
  }

  window.ImageProcess = {
    addFsaAsset: handleFsaAsset,
    getSavedScripts,
    ensureScriptPresetsLoaded,
    processImageInMemory,
    stitchImagesFromUrls
  };
})();
