import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoachEngine } from '../../src/coach/engine.js';

function harness({ failDetector = false, failClose = false } = {}) {
  const timestamps = [], closed = [], delegates = [];
  let detected = 0;
  const pose = { detectForVideo(_video, timestamp) { timestamps.push(timestamp); return { landmarks: [] }; }, close() { closed.push('pose'); if (failClose) throw new Error('close failed'); } };
  const detector = { detectForVideo() {
    if (++detected > 1 && failDetector) throw new Error('detector failed');
    return { detections: [{ boundingBox: { originX: 200, originY: 200, width: 50, height: 50 }, categories: [{ categoryName: 'sports ball', score: .8 }] }] };
  }, close() { closed.push('objects'); } };
  return { timestamps, closed, delegates, loadVision: async () => ({
    FilesetResolver: { forVisionTasks: async () => ({}) },
    PoseLandmarker: { async createFromOptions(_files, options) { delegates.push(options.baseOptions.delegate); if (delegates.length === 1) throw new Error('No GPU'); return pose; } },
    ObjectDetector: { createFromOptions: async () => detector },
  }) };
}
const video = { readyState: 2, videoWidth: 720, videoHeight: 1280 };

test('CPU fallback keeps timestamps increasing and a failed detector cannot leave a visible phantom ball', async () => {
  const h = harness({ failDetector: true });
  const engine = await createCoachEngine({ loadVision: h.loadVision }); engine.start('football');
  assert.deepEqual(h.delegates, ['GPU', 'CPU']);
  assert.ok(engine.analyze(video, 1000).ball);
  const failed = engine.analyze(video, 1300);
  assert.equal(failed.ball, null); assert.equal(failed.metrics.ballSeen, false); assert.equal(failed.objectDetector, false);
  engine.analyze(video, 1200);
  assert.deepEqual(h.timestamps, [1000, 1300, 1301]);
  engine.close(); engine.close(); assert.deepEqual(h.closed, ['objects', 'pose']);
});

test('closing a failed pose runtime still releases the object detector', async () => {
  const h = harness({ failClose: true }); const engine = await createCoachEngine({ loadVision: h.loadVision });
  assert.throws(() => engine.close(), /close failed/);
  assert.deepEqual(h.closed, ['pose', 'objects']);
  engine.close(); assert.equal(h.closed.length, 2);
});
