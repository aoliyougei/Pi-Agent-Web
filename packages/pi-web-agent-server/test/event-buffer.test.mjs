import assert from "node:assert/strict";
import test from "node:test";
import { EventBuffer } from "../dist/runtime/event-buffer.js";

test("assigns ordered IDs and stores immutable serialized payloads", () => {
  const buffer = new EventBuffer(3);
  const payload = { type: "one", nested: { value: 1 } };
  assert.deepEqual(buffer.append(payload), { id: "1", data: '{"type":"one","nested":{"value":1}}' });
  payload.nested.value = 2;
  assert.deepEqual(buffer.append({ type: "two" }), { id: "2", data: '{"type":"two"}' });
  assert.deepEqual(buffer.replayAfter("1"), {
    resyncRequired: false,
    events: [{ id: "2", data: '{"type":"two"}' }],
  });
  assert.equal(buffer.replayAfter("0").events[0].data, '{"type":"one","nested":{"value":1}}');
});

test("evicts to capacity and requires resync for stale or unknown cursors", () => {
  const buffer = new EventBuffer(2);
  buffer.append({ n: 1 });
  buffer.append({ n: 2 });
  buffer.append({ n: 3 });
  buffer.append({ n: 4 });
  assert.deepEqual(buffer.replayAfter("2"), {
    resyncRequired: false,
    events: [{ id: "3", data: '{"n":3}' }, { id: "4", data: '{"n":4}' }],
  });
  for (const cursor of ["1", "999", "not-an-id"]) {
    assert.deepEqual(buffer.replayAfter(cursor), { resyncRequired: true, events: [] });
  }
});

test("a connection without a cursor starts live instead of replaying history", () => {
  const buffer = new EventBuffer(2);
  buffer.append({ n: 1 });
  assert.deepEqual(buffer.replayAfter(undefined), { resyncRequired: false, events: [] });
});
