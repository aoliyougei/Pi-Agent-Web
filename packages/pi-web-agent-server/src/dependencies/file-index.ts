import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { buildEntriesFromFiles, filterFileEntries, type FileIndexEntry } from "./file-fuzzy.js";

const run = promisify(execFile);
const IGNORED_NAMES = new Set(["node_modules", ".git", ".next", "dist", "build", "__pycache__", ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache", "target", "vendor", ".DS_Store"]);
const MAX_FILES = 5000, GIT_HARD_CAP = 200_000, WALK_HARD_CAP = 50_000, MAX_WALK_DEPTH = 8;
interface Listing { files: string[]; hardTruncated: boolean }
interface Entry { listing: Listing; entries?: FileIndexEntry[]; expiresAt: number }
const cache = new Map<string, Entry>();

async function gitFiles(cwd: string): Promise<Listing | null> {
  try {
    const { stdout } = await run("git", ["-C", cwd, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      timeout: 10_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" },
    });
    const files = stdout.split("\0").filter(Boolean);
    return { files: files.slice(0, GIT_HARD_CAP), hardTruncated: files.length > GIT_HARD_CAP };
  } catch { return null; }
}

function walk(cwd: string): Listing {
  const files: string[] = [], queue = [{ abs: cwd, rel: "", depth: 0 }];
  while (queue.length) {
    const { abs, rel, depth } = queue.shift()!;
    let dirents: fs.Dirent[];
    try { dirents = fs.readdirSync(abs, { withFileTypes: true }); } catch { continue; }
    for (const dirent of dirents) {
      if (IGNORED_NAMES.has(dirent.name) || dirent.name.endsWith(".pyc")) continue;
      const child = rel ? `${rel}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        if (depth + 1 <= MAX_WALK_DEPTH) queue.push({ abs: path.join(abs, dirent.name), rel: child, depth: depth + 1 });
      } else if (dirent.isFile()) {
        if (files.length >= WALK_HARD_CAP) return { files, hardTruncated: true };
        files.push(child);
      }
    }
  }
  return { files, hardTruncated: false };
}

export async function fileIndex(cwd: string, query: string): Promise<unknown> {
  const now = Date.now();
  let entry = cache.get(cwd);
  if (!entry || entry.expiresAt <= now) {
    const listing = await gitFiles(cwd) ?? walk(cwd);
    for (const [key, value] of cache) if (value.expiresAt <= now) cache.delete(key);
    if (cache.size >= 20) cache.clear();
    entry = { listing, expiresAt: now + 10_000 };
    cache.set(cwd, entry);
  }
  if (query) {
    entry.entries ??= buildEntriesFromFiles(entry.listing.files);
    return { matches: filterFileEntries(entry.entries, query) };
  }
  return { files: entry.listing.files.slice(0, MAX_FILES), truncated: entry.listing.hardTruncated || entry.listing.files.length > MAX_FILES };
}
