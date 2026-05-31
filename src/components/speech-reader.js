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
  utterance.onend = () => {
    if (activeSpeechIdx === idx) {
      activeSpeechIdx = -1;
      updateSpeechButtons();
    }
  };
  utterance.onerror = () => {
    if (activeSpeechIdx === idx) {
      activeSpeechIdx = -1;
      updateSpeechButtons();
    }
  };
  
  activeSpeechIdx = idx;
  window.speechSynthesis.speak(utterance);
  updateSpeechButtons();
}

export function cancelSpeech() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  activeSpeechIdx = -1;
  updateSpeechButtons();
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
