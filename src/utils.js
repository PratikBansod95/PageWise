/**
 * Shared utility functions.
 */

export function slug(t) {
  return t.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').substring(0, 40);
}

export function splitSents(t) {
  const r = t.split(/(?<=[.!?])\s+/);
  const out = [];
  let buf = '';
  for (const s of r) {
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

export function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '') + ' show';
  setTimeout(() => t.classList.remove('show'), 3500);
}

// Bind to window for backwards compatibility if needed, or inline use
window.showToast = showToast;
