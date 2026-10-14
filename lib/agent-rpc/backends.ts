import { constants, open, mkdir, lstat, readdir, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readDeploymentToken } from "./token";

export interface AgentBackend {
  id: string;
  name: string;
  baseUrl: string;
  hasToken: boolean;
}
interface StoredBackend { id: string; name: string; baseUrl: string; token: string }

export class BackendConfigError extends Error {}

export function validateBackendUrl(value: unknown): string {
  try {
    if (typeof value !== "string") throw new Error();
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
    return url.origin;
  } catch { throw new BackendConfigError("Invalid backend URL"); }
}

function validateId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !/^(default|[0-9a-f-]{36})$/.test(id)) throw new BackendConfigError("Invalid backend id");
}

async function directory(): Promise<string> {
  const path = process.env.PI_WEB_CONFIG_DIR ?? join(process.env.HOME ?? ".", ".config", "pi-agent-web");
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) {
    throw new Error("Invalid Web configuration directory permissions");
  }
  return path;
}

async function readProfile(id: string): Promise<StoredBackend | null | undefined> {
  const path = join(await directory(), `${id}.json`);
  let file;
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 16384 || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw new Error("Invalid Web configuration file");
    const value: unknown = JSON.parse(await file.readFile("utf8"));
    if (value === null && id === "default") return null;
    const profile = value as StoredBackend;
    if (!profile || profile.id !== id || typeof profile.name !== "string" || !profile.name.trim() || profile.name.length > 100) throw new Error("Invalid Web configuration file");
    validateBackendUrl(profile.baseUrl);
    validateToken(profile.token);
    return profile;
  } finally { await file.close(); }
}

function validateToken(token: unknown): asserts token is string {
  if (typeof token !== "string" || !token.trim() || Buffer.byteLength(token, "utf8") > 4096 || /[^\x20-\x7e]/.test(token)) throw new BackendConfigError("Invalid backend token");
}

export async function getBackend(id: string): Promise<{ id: string; name: string; baseUrl: string; token?: string }> {
  validateId(id);
  const profile = await readProfile(id);
  if (profile) return profile;
  if (profile === undefined && id === "default" && process.env.PI_AGENT_RPC_URL?.trim()) return {
    id, name: "Default Pi Agent", baseUrl: validateBackendUrl(process.env.PI_AGENT_RPC_URL),
  };
  throw new BackendConfigError("Backend not found");
}

function publicProfile(profile: { id: string; name: string; baseUrl: string }): AgentBackend {
  return { id: profile.id, name: profile.name, baseUrl: profile.baseUrl, hasToken: true };
}

export async function listBackends(): Promise<AgentBackend[]> {
  const ids = ["default", ...(await readdir(await directory())).filter((name) => /^[0-9a-f-]{36}\.json$/.test(name)).map((name) => name.slice(0, -5))];
  const result: AgentBackend[] = [];
  for (const id of ids) {
    try { result.push(publicProfile(await getBackend(id))); }
    catch (error) { if (!(error instanceof BackendConfigError && error.message === "Backend not found")) throw error; }
  }
  return result;
}

async function writeProfile(id: string, profile: StoredBackend | null): Promise<void> {
  const dir = await directory();
  const temporary = join(dir, `.${randomUUID()}.tmp`);
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(JSON.stringify(profile));
    await file.sync();
    await file.close();
    await rename(temporary, join(dir, `${id}.json`));
  } finally {
    await file.close();
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}

export async function saveBackend(input: unknown): Promise<AgentBackend> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BackendConfigError("Invalid backend configuration");
  const value = input as Record<string, unknown>;
  const id = value.id === undefined ? randomUUID() : value.id;
  validateId(id);
  if (typeof value.name !== "string" || !value.name.trim() || value.name.trim().length > 100) throw new BackendConfigError("Invalid backend name");
  const baseUrl = validateBackendUrl(value.baseUrl);
  let token = value.token;
  if (value.id !== undefined && token === "") {
    const previous = await getBackend(id);
    token = previous.token ?? await readDeploymentToken();
  }
  validateToken(token);
  const profile = { id, name: value.name.trim(), baseUrl, token };
  await writeProfile(id, profile);
  return publicProfile(profile);
}

export async function deleteBackend(id: string): Promise<void> {
  validateId(id);
  await getBackend(id);
  if (id === "default") await writeProfile(id, null);
  else await unlink(join(await directory(), `${id}.json`));
}
