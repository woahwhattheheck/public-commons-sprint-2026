import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SOURCE = fileURLToPath(new URL("./native_async_producer.py", import.meta.url));

/** Operate the selected original Python SDK environment and retain its exit state. */
export function asyncProducerCommand(argv, { signal } = {}) {
  const args = [];
  let python = "python3", selected = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--python") { args.push(argv[i]); continue; }
    if (selected || !argv[i + 1] || argv[i + 1].startsWith("--"))
      throw new Error("Use --python once with the selected OpenLineage Python executable");
    python = argv[++i]; selected = true;
  }
  return new Promise((resolve, reject) => {
    let child, settled = false;
    const clean = () => {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", terminate);
    };
    const interrupt = () => { if (child && !settled) child.kill("SIGINT"); };
    const terminate = () => { if (child && !settled) child.kill("SIGTERM"); };
    try {
      const inherited = process.env.OPENLINEAGE_RECEIVING_LOCK_FD;
      const lease = inherited === undefined ? null : Number(inherited);
      if (lease !== null && (!/^\d+$/.test(inherited) || !Number.isSafeInteger(lease) || lease < 3))
        throw new Error("Use the original inherited receiving lease descriptor");
      child = spawn(python, [SOURCE, ...args], {
        stdio: lease === null ? "inherit" : ["inherit", "inherit", "inherit", lease],
        shell: false, signal,
        env: { ...process.env, PYTHONUNBUFFERED: "1",
          ...(lease === null ? {} : { OPENLINEAGE_RECEIVING_LOCK_FD: "3" }) }
      });
    } catch (error) { reject(error); return; }
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    child.once("error", error => {
      settled = true; clean();
      reject(new Error(error.code === "ENOENT"
        ? "Selected Python executable was not found; use the original prepared OpenLineage environment"
        : error.message, { cause: error }));
    });
    child.once("close", (code, stoppedBy) => {
      settled = true; clean();
      resolve(Number.isInteger(code) ? code : stoppedBy === "SIGINT" ? 130 : 143);
    });
  });
}
