/**
 * ide-agent.js — IDE Agent Chat Interface & Left Pane Asset Explorer
 * Dual-track image generation:
 *   Track A: Direct image mode — bypasses chat models, sends prompt directly to GPT Image 2.0
 *   Track B: Tool Calling — chat models can invoke generate_image tool
 * Models: ChatGPT 5.5, Gemini 3.5 Flash, Gemini 3.1 Pro (High)
 */
window.IDEAgent = (function() {
  // ── DOM refs ──
  const folderList    = document.getElementById('ideFolderList');
  const assetsGrid    = document.getElementById('ideAssetsGrid');
  const messagesEl    = document.getElementById('agentMessages');
  const textarea      = document.getElementById('agentTextarea');
  const sendBtn       = document.getElementById('agentSendBtn');
  const attachBtn     = document.getElementById('agentAttachBtn');
  const attachmentsEl = document.getElementById('agentAttachments');
  const modelSelect   = document.getElementById('agentModelSelect');
  const agentPane     = document.querySelector('.ide-right-agent');
  const imageModeBtn  = document.getElementById('agentImageModeToggle');
  const genParamsEl   = document.getElementById('agentGenParams');
  const genSizeEl     = document.getElementById('agentGenSize');
  const genQualityEl  = document.getElementById('agentGenQuality');
  const inputContainer = document.getElementById('agentInputContainer');

  // ── State ──
  const AGENT_ARCHIVED = true; // IDE Agent is under development — all API calls blocked
  let chatHistory = [];        // { role: 'user'|'assistant', content: string, images?: string[] }
  let pendingAttachments = []; // base64 data URLs
  let activeFolder = '已完成';
  let isLoading = false;
  let isImageMode = false;     // Track A: direct image generation mode

  // ════════════════════════════════════════════════════════
  //  LEFT PANE: Asset File Explorer
  // ════════════════════════════════════════════════════════
  async function renderIdeFolders() {
    if (!folderList) return;
    const folders = window.AssetsService.getFolders();
    folderList.innerHTML = '';
    folders.forEach(name => {
      const btn = document.createElement('button');
      btn.className = 'ide-folder-item' + (name === activeFolder ? ' active' : '');
      btn.textContent = name;
      btn.addEventListener('click', () => {
        activeFolder = name;
        renderIdeFolders();
        renderIdeAssets();
      });
      folderList.appendChild(btn);
    });
  }

  async function renderIdeAssets() {
    if (!assetsGrid) return;
    try {
      const all = await window.AssetsService.getAllAssets();
      const assets = all.filter(a => a.folder === activeFolder);
      assetsGrid.innerHTML = '';

      if (assets.length === 0) {
        assetsGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);font-size:11px;padding:20px;">此資料夾目前沒有資產</div>';
        return;
      }

      assets.forEach(asset => {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';

        const thumb = document.createElement('div');
        thumb.className = 'ide-asset-thumb';
        thumb.draggable = true;
        thumb.innerHTML = `<img src="${asset.data}" alt="${asset.name}" loading="lazy">`;
        
        // Drag to chat
        thumb.addEventListener('dragstart', (e) => {
          const tag = `[@${asset.name}:${asset.id}]`;
          e.dataTransfer.setData('text/ide-asset', JSON.stringify({ id: asset.id, data: asset.data, name: asset.name }));
          e.dataTransfer.setData('text/plain', tag);
          e.dataTransfer.effectAllowed = 'copy';
        });

        // Click to preview
        thumb.addEventListener('click', () => {
          window.AssetsService.openLightBox(asset.data, asset.name, false);
        });

        const label = document.createElement('div');
        label.className = 'ide-asset-name';
        label.textContent = asset.name;

        wrapper.appendChild(thumb);
        wrapper.appendChild(label);
        assetsGrid.appendChild(wrapper);
      });
    } catch (e) {
      console.error('IDE Assets render error:', e);
    }
  }

  // ════════════════════════════════════════════════════════
  //  IMAGE MODE TOGGLE
  // ════════════════════════════════════════════════════════
  function toggleImageMode() {
    isImageMode = !isImageMode;
    if (imageModeBtn) imageModeBtn.classList.toggle('active', isImageMode);
    if (genParamsEl)  genParamsEl.classList.toggle('hidden', !isImageMode);
    if (inputContainer) inputContainer.classList.toggle('image-mode', isImageMode);
    if (textarea) {
      textarea.placeholder = isImageMode
        ? '🎨 描述您想要生成的圖片（直接呼叫 GPT Image 2.0，不消耗對話 Token）...'
        : '輸入描述來生成圖像，或附加圖片進行分析...';
    }
  }

  // ════════════════════════════════════════════════════════
  //  RIGHT PANE: Chat Interface
  // ════════════════════════════════════════════════════════

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function addUserMessage(text, images = []) {
    const welcome = messagesEl.querySelector('.agent-welcome');
    if (welcome) welcome.remove();

    const msg = document.createElement('div');
    msg.className = 'chat-msg user';
    
    let imagesHtml = '';
    if (images.length > 0) {
      imagesHtml = images.map(src => `<img class="chat-user-image" src="${src}" alt="attachment">`).join('');
    }

    msg.innerHTML = `<div class="chat-bubble">${imagesHtml}${escHtml(text)}</div>`;
    messagesEl.appendChild(msg);
    scrollToBottom();
  }

  function addAIMessage(text, generatedImageUrl = null) {
    const msg = document.createElement('div');
    msg.className = 'chat-msg ai';

    let contentHtml = text.split('\n').filter(p => p.trim()).map(p => `<p>${escHtml(p)}</p>`).join('');
    
    if (generatedImageUrl) {
      contentHtml += `<img class="chat-gen-image" src="${generatedImageUrl}" alt="Generated Image">`;
      contentHtml += `<button class="chat-save-btn" data-src="${generatedImageUrl}">💾 存入資產庫</button>`;
    }

    msg.innerHTML = `
      <div class="chat-msg-avatar">✧</div>
      <div class="chat-content">${contentHtml}</div>
    `;

    // Save button handler
    const saveBtn = msg.querySelector('.chat-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const src = saveBtn.dataset.src;
        const name = prompt('請為生成的圖片命名：', 'IDE Agent 生成') || 'IDE Agent 生成';
        try {
          await window.AssetsService.saveAsset(name, src, '已完成');
          window.showToast('✅ 已存入「已完成」資料夾！');
          renderIdeAssets();
          if (window.refreshAssetsGrid) window.refreshAssetsGrid();
        } catch (e) {
          window.showToast('❌ 儲存失敗');
        }
      });
    }

    // Click generated image to enlarge
    const genImg = msg.querySelector('.chat-gen-image');
    if (genImg) {
      genImg.addEventListener('click', () => {
        window.AssetsService.openLightBox(generatedImageUrl, 'Generated Image', true);
      });
    }

    messagesEl.appendChild(msg);
    scrollToBottom();
  }

  function addLoadingIndicator() {
    const loader = document.createElement('div');
    loader.className = 'chat-msg ai';
    loader.id = 'agentLoading';
    loader.innerHTML = `
      <div class="chat-msg-avatar">✧</div>
      <div class="chat-content">
        <div class="chat-loading">
          <div class="chat-loading-dots"><span></span><span></span><span></span></div>
        </div>
      </div>
    `;
    messagesEl.appendChild(loader);
    scrollToBottom();
  }

  function removeLoadingIndicator() {
    const loader = document.getElementById('agentLoading');
    if (loader) loader.remove();
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  // ════════════════════════════════════════════════════════
  //  SEND MESSAGE — Dual Track Router
  // ════════════════════════════════════════════════════════

  async function sendMessage() {
    if (AGENT_ARCHIVED) return; // IDE Agent is archived — no API calls
    const text = textarea.value.trim();
    if (!text && pendingAttachments.length === 0) return;
    if (isLoading) return;

    const images = [...pendingAttachments];

    // Add to UI
    addUserMessage(text || '(附加圖片)', images);
    chatHistory.push({ role: 'user', content: text, images });

    // Clear input
    textarea.value = '';
    textarea.style.height = 'auto';
    pendingAttachments = [];
    attachmentsEl.innerHTML = '';

    isLoading = true;
    addLoadingIndicator();

    try {
      let response;

      if (isImageMode) {
        // ── TRACK A: Direct Image Generation (zero chat token cost) ──
        response = await directImageGeneration(text, images);
      } else {
        // ── TRACK B: Chat with Tool Calling for image generation ──
        const model = modelSelect.value;
        if (model === 'gpt-5.5') {
          response = await callOpenAI(text, images);
        } else {
          response = await callGemini(text, images, model);
        }
      }

      removeLoadingIndicator();

      if (response.image) {
        addAIMessage(response.text || '圖片已生成完成！', response.image);
        chatHistory.push({ role: 'assistant', content: response.text || '', generatedImage: response.image });
      } else {
        addAIMessage(response.text);
        chatHistory.push({ role: 'assistant', content: response.text });
      }
    } catch (err) {
      removeLoadingIndicator();
      addAIMessage(`❌ 錯誤：${err.message}`);
    } finally {
      isLoading = false;
    }
  }

  // ════════════════════════════════════════════════════════
  //  TRACK A: Direct Image Generation (GPT Image 2.0)
  // ════════════════════════════════════════════════════════

  async function directImageGeneration(prompt, refImages) {
    const apiKey = window.StudioSettings.getGptimageKey() || window.StudioSettings.getOpenAIKey();
    if (!apiKey) throw new Error('請先在設定中配置 OpenAI / GPT Image API Key');

    const size = genSizeEl ? genSizeEl.value : '1024x1024';
    const quality = genQualityEl ? genQualityEl.value : 'high';

    const imgResult = await generateWithGPTImage2(apiKey, prompt, refImages, size, quality);
    return { text: `🎨 生圖完成！\n尺寸：${size} · 畫質：${quality}`, image: imgResult };
  }

  // ── GPT Image 2.0 Core ──
  async function generateWithGPTImage2(apiKey, prompt, refImages, size, quality) {
    const formData = new FormData();
    formData.append('model', 'gpt-image-1');
    formData.append('prompt', prompt);
    formData.append('size', size || '1024x1024');
    formData.append('quality', quality || 'high');
    formData.append('n', '1');

    // Attach reference images if available
    if (refImages && refImages.length > 0) {
      for (let i = 0; i < Math.min(refImages.length, 4); i++) {
        const blob = dataURLtoBlob(refImages[i]);
        formData.append('image[]', blob, `ref_${i}.png`);
      }
    }

    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `GPT Image 2.0 API 錯誤 (${res.status})`);
    }

    const data = await res.json();
    if (data.data?.[0]?.b64_json) {
      return `data:image/png;base64,${data.data[0].b64_json}`;
    } else if (data.data?.[0]?.url) {
      return data.data[0].url;
    }
    throw new Error('未收到生成的圖片');
  }

  // ════════════════════════════════════════════════════════
  //  TRACK B: Chat with Tool Calling
  // ════════════════════════════════════════════════════════

  // ── Tool definition for function calling ──
  const IMAGE_GEN_TOOL = {
    type: 'function',
    function: {
      name: 'generate_image',
      description: '使用 GPT Image 2.0 生成圖片。當用戶要求生成、繪製、創建圖片時呼叫此工具。',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '用於生成圖片的詳細英文提示詞 (prompt)。請將用戶的描述翻譯為英文並擴充細節。'
          },
          size: {
            type: 'string',
            enum: ['1024x1024', '1792x1024', '1024x1792'],
            description: '圖片尺寸。1024x1024 為正方形，1792x1024 為橫向，1024x1792 為直向。'
          },
          quality: {
            type: 'string',
            enum: ['standard', 'high'],
            description: '圖片品質。high 為高解析度，standard 為標準。'
          }
        },
        required: ['prompt']
      }
    }
  };

  // Gemini equivalent tool declaration
  const GEMINI_IMAGE_GEN_TOOL = {
    functionDeclarations: [{
      name: 'generate_image',
      description: '使用 GPT Image 2.0 生成圖片。當用戶要求生成、繪製、創建圖片時呼叫此工具。',
      parameters: {
        type: 'OBJECT',
        properties: {
          prompt: {
            type: 'STRING',
            description: '用於生成圖片的詳細英文提示詞 (prompt)。請將用戶的描述翻譯為英文並擴充細節。'
          },
          size: {
            type: 'STRING',
            enum: ['1024x1024', '1792x1024', '1024x1792'],
            description: '圖片尺寸。1024x1024 為正方形，1792x1024 為橫向，1024x1792 為直向。'
          },
          quality: {
            type: 'STRING',
            enum: ['standard', 'high'],
            description: '圖片品質。high 為高解析度，standard 為標準。'
          }
        },
        required: ['prompt']
      }
    }]
  };

  // ── OpenAI (ChatGPT 5.5 with Tool Calling) ──
  async function callOpenAI(text, images) {
    const apiKey = window.StudioSettings.getOpenAIKey();
    if (!apiKey) throw new Error('請先在設定中配置 OpenAI API Key');

    const messages = buildOpenAIMessages(text, images);

    const body = {
      model: 'gpt-5.5',
      messages,
      max_tokens: 2048,
      tools: [IMAGE_GEN_TOOL],
      tool_choice: 'auto'
    };

    const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    });

    if (!chatRes.ok) {
      const err = await chatRes.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI API 錯誤 (${chatRes.status})`);
    }

    const chatData = await chatRes.json();
    const choice = chatData.choices?.[0];
    const reply = choice?.message?.content || '';

    // Check if model wants to call generate_image tool
    const toolCalls = choice?.message?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      for (const tc of toolCalls) {
        if (tc.function?.name === 'generate_image') {
          try {
            const args = JSON.parse(tc.function.arguments);
            const imgApiKey = window.StudioSettings.getGptimageKey() || apiKey;
            const imgResult = await generateWithGPTImage2(
              imgApiKey,
              args.prompt,
              images,
              args.size || '1024x1024',
              args.quality || 'high'
            );
            const desc = reply || `🎨 已根據您的要求生成圖片！\nPrompt: ${args.prompt}`;
            return { text: desc, image: imgResult };
          } catch (imgErr) {
            return { text: reply + `\n\n⚠️ 圖片生成失敗：${imgErr.message}` };
          }
        }
      }
    }

    return { text: reply };
  }

  function buildOpenAIMessages(text, images) {
    const msgs = [];
    msgs.push({ role: 'system', content: '你是一位專業的創意 AI 助手，擅長圖像生成、藝術分析和創意設計。回覆請使用繁體中文。當用戶要求生成或繪製圖片時，請使用 generate_image 工具。' });

    // History (last 10 turns)
    const recent = chatHistory.slice(-10);
    recent.forEach(h => {
      if (h.role === 'user') {
        if (h.images && h.images.length > 0) {
          const content = [];
          if (h.content) content.push({ type: 'text', text: h.content });
          h.images.forEach(img => {
            content.push({ type: 'image_url', image_url: { url: img } });
          });
          msgs.push({ role: 'user', content });
        } else {
          msgs.push({ role: 'user', content: h.content });
        }
      } else {
        msgs.push({ role: 'assistant', content: h.content || '' });
      }
    });

    // Current message
    if (images.length > 0) {
      const content = [];
      if (text) content.push({ type: 'text', text });
      images.forEach(img => {
        content.push({ type: 'image_url', image_url: { url: img } });
      });
      msgs.push({ role: 'user', content });
    } else if (text) {
      msgs.push({ role: 'user', content: text });
    }

    return msgs;
  }

  // ── Google Gemini (3.5 Flash / 3.1 Pro with Tool Calling) ──
  async function callGemini(text, images, modelType) {
    const apiKey = window.StudioSettings.getGeminiKey();
    if (!apiKey) throw new Error('請先在設定中配置 Gemini API Key');

    const modelName = modelType === 'gemini-3.1-pro' ? 'gemini-2.5-pro' : 'gemini-2.5-flash';

    // Build parts
    const parts = [];
    if (text) parts.push({ text });
    images.forEach(img => {
      const match = img.match(/^data:(image\/\w+);base64,(.+)/);
      if (match) {
        parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
      }
    });

    // Build contents with history
    const contents = [];
    const recent = chatHistory.slice(-10);
    recent.forEach(h => {
      const p = [];
      if (h.content) p.push({ text: h.content });
      if (h.images) {
        h.images.forEach(img => {
          const m = img.match(/^data:(image\/\w+);base64,(.+)/);
          if (m) p.push({ inline_data: { mime_type: m[1], data: m[2] } });
        });
      }
      if (p.length > 0) {
        contents.push({ role: h.role === 'user' ? 'user' : 'model', parts: p });
      }
    });

    // Add current
    contents.push({ role: 'user', parts });

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        tools: [GEMINI_IMAGE_GEN_TOOL],
        generationConfig: { maxOutputTokens: 2048 },
        systemInstruction: { parts: [{ text: '你是一位專業的創意 AI 助手，擅長圖像分析、藝術設計和創意指導。回覆請使用繁體中文。當用戶要求生成或繪製圖片時，請使用 generate_image 工具。' }] }
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Gemini API 錯誤 (${res.status})`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0]?.content;

    // Check for function call response
    if (candidate?.parts) {
      const funcCall = candidate.parts.find(p => p.functionCall);
      const textParts = candidate.parts.filter(p => p.text).map(p => p.text).join('');

      if (funcCall && funcCall.functionCall.name === 'generate_image') {
        try {
          const args = funcCall.functionCall.args;
          const imgApiKey = window.StudioSettings.getGptimageKey() || window.StudioSettings.getOpenAIKey();
          if (!imgApiKey) throw new Error('生圖需要配置 OpenAI API Key');
          const imgResult = await generateWithGPTImage2(
            imgApiKey,
            args.prompt,
            images,
            args.size || '1024x1024',
            args.quality || 'high'
          );
          const desc = textParts || `🎨 已根據您的要求生成圖片！\nPrompt: ${args.prompt}`;
          return { text: desc, image: imgResult };
        } catch (imgErr) {
          return { text: (textParts || '') + `\n\n⚠️ 圖片生成失敗：${imgErr.message}` };
        }
      }

      if (textParts) {
        return { text: textParts };
      }
    }

    const reply = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '(無回覆)';
    return { text: reply };
  }

  // ════════════════════════════════════════════════════════
  //  Utilities
  // ════════════════════════════════════════════════════════

  function dataURLtoBlob(dataURL) {
    const parts = dataURL.split(',');
    const mime = parts[0].match(/:(.*?);/)[1];
    const raw = atob(parts[1]);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // ════════════════════════════════════════════════════════
  //  Attachments
  // ════════════════════════════════════════════════════════

  function addAttachment(dataUrl) {
    if (pendingAttachments.length >= 4) {
      window.showToast('最多附加 4 張圖片');
      return;
    }
    pendingAttachments.push(dataUrl);
    renderAttachments();
  }

  function renderAttachments() {
    if (!attachmentsEl) return;
    attachmentsEl.innerHTML = '';
    pendingAttachments.forEach((src, i) => {
      const preview = document.createElement('div');
      preview.className = 'agent-attach-preview';
      preview.innerHTML = `
        <img src="${src}" alt="attachment">
        <button class="agent-attach-remove" data-idx="${i}">&times;</button>
      `;
      preview.querySelector('.agent-attach-remove').addEventListener('click', () => {
        pendingAttachments.splice(i, 1);
        renderAttachments();
      });
      attachmentsEl.appendChild(preview);
    });
  }

  // ════════════════════════════════════════════════════════
  //  Event Bindings
  // ════════════════════════════════════════════════════════

  function init() {
    if (!textarea || !sendBtn) return;

    // Send on button click
    sendBtn.addEventListener('click', sendMessage);

    // Send on Enter (Shift+Enter for newline)
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Auto-expand textarea
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    });

    // Image mode toggle
    if (imageModeBtn) {
      imageModeBtn.addEventListener('click', toggleImageMode);
    }

    // Attach button — open file picker
    if (attachBtn) {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.style.display = 'none';
      document.body.appendChild(fileInput);

      attachBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => addAttachment(ev.target.result);
        reader.readAsDataURL(file);
        fileInput.value = '';
      });
    }

    // Drag & Drop into agent chat pane
    if (agentPane) {
      agentPane.addEventListener('dragover', (e) => {
        if (e.dataTransfer.types.includes('text/ide-asset') || e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          agentPane.classList.add('drag-over');
        }
      });
      agentPane.addEventListener('dragleave', (e) => {
        if (!agentPane.contains(e.relatedTarget)) {
          agentPane.classList.remove('drag-over');
        }
      });
      agentPane.addEventListener('drop', (e) => {
        e.preventDefault();
        agentPane.classList.remove('drag-over');

        // Handle IDE asset drag
        const assetData = e.dataTransfer.getData('text/ide-asset');
        if (assetData) {
          try {
            const asset = JSON.parse(assetData);
            addAttachment(asset.data);
            window.showToast(`📎 已附加「${asset.name}」`);
          } catch (ex) { console.error(ex); }
          return;
        }

        // Handle file drag from OS
        const files = e.dataTransfer.files;
        if (files.length > 0) {
          Array.from(files).forEach(file => {
            if (!file.type.startsWith('image/')) return;
            const reader = new FileReader();
            reader.onload = (ev) => addAttachment(ev.target.result);
            reader.readAsDataURL(file);
          });
        }
      });
    }

    // Initialize left pane
    renderIdeFolders();
    renderIdeAssets();

    // Sync with asset library updates
    window.addEventListener('assets-updated', () => {
      renderIdeFolders();
      renderIdeAssets();
    });

    // Handle Left Pane Resizing via Draggable Splitter
    const resizer = document.getElementById('ideLeftResizer');
    const layout = document.querySelector('.workflow-ide-layout');
    const pane = document.querySelector('.ide-left-assets');
    if (resizer && layout && pane) {
      // Set initial column state
      const initialWidth = parseInt(layout.style.getPropertyValue('--ide-left-width') || '240');
      pane.classList.toggle('single-column', initialWidth < 220);

      resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        resizer.classList.add('dragging');
        
        const onMouseMove = (moveEvent) => {
          const rect = layout.getBoundingClientRect();
          let newWidth = moveEvent.clientX - rect.left;
          if (newWidth < 180) newWidth = 180;
          if (newWidth > 480) newWidth = 480;
          layout.style.setProperty('--ide-left-width', newWidth + 'px');
          pane.classList.toggle('single-column', newWidth < 220);
        };
        
        const onMouseUp = () => {
          resizer.classList.remove('dragging');
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
        };
        
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      });
    }
  }

  // Wait for AssetsService to be ready
  if (window.AssetsService) {
    setTimeout(init, 300);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 300));
  }

  return {
    renderIdeFolders,
    renderIdeAssets,
    addAttachment
  };
})();
