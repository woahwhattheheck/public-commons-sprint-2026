#!/usr/bin/env node
// MIT. Creates a NEW fictional merchant workspace; never overwrites an existing directory.
import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile, copyFile, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants } from 'node:fs';
export async function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--directory') throw new TypeError('Usage: node sqlite/create-example.mjs --directory NEW_DIRECTORY');
  const directory = resolve(args[1]);
  await mkdir(directory, { mode: 0o700 });
  const databasePath = join(directory, 'catalog.sqlite');
  await writeFile(databasePath, '', { flag: 'wx', mode: 0o600 });
  const database = new DatabaseSync(databasePath);
  try {
    database.exec('CREATE TABLE products(id INTEGER PRIMARY KEY,title TEXT,region TEXT,price_cents INTEGER,internal_note TEXT); CREATE INDEX catalog_region_id ON products(region,id)');
    const insert = database.prepare('INSERT INTO products VALUES(?,?,?,?,?)');
    for (const row of [[1,'Example sensor','north',499],[2,'Example actuator','south',725],[3,'東京 demo','north',1299],[4,'Example gateway','north',2499]])
      insert.run(...row, 'Fictional internal note excluded from the paid projection');
  } finally { database.close(); }
  for (const [input, output] of [['example-source.json','source.json'],['example-service.json','service.json']]) {
    await copyFile(new URL(input, import.meta.url), join(directory,output), constants.COPYFILE_EXCL);
    await chmod(join(directory,output),0o600);
  }
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const source = join(directory,'source.json'), service = join(directory,'service.json');
  const seller = fileURLToPath(new URL('../serve.mjs',import.meta.url));
  const handlers = fileURLToPath(new URL('./example-handlers.mjs',import.meta.url));
  console.log(JSON.stringify({ example:'FICTIONAL_CHALLENGE_ONLY', database:databasePath,source,service,handlers,
    command:`SF30_SQLITE_SOURCE=${quote(source)} node ${quote(seller)} --config ${quote(service)} --handlers ${quote(handlers)} --port 0` },null,2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error=>{process.stderr.write((error.code??error.message)+'\n');process.exitCode=1;});
}
