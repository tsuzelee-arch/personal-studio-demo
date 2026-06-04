/**
 * editor.js — Rich Text Prompt Editor & Autosuggest (/, @)
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
      const allPrompts = raw ? JSON.parse(raw) : [];
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
  
  // Handle input in editor
  async function onEditorInput(e) {
    const editor = e.target;
    currentEditor = editor;
    
    // Sync to hidden textarea
    const textarea = editor.previousElementSibling;
    if (textarea && textarea.tagName === 'TEXTAREA') {
      // Create a simplified text representation
      let rawText = '';
      editor.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          rawText += node.textContent;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.classList.contains('editor-img-tag')) {
            const assetId = node.dataset.assetId;
            const assetName = node.querySelector('.tag-name').textContent;
            rawText += `[@${assetName}:${assetId}]`;
          } else if (node.classList.contains('editor-color-tag')) {
            rawText += node.innerText;
          } else {
            rawText += node.innerText;
          }
        }
      });
      textarea.value = rawText;
      // Dispatch change event for other listeners
      textarea.dispatchEvent(new Event('input'));
    }
    
    // AutoResize behavior
    editor.style.height = 'auto';
    editor.style.height = editor.scrollHeight + 'px';
    
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
      
      // Ensure trigger is valid (not part of a word)
      if (lastTrigger !== -1 && (lastTrigger === 0 || /\s/.test(text[lastTrigger - 1]))) {
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
    }
    
    closeSuggestMenu();
  }
  
  // Setup editor
  function setupRichPromptEditor(textareaId) {
    const textarea = document.getElementById(textareaId);
    if (!textarea) return;
    if (textarea.nextElementSibling && textarea.nextElementSibling.classList.contains('rich-editor')) return;
    
    const editor = document.createElement('div');
    editor.className = 'rich-editor ' + textarea.className;
    editor.contentEditable = true;
    
    // Copy initial value
    editor.textContent = textarea.value;
    
    editor.addEventListener('keydown', onEditorKeyDown);
    editor.addEventListener('input', onEditorInput);
    
    // Hide textarea and insert editor
    textarea.style.display = 'none';
    textarea.parentNode.insertBefore(editor, textarea.nextSibling);
    
    // Initial resize
    editor.style.height = 'auto';
    editor.style.height = editor.scrollHeight + 'px';
    
    return editor;
  }
  
  // Set content programmatically
  function setContent(textareaId, content) {
    const textarea = document.getElementById(textareaId);
    if (textarea) {
      textarea.value = content;
      const editor = textarea.nextElementSibling;
      if (editor && editor.classList.contains('rich-editor')) {
        let html = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
        
        // Render hex color tags
        html = html.replace(/(#[0-9A-Fa-f]{6})\b/gi, '<span class="editor-color-tag" style="color: $1; font-weight: bold; background: rgba(0,0,0,0.05); padding: 0 2px; border-radius: 3px;">$1</span>');
        
        // Render asset tags (if any were embedded previously)
        html = html.replace(/\[@([^:]+):([^\]]+)\]/g, '<span class="editor-img-tag" contenteditable="false" data-asset-id="$2"><img src="assets/$2.jpg" alt="$1"><span class="tag-name">$1</span></span>');
        
        editor.innerHTML = html;
        editor.style.height = 'auto';
        editor.style.height = editor.scrollHeight + 'px';
      }
    }
  }

  // Get raw content
  function getContent(textareaId) {
    const textarea = document.getElementById(textareaId);
    if (textarea) return textarea.value;
    return '';
  }
  
  // Expose API
  return {
    setupRichPromptEditor,
    closeSuggestMenu,
    setContent,
    getContent
  };
})();
