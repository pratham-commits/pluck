/* ──────────────────────────────────────────────────────────
   Media Extractor — popup.js
   All extraction logic for DOCX, PPTX, and PDF files.
   Runs entirely client-side inside the Chrome extension popup.
   ────────────────────────────────────────────────────────── */

(() => {
  'use strict';

  // ── Configure pdf.js worker ──────────────────────────
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.js');
  }

  // ── DOM References ───────────────────────────────────
  const dropzone       = document.getElementById('dropzone');
  const fileInput      = document.getElementById('fileInput');
  const errorBox       = document.getElementById('errorBox');
  const errorText      = document.getElementById('errorText');
  const retryBtn       = document.getElementById('retryBtn');
  const statusBar      = document.getElementById('statusBar');
  const statusFilename = document.getElementById('statusFilename');
  const statusBadge    = document.getElementById('statusBadge');
  const statusCount    = document.getElementById('statusCount');
  const progressBar    = document.getElementById('progressBar');
  const progressText   = document.getElementById('progressText');
  const noMedia        = document.getElementById('noMedia');
  const galleryWrap    = document.getElementById('galleryWrap');
  const gallery        = document.getElementById('gallery');
  const actionBar      = document.getElementById('actionBar');
  const selectToggle   = document.getElementById('selectToggle');
  const selectCount    = document.getElementById('selectCount');
  const btnDownloadSel = document.getElementById('btnDownloadSelected');
  const btnDownloadAll = document.getElementById('btnDownloadAll');

  // ── State ────────────────────────────────────────────
  let mediaItems   = [];   // { name, blob, url, type }
  let selectedSet  = new Set();
  let currentFormat = null; // 'docx' | 'pptx' | 'pdf'
  let originalFileName = '';

  // ── Format accent colors ─────────────────────────────
  const ACCENT = {
    docx: '#1D9E75',
    pptx: '#D85A30',
    pdf:  '#378ADD',
  };

  // ── Supported media MIME prefixes ────────────────────
  const MEDIA_MIME = ['image/', 'video/'];

  // ── Helpers ──────────────────────────────────────────
  function getExtension(filename) {
    return (filename.split('.').pop() || '').toLowerCase();
  }

  function isMediaFile(filename) {
    const ext = getExtension(filename);
    const mediaExts = [
      'png','jpg','jpeg','gif','webp','bmp','tiff','tif','svg','ico',
      'mp4','mov','avi','webm','mkv','wmv','flv','m4v',
      'emf','wmf'
    ];
    return mediaExts.includes(ext);
  }

  function isVideoFile(filename) {
    const ext = getExtension(filename);
    return ['mp4','mov','avi','webm','mkv','wmv','flv','m4v'].includes(ext);
  }

  function basename(filepath) {
    return filepath.split('/').pop();
  }

  function detectFormat(file) {
    const ext = getExtension(file.name);
    if (['docx','pptx','pdf'].includes(ext)) return ext;
    return null;
  }

  async function detectFormatByMagic(file) {
    const slice = file.slice(0, 4);
    const buf = await slice.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // PDF: %PDF → 0x25 0x50 0x44 0x46
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
    // ZIP (PK): 0x50 0x4B
    if (bytes[0] === 0x50 && bytes[1] === 0x4B) {
      // Try to determine DOCX vs PPTX by inspecting ZIP contents
      try {
        const ab = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(ab);
        const paths = Object.keys(zip.files);
        if (paths.some(p => p.startsWith('ppt/'))) return 'pptx';
        if (paths.some(p => p.startsWith('word/'))) return 'docx';
      } catch (_) { /* fall through */ }
      // Fallback to extension hint
      const ext = getExtension(file.name);
      if (ext === 'pptx') return 'pptx';
      return 'docx';
    }
    return null;
  }

  function setAccent(format) {
    const color = ACCENT[format] || ACCENT.pdf;
    document.documentElement.style.setProperty('--accent', color);
  }

  // ── UI Helpers ───────────────────────────────────────
  function resetUI() {
    errorBox.classList.remove('visible');
    dropzone.classList.remove('has-error');
    statusBar.classList.remove('visible');
    progressBar.classList.remove('visible');
    noMedia.classList.remove('visible');
    galleryWrap.classList.remove('visible');
    actionBar.classList.remove('visible');
    gallery.innerHTML = '';
    mediaItems.forEach(m => { if (m.url) URL.revokeObjectURL(m.url); });
    mediaItems = [];
    selectedSet.clear();
  }

  function showError(msg) {
    errorText.textContent = msg;
    errorBox.classList.add('visible');
    dropzone.classList.add('has-error');
  }

  function showStatus(filename, format, count) {
    statusFilename.textContent = filename;
    statusBadge.textContent = format.toUpperCase();
    statusBadge.className = 'status-badge ' + format;
    statusCount.textContent = count + ' item' + (count !== 1 ? 's' : '') + ' found';
    statusBar.classList.add('visible');
  }

  function showProgress(text) {
    progressText.textContent = text;
    progressBar.classList.add('visible');
  }

  function hideProgress() {
    progressBar.classList.remove('visible');
  }

  function updateSelectionUI() {
    const total = mediaItems.length;
    const selected = selectedSet.size;
    selectCount.textContent = `${selected} of ${total} selected`;
    btnDownloadSel.disabled = selected === 0;
    selectToggle.textContent = selected === total ? 'Deselect all' : 'Select all';

    // Update item classes
    gallery.querySelectorAll('.gallery-item').forEach((el, i) => {
      el.classList.toggle('selected', selectedSet.has(i));
    });
  }

  // ── Gallery Rendering ────────────────────────────────
  function renderGallery() {
    gallery.innerHTML = '';

    if (mediaItems.length === 0) {
      noMedia.classList.add('visible');
      return;
    }

    galleryWrap.classList.add('visible');
    actionBar.classList.add('visible');

    mediaItems.forEach((item, idx) => {
      const div = document.createElement('div');
      div.className = 'gallery-item';
      div.dataset.index = idx;

      // Thumbnail
      if (isVideoFile(item.name)) {
        div.innerHTML = `
          <div class="gallery-video-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          </div>
        `;
      } else {
        const img = document.createElement('img');
        img.className = 'gallery-thumb';
        img.src = item.url;
        img.alt = item.name;
        img.loading = 'lazy';
        div.appendChild(img);
      }

      // Filename label
      const nameEl = document.createElement('div');
      nameEl.className = 'gallery-name';
      nameEl.textContent = item.name;
      nameEl.title = item.name;
      div.appendChild(nameEl);

      // Checkbox
      div.insertAdjacentHTML('beforeend', `
        <div class="gallery-check">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
      `);

      // Toggle selection on click
      div.addEventListener('click', () => {
        if (selectedSet.has(idx)) {
          selectedSet.delete(idx);
        } else {
          selectedSet.add(idx);
        }
        updateSelectionUI();
      });

      gallery.appendChild(div);
    });

    // Default: select all
    mediaItems.forEach((_, i) => selectedSet.add(i));
    updateSelectionUI();
  }

  // ── DOCX / PPTX Extraction ──────────────────────────
  async function extractFromZip(arrayBuffer, mediaPrefix) {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const entries = [];

    zip.forEach((relativePath, zipEntry) => {
      if (!zipEntry.dir && relativePath.startsWith(mediaPrefix) && isMediaFile(relativePath)) {
        entries.push(zipEntry);
      }
    });

    if (entries.length === 0) return [];

    showProgress(`Extracting… 0 of ${entries.length}`);

    const results = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const name = basename(entry.name);
      const blob = await entry.async('blob');
      const url = URL.createObjectURL(blob);
      const ext = getExtension(name);
      let type = blob.type || 'application/octet-stream';
      // Ensure MIME is set for common types
      if (!blob.type || blob.type === 'application/octet-stream') {
        const mimeMap = {
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
          gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
          tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml',
          mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
          webm: 'video/webm', wmv: 'video/x-ms-wmv',
          emf: 'image/emf', wmf: 'image/wmf',
        };
        type = mimeMap[ext] || type;
      }
      results.push({ name, blob: new Blob([blob], { type }), url, type });
      showProgress(`Extracting… ${i + 1} of ${entries.length}`);
    }

    return results;
  }

  // ── PDF Extraction ───────────────────────────────────
  async function extractFromPDF(arrayBuffer) {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;

    if (numPages === 0) throw new Error('PDF has 0 pages.');

    const results = [];
    const scale = 2.0; // Retina quality

    for (let i = 1; i <= numPages; i++) {
      showProgress(`Extracting… page ${i} of ${numPages}`);

      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');

      await page.render({ canvasContext: ctx, viewport }).promise;

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(b => {
          if (b) resolve(b);
          else reject(new Error(`Failed to render page ${i}`));
        }, 'image/png');
      });

      const url = URL.createObjectURL(blob);
      const name = `page-${String(i).padStart(String(numPages).length, '0')}.png`;
      results.push({ name, blob, url, type: 'image/png' });
    }

    return results;
  }

  // ── Main Processing ──────────────────────────────────
  async function processFile(file) {
    resetUI();

    // Detect format
    let format = detectFormat(file);
    if (!format) {
      format = await detectFormatByMagic(file);
    }
    if (!format) {
      showError('Unsupported file type. Please use DOCX, PPTX, or PDF.');
      return;
    }

    currentFormat = format;
    originalFileName = file.name.replace(/\.[^.]+$/, '');
    setAccent(format);

    showProgress('Reading file…');

    try {
      const arrayBuffer = await file.arrayBuffer();
      let items = [];

      if (format === 'docx') {
        items = await extractFromZip(arrayBuffer, 'word/media/');
      } else if (format === 'pptx') {
        items = await extractFromZip(arrayBuffer, 'ppt/media/');
      } else if (format === 'pdf') {
        items = await extractFromPDF(arrayBuffer);
      }

      hideProgress();
      mediaItems = items;
      showStatus(file.name, format, items.length);
      renderGallery();

    } catch (err) {
      console.error('Extraction error:', err);
      hideProgress();
      showError('Failed to parse file: ' + (err.message || 'Unknown error'));
    }
  }

  // ── Download Helpers ─────────────────────────────────
  function downloadSingleFile(item) {
    const a = document.createElement('a');
    a.href = item.url;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function downloadAsZip(items, zipName) {
    const zip = new JSZip();
    items.forEach(item => {
      zip.file(item.name, item.blob);
    });
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, zipName);
  }

  // ── Event Listeners ──────────────────────────────────

  // Click to browse
  dropzone.addEventListener('click', (e) => {
    if (e.target === retryBtn || e.target.closest('.retry-btn')) return;
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      processFile(fileInput.files[0]);
    }
    // Reset so the same file can be re-selected
    fileInput.value = '';
  });

  // Drag-and-drop
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add('drag-over');
  });

  dropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('drag-over');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processFile(files[0]); // Only process the first file
    }
  });

  // Retry button
  retryBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    resetUI();
    fileInput.click();
  });

  // Select all / Deselect all
  selectToggle.addEventListener('click', () => {
    if (selectedSet.size === mediaItems.length) {
      selectedSet.clear();
    } else {
      mediaItems.forEach((_, i) => selectedSet.add(i));
    }
    updateSelectionUI();
  });

  // Download selected
  btnDownloadSel.addEventListener('click', async () => {
    const selected = mediaItems.filter((_, i) => selectedSet.has(i));
    if (selected.length === 0) return;

    if (selected.length === 1) {
      downloadSingleFile(selected[0]);
    } else {
      btnDownloadSel.disabled = true;
      btnDownloadSel.textContent = 'Packaging…';
      try {
        await downloadAsZip(selected, `${originalFileName}-media.zip`);
      } finally {
        btnDownloadSel.disabled = false;
        btnDownloadSel.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download selected
        `;
        updateSelectionUI();
      }
    }
  });

  // Download all as ZIP
  btnDownloadAll.addEventListener('click', async () => {
    if (mediaItems.length === 0) return;

    btnDownloadAll.disabled = true;
    btnDownloadAll.textContent = 'Packaging…';
    try {
      await downloadAsZip(mediaItems, `${originalFileName}-media.zip`);
    } finally {
      btnDownloadAll.disabled = false;
      btnDownloadAll.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Download all ZIP
      `;
    }
  });

})();
