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
      title: '④ 圖像生成',
      desc: '使用組建的提示詞，透過進階模型直接生成圖像。',
      action: '開始生成',
      onAction: async () => {
        const res = window.StudioState.decodeResult;
        if (!res) { showToast('請先完成前面的步驟'); return; }

        const actionBtns = document.querySelectorAll('.step-action');
        const btn = actionBtns[actionBtns.length - 1];
        if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }

        try {
          let model = 'gptImage';
          let key = window.StudioSettings.getGptImageKey();
          if (!key) {
            model = 'nano';
            key = window.StudioSettings.getNanoKey();
          }
          if (!key) {
            throw new Error("請先至「設定」面板配置 GPT Image 2.0 或 Nano Banana Pro 金鑰");
          }

          showToast(`⏳ 正在使用 ${model === 'gptImage' ? 'GPT Image 2.0' : 'Nano Banana Pro'} 生成圖像...`);

          let imageUrl;
          if (model === 'gptImage') {
            imageUrl = await window.AIService.generateWithGPTImage(res.promptText, key);
          } else {
            imageUrl = await window.AIService.generateWithNanoBanana(res.promptText, key);
          }

          markStep(3);
          showToast('✅ 圖像生成成功！');
          updateStepResult(3, `<div style="margin-top: 10px; font-weight: 600; color: var(--warm-dark);">${model === 'gptImage' ? 'GPT Image 2.0' : 'Nano Banana Pro'} 生成結果：</div><img src="${imageUrl}" alt="Generated Image" style="max-width: 100%; border-radius: 8px; margin-top: 10px; box-shadow: var(--card-shadow);">`);
          renderPipeline();
        } catch (err) {
          showToast('❌ 生成失敗：' + err.message, 4000);
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = '開始生成'; }
        }
      }
    }
  ];

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
        const actionBtn = document.createElement('button');
        actionBtn.className = 'step-action btn-primary';
        actionBtn.textContent = step.action;
        actionBtn.disabled = !isActive;
        if (!isActive) actionBtn.style.opacity = '0.4';
        actionBtn.addEventListener('click', step.onAction);
        body.appendChild(actionBtn);
      } else {
        body.appendChild(status);
        if (stepResults[i]) {
          const result = document.createElement('div');
          result.className = 'step-result visible';
          // Using innerHTML instead of textContent to allow rendering the image tag
          if (stepResults[i].includes('<img')) {
            result.innerHTML = stepResults[i];
          } else {
            result.textContent = stepResults[i];
          }
          body.appendChild(result);
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
