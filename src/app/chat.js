// Chat screen: a thread with the coach, like a direct-message conversation.
// The coach answers from the skill planner (keywords or the local LLM); every
// message is stored on the device. Live sessions post their summary here.
import { SKILL_LIST, getSkill, PERSONALITIES } from '../skills/index.js';
import { keywordPlan, buildPlannerMessages, parsePlan, planReplyText, pluralize } from '../ai/planner.js';
import { $, text, el, icon, toast, haptic, bus, timeLabel, relativeDate, formatTime, rhythmNode } from './ui.js';
import * as store from './store.js';
import { detectIntent, looksLikeGoal, talkReply, STRONG_INTENTS } from '../coach/talk.js';
import { llmHandles, buildChatContext, buildChatMessages, historyMessages, validateChatReply, invitesToTrain, CHAT_MAX_TOKENS } from '../ai/chat.js';
import { INPUT_LIMIT, inspectPrompt, normalizedText, SAFE_REPLY } from '../ai/safety.js';
import { authorizeAction } from './action-policy.js';

const ctx = { prefs: null, profile: null, history: [], chats: [], thread: null, ensureLiveCoach: null, getLiveCoach: null, llmState: () => ({}), busy: false, llmHistory: [] };
const steps = (n) => pluralize(n, ['шаг', 'шага', 'шагов']);
let stick = true;          // the list follows new messages while the person is at the bottom
let lastSummary = null;    // where the latest live summary card lives, for the late LLM text
let replyRequest = null;
let initialized = false;
export function cancelReply() {
  replyRequest?.controller.abort(); replyRequest = null;
  ctx.busy = false; $('chatSend').disabled = false; setTyping(false);
}
const currentReply = request => request === replyRequest && !request.controller.signal.aborted && request.threadId === ctx.thread?.id;

export function initChat({ prefs, profile, history, ensureLiveCoach, getLiveCoach, llmState }) {
  Object.assign(ctx, { prefs, profile, history, ensureLiveCoach, getLiveCoach, llmState: llmState || ctx.llmState });
  ctx.chats = store.loadChats();
  if (initialized) return;
  initialized = true;
  const list = $('chatList');
  list.addEventListener('scroll', () => {
    stick = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    if (stick) setJump(false); else if ($('chatJump').hidden) setJump(true, false);
  }, { passive: true });
  // The keyboard and the typing indicator change the list height: keep the latest message in view.
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(() => { if (stick) { list.scrollTop = list.scrollHeight; bus.emit('chat-at-bottom'); } });
    observer.observe(list); observer.observe($('bottomControls'));
  }
  $('chatJump').addEventListener('click', () => { stick = true; setJump(false); list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' }); });
  // Tapping send or a chip must not close the keyboard while typing.
  const keepFocus = (event) => { if (document.activeElement === $('chatInput')) event.preventDefault(); };
  $('chatSend').addEventListener('mousedown', keepFocus);
  $('chatChips').addEventListener('mousedown', keepFocus);
  $('chatForm').addEventListener('submit', (event) => { event.preventDefault(); send($('chatInput').value, { fromInput: true }); });
  $('newChatBtn').addEventListener('click', () => { newThread(); haptic(); toast('Новый чат'); });
  $('drawerNew').addEventListener('click', () => { newThread(); bus.emit('drawer', false); });
  $('drawerClear').addEventListener('click', () => {
    if (!ctx.chats.length || !authorizeAction('delete-chats', {})) return;
    ctx.chats = []; store.saveChats([]); openFresh(); toast('Чаты удалены');
  });
}
function setJump(visible, fresh = false) {
  const button = $('chatJump'); button.hidden = !visible;
  button.classList.toggle('has-new', visible && (fresh || button.classList.contains('has-new')));
  if (!visible) button.classList.remove('has-new');
}

export function setProfile(profile) { ctx.profile = profile; }
export function setHistory(history) { ctx.history = history; }
export function currentThread() { return ctx.thread; }

function greetingText() {
  const name = ctx.profile?.name || 'друг';
  return `${store.greeting(name)} Я твой тренер. Напиши, чему хочешь научиться, или открой вкладку «Навыки».`;
}

/** App start: reuse an untouched chat, otherwise open a new one. */
export function openFresh() {
  cancelReply();
  const { chats, thread } = store.freshThread(ctx.chats, greetingText());
  ctx.chats = chats; ctx.thread = thread; ctx.llmHistory = [];
  store.saveChats(chats); renderThread(); renderDrawer();
}
export function newThread() {
  cancelReply();
  const thread = store.createThread(greetingText());
  ctx.chats = [thread, ...ctx.chats].slice(0, store.MAX_THREADS); ctx.thread = thread; ctx.llmHistory = [];
  store.saveChats(ctx.chats); renderThread(); renderDrawer();
}
export function openThread(id) {
  const thread = ctx.chats.find(t => t.id === id); if (!thread) return;
  cancelReply();
  ctx.thread = thread; ctx.llmHistory = [];
  renderThread(); renderDrawer();
}
function deleteThread(id) {
  if (!ctx.chats.some(thread => thread.id === id) || !authorizeAction('delete-chat', { id })) return;
  ctx.chats = ctx.chats.filter(t => t.id !== id); store.saveChats(ctx.chats);
  if (ctx.thread?.id === id) openFresh(); else renderDrawer();
  toast('Чат удалён');
}
function persist() { ctx.chats = store.replaceThread(ctx.chats, ctx.thread); store.saveChats(ctx.chats); }
function push(message) {
  const { thread, message: msg } = store.appendMessage(ctx.thread, message);
  ctx.thread = thread; persist(); appendNode(msg); renderDrawer();
  return msg;
}

/* ───────────── Rendering ───────────── */

function renderThread() {
  const list = $('chatList'), typing = $('chatTyping');
  typing.hidden = true;
  list.replaceChildren(typing);
  let lastDay = '';
  for (const message of ctx.thread.messages) {
    const day = relativeDate(message.at);
    if (day !== lastDay) { list.insertBefore(el('div', 'day-sep', day), typing); lastDay = day; }
    list.insertBefore(messageNode(message), typing);
  }
  stick = true; setJump(false); renderChips(); scrollBottom();
}
function appendNode(message) {
  const list = $('chatList');
  const day = relativeDate(message.at);
  const lastSep = [...list.querySelectorAll('.day-sep')].at(-1);
  if (!lastSep || lastSep.textContent !== day) list.insertBefore(el('div', 'day-sep', day), $('chatTyping'));
  list.insertBefore(messageNode(message), $('chatTyping')); renderChips();
  // Own messages always scroll; replies only when the person is reading the bottom.
  if (stick || message.role === 'user') { stick = true; setJump(false); scrollBottom(); } else setJump(true, true);
}
function scrollBottom() { const list = $('chatList'); requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; bus.emit('chat-at-bottom'); }); }

function messageNode(message) {
  if (message.role === 'system') return el('div', 'sys-msg', message.text);
  const mine = message.role === 'user';
  const wrap = el('div', `msg ${mine ? 'me' : 'them'} ${message.type}`);
  wrap.dataset.id = message.id;
  if (!mine) { const avatar = el('span', 'avatar tiny coach'); avatar.append(icon('i-spark')); wrap.append(avatar); }
  const bubble = el('div', 'bubble');
  if (message.type === 'text') bubble.append(el('p', null, message.text));
  if (message.type === 'route') bubble.append(routeCard(message.data || {}));
  if (message.type === 'skill') bubble.append(skillCard(message.data || {}));
  if (message.type === 'summary') bubble.append(summaryCard(message.data || {}));
  if (message.meta && !/^живой тренер\s*·\s*проверено/iu.test(message.meta)) bubble.append(el('small', 'msg-meta', message.meta));
  const foot = el('div', 'msg-foot');
  foot.append(el('time', 'msg-time', timeLabel(message.at)));
  bubble.append(foot); wrap.append(bubble);
  return wrap;
}

function routeCard(data) {
  const plan = (data.plan || []).filter(id => SKILL_LIST.some(s => s.id === id));
  const card = el('div', 'card');
  card.append(el('b', 'card-title', plan.length > 1 ? `Твой маршрут · ${plan.length} навыка` : 'Твой маршрут'));
  if (data.goal) { const goal = data.goal.length > 60 ? `${data.goal.slice(0, 57)}…` : data.goal; card.append(el('small', 'card-goal', `по запросу «${goal}»`)); }
  const list = el('ol', 'card-steps');
  plan.forEach(id => { const s = getSkill(id); list.append(el('li', null, `${s.emoji} ${s.name} · ${steps(s.lessons.length)} · ${s.minutes} мин`)); });
  card.append(list);
  if (plan.length) {
    const start = el('button', 'btn-primary small'); start.type = 'button';
    start.append(icon('i-camera'), document.createTextNode(` Начать: ${getSkill(plan[0]).name}`));
    start.addEventListener('click', () => bus.emit('start-live', { skillId: plan[0], mode: 'camera' }));
    card.append(start);
  }
  return card;
}
function skillCard(data) {
  const skill = getSkill(data.skillId);
  const card = el('div', 'card');
  const head = el('div', 'card-skill'); head.append(el('span', 'skill-emoji', skill.emoji));
  const copy = el('div'); copy.append(el('b', 'card-title', skill.name), el('small', null, `${skill.level} · ${steps(skill.lessons.length)} · ${skill.minutes} мин${skill.needsBall ? ' · нужен мяч' : ''}`));
  head.append(copy); card.append(head, el('p', 'card-text', skill.description));
  const row = el('div', 'card-row');
  const start = el('button', 'btn-primary small'); start.type = 'button'; start.append(icon('i-camera'), document.createTextNode(' Начать эфир'));
  start.addEventListener('click', () => bus.emit('start-live', { skillId: skill.id, mode: 'camera' }));
  const demo = el('button', 'btn-ghost small', 'Демо'); demo.type = 'button';
  demo.addEventListener('click', () => bus.emit('start-live', { skillId: skill.id, mode: 'demo' }));
  row.append(start, demo); card.append(row);
  return card;
}
function summaryCard(data) {
  const card = el('div', 'card summary');
  const skillName = SKILL_LIST.find(skill => skill.id === data.skillId)?.name || data.skillName || '';
  card.append(el('b', 'card-title', `${skillName} · ${formatTime(data.seconds || 0)}`), el('small', 'card-goal', data.demo ? 'Демо: симуляция, в историю не записана' : data.source === 'file' ? 'Разбор видео' : 'Эфир с камеры'));
  const stats = el('div', 'card-stats');
  for (const [value, label] of [[String(data.metricValue ?? 0), data.metricWord || data.metricLabel || ''], [`${data.lessonsDone ?? 0}/${data.lessonsTotal ?? 0}`, 'шагов урока']]) {
    const cell = el('div'); cell.append(el('b', null, value), el('span', null, label)); stats.append(cell);
  }
  card.append(stats);
  for (const [label, value] of [['Получилось', data.done], ['Главная ошибка', data.mistake], ['Следующий шаг', data.next], ['Твой прогресс', data.progress]]) {
    if (!value) continue;
    const line = el('p', 'card-line'); line.append(el('b', null, `${label}: `), document.createTextNode(value)); card.append(line);
  }
  if (data.rhythm?.times?.length) card.append(rhythmNode(data.rhythm));
  if (data.live) { const live = el('p', 'card-line llm'); live.append(el('span', 'badge-llm', 'живой тренер'), document.createTextNode(` ${data.live}`)); card.append(live); }
  const again = el('button', 'btn-ghost small', data.demo ? 'Запустить эфир с камерой' : 'Повторить'); again.type = 'button';
  again.addEventListener('click', () => bus.emit('start-live', { skillId: data.skillId || ctx.prefs.skill, mode: 'camera' }));
  card.append(again);
  return card;
}

function renderChips() {
  const chips = $('chatChips'); chips.replaceChildren();
  const last = [...ctx.thread.messages].reverse().find(m => m.role !== 'system');
  // Quick replies follow the conversation: after a session they are about that session.
  const items = store.isFresh(ctx.thread) ? ['Хочу чеканить мяч', 'Хочу укрепить ноги', 'Не знаю, с чего начать']
    : last?.type === 'summary' ? ['Как у меня получилось?', 'Повторить эфир', 'Другой навык']
    : last?.role === 'coach' && last.offer ? ['Давай', 'Не сейчас', 'Покажи демо']
    : ['Начать эфир', 'Покажи демо', 'Другая цель'];
  for (const label of items) {
    const chip = el('button', 'chip', label); chip.type = 'button';
    chip.addEventListener('click', () => send(label));
    chips.append(chip);
  }
}

/** The header shows only the selected coach personality. */
export function renderHeader() {
  if (!ctx.prefs) return; // the model manager may report before the chat is initialised
  text('chatSub', `${PERSONALITIES[ctx.prefs.personality].name} тренер`);
}

export function renderDrawer() {
  const list = $('drawerList'); list.replaceChildren();
  if (!ctx.chats.length) { list.append(el('p', 'drawer-empty', 'Здесь появится история чатов.')); return; }
  for (const thread of ctx.chats) {
    const item = el('div', `drawer-item${thread.id === ctx.thread?.id ? ' is-active' : ''}`);
    const open = el('button', 'drawer-open'); open.type = 'button';
    const emoji = el('span', 'drawer-emoji', thread.skill ? getSkill(thread.skill).emoji : '✦');
    const copy = el('div', 'drawer-copy');
    const last = thread.messages.at(-1);
    copy.append(el('b', null, store.threadTitle(thread)), el('small', null, last ? (last.type === 'text' ? last.text : last.type === 'summary' ? 'Итог эфира' : last.type === 'route' ? 'Маршрут' : 'Навык') : ''));
    const when = el('time', 'drawer-when', relativeDate(thread.updatedAt || thread.createdAt));
    open.append(emoji, copy, when);
    open.addEventListener('click', () => { openThread(thread.id); bus.emit('drawer', false); });
    item.append(open);
    if (thread.id !== ctx.thread?.id) {
      const del = el('button', 'icon-btn drawer-del'); del.type = 'button'; del.setAttribute('aria-label', 'Удалить чат'); del.append(icon('i-trash'));
      del.addEventListener('click', (event) => { event.stopPropagation(); deleteThread(thread.id); });
      item.append(del);
    }
    list.append(item);
  }
}

/* ───────────── Conversation ───────────── */

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
function setTyping(on) { $('chatTyping').hidden = !on; if (on && stick) scrollBottom(); }

async function coachSays(message, request, extra = {}) {
  if (!currentReply(request)) return false;
  setTyping(true); await wait(350 + Math.min(900, message.length * 12));
  if (!currentReply(request)) return false;
  setTyping(false);
  return push({ role: 'coach', type: 'text', text: message, ...extra });
}

export async function send(raw, { fromInput = false } = {}) {
  const original = typeof raw === 'string' ? raw : '';
  const query = normalizedText(original).slice(0, INPUT_LIMIT);
  if (!query || ctx.busy) return;
  ctx.busy = true; $('chatSend').disabled = true;
  const request = { threadId: ctx.thread.id, controller: new AbortController() }; replyRequest = request;
  if (fromInput) $('chatInput').value = ''; // a chip must not wipe a half-written message
  haptic(6);
  push({ role: 'user', type: 'text', text: query });
  const q = query.toLowerCase();
  try {
    // Pain remains a rule-level response even when the same message contains an attack.
    if (detectIntent(query) === 'pain') { await talk('pain', query, request); return; }
    if (!inspectPrompt(original).ok) { await coachSays(SAFE_REPLY, request); return; }
    if (/^(покажи )?демо([\s!.,]|$)/.test(q)) {
      bus.emit('gesture'); // iOS speaks only if voice was unlocked inside the tap
      await coachSays('Запускаю демо на нарисованном спортсмене. Это симуляция интерфейса, а не анализ камеры.', request);
      if (currentReply(request)) bus.emit('start-live', { skillId: ctx.prefs.skill, mode: 'demo' });
    } else if (/^(начать эфир|начни|поехали|старт|начать|повторить( эфир)?|повтори)([\s!.,]|$)/.test(q)) {
      bus.emit('gesture');
      const skill = getSkill(ctx.prefs.skill);
      await coachSays(`Открываю эфир: ${skill.name}. ${skill.camera}`, request);
      if (currentReply(request)) bus.emit('start-live', { skillId: skill.id, mode: 'camera' });
    } else if (/не знаю|с чего начать|помоги выбрать/.test(q)) {
      await coachSays('Давай так: что ближе одним словом — мяч, ноги, руки, пресс или выносливость? Или открой вкладку «Навыки».', request);
    } else if (/^(другая цель|другой навык)/.test(q)) {
      await coachSays('Напиши новую цель своими словами, соберу маршрут заново.', request);
    } else {
      await respond(query, request);
    }
  } finally { if (replyRequest === request) { replyRequest = null; ctx.busy = false; $('chatSend').disabled = false; } }
}

/** What the small-talk replies may rely on: only real data from this device. */
function talkContext() {
  const messages = ctx.thread.messages;
  const summary = [...messages].reverse().find(m => m.type === 'summary')?.data || null;
  const lastCoach = [...messages].reverse().find(m => m.role === 'coach');
  const record = ctx.history[0] || null;
  return {
    name: ctx.profile?.name || 'друг', personality: ctx.prefs.personality, summary,
    stats: store.historyStats(ctx.history),
    lastRecord: record ? { skillName: getSkill(record.skill).name, lessonsDone: record.lessonsDone, lessonsTotal: record.lessonsTotal } : null,
    skillName: getSkill(ctx.prefs.skill).name,
    canStart: Boolean(lastCoach && (['route', 'skill', 'summary'].includes(lastCoach.type) || lastCoach.offer)),
  };
}

/**
 * Order: pain, results, «как дела», help → a skill named in the message → other small talk →
 * a stated goal (may honestly get «такого навыка пока нет») → a free question.
 * Free questions and small talk go to the local model when it is running; safety, numbers
 * and actions (pain, results, «да»/«нет», goals) always stay with the rules.
 */
async function respond(query, request) {
  const intent = detectIntent(query);
  const hasSkillWords = keywordPlan(query, SKILL_LIST).plan.length > 0;
  const goal = looksLikeGoal(query);
  if (intent && (STRONG_INTENTS.has(intent) || !hasSkillWords)) return talk(intent, query, request);
  // «Как правильно чеканить?» is a question about technique: the model answers it; without the model the route card does.
  if (hasSkillWords && isQuestion(query) && !goal && await llmTalk(query, null, request)) return;
  if (!currentReply(request)) return;
  if (hasSkillWords || goal) return plan(query, request);
  return talk(null, query, request);
}
// «как правильно чеканить?» is a question about technique, not a route request.
const isQuestion = (query) => /\?|^(как|что|почему|зачем|сколько|можно|какой|какая|какие|где|когда|нужно ли|стоит ли|правда ли)(?!\p{L})/iu.test(String(query).trim());

async function talk(intent, query, request) {
  if (llmHandles(intent) && await llmTalk(query, intent, request)) return;
  if (!currentReply(request)) return;
  const context = talkContext();
  const reply = talkReply(intent, context, ctx.thread.messages.length);
  if (reply.action === 'start') bus.emit('gesture'); // still inside the tap: unlocks voice on iOS
  const pending = ctx.prefs.liveCoach && llmHandles(intent) && !ctx.getLiveCoach() && ctx.llmState()?.loading;
  await coachSays(reply.text, request, { ...(reply.offer ? { offer: true } : {}), ...(pending ? { meta: 'по правилам · живой тренер запускается' } : {}) });
  if (currentReply(request) && reply.action === 'start') bus.emit('start-live', { skillId: ctx.prefs.skill, mode: 'camera' });
}

/* ───────────── Free conversation with the local model ───────────── */

const LLM_FIRST_TOKEN_MS = 20000;   // a phone that has not started answering by then falls back to the rules
const LLM_TOTAL_MS = 45000;

/** The model's reply streams into a temporary bubble; only a validated reply is stored. Returns true when it answered. */
async function llmTalk(query, intent, request) {
  const coach = ctx.prefs.liveCoach ? ctx.getLiveCoach() : null;
  if (!coach) {
    // Downloaded but not running yet: start it for the next message, answer by the rules now.
    if (ctx.prefs.liveCoach && !ctx.llmState()?.loading) ctx.ensureLiveCoach().catch(() => {});
    return false;
  }
  const t = talkContext();
  const context = buildChatContext({ ...t, plan: ctx.prefs.plan, skillId: ctx.prefs.skill, query, skills: SKILL_LIST });
  // The thread itself is the memory: the latest turns, whoever wrote them (rules, planner or model).
  const messages = buildChatMessages(query, context, historyMessages(ctx.thread.messages.slice(0, -1)));
  // Buffer tokens until validation: rejected text must never reach the screen or speech.
  let received = false;
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.controller.signal.addEventListener('abort', abort, { once: true });
  const firstToken = setTimeout(() => { if (!received) controller.abort(); }, LLM_FIRST_TOKEN_MS);
  const total = setTimeout(() => controller.abort(), LLM_TOTAL_MS);
  setTyping(true);
  let raw = null;
  try {
    raw = await coach.stream(messages, {
      maxTokens: CHAT_MAX_TOKENS, temperature: 0.6, signal: controller.signal,
      onToken(full) {
        if (!currentReply(request)) return;
        received = Boolean(full);
        if (full.length > 2048) controller.abort();
      },
    });
  } catch (error) { console.warn('Aimo chat: LLM failed', error?.message); }
  finally { clearTimeout(firstToken); clearTimeout(total); request.controller.signal.removeEventListener('abort', abort); if (currentReply(request)) setTyping(false); }
  if (!currentReply(request)) return true;
  const checked = validateChatReply(raw, context, query);
  if (!checked.ok) { console.warn('Aimo chat: LLM reply rejected,', checked.reason, intent); return false; }
  push({ role: 'coach', type: 'text', text: checked.text, ...(invitesToTrain(checked.text) ? { offer: true } : {}) });
  return true;
}

const LLM_REPLY_TIMEOUT_MS = 25000;
async function plan(query, request) {
  setTyping(true);
  let result = null; let note = '';
  const coach = ctx.prefs.liveCoach ? ctx.getLiveCoach() : null;
  if (coach) {
    let timeout;
    try {
      // A slow phone must not leave the chat hanging: past the timeout the keyword planner answers.
      const raw = await Promise.race([coach.chat(buildPlannerMessages(query, SKILL_LIST, ctx.llmHistory), { maxTokens: 220 }), new Promise(resolve => { timeout = setTimeout(() => resolve(null), LLM_REPLY_TIMEOUT_MS); })]);
      const parsed = parsePlan(raw, SKILL_LIST);
      if (parsed.ok) result = parsed; else { note = 'живой тренер не дал проверяемый ответ'; console.warn('Aimo planner: LLM reply rejected,', parsed.reason); }
    } catch (error) { console.warn('Aimo planner: LLM unavailable', error?.message); }
    finally { clearTimeout(timeout); }
  } else if (ctx.prefs.liveCoach) {
    // The model is still downloading: answer now, keep loading in the background.
    note = 'живой тренер ещё загружается'; ctx.ensureLiveCoach().catch(() => {}); await wait(450);
  } else await wait(500);
  if (!currentReply(request)) return;
  const viaLlm = Boolean(result);
  if (!result) result = keywordPlan(query, SKILL_LIST);
  const reply = result.reply || planReplyText(result.plan, SKILL_LIST);
  ctx.llmHistory.push({ role: 'user', content: query }, { role: 'assistant', content: reply });
  ctx.llmHistory = ctx.llmHistory.slice(-4);
  setTyping(false);
  push({ role: 'coach', type: 'text', text: reply, meta: !viaLlm && note ? `подбор по ключевым словам · ${note}` : '' });
  if (result.plan.length) {
    ctx.prefs.plan = result.plan; ctx.prefs.planGoal = query; ctx.prefs.skill = result.plan[0]; store.savePrefs(ctx.prefs);
    push({ role: 'coach', type: 'route', data: { plan: result.plan, goal: query }, skill: result.plan[0] });
    bus.emit('prefs-changed');
  }
}

/** Called by the skill sheet: the coach introduces a skill inside the chat. */
export async function introduceSkill(skillId) {
  const skill = getSkill(skillId);
  ctx.prefs.skill = skill.id; store.savePrefs(ctx.prefs); bus.emit('prefs-changed');
}

/** Called when a live session ends. */
export function postSummary(data) {
  const message = push({ role: 'coach', type: 'summary', data, skill: data.skillId });
  stick = true; scrollBottom();
  lastSummary = { threadId: ctx.thread.id, messageId: message.id };
}

/** The live coach's final review arrives a few seconds after the summary card: add it there. */
export function attachLiveText(liveText) {
  if (!lastSummary || !liveText) return;
  const { threadId, messageId } = lastSummary;
  const thread = ctx.chats.find(t => t.id === threadId); if (!thread) return;
  const updated = { ...thread, messages: thread.messages.map(m => (m.id === messageId ? { ...m, data: { ...m.data, live: liveText } } : m)) };
  ctx.chats = ctx.chats.map(t => (t.id === threadId ? updated : t)); store.saveChats(ctx.chats);
  if (ctx.thread?.id !== threadId) return;
  ctx.thread = updated;
  const node = $('chatList').querySelector(`[data-id="${messageId}"]`);
  node?.replaceWith(messageNode(updated.messages.find(m => m.id === messageId)));
  if (stick) scrollBottom();
}
export function postSystem(message) { push({ role: 'system', type: 'text', text: message }); }
