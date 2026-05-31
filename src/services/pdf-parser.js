/**
 * Service to parse PDF structure and extract text, headings, and paragraph blocks.
 * Calibrates line gaps dynamically, merges split paragraphs, and caps block size.
 */

const MAX_MERGED_WORDS = 500;

export async function extractPDF(file) {
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) {
    throw new Error("pdfjsLib is not loaded. Ensure the PDF.js script tag is in index.html.");
  }

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const blocks = [];
  let title = '';

  const pushParagraph = (text, page) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    blocks.push({ type: 'paragraph', text: trimmed, page });
  };

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const lines = [];
    let cur = null;

    for (const item of tc.items) {
      const y = Math.round(item.transform[5]);
      const x = Math.round(item.transform[4]);
      const fs = Math.round(Math.sqrt(item.transform[0] ** 2 + item.transform[1] ** 2));
      if (!cur || Math.abs(cur.y - y) > 3) {
        if (cur) lines.push(cur);
        cur = { y, text: '', fontSize: fs, items: [] };
      }
      
      // Filter out overlapping bold duplicates drawn at the same horizontal/vertical coordinate
      const isDup = cur.items.some(it => Math.abs(it.x - x) < 3 && it.str === item.str);
      if (!isDup) {
        cur.text += item.str;
        if (item.hasEOL) cur.text += ' ';
        cur.items.push({ x, str: item.str });
      }
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

      // Check for paragraph break based on vertical spacing and text content
      if (j > 0 && pBuf.length) {
        const prevLn = lines[j - 1];
        const gap = Math.abs(ln.y - prevLn.y);
        const prevText = prevLn.text.trim();
        
        const endsWithSentenceEnd = /[.!?]['"]?$/.test(prevText);
        const endsWithHyphen = /-$/.test(prevText);
        const startsWithLowercase = /^[a-z]/.test(t);
        
        let isParaBreak = false;
        
        if (endsWithHyphen) {
          isParaBreak = false;
        } else if (gap > ln.fontSize * 3.0) {
          isParaBreak = true;
        } else if (startsWithLowercase) {
          isParaBreak = false;
        } else if (!endsWithSentenceEnd) {
          isParaBreak = false;
        } else {
          const threshold = avgGap > 0 ? avgGap * 1.35 : ln.fontSize * 1.5;
          if (gap > threshold) {
            isParaBreak = true;
          }
        }
        
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
      } else if (/^\d+\.\d+\.\d+\s+\S/.test(t) && t.length < 80 && !/[.!?]$/.test(t)) {
        if (pBuf.length) { pushParagraph(pBuf.join(' '), i); pBuf = []; }
        blocks.push({ type: 'h3', text: t, page: i });
      } else if (/^\d+\.\d+\s+[A-Z\u0900-\u097F]/.test(t) && t.length < 80 && !/[.!?]$/.test(t)) {
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
  const mergedDropCaps = [];
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
    mergedDropCaps.push(b);
  }

  // Merge consecutive paragraphs that were split across pages or lines
  const postProcessed = [];
  for (let j = 0; j < mergedDropCaps.length; j++) {
    const current = mergedDropCaps[j];
    if (current.type !== 'paragraph') {
      postProcessed.push(current);
      continue;
    }

    let mergedText = current.text.trim();
    let lastMergedPage = current.page;
    let nextIdx = j + 1;
    let pendingPagebreaks = [];

    while (nextIdx < mergedDropCaps.length) {
      const nextBlock = mergedDropCaps[nextIdx];
      if (nextBlock.type === 'pagebreak') {
        pendingPagebreaks.push(nextBlock);
        nextIdx++;
        continue;
      }
      if (nextBlock.type === 'paragraph') {
        const nextText = nextBlock.text.trim();
        const endsWithSentencePunc = /[.!?]['"]?$/.test(mergedText);
        const startsWithLowercase = /^[a-z]/.test(nextText);
        const endsWithHyphen = /-$/.test(mergedText);
        const currentWordCount = mergedText.split(/\s+/).length;

        // Don't merge if we'd exceed the safety cap
        if (currentWordCount >= MAX_MERGED_WORDS) break;

        let shouldMerge = false;
        if (endsWithHyphen) {
          shouldMerge = true;
        } else if (!endsWithSentencePunc) {
          shouldMerge = true;
        } else if (startsWithLowercase) {
          shouldMerge = true;
        } else if (currentWordCount < 60) {
          shouldMerge = true;
        }

        if (shouldMerge) {
          if (endsWithHyphen) {
            mergedText = mergedText.slice(0, -1) + nextText;
          } else {
            mergedText = mergedText + ' ' + nextText;
          }
          lastMergedPage = nextBlock.page;
          nextIdx++;
        } else {
          break;
        }
      } else {
        break;
      }
    }

    postProcessed.push({
      type: 'paragraph',
      text: mergedText,
      page: lastMergedPage
    });

    for (const pb of pendingPagebreaks) {
      postProcessed.push(pb);
    }

    j = nextIdx - 1;
  }

  const filtered = postProcessed.filter(b => {
    if (b.type !== 'paragraph') return true;
    const text = b.text.trim();
    
    // Raise minimum paragraph length from 5 to 8 words
    if (text.split(/\s+/).length < 8) return false;
    
    // Filter out page numbers (pure digits)
    if (/^\d+$/.test(text)) return false;
    
    // Filter out NCERT rationalize/reprint footers
    if (/rationalised/i.test(text) && /\d{4}-\d{2,4}/.test(text)) return false;
    if (/reprint/i.test(text) && /\d{4}-\d{2,4}/.test(text)) return false;
    
    // Filter out short figure and activity headers (e.g., "Figure 5.3", "Activity 5.1") under 15 words
    if (/^(figure|fig\.|activity)\s+\d+\.\d+/i.test(text) && text.split(/\s+/).length < 15) return false;
    
    return true;
  });

  // Check if we extracted any usable content
  const hasContent = filtered.some(b => b.type === 'paragraph' || b.type === 'h1' || b.type === 'h2');
  if (!hasContent) {
    throw new Error('No readable text found. This PDF may be scanned images, password-protected, or empty.');
  }

  return { blocks: filtered, title: title || 'Document' };
}
