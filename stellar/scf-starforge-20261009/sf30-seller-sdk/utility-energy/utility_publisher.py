"""MIT. The existing original publisher bridge, owned by this utility process."""
from __future__ import annotations
import json
import os
import queue
import subprocess
import tempfile
import threading

from utility_shared import HERE,InputError,json_bytes,load_json

class Publisher:
    def __init__(self,directory):
        self.directory=directory;self.process=None;self.errors=None;self.sequence=0
        self.lock=threading.RLock();self.replies=None;self.last_state=None

    def call(self,action,payload=None):
        with self.lock:
            if self.process is None:
                self.errors=tempfile.TemporaryFile()
                self.replies=queue.Queue()
                bridge=HERE.parent/"clinicaltrials"/"publisher-bridge.mjs"
                self.process=subprocess.Popen([os.environ.get("SF30_XML_NODE","node"),"--max-old-space-size=512",
                    str(bridge),"--directory",str(self.directory)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=self.errors)
                process,replies=self.process,self.replies
                def receive():
                    try:
                        while line:=process.stdout.readline(24*1024*1024):
                            if not line.endswith(b"\n"):break
                            replies.put(line)
                    finally:replies.put(None)
                threading.Thread(target=receive,daemon=True).start()
            self.sequence+=1
            self.process.stdin.write(json_bytes({"id":self.sequence,"action":action,"payload":payload or {}}));self.process.stdin.flush()
            try:
                raw=self.replies.get(timeout=180)
                if raw is None:raise InputError("The original publisher process exited")
                response=load_json(raw)
                if response.get("id")!=self.sequence:raise InputError("Original publisher response identity changed")
                if not response.get("ok"):raise InputError(response.get("error","Original publisher rejected the operation"))
                result=response["result"]
                if action=="publisher.state":self.last_state=result
                elif action.startswith("publisher.") and isinstance(result,dict) and "state" in result:
                    self.last_state=result["state"]
                return result.get("result",result) if isinstance(result,dict) and "state" in result else result
            except queue.Empty as error:
                self.close();raise InputError("Read the retained original publisher operation before continuing") from error

    def state(self):
        return {"opened":self.process is not None,"last_state":self.last_state}

    def close(self):
        with self.lock:
            if self.process is not None:
                process,self.process=self.process,None
                try:
                    process.stdin.close();process.wait(timeout=10)
                except (OSError,subprocess.TimeoutExpired):
                    process.terminate()
                    try:process.wait(timeout=10)
                    except subprocess.TimeoutExpired:process.kill();process.wait()
                finally:process.stdout.close()
            if self.errors is not None:self.errors.close();self.errors=None
