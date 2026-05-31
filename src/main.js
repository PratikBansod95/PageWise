import { extractPDF } from './services/pdf-parser.js';
import { generateParagraphSummaries } from './services/gemini-api.js';
import { buildReader, collapseAll, chgFs, toggleFont, toggleByIndex, allBlocks, curIdx } from './components/reader-ui.js';
import { showToast } from './utils.js';
import { cancelSpeech } from './components/speech-reader.js';

// Setup pdf worker globally
window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let apiKey = sessionStorage.getItem('z_key') || '';

// Bind functions to window for HTML inline listeners compatibility
window.saveKey = saveKey;
window.handleFile = handleFile;
window.chgFs = chgFs;
window.collapseAll = collapseAll;
window.toggleFont = toggleFont;
window.goHome = goHome;

document.addEventListener('DOMContentLoaded', () => {
  if (apiKey) {
    const input = document.getElementById('apiKeyInput');
    if (input) input.value = apiKey;
  }
  
  // Setup Upload Zone
  const z = document.getElementById('uploadZone');
  if (z) {
    z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('drag-over'); });
    z.addEventListener('dragleave', () => z.classList.remove('drag-over'));
    z.addEventListener('drop', e => {
      e.preventDefault();
      z.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f && f.type === 'application/pdf') processFile(f);
      else showToast('Please drop a PDF file.', 'err');
    });
  }

  // Keyboard navigation
  document.addEventListener('keydown', e => {
    const reader = document.getElementById('reader');
    if (!reader || reader.style.display === 'none') return;
    
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      if (curIdx + 1 < allBlocks.length) toggleByIndex(curIdx + 1);
    }
    if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      if (curIdx - 1 >= 0) toggleByIndex(curIdx - 1);
    }
    if (e.key === 'Escape') collapseAll();
  });
});

export function saveKey() {
  const input = document.getElementById('apiKeyInput');
  const v = input ? input.value.trim() : '';
  if (!v.startsWith('AIza')) {
    showToast('Key should start with AIza…', 'err');
    return;
  }
  apiKey = v;
  sessionStorage.setItem('z_key', v);
  showToast('API key saved ✓', 'ok');
}

export function handleFile(e) {
  const f = e.target.files[0];
  if (f) processFile(f);
}

export async function processFile(file) {
  const input = document.getElementById('apiKeyInput');
  const key = (input ? input.value.trim() : '') || apiKey;
  if (!key.startsWith('AIza')) {
    showToast('Enter your Gemini API key first.', 'err');
    return;
  }
  apiKey = key;
  sessionStorage.setItem('z_key', key);
  show('processing');
  setStep(1);
  try {
    const { blocks, title } = await extractPDF(file);
    setStep(2);
    
    const summarised = await generateParagraphSummaries(blocks, title, key, (step) => setStep(step));
    setStep(4);
    
    buildReader(summarised, title, file.name, key);
    show('reader');
    document.getElementById('reader').classList.add('loaded');
  } catch (err) {
    show('landing');
    showToast('Error: ' + err.message, 'err');
    console.error(err);
  }
}

export function show(id) {
  ['landing', 'processing', 'reader'].forEach(s => {
    const el = document.getElementById(s);
    if (el) {
      el.style.display = s === id ? (s === 'processing' ? 'flex' : 'block') : 'none';
    }
  });
}

export function setStep(n) {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById('step' + i);
    if (el) {
      el.className = 'pstep' + (i < n ? ' done' : (i === n ? ' active' : ''));
    }
  }
}

export function goHome() {
  show('landing');
  const main = document.getElementById('rMain');
  const sidebar = document.getElementById('rSidebar');
  if (main) main.innerHTML = '';
  if (sidebar) sidebar.innerHTML = '';
  
  allBlocks.length = 0;
  
  // Reset file input
  const fileInput = document.getElementById('fileInput');
  if (fileInput) fileInput.value = '';
  
  const reader = document.getElementById('reader');
  if (reader) reader.classList.remove('loaded');
  
  cancelSpeech();
}
