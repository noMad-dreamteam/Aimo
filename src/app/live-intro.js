// A calm welcome before any exercise is measured. No claims about camera observations.
export function liveWelcome({ name = '', personality = 'calm' } = {}) {
  const firstName = String(name || '').trim().slice(0, 24);
  const greeting = firstName ? `Привет, ${firstName}!` : 'Привет!';
  const tone = {
    strict: 'Рад тебя видеть. Начнём спокойно, без спешки.',
    fun: 'Рад тебя видеть! Сегодня потренируемся вместе, шаг за шагом.',
    calm: 'Рад тебя видеть. Я рядом и помогу тебе, шаг за шагом.',
  };
  return `${greeting} ${tone[personality] || tone.calm} Выбери навык вверху экрана. Затем нажми «Начать эфир». Не торопись. Когда будешь готов, начнём.`;
}

// Slower choices stay slower; live instructions never rush, even with a fast preview setting.
export function liveSpeechRate(rate, greeting = false) {
  return Math.max(0.5, Math.min(Number.isFinite(rate) ? rate : 0.7, greeting ? 0.65 : 0.7));
}
