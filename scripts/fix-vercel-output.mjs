import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

// Inject the hashed client JS/CSS into the SSR renderer template so that
// browsers load the production bundles instead of the dev entry.
const assetsDir = resolve(outputRoot, "static/assets");
if (!existsSync(assetsDir)) {
  process.exit(0);
}

const cssAsset = readdirSync(assetsDir).find((file) => /^styles-.*\.css$/.test(file));
const manifestFile = readdirSync(assetsDir).find((file) => /^index-.*\.js$/.test(file));

if (!cssAsset || !manifestFile) {
  process.exit(0);
}

const scriptSrc = `/assets/${manifestFile}`;
const cssHref = `/assets/${cssAsset}`;
const escapedInjection =
  `\\n    <link rel="stylesheet" href="${cssHref}" />` +
  `\\n    <script type="module" src="${scriptSrc}"></script>`;

for (const templatePath of [
  resolve(outputRoot, "functions/__server.func/_chunks/renderer-template.mjs"),
  resolve(outputRoot, "functions/[...].func/_chunks/renderer-template.mjs"),
]) {
  if (!existsSync(templatePath)) continue;
  const source = readFileSync(templatePath, "utf8");
  if (source.includes(scriptSrc)) continue;
  const patched = source
    .replace(
      "</head>\\n  <body>",
      `${escapedInjection}\\n  </head>\\n  <body>`,
    )
    .replace('\\n    <script type="module" src="/src/client.tsx"><\\/script>', "");

  writeFileSync(templatePath, patched);
}
console.log(`Injected Vercel client assets into renderer template: ${scriptSrc} and ${cssHref}.`);
