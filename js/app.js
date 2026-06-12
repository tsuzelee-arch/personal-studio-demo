// Shared state accessible by all modules
window.StudioState = {
  decodeResult: null,   // { palette, styleTags, promptText }
  workflowSteps: [false, false, false, false]
};

// Navigation
const panels = {
  'simple-workflow': '簡易工具流',
  decode: '圖像解構',
  prompts: '提示詞庫與熔爐',
  workflow: '自定工作流',
  assets: '資產庫',
  settings: 'API 設定'
};

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const target = item.dataset.panel;
    if (!target) return;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    document.getElementById(`panel-${target}`).classList.add('active');
    document.getElementById('pageTitle').textContent = panels[target] || item.textContent.trim();
    sessionStorage.setItem('activePanel', target);
  });
});

// Restore last active panel on load
(function restorePanel() {
  const saved = sessionStorage.getItem('activePanel');
  if (saved && document.querySelector(`[data-panel="${saved}"]`)) {
    document.querySelector(`[data-panel="${saved}"]`).click();
  }
})();

// Toast utility
window.showToast = function(msg, duration = 2000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.classList.add('hidden');
    t.classList.remove('show');
  }, duration);
};

// Switch to a panel programmatically
window.switchPanel = function(panelId) {
  const item = document.querySelector(`[data-panel="${panelId}"]`);
  if (item) item.click();
};

// ── Global Textarea Color Picker Interceptor (Pickr) ──
(function() {
  const pickrAnchor = document.getElementById('pickr-anchor');
  if (!pickrAnchor || typeof Pickr === 'undefined') return;

  let activeTextarea = null;
  let activeCursorPos = null;
  let pickrEnterPressed = false;
  let pickrColorChanged = false;
  let pickrInitialColor = null;
  let isPickrOpen = false;

  // Initialize Pickr
  const pickr = Pickr.create({
    el: '#pickr-anchor',
    useAsButton: true, // Keep anchor position, fixes bottom-left bug
    theme: 'nano',
    defaultRepresentation: 'HEX',
    default: '#000000',
    components: {
      preview: true,
      opacity: false,
      hue: true,
      interaction: {
        hex: true,
        rgba: false,
        hsla: false,
        hsva: false,
        cmyk: false,
        input: true,
        clear: false,
        save: false
      }
    }
  });

  // Bulletproof global listener for Enter key in Pickr (useCapture to bypass Pickr's stopPropagation)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && isPickrOpen) {
      e.preventDefault();
      e.stopPropagation();
      pickrEnterPressed = true;
      pickr.hide();
    }
  }, true);

  pickr.on('show', () => {
    isPickrOpen = true;
    pickrEnterPressed = false;
    pickrColorChanged = false;
    pickrInitialColor = pickr.getColor().toHEXA().toString().toUpperCase();
  });

  pickr.on('change', () => {
    pickrColorChanged = true;
  });

  // Expose global open API
  window.openGlobalPickr = function(x, y, color = '#000000', targetEditorId = '') {
    pickrAnchor.style.left = x + 'px';
    pickrAnchor.style.top = y + 'px';
    pickrAnchor.dataset.targetEditorId = targetEditorId;
    pickr.setColor(color);
    pickr.show();
  };

  // Textarea interceptor for '#'
  document.addEventListener('input', (e) => {
    if (e.target.tagName.toLowerCase() === 'textarea') {
      const val = e.target.value;
      const pos = e.target.selectionStart;
      if (pos > 0 && val[pos - 1] === '#') {
        if (e.data === '#') {
          activeTextarea = e.target;
          activeCursorPos = pos;
          window.openGlobalPickr(window.innerWidth / 2, window.innerHeight / 2, '#000000', e.target.id);
        }
      }
    }
  });

  // Handle clicking on an existing color tag to edit it
  document.addEventListener('click', (e) => {
    if (e.target.classList && e.target.classList.contains('editor-color-tag')) {
      const color = e.target.textContent;
      if (/^#[0-9A-Fa-f]{6}$/i.test(color)) {
        const range = document.createRange();
        range.selectNode(e.target);
        window.currentEditorColorRange = range;
        
        let editor = e.target.closest('.rich-editor, .swf-prompt-editor');
        window.openGlobalPickr(e.clientX, e.clientY, color, editor ? editor.id : '');
      }
    }
  });

  // Apply color logic
  function applyColor(color) {
    const targetEditorId = pickrAnchor.dataset.targetEditorId;

    // Rich Editor Path
    if (window.currentEditorColorRange) {
       const range = window.currentEditorColorRange;
       
       if (range.collapsed) {
           const textNode = range.startContainer;
           range.setStart(textNode, Math.max(0, range.startOffset - 1)); // Select the '#'
       }
       
       const editor = range.startContainer.parentElement?.closest('.rich-editor, .swf-prompt-editor');
       if (editor) editor.focus();

       const sel = window.getSelection();
       sel.removeAllRanges();
       sel.addRange(range);
       
       const html = `<span class="editor-color-tag" style="color: ${color}; font-weight: bold; background: rgba(0,0,0,0.05); padding: 0 2px; border-radius: 3px;">${color}</span><span class="editor-reset-style" style="color: var(--node-text, #e0e0e0); font-weight: normal; background: transparent;">&#8203;</span>`;
       document.execCommand('insertHTML', false, html);
       
       if (targetEditorId) {
         const richEditor = document.getElementById(targetEditorId)?.nextElementSibling;
         if (richEditor && richEditor.classList.contains('rich-editor')) {
           richEditor.dispatchEvent(new Event('input', { bubbles: true }));
         }
       }
       
       if (window.PromptsService && window.PromptsService.setModalPaletteColor) {
         window.PromptsService.setModalPaletteColor(color);
       }
       return;
    }

    // Standard Textarea Path
    if (activeTextarea && activeCursorPos !== null) {
      const val = activeTextarea.value;
      const before = val.substring(0, activeCursorPos - 1);
      const after = val.substring(activeCursorPos);
      activeTextarea.value = before + color + after;
      
      const newPos = activeCursorPos - 1 + color.length;
      activeTextarea.setSelectionRange(newPos, newPos);
      activeTextarea.focus();

      if (window.EditorService && window.EditorService.setContent) {
        window.EditorService.setContent(activeTextarea.id, activeTextarea.value);
      }
      if (window.PromptsService && window.PromptsService.setModalPaletteColor) {
         window.PromptsService.setModalPaletteColor(color);
      }
    }
  }

  // Hide Event (Replaces Save Event, perfectly mimics native picker)
  pickr.on('hide', () => {
    isPickrOpen = false;
    const finalColor = pickr.getColor().toHEXA().toString().toUpperCase();
    
    // Only apply if color was changed or Enter was explicitly pressed
    if (finalColor !== pickrInitialColor || pickrColorChanged || pickrEnterPressed) {
        applyColor(finalColor);
    }

    // Cleanup state
    window.currentEditorColorRange = null;
    activeTextarea = null;
    activeCursorPos = null;
    pickrAnchor.dataset.targetEditorId = '';
  });

})();
