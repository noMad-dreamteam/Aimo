import test from 'node:test';
import assert from 'node:assert/strict';
import { initialTabbarState, nextTabbarState, initTabbar } from '../../src/app/tabbar.js';

test('menu hides on sustained downward scrolling and returns on upward scrolling', () => {
  let state = initialTabbarState(20);
  state = nextTabbarState(state, 30, 500); assert.equal(state.hidden, false);
  state = nextTabbarState(state, 42, 500); assert.equal(state.hidden, true);
  state = nextTabbarState(state, 38, 500); assert.equal(state.hidden, true);
  state = nextTabbarState(state, 34, 500); assert.equal(state.hidden, false);
});

test('small direction changes do not flicker the menu', () => {
  let state = nextTabbarState(initialTabbarState(40), 65, 500);
  for (const top of [63, 65, 62, 64, 61, 63]) {
    state = nextTabbarState(state, top, 500); assert.equal(state.hidden, true);
  }
  state = nextTabbarState(state, 54, 500); assert.equal(state.hidden, false);
});

test('top edge and a page without overflow always show the menu', () => {
  const hidden = nextTabbarState(initialTabbarState(40), 80, 500);
  assert.equal(nextTabbarState(hidden, 7, 500).hidden, false);
  assert.equal(nextTabbarState(hidden, -30, 500).top, 0);
  assert.equal(nextTabbarState(hidden, 80, 0).hidden, false);
  assert.equal(nextTabbarState(hidden, 80, NaN).hidden, false);
});

test('Safari overscroll at the bottom does not falsely reveal the menu on bounce', () => {
  let state = nextTabbarState(initialTabbarState(170), 200, 200);
  state = nextTabbarState(state, 240, 200); assert.equal(state.top, 200);
  state = nextTabbarState(state, 200, 200); assert.equal(state.hidden, true);
  state = nextTabbarState(state, 190, 200); assert.equal(state.hidden, false);
});

test('reset on a changed tab starts visible at its current scroll position', () => {
  const state = initialTabbarState(180);
  assert.equal(state.hidden, false);
  assert.equal(nextTabbarState(state, 182, 500).hidden, false);
  assert.equal(nextTabbarState(state, NaN, 500).hidden, false);
});

function navigationFixture() {
  const app = Object.assign(new EventTarget(), { dataset: { screen: 'profile', live: 'off', keyboard: 'closed' } });
  const bar = Object.assign(new EventTarget(), { inert: false, querySelector: () => null });
  const surface = name => Object.assign(new EventTarget(), {
    scrollTop: 0, scrollHeight: 800, clientHeight: 300,
    closest: () => ({ dataset: { screen: name } }),
  });
  const profile = surface('profile');
  const chat = surface('chat');
  chat.id = 'chatList';
  const navigation = initTabbar({ app, bar, surfaces: [profile, chat] });
  function scroll(target, top) { target.scrollTop = top; target.dispatchEvent(new Event('scroll')); }
  return { app, bar, profile, chat, navigation, scroll };
}

test('only the visible screen controls navigation, outside live and keyboard modes', () => {
  const { app, bar, profile, chat, scroll } = navigationFixture();
  scroll(chat, 100);
  assert.equal(app.dataset.navHidden, 'false');
  app.dataset.live = 'on'; scroll(profile, 100);
  assert.equal(bar.inert, false);
  app.dataset.live = 'off'; app.dataset.keyboard = 'open'; scroll(profile, 150);
  assert.equal(bar.inert, false);
  app.dataset.keyboard = 'closed'; scroll(profile, 180);
  assert.equal(app.dataset.navHidden, 'true');
  assert.equal(bar.inert, true);
  scroll(profile, 170);
  assert.equal(bar.inert, false);
});

test('reset restores navigation and measures subsequent scroll from the current position', () => {
  const { app, bar, profile, navigation, scroll } = navigationFixture();
  scroll(profile, 100);
  assert.equal(bar.inert, true);
  navigation.reset();
  assert.equal(app.dataset.navHidden, 'false');
  assert.equal(bar.inert, false);
  scroll(profile, 102);
  assert.equal(bar.inert, false);
  scroll(profile, 125);
  assert.equal(bar.inert, true);
});

test('keyboard navigation reveals hidden links and scrolling preserves visible focus', () => {
  const { app, bar, profile, scroll } = navigationFixture();
  scroll(profile, 100);
  const tab = new Event('keydown');
  Object.defineProperty(tab, 'key', { value: 'Tab' });
  app.dispatchEvent(tab);
  assert.equal(bar.inert, false);
  assert.equal(app.dataset.navHidden, 'false');
  bar.querySelector = () => ({});
  scroll(profile, 160);
  assert.equal(bar.inert, false);
  bar.querySelector = () => null;
  scroll(profile, 190);
  assert.equal(bar.inert, true);
});

test('the measured stack height reserves room for chips, input and navigation, ignoring hidden screens', () => {
  const old = globalThis.ResizeObserver;
  let resize, target;
  globalThis.ResizeObserver = class { constructor(callback) { resize = callback; } observe(element) { target = element; } };
  try {
    const f = navigationFixture();
    const values = [];
    f.app.style = { setProperty: (name, value) => values.push([name, value]) };
    assert.equal(target, f.bar);
    resize([{ contentRect: { height: 182.5 } }]);
    resize([{ contentRect: { height: 0 } }]);
    resize([{ contentRect: { height: 110 } }]);
    assert.deepEqual(values, [['--bottom-controls-h', '183px'], ['--bottom-controls-h', '110px']]);
  } finally {
    if (old === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = old;
  }
});

test('chat restores the controls at the last message without needing an upward scroll', () => {
  const options = { revealAtEnd: true };
  let state = nextTabbarState(initialTabbarState(300), 350, 500, options);
  assert.equal(state.hidden, true, 'downward scrolling in the middle still hides controls');
  state = nextTabbarState(state, 475, 500, options);
  assert.equal(state.hidden, true);
  state = nextTabbarState(state, 476, 500, options);
  assert.equal(state.hidden, false, 'restore just before reaching the end');
  for (const top of [500, 550, 500, 498]) {
    state = nextTabbarState(state, top, 500, options);
    assert.equal(state.hidden, false, 'inertia and bounce never leave an empty footer');
  }
});

test('restoring chat controls does not change the scroll position or hide them after a content shrink', () => {
  const hidden = nextTabbarState(initialTabbarState(300), 350, 500);
  const state = nextTabbarState(hidden, 350, 350, { revealAtEnd: true });
  assert.equal(state.hidden, false);
  assert.equal(state.top, 350);
  assert.equal(nextTabbarState(hidden, 500, 500).hidden, true, 'other screens keep their existing behavior');
});

test('chat scroll events reveal the whole bottom stack and remove inert at the end', () => {
  const { app, bar, chat, scroll } = navigationFixture();
  app.dataset.screen = 'chat';
  scroll(chat, 300); assert.equal(bar.inert, true);
  scroll(chat, 500); assert.equal(app.dataset.navHidden, 'false'); assert.equal(bar.inert, false);
  scroll(chat, 490); assert.equal(bar.inert, false);
  scroll(chat, 400); assert.equal(bar.inert, false);
  scroll(chat, 430); assert.equal(bar.inert, true, 'downward scrolling away from the last message still hides the stack');
});
