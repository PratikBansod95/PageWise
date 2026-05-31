/**
 * Service to parse PDF structure and extract text, headings, and paragraph blocks.
 * Calibrates line gaps dynamically and chunks large paragraphs for ADHD focus.
 */

export async function extractPDF(file) {
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) {
    throw new Error("pdfjsLib is not loaded. Ensure the PDF.js script tag is in index.html.");
  }

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const blocks = [];
  let title = '';

  const splitParagraphIntoChunks = (text, maxWords = 80) => {
    const sents = text.split(/(?<=[.!?])\s+/);
    const chunks = [];
    let curChunk = [];
    let curCount = 0;
    for (const s of sents) {
      const trimS = s.trim();
      if (!trimS) continue;
      const words = trimS.split(/\s+/).length;
      if (curCount + words > maxWords && curChunk.length > 0) {
        chunks.push(curChunk.join(' '));
        curChunk = [trimS];
        curCount = words;
      } else {
        curChunk.push(trimS);
        curCount += words;
      }
    }
    if (curChunk.length > 0) chunks.push(curChunk.join(' '));
    return chunks;
  };

  const pushParagraph = (text, page) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const chunks = splitParagraphIntoChunks(trimmed, 80);
    for (const chunk of chunks) {
      blocks.push({ type: 'paragraph', text: chunk, page });
    }
  };

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const lines = [];
    let cur = null;

    for (const item of tc.items) {
      const y = Math.round(item.transform[5]);
      const fs = Math.round(Math.sqrt(item.transform[0] ** 2 + item.transform[1] ** 2));
      if (!cur || Math.abs(cur.y - y) > 3) {
        if (cur) lines.push(cur);
        cur = { y, text: '', fontSize: fs };
      }
      cur.text += item.str;
      if (item.hasEOL) cur.text += ' ';
    }
    if (cur) lines.push(cur);

    // Calculate average standard line gap for this page
    const gaps = [];
    for (let j = 1; j < lines.length; j++) {
      const g = Math.abs(lines[j].y - lines[j - 1].y);
      const fs = lines[j].fontSize;
      if (g > 3 && g < fs * 2.5) gaps.push(g);
    }
    const avgGap = gaps.length ? (gaps.reduce((s, x) => s + x, 0) / gaps.length) : 0;

    const avg = lines.reduce((s, l) => s + l.fontSize, 0) / (lines.length || 1);
    let pBuf = [];

    for (let j = 0; j < lines.length; j++) {
      const ln = lines[j];
      const t = ln.text.trim();
      if (!t) continue;

      // Check for paragraph break based on vertical spacing
      if (j > 0 && pBuf.length) {
        const prevLn = lines[j - 1];
        const gap = Math.abs(ln.y - prevLn.y);
        const isParaBreak = (avgGap > 0 && gap > avgGap * 1.35) || (gap > ln.fontSize * 1.7);
        if (isParaBreak) {
          pushParagraph(pBuf.join(' '), i);
          pBuf = [];
        }
      }

      const big = ln.fontSize > avg * 1.3, huge = ln.fontSize > avg * 1.6;
      if (huge) {
        if (pBuf.length) { pushParagraph(pBuf.join(' '), i); pBuf = []; }
        if (!title) title = t;
        blocks.push({ type: 'h1', text: t, page: i });
      } else if (big) {
        if (pBuf.length) { pushParagraph(pBuf.join(' '), i); pBuf = []; }
        blocks.push({ type: 'h2', text: t, page: i });
      } else if (/^\d+\.\d+\.\d+\s+\S/.test(t) && t.length < 80) {
        if (pBuf.length) { pushParagraph(pBuf.join(' '), i); pBuf = []; }
        blocks.push({ type: 'h3', text: t, page: i });
      } else if (/^\d+\.\d+\s+[A-Z\u0900-\u097F]/.test(t) && t.length < 80) {
        if (pBuf.length) { pushParagraph(pBuf.join(' '), i); pBuf = []; }
        blocks.push({ type: 'h2', text: t, page: i });
      } else {
        pBuf.push(t);
      }
    }
    if (pBuf.length) pushParagraph(pBuf.join(' '), i);
    blocks.push({ type: 'pagebreak', page: i });
  }

  // Post-processing to merge drop-caps and fix paragraph flow
  const postProcessed = [];
  for (let j = 0; j < blocks.length; j++) {
    const b = blocks[j];
    if ((b.type === 'h1' || b.type === 'h2' || b.type === 'h3') && b.text.trim().length === 1) {
      let nextParaIdx = j + 1;
      while (nextParaIdx < blocks.length && blocks[nextParaIdx].type === 'pagebreak') {
        nextParaIdx++;
      }
      if (nextParaIdx < blocks.length && blocks[nextParaIdx].type === 'paragraph') {
        const nextB = blocks[nextParaIdx];
        nextB.text = b.text.trim() + nextB.text;
        continue;
      }
    }
    postProcessed.push(b);
  }

  const filtered = postProcessed.filter(b => b.type !== 'paragraph' || b.text.trim().split(' ').length >= 5);
  return { blocks: filtered, title: title || 'Document' };
}
