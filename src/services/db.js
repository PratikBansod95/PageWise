const DB_NAME = 'zenith_db';
const DB_VERSION = 1;

export function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      
      // Store reading progress: key is docTitle
      if (!db.objectStoreNames.contains('progress')) {
        db.createObjectStore('progress', { keyPath: 'docTitle' });
      }
      
      // Store concepts/vocab mapping per doc: key is docTitle
      if (!db.objectStoreNames.contains('concepts')) {
        db.createObjectStore('concepts', { keyPath: 'docTitle' });
      }
    };
    
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

export async function saveProgress(docTitle, paragraphIndex) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('progress', 'readwrite');
    const store = tx.objectStore('progress');
    store.put({ docTitle, paragraphIndex });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getProgress(docTitle) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('progress', 'readonly');
    const store = tx.objectStore('progress');
    const req = store.get(docTitle);
    req.onsuccess = () => resolve(req.result ? req.result.paragraphIndex : -1);
    req.onerror = () => reject(req.error);
  });
}

export async function saveConcepts(docTitle, concepts) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('concepts', 'readwrite');
    const store = tx.objectStore('concepts');
    store.put({ docTitle, concepts });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getConcepts(docTitle) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('concepts', 'readonly');
    const store = tx.objectStore('concepts');
    const req = store.get(docTitle);
    req.onsuccess = () => resolve(req.result ? req.result.concepts : []);
    req.onerror = () => reject(req.error);
  });
}

export async function updateConceptMastery(docTitle, keyword, status) {
  const concepts = await getConcepts(docTitle);
  if (!concepts || !concepts.length) return;
  
  let updated = false;
  concepts.forEach(c => {
    if (c.keywords && c.keywords.some(k => k.toLowerCase() === keyword.toLowerCase())) {
      c.mastery = status; // 'new' | 'learning' | 'mastered'
      updated = true;
    }
  });
  
  if (updated) {
    await saveConcepts(docTitle, concepts);
  }
}
