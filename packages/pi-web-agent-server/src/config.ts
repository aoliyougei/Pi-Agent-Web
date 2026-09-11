import { open, stat } from "node:fs/promises";
import { MAX_TOKEN_BYTES } from "@aoliyougei/pi-agent-contract";

export interface RuntimeIdentity {
  uid: number;
  gids: readonly number[];
}

export async function loadToken(path: string, identity: RuntimeIdentity): Promise<string> {
  try {
    const info = await stat(path);
    const mode = info.mode & 0o777;
    const ownerOnly = info.uid === identity.uid && mode === 0o400;
    const kubernetesGroup = info.uid === 0 && identity.gids.includes(info.gid) && mode === 0o440;
    if (!info.isFile() || !ownerOnly && !kubernetesGroup) throw new Error();
    const file = await open(path, "r");
    try {
      const buffer = Buffer.alloc(MAX_TOKEN_BYTES + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_TOKEN_BYTES) throw new Error();
      const token = buffer.subarray(0, bytesRead).toString("utf8").replace(/\r?\n$/, "");
      if (!token.trim()) throw new Error();
      return token;
    } finally {
      await file.close();
    }
  } catch {
    throw new Error("Invalid RPC token file");
  }
}
