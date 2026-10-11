// MIT — Native collections and portable receiving under starforge inbox library.
import { openLibrary } from './library.mjs';
import { requireValue, readSnapshot } from './files.mjs';
import { exportCollection, inspectCollectionArchive, receiveCollection, openReceivedLibrary } from './collection-package.mjs';

export async function collectionMain(args) {
  if(!args.length || args.includes('--help')) {
    process.stdout.write(`Resource collections — original buyer library\n\nstarforge inbox library collections COMMAND [OPTIONS]\n\nserve   --state ABS [--port N]\nlist    --state ABS [--offset N --limit N]\nshow    --state ABS --id ID [--revision N]\nhistory --state ABS --id ID [--offset N --limit N]\nsave    --state ABS --request ABS\nexport  --state ABS --id ID --revision N --out ABS [--max-bytes N]\ninspect --archive ABS [--sha256 HASH --max-bytes N]\nreceive --archive ABS --out ABS --state ABS [--sha256 HASH --resume true --max-bytes N]\n\nsave reads a collection selection JSON with id, name, note, expectedRevision,\noperationId and members [{id, sha256, annotationRevision, mode:'current'|'retain'}].\nexport writes the complete selected edition as one private USTAR file.\nreceive retains exact original metadata, adopts the original searchable library\nand reopens the source collection as an independently editable local edition.\nRepeat a lost receive reply with --resume true and the SAME archive/destination/state.\nFirst initialize an inbox library with its original scan command.\n`);return;
  }
  const [command,...rest]=args;
  const options={serve:['--state','--port'],list:['--state','--offset','--limit'],show:['--state','--id','--revision'],
    history:['--state','--id','--offset','--limit'],save:['--state','--request'],
    export:['--state','--id','--revision','--out','--max-bytes'],inspect:['--archive','--sha256','--max-bytes'],
    receive:['--archive','--out','--state','--sha256','--resume','--max-bytes']};
  requireValue(Object.hasOwn(options,command),'COLLECTION_COMMAND_REQUIRED');
  requireValue(rest.length%2===0,'OPTION_VALUE_REQUIRED');
  const flags=new Map();for(let i=0;i<rest.length;i+=2){
    requireValue(options[command].includes(rest[i])&&!flags.has(rest[i]),'OPTION_INVALID');flags.set(rest[i],rest[i+1]);}
  const get=key=>flags.get('--'+key),num=key=>flags.has('--'+key)?Number(get(key)):undefined;
  if(flags.has('--resume'))requireValue(['true','false'].includes(get('resume')),'OPTION_INVALID');
  const controller=new AbortController(),stop=()=>controller.abort(new Error('OPERATOR_CANCELLED'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
  let library,host;
  try {
    if(command==='inspect') {
      print(await inspectCollectionArchive(get('archive'),{signal:controller.signal,maxBytes:num('max-bytes'),expectedSha256:get('sha256')}));return;
    }
    if(command==='receive') {
      requireValue(typeof get('state')==='string','LIBRARY_STATE_REQUIRED');
      const received=await receiveCollection({archive:get('archive'),destination:get('out'),resume:get('resume')==='true',
        signal:controller.signal,maxBytes:num('max-bytes'),expectedSha256:get('sha256')});
      library=await openReceivedLibrary({directory:received.directory,state:get('state'),signal:controller.signal});
      print({...received,state:library.state,localCollection:library.collections.show(received.collectionId)});return;
    }
    library=await openLibrary({state:get('state')});
    const page={offset:num('offset')??0,limit:num('limit')??50};
    if(command==='list')print(library.collections.list(page));
    else if(command==='show')print(library.collections.show(get('id'),num('revision')));
    else if(command==='history')print(library.collections.history(get('id'),page));
    else if(command==='save')print(library.collections.save(JSON.parse((await readSnapshot(get('request'),4*1024*1024)).toString('utf8'))));
    else if(command==='export') {
      requireValue(Number.isSafeInteger(num('revision'))&&num('revision')>0,'COLLECTION_REVISION_REQUIRED');
      print(await exportCollection(library,{id:get('id'),revision:num('revision'),destination:get('out'),signal:controller.signal,maxBytes:num('max-bytes')}));
    } else if(command==='serve') {
      const {serveLibrary}=await import('./server.mjs'),{collectionExtension}=await import('./collection-ui.mjs');
      host=await serveLibrary(library,{...await collectionExtension(library),port:num('port')??0});
      print({url:host.origin+'/collections#'+host.token,state:library.state});
      if(!controller.signal.aborted)await new Promise(resolve=>controller.signal.addEventListener('abort',resolve,{once:true}));
    }
  } finally {
    process.off('SIGINT',stop);process.off('SIGTERM',stop);
    if(host)await host.close();if(library)await library.close();
  }
}
