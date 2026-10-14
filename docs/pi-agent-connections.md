# Pi Agent backend connections

Settings → **Pi Agent** lists shared backend profiles as 72 × 72 px rounded-square Logo icons (18 px radius), with names underneath and a check on the selected backend. Click an icon to connect this browser; other browsers keep their selection. Right-click, touch-and-hold, or press the keyboard menu key / Shift+F10 to open Connect, Configure and Delete. Use arrow keys to navigate the menu and Escape to close it. The final gray '+' icon adds a backend. Every person with access to Web can add, edit and delete profiles. The settings content scrolls inside the window so all editor fields and save controls remain reachable.

Configure a name, an HTTP/HTTPS address, a port, and a service Bearer Token. The address must be an origin, without a path, query, fragment or embedded credentials. The backend must be reachable **from the Web server**, not merely from the user's computer. `localhost` therefore refers to the Web container. Use HTTPS outside a trusted container/private network.

Tokens are entered through the browser but stored only on the Web server. List responses never return them. Leave the Token field empty when editing to preserve the stored value. All Web users are trusted administrators: they can redirect the Web service's outbound RPC traffic, so protect Web with authentication and restrict network egress as needed.

Without `PI_AGENT_RPC_URL`, there is no implicit default card: Web starts with an empty list, displays a connection notice and lets users open Settings → Pi Agent. The container does not require a Token file at startup. When explicitly configured, the default card uses `PI_AGENT_RPC_URL` and `PI_AGENT_RPC_TOKEN_FILE`; the Token file is validated only when connecting or preserving that Token during editing. Editing it creates a persistent override; deleting it writes a tombstone so it does not reappear after restart. A selected deleted profile fails closed; open Settings → Pi Agent to choose another profile. No automatic fallback or prompt replay occurs.

Selection is a same-origin, SameSite=Strict cookie containing only the profile ID. It covers fetch, native EventSource, file download and image requests. Tabs in the same browser share this cookie. Other open tabs reload when they detect a change (focus/visibility and a 500 ms poll). A stale tab's fetch requests are blocked as soon as its selected cookie changes, before it can send commands to the new backend. Existing streams may finish receiving events until the tab reloads. Switching removes session/cwd URL parameters and closes existing file tabs; server tasks keep running. Unsent in-memory drafts are lost. Local workspace and last-session memories are scoped per backend.

## Standalone container

```sh
docker run -d --name pi-agent-web -p 30141:30141 \
  -v pi-agent-web-config:/var/lib/pi-agent-web pi-agent-web:0.1.0
```

Or use `docker compose -f deploy/compose/web-only.yml up -d`. This starts only Web, without an Agent service, backend environment variables or a Token Secret. Open the page, use the connection notice to enter Settings → Pi Agent, add a backend and click its card to connect. The existing two-service Compose remains available, but Web no longer waits for Agent health.

For standalone Kubernetes deployment, use the Web Deployment, Service and configuration PVC only; remove `PI_AGENT_RPC_URL`, `PI_AGENT_RPC_TOKEN_FILE` and the `rpc-token` volume/mount from the Web Deployment. The existing base remains the two-service deployment example.

## Persistent Web configuration

`PI_WEB_CONFIG_DIR` chooses a dedicated private configuration directory. Development defaults to `$HOME/.config/pi-agent-web`; the Web image defaults to `/var/lib/pi-agent-web/backends`. It contains Token-bearing JSON profiles, with owner-only directory permissions (0700) and files (0600). Do not mount an Agent project or Pi data directory here. Protect backups as credentials. Use a single Web instance with these filesystem-based profiles; simultaneous edits of one profile are last-write-wins.

Compose mounts the `web-config` named volume at `/var/lib/pi-agent-web` and adds `web-egress` so other backend addresses can be reached. Named volumes survive ordinary restart/down; `down -v` removes saved profiles.

Kubernetes creates `pi-agent-web-config` (1 GiB, default StorageClass, ReadWriteOnce), mounts it on Web and uses Recreate to avoid overlapping writers on a single-node PVC. `fsGroupChangePolicy: OnRootMismatch` prevents recursive group-permission changes to private Token files on ordinary restarts. A cluster needs a default StorageClass, or supply an appropriate `storageClassName`. Keep Web at one replica. The nested `backends` directory is created by UID 1000 with private permissions; the volume root may use fsGroup 1000.

Web readiness now checks Web configuration readability, not the default Agent's availability. This keeps the UI reachable when an Agent is offline or deleted so users can repair the connection. Liveness remains independent of Agent.

No Pi-Agent-RPC runtime or protocol changes are required.
