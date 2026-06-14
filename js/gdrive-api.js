/**
 * gdrive-api.js — Google Drive integration via Google Identity Services (GIS)
 *
 * 使用方式：
 *  1. 在 Google Cloud Console 建立 OAuth 2.0 Web 應用程式憑證
 *  2. 將 Client ID 填入設定頁面並儲存
 *  3. 此模組在頁面載入時自動以儲存的 Client ID 初始化
 *
 * 依賴：
 *  - <script src="https://accounts.google.com/gsi/client" async defer></script>  (index.html 已引入)
 *  - window.StudioSettings.getGdriveClientId()
 *
 * 資料流：
 *  signIn()       → Google OAuth popup → 取得 access_token
 *  listFiles()    → Drive API v3 GET /files（只列圖片）
 *  uploadFile()   → Drive API v3 multipart upload（base64 data URL）
 *  downloadFile() → Drive API v3 GET /files/:id?alt=media → dataURL
 */
window.GDriveService = (function() {

  const SCOPES    = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly';
  const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/avif'];

  let tokenClient   = null;
  let accessToken   = null;
  let tokenExpiry   = 0;      // epoch ms when token expires
  let clientId      = '';
  let _signInResolve = null;

  // ── Init / Reinit ────────────────────────────────────────────────────────────
  function init(id) {
    if (!id) return;
    clientId = id;
    if (typeof google === 'undefined' || !google.accounts) return; // GIS not yet loaded
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (resp) => {
        if (resp.error) {
          console.error('GDrive OAuth error', resp);
          if (_signInResolve) { _signInResolve(Promise.reject(new Error(resp.error))); _signInResolve = null; }
          return;
        }
        accessToken = resp.access_token;
        tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
        if (_signInResolve) { _signInResolve(); _signInResolve = null; }
        if (window.showToast) window.showToast('✅ Google Drive 登入成功');
      }
    });
  }

  // Called from settings.js when the user saves a new Client ID
  function reinit(id) {
    accessToken = null;
    tokenExpiry = 0;
    init(id);
  }

  function isSignedIn() {
    return !!accessToken && Date.now() < tokenExpiry;
  }

  // ── Sign in / out ────────────────────────────────────────────────────────────
  function signIn() {
    return new Promise((resolve, reject) => {
      if (!tokenClient) {
        reject(new Error('GDrive Client ID 尚未設定。請至設定頁面填入 Client ID 後重試。'));
        return;
      }
      if (isSignedIn()) { resolve(); return; }
      _signInResolve = resolve;
      tokenClient.requestAccessToken({ prompt: 'consent' });
    });
  }

  function signOut() {
    if (accessToken) {
      google.accounts.oauth2.revoke(accessToken, () => {});
    }
    accessToken = null;
    tokenExpiry = 0;
    if (window.showToast) window.showToast('已登出 Google Drive');
  }

  // ── API helper ───────────────────────────────────────────────────────────────
  async function driveRequest(url, options = {}) {
    if (!isSignedIn()) await signIn();
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        ...(options.headers || {})
      }
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.status);
      throw new Error('Drive API ' + res.status + ': ' + errText);
    }
    return res;
  }

  // ── List image files in Drive root (or a folder) ─────────────────────────────
  async function listFiles(folderId) {
    const mimeQ   = IMAGE_MIME.map(m => `mimeType='${m}'`).join(' or ');
    const parentQ = folderId ? `'${folderId}' in parents and ` : '';
    const q       = encodeURIComponent(parentQ + `(${mimeQ}) and trashed=false`);
    const fields  = encodeURIComponent('files(id,name,mimeType,thumbnailLink,webContentLink)');
    const res     = await driveRequest(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=100`
    );
    const data = await res.json();
    return data.files || [];
  }

  // ── Upload a base64 data URL to Drive ────────────────────────────────────────
  async function uploadFile(name, base64DataUrl) {
    if (!isSignedIn()) await signIn();
    // Decode base64 to Blob
    const [header, b64] = base64DataUrl.split(',');
    const mimeMatch = header.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const blob  = new Blob([bytes], { type: mime });

    const metadata = JSON.stringify({ name, mimeType: mime });
    const boundary = '-------314159265358979323846';
    const body = [
      '--' + boundary,
      'Content-Type: application/json; charset=UTF-8',
      '',
      metadata,
      '--' + boundary,
      'Content-Type: ' + mime,
      '',
      ''
    ].join('\r\n');

    const bodyEnd = '\r\n--' + boundary + '--';

    const fullBody = new Blob([body, blob, bodyEnd]);
    const res = await driveRequest(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: fullBody }
    );
    return res.json();
  }

  // ── Download a Drive file as a data URL ──────────────────────────────────────
  async function downloadFile(fileId) {
    const res  = await driveRequest(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    const blob = await res.blob();
    return window.StudioUtils.fileToDataURL(blob);
  }

  // ── Auto-init when GIS script fires its load event ──────────────────────────
  // GIS loads asynchronously; we must wait for it before calling initTokenClient.
  function tryInit() {
    const id = window.StudioSettings ? window.StudioSettings.getGdriveClientId() : (localStorage.getItem('ps_gdrive_client_id') || '');
    if (id) init(id);
  }

  if (typeof google !== 'undefined' && google.accounts) {
    tryInit();
  } else {
    // GIS script has "async defer" — try after a short poll
    let attempts = 0;
    const poll = setInterval(() => {
      attempts++;
      if ((typeof google !== 'undefined' && google.accounts) || attempts > 30) {
        clearInterval(poll);
        if (typeof google !== 'undefined' && google.accounts) tryInit();
      }
    }, 200);
  }

  return { init, reinit, isSignedIn, signIn, signOut, listFiles, uploadFile, downloadFile };
})();
