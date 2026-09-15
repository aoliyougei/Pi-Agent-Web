import assert from "node:assert/strict";
import test from "node:test";
import { defaultCwdPath, resolveDefaultCwdRoot } from "../../../src/dependencies/default-cwd.ts";

test("defaults under /app/pi-cwd", () => {
  assert.equal(resolveDefaultCwdRoot(undefined), "/app/pi-cwd");
  assert.equal(defaultCwdPath(new Date("2026-08-30T12:00:00Z"), undefined), "/app/pi-cwd/pi-cwd-20260830");
});

test("accepts an absolute configured root and rejects relative roots", () => {
  assert.equal(defaultCwdPath(new Date("2026-08-30T12:00:00Z"), "/workspace"), "/workspace/pi-cwd-20260830");
  assert.throws(() => resolveDefaultCwdRoot("relative/path"), /absolute/);
});
