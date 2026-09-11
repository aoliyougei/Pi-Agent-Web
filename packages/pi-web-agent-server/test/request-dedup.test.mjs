import assert from "node:assert/strict";
import test from "node:test";
import { RequestDeduplicator } from "../dist/runtime/request-dedup.js";

test("shares one active operation and replays its settled result", async () => {
  const dedup = new RequestDeduplicator();
  let calls = 0;
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const operation = async () => { calls += 1; await held; return "done"; };

  const first = dedup.run({ id: "request-1", fingerprint: "same" }, operation);
  const second = dedup.run({ id: "request-1", fingerprint: "same" }, operation);
  assert.equal(calls, 1);
  release();
  assert.equal(await first, "done");
  assert.equal(await second, "done");
  assert.equal(await dedup.run({ id: "request-1", fingerprint: "same" }, operation), "done");
  assert.equal(calls, 1);
});

test("rejects reuse of an id with a different fingerprint", async () => {
  const dedup = new RequestDeduplicator();
  await dedup.run({ id: "request-1", fingerprint: "first" }, async () => null);
  await assert.rejects(
    dedup.run({ id: "request-1", fingerprint: "different" }, async () => null),
    (error) => error?.code === "request_id_conflict",
  );
});

test("replays failures consistently", async () => {
  const dedup = new RequestDeduplicator();
  const failure = new Error("failed once");
  let calls = 0;
  const operation = async () => { calls += 1; throw failure; };
  await assert.rejects(dedup.run({ id: "request-1", fingerprint: "same" }, operation), failure);
  await assert.rejects(dedup.run({ id: "request-1", fingerprint: "same" }, operation), failure);
  assert.equal(calls, 1);
});

test("expires settled entries", async () => {
  let now = 0;
  const dedup = new RequestDeduplicator({ ttlMs: 10, now: () => now });
  await dedup.run({ id: "request-1", fingerprint: "same" }, async () => "old");
  now = 11;
  assert.equal(await dedup.run({ id: "request-1", fingerprint: "same" }, async () => "fresh"), "fresh");
});

test("never evicts active entries and bounds settled entries", async () => {
  const dedup = new RequestDeduplicator({ maxEntries: 1 });
  let releaseFirst;
  let releaseSecond;
  const firstHeld = new Promise((resolve) => { releaseFirst = resolve; });
  const secondHeld = new Promise((resolve) => { releaseSecond = resolve; });
  const first = dedup.run({ id: "first", fingerprint: "a" }, async () => firstHeld);
  const second = dedup.run({ id: "second", fingerprint: "b" }, async () => secondHeld);
  assert.equal(dedup.size, 2);
  releaseFirst("first");
  releaseSecond("second");
  await Promise.all([first, second]);
  assert.ok(dedup.size <= 1);
});
