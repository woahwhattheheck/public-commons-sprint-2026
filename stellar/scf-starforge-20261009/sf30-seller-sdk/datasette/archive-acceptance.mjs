// MIT. Receiving the original WRI edition through the complete Datasette workspace.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { openDatasetteWorkspace } from './workspace.mjs';
import { receiveDatasetteWorkspace } from './archive.mjs';
const sha = raw => createHash('sha256').update(raw).digest('hex');
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const directory = resolve(process.argv[2]), sourceArchive = resolve(process.argv[3]);
const sourceSHA = '53f2486406d61f18c9e1c9ceaac659c265bbad7afe2fe54b1a17f43307cb0ca0';
const editionSHA = 'ee34942e0c4c090d4e5cab66eeb51dda49c5cf8852f86d9dfa299913b4115616';
const startedAt = new Date().toISOString();
let source, received, rereceived;
try {
  source = await openDatasetteWorkspace({directory:join(directory,'workspace'),create:true});
  const imported = await source.dispatch('source.receive',{archiveFile:sourceArchive,sha256:sourceSHA,id:'wri-geothermal'});
  requireValue(imported.editionSha256===editionSHA,'The received edition identity changed.');
  const selection=await source.dispatch('source.select',{editionId:'wri-geothermal'});
  const inspected=await source.dispatch('editions.inspect',{id:'wri-geothermal',limit:250});
  const before=await source.status();
  await writeFile(join(source.directory,'imports','wri-geothermal.sfds.gz'),await readFile(sourceArchive),{mode:0o600});
  const archiveFile=join(source.directory,'exports','complete-workspace.zip');
  const exported=await source.dispatch('workspace.export',{outputFile:archiveFile});
  const replay=await source.dispatch('workspace.export',{outputFile:archiveFile});
  requireValue(replay.reused===true && replay.sha256===exported.sha256,'Archive replay did not retain the same source identity.');
  requireValue(exported.manifest.files.some(file=>file.path==='imports/wri-geothermal.sfds.gz'),'The original source archive was omitted.');
  requireValue(exported.manifest.files.some(file=>file.path.startsWith('editions/wri-geothermal/')),'The complete source edition was omitted.');
  await source.close(); source=null;
  const result=await receiveDatasetteWorkspace({archiveFile,directory:join(directory,'received'),sha256:exported.sha256});
  received=await openDatasetteWorkspace({directory:result.directory});
  const status=await received.status();
  requireValue(status.workspaceId===before.workspaceId,'The received workspace identity changed.');
  requireValue(JSON.stringify(status.selection)===JSON.stringify(selection).replace(/,"reused":false}/,'}'),'The received source selection changed.');
  const edition=await received.dispatch('editions.inspect',{id:'wri-geothermal',limit:250});
  requireValue(edition.editionSha256===editionSHA,'The complete source edition did not reopen.');
  const original=await received.dispatch('files.inspect',{path:result.originalArchive,sha256:exported.sha256});
  const part=await received.dispatch('files.read',{path:result.originalArchive,sha256:exported.sha256,offset:0,limit:262144});
  requireValue(part.complete && sha(Buffer.from(part.data,'base64'))===exported.sha256,'The original archive was not completely readable.');
  await received.dispatch('source.select',{editionId:'wri-geothermal',query:'receiving-edit'});
  await received.close(); received=null;
  const receiveReplay=await receiveDatasetteWorkspace({archiveFile,directory:result.directory,sha256:exported.sha256});
  requireValue(receiveReplay.reused===true,'The original completed receiving operation was not reused.');
  received=await openDatasetteWorkspace({directory:result.directory});
  requireValue((await received.status()).selection.query==='receiving-edit','Receive replay overwrote a later workspace edit.');
  const second=await received.dispatch('workspace.export',{outputFile:join(directory,'received-workspace.zip')});
  await received.close();received=null;
  const third=await receiveDatasetteWorkspace({archiveFile:second.archiveFile,directory:join(directory,'received-again'),sha256:second.sha256});
  rereceived=await openDatasetteWorkspace({directory:third.directory});
  const thirdStatus=await rereceived.status();
  requireValue(thirdStatus.selection.query==='receiving-edit','A second complete transfer lost the reopened edit.');
  const history=JSON.parse(await readFile(join(third.directory,'datasette-receiving-history.json'),'utf8'));
  requireValue(history.receipts.length===2,'Complete receiving history was not retained.');
  const fullReport={schema:'stellar-forge.datasette-workspace-archive-programme.v1',startedAt,completedAt:new Date().toISOString(),
    node:process.version,sourceArchive:{file:sourceArchive,sha256:sourceSHA,editionSha256:editionSHA},
    originalInspection:inspected,receivedInspection:edition,
    archive:{archiveFile:exported.archiveFile,bytes:exported.bytes,sha256:exported.sha256,manifestSha256:exported.manifestSha256,
      snapshotSha256:exported.snapshotSha256,files:exported.manifest.files.length,directories:exported.manifest.directories.length},
    receiving:result,reexport:{archiveFile:second.archiveFile,bytes:second.bytes,sha256:second.sha256},
    checks:{sameSourceEdition:true,sameWorkspaceIdentity:true,completeOriginalArchive:true,exactExportReplay:true,
      editedWorkspaceSurvivesReceiveReplay:true,secondTransferRetainsEdit:true,completeReceivingHistory:true}};
  await writeFile(join(directory,'workspace-archive-result.json'),JSON.stringify(fullReport,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({schema:fullReport.schema,startedAt,completedAt:fullReport.completedAt,node:process.version,
    archive:fullReport.archive,reexport:fullReport.reexport,checks:fullReport.checks,reportFile:join(directory,'workspace-archive-result.json')}));
} finally {
  await rereceived?.close();await received?.close();await source?.close();
}
