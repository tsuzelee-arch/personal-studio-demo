/**
 * Asset Manager V2 — File System Access API (Local Direct Read)
 * 純前端本機目錄直讀：零上傳、路徑記憶、即時互動
 */
window.AssetManager = (function() {
  const DB_NAME    = 'PersonalStudioFSA_v1';
  const STORE_NAME = 'handles';
  const DB_VERSION = 1;

  let db = null;
  let workspaceHandle = null;
  let activeFolder = '根目錄';
  let treeState = { expanded: new Set(['根目錄']) };
  let activeBlobUrls = []; // Object URLs created for node/workflow resolution (getFileBlobUrl)
  const gridBlobUrls = {}; // containerId -> [url]; revoked per-grid so grids/nodes don't clobber each other
  let assetObserver = null; // Lazy-loads card images only when they scroll into view

  // Virtual Tree structure: { name, path, isDir, handle, children: {} }
  let virtualTree = { name: '根目錄', path: '根目錄', isDir: true, handle: null, children: {} };
  let allImageFiles = []; // Flat list of file references for the grid

  // 1. Database Initialization
  function initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = (e) => {
        db = e.target.result;
        resolve();
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  function getSavedHandle() {
    return new Promise((resolve) => {
      if (!db) return resolve(null);
      const tx = db.transaction([STORE_NAME], 'readonly');
      const req = tx.objectStore(STORE_NAME).get('workspace_handle');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }

  function saveHandle(handle) {
    return new Promise((resolve, reject) => {
      if (!db) return reject('DB not init');
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(handle, 'workspace_handle');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // Helper to show/hide all restore buttons
  function updateRestoreButtons(display) {
    const ids = ['v2-btn-restore', 'swfAssetRestore', 'ipAssetRestore'];
    ids.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.style.display = display;
    });
  }

  let autoLinkGestureActive = false;
  function triggerAutoLinkGesture(hasHandle) {
    const isAutoLink = localStorage.getItem('ps_auto_link') === 'true';
    if (!isAutoLink) return;
    if (autoLinkGestureActive) return;

    autoLinkGestureActive = true;
    console.log('[AssetManager] Auto-link setup. Has handle:', hasHandle);

    const gestureHandler = async (e) => {
      // Ignore click on interactive buttons that have their own link/restore/clear click handlers, or the checkbox itself
      if (
        e.target.closest('#v2-btn-clear-link') || 
        e.target.closest('#v2-auto-link-check') ||
        e.target.closest('#v2-btn-link-folder') ||
        e.target.closest('#v2-btn-restore') ||
        e.target.closest('#swfAssetLink') ||
        e.target.closest('#swfAssetRestore') ||
        e.target.closest('#ipAssetLink') ||
        e.target.closest('#ipAssetRestore')
      ) {
        return;
      }

      document.body.removeEventListener('click', gestureHandler, true);
      autoLinkGestureActive = false;

      // Re-read storage state in case it was toggled off before click
      const isAutoLinkNow = localStorage.getItem('ps_auto_link') === 'true';
      if (!isAutoLinkNow) return;

      setTimeout(async () => {
        if (hasHandle) {
          console.log('[AssetManager] Auto-link gesture triggering restore permission');
          await requestRestorePermission();
        } else {
          console.log('[AssetManager] Auto-link gesture triggering workspace link');
          await linkWorkspace();
        }
      }, 100);
    };

    document.body.addEventListener('click', gestureHandler, true);
  }

  // 2. File System Access API
  async function linkWorkspace() {
    try {
      workspaceHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await saveHandle(workspaceHandle);
      updateRestoreButtons('none');
      
      if (window.showToast) window.showToast('✅ 成功連結本機資料夾！');
      await refreshUI();
    } catch (e) {
      console.warn('使用者取消或不支援:', e);
    }
  }

  async function restoreWorkspace() {
    try {
      const handle = await getSavedHandle();
      if (!handle) {
        triggerAutoLinkGesture(false);
        return false;
      }
      workspaceHandle = handle;
      
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        await refreshUI();
        return true;
      } else {
        // Needs user gesture to request permission.
        updateRestoreButtons('inline-block');
        triggerAutoLinkGesture(true);
        return false;
      }
    } catch (e) {
      console.error('Restore error', e);
      triggerAutoLinkGesture(false);
      return false;
    }
  }

  async function requestRestorePermission() {
    if (!workspaceHandle) return;
    try {
      const perm = await workspaceHandle.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        updateRestoreButtons('none');
        if (window.showToast) window.showToast('✅ 成功恢復連線！');
        await refreshUI();
        window.dispatchEvent(new Event('assets-restored'));
      }
    } catch(e) {
      console.warn('Permission rejected', e);
    }
  }

  function clearLink() {
    if (confirm('確定解除本機資料夾的連結嗎？')) {
      if (db) {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        tx.objectStore(STORE_NAME).delete('workspace_handle');
      }
      workspaceHandle = null;
      virtualTree = { name: '根目錄', path: '根目錄', isDir: true, handle: null, children: {} };
      allImageFiles = [];
      activeFolder = '根目錄';
      treeState.expanded.clear();
      treeState.expanded.add('根目錄');
      updateRestoreButtons('none');
      refreshUI();
    }
  }

  // 3. Deep Tree Scanning
  async function scanDirectory(dirHandle, currentPath = '根目錄', parentNode) {
    for await (const entry of dirHandle.values()) {
      if (entry.name.startsWith('.')) continue; // ignore hidden
      
      const path = currentPath === '根目錄' ? `根目錄/${entry.name}` : `${currentPath}/${entry.name}`;
      
      if (entry.kind === 'directory') {
        const node = { name: entry.name, path: path, isDir: true, handle: entry, children: {} };
        parentNode.children[entry.name] = node;
        await scanDirectory(entry, path, node);
      } else if (entry.kind === 'file') {
        if (entry.name.match(/\.(png|jpe?g|webp|gif|bmp)$/i)) {
          const node = { name: entry.name, path: path, isDir: false, handle: entry };
          parentNode.children[entry.name] = node;
          allImageFiles.push({
            name: entry.name,
            path: path,
            folder: currentPath,
            handle: entry
          });
        }
      }
    }
  }

  let permissionGranted = false;
  
  async function buildTree() {
    if (!workspaceHandle) {
      virtualTree = { name: '根目錄', path: '根目錄', isDir: true, handle: null, children: {} };
      allImageFiles = [];
      permissionGranted = false;
      return;
    }
    
    // Check permission first
    const perm = await workspaceHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      virtualTree = { name: '根目錄 (等待授權)', path: '根目錄', isDir: true, handle: null, children: {} };
      allImageFiles = [];
      permissionGranted = false;
      return;
    }
    
    permissionGranted = true;
    const newRoot = { name: '根目錄', path: '根目錄', isDir: true, handle: workspaceHandle, children: {} };
    allImageFiles = [];
    
    // Status
    const statusText = document.getElementById('v2-status-text');
    if (statusText) statusText.textContent = '掃描中...';
    
    try {
      await scanDirectory(workspaceHandle, '根目錄', newRoot);
      virtualTree = newRoot;
      if (statusText) statusText.textContent = '(就緒)';
    } catch (e) {
      console.error('Scan Error', e);
      if (statusText) statusText.textContent = '(掃描失敗)';
      virtualTree = { name: '根目錄 (掃描失敗)', path: '根目錄', isDir: true, handle: null, children: {} };
    }
    
    // Dispatch event so simple-workflow.js can update dropdowns
    window.dispatchEvent(new CustomEvent('assets-tree-updated'));
  }

  function getAllFolderPaths(node = virtualTree, paths = []) {
    if (!node || !node.isDir) return paths;
    paths.push(node.path);
    if (node.children) {
      for (const key in node.children) {
        getAllFolderPaths(node.children[key], paths);
      }
    }
    return paths;
  }

  // 4. UI Rendering
  let isRefreshing = false;
  
  async function smartRefresh() {
    if (isRefreshing || !workspaceHandle || !permissionGranted) return;
    isRefreshing = true;
    try {
      const oldHash = allImageFiles.map(f => f.path + '_' + (f.file ? f.file.lastModified : 0)).join('|');
      await buildTree();
      const newHash = allImageFiles.map(f => f.path + '_' + (f.file ? f.file.lastModified : 0)).join('|');
      
      // Only re-render if the file list actually changed
      if (oldHash !== newHash) {
        renderSidebar(virtualTree, 'v2-tree-root');
        await renderGrid('v2-grid');
        if (document.getElementById('swfLeftAssets') && document.getElementById('swfLeftAssets').style.display !== 'none') {
          renderSidebar(virtualTree, 'v2-swf-tree-root');
          await renderGrid('v2-swf-grid');
        }
        if (document.getElementById('ipLeftAssets') && document.getElementById('ipLeftAssets').style.display !== 'none') {
          renderSidebar(virtualTree, 'v2-ip-tree-root');
          await renderGrid('v2-ip-grid');
        }
      }
    } finally {
      isRefreshing = false;
    }
  }

  async function refreshUI() {
    // Immediate loading state to prevent blank screens on first open
    const grid1 = document.getElementById('v2-grid');
    if (grid1) grid1.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--muted);">掃描中...</div>';
    
    const panel = document.getElementById('swfLeftAssets');
    if (panel && panel.style.display !== 'none') {
      const grid2 = document.getElementById('v2-swf-grid');
      if (grid2) grid2.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--muted);">掃描中...</div>';
      const tree2 = document.getElementById('v2-swf-tree-root');
      if (tree2) tree2.innerHTML = '<li style="padding:10px;color:var(--muted);text-align:center;">讀取中...</li>';
    }

    const ipPanel = document.getElementById('ipLeftAssets');
    if (ipPanel && ipPanel.style.display !== 'none') {
      const grid3 = document.getElementById('v2-ip-grid');
      if (grid3) grid3.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--muted);">掃描中...</div>';
      const tree3 = document.getElementById('v2-ip-tree-root');
      if (tree3) tree3.innerHTML = '<li style="padding:10px;color:var(--muted);text-align:center;">讀取中...</li>';
    }

    await buildTree();
    renderSidebar(virtualTree, 'v2-tree-root');
    await renderGrid('v2-grid');
    
    if (panel && panel.style.display !== 'none') {
      renderSidebar(virtualTree, 'v2-swf-tree-root');
      await renderGrid('v2-swf-grid');
    }

    if (ipPanel && ipPanel.style.display !== 'none') {
      renderSidebar(virtualTree, 'v2-ip-tree-root');
      await renderGrid('v2-ip-grid');
    }
  }

  function renderSidebar(tree, containerId) {
    const rootUl = document.getElementById(containerId);
    if (!rootUl) return;
    rootUl.innerHTML = '';
    if (!tree) return;
    
    function buildNodeHTML(node, containerEl) {
      // Only render directories in the sidebar
      if (!node.isDir) return;
      
      const sortedKeys = Object.keys(node.children)
        .filter(k => node.children[k].isDir)
        .sort((a,b) => a.localeCompare(b));
      const hasChildren = sortedKeys.length > 0;
      
      const li = document.createElement('li');
      li.className = 'v2-tree-node';
      if (treeState.expanded.has(node.path)) li.classList.add('expanded');
      
      const itemDiv = document.createElement('div');
      itemDiv.className = 'v2-tree-item' + (activeFolder === node.path ? ' active' : '');
      itemDiv.setAttribute('draggable', 'true');
      itemDiv.addEventListener('dragstart', (e) => {
        const payload = JSON.stringify({ type: 'fsa-folder', path: node.path, name: node.name });
        e.dataTransfer.setData('text/ide-asset-folder', payload);
        e.dataTransfer.setData('text/plain', `[@folder:${node.name}:${node.path}]`);
        e.dataTransfer.effectAllowed = 'copy';
      });
      
      const toggleSpan = document.createElement('span');
      toggleSpan.className = 'v2-tree-toggle';
      toggleSpan.textContent = hasChildren ? '▶' : '';
      
      const iconSpan = document.createElement('span');
      iconSpan.className = 'v2-tree-icon';
      iconSpan.textContent = node.path === '根目錄' ? '📂' : '📁';
      
      const nameSpan = document.createElement('span');
      nameSpan.textContent = node.name;
      
      itemDiv.appendChild(toggleSpan);
      itemDiv.appendChild(iconSpan);
      itemDiv.appendChild(nameSpan);
      li.appendChild(itemDiv);
      
      let childrenUl = null;
      if (hasChildren) {
        childrenUl = document.createElement('ul');
        childrenUl.className = 'v2-tree v2-tree-children';
        if (!treeState.expanded.has(node.path)) childrenUl.classList.add('collapsed');
        
        sortedKeys.forEach(k => {
          buildNodeHTML(node.children[k], childrenUl);
        });
        li.appendChild(childrenUl);
      }
      
      itemDiv.addEventListener('click', (e) => {
        e.stopPropagation();
        const clickX = e.clientX - itemDiv.getBoundingClientRect().left;
        if (hasChildren && clickX < 24) {
          if (childrenUl.classList.contains('collapsed')) {
            childrenUl.classList.remove('collapsed');
            li.classList.add('expanded');
            treeState.expanded.add(node.path);
          } else {
            childrenUl.classList.add('collapsed');
            li.classList.remove('expanded');
            treeState.expanded.delete(node.path);
          }
          return;
        }
        
        activeFolder = node.path;
        renderSidebar(virtualTree, containerId); // Fast update sidebar
        if (containerId === 'v2-swf-tree-root') {
            renderSidebar(virtualTree, 'v2-tree-root');
            renderSidebar(virtualTree, 'v2-ip-tree-root');
            renderGrid('v2-swf-grid');
            renderGrid('v2-grid');
            renderGrid('v2-ip-grid');
        } else if (containerId === 'v2-ip-tree-root') {
            renderSidebar(virtualTree, 'v2-tree-root');
            renderSidebar(virtualTree, 'v2-swf-tree-root');
            renderGrid('v2-ip-grid');
            renderGrid('v2-grid');
            renderGrid('v2-swf-grid');
        } else {
            renderSidebar(virtualTree, 'v2-swf-tree-root');
            renderSidebar(virtualTree, 'v2-ip-tree-root');
            renderGrid('v2-grid');
            renderGrid('v2-swf-grid');
            renderGrid('v2-ip-grid');
        }
      });
      
      containerEl.appendChild(li);
    }
    
    treeState.expanded.add('根目錄');
    buildNodeHTML(tree, rootUl);
  }

  function getAssetObserver() {
    if (!assetObserver) {
      assetObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            assetObserver.unobserve(entry.target);
            loadCardImage(entry.target);
          }
        });
      }, { rootMargin: '400px' }); // preload slightly before visible so drags always have a blob
    }
    return assetObserver;
  }

  // Create the object URL for a single card on demand (idempotent). Tracked per
  // grid so re-rendering a grid only revokes its own URLs.
  async function loadCardImage(card) {
    if (card._blobUrl || !card._assetHandle) return card._blobUrl;
    try {
      const file = await card._assetHandle.getFile();
      const url = URL.createObjectURL(file);
      card._blobUrl = url;
      (gridBlobUrls[card._containerId] = gridBlobUrls[card._containerId] || []).push(url);
      if (card.isConnected) {
        const img = card.querySelector('img');
        if (img) img.src = url;
      }
    } catch (err) {
      console.error('Cannot read file', card._assetName, err);
    }
    return card._blobUrl;
  }

  async function renderGrid(containerId) {
    const grid = document.getElementById(containerId);
    if (!grid) return;

    // Memory Management: revoke only THIS grid's previously-created URLs so we
    // never clobber the other grid's or a node's still-displayed images.
    (gridBlobUrls[containerId] || []).forEach(url => URL.revokeObjectURL(url));
    gridBlobUrls[containerId] = [];

    grid.innerHTML = '';
    
    if (!workspaceHandle) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--muted);">尚未連結本機資料夾</div>';
      return;
    }
    
    if (!permissionGranted) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--muted);">權限已過期<br><br><span style="font-size:12px">請至左側導覽列「資產庫」點擊「恢復連線」</span></div>';
      return;
    }
    
    const assets = allImageFiles.filter(a => a.folder === activeFolder);
    
    if (assets.length === 0) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--muted);">此資料夾沒有影像</div>';
      return;
    }
    
    const observer = getAssetObserver();
    for (let i = 0; i < assets.length; i++) {
      const a = assets[i];
      const card = document.createElement('div');
      card.className = 'v2-asset-card';
      // Stash the FSA handle/meta; the object URL is created lazily on intersect.
      card._assetHandle = a.handle;
      card._assetName = a.name;
      card._containerId = containerId;

      const isIpGrid = containerId === 'v2-ip-grid';
      card.innerHTML = `
        <div class="v2-asset-img-wrap">
          <img alt="${a.name}" loading="lazy">
          <div class="v2-asset-actions">
            ${isIpGrid ? `<button class="v2-btn-icon" title="新增至畫布" data-action="add-to-workspace" data-path="${a.path}" data-name="${a.name}">➕</button>` : ''}
            <button class="v2-btn-icon" title="複製標籤" data-action="copy" data-path="${a.path}" data-name="${a.name}">📋</button>
            <button class="v2-btn-icon danger" title="刪除檔案" data-action="delete" data-path="${a.path}" data-name="${a.name}">🗑️</button>
          </div>
        </div>
        <div class="v2-asset-info">
          <span class="v2-asset-name" title="${a.name}">${a.name}</span>
        </div>
      `;

      card.draggable = true;
      card.addEventListener('dragstart', (e) => {
        // We pass the RELATIVE PATH instead of base64 data!
        const payload = JSON.stringify({ type: 'fsa', path: a.path, name: a.name });
        e.dataTransfer.setData('text/swf-asset', payload);
        e.dataTransfer.setData('text/ide-asset', payload);
        // Visible cards are already loaded (observer preloads); include the blob if ready.
        if (card._blobUrl) e.dataTransfer.setData('text/swf-image-src', card._blobUrl);
        e.dataTransfer.setData('text/plain', `[@${a.name}:${a.path}]`);
        e.dataTransfer.effectAllowed = 'copy';
      });

      card.addEventListener('click', async (e) => {
        if (e.target.closest('.v2-asset-actions')) return;
        const url = await loadCardImage(card);
        if (url) openLightBox(url, a.path);
      });

      card.addEventListener('dblclick', async (e) => {
        if (containerId === 'v2-ip-grid') {
          e.stopPropagation();
          if (window.ImageProcess && window.ImageProcess.addFsaAsset) {
            window.ImageProcess.addFsaAsset(a.path, a.name);
            if (window.showToast) window.showToast(`已新增 ${a.name} 到預覽畫布`);
          }
        }
      });

      grid.appendChild(card);
      observer.observe(card);
    }
    
    // Bind actions
    grid.querySelectorAll('.v2-btn-icon').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (btn.dataset.action === 'add-to-workspace') {
          const path = btn.dataset.path;
          const name = btn.dataset.name;
          if (window.ImageProcess && window.ImageProcess.addFsaAsset) {
            window.ImageProcess.addFsaAsset(path, name);
            if (window.showToast) window.showToast(`已新增 ${name} 到預覽畫布`);
          }
        } else if (btn.dataset.action === 'copy') {
          const path = btn.dataset.path;
          navigator.clipboard.writeText(`[@${btn.dataset.name}:${path}]`).then(() => {
            if (window.showToast) window.showToast('✅ 相對路徑標籤已複製');
          });
        } else if (btn.dataset.action === 'delete') {
          const name = btn.dataset.name;
          if (confirm(`確定刪除「${name}」？此動作會從本機資料夾永久刪除該檔案，無法復原。`)) {
            await deleteAsset(btn.dataset.path);
          }
        }
      });
    });
  }

  // 5. Dynamic File Retrieval (For workflow rendering)
  async function getFileBlobUrl(path) {
    if (!workspaceHandle) return null;
    
    // Path looks like "根目錄/Folder/Image.png"
    const parts = path.split('/');
    if (parts[0] === '根目錄') parts.shift();
    
    let currentHandle = workspaceHandle;
    try {
      for (let i = 0; i < parts.length - 1; i++) {
        currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
      }
      const fileHandle = await currentHandle.getFileHandle(parts[parts.length - 1]);
      const file = await fileHandle.getFile();
      const url = URL.createObjectURL(file);
      activeBlobUrls.push(url); // track for memory management later if needed
      return url;
    } catch(e) {
      console.error('getFileBlobUrl failed for path:', path, e);
      return null;
    }
  }

  // 6. Bind UI Elements
  function bindUI() {
    const linkBtn = document.getElementById('v2-btn-link-folder');
    const restoreBtn = document.getElementById('v2-btn-restore');
    const clearLinkBtn = document.getElementById('v2-btn-clear-link');
    
    if (linkBtn) linkBtn.addEventListener('click', linkWorkspace);
    if (restoreBtn) restoreBtn.addEventListener('click', requestRestorePermission);
    if (clearLinkBtn) clearLinkBtn.addEventListener('click', clearLink);
    
    // SWF specific buttons
    const swfRefreshBtn = document.getElementById('swfAssetRefresh');
    const swfLinkBtn = document.getElementById('swfAssetLink');
    const swfRestoreBtn = document.getElementById('swfAssetRestore');
    
    if (swfRefreshBtn) swfRefreshBtn.addEventListener('click', refreshUI);
    if (swfLinkBtn) swfLinkBtn.addEventListener('click', linkWorkspace);
    if (swfRestoreBtn) swfRestoreBtn.addEventListener('click', requestRestorePermission);
    
    // IP specific buttons
    const ipRefreshBtn = document.getElementById('ipAssetRefresh');
    const ipLinkBtn = document.getElementById('ipAssetLink');
    const ipRestoreBtn = document.getElementById('ipAssetRestore');
    
    if (ipRefreshBtn) ipRefreshBtn.addEventListener('click', refreshUI);
    if (ipLinkBtn) ipLinkBtn.addEventListener('click', linkWorkspace);
    if (ipRestoreBtn) ipRestoreBtn.addEventListener('click', requestRestorePermission);
    
    // Auto-Link Checkbox
    const autoLinkCheck = document.getElementById('v2-auto-link-check');
    if (autoLinkCheck) {
      const autoLink = localStorage.getItem('ps_auto_link') === 'true';
      autoLinkCheck.checked = autoLink;
      autoLinkCheck.addEventListener('change', (e) => {
        const checked = e.target.checked;
        localStorage.setItem('ps_auto_link', checked ? 'true' : 'false');
        if (checked && (!workspaceHandle || !permissionGranted)) {
          triggerAutoLinkGesture(!!workspaceHandle);
        }
      });
    }

    // Auto-Refresh on Window Focus
    window.addEventListener('focus', () => {
      if (workspaceHandle && permissionGranted) {
        smartRefresh();
      }
    });
  }

  // 7. Lightbox Preview
  function openLightBox(src, titleText = '') {
    let lb = document.getElementById('v2-lightbox');
    if (!lb) {
      lb = document.createElement('div');
      lb.id = 'v2-lightbox';
      lb.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.85); z-index:9999; display:flex; justify-content:center; align-items:center; flex-direction:column; opacity:0; transition:opacity 0.3s;';
      
      const img = document.createElement('img');
      img.id = 'v2-lb-img';
      img.style.cssText = 'max-width:90%; max-height:85%; object-fit:contain; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.5); transform:scale(0.95); transition:transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);';
      
      const title = document.createElement('div');
      title.id = 'v2-lb-title';
      title.style.cssText = 'color:#fff; margin-top:16px; font-size:16px; font-weight:500;';
      
      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = '✕';
      closeBtn.style.cssText = 'position:absolute; top:20px; right:30px; background:transparent; border:none; color:#fff; font-size:32px; cursor:pointer; opacity:0.7; transition:opacity 0.2s;';
      closeBtn.onmouseover = () => closeBtn.style.opacity = '1';
      closeBtn.onmouseout = () => closeBtn.style.opacity = '0.7';
      
      lb.appendChild(img);
      lb.appendChild(title);
      lb.appendChild(closeBtn);
      document.body.appendChild(lb);
      
      const closeLb = () => {
        lb.style.opacity = '0';
        img.style.transform = 'scale(0.95)';
        setTimeout(() => lb.style.display = 'none', 300);
      };
      
      closeBtn.onclick = closeLb;
      lb.onclick = (e) => { if (e.target === lb) closeLb(); };
    }
    
    lb.style.display = 'flex';
    document.getElementById('v2-lb-img').src = src;
    document.getElementById('v2-lb-title').textContent = titleText;
    
    // trigger reflow
    void lb.offsetWidth;
    lb.style.opacity = '1';
    document.getElementById('v2-lb-img').style.transform = 'scale(1)';
  }

  // Initialize
  window.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('panel-assets-v2')) {
      bindUI();
      initDB().then(restoreWorkspace).catch(e => console.error('AssetDB Error:', e));
    }
  });

  // 5. Saving Assets
  // Find a .png filename that doesn't already exist in the folder by appending
  // _1, _2, … to the base name. Used when overwrite is disabled so re-runs don't
  // clobber an earlier image that shares the same (slot-based) name.
  async function resolveUniqueName(folderHandle, baseName) {
    let candidate = baseName, i = 1;
    while (i < 10000) {
      try {
        await folderHandle.getFileHandle(candidate + '.png'); // resolves → exists
        candidate = `${baseName}_${i++}`;
      } catch {
        return candidate; // NotFoundError → available
      }
    }
    return `${baseName}_${Date.now()}`;
  }

  async function saveAsset(name, src, targetFolderPath, overwrite = true) {
    if (!workspaceHandle || !permissionGranted) {
      if (window.showToast) window.showToast('❌ 無法儲存：未連結本機目錄或未授權', 2000);
      return;
    }
    try {
      let folderHandle = workspaceHandle;
      if (targetFolderPath && targetFolderPath !== '根目錄' && targetFolderPath !== '') {
        const parts = targetFolderPath.split('/');
        if (parts[0] === '根目錄') parts.shift();

        for (const part of parts) {
          if (!part.trim()) continue;
          folderHandle = await folderHandle.getDirectoryHandle(part, { create: true });
        }
      }

      let blob;
      if (src.startsWith('data:')) {
        const res = await fetch(src);
        blob = await res.blob();
      } else {
        const res = await fetch(src);
        blob = await res.blob();
      }

      const finalName = overwrite ? name : await resolveUniqueName(folderHandle, name);
      const fileHandle = await folderHandle.getFileHandle(finalName + '.png', { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      
      // Auto refresh UI silently to show new file
      smartRefresh();
    } catch (e) {
      console.error('Failed to save asset:', e);
      if (window.showToast) window.showToast('❌ 儲存失敗: ' + e.message, 3000);
    }
  }

  // Permanently delete an image from the linked workspace folder. The workspace
  // handle is opened with mode:'readwrite', so removeEntry is already permitted.
  async function deleteAsset(path) {
    if (!workspaceHandle || !permissionGranted) {
      if (window.showToast) window.showToast('❌ 無法刪除：未連結本機目錄或未授權', 2000);
      return false;
    }
    const parts = path.split('/');
    if (parts[0] === '根目錄') parts.shift();
    const fileName = parts[parts.length - 1];
    try {
      let dir = workspaceHandle;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i]);
      }
      await dir.removeEntry(fileName);
      await smartRefresh(); // rescan → file drops out of both grids + sidebar counts
      if (window.showToast) window.showToast('🗑️ 已刪除 ' + fileName, 2000);
      return true;
    } catch (e) {
      console.error('Failed to delete asset:', e);
      if (window.showToast) window.showToast('❌ 刪除失敗: ' + e.message, 3000);
      return false;
    }
  }

  // Read a UTF-8 text file from the workspace root. Returns null if not connected
  // or the file doesn't exist (so callers can migrate/seed). Throws on other errors.
  async function readWorkspaceTextFile(filename) {
    if (!workspaceHandle || !permissionGranted) return null;
    try {
      const fh = await workspaceHandle.getFileHandle(filename);
      const file = await fh.getFile();
      return await file.text();
    } catch (e) {
      if (e && e.name === 'NotFoundError') return null;
      throw e;
    }
  }

  // Write a UTF-8 text file to the workspace root (durable on-disk storage, unlike
  // localStorage). Used to persist settings such as automation-script presets.
  async function writeWorkspaceTextFile(filename, text) {
    if (!workspaceHandle || !permissionGranted) throw new Error('未連結本機目錄或未授權');
    const fh = await workspaceHandle.getFileHandle(filename, { create: true });
    const writable = await fh.createWritable();
    await writable.write(text);
    await writable.close();
  }

  // Public API
  return {
    initDB,
    openLightBox,
    getActiveFolder: () => activeFolder,
    refreshUI,
    isConnected: () => !!workspaceHandle && permissionGranted,
    readWorkspaceTextFile,
    writeWorkspaceTextFile,
    getFileBlobUrlByPath: getFileBlobUrl,
    getFileHandleByPath: (path) => {
      const fileObj = allImageFiles.find(f => f.path === path);
      return fileObj ? fileObj.handle : null;
    },
    getAllFolderPaths,
    saveAsset,
    deleteAsset,
    getImagesInFolder: (folderPath) => allImageFiles.filter(f => f.folder === folderPath),
    getImagesUnderFolder: (folderPath) => {
      if (folderPath === '根目錄') return allImageFiles;
      return allImageFiles.filter(f => f.path === folderPath || f.path.startsWith(folderPath + '/'));
    }
  };

})();
