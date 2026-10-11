#!/usr/bin/env node
/** Forward the installed buyer-expenses command to its original Python server. */
import {spawn} from "node:child_process";
import {constants} from "node:os";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

export function main(args = process.argv.slice(2)) {
  return new Promise((resolveRun, reject) => {
    const child = spawn("python3", [fileURLToPath(new URL("./server.py", import.meta.url)), ...args],
      {stdio: "inherit", shell: false, windowsHide: true});
    const interrupt = () => child.kill("SIGINT");
    const terminate = () => child.kill("SIGTERM");
    const detach = () => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    };
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    child.once("error", error => {detach(); reject(error);});
    child.once("exit", (code, signal) => {
      detach();
      const status = code ?? 128 + (constants.signals[signal] ?? 1);
      resolveRun(status);
    });
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => {process.exitCode = code;}).catch(error => {
    console.error("Buyer expense workspace: " + error.message);
    process.exitCode = 1;
  });
}
