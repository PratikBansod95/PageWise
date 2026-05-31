import { slug, splitSents, escHtml, showToast } from '../utils.js';
import { initSpeech, readAloud, cancelSpeech } from './speech-reader.js';
import { generateQuizQuestion } from '../services/gemini-api.js';
import { renderQuiz } from './active-recall.js';

/**
 * Component to handle Reader UI rendering, font adjustments, paragraph toggles,
 * and page progress tracking.
 *
 * State is kept module-private; external code uses getter functions
 * (getCurIdx, getAllBlocks) instead of mutable exported variables.
 */

// ── Private state ──
const _state = {
  allBlocks: [],
  paragraphTexts: [],
  curIdx: -1,
  fontSize: 18,
  fontMode: 0, // 0: Serif, 1: Sans-Serif, 2: Dyslexic
  scrollHandler: null,
  apiKey: null,
  totalParas: 0,
  quizzesAttempted: 0,
  quizzesCorrect: 0,
};

// ── Public getters (safe read-only access from main.js) ──
export function getCurIdx() { return _state.curIdx; }
export function getAllBlocks() { return _state.allBlocks; }

// Legacy compatibility — keep live-binding exports for main.js imports
// that already destructure `allBlocks` and `curIdx` at the top level.
export const allBlocks = _state.allBlocks;
export const paragraphTexts = _state.paragraphTexts;
export { getCurIdx as curIdx_getter };

// Provide curIdx as a getter on the export object isn't possible with
// ES static exports, so we keep both: the getter fn for new code, and
// a re-exported reference that main.js already uses via live binding.
// The trick: main.js reads `curIdx` which is a module-scoped let that
// we keep synced to _state.curIdx in every mutation.
let curIdx = -1; // kept in sync with _state.curIdx
export { curIdx };

function _syncCurIdx(v) {
  _state.curIdx = v;
  curIdx = v;
}

// ── Builder ──

export function buildReader(blocks, title, fname, apiKey) {
  // Cleanup any previous reader session
  cleanupReader();

  _state.apiKey = apiKey;
  _state.allBlocks.length = 0;
  _state.paragraphTexts.length = 0;
  _state.quizzesAttempted = 0;
  _state.quizzesCorrect = 0;
  _syncCurIdx(-1);

  const main = document.getElementById('rMain');
  const sidebar = document.getElementById('rSidebar');
  if (!main || !sidebar) return;

  document.getElementById('rDocName').textContent = fname.replace(/\.pdf$/i, '');
  main.innerHTML = '';
  sidebar.innerHTML = '<span class="sb-label">Contents</span>';

  const isDemo = !apiKey;

  // Chapter label
  const clabel = document.createElement('div');
  clabel.className = 'book-chapter-label fade-up';
  clabel.textContent = 'Your Focus Book';
  main.appendChild(clabel);

  // Reading stats bar
  const statsBar = document.createElement('div');
  statsBar.className = 'reading-stats-bar fade-up';
  statsBar.id = 'readingStats';
  main.appendChild(statsBar);

  // Book page container
  const page = document.createElement('div');
  page.className = 'book-page';
  page.setAttribute('role', 'article');
  page.setAttribute('aria-label', title);
  main.appendChild(page);

  // Doc title
  const titleEl = document.createElement('div');
  titleEl.className = 'doc-title fade-up';
  titleEl.setAttribute('role', 'heading');
  titleEl.setAttribute('aria-level', '1');
  titleEl.textContent = title;
  page.appendChild(titleEl);

  let pi = 0;
  let delay = 0;
  let slugCounts = {};

  for (const b of blocks) {
    if (b.type === 'pagebreak') {
      const pm = document.createElement('div');
      pm.className = 'pg-turn';
      pm.setAttribute('role', 'separator');
      pm.innerHTML = `<div class="pg-turn-line"></div><span class="pg-turn-badge">Page ${b.page}</span><div class="pg-turn-line"></div>`;
      page.appendChild(pm);
      continue;
    }
    if (b.type === 'h1') {
      const el = document.createElement('h2'); // semantic heading
      el.className = 'c-h1 fade-up';
      el.id = uniqueSlug(b.text, slugCounts);
      el.textContent = b.text;
      page.appendChild(el);
      addSbItem(sidebar, b.text, el, 'h1');
      continue;
    }
    if (b.type === 'h2') {
      const el = document.createElement('h3');
      el.className = 'c-h2 fade-up';
      el.id = uniqueSlug(b.text, slugCounts);
      el.textContent = b.text;
      page.appendChild(el);
      addSbItem(sidebar, b.text, el, 'h2');
      continue;
    }
    if (b.type === 'h3') {
      const el = document.createElement('h4');
      el.className = 'c-h3 fade-up';
      el.id = uniqueSlug(b.text, slugCounts);
      el.textContent = b.text;
      page.appendChild(el);
      addSbItem(sidebar, b.text, el, 'h3');
      continue;
    }
    if (b.type === 'paragraph') {
      const idx = pi;
      _state.paragraphTexts.push(b.text);

      const isSkip = b.summary === '__skip__';
      const div = document.createElement('div');
      div.className = 'para-block fade-up' + (isSkip ? ' skip-summary' : '');
      div.style.animationDelay = Math.min(delay * 20, 300) + 'ms';
      div.dataset.index = idx;
      div.setAttribute('role', 'button');
      div.setAttribute('tabindex', '0');
      div.setAttribute('aria-label', isSkip ? 'Caption or label' : `Paragraph ${idx + 1}: ${(b.summary || '').substring(0, 60)}`);
      div.setAttribute('aria-expanded', 'false');

      const sents = splitSents(b.text).map(s => `<p>${escHtml(s)}</p>`).join('');
      
      const summaryRowHtml = isSkip ? '' : `
        <div class="para-summary-row">
          <span class="para-sum-text">${escHtml(b.summary || '…')}</span>
        </div>`;
        
      let actionsHtml = '';
      if (!isSkip) {
        if (isDemo) {
          actionsHtml = `
            <div class="para-actions">
              <button class="r-btn tts-btn" disabled title="Upload your own PDF to use Listen" aria-label="Listen to paragraph (demo disabled)">Listen 🔊</button>
              <button class="r-btn quiz-btn" disabled title="Upload your own PDF to use Quiz" aria-label="Quiz on paragraph (demo disabled)">Quiz Me 🧠</button>
            </div>`;
        } else {
          actionsHtml = `
            <div class="para-actions">
              <button class="r-btn tts-btn" aria-label="Listen to paragraph ${idx + 1}">Listen 🔊</button>
              <button class="r-btn quiz-btn" aria-label="Quiz on paragraph ${idx + 1}">Quiz Me 🧠</button>
            </div>
            <div class="para-quiz-container" id="quiz-${idx}"></div>`;
        }
      }

      div.innerHTML = `
        ${summaryRowHtml}
        <div class="para-full">
          <div class="para-full-inner${isSkip ? ' skip-inner' : ''}">
            ${sents}
            ${actionsHtml}
          </div>
        </div>`;

      // Bind click + keyboard events
      const handleActivate = (e) => {
        if (isSkip) return;
        if (e.target.closest('button, input, a, .quiz-opt-btn, .quiz-feedback')) return;
        toggle(idx);
      };
      div.addEventListener('click', handleActivate);
      div.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleActivate(e);
        }
      });

      if (!isSkip && !isDemo) {
        div.querySelector('.tts-btn').addEventListener('click', (e) => readAloud(idx, e));
        div.querySelector('.quiz-btn').addEventListener('click', (e) => quizMe(idx, e, _state.apiKey));
      }

      page.appendChild(div);
      _state.allBlocks.push(div);
      pi++;
      delay++;
    }
  }

  _state.totalParas = pi;
  updateReadingStats();

  // Page number at bottom
  const pgnum = document.createElement('div');
  pgnum.className = 'pg-num-display';
  pgnum.textContent = '— Pagewise Focus Edition —';
  page.appendChild(pgnum);

  // Initialize Speech Synthesizer with refs
  initSpeech(_state.paragraphTexts, _state.allBlocks);

  // Track the scroll handler so we can remove it later
  _state.scrollHandler = updateProg;
  window.addEventListener('scroll', _state.scrollHandler, { passive: true });
  updateProg();
}

/** Update the reading stats bar */
function updateReadingStats() {
  const el = document.getElementById('readingStats');
  if (!el) return;
  const read = _state.allBlocks.filter(b => b.dataset.wasRead === '1').length;
  const total = _state.totalParas;
  const pct = total > 0 ? Math.round((read / total) * 100) : 0;

  let html = `<span class="stat-item">📖 ${read}/${total} paragraphs read (${pct}%)</span>`;
  if (_state.quizzesAttempted > 0) {
    html += `<span class="stat-item">🧠 ${_state.quizzesCorrect}/${_state.quizzesAttempted} quizzes correct</span>`;
  }
  el.innerHTML = html;
}

/** Generate a unique slug ID, appending a counter suffix on collision */
function uniqueSlug(text, counts) {
  const base = 'h-' + slug(text);
  if (!counts[base]) {
    counts[base] = 1;
    return base;
  }
  counts[base]++;
  return base + '-' + counts[base];
}

/** Remove scroll listeners and cancel speech — call before rebuilding or going home */
export function cleanupReader() {
  if (_state.scrollHandler) {
    window.removeEventListener('scroll', _state.scrollHandler);
    _state.scrollHandler = null;
  }
  cancelSpeech();
}

function addSbItem(sb, text, el, cls) {
  const btn = document.createElement('button');
  btn.className = `sb-item ${cls}`;
  btn.textContent = text.length > 42 ? text.substring(0, 42) + '…' : text;
  btn.setAttribute('aria-label', `Jump to: ${text.substring(0, 60)}`);
  btn.onclick = () => el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  sb.appendChild(btn);
}

export function toggle(idx) {
  const b = _state.allBlocks[idx];
  if (!b) return;
  const wasActive = b.classList.contains('active');

  // Collapse all
  _state.allBlocks.forEach(x => {
    x.classList.remove('active');
    x.setAttribute('aria-expanded', 'false');
  });

  if (!wasActive) {
    b.classList.add('active');
    b.setAttribute('aria-expanded', 'true');
    b.dataset.wasRead = '1';
    _syncCurIdx(idx);
    updateReadingStats();
    setTimeout(() => {
      const r = b.getBoundingClientRect();
      if (r.top < 64 || r.bottom > window.innerHeight - 40) {
        b.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 60);
  } else {
    _syncCurIdx(-1);
  }
}

export function toggleByIndex(idx) {
  if (idx >= 0 && idx < _state.allBlocks.length) {
    toggle(idx);
  }
}

export function collapseAll() {
  _state.allBlocks.forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-expanded', 'false');
  });
  _syncCurIdx(-1);
  cancelSpeech();
}

export function expandAll() {
  _state.allBlocks.forEach(b => {
    if (!b.classList.contains('skip-summary')) {
      b.classList.add('active');
      b.setAttribute('aria-expanded', 'true');
      b.dataset.wasRead = '1';
    }
  });
  _syncCurIdx(-1);
  updateReadingStats();
}

export function updateProg() {
  const rProg = document.getElementById('rProg');
  if (!rProg) return;
  const s = window.scrollY;
  const d = document.documentElement.scrollHeight - window.innerHeight;
  rProg.style.width = (d > 0 ? (s / d) * 100 : 0) + '%';
}

export function chgFs(d) {
  _state.fontSize = Math.max(13, Math.min(26, _state.fontSize + d));
  const label = document.getElementById('fsLabel');
  if (label) label.textContent = _state.fontSize;
  document.documentElement.style.setProperty('--rfs', _state.fontSize + 'px');
}

export function toggleFont() {
  _state.fontMode = (_state.fontMode + 1) % 3;
  const btn = document.getElementById('fontToggleBtn');
  const root = document.documentElement;
  if (!btn) return;

  if (_state.fontMode === 0) {
    root.style.setProperty('--reading-font', "'Lora', serif");
    root.style.setProperty('--reading-letter-spacing', 'normal');
    root.style.setProperty('--reading-word-spacing', 'normal');
    root.style.setProperty('--reading-line-height', '1.9');
    btn.innerHTML = 'Serif 📖';
  } else if (_state.fontMode === 1) {
    root.style.setProperty('--reading-font', "'DM Sans', sans-serif");
    root.style.setProperty('--reading-letter-spacing', 'normal');
    root.style.setProperty('--reading-word-spacing', 'normal');
    root.style.setProperty('--reading-line-height', '1.9');
    btn.innerHTML = 'Sans 📱';
  } else {
    root.style.setProperty('--reading-font', "'DM Sans', sans-serif");
    root.style.setProperty('--reading-letter-spacing', '0.12em');
    root.style.setProperty('--reading-word-spacing', '0.2em');
    root.style.setProperty('--reading-line-height', '2.2');
    btn.innerHTML = 'Dyslexic 🧠';
  }
}

/** Track quiz result for analytics */
export function recordQuizResult(correct) {
  _state.quizzesAttempted++;
  if (correct) _state.quizzesCorrect++;
  updateReadingStats();
}

export async function quizMe(idx, e, apiKey) {
  if (e) e.stopPropagation();
  if (!apiKey) {
    showToast('Upload a PDF with your API key to use quizzes.', 'err');
    return;
  }

  const container = document.getElementById('quiz-' + idx);
  if (!container) return;

  if (container.classList.contains('quiz-visible')) {
    container.classList.remove('quiz-visible');
    return;
  }

  // Disable the quiz button during the API call
  const quizBtn = _state.allBlocks[idx]?.querySelector('.quiz-btn');
  if (quizBtn) {
    quizBtn.disabled = true;
    quizBtn.textContent = 'Loading…';
  }

  container.classList.add('quiz-visible');
  container.innerHTML = `
    <div class="q-box q-box-loading">
      <div class="q-label">AI Tutor</div>
      <p class="q-loading-text">Drafting a recall question...</p>
    </div>
  `;

  try {
    const text = _state.paragraphTexts[idx];
    const quiz = await generateQuizQuestion(text, apiKey);
    renderQuiz(idx, container, quiz);
  } catch (err) {
    console.error(err);
    container.innerHTML = `
      <div class="q-box quiz-error-box">
        <div class="q-label">Error</div>
        <p class="q-error-text">Failed to generate quiz question. Check your API key and network connection.</p>
      </div>
    `;
  } finally {
    if (quizBtn) {
      quizBtn.disabled = false;
      quizBtn.textContent = 'Quiz Me 🧠';
    }
  }
}

/** Toggle the mobile sidebar overlay */
export function toggleSidebar() {
  const sidebar = document.getElementById('rSidebar');
  if (sidebar) sidebar.classList.toggle('sidebar-open');
}
