import hashlib,json,os,sys,termios
os.umask(0o077);sys.dont_write_bytecode=True
if sys.stdin.isatty():
    state=termios.tcgetattr(sys.stdin.fileno())
    state[3]&=~(termios.ECHO|termios.ICANON)
    state[6][termios.VMIN]=1;state[6][termios.VTIME]=0
    termios.tcsetattr(sys.stdin.fileno(),termios.TCSANOW,state)
print(json.dumps({"stage":"datasette_connected_source_ready","pid":os.getpid(),"cwd":os.getcwd()}),flush=True)
raw=sys.stdin.buffer.readline(8*1024*1024+1)
if len(raw)>8*1024*1024 or not raw.endswith(b"\n"):raise RuntimeError("Complete original source input is missing.")
selection=json.loads(raw)
source=selection["connected_source"]["content"].encode("utf-8")
if len(source)!=59095 or hashlib.sha256(source).hexdigest()!="76795c50e22f045c3ffb82987d991b96373b063c1f90491b85e5ac8ff6e943ec":raise RuntimeError("Original connected transport differs.")
receiver=selection["receiver"]["content"].encode("utf-8")
if len(receiver)!=353728 or hashlib.sha256(receiver).hexdigest()!="0879b964501dc1ca74e9f4301321b9b2fbb850a9c09ce7d376e7aaa287e3856d":raise RuntimeError("Original complete receiver differs.")
compile(receiver,"receive_original.py","exec")
exec(compile(source,"connected_receive.py","exec"),{"connected_selection":selection,"__name__":"__main__"})
