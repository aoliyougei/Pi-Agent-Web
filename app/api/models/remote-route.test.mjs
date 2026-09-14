import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routes = [
  "./route.ts",
  "../models-config/route.ts",
  "../models-config/catalog/route.ts",
  "../models-config/discover/route.ts",
  "../models-config/test/route.ts",
  "../auth/providers/route.ts",
  "../auth/api-key/[provider]/route.ts",
  "../auth/login/[provider]/route.ts",
  "../auth/logout/[provider]/route.ts",
];

test("migrated public model and auth routes contain no local SDK, credential, filesystem, or network execution", async () => {
  for (const route of routes) {
    const source = await readFile(new URL(route, import.meta.url), "utf8");
    assert.match(source, /agent-rpc\/routes\/models-auth-instance/);
    assert.doesNotMatch(source, /from\s+["'](?:node:)?(?:fs|path|http|https|child_process)["']|ModelRuntime|AuthStorage|models-config-store|provider-credential|model-discovery|completeSimple|\bfetch\s*\(/);
  }
});

test("public model connection testing validates browser origin before remote delivery", async () => {
  const source = await readFile(new URL("../models-config/test/route.ts", import.meta.url), "utf8");
  const validation = source.indexOf("isApiRequestAllowed(request)");
  const delivery = source.indexOf("remoteModelsAuthRoutes.TEST(request)");
  assert.ok(validation >= 0 && delivery > validation);
});
