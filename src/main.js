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
window.scrollToWorkspace = scrollToWorkspace;
window.switchHeroTab = switchHeroTab;
window.clickMockPara = clickMockPara;
window.loadDemoDoc = loadDemoDoc;

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

export function scrollToWorkspace() {
  const ws = document.getElementById('workspaceSection');
  if (ws) {
    ws.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

export function switchHeroTab(tab) {
  const uploadBtn = document.getElementById('tabUploadBtn');
  const demoBtn = document.getElementById('tabDemoBtn');
  const uploadContent = document.getElementById('tabContentUpload');
  const demoContent = document.getElementById('tabContentDemo');
  
  if (tab === 'upload') {
    uploadBtn?.classList.add('active');
    demoBtn?.classList.remove('active');
    uploadContent?.classList.add('active');
    demoContent?.classList.remove('active');
  } else {
    demoBtn?.classList.add('active');
    uploadBtn?.classList.remove('active');
    demoContent?.classList.add('active');
    uploadContent?.classList.remove('active');
  }
}

export function clickMockPara(el) {
  const blocks = document.querySelectorAll('.mock-para-block');
  const isActive = el.classList.contains('active');
  blocks.forEach(b => b.classList.remove('active'));
  if (!isActive) {
    el.classList.add('active');
  }
}

const DEMO_BLOCKS = [
  { type: 'h1', text: 'The Biology of Learning: Synaptic Plasticity' },
  { type: 'pagebreak', page: 1 },
  { type: 'h2', text: '1. What Happens in the Brain When You Study?' },
  { type: 'paragraph', text: 'Every time you learn something new, your brain physically changes. This is due to a phenomenon called synaptic plasticity, which is the ability of connections between neurons—called synapses—to strengthen or weaken over time in response to increases or decreases in their activity. When you review material, you repeatedly fire the same neural pathways, making those connections more efficient.', summary: '✦ Your brain rewires itself physically and strengthens connections when studying new concepts.' },
  { type: 'paragraph', text: 'In the mid-20th century, neuroscientist Donald Hebb famously summarized this process: "neurons that fire together, wire together." This means that when two neurons are activated at the same time, the synapse between them undergoes chemical changes that make it easier for them to communicate in the future. This form of synaptic enhancement is known as Long-Term Potentiation (LTP).', summary: '✦ Neurons firing together strengthen synapses chemically via Long-Term Potentiation.' },
  { type: 'h2', text: '2. The Myth of Multitasking' },
  { type: 'paragraph', text: 'Many students believe they can study effectively while listening to music, watching videos, or messaging friends. However, cognitive psychology shows that the human brain cannot focus on two complex tasks simultaneously. Instead, the brain rapidly switches back and forth between tasks. This switching incurs a "cognitive switch cost," which depletes your mental energy, slows down your learning speed, and increases the rate of errors.', summary: '✦ Multitasking triggers rapid cognitive switching, draining mental energy and causing errors.' },
  { type: 'paragraph', text: 'To achieve deep learning, you must enter a state of "Flow"—a psychological term coined by Mihaly Csikszentmihalyi. Flow is a state of deep absorption and focus where a person is fully immersed in their current activity. In this state, distractions are naturally filtered out, time seems to warp, and the efficiency of synaptic plasticity increases dramatically because of focused neurotransmitter release.', summary: '✦ Entering a state of flow filters out distractions and increases study efficiency.' },
];

export function loadDemoDoc() {
  show('reader');
  buildReader(DEMO_BLOCKS, 'The Biology of Learning: Synaptic Plasticity', 'biology_of_learning_demo.pdf', 'demo-key');
  document.getElementById('reader')?.classList.add('loaded');
  showToast('Loaded demo document ✓', 'ok');
}
