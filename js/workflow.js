(function() {
  const canvas = document.getElementById('workflowCanvas');
  const svg = document.getElementById('workflowSvg');
  const toolbar = document.getElementById('wfToolbar');
  const runBtn = document.getElementById('wfGenerateRunBtn');
  
  if (!canvas || !svg) return;

  let nodes = [];
  let connections = [];
  let nodeIdCounter = 0;
  
  let activeNode = null;
  let offsetX = 0;
  let offsetY = 0;
  
  let linkingFrom = null; // port element

  // ── Node Factory ──
  function createNode(type, x, y) {
    nodeIdCounter++;
    const id = 'wfNode_' + nodeIdCounter;
    
    const nodeEl = document.createElement('div');
    nodeEl.className = 'wf-node';
    nodeEl.id = id;
    nodeEl.style.left = x + 'px';
    nodeEl.style.top = y + 'px';
    nodeEl.dataset.type = type;

    let headerText = '';
    let bodyHTML = '';
    let portsHTML = '';

    if (type === 'model') {
      headerText = '生成模型 (Model)';
      portsHTML = `<div class="wf-port wf-port-out" data-node="${id}" data-type="out" title="Output to Prompt"></div>`;
      bodyHTML = `
        <label>Model</label>
        <select class="form-select form-select-sm wf-model-sel" style="margin-bottom: 10px;">
          <option value="nanobanana2">Nano Banana 2</option>
          <option value="nanobanana">Nano Banana Pro</option>
          <option value="gptimage">GPT Image 2.0</option>
        </select>
        <label>Resolution</label>
        <select class="form-select form-select-sm wf-res-sel">
          <option value="1024x1024">1024x1024 (1:1)</option>
          <option value="1024x576">1024x576 (16:9)</option>
          <option value="576x1024">576x1024 (9:16)</option>
        </select>
      `;
    } else if (type === 'prompt') {
      headerText = '提示詞 (Prompt)';
      portsHTML = `
        <div class="wf-port wf-port-in" data-node="${id}" data-type="in"></div>
        <div class="wf-port wf-port-out" data-node="${id}" data-type="out"></div>
      `;
      bodyHTML = `
        <textarea id="${id}_prompt" class="wf-prompt-input" placeholder="輸入提示詞 (支援 / 與 @)..."></textarea>
      `;
    } else if (type === 'img2img') {
      headerText = '圖生圖 (Img2Img)';
      portsHTML = `
        <div class="wf-port wf-port-in" data-node="${id}" data-type="in"></div>
        <div class="wf-port wf-port-out" data-node="${id}" data-type="out"></div>
      `;
      bodyHTML = `
        <label>Base Image (Base64)</label>
        <input type="text" class="form-input wf-i2i-base" placeholder="貼上或@資產..." style="margin-bottom:10px;">
        <label>Denoising (0.0 - 1.0)</label>
        <input type="number" class="form-input wf-i2i-denoise" min="0" max="1" step="0.1" value="0.7">
      `;
    } else if (type === 'upscale') {
      headerText = '放大 (Upscale)';
      portsHTML = `
        <div class="wf-port wf-port-in" data-node="${id}" data-type="in"></div>
        <div class="wf-port wf-port-out" data-node="${id}" data-type="out"></div>
      `;
      bodyHTML = `
        <label>Scale Factor</label>
        <select class="form-select form-select-sm wf-up-scale">
          <option value="2">2x</option>
          <option value="4">4x</option>
        </select>
      `;
    } else if (type === 'temperature') {
      headerText = '隨機性 (Temperature)';
      portsHTML = `
        <div class="wf-port wf-port-in" data-node="${id}" data-type="in"></div>
        <div class="wf-port wf-port-out" data-node="${id}" data-type="out"></div>
      `;
      bodyHTML = `
        <label>CFG Scale</label>
        <input type="range" class="wf-temp-cfg" min="1" max="20" value="7" style="width: 100%;">
        <div style="text-align: right; font-size: 11px;" class="wf-temp-val">7</div>
      `;
    } else if (type === 'mask') {
      headerText = '遮罩 (Mask)';
      portsHTML = `
        <div class="wf-port wf-port-in" data-node="${id}" data-type="in"></div>
        <div class="wf-port wf-port-out" data-node="${id}" data-type="out"></div>
      `;
      bodyHTML = `
        <label>Mask Image (B/W)</label>
        <input type="file" class="wf-mask-file" accept="image/*" style="display:none;">
        <div class="wf-mask-preview">點擊上傳遮罩圖</div>
      `;
    } else if (type === 'preview') {
      headerText = '預覽 (Preview)';
      portsHTML = `<div class="wf-port wf-port-in" data-node="${id}" data-type="in"></div>`;
      bodyHTML = `
        <div class="wf-preview-img-container">
          <img class="wf-preview-img" src="" style="display: none; max-width: 100%; border-radius: 4px; cursor: pointer;">
          <div class="wf-preview-placeholder" style="width: 200px; height: 200px; display: flex; align-items: center; justify-content: center; background: #eee; border-radius: 4px; color: #888;">No Image</div>
        </div>
      `;
    }

    nodeEl.innerHTML = `
      ${portsHTML}
      <div class="wf-node-header">${headerText} <span class="wf-node-del" style="float:right; cursor:pointer;">&times;</span></div>
      <div class="wf-node-body">${bodyHTML}</div>
    `;

    canvas.appendChild(nodeEl);
    nodes.push(nodeEl);

    // Setup Rich Editor if it's a prompt
    if (type === 'prompt' && window.EditorService) {
      setTimeout(() => {
        window.EditorService.setupRichPromptEditor(`${id}_prompt`);
      }, 50);
    }

    // Dragging
    const header = nodeEl.querySelector('.wf-node-header');
    header.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('wf-node-del')) return;
      activeNode = nodeEl;
      const rect = nodeEl.getBoundingClientRect();
      const parentRect = canvas.getBoundingClientRect();
      offsetX = e.clientX - rect.left + parentRect.left;
      offsetY = e.clientY - rect.top + parentRect.top;
      nodes.forEach(n => n.style.zIndex = '2');
      nodeEl.style.zIndex = '3';
    });

    // Delete
    nodeEl.querySelector('.wf-node-del').addEventListener('click', () => {
      connections = connections.filter(c => c.fromNode !== id && c.toNode !== id);
      canvas.removeChild(nodeEl);
      nodes = nodes.filter(n => n !== nodeEl);
      drawConnections();
    });

    // Ports
    nodeEl.querySelectorAll('.wf-port').forEach(port => {
      port.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (port.dataset.type === 'out') {
          linkingFrom = port;
        } else if (port.dataset.type === 'in' && linkingFrom) {
          // Connect
          connections.push({
            from: linkingFrom,
            fromNode: linkingFrom.dataset.node,
            to: port,
            toNode: port.dataset.node
          });
          linkingFrom = null;
          drawConnections();
        }
      });
    });

    // Temp range sync
    if (type === 'temperature') {
      const range = nodeEl.querySelector('.wf-temp-cfg');
      const val = nodeEl.querySelector('.wf-temp-val');
      range.addEventListener('input', () => val.textContent = range.value);
    }
    
    // Mask file upload
    if (type === 'mask') {
      const fileInput = nodeEl.querySelector('.wf-mask-file');
      const preview = nodeEl.querySelector('.wf-mask-preview');
      preview.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          nodeEl.dataset.maskData = ev.target.result;
          preview.innerHTML = `<img src="${ev.target.result}">`;
        };
        reader.readAsDataURL(file);
      });
    }

    // Lightbox for preview
    if (type === 'preview') {
      const img = nodeEl.querySelector('.wf-preview-img');
      img.addEventListener('click', () => {
        if (window.AssetsService) window.AssetsService.openLightBox(img.src, '工作流產圖', true);
      });
    }

    drawConnections();
    return nodeEl;
  }

  // ── Global Drag & Draw ──
  window.addEventListener('mousemove', (e) => {
    if (!activeNode) return;
    const parentRect = canvas.getBoundingClientRect();
    let x = e.clientX - offsetX;
    let y = e.clientY - offsetY;
    x = Math.max(0, Math.min(x, parentRect.width - activeNode.offsetWidth));
    y = Math.max(0, Math.min(y, parentRect.height - activeNode.offsetHeight));
    activeNode.style.left = x + 'px';
    activeNode.style.top = y + 'px';
    drawConnections();
  });

  window.addEventListener('mouseup', () => {
    activeNode = null;
  });

  document.addEventListener('mouseup', () => {
    linkingFrom = null; // cancel link if drop outside
  });

  function getPortCenter(port) {
    if (!port || !canvas) return {x: 0, y: 0};
    const rect = port.getBoundingClientRect();
    const parentRect = canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 - parentRect.left,
      y: rect.top + rect.height / 2 - parentRect.top
    };
  }

  function drawBezier(x1, y1, x2, y2) {
    const dx = Math.abs(x2 - x1) * 0.5;
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  function drawConnections() {
    if (!svg) return;
    svg.innerHTML = '';
    let pathHTML = '';
    connections.forEach(conn => {
      const p1 = getPortCenter(conn.from);
      const p2 = getPortCenter(conn.to);
      pathHTML += `<path d="${drawBezier(p1.x, p1.y, p2.x, p2.y)}"></path>`;
    });
    svg.innerHTML = pathHTML;
  }
  
  window.addEventListener('resize', drawConnections);

  // ── Toolbar ──
  if (toolbar) {
    toolbar.querySelectorAll('button[data-add]').forEach(btn => {
      btn.addEventListener('click', () => {
        createNode(btn.dataset.add, 100 + Math.random()*50, 100 + Math.random()*50);
      });
    });
  }

  // Initial Default Setup
  setTimeout(() => {
    if (nodes.length === 0) {
      const nModel = createNode('model', 50, 50);
      const nPrompt = createNode('prompt', 350, 50);
      const nPreview = createNode('preview', 650, 50);
      
      // Auto connect
      connections.push({
        from: nModel.querySelector('.wf-port-out'), fromNode: nModel.id,
        to: nPrompt.querySelector('.wf-port-in'), toNode: nPrompt.id
      });
      connections.push({
        from: nPrompt.querySelector('.wf-port-out'), fromNode: nPrompt.id,
        to: nPreview.querySelector('.wf-port-in'), toNode: nPreview.id
      });
      drawConnections();
    }
  }, 300);

  // ── Execution Pipeline ──
  if (runBtn) {
    runBtn.addEventListener('click', async () => {
      // Find all preview nodes
      const previews = nodes.filter(n => n.dataset.type === 'preview');
      if (previews.length === 0) {
        if(window.showToast) window.showToast('⚠️ 找不到 Preview 節點');
        return;
      }
      
      runBtn.disabled = true;
      runBtn.textContent = '執行中...';
      
      for (const pNode of previews) {
        // Trace back from preview
        let currentNodeId = pNode.id;
        const pipeline = [];
        
        while (currentNodeId) {
          const incomingConn = connections.find(c => c.toNode === currentNodeId);
          if (!incomingConn) break;
          const srcNodeId = incomingConn.fromNode;
          const srcNode = nodes.find(n => n.id === srcNodeId);
          if (srcNode) pipeline.unshift(srcNode); // prepend
          currentNodeId = srcNodeId;
        }
        
        // Parse pipeline parameters
        let params = {
          model: 'nanobanana2',
          resolution: '1024x1024',
          prompt: '',
          cfg: 7,
          i2i_base: null,
          i2i_denoise: 0.7,
          mask: null,
          upscale: 1
        };
        
        pipeline.forEach(n => {
          if (n.dataset.type === 'model') {
            params.model = n.querySelector('.wf-model-sel').value;
            params.resolution = n.querySelector('.wf-res-sel').value;
          } else if (n.dataset.type === 'prompt') {
            const ta = n.querySelector('.wf-prompt-input');
            params.prompt += ' ' + (window.EditorService ? window.EditorService.getContent(ta.id) : ta.value);
          } else if (n.dataset.type === 'temperature') {
            params.cfg = parseInt(n.querySelector('.wf-temp-cfg').value);
          } else if (n.dataset.type === 'img2img') {
            params.i2i_base = n.querySelector('.wf-i2i-base').value;
            params.i2i_denoise = parseFloat(n.querySelector('.wf-i2i-denoise').value);
          } else if (n.dataset.type === 'mask') {
            params.mask = n.dataset.maskData || null;
          } else if (n.dataset.type === 'upscale') {
            params.upscale = parseInt(n.querySelector('.wf-up-scale').value);
          }
        });
        
        if (!params.prompt.trim()) {
          if(window.showToast) window.showToast('⚠️ 提示詞不能為空');
          continue;
        }

        // Execution
        const placeholder = pNode.querySelector('.wf-preview-placeholder');
        const imgEl = pNode.querySelector('.wf-preview-img');
        placeholder.style.display = 'flex';
        placeholder.textContent = 'Generating...';
        imgEl.style.display = 'none';

        try {
          const [width, height] = params.resolution.split('x').map(Number);
          const finalW = width * params.upscale;
          const finalH = height * params.upscale;
          
          let apiKey = '';
          if (params.model === 'gptimage') apiKey = window.StudioSettings.getGptimageKey();
          else apiKey = window.StudioSettings.getNanobananaKey();

          if (!apiKey) throw new Error('API Key missing');

          // Build final prompt replacing tags
          // (Simulated logic: in reality AI service handles @tags, here we pass the raw text which has [@name:id])
          
          let imageUrl = '';
          if (params.model === 'gptimage') {
            imageUrl = await window.AIService.generateWithGPTImage(params.prompt, apiKey, finalW, finalH);
          } else if (params.model === 'nanobanana2') {
            imageUrl = await window.AIService.generateWithNanoBanana2(params.prompt, apiKey, finalW, finalH, params.i2i_base, params.mask, params.cfg);
          } else {
            imageUrl = await window.AIService.generateWithNanoBanana(params.prompt, apiKey, finalW, finalH);
          }

          placeholder.style.display = 'none';
          imgEl.src = imageUrl;
          imgEl.style.display = 'block';
          if(window.showToast) window.showToast('✅ 產圖成功！');

          // Auto-save to 已完成 folder
          if (window.AssetsService) {
            if (window.AssetsService.getFolders && !window.AssetsService.getFolders().includes('已完成')) {
              window.AssetsService.addFolder('已完成');
            }
            const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
            window.AssetsService.saveAsset('Workflow_Output_' + ts, imageUrl, '已完成').then(() => {
              if (window.refreshAssetsGrid) window.refreshAssetsGrid();
            }).catch(() => {});
          }
          
        } catch (e) {
          console.error(e);
          placeholder.textContent = 'Error';
          if(window.showToast) window.showToast('❌ ' + e.message);
        }
      }
      
      runBtn.disabled = false;
      runBtn.textContent = '執行工作流 (Run)';
    });
  }

  // Receive Prompt from Decode Panel
  window.workflowReceivePrompt = function(promptText) {
    const promptNodes = nodes.filter(n => n.dataset.type === 'prompt');
    if (promptNodes.length > 0) {
      const ta = promptNodes[0].querySelector('.wf-prompt-input');
      if (window.EditorService) {
        window.EditorService.setContent(ta.id, promptText);
      } else {
        ta.value = promptText;
      }
    } else {
      // Create one if doesn't exist
      const pNode = createNode('prompt', 350, 200);
      setTimeout(() => {
        const ta = pNode.querySelector('.wf-prompt-input');
        if (window.EditorService) window.EditorService.setContent(ta.id, promptText);
        else ta.value = promptText;
      }, 100);
    }
  };

})();
