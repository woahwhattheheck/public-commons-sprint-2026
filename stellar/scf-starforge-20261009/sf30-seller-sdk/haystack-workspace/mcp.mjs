#!/usr/bin/env node
import { stringifyJson } from "./json-codec.mjs";
import { HaystackWorkspace } from "./store.mjs";
import { serveStdio } from "./protocol.mjs";
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--directory" || !args[1]) {
  process.stderr.write("Usage: node mcp.mjs --directory ORIGINAL_WORKSPACE_DIRECTORY\n");
  process.exitCode = 2;
} else {
  try { const workspace = new HaystackWorkspace(args[1]); await workspace.read(); await serveStdio(workspace); }
  catch (error) { process.stderr.write(stringifyJson({ error: error.message, code: error.code, details: error.details }) + "\n"); process.exitCode = 1; }
}
