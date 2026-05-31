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
      btn.style.borderColor = '#2A7A4A';
      btn.style.background = 'rgba(42, 122, 74, 0.06)';
      btn.style.color = '#2A7A4A';
      btn.style.fontWeight = '600';
    } else if (bidx === oidx) {
      btn.style.borderColor = '#8B2020';
      btn.style.background = 'rgba(139, 32, 32, 0.06)';
      btn.style.color = '#8B2020';
    } else {
      btn.style.opacity = '0.5';
    }
  });

  const feedback = container.querySelector('.quiz-feedback');
  feedback.style.display = 'block';
  if (oidx === correctIdx) {
    feedback.innerHTML = `<strong style="color: #2A7A4A;">Correct! 🎉</strong> ${escHtml(explanation)}`;
  } else {
    feedback.innerHTML = `<strong style="color: #8B2020;">Incorrect ❌</strong> ${escHtml(explanation)}`;
  }
}
