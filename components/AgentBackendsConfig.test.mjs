import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

test("backend settings constrains its scroll area to the section height", async () => {
  const css = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
  assert.match(css, /\.agent-backends\s*\{[^}]*height:\s*100%/);
  assert.match(css, /\.agent-backends\s*\{[^}]*overflow-y:\s*auto/);
});

test("Pi Agent settings renders accessible management controls", async () => {
  const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
  const React = await jiti.import("react");
  const { renderToStaticMarkup } = await jiti.import("react-dom/server");
  const { I18nProvider } = await jiti.import("@/hooks/useI18n");
  const { AgentBackendsConfig } = await jiti.import("./AgentBackendsConfig.tsx");
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(AgentBackendsConfig)));
  assert.match(html, /Pi Agent/);
  assert.match(html, /Add backend/);
  const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /backendMissing/);
  assert.match(shell, /setSettingsSection\("backends"\)/);
  assert.doesNotMatch(html, /test-secret/);
});

test("backend launcher uses square icons, a final add tile and an accessible context menu", async () => {
  const source = await readFile(new URL("./AgentBackendsConfig.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
  assert.match(source, /onContextMenu/);
  assert.match(source, /onPointerDown/);
  assert.match(source, /ContextMenu/);
  assert.match(source, /role="menu"/);
  assert.match(source, /role="menuitem"/);
  assert.match(source, /backends.connect/);
  assert.match(source, /agent-backend-add-tile/);
  assert.doesNotMatch(source, /className="agent-backend-card"/);
  assert.match(css, /\.agent-backend-icon\s*\{[^}]*width: 72px;[^}]*height: 72px;[^}]*border-radius: 18px/);
});

test("Pi Agent settings exposes selectable logo cards and a private-token editor", async () => {
  const source = await readFile(new URL("./AgentBackendsConfig.tsx", import.meta.url), "utf8");
  assert.match(source, /selectBackend\(backend.id\)/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /<AgentLogo/);
  assert.match(source, /type="password"/);
  assert.match(source, /\/api\/agent-backends/);
  assert.match(source, /method: "DELETE"/);
  assert.match(source, /type="number"/);
  const panel = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /id: "backends"/);
  assert.match(panel, /sectionHost\("backends", <AgentBackendsConfig/);
});
