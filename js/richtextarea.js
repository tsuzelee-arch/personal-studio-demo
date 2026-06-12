/**
 * richtextarea.js — RichTextService 核心服務
 *
 * 統一管理「textarea ↔ contenteditable div」的雙向同步、autoResize、
 * placeholder、貼上淨化（強制純文字）。editor.js 的 autosuggest 建立在此之上。
 *
 * 載入順序：必須在 editor.js 之前載入。
 *
 * 資料流（單向，防止無窮迴圈）：
 *   使用者輸入 → editor div → (rAF throttle) serialize → textarea.value → dispatch 'input'
 *   程式寫入   → setContent(text) → textarea.value + renderToHtml → editor div
 *   兩條路徑都以 `updating` WeakSet 與 `__lastRendered` 防止重入互踩。
 */
window.RichTextService = (function() {

  // 正在程式化更新中的 textarea 集合 — setContent/refresh 重入防護
  const updating = new WeakSet();

  function resolve(textareaOrId) {
    return typeof textareaOrId === 'string' ? document.getElementById(textareaOrId) : textareaOrId;
  }

  // 取得 textarea 對應的 rich editor div（緊鄰的下一個兄弟節點）
  function getEditor(textarea) {
    const sib = textarea && textarea.nextElementSibling;
    return (sib && sib.classList.contains('rich-editor')) ? sib : null;
  }

  // ── 序列化：editor DOM → 純文字（含 [@name:id] 標籤格式）──
  // 遞迴處理：瀏覽器在 contenteditable 換行時會產生 <div>/<br> 巢狀結構，
  // 圖片標籤可能被包進行內 div，僅走訪第一層會遺失格式。
  function serialize(root) {
    let out = '';
    root.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) { out += node.textContent.replace(/\u200B/g, ''); return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.tagName === 'BR') { out += '\n'; return; }
      
      // Neutralize Chrome's injected <font> tags (stops style bleed)
      if (node.tagName === 'FONT') {
         node.removeAttribute('color');
         node.removeAttribute('style');
      }

      if (node.classList.contains('editor-img-tag')) {
        const name = node.querySelector('.tag-name');
        out += `[@${name ? name.textContent : ''}:${node.dataset.assetId || ''}]`;
        return;
      }
      if (node.classList.contains('editor-color-tag')) { 
        // Forcefully strip Chrome's deeply nested color tags ALWAYS
        node.querySelectorAll('*').forEach(child => {
            child.removeAttribute('color');
            child.removeAttribute('style');
        });

        const match = node.textContent.match(/^#[0-9A-Fa-f]{6}$/i);
        if (!match) {
           node.removeAttribute('style');
           node.classList.remove('editor-color-tag');
        } else {
           node.style.color = match[0];
        }
        out += node.textContent; 
        return; 
      }
      
      // Neutralize any other spans that aren't explicitly ours
      if (node.tagName === 'SPAN' && !node.classList.contains('editor-reset-style')) {
         node.removeAttribute('style');
         node.querySelectorAll('*').forEach(child => {
             child.removeAttribute('color');
             child.removeAttribute('style');
         });
      }

      const isBlock = node.tagName === 'DIV' || node.tagName === 'P';
      if (isBlock && out && !out.endsWith('\n')) out += '\n';
      out += serialize(node);
    });
    return out;
  }

  // ── 渲染：純文字 → editor HTML（color tag / asset tag）──
  function renderToHtml(text) {
    let html = String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    html = html.replace(/(#[0-9A-Fa-f]{6})\b/gi,
      '<span class="editor-color-tag" style="color: $1; font-weight: bold; background: rgba(0,0,0,0.05); padding: 0 2px; border-radius: 3px;">$1</span><span class="editor-reset-style" style="color: var(--node-text, #e0e0e0); font-weight: normal; background: transparent;">&#8203;</span>');
    // TODO: 縮圖路徑為舊有的硬編碼約定；真實縮圖需查詢 AssetsService（async）
    html = html.replace(/\[@([^:]+):([^\]]+)\]/g,
      '<span class="editor-img-tag" contenteditable="false" data-asset-id="$2"><img src="assets/$2.jpg" alt="$1"><span class="tag-name">$1</span></span>');
    return html;
  }

  // ── Placeholder：:empty 在殘留 <br>/空白節點時失效，改用 JS 維護 data-empty ──
  function updatePlaceholder(editor) {
    const isEmpty = editor.textContent.trim() === '' && !editor.querySelector('img, .editor-img-tag');
    editor.dataset.empty = isEmpty ? 'true' : 'false';
  }

  function plainResize(el, maxPx) {
    el.style.height = 'auto';
    const h = maxPx ? Math.min(el.scrollHeight, maxPx) : el.scrollHeight;
    el.style.height = h + 'px';
  }

  // textarea.value → editor div（值未變時跳過 innerHTML 重寫，避免游標被毀與閃爍）
  function refreshFromTextarea(textarea, maxPx) {
    const editor = getEditor(textarea);
    if (!editor) { plainResize(textarea, maxPx); return; }
    if (!updating.has(textarea) && editor.__lastRendered !== textarea.value) {
      updating.add(textarea);
      try {
        editor.innerHTML = renderToHtml(textarea.value);
        editor.__lastRendered = textarea.value;
        updatePlaceholder(editor);
      } finally { updating.delete(textarea); }
    }
    plainResize(editor, maxPx);
  }

  // 統一 autoResize：textarea（含 rich editor 同步）與一般元素皆可用
  function autoResize(el, maxPx) {
    if (!el) return;
    if (el.tagName === 'TEXTAREA') { refreshFromTextarea(el, maxPx); return; }
    plainResize(el, maxPx);
  }

  // ── 貼上淨化：一律轉純文字，杜絕外部網頁的粗體/顏色/表格污染 ──
  function handlePaste(e) {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (!text) return;
    // execCommand 保留瀏覽器 undo 堆疊且自動觸發 input；失敗時退回 Range API
    if (!document.execCommand('insertText', false, text)) {
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      e.currentTarget.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  // editor → textarea 同步（rAF 節流：一個 frame 內的連續輸入只序列化一次）
  function wireSync(editor, textarea) {
    let scheduled = false;
    editor.addEventListener('input', () => {
      updatePlaceholder(editor); // 便宜操作，立即執行讓 placeholder 不閃爍
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const raw = serialize(editor);
        editor.__lastRendered = raw; // 標記已同步，後續 autoResize 不重寫 innerHTML
        if (textarea.value !== raw) {
          textarea.value = raw;
          updating.add(textarea); // 防護：dispatch 期間的 setContent 重入只更新 value
          try {
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          } finally { updating.delete(textarea); }
        }
        plainResize(editor);
      });
    });
  }

  // ── enhance 模式：對既有 contenteditable div 加掛 placeholder + 貼上淨化 ──
  // （不接管 drop / input 同步 — 例如 simple-workflow 的提示詞編輯器自有拖放邏輯）
  function enhance(el) {
    if (el.__rtEnhanced) return el;
    el.__rtEnhanced = true;
    el.addEventListener('paste', handlePaste);
    el.addEventListener('input', () => updatePlaceholder(el));
    updatePlaceholder(el);
    return el;
  }

  // ── init：主入口。textarea → 包裝模式；contenteditable div → enhance 模式 ──
  function init(target, options) {
    options = options || {};
    const el = resolve(target);
    if (!el) return null;
    if (el.tagName !== 'TEXTAREA') {
      if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return enhance(el);
      return null;
    }
    const existing = getEditor(el);
    if (existing) return existing;

    const editor = document.createElement('div');
    editor.className = 'rich-textarea rich-editor ' + el.className;
    editor.contentEditable = 'true';
    if (el.placeholder) editor.dataset.placeholder = el.placeholder;
    editor.innerHTML = renderToHtml(el.value);
    editor.__lastRendered = el.value;

    wireSync(editor, el);
    editor.addEventListener('paste', handlePaste);
    if (!options.enableDragDrop) {
      editor.addEventListener('dragover', e => e.preventDefault());
      editor.addEventListener('drop', e => e.preventDefault());
    }

    el.style.display = 'none';
    el.parentNode.insertBefore(editor, el.nextSibling);
    updatePlaceholder(editor);
    plainResize(editor);
    return editor;
  }

  // ── 程式化寫入內容（防重入 guard）──
  function setContent(target, content) {
    const textarea = resolve(target);
    if (!textarea) return;
    if (updating.has(textarea)) { textarea.value = content; return; }
    updating.add(textarea);
    try {
      textarea.value = content;
      const editor = getEditor(textarea);
      if (editor) {
        editor.innerHTML = renderToHtml(content);
        editor.__lastRendered = content;
        updatePlaceholder(editor);
        plainResize(editor);
      }
    } finally { updating.delete(textarea); }
  }

  // ── 讀取內容：直接從 editor DOM 序列化，避免 rAF 同步尚未落地時拿到舊值 ──
  function getContent(target) {
    const textarea = resolve(target);
    if (!textarea) return '';
    const editor = getEditor(textarea);
    if (editor) {
      const raw = serialize(editor);
      textarea.value = raw;
      editor.__lastRendered = raw;
      return raw;
    }
    return textarea.value;
  }

  return {
    init,
    enhance,
    setContent,
    getContent,
    autoResize,
    updatePlaceholder,
    serialize
  };
})();
