import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { MAX_INLINE_BASH_OUTPUT_BYTES, openRegularFileNoFollow, readUtf8FileWithinLimit, resolveBashOutputPath } from "../dependencies/bash-output.js";
import { getSessionEntries, resolveSessionPath } from "../dependencies/session-reader.js";
import { isBashOutputPathReferencedByEntries, isValidSessionId } from "../dependencies/session-file-references-core.js";

export async function routeBashOutput(request: IncomingMessage, response: ServerResponse, path: string): Promise<boolean> {
  const match = /^\/internal\/v1\/api\/agent\/([^/]+)\/bash-output$/.exec(path);
  if (request.method !== "GET" || !match) return false;
  const json = (status: number, body: unknown) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(body)); };
  const url = new URL(request.url!, "http://internal");
  const raw = url.searchParams.get("path");
  if (!raw) { json(400, { error: "path required" }); return true; }
  const file = resolveBashOutputPath(raw, tmpdir());
  if (!file) { json(400, { error: "invalid path" }); return true; }
  let allowed = false;
  try {
    const id = decodeURIComponent(match[1]);
    const session = isValidSessionId(id) ? await resolveSessionPath(id) : null;
    allowed = !!session && isBashOutputPathReferencedByEntries(file, getSessionEntries(session));
  } catch { /* Fail closed on unreadable or invalid Session. */ }
  if (!allowed) { json(403, { error: "forbidden" }); return true; }
  try {
    if (url.searchParams.get("download") === "1") {
      const { handle } = await openRegularFileNoFollow(file);
      const stream = handle.createReadStream();
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "content-disposition": 'attachment; filename="bash-output.log"', "cache-control": "no-store" });
      await pipeline(stream, response);
    } else {
      const result = await readUtf8FileWithinLimit(file);
      if (result.tooLarge) json(413, { error: `Full output is too large to display (limit ${MAX_INLINE_BASH_OUTPUT_BYTES} bytes)`, data: { size: result.size, maxBytes: MAX_INLINE_BASH_OUTPUT_BYTES } });
      else json(200, { success: true, data: { output: result.content } });
    }
  } catch {
    if (!response.headersSent) json(404, { error: "full output unavailable" });
    else response.destroy();
  }
  return true;
}
