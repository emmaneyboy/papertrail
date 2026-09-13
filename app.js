const SAMPLE_MARKDOWN = `# Field notes for a slower web

A small document can still have a long life. This is a sample workspace for turning Markdown into a clear, comfortable PDF without losing the shape of the writing.

## The useful middle

Good documents make room for both **structure** and *texture*. Use headings to create a map, lists to create rhythm, and a quote when a sentence deserves to breathe.

> The best page is the one that gets out of the way.

### A compact checklist

- [x] Write in plain Markdown
- [x] See the rendered document as you work
- [ ] Export a PDF for sharing

## A little code

\`\`\`js
function makeDocument(title, sections) {
  return { title, sections, ready: true };
}
\`\`\`

| Format | Best for | Status |
| --- | --- | --- |
| Markdown | Writing and versioning | Ready |
| PDF | Sharing and printing | Ready |

---

Keep going. The page will follow.`;

const input = document.querySelector('#markdownInput');
const preview = document.querySelector('#preview');
const pdfDocument = document.querySelector('#pdfDocument');
const fileInput = document.querySelector('#fileInput');
const dropZone = document.querySelector('#dropZone');
const exportButton = document.querySelector('#exportButton');
const clearButton = document.querySelector('#clearButton');
const downloadButton = document.querySelector('#downloadButton');
const pageNumbersInput = document.querySelector('#pageNumbersInput');
const headingColorInputs = {
  h1: document.querySelector('#headingH1Color'),
  h2: document.querySelector('#headingH2Color'),
  h3: document.querySelector('#headingH3Color')
};
const toast = document.querySelector('#toast');
const documentName = document.querySelector('#documentName');
const sourceStats = document.querySelector('#sourceStats');
const pageEstimate = document.querySelector('#pageEstimate');
let toastTimer;
const headingColorStorageKey = 'papertrail-heading-colors';

marked.setOptions({ gfm: true, breaks: true });

function renderMarkdown() {
  const rawHtml = marked.parse(input.value);
  const safeHtml = DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
  preview.innerHTML = safeHtml;
  pdfDocument.innerHTML = safeHtml;
  preview.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
  pdfDocument.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
  updateStats();
}

function updateStats() {
  const text = input.value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  sourceStats.textContent = `${words.toLocaleString()} words · ${input.value.length.toLocaleString()} characters`;
  const estimatedPages = Math.max(1, Math.ceil(pdfDocument.scrollHeight / 1033));
  pageEstimate.textContent = `${estimatedPages} page${estimatedPages === 1 ? '' : 's'} estimated`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3400);
}

function setBusy(isBusy) {
  exportButton.disabled = isBusy;
  exportButton.innerHTML = isBusy ? '<span aria-hidden="true">…</span> Preparing PDF' : '<span aria-hidden="true">↓</span> Export PDF';
}

function applyHeadingColors(article) {
  article.querySelectorAll('h1, h2, h3').forEach((heading) => {
    const level = heading.tagName.toLowerCase();
    heading.style.color = headingColorInputs[level].value;
  });
}

function restoreHeadingColors() {
  try {
    const savedColors = JSON.parse(localStorage.getItem(headingColorStorageKey) || '{}');
    Object.entries(headingColorInputs).forEach(([level, control]) => {
      if (/^#[0-9a-f]{6}$/i.test(savedColors[level] || '')) control.value = savedColors[level];
    });
  } catch (error) {
    console.warn('Could not restore heading colors', error);
  }
}

function saveHeadingColors() {
  const colors = Object.fromEntries(Object.entries(headingColorInputs).map(([level, control]) => [level, control.value]));
  localStorage.setItem(headingColorStorageKey, JSON.stringify(colors));
}

function findSafePageCut(canvas, desiredCut, lastCut, pageHeight) {
  const searchRadius = Math.min(140, Math.floor(pageHeight * 0.14));
  const start = Math.max(lastCut + 40, desiredCut - searchRadius);
  const end = Math.min(canvas.height - 1, desiredCut + searchRadius);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const pixels = context.getImageData(0, start, canvas.width, end - start + 1).data;
  const blankRows = [];

  for (let row = 0; row <= end - start; row += 1) {
    let inkPixels = 0;
    for (let x = 0; x < canvas.width; x += 4) {
      const pixel = (row * canvas.width + x) * 4;
      const red = pixels[pixel];
      const green = pixels[pixel + 1];
      const blue = pixels[pixel + 2];
      if (red < 245 || green < 245 || blue < 242) inkPixels += 1;
    }
    if (inkPixels <= canvas.width * 0.002) blankRows.push(start + row);
  }

  const safeRows = blankRows.filter((row, index) => {
    return blankRows[index + 1] === row + 1 && blankRows[index + 2] === row + 2;
  });
  if (!safeRows.length) return Math.min(desiredCut, canvas.height);
  return safeRows.reduce((closest, row) => {
    return Math.abs(row - desiredCut) < Math.abs(closest - desiredCut) ? row : closest;
  }, safeRows[0]);
}

function trimCanvasToContent(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let lastInkRow = 0;
  for (let row = canvas.height - 1; row >= 0; row -= 1) {
    let hasInk = false;
    for (let x = 0; x < canvas.width; x += 4) {
      const pixel = (row * canvas.width + x) * 4;
      if (pixels[pixel] < 245 || pixels[pixel + 1] < 245 || pixels[pixel + 2] < 242) {
        hasInk = true;
        break;
      }
    }
    if (hasInk) {
      lastInkRow = row;
      break;
    }
  }
  const bottomPadding = 24;
  const contentHeight = Math.max(1, Math.min(canvas.height, lastInkRow + bottomPadding));
  if (contentHeight === canvas.height) return canvas;
  const trimmed = document.createElement('canvas');
  trimmed.width = canvas.width;
  trimmed.height = contentHeight;
  trimmed.getContext('2d').drawImage(canvas, 0, 0, canvas.width, contentHeight, 0, 0, canvas.width, contentHeight);
  return trimmed;
}

async function exportPdf() {
  if (!input.value.trim()) {
    showToast('Add some Markdown before exporting.');
    input.focus();
    return;
  }
  setBusy(true);
  pageEstimate.textContent = 'Preparing PDF…';
  try {
    if (document.fonts?.ready) await document.fonts.ready;
    renderMarkdown();
    const overflowingBlocks = [...pdfDocument.children].filter((element) => element.scrollHeight > 1015);
    if (overflowingBlocks.length) {
      showToast('Long content will flow across pages to keep every line visible.');
    }
    if (!window.html2canvas || !window.jspdf) {
      throw new Error('PDF libraries are still loading');
    }
    const filename = `${(documentName.textContent || 'untitled').replace(/\.md$/i, '') || 'untitled'}.pdf`;
    const stage = document.createElement('div');
    stage.className = 'pdf-export-stage';
    const article = document.createElement('article');
    article.className = 'markdown-body pdf-export-document';
    article.innerHTML = pdfDocument.innerHTML;
    applyHeadingColors(article);
    stage.appendChild(article);
    document.body.appendChild(stage);
    article.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));

    const capturedCanvas = await html2canvas(stage, {
      scale: 2,
      backgroundColor: '#fffefb',
      useCORS: true,
      logging: false,
      windowWidth: stage.scrollWidth
    });
    const canvas = trimCanvasToContent(capturedCanvas);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 34;
    const printableWidth = pageWidth - margin * 2;
    const printableHeight = pageHeight - margin * 2;
    const pixelsPerPage = Math.floor((printableHeight * canvas.width) / printableWidth);
    const pageCuts = [];
    let lastCut = 0;
    while (lastCut < canvas.height) {
      const desiredCut = Math.min(lastCut + pixelsPerPage, canvas.height);
      const nextCut = desiredCut === canvas.height
        ? canvas.height
        : findSafePageCut(canvas, desiredCut, lastCut, pixelsPerPage);
      pageCuts.push([lastCut, nextCut]);
      lastCut = nextCut;
    }
    const totalPages = pageCuts.length;

    for (let page = 0; page < totalPages; page += 1) {
      const [sourceStart, sourceEnd] = pageCuts[page];
      const sliceHeight = sourceEnd - sourceStart;
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = sliceHeight;
      const context = slice.getContext('2d');
      context.fillStyle = '#fffefb';
      context.fillRect(0, 0, slice.width, slice.height);
      context.drawImage(canvas, 0, sourceStart, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
      const imageHeight = (sliceHeight * printableWidth) / canvas.width;
      if (page > 0) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/jpeg', 0.96), 'JPEG', margin, margin, printableWidth, imageHeight);
      if (pageNumbersInput.checked) {
        pdf.setFontSize(8);
        pdf.setTextColor(150);
        pdf.text(`${page + 1} / ${totalPages}`, pageWidth / 2, pageHeight - 14, { align: 'center' });
      }
    }
    pdf.save(filename);
    stage.remove();
    pageEstimate.textContent = 'PDF downloaded';
    showToast('Your PDF is ready.');
  } catch (error) {
    console.error(error);
    pageEstimate.textContent = 'Export failed';
    showToast('PDF export failed. Check your CDN connection and try again.');
  } finally {
    setBusy(false);
  }
}

function loadFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    input.value = String(reader.result || '');
    documentName.textContent = file.name || 'untitled.md';
    renderMarkdown();
    showToast(`${file.name} loaded.`);
  };
  reader.onerror = () => showToast('That file could not be read.');
  reader.readAsText(file);
}

function downloadMarkdown() {
  const blob = new Blob([input.value], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = documentName.textContent || 'untitled.md';
  link.click();
  URL.revokeObjectURL(url);
  showToast('Markdown downloaded.');
}

input.addEventListener('input', renderMarkdown);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Tab') {
    event.preventDefault();
    const start = input.selectionStart;
    input.value = `${input.value.slice(0, start)}  ${input.value.slice(input.selectionEnd)}`;
    input.selectionStart = input.selectionEnd = start + 2;
    renderMarkdown();
  }
});
fileInput.addEventListener('change', (event) => loadFile(event.target.files[0]));
['dragenter', 'dragover'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragging');
}));
dropZone.addEventListener('drop', (event) => loadFile(event.dataTransfer.files[0]));
clearButton.addEventListener('click', () => {
  input.value = '';
  documentName.textContent = 'untitled.md';
  renderMarkdown();
  input.focus();
});
downloadButton.addEventListener('click', downloadMarkdown);
exportButton.addEventListener('click', exportPdf);
Object.values(headingColorInputs).forEach((control) => control.addEventListener('input', saveHeadingColors));

input.value = SAMPLE_MARKDOWN;
restoreHeadingColors();
renderMarkdown();
