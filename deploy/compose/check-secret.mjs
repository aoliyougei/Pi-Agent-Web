import { constants, open } from "node:fs/promises";

const path = process.argv[2] ?? new URL("secrets/pi-agent-rpc-token", import.meta.url);
try {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.uid !== 1000 || (info.mode & 0o777) !== 0o400 || info.size < 1 || info.size > 4096) throw new Error();
    const buffer = Buffer.alloc(info.size);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (!buffer.subarray(0, bytesRead).toString("utf8").replace(/\r?\n$/, "").trim()) throw new Error();
  } finally {
    await file.close();
  }
} catch {
  console.error("Invalid RPC token file");
  process.exit(1);
}
