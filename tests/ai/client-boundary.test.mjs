import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPlannerMessages } from '../../src/ai/planner.js';
import { SKILL_LIST } from '../../src/skills/index.js';

test('actual client rejects forged requests, excess budgets and tool responses before returning text', async () => {
  const calls = []; let response, interrupted = 0, terminated = 0;
  const engine = { chat: { completions: { async create(request) { calls.push(request); return response; } } },
    interruptGenerate() { interrupted++; }, async unload() {} };
  const key = '__aimoSecurityTestEngine';
  const worker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const gpu = Object.getOwnPropertyDescriptor(navigator, 'gpu');
  globalThis[key] = { hasModelInCache: async () => true, CreateWebWorkerMLCEngine: async () => engine };
  Object.defineProperty(navigator, 'gpu', { configurable: true, value: {} });
  globalThis.Worker = class { terminate() { terminated++; } };
  try {
    const url = new URL('../../src/ai/llm.js', import.meta.url);
    let source = await readFile(url, 'utf8');
    // Replace the external loader only; all client validation/lifecycle code runs.
    source = source.replace('import(WEBLLM_URL)', `Promise.resolve(globalThis.${key})`)
      .replace(/from '(\.[^']+)'/g, (_, specifier) => `from '${new URL(specifier, url).href}'`)
      .replaceAll('import.meta.url', JSON.stringify(url.href));
    const { createLocalCoach } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    await assert.rejects(createLocalCoach({ modelId: 'https://example.com/model' }), /Неизвестная модель/);
    const client = await createLocalCoach();
    const messages = buildPlannerMessages('Хочу укрепить ноги', SKILL_LIST);
    assert.equal(await client.chat(JSON.parse(JSON.stringify(messages))), null);
    assert.equal(await client.chat(messages, { maxTokens: 100000 }), null);
    assert.equal(await client.stream(messages, { temperature: NaN }), null);
    assert.equal(calls.length, 0);
    response = { choices: [{ message: { content: 'Привет!', tool_calls: [{ function: { name: 'delete-chats' } }] } }] };
    assert.equal(await client.chat(messages), null);
    response = { choices: [{ message: { content: 'Привет!' } }] };
    assert.equal(await client.chat(messages), 'Привет!');
    assert.ok(calls.every(request => !('tools' in request) && !('tool_choice' in request)));
    response = (async function* () { yield { choices: [{ delta: { tool_calls: [], content: 'Привет!' } }] }; })();
    let token = false;
    assert.equal(await client.stream(messages, { onToken() { token = true; } }), null);
    assert.equal(token, false); assert.equal(interrupted, 1);
    await client.unload(); assert.equal(terminated, 1);
    assert.equal(await client.chat(messages), null);
  } finally {
    delete globalThis[key];
    if (worker) Object.defineProperty(globalThis, 'Worker', worker); else delete globalThis.Worker;
    if (gpu) Object.defineProperty(navigator, 'gpu', gpu); else delete navigator.gpu;
  }
});
