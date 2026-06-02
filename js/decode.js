(function() {
  const dropZone       = document.getElementById('dropZone');
  const imageInput     = document.getElementById('imageInput');
  const uploadBtn      = document.getElementById('uploadBtn');
  const decodeResult   = document.getElementById('decodeResult');
  const previewImg     = document.getElementById('previewImg');
  const resetDecodeBtn = document.getElementById('resetDecodeBtn');

  // Current analysis data
  let currentFile = null;

  // ── Upload / Drag-drop handlers ──
  uploadBtn.addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', e => { if (e.target.files[0]) loadImage(e.target.files[0]); });

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadImage(file);
  });
  dropZone.addEventListener('click', e => { if (e.target !== uploadBtn) imageInput.click(); });

  resetDecodeBtn.addEventListener('click', resetDecode);

  function resetDecode() {
    decodeResult.classList.add('hidden');
    dropZone.classList.remove('hidden');
    imageInput.value = '';
    currentFile = null;
    window.StudioState.decodeResult = null;
  }

  // ── Image load → preview ──
  function loadImage(file) {
    currentFile = file;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      previewImg.src = url;
      dropZone.classList.add('hidden');
      decodeResult.classList.remove('hidden');
    };
    img.src = url;
  }

})();
