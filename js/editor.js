/**
 * editor.js — Autosuggest (/, @) 層
 * 編輯器的建立／同步／resize／placeholder 由 RichTextService (richtextarea.js) 負責。
 */
window.EditorService = (function() {

  // Create autosuggest UI container
  const suggestMenu = document.createElement('div');
  suggestMenu.className = 'autosuggest-menu hidden';
  document.body.appendChild(suggestMenu);

  let currentEditor = null;
  let currentMode = null; // '/' or '@'
  let query = '';
  let suggestionItems = [];
  let selectedIndex = -1;
  let selectionRange = null;

  // Close menu
  function closeSuggestMenu() {
    suggestMenu.classList.add('hidden');
    currentMode = null;
    query = '';
    suggestionItems = [];
    selectedIndex = -1;
    selectionRange = null;
  }
  
  // Handle suggestion selection
  function selectSuggestion(index) {
    if (index < 0 || index >= suggestionItems.length) return;
    const item = suggestionItems[index];
    
    // Restore selection to where the trigger was
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(selectionRange);
    
    // Create text node to replace the "/query" or "@query"
    // Since we only want to insert the item and delete the trigger text,
    // we use standard execCommand or Range manipulation.
    const textNode = selectionRange.startContainer;
    const text = textNode.textContent;
    const triggerIndex = text.lastIndexOf(currentMode, selectionRange.startOffset - 1);
    
    if (triggerIndex !== -1) {
      // Delete trigger text
      selectionRange.setStart(textNode, triggerIndex);
      selectionRange.deleteContents();
      
      // Insert new content
      if (currentMode === '/') {
        // Insert prompt text
        const insertText = document.createTextNode(item.content + ' ');
        selectionRange.insertNode(insertText);
        selectionRange.setStartAfter(insertText);
      } else if (currentMode === '@') {
        // Insert image tag
        const tagSpan = document.createElement('span');
        tagSpan.className = 'editor-img-tag';
        tagSpan.contentEditable = 'false'; // atomic
        tagSpan.dataset.assetId = item.id;
        tagSpan.innerHTML = `<img src="${item.data}" alt="${item.name}"><span class="tag-name">${item.name}</span>`;
        selectionRange.insertNode(tagSpan);
        
        // Add a space after
        const space = document.createTextNode(' ');
        selectionRange.setStartAfter(tagSpan);
        selectionRange.insertNode(space);
        selectionRange.setStartAfter(space);
      }
      
      selectionRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(selectionRange);
      
      // Trigger input event to sync with hidden textarea
      if (currentEditor) {
        currentEditor.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    
    closeSuggestMenu();
  }
  
  // Render suggestions in menu
  function renderSuggestions() {
    suggestMenu.innerHTML = '';
    if (suggestionItems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'suggest-empty';
      empty.textContent = '無符合結果';
      suggestMenu.appendChild(empty);
      return;
    }
    
    suggestionItems.forEach((item, idx) => {
      const el = document.createElement('div');
      el.className = 'suggest-item' + (idx === selectedIndex ? ' active' : '');
      
      if (currentMode === '/') {
        // Prompt Item
        el.innerHTML = `
          <div class="s-thumb">${item.thumb ? `<img src="${item.thumb}">` : '📝'}</div>
          <div class="s-info">
            <div class="s-title">${item.title}</div>
            <div class="s-cat">${item.category}</div>
          </div>
        `;
      } else {
        // Asset Item
        el.innerHTML = `
          <div class="s-thumb"><img src="${item.data}"></div>
          <div class="s-info">
            <div class="s-title">${item.name}</div>
          </div>
        `;
      }
      
      el.addEventListener('mousedown', (e) => {
        e.preventDefault(); // keep focus
        selectSuggestion(idx);
      });
      el.addEventListener('mouseover', () => {
        const prev = suggestMenu.querySelector('.suggest-item.active');
        if (prev) prev.classList.remove('active');
        el.classList.add('active');
        selectedIndex = idx;
      });
      suggestMenu.appendChild(el);
    });
  }
  
  // Fetch suggestions
  async function updateSuggestions() {
    if (currentMode === '/') {
      const raw = localStorage.getItem('ps_prompts');
      let allPrompts = [];
      try { allPrompts = raw ? JSON.parse(raw) : []; } catch (e) {}
      const q = query.toLowerCase();
      suggestionItems = allPrompts.filter(p => p.title.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || p.content.toLowerCase().includes(q));
    } else if (currentMode === '@') {
      if (window.AssetsService) {
        const allAssets = await window.AssetsService.getAllAssets();
        const q = query.toLowerCase();
        suggestionItems = allAssets.filter(a => a.name.toLowerCase().includes(q));
      }
    }
    selectedIndex = suggestionItems.length > 0 ? 0 : -1;
    renderSuggestions();
  }
  
  // Handle keydown in editor
  function onEditorKeyDown(e) {
    if (currentMode) {
      if (e.key === 'Escape') {
        closeSuggestMenu();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % suggestionItems.length;
        renderSuggestions();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + suggestionItems.length) % suggestionItems.length;
        renderSuggestions();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        selectSuggestion(selectedIndex);
        return;
      }
    }
  }
  
  // Handle input in editor — autosuggest only.
  // (div→textarea 同步與 autoResize 由 RichTextService.wireSync 處理)
  async function onEditorInput(e) {
    const editor = e.target;
    currentEditor = editor;
    const textarea = editor.previousElementSibling;

    // Autosuggest logic
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const textNode = range.startContainer;
    
    if (textNode.nodeType === Node.TEXT_NODE) {
      const text = textNode.textContent.substring(0, range.startOffset);
      
      const lastSlash = text.lastIndexOf('/');
      const lastAt = text.lastIndexOf('@');
      const lastTrigger = Math.max(lastSlash, lastAt);
      
      // Ensure trigger is valid (not part of a word, zero-width space is allowed)
      if (lastTrigger !== -1 && (lastTrigger === 0 || /[\s\u200B]/.test(text[lastTrigger - 1]))) {
        const word = text.substring(lastTrigger);
        // Only trigger if no space after the trigger symbol
        if (!/\s/.test(word)) {
          const newMode = text[lastTrigger];
          query = word.substring(1);
          selectionRange = range.cloneRange();

          // Anchor the menu only when the trigger is first detected
          if (currentMode !== newMode) {
            currentMode = newMode;
            const rect = range.getBoundingClientRect();
            suggestMenu.style.left = rect.left + 'px';
            suggestMenu.style.top = (rect.bottom + 5) + 'px';
            suggestMenu.classList.remove('hidden');
          }

          await updateSuggestions();
          return;
        }
      }
      
      // Color picker logic for #
      if (text.endsWith('#') && e.data === '#') {
         if (window.openGlobalPickr) {
           const tempRange = document.createRange();
           tempRange.setStart(textNode, range.startOffset - 1);
           tempRange.setEnd(textNode, range.startOffset);
           const rect = tempRange.getBoundingClientRect();
           
           // We don't need to store it anymore, pass it directly for live preview
           const targetEditorId = editor.id || (textarea ? textarea.id : '');
           window.openGlobalPickr(rect.left, rect.bottom, '#000000', targetEditorId, tempRange);
         }
      }
    }
    
    closeSuggestMenu();
  }
  
  // Setup editor — RichTextService 建立編輯器，這裡加掛 autosuggest 行為
  function setupRichPromptEditor(textareaOrId) {
    const textarea = typeof textareaOrId === 'string' ? document.getElementById(textareaOrId) : textareaOrId;
    if (!textarea || textarea.tagName !== 'TEXTAREA' || !window.RichTextService) return;
    if (textarea.nextElementSibling && textarea.nextElementSibling.classList.contains('rich-editor')) return;

    const editor = window.RichTextService.init(textarea);
    if (!editor) return;
    editor.addEventListener('keydown', onEditorKeyDown);
    editor.addEventListener('input', onEditorInput);
    return editor;
  }

  // Setup an arbitrary contenteditable div with autosuggest and rich formatting
  function enhanceRichEditor(editorDiv) {
    if (!editorDiv || (!editorDiv.isContentEditable && editorDiv.getAttribute('contenteditable') !== 'true')) return;
    editorDiv.addEventListener('keydown', onEditorKeyDown);
    editorDiv.addEventListener('input', onEditorInput);
    if (window.RichTextService) {
      window.RichTextService.enhance(editorDiv);
    }
    return editorDiv;
  }

  // Set content programmatically
  function setContent(textareaOrId, content) {
    if (window.RichTextService) window.RichTextService.setContent(textareaOrId, content);
  }

  // Get raw content — 從 editor DOM 即時序列化，不會拿到未同步的舊值
  function getContent(textareaOrId) {
    return window.RichTextService ? window.RichTextService.getContent(textareaOrId) : '';
  }
  
  // Auto-upgrade all textareas
  function initAutoUpgrade() {
    // Upgrade existing
    document.querySelectorAll('textarea').forEach(setupRichPromptEditor);
    
    // Watch for new textareas
    const observer = new MutationObserver(mutations => {
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.tagName === 'TEXTAREA') {
            setupRichPromptEditor(node);
          } else if (node.querySelectorAll) {
            node.querySelectorAll('textarea').forEach(setupRichPromptEditor);
          }
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Start auto-upgrade
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAutoUpgrade);
  } else {
    initAutoUpgrade();
  }
  
  // Expose API
  return {
    setupRichPromptEditor,
    enhanceRichEditor,
    closeSuggestMenu,
    setContent,
    getContent
  };
})();
