#!/usr/bin/env python3
"""MIT. Export one consistent private project, every source version and exact original asset."""
import csv, hashlib, io, json, os, sqlite3, sys, zipfile
def main():
    database, project, revision, output = sys.argv[1:]
    db=sqlite3.connect('file:'+database+'?mode=ro',uri=True);db.row_factory=sqlite3.Row;db.execute('BEGIN')
    current=db.execute('SELECT * FROM projects WHERE id=?',(project,)).fetchone()
    if not current or current['revision']!=int(revision): raise ValueError('The project changed before this snapshot; refresh it.')
    manifest={'schema':'asheville.portable-project.v1','projectId':project,'revision':int(revision),'files':[]}
    with open(output,'xb') as handle:
        os.chmod(output,0o600)
        with zipfile.ZipFile(handle,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
            def write(name,data):
                if not isinstance(data,bytes):data=(json.dumps(data,ensure_ascii=False,indent=2)+'\n').encode()
                archive.writestr(name,data);manifest['files'].append({'file':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
            write('project.json',{**json.loads(current['body']),'revision':current['revision']})
            write('active-datasets.json',dict(db.execute('SELECT kind,dataset FROM active WHERE project=?',(project,))))
            write('history.json',[{**json.loads(r['body']),'hmac':r['hmac']} for r in db.execute('SELECT body,hmac FROM events WHERE project=? ORDER BY revision',(project,))])
            assets=[dict(r) for r in db.execute('SELECT a.sha AS sha256,a.name,a.kind,b.size AS bytes,a.created FROM assets a JOIN blobs b ON a.sha=b.sha WHERE a.project=? ORDER BY a.created',(project,))]
            write('original-sources.json',assets)
            for digest in sorted(set(a['sha256'] for a in assets)):
                row=db.execute('SELECT bytes,size FROM blobs WHERE sha=?',(digest,)).fetchone();data=bytes(row['bytes'])
                if len(data)!=row['size'] or hashlib.sha256(data).hexdigest()!=digest:raise ValueError('Original asset hash changed: '+digest)
                write('sources/'+digest+'.data',data)
            for ds in db.execute('SELECT * FROM datasets WHERE project=? ORDER BY created,id',(project,)):
                meta=json.loads(ds['body']);rows=[dict(r) for r in db.execute('SELECT row_number,body,errors FROM data_rows WHERE dataset=? ORDER BY row_number',(ds['id'],))]
                write('datasets/'+ds['id']+'/metadata.json',meta)
                write('datasets/'+ds['id']+'/records.json',[{'row':r['row_number'],'data':json.loads(r['body']),'errors':json.loads(r['errors'])} for r in rows])
                values=[json.loads(r['body']) for r in rows];headers=list(values[0]) if values else []
                text=io.StringIO(newline='');writer=csv.DictWriter(text,fieldnames=headers,lineterminator='\r\n',quoting=csv.QUOTE_ALL);writer.writeheader();writer.writerows(values)
                write('datasets/'+ds['id']+'/mapped.csv',text.getvalue().encode())
            operations=[dict(r) for r in db.execute('SELECT * FROM artifacts WHERE project=? ORDER BY created,id',(project,))]
            write('operations.json',operations)
            for op in operations:
                data=bytes(db.execute('SELECT bytes FROM blobs WHERE sha=?',(op['sha'],)).fetchone()[0]);write('operations/'+op['id']+'.json',data)
            ledger=[json.loads(r['body']) for r in db.execute('SELECT body FROM ledger WHERE project=? ORDER BY id',(project,))]
            write('migration-ledger.json',ledger);write('accepted-bill-baselines.json',[dict(r) for r in db.execute('SELECT * FROM bill_baselines WHERE project=? ORDER BY bill_id',(project,))])
            write('READ_ME.txt',b'Private utility migration handoff. Original sources are stored once under sources/<sha256>.data; original-sources.json preserves every name and purpose. Datasets retain original intake and correction versions. Operations and the migration ledger are local operator records, not vendor import acceptance or production posting. Reopen the encrypted workspace backup to continue editing; this ZIP is a frozen, portable project handoff.\n')
            archive.writestr('MANIFEST.json',(json.dumps(manifest,indent=2)+'\n').encode())
        handle.flush();os.fsync(handle.fileno())
    db.close();print(json.dumps({'files':len(manifest['files']),'sourceAssets':len(set(a['sha256'] for a in assets)),'datasets':sum(1 for f in manifest['files'] if f['file'].endswith('/metadata.json')),'revision':int(revision)}))
if __name__=='__main__':
    try:main()
    except Exception as error:print(str(error),file=sys.stderr);sys.exit(1)
