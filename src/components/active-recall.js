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
}
