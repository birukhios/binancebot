import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

// Nitro's Vercel preset emits two identical functions: a catch-all named [...]
// and an SSR function named __server. Vercel can get confused by the [...]
// function name and route requests to the wrong target, so consolidate to a
// single __server function and route every request there.
const catchAllIndex = routes.findIndex((route) => route.src === "/(?:.*)" && route.dest === "/[...]");
const serverIndex = routes.findIndex((route) => route.src === "/(.*)" && route.dest === "/__server");

if (catchAllIndex !== -1) {
  routes[catchAllIndex].dest = "/__server";
}

// Remove the now-unused [...] function directory so Vercel only deploys one
// serverless function.
const catchAllFuncDir = resolve(outputRoot, "functions/[...].func");
if (existsSync(catchAllFuncDir)) {
  rmSync(catchAllFuncDir, { recursive: true, force: true });
}

writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log("Consolidated Vercel output to a single __server function.");

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

const templatePath = resolve(outputRoot, "functions/__server.func/_chunks/renderer-template.mjs");
if (!existsSync(templatePath)) {
  process.exit(0);
}

const source = readFileSync(templatePath, "utf8");
if (source.includes(scriptSrc)) {
  process.exit(0);
}

const patched = source
  .replace(
    "</head>\\n  <body>",
    `${escapedInjection}\\n  </head>\\n  <body>`,
  )
  .replace('\\n    <script type="module" src="/src/client.tsx"><\\/script>', "");

writeFileSync(templatePath, patched);
console.log(`Injected Vercel client assets into renderer template: ${scriptSrc} and ${cssHref}.`);
