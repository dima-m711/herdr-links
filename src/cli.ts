#!/usr/bin/env node

import { isAbsolute, join } from "node:path";
import {
  PLUGIN_ID,
  ROOT,
  VERSION,
  Environment,
  HerdrLinksError,
  cleanup,
  cleanupInstructionFile,
  findExecutable,
  handleNavigation,
  install,
  migrateLegacyRegistration,
  navigationMarkdown,
  setup,
  setupInstructionFile,
  socketFromEnvironment,
  uninstall,
  validateTarget,
} from "./core.js";

const HELP = `Usage: herdr-links <command>

Commands:
  handle
  link <agent|workspace|tab|pane> <ID> [--label <text>]
  setup
  cleanup
  install
  uninstall
  migrate
`;

interface LinkArguments {
  kind: string;
  target: string;
  label?: string;
}

function parseLinkArguments(arguments_: readonly string[]): LinkArguments {
  const [kind, target, ...options] = arguments_;
  if (!kind || !target) throw new HerdrLinksError("link requires a target kind and public ID");
  validateTarget(kind, target);
  if (options.length === 0) return { kind, target };
  if (options.length !== 2 || options[0] !== "--label" || options[1] === undefined) {
    throw new HerdrLinksError("link accepts only one optional --label value");
  }
  return { kind, target, label: options[1] };
}

function herdrBinary(environment: Environment): string {
  const binary = environment["HERDR_BIN_PATH"] ?? findExecutable("herdr", environment);
  if (!binary || !isAbsolute(binary)) throw new HerdrLinksError("cannot locate an absolute Herdr CLI executable");
  return binary;
}

function printableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return JSON.stringify(message).slice(1, -1);
}

export async function main(
  arguments_: readonly string[] = process.argv.slice(2),
  environment: Environment = process.env,
): Promise<number> {
  const [command, ...rest] = arguments_;
  try {
    if (command === "--help" || command === "-h") {
      process.stdout.write(HELP);
      return 0;
    }
    if (command === "--version" || command === "-V") {
      console.log(`herdr-links ${VERSION}`);
      return 0;
    }
    if (!command) throw new HerdrLinksError("a command is required; use --help for usage");

    if (command === "handle") {
      if (rest.length !== 0) throw new HerdrLinksError("handle accepts no arguments");
      const result = await handleNavigation(environment);
      console.log(JSON.stringify({ ok: true, type: result["type"] }));
      return 0;
    }

    if (command === "link") {
      const { kind, target, label } = parseLinkArguments(rest);
      console.log(await navigationMarkdown(kind, target, label, socketFromEnvironment(environment)));
      return 0;
    }

    if (!["setup", "cleanup", "install", "uninstall", "migrate"].includes(command)) {
      throw new HerdrLinksError(`unknown command: ${command}`);
    }
    if (rest.length !== 0) throw new HerdrLinksError(`${command} accepts no arguments`);

    if (command === "cleanup") {
      const agentFile = cleanupInstructionFile(environment);
      const instructions = cleanup(agentFile);
      console.log(`Pi instructions: ${instructions.changed ? "removed" : "unchanged"} (${agentFile})`);
      if (instructions.backup) console.log(`Pre-edit backup: ${instructions.backup}`);
      return 0;
    }

    const binary = herdrBinary(environment);
    const agentFile = command === "uninstall" ? cleanupInstructionFile(environment) : setupInstructionFile(environment);
    if (command === "migrate") {
      const migration = migrateLegacyRegistration(ROOT, binary);
      const receipt = setup(ROOT, agentFile, join(ROOT, "agent-instructions.md"), binary);
      console.log(`${migration.changed ? "Migrated" : "Verified"} ${PLUGIN_ID} at ${ROOT}`);
      console.log(`Pi instructions: ${receipt.instructions.changed ? "updated" : "unchanged"} (${agentFile})`);
      if (receipt.instructions.backup) console.log(`Pre-edit backup: ${receipt.instructions.backup}`);
    } else if (command === "setup") {
      const receipt = setup(ROOT, agentFile, join(ROOT, "agent-instructions.md"), binary);
      console.log(`Configured ${PLUGIN_ID} from ${ROOT}`);
      console.log(`Pi instructions: ${receipt.instructions.changed ? "updated" : "unchanged"} (${agentFile})`);
      if (receipt.instructions.backup) console.log(`Pre-edit backup: ${receipt.instructions.backup}`);
    } else if (command === "install") {
      const receipt = install(ROOT, agentFile, join(ROOT, "agent-instructions.md"), binary);
      console.log(`Installed ${PLUGIN_ID} from ${ROOT}`);
      console.log(`Pi instructions: ${receipt.instructions.changed ? "updated" : "unchanged"} (${agentFile})`);
      if (receipt.instructions.backup) console.log(`Pre-edit backup: ${receipt.instructions.backup}`);
    } else {
      const receipt = uninstall(agentFile, binary);
      console.log(`Uninstalled ${PLUGIN_ID}; unrelated plugins and instructions preserved`);
      console.log(`Pi instructions: ${receipt.instructions.changed ? "updated" : "unchanged"} (${agentFile})`);
      if (receipt.instructions.backup) console.log(`Pre-edit backup: ${receipt.instructions.backup}`);
    }
    return 0;
  } catch (error) {
    console.error(`herdr-links: ${printableError(error)}`);
    return 1;
  }
}

process.exitCode = await main();
