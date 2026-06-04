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

    let nodeIdCounter = 0;
    const nodeDOMCache = {}; // Cache to preserve DOM state on re-render

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
      el.className = 'wf-node';
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.position = 'relative';
      el.dataset.type = type;

      let headerText = '';
      let bodyHTML = '';

      if (type === 'model') {
        headerText = '生成模型 (Model)';
        bodyHTML = `
          <label>Model</label>
          <select class="form-select form-select-sm wf-model-sel" style="width:100%;">
            <option value="nanobanana2">Nano Banana 2</option>
            <option value="nanobanana">Nano Banana Pro</option>
            <option value="gptimage">GPT Image 2.0</option>
          </select>
        `;
      } else if (type === 'prompt') {
        headerText = '提示詞 (Prompt)';
        bodyHTML = `
          <textarea id="${id}_prompt" class="wf-prompt-input" placeholder="輸入提示詞 (支援 / 與 @)..." style="width:100%; height:80px; resize:none;"></textarea>
        `;
      } else if (type === 'parameters') {
        headerText = '參數 (測試)';
        bodyHTML = `
          <label>Resolution</label>
          <select class="form-select form-select-sm wf-res-sel" style="width:100%;">
            <option value="1024x1024" selected>1024x1024 (1:1)</option>
            <option value="1024x576">1024x576 (16:9)</option>
            <option value="576x1024">576x1024 (9:16)</option>
          </select>
        `;
      } else if (type === 'img2img') {
        headerText = '生成器 / 圖生圖 (Generator / Img2Img)';
        bodyHTML = `
          <label>Base Image (留空為純文字生成)</label>
          <input type="text" class="form-input wf-i2i-base" placeholder="貼上或@資產..." style="margin-bottom:10px; width:100%;">
          <div class="wf-preview-img-container" style="width:100%; height:200px; position:relative; margin-top:10px;">
            <img class="wf-preview-img" src="" style="display:none; width:100%; height:100%; object-fit:contain; border-radius:4px; cursor:pointer;">
            <button class="wf-preview-download" style="display:none; position:absolute; top:6px; right:6px; background:rgba(0,0,0,0.55); color:#fff; border:none; border-radius:4px; padding:4px 8px; font-size:14px; cursor:pointer; z-index:5;" title="下載圖片">📥</button>
            <div class="wf-preview-placeholder" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:#eee; border-radius:4px; color:#888;">No Image</div>
          </div>
        `;
      } else if (type === 'mask') {
        headerText = '遮罩 (Mask)';
        bodyHTML = `
          <label>Mask Image (B/W)</label>
          <input type="file" class="wf-mask-file" accept="image/*" style="display:none;">
          <div class="wf-mask-preview" style="width:100%; height:100px; background:#eaeaea; border:1px dashed #ccc; display:flex; align-items:center; justify-content:center; cursor:pointer;">
            點擊上傳遮罩圖
          </div>
        `;
      }

      el.innerHTML = `
        <div class="wf-dom-port" onpointerdown="window.__wfDragState='port'" onmousedown="window.__wfDragState='port'" style="position:absolute; left:0; top:50%; width:14px; height:14px; background:#fff; border:2px solid #1783FF; border-radius:50%; transform:translate(-50%, -50%); cursor:crosshair; z-index:10; pointer-events:auto;" title="拖曳以連線"></div>
        <div class="wf-dom-port" onpointerdown="window.__wfDragState='port'" onmousedown="window.__wfDragState='port'" style="position:absolute; right:0; top:50%; width:14px; height:14px; background:#fff; border:2px solid #1783FF; border-radius:50%; transform:translate(50%, -50%); cursor:crosshair; z-index:10; pointer-events:auto;" title="拖曳以連線"></div>
        <div class="wf-node-header" onpointerdown="window.__wfDragState='header'" onmousedown="window.__wfDragState='header'" style="background:#333; color:#fff; padding:6px 10px; font-size:12px; font-weight:600; border-top-left-radius:6px; border-top-right-radius:6px; cursor:move;">
          ${headerText}
          <span class="wf-node-del" style="float:right; cursor:pointer; color:#ccc;" title="刪除節點">&times;</span>
        </div>
        <div class="wf-node-body" style="padding:10px; background:#fff; border:1px solid #ccc; border-top:none; border-bottom-left-radius:6px; border-bottom-right-radius:6px; height:calc(100% - 28px); overflow-y:auto; box-sizing:border-box;">
          ${bodyHTML}
        </div>
      `;

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
        const preview = el.querySelector('.wf-mask-preview');
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

      nodeDOMCache[id] = el;
      return el;
    }

    // Default graph data — 6-node chain
    const defaultPrompt2 = `編輯模式：尺寸不變，保持當前圖像形體和結構不變。未指定區域的所有圖像必須完全保持原樣，所有修改必須按照用戶的要求進行。不得重繪、修飾、增強、裁切、縮放、變色、銳化、模糊或改動任何像素。\n\n編輯：分析視覺主體，將圖像轉化為銳利，簡潔線稿，輪廓線介於1px~2px, 次要線0.2~0.5px。去除噪點\n\n采色：#ffffff,#000000`;
    const initialData = {
      nodes: [
        { id: 'node_1', data: { type: 'model' }, style: { x: 100, y: 200 } },
        { id: 'node_2', data: { type: 'prompt' }, style: { x: 380, y: 200 } },
        { id: 'node_3', data: { type: 'parameters' }, style: { x: 700, y: 200 } },
        { id: 'node_4', data: { type: 'img2img' }, style: { x: 1000, y: 200 } },
        { id: 'node_5', data: { type: 'prompt', prefill: defaultPrompt2 }, style: { x: 1350, y: 200 } },
        { id: 'node_6', data: { type: 'img2img' }, style: { x: 1700, y: 200 } }
      ],
      edges: [
        { source: 'node_1', target: 'node_2' },
        { source: 'node_2', target: 'node_3' },
        { source: 'node_3', target: 'node_4' },
        { source: 'node_4', target: 'node_5' },
        { source: 'node_5', target: 'node_6' }
      ]
    };

    // Provide invisible G6 ports so edges route perfectly to the bounding box edges
    function getPorts(type) {
      return [
        { key: 'in', placement: 'left' },
        { key: 'out', placement: 'right' }
      ];
    }

    function getNodeSize(type) {
      switch(type) {
        case 'model': return [224, 90];
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

    const graph = new Graph({
      container: container,
      data: initialData,
      node: {
        type: 'html',
        style: {
          innerHTML: (datum) => createNodeDOM(datum),
          size: (datum) => getNodeSize(datum.data.type),
          ports: (datum) => getPorts(datum.data.type),
          portR: 0.1,
          portStrokeOpacity: 0,
          portFillOpacity: 0
        }
      },
      edge: {
        type: 'cubic-horizontal',
        style: {
          stroke: '#999',
          lineWidth: 2,
          lineAppendWidth: 15,
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
          style: { stroke: '#1783FF', lineWidth: 2, lineDash: [4, 2], endArrow: true },
          onCreate: (edge) => {
            if (edge.source === edge.target) return undefined; // No self loops
            return edge;
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

    window.addEventListener('pointerup', () => {
      setTimeout(() => { window.__wfDragState = null; }, 100);
    });
    window.addEventListener('mouseup', () => {
      setTimeout(() => { window.__wfDragState = null; }, 100);
    });
    window.addEventListener('dragend', () => {
      setTimeout(() => { window.__wfDragState = null; }, 100);
    });

    // Handle edge deletion via Keyboard
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Do not delete edges if user is typing in an input
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
        
        const edges = graph.getEdgeData();
        let deleted = false;
        edges.forEach(edge => {
          const state = graph.getElementState(edge.id);
          if (state && state.includes('selected')) {
            graph.removeEdgeData([edge.id]);
            deleted = true;
          }
        });
        if (deleted) {
          graph.draw();
          e.preventDefault();
        }
      }
    });

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
    }

    // Deletion Logic
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeTag = document.activeElement.tagName;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag) && !document.activeElement.classList.contains('wf-node-header')) {
          return;
        }

        const selectedNodes = graph.getElementDataByState('node', 'selected');
        const selectedEdges = graph.getElementDataByState('edge', 'selected');

        if (selectedNodes.length > 0) {
          const nodeIds = selectedNodes.map(n => n.id);
          graph.removeNodeData(nodeIds);
          nodeIds.forEach(id => delete nodeDOMCache[id]); // cleanup cache
        }
        if (selectedEdges.length > 0) {
          graph.removeEdgeData(selectedEdges.map(ed => ed.id));
        }
        if (selectedNodes.length > 0 || selectedEdges.length > 0) {
          graph.draw();
        }
      }
    });

    // Delete edge on single click
    graph.on('edge:click', (e) => {
      const edgeId = e.target.id || (e.itemId) || (e.item && e.item.id) || e.id;
      // In G6 v5, edge ID can be on e.itemId or e.target.id
      if (edgeId) {
        graph.removeEdgeData([edgeId]);
        graph.draw();
      }
    });

    // Drag and Drop from Asset Panel
    container.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/ide-asset')) {
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
            });
          }
          
          // Highlight current executing node
          const nodeWrapper = el.closest ? el.closest('[data-node-id]') || el.parentElement : el.parentElement;
          if (nodeWrapper) nodeWrapper.style.outline = '3px solid #4ade80';
          if (nodeWrapper) nodeWrapper.style.outlineOffset = '2px';
          
          const type = n.data.type;
          
          if (type === 'model') {
            state.model = el.querySelector('.wf-model-sel').value;
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
            const finalCfg = state.cfg !== undefined ? state.cfg : 7;

            const placeholder = el.querySelector('.wf-preview-placeholder');
            const imgEl = el.querySelector('.wf-preview-img');
            
            placeholder.style.display = 'flex';
            placeholder.textContent = 'Generating...';
            imgEl.style.display = 'none';

            try {
              const [width, height] = finalRes.split('x').map(Number);
              const finalW = width;
              const finalH = height;
              
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
                imageUrl = await window.AIService.generateWithGPTImage(finalPrompt, apiKey, finalW, finalH);
              } else if (finalModel === 'nanobanana2') {
                imageUrl = await window.AIService.generateWithNanoBanana2(finalPrompt, apiKey, finalW, finalH, state.i2i_base, state.mask, finalCfg);
              } else {
                imageUrl = await window.AIService.generateWithNanoBanana(finalPrompt, apiKey, finalW, finalH);
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
                  if (window.AssetsService.getFolders && !window.AssetsService.getFolders().includes('已完成')) {
                    window.AssetsService.addFolder('已完成');
                  }
                  window.AssetsService.saveAsset('Workflow_Out_' + ts, imageUrl, '已完成').then(() => {
                    if (window.refreshAssetsGrid) window.refreshAssetsGrid();
                  });
                }
              }
            } catch (err) {
              console.error(err);
              placeholder.textContent = 'Error';
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
        
        // Insert near quickBar
        quickBar.parentElement.appendChild(popover);
        
        // Hover handling for popover itself
        popover.addEventListener('mouseenter', () => {
          if (!isPinned) clearHideTimer();
        });
        popover.addEventListener('mouseleave', () => {
          if (!isPinned) startHideTimer();
        });
      }

      let activeCategory = null;
      let isPinned = false;
      let hideTimer = null;
      
      const categories = window.PromptsService.getAllCategories();
      
      categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'quickbar-cat-btn';
        // Use first char as icon, or custom emoji if mapped
        const catFirstChar = cat.charAt(0);
        btn.innerHTML = `<span>${catFirstChar}</span><div class="quickbar-cat-tooltip">${cat}</div>`;
        
        btn.addEventListener('mouseenter', () => {
          if (isPinned) return;
          clearHideTimer();
          showPopover(cat, btn);
        });
        
        btn.addEventListener('mouseleave', () => {
          if (isPinned) return;
          startHideTimer();
        });
        
        btn.addEventListener('click', () => {
          if (isPinned && activeCategory === cat) {
            // Unpin
            hidePopover(true);
          } else {
            // Pin
            isPinned = true;
            showPopover(cat, btn);
          }
        });
        
        quickBar.appendChild(btn);
      });
      
      function showPopover(category, btnEl) {
        activeCategory = category;
        const titleEl = document.getElementById('wfQuickbarPopoverTitle');
        const bodyEl = document.getElementById('wfQuickbarPopoverBody');
        
        // Highlight active btn
        document.querySelectorAll('.quickbar-cat-btn').forEach(b => {
          b.classList.remove('active', 'pinned');
        });
        if (btnEl) {
          if (isPinned) btnEl.classList.add('pinned');
          else btnEl.classList.add('active');
        }
        
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
            
            const pContent = document.createElement('div');
            pContent.className = 'quickbar-prompt-content';
            pContent.textContent = p.content;
            
            item.appendChild(pTitle);
            item.appendChild(pContent);
            
            // Drag Drop logic
            item.addEventListener('dragstart', (e) => {
              e.dataTransfer.setData('text/plain', p.content);
              e.dataTransfer.effectAllowed = 'copy';
            });
            
            bodyEl.appendChild(item);
          });
        }
        
        popover.classList.add('visible');
      }
      
      function hidePopover(force = false) {
        if (force) {
          isPinned = false;
          activeCategory = null;
          popover.classList.remove('visible');
          document.querySelectorAll('.quickbar-cat-btn').forEach(b => {
            b.classList.remove('active', 'pinned');
          });
        } else if (!isPinned) {
          popover.classList.remove('visible');
          document.querySelectorAll('.quickbar-cat-btn').forEach(b => {
            b.classList.remove('active', 'pinned');
          });
          activeCategory = null;
        }
      }
      
      function startHideTimer() {
        clearHideTimer();
        hideTimer = setTimeout(() => hidePopover(), 400);
      }
      function clearHideTimer() {
        if (hideTimer) clearTimeout(hideTimer);
      }
    }

    // Call after slight delay to ensure PromptsService is ready
    setTimeout(initPromptQuickBar, 300);

    window.workflowGraph = graph; // Expose for debugging
  }
})();
