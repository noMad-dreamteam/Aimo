// Bootstrap: local profile gate, screens and tabs, chat drawer with swipe,
// skill sheet, progress and profile screens. Wires chat.js and live.js together.
import { SKILL_LIST, getSkill, PERSONALITIES, CATEGORIES } from '../skills/index.js';
import { createLocalCoach, hasCachedModel, deleteCachedModel, supportsWebGPU, LLM_MODELS } from '../ai/llm.js';
import { pluralize } from '../shared/text.js';
import { compareProgress } from '../coach/progress.js';
import { $, text, el, icon, toast, haptic, bus, formatTime, relativeDate, openSheet, closeSheet, currentSheet, paintAvatar } from './ui.js';
import * as store from './store.js';
import * as chat from './chat.js';
import * as live from './live.js';
import { createModelManager } from './model-manager.js';
import { russianVoices, voiceKey, selectedVoice } from './speech.js';
import { LOCAL_VOICES, localVoice } from './voice-models.js';
import { trainerAudio } from './trainer-audio.js';
import { initViewport } from './viewport.js';
import { initTabbar, initialTabbarState, nextTabbarState } from './tabbar.js';
import { metricPhrase } from '../coach/talk.js';
import { authorizeAction } from './action-policy.js';

store.migrateLegacyKeys();
const app = $('app');
const prefs = store.loadPrefs();
let profile = store.loadProfile();
let history = store.loadHistory();
const makeModelManager = () => createModelManager({ models: LLM_MODELS, load: createLocalCoach, hasCached: hasCachedModel, deleteCached: deleteCachedModel, canLoad: supportsWebGPU, isLive: live.isActive, onChange: renderModels });
let modelManager = makeModelManager();
let liveStartRequest = 0;
let sheetSkillId = null;
let setupDismissed = false;
try { setupDismissed = sessionStorage.getItem('aimo:setup-dismissed') === 'yes'; } catch { /* storage can be unavailable */ }
const steps = (n) => pluralize(n, ['шаг', 'шага', 'шагов']);
const navigation = initTabbar({ app, bar: $('bottomControls'), surfaces: document.querySelectorAll('.screen:not(.screen-login), #chatList') });
for (const event of ['live-finished', 'live-failed', 'live-cancelled', 'chat-at-bottom']) bus.on(event, () => navigation.reset());

/* ───────────── Viewport & keyboard ───────────── */
initViewport({
  onChange({ keyboard }) {
    const value = keyboard ? 'open' : 'closed';
    if (app.dataset.keyboard !== value) { app.dataset.keyboard = value; navigation.reset(); bus.emit('keyboard', keyboard); }
  },
});

/* ───────────── Theme ───────────── */
const themeMetas = [...document.querySelectorAll('meta[name="theme-color"]')];
const systemColorScheme = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  document.documentElement.dataset.theme = prefs.theme; $('themeSelect').value = prefs.theme;
  document.documentElement.dataset.appearance = prefs.theme === 'system' ? (systemColorScheme.matches ? 'dark' : 'light') : prefs.theme;
  // The browser bar follows the chosen theme, not only the system one.
  for (const meta of themeMetas) {
    const systemDark = (meta.getAttribute('media') || '').includes('dark');
    const dark = prefs.theme === 'system' ? systemDark : prefs.theme === 'dark';
    meta.setAttribute('content', dark ? '#151515' : '#ffffff');
  }
}
systemColorScheme.addEventListener('change', () => { if (prefs.theme === 'system') applyTheme(); });

/* ───────────── Screens & tabs ───────────── */
function showScreen(name) {
  app.dataset.screen = name;
  navigation.reset();
  document.querySelectorAll('.tab[data-tab]').forEach(tab => { if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current'); });
  if (name === 'progress') renderProgress();
  if (name === 'profile') { renderProfile(); modelManager.refresh(); trainerAudio.refresh(); }
  if (name === 'catalog') renderCatalog();
  if (name === 'chat') warmLiveCoach();
  if (name !== 'chat') document.querySelector(`.screen-${name}`)?.scrollTo({ top: 0 });
  if (drawerOpen) setDrawer(false, { focus: false });
}
document.querySelectorAll('.tab[data-tab]').forEach(tab => tab.addEventListener('click', () => {
  haptic(6);
  // «Эфир»: the camera comes on at once; the plate on top lets the person pick the skill.
  if (tab.dataset.tab === 'live') { startSession({ skillId: prefs.skill, mode: 'camera', pick: true }); return; }
  if (tab.dataset.tab === app.dataset.screen) { document.querySelector(`.screen-${app.dataset.screen === 'chat' ? 'chat .chat-list' : app.dataset.screen}`)?.scrollTo({ top: app.dataset.screen === 'chat' ? 1e9 : 0, behavior: 'smooth' }); return; }
  showScreen(tab.dataset.tab);
}));

/* ───────────── Login ───────────── */
const loginHue = store.AVATAR_HUES[0];
function submitLogin(event) {
  event?.preventDefault();
  const name = $('loginName').value.trim();
  if (!name) { $('loginName').focus(); return; }
  profile = store.sanitizeProfile({ name, hue: loginHue, createdAt: new Date().toISOString() });
  store.saveProfile(profile); enterApp(); toast(`Добро пожаловать, ${profile.name}!`);
}
$('loginForm').addEventListener('submit', submitLogin);
$('logoutBtn').addEventListener('click', () => {
  liveStartRequest++; chat.cancelReply(); modelManager.dispose(); modelManager = makeModelManager(); trainerAudio.cancelDownload(); trainerAudio.release();
  store.clearProfile(); profile = null; app.dataset.screen = 'login'; $('loginName').value = '';
  toast('Ты вышел. Чаты и история остались на этом устройстве.');
});

/* ───────────── Drawer: chat history, swipe right anywhere on the chat ───────────── */
const drawerEl = $('drawer');
const backdropEl = $('drawerBackdrop');
let drawerOpen = false;
let drawerScrollState = initialTabbarState();
function showDrawerClear(hidden = false) {
  drawerEl.dataset.clearHidden = String(hidden);
  $('drawerClear').inert = hidden;
}
$('drawerList').addEventListener('scroll', () => {
  if (!drawerOpen) return;
  const list = $('drawerList');
  drawerScrollState = nextTabbarState(drawerScrollState, list.scrollTop, list.scrollHeight - list.clientHeight);
  showDrawerClear(drawerScrollState.hidden && !$('drawerClear').matches(':focus-visible'));
}, { passive: true });
$('drawerClear').addEventListener('focusin', () => showDrawerClear());
drawerEl.addEventListener('keydown', event => { if (event.key === 'Tab') showDrawerClear(); });
function setDrawer(open, { focus = true } = {}) {
  const changed = open !== drawerOpen;
  drawerOpen = open; app.dataset.drawer = open ? 'open' : 'closed';
  drawerEl.inert = !open; $('openDrawer').setAttribute('aria-expanded', String(open));
  if (open) {
    chat.renderDrawer();
    drawerScrollState = initialTabbarState($('drawerList').scrollTop);
    showDrawerClear();
  }
  if (changed && focus) (open ? $('closeDrawer') : $('openDrawer')).focus({ preventScroll: true });
}
setDrawer(false, { focus: false });
bus.on('drawer', (open) => setDrawer(open));
$('openDrawer').addEventListener('click', () => { showScreen('chat'); setDrawer(true); });
$('newChatBtn').addEventListener('click', () => showScreen('chat'));
$('closeDrawer').addEventListener('click', () => setDrawer(false));
backdropEl.addEventListener('click', () => setDrawer(false));
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (currentSheet()) { closeSheet(); event.preventDefault(); return; }
  if (drawerOpen) { setDrawer(false); event.preventDefault(); }
});

// The panel follows the finger. Opening starts anywhere on the chat except rows that
// scroll sideways (chips) and the composer, which also keeps clear of the
// iOS back gesture at the very edge of the screen.
const NO_SWIPE = '.chips, .composer, input, select, textarea';
let drag = null;
document.addEventListener('touchstart', (event) => {
  if (!profile || live.isActive() || currentSheet() || event.touches.length !== 1) { drag = null; return; }
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const fromChat = !drawerOpen && app.dataset.screen === 'chat' && target.closest('.screen-chat') && !target.closest(NO_SWIPE);
  const fromDrawer = drawerOpen && (target.closest('#drawer') || target === backdropEl);
  if (!fromChat && !fromDrawer) { drag = null; return; }
  const touch = event.touches[0]; const now = performance.now();
  drag = { x: touch.clientX, y: touch.clientY, open: drawerOpen, axis: null, progress: drawerOpen ? 1 : 0, lastX: touch.clientX, lastT: now, velocity: 0 };
}, { passive: true });
document.addEventListener('touchmove', (event) => {
  if (!drag) return;
  const touch = event.touches[0]; const dx = touch.clientX - drag.x; const dy = touch.clientY - drag.y;
  if (!drag.axis) {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    const sideways = Math.abs(dx) > Math.abs(dy) * 1.3 && (drag.open ? dx < 0 : dx > 0);
    if (!sideways) { drag = null; return; }
    drag.axis = 'x'; app.classList.add('drawer-dragging'); if (!drag.open) chat.renderDrawer();
  }
  const now = performance.now();
  drag.velocity = (touch.clientX - drag.lastX) / Math.max(1, now - drag.lastT); drag.lastX = touch.clientX; drag.lastT = now;
  const width = drawerEl.offsetWidth || 300;
  drag.progress = Math.min(1, Math.max(0, (drag.open ? 1 : 0) + dx / width));
  drawerEl.style.transform = `translateX(${((drag.progress - 1) * 100).toFixed(2)}%)`;
  backdropEl.style.opacity = drag.progress.toFixed(3);
}, { passive: true });
function endDrag() {
  const finished = drag; drag = null;
  if (!finished || finished.axis !== 'x') return;
  const open = finished.velocity > 0.45 ? true : finished.velocity < -0.45 ? false : finished.progress > 0.4;
  app.classList.remove('drawer-dragging'); drawerEl.style.transform = ''; backdropEl.style.opacity = '';
  if (open !== drawerOpen) haptic(8);
  setDrawer(open, { focus: false });
}
document.addEventListener('touchend', endDrag, { passive: true });
document.addEventListener('touchcancel', endDrag, { passive: true });
document.addEventListener('keydown', (event) => { if (event.key === '[' && profile && !live.isActive() && (event.metaKey || event.ctrlKey)) { event.preventDefault(); setDrawer(!drawerOpen); } });

/* ───────────── Catalog & skill sheet ───────────── */
// Catalog: one section per category, a plain tile per skill (emoji, name, length).
function renderCatalog() {
  const root = $('catalogGrid'); root.replaceChildren();
  const done = new Set(history.map(s => s.skill));
  for (const category of CATEGORIES) {
    const skills = SKILL_LIST.filter(skill => skill.category === category.id);
    if (!skills.length) continue;
    const section = el('section', 'catalog-section');
    const head = el('div', 'catalog-head'); head.append(el('h3', null, category.name), el('small', null, category.note));
    const grid = el('div', 'catalog-grid');
    for (const skill of skills) {
      const card = el('button', 'skill-tile'); card.type = 'button';
      const top = el('div', 'tile-top'); top.append(el('span', 'skill-emoji', skill.emoji));
      const planIndex = prefs.plan.indexOf(skill.id);
      if (planIndex !== -1) top.append(el('span', 'tile-badge', `маршрут ${planIndex + 1}`));
      else if (done.has(skill.id)) { const badge = el('span', 'tile-badge seen'); badge.setAttribute('aria-label', 'уже тренировался'); badge.append(icon('i-check')); top.append(badge); }
      card.append(top, el('b', null, skill.name), el('small', null, `${steps(skill.lessons.length)} · ${skill.minutes} мин${skill.needsBall ? ' · мяч' : ''}`));
      card.addEventListener('click', () => openSkillSheet(skill.id));
      grid.append(card);
    }
    section.append(head, grid); root.append(section);
  }
}
function openSkillSheet(skillId) {
  const skill = getSkill(skillId); sheetSkillId = skill.id;
  text('skillSheetEmoji', skill.emoji); text('skillSheetName', skill.name);
  text('skillSheetMeta', `${skill.level} · ${steps(skill.lessons.length)} · ${skill.minutes} мин${skill.needsBall ? ' · нужен мяч' : ' · без инвентаря'}`);
  text('skillSheetDesc', skill.description); text('skillSheetCamera', skill.camera);
  const reference = $('skillSheetReference'); reference.hidden = !skill.reference;
  if (skill.reference) reference.href = skill.reference; else reference.removeAttribute('href');
  const list = $('skillSheetSteps'); list.replaceChildren();
  skill.lessons.forEach(lesson => { const item = el('li'); item.append(el('b', null, lesson.title), el('span', null, lesson.goal)); list.append(item); });
  openSheet('sheetSkill');
}
bus.on('open-skill', openSkillSheet);
$('skillStart').addEventListener('click', () => { closeSheet(); chat.introduceSkill(sheetSkillId); startSession({ skillId: sheetSkillId, mode: 'camera' }); });
$('skillDemo').addEventListener('click', () => { closeSheet(); chat.introduceSkill(sheetSkillId); startSession({ skillId: sheetSkillId, mode: 'demo' }); });
$('skillFile').addEventListener('click', () => { live.unlockSpeech(); live.ensureAudio(); $('videoFile').click(); });
$('videoFile').addEventListener('change', (event) => { const file = event.target.files[0]; event.target.value = ''; if (!file) return; closeSheet(); chat.introduceSkill(sheetSkillId); startSession({ skillId: sheetSkillId, mode: 'file', file }); });
document.querySelector('[data-sheet-backdrop]').addEventListener('click', closeSheet);

/* ───────────── Progress ───────────── */
function renderProgress() {
  const stats = store.historyStats(history);
  const tail = (n, forms) => pluralize(n, forms).split(' ').slice(1).join(' ');
  text('statTrainings', stats.trainings); text('statTrainingsLabel', tail(stats.trainings, ['тренировка', 'тренировки', 'тренировок']));
  text('statMinutes', stats.minutes); text('statMinutesLabel', tail(stats.minutes, ['минута', 'минуты', 'минут']));
  text('statDays', stats.days); text('statDaysLabel', `${tail(stats.days, ['день', 'дня', 'дней'])} подряд`);
  const list = $('historyList'); list.replaceChildren(); $('clearHistory').disabled = history.length === 0;
  $('historyNote').hidden = history.length === 0;
  if (!history.length) { list.append(el('p', 'empty', 'Здесь появятся итоги эфиров. Демо в историю не записывается, видео не хранится.')); return; }
  for (const [index, session] of history.entries()) {
    const skill = getSkill(session.skill);
    const row = el('div', 'history-row');
    row.append(el('span', 'skill-emoji', skill.emoji));
    const copy = el('div');
    const lessonCount = Number.isInteger(session.lessonsDone) && Number.isInteger(session.lessonsTotal)
      ? `шагов ${session.lessonsDone}/${session.lessonsTotal}` : '';
    copy.append(el('b', null, skill.name), el('small', null, [relativeDate(session.date), formatTime(session.seconds), metricPhrase(session.metricValue ?? session.movements ?? 0, session.metricLabel || ''), session.source === 'camera' ? '' : session.source === 'file' ? 'Видео' : 'Источник не указан', lessonCount, session.bestStreak ? `серия ${session.bestStreak}` : ''].filter(Boolean).join(' · ')));
    const progress = compareProgress(session, history.filter((_, otherIndex) => otherIndex !== index));
    copy.append(el('p', `history-progress${progress?.isNewBest ? ' is-best' : ''}`, progress ? progress.text : 'Для этой записи сравнение недоступно.'));
    row.append(copy); list.append(row);
  }
}
$('clearHistory').addEventListener('click', () => { if (!authorizeAction('delete-history', {})) return; history = []; store.saveHistory(history); renderProgress(); chat.setHistory(history); toast('Прогресс удалён'); });

/* ───────────── Profile & settings ───────────── */
function renderProfile() {
  $('clearHistory').disabled = history.length === 0;
  paintAvatar($('profileAvatar'), profile); $('profileNameInput').value = profile.name;
  text('profileSince', `В Aimo с ${new Date(profile.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`);
  renderPersonalities(); applyPreferences();
}
function syncProfile() { paintAvatar($('tabAvatar'), profile); paintAvatar($('profileAvatar'), profile); chat.setProfile(profile); live.setProfile(profile); }
$('profileNameInput').addEventListener('change', () => {
  const name = $('profileNameInput').value.trim(); if (!name) { $('profileNameInput').value = profile.name; return; }
  profile = store.sanitizeProfile({ ...profile, name }); store.saveProfile(profile); syncProfile(); toast('Имя обновлено');
});
function renderPersonalities() {
  const row = $('personalityRow'); row.replaceChildren();
  for (const p of Object.values(PERSONALITIES)) {
    const chip = el('button', 'segment', p.name); chip.type = 'button'; chip.setAttribute('role', 'radio'); chip.setAttribute('aria-checked', String(p.id === prefs.personality));
    chip.addEventListener('click', () => { prefs.personality = p.id; store.savePrefs(prefs); renderPersonalities(); bus.emit('prefs-changed'); });
    row.append(chip);
  }
  text('personalityNote', PERSONALITIES[prefs.personality].description);
}
function applyPreferences() {
  for (const key of ['voice', 'skeleton', 'mirror', 'objects', 'sound', 'autoFar']) if ($(key + 'Input')) $(key + 'Input').checked = prefs[key];
  for (const id of ['voicePicker', 'voiceVolumeSetting', 'voiceRateSetting']) $(id).hidden = !prefs.voice;
  document.querySelectorAll('input[name=llmModel]').forEach(radio => { radio.checked = radio.value === prefs.llmModel; });
  live.applyPrefs(); applyTheme();
}
for (const key of ['voice', 'skeleton', 'mirror', 'objects', 'sound', 'autoFar']) $(key + 'Input').addEventListener('change', () => {
  prefs[key] = $(key + 'Input').checked; store.savePrefs(prefs); applyPreferences();
  if (key === 'sound' && prefs.sound) live.ensureAudio();
  if (key === 'voice' && !prefs.voice) trainerAudio.cancel();
  if (key === 'objects') live.resetEngine();
});
$('themeSelect').addEventListener('change', () => { prefs.theme = $('themeSelect').value; store.savePrefs(prefs); applyTheme(); });
document.querySelectorAll('input[name=llmModel]').forEach(radio => radio.addEventListener('change', async () => {
  prefs.llmModel = radio.value; store.savePrefs(prefs);
  await unloadLiveCoach(); if (prefs.liveCoach) ensureLiveCoach().catch(() => {});
}));
bus.on('prefs-changed', () => { applyPreferences(); if (app.dataset.screen === 'profile') renderPersonalities();  chat.renderHeader(); });

/* ───────────── Local LLM ───────────── */
function renderSetupReminder() {
  const voice = trainerAudio.states['piper:ru_RU-dmitri-medium'];
  const needsVoice = trainerAudio.supported && voice?.status === 'missing';
  const models = Object.values(modelManager.states);
  const needsModel = supportsWebGPU() && !models.some(model => model.status === 'cached') && models.some(model => ['missing', 'error'].includes(model.status));
  $('setupReminder').hidden = setupDismissed || (!needsVoice && !needsModel);
  text('setupReminderText', needsVoice && needsModel ? 'Скачай голос Дмитрия и Qwen для озвучивания и живого разговора.' : needsVoice ? 'Скачай голос Дмитрия, чтобы тренер озвучивал подсказки.' : 'Скачай Qwen, чтобы свободно общаться с тренером.');
  $('setupModelRow').hidden = !supportsWebGPU();
}
$('dismissSetup').addEventListener('click', () => {
  setupDismissed = true;
  try { sessionStorage.setItem('aimo:setup-dismissed', 'yes'); } catch { /* dismissal still works for this page */ }
  renderSetupReminder();
});
$('openSetup').addEventListener('click', () => openSheet('sheetSetup'));
$('closeSetup').addEventListener('click', closeSheet);
$('setupVoice').addEventListener('click', () => {
  closeSheet(); showScreen('profile');
  trainerAudio.release(); prefs.voiceId = 'piper:ru_RU-dmitri-medium'; store.savePrefs(prefs); renderVoiceOptions();
  $('voiceSettings').scrollIntoView({ block: 'start', behavior: 'smooth' });
  if (prefs.voice) {
    $('voicePicker').open = true;
    document.querySelector('input[name=trainerVoice]:checked')?.focus({ preventScroll: true });
  } else {
    $('voiceInput').focus({ preventScroll: true });
    toast('Включи «Озвучивать подсказки», чтобы выбрать голос');
  }
});
$('setupModel').addEventListener('click', () => {
  closeSheet(); showScreen('profile'); $('modelSettings').open = true;
  $('modelSettings').scrollIntoView({ block: 'start', behavior: 'smooth' });
  document.querySelector('[data-download-model]').focus({ preventScroll: true });
});
function renderModels() {
  for (const [key, info] of Object.entries(modelManager.states)) {
    const model = LLM_MODELS[key];
    const size = $(`modelSize-${key}`);
    size.textContent = `${model.size} · ${key === 'default' ? 'подробнее отвечает' : 'для слабых устройств'}`;
    size.title = `${model.bytes.toLocaleString('ru-RU')} байт`;
    text(`modelSpace-${key}`, `Рекомендуем освободить ${Math.ceil(model.bytes / 1e6 + 100)} МБ`);
    const button = document.querySelector(`[data-download-model="${key}"]`);
    const ready = info.status === 'cached';
    if (ready && key === prefs.llmModel && !prefs.liveCoach) { prefs.liveCoach = true; store.savePrefs(prefs); }
    button.textContent = ready ? 'Скачана' : info.status === 'loading' ? 'Загружается…' : 'Скачать';
    button.dataset.ready = String(ready);
    button.disabled = ready || modelManager.busy || trainerAudio.downloading || trainerAudio.deleting || info.status === 'checking' || !supportsWebGPU() || live.isActive();
    const remove = document.querySelector(`[data-delete-model="${key}"]`);
    remove.hidden = false;
    remove.disabled = !ready || modelManager.busy || trainerAudio.downloading || trainerAudio.deleting || live.isActive();
    remove.textContent = info.status === 'deleting' ? 'Удаляем…' : 'Удалить нейросеть';
    button.setAttribute('aria-label', `${ready ? 'Скачана' : 'Скачать'} ${LLM_MODELS[key].label}`);
    text(`modelStatus-${key}`, !supportsWebGPU() ? 'Этот браузер не поддерживает локальную нейросеть. Подсказки тренера доступны.' : info.message);
    const bar = $(`modelProgress-${key}`); bar.hidden = info.status !== 'loading'; bar.value = info.progress;
  }
  $('cancelModelDownload').hidden = !modelManager.downloading;
  renderLocalVoiceControls();
  chat.renderHeader();
  renderSetupReminder();
}
/** What the chat shows about the model: running, starting, or absent. */
const llmState = () => ({ loaded: Boolean(modelManager.loaded), loading: modelManager.busy && !modelManager.downloading, label: LLM_MODELS[prefs.llmModel].label });
/** The downloaded model joins the chat: started in the background when the chat is in use. */
function warmLiveCoach() {
  if (!profile || !prefs.liveCoach || !supportsWebGPU() || live.isActive() || modelManager.busy || modelManager.loaded) return;
  ensureLiveCoach().catch(() => {});
}
document.querySelectorAll('[data-download-model]').forEach(button => button.addEventListener('click', async () => {
  const key = button.dataset.downloadModel;
  text('liveCoachStatus', `Скачиваем ${LLM_MODELS[key].label}. Можно отменить загрузку.`);
  try {
    await modelManager.download(key);
    text('liveCoachStatus', `${LLM_MODELS[key].label} скачана. Она будет использоваться в эфире и чате.`);
    // The model is now part of the chat: tell the person there and start it right away.
    prefs.llmModel = key; prefs.liveCoach = true; store.savePrefs(prefs); applyPreferences();
    chat.postSystem(`Живой тренер подключён: ${LLM_MODELS[key].label} теперь отвечает в чате и в эфире, всё на устройстве`);
    warmLiveCoach();
  }
  catch (error) { if (error.name !== 'AbortError') { text('liveCoachStatus', error.message); toast(error.message); } }
}));
$('cancelModelDownload').addEventListener('click', async () => { await modelManager.cancelDownload(); text('liveCoachStatus', 'Скачивание отменено.'); modelManager.refresh(); });
document.querySelectorAll('[data-delete-model]').forEach(button => button.addEventListener('click', async () => {
  if (modelManager.busy || trainerAudio.downloading || trainerAudio.deleting || live.isActive()) return;
  const key = button.dataset.deleteModel;
  if (!authorizeAction('delete-model', { key })) return;
  try {
    await modelManager.remove(key);
    if (prefs.llmModel === key) { prefs.liveCoach = false; store.savePrefs(prefs); }
    text('liveCoachStatus', `${LLM_MODELS[key].label} удалена с устройства. Можно скачать её снова.`);
    renderModels();
  } catch (error) { text('liveCoachStatus', error.message); toast(error.message); }
}));
async function ensureLiveCoach() {
  try {
    const coach = await modelManager.activate(prefs.llmModel);
    text('liveCoachStatus', `Живой тренер готов · ${LLM_MODELS[prefs.llmModel].label}`);
    return coach;
  } catch (error) {
    if (error.name !== 'AbortError') {
      text('liveCoachStatus', error.message || 'Не удалось запустить модель.');
      if (!modelManager.downloading) { prefs.liveCoach = false; store.savePrefs(prefs); applyPreferences(); }
    }
    throw error;
  }
}
async function unloadLiveCoach() {
  await modelManager.release();
  text('liveCoachStatus', 'Модель выгружена из памяти. Скачанные файлы остаются в кеше.');
}
window.addEventListener('pagehide', () => { liveStartRequest++; chat.cancelReply(); modelManager.dispose(); trainerAudio.dispose(); });
window.addEventListener('pageshow', event => { if (event.persisted) { modelManager = makeModelManager(); renderModels(); } });
if (!supportsWebGPU()) text('liveCoachStatus', 'Этот браузер не поддерживает локальную нейросеть. Подсказки тренера доступны.');

/* ───────────── Trainer voice ───────────── */
function renderVoiceOptions() {
  const list = $('localVoiceList'); list.replaceChildren();
  for (const voice of LOCAL_VOICES) {
    const card = el('div', 'model-card voice-card'); card.dataset.voice = voice.id;
    const label = el('label'), radio = el('input'); radio.type = 'radio'; radio.name = 'trainerVoice'; radio.value = voice.id;
    const copy = el('span', null, voice.name); copy.append(el('small', null, `${voice.description} · ${Math.round((voice.modelBytes + voice.configBytes) / 1e6)} МБ`));
    label.append(radio, copy); card.append(label);
    const actions = el('div', 'model-actions');
    for (const [action, title] of [['download', 'Скачать'], ['preview', 'Прослушать'], ['delete', 'Удалить голос'], ['cancel', 'Отменить']]) {
      const button = el('button', `btn-ghost small${action === 'delete' ? ' danger' : ''}`, title);
      button.type = 'button'; button.dataset.voiceAction = action;
      button.setAttribute('aria-label', `${title}: ${voice.name}`); actions.append(button);
    }
    const status = el('p', 'model-status'); status.dataset.voiceStatus = ''; status.setAttribute('role', 'status');
    const progress = el('progress'); progress.max = 1; progress.value = 0; progress.hidden = true;
    progress.setAttribute('aria-label', `Скачивание голоса: ${voice.name}`);
    card.append(actions, status, progress); list.append(card);
  }
  const select = $('coachVoiceSelect'); select.replaceChildren(el('option', null, 'Автоматически · русский'));
  select.options[0].value = '';
  for (const voice of russianVoices(window.speechSynthesis?.getVoices() || [])) {
    const option = el('option', null, `${voice.name}${voice.localService ? '' : ' · онлайн'}`); option.value = voiceKey(voice); select.append(option);
  }
  select.value = localVoice(prefs.voiceId) ? '' : prefs.voiceId;
  if (select.selectedIndex < 0) select.value = '';
  renderLocalVoiceControls();
}
function renderLocalVoiceControls() {
  const busy = trainerAudio.downloading || trainerAudio.deleting;
  for (const card of $('localVoiceList').children) {
    const voice = localVoice(card.dataset.voice), state = trainerAudio.states[voice.id];
    const ready = state.status === 'cached';
    card.querySelector('input').checked = prefs.voiceId === voice.id;
    card.querySelector('input').disabled = busy;
    const download = card.querySelector('[data-voice-action="download"]');
    download.textContent = ready ? 'Скачан' : state.status === 'downloading' ? 'Скачивается…' : 'Скачать';
    download.disabled = ready || busy || modelManager.busy || live.isActive() || !trainerAudio.supported || state.status === 'unknown';
    card.querySelector('[data-voice-action="preview"]').disabled = !ready || busy || live.isActive();
    const remove = card.querySelector('[data-voice-action="delete"]');
    remove.disabled = !ready || busy || modelManager.busy || live.isActive();
    remove.textContent = state.status === 'deleting' ? 'Удаляем…' : 'Удалить голос';
    card.querySelector('[data-voice-action="cancel"]').hidden = state.status !== 'downloading';
    const progress = card.querySelector('progress'); progress.hidden = state.status !== 'downloading'; progress.value = state.progress;
    card.querySelector('[data-voice-status]').textContent = !trainerAudio.supported ? 'Для скачивания нужно локальное хранилище и Web Audio.'
      : state.status === 'deleting' ? 'Удаляем с устройства…' : ready ? 'Скачан на это устройство' : state.status === 'unknown' ? 'Проверяем хранилище…' : state.status === 'downloading' ? `Скачивание: ${Math.floor(state.progress * 100)}%` : 'Ещё не скачан';
  }
  const systemRadio = document.querySelector('input[name=trainerVoice][value=""]');
  systemRadio.checked = !localVoice(prefs.voiceId); systemRadio.disabled = busy;
  $('coachVoiceSelect').disabled = busy;
  $('previewCoachVoice').disabled = busy || live.isActive() || !window.speechSynthesis;
  const selected = localVoice(prefs.voiceId);
  text('voiceHint', selected ? `${selected.name} · ${selected.description}` : 'Голос браузера · русский');
  text('voiceDownloadStatus', trainerAudio.status);
}
function chooseVoice(id) {
  trainerAudio.release(); prefs.voiceId = id; store.savePrefs(prefs); renderLocalVoiceControls();
}
function previewVoice(id) {
  const voice = localVoice(id) || selectedVoice(window.speechSynthesis?.getVoices() || [], id);
  const introduction = voice ? `Меня зовут ${voice.name}. ` : '';
  trainerAudio.unlock();
  return trainerAudio.speak(`Привет! ${introduction}Приятно познакомиться! Давай начнём тренировку.`, { ...prefs, voiceId: id }, PERSONALITIES[prefs.personality]);
}
$('voicePicker').addEventListener('change', event => {
  if (event.target.name === 'trainerVoice') chooseVoice(event.target.value || $('coachVoiceSelect').value);
});
$('localVoiceList').addEventListener('click', async event => {
  const button = event.target.closest('[data-voice-action]'); if (!button || button.disabled) return;
  const id = button.closest('[data-voice]').dataset.voice, action = button.dataset.voiceAction;
  try {
    if (action === 'preview') {
      await previewVoice(id);
    } else if (action === 'cancel') await trainerAudio.cancelDownload();
    else {
      if (modelManager.busy || live.isActive() || trainerAudio.downloading || trainerAudio.deleting) return;
      if (action === 'download') await trainerAudio.downloadVoice(id);
      if (action === 'delete' && authorizeAction('delete-voice', { id })) await trainerAudio.removeVoice(id);
    }
  } catch (error) { if (error.name !== 'AbortError') toast(error.message); }
});
trainerAudio.onChange(() => { renderLocalVoiceControls(); renderModels(); });
function renderSpeechSettings() {
  $('voiceVolumeInput').value = Math.round(prefs.voiceVolume * 100);
  $('voiceRateInput').value = prefs.voiceRate;
  text('voiceVolumeValue', `${Math.round(prefs.voiceVolume * 100)}%`);
  // The preferred engine rate 0.7 is the user's normal 1×; stored/playback rates stay unchanged.
  const rateLabel = `${(prefs.voiceRate / 0.7).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}×`;
  text('voiceRateValue', rateLabel);
  $('voiceRateInput').setAttribute('aria-valuetext', rateLabel);
}
for (const [id, key, scale] of [['voiceVolumeInput', 'voiceVolume', 100], ['voiceRateInput', 'voiceRate', 1]]) {
  $(id).addEventListener('input', () => {
    prefs[key] = Number($(id).value) / scale;
    store.savePrefs(prefs); renderSpeechSettings();
  });
}
renderSpeechSettings();
$('coachVoiceSelect').addEventListener('change', () => chooseVoice($('coachVoiceSelect').value));
$('previewCoachVoice').addEventListener('click', () => {
  previewVoice($('coachVoiceSelect').value);
});
window.speechSynthesis?.addEventListener('voiceschanged', renderVoiceOptions);
renderVoiceOptions(); renderModels(); trainerAudio.refresh(); modelManager.refresh();

/* ───────────── Live wiring ───────────── */
async function startSession(options) {
  if (!authorizeAction('start-live', options)) { toast('Некорректные параметры эфира'); return; }
  options = Object.freeze({ ...options });
  chat.cancelReply();
  live.unlockSpeech(); live.ensureAudio();
  const request = ++liveStartRequest; closeSheet(); setDrawer(false);
  await trainerAudio.cancelDownload(); if (request !== liveStartRequest) return;
  if (modelManager.downloading) { await modelManager.cancelDownload(); toast('Скачивание остановлено: анализ движений важнее.'); }
  await modelManager.release(); if (request !== liveStartRequest) return;
  live.startLive(options);
}
bus.on('start-live', startSession);
// The plate's button: a fresh chat for this session, the skill becomes the current one.
bus.on('live-pick', ({ skillId }) => { chat.newThread(); chat.introduceSkill(skillId); });
live.initPlate();
bus.on('gesture', () => { live.unlockSpeech(); live.ensureAudio(); });
bus.on('live-final-text', data => chat.attachLiveText(data.live));
bus.on('live-failed', () => chat.postSystem('Эфир не запустился'));
bus.on('live-cancelled', () => chat.postSystem('Эфир отменён'));
bus.on('live-finished', (data) => { chat.postSummary(data); if (app.dataset.screen === 'progress') renderProgress(); chat.setHistory(history); renderModels(); warmLiveCoach(); });
live.initLive({
  prefs, profile, ensureLiveCoach, getLiveCoach: () => modelManager.loaded,
  // After the live screen the model stays for the chat while the setting is on; otherwise it is unloaded.
  async releaseCoach(coach) { if (!live.isActive() && (!coach || modelManager.loaded === coach) && !prefs.liveCoach) await unloadLiveCoach(); },
  onHistory(record) {
    const progress = compareProgress(record, history.slice(0, 49));
    history = [record, ...history].slice(0, 50); store.saveHistory(history); chat.setHistory(history);
    return progress;
  },
});
chat.initChat({ prefs, profile, history, ensureLiveCoach, getLiveCoach: () => modelManager.loaded, llmState });

/* ───────────── Coming back after a break opens a new chat ───────────── */
const NEW_CHAT_AFTER_MS = 30 * 60 * 1000;
let hiddenAt = 0;
function comeBack() {
  const away = hiddenAt ? Date.now() - hiddenAt : 0; hiddenAt = 0;
  if (!profile || live.isActive() || away < NEW_CHAT_AFTER_MS) return;
  closeSheet(); setDrawer(false, { focus: false }); chat.openFresh(); showScreen('chat');
}
document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenAt = Date.now(); else comeBack(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) comeBack(); });

/* ───────────── Enter ───────────── */
function enterApp() {
  syncProfile(); applyPreferences(); renderCatalog();
  chat.setHistory(history); chat.openFresh();
  showScreen('chat');
  warmLiveCoach();
}
/* ───────────── Offline ───────────── */
// The installed shell works offline; vision also needs its model files cached (sw.js).
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
window.addEventListener('offline', () => toast('Нет сети: доступны сохранённые на устройстве модели'));
window.addEventListener('online', () => toast('Сеть снова есть'));

applyTheme();
if (profile) enterApp(); else { app.dataset.screen = 'login'; setTimeout(() => $('loginName').focus(), 100); }
