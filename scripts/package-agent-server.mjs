import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(process.argv[2] ?? join(root, "dist"));
const packages = [
  { dir: "packages/agent-contract", name: "@aoliyougei/pi-agent-contract", file: "agent-contract-0.1.0.tgz" },
  { dir: "packages/pi-web-agent-server", name: "@aoliyougei/pi-web-agent-server", file: "pi-web-agent-server-0.1.0.tgz", compatiblePiVersion: "0.84.4" },
];

mkdirSync(output, { recursive: true });
for (const item of packages) {
  execFileSync("npm", ["run", "build"], { cwd: join(root, item.dir), stdio: "inherit" });
  const metadata = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", output, "--json"], {
    cwd: join(root, item.dir),
    encoding: "utf8",
  }))[0];
  const manifest = JSON.parse(readFileSync(join(root, item.dir, "package.json"), "utf8"));
  if (manifest.name !== item.name || manifest.version !== "0.1.0") throw new Error(`Unexpected package metadata: ${item.dir}`);
  const generated = join(output, metadata.filename);
  const target = join(output, item.file);
  if (generated !== target) {
    rmSync(target, { force: true });
    renameSync(generated, target);
  }
}

const lock = {
  pi: {
    version: "0.84.4",
    revision: "b79e4cc834970cca69daebffab7df1da7d1e52c4",
  },
  packages: packages.map((item) => ({
    name: item.name,
    version: "0.1.0",
    file: item.file,
    sha256: createHash("sha256").update(readFileSync(join(output, item.file))).digest("hex"),
    ...(item.compatiblePiVersion ? { compatiblePiVersion: item.compatiblePiVersion } : {}),
  })),
};
const temporary = join(output, ".bridge-package.lock.json.tmp");
writeFileSync(temporary, `${JSON.stringify(lock, null, 2)}\n`);
renameSync(temporary, join(output, "bridge-package.lock.json"));
