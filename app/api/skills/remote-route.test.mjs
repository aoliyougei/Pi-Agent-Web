import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routes = [
  "./route.ts",
  "./install/route.ts",
  "./search/route.ts",
  "./check/route.ts",
  "./update/route.ts",
  "../plugins/route.ts",
  "../tools/settings/route.ts",
  "../project-trust/route.ts",
  "../subagents/settings/route.ts",
  "../subagents/profiles/route.ts",
];

test("public resource routes contain no local SDK, filesystem, process, package, or runtime execution", async () => {
  for (const route of routes) {
    const source = await readFile(new URL(route, import.meta.url), "utf8");
    assert.match(source, /agent-rpc\/routes\/resources-instance/);
    assert.doesNotMatch(source, /from\s+["'](?:node:)?(?:fs|path|os|child_process)["']|@earendil-works\/pi-|DefaultPackageManager|SettingsManager|runNpx|rpc-manager|skills-service|skill-frontmatter|project-trust|powershell-settings|subagent-settings|\/subagents["']/);
  }
});

test("browser-specific resource mutation validation precedes remote delivery", async () => {
  const guarded = [
    ["./install/route.ts", "SKILL_INSTALL"],
    ["../plugins/route.ts", "PLUGINS"],
    ["../tools/settings/route.ts", "TOOLS_SETTINGS"],
    ["../subagents/settings/route.ts", "SUBAGENT_SETTINGS"],
  ];
  for (const [route, method] of guarded) {
    const source = await readFile(new URL(route, import.meta.url), "utf8");
    const mutation = source.slice(source.indexOf("export async function"));
    const origin = mutation.indexOf("isApiRequestAllowed(request)");
    const contentType = mutation.indexOf("hasJsonContentType(request)");
    const delivery = mutation.indexOf(`remoteResourceRoutes.${method}(request)`);
    assert.ok(origin >= 0 && contentType > origin && delivery > contentType, route);
  }
});
