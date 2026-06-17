import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const configPath = resolve(".vercel/output/config.json");
const outputRoot = resolve(".vercel/output");

if (!existsSync(configPath)) {
  process.exit(0);
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
if (!Array.isArray(config.routes)) {
  process.exit(0);
}

const routes = config.routes;

const catchAllIndex = routes.findIndex((route) => route.src === "/(?:.*)" && route.dest === "/[...]");
const shellIndex = routes.findIndex((route) => route.src === "/(.*)" && route.dest === "/__server");

// Keep the shell route for browser pages, but make sure API and TanStack
// server-function requests hit the actual app handler ([...]).
if (!routes.some((route) => route.src === "/api/(.*)" && route.dest === "/[...]")) {
  routes.splice(2, 0, { src: "/api/(.*)", dest: "/[...]" });
}
if (!routes.some((route) => route.src === "/_serverFn/(.*)" && route.dest === "/[...]")) {
  routes.splice(3, 0, { src: "/_serverFn/(.*)", dest: "/[...]" });
}

// Preserve the original catch-all app function if Nitro generated it.
if (catchAllIndex !== -1 && shellIndex !== -1 && catchAllIndex > shellIndex) {
  const [catchAll] = routes.splice(catchAllIndex, 1);
  const nextShellIndex = routes.findIndex((route) => route.src === "/(.*)" && route.dest === "/__server");
  routes.splice(nextShellIndex, 0, catchAll);
}

writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log("Routed Vercel API and server functions to the app handler.");

// Nitro's generated Vercel Node handlers can degrade into a static shell
// responder. Replace those wrappers with a direct adapter to the real SSR
// server so auth/API routes execute on Vercel instead of returning HTML.
const nodeAdapter = [
  'import { t as toNodeHandler } from "./_libs/srvx.mjs";',
  'import server from "./_ssr/index.mjs";',
  "",
  "const handler = toNodeHandler(server.fetch.bind(server));",
  "",
  "export default handler;",
  "",
].join("\n");

for (const handlerPath of [
  resolve(outputRoot, "functions/__server.func/index.mjs"),
  resolve(outputRoot, "functions/[...].func/index.mjs"),
]) {
  if (!existsSync(handlerPath)) continue;
  writeFileSync(handlerPath, nodeAdapter);
}
console.log("Rewired Vercel Node handlers to the real SSR server.");
