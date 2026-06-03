// Shared state accessible by all modules
window.StudioState = {
  decodeResult: null,   // { palette, styleTags, promptText }
  workflowSteps: [false, false, false, false]
};

// Navigation
const panels = {
  decode: '提示詞解構',
  prompts: '提示詞庫與熔爐',
  workflow: '簡易工作流',
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
