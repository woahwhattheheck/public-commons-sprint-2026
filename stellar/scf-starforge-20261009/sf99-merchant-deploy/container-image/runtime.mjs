// MIT. The generated image installs and opens its original selected runtime.
import { readFile, writeFile, mkdir, chmod, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { installDistribution } from './archive.mjs';
import { verifyRuntimeProfile, inspectRuntimeProfile } from '../../distribution/runtime-profile.mjs';

const need = (yes, message) => { if (!yes) throw new Error(message); };
const BASE = 'stellar/scf-starforge-20261009/sf99-merchant-deploy/';
function pythonProbe(executable, modules) {
  const program = 'import importlib,json,sys\n' +
    'assert sys.version_info >= (3,11), "Python 3.11 or newer is required"\n' +
    'names=json.loads(sys.argv[1])\n' +
    'for name in names: importlib.import_module(name)\n' +
    'print(json.dumps({"version":sys.version.split()[0],"modules":names}))\n';
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, ['-I','-B','-c',program,JSON.stringify(modules)],
      { stdio: ['ignore','pipe','pipe'] });
    let stdout = '', exceeded = false;
    const timer = setTimeout(() => { exceeded = true; child.kill('SIGKILL'); }, 30000);
    child.stdout.on('data', data => {
      stdout += data;
      if (Buffer.byteLength(stdout) > 65536) { exceeded = true; child.kill('SIGKILL'); }
    });
    child.stderr.resume();
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0 || exceeded) return reject(new Error('Selected Python runtime or module could not open'));
      try { resolveResult(JSON.parse(stdout)); } catch { reject(new Error('Invalid Python runtime result')); }
    });
  });
}

export async function main(args = process.argv.slice(2)) {
  const [command, contractFile] = args;
  need(args.length === 2 && ['install','check'].includes(command), 'Use runtime.mjs install|check CONTRACT.json');
  const contract = JSON.parse(await readFile(contractFile, 'utf8'));
  need(contract.schema === 'stellar-forge.merchant-image-runtime.v1', 'Selected image runtime contract required');
  if (command === 'install') {
    const input = join(contract.dependencyRoot, 'merchant-build', 'merchant.tgz');
    const original = await installDistribution(input, contract.release.archiveSha256, contract.sourceRoot);
    need(original.manifest.sourceCommit === contract.release.sourceCommit &&
      original.manifest.packageVersion === contract.release.packageVersion, 'Image source differs from selected release');
    const metadata = join(contract.dependencyRoot, 'merchant-release');
    await mkdir(metadata, { mode: 0o755 });
    await writeFile(join(contract.dependencyRoot, 'manifest.json'), JSON.stringify(original.manifest, null, 2) + '\n', { mode: 0o644, flag: 'wx' });
    await writeFile(join(metadata, 'package.json'), JSON.stringify(original.packageJson, null, 2) + '\n', { mode: 0o644, flag: 'wx' });
    for (const file of ['package.json','package-lock.json']) await chmod(join(contract.dependencyRoot, file), 0o644);
    for (const file of ['archive.mjs','runtime.mjs','runtime-profile.mjs','profile.json','runtime-contract.json'])
      await chmod(join(contract.dependencyRoot, 'merchant-build', file), 0o644);
    await unlink(input);
    return { status: 'ORIGINAL_SOURCE_INSTALLED', sourceCommit: original.manifest.sourceCommit,
      sourceFiles: original.sourceFiles, sourceBytes: original.sourceBytes, sourceRoot: contract.sourceRoot };
  }
  const profile = verifyRuntimeProfile(JSON.parse(await readFile(join(contract.dependencyRoot,'merchant-build','profile.json'),'utf8')));
  need(profile.profileId === contract.profileId, 'Runtime profile changed');
  const original = JSON.parse(await readFile(join(contract.dependencyRoot, 'manifest.json'), 'utf8'));
  need(original.sourceCommit === contract.release.sourceCommit, 'Installed source identity changed');
  if(contract.sourceModes?.includes('image'))
    await import(pathToFileURL(join(contract.sourceRoot,BASE+'container-runtime.mjs')).href);
  const inspection = await inspectRuntimeProfile(profile,{directory:contract.dependencyRoot,
    sourceRoot:contract.sourceRoot,load:true,python:contract.runtime.python});
  need(inspection.ready, 'Selected runtime profile is incomplete: ' + JSON.stringify(inspection));
  const python = contract.pythonModules.length ? await pythonProbe(contract.runtime.python, contract.pythonModules) : inspection.host.python;
  return { status: 'RUNTIME_READY', sourceCommit: original.sourceCommit,
    profileId:profile.profileId,node: process.version, python, inspection, sourceRoot: contract.sourceRoot,
    dependencyRoot: contract.dependencyRoot,sourceModes:contract.sourceModes,
    uid: process.getuid?.(), gid: process.getgid?.() };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
