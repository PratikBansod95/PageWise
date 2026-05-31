import { slug, splitSents, escHtml, showToast } from '../utils.js';
import { initSpeech, readAloud, cancelSpeech } from './speech-reader.js';
import { generateQuizQuestion } from '../services/gemini-api.js';
import { renderQuiz } from './active-recall.js';

/**
 * Component to handle Reader UI rendering, font adjustments, paragraph toggles,
 * and page progress tracking.
 */

export let allBlocks = [];
export let paragraphTexts = [];
export let curIdx = -1;
export let fontSize = 18;
export let fontMode = 0; // 0: Serif, 1: Sans-Serif, 2: Dyslexic Style

export function buildReader(blocks, title, fname, apiKey) {
  const main = document.getElementById('rMain');
  const sidebar = document.getElementById('rSidebar');
  if (!main || !sidebar) return;

  document.getElementById('rDocName').textContent = fname.replace(/\.pdf$/i, '');
  main.innerHTML = '';
  sidebar.innerHTML = '<span class="sb-label">Contents</span>';
  
  allBlocks.length = 0;
  paragraphTexts.length = 0;
  curIdx = -1;

  // Chapter label
  const clabel = document.createElement('div');
  clabel.className = 'book-chapter-label fade-up';
  clabel.textContent = 'Your Focus Book';
  main.appendChild(clabel);

  // Book page container
  const page = document.createElement('div');
  page.className = 'book-page';
  main.appendChild(page);

  // Doc title
  const titleEl = document.createElement('div');
  titleEl.className = 'doc-title fade-up';
  titleEl.textContent = title;
  page.appendChild(titleEl);

  let pi = 0;
  let delay = 0;
  for (const b of blocks) {
    if (b.type === 'pagebreak') {
      const pm = document.createElement('div');
      pm.className = 'pg-turn';
      pm.innerHTML = `<div class="pg-turn-line"></div><span class="pg-turn-badge">Page ${b.page}</span><div class="pg-turn-line"></div>`;
      page.appendChild(pm);
      continue;
    }
    if (b.type === 'h1') {
      const el = document.createElement('div');
      el.className = 'c-h1 fade-up';
      el.id = 'h-' + slug(b.text);
      el.textContent = b.text;
      page.appendChild(el);
      addSbItem(sidebar, b.text, el, 'h1');
      continue;
    }
    if (b.type === 'h2') {
      const el = document.createElement('div');
      el.className = 'c-h2 fade-up';
      el.id = 'h-' + slug(b.text);
      el.textContent = b.text;
      page.appendChild(el);
      addSbItem(sidebar, b.text, el, 'h2');
      continue;
    }
    if (b.type === 'h3') {
      const el = document.createElement('div');
      el.className = 'c-h3 fade-up';
      el.id = 'h-' + slug(b.text);
      el.textContent = b.text;
      page.appendChild(el);
      addSbItem(sidebar, b.text, el, 'h3');
      continue;
    }
    if (b.type === 'paragraph') {
      const idx = pi;
      paragraphTexts.push(b.text);

      const isSkip = b.summary === '__skip__';
      const div = document.createElement('div');
      div.className = 'para-block fade-up' + (isSkip ? ' skip-summary' : '');
      div.style.animationDelay = Math.min(delay * 20, 300) + 'ms';
      div.dataset.index = idx;

      const sents = splitSents(b.text).map(s => `<p>${escHtml(s)}</p>`).join('');
      
      const summaryRowHtml = isSkip ? '' : `
        <div class="para-summary-row">
          <span class="para-sum-text">${escHtml(b.summary || '…')}</span>
        </div>`;
        
      const actionsHtml = isSkip ? '' : `
            <div class="para-actions" style="margin-top: 16px; display: flex; gap: 8px; border-top: 1px solid var(--rule); padding-top: 12px;">
              <button class="r-btn tts-btn">Listen 🔊</button>
              <button class="r-btn quiz-btn">Quiz Me 🧠</button>
            </div>
            <div class="para-quiz-container" id="quiz-${idx}" style="display: none; width: 100%;"></div>`;

      div.innerHTML = `
        ${summaryRowHtml}
        <div class="para-full">
          <div class="para-full-inner" style="${isSkip ? 'border-left: none; margin-left: 0; padding: 0;' : ''}">
            ${sents}
            ${actionsHtml}
          </div>
        </div>`;

      // Bind events programmatically
      div.addEventListener('click', (e) => {
        if (isSkip) return;
        if (e.target.closest('button, input, a, .quiz-opt-btn, .quiz-feedback')) {
          return;
        }
        toggle(idx);
      });
      if (!isSkip) {
        div.querySelector('.tts-btn').addEventListener('click', (e) => readAloud(idx, e));
        div.querySelector('.quiz-btn').addEventListener('click', (e) => quizMe(idx, e, apiKey));
      }

      page.appendChild(div);
      allBlocks.push(div);
      pi++;
      delay++;
    }
  }

  // Page number at bottom
  const pgnum = document.createElement('div');
  pgnum.className = 'pg-num-display';
  pgnum.textContent = '— Pagewise Focus Edition —';
  page.appendChild(pgnum);

  // Initialize Speech Synthesizer with refs
  initSpeech(paragraphTexts, allBlocks);

  window.addEventListener('scroll', updateProg, { passive: true });
  updateProg();
}

function addSbItem(sb, text, el, cls) {
  const btn = document.createElement('button');
  btn.className = `sb-item ${cls}`;
  btn.textContent = text.length > 42 ? text.substring(0, 42) + '…' : text;
  btn.onclick = () => el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  sb.appendChild(btn);
}

export function toggle(idx) {
  const b = allBlocks[idx];
  if (!b) return;
  const wasActive = b.classList.contains('active');
  allBlocks.forEach(x => x.classList.remove('active'));
  if (!wasActive) {
    b.classList.add('active');
    curIdx = idx;
    setTimeout(() => {
      const r = b.getBoundingClientRect();
      if (r.top < 64 || r.bottom > window.innerHeight - 40) {
        b.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 60);
  } else {
    curIdx = -1;
  }
}

export function toggleByIndex(idx) {
  if (idx >= 0 && idx < allBlocks.length) {
    toggle(idx);
  }
}

export function collapseAll() {
  allBlocks.forEach(b => b.classList.remove('active'));
  curIdx = -1;
  cancelSpeech();
}

export function updateProg() {
  const rProg = document.getElementById('rProg');
  if (!rProg) return;
  const s = window.scrollY;
  const d = document.documentElement.scrollHeight - window.innerHeight;
  rProg.style.width = (d > 0 ? (s / d) * 100 : 0) + '%';
}

export function chgFs(d) {
  fontSize = Math.max(13, Math.min(26, fontSize + d));
  const label = document.getElementById('fsLabel');
  if (label) label.textContent = fontSize;
  document.documentElement.style.setProperty('--rfs', fontSize + 'px');
}

export function toggleFont() {
  fontMode = (fontMode + 1) % 3;
  const btn = document.getElementById('fontToggleBtn');
  const root = document.documentElement;
  if (!btn) return;

  if (fontMode === 0) {
    root.style.setProperty('--reading-font', "'Lora', serif");
    root.style.setProperty('--reading-letter-spacing', 'normal');
    root.style.setProperty('--reading-word-spacing', 'normal');
    root.style.setProperty('--reading-line-height', '1.9');
    btn.innerHTML = 'Serif 📖';
  } else if (fontMode === 1) {
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

export async function quizMe(idx, e, apiKey) {
  if (e) e.stopPropagation();
  const container = document.getElementById('quiz-' + idx);
  if (!container) return;

  if (container.style.display === 'block') {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  container.innerHTML = `
    <div class="q-box" style="border-left: 3px solid var(--gold); margin: 12px 0 0 0; background: var(--paper);">
      <div class="q-label">AI Tutor</div>
      <p style="font-family: 'Lora', serif; font-size: 13px; font-style: italic; color: var(--ink3);">Drafting a recall question...</p>
    </div>
  `;

  try {
    const text = paragraphTexts[idx];
    const quiz = await generateQuizQuestion(text, apiKey);
    renderQuiz(idx, container, quiz);
  } catch (err) {
    console.error(err);
    container.innerHTML = `
      <div class="q-box" style="border-left: 3px solid #8B2020; background: #FFF5F5; color: #8B2020; margin: 12px 0 0 0;">
        <div class="q-label" style="color: #8B2020;">Error</div>
        <p style="font-size: 12.5px;">Failed to generate quiz question. Check your API key and network connection.</p>
      </div>
    `;
  }
}
