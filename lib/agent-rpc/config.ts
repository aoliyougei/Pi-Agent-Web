import "server-only";
import { open, stat } from "node:fs/promises";
import { MAX_TOKEN_BYTES } from "@aoliyougei/pi-agent-contract";

export const DEFAULT_AGENT_RPC_URL = "http://pi-agent-rpc:8080";

async function readToken(path: string): Promise<string> {
  const info = await stat(path);
  const mode = info.mode & 0o777;
  const uid = process.getuid?.() ?? -1;
  const gids = process.getgroups?.() ?? [];
  if (!info.isFile() || !(info.uid === uid && mode === 0o400 || info.uid === 0 && gids.includes(info.gid) && mode === 0o440)) {
    throw new Error("Invalid RPC token file");
  }
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(MAX_TOKEN_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const token = buffer.subarray(0, bytesRead).toString("utf8").replace(/\r?\n$/, "");
    if (bytesRead > MAX_TOKEN_BYTES || !token.trim()) throw new Error("Invalid RPC token file");
    return token;
  } finally {
    await file.close();
  }
}

export async function loadAgentRpcConfig() {
  return {
    baseUrl: process.env.PI_AGENT_RPC_URL ?? DEFAULT_AGENT_RPC_URL,
    token: await readToken(process.env.PI_AGENT_RPC_TOKEN_FILE ?? "/run/secrets/pi-agent-rpc-token"),
  };
}
