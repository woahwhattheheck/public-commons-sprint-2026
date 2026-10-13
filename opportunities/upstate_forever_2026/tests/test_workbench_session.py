"""Focused real-process opening course; authored HTTP fixture, no scientific run."""
from __future__ import annotations
import argparse
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from source_tools import workbench_session as opening

SERVER = r'''
import argparse, hashlib, json, signal, threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
parser=argparse.ArgumentParser()
parser.add_argument("--workspace", required=True)
parser.add_argument("--operator-state", required=True)
parser.add_argument("--port", type=int, default=0)
parser.add_argument("--source-manifest", action="append", default=[])
parser.add_argument("--source-root", action="append", default=[])
args=parser.parse_args()
project=json.loads((Path(args.workspace)/"workspace.json").read_text())
key=hashlib.sha256(json.dumps({"directory":str(Path(args.workspace).resolve())},
 sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()).hexdigest()
token="authored-local-receiving-course-token-000000000001"
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*_): pass
 def do_GET(self):
  expected="127.0.0.1:"+str(self.server.server_address[1])
  if self.headers.get("Host")!=expected or self.headers.get("Authorization")!="Bearer "+token:
   self.send_error(401);return
  if self.path!="/api/whoami":
   self.send_error(404);return
  body=json.dumps({"default_workspace":key,"workspaces":[{"id":key,
    "project_id":project["id"],"available":True}]}).encode()
  self.send_response(200);self.send_header("Content-Length",str(len(body)))
  self.end_headers();self.wfile.write(body)
server=ThreadingHTTPServer(("127.0.0.1",args.port),Handler)
url="http://127.0.0.1:"+str(server.server_address[1])+"/#token="+token
print(json.dumps({"operator_url":url,"workspace_key":key,"project":project}),flush=True)
def close(*_): threading.Thread(target=server.shutdown,daemon=True).start()
signal.signal(signal.SIGTERM,close);signal.signal(signal.SIGINT,close)
try: server.serve_forever(poll_interval=.05)
finally: server.server_close()
'''

def arguments(**updates):
    value=dict(profile=None, application=None, workspace=None, python_path=sys.executable,
        operator_state=None, native=None, port=None, source_manifest=None, source_root=None)
    value.update(updates)
    return argparse.Namespace(**value)

class OpeningCourse(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory()
        self.root=Path(self.temporary.name)
        self.project=self.root/"original"
        self.application=self.project/"application"
        self.workspace=self.project/"workspace"
        (self.application/"operator").mkdir(parents=True)
        self.workspace.mkdir()
        (self.application/"operator/server.py").write_text(SERVER)
        (self.workspace/"workspace.json").write_text(json.dumps({
            "schema":"upstate.scientific-workbench/v1","id":"original-project","title":"Authored fixture"}))
        self.state=self.root/"private-state"
        self.state.mkdir()
        self.args=arguments(workspace=str(self.workspace),operator_state=str(self.state))
        self.selection,_,_=opening.resolve_selection(self.args,self.application)
        self.process=None

    def tearDown(self):
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            self.process.wait(timeout=10)
        self.temporary.cleanup()

    def run_original(self):
        self.process, _, record=opening.start(self.selection,self.state)
        opening._write(self.state/"workbench-session.json",record)
        return record

    def test_real_start_status_and_reopen_leave_original_process(self):
        record=self.run_original()
        pid=self.process.pid
        output=io.StringIO()
        with patch.object(opening.subprocess,"Popen",side_effect=AssertionError("duplicate process")), \
             patch.object(opening.webbrowser,"open",side_effect=AssertionError("unexpected browser")), \
             contextlib.redirect_stdout(output):
            code=opening.main(self.application,["--workspace",str(self.workspace),
                "--python",sys.executable,"--operator-state",str(self.state),"--status"])
        self.assertEqual(code,0)
        self.assertNotIn("#token",output.getvalue())
        self.assertEqual(json.loads(output.getvalue())["pid"],pid)
        self.assertIsNone(self.process.poll())
        with patch.object(opening.subprocess,"Popen",side_effect=AssertionError("duplicate process")), \
             patch.object(opening.webbrowser,"open",return_value=True), \
             contextlib.redirect_stdout(io.StringIO()):
            code=opening.main(self.application,["--workspace",str(self.workspace),
                "--python",sys.executable,"--operator-state",str(self.state)])
        self.assertEqual(code,0)
        self.assertIsNone(self.process.poll())
        self.assertEqual(opening.existing_session(self.state/"workbench-session.json",self.selection),record)

    def test_other_project_and_runtime_do_not_reuse_or_start(self):
        self.run_original()
        mismatch={**self.selection,"project_id":"another-original"}
        with self.assertRaisesRegex(RuntimeError,"different original"):
            opening.existing_session(self.state/"workbench-session.json",mismatch)
        with self.assertRaisesRegex(ValueError,"another launch selection"):
            opening.existing_session(self.state/"workbench-session.json",{**self.selection,"native":True})
        self.assertIsNone(self.process.poll())

    def test_adopt_exact_old_receipt_without_owning_it(self):
        record=self.run_original()
        original=self.root/"private-startup.json"
        opening._write(original,{"operator_url":record["operator_url"],
            "workspace_key":record["workspace_key"],"project":{"id":"original-project"}})
        adopted=opening.adopt_session(original,self.selection)
        self.assertEqual(adopted["launch_origin"],"adopted-original-operator")
        self.assertEqual(adopted["operator_url"],record["operator_url"])
        public=opening.public_status(adopted,self.selection,self.state)
        self.assertIsNone(public["python"])
        self.assertIsNone(public["native_invocation"])
        self.assertNotIn("#token",json.dumps(public))
        self.assertIsNone(self.process.poll())
        with self.assertRaisesRegex(ValueError,"--plain"):
            opening.adopt_session(original,{**self.selection,"native":True})

    def test_profile_create_only_and_whole_directory_relocation(self):
        profile=self.project/"workbench.json"
        opening.save_profile(profile,self.selection)
        value=opening._json(profile)
        self.assertEqual(value["application"],"application")
        self.assertEqual(value["workspace"],"workspace")
        self.assertNotIn("operator_state",value)
        self.assertNotIn("token",json.dumps(value))
        with self.assertRaises(FileExistsError):
            opening.save_profile(profile,self.selection)
        target=self.root/"relocated"
        shutil.copytree(self.project,target)
        args=arguments(profile=target/"workbench.json",workspace=None,python_path=sys.executable)
        selected,state,_=opening.resolve_selection(args,self.application)
        self.assertEqual(selected["workspace"],str(target/"workspace"))
        self.assertEqual(selected["application"],str(target/"application"))
        self.assertNotEqual(state,self.state)
        self.assertEqual(selected["project_id"],"original-project")

    def test_native_command_uses_original_invocation_and_arguments(self):
        invocation=self.application/"source_tools/native_runtime/invocation.py"
        invocation.parent.mkdir(parents=True)
        invocation.write_text("# Original component is supplied by the real application.\n")
        selection={**self.selection,"native":True,"source_manifests":["/original/input.json"],
            "source_roots":["/original/source"]}
        command,args=opening.command_for(selection)
        self.assertEqual(command,[sys.executable,"-B",str(invocation),"--python",sys.executable,
            "--application",str(self.application),"--entry","operator/server.py","--"])
        self.assertEqual(args,["--workspace",str(self.workspace),"--source-manifest","/original/input.json",
            "--source-root","/original/source","--port","0"])

    def test_nonlocal_url_and_private_state_inside_project_reject(self):
        with self.assertRaises(ValueError):
            opening._session_url("http://example.com/#token="+"x"*48)
        with self.assertRaises(ValueError):
            opening._session_url("http://127.0.0.1:8000/path#token="+"x"*48)
        with self.assertRaisesRegex(ValueError,"outside"):
            opening.resolve_selection(arguments(workspace=str(self.workspace),
                operator_state=str(self.application/"private")),self.application)

if __name__=="__main__":
    unittest.main()
