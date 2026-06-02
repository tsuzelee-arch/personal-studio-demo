(function() {
  const pipeline = document.getElementById('workflowPipeline');
  const resetBtn = document.getElementById('resetWorkflowBtn');

  const STEPS = [
    {
      title: '① 上傳圖像',
      desc: '前往圖像解碼面板，上傳一張想要分析的圖像。',
      action: '前往圖像解碼',
      onAction: () => { switchPanel('decode'); markStep(0); }
    },
    {
      title: '② 解碼色調',
      desc: '解碼面板會自動分析色彩色盤與風格標籤。',
      action: '確認已解碼',
      onAction: () => {
        if (!window.StudioState.decodeResult) {
          showToast('請先在圖像解碼面板上傳並分析圖像');
          switchPanel('decode');
          return;
        }
        markStep(1);
        const res = window.StudioState.decodeResult;
        updateStepResult(1, `色盤：${res.palette.join(' ')}\n標籤：${res.styleTags.map(t=>t.label).join('、')}`);
      }
    },
    {
      title: '③ 組建提示詞',
      desc: '根據解碼結果自動生成提示詞，可點擊複製使用。',
      action: '生成並複製提示詞',
      onAction: () => {
        const res = window.StudioState.decodeResult;
        if (!res) { showToast('請先完成 Step 1 和 Step 2'); return; }
        navigator.clipboard.writeText(res.promptText).then(() => {
          showToast('提示詞已複製！');
          markStep(2);
          updateStepResult(2, res.promptText);
        });
      }
    },
    {
      title: '④ 圖像生成 (進階)',
      desc: '使用高階模型將提示詞直接轉換為圖像。',
      action: '選擇模型並生成',
      onAction: () => { /* Custom handled in renderPipeline */ }
    }
  ];

  let isGeneratingImage = false;

  let stepStates = [false, false, false, false];
  let stepResults = ['', '', '', ''];

  function markStep(idx) {
    stepStates[idx] = true;
    window.StudioState.workflowSteps = [...stepStates];
    renderPipeline();
  }

  function updateStepResult(idx, text) {
    stepResults[idx] = text;
  }

  function renderPipeline() {
    pipeline.innerHTML = '';
    STEPS.forEach((step, i) => {
      const isDone = stepStates[i];
      const isActive = !isDone && (i === 0 || stepStates[i-1]);

      const wrapper = document.createElement('div');
      wrapper.className = 'workflow-step';

      const connector = document.createElement('div');
      connector.className = 'step-connector';

      const badge = document.createElement('div');
      badge.className = 'step-badge' + (isDone ? ' done' : isActive ? ' active-step' : '');
      badge.textContent = isDone ? '✓' : String(i + 1);

      connector.appendChild(badge);

      if (i < STEPS.length - 1) {
        const line = document.createElement('div');
        line.className = 'step-line' + (isDone ? ' done' : '');
        connector.appendChild(line);
      }

      const body = document.createElement('div');
      body.className = 'step-body' + (isDone ? ' done' : isActive ? ' active-step' : '');

      const title = document.createElement('div');
      title.className = 'step-title';
      title.textContent = step.title;

      const desc = document.createElement('div');
      desc.className = 'step-desc';
      desc.textContent = step.desc;

      const status = document.createElement('div');
      status.className = 'step-status';
      status.textContent = '✓ 已完成';

      body.appendChild(title);
      body.appendChild(desc);

      if (!isDone) {
        if (i === 3 && isActive) {
          // Custom UI for Step 4 (Image Generation)
          const genControls = document.createElement('div');
          genControls.className = 'workflow-gen-controls';
          genControls.style.display = 'flex';
          genControls.style.gap = '10px';
          genControls.style.marginTop = '10px';
          genControls.style.alignItems = 'center';

          const modelSel = document.createElement('select');
          modelSel.className = 'form-input';
          modelSel.style.minWidth = '180px';
          modelSel.innerHTML = `
            <option value="nanobanana">Nano Banana Pro</option>
            <option value="gptimage">GPT Image 2.0</option>
          `;

          const genBtn = document.createElement('button');
          genBtn.className = 'step-action btn-primary';
          genBtn.textContent = isGeneratingImage ? '生成中...' : '開始生成';
          genBtn.disabled = isGeneratingImage;

          genBtn.addEventListener('click', async () => {
            const prompt = stepResults[2] || window.StudioState.decodeResult?.promptText;
            if (!prompt) { showToast('找不到提示詞'); return; }

            const model = modelSel.value;
            const hasKey = window.StudioSettings.hasApiKey(model);
            
            if (!hasKey) {
              showToast(`請先在設定面板配置 ${model === 'nanobanana' ? 'Nano Banana Pro' : 'GPT Image 2.0'} 的 API Key`);
              return;
            }

            isGeneratingImage = true;
            renderPipeline(); // re-render to show loading state

            try {
              const key = model === 'nanobanana' ? window.StudioSettings.getNanobananaKey() : window.StudioSettings.getGptimageKey();
              let imageUrl = '';
              if (model === 'nanobanana') {
                imageUrl = await window.AIService.generateWithNanoBanana(prompt, key);
              } else {
                imageUrl = await window.AIService.generateWithGPTImage(prompt, key);
              }

              isGeneratingImage = false;
              markStep(3);
              stepResults[3] = imageUrl;
              showToast('✨ 圖像生成成功！');
            } catch(e) {
              isGeneratingImage = false;
              renderPipeline();
              showToast('❌ 生成失敗：' + e.message);
            }
          });

          genControls.appendChild(modelSel);
          genControls.appendChild(genBtn);
          body.appendChild(genControls);

        } else {
          // Standard action button
          const actionBtn = document.createElement('button');
          actionBtn.className = 'step-action btn-primary';
          actionBtn.textContent = step.action;
          actionBtn.disabled = !isActive;
          if (!isActive) actionBtn.style.opacity = '0.4';
          actionBtn.addEventListener('click', step.onAction);
          body.appendChild(actionBtn);
        }
      } else {
        body.appendChild(status);
        if (stepResults[i]) {
          if (i === 3) {
             // Display generated image
             const imgWrapper = document.createElement('div');
             imgWrapper.style.marginTop = '12px';
             const img = document.createElement('img');
             img.src = stepResults[i];
             img.style.maxWidth = '100%';
             img.style.borderRadius = '8px';
             img.style.border = '1px solid var(--border)';
             imgWrapper.appendChild(img);
             body.appendChild(imgWrapper);
          } else {
            const result = document.createElement('div');
            result.className = 'step-result visible';
            result.textContent = stepResults[i];
            body.appendChild(result);
          }
        }
      }

      wrapper.appendChild(connector);
      wrapper.appendChild(body);
      pipeline.appendChild(wrapper);
    });
  }

  resetBtn.addEventListener('click', () => {
    stepStates = [false, false, false, false];
    stepResults = ['', '', '', ''];
    window.StudioState.workflowSteps = [false, false, false, false];
    renderPipeline();
    showToast('流程已重置');
  });

  // External hooks called by decode.js
  window.workflowMarkReady = function(idx) {
    // Called when decode finishes — just re-render to activate step 2
    renderPipeline();
  };

  window.workflowReceivePrompt = function(text) {
    stepResults[2] = text;
    if (!stepStates[1] && window.StudioState.decodeResult) {
      stepStates[0] = true;
      stepStates[1] = true;
      const res = window.StudioState.decodeResult;
      stepResults[1] = `色盤：${res.palette.join(' ')}\n標籤：${res.styleTags.map(t=>t.label).join('、')}`;
    }
    renderPipeline();
  };

  renderPipeline();
})();
