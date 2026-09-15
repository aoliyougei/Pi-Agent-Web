import { constants, open } from "node:fs/promises";

const path = process.env.PI_AGENT_RPC_TOKEN_FILE ?? "/run/secrets/pi-agent-rpc-token";
try {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    const mode = info.mode & 0o777;
    const uid = process.getuid?.() ?? -1;
    const gids = process.getgroups?.() ?? [];
    if (!info.isFile() || !(info.uid === uid && mode === 0o400 || info.uid === 0 && gids.includes(info.gid) && mode === 0o440)) throw new Error();
    const buffer = Buffer.alloc(4097);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 4096 || !buffer.subarray(0, bytesRead).toString("utf8").replace(/\r?\n$/, "").trim()) throw new Error();
  } finally {
    await file.close();
  }
} catch {
  console.error("Invalid RPC token file");
  process.exit(1);
}
