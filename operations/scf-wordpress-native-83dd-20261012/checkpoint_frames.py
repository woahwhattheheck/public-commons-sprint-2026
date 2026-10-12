#!/usr/bin/env python3
"""Retain one complete private native-control checkpoint from courier JSON lines."""
from __future__ import annotations
import argparse,base64,hashlib,json,os,pathlib,tempfile,zlib

OPERATION='scf-wordpress-native-receiving-83dd-20261012'
MAX_BYTES=4*1024*1024

def checksum(value):
    if not isinstance(value,str) or len(value)!=64 or any(c not in '0123456789abcdef' for c in value):
        raise ValueError('Select the actual checkpoint SHA-256')
    return value

def decode(source,selected):
    checksum(selected)
    meta=None;data=bytearray();committed=False
    with open(source,encoding='utf-8') as stream:
        for line in stream:
            if not line.strip():continue
            try:value=json.loads(line)
            except json.JSONDecodeError:continue
            if not isinstance(value,dict) or value.get('sha256')!=selected:continue
            action=value.get('action')
            if action=='checkpoint-begin':
                candidate={key:value.get(key) for key in
                    ('operation_id','encoding','bytes','sha256','compressed_bytes','compressed_sha256')}
                if candidate['operation_id']!=OPERATION or candidate['encoding']!='zlib+base64':
                    raise ValueError('Checkpoint belongs to a different original operation')
                for key,maximum in [('bytes',MAX_BYTES),('compressed_bytes',MAX_BYTES+65536)]:
                    if isinstance(candidate[key],bool) or not isinstance(candidate[key],int) or not 1<=candidate[key]<=maximum:
                        raise ValueError('Checkpoint exceeds its control-data envelope')
                checksum(candidate['compressed_sha256'])
                if meta is not None and meta!=candidate:raise ValueError('Repeated checkpoint selection differs')
                meta=candidate
            elif action=='checkpoint-write':
                if meta is None:raise ValueError('Checkpoint bytes precede their original selection')
                part=base64.b64decode(value.get('data_base64',''),validate=True)
                if base64.b64encode(part).decode()!=value.get('data_base64') or len(part)>32768:
                    raise ValueError('Checkpoint transfer range differs')
                offset=value.get('offset')
                if isinstance(offset,bool) or not isinstance(offset,int) or offset<0 or offset+len(part)>meta['compressed_bytes']:
                    raise ValueError('Checkpoint transfer offset differs')
                if offset<len(data):
                    if offset+len(part)>len(data) or data[offset:offset+len(part)]!=part:
                        raise ValueError('Repeated checkpoint bytes differ')
                elif offset==len(data):data.extend(part)
                else:raise ValueError('An original checkpoint transfer range is missing')
            elif action=='checkpoint-commit':
                if meta is None or value.get('compressed_sha256')!=meta['compressed_sha256']:
                    raise ValueError('Checkpoint completion differs')
                if len(data)!=meta['compressed_bytes'] or hashlib.sha256(data).hexdigest()!=meta['compressed_sha256']:
                    raise ValueError('Checkpoint is incomplete; recover its original missing ranges')
                committed=True
    if not committed or meta is None:raise ValueError('No complete selected checkpoint was retained')
    decoder=zlib.decompressobj()
    raw=decoder.decompress(data,MAX_BYTES+1)
    if not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
        raise ValueError('Checkpoint compression stream differs')
    if len(raw)!=meta['bytes'] or hashlib.sha256(raw).hexdigest()!=selected:
        raise ValueError('Complete checkpoint identity differs')
    value=json.loads(raw)
    if value.get('schema')!='stellar-forge.wordpress-native-control-checkpoint.v1' or value.get('operation_id')!=OPERATION:
        raise ValueError('Complete checkpoint schema differs')
    return raw,value

def retain(destination,raw):
    destination=pathlib.Path(destination).absolute()
    if destination.is_symlink() or destination.parent.resolve()!=destination.parent:
        raise ValueError('Select a physical private destination directory')
    if destination.exists():
        if not destination.is_file() or destination.read_bytes()!=raw:
            raise ValueError('Existing selected checkpoint bytes differ')
        return destination
    descriptor,temporary=tempfile.mkstemp(prefix='.'+destination.name+'.',dir=destination.parent)
    try:
        with os.fdopen(descriptor,'wb') as stream:
            stream.write(raw);stream.flush();os.fsync(stream.fileno())
        os.chmod(temporary,0o600)
        try:os.link(temporary,destination)
        except FileExistsError:
            if destination.is_symlink() or destination.read_bytes()!=raw:
                raise ValueError('Concurrent checkpoint differs')
        directory=os.open(destination.parent,os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)
    return destination

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',required=True,help='Original captured courier JSON lines')
    parser.add_argument('--sha256',required=True,help='Exact checkpoint-ready digest')
    parser.add_argument('--output',required=True,help='Private JSON file in an existing physical directory')
    args=parser.parse_args()
    raw,packet=decode(args.input,args.sha256)
    path=retain(args.output,raw)
    print(json.dumps({'operation_id':OPERATION,'path':str(path),'bytes':len(raw),'sha256':args.sha256,
                      'request_sha256':packet['request_sha256'],'native_failure_sha256':packet['native_failure_sha256'],
                      'resume_request':packet['resume_request']},separators=(',',':')))
    return 0

if __name__=='__main__':
    raise SystemExit(main())
