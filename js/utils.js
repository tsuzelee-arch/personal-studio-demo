/**
 * utils.js — Shared pure utility helpers (no DOM / app-state dependencies).
 *
 * Loaded before every other project script so all modules can use
 * `window.StudioUtils`. Everything here is a pure function or a thin Promise
 * wrapper around a browser primitive — nothing closes over workflow / asset /
 * editor state. Grouped by category so related helpers stay together.
 */
window.StudioUtils = (function () {
  'use strict';

  // ── File / Encoding ────────────────────────────────────────────────────────

  // Read a File or Blob into a base64 data URL ("data:<mime>;base64,<data>").
  // Single source of truth for the FileReader → data URL dance that was
  // previously inlined across ai-service / ide-agent / workflow / simple-workflow.
  function fileToDataURL(blobOrFile) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = ev => resolve(ev.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(blobOrFile);
    });
  }

  // Resolve a transient blob: URL to a persistent data URL. Non-blob inputs are
  // returned unchanged; on failure the original src is returned (callers may
  // still have downstream guards). Prevents broken refs once object URLs revoke.
  function blobUrlToDataURL(src) {
    if (!src || !src.startsWith('blob:')) return Promise.resolve(src);
    return fetch(src)
      .then(r => r.blob())
      .then(fileToDataURL)
      .catch(() => src);
  }

  // Strip the "data:<mime>;base64," prefix, returning just the base64 payload.
  function dataUrlToBase64(dataUrl) {
    return typeof dataUrl === 'string' ? (dataUrl.split(',')[1] || '') : '';
  }

  return {
    fileToDataURL,
    blobUrlToDataURL,
    dataUrlToBase64,
  };
})();
