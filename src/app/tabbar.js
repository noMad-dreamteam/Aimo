// Direction hysteresis keeps the floating menu steady during small scroll jitters.
export function initialTabbarState(top = 0) {
  return { top: Number.isFinite(top) ? Math.max(0, top) : 0, direction: 0, distance: 0, hidden: false };
}

export function nextTabbarState(state, scrollTop, maxScroll, { revealAtEnd = false } = {}) {
  const max = Number.isFinite(maxScroll) ? Math.max(0, maxScroll) : 0;
  const top = Math.max(0, Math.min(max, Number.isFinite(scrollTop) ? scrollTop : 0));
  // In chat the reserved space below the last message is occupied by the controls.
  // Always restore them at the end instead of leaving that space empty.
  if (max <= 1 || top <= 8 || (revealAtEnd && max - top <= 24)) return initialTabbarState(top);
  const delta = top - state.top;
  if (Math.abs(delta) < .5) return { ...state, top };
  const direction = Math.sign(delta);
  const distance = Math.min(40, direction === state.direction ? state.distance + Math.abs(delta) : Math.abs(delta));
  const hidden = direction > 0 && distance >= 20 ? true : direction < 0 && distance >= 8 ? false : state.hidden;
  return { top, direction, distance, hidden };
}

export function initTabbar({ app, bar, surfaces }) {
  const states = new WeakMap();
  // Keep the last message above the entire stack, even when chips or typing change height.
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(entries => {
    const height = entries[0]?.contentRect.height;
    if (height > 0) app.style.setProperty('--bottom-controls-h', `${Math.ceil(height)}px`);
  }).observe(bar);
  function display(hidden) {
    app.dataset.navHidden = String(hidden);
    bar.inert = hidden;
  }
  function reset() {
    for (const surface of surfaces) states.set(surface, initialTabbarState(surface.scrollTop));
    display(false);
  }
  for (const surface of surfaces) {
    surface.addEventListener('scroll', () => {
      if (surface.closest('.screen')?.dataset.screen !== app.dataset.screen || app.dataset.live === 'on' || app.dataset.keyboard === 'open') return;
      const next = nextTabbarState(states.get(surface) || initialTabbarState(), surface.scrollTop, surface.scrollHeight - surface.clientHeight, { revealAtEnd: surface.id === 'chatList' });
      states.set(surface, next);
      // Keyboard focus must stay reachable while the menu is being used.
      display(next.hidden && !bar.querySelector(':focus-visible'));
    }, { passive: true });
  }
  bar.addEventListener('focusin', () => display(false));
  // Restore hidden links before the browser chooses the next keyboard target.
  app.addEventListener('keydown', event => { if (event.key === 'Tab') reset(); });
  reset();
  return { reset };
}
