import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_JSON_BYTES,
  MAX_TOKEN_BYTES,
  PROTOCOL_VERSION,
  REQUIRED_CAPABILITIES,
  agentError,
  parseAgentVersion,
} from "../dist/index.js";

const validVersion = {
  protocolVersion: 1,
  serverVersion: "0.1.0",
  piVersion: "0.84.4",
  piRevision: "b79e4cc834970cca69daebffab7df1da7d1e52c4",
  capabilities: ["extension-ui", "custom-ui", "remote-files", "subagents", "session-locks"],
};

test("exports the exact v1 protocol contract", () => {
  assert.equal(PROTOCOL_VERSION, 1);
  assert.deepEqual(REQUIRED_CAPABILITIES, [
    "extension-ui",
    "custom-ui",
    "remote-files",
    "subagents",
    "session-locks",
  ]);
  assert.equal(MAX_JSON_BYTES, 12 * 1024 * 1024);
  assert.equal(MAX_TOKEN_BYTES, 4096);
});

test("accepts a complete compatible agent version without coercion", () => {
  assert.deepEqual(parseAgentVersion(validVersion), validVersion);
});

test("accepts optional and future string capabilities without changing required capabilities", () => {
  const version = { ...validVersion, capabilities: [...validVersion.capabilities, "project-session-discovery", "future-feature"] };
  assert.deepEqual(parseAgentVersion(version), version);
  assert.equal(REQUIRED_CAPABILITIES.includes("project-session-discovery"), false);
});

test("rejects malformed and protocol-incompatible agent versions", () => {
  for (const value of [
    null,
    {},
    { ...validVersion, protocolVersion: "1" },
    { ...validVersion, protocolVersion: 2 },
    { ...validVersion, serverVersion: 1 },
    { ...validVersion, capabilities: ["extension-ui", 1] },
  ]) {
    assert.throws(() => parseAgentVersion(value), /invalid agent version/i);
  }
});

test("builds the stable network error envelope", () => {
  assert.deepEqual(agentError("unauthorized", "Unauthorized", "r1"), {
    error: { code: "unauthorized", message: "Unauthorized", requestId: "r1" },
  });
});
