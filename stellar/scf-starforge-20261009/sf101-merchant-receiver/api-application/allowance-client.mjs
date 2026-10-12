// MIT. Private subprocess composition with the original Python merchant authority.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonical, jobError } from '../../sf30-seller-sdk/jobs/config.mjs';

const adapter = fileURLToPath(new URL('./allowance.py', import.meta.url));
const MAX_BYTES = 7 * 1024 * 1024;
export function allowance(runtime, action, value = {}, options = {}) {
  const args = [adapter, action, '--state', runtime.gateway.state];
  for (const [key, flag] of Object.entries({
    order: '--order', requestId: '--request-id', revision: '--revision',
    operationId: '--operation-id', actor: '--actor', reason: '--reason',
  })) if (options[key] !== undefined) args.push(flag + '=' + String(options[key]));
  const body = Buffer.from(canonical(value));
  if (body.length > MAX_BYTES) return Promise.reject(jobError('APP_ALLOWANCE_INPUT_TOO_LARGE', 413));
  return new Promise((resolve, reject) => {
    let child, terminal = false, stdout = [], stderr = [], outBytes = 0, errBytes = 0;
    const finish = (error, result) => {
      if (terminal) return;
      terminal = true; clearTimeout(timer);
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => {
      child?.kill('SIGKILL'); finish(jobError('APP_ALLOWANCE_TIMED_OUT', 503));
    }, 20000);
    try {
      child = spawn(options.python || process.env.PYTHON || 'python3', args, {
        stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      });
      child.on('error', () => finish(jobError('APP_ALLOWANCE_UNAVAILABLE', 503)));
      child.stdin.on('error', () => {});
      child.stdout.on('data', chunk => {
        outBytes += chunk.length;
        if (outBytes > 262144) { child.kill('SIGKILL'); finish(jobError('APP_ALLOWANCE_REPLY_TOO_LARGE', 503)); }
        else stdout.push(chunk);
      });
      child.stderr.on('data', chunk => {
        errBytes += chunk.length;
        if (errBytes > 262144) { child.kill('SIGKILL'); finish(jobError('APP_ALLOWANCE_REPLY_TOO_LARGE', 503)); }
        else stderr.push(chunk);
      });
      child.on('close', code => {
        if (terminal) return;
        let value;
        try {
          value = JSON.parse(Buffer.concat(code === 0 ? stdout : stderr).toString('utf8'));
        } catch { return finish(jobError('APP_ALLOWANCE_UNAVAILABLE', 503)); }
        if (code !== 0) {
          const safe = typeof value.error === 'string' && /^[A-Z][A-Z0-9_]{1,100}$/.test(value.error)
            ? value.error : 'APP_ALLOWANCE_UNAVAILABLE';
          return finish(jobError(safe, Number.isInteger(value.status) ? value.status : 503));
        }
        finish(null, value);
      });
      child.stdin.end(body);
    } catch { child?.kill('SIGKILL'); finish(jobError('APP_ALLOWANCE_UNAVAILABLE', 503)); }
  });
}
