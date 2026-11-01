import { makeDanceSkill } from './dance-common.js';
// Keep the saved skill ID and movement variant compatible with existing local history.
export default makeDanceSkill({
  id: 'zolo', name: 'Танцы Тикток', short: 'Танцы Тикток', emoji: '🕺', variant: 'zolo',
  tagline: 'Широкая стойка, мягкие колени и согнутые руки',
  description: 'Учебная связка для коротких танцевальных видео: широкая стойка, мягкое сгибание коленей и подъём согнутых рук. Три шага без прыжков. Камера проверяет базовую связку, а не сходство со всей хореографией.',
  reference: 'https://www.youtube.com/shorts/7QsbsckutLU',
});
