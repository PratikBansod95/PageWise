/**
 * Service to handle communication with the Google Gemini API.
 * Uses structured JSON output schemas and robust parsing heuristics.
 */

export async function generateParagraphSummaries(blocks, title, key, onStepChange) {
  if (onStepChange) onStepChange(3);
  const paras = blocks.filter(b => b.type === 'paragraph').map((b, i) => ({ id: i, text: b.text }));
  if (!paras.length) return blocks;

  const BATCH = 40;
  const map = {};
  for (let s = 0; s < paras.length; s += BATCH) {
    const batch = paras.slice(s, s + BATCH);
    const ctx = s > 0 ? `Context — recent summaries: ${Object.values(map).slice(-3).join(' | ')}` : '';
    const prompt = `You help students with ADHD read "${title}" using a focus-reading interface where only one paragraph is shown at a time.
${ctx}
For each paragraph write a summary of 8-14 words that:
- Flows naturally as a story fragment from the paragraph before it
- Uses plain direct language, not academic
- Captures the single most important idea
- Never starts with "This paragraph" / "The author" / "Here we see"
- Feels like a breadcrumb — enough context, not a spoiler

Return ONLY valid JSON: [{"id":0,"summary":"..."}]

Paragraphs:
${batch.map(p => `[${p.id}] ${p.text}`).join('\n\n')}`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048,
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
    });

    if (!res.ok) {
      const e = await res.json();
      throw new Error(e.error?.message || `Gemini error ${res.status}`);
    }

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
          const targetId = (x.id !== undefined && paras[x.id] !== undefined)
            ? x.id
            : (batch[index] ? batch[index].id : null);
          if (targetId !== null) {
            map[targetId] = x.summary;
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

  let pi = 0;
  return blocks.map(b => {
    if (b.type === 'paragraph') {
      const r = { ...b, summary: map[pi] || b.text.substring(0, 55) + '…' };
      pi++;
      return r;
    }
    return b;
  });
}

export async function generateQuizQuestion(paragraphText, key) {
  const prompt = `You are a helpful study tutor. Based on this paragraph, write a single multiple-choice question to test a student's comprehension.
    
Paragraph:
"${paragraphText}"

Create:
- 1 clear question
- 3 options (1 correct, 2 plausible distractors)
- The correct answer index (0, 1, or 2)
- A short, encouraging explanation of why that answer is correct.`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
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
  });

  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.error?.message || `Gemini error ${res.status}`);
  }

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
