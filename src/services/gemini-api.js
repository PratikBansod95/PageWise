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

  // Build array of {id, text, section} for paragraphs only
  const paras = [];
  let currentSection = 'Introduction';
  let pi = 0;
  for (const b of blocks) {
    if (b.type === 'h1' || b.type === 'h2' || b.type === 'h3') {
      currentSection = b.text;
    } else if (b.type === 'paragraph') {
      paras.push({ id: pi, text: b.text, section: currentSection });
      pi++;
    }
  }

  if (!paras.length) return blocks;

  const BATCH = 20;
  const totalBatches = Math.ceil(paras.length / BATCH);
  const summaryMap = {}; // id → summary string

  for (let start = 0; start < paras.length; start += BATCH) {
    const batch       = paras.slice(start, start + BATCH);
    const batchNum    = Math.floor(start / BATCH) + 1;
    const sectionName = batch[0].section;

    if (onProgress) onProgress(3, { current: batchNum, total: totalBatches });

    // Rolling context: last 3 summaries for narrative continuity
    const prevSummaries = Object.values(summaryMap)
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
            maxOutputTokens: Math.max(1024, batch.length * 80),
          }
        })
      });

      const data = await res.json();
      raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      console.log(`Batch ${batchNum}/${totalBatches} raw (first 200):`, raw.substring(0, 200));

      const parsed = extractJsonArray(raw);

      if (Array.isArray(parsed) && parsed.length > 0) {
        // Handle both [{id, summary}] and ["summary1", "summary2"] formats
        if (typeof parsed[0] === 'string') {
          batch.forEach((p, idx) => {
            const s = parsed[idx];
            if (s && s !== '__skip__') summaryMap[p.id] = s;
          });
        } else {
          parsed.forEach(item => {
            if (item.summary && item.summary !== '__skip__') {
              summaryMap[item.id] = item.summary;
            }
          });
        }
        console.log(`Batch ${batchNum}: mapped ${Object.keys(summaryMap).length} summaries total`);
      } else {
        throw new Error('No valid JSON array in response');
      }

    } catch (err) {
      console.error(`Batch ${batchNum} failed:`, err.message, '\nRaw:', raw.substring(0, 300));
      // Fallback: extract summaries line-by-line, or use first sentence
      batch.forEach(p => {
        if (!summaryMap[p.id]) {
          const firstSent = p.text.match(/^[^.!?]+[.!?]/)?.[0] || p.text.substring(0, 80);
          summaryMap[p.id] = firstSent.trim();
        }
      });
    }
  }

  // Inject summaries back into blocks
  let pj = 0;
  return blocks.map(b => {
    if (b.type === 'paragraph') {
      const summary = summaryMap[pj] || firstSentence(b.text);
      pj++;
      return { ...b, summary };
    }
    return b;
  });
}

// ── Prompt builder ──
function buildPrompt(title, docType, section, contextLine, batch) {
  return `You are an expert tutor helping students — including those with ADHD — study "${title}" (${docType}) using a focus-reading interface.

The user sees ONLY the summary line until they click to expand the paragraph. Your summary must:
- Be a SHORT, CLEAR sentence of 10–18 words that captures the core concept.
- Name the KEY CONCEPT or KEY TERM introduced (do NOT hide it in vague language).
- Read as a natural continuation of the story/document so far (narrative flow).
- Use ACTIVE voice and plain English — no jargon unless it IS the key term.
- BE A TRIGGER, NOT A SPOILER: Give enough to recognize the idea and want to click — not so much that clicking feels unnecessary.
- NEVER start with: "This paragraph", "The author", "Here we see", "It explains", "We learn".

SECTION: "${section}"
${contextLine}

GOOD examples:
• "Photosynthesis converts sunlight, CO₂, and water into glucose through four chemical steps."
• "ATP stores cellular energy as a chemical bond — broken to power every cell activity."
• "Lactic acid builds up when muscles run short on oxygen, causing cramps."
• "Stomata open and close via guard cells, balancing CO₂ intake against water loss."

BAD examples (do NOT do these):
• "The paragraph discusses an important process in biology." (too vague, no key term)
• "This section explains what happens during photosynthesis." (meta-opener)
• "How organisms get their energy is discussed." (passive, no key term)

SPECIAL CASES:
- If the paragraph is a figure caption, activity instruction, label, or question list → return "__skip__"
- If the paragraph is garbled/unreadable (symbols or OCR artifacts only) → return "__skip__"

Return ONLY a JSON array of strings — one summary per paragraph, in the exact order of the input list.
Do NOT include markdown, backticks, or any explanation before or after the JSON.
Format: ["summary for paragraph 1", "summary for paragraph 2", ...]

PARAGRAPHS:
${batch.map((p, i) => `[${i + 1}] ${p.text.substring(0, 600)}`).join('\n\n')}`;
}

// ── Extract JSON array from raw Gemini response ──
function extractJsonArray(raw) {
  if (!raw) return null;

  let text = raw.trim();

  // Strip markdown code fences
  text = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

  // Try direct parse first
  if (text.startsWith('[')) {
    try { return JSON.parse(text); } catch {}
  }

  // Find first [ ... ] span
  const start = text.indexOf('[');
  const end   = text.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.substring(start, end + 1)); } catch {}
  }

  // Line-by-line fallback: extract quoted strings
  const lines  = text.split('\n');
  const result = [];
  for (const line of lines) {
    const m = line.match(/^\s*"([^"]+)"/);
    if (m) result.push(m[1]);
  }
  if (result.length > 0) return result;

  return null;
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
