/**
 * assets.js — Asset Library (IndexedDB) and LightBox functionality
 */
window.AssetsService = (function() {
  const DB_NAME = 'PersonalStudioDB';
  const STORE_NAME = 'assets';
  const DB_VERSION = 2;
  const FOLDERS_KEY = 'ps_asset_folders';
  let db = null;
  let activeFolder = '已完成';
  let isManageMode = false;
  let selectedAssets = new Set();

  // ── Folder Management (localStorage) ──
  function getFolders() {
    const raw = localStorage.getItem(FOLDERS_KEY);
    const saved = raw ? JSON.parse(raw) : [];
    const base = ['根目錄', '已完成'];
    base.forEach(f => { if (!saved.includes(f)) saved.unshift(f); });
    return saved;
  }

  function addFolder(name) {
    const folders = getFolders();
    if (!folders.includes(name)) {
      folders.push(name);
      localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
      window.dispatchEvent(new CustomEvent('assets-updated'));
    }
    return folders;
  }

  // ── Init IndexedDB ──
  function initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('folder', 'folder', { unique: false });
        } else {
          // v1 → v2: add folder index if missing
          const store = e.target.transaction.objectStore(STORE_NAME);
          if (!store.indexNames.contains('folder')) {
            store.createIndex('folder', 'folder', { unique: false });
          }
        }
      };
      request.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };
      request.onerror = (e) => {
        console.error('IndexedDB Error:', e);
        reject(e);
      };
    });
  }

  // ── DB Operations ──
  async function saveAsset(name, dataUrl, folder = '根目錄') {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const asset = {
        id: 'asset_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        name,
        data: dataUrl,
        folder: folder || '根目錄',
        date: new Date().toISOString()
      };
      const request = store.add(asset);
      request.onsuccess = () => {
        window.dispatchEvent(new CustomEvent('assets-updated'));
        resolve(asset);
      };
      request.onerror = (e) => reject(e);
    });
  }

  async function getAllAssets() {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const results = (request.result || []).map(a => ({ folder: '根目錄', ...a }));
        results.sort((a, b) => new Date(b.date) - new Date(a.date));
        resolve(results);
      };
      request.onerror = (e) => reject(e);
    });
  }

  async function getAsset(id) {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e);
    });
  }

  async function deleteAsset(id) {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => {
        window.dispatchEvent(new CustomEvent('assets-updated'));
        resolve();
      };
      request.onerror = (e) => reject(e);
    });
  }

  // ── LightBox UI ──
  function openLightBox(dataUrl, title = 'Image', allowSave = true) {
    let lb = document.getElementById('lightbox-modal');
    if (!lb) {
      lb = document.createElement('div');
      lb.id = 'lightbox-modal';
      lb.className = 'modal-backdrop';
      lb.innerHTML = `
        <div class="lightbox-content">
          <button class="lightbox-close">&times;</button>
          <img class="lightbox-img" src="" alt="Enlarged Image">
          <div class="lightbox-actions">
             <button class="btn-primary lightbox-save-btn">📥 存入資產庫</button>
          </div>
        </div>
      `;
      document.body.appendChild(lb);
      lb.querySelector('.lightbox-close').addEventListener('click', () => lb.classList.add('hidden'));
      lb.addEventListener('click', (e) => { if (e.target === lb) lb.classList.add('hidden'); });
    }

    lb.querySelector('.lightbox-img').src = dataUrl;
    const saveBtn = lb.querySelector('.lightbox-save-btn');

    if (allowSave) {
      saveBtn.style.display = 'inline-block';
      const newSaveBtn = saveBtn.cloneNode(true);
      saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
      newSaveBtn.addEventListener('click', async () => {
        try {
          const name = prompt('請為資產命名：', title) || title;
          await saveAsset(name, dataUrl, activeFolder);
          if (window.showToast) window.showToast('✅ 已存入資產庫！');
          if (window.refreshAssetsGrid) window.refreshAssetsGrid();
          lb.classList.add('hidden');
        } catch (err) {
          console.error(err);
          if (window.showToast) window.showToast('❌ 儲存失敗');
        }
      });
    } else {
      saveBtn.style.display = 'none';
    }

    lb.classList.remove('hidden');
  }

  // ── Folder Sidebar Rendering ──
  function renderFolderSidebar() {
    const sidebar = document.getElementById('assetsFolderList');
    if (!sidebar) return;
    const folders = getFolders();
    sidebar.innerHTML = '';
    folders.forEach(name => {
      const btn = document.createElement('button');
      btn.className = 'folder-item' + (name === activeFolder ? ' active' : '');
      btn.textContent = name;
      btn.addEventListener('click', () => {
        activeFolder = name;
        renderFolderSidebar();
        window.refreshAssetsGrid();
      });
      sidebar.appendChild(btn);
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'folder-add-btn';
    addBtn.textContent = '+ 新增資料夾';
    addBtn.addEventListener('click', () => {
      const name = prompt('資料夾名稱：');
      if (name && name.trim()) {
        addFolder(name.trim());
        renderFolderSidebar();
      }
    });
    sidebar.appendChild(addBtn);
  }

  // ── Assets Panel Rendering ──
  window.refreshAssetsGrid = async function() {
    const grid = document.getElementById('assetsGrid');
    const empty = document.getElementById('assetsEmpty');
    if (!grid) return;

    try {
      const all = await getAllAssets();
      const assets = all.filter(a => a.folder === activeFolder);

      if (assets.length === 0) {
        grid.style.display = 'none';
        if (empty) empty.classList.remove('hidden');
        return;
      }

      grid.style.display = 'grid';
      if (empty) empty.classList.add('hidden');
      grid.innerHTML = '';

      assets.forEach(asset => {
        const isSelected = selectedAssets.has(asset.id);
        const card = document.createElement('div');
        card.className = 'asset-card prompt-card' + (isSelected ? ' selected' : '');
        card.innerHTML = `
          <div class="asset-img-container" style="height:150px;overflow:hidden;border-radius:6px;cursor:pointer;background:#eee;position:relative;">
            <img src="${asset.data}" alt="${asset.name}" style="width:100%;height:100%;object-fit:cover; opacity:${isSelected ? '0.7' : '1'}; transition: opacity 0.2s;">
            <div class="asset-checkbox ${isManageMode ? '' : 'hidden'}" style="position:absolute; top:8px; left:8px; background:rgba(255,255,255,0.9); border-radius:4px; padding:2px; display:flex;">
              <input type="checkbox" ${isSelected ? 'checked' : ''} style="pointer-events:none; margin:0;">
            </div>
          </div>
          <div style="margin-top:10px;font-weight:500;font-size:13px;color:var(--text);">${asset.name}</div>
          <div style="margin-top:5px;font-size:10px;color:var(--muted);">${asset.folder}</div>
          <div style="margin-top:5px;display:flex;justify-content:space-between;">
            <button class="btn-ghost btn-sm asset-copy-tag" data-id="${asset.id}" style="padding:4px 8px;font-size:11px;">複製 Tag</button>
            <button class="btn-ghost btn-sm asset-del-btn" data-id="${asset.id}" style="padding:4px 8px;font-size:11px;color:#dc3545;">刪除</button>
          </div>
        `;

        card.querySelector('.asset-img-container').addEventListener('click', (e) => {
          if (isManageMode) {
            e.stopPropagation();
            if (selectedAssets.has(asset.id)) {
              selectedAssets.delete(asset.id);
            } else {
              selectedAssets.add(asset.id);
            }
            window.refreshAssetsGrid();
          } else {
            openLightBox(asset.data, asset.name, false);
          }
        });
        card.querySelector('.asset-del-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm('確定要刪除這張資產嗎？')) {
            await deleteAsset(asset.id);
            if (window.showToast) window.showToast('🗑️ 已刪除');
            window.refreshAssetsGrid();
          }
        });
        card.querySelector('.asset-copy-tag').addEventListener('click', (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(`[@${asset.name}:${asset.id}]`).then(() => {
            if (window.showToast) window.showToast('✅ 標籤已複製');
          });
        });
        grid.appendChild(card);
      });
    } catch (e) {
      console.error(e);
    }
  };

  // ── Upload Handler ──
  function initUploadButton() {
    const uploadBtn = document.getElementById('assetUploadBtn');
    const uploadInput = document.getElementById('assetUploadInput');
    if (!uploadBtn || !uploadInput) return;
    uploadBtn.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const name = file.name.replace(/\.[^.]+$/, '') || 'Uploaded';
        try {
          await saveAsset(name, ev.target.result, activeFolder);
          if (window.showToast) window.showToast('✅ 已上傳至「' + activeFolder + '」');
          window.refreshAssetsGrid();
        } catch (err) {
          if (window.showToast) window.showToast('❌ 上傳失敗');
        }
      };
      reader.readAsDataURL(file);
      uploadInput.value = '';
    });
  }

  // ── Manage Mode ──
  function initManageButtons() {
    const manageBtn = document.getElementById('assetManageBtn');
    const delSelBtn = document.getElementById('assetDelSelectedBtn');
    const clearBtn = document.getElementById('assetClearFolderBtn');
    const authDirBtn = document.getElementById('assetAuthDirBtn');

    if (authDirBtn) {
      authDirBtn.addEventListener('click', async () => {
        try {
          if (!window.showDirectoryPicker) {
            alert('您的瀏覽器不支援本機資料夾存取功能 (File System Access API)。請使用最新版 Chrome 或 Edge。');
            return;
          }
          const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
          window.localDirHandle = dirHandle;
          authDirBtn.textContent = '✅ 已授權: ' + dirHandle.name;
          authDirBtn.style.background = '#1e7e34';
          authDirBtn.style.borderColor = '#1c7430';
          if (window.showToast) window.showToast('✅ 本機資產目錄授權成功！');
        } catch (err) {
          console.error(err);
          if (err.name !== 'AbortError') {
            if (window.showToast) window.showToast('❌ 授權失敗');
          }
        }
      });
    }

    if (manageBtn) {
      manageBtn.addEventListener('click', () => {
        isManageMode = !isManageMode;
        selectedAssets.clear();
        manageBtn.textContent = isManageMode ? '完成' : '管理';
        if (isManageMode) {
          manageBtn.classList.add('btn-primary');
          manageBtn.classList.remove('btn-ghost');
          if(delSelBtn) delSelBtn.classList.remove('hidden');
          if(clearBtn) clearBtn.classList.remove('hidden');
        } else {
          manageBtn.classList.add('btn-ghost');
          manageBtn.classList.remove('btn-primary');
          if(delSelBtn) delSelBtn.classList.add('hidden');
          if(clearBtn) clearBtn.classList.add('hidden');
        }
        window.refreshAssetsGrid();
      });
    }

    if (delSelBtn) {
      delSelBtn.addEventListener('click', async () => {
        if (selectedAssets.size === 0) return window.showToast ? window.showToast('請先選取要刪除的資產') : alert('請先選取');
        if (!confirm(`確定要刪除選取的 ${selectedAssets.size} 項資產嗎？`)) return;
        
        for (let id of selectedAssets) {
          await deleteAsset(id);
        }
        selectedAssets.clear();
        if (window.showToast) window.showToast('✅ 刪除完成');
        window.refreshAssetsGrid();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (!confirm(`確定要清空「${activeFolder}」資料夾中的所有資產嗎？\n此動作無法復原！`)) return;
        const all = await getAllAssets();
        const assets = all.filter(a => a.folder === activeFolder);
        for (let a of assets) {
          await deleteAsset(a.id);
        }
        selectedAssets.clear();
        if (window.showToast) window.showToast('✅ 資料夾已清空');
        window.refreshAssetsGrid();
      });
    }
  }

  // Init
  initDB().then(() => {
    if (document.getElementById('panel-assets')) {
      renderFolderSidebar();
      window.refreshAssetsGrid();
      initUploadButton();
      initManageButtons();
    }
  });

  // ── Native File System Helper ──
  async function saveAssetToLocalDir(base64Data, filename) {
    if (!window.localDirHandle) return false;
    try {
      // Use fetch() to decode Base64 data URL → Blob asynchronously (no main-thread blocking)
      const res = await fetch(base64Data);
      const blob = await res.blob();
      if (!blob || blob.size === 0) return false;
      
      const fileHandle = await window.localDirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      if (window.showToast) window.showToast(`✅ 已自動儲存至本機目錄: ${filename}`);
      return true;
    } catch (err) {
      console.error('Failed to save to local dir:', err);
      return false;
    }
  }

  return {
    initDB,
    saveAsset,
    getAllAssets,
    getAsset,
    deleteAsset,
    openLightBox,
    getFolders,
    addFolder,
    saveAssetToLocalDir,
    getActiveFolder: () => activeFolder
  };
})();
