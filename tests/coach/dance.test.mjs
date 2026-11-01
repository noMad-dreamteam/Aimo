import test from 'node:test';
import assert from 'node:assert/strict';
import zolo from '../../src/skills/zolo.js';
import trend from '../../src/skills/trend-dance.js';
import { dancePose } from '../../src/skills/dance-common.js';
import { observePose, createPoseState } from '../../src/coach/engine.js';
import { bodyFeatures } from '../../src/coach/motion.js';
import { pauseMemo } from '../../src/skills/common.js';

function run(skill, frames, aspect = 9 / 16) {
  let state = createPoseState(), now = 0; const events = [];
  for (const points of frames) {
    const result = observePose(points, state, now, aspect, skill.id); state = result.state; now += 110;
    if (result.obs.motion?.event) events.push(result.obs.motion.event);
  }
  return { state, events };
}
for (const [skill, variant] of [[zolo, 'zolo'], [trend, 'step-touch']]) {
  const pose = (open, options = {}) => dancePose(open, { variant, ...options });
  const repeat = (p, n = 6) => Array.from({ length: n }, () => p);
  test(`${skill.id}: hands-only, legs-only and holding the target pose are not completed combinations`, () => {
    for (const options of [{ legs: false }, { arms: false }]) {
      const frames = [...repeat(pose(0)), ...repeat(pose(1, options)), ...repeat(pose(0))];
      assert.equal(run(skill, frames).events.filter(e => e.type === 'rep').length, 0);
    }
    assert.equal(run(skill, repeat(pose(1), 60)).events.length, 0);
  });
  test(`${skill.id}: a single noisy frame and separate arm/leg movements do not count`, () => {
    const frames = [...repeat(pose(0)), pose(1), ...repeat(pose(0))];
    assert.equal(run(skill, frames).events.filter(e => e.type === 'rep').length, 0);
    const separate = [...repeat(pose(0)), ...repeat(pose(1, { legs: false })), ...repeat(pose(1, { arms: false })), ...repeat(pose(0))];
    assert.equal(run(skill, separate).events.filter(e => e.type === 'rep').length, 0);
  });
  test(`${skill.id}: loss of the person drops an incomplete movement, then a new cycle counts once`, () => {
    const frames = [...repeat(pose(0)), ...repeat(pose(1)), null, ...repeat(pose(0))];
    assert.equal(run(skill, frames).events.filter(e => e.type === 'rep').length, 0);
    frames.push(...repeat(pose(1)), ...repeat(pose(0)));
    assert.equal(run(skill, frames).events.filter(e => e.type === 'rep').length, 1);
  });
  test(`${skill.id}: full-body visibility and a complete cycle work in portrait and landscape`, () => {
    for (const aspect of [9 / 16, 16 / 9]) {
      const closed = pose(0, { aspect }), open = pose(1, { aspect });
      const result = run(skill, [...repeat(closed), ...repeat(open), ...repeat(closed)], aspect);
      assert.equal(result.events.filter(e => e.type === 'rep').length, 1);
      const cropped = open.map((p, i) => i === 15 ? { ...p, visibility: 0 } : p);
      assert.equal(run(skill, [...repeat(closed), ...repeat(cropped), ...repeat(closed)], aspect).events.filter(e => e.type === 'rep').length, 0);
    }
  });
  test(`${skill.id}: observation does not mutate its memo; pause clears a cycle but retains totals`, () => {
    const f = bodyFeatures(pose(0), 9 / 16);
    const memo = skill.measure({ f, still: true, now: 0 }).memo;
    const before = JSON.stringify(memo);
    skill.measure({ f: bodyFeatures(pose(1), 9 / 16), still: true, now: 500 }, memo);
    assert.equal(JSON.stringify(memo), before);
    const paused = pauseMemo({ ...memo, count: 4, cur: { phase: 'open' } });
    assert.equal(paused.cur, null); assert.equal(paused.count, 4);
  });
}
