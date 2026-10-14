"""Select and inspect the existing Measurements Node runtime without disk writes.

The same function is consumed by the original component installer and Python
bridge. An explicit selection is authoritative: a broken selection is reported,
never silently replaced with a different executable.
"""
from __future__ import annotations
import os
import sys

# Direct execution otherwise puts this directory's operator.py ahead of the
# standard-library operator imported by argparse/enum. Leave ordinary package
# imports and isolated (-I) invocation unchanged.
if __name__ == "__main__" and sys.path:
    _entry_directory = os.path.normcase(os.path.realpath(os.path.dirname(__file__)))
    if os.path.normcase(os.path.realpath(sys.path[0])) == _entry_directory:
        del sys.path[0]

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess

PROBE = r"""
const result={format:'upper-savannah-measurement-runtime/v1',
  executable:process.execPath,version:process.versions.node,
  platform:process.platform,arch:process.arch};
let db;
try {
  const sqlite=require('node:sqlite'),zlib=require('node:zlib');
  if(typeof sqlite.DatabaseSync!=='function'||typeof sqlite.backup!=='function')
    throw Error('Built-in SQLite and online backup are required');
  db=new sqlite.DatabaseSync(':memory:');
  db.exec('CREATE TABLE runtime_check(value INTEGER NOT NULL)');
  db.prepare('INSERT INTO runtime_check VALUES (?)').run(9223372036854775807n);
  const statement=db.prepare('SELECT value FROM runtime_check');
  statement.setReadBigInts(true);
  if(statement.get().value!==9223372036854775807n)
    throw Error('SQLite exact integer support is unavailable');
  if(db.prepare("SELECT json_extract('{\"enabled\":true}', '$.enabled') AS value").get().value!==1)
    throw Error('SQLite JSON support is unavailable');
  const original=Buffer.from('Upper Savannah Measurements runtime \u03bc');
  const compressed=zlib.deflateRawSync(original);
  if(!zlib.inflateRawSync(compressed).equals(original)||
      typeof zlib.crc32!=='function'||zlib.crc32(Buffer.from('123456789'))!==0xcbf43926)
    throw Error('Native ZIP compression or CRC32 is unavailable');
  result.sqlite=db.prepare('SELECT sqlite_version() AS version').get().version;
  result.capabilities={sqlite:true,online_backup:true,exact_integers:true,json:true,deflate:true,crc32:true};
  result.ready=true;
} catch(error) {
  result.ready=false;
  result.error=String(error&&error.message||error).slice(0,1000);
  process.exitCode=1;
} finally {
  if(db)db.close();
  process.stdout.write(JSON.stringify(result)+'\n');
}
"""


class MeasurementRuntimeError(RuntimeError):
    """An actionable local runtime failure before any scientific request."""
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def resolve_node(node=None):
    selected = node if node is not None else os.environ.get("MEASUREMENTS_NODE")
    source = "argument" if node is not None else "MEASUREMENTS_NODE"
    if selected is None:
        sibling = Path(sys.executable).resolve().parent / ("node.exe" if os.name == "nt" else "node")
        if sibling.is_file():
            selected, source = str(sibling), "python-runtime"
        else:
            selected, source = "node", "PATH"
    if not isinstance(selected, (str, os.PathLike)) or not str(selected).strip():
        raise MeasurementRuntimeError("NODE_SELECTION", "MEASUREMENTS_NODE must name one Node executable.")
    selected = os.path.expanduser(os.fspath(selected))
    # No shell, command strings, downloaded runtimes or mutable browser setting.
    executable = shutil.which(selected)
    if executable is None:
        raise MeasurementRuntimeError(
            "NODE_NOT_FOUND",
            "Measurements cannot find its selected Node executable. Set MEASUREMENTS_NODE "
            "to the installed Node 22.16 or newer executable before opening the workbench.")
    resolved = Path(executable).resolve(strict=True)
    if os.name == "nt" and resolved.suffix.lower() != ".exe":
        raise MeasurementRuntimeError("NODE_EXECUTABLE", "Select node.exe directly, rather than a command or batch wrapper.")
    if not resolved.is_file():
        raise MeasurementRuntimeError("NODE_EXECUTABLE", "Select the installed Node executable file.")
    return str(resolved), source


def inspect_node(node=None):
    executable, selection = resolve_node(node)
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        result = subprocess.run(
            [executable, "--input-type=commonjs", "--eval", PROBE],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=12, check=False, close_fds=True, creationflags=flags)
    except subprocess.TimeoutExpired as error:
        raise MeasurementRuntimeError("NODE_TIMEOUT", "The selected Node runtime did not complete its in-memory capability check.") from error
    except OSError as error:
        raise MeasurementRuntimeError("NODE_EXECUTION", "The selected Node executable could not start: " + str(error)) from error
    try:
        value = json.loads(result.stdout.decode("utf-8", errors="strict"))
    except (ValueError, UnicodeError) as error:
        raise MeasurementRuntimeError(
            "NODE_RESPONSE", "The selected executable did not return the Measurements runtime response "
            "(exit " + str(result.returncode) + "). Select node.exe or the native Node binary directly.") from error
    if not isinstance(value, dict) or value.get("format") != "upper-savannah-measurement-runtime/v1":
        raise MeasurementRuntimeError("NODE_RESPONSE", "The selected executable returned an incompatible runtime response.")
    version = value.get("version", "")
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", version) if isinstance(version, str) else None
    if match is None or tuple(map(int, match.groups())) < (22, 16, 0):
        raise MeasurementRuntimeError("NODE_VERSION", "Measurements needs Node 22.16 or newer; selected version: " + str(version))
    expected = {"sqlite", "online_backup", "exact_integers", "json", "deflate", "crc32"}
    caps = value.get("capabilities")
    if result.returncode != 0 or value.get("ready") is not True or not isinstance(caps, dict) or any(caps.get(key) is not True for key in expected):
        detail = value.get("error", "Required built-in SQLite and ZIP capabilities are unavailable.")
        if not isinstance(detail, str):
            detail = "Required built-in SQLite and ZIP capabilities are unavailable."
        raise MeasurementRuntimeError("NODE_CAPABILITIES", "Selected Node " + version + ": " + detail[:1000])
    # Keep the observed process path separate from the exact path selected for spawn.
    return {**value, "selected_executable": executable, "selection": selection}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", help="Installed native Node executable; defaults to MEASUREMENTS_NODE, Python runtime sibling, then PATH.")
    options = parser.parse_args()
    try:
        print(json.dumps(inspect_node(options.node), indent=2))
    except MeasurementRuntimeError as error:
        print(json.dumps({"ready": False, "code": error.code, "error": str(error)}))
        raise SystemExit(1)
