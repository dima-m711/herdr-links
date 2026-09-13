import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  cwd: root,
  encoding: "utf8",
});
const paths = listed.split("\0").filter(Boolean);
const forbiddenPaths = paths.filter((path) => path.startsWith("docs/verification/") && existsSync(resolve(root, path)));
const patterns = [
  { name: "macOS home path", expression: /\/Users\/[^/\s]+\//u },
  { name: "Linux home path", expression: /\/home\/[^/\s]+\//u },
  { name: "live navigation fingerprint", expression: /(?:herdr:\/\/navigation\/v1|https:\/\/herdr\.invalid\/v1)\/[0-9a-f]{64}\//u },
  { name: "plugin log identifier", expression: /plugin-log-[0-9]+/u },
  { name: "GitHub token", expression: /(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/u },
  { name: "AWS access key", expression: /AKIA[0-9A-Z]{16}/u },
];
const findings = forbiddenPaths.map((path) => `${path}: raw verification receipt directory is not public-safe`);

for (const path of paths) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
  const content = readFileSync(absolute);
  if (content.includes(0)) continue;
  const text = content.toString("utf8");
  for (const pattern of patterns) {
    if (pattern.expression.test(text)) findings.push(`${path}: contains ${pattern.name}`);
  }
}

if (findings.length > 0) {
  throw new Error(`public content check failed:\n${findings.join("\n")}`);
}

console.log(`Public content check passed for ${paths.length} repository files.`);
