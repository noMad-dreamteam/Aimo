// Application-owned boundary. Model output is never an action request.
import { SKILL_LIST } from '../skills/index.js';
import { localVoice } from './voice-models.js';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Reflect.ownKeys(value).every(key => keys.includes(key));
const empty = value => exact(value, []) && Object.keys(value).length === 0;

export function validateAction(action, args, source = 'ui') {
  if (source !== 'ui') return false; // no model, external-data or worker privileges
  if (action === 'start-live') {
    if (!exact(args, ['skillId', 'mode', 'pick', 'file']) || !SKILL_LIST.some(skill => skill.id === args.skillId)
      || !['camera', 'demo', 'file'].includes(args.mode) || (args.pick !== undefined && typeof args.pick !== 'boolean')) return false;
    if (args.mode !== 'file') return args.file === undefined;
    return typeof File !== 'undefined' && args.file instanceof File && args.file.size > 0
      && args.file.type.startsWith('video/') && args.file.size <= 1024 ** 3;
  }
  if (['delete-chats', 'delete-history'].includes(action)) return empty(args);
  if (action === 'delete-chat') return exact(args, ['id']) && typeof args.id === 'string' && args.id.length > 0 && args.id.length <= 100;
  if (action === 'delete-model') return exact(args, ['key']) && ['default', 'small'].includes(args.key);
  if (action === 'delete-voice') return exact(args, ['id']) && !!localVoice(args.id);
  return false;
}

export function authorizeAction(action, args, { source = 'ui', confirm = message => globalThis.confirm?.(message) === true } = {}) {
  if (!validateAction(action, args, source)) return false;
  // Native modal is synchronous: approval is local to this exact invocation,
  // never persisted or reused as permission for a later operation.
  const messages = {
    'delete-chats': 'Удалить все чаты на этом устройстве? Восстановить переписку нельзя.',
    'delete-chat': 'Удалить этот чат на устройстве? Восстановить переписку нельзя.',
    'delete-history': 'Удалить весь прогресс тренировок на этом устройстве? Восстановить его нельзя.',
    'delete-model': `Удалить модель ${args.key === 'small' ? 'Qwen 0.5B' : 'Qwen 1.5B'} с устройства? Для её использования понадобится повторное скачивание.`,
    'delete-voice': `Удалить голос «${localVoice(args.id)?.name}» с устройства? Для его использования понадобится повторное скачивание.`,
  };
  if (action === 'start-live') return true;
  try { return confirm(messages[action]) === true; } catch { return false; }
}
