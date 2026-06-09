(function() {
  const container = document.getElementById('workflowCanvas');
  const toolbar = document.getElementById('wfToolbar');
  const runBtn = document.getElementById('wfGenerateRunBtn');
  
  if (!container) return;

  // Wait for G6 to be available from CDN
  const checkG6 = setInterval(() => {
    if (window.G6) {
      clearInterval(checkG6);
      initWorkflow();
    }
  }, 100);

  function initWorkflow() {
    const { Graph } = window.G6;

    // Remove old SVG
    const oldSvg = document.getElementById('workflowSvg');
    if (oldSvg) oldSvg.remove();

    let nodeIdCounter = 3;
    let nodeDOMCache = {};
    window.nodeDOMCache = nodeDOMCache;

    function syncDOMToGraph() {
      if (!graph || graph.destroyed) return;
      const nodes = graph.getNodeData ? graph.getNodeData() : [];
      let updated = false;
      nodes.forEach(n => {
        const el = nodeDOMCache[n.id];
        if (!el) return;
        const type = n.data.type;
        let changed = false;
        if (type === 'model') {
          const val = el.querySelector('.wf-model-sel').value;
          if (n.data.model !== val) { n.data.model = val; changed = true; }
          const _pe = el.querySelector('.wf-model-params');
          if (_pe) {
            const _temp = parseFloat(el.querySelector('.wf-temp-slider').value);
            const _aSel = el.querySelector('.wf-aspect-sel').value;
            const _aCustom = el.querySelector('.wf-custom-aspect').value.trim();
            const _aspect = _aSel === 'custom' ? (_aCustom || '1:1') : _aSel;
            const _imageSize = el.querySelector('.wf-image-size-sel').value;
            const _thinking = el.querySelector('.wf-thinking-sel').value;
            const _gs = el.querySelector('.wf-google-search').checked;
            const _stopRaw = el.querySelector('.wf-stop-seq').value;
            const _stops = _stopRaw.split(',').map(s => s.trim()).filter(Boolean);
            const _outLen = parseInt(el.querySelector('.wf-output-length').value) || 65536;
            const _topP = parseFloat(el.querySelector('.wf-topp-slider').value);
            if (n.data.temperature !== _temp) { n.data.temperature = _temp; changed = true; }
            if (n.data.aspectRatio !== _aspect) { n.data.aspectRatio = _aspect; changed = true; }
            if (n.data.imageSize !== _imageSize) { n.data.imageSize = _imageSize; changed = true; }
            if (n.data.thinkingLevel !== _thinking) { n.data.thinkingLevel = _thinking; changed = true; }
            if (n.data.googleSearch !== _gs) { n.data.googleSearch = _gs; changed = true; }
            if (JSON.stringify(n.data.stopSequences) !== JSON.stringify(_stops)) { n.data.stopSequences = _stops; changed = true; }
            if (n.data.outputLength !== _outLen) { n.data.outputLength = _outLen; changed = true; }
            if (n.data.topP !== _topP) { n.data.topP = _topP; changed = true; }
          }
        } else if (type === 'parameters') {
           const val = el.querySelector('.wf-res-sel').value;
           if(n.data.resolution !== val) { n.data.resolution = val; changed = true; }
        } else if (type === 'prompt') {
           const ta = el.querySelector('.wf-prompt-input');
           const val = window.EditorService ? window.EditorService.getContent(ta.id) : ta.value;
           if(n.data.prefill !== val) { n.data.prefill = val; changed = true; }
        } else if (type === 'img2img') {
           const input = el.querySelector('.wf-i2i-base');
           if (input) {
             const val = input.value;
             if(n.data.initialImage !== val) { n.data.initialImage = val; changed = true; }
           }
           const folderSel = el.querySelector('.wf-i2i-folder');
           if (folderSel) {
             const val = folderSel.value;
             if(n.data.saveFolder !== val) { n.data.saveFolder = val; changed = true; }
           }
        } else if (type === 'mask') {
           const val = el.dataset.maskData;
           if(n.data.maskData !== val) { n.data.maskData = val; changed = true; }
        }
        if (changed) updated = true;
      });
      if (updated && graph.updateNodeData) {
         graph.updateNodeData(nodes);
      }
    }
    
    // Inject Custom Focus Style
    if (!document.getElementById('wf-custom-focus-style')) {
      const styleTag = document.createElement('style');
      styleTag.id = 'wf-custom-focus-style';
      styleTag.innerHTML = `
        .wf-node-selected {
          outline: 3px solid #1783FF !important;
          box-shadow: 0 0 15px rgba(23, 131, 255, 0.6) !important;
          border-radius: 10px;
        }
      `;
      document.head.appendChild(styleTag);
    }

    // Helper to resolve a single asset tag to its base64 data
    async function resolveAssetTag(str) {
      if (!str) return str;
      const regex = /\[@([^:]+):([^\]]+)\]/;
      const match = str.match(regex);
      if (match) {
        const assetId = match[2];
        if (window.AssetsService) {
          try {
            const asset = await window.AssetsService.getAsset(assetId);
            if (asset && asset.data) {
              return asset.data;
            }
          } catch (e) {
            console.error('Failed to get asset', assetId, e);
          }
        }
      }
      return str;
    }

    // Helper to parse prompt, extract first asset tag as base image, and clean the text
    async function resolvePromptAndExtractImage(promptText, state) {
      if (!promptText) return '';
      const regex = /\[@([^:]+):([^\]]+)\]/g;
      const matches = [...promptText.matchAll(regex)];
      let cleanedPrompt = promptText;
      
      for (const match of matches) {
        const assetName = match[1];
        const assetId = match[2];
        
        if (window.AssetsService) {
          try {
            const asset = await window.AssetsService.getAsset(assetId);
            if (asset && asset.data) {
              state.i2i_base = asset.data;
            }
          } catch (e) {
            console.error('Failed to resolve asset in prompt:', e);
          }
        }
        cleanedPrompt = cleanedPrompt.replace(match[0], assetName);
      }
      return cleanedPrompt;
    }

    // Helper to update img2img node base image preview
    async function updateI2IPreview(val, previewImg, downloadBtn, previewPlaceholder) {
      if (!val) {
        previewImg.style.display = 'none';
        downloadBtn.style.display = 'none';
        previewPlaceholder.style.display = 'flex';
        previewPlaceholder.textContent = 'No Image';
        return;
      }
      
      let imgSrc = val;
      if (val.includes('[@') && val.includes(']')) {
        const regex = /\[@([^:]+):([^\]]+)\]/;
        const match = val.match(regex);
        if (match && window.AssetsService) {
          try {
            const asset = await window.AssetsService.getAsset(match[2]);
            if (asset && asset.data) {
              imgSrc = asset.data;
            }
          } catch (e) {
            console.error(e);
          }
        }
      }
      
      if (imgSrc && (imgSrc.startsWith('data:') || imgSrc.startsWith('http') || imgSrc.startsWith('blob:'))) {
        previewImg.src = imgSrc;
        previewImg.style.display = 'block';
        downloadBtn.style.display = 'block';
        previewPlaceholder.style.display = 'none';
        
        // Auto-save to authorized local directory if it's a generated/pasted base64 image
        // To prevent infinite re-saving when re-opening workflow, we could check a dataset flag, 
        // but for simplicity, we just save if it's base64 and authorized. 
        // We'll mark the image to avoid duplicate saves.
        if (imgSrc.startsWith('data:image/') && window.localDirHandle && window.AssetsService && window.AssetsService.saveAssetToLocalDir) {
          const savedKey = 'saved_' + (imgSrc.length); // simple hash
          if (previewImg.dataset.lastSaved !== savedKey) {
            previewImg.dataset.lastSaved = savedKey;
            const filename = 'img2img_' + Date.now() + '.png';
            window.AssetsService.saveAssetToLocalDir(imgSrc, filename);
          }
        }

      } else {
        previewImg.style.display = 'none';
        downloadBtn.style.display = 'none';
        previewPlaceholder.style.display = 'flex';
        previewPlaceholder.textContent = 'Invalid Image';
      }
    }

    function createNodeDOM(datum) {
      const type = datum.data.type;
      const id = datum.id;
      
      if (nodeDOMCache[id]) return nodeDOMCache[id];
      
      const el = document.createElement('div');
      el.id = 'wf-node-dom-' + id;
      el.className = 'wf-node';
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.position = 'relative';
      el.dataset.type = type;

      let headerText = '';
      let bodyHTML = '';

      if (type === 'model') {
        headerText = '生成模型 (Model)';
        const _isGpt = datum.data.model === 'gptimage';
        const _savedTemp = datum.data.temperature ?? 0.4;
        const _savedAspect = datum.data.aspectRatio || '1:1';
        const _savedImageSize = datum.data.imageSize || '';
        const _stdAspects = ['1:1','16:9','9:16','4:3','3:4','21:9','3:2','2:3','4:5','5:4'];
        const _isCustomAspect = !_stdAspects.includes(_savedAspect);
        const _savedThinking = datum.data.thinkingLevel || 'none';
        const _savedGS = datum.data.googleSearch || false;
        const _savedStopSeq = datum.data.stopSequences ? datum.data.stopSequences.join(',') : '';
        const _savedOutputLen = datum.data.outputLength ?? 65536;
        const _savedTopP = datum.data.topP ?? 0.95;
        bodyHTML = `
          <label style="color:var(--node-text); font-weight:500; font-size:11px; margin-bottom:2px; display:block;">Model</label>
          <select class="form-select form-select-sm wf-model-sel" style="width:100%; background:var(--node-input-bg); color:var(--node-text); border:1px solid var(--node-input-border); border-radius:4px; margin-bottom:8px;">
            <option value="nanobanana2" ${datum.data.model === 'nanobanana2' || !datum.data.model ? 'selected' : ''}>Nano Banana 2</option>
            <option value="nanobanana" ${datum.data.model === 'nanobanana' ? 'selected' : ''}>Nano Banana Pro</option>
            <option value="gptimage" ${datum.data.model === 'gptimage' ? 'selected' : ''}>GPT Image 2.0</option>
          </select>
          <div class="wf-model-params" style="display:${_isGpt ? 'none' : 'flex'}; flex-direction:column; flex:1; overflow-y:auto; gap:0;">
            <div style="margin-bottom:8px;">
              <label style="color:var(--node-text); font-size:11px; font-weight:500; display:flex; justify-content:space-between; margin-bottom:2px;">
                <span>Temperature</span><span class="wf-temp-val" style="color:var(--accent,#4ade80);">${_savedTemp.toFixed(2)}</span>
              </label>
              <input type="range" class="wf-temp-slider" min="0" max="2" step="0.05" value="${_savedTemp}" style="width:100%; accent-color:var(--accent,#4ade80); cursor:pointer;">
            </div>
            <div style="margin-bottom:8px;">
              <label style="color:var(--node-text); font-size:11px; font-weight:500; display:block; margin-bottom:2px;">Aspect Ratio</label>
              <select class="form-select form-select-sm wf-aspect-sel" style="width:100%; background:var(--node-input-bg); color:var(--node-text); border:1px solid var(--node-input-border); border-radius:4px; margin-bottom:4px;">
                <option value="1:1" ${!_isCustomAspect && _savedAspect==='1:1' ? 'selected':''}>1:1</option>
                <option value="16:9" ${!_isCustomAspect && _savedAspect==='16:9' ? 'selected':''}>16:9</option>
                <option value="9:16" ${!_isCustomAspect && _savedAspect==='9:16' ? 'selected':''}>9:16</option>
                <option value="4:3" ${!_isCustomAspect && _savedAspect==='4:3' ? 'selected':''}>4:3</option>
                <option value="3:4" ${!_isCustomAspect && _savedAspect==='3:4' ? 'selected':''}>3:4</option>
                <option value="3:2" ${!_isCustomAspect && _savedAspect==='3:2' ? 'selected':''}>3:2</option>
                <option value="2:3" ${!_isCustomAspect && _savedAspect==='2:3' ? 'selected':''}>2:3</option>
                <option value="4:5" ${!_isCustomAspect && _savedAspect==='4:5' ? 'selected':''}>4:5</option>
                <option value="5:4" ${!_isCustomAspect && _savedAspect==='5:4' ? 'selected':''}>5:4</option>
                <option value="21:9" ${!_isCustomAspect && _savedAspect==='21:9' ? 'selected':''}>21:9</option>
                <option value="custom" ${_isCustomAspect ? 'selected':''}>Custom...</option>
              </select>
              <input type="text" class="wf-custom-aspect" placeholder="e.g. 1:4" value="${_isCustomAspect ? _savedAspect : ''}" style="display:${_isCustomAspect ? 'block':'none'}; width:100%; background:var(--node-input-bg); color:var(--node-text); border:1px solid var(--node-input-border); border-radius:4px; padding:4px; box-sizing:border-box; font-size:11px;">
            </div>
            <div style="margin-bottom:8px;">
              <label style="color:var(--node-text); font-size:11px; font-weight:500; display:block; margin-bottom:2px;">Image Size</label>
              <select class="form-select form-select-sm wf-image-size-sel" style="width:100%; background:var(--node-input-bg); color:var(--node-text); border:1px solid var(--node-input-border); border-radius:4px;">
                <option value="" ${_savedImageSize==='' ? 'selected':''}>Default</option>
                <option value="512" ${_savedImageSize==='512' ? 'selected':''}>512px</option>
                <option value="1K" ${_savedImageSize==='1K' ? 'selected':''}>1K</option>
                <option value="2K" ${_savedImageSize==='2K' ? 'selected':''}>2K</option>
                <option value="4K" ${_savedImageSize==='4K' ? 'selected':''}>4K</option>
              </select>
            </div>
            <div style="margin-bottom:8px;">
              <label style="color:var(--node-text); font-size:11px; font-weight:500; display:block; margin-bottom:2px;">Thinking Level</label>
              <select class="form-select form-select-sm wf-thinking-sel" style="width:100%; background:var(--node-input-bg); color:var(--node-text); border:1px solid var(--node-input-border); border-radius:4px;">
                <option value="none" ${_savedThinking==='none' ? 'selected':''}>None</option>
                <option value="low" ${_savedThinking==='low' ? 'selected':''}>Low (Minimal)</option>
                <option value="high" ${_savedThinking==='high' ? 'selected':''}>High</option>
              </select>
            </div>
            <div style="margin-bottom:8px;">
              <label style="color:var(--node-text); font-size:11px; display:flex; align-items:center; gap:6px; cursor:pointer;">
                <input type="checkbox" class="wf-google-search" ${_savedGS ? 'checked':''} style="accent-color:var(--accent,#4ade80); cursor:pointer;">
                <span>Grounding with Google Search</span>
              </label>
            </div>
            <details class="wf-advanced">
              <summary style="color:var(--muted,#888); font-size:11px; cursor:pointer; user-select:none; padding:2px 0; margin-bottom:6px;">Advanced Settings</summary>
              <div style="margin-bottom:8px;">
                <label style="color:var(--node-text); font-size:11px; font-weight:500; display:block; margin-bottom:2px;">Stop Sequences</label>
                <input type="text" class="wf-stop-seq" placeholder="e.g. END,STOP" value="${_savedStopSeq}" style="width:100%; background:var(--node-input-bg); color:var(--node-text); border:1px solid var(--node-input-border); border-radius:4px; padding:4px; box-sizing:border-box; font-size:11px;">
              </div>
              <div style="margin-bottom:8px;">
                <label style="color:var(--node-text); font-size:11px; font-weight:500; display:block; margin-bottom:2px;">Output Length</label>
                <input type="number" class="wf-output-length" value="${_savedOutputLen}" min="1" max="65536" style="width:100%; background:var(--node-input-bg); color:var(--node-text); border:1px solid var(--node-input-border); border-radius:4px; padding:4px; box-sizing:border-box; font-size:11px;">
              </div>
              <div style="margin-bottom:4px;">
                <label style="color:var(--node-text); font-size:11px; font-weight:500; display:flex; justify-content:space-between; margin-bottom:2px;">
                  <span>Top P</span><span class="wf-topp-val" style="color:var(--accent,#4ade80);">${_savedTopP.toFixed(2)}</span>
                </label>
                <input type="range" class="wf-topp-slider" min="0" max="1" step="0.01" value="${_savedTopP}" style="width:100%; accent-color:var(--accent,#4ade80); cursor:pointer;">
              </div>
            </details>
          </div>
        `;
      } else if (type === 'prompt') {
        headerText = '提示詞 (Prompt)';
        bodyHTML = `
          <textarea id="${id}_prompt" class="wf-prompt-input" placeholder="輸入提示詞 (支援 / 與 @)..." style="width:100%; height:100%; min-height:80px; resize:none; box-sizing:border-box; outline:none; font-family:inherit; padding:8px; border:1px solid var(--node-input-border); border-radius:4px; background:var(--node-input-bg); color:var(--node-text);"></textarea>
        `;
      } else if (type === 'parameters') {
        headerText = '參數設定 (Parameters)';
        bodyHTML = `
          <label style="color:var(--node-text); font-weight:500;">Resolution</label>
          <select class="form-select form-select-sm wf-res-sel" style="width:100%; background:var(--node-input-bg); color:var(--node-text); border:1px solid var(--node-input-border); border-radius:4px;">
            <option value="1024x1024" ${datum.data.resolution === '1024x1024' || !datum.data.resolution ? 'selected' : ''}>1024x1024 (1:1)</option>
            <option value="1024x576" ${datum.data.resolution === '1024x576' ? 'selected' : ''}>1024x576 (16:9)</option>
            <option value="576x1024" ${datum.data.resolution === '576x1024' ? 'selected' : ''}>576x1024 (9:16)</option>
          </select>
        `;
      } else if (type === 'img2img') {
        headerText = '生成器 / 圖生圖 (Generator / Img2Img)';
        
        let folders = [];
        if (window.AssetsService && window.AssetsService.getFolders) {
            folders = window.AssetsService.getFolders();
        }
        if (folders.length === 0) folders = ['已完成'];
        let folderOptions = folders.map(f => `<option value="${f}" ${datum.data.saveFolder === f ? 'selected' : ''}>${f}</option>`).join('');
        
        bodyHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <label style="font-size:11px; font-weight:600; color:var(--node-text);">Base Image</label>
            <select class="wf-i2i-folder" style="font-size:10px; background:var(--node-input-bg); color:var(--node-text); border:1px solid var(--node-input-border); border-radius:4px; max-width:90px;" title="儲存資料夾">
              <option value="">(自動儲存)</option>
              ${folderOptions}
            </select>
          </div>
          <input type="text" class="form-input wf-i2i-base" placeholder="貼上或@資產..." style="margin-bottom:10px; width:100%; flex-shrink:0; background:var(--node-input-bg); color:var(--node-text); border:1px solid var(--node-input-border); border-radius:4px; padding:4px;">
          <div class="wf-preview-img-container" style="width:100%; flex:1; min-height:150px; position:relative; display:flex; background:var(--node-input-bg); border:1px solid var(--node-input-border); border-radius:4px;">
            <img class="wf-preview-img" src="" style="display:none; width:100%; height:100%; object-fit:contain; border-radius:4px; cursor:pointer;">
            <button class="wf-preview-download" style="display:none; position:absolute; top:6px; right:6px; background:rgba(0,0,0,0.55); color:#fff; border:none; border-radius:4px; padding:4px 8px; font-size:14px; cursor:pointer; z-index:5;" title="下載圖片">📥</button>
            <div class="wf-preview-placeholder" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:var(--muted); font-size:12px;">No Image</div>
          </div>
        `;
      } else if (type === 'mask') {
        headerText = '局部重繪遮罩 (Inpaint Mask)';
        bodyHTML = `
          <label style="color:var(--node-text); font-weight:500;">Mask Image (B/W)</label>
          <input type="text" class="form-input wf-mask-input" placeholder="貼上遮罩或@資產..." style="width:100%; margin-bottom:4px; background:var(--node-input-bg); color:var(--node-text); border:1px solid var(--node-input-border); border-radius:4px; padding:4px;">
          <input type="file" class="wf-mask-file" accept="image/*" style="display:none;">
          <div class="wf-mask-upload-btn" style="width:100%; height:80px; border:2px dashed var(--node-input-border); display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--muted); background:var(--node-input-bg); border-radius:4px; margin-top:4px;">
            點擊上傳遮罩圖
          </div>
        `;
      }

      el.innerHTML = `
        <div id="port-${id}-in" class="wf-dom-port" onpointerdown="window.__wfDragState='port'; window.__wfActivePort=this;" onmousedown="window.__wfDragState='port'; window.__wfActivePort=this;" style="position:absolute; left:-7px; top:50%; width:14px; height:14px; background:var(--node-input-bg); border:3px solid #1783FF; border-radius:50%; transform:translateY(-50%); cursor:crosshair; z-index:10; pointer-events:auto;" title="拖曳以連線"></div>
        <div id="port-${id}-out" class="wf-dom-port" onpointerdown="window.__wfDragState='port'; window.__wfActivePort=this;" onmousedown="window.__wfDragState='port'; window.__wfActivePort=this;" style="position:absolute; right:-7px; top:50%; width:14px; height:14px; background:var(--node-input-bg); border:3px solid #1783FF; border-radius:50%; transform:translateY(-50%); cursor:crosshair; z-index:10; pointer-events:auto;" title="拖曳以連線"></div>
        <div class="wf-node-header" onpointerdown="window.__wfDragState='header'" onmousedown="window.__wfDragState='header'" style="background:var(--node-header-bg); color:var(--node-header-text); padding:8px 12px; font-size:13px; font-weight:600; border-top-left-radius:10px; border-top-right-radius:10px; cursor:move; border-bottom:1px solid var(--node-border);">
          <span class="wf-node-title">${headerText}</span>
          <span class="wf-node-del" style="float:right; cursor:pointer; color:var(--muted);" title="刪除節點">&times;</span>
        </div>
        <div class="wf-node-body" style="padding:15px 12px; background:var(--node-body-bg); border:none; border-bottom-left-radius:10px; border-bottom-right-radius:10px; height:calc(100% - 34px); display:flex; flex-direction:column; overflow:hidden; box-sizing:border-box; color:var(--node-text); box-shadow:var(--node-shadow);">
          ${bodyHTML}
        </div>
        <div class="wf-node-resizer" style="position:absolute; right:2px; bottom:2px; width:16px; height:16px; cursor:nwse-resize; z-index:20; display:flex; align-items:flex-end; justify-content:flex-end; padding:2px;">
          <div style="width:0;height:0;border-left:8px solid transparent;border-bottom:8px solid var(--muted);border-bottom-right-radius:8px;"></div>
        </div>
      `;

      // Setup Node Resizer Drag Logic
      const resizer = el.querySelector('.wf-node-resizer');
      if (resizer) {
        resizer.addEventListener('pointerdown', (e) => {
          window.__wfDragState = 'resize';
          window.__wfResizeNodeId = id;
          window.__wfResizeStart = {
            x: e.clientX,
            y: e.clientY,
            w: el.offsetWidth,
            h: el.offsetHeight
          };
          e.stopPropagation();
        });
      }


      // Event listeners setup
      if (type === 'prompt' && window.EditorService) {
        setTimeout(() => {
          if(!window.EditorService.instances || !window.EditorService.instances[`${id}_prompt`]) {
             window.EditorService.setupRichPromptEditor(`${id}_prompt`);
          }
        }, 50);
      }

      // Prefill prompt text if specified in node data
      if (type === 'prompt' && datum.data.prefill) {
        const ta = el.querySelector('.wf-prompt-input');
        if (ta) {
          ta.value = datum.data.prefill;
          setTimeout(() => {
            if (window.EditorService) {
              window.EditorService.setContent(ta.id, datum.data.prefill);
            }
          }, 100);
        }
      }

      if (type === 'model') {
        const _modelSel = el.querySelector('.wf-model-sel');
        const _paramsDiv = el.querySelector('.wf-model-params');
        const _aspectSel = el.querySelector('.wf-aspect-sel');
        const _customAspect = el.querySelector('.wf-custom-aspect');
        const _tempSlider = el.querySelector('.wf-temp-slider');
        const _tempVal = el.querySelector('.wf-temp-val');
        const _toppSlider = el.querySelector('.wf-topp-slider');
        const _toppVal = el.querySelector('.wf-topp-val');

        _modelSel.addEventListener('change', () => {
          _paramsDiv.style.display = _modelSel.value === 'gptimage' ? 'none' : 'flex';
        });
        _aspectSel.addEventListener('change', () => {
          _customAspect.style.display = _aspectSel.value === 'custom' ? 'block' : 'none';
        });
        _tempSlider.addEventListener('input', () => {
          _tempVal.textContent = parseFloat(_tempSlider.value).toFixed(2);
        });
        _toppSlider.addEventListener('input', () => {
          _toppVal.textContent = parseFloat(_toppSlider.value).toFixed(2);
        });
      }

      // Parameters node no longer has interactive elements beyond the select

      if (type === 'img2img') {
        const input = el.querySelector('.wf-i2i-base');
        const previewImg = el.querySelector('.wf-preview-img');
        const previewPlaceholder = el.querySelector('.wf-preview-placeholder');
        const downloadBtn = el.querySelector('.wf-preview-download');

        // Click image to enlarge via LightBox
        previewImg.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (previewImg.src && window.AssetsService && window.AssetsService.openLightBox) {
            window.AssetsService.openLightBox(previewImg.src, 'Generated Image', false);
          }
        });

        // Download button
        downloadBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (!previewImg.src) return;
          const a = document.createElement('a');
          a.href = previewImg.src;
          a.download = 'generated_image_' + Date.now() + '.png';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        });

        const triggerPreviewUpdate = () => {
          updateI2IPreview(input.value, previewImg, downloadBtn, previewPlaceholder);
        };

        input.addEventListener('input', triggerPreviewUpdate);
        input.addEventListener('change', triggerPreviewUpdate);
        
        // Handle injected image (from paste)
        if (datum.data.initialImage) {
          input.value = datum.data.initialImage;
          triggerPreviewUpdate();
        } else if (input.value) {
          triggerPreviewUpdate();
        }
      }

      if (type === 'mask') {
        const fileInput = el.querySelector('.wf-mask-file');
        const preview = el.querySelector('.wf-mask-upload-btn');
        preview.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            el.dataset.maskData = ev.target.result;
            preview.innerHTML = `<img src="${ev.target.result}" style="width:100%; height:100%; object-fit:cover;">`;
          };
          reader.readAsDataURL(file);
        });
        
        if (datum.data.maskData) {
          el.dataset.maskData = datum.data.maskData;
          preview.innerHTML = `<img src="${datum.data.maskData}" style="width:100%; height:100%; object-fit:cover;">`;
        }
      }

      // Ensure node body elements capture pointer events so they can be clicked/focused
      const body = el.querySelector('.wf-node-body');
      if (body) {
        body.addEventListener('pointerdown', e => e.stopPropagation());
        body.addEventListener('mousedown', e => e.stopPropagation());
        body.addEventListener('wheel', e => e.stopPropagation());
      }
      
      const delBtn = el.querySelector('.wf-node-del');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const graph = window.workflowGraph;
          if (graph) {
            graph.removeNodeData([id]);
            delete nodeDOMCache[id];
            graph.draw();
          }
        });
      }

      // Block drag/drop propagation so dragging within node doesn't trigger canvas drop
      el.addEventListener('dragover', e => e.stopPropagation());
      el.addEventListener('drop', e => e.stopPropagation());

      // Support manual selection since pointer events are stopped by body
      el.addEventListener('click', () => {
        document.querySelectorAll('.wf-node-selected').forEach(n => n.classList.remove('wf-node-selected'));
        el.classList.add('wf-node-selected');
        window.__wfSelectedNodeId = id;
      });

      nodeDOMCache[id] = el;
      return el;
    }

    // Default graph data — 6-node chain
    const defaultPrompt2 = `編輯模式：尺寸不變，保持當前圖像形體和結構不變。未指定區域的所有圖像必須完全保持原樣，所有修改必須按照用戶的要求進行。不得重繪、修飾、增強、裁切、縮放、變色、銳化、模糊或改動任何像素。\n\n編輯：分析視覺主體，將圖像轉化為銳利，簡潔線稿，輪廓線介於1px~2px, 次要線0.2~0.5px。去除噪點\n\n采色：#ffffff,#000000`;
    let initialData = {
      nodes: [
        { id: 'node_1', data: { type: 'model' }, style: { x: 100, y: 200, ports: [{key:'in', position:'left', placement:'left'}, {key:'out', position:'right', placement:'right'}] } },
        { id: 'node_2', data: { type: 'prompt' }, style: { x: 450, y: 100, ports: [{key:'in', position:'left', placement:'left'}, {key:'out', position:'right', placement:'right'}] } },
        { id: 'node_4', data: { type: 'img2img' }, style: { x: 450, y: 350, ports: [{key:'in', position:'left', placement:'left'}, {key:'out', position:'right', placement:'right'}] } },
        { id: 'node_5', data: { type: 'prompt', prefill: defaultPrompt2 }, style: { x: 850, y: 100, ports: [{key:'in', position:'left', placement:'left'}, {key:'out', position:'right', placement:'right'}] } },
        { id: 'node_6', data: { type: 'img2img' }, style: { x: 850, y: 350, ports: [{key:'in', position:'left', placement:'left'}, {key:'out', position:'right', placement:'right'}] } }
      ],
      edges: [
        { source: 'node_1', target: 'node_2', sourcePort: 'out', targetPort: 'in', sourceAnchor: 1, targetAnchor: 0 },
        { source: 'node_2', target: 'node_4', sourcePort: 'out', targetPort: 'in', sourceAnchor: 1, targetAnchor: 0 },
        { source: 'node_4', target: 'node_5', sourcePort: 'out', targetPort: 'in', sourceAnchor: 1, targetAnchor: 0 },
        { source: 'node_5', target: 'node_6', sourcePort: 'out', targetPort: 'in', sourceAnchor: 1, targetAnchor: 0 }
      ]
    };

    const savedDataStr = localStorage.getItem('ps_workflow');
    if (savedDataStr) {
      try {
        const parsed = JSON.parse(savedDataStr);
        if (parsed && parsed.nodes && parsed.nodes.length > 0) {
          // Check if the saved nodes have coordinate data (graph.save() in G6 v5 drops them without our custom getGraphDataDump)
          if (parsed.nodes[0].style && parsed.nodes[0].style.x !== undefined) {
            initialData = parsed;
          } else {
            console.warn("Saved workflow nodes are missing coordinates due to old bug. Falling back to default.");
            localStorage.removeItem('ps_workflow');
          }
        }
      } catch (e) {
        console.error("Failed to parse saved workflow", e);
      }
    }

    // Provide invisible G6 ports so edges route perfectly to the bounding box edges
    function getPorts(type) {
      return [
        { key: 'in', placement: 'left' },
        { key: 'out', placement: 'right' }
      ];
    }

    function getNodeSize(type) {
      switch(type) {
        case 'model': return [280, 380];
        case 'prompt': return [304, 150];
        case 'parameters': return [224, 90];
        case 'img2img': return [284, 300];
        case 'mask': return [224, 160];
        default: return [224, 100];
      }
    }

    // Helper: get the canvas-space center of the current viewport
    function getViewportCenter() {
      const rect = container.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      try {
        const [x, y] = graph.getCanvasByClient([cx, cy]);
        return [x, y];
      } catch (e) {
        return [300, 200]; // fallback
      }
    }


    const graph = new window.G6.Graph({
      container: container,
      data: initialData,
      node: {
        type: 'html',
        style: {
          innerHTML: (datum) => createNodeDOM(datum),
          size: (datum) => getNodeSize(datum.data.type),
          ports: [
            { key: 'in', position: 'left', placement: 'left' },
            { key: 'out', position: 'right', placement: 'right' }
          ],
          anchorPoints: [
            [0, 0.5],
            [1, 0.5]
          ],
          portR: 0.1,
          portStrokeOpacity: 0,
          portFillOpacity: 0
        }
      },
      edge: {
        type: 'cubic-horizontal',
        style: {
          opacity: 0, // 徹底隱藏 G6 的原生連線
          stroke: 'transparent',
          lineWidth: 2,
          endArrow: true,
          cursor: 'pointer'
        },
        state: {
          selected: { stroke: '#ff4d4d', lineWidth: 3, shadowColor: '#ff4d4d', shadowBlur: 10 },
          hover: { stroke: '#40a9ff', lineWidth: 3 }
        }
      },
      behaviors: [
        'drag-canvas',
        'zoom-canvas',
        {
          type: 'drag-element',
          enable: () => window.__wfDragState === 'header'
        },
        {
          type: 'create-edge',
          trigger: 'drag',
          enable: () => window.__wfDragState === 'port',
          shouldBegin: (e) => {
              return window.__wfDragState === 'port';
            },
            onCreate: (edge) => {
              window.__wfDragState = null;
              window.__wfActivePort = null;
              if (window.scheduleHistory) window.scheduleHistory();
              if (edge.source === edge.target) return undefined; // No self loops
              return {
                ...edge,
                id: edge.id || `edge_${edge.source}_${edge.target}_${Date.now()}`,
                type: 'cubic-horizontal',
                sourcePort: 'out',
                targetPort: 'in',
                sourceAnchor: 1,
                targetAnchor: 0,
                style: {
                  opacity: 0, // 徹底隱藏 G6 的原生連線
                  stroke: 'transparent',
                  lineWidth: 2,
                  lineDash: [],
                  endArrow: true
                }
              };
            }
        },
        'click-select',
        {
           type: 'hover-activate',
           enable: (e) => e.targetType === 'edge' 
        } // Highlights edge on hover
      ]
    });

    graph.render();
    window.workflowGraph = graph;

    // === CUSTOM SVG EDGE OVERLAY (COMFYUI STYLE) ===
    const svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgOverlay.id = 'wf-custom-edges';
    svgOverlay.style.position = 'absolute';
    svgOverlay.style.top = '0';
    svgOverlay.style.left = '0';
    svgOverlay.style.width = '100%';
    svgOverlay.style.height = '100%';
    svgOverlay.style.pointerEvents = 'none';
    svgOverlay.style.zIndex = '0';
    container.style.position = 'relative';
    container.insertBefore(svgOverlay, container.firstChild);

    function updateCustomEdges() {
      if (!graph || graph.destroyed) return;

      const _wfPanel = document.getElementById('panel-workflow');
      if (!_wfPanel || !_wfPanel.classList.contains('active')) {
        requestAnimationFrame(updateCustomEdges);
        return;
      }

      let edges = [];
      try {
        edges = graph.getEdgeData ? graph.getEdgeData() : (graph.save ? graph.save().edges : []);
      } catch (e) {
        // ignore during init
      }
      const containerRect = container.getBoundingClientRect();
      
      let pathHTML = '';
      edges.forEach(edge => {
        const sourcePort = document.getElementById(`port-${edge.source}-out`);
        const targetPort = document.getElementById(`port-${edge.target}-in`);
        if (sourcePort && targetPort) {
          const r1 = sourcePort.getBoundingClientRect();
          const r2 = targetPort.getBoundingClientRect();
          
          const x1 = r1.left - containerRect.left + r1.width / 2;
          const y1 = r1.top - containerRect.top + r1.height / 2;
          const x2 = r2.left - containerRect.left + r2.width / 2;
          const y2 = r2.top - containerRect.top + r2.height / 2;
          
          const zoom = (graph && graph.getZoom) ? graph.getZoom() : 1;
          const xDist = Math.abs(x2 - x1);
          const offset = Math.max(xDist * 0.5, 80 * zoom);
          const strokeWidth = Math.max(1, 3 * zoom);
          const isSelected = (window.__wfSelectedEdgeId === edge.id);
          const color = isSelected ? '#1783FF' : 'var(--node-edge-color, #a0a0a0)';
          
          // Thin visible path
          pathHTML += `<path d="M ${x1} ${y1} C ${x1 + offset} ${y1}, ${x2 - offset} ${y2}, ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${strokeWidth + (isSelected ? 1 : 0)}" stroke-linecap="round" style="pointer-events:none; ${isSelected ? 'filter: drop-shadow(0 0 5px rgba(23,131,255,0.8));' : ''}" />`;
        }
      });
      
      if (window.__wfDragState === 'port' && window.__wfActivePort && window.__wfMouseX !== undefined) {
        const r1 = window.__wfActivePort.getBoundingClientRect();
        const x1 = r1.left - containerRect.left + r1.width / 2;
        const y1 = r1.top - containerRect.top + r1.height / 2;
        const x2 = window.__wfMouseX - containerRect.left;
        const y2 = window.__wfMouseY - containerRect.top;
        const zoom = (graph && graph.getZoom) ? graph.getZoom() : 1;
        const xDist = Math.abs(x2 - x1);
        const offset = Math.max(xDist * 0.5, 80 * zoom);
        const strokeWidth = Math.max(1, 3 * zoom);
        pathHTML += `<path d="M ${x1} ${y1} C ${x1 + offset} ${y1}, ${x2 - offset} ${y2}, ${x2} ${y2}" fill="none" stroke="#a0a0a0" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-dasharray="5,5" />`;
      }
      
      if (svgOverlay.innerHTML !== pathHTML) {
        svgOverlay.innerHTML = pathHTML;
      }
      requestAnimationFrame(updateCustomEdges);
    }
    requestAnimationFrame(updateCustomEdges);
    
    // Mouse tracking for drag line
    window.addEventListener('pointermove', (e) => {
        window.__wfMouseX = e.clientX;
        window.__wfMouseY = e.clientY;
    });
    
    // Add SVG dblclick listener using Bezier Math for ultimate deletion reliability
    function getDistanceToBezier(px, py, x1, y1, cx1, cy1, cx2, cy2, x2, y2) {
      let minDistance = Infinity;
      for (let t = 0; t <= 1; t += 0.05) {
        const u = 1 - t; const tt = t * t; const uu = u * u; const uuu = uu * u; const ttt = tt * t;
        const pX = uuu * x1 + 3 * uu * t * cx1 + 3 * u * tt * cx2 + ttt * x2;
        const pY = uuu * y1 + 3 * uu * t * cy1 + 3 * u * tt * cy2 + ttt * y2;
        const dist = Math.sqrt((pX - px) ** 2 + (pY - py) ** 2);
        if (dist < minDistance) minDistance = dist;
      }
      return minDistance;
    }

    window.__wfSelectedEdgeId = null;
    let wfLastMouseClickTime = 0;

    window.addEventListener('mousedown', (e) => {
      const panel = document.getElementById('panel-workflow');
      if (!panel || !panel.classList.contains('active')) return;
      if (!container.contains(e.target) && e.target !== container) return;

      if (!graph) return;
      const containerRect = container.getBoundingClientRect();
      const px = e.clientX - containerRect.left;
      const py = e.clientY - containerRect.top;
      const edges = graph.getEdgeData ? graph.getEdgeData() : [];
      let closestEdgeId = null;
      let minDistance = Infinity;

      edges.forEach(edge => {
        const sourcePort = document.getElementById(`port-${edge.source}-out`);
        const targetPort = document.getElementById(`port-${edge.target}-in`);
        if (sourcePort && targetPort) {
          const r1 = sourcePort.getBoundingClientRect();
          const r2 = targetPort.getBoundingClientRect();
          const x1 = r1.left - containerRect.left + r1.width / 2;
          const y1 = r1.top - containerRect.top + r1.height / 2;
          const x2 = r2.left - containerRect.left + r2.width / 2;
          const y2 = r2.top - containerRect.top + r2.height / 2;
          const zoom = (graph && graph.getZoom) ? graph.getZoom() : 1;
          const offset = Math.max(Math.abs(x2 - x1) * 0.5, 80 * zoom);
          
          const dist = getDistanceToBezier(px, py, x1, y1, x1 + offset, y1, x2 - offset, y2, x2, y2);
          if (dist < minDistance) {
            minDistance = dist;
            closestEdgeId = edge.id;
          }
        }
      });

      const now = Date.now();
      const isDblClick = (now - wfLastMouseClickTime < 350);
      wfLastMouseClickTime = now;

      if (minDistance <= 25 && closestEdgeId) {
        if (isDblClick) {
          // Double click delete
          if (graph.removeEdgeData) {
            graph.removeEdgeData([closestEdgeId]);
            window.__wfSelectedEdgeId = null;
            graph.render();
            if (window.scheduleHistory) window.scheduleHistory();
          }
        } else {
          // Single click select
          window.__wfSelectedEdgeId = closestEdgeId;
          document.querySelectorAll('.wf-node-selected').forEach(n => n.classList.remove('wf-node-selected'));
          window.__wfSelectedNodeId = null;
        }
        e.preventDefault();
        e.stopPropagation();
      } else {
        // Clicked empty space
        if (e.target.tagName === 'CANVAS' || e.target.tagName === 'svg') {
          window.__wfSelectedEdgeId = null;
        }
      }
    }, true);
    
    // Clear custom node focus when clicking canvas
    container.addEventListener('click', (e) => {
      if (e.target.tagName === 'CANVAS' || e.target.tagName === 'svg') {
        document.querySelectorAll('.wf-node-selected').forEach(n => n.classList.remove('wf-node-selected'));
        window.__wfSelectedNodeId = null;
        window.__wfSelectedEdgeId = null;
      }
    });
    
    // History system
    window.wfHistory = [];
    window.isUndoing = false;
    // Dump graph data with precise positions
    window.getGraphDataDump = function() {
      if (!graph || graph.destroyed) return { nodes: [], edges: [] };
      syncDOMToGraph();
      const nodes = (graph.getNodeData ? graph.getNodeData() : []).map(n => {
         const cloned = JSON.parse(JSON.stringify(n));
         if (graph.getElementPosition) {
           const pos = graph.getElementPosition(n.id);
           if (pos) {
             if (!cloned.style) cloned.style = {};
             cloned.style.x = pos[0];
             cloned.style.y = pos[1];
           }
         }
         return cloned;
      });
      const edges = graph.getEdgeData ? graph.getEdgeData() : [];
      return { nodes, edges };
    };

    window.pushHistory = function() {
      if (window.isUndoing || !graph || graph.destroyed) return;
      try {
        const data = window.getGraphDataDump();
        window.wfHistory.push(JSON.parse(JSON.stringify(data)));
        if (window.wfHistory.length > 50) window.wfHistory.shift();
      } catch (e) {}
    };

    window.scheduleHistory = function() {
      clearTimeout(window.__wfHistoryTimer);
      window.__wfHistoryTimer = setTimeout(() => {
        if (window.pushHistory) window.pushHistory();
      }, 100);
    };
    
    // Initial history push
    window.scheduleHistory();

    graph.on('node:dragend', (e) => {
      if (window.scheduleHistory) window.scheduleHistory();
    });

    // Handle dynamic canvas resizing
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (graph && !graph.destroyed) {
          graph.setSize(width, height);
        }
      }
    });
    resizeObserver.observe(container);

    window.addEventListener('pointermove', (e) => {
      if (window.__wfDragState === 'resize' && window.__wfResizeNodeId && window.__wfResizeStart) {
        const dx = e.clientX - window.__wfResizeStart.x;
        const dy = e.clientY - window.__wfResizeStart.y;
        
        const nodeType = graph.getNodeData(window.__wfResizeNodeId)?.data?.type || 'prompt';
        const minW = 200;
        const minH = nodeType === 'img2img' ? 250 : 150;

        let newW = Math.max(minW, window.__wfResizeStart.w + dx);
        let newH = Math.max(minH, window.__wfResizeStart.h + dy);
        
        const el = document.getElementById('wf-node-dom-' + window.__wfResizeNodeId);
        if (el) {
          el.style.width = newW + 'px';
          el.style.height = newH + 'px';
        }
        
        if (graph && !graph.destroyed) {
          graph.updateNodeData([{ id: window.__wfResizeNodeId, style: { size: [newW, newH] } }]);
          // Manual DOM resizing ensures it reflects immediately, G6 catches up visually
          if (window.requestAnimationFrame) {
             window.requestAnimationFrame(() => graph.draw());
          } else {
             graph.draw();
          }
        }
      }
    });

    window.addEventListener('pointerup', () => {
      setTimeout(() => { 
        window.__wfDragState = null; 
        window.__wfResizeNodeId = null; 
      }, 100);
    });
    window.addEventListener('mouseup', () => {
      setTimeout(() => { window.__wfDragState = null; }, 100);
    });
    window.addEventListener('dragend', () => {
      setTimeout(() => { window.__wfDragState = null; }, 100);
    });

    // Keyboard Shortcuts (Delete, Copy, Cut, Paste)
    window.addEventListener('keydown', (e) => {
      if (!document.getElementById('panel-workflow').classList.contains('active')) return;

      const activeTag = document.activeElement.tagName;
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag) && !document.activeElement.classList.contains('wf-node-header');
      
      // Delete node / edge
      if (e.key === 'Delete' && !isInput) {
        const selectedNodes = graph.getElementDataByState ? graph.getElementDataByState('node', 'selected') : [];
        let nodeIds = selectedNodes.map(n => n.id);
        
        if (window.__wfSelectedNodeId && !nodeIds.includes(window.__wfSelectedNodeId)) {
          nodeIds.push(window.__wfSelectedNodeId);
        }

        if (nodeIds.length > 0) {
          if (graph.removeNodeData) graph.removeNodeData(nodeIds);
          nodeIds.forEach(id => delete nodeDOMCache[id]);
          graph.render();
          if (window.scheduleHistory) window.scheduleHistory();
          window.__wfSelectedNodeId = null;
        }

        const selectedEdges = graph.getElementDataByState ? graph.getElementDataByState('edge', 'selected') : [];
        let edgeIds = selectedEdges.map(ed => ed.id);
        
        if (window.__wfSelectedEdgeId && !edgeIds.includes(window.__wfSelectedEdgeId)) {
          edgeIds.push(window.__wfSelectedEdgeId);
        }

        if (edgeIds.length > 0) {
          if (graph.removeEdgeData) graph.removeEdgeData(edgeIds);
          window.__wfSelectedEdgeId = null;
          graph.render();
          if (window.scheduleHistory) window.scheduleHistory();
        }
        return;
      }

      // Undo (Ctrl+Z / Cmd+Z)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !isInput) {
        if (window.wfHistory.length > 1) {
          window.wfHistory.pop(); // Remove current state
          const prevState = window.wfHistory[window.wfHistory.length - 1];
          window.isUndoing = true;
          // Clear node DOM cache to force re-render
          Object.keys(nodeDOMCache).forEach(k => delete nodeDOMCache[k]);
          graph.setData(JSON.parse(JSON.stringify(prevState)));
          graph.render();
          window.isUndoing = false;
          if (window.showToast) window.showToast(`✅ 已復原上一動`);
        } else {
          if (window.showToast) window.showToast(`⚠️ 沒有更多歷史紀錄`);
        }
        return;
      }

      // Copy (Ctrl+C / Cmd+C)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && !isInput) {
        syncDOMToGraph();
        const selectedNodes = graph.getElementDataByState('node', 'selected');
        if (selectedNodes.length > 0) {
           wfClipboard = selectedNodes.map(n => JSON.parse(JSON.stringify(n)));
           if (window.showToast) window.showToast(`✅ 已複製 ${selectedNodes.length} 個節點`);
        }
        return;
      }

      // Cut (Ctrl+X / Cmd+X)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x' && !isInput) {
        syncDOMToGraph();
        const selectedNodes = graph.getElementDataByState('node', 'selected');
        if (selectedNodes.length > 0) {
           wfClipboard = selectedNodes.map(n => JSON.parse(JSON.stringify(n)));
           const nodeIds = selectedNodes.map(n => n.id);
           if (graph.removeNodeData) graph.removeNodeData(nodeIds);
           nodeIds.forEach(id => delete nodeDOMCache[id]); // cleanup cache
           
           graph.render();
           if (window.scheduleHistory) window.scheduleHistory();
           if (window.showToast) window.showToast(`✅ 已剪下 ${selectedNodes.length} 個節點`);
        }
        return;
      }

      // Paste (Ctrl+V / Cmd+V)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && !isInput) {
        if (wfClipboard && wfClipboard.length > 0) {
           const newNodes = [];
           wfClipboard.forEach(node => {
               nodeIdCounter++;
               const newId = 'node_copy_' + Date.now() + '_' + nodeIdCounter;
               const newNode = JSON.parse(JSON.stringify(node));
               newNode.id = newId;
               newNode.style.x += 30; // offset
               newNode.style.y += 30; // offset
               newNodes.push(newNode);
           });
           graph.addNodeData(newNodes);
           graph.draw();
           if (window.scheduleHistory) window.scheduleHistory();
           wfClipboard = newNodes; // Update clipboard for multiple pastes
           if (window.showToast) window.showToast(`✅ 已貼上 ${newNodes.length} 個節點`);
        }
        return;
      }
    });

    let wfClipboard = null;

    // Toolbar logic
    if (toolbar) {
      toolbar.querySelectorAll('button[data-add]').forEach(btn => {
        btn.addEventListener('click', () => {
          const type = btn.dataset.add;
          nodeIdCounter++;
          const id = 'node_new_' + Date.now() + '_' + nodeIdCounter;
          
          const [cx, cy] = getViewportCenter();
          const x = cx + (Math.random() - 0.5) * 60;
          const y = cy + (Math.random() - 0.5) * 60;
          
          graph.addNodeData([{
            id,
            data: { type },
            style: { x, y }
          }]);
          graph.draw();
        });
      });

      // Save Workflow → opens library save modal
      document.getElementById('wfSaveBtn')?.addEventListener('click', () => {
        if (window.WorkflowLibrary) window.WorkflowLibrary.openSaveModal();
      });

      // Silent backup on page unload
      window.addEventListener('beforeunload', () => {
        if (window.getGraphDataDump) {
          localStorage.setItem('ps_workflow', JSON.stringify(window.getGraphDataDump()));
        }
      });

      // Export JSON
      const exportBtn = document.getElementById('wfExportBtn');
      if (exportBtn) {
        exportBtn.addEventListener('click', () => {
          if (!graph) return;
          const data = window.getGraphDataDump();
          const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
          const anchor = document.createElement('a');
          anchor.href = dataStr;
          anchor.download = "workflow_config.json";
          anchor.click();
          if (window.showToast) window.showToast('✅ 工作流配置已導出');
        });
      }

      // Import JSON
      const importInput = document.getElementById('wfImportInput');
      if (importInput) {
        importInput.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (event) => {
            try {
              const data = JSON.parse(event.target.result);
              if (graph) {
                Object.keys(nodeDOMCache).forEach(k => delete nodeDOMCache[k]);
                graph.setData(JSON.parse(JSON.stringify(data)));
                graph.render();
                setTimeout(() => { graph.fitView(); }, 150);
                if (window.showToast) window.showToast('✅ 工作流配置已導入');
              }
            } catch (err) {
              console.error(err);
              if (window.showToast) window.showToast('❌ 導入失敗：JSON 格式錯誤');
            }
          };
          reader.readAsText(file);
          importInput.value = ''; // reset
        });
      }

      // Expose load function for Workflow Library
      window.wfLoadData = function(data) {
        if (!graph || graph.destroyed) return;
        Object.keys(nodeDOMCache).forEach(k => delete nodeDOMCache[k]);
        graph.setData(JSON.parse(JSON.stringify(data)));
        graph.render();
      };

      // Prompt Toggle
      const promptToggleBtn = document.getElementById('wfPromptToggleBtn');
      const promptQuickBar = document.getElementById('wfPromptQuickBar');
      if (promptToggleBtn && promptQuickBar) {
        promptToggleBtn.addEventListener('click', () => {
          promptQuickBar.classList.toggle('active');
        });
      }
    }

    // Delete edge on single click
    graph.on('edge:click', (e) => {
      const edgeId = e.target.id || (e.itemId) || (e.item && e.item.id) || e.id;
      // In G6 v5, edge ID can be on e.itemId or e.target.id
      if (edgeId) {
        graph.removeEdgeData([edgeId]);
        graph.draw();
      }
    });

    // Drag and Drop from Asset Panel / Prompt Library
    container.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/ide-asset') || e.dataTransfer.types.includes('text/prompt-id')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    container.addEventListener('drop', (e) => {
      const assetData = e.dataTransfer.getData('text/ide-asset');
      if (assetData) {
        e.preventDefault();
        try {
          const asset = JSON.parse(assetData);
          // Convert client coords to canvas coords
          let x, y;
          try {
            [x, y] = graph.getCanvasByClient([e.clientX, e.clientY]);
          } catch (_) {
            [x, y] = getViewportCenter();
          }
          
          nodeIdCounter++;
          const id = 'node_drop_' + Date.now() + '_' + nodeIdCounter;
          
          graph.addNodeData([{
            id,
            data: { type: 'img2img', initialImage: asset.data },
            style: { x, y }
          }]);
          graph.draw();
          if (window.showToast) window.showToast('✅ 已從資產庫匯入圖片為圖生圖節點');
        } catch (err) {
          console.error('Drop error', err);
        }
        return;
      }

      const promptId = e.dataTransfer.getData('text/prompt-id');
      const promptText = e.dataTransfer.getData('text/plain');
      if (promptId && promptText) {
        e.preventDefault();
        let x, y;
        try {
          [x, y] = graph.getCanvasByClient([e.clientX, e.clientY]);
        } catch (_) {
          [x, y] = getViewportCenter();
        }
        
        nodeIdCounter++;
        const id = 'node_prompt_drop_' + Date.now() + '_' + nodeIdCounter;
        
        graph.addNodeData([{
          id,
          data: { type: 'prompt', prefill: promptText },
          style: { x, y }
        }]);
        graph.draw();
        if (window.showToast) window.showToast('✅ 已從提示庫匯入提示詞為節點');
      }
    });

    // Paste Image Logic (Global)
    window.addEventListener('paste', (e) => {
      if (!document.getElementById('panel-workflow').classList.contains('active')) return;
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

      const items = (e.clipboardData || e.originalEvent.clipboardData).items;
      for (let index in items) {
        const item = items[index];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          const reader = new FileReader();
          reader.onload = (event) => {
            const base64 = event.target.result;
            
            nodeIdCounter++;
            const id = 'node_paste_' + Date.now() + '_' + nodeIdCounter;
            const [cx, cy] = getViewportCenter();
            const x = cx + (Math.random() - 0.5) * 60;
            const y = cy + (Math.random() - 0.5) * 60;
            
            graph.addNodeData([{
              id,
              data: { type: 'img2img', initialImage: base64 },
              style: { x, y }
            }]);
            graph.draw();
            if (window.showToast) window.showToast('✅ 已從剪貼簿匯入圖片為圖生圖節點');
          };
          reader.readAsDataURL(blob);
          e.preventDefault();
          break;
        }
      }
    });

    // Execution Pipeline (DAG Topological Sort)
    if (runBtn) {
      runBtn.addEventListener('click', async () => {
        const nodeData = graph.getNodeData();
        const edgeData = graph.getEdgeData();
        
        const generators = nodeData.filter(n => n.data.type === 'img2img');
        if (generators.length === 0) {
          if (window.showToast) window.showToast('⚠️ 找不到 Img2Img 生成節點');
          return;
        }

        runBtn.disabled = true;
        runBtn.textContent = '執行中...';

        // 1. Build Adjacency and In-Degree maps
        const inDegree = {};
        const adj = {};
        nodeData.forEach(n => {
          inDegree[n.id] = 0;
          adj[n.id] = [];
        });
        
        edgeData.forEach(e => {
          if (inDegree[e.target] !== undefined) {
            inDegree[e.target]++;
            adj[e.source].push(e.target);
          }
        });

        // 2. Topological Sort using BFS
        const q = [];
        for (const id in inDegree) {
          if (inDegree[id] === 0) q.push(id);
        }

        const sortedNodes = [];
        while(q.length > 0) {
          const u = q.shift();
          sortedNodes.push(u);
          adj[u].forEach(v => {
            inDegree[v]--;
            if (inDegree[v] === 0) q.push(v);
          });
        }

        if (sortedNodes.length !== nodeData.length) {
          if (window.showToast) window.showToast('⚠️ 偵測到循環依賴 (Cycle)，請檢查連線');
          runBtn.disabled = false;
          runBtn.textContent = '執行工作流 (Run)';
          return;
        }

        // 3. Initialize states
        const nodeStates = {};
        nodeData.forEach(n => {
          nodeStates[n.id] = {};
        });

        // 4. Execute Nodes in topological order
        for (const id of sortedNodes) {
          const n = nodeData.find(x => x.id === id);
          const el = nodeDOMCache[id];
          if (!el) continue;
          
          // Merge incoming states
          const incomingEdges = edgeData.filter(e => e.target === id);
          const incomingStates = incomingEdges.map(e => nodeStates[e.source]);
          
          let state = nodeStates[id];
          if (incomingStates.length > 0) {
            incomingStates.forEach(inc => {
              if (inc.model !== undefined) state.model = inc.model;
              if (inc.resolution !== undefined) state.resolution = inc.resolution;
              if (inc.prompt !== undefined && inc.prompt !== '') {
                state.prompt = (state.prompt ? state.prompt + ' ' : '') + inc.prompt;
              }
              if (inc.mask !== undefined) state.mask = inc.mask;
              if (inc.resultImage !== undefined) state.resultImage = inc.resultImage;
              if (inc.i2i_base !== undefined) state.i2i_base = inc.i2i_base;
              if (inc.cfg !== undefined) state.cfg = inc.cfg;
              if (inc.upscale !== undefined) state.upscale = inc.upscale;
              if (inc.aspectRatio !== undefined) state.aspectRatio = inc.aspectRatio;
              if (inc.imageSize !== undefined) state.imageSize = inc.imageSize;
              if (inc.temperature !== undefined) state.temperature = inc.temperature;
              if (inc.thinkingLevel !== undefined) state.thinkingLevel = inc.thinkingLevel;
              if (inc.googleSearch !== undefined) state.googleSearch = inc.googleSearch;
              if (inc.stopSequences !== undefined) state.stopSequences = inc.stopSequences;
              if (inc.outputLength !== undefined) state.outputLength = inc.outputLength;
              if (inc.topP !== undefined) state.topP = inc.topP;
            });
          }
          
          // Highlight current executing node
          const nodeWrapper = el.closest ? el.closest('[data-node-id]') || el.parentElement : el.parentElement;
          if (nodeWrapper) nodeWrapper.style.outline = '3px solid #4ade80';
          if (nodeWrapper) nodeWrapper.style.outlineOffset = '2px';
          
          const type = n.data.type;
          
          if (type === 'model') {
            state.model = el.querySelector('.wf-model-sel').value;
            const _runPe = el.querySelector('.wf-model-params');
            if (_runPe) {
              const _runASel = el.querySelector('.wf-aspect-sel').value;
              const _runACustom = el.querySelector('.wf-custom-aspect').value.trim();
              state.aspectRatio = _runASel === 'custom' ? (_runACustom || '1:1') : _runASel;
              state.imageSize = el.querySelector('.wf-image-size-sel').value;
              state.temperature = parseFloat(el.querySelector('.wf-temp-slider').value);
              state.thinkingLevel = el.querySelector('.wf-thinking-sel').value;
              state.googleSearch = el.querySelector('.wf-google-search').checked;
              state.stopSequences = el.querySelector('.wf-stop-seq').value
                .split(',').map(s => s.trim()).filter(Boolean);
              state.outputLength = parseInt(el.querySelector('.wf-output-length').value) || 65536;
              state.topP = parseFloat(el.querySelector('.wf-topp-slider').value);
            }
          } else if (type === 'parameters') {
            state.resolution = el.querySelector('.wf-res-sel').value;
            // CFG and upscale are hardcoded
            state.cfg = 7;
            state.upscale = 1;
          } else if (type === 'prompt') {
            const ta = el.querySelector('.wf-prompt-input');
            const rawPrompt = (window.EditorService ? window.EditorService.getContent(ta.id) : ta.value);
            // Resolve `@` file references in prompt: extract image base64, replace tag with asset name
            state.prompt = await resolvePromptAndExtractImage(rawPrompt, state);
          } else if (type === 'mask') {
            state.mask = el.dataset.maskData || null;
          } else if (type === 'img2img') {
            // Check upstream resultImage and copy to i2i_base if present
            if (state.resultImage && !state.i2i_base) {
              state.i2i_base = state.resultImage;
            }

            // Generator Node (Terminal or Intermediate)
            const uiBase = el.querySelector('.wf-i2i-base').value;
            if (uiBase.trim()) {
              if (uiBase.includes('[@') && uiBase.includes(']')) {
                state.i2i_base = await resolveAssetTag(uiBase);
              } else {
                state.i2i_base = uiBase;
              }
            }
            if (n.data.initialImage && !state.i2i_base) {
              state.i2i_base = n.data.initialImage;
            }
            state.i2i_denoise = 0.7; // hardcoded default, UI removed

            const finalPrompt = state.prompt || '';
            if (!finalPrompt.trim()) {
              if (window.showToast) window.showToast(`⚠️ 節點 [${id}] 提示詞不能為空`);
              continue;
            }

            const finalModel = state.model || 'nanobanana2';
            const finalRes = state.resolution || '1024x1024';

            const genOptions = {
              aspectRatio: state.aspectRatio || '1:1',
              imageSize: state.imageSize || '',
              temperature: state.temperature ?? 0.4,
              topP: state.topP ?? 0.95,
              maxOutputTokens: state.outputLength || 65536,
              stopSequences: state.stopSequences || [],
              thinkingLevel: state.thinkingLevel || 'none',
              googleSearch: state.googleSearch || false,
            };

            const placeholder = el.querySelector('.wf-preview-placeholder');
            const imgEl = el.querySelector('.wf-preview-img');

            placeholder.style.display = 'flex';
            placeholder.textContent = 'Generating...';
            imgEl.style.display = 'none';

            try {
              let apiKey = '';
              if (finalModel === 'gptimage') apiKey = window.StudioSettings.getGptimageKey();
              else apiKey = window.StudioSettings.getNanobananaKey();

              if (!apiKey) {
                 if (window.showToast) window.showToast('⚠️ API Key 尚未設定 (' + finalModel + ')');
                 throw new Error('API Key missing');
              }

              if (window.showToast) window.showToast(`🚀 節點 [${id}] 開始生成...`);

              let imageUrl = '';
              if (finalModel === 'gptimage') {
                const [finalW, finalH] = finalRes.split('x').map(Number);
                imageUrl = await window.AIService.generateWithGPTImage(finalPrompt, apiKey, finalW, finalH, state.i2i_base);
              } else if (finalModel === 'nanobanana2') {
                imageUrl = await window.AIService.generateWithNanoBanana2(finalPrompt, apiKey, state.i2i_base || null, state.mask || null, genOptions);
              } else {
                imageUrl = await window.AIService.generateWithNanoBanana(finalPrompt, apiKey, genOptions);
              }
              
              imgEl.src = imageUrl;
              imgEl.style.display = 'block';
              placeholder.style.display = 'none';
              // Show download button
              const dlBtn = el.querySelector('.wf-preview-download');
              if (dlBtn) dlBtn.style.display = 'block';
              
              state.resultImage = imageUrl; // Ready for downstream nodes
              state.prompt = '';             // Cut prompt leakage — only resultImage flows downstream
              
              // Save to Assets if successful
              if (imageUrl.startsWith('http') || imageUrl.startsWith('data:')) {
                const ts = Date.now();
                if (window.AssetsService) {
                  let targetFolder = state.saveFolder;
                  if (!targetFolder) targetFolder = window.AssetsService.getActiveFolder ? window.AssetsService.getActiveFolder() : '已完成';
                  if (window.AssetsService.getFolders && !window.AssetsService.getFolders().includes(targetFolder)) {
                    window.AssetsService.addFolder(targetFolder);
                  }
                  window.AssetsService.saveAsset('Workflow_Out_' + ts, imageUrl, targetFolder).then(() => {
                    if (window.refreshAssetsGrid) window.refreshAssetsGrid();
                  });
                  
                  if (window.localDirHandle && window.AssetsService.saveAssetToLocalDir) {
                    window.AssetsService.saveAssetToLocalDir(imageUrl, 'Workflow_Out_' + ts + '.png');
                  }
                }
              }
            } catch (err) {
              console.error(err);
              placeholder.style.fontSize = '11px';
              placeholder.textContent = err.message || 'Unknown error';
            }
          }
        }

        // Clear all execution highlights
        document.querySelectorAll('.wf-node').forEach(n => {
          const w = n.closest ? n.closest('[data-node-id]') || n.parentElement : n.parentElement;
          if (w) { w.style.outline = ''; w.style.outlineOffset = ''; }
        });
        runBtn.disabled = false;
        runBtn.textContent = '執行工作流 (Run)';
      });
    }

    // Expose global hook for Decode panel
    window.workflowReceivePrompt = function(promptText) {
      const nodes = graph.getNodeData();
      const promptNodes = nodes.filter(n => n.data.type === 'prompt');
      
      let targetId;
      if (promptNodes.length > 0) {
        targetId = promptNodes[0].id;
      } else {
        targetId = 'node_p_' + Date.now();
        graph.addNodeData([{ id: targetId, data: { type: 'prompt' }, style: { x: 300, y: 200 } }]);
        graph.draw();
      }
      
      setTimeout(() => {
        const el = nodeDOMCache[targetId];
        if (el) {
          const ta = el.querySelector('.wf-prompt-input');
          if (window.EditorService) window.EditorService.setContent(ta.id, promptText);
          else ta.value = promptText;
        }
      }, 100);
    };

    // ── Prompt Vault Quick-Bar Logic ──
    function initPromptQuickBar() {
      const quickBar = document.getElementById('wfPromptQuickBar');
      if (!quickBar || !window.PromptsService) return;

      quickBar.innerHTML = '';
      
      // Create global popover
      let popover = document.getElementById('wfQuickbarPopover');
      if (!popover) {
        popover = document.createElement('div');
        popover.id = 'wfQuickbarPopover';
        popover.className = 'quickbar-popover';
        
        // Header
        const header = document.createElement('div');
        header.className = 'quickbar-popover-header';
        
        const title = document.createElement('span');
        title.id = 'wfQuickbarPopoverTitle';
        header.appendChild(title);
        
        const closeBtn = document.createElement('button');
        closeBtn.className = 'quickbar-popover-close';
        closeBtn.innerHTML = '&#x2715;';
        closeBtn.addEventListener('click', () => hidePopover(true));
        header.appendChild(closeBtn);
        
        popover.appendChild(header);
        
        // Body
        const body = document.createElement('div');
        body.id = 'wfQuickbarPopoverBody';
        body.className = 'quickbar-popover-body';
        popover.appendChild(body);
        
        // Insert inside quickBar so it positions relative to the floating buttons
        quickBar.appendChild(popover);
        
        // Hover handling for popover itself - no longer needed for hide timer
      }

      let activeCategory = null;
      let isPinned = false;
      let pinTimer = null;
      
      const categories = window.PromptsService.getAllCategories();
      
      categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'quickbar-cat-btn';
        // Display full category name in floating capsule layout
        btn.innerHTML = `<span class="quickbar-cat-text">${cat}</span><div class="quickbar-timer-bar"></div>`;
        
        btn.addEventListener('mouseenter', () => {
          if (isPinned && activeCategory === cat) return;
          showPopover(cat, btn);
          startPinTimer(cat, btn);
        });
        
        btn.addEventListener('mouseleave', () => {
          cancelPinTimer();
          if (!isPinned) {
            hidePopover();
          }
        });
        
        btn.addEventListener('click', () => {
          if (isPinned && activeCategory === cat) {
            // Unpin
            hidePopover(true);
          } else {
            // Pin immediately
            cancelPinTimer();
            isPinned = true;
            showPopover(cat, btn);
          }
        });
        
        quickBar.appendChild(btn);
      });
      
      // Click outside to unpin
      document.addEventListener('click', (e) => {
        if (isPinned && !quickBar.contains(e.target) && !popover.contains(e.target)) {
          hidePopover(true);
        }
      });
      
      function showPopover(category, btnEl) {
        activeCategory = category;
        const titleEl = document.getElementById('wfQuickbarPopoverTitle');
        const bodyEl = document.getElementById('wfQuickbarPopoverBody');
        
        // Highlight active btn and stop animation
        document.querySelectorAll('.quickbar-cat-btn').forEach(b => {
          b.classList.remove('active', 'pinned', 'timer-active');
        });
        if (btnEl) btnEl.classList.add('pinned');
        
        titleEl.textContent = category;
        bodyEl.innerHTML = '';
        
        const prompts = window.PromptsService.getPromptsByCategory(category);
        if (prompts.length === 0) {
          bodyEl.innerHTML = '<div style="color:var(--text-light);font-size:12px;text-align:center;margin-top:20px;">無儲存的提示詞</div>';
        } else {
          prompts.forEach(p => {
            const item = document.createElement('div');
            item.className = 'quickbar-prompt-item';
            item.draggable = true;
            
            const pTitle = document.createElement('div');
            pTitle.className = 'quickbar-prompt-title';
            pTitle.textContent = p.title || '未命名';
            
            item.appendChild(pTitle);
            
            // Click logic
            item.addEventListener('click', () => {
              if (navigator.clipboard) {
                navigator.clipboard.writeText(p.content);
                if (window.showToast) window.showToast('✅ 已複製提示詞');
              }
              hidePopover(true);
            });

            // Drag Drop logic
            item.addEventListener('dragstart', (e) => {
              e.dataTransfer.setData('text/prompt-id', String(p.id || Date.now()));
              e.dataTransfer.setData('text/plain', p.content);
              e.dataTransfer.effectAllowed = 'copy';
            });
            
            bodyEl.appendChild(item);
          });
        }
        
        popover.classList.add('visible');
      }
      
      function hidePopover(force = false) {
        if (force || !isPinned) {
          isPinned = false;
          activeCategory = null;
          popover.classList.remove('visible');
          document.querySelectorAll('.quickbar-cat-btn').forEach(b => {
            b.classList.remove('active', 'pinned', 'timer-active');
          });
        }
      }
      
      function startPinTimer(cat, btn) {
        cancelPinTimer();
        btn.classList.add('timer-active');
        pinTimer = setTimeout(() => {
          btn.classList.remove('timer-active');
          isPinned = true;
          // Ensure it's showing the correct category
          if (activeCategory !== cat) showPopover(cat, btn);
        }, 400);
      }
      
      function cancelPinTimer() {
        if (pinTimer) {
          clearTimeout(pinTimer);
          pinTimer = null;
        }
        document.querySelectorAll('.quickbar-cat-btn').forEach(b => b.classList.remove('timer-active'));
      }
    }

    // Call after slight delay to ensure PromptsService is ready
    setTimeout(initPromptQuickBar, 300);

    window.workflowGraph = graph; // Expose for debugging
  }
})();
