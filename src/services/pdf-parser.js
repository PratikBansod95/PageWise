/**
 * pdf-parser.js — Pagewise
 *
 * Complete rewrite based on real NCERT PDF analysis.
 *
 * Key findings from PDF structure analysis:
 * 1. PDF.js text items may lack spaces — must reconstruct from X gaps
 * 2. Drop-caps ("H" at large font) must be joined to their following line
 * 3. Paragraph breaks = sentence ends + gap > 1.5× median line gap
 * 4. Duplicate heading text ("5.2 NUTRITION 5.2 NUTRITION") from bold rendering
 * 5. Page numbers / running headers = font size ≤9 + short text
 * 6. Mid-sentence line wraps have NO gap — just next Y position
 */

export async function extractPDF(file) {
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) throw new Error('pdfjsLib is not loaded.');

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  const allLines = []; // all lines across all pages

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const tc  = await page.getTextContent({ includeMarkedContent: false });

    // ── 1. Group items into visual lines by Y coordinate (±4px) ──
    const lineMap = new Map(); // yKey → { y, items: [{x, str, w, fs}] }

    for (const item of tc.items) {
      if (!item.str) continue;
      const y  = item.transform[5];
      const x  = item.transform[4];
      const w  = item.width || 0;
      const fs = Math.round(Math.sqrt(item.transform[0] ** 2 + item.transform[1] ** 2));

      // Find matching Y bucket (within 4px)
      let yKey = null;
      for (const k of lineMap.keys()) {
        if (Math.abs(k - y) <= 4) { yKey = k; break; }
      }
      if (yKey === null) {
        yKey = y;
        lineMap.set(yKey, { y, items: [], maxFs: 0, page: pageNum });
      }
      const ln = lineMap.get(yKey);

      // Deduplicate: skip if same text at same X (bold duplicate rendering)
      const isDup = ln.items.some(it => Math.abs(it.x - x) < 4 && it.str === item.str);
      if (!isDup) {
        ln.items.push({ x, str: item.str, w, fs });
        if (fs > ln.maxFs) ln.maxFs = fs;
      }
    }

    // ── 2. Sort lines top→bottom (PDF Y=0 is bottom, so sort descending) ──
    const lines = [...lineMap.values()].sort((a, b) => b.y - a.y);

    // ── 3. Reconstruct text with proper spaces using X-gap heuristic ──
    for (const ln of lines) {
      ln.items.sort((a, b) => a.x - b.x);
      let text = '';
      for (let i = 0; i < ln.items.length; i++) {
        const cur = ln.items[i];
        if (i === 0) {
          text = cur.str;
        } else {
          const prev = ln.items[i - 1];
          const gap  = cur.x - (prev.x + prev.w);
          // If gap > ~1 space width (roughly 2px), insert a space
          const spaceWidth = (prev.fs || 10) * 0.28;
          text += (gap > spaceWidth ? ' ' : '') + cur.str;
        }
      }
      ln.text = text.replace(/\s+/g, ' ').trim();
    }

    // ── 4. Determine body font size for this page (most common fs) ──
    const fsFreq = {};
    for (const ln of lines) {
      if (ln.maxFs >= 8 && ln.text.length > 3) {
        fsFreq[ln.maxFs] = (fsFreq[ln.maxFs] || 0) + 1;
      }
    }
    const bodyFs = lines.length
      ? parseInt(Object.entries(fsFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || 10)
      : 10;

    // ── 5. Compute median inter-line gap ──
    const gaps = [];
    for (let i = 1; i < lines.length; i++) {
      const g = lines[i - 1].y - lines[i].y;
      if (g > 1 && g < 30) gaps.push(g);
    }
    gaps.sort((a, b) => a - b);
    const medianGap = gaps[Math.floor(gaps.length / 2)] || 12;

    for (const ln of lines) {
      ln.bodyFs    = bodyFs;
      ln.medianGap = medianGap;
    }

    allLines.push(...lines);
    allLines.push({ type: 'pagebreak', page: pageNum }); // sentinel
  }

  // ── 6. Classify each line ──
  const classified = [];
  for (const ln of allLines) {
    if (ln.type === 'pagebreak') { classified.push(ln); continue; }

    const text = ln.text;
    if (!text) continue;

    // Skip tiny footers/page numbers
    if (ln.maxFs <= 9 && text.split(' ').length <= 5) continue;
    if (/^\d{1,3}$/.test(text)) continue;
    if (/^(Science|Life Processes|Physics|Chemistry|Biology|Reprint \d{4}[-–]\d{2,4})$/i.test(text)) continue;
    if (/^Q\s*U\s*E\s*S\s*T\s*I\s*O\s*N\s*S$/i.test(text)) continue; // spaced-out "QUESTIONS"

    // Deduplicate repeated heading text: "5.2 NUTRITION 5.2 NUTRITION 5.2 NUTRITION"
    const cleanText = dedupeRepeatedText(text);

    // Classify by font size ratio
    const ratio = ln.maxFs / ln.bodyFs;
    let type = 'body';
    if (ratio >= 1.55)      type = 'h1';
    else if (ratio >= 1.2)  type = 'h2';
    else if (ratio >= 1.08) type = 'h3';

    // Override by content pattern
    if (/^\d+\.\d+\.\d+\s+\S/.test(cleanText) && cleanText.length < 90) type = 'h3';
    else if (/^\d+\.\d+\s+[A-Z\u0900-\u097F]/.test(cleanText) && cleanText.length < 90) type = 'h2';

    // Drop-cap: single large character — mark for merging with next line
    const isDropCap = type !== 'body' && cleanText.length === 1;

    classified.push({ ...ln, text: cleanText, type, isDropCap });
  }

  // ── 7. Stitch lines into paragraph blocks ──
  const blocks  = [];
  let   textBuf = '';
  let   bufPage = 1;
  let   prev    = null; // previous non-pagebreak classified line
  let   dropCapPending = '';

  const flush = (page) => {
    const t = textBuf.trim();
    textBuf = '';
    if (!t || t.split(/\s+/).length < 6) return;
    blocks.push({ type: 'paragraph', text: t, page });
  };

  for (const ln of classified) {
    if (ln.type === 'pagebreak') {
      // Don't flush on page break — paragraph may continue on next page
      blocks.push(ln);
      continue;
    }

    // Handle drop-cap: store and prepend to next body line
    if (ln.isDropCap) {
      dropCapPending = ln.text;
      continue;
    }

    if (ln.type !== 'body') {
      flush(prev?.page || ln.page);
      blocks.push({ type: ln.type, text: ln.text, page: ln.page });
      prev = ln;
      dropCapPending = '';
      continue;
    }

    // Prepend any pending drop-cap letter
    let lineText = ln.text;
    if (dropCapPending) {
      lineText = dropCapPending + lineText;
      dropCapPending = '';
    }

    // Decide: continue current paragraph or start a new one?
    let startNew = false;
    if (prev && prev.type === 'body') {
      const prevText       = prev.text;
      const endsSentence   = /[.!?]['"]?\s*$/.test(prevText);
      const endsHyphen     = /-\s*$/.test(prevText);
      const startsLower    = /^[a-z(]/.test(lineText);
      const startsCap      = /^[A-Z"']/.test(lineText);
      const vertGap        = prev.page === ln.page ? (prev.y - ln.y) : 999;
      const bigGap         = vertGap > ln.medianGap * 1.6;
      const bufWords       = textBuf.split(/\s+/).length;

      if (endsHyphen) {
        // De-hyphenate
        textBuf = textBuf.replace(/-\s*$/, '');
        startNew = false;
      } else if (startsLower) {
        startNew = false; // definitely continuation
      } else if (!endsSentence) {
        startNew = false; // mid-sentence wrap
      } else if (endsSentence && bigGap && startsCap && bufWords >= 20) {
        startNew = true;  // clean paragraph break
      } else if (endsSentence && bufWords >= 80) {
        startNew = true;  // paragraph is already long enough
      }
      // All other cases: keep buffering
    }

    if (startNew) {
      flush(prev?.page || ln.page);
      bufPage = ln.page;
    }

    textBuf = textBuf ? textBuf + ' ' + lineText : lineText;
    prev = { ...ln, text: lineText }; // use joined text for next iteration's logic
  }
  flush(prev?.page || 1);

  // ── 8. Post-process: merge short orphans, split giants ──
  const merged = mergeShortParagraphs(blocks);
  const final  = splitLongParagraphs(merged, 220);

  // ── 9. Validate ──
  const paraCount = final.filter(b => b.type === 'paragraph').length;
  if (paraCount === 0) {
    throw new Error('No readable text found. This PDF may be scanned or image-based.');
  }

  const h1 = final.find(b => b.type === 'h1');
  const title = h1 ? h1.text : 'Document';
  console.log(`✓ PDF parsed: ${paraCount} paragraphs, ${final.filter(b=>b.type==='h2').length} sections`);
  return { blocks: final, title };
}

// ── Helpers ──────────────────────────────────────────────

/**
 * "5.2 NUTRITION 5.2 NUTRITION 5.2 NUTRITION" → "5.2 NUTRITION"
 * Works by finding the shortest repeating unit.
 */
function dedupeRepeatedText(text) {
  const words = text.trim().split(/\s+/);
  if (words.length <= 4) return text;

  // Try chunk sizes from 1 to half the word count
  for (let chunkSize = 1; chunkSize <= Math.floor(words.length / 2); chunkSize++) {
    const chunk = words.slice(0, chunkSize).join(' ');
    const rest  = words.slice(chunkSize).join(' ');
    // Check if rest is just repetitions of chunk
    const pattern = new RegExp('^(' + chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*)+$', 'i');
    if (pattern.test(rest)) return chunk;
  }
  return text;
}

/**
 * Merge very short paragraphs (<25 words, no terminal punctuation) into next paragraph.
 */
function mergeShortParagraphs(blocks) {
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== 'paragraph') { out.push(b); continue; }

    const words         = b.text.split(/\s+/).length;
    const endsTerminal  = /[.!?]['"]?\s*$/.test(b.text);

    // Find next paragraph (skip page breaks)
    let nj = i + 1;
    while (nj < blocks.length && blocks[nj].type === 'pagebreak') nj++;
    const next = nj < blocks.length && blocks[nj].type === 'paragraph' ? blocks[nj] : null;

    if (words < 25 && !endsTerminal && next) {
      // Absorb into next paragraph
      next.text = b.text + ' ' + next.text;
      next.page = b.page;
      // Preserve page breaks between them
      for (let k = i + 1; k < nj; k++) out.push(blocks[k]);
      continue; // skip current block, will process merged next
    }
    out.push(b);
  }
  return out;
}

/**
 * Split paragraphs longer than maxWords at sentence boundaries.
 */
function splitLongParagraphs(blocks, maxWords) {
  const out = [];
  for (const b of blocks) {
    if (b.type !== 'paragraph') { out.push(b); continue; }

    const words = b.text.split(/\s+/).length;
    if (words <= maxWords) { out.push(b); continue; }

    // Split at sentence-final punctuation
    const sentences = b.text.split(/(?<=[.!?]['"]?)\s+/);
    let chunk = '';
    for (const sent of sentences) {
      const combined = chunk ? chunk + ' ' + sent : sent;
      if (chunk && combined.split(/\s+/).length > maxWords) {
        out.push({ type: 'paragraph', text: chunk.trim(), page: b.page });
        chunk = sent;
      } else {
        chunk = combined;
      }
    }
    if (chunk.trim()) out.push({ type: 'paragraph', text: chunk.trim(), page: b.page });
  }
  return out;
}
