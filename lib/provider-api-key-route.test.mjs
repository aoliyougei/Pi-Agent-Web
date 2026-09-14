import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("API key saves do not use ModelRuntime.login's network refresh", async () => {
  const source = await readFile(new URL("../packages/pi-web-agent-server/src/routes/auth.ts", import.meta.url), "utf-8");

  assert.doesNotMatch(source, /modelRuntime\.login\(/);
  assert.match(source, /auth\.apiKey\?\.login/);
  assert.match(source, /request\.once\("aborted", \(\) => abort\.abort\(\)\)/);
  assert.match(source, /signal:\s*abort\.signal/);
  assert.match(source, /storeProviderCredential\(provider, credential\)/);
});
