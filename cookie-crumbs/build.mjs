import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const WEB3_PACKAGE = '@solana/web3.js@1.98.4';
export const WEB3_TARBALL_SHA512 = 'beff657e7be352c462abfffe8f9a417578a0d0841db730340516776d710fe0a688c85d4271ac9d5aa832cd081f64c348b16356986f80507c0fcb8007383ea0a7';
export const WEB3_BUNDLE_PATH = 'package/lib/index.iife.min.js';
export const VENDOR_OUTPUT = 'vendor/solana-web3.iife.min.js';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function sha512Hex(bytes) {
  return createHash('sha512').update(bytes).digest('hex');
}

function sha384Sri(bytes) {
  return `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
}

export async function buildStatic({ cwd = process.cwd(), pack = true } = {}) {
  const root = resolve(cwd);
  const dist = join(root, 'dist');
  const scratch = await mkdtemp(join(tmpdir(), 'cookie-crumbs-build-'));

  try {
    await rm(dist, { recursive: true, force: true });
    await mkdir(join(dist, 'vendor'), { recursive: true });

    let bundleBytes;
    let tarballSha512 = WEB3_TARBALL_SHA512;
    if (pack) {
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const raw = run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch, WEB3_PACKAGE], { cwd: root });
      const parsed = JSON.parse(raw);
      const filename = parsed?.[0]?.filename;
      if (!filename) throw new Error('npm pack did not return a package filename');
      const tarball = join(scratch, basename(filename));
      const tarballBytes = await readFile(tarball);
      tarballSha512 = sha512Hex(tarballBytes);
      if (tarballSha512 !== WEB3_TARBALL_SHA512) {
        throw new Error(`@solana/web3.js tarball digest mismatch: expected ${WEB3_TARBALL_SHA512}, got ${tarballSha512}`);
      }
      run('tar', ['-xzf', tarball, '-C', scratch, WEB3_BUNDLE_PATH], { cwd: root });
      bundleBytes = await readFile(join(scratch, WEB3_BUNDLE_PATH));
    } else {
      bundleBytes = Buffer.from('var solanaWeb3={};\n', 'utf8');
    }

    for (const file of ['index.html', 'styles.css', 'app.js', 'receipt.mjs', 'provenance.mjs']) {
      await copyFile(join(root, file), join(dist, file));
    }
    await writeFile(join(dist, VENDOR_OUTPUT), bundleBytes, { flag: 'wx' });

    const lock = Object.freeze({
      schema: 'cookie-crumbs/vendor-lock/v1',
      package: WEB3_PACKAGE,
      tarballSha512,
      bundlePath: VENDOR_OUTPUT,
      bundleBytes: bundleBytes.byteLength,
      bundleSri: sha384Sri(bundleBytes),
    });
    await writeFile(join(dist, 'vendor-lock.json'), `${JSON.stringify(lock, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return lock;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

const invoked = process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (invoked) {
  const lock = await buildStatic();
  process.stdout.write(`${JSON.stringify(lock)}\n`);
}
