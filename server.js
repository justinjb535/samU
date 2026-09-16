import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import pdfParse from 'pdf-parse';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'; // for page text + count
// server.js WITH server-side rendering - Only for Render
import { createCanvas } from 'canvas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
//app.use('/api/auth', signupRouter);

let pdfText = "";  // full text for TTS
let pdfDoc = null; // pdfjs doc for paging

// 1. Upload: extract full text + load pdf for paging
app.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const filePath = path.join(__dirname, req.file.path);
    const dataBuffer = fs.readFileSync(filePath);

    // Get full text for TTS
    const data = await pdfParse(dataBuffer);
    pdfText = data.text;

    // Load pdfjs doc to get page count
    const dataPdf = new Uint8Array(dataBuffer);
    pdfDoc = await pdfjsLib.getDocument({ data: dataPdf }).promise;

    res.json({ 
      pages: pdfDoc.numPages,
      message: "PDF loaded" 
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process PDF" });
  }
});

// 2. Get text for specific page - 0 based from frontend
app.get('/page/:num', async (req, res) => {
  try {
    if (!pdfDoc) return res.status(400).json({ error: "Upload a PDF first" });
    
    const pageIndex = parseInt(req.params.num); // 0-based
    const pageNum = pageIndex + 1; // pdfjs is 1-based

    if (pageNum < 1 || pageNum > pdfDoc.numPages) {
      return res.status(400).json({ error: "Invalid page number" });
    }

    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str).join(' ');
    
    res.json({ 
      text: text,
      page: pageNum,
      total: pdfDoc.numPages
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get page" });
  }
});

app.get('/render/:num', async (req, res) => {
  const page = await pdfDoc.getPage(parseInt(req.params.num)+1);
  const viewport = page.getViewport({ scale: 2.0 });
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  res.set('Content-Type', 'image/png');
  canvas.createPNGStream().pipe(res);
});

// 3. TTS endpoint - sends full pdf text
app.get('/speak', (req, res) => {
  if (!pdfText) return res.status(400).json({ error: "Upload a PDF first" });
  res.json({ text: pdfText });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`v2.0.0 running on ${PORT}`));
