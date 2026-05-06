# pluck

> Extract images, GIFs, and videos from DOCX, PPTX, and PDF files directly in your browser. 100% client-side — no uploads, no server, complete privacy.

---

## Features

- **DOCX** — Extracts all media from `word/media/` at original quality
- **PPTX** — Extracts all media from `ppt/media/` at original quality
- **PDF** — Renders each page as a high-resolution PNG (2× retina scale)
- **Gallery preview** — Thumbnail grid with select/deselect
- **Batch download** — Download selected files individually or all at once as a ZIP
- **Drag & drop** — Drop a file or click to browse
- **Privacy first** — Everything runs locally in the browser

---

## Supported Media Types

| Category | Formats |
|----------|---------|
| Images   | PNG, JPG/JPEG, GIF, WEBP, BMP, TIFF, SVG, ICO, EMF, WMF |
| Videos   | MP4, MOV, AVI, WEBM, MKV, WMV, FLV, M4V |

---

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right)
4. Click **Load unpacked**
5. Select the `extension/` folder
6. The Media Extractor icon will appear in your toolbar

---

## How to Use

1. Click the Media Extractor icon in the Chrome toolbar
2. Drag a `.docx`, `.pptx`, or `.pdf` file onto the drop zone (or click to browse)
3. Wait for extraction to complete
4. Browse the gallery — click thumbnails to select/deselect
5. Click **Download selected** or **Download all ZIP**

---
## Project Structure

```
extension/
├── manifest.json          Manifest V3 config
├── popup.html             Extension popup UI
├── popup.js               All extraction + UI logic
├── libs/
│   ├── jszip.min.js
│   ├── pdf.min.js
│   ├── pdf.worker.min.js
│   └── FileSaver.min.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---
## License

MIT
