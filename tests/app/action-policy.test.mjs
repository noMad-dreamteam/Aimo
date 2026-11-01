import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeAction, validateAction } from '../../src/app/action-policy.js';

test('unknown actions, untrusted sources and malformed live requests have no privileges', () => {
  const valid = { skillId: 'football', mode: 'camera' };
  assert.equal(validateAction('start-live', valid), true);
  assert.equal(validateAction('start-live', { ...valid, mode: 'demo', pick: true }), true);
  for (const source of ['model', 'worker', 'external', '', null]) {
    assert.equal(validateAction('start-live', valid, source), false);
    assert.equal(authorizeAction('delete-chats', {}, { source, confirm: () => { assert.fail('no confirmation for unauthorized actor'); } }), false);
  }
  for (const args of [null, [], {}, { ...valid, skillId: '__proto__' }, { ...valid, mode: 'shell' },
    { ...valid, url: 'https://example.com' }, { ...valid, pick: 'yes' }, { ...valid, file: {} },
    { ...valid, mode: 'file', file: { type: 'video/mp4', size: 10 } }]) assert.equal(validateAction('start-live', args), false);
  assert.equal(validateAction('execute', {}), false);
  assert.equal(validateAction('start-live', { ...valid, mode: 'file', file: new File(['v'], 'test.mp4', { type: 'video/mp4' }) }), true);
  assert.equal(validateAction('start-live', { ...valid, mode: 'file', file: new File(['v'], 'test.html', { type: 'text/html' }) }), false);
});

test('every destructive action requires a fresh exact human approval, otherwise fails closed', () => {
  for (const [action, args, target] of [['delete-chats', {}, /все чаты/], ['delete-chat', { id: 'thread-1' }, /этот чат/],
    ['delete-history', {}, /весь прогресс/], ['delete-model', { key: 'small' }, /Qwen 0.5B/],
    ['delete-voice', { id: 'piper:ru_RU-denis-medium' }, /Денис/]]) {
    let calls = 0;
    assert.equal(authorizeAction(action, args, { confirm: message => { calls++; assert.match(message, target); return true; } }), true);
    assert.equal(calls, 1);
    for (const result of [false, undefined, 'true', 1, Promise.resolve(true)]) assert.equal(authorizeAction(action, args, { confirm: () => result }), false);
    assert.equal(authorizeAction(action, args, { confirm: () => { throw new Error('unavailable'); } }), false);
  }
  for (const [action, args] of [['delete-chat', { id: '' }], ['delete-model', { key: '../other' }],
    ['delete-voice', { id: 'unknown' }], ['delete-history', { force: true }]]) {
    assert.equal(authorizeAction(action, args, { confirm: () => assert.fail('invalid input must not reach approval') }), false);
  }
});
