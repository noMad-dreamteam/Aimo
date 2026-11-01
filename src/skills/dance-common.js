// Observable beginner dance combinations, not a choreography similarity score.
import { stanceLesson, repLesson, REP_MARKS } from './common.js';
import { puppet, wave } from './puppet.js';
import { rhythmSpread } from '../coach/motion.js';

export function dancePose(open, { aspect = 9 / 16, variant = 'zolo', arms = true, legs = true } = {}) {
  const zolo = variant === 'zolo';
  const amount = legs ? open : 0;
  const leg = zolo ? { thigh: 12 + 16 * amount, shin: 12 - 14 * amount } : { thigh: 2 + 20 * amount };
  const a = arms ? open : 0;
  const arm = zolo ? { upper: 8 + 82 * a, fore: 10 + 150 * a } : { upper: 20 - 45 * a, fore: 10 + 170 * a };
  return puppet({ aspect, size: 0.72, legs: [leg, leg], arms: [arm, arm] });
}

function shape(f, variant) {
  const width = Math.max(0.03, f.shoulderWidth);
  const spread = f.ankleGap / width;
  const wrists = f.loose.wrist;
  const lift = f.wristLift;
  const down = lift.every(v => Number.isFinite(v) && v < -0.4);
  if (variant === 'zolo') {
    const wide = spread > 1.3;
    return { closed: wide && down && f.knee.every(v => Number.isFinite(v) && v > 168),
      arms: lift.every(v => Number.isFinite(v) && v > 0.2) && f.elbow.every(v => Number.isFinite(v) && v < 145),
      legs: wide && f.knee.every(v => Number.isFinite(v) && v < 164) };
  }
  const together = wrists.every(Boolean) && Math.abs(wrists[0].x - wrists[1].x) / width < 0.45;
  return { closed: spread < 1.1 && down, arms: together && lift.every(v => v > -0.45 && v < 0.7), legs: spread > 1.5 };
}
const tones = lines => ({ strict: [...lines], fun: lines.map(s => `Лови движение! ${s}`), calm: lines.map(s => `Не спеши. ${s}`) });

export function makeDanceSkill({ id, name, short, emoji, variant, tagline, description, reference = null }) {
  const armAdvice = variant === 'zolo' ? 'Подними согнутые руки к голове, затем опусти.' : 'Сведи ладони перед грудью, затем опусти руки.';
  const legAdvice = variant === 'zolo' ? 'Стопы широко. Мягко согни колени и выпрямись без прыжка.' : 'Шагни в сторону и верни стопу обратно без прыжка.';
  const instruction = `${legAdvice} ${armAdvice}`;
  const startingFeet = variant === 'zolo' ? 'Стопы шире плеч.' : 'Стопы рядом.';
  return {
    id, name, short, emoji, category: 'dance', level: 'Новичок', minutes: 4, needsBall: false,
    goal: `Осваиваю ${name.toLowerCase()}`, tagline, description, reference,
    camera: 'Телефон вертикально в 2–3 метрах, лицом к нему. В кадре целиком руки, колени и стопы. Освободи место вокруг.',
    metric: { key: 'reps', label: 'связок', forms: ['связка', 'связки', 'связок'], progress: 'Танцевальные связки', rhythmWords: ['связки', 'связками'] },
    view(f) {
      if (!f.legVisible.every(Boolean)) return 'show-feet';
      if (!f.armVisible.every(Boolean)) return 'show-body';
      return f.facing < 0.3 ? 'turn-front' : null;
    },
    measure({ f, still, now }, memo = { cur: null, count: 0, clean: 0, times: [] }) {
      const m = { ...memo, cur: memo.cur ? { ...memo.cur } : null, times: [...memo.times] };
      const s = shape(f, variant);
      let event = null, milestone = null;
      if (!m.cur) { if (s.closed) m.cur = { phase: 'closed' }; }
      else if (m.cur.phase === 'closed') {
        if (s.arms || s.legs) m.cur = { phase: 'open', since: now, bothFrames: 0, coordinated: false, arms: false, legs: false, returnFrames: 0 };
      } else {
        const c = m.cur;
        c.arms ||= s.arms; c.legs ||= s.legs;
        c.bothFrames = s.arms && s.legs ? c.bothFrames + 1 : 0;
        c.coordinated ||= c.bothFrames >= 3;
        c.returnFrames = s.closed ? c.returnFrames + 1 : 0;
        if (now - c.since > 5000) m.cur = null;
        else if (c.returnFrames >= 2) {
          const errors = [];
          if (!c.arms) errors.push('dance-arms');
          if (!c.legs) errors.push('dance-legs');
          if (!c.coordinated || now - c.since < 220) {
            if (!errors.length) errors.push('dance-together');
            event = { type: 'attempt', errors };
          } else {
            m.times = m.times.length && now - m.times.at(-1) > 5000 ? [now] : [...m.times, now].slice(-8);
            if (m.times.length >= 6 && rhythmSpread(m.times) > 0.35) errors.push('dance-tempo');
            m.count++; if (!errors.length) m.clean++;
            event = { type: 'rep', errors, clean: !errors.length };
            if (REP_MARKS.includes(m.count)) milestone = { tag: 'dance-good', vars: { reps: m.count } };
          }
          m.cur = { phase: 'closed' };
        }
      }
      return { memo: m, event, milestone, phase: m.cur?.phase || 'idle', activity: m.cur?.phase === 'open' || Boolean(event),
        ready: still && s.closed, counts: { reps: m.count, clean: m.clean } };
    },
    lessons: [
      stanceLesson({ seconds: 2, goal: `${variant === 'zolo' ? 'Стопы шире плеч' : 'Стопы рядом'}, руки вниз. Постой 2 секунды.`,
        intro: { strict: `Встань лицом к камере. ${startingFeet} Руки вниз. Постой две секунды.`, fun: `Начнём со стойки! ${startingFeet} Лицом ко мне, руки вниз, две секунды спокойно.`, calm: `Встань лицом к камере. ${startingFeet} Опусти руки и постой две секунды.` } }),
      repLesson({ id: 'five', title: 'Пять связок медленно', short: '5 связок', target: 5, goal: instruction,
        intro: { strict: `Пять связок. ${instruction}`, fun: `Разберём танец по частям! Пять связок. ${instruction}`, calm: `Сделай пять связок медленно. ${instruction}` } }),
      repLesson({ id: 'eight', title: 'Восемь связок вместе', short: '8 связок', target: 8, goal: `Восемь связок в удобном ровном темпе. ${instruction}`,
        intro: { strict: 'Восемь связок подряд. Руки и ноги вместе, без спешки.', fun: 'Собираем маленький танец! Восемь связок в своём темпе.', calm: 'Теперь восемь связок подряд. Согласуй руки и ноги, дыши свободно.' } }),
    ],
    errors: {
      'dance-arms': { label: 'Не завершено движение рук', advice: armAdvice, priority: 3 },
      'dance-legs': { label: 'Не завершено движение ног', advice: legAdvice, priority: 3 },
      'dance-together': { label: 'Руки и ноги двигались отдельно или слишком коротко', advice: 'Соедини руки и ноги в одно движение, затем вернись в исходное положение.', priority: 2 },
      'dance-tempo': { label: 'Неравномерные интервалы между связками', advice: 'Выбери удобный ровный темп. Музыку тренер не анализирует.', priority: 1 },
    },
    phrases: {
      'dance-arms': tones([armAdvice, `Добавь руки. ${armAdvice}`, 'Сделай движение рук до конца.', 'Начни медленнее, чтобы успевали руки.', 'Покажи полное движение обеими руками.']),
      'dance-legs': tones([legAdvice, `Добавь ноги. ${legAdvice}`, 'Не оставляй ноги неподвижными.', 'Сделай движение ног до конца.', 'Покажи работу ног, потом вернись в стойку.']),
      'dance-together': tones(['Руки и ноги двигаются вместе.', 'Соедини обе части связки.', 'Чуть медленнее, чтобы согласовать руки и ноги.', 'Одна связка — одно совместное движение.', 'Вернись в стойку и повтори руками и ногами вместе.']),
      'dance-tempo': tones(['Держи ровный удобный темп.', 'Считай про себя раз-два.', 'Паузы между связками пусть будут одинаковыми.', 'Не ускоряйся резко.', 'Выровняй интервалы между связками.']),
      'dance-good': tones(['Связка {reps} засчитана.', 'Уже {reps} связок.', 'Счёт {reps}. Продолжай.', 'Получилось {reps} связок.', 'Есть {reps}. Держи удобный темп.']),
      [`${id}-idle`]: tones(['Начни одну связку в своём темпе.', instruction, 'Можешь начинать, я считаю завершённые связки.', 'Руки и ноги вместе, затем обратно.', 'Попробуй одну связку без спешки.']),
    },
    result: m => ({ key: 'reps', value: m.reps, label: 'связок' }),
    summaryLine: m => `Завершённых связок: ${m.reps}, без замечаний: ${m.clean}. Сходство с полной хореографией и попадание в музыку не оцениваются.`,
    answer: m => `Камера засчитала связок: ${m.reps}, без замечаний: ${m.clean}. Проверяю базовое движение рук и ног, а не полную хореографию.`,
    rhythm: 'reps',
    demo(t, aspect) {
      if (t < 3) return { points: dancePose(0, { aspect, variant }) };
      const n = Math.floor((t - 3) / 1.8), at = ((t - 3) % 1.8) / 1.8;
      const open = wave(at, { down: 0.3, hold: 0.2 });
      return { points: dancePose(open, { aspect, variant, arms: ![5, 6, 16, 17].includes(n % 22) }) };
    },
  };
}
