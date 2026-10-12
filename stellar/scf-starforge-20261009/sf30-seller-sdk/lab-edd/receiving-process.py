# MIT. Explicit generated-format process-ownership receiving probe.
# The existing workbook bridge completes its real decoder before this process
# waits for the original worker's cancellation or deadline to retire it.
import hashlib,json,os,runpy,signal,sys,time
from pathlib import Path

marker=Path(os.environ["LAB_EDD_PROCESS_RECEIVING"])
args=sys.argv[1:]
if len(args)!=5 or args[1]!="--files":
    raise ValueError("Use the original workbook file transport.")
bridge,_,control,source,output=args
signal.signal(signal.SIGTERM,signal.SIG_IGN)
sys.argv=args
runpy.run_path(bridge,run_name="__main__")
stat=Path("/proc/self/stat").read_text()
start_ticks=stat[stat.rfind(")")+2:].split()[19]
body={"schema":"starforge.lab-edd-native-decoder-observation.v1","source_kind":"generated software-format fixture",
      "pid":os.getpid(),"parent_pid":os.getppid(),"start_ticks":start_ticks,"cwd":os.getcwd(),
      "bridge":str(Path(bridge).resolve()),"source_sha256":hashlib.sha256(Path(source).read_bytes()).hexdigest(),
      "decoded_bytes":Path(output).stat().st_size,"decoded_sha256":hashlib.sha256(Path(output).read_bytes()).hexdigest()}
raw=(json.dumps(body,sort_keys=True,separators=(",",":"))+"\n").encode()
fd=os.open(marker,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,"wb") as stream:stream.write(raw);stream.flush()
while True:time.sleep(0.1)
