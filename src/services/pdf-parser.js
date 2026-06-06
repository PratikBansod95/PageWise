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

    // ── 1. Group items into visual lines with Column-aware Gutter detection ──
    const gutterX = detectColumnGutter(tc.items);
    const pageLines = [];

    if (gutterX) {
      // Split items into left, right, and spanning
      const leftItems = [];
      const rightItems = [];
      const spanningItems = [];

      for (const item of tc.items) {
        if (!item.str) continue;
        const x = item.transform[4];
        const fs = Math.round(Math.sqrt(item.transform[0] ** 2 + item.transform[1] ** 2));
        const w = item.width || (item.str.length * fs * 0.5);

        const isSpanning = x < (gutterX - 15) && (x + w) > (gutterX + 15);
        if (isSpanning) {
          spanningItems.push(item);
        } else if (x + w / 2 < gutterX) {
          leftItems.push(item);
        } else {
          rightItems.push(item);
        }
      }

      // Group each column's items independently
      const leftLines = groupItemsIntoLines(leftItems, pageNum);
      const rightLines = groupItemsIntoLines(rightItems, pageNum);
      const spanningLines = groupItemsIntoLines(spanningItems, pageNum);

      // Distribute spanning lines into top, bottom or middle based on columns bounds
      let colMaxY = -Infinity;
      let colMinY = Infinity;
      [...leftLines, ...rightLines].forEach(ln => {
        if (ln.y > colMaxY) colMaxY = ln.y;
        if (ln.y < colMinY) colMinY = ln.y;
      });

      const topSpanning = [];
      const bottomSpanning = [];
      const middleSpanning = [];

      spanningLines.forEach(ln => {
        if (ln.y > colMaxY - 10) topSpanning.push(ln);
        else if (ln.y < colMinY + 10) bottomSpanning.push(ln);
        else middleSpanning.push(ln);
      });

      // Sort sub-groups top -> bottom
      topSpanning.sort((a, b) => b.y - a.y);
      leftLines.sort((a, b) => b.y - a.y);
      rightLines.sort((a, b) => b.y - a.y);
      bottomSpanning.sort((a, b) => b.y - a.y);

      // Order of flow: Top spanning (like chapter headers) -> Left Column -> Right Column -> middle -> footers
      pageLines.push(...topSpanning, ...leftLines, ...rightLines, ...middleSpanning, ...bottomSpanning);
    } else {
      // Single column layout
      const standardLines = groupItemsIntoLines(tc.items, pageNum);
      standardLines.sort((a, b) => b.y - a.y);
      pageLines.push(...standardLines);
    }

    const lines = pageLines;

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

      // Calculate coordinates and width
      if (ln.items.length > 0) {
        ln.minX = ln.items[0].x;
        const lastItem = ln.items[ln.items.length - 1];
        ln.maxX = lastItem.x + lastItem.w;
        ln.width = ln.maxX - ln.minX;
      } else {
        ln.minX = 0;
        ln.maxX = 0;
        ln.width = 0;
      }
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

    // Find min and max Y for this page's lines to determine visual borders
    let pageMinY = Infinity;
    let pageMaxY = -Infinity;
    for (const ln of lines) {
      if (ln.text) {
        if (ln.y < pageMinY) pageMinY = ln.y;
        if (ln.y > pageMaxY) pageMaxY = ln.y;
      }
    }
    const pageHeight = pageMaxY - pageMinY;

    // Find max width of body-like lines on this page
    let pageMaxLineWidth = 0;
    for (const ln of lines) {
      if (ln.text && ln.text.length > 20 && Math.abs(ln.maxFs - bodyFs) <= 1) {
        if (ln.width > pageMaxLineWidth) {
          pageMaxLineWidth = ln.width;
        }
      }
    }
    if (pageMaxLineWidth === 0) {
      pageMaxLineWidth = Math.max(...lines.map(ln => ln.width || 0)) || 300;
    }

    for (const ln of lines) {
      ln.bodyFs    = bodyFs;
      ln.medianGap = medianGap;
      ln.pageMaxLineWidth = pageMaxLineWidth;
      ln.isHeaderZone = false;
      ln.isFooterZone = false;

      if (lines.length >= 3 && pageHeight > 50) {
        const distFromTop = pageMaxY - ln.y;
        const distFromBottom = ln.y - pageMinY;
        // Top 8% is header zone, bottom 8% is footer zone
        ln.isHeaderZone = distFromTop < pageHeight * 0.08;
        ln.isFooterZone = distFromBottom < pageHeight * 0.08;
      }
    }

    allLines.push(...lines);
    allLines.push({ type: 'pagebreak', page: pageNum }); // sentinel
  }

  // ── 6. Identify repeating running headers/footers across pages ──
  const headerFooterFreq = {}; // normalizedText -> Set of pageNumbers
  for (const ln of allLines) {
    if (ln.type === 'pagebreak') continue;
    if (ln.isHeaderZone || ln.isFooterZone) {
      const norm = normalizeHeaderFooterText(ln.text);
      if (!norm) continue;
      if (!headerFooterFreq[norm]) {
        headerFooterFreq[norm] = new Set();
      }
      headerFooterFreq[norm].add(ln.page);
    }
  }

  const runningHeaderFooters = new Set();
  for (const [norm, pages] of Object.entries(headerFooterFreq)) {
    // If a text appears in header/footer zone on 2 or more different pages, it's a running header/footer
    if (pages.size >= 2) {
      runningHeaderFooters.add(norm);
    }
  }

  // ── 7. Classify each line ──
  const classified = [];
  for (const ln of allLines) {
    if (ln.type === 'pagebreak') { classified.push(ln); continue; }

    const text = ln.text;
    if (!text) continue;

    // Skip tiny footers/page numbers
    if (ln.maxFs <= 9 && text.split(' ').length <= 5) continue;
    if (/^\d{1,3}$/.test(text)) continue;

    // Filter out running headers and footers detected generically
    if (ln.isHeaderZone || ln.isFooterZone) {
      const norm = normalizeHeaderFooterText(text);
      if (runningHeaderFooters.has(norm)) {
        continue;
      }
    }

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
      continue;
    }

    // Prepend any pending drop-cap letter
    let lineText = ln.text;
    if (dropCapPending) {
      lineText = dropCapPending + lineText;
      dropCapPending = '';
    }
    lineText = stripBulletArtifacts(lineText);

    // Decide: continue current paragraph or start a new one?
    let startNew = false;
    if (prev && prev.type === 'body') {
      const prevText       = prev.text;
      const endsSentence   = /[.!?]['"]?\s*$/.test(prevText);
      const endsHyphen     = /-\s*$/.test(prevText);
      const startsCap      = /^[A-Z"']/.test(lineText);
      const vertGap        = prev.page === ln.page ? (prev.y - ln.y) : 999;
      
      const bigGap         = vertGap > ln.medianGap * 1.25;
      const isShortLine    = prev.width < prev.pageMaxLineWidth * 0.88;
      const isIndented     = ln.minX > prev.minX + ln.bodyFs * 1.2;
      const isPageBreak    = prev.page !== ln.page;

      if (endsHyphen) {
        // De-hyphenate
        textBuf = textBuf.replace(/-\s*$/, '');
        startNew = false;
      } else if (endsSentence && startsCap && (bigGap || isShortLine || isIndented || isPageBreak)) {
        startNew = true;  // clean paragraph break
      } else {
        startNew = false; // keep buffering
      }
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
  const trimmed = text.trim();
  if (!trimmed) return text;

  // Try unspaced repetition: "NUTRITIONNUTRITION"
  const doubleUnspaced = trimmed + trimmed;
  const repeatUnspacedIdx = doubleUnspaced.indexOf(trimmed, 1);
  if (repeatUnspacedIdx !== -1 && repeatUnspacedIdx < trimmed.length) {
    const candidate = doubleUnspaced.substring(0, repeatUnspacedIdx).trim();
    if (candidate.length > 2) return candidate;
  }

  // Try spaced repetition: "NUTRITION NUTRITION"
  const doubleSpaced = trimmed + ' ' + trimmed;
  const repeatSpacedIdx = doubleSpaced.indexOf(trimmed, 1);
  if (repeatSpacedIdx !== -1 && repeatSpacedIdx < trimmed.length + 1) {
    const candidate = doubleSpaced.substring(0, repeatSpacedIdx).trim();
    if (candidate.length > 2) return candidate;
  }

  return text;
}

/**
 * Strip NCERT custom bullet font artifacts (letter 'n' rendered as bullet).
 */
function stripBulletArtifacts(text) {
  return text
    .replace(/^n\s+/, '')
    .replace(/\s+n\s+/g, ' ')
    .trim();
}

/**
 * Normalize text to detect generic repeating header/footer patterns
 */
function normalizeHeaderFooterText(text) {
  return text.toLowerCase()
    .replace(/\d+/g, '#')       // Replace numbers with '#'
    .replace(/\s+/g, ' ')       // Normalize spaces
    .trim();
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
    const pagebreaks = [];
    while (nj < blocks.length && blocks[nj].type === 'pagebreak') {
      pagebreaks.push(blocks[nj]);
      nj++;
    }
    const next = nj < blocks.length && blocks[nj].type === 'paragraph' ? blocks[nj] : null;

    if (words < 25 && !endsTerminal && next) {
      // Absorb into next paragraph
      next.text = b.text + ' ' + next.text;
      next.page = b.page;
      // Push the page breaks
      out.push(...pagebreaks);
      // Advance i to skip the pagebreaks
      i = nj - 1;
      continue;
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

/**
 * Detect column gutter in a PDF page by analyzing item horizontal ranges.
 * Returns X coordinate of center of gutter if columns exist, otherwise null.
 */
function detectColumnGutter(items) {
  if (items.length < 10) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  for (const it of items) {
    const x = it.transform[4];
    const fs = Math.round(Math.sqrt(it.transform[0] ** 2 + it.transform[1] ** 2));
    const w = it.width || (it.str.length * fs * 0.5);
    if (x < minX) minX = x;
    if (x + w > maxX) maxX = x + w;
  }

  const width = maxX - minX;
  if (width < 220) return null;

  const searchMin = minX + width * 0.35;
  const searchMax = minX + width * 0.65;

  const binsCount = 60;
  const binWidth = (searchMax - searchMin) / binsCount;
  const overlaps = Array(binsCount).fill(0);

  for (const it of items) {
    const x = it.transform[4];
    const fs = Math.round(Math.sqrt(it.transform[0] ** 2 + it.transform[1] ** 2));
    const w = it.width || (it.str.length * fs * 0.5);
    const itemMin = x;
    const itemMax = x + w;

    for (let j = 0; j < binsCount; j++) {
      const binMin = searchMin + j * binWidth;
      const binMax = binMin + binWidth;
      if (itemMin < binMax && itemMax > binMin) {
        overlaps[j]++;
      }
    }
  }

  let minOverlaps = Infinity;
  let bestBinIdx = -1;
  for (let j = 0; j < binsCount; j++) {
    if (overlaps[j] < minOverlaps) {
      minOverlaps = overlaps[j];
      bestBinIdx = j;
    }
  }

  if (bestBinIdx !== -1 && minOverlaps < Math.max(1, items.length * 0.03)) {
    const gutterX = searchMin + bestBinIdx * binWidth + binWidth / 2;
    return gutterX;
  }

  return null;
}

/**
 * Group list of items into visual lines by Y coordinate (within 4px)
 */
function groupItemsIntoLines(items, pageNum) {
  const lineMap = new Map();
  for (const item of items) {
    if (!item.str) continue;
    const y  = item.transform[5];
    const x  = item.transform[4];
    const w  = item.width || 0;
    const fs = Math.round(Math.sqrt(item.transform[0] ** 2 + item.transform[1] ** 2));

    let yKey = null;
    for (const k of lineMap.keys()) {
      if (Math.abs(k - y) <= 4) { yKey = k; break; }
    }
    if (yKey === null) {
      yKey = y;
      lineMap.set(yKey, { y, items: [], maxFs: 0, page: pageNum });
    }
    const ln = lineMap.get(yKey);

    const isDup = ln.items.some(it => Math.abs(it.x - x) < 4 && it.str === item.str);
    if (!isDup) {
      ln.items.push({ x, str: item.str, w, fs });
      if (fs > ln.maxFs) ln.maxFs = fs;
    }
  }
  return [...lineMap.values()];
}
