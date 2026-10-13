"""UI-independent hooks for the existing ECSA upload/job/download gateways."""
from __future__ import annotations
import json
from pathlib import Path
from .store import RunStore
from .provider import capture_provider, submit_run
from .bindings import submit_manifest
from .runner import run_pending
from .comparison import compare_runs
from .archive import export_workspace, receive_workspace
from . import codec

class RunGateway:
    def __init__(self, workspace): self.store = RunStore(workspace)

    def configure(self, provider_file, data_dir, code_root=None):
        sha = capture_provider(self.store, provider_file, data_dir, code_root)
        project = self.store.project()
        project['provider_snapshot'] = sha
        self.store.save_project(project)
        return sha

    @property
    def snapshot(self):
        sha = self.store.project().get('provider_snapshot')
        if not sha: raise ValueError('Configure the original model provider first')
        return sha

    def submit(self, family, inputs, **options):
        return submit_run(self.store, self.snapshot, family, inputs, **options)

    def submit_manifest(self, manifest, **options):
        return submit_manifest(self.store, self.snapshot, manifest, **options)

    def execute(self, job_ids=None, *, workers=2, progress=None, **options):
        """Call from the existing app's job executor; no second UI or daemon."""
        return run_pending(self.store, job_ids=job_ids, workers=workers, progress=progress, **options)

    def packet(self, job_id):
        row = self.store.get(job_id)
        return {'job': row, 'spec': self.store.read(row['spec_sha']),
                'events': self.store.events(job_id),
                'result': self.store.result(job_id) if row['state']=='complete' else None}

    def select(self, job_id):
        """One durable selection shared by the original Map, Comparison and Report."""
        result=self.store.result(job_id)
        project=self.store.project(); project['active_job_id']=job_id
        self.store.save_project(project)
        return result

    def active(self):
        job_id=self.store.project().get('active_job_id')
        return self.store.result(job_id) if job_id else None

    def comparison(self, baseline_id, candidate_id, spatial_keys=('source_cell_id',), *, remember=True):
        result=compare_runs(self.store.result(baseline_id),self.store.result(candidate_id),spatial_keys)
        if remember:
            project=self.store.project()
            project['comparison']={'baseline_id':baseline_id,'candidate_id':candidate_id,'spatial_keys':list(spatial_keys)}
            self.store.save_project(project)
        return result

    def current_comparison(self):
        pair=self.store.project().get('comparison')
        return self.comparison(**pair,remember=False) if pair else None

    def adopt_ui_state(self, state: dict, job_id: str):
        """Update the original Streamlit-compatible keys, retaining full results."""
        result=self.select(job_id)
        state['active_result']=result
        history=state.setdefault('run_history',[])
        record={'job_id':job_id,'run_id':result['run_id'],'family':result['family']}
        if not any(isinstance(r,dict) and r.get('job_id')==job_id for r in history): history.append(record)
        return result

    def export_report(self, destination, baseline_id=None, candidate_id=None, spatial_keys=('source_cell_id',)):
        """Complete machine-readable result tables + native file assets + HTML index."""
        import html, shutil
        destination=Path(destination).resolve(); destination.mkdir(parents=True,exist_ok=False)
        try:
            project=self.store.project(); active=project.get('active_job_id')
            ids=list(dict.fromkeys(x for x in (baseline_id,candidate_id,active) if x))
            if not ids: raise ValueError('Select a completed result for this report')
            entries=[]
            for job_id in ids:
                packet=self.packet(job_id)
                if packet['result'] is None: raise ValueError(f'Run is not complete: {job_id}')
                root=destination/job_id; root.mkdir()
                frames=[]
                import pandas as pd
                # Nested tables remain complete in typed JSON; top-level frames also have CSV copies.
                for key,value in packet['result'].items():
                    if isinstance(value,pd.DataFrame):
                        filename=f'table-{len(frames)+1}.csv'
                        value.to_csv(root/filename,index=True)
                        frames.append({'result_key':str(key),'file':filename,'rows':len(value)})
                artifacts=packet['result'].get('_ecsa_execution',{}).get('result_artifacts',[])
                for i,artifact in enumerate(artifacts):
                    for f in artifact['files']:
                        from .provider import safe_relative
                        target=root/'native-files'/str(i)/safe_relative(f['relative'])
                        target.parent.mkdir(parents=True,exist_ok=True)
                        self.store.copy_blob(f['sha256'],target)
                    from .provider import _pointer
                    parent,key=_pointer(packet['result'],artifact['pointer'])
                    relative=Path('native-files')/str(i)
                    if not artifact['directory']: relative/=safe_relative(artifact['files'][0]['relative'])
                    parent[key]=relative if artifact['path_type'] else relative.as_posix()
                (root/'complete-result.json').write_bytes(codec.dumps(packet))
                (root/'TABLES.json').write_text(json.dumps(frames,indent=2),encoding='utf-8')
                entries.append({'job_id':job_id,'run_id':packet['result']['run_id'], 'family':packet['result']['family'],
                                'tables':frames,'native_artifacts':len(artifacts)})
            comparison=None
            if baseline_id and candidate_id:
                comparison=self.comparison(baseline_id,candidate_id,spatial_keys,remember=False)
                (destination/'comparison.json').write_bytes(codec.dumps(comparison))
                comparison['metrics'].to_csv(destination/'comparison-metrics.csv',index=False)
                comparison['spatial_delta'].to_csv(destination/'comparison-spatial.csv',index=False)
            (destination/'REPORT.json').write_text(json.dumps({'format':'ecsa-report-v1','runs':entries,'project':project},indent=2),encoding='utf-8')
            rows=''.join('<tr><td>'+html.escape(str(e['run_id']))+'</td><td>'+html.escape(str(e['family']))+
                         '</td><td><a href="'+e['job_id']+'/complete-result.json">Complete packet</a></td></tr>' for e in entries)
            extra='<h2>Comparison</h2>'+comparison['metrics'].to_html(index=False,escape=True) if comparison is not None else ''
            (destination/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>ECSA retained runs</title>'
                '<style>body{font:14px system-ui;margin:32px;max-width:1200px;color:#222;background:#fff}table{border-collapse:collapse;width:100%}'
                'td,th{border:1px solid #ccc;padding:8px;text-align:left}a{color:#222}h1,h2{font-weight:600}</style>'
                '<h1>Retained watershed runs</h1><p>Results are preserved by original model family, run identifier and input edition.</p>'
                '<table><thead><tr><th>Native run</th><th>Family</th><th>Download</th></tr></thead><tbody>'+rows+'</tbody></table>'+extra,encoding='utf-8')
            return {'path':str(destination),'runs':entries}
        except BaseException:
            shutil.rmtree(destination);raise

class RetainedProvider:
    """Drop-in blocking wrapper around original run_model/run_scenario signatures.

    The application's existing background job gateway may invoke these methods;
    native computation remains in a child process, while full results persist.
    """
    def __init__(self, workspace, provider_file, data_dir, *, code_root=None,
                 file_fields=('/weather_csv',),result_file_fields=()):
        self.gateway=RunGateway(workspace)
        self.gateway.configure(provider_file,data_dir,code_root)
        self.file_fields=file_fields;self.result_file_fields=result_file_fields

    def _run(self,family,inputs,scenario_name=None,data_dir=None):
        # data_dir is accepted for the original signature but a different directory
        # requires explicit recapture so provenance cannot silently drift.
        snapshot=self.gateway.store.read(self.gateway.snapshot)
        if data_dir is not None and Path(data_dir).resolve()!=Path(snapshot['original_data_dir']):
            raise ValueError('data_dir changed; configure a new provider/input edition')
        job=self.gateway.submit(family,inputs,name=scenario_name or 'Baseline',
            kind='scenario' if scenario_name is not None else 'baseline',
            file_fields=self.file_fields,result_file_fields=self.result_file_fields)
        if job['state'] not in ('complete','failed','cancelled'):
            self.gateway.execute([job['id']],workers=1)
        job=self.gateway.store.get(job['id'])
        if job['state']!='complete': raise RuntimeError(f"Native run {job['id']} {job['state']}: {job['error']}")
        return self.gateway.select(job['id'])

    def run_model(self,family,inputs,data_dir=None): return self._run(family,inputs,data_dir=data_dir)
    def run_scenario(self,family,inputs,scenario_name,data_dir=None): return self._run(family,inputs,scenario_name,data_dir)
