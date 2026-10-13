"""Strict portable JSON and bounded filesystem helpers."""
import base64, hashlib, json, math, os, re, stat, tempfile, uuid
from datetime import datetime
from pathlib import Path
MAX_BLOB=64*1024*1024
MAX_BLOBS=256*1024*1024
MAX_HISTORY=72*1024*1024
MAX_ARCHIVE=384*1024*1024
SHA=re.compile(r"^[0-9a-f]{64}$")
class HighwayError(ValueError):
    def __init__(self,code,message):
        super().__init__(message); self.code=code
def fail(code,message): raise HighwayError(code,message)
def require(test,code,message):
    if not test: fail(code,message)
def canonical(value):
    try: return json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(",",":"),allow_nan=False).encode("utf-8")
    except (ValueError,TypeError,UnicodeError): fail("INVALID_JSON","Value must be finite UTF-8 JSON.")
def sha(data): return hashlib.sha256(data).hexdigest()
def digest(value): return sha(canonical(value))
def loads(data):
    def pairs(rows):
        result={}
        for key,value in rows:
            require(key not in result,"DUPLICATE_KEY","JSON contains a repeated property.")
            result[key]=value
        return result
    try: return json.loads(data,object_pairs_hook=pairs,parse_constant=lambda x:fail("NONFINITE","Nonfinite JSON is unsupported."))
    except (UnicodeError,json.JSONDecodeError): fail("INVALID_JSON","Cannot read the complete UTF-8 JSON.")
def identifier(value):
    require(isinstance(value,str),"INVALID_ID","An original UUID is required.")
    try: parsed=uuid.UUID(value)
    except ValueError: fail("INVALID_ID","An original UUID is required.")
    require(str(parsed)==value.lower(),"INVALID_ID","Use the canonical UUID spelling.")
    return value
def timestamp(value):
    require(isinstance(value,str),"INVALID_TIME","An explicit dated time is required.")
    try: parsed=datetime.fromisoformat(value.replace("Z","+00:00"))
    except ValueError: fail("INVALID_TIME","Use an ISO date and time.")
    require(parsed.tzinfo is not None,"INVALID_TIME","A time-zone offset is required.")
    return value
def now(): return datetime.now().astimezone().isoformat(timespec="milliseconds")
def sha_id(value):
    require(isinstance(value,str) and SHA.fullmatch(value),"INVALID_SHA","A SHA-256 identity is required.")
    return value
def text(value,label,maximum=2000):
    require(isinstance(value,str) and 0<len(value)<=maximum and "\x00" not in value,"INVALID_TEXT",label+" is required.")
    return value
def safe_path(value):
    require(isinstance(value,str) and 0<len(value)<=512 and "\\" not in value and not value.startswith("/") and all(ord(c)>=32 for c in value),"INVALID_PATH","Use a portable relative path.")
    require(all(p not in ("",".","..") for p in value.split("/")),"INVALID_PATH","Unsafe source path.")
    return value
def read_regular(path,limit=MAX_BLOB):
    path=Path(path)
    fd=os.open(path,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
    try:
        before=os.fstat(fd); require(stat.S_ISREG(before.st_mode) and before.st_size<=limit,"FILE_LIMIT","Source must be a bounded ordinary file.")
        chunks=[]; total=0
        while True:
            b=os.read(fd,min(1024*1024,limit+1-total))
            if not b: break
            chunks.append(b);total+=len(b)
            require(total<=limit,"FILE_LIMIT","File exceeds its allowance.")
        after=os.fstat(fd)
        require((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),"SOURCE_CHANGED","Source changed while reading.")
        return b"".join(chunks)
    finally: os.close(fd)
def fsync_directory(path):
    fd=os.open(path,os.O_RDONLY|getattr(os,"O_DIRECTORY",0))
    try: os.fsync(fd)
    finally: os.close(fd)
def atomic_file(path,data,immutable=False):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd,tmp=tempfile.mkstemp(prefix="."+path.name+".",dir=path.parent)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,"wb") as f: f.write(data);f.flush();os.fsync(f.fileno())
        if immutable:
            try: os.link(tmp,path)
            except FileExistsError: require(read_regular(path,max(MAX_BLOB,len(data)))==data,"IMMUTABLE_CONFLICT","Retained output differs from the original bytes.")
        else: os.replace(tmp,path)
        fsync_directory(path.parent)
    finally:
        try: os.unlink(tmp)
        except FileNotFoundError: pass
def canonical_directory(path,create=False):
    path=Path(path).absolute()
    parent=path.parent.resolve(strict=True)
    require(path.name not in ("",".",".."),"INVALID_DIRECTORY","Select a named workspace.")
    target=parent/path.name
    require(not target.is_symlink(),"SYMLINK","Workspace cannot be a symbolic link.")
    if create: target.mkdir(mode=0o700,exist_ok=True)
    require(target.is_dir(),"WORKSPACE_MISSING","Original workspace directory is unavailable.")
    return target
