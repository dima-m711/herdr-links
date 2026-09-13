import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

const [piRoot, input] = process.argv.slice(2);
assert(piRoot && input, "usage: node tests/probe_pi_links.mjs <installed-pi-root> <markdown-file>");
const tuiRoot = resolve(piRoot, "node_modules/@earendil-works/pi-tui/dist");
const { Markdown } = await import(pathToFileURL(resolve(tuiRoot, "components/markdown.js")));
const { getCapabilities } = await import(pathToFileURL(resolve(tuiRoot, "terminal-image.js")));
const markdown = readFileSync(input, "utf8").trim();
const theme = Object.fromEntries(
  ["heading", "link", "linkUrl", "code", "codeBlock", "codeBlockBorder", "quote", "quoteBorder", "hr", "listBullet", "bold", "italic", "strikethrough", "underline"].map(key => [key, text => text]),
);
const url = markdown.match(/\]\(((?:herdr:\/\/navigation|https:\/\/herdr\.invalid)\/[^)]+)\)$/)?.[1];
assert(url, "input must be one generated Herdr Links Markdown link");
const lines = new Markdown(markdown, 0, 0, theme).render(40);
const visible = lines.map(stripVTControlCharacters).join("\n").trim();
assert(getCapabilities().hyperlinks, "installed Pi does not detect OSC8 support in this environment");
assert(lines.some(line => line.includes(`\x1b]8;;${url}\x1b\\`)), "OSC8 target was not preserved");
assert(!visible.includes("https://"), "destination leaked into visible label");
console.log(JSON.stringify({
  piVersion: JSON.parse(readFileSync(resolve(piRoot, "package.json"), "utf8")).version,
  capabilityProbe: getCapabilities(),
  markdown,
  ansiLines: lines,
  visible,
  osc8TargetPreserved: true,
  physicalCtrlClick: "not tested by this renderer probe",
}, null, 2));
