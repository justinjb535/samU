import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import pdfParse from 'pdf-parse';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

console.log("GROQ KEY LOADED?",!!process.env.GROQ_KEY, process.env.GROQ_KEY?.slice(0,10));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

const supabase = createClient(
  "https://pctbcbdqgicazzgwlrhr.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjdGJjYmRxZ2ljYXp6Z3dscmhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNzY1MzMsImV4cCI6MjA5Nzk1MjUzM30.NEz5DvbnjdtVuWwpf-6p09wvy_yTy5OETjsFUynoeN4"
);

let pdfDoc = null;
let pdfPagesText = [];
const summaryCache = new Map();

function cheapExtractiveSummary(text){
  if(!text) return "No text found.";
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s=>s.length>20);
  if(sentences.length <=2) return text.slice(0,200);
  const words = text.toLowerCase().match(/\w+/g) || [];
  const freq = {};
  words.forEach(w=>{ if(w.length>4) freq[w]=(freq[w]||0)+1 });
  const scored = sentences.map(s=>{
    const score = s.toLowerCase().split(/\W+/).reduce((a,w)=>a+(freq[w]||0),0);
    return { s, score };
  }).sort((a,b)=>b.score-a.score);
  return " FREE Preview:\n- " + scored.slice(0,2).map(x=>x.s.trim()).join("\n- ") + "\n\n[Upgrade to Premium for full AI Samurise]";
}

app.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const filePath = path.join(__dirname, req.file.path);
    const dataBuffer = fs.readFileSync(filePath);
    const dataPdf = new Uint8Array(dataBuffer);
    pdfDoc = await pdfjsLib.getDocument({ data: dataPdf, disableFontFace:true }).promise;
    pdfPagesText = [];
    for(let i=1;i<=pdfDoc.numPages;i++){
      const page = await pdfDoc.getPage(i);
      const content = await page.getTextContent();
      pdfPagesText.push(content.items.map(it=>it.str).join(' '));
    }
    summaryCache.clear();
    res.json({ pages: pdfDoc.numPages, pdfUrl: `/uploads/${req.file.filename}`, message: "PDF loaded" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process PDF: "+err.message });
  }
});

app.get('/page/:num', async (req, res) => {
  try {
    if (!pdfDoc) return res.status(400).json({ error: "Upload a PDF first" });
    const num = parseInt(req.params.num);
    const text = pdfPagesText[num] || "";
    const userId = req.headers['x-user-id'];
    console.log("\n--- NEW REQUEST ---");
    console.log("Page:", num, "User:", userId);
    console.log("GROQ_KEY exists:",!!process.env.GROQ_KEY);

    let isPro = false;
    if(userId){
      const { data, error } = await supabase.from("acu_users").select("is_pro").eq("user_id", userId).maybeSingle();
      console.log("Supabase:", data, "err:", error?.message);
      if(data?.is_pro) isPro = true;
    }

    const cacheKey = `${num}_${isPro? 'pro' : 'free'}`;
    if(summaryCache.has(cacheKey)){
      console.log("From cache");
      return res.json({ text, summary: summaryCache.get(cacheKey), page: num+1, total: pdfDoc.numPages, isPro });
    }

    let summary = "";
    if(isPro){
      if(!process.env.GROQ_KEY) throw new Error("GROQ_KEY missing in.env");
      console.log("Calling GROQ...");
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method:"POST",
        headers:{ "Authorization": `Bearer ${process.env.GROQ_KEY}`, "Content-Type":"application/json" },
        body: JSON.stringify({
          model:"openai/gpt-oss-20b",
          messages:[{ role:"system", content:"Summarize in 5 bullets." }, { role:"user", content: text.slice(0,3500) }],
          max_tokens: 300
        })
      });
      const data = await groqRes.json();
      console.log("GROQ raw:", JSON.stringify(data).slice(0,500));
      if(data.error) throw new Error(JSON.stringify(data.error));
      summary = "SAMURISED :\n" + (data.choices?.[0]?.message?.content || "Empty response");
    } else {
      summary = cheapExtractiveSummary(text);
    }
    summaryCache.set(cacheKey, summary);
    res.json({ text, summary, page: num+1, total: pdfDoc.numPages, isPro });
  } catch (err) {
    console.error("ERROR IN /page:", err.message);
    res.status(500).json({ error: err.message, text: pdfPagesText[parseInt(req.params.num)] || "", summary: "FAILED: "+err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`v2.1 SamU.backend running on ${PORT}`));
