/**
 * Service to handle communication with the Google Gemini API.
 * Uses structured JSON output schemas and robust parsing heuristics.
 */

const GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

function guessDocType(title) {
  const t = title.toLowerCase();
  if (t.includes('biology') || t.includes('science') || t.includes('chem') || t.includes('phys') || t.includes('medic') || t.includes('cell')) return 'science textbook';
  if (t.includes('paper') || t.includes('journal') || t.includes('ieee') || t.includes('research') || t.includes('study')) return 'research paper';
  if (t.includes('history') || t.includes('social') || t.includes('civic') || t.includes('epoch')) return 'history notes';
  if (t.includes('law') || t.includes('court') || t.includes('legal') || t.includes('statute') || t.includes('act')) return 'law';
  return 'general';
}

/** Fetch with retry on transient errors (429, 500, 503) */
async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    
    if (res.ok) return res;
    
    const isRetryable = res.status === 429 || res.status >= 500;
    if (isRetryable && attempt < retries) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
      console.warn(`Gemini API returned ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})...`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    
    // Non-retryable or exhausted retries — throw with safe error extraction
    let errorMsg = `Gemini error ${res.status}`;
    try {
      const e = await res.json();
      if (e.error?.message) errorMsg = e.error.message;
    } catch { /* response wasn't JSON */ }
    throw new Error(errorMsg);
  }
}

export async function generateParagraphSummaries(blocks, title, key, onStepChange) {
  if (onStepChange) onStepChange(3);
  
  const docType = guessDocType(title);
  
  let currentSec = 'General';
  const paras = [];
  let pi = 0;
  for (const b of blocks) {
    if (b.type === 'h1' || b.type === 'h2' || b.type === 'h3') {
      currentSec = b.text;
    } else if (b.type === 'paragraph') {
      paras.push({ id: pi, text: b.text, section: currentSec });
      pi++;
    }
  }
  if (!paras.length) return blocks;

  const BATCH = 40;
  const totalBatches = Math.ceil(paras.length / BATCH);
  const map = {};
  
  for (let s = 0; s < paras.length; s += BATCH) {
    const batch = paras.slice(s, s + BATCH);
    const batchNum = Math.floor(s / BATCH) + 1;
    
    // Report batch progress to the UI
    if (onStepChange) onStepChange(3, { current: batchNum, total: totalBatches });
    
    const prevSummaries = Object.values(map).slice(-3).filter(x => x && x !== '__skip__');
    const ctx = prevSummaries.length 
      ? `CONTEXT: Previous summaries for flow continuity: ${prevSummaries.join(' | ')}`
      : '';
      
    const currentSectionHeading = batch[0].section || 'General';

    const prompt = `You are an expert cognitive learning assistant helping students — including those with ADHD — study complex texts using a focus-reading interface.

DOCUMENT: "${title}"
DOCUMENT TYPE: ${docType}
CURRENT SECTION: "${currentSectionHeading}"
${ctx}

TASK:
For each numbered paragraph below, write one summary of 8–14 words.

RULES — follow every one:
1. NARRATIVE FLOW: Each summary must read as a natural continuation of the previous one — like breadcrumbs through a story, not isolated facts. A student should be able to read only the summaries and still understand the chapter arc.

2. SURFACE THE KEY TERM: If the paragraph introduces or defines a named concept, process, molecule, person, law, or event — that word MUST appear in the summary.
   Bad:  "Energy is stored and used by cells for various functions."
   Good: "ATP stores cellular energy — spent whenever the cell does work."

3. ACTIVE + DIRECT: Use active voice and plain English. No passive constructions. No jargon unless it is the key term (Rule 2).
   Bad:  "The process by which autotrophs synthesise food is described."
   Good: "Plants make their own food from sunlight, CO₂, and water."

4. NEVER USE META-OPENERS: Do not start with:
   "This paragraph...", "Here the author...", "The section details...", "We learn that...", "It is explained that..."

5. BE A TRIGGER, NOT A SPOILER: Give enough to recognise the idea and want to click — not so much that clicking feels unnecessary.

6. SHORT PARAGRAPHS / CAPTIONS: If a paragraph is fewer than 15 words or appears to be a figure caption, label, or header — return: {"id": N, "summary": "__skip__"}

7. UNKNOWN / GARBLED TEXT: If a paragraph is unreadable (OCR artifacts, symbols only) — return: {"id": N, "summary": "__skip__"}

EXAMPLES:
Paragraph: "The process of photosynthesis involves the absorption of light energy by chlorophyll, conversion of light to chemical energy, splitting of water molecules, and reduction of CO₂ to carbohydrates. These steps do not necessarily occur sequentially."
Good summary: "Photosynthesis converts light into sugar through four non-sequential chemical steps."
Bad summary:  "The process of making food using light energy is described in detail here."

Paragraph: "When there is a lack of oxygen in muscle cells, pyruvate converts to lactic acid instead of entering the mitochondria. This buildup causes the familiar cramping sensation."
Good summary: "Lactic acid builds up when muscles run low on oxygen — causing cramps."
Bad summary:  "A different chemical pathway occurs when oxygen is unavailable to cells."

Return ONLY valid JSON — no markdown, no backticks, no explanation:
[{"id": 0, "summary": "..."}, {"id": 1, "summary": "..."}]

PARAGRAPHS:
${batch.map((p, idx) => `[${idx}] ${p.text}`).join('\n\n')}`;

    const maxTokens = Math.max(4096, batch.length * 120);

    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: maxTokens,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  id: { type: 'INTEGER' },
                  summary: { type: 'STRING' }
                },
                required: ['id', 'summary']
              }
            }
          }
        })
      }
    );

    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

    // Robust extraction of JSON array
    let jsonText = raw.trim();
    const startIdx = jsonText.indexOf('[');
    const endIdx = jsonText.lastIndexOf(']');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      jsonText = jsonText.substring(startIdx, endIdx + 1);
    }

    try {
      const parsed = JSON.parse(jsonText);
      if (Array.isArray(parsed)) {
        parsed.forEach((x, index) => {
          const localId = (x.id !== undefined && batch[x.id] !== undefined)
            ? x.id
            : index;
          const targetPara = batch[localId];
          if (targetPara) {
            map[targetPara.id] = x.summary;
          }
        });
      } else {
        throw new Error("Parsed JSON is not an array");
      }
    } catch (e) {
      console.error("Gemini summary JSON parse error:", e, "Raw response:", raw);
      batch.forEach(p => {
        map[p.id] = p.text.split(' ').slice(0, 10).join(' ') + '…';
      });
    }
  }

  let pj = 0;
  return blocks.map(b => {
    if (b.type === 'paragraph') {
      const r = { ...b, summary: map[pj] || b.text.substring(0, 55) + '…' };
      pj++;
      return r;
    }
    return b;
  });
}

export async function generateQuizQuestion(paragraphText, key) {
  const prompt = `You are a world-class study tutor specialized in active recall and deep conceptual learning.
Based on this paragraph, write a single multiple-choice question designed to test the student's conceptual comprehension, not just rote memorization.

Paragraph:
"${paragraphText}"

Create:
- 1 clear question. Focus on the core concept, its implications, or a practical scenario applying it.
- 3 options (1 correct, 2 highly plausible distractors based on common misconceptions).
- The correct answer index (0, 1, or 2).
- A short, encouraging, and clear explanation of why the correct answer is right and why it matters, reinforcing the learning loop.`;

  const res = await fetchWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.5,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              question: { type: 'STRING' },
              options: {
                type: 'ARRAY',
                items: { type: 'STRING' }
              },
              answerIndex: { type: 'INTEGER' },
              explanation: { type: 'STRING' }
            },
            required: ['question', 'options', 'answerIndex', 'explanation']
          }
        }
      })
    }
  );

  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;

  // Robust extraction of JSON object
  let jsonText = raw.trim();
  const startIdx = jsonText.indexOf('{');
  const endIdx = jsonText.lastIndexOf('}');
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    jsonText = jsonText.substring(startIdx, endIdx + 1);
  }
  return JSON.parse(jsonText);
}
