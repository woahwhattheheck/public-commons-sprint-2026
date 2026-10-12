// MIT. Compose the original merchant process-lifetime operation with customer receiving.
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const need = (value, message) => { if (!value) throw new Error(message); };

/** Runs inside the caller's existing admitted Linux/native operation. */
export async function runLifecycle({ sourceRoot, outputDirectory, pythonExecutable,
  sourceCommit = null }, { onProgress = () => {} } = {}) {
  for (const [name, value] of Object.entries({ sourceRoot, outputDirectory, pythonExecutable }))
    need(typeof value === 'string' && isAbsolute(value), 'Select the absolute ' + name);
  need(process.platform === 'linux', 'The native process-group operation requires Linux');
  sourceRoot = resolve(sourceRoot); outputDirectory = resolve(outputDirectory);
  await mkdir(dirname(outputDirectory), { recursive: true, mode: 0o700 });
  const args = ['-B', join(here, 'process-lifecycle.py'),
    '--source-root', sourceRoot, '--directory', outputDirectory, '--node', process.execPath];
  if (sourceCommit) args.push('--source-commit', sourceCommit);
  let stdout = '', stderr = '', pending = '', callbackError = null;
  const outcomePath = join(outputDirectory, 'native-outcome.json');
  const completed = await new Promise((accept, reject) => {
    const child = spawn(pythonExecutable, args, { shell: false,
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    let timedOut = false, escalation;
    const timer = setTimeout(() => {
      timedOut = true; child.kill('SIGTERM');
      escalation = setTimeout(() => child.kill('SIGKILL'), 10000);
    }, 180000);
    const detach = () => {
      clearTimeout(timer); clearTimeout(escalation);
      process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => {
      stdout += text; pending += text;
      if (stdout.length > 2097152) { callbackError ??= new Error('Native lifecycle output exceeded two MiB'); child.kill('SIGTERM'); }
      let position;
      while ((position = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, position); pending = pending.slice(position + 1);
        if (!line.trim()) continue;
        try { onProgress(JSON.parse(line)); }
        catch (error) { callbackError ??= error; child.kill('SIGTERM'); }
      }
    });
    child.stderr.on('data', text => {
      stderr += text;
      if (stderr.length > 2097152) { callbackError ??= new Error('Native lifecycle error output exceeded two MiB'); child.kill('SIGTERM'); }
    });
    child.once('error', error => { detach(); reject(error); });
    child.once('close', (code, signal) => {
      detach(); accept({ code, signal, timedOut });
    });
  });
  let outcome;
  try { outcome = JSON.parse(await readFile(outcomePath, 'utf8')); }
  catch (error) {
    const failure = new Error('The original native lifecycle ended before retaining its outcome: ' +
      (stderr.trim() || completed.signal || completed.code), { cause: error });
    failure.code = 'NDJSON_NATIVE_LIFECYCLE_OUTCOME_MISSING'; throw failure;
  }
  await writeFile(join(outputDirectory, 'observer-stdout.jsonl'), stdout, { flag: 'wx', mode: 0o600 });
  await writeFile(join(outputDirectory, 'observer-stderr.log'), stderr, { flag: 'wx', mode: 0o600 });
  if (callbackError || completed.timedOut || completed.code !== 0 ||
      outcome.state !== 'COMPLETE' || outcome.cases.length !== 3) {
    const failure = new Error(callbackError?.message ?? outcome.error?.message ??
      'The original native lifecycle did not complete');
    failure.code = 'NDJSON_NATIVE_LIFECYCLE_FAILED';
    failure.nativeOutcome = outcome; failure.outcomePath = outcomePath; throw failure;
  }
  return outcome;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const input = JSON.parse(await readFile(resolve(process.argv[2]), 'utf8'));
  const result = await runLifecycle(input, {
    onProgress: value => process.stdout.write(JSON.stringify(value) + '\n'),
  });
  process.stdout.write(JSON.stringify({ schema: result.schema, state: result.state,
    cases: result.cases.length, outputDirectory: result.outputDirectory }) + '\n');
}
