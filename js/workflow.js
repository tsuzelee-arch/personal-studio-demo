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
        headerText = '參數 (Parameters)';
        bodyHTML = `
          <label>Resolution</label>
          <select class="form-select form-select-sm wf-res-sel" style="margin-bottom:8px; width:100%;">
            <option value="1024x1024">1024x1024 (1:1)</option>
            <option value="1024x576">1024x576 (16:9)</option>
            <option value="576x1024">576x1024 (9:16)</option>
          </select>
          <label>CFG Scale</label>
          <input type="range" class="wf-temp-cfg" min="1" max="20" value="7" style="width:100%;">
          <div style="text-align:right;font-size:11px;" class="wf-temp-val">7</div>
          <label>Upscale</label>
          <select class="form-select form-select-sm wf-up-scale" style="width:100%;">
            <option value="1">None (1x)</option>
            <option value="2">2x</option>
            <option value="4">4x</option>
          </select>
        `;
      } else if (type === 'img2img') {
        headerText = '生成器 / 圖生圖 (Generator / Img2Img)';
        bodyHTML = `
          <label>Base Image (留空為純文字生成)</label>
          <input type="text" class="form-input wf-i2i-base" placeholder="貼上或@資產..." style="margin-bottom:10px; width:100%;">
          <label>Denoising (0.0 - 1.0)</label>
          <input type="number" class="form-input wf-i2i-denoise" min="0" max="1" step="0.1" value="0.7" style="margin-bottom:10px; width:100%;">
          <div class="wf-preview-img-container" style="width:100%; height:180px; position:relative; margin-top:10px;">
            <img class="wf-preview-img" src="" style="display:none; width:100%; height:100%; object-fit:contain; border-radius:4px; cursor:pointer;">
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

      if (type === 'parameters') {
        const range = el.querySelector('.wf-temp-cfg');
        const val = el.querySelector('.wf-temp-val');
        range.addEventListener('input', () => val.textContent = range.value);
      }

      if (type === 'img2img') {
        const input = el.querySelector('.wf-i2i-base');
        const preview = el.querySelector('.wf-i2i-preview');
        input.addEventListener('input', () => {
          if (input.value) {
            preview.innerHTML = `<img src="${input.value}" style="width:100%; height:100%; object-fit:cover;">`;
          } else {
            preview.innerHTML = `<span style="color:#aaa; font-size:12px;">No Image</span>`;
          }
        });
        
        // Handle injected image (from paste)
        if (datum.data.initialImage) {
          input.value = datum.data.initialImage;
          preview.innerHTML = `<img src="${datum.data.initialImage}" style="width:100%; height:100%; object-fit:cover;">`;
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

      nodeDOMCache[id] = el;
      return el;
    }

    // Default graph data
    const initialData = {
      nodes: [
        { id: 'node_1', data: { type: 'model' }, style: { x: 100, y: 150 } },
        { id: 'node_2', data: { type: 'prompt' }, style: { x: 380, y: 150 } },
        { id: 'node_3', data: { type: 'parameters' }, style: { x: 740, y: 150 } },
        { id: 'node_4', data: { type: 'img2img' }, style: { x: 1080, y: 150 } }
      ],
      edges: [
        { source: 'node_1', target: 'node_2' },
        { source: 'node_2', target: 'node_3' },
        { source: 'node_3', target: 'node_4' }
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
        case 'parameters': return [264, 220];
        case 'img2img': return [284, 340];
        case 'mask': return [224, 160];
        default: return [224, 100];
      }
    }

    const graph = new Graph({
      container: container,
      autoFit: 'center',
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
          
          const x = 300 + Math.random() * 50;
          const y = 200 + Math.random() * 50;
          
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
          let x = e.offsetX || 300;
          let y = e.offsetY || 200;
          
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
            const x = 300 + Math.random() * 50;
            const y = 200 + Math.random() * 50;
            
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
          nodeStates[n.id] = {
            model: 'nanobanana2',
            resolution: '1024x1024',
            prompt: '',
            cfg: 7,
            i2i_base: null,
            i2i_denoise: 0.7,
            mask: null,
            upscale: 1,
            resultImage: null
          };
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
              if (inc.model !== 'nanobanana2') state.model = inc.model;
              if (inc.resolution !== '1024x1024') state.resolution = inc.resolution;
              if (inc.prompt) state.prompt += (state.prompt ? ' ' : '') + inc.prompt;
              if (inc.cfg !== 7) state.cfg = inc.cfg;
              if (inc.upscale !== 1) state.upscale = inc.upscale;
              if (inc.mask) state.mask = inc.mask;
              // Pass image from upstream generator
              if (inc.resultImage) state.i2i_base = inc.resultImage;
            });
          }
          
          const type = n.data.type;
          
          if (type === 'model') {
            state.model = el.querySelector('.wf-model-sel').value;
          } else if (type === 'parameters') {
            state.resolution = el.querySelector('.wf-res-sel').value;
            state.cfg = parseInt(el.querySelector('.wf-temp-cfg').value);
            state.upscale = parseInt(el.querySelector('.wf-up-scale').value);
          } else if (type === 'prompt') {
            const ta = el.querySelector('.wf-prompt-input');
            state.prompt += ' ' + (window.EditorService ? window.EditorService.getContent(ta.id) : ta.value);
          } else if (type === 'mask') {
            state.mask = el.dataset.maskData || null;
          } else if (type === 'img2img') {
            // Generator Node (Terminal or Intermediate)
            const uiBase = el.querySelector('.wf-i2i-base').value;
            if (uiBase.trim()) state.i2i_base = uiBase;
            if (n.data.initialImage && !state.i2i_base) state.i2i_base = n.data.initialImage;
            state.i2i_denoise = parseFloat(el.querySelector('.wf-i2i-denoise').value);

            if (!state.prompt.trim()) {
              if (window.showToast) window.showToast(`⚠️ 節點 [${id}] 提示詞不能為空`);
              continue;
            }

            const placeholder = el.querySelector('.wf-preview-placeholder');
            const imgEl = el.querySelector('.wf-preview-img');
            
            placeholder.style.display = 'flex';
            placeholder.textContent = 'Generating...';
            imgEl.style.display = 'none';

            try {
              const [width, height] = state.resolution.split('x').map(Number);
              const finalW = width * state.upscale;
              const finalH = height * state.upscale;
              
              let apiKey = '';
              if (state.model === 'gptimage') apiKey = window.StudioSettings.getGptimageKey();
              else apiKey = window.StudioSettings.getNanobananaKey();

              if (!apiKey) {
                 if (window.showToast) window.showToast('⚠️ API Key 尚未設定 (' + state.model + ')');
                 throw new Error('API Key missing');
              }
              
              if (window.showToast) window.showToast(`🚀 節點 [${id}] 開始生成...`);
              
              let imageUrl = '';
              if (state.model === 'gptimage') {
                imageUrl = await window.AIService.generateWithGPTImage(state.prompt, apiKey, finalW, finalH);
              } else if (state.model === 'nanobanana2') {
                imageUrl = await window.AIService.generateWithNanoBanana2(state.prompt, apiKey, finalW, finalH, state.i2i_base, state.mask, state.cfg);
              } else {
                imageUrl = await window.AIService.generateWithNanoBanana(state.prompt, apiKey, finalW, finalH);
              }
              
              imgEl.src = imageUrl;
              imgEl.style.display = 'block';
              placeholder.style.display = 'none';
              
              state.resultImage = imageUrl; // Ready for downstream nodes
              
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

    window.workflowGraph = graph; // Expose for debugging
  }
})();
