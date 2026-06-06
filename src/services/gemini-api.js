/**
 * gemini-api.js — Pagewise
 *
 * Generates meaningful paragraph summaries using Gemini.
 * Key fixes:
 * - Model: gemini-2.0-flash (stable, exists)
 * - NO responseSchema / responseMimeType — causes issues on some API versions
 * - Robust JSON extraction handles any wrapping Gemini adds
 * - Summaries ask for PLAIN SENTENCES not bullets or titles
 * - Smaller batches (20) = better quality per summary
 */

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ── Retry with exponential backoff ──
async function fetchWithRetry(url, options, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options);
    if (res.ok) return res;

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < maxRetries) {
      const delay = 1500 * Math.pow(2, attempt);
      console.warn(`Gemini ${res.status}, retrying in ${delay}ms…`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }

    let msg = `Gemini error ${res.status}`;
    try { const e = await res.json(); if (e.error?.message) msg = e.error.message; } catch {}
    throw new Error(msg);
  }
}

// ── Guess document type for better prompting ──
function guessDocType(title) {
  const t = title.toLowerCase();
  if (/biology|science|chemistry|physics|medicine|cell|organ/.test(t)) return 'science textbook';
  if (/research|paper|journal|ieee|study|proceedings/.test(t)) return 'research paper';
  if (/history|social|civics|epoch|ancient|modern/.test(t)) return 'history notes';
  if (/law|court|legal|statute|act|regulation/.test(t)) return 'legal document';
  if (/math|algebra|calculus|geometry|statistics/.test(t)) return 'mathematics textbook';
  return 'educational document';
}

// ── Main export ──
export async function generateParagraphSummaries(blocks, title, key, onProgress) {
  if (onProgress) onProgress(3);

  const docType = guessDocType(title);

  // Build array of {id, text, section, originalBlockIndex, page} for paragraphs only
  const paras = [];
  let currentSection = 'Introduction';
  for (let idx = 0; idx < blocks.length; idx++) {
    const b = blocks[idx];
    if (b.type === 'h1' || b.type === 'h2' || b.type === 'h3') {
      currentSection = b.text;
    } else if (b.type === 'paragraph') {
      paras.push({ id: paras.length, text: b.text, section: currentSection, originalBlockIndex: idx, page: b.page });
    }
  }

  if (!paras.length) return blocks;

  const BATCH = 20;
  const totalBatches = Math.ceil(paras.length / BATCH);
  const allGroups = []; // list of all reconstructed focus groups

  for (let start = 0; start < paras.length; start += BATCH) {
    const batch       = paras.slice(start, start + BATCH);
    const batchNum    = Math.floor(start / BATCH) + 1;
    const sectionName = batch[0].section;

    if (onProgress) onProgress(3, { current: batchNum, total: totalBatches });

    // Rolling context: last 3 summaries for narrative continuity
    const prevSummaries = allGroups
      .map(g => g.summary)
      .filter(s => s && s !== '__skip__')
      .slice(-3);
    const contextLine = prevSummaries.length
      ? `RECENT SUMMARIES (for flow): ${prevSummaries.join(' → ')}`
      : '';

    const prompt = buildPrompt(title, docType, sectionName, contextLine, batch);

    let raw = '';
    try {
      const res = await fetchWithRetry(`${GEMINI_URL}?key=${key}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature:     0.2,
            maxOutputTokens: Math.max(1024, batch.length * 120),
          }
        })
      });

      const data = await res.json();
      raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      console.log(`Batch ${batchNum}/${totalBatches} raw (first 200):`, raw.substring(0, 200));

      const parsed = extractJsonGroups(raw);

      if (parsed) {
        const groups = reconstructGroups(batch, parsed, blocks);
        allGroups.push(...groups);
        console.log(`Batch ${batchNum}: generated ${groups.length} focus groups`);
      } else {
        throw new Error('No valid JSON array of groups in response');
      }

    } catch (err) {
      console.error(`Batch ${batchNum} failed:`, err.message, '\nRaw:', raw.substring(0, 300));
      // Fallback: each paragraph in this batch gets its own group
      batch.forEach(p => {
        allGroups.push({
          groupId: -1 - p.id,
          summary: firstSentence(p.text),
          paragraphs: [p.text],
          paragraphIds: [p.id],
          page: p.page || 1
        });
      });
    }
  }

  // Reconstruct final blocks array preserving outline order
  const finalBlocks = [];
  const blockReplaceMap = {};
  const blocksToRemove = new Set();

  allGroups.forEach(g => {
    const origIndices = g.paragraphIds.map(pid => paras[pid].originalBlockIndex);
    const targetIdx = origIndices[0];

    blockReplaceMap[targetIdx] = {
      type: 'paragraph',
      text: g.paragraphs.join('\n\n'),
      paragraphs: g.paragraphs,
      summary: g.summary,
      page: g.page
    };

    for (let k = 1; k < origIndices.length; k++) {
      blocksToRemove.add(origIndices[k]);
    }
  });

  for (let idx = 0; idx < blocks.length; idx++) {
    if (blocksToRemove.has(idx)) {
      continue;
    }
    if (blockReplaceMap[idx] !== undefined) {
      finalBlocks.push(blockReplaceMap[idx]);
    } else {
      finalBlocks.push(blocks[idx]);
    }
  }

  return finalBlocks;
}

// ── Prompt builder ──
function buildPrompt(title, docType, section, contextLine, batch) {
  return `You are an expert tutor helping students — including those with ADHD — study "${title}" (${docType}) using a focus-reading interface.

The user sees ONLY a summary line until they click to expand a block of paragraphs.
Your task is to group the consecutive paragraphs below into logical "focus blocks" (each containing one or more consecutive paragraphs that cover the same core concept or sub-topic) and write a single, high-quality summary for each focus block.

Guidelines for summaries:
- Be a SHORT, CLEAR sentence of 10–18 words that captures the core concept.
- Name the KEY CONCEPT or KEY TERM introduced (do NOT hide it in vague language).
- Read as a natural continuation of the story/document so far (narrative flow).
- Use ACTIVE voice and plain English.
- BE A TRIGGER, NOT A SPOILER: Give enough to recognize the idea and want to click — not so much that clicking feels unnecessary.
- NEVER start with: "This paragraph", "The author", "Here we see", "It explains", "We learn".

Guidelines for grouping:
- Group ONLY consecutive paragraphs that belong to the same sub-topic or narrative thread.
- A focus block can contain 1, 2, or at most 3 paragraphs. Do not group more than 3 paragraphs together.
- Every paragraph in the list must be assigned to exactly one focus block.
- Use 1-based paragraph indices (e.g. 1, 2, 3...) to refer to the paragraphs in the input list below.

SPECIAL CASES:
- If a paragraph is a figure caption, activity instruction, label, question list, or garbled/unreadable text → assign it to its own focus block and use "__skip__" as its summary.

Return ONLY a JSON array of objects, with no markdown, backticks, or other explanation before or after the JSON.
Format:
[
  {
    "summary": "Summary of paragraph 1 and 2.",
    "paragraphIndices": [1, 2]
  },
  {
    "summary": "Summary of paragraph 3.",
    "paragraphIndices": [3]
  }
]

SECTION: "${section}"
${contextLine}

PARAGRAPHS TO GROUP AND SUMMARIZE:
${batch.map((p, i) => `[Paragraph ${i + 1}] ${p.text}`).join('\n\n')}`;
}

// ── Extract JSON array of groups from raw Gemini response ──
function extractJsonGroups(raw) {
  if (!raw) return null;

  let text = raw.trim();

  // Strip markdown code fences
  text = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

  // Try direct parse first
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  // Find first [ ... ] span
  const start = text.indexOf('[');
  const end   = text.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.substring(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  return null;
}

// ── Heuristically group paragraphs consecutively, guarding headings and skips ──
function reconstructGroups(batch, parsedGroups, blocks) {
  const N = batch.length;
  const paragraphAssignments = Array(N).fill(null);

  if (Array.isArray(parsedGroups)) {
    parsedGroups.forEach((group, gIdx) => {
      if (!group || typeof group !== 'object') return;
      const summary = typeof group.summary === 'string' ? group.summary.trim() : '';
      const indices = group.paragraphIndices;
      if (Array.isArray(indices) && summary) {
        indices.forEach(idx => {
          const val = parseInt(idx);
          if (!isNaN(val) && val >= 1 && val <= N) {
            const pIdx = val - 1;
            // Only assign if not already claimed
            if (paragraphAssignments[pIdx] === null) {
              paragraphAssignments[pIdx] = {
                summary: summary,
                groupId: gIdx
              };
            }
          }
        });
      }
    });
  }

  // Construct final grouped blocks
  const groups = [];
  let currentGroup = null;

  for (let i = 0; i < N; i++) {
    const p = batch[i];
    const assign = paragraphAssignments[i];

    if (assign && assign.summary !== '__skip__') {
      // Check if we can merge with the currentGroup:
      // Must have same groupId, same summary, and NO heading between their original blocks.
      let canMerge = currentGroup && 
                     currentGroup.groupId === assign.groupId && 
                     currentGroup.summary === assign.summary;
      
      if (canMerge && currentGroup.paragraphIds.length > 0) {
        const lastParaId = currentGroup.paragraphIds[currentGroup.paragraphIds.length - 1];
        const prevBlockIdx = batch.find(bp => bp.id === lastParaId)?.originalBlockIndex;
        const currBlockIdx = p.originalBlockIndex;
        if (prevBlockIdx !== undefined && currBlockIdx !== undefined) {
          if (hasHeadingBetween(blocks, prevBlockIdx, currBlockIdx)) {
            canMerge = false;
          }
        }
      }

      if (canMerge) {
        currentGroup.paragraphs.push(p.text);
        currentGroup.paragraphIds.push(p.id);
      } else {
        if (currentGroup) groups.push(currentGroup);
        currentGroup = {
          groupId: assign.groupId,
          summary: assign.summary,
          paragraphs: [p.text],
          paragraphIds: [p.id],
          page: p.page || 1
        };
      }
    } else {
      // Unmapped paragraph or skipped block
      if (currentGroup) {
        groups.push(currentGroup);
        currentGroup = null;
      }
      // Each unmapped/skipped paragraph becomes its own group
      const summary = (assign && assign.summary === '__skip__') ? '__skip__' : firstSentence(p.text);
      groups.push({
        groupId: -1 - p.id,
        summary: summary,
        paragraphs: [p.text],
        paragraphIds: [p.id],
        page: p.page || 1
      });
    }
  }
  if (currentGroup) {
    groups.push(currentGroup);
  }

  return groups;
}

// ── Check if there are any section headings between two block indexes ──
function hasHeadingBetween(blocks, idxA, idxB) {
  const start = Math.min(idxA, idxB);
  const end = Math.max(idxA, idxB);
  for (let i = start + 1; i < end; i++) {
    const type = blocks[i]?.type;
    if (type === 'h1' || type === 'h2' || type === 'h3') {
      return true;
    }
  }
  return false;
}

// ── First meaningful sentence of a paragraph (fallback summary) ──
function firstSentence(text) {
  const m = text.match(/^[^.!?]{15,}[.!?]/);
  return m ? m[0].trim() : text.substring(0, 90).trim() + '…';
}

// ── Quiz question generator (unchanged) ──
export async function generateQuizQuestion(paragraphText, key) {
  const prompt = `You are a world-class study tutor.
Based on this paragraph, write ONE multiple-choice question testing conceptual understanding (not just memorization).

Paragraph: "${paragraphText}"

Requirements:
- 1 clear conceptual question
- 3 answer options (1 correct, 2 plausible distractors based on common misconceptions)
- correctAnswerIndex: 0, 1, or 2
- A short explanation of why the correct answer is right

Return ONLY valid JSON, no markdown:
{"question":"...","options":["...","...","..."],"answerIndex":0,"explanation":"..."}`;

  const res = await fetchWithRetry(`${GEMINI_URL}?key=${key}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 512 }
    })
  });

  const data = await res.json();
  const raw  = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  const text = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    return JSON.parse(text.substring(start, end + 1));
  }
  throw new Error('Could not parse quiz response');
}
