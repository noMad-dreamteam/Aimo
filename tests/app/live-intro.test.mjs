import test from 'node:test';
import assert from 'node:assert/strict';
import { liveWelcome, liveSpeechRate } from '../../src/app/live-intro.js';

test('the welcome names the athlete and explains choosing a skill without inventing observations', () => {
  for (const personality of ['strict', 'fun', 'calm', 'unknown']) {
    const message = liveWelcome({ name: 'Саша', personality });
    assert.match(message, /^Привет, Саша!/);
    assert.match(message, /Выбери навык/);
    assert.match(message, /Начать эфир/);
    assert.ok(message.length <= 280, 'the local audio layer must not truncate the welcome');
    assert.doesNotMatch(message, /вижу|сделал|повтор|точность|успех/i);
  }
});
test('no name and a long name keep the welcome usable and within the speech limit', () => {
  assert.match(liveWelcome(), /^Привет!/);
  assert.match(liveWelcome({ name: null }), /^Привет!/);
  const message = liveWelcome({ name: 'А'.repeat(100), personality: 'fun' });
  assert.ok(message.length <= 280); assert.ok(!message.includes('undefined'));
});
test('live speech is calm, respects slower settings and leaves saved preferences alone', () => {
  const prefs = { voiceRate: 1.4 };
  assert.equal(liveSpeechRate(prefs.voiceRate), 0.7);
  assert.equal(liveSpeechRate(prefs.voiceRate, true), 0.65);
  assert.equal(liveSpeechRate(0.5, true), 0.5);
  assert.equal(liveSpeechRate(NaN), 0.7);
  assert.equal(liveSpeechRate(undefined, true), 0.65);
  assert.equal(prefs.voiceRate, 1.4);
});
