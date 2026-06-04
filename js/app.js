// Shared state accessible by all modules
window.StudioState = {
  decodeResult: null,   // { palette, styleTags, promptText }
  workflowSteps: [false, false, false, false]
};

// Navigation
const panels = {
  decode: '圖像解構',
  prompts: '提示詞庫與熔爐',
  workflow: '自定工作流與IDE Agent(開發中)',
  assets: '資產庫',
  settings: '設定'
};

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const target = item.dataset.panel;
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

// ── Global Textarea Color Picker Interceptor ──
(function() {
  const globalColorPicker = document.getElementById('globalColorPicker');
  if (!globalColorPicker) return;

  let activeTextarea = null;
  let activeCursorPos = null;

  document.addEventListener('input', (e) => {
    if (e.target.tagName.toLowerCase() === 'textarea') {
      const val = e.target.value;
      const pos = e.target.selectionStart;
      if (pos > 0 && val[pos - 1] === '#') {
        if (e.data === '#') {
          activeTextarea = e.target;
          activeCursorPos = pos;
          globalColorPicker.click();
        }
      }
    }
  });

  globalColorPicker.addEventListener('change', (e) => {
    if (activeTextarea && activeCursorPos !== null) {
      const color = e.target.value.toUpperCase();
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
      
      activeTextarea = null;
      activeCursorPos = null;
    }
  });
})();
