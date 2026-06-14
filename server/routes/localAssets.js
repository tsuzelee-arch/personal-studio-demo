'use strict';
const express = require('express');
const fs      = require('fs');
const path    = require('path');

const router     = express.Router();
const CONFIG_PATH = path.resolve(__dirname, '../../server-config.json');

const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);

// ── Config helpers ────────────────────────────────────────────────────────────
function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}
function writeConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
}
function getAllowedRoots() {
  return (readConfig().localAssetPaths || []).map(p => path.resolve(p));
}

// ── Path safety check ─────────────────────────────────────────────────────────
// Rejects relative paths, path traversal, and paths outside of the allowed roots.
function isSafePath(requestedPath, allowedRoots) {
  if (!requestedPath) return false;
  const abs = path.resolve(requestedPath);
  if (!path.isAbsolute(abs)) return false;
  // Must start with one of the configured root prefixes
  return allowedRoots.some(root => abs.startsWith(root + path.sep) || abs === root);
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/local-assets/config — return currently configured paths (no secrets)
router.get('/config', (_req, res) => {
  res.json({ localAssetPaths: readConfig().localAssetPaths || [] });
});

// POST /api/local-assets/config — save allowed paths (writes server-config.json)
router.post('/config', (req, res) => {
  const { paths } = req.body;
  if (!Array.isArray(paths)) return res.status(400).json({ error: 'paths must be an array' });
  // Validate each entry is an absolute path string
  for (const p of paths) {
    if (typeof p !== 'string' || !path.isAbsolute(p)) {
      return res.status(400).json({ error: `Invalid path: "${p}" — must be an absolute path` });
    }
  }
  const cfg = readConfig();
  cfg.localAssetPaths = paths;
  writeConfig(cfg);
  res.json({ ok: true, localAssetPaths: paths });
});

// GET /api/local-assets/list?path=... — list image files in a directory
router.get('/list', (req, res) => {
  const allowedRoots = getAllowedRoots();
  if (allowedRoots.length === 0) return res.status(403).json({ error: '尚未設定允許的本機目錄，請至設定頁面新增路徑。' });

  const reqPath = req.query.path;
  if (!isSafePath(reqPath, allowedRoots)) {
    return res.status(403).json({ error: '路徑不在允許清單內或包含非法字元。' });
  }

  const abs = path.resolve(reqPath);
  try {
    const entries = fs.readdirSync(abs, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile() && IMG_EXTS.has(path.extname(e.name).toLowerCase()))
      .map(e => ({
        name: e.name,
        path: path.join(abs, e.name),
        ext: path.extname(e.name).toLowerCase()
      }));
    const folders = entries
      .filter(e => e.isDirectory())
      .map(e => e.name);
    res.json({ path: abs, files, folders });
  } catch (err) {
    res.status(500).json({ error: '無法讀取目錄：' + err.message });
  }
});

// Helper for recursive scan
function scanDirectoryRecursive(dirPath, allowedRoots, baseFolderName = '') {
  let results = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const e of entries) {
      const fullPath = path.join(dirPath, e.name);
      if (e.isDirectory()) {
        // Skip hidden folders to save time
        if (e.name.startsWith('.')) continue;
        const subFolder = baseFolderName ? baseFolderName + '/' + e.name : e.name;
        results = results.concat(scanDirectoryRecursive(fullPath, allowedRoots, subFolder));
      } else if (e.isFile() && IMG_EXTS.has(path.extname(e.name).toLowerCase())) {
        results.push({
          name: e.name,
          path: fullPath,
          folder: baseFolderName || '根目錄',
          ext: path.extname(e.name).toLowerCase()
        });
      }
    }
  } catch (err) {
    console.warn('Cannot read directory:', dirPath, err.message);
  }
  return results;
}

// GET /api/local-assets/all — recursively list ALL images across all allowed roots
router.get('/all', (req, res) => {
  const allowedRoots = getAllowedRoots();
  if (allowedRoots.length === 0) return res.json({ files: [] });

  let allFiles = [];
  for (const root of allowedRoots) {
    const rootName = path.basename(root);
    allFiles = allFiles.concat(scanDirectoryRecursive(root, allowedRoots, rootName));
  }
  res.json({ files: allFiles });
});

// GET /api/local-assets/image?path=... — stream an image file
router.get('/image', (req, res) => {
  const allowedRoots = getAllowedRoots();
  if (allowedRoots.length === 0) return res.status(403).json({ error: '尚未設定允許的本機目錄。' });

  const reqPath = req.query.path;
  if (!isSafePath(reqPath, allowedRoots)) {
    return res.status(403).json({ error: '路徑不在允許清單內。' });
  }

  const abs = path.resolve(reqPath);
  const ext = path.extname(abs).toLowerCase();
  if (!IMG_EXTS.has(ext)) return res.status(403).json({ error: '不支援的檔案類型。' });

  const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                 '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif' };
  try {
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(abs).pipe(res);
  } catch (err) {
    res.status(500).json({ error: '無法讀取檔案：' + err.message });
  }
});

// POST /api/local-assets/save — write a generated image to a local directory
router.post('/save', (req, res) => {
  const allowedRoots = getAllowedRoots();
  const { dirPath, filename, base64 } = req.body;

  if (!isSafePath(dirPath, allowedRoots)) {
    return res.status(403).json({ error: '目錄不在允許清單內。' });
  }
  if (!filename || !/^[\w\-. ]+\.(jpg|jpeg|png|webp)$/i.test(filename)) {
    return res.status(400).json({ error: '非法的檔名。' });
  }

  const destPath = path.join(path.resolve(dirPath), filename);
  const matches = (base64 || '').match(/^data:image\/\w+;base64,(.+)$/);
  if (!matches) return res.status(400).json({ error: 'base64 格式不正確。' });

  try {
    fs.writeFileSync(destPath, Buffer.from(matches[1], 'base64'));
    res.json({ ok: true, path: destPath });
  } catch (err) {
    res.status(500).json({ error: '寫入失敗：' + err.message });
  }
});

module.exports = router;
