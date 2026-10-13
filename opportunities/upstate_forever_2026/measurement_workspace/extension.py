"""Adapter for the existing upstate.operator-extension/v1 host at f293e68f.

The registry injects the actual Workspace. No separate task queue or browser
session exists; browser RPC travels through the original authenticated handler.
"""
from __future__ import annotations
import atexit
import hashlib
import json
import os
from pathlib import Path
import re
import threading
from urllib.parse import urlsplit
from .operator import Measurements, BASE
from .large_context import capture_native_domain, retained_native_reaches

class MeasuredObservationExtension:
    def __init__(self, operator, fault):
        self.operator = operator
        self.fault = fault
        self._services = {}
        self._lock = threading.RLock()
        atexit.register(self.close)

    def _directory(self, workspace):
        # The maintained Workspace owns root; no competing Workspace is constructed.
        return Path(workspace.root).resolve() / "measurement-observations"

    def _service(self, workspace):
        directory = self._directory(workspace)
        key = str(directory)
        with self._lock:
            if key not in self._services:
                def reaches(_):
                    registry = directory / "native-domain.json"
                    if not registry.exists(): return []
                    value = json.loads(registry.read_text("utf-8"))
                    source = Path(workspace.root).resolve() / value["source_path"]
                    if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest() != value["source_sha256"]:
                        # Received projects retain their explicitly selected original domain.
                        return retained_native_reaches(directory, value) or []
                    return value["reaches"]
                self._services[key] = Measurements(workspace, data_dir=directory, reaches=reaches)
            return self._services[key]

    def bind_domain(self, workspace, payload):
        """Read actual retained JSON/GeoJSON IDs; require an explicit source field path.

        Example items_path='features', id_path='properties.HUC12'. This is source
        selection, not an assertion that the HUC is the sample's drainage area.
        """
        root = Path(workspace.root).resolve()
        relative = payload.get("source_path", "")
        if not isinstance(relative, str) or not relative:
            raise ValueError("Choose the original retained domain JSON or GeoJSON source path")
        source = (root / relative).resolve(strict=True)
        if not source.is_relative_to(root) or not source.is_file():
            raise ValueError("Domain source must be an existing file inside the original Workspace")
        raw = source.read_bytes()
        if len(raw) > 128 * 1024 * 1024:
            raise ValueError("Select a native identifier export under 128 MiB")
        value = json.loads(raw)
        def at(item, path):
            if not path: return item
            for part in path.split("."):
                if not isinstance(item, dict) or part not in item:
                    raise ValueError("Source field path is absent: " + path)
                item = item[part]
            return item
        items = at(value, str(payload.get("items_path", "")))
        if not isinstance(items, list): raise ValueError("The selected native source field must be a list")
        id_path = str(payload.get("id_path", ""))
        name_path = str(payload.get("name_path", ""))
        rows=[]
        for item in items:
            identity=at(item,id_path)
            if not isinstance(identity,str) or not identity.strip():
                raise ValueError("Source identities must be nonempty strings; numeric identifiers are not coerced")
            name=at(item,name_path) if name_path else identity
            rows.append({"id":identity,"name":str(name),"source_path":str(source.relative_to(root)),"sourceSha256":hashlib.sha256(raw).hexdigest()})
        if len({x['id'] for x in rows}) != len(rows): raise ValueError("Duplicate native source identities")
        result={"format":"upper-savannah-measurement-domain/v1","source_path":str(source.relative_to(root)),
                "source_sha256":hashlib.sha256(raw).hexdigest(),"items_path":payload.get("items_path", ""),
                "id_path":id_path,"name_path":name_path,"reaches":rows}
        directory=self._directory(workspace);directory.mkdir(parents=True,exist_ok=True)
        with self._lock:
            target=directory/'native-domain.json';temp=directory/'native-domain.pending'
            with temp.open('w',encoding='utf-8') as stream:
                json.dump(result,stream,ensure_ascii=False);stream.flush();os.fsync(stream.fileno())
            temp.replace(target)
        return {"count":len(rows),"source_path":result['source_path'],"source_sha256":result['source_sha256']}

    def read(self, workspace, operation, payload):
        try:
            if operation == 'bind-domain': return self.bind_domain(workspace,payload)
            if operation == 'chemistry':
                from .chemistry import handle
                return handle(workspace, self._service(workspace), payload)
            method=payload.get('method','GET');path=payload.get('path','')
            if method not in {'GET','POST','PUT'} or not isinstance(path,str):
                raise ValueError('Unsupported measured-data operation')
            parsed=urlsplit(path)
            if parsed.scheme or parsed.netloc or not path.startswith('/') and path!='' or parsed.fragment:
                raise ValueError('Measured-data path must be local to the extension')
            if any(part in {'.','..'} for part in parsed.path.split('/')):
                raise ValueError('Invalid measured-data path')
            service=self._service(workspace)
            if method == 'POST' and parsed.path == '/large/editions':
                capture_native_domain(Path(workspace.root), service.directory)
            body=b'' if payload.get('payload') is None else json.dumps(payload['payload'],allow_nan=False).encode()
            status,headers,content=service.request(method,BASE+path,body)
            return {'status':status,'content_type':headers.get('Content-Type','application/json'),
                    'body':content.decode('utf-8')}
        except Exception as error:
            raise self.fault('MEASUREMENT_OPERATION',str(error),422) from error

    def close(self):
        with self._lock:
            for service in self._services.values(): service.close()
            self._services.clear()
