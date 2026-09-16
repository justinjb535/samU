import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import pdfParse from 'pdf-parse';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

let pdfText = "";
let pdfDoc = null;

app.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const filePath = path.join(__dirname, req.file.path);
    const dataBuffer = fs.readFileSync(filePath);

    const data = await pdfParse(dataBuffer);
    pdfText = data.text;

    const dataPdf = new Uint8Array(dataBuffer);
    pdfDoc = await pdfjsLib.getDocument({ data: dataPdf }).promise;

    res.json({
      pages: pdfDoc.numPages,
      pdfUrl: `/uploads/${req.file.filename}`, // Client will render this
      message: "PDF loaded"
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process PDF" });
  }
});

// TEXT comes from SERVER
app.get('/page/:num', async (req, res) => {
  try {
    if (!pdfDoc) return res.status(400).json({ error: "Upload a PDF first" });
    const pageNum = parseInt(req.params.num) + 1;
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str).join(' ');
    res.json({ text, page: pageNum, total: pdfDoc.numPages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get page" });
  }
});

app.get('/speak', (req, res) => {
  if (!pdfText) return res.status(400).json({ error: "Upload a PDF first" });
  res.json({ text: pdfText });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`v2.0.0 CLIENT RENDER running on ${PORT}`));
