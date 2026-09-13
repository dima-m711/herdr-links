import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const manifest = readFileSync(new URL("../herdr-plugin.toml", import.meta.url), "utf8");
const report = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  }),
);

if (!Array.isArray(report) || report.length !== 1 || !Array.isArray(report[0].files)) {
  throw new Error("npm pack returned an unexpected report");
}

const paths = report[0].files.map((file) => file.path).sort();
const required = [
  "LICENSE",
  "README.md",
  "agent-instructions.md",
  "dist/cli.d.ts",
  "dist/cli.js",
  "dist/core.d.ts",
  "dist/core.js",
  "herdr-plugin.toml",
  "package.json",
];
for (const path of required) {
  if (!paths.includes(path)) throw new Error(`npm package is missing ${path}`);
}
for (const path of paths) {
  if (!required.includes(path)) throw new Error(`npm package contains unexpected file ${path}`);
  if ((path.endsWith(".ts") && !path.endsWith(".d.ts")) || path.endsWith(".py") || path.endsWith(".map")) {
    throw new Error(`npm package exposes source material ${path}`);
  }
}

const manifestVersion = /^version = "([^"]+)"$/mu.exec(manifest)?.[1];
if (manifestVersion !== packageJson.version) {
  throw new Error(`manifest version ${manifestVersion} does not match package version ${packageJson.version}`);
}
if (!manifest.includes('command = ["node", "./dist/cli.js", "handle"]')) {
  throw new Error("manifest does not invoke the TypeScript runtime directly");
}
const runtimeVersion = execFileSync(process.execPath, ["dist/cli.js", "--version"], {
  cwd: new URL("..", import.meta.url),
  encoding: "utf8",
}).trim();
if (runtimeVersion !== `herdr-links ${packageJson.version}`) {
  throw new Error(`runtime reports ${runtimeVersion} instead of package version ${packageJson.version}`);
}

console.log(
  JSON.stringify({ name: packageJson.name, version: packageJson.version, runtimeVersion, files: paths }, null, 2),
);
