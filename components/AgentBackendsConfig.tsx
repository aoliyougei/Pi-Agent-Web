"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getSelectedBackendId, selectBackend } from "@/lib/agent-backend-selection";
import type { AgentBackend } from "@/lib/agent-rpc/backends";

export function AgentLogo({ size = 40 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="7" width="16" height="13" rx="4" /><path d="M12 7V3M10 3h4M8 12h.01M16 12h.01M8 16h8M1 11v5M23 11v5" /></svg>;
}

interface Editor { id?: string; name: string; address: string; port: string; token: string }
const emptyEditor: Editor = { name: "", address: "http://", port: "8080", token: "" };

export function AgentBackendsConfig() {
  const { t } = useI18n();
  const [backends, setBackends] = useState<AgentBackend[]>([]);
  const [selected, setSelected] = useState("default");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ backend: AgentBackend; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);

  function cancelHold() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }

  function closeMenu() {
    setMenu(null);
    triggerRef.current?.focus();
  }

  function openMenu(backend: AgentBackend, trigger: HTMLButtonElement, x: number, y: number) {
    triggerRef.current = trigger;
    setMenu({ backend, x: Math.max(8, Math.min(x, window.innerWidth - 168)), y: Math.max(8, Math.min(y, window.innerHeight - 144)) });
  }

  useEffect(() => () => cancelHold(), []);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const scroll = () => setMenu(null);
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", scroll);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", scroll);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [menu]);

  async function refresh() {
    const response = await fetch("/api/agent-backends", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
    setBackends(data.backends);
    setLoaded(true);
  }

  useEffect(() => {
    setSelected(getSelectedBackendId());
    void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  function edit(backend: AgentBackend) {
    const url = new URL(backend.baseUrl);
    setEditor({ id: backend.id, name: backend.name, address: `${url.protocol}//${url.hostname}`, port: url.port || (url.protocol === "https:" ? "443" : "80"), token: "" });
    setError(null);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editor) return;
    setBusy(true);
    setError(null);
    try {
      const url = new URL(editor.address);
      if (!/^\d+$/.test(editor.port) || Number(editor.port) < 1 || Number(editor.port) > 65535) throw new Error(t("backends.invalidPort"));
      url.port = editor.port;
      const response = await fetch("/api/agent-backends", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editor.id, name: editor.name, baseUrl: url.href, token: editor.token }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      if (editor.id === selected) {
        selectBackend(selected);
        return;
      }
      setEditor(null);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function remove(backend: AgentBackend) {
    if (!window.confirm(t("backends.deleteConfirm", { name: backend.name }))) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/agent-backends", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: backend.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      if (backend.id === selected) {
        // Keep the deleted selection: requests fail closed until the user chooses another card.
        selectBackend(selected);
        return;
      }
      if (editor?.id === backend.id) setEditor(null);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  return <div className="settings-general agent-backends">
    <h2 className="settings-general-title">{t("backends.title")}</h2>
    <p className="settings-general-description">{t("backends.description")}</p>
    <p className="settings-general-description">{t("backends.switchNotice")}</p>
    {error && <p role="alert" className="settings-general-error">{error}</p>}
    {loaded && !backends.some((backend) => backend.id === selected) && <p role="alert" className="settings-general-error">{t("backends.selectionMissing")}</p>}
    <div className="agent-backend-grid">
      {backends.map((backend) => <button key={backend.id} type="button" className="agent-backend-tile" aria-pressed={selected === backend.id} aria-haspopup="menu" disabled={busy} title={`${backend.name}\n${backend.baseUrl}`} onClick={() => {
        if (held.current) { held.current = false; return; }
        selectBackend(backend.id);
      }} onContextMenu={(event) => {
        event.preventDefault();
        cancelHold();
        openMenu(backend, event.currentTarget, event.clientX, event.clientY);
      }} onKeyDown={(event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          openMenu(backend, event.currentTarget, rect.left, rect.bottom);
        }
      }} onPointerDown={(event) => {
        held.current = false;
        if (event.pointerType !== "touch") return;
        const trigger = event.currentTarget;
        const { clientX, clientY } = event;
        cancelHold();
        holdTimer.current = setTimeout(() => { held.current = true; openMenu(backend, trigger, clientX, clientY); }, 550);
      }} onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerMove={cancelHold}>
        <span className="agent-backend-icon"><AgentLogo />{selected === backend.id && <span className="agent-backend-check" aria-label={t("backends.selected")}>✓</span>}</span>
        <span className="agent-backend-name">{backend.name}</span>
      </button>)}
      <button type="button" className="agent-backend-tile agent-backend-add-tile" disabled={busy} aria-label={t("backends.add")} onClick={() => { setMenu(null); setEditor({ ...emptyEditor }); setError(null); }}>
        <span className="agent-backend-icon" aria-hidden="true">＋</span>
        <span className="agent-backend-name">{t("backends.add")}</span>
      </button>
    </div>
    {menu && <div ref={menuRef} className="agent-backend-menu" role="menu" aria-label={menu.backend.name} style={{ left: menu.x, top: menu.y }} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(); }
      if (event.key === "Tab") closeMenu();
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}>
      <button type="button" role="menuitem" onClick={() => selectBackend(menu.backend.id)}>{t("backends.connect")}</button>
      <button type="button" role="menuitem" onClick={() => { edit(menu.backend); closeMenu(); }}>{t("backends.configure")}</button>
      <button type="button" role="menuitem" onClick={() => { void remove(menu.backend); closeMenu(); }}>{t("backends.delete")}</button>
    </div>}
    {editor && <form className="agent-backend-form" onSubmit={(event) => void save(event)}>
      <h3>{editor.id ? t("backends.configure") : t("backends.add")}</h3>
      <label>{t("backends.name")}<input required maxLength={100} value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} disabled={busy} /></label>
      <label>{t("backends.address")}<input required type="url" placeholder="https://agent.example" value={editor.address} onChange={(event) => setEditor({ ...editor, address: event.target.value })} disabled={busy} /></label>
      <label>{t("backends.port")}<input required type="number" min={1} max={65535} value={editor.port} onChange={(event) => setEditor({ ...editor, port: event.target.value })} disabled={busy} /></label>
      <label>Token<input type="password" autoComplete="new-password" required={!editor.id} value={editor.token} onChange={(event) => setEditor({ ...editor, token: event.target.value })} disabled={busy} placeholder={editor.id ? t("backends.keepToken") : ""} /></label>
      <div className="agent-backend-actions">
        <button type="submit" disabled={busy}>{t("backends.save")}</button>
        <button type="button" disabled={busy} onClick={() => setEditor(null)}>{t("backends.cancel")}</button>
      </div>
    </form>}
  </div>;
}
