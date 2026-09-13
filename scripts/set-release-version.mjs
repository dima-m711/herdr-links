import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
  throw new Error("expected a semantic version argument");
}

function replaceExactlyOnce(path, pattern, replacement, label) {
  const original = readFileSync(path, "utf8");
  const matches = original.match(pattern) ?? [];
  if (matches.length !== 1) throw new Error(`${label} must contain exactly one version field`);
  writeFileSync(path, original.replace(matches[0], replacement));
}

replaceExactlyOnce(
  new URL("../herdr-plugin.toml", import.meta.url),
  /^version = "[^"]+"$/gmu,
  `version = "${version}"`,
  "manifest",
);
replaceExactlyOnce(
  new URL("../src/core.ts", import.meta.url),
  /^export const VERSION = "[^"]+";$/gmu,
  `export const VERSION = "${version}";`,
  "TypeScript runtime",
);
