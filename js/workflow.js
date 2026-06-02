(function() {
  const canvas = document.getElementById('workflowCanvas');
  const svg = document.getElementById('workflowSvg');
  const nodes = document.querySelectorAll('.wf-node');
  
  // UI Elements
  const wfPromptInput = document.getElementById('wfPromptInput');
  const wfModelSelect = document.getElementById('wfModelSelect');
  const wfResolution = document.getElementById('wfResolution');
  const wfCfg = document.getElementById('wfCfg');
  const wfCfgVal = document.getElementById('wfCfgVal');
  const wfGenerateBtn = document.getElementById('wfGenerateBtn');
  const wfPreviewImg = document.getElementById('wfPreviewImg');
  const wfPreviewPlaceholder = document.getElementById('wfPreviewPlaceholder');

  if (!canvas) return; // Prevent errors if DOM not ready

  // Node Dragging Logic
  let activeNode = null;
  let offsetX = 0;
  let offsetY = 0;

  nodes.forEach(node => {
    const header = node.querySelector('.wf-node-header');
    header.addEventListener('mousedown', (e) => {
      activeNode = node;
      const rect = node.getBoundingClientRect();
      const parentRect = canvas.getBoundingClientRect();
      offsetX = e.clientX - rect.left + parentRect.left;
      offsetY = e.clientY - rect.top + parentRect.top;
      // Bring to front
      nodes.forEach(n => n.style.zIndex = '2');
      node.style.zIndex = '3';
    });
  });

  window.addEventListener('mousemove', (e) => {
    if (!activeNode) return;
    const parentRect = canvas.getBoundingClientRect();
    let x = e.clientX - offsetX;
    let y = e.clientY - offsetY;
    
    // Boundary check
    x = Math.max(0, Math.min(x, parentRect.width - activeNode.offsetWidth));
    y = Math.max(0, Math.min(y, parentRect.height - activeNode.offsetHeight));
    
    activeNode.style.left = x + 'px';
    activeNode.style.top = y + 'px';
    drawConnections();
  });

  window.addEventListener('mouseup', () => {
    activeNode = null;
  });

  // Connection Drawing Logic
  function getPortCenter(portId) {
    const port = document.getElementById(portId);
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
    svg.innerHTML = ''; // clear
    const connections = [
      { from: 'portPromptOut', to: 'portModelIn' },
      { from: 'portModelOut', to: 'portPreviewIn' }
    ];

    let pathHTML = '';
    connections.forEach(conn => {
      const p1 = getPortCenter(conn.from);
      const p2 = getPortCenter(conn.to);
      pathHTML += `<path d="${drawBezier(p1.x, p1.y, p2.x, p2.y)}"></path>`;
    });
    svg.innerHTML = pathHTML;
  }

  // Initial draw
  setTimeout(drawConnections, 100);
  window.addEventListener('resize', drawConnections);

  // Parameter UI
  if (wfCfg) {
    wfCfg.addEventListener('input', (e) => {
      if (wfCfgVal) wfCfgVal.textContent = e.target.value;
    });
  }

  // Receive Prompt from Decode Panel
  window.workflowReceivePrompt = function(promptText) {
    if (wfPromptInput) wfPromptInput.value = promptText;
  };
  
  // Backward compatibility with step tracker (used in decode.js)
  window.workflowMarkReady = function(step) {
    // No-op for custom workflow
  };

  // Generation Logic
  if (wfGenerateBtn) {
    wfGenerateBtn.addEventListener('click', async () => {
      const prompt = wfPromptInput.value.trim();
      if (!prompt) {
        showToast('請先輸入提示詞！');
        return;
      }
      
      const model = wfModelSelect.value;
      let apiKey = '';
      if (model === 'gptimage') apiKey = window.StudioSettings.getGptimageKey();
      else apiKey = window.StudioSettings.getNanobananaKey(); // Share key for nanobanana and nanobanana2

      if (!apiKey) {
        showToast(`請先至設定頁面填寫 ${model} 的 API Key`);
        return;
      }

      wfGenerateBtn.textContent = '生成中... (Generating)';
      wfGenerateBtn.disabled = true;
      wfPreviewImg.style.display = 'none';
      wfPreviewPlaceholder.style.display = 'flex';
      wfPreviewPlaceholder.textContent = 'Generating...';

      try {
        let imageUrl = '';
        if (model === 'gptimage') {
          imageUrl = await window.AIService.generateWithGPTImage(prompt, apiKey);
        } else if (model === 'nanobanana2') {
          imageUrl = await window.AIService.generateWithNanoBanana2(prompt, apiKey);
        } else {
          imageUrl = await window.AIService.generateWithNanoBanana(prompt, apiKey);
        }

        wfPreviewPlaceholder.style.display = 'none';
        wfPreviewImg.src = imageUrl;
        wfPreviewImg.style.display = 'block';
        showToast('✅ 生成成功！');
      } catch (e) {
        console.error(e);
        wfPreviewPlaceholder.textContent = '生成失敗 (Error)';
        showToast('❌ ' + e.message, 5000);
      } finally {
        wfGenerateBtn.textContent = '生成圖片 (Generate)';
        wfGenerateBtn.disabled = false;
      }
    });
  }

})();
