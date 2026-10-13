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
if len(source)!=58152 or hashlib.sha256(source).hexdigest()!="472b8e168206eb0f3dc630020ff7c0954c940bdfc2d684d3f4fe63ae1844b3cb":raise RuntimeError("Original connected transport differs.")
receiver=selection["receiver"]["content"].encode("utf-8")
if len(receiver)!=320135 or hashlib.sha256(receiver).hexdigest()!="380abe4426b527fcbd1abb571185ba63a0196b688844df3140a03d3bf4eae03e":raise RuntimeError("Original complete receiver differs.")
compile(receiver,"receive_original.py","exec")
exec(compile(source,"connected_receive.py","exec"),{"connected_selection":selection,"__name__":"__main__"})
