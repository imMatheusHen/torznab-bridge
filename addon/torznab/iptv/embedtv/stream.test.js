import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { streamToResponse } from './stream.js';

test('cancels the upstream Web stream when the downstream closes early', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
    },
    pull() {},
    cancel() {
      cancelled = true;
    },
  });
  const destination = new PassThrough();
  streamToResponse({ body }, destination);
  destination.destroy();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(cancelled, true);
});
