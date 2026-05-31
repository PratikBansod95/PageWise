import { escHtml } from '../utils.js';

/**
 * Component to handle Active Recall comprehension quizzes.
 * Renders multiple-choice questions programmatically and manages submit answers.
 */

export function renderQuiz(idx, container, quiz) {
  container.dataset.answer = quiz.answerIndex;
  container.dataset.explanation = quiz.explanation;

  container.innerHTML = `
    <div class="q-box" style="border-left: 3px solid var(--gold); margin: 12px 0 0 0; background: var(--paper);">
      <div class="q-label">Recall Quiz</div>
      <p style="font-family: 'Lora', serif; font-size: 13.5px; font-weight: 500; color: var(--ink); margin-bottom: 12px;">${escHtml(quiz.question)}</p>
      <div class="quiz-options"></div>
      <div class="quiz-feedback" style="display: none; margin-top: 12px; font-size: 12.5px; line-height: 1.5; font-family: var(--reading-font);"></div>
    </div>
  `;

  const optionsContainer = container.querySelector('.quiz-options');
  quiz.options.forEach((opt, oidx) => {
    const btn = document.createElement('button');
    btn.className = 'quiz-opt-btn';
    btn.textContent = opt;
    btn.addEventListener('click', () => submitAnswer(idx, oidx, container));
    optionsContainer.appendChild(btn);
  });
}

export function submitAnswer(idx, oidx, container) {
  const correctIdx = parseInt(container.dataset.answer);
  const explanation = container.dataset.explanation;

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
  feedback.style.display = 'block';
  if (oidx === correctIdx) {
    feedback.className = 'quiz-feedback correct';
    feedback.innerHTML = `<strong>Correct! 🎉</strong> ${escHtml(explanation)}`;
  } else {
    feedback.className = 'quiz-feedback incorrect';
    feedback.innerHTML = `<strong>Incorrect ❌</strong> ${escHtml(explanation)}`;
  }
}
