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

  // ── PDF Extraction (true image XObject extraction) ───
  async function extractFromPDF(arrayBuffer) {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;

    if (numPages === 0) throw new Error('PDF has 0 pages.');

    const results = [];
    const seenImages = new Set();
    let imageIndex = 0;

    const OPS = pdfjsLib.OPS;

    for (let i = 1; i <= numPages; i++) {
      showProgress(`Scanning page ${i} of ${numPages}…`);

      const page = await pdf.getPage(i);

      // Render at scale 1 to force pdf.js to decode all image XObjects
      // and populate page.objs with decoded pixel data
      const viewport = page.getViewport({ scale: 1 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      // Walk the operator list to find image painting operations
      const ops = await page.getOperatorList();

      for (let j = 0; j < ops.fnArray.length; j++) {
        const fn = ops.fnArray[j];

        if (fn !== OPS.paintImageXObject &&
            fn !== OPS.paintImageXObjectRepeat) {
          continue;
        }

        const imgName = ops.argsArray[j][0];
        if (seenImages.has(imgName)) continue;
        seenImages.add(imgName);

        try {
          const imgData = page.objs.get(imgName);
          if (!imgData) continue;

          const imgCanvas = document.createElement('canvas');
          const imgCtx = imgCanvas.getContext('2d');
          let w = 0, h = 0;

          // Determine the drawable source from the various formats pdf.js may return
          const bitmap = imgData instanceof ImageBitmap ? imgData
                       : (imgData.bitmap instanceof ImageBitmap ? imgData.bitmap : null);

          if (bitmap) {
            // ImageBitmap (direct or wrapped in { width, height, bitmap })
            w = bitmap.width;
            h = bitmap.height;
            imgCanvas.width = w;
            imgCanvas.height = h;
            imgCtx.drawImage(bitmap, 0, 0);

          } else if (imgData.data && imgData.width && imgData.height) {
            // Raw pixel data with .kind indicator
            w = imgData.width;
            h = imgData.height;
            imgCanvas.width = w;
            imgCanvas.height = h;

            let imageData;
            const kind = imgData.kind; // 1=GRAY_1BPP, 2=RGB_24BPP, 3=RGBA_32BPP

            if (kind === 1) {
              // 1-bit grayscale — expand to RGBA
              const rgba = new Uint8ClampedArray(w * h * 4);
              const src = imgData.data;
              let di = 0;
              for (let bi = 0; bi < src.length && di < rgba.length; bi++) {
                const byte = src[bi];
                for (let bit = 7; bit >= 0 && di < rgba.length; bit--) {
                  const val = ((byte >> bit) & 1) ? 0 : 255;
                  rgba[di++] = val;
                  rgba[di++] = val;
                  rgba[di++] = val;
                  rgba[di++] = 255;
                }
              }
              imageData = new ImageData(rgba, w, h);

            } else if (kind === 2) {
              // RGB 24-bit — expand to RGBA
              const rgba = new Uint8ClampedArray(w * h * 4);
              const src = imgData.data;
              for (let s = 0, d = 0; s < src.length; s += 3, d += 4) {
                rgba[d]     = src[s];
                rgba[d + 1] = src[s + 1];
                rgba[d + 2] = src[s + 2];
                rgba[d + 3] = 255;
              }
              imageData = new ImageData(rgba, w, h);

            } else if (kind === 3) {
              // RGBA 32-bit — use directly
              imageData = new ImageData(
                new Uint8ClampedArray(imgData.data.buffer,
                  imgData.data.byteOffset, imgData.data.byteLength),
                w, h
              );
            } else {
              // Unknown kind — try treating data as RGBA
              try {
                imageData = new ImageData(
                  new Uint8ClampedArray(imgData.data.buffer,
                    imgData.data.byteOffset, imgData.data.byteLength),
                  w, h
                );
              } catch (_) {
                continue;
              }
            }

            if (imageData) {
              imgCtx.putImageData(imageData, 0, 0);
            } else {
              continue;
            }

          } else {
            // Unknown format — skip
            console.info(`Skipping image "${imgName}" — unrecognized format:`, typeof imgData, Object.keys(imgData || {}));
            continue;
          }

          // Skip tiny images (icons, decorative dots, masks, etc.)
          if (w < 10 || h < 10) continue;

          const blob = await new Promise(resolve => {
            imgCanvas.toBlob(b => resolve(b), 'image/png');
          });

          if (blob && blob.size > 100) {
            imageIndex++;
            const url = URL.createObjectURL(blob);
            results.push({
              name: `image-${imageIndex}.png`,
              blob, url, type: 'image/png'
            });
            showProgress(`Found ${results.length} image${results.length !== 1 ? 's' : ''}… (page ${i} of ${numPages})`);
          }
        } catch (e) {
          console.warn(`Could not extract image "${imgName}" from page ${i}:`, e);
        }
      }

      page.cleanup();
    }

    // Fallback: if no embedded images found, render pages as images
    if (results.length === 0) {
      const scale = 2.0;
      for (let i = 1; i <= numPages; i++) {
        showProgress(`No embedded images found. Rendering page ${i} of ${numPages}…`);
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;

        const blob = await new Promise(resolve => {
          canvas.toBlob(b => resolve(b), 'image/png');
        });

        if (blob) {
          const url = URL.createObjectURL(blob);
          const name = `page-${String(i).padStart(String(numPages).length, '0')}.png`;
          results.push({ name, blob, url, type: 'image/png' });
        }
      }
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

    const imageExts = ['png','jpg','jpeg','gif','webp','bmp','tiff','tif','svg','ico','emf','wmf'];
    const videoExts = ['mp4','mov','avi','webm','mkv','wmv','flv','m4v'];

    items.forEach(item => {
      const ext = getExtension(item.name);
      let folder;
      if (imageExts.includes(ext)) {
        folder = 'images';
      } else if (videoExts.includes(ext)) {
        folder = 'videos';
      } else {
        folder = 'other';
      }
      zip.file(`${folder}/${item.name}`, item.blob);
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
