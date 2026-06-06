/**
 * Component to handle Web Speech Synthesis (Text-to-Speech) for paragraphs.
 * Manages active speaking state, button highlights, and navigation events.
 */

let activeSpeechIdx = -1;
let paragraphTextsRef = null;
let allBlocksRef = null;

export function initSpeech(paragraphTexts, allBlocks) {
  paragraphTextsRef = paragraphTexts;
  allBlocksRef = allBlocks;
  activeSpeechIdx = -1;
  cancelSpeech();
}

export function readAloud(idx, e) {
  if (e) e.stopPropagation();
  if (!window.speechSynthesis) {
    if (window.showToast) {
      window.showToast('Text-to-speech is not supported in this browser.', 'err');
    } else {
      alert('Text-to-speech is not supported in this browser.');
    }
    return;
  }
  
  if (window.speechSynthesis.speaking && activeSpeechIdx === idx) {
    cancelSpeech();
    return;
  }
  
  window.speechSynthesis.cancel();
  const text = paragraphTextsRef ? paragraphTextsRef[idx] : null;
  if (!text) return;
  
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.95;
  utterance.pitch = 1.0;
  
  // Prefer a natural-sounding voice if available
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) {
    const preferred = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Enhanced') || v.name.includes('Google')))
      || voices.find(v => v.lang.startsWith('en') && !v.localService)
      || voices.find(v => v.lang.startsWith('en'));
    if (preferred) utterance.voice = preferred;
  }
  
  utterance.onboundary = (event) => {
    if (event.name === 'word' && window.onTTSBoundary) {
      window.onTTSBoundary(idx, event.charIndex);
    }
  };

  utterance.onend = () => {
    if (activeSpeechIdx === idx) {
      activeSpeechIdx = -1;
      updateSpeechButtons();
      if (window.onTTSEnd) window.onTTSEnd(idx);
    }
  };
  utterance.onerror = () => {
    if (activeSpeechIdx === idx) {
      activeSpeechIdx = -1;
      updateSpeechButtons();
      if (window.onTTSEnd) window.onTTSEnd(idx);
    }
  };
  
  if (window.onTTSStart) {
    window.onTTSStart(idx, text);
  }
  
  activeSpeechIdx = idx;
  window.speechSynthesis.speak(utterance);
  updateSpeechButtons();
}

export function cancelSpeech() {
  const oldIdx = activeSpeechIdx;
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  activeSpeechIdx = -1;
  updateSpeechButtons();
  if (oldIdx !== -1 && window.onTTSEnd) {
    window.onTTSEnd(oldIdx);
  }
}

export function getActiveSpeechIdx() {
  return activeSpeechIdx;
}

export function updateSpeechButtons() {
  if (!allBlocksRef) return;
  allBlocksRef.forEach((div, idx) => {
    const btn = div.querySelector('.tts-btn');
    if (btn) {
      if (activeSpeechIdx === idx) {
        btn.innerHTML = 'Stop ⏹';
        btn.classList.add('active-speaking');
      } else {
        btn.innerHTML = 'Listen 🔊';
        btn.classList.remove('active-speaking');
      }
    }
  });
}
