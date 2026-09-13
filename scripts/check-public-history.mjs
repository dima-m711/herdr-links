import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const objects = execFileSync("git", ["rev-list", "--objects", "--all"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
const patterns = [
  { name: "macOS home path", expression: /\/Users\/[^/\s]+\//u },
  { name: "Linux home path", expression: /\/home\/[^/\s]+\//u },
  { name: "live navigation fingerprint", expression: /(?:herdr:\/\/navigation\/v1|https:\/\/herdr\.invalid\/v1)\/[0-9a-f]{64}\//u },
  { name: "plugin log identifier", expression: /plugin-log-[0-9]+/u },
  { name: "GitHub token", expression: /(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/u },
  { name: "AWS access key", expression: /AKIA[0-9A-Z]{16}/u },
];
const findings = [];
const seen = new Set();

for (const line of objects.trim().split("\n")) {
  if (!line) continue;
  const separator = line.indexOf(" ");
  if (separator === -1) continue;
  const object = line.slice(0, separator);
  const path = line.slice(separator + 1);
  if (path.startsWith("docs/verification/")) {
    findings.push(`${object.slice(0, 12)} ${path}: raw verification receipt directory is not public-safe`);
  }
  if (seen.has(object)) continue;
  seen.add(object);
  let content;
  try {
    content = execFileSync("git", ["cat-file", "blob", object], {
      cwd: root,
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    continue;
  }
  if (content.includes(0)) continue;
  const text = content.toString("utf8");
  for (const pattern of patterns) {
    if (pattern.expression.test(text)) findings.push(`${object.slice(0, 12)} ${path}: contains ${pattern.name}`);
  }
}

if (findings.length > 0) {
  throw new Error(`public history check failed:\n${[...new Set(findings)].join("\n")}`);
}

console.log(`Public history check passed for ${seen.size} reachable objects.`);
