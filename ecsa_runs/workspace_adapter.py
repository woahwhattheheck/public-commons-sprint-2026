"""Retain complete results behind an application's EXISTING queue and job IDs.

No job creation, model execution, comparison, selection, UI or HTTP routing occurs
here. The canonical workspace owns all those operations. A lost response can be
retried with the same job/attempt; a different result cannot overwrite that edition.
"""
from __future__ import annotations
import copy
import hashlib
from pathlib import Path
from typing import Any
from .store import RunStore
from .artifacts import retain_artifacts, restore_artifacts

class WorkspaceRetention:
    def __init__(self, root: str | Path, namespace: str = 'ecsa'):
        if not namespace: raise ValueError('A project namespace is required')
        self.store = RunStore(root)
        self.namespace = namespace

    def _key(self, job_id: str, attempt: int) -> str:
        if not isinstance(job_id, str) or not job_id: raise ValueError('Use the existing nonempty job ID')
        if type(attempt) is not int or attempt < 1: raise ValueError('attempt must be a positive integer')
        from . import codec
        return 'retention:' + hashlib.sha256(codec.dumps([self.namespace, job_id, attempt])).hexdigest()

    def retain(self, job_id: str, result: dict[str, Any], *, attempt: int = 1,
               model_family: str, run_id: str, scenario_id: str | None = None,
               inputs: Any = None, input_files: dict[str, str | Path] | None = None,
               output_pointers: tuple[str, ...] = (), output_base: str | Path | None = None,
               native_files: dict[str, str | Path] | None = None,
               native_directories: tuple[str, ...] = (),
               native_file_metadata: dict[str, dict] | None = None) -> dict:
        """Call once native work succeeds, BEFORE deleting its native output files.

        inputs is the existing application's frozen input/provenance object.
        input_files binds explicit role names to complete files; no filename guesses.
        Persist the returned metadata with the original job in the original writer.
        """
        if (native_directories or native_file_metadata is not None) and native_files is None:
            raise ValueError('Native directories and metadata require the original native file tree')
        key = self._key(job_id, attempt)
        if not isinstance(result, dict): raise TypeError('Retain the original result dictionary')
        if not isinstance(model_family, str) or not model_family: raise ValueError('model_family required')
        if not isinstance(run_id, str) or not run_id: raise ValueError('original run_id required')
        for field in ('family', 'model_family'):
            if field in result and result[field] != model_family: raise ValueError('Original result family differs')
        if 'run_id' in result and result['run_id'] != run_id: raise ValueError('Original result run_id differs')
        files=[]
        for role, path in sorted((input_files or {}).items()):
            sha, size = self.store.put_file(Path(path))
            files.append({'role':role,'name':Path(path).name,'sha256':sha,'bytes':size})
        artifacts=retain_artifacts(self.store,result,output_pointers,Path(output_base) if output_base else None)
        artifact_sha=self.store.put(artifacts)
        input_sha=self.store.put({'inputs':inputs,'files':files})
        result_sha=self.store.put(result)
        descriptor={'upstream_job_id':job_id,'attempt':attempt,'namespace':self.namespace,
                    'model_family':model_family,'run_id':run_id,'scenario_id':scenario_id,
                    'retained_result_sha256':result_sha,'retained_input_sha256':input_sha,
                    'retained_artifacts_sha256':artifact_sha}
        if native_files is not None:
            from .native_tree import capture_tree
            descriptor['retained_native_tree_sha256'] = self.store.put(
                capture_tree(self.store, native_files, directories=native_directories,
                             expected=native_file_metadata))
        descriptor_sha=self.store.put(descriptor)
        with self.store.transaction() as con:
            previous=con.execute('SELECT value FROM settings WHERE key=?',(key,)).fetchone()
            if previous and previous[0] != descriptor_sha:
                raise ValueError('This upstream job attempt already has a different retained result')
            con.execute('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)',(key,descriptor_sha))
        return descriptor

    def metadata(self, job_id: str, attempt: int = 1) -> dict:
        with self.store.connection() as con:
            row=con.execute('SELECT value FROM settings WHERE key=?',(self._key(job_id,attempt),)).fetchone()
        if row is None: raise KeyError((job_id,attempt))
        return self.store.read(row[0])

    def load(self, job_id: str, attempt: int = 1) -> dict:
        """Return the original dictionary, with only declared file paths relocated."""
        meta=self.metadata(job_id,attempt)
        result=self.store.read(meta['retained_result_sha256'])
        original=copy.deepcopy(result.get('_ecsa_execution'))
        had_key='_ecsa_execution' in result
        result['_ecsa_execution']={'result_artifacts':self.store.read(meta['retained_artifacts_sha256'])}
        result=restore_artifacts(self.store,result,self._key(job_id,attempt).split(':')[1])
        if had_key: result['_ecsa_execution']=original
        else: result.pop('_ecsa_execution',None)
        return result

    def inputs(self, job_id: str, attempt: int = 1) -> dict:
        """Receive original input bytes under role-indexed paths and retain role IDs."""
        from .provider import safe_relative
        value=self.store.read(self.metadata(job_id,attempt)['retained_input_sha256'])
        root=self.store.root/'retained-inputs'/self._key(job_id,attempt).split(':')[1]
        for i,item in enumerate(value['files']):
            path=root/str(i)/safe_relative(item['name']);path.parent.mkdir(parents=True,exist_ok=True)
            self.store.copy_blob(item['sha256'],path);item['local_path']=str(path)
        return value

    def restore_native(self, job_id: str, destination: str | Path, attempt: int = 1,
                       *, repair_missing: bool = False) -> dict:
        from .native_tree import restore_tree
        meta = self.metadata(job_id, attempt)
        if 'retained_native_tree_sha256' not in meta:
            raise ValueError('This retained result has no native workspace tree')
        tree = self.store.read(meta['retained_native_tree_sha256'])
        return restore_tree(self.store, tree, destination, repair_missing=repair_missing)

    def export(self, destination: str | Path) -> dict:
        from .archive import export_workspace
        return export_workspace(self.store,destination)

    @classmethod
    def receive(cls, archive: str | Path, destination: str | Path, namespace: str = 'ecsa'):
        from .archive import receive_workspace
        received=receive_workspace(archive,destination)
        return cls(received.root,namespace)
