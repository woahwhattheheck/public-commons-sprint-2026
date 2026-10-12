// MIT. Same retained HTTP boundary with the original Linux dataset lease helper.
import childProcess from 'node:child_process';
import { readFileSync, readlinkSync, lstatSync, fstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { installLocalOnlyNetwork } from './retained-local-network.mjs';

let installed;
export function installCapturedLocalNetwork({ versionDirectories, flockPath, flockSha256 } = {}) {
  if (installed) return installed;
  if (!Array.isArray(versionDirectories) || !versionDirectories.length ||
      versionDirectories.some(value => typeof value !== 'string' || resolve(value) !== value || value === '/') ||
      typeof flockPath !== 'string' || resolve(flockPath) !== flockPath ||
      !/^[a-f0-9]{64}$/.test(flockSha256 ?? ''))
    throw new TypeError('Declare the exact native dataset roots and retained Linux flock binary.');
  const paths = new Set(versionDirectories.map(path => join(path, 'writer.lease')));
  const digest = raw => createHash('sha256').update(raw).digest('hex');
  const verifyBinary = () => {
    const file = lstatSync(flockPath);
    if (!file.isFile() || file.isSymbolicLink() || !(file.mode & 0o111) || realpathSync(flockPath) !== flockPath ||
        digest(readFileSync(flockPath)) !== flockSha256)
      throw new Error('The selected original Linux flock binary changed.');
  };
  verifyBinary();
  const spawnSync = childProcess.spawnSync;
  const boundary = installLocalOnlyNetwork();
  let leaseCalls = 0;
  const invalid = () => { throw Object.assign(new Error('Only the original dataset descriptor-lock operation is permitted.'),
    { code: 'CAPTURED_LOCAL_LEASE_REQUIRED' }); };
  childProcess.spawnSync = function (command, args, options) {
    if (command !== 'flock' || !Array.isArray(args) ||
        JSON.stringify(args) !== JSON.stringify(['--exclusive', '--nonblock', '--conflict-exit-code', '73', '3']) ||
        !options || typeof options !== 'object' || Array.isArray(options) ||
        Object.keys(options).sort().join(',') !== 'shell,stdio,timeout' ||
        options.shell !== false || options.timeout !== 10000 ||
        !Array.isArray(options.stdio) || options.stdio.length !== 4 ||
        options.stdio.slice(0, 3).some(value => value !== 'ignore') ||
        !Number.isInteger(options.stdio[3]) || options.stdio[3] < 3) invalid();
    const fd = options.stdio[3], path = readlinkSync('/proc/self/fd/' + fd);
    if (!paths.has(path) || realpathSync(path) !== path) invalid();
    const opened = fstatSync(fd), named = lstatSync(path);
    const flags = /^flags:\s+([0-7]+)$/m.exec(readFileSync('/proc/self/fdinfo/' + fd, 'utf8'));
    if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() || opened.nlink !== 1 ||
        (opened.mode & 0o777) !== 0o600 || opened.dev !== named.dev || opened.ino !== named.ino ||
        !flags || (parseInt(flags[1], 8) & 3) !== 2) invalid();
    verifyBinary(); leaseCalls++;
    return spawnSync(flockPath, args, { stdio: ['ignore', 'ignore', 'ignore', fd], timeout: 10000, shell: false,
      cwd: '/', env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' } });
  };
  syncBuiltinESMExports();
  installed = Object.freeze({
    closeIdleConnections: () => boundary.closeIdleConnections(),
    snapshot: () => ({ ...boundary.snapshot(), datasetLeaseCalls: leaseCalls,
      datasetLeaseBinarySha256: flockSha256, datasetRoots: [...versionDirectories] }),
  });
  return installed;
}
