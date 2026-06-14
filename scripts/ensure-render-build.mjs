import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const serverBundle = join(rootDir, "dist", "server", "server.js");
const clientDir = join(rootDir, "dist", "client");

if (existsSync(serverBundle) && existsSync(clientDir)) {
  process.exit(0);
}

console.log("Render build output is missing; running npm run build before start.");

const result = spawnSync("npm", ["run", "build"], {
  cwd: rootDir,
  stdio: "inherit",
  env: process.env,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
