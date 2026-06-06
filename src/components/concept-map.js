import { getConcepts, initDB } from '../services/db.js';

export function toggleConceptMap() {
  const modal = document.getElementById('conceptMapModal');
  if (!modal) return;
  
  const isHidden = modal.style.display === 'none';
  modal.style.display = isHidden ? 'flex' : 'none';
  
  if (isHidden) {
    renderCurrentConceptMap();
  }
}

// Bind to window for global access
window.toggleConceptMap = toggleConceptMap;

export async function renderCurrentConceptMap() {
  const container = document.getElementById('conceptMapContainer');
  if (!container) return;
  
  // Get active doc title
  const docTitleEl = document.getElementById('rDocName');
  const title = docTitleEl ? docTitleEl.textContent.trim() : 'Document';
  
  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--ink3); font-style: italic;">
      Loading Concept Map...
    </div>
  `;
  
  try {
    const concepts = await getConcepts(title);
    if (!concepts || concepts.length === 0) {
      container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--ink3); text-align: center; padding: 20px;">
          No concepts extracted for this document. Upload a new PDF to initialize.
        </div>
      `;
      return;
    }
    
    // Draw SVG
    const width = container.clientWidth || 650;
    const height = container.clientHeight || 350;
    const cx = width / 2;
    const cy = height / 2;
    
    let svgHtml = `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
    
    // Nodes lists
    const nodes = [];
    const links = [];
    
    // Central Node (Document Title)
    nodes.push({ id: 'root', label: title.substring(0, 15) + '...', x: cx, y: cy, type: 'root', r: 28, color: 'var(--accent)' });
    
    const sectionsCount = concepts.length;
    concepts.forEach((sec, sIdx) => {
      // Position Section Node
      const sAngle = (2 * Math.PI * sIdx) / sectionsCount;
      const sRadius = Math.min(width, height) * 0.26;
      const sx = cx + sRadius * Math.cos(sAngle);
      const sy = cy + sRadius * Math.sin(sAngle);
      const sId = `sec-${sIdx}`;
      
      nodes.push({ id: sId, label: sec.heading.substring(0, 12) + '...', x: sx, y: sy, type: 'section', r: 18, color: 'var(--ink)' });
      links.push({ from: 'root', to: sId });
      
      // Keywords/Concepts
      const keywords = sec.keywords || [];
      const kwCount = keywords.length;
      
      keywords.forEach((kw, kIdx) => {
        // Spread keywords in an arc around the section angle
        let kwAngle = sAngle;
        if (kwCount > 1) {
          const arcWidth = 0.8; // radians span
          kwAngle = sAngle - arcWidth / 2 + (arcWidth * kIdx) / (kwCount - 1);
        }
        
        const kwRadius = Math.min(width, height) * 0.43;
        const kx = cx + kwRadius * Math.cos(kwAngle);
        const ky = cy + kwRadius * Math.sin(kwAngle);
        const kId = `kw-${sIdx}-${kIdx}`;
        
        let nodeColor = '#9CA3AF'; // new (gray)
        if (sec.mastery === 'learning') nodeColor = 'var(--gold)';
        else if (sec.mastery === 'mastered') nodeColor = '#10B981';
        
        nodes.push({ id: kId, label: kw, x: kx, y: ky, type: 'keyword', r: 10, color: nodeColor, mastery: sec.mastery || 'new', sectionHeading: sec.heading });
        links.push({ from: sId, to: kId });
      });
    });
    
    // Render links first so they draw behind nodes
    links.forEach(l => {
      const fromNode = nodes.find(n => n.id === l.from);
      const toNode = nodes.find(n => n.id === l.to);
      if (fromNode && toNode) {
        svgHtml += `<line class="link-line" x1="${fromNode.x}" y1="${fromNode.y}" x2="${toNode.x}" y2="${toNode.y}" />`;
      }
    });
    
    // Render nodes
    nodes.forEach(n => {
      let strokeColor = 'var(--rule)';
      if (n.type === 'root') strokeColor = 'var(--accent-glow)';
      
      svgHtml += `
        <g class="node-g" style="cursor: pointer;" onclick="window.clickConceptNode('${n.label}', '${n.type}', '${n.mastery || ''}', '${n.sectionHeading || ''}')">
          <circle class="node-circle" cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${n.color}" stroke="${strokeColor}" stroke-width="2" />
          <text class="node-text" x="${n.x}" y="${n.y + (n.type === 'keyword' ? 18 : 4)}" fill="var(--ink)">
            ${n.label}
          </text>
        </g>
      `;
    });
    
    svgHtml += `</svg>`;
    container.innerHTML = svgHtml;
    
  } catch (err) {
    console.error("Error drawing concept map:", err);
    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--ink3); padding: 20px; text-align: center;">
        Failed to load concept map. Error: ${err.message}
      </div>
    `;
  }
}

// Click detail handler
window.clickConceptNode = function(label, type, mastery, sectionHeading) {
  if (type !== 'keyword') return;
  const statusLabels = {
    'new': '🔴 Unattempted (Pass quiz on this topic to master it)',
    'learning': '🟡 Learning (Keep taking quizzes to improve your retention)',
    'mastered': '🟢 Mastered (Excellent score achieved!)'
  };
  alert(`Concept: ${label}\nSection: ${sectionHeading}\nStatus: ${statusLabels[mastery] || 'Unattempted'}`);
};
