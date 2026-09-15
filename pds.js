// 1. POLYFILL FIRST
global.DOMMatrix = class DOMMatrix {
  constructor(a=1,b=0,c=0,d=1,e=0,f=0) { Object.assign(this,{a,b,c,d,e,f}) }
  multiply() { return this }
  flipX() { return this }
  flipY() { return this }
  translate() { return this }
  scale() { return this }
  rotate() { return this }
  inverse() { return this }
};
global.DOMMatrixReadOnly = global.DOMMatrix;
global.Path2D = class Path2D {};

// 2. Normal imports
import express from 'express';
import fs from 'fs';
import { exec } from 'child_process';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.static('public'));
app.use(express.json());
const upload = multer({ dest: 'uploads/' });

let pdfPages = [];
let currentPage = 0;
let isSpeaking = false;
let lastPdfPath = '';
let pdfjsLib;

// 3. Load pdfjs AFTER polyfill
async function initPdfjs() {
  pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  console.log('pdfjs loaded');
}
await initPdfjs();

// 4. cmaps path
const CMAP_URL = path.join(__dirname, 'node_modules/pdfjs-dist/cmaps/');
const FONT_URL = path.join(__dirname, 'node_modules/pdfjs-dist/standard_fonts/');

async function loadPDF(filePath) {
  pdfPages = [];
  lastPdfPath = filePath;
  const data = new Uint8Array(fs.readFileSync(filePath));
  const pdf = await pdfjsLib.getDocument({
    data,
    disableWorker: true,
    cMapUrl: CMAP_URL,        // <-- pass here, not on pdfjsLib
    cMapPacked: true,
    standardFontDataUrl: FONT_URL
  }).promise;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pdfPages.push(content.items.map(item => item.str).join(" "));
  }
  currentPage = 0;
  console.log(`Loaded ${pdfPages.length} pages`);
}

app.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    await loadPDF(req.file.path);
    fs.unlinkSync(req.file.path);
    res.json({ pages: pdfPages.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/page/:num', (req, res) => {
  const num = parseInt(req.params.num);
  if (pdfPages.length === 0) return res.status(400).json({ error: 'No PDF loaded' });
  if (num >= 0 && num < pdfPages.length) {
    currentPage = num;
    res.json({ text: pdfPages[num], page: num + 1, total: pdfPages.length });
  } else {
    res.status(404).json({ error: 'Page not found' });
  }
});

app.post('/speak', (req, res) => {
  const { speed = 1.0, pitch = 1.0, lang = 'en-US', text = '' } = req.body;
  if (isSpeaking) exec('pkill termux-tts-speak');
  isSpeaking = true;
  const cleanText = text.replace(/"/g, "'").slice(0, 400);
  exec(`termux-tts-speak -r ${speed} -p ${pitch} -l ${lang} "${cleanText}"`, () => { isSpeaking = false; });
  res.json({ status: 'speaking' });
});

app.post('/stop', (req, res) => {
  exec('pkill termux-tts-speak');
  isSpeaking = false;
  res.json({ status: 'stopped' });
});

app.listen(8080, '0.0.0.0', () => console.log('Reader at http://localhost:8080'));
