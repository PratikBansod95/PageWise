/**
 * Shared utility functions.
 */

export function slug(t) {
  return t.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').substring(0, 40);
}

/**
 * Split text into displayable sentence groups, avoiding breaks on
 * common abbreviations like Dr., Mr., Mrs., Fig., e.g., i.e., etc.
 */
export function splitSents(t) {
  // Replace known abbreviation periods with a placeholder
  const ABBR_PLACEHOLDER = '\u200B'; // zero-width space
  const abbrs = /\b(Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|Fig|fig|Vol|vol|No|no|vs|etc|al|approx|dept|est|govt|inc|corp|ltd|co|assn|e\.g|i\.e|cf|viz)\./gi;
  const safe = t.replace(abbrs, (match) => match.slice(0, -1) + ABBR_PLACEHOLDER);

  // Split on actual sentence-ending punctuation followed by space
  const r = safe.split(/(?<=[.!?]['"]?)\s+/);

  // Restore placeholders
  const restored = r.map(s => s.replace(new RegExp(ABBR_PLACEHOLDER, 'g'), '.'));

  const out = [];
  let buf = '';
  for (const s of restored) {
    buf += (buf ? ' ' : '') + s;
    if (buf.length > 130) {
      out.push(buf);
      buf = '';
    }
  }
  if (buf) out.push(buf);
  return out.length ? out : [t];
}

export function escHtml(t) {
  return String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let _toastTimer = null;

/**
 * Show a toast notification. Debounced — rapid calls replace the
 * previous toast and reset the timer instead of stacking.
 */
export function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  if (!t) return;

  // Clear any pending hide timer
  if (_toastTimer) {
    clearTimeout(_toastTimer);
    _toastTimer = null;
  }

  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '') + ' show';
  _toastTimer = setTimeout(() => {
    t.classList.remove('show');
    _toastTimer = null;
  }, 3500);
}

// Bind to window for backwards compatibility if needed, or inline use
window.showToast = showToast;

/**
 * Formats a text block with bionic reading styling (bolding word prefixes).
 */
export function formatBionic(text) {
  if (!text) return '';
  return text.split(/\s+/).map(word => {
    if (word.length <= 1) return word;
    
    // Check if the alphabetical part exists
    const match = word.match(/^([^a-zA-Z0-9]*)(.*?)([^a-zA-Z0-9]*)$/);
    if (!match) return word;
    const prefix = match[1];
    const core = match[2];
    const suffix = match[3];
    
    if (core.length <= 1) return word;
    
    const coreBoldLen = Math.ceil(core.length * 0.4) || 1;
    const boldPart = core.substring(0, coreBoldLen);
    const regularPart = core.substring(coreBoldLen);
    
    return `${prefix}<b>${boldPart}</b>${regularPart}${suffix}`;
  }).join(' ');
}
