#!/usr/bin/env node
// MIT. A create-only merchant starter; never connects to or mutates a database.
import { mkdir, copyFile, chmod, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export async function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--directory') throw new TypeError('Usage: node postgres/create-example.mjs --directory NEW_DIRECTORY');
  const directory = resolve(args[1]); await mkdir(directory, { mode: 0o700 });
  for (const [input, output] of [['example-source.json','source.json'],['example-service.json','service.json'],['example-seed.sql','seed.sql']]) {
    await copyFile(new URL(input, import.meta.url), join(directory,output), constants.COPYFILE_EXCL);
    await chmod(join(directory,output),0o600);
  }
  await writeFile(join(directory,'README.txt'), 'Merchant workspace: source.json selects an existing PostgreSQL URL environment variable. No credentials belong in these files. Review source SQL/projection and seller payment terms. seed.sql is fictional and may be run explicitly only in your new disposable database. The starter has not connected or executed SQL. See the original postgres/README.md for launch and database-role setup.\n', { flag:'wx',mode:0o600 });
  console.log(JSON.stringify({schema:'stellar-forge.postgres-starter.v1',directory,
    source:join(directory,'source.json'),service:join(directory,'service.json'),
    launcher:fileURLToPath(new URL('./start.mjs',import.meta.url)),
    databaseModified:false,mode:'FICTIONAL_CHALLENGE_ONLY_CONFIG'},null,2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(issue=>{process.stderr.write((issue.code??issue.message)+'\n');process.exitCode=1;});
}
