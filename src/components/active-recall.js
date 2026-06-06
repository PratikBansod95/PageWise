import { escHtml } from '../utils.js';
import { recordQuizResult } from './reader-ui.js';

/**
 * Component to handle Active Recall comprehension quizzes.
 * Renders multiple-choice questions programmatically and manages submit answers.
 */

export function renderQuiz(idx, container, quiz) {
  container.dataset.answer = quiz.answerIndex;
  container.dataset.explanation = quiz.explanation;

  container.innerHTML = `
    <div class="q-box q-box-quiz">
      <div class="q-label">Recall Quiz</div>
      <p class="q-question">${escHtml(quiz.question)}</p>
      <div class="quiz-options" role="group" aria-label="Answer options"></div>
      <div class="quiz-feedback" role="alert" aria-live="polite"></div>
    </div>
  `;

  const optionsContainer = container.querySelector('.quiz-options');
  quiz.options.forEach((opt, oidx) => {
    const btn = document.createElement('button');
    btn.className = 'quiz-opt-btn';
    btn.textContent = opt;
    btn.setAttribute('aria-label', `Option ${oidx + 1}: ${opt}`);
    btn.addEventListener('click', () => submitAnswer(idx, oidx, container));
    optionsContainer.appendChild(btn);
  });
}

import { getConcepts, saveConcepts } from '../services/db.js';

export function submitAnswer(idx, oidx, container) {
  const correctIdx = parseInt(container.dataset.answer);
  const explanation = container.dataset.explanation;
  const isCorrect = oidx === correctIdx;

  // Track analytics
  recordQuizResult(isCorrect);

  const buttons = container.querySelectorAll('.quiz-opt-btn');
  buttons.forEach((btn, bidx) => {
    btn.disabled = true;
    if (bidx === correctIdx) {
      btn.classList.add('correct');
    } else if (bidx === oidx) {
      btn.classList.add('incorrect');
    } else {
      btn.classList.add('muted');
    }
  });

  const feedback = container.querySelector('.quiz-feedback');
  feedback.classList.add('feedback-visible');
  if (isCorrect) {
    feedback.className = 'quiz-feedback feedback-visible correct';
    feedback.innerHTML = `<strong>Correct! 🎉</strong> ${escHtml(explanation)}`;
  } else {
    feedback.className = 'quiz-feedback feedback-visible incorrect';
    feedback.innerHTML = `<strong>Incorrect ❌</strong> ${escHtml(explanation)}`;
  }

  // Update concept mastery status in IndexedDB
  const docTitleEl = document.getElementById('rDocName');
  const docTitle = docTitleEl ? docTitleEl.textContent.trim() : '';
  
  const blockEl = container.closest('.para-block');
  let sectionHeading = '';
  if (blockEl) {
    let prev = blockEl.previousElementSibling;
    while (prev) {
      if (prev.classList.contains('c-h1') || prev.classList.contains('c-h2') || prev.classList.contains('c-h3')) {
        sectionHeading = prev.textContent.trim();
        break;
      }
      prev = prev.previousElementSibling;
    }
  }

  if (docTitle && sectionHeading) {
    getConcepts(docTitle).then(concepts => {
      if (concepts && concepts.length > 0) {
        const matchingSec = concepts.find(c => c.heading.trim().toLowerCase() === sectionHeading.toLowerCase());
        if (matchingSec) {
          // If already mastered, don't demote to learning on a single mistake, or we can just update it
          matchingSec.mastery = isCorrect ? 'mastered' : 'learning';
          saveConcepts(docTitle, concepts).then(() => {
            console.log(`Updated mastery of concept "${sectionHeading}" to: ${matchingSec.mastery}`);
          });
        }
      }
    }).catch(e => console.error("Failed to update concept mastery:", e));
  }
}
