import ast,base64,hashlib,json,os,sys,tty,zlib
from pathlib import Path
if sys.stdin.isatty():tty.setraw(sys.stdin.fileno())
print(json.dumps({"event":"AVIARY_INPUT_READY","namespacePid":os.getpid(),"procSelfStat":Path("/proc/self/stat").read_text().strip()}),flush=True)
raw=bytearray()
while len(raw)<WIRE_BYTES:
 block=os.read(sys.stdin.fileno(),min(65536,WIRE_BYTES-len(raw)))
 if not block:raise RuntimeError("Complete original Aviary input ended early")
 raw.extend(block)
if hashlib.sha256(raw).hexdigest()!="WIRE_SHA256":raise RuntimeError("The complete compressed Aviary transfer differs")
compressed=base64.b64decode(raw,validate=True);del raw
decoder=zlib.decompressobj(-15)
raw=decoder.decompress(compressed,DECODED_BYTES+1)
if len(raw)!=DECODED_BYTES or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail or hashlib.sha256(raw).hexdigest()!="DECODED_SHA256":raise RuntimeError("Decoded complete Aviary input differs")
del compressed,decoder
value=json.loads(raw);del raw
print(json.dumps({"event":"AVIARY_INPUT_VERIFIED","bytes":DECODED_BYTES,"sha256":"DECODED_SHA256","transportBytes":WIRE_BYTES,"transportSha256":"WIRE_SHA256","encoding":"pako-2.1.0 deflateRaw + base64; Python zlib verified"}),flush=True)
ast.parse(value["mainSource"],filename="run_lean_aviary.py")
namespace={"__name__":"__main__","__file__":"run_lean_aviary.py","AVIARY_LEAN_VALUE":value}
exec(compile(value["mainSource"],"run_lean_aviary.py","exec"),namespace)
