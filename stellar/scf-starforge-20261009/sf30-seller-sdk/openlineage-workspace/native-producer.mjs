import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PYTHON_SOURCE = fileURLToPath(new URL("./native_python_producer.py", import.meta.url));

/** Run the retained native Python producer with an explicitly selected interpreter. */
export async function pythonProducerCommand(argv, { signal } = {}) {
  const args = [], values = [...argv];
  let python = "python3", selected = false;
  for (let index = 0; index < values.length; index++) {
    if (values[index] !== "--python") { args.push(values[index]); continue; }
    if (selected || !values[index + 1] || values[index + 1].startsWith("--"))
      throw new Error("Use --python once with the selected Python executable");
    python = values[++index]; selected = true;
  }
  return new Promise((resolve, reject) => {
    let child;
    try {
      // A native receiving supervisor can supply a POSIX kernel lease. Retain it
      // in the SDK process too, so killing its parent cannot admit a competing
      // continuation while the original HTTP send remains alive.
      const inherited = process.env.OPENLINEAGE_RECEIVING_LOCK_FD;
      const lease = inherited === undefined ? null : Number(inherited);
      if (lease !== null && (!/^\d+$/.test(inherited) || !Number.isSafeInteger(lease) || lease < 3))
        throw new Error("Use the original inherited receiving lease descriptor");
      child = spawn(python, [PYTHON_SOURCE, ...args], {
        stdio: lease === null ? "inherit" : ["inherit", "inherit", "inherit", lease],
        shell: false, signal,
        env: { ...process.env, PYTHONUNBUFFERED: "1",
          ...(lease === null ? {} : { OPENLINEAGE_RECEIVING_LOCK_FD: "3" }) }
      });
    } catch (error) { reject(error); return; }
    const interrupt = () => { if (!child.killed) child.kill("SIGINT"); };
    const terminate = () => { if (!child.killed) child.kill("SIGTERM"); };
    const clean = () => {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", terminate);
    };
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", terminate);
    child.once("error", error => {
      clean();
      reject(new Error(error.code === "ENOENT"
        ? "Selected Python executable was not found; use --python with the prepared runtime"
        : error.message, { cause: error }));
    });
    child.once("close", (code, stoppedBy) => {
      clean();
      resolve(Number.isInteger(code) ? code : stoppedBy === "SIGINT" ? 130 : 143);
    });
  });
}
