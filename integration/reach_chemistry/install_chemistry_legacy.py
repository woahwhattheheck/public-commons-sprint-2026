#!/usr/bin/env python3
"""Compose reach chemistry into the original Upper Savannah application."""
from __future__ import annotations
import argparse, ast, fcntl, hashlib, json, os, re, tempfile
from pathlib import Path


def add(s,anchor,new,label,before=False):
    if new in s:return s
    if s.count(anchor)!=1:raise ValueError(label+': expected one current source anchor, found '+str(s.count(anchor)))
    return s.replace(anchor,new+anchor if before else anchor+new,1)


def patch_server(s):
    s=add(s,'from model.spatial_exports import SpatialExports\n',
          'from chemistry import ChemistryOperations, ACTIONS as CHEMISTRY_ACTIONS, READS as CHEMISTRY_READS\n','chemistry import')
    s=add(s,'ACTIONS.update(CUSTOMER_REVIEW_ACTIONS)\n','ACTIONS.update(CHEMISTRY_ACTIONS)\n','actions')
    s=add(s,'        self.customer_reviews = CustomerReviews(self, Fault)\n',
          '        self.chemistry = ChemistryOperations(self, Fault)\n','operator')
    s=add(s,'        if action in CUSTOMER_REVIEW_ACTIONS:\n',
          '        if action in CHEMISTRY_ACTIONS:\n            return self.chemistry.invoke(task)\n','worker',True)
    anchor='                review_reads = {"/api/reviews/" + name: name for name in CUSTOMER_REVIEW_READS}\n'
    new='''                chemistry_reads = {"/api/chemistry/" + name: name for name in CHEMISTRY_READS}
                if url.path in chemistry_reads:
                    return self.send_json(200, self.app.chemistry.read(workspace, chemistry_reads[url.path],
                        {key: one(key) for key in ("case_id", "run_id", "field", "offset", "limit")}))
'''
    s=add(s,anchor,new,'read routes',True)
    s=add(s,'            value = self.body()\n','''            if url.path == "/api/chemistry/cancel":
                return self.send_json(200, self.app.chemistry.cancel(value.get("workspace", self.app.primary), value))
''','cancellation route')
    if 'self.chemistry.decorate_task(' not in s:
        pattern=r'(?m)^(        return )([^\n]*self\.customer_reviews\.decorate_task\(task\)[^\n]*)$'
        matches=list(re.finditer(pattern,s))
        if len(matches)!=1:raise ValueError('Expected the original customer-review task decorator')
        s=re.sub(pattern,r'\1self.chemistry.decorate_task(\2)',s,count=1)
    matches=list(re.finditer(r'if selected not in \{([^}]+)\}:',s))
    if len(matches)!=1:raise ValueError('Expected the original static asset registry')
    match=matches[0];names=ast.literal_eval('{'+match.group(1)+'}')
    names.update({'chemistry.mjs','chemistry.css'})
    s=s[:match.start()]+'if selected not in {'+', '.join(json.dumps(n) for n in sorted(names))+'}:'+s[match.end():]
    ast.parse(s);return s


def patch_app(s):
    s=add(s,"import {attachCustomerReviews} from './reviews.mjs';\n","import {attachChemistry} from './chemistry.mjs';\n",'browser import')
    s=add(s,'const viewLabels={',"chemistry:'Reach chemistry',",'browser navigation')
    s=add(s,'const actionLabels={',"'chemistry.case.save':'Save chemical scenario','chemistry.run':'Calculate reach chemistry','chemistry.export':'Export chemical project','chemistry.receive':'Receive chemical project',",'action labels')
    s=add(s,'function toast(message){',
          'const chemistry=attachChemistry({getState:()=>state,api,endpoint,submitAction,showTask,toast,fileList});\n','browser instance',True)
    s=add(s,"  const d=state.data;let html='';\n",'''  if(view==='chemistry'){spatialWorkspace.suspend();community.detach();customerReviews.detach();chemistry.mount($('#content'),state);return;}
  chemistry.detach();
''','browser mount',True)
    s=add(s," const action=button.dataset.action,id=button.dataset.id;\n",
          " if(action?.startsWith('chemistry-'))return chemistry.dispatch(button);\n",'browser actions')
    # This original workspace-switch segment is kept intact for other plug-ins.
    s=add(s,'workspace=id;', 'chemistry.detach();','workspace lifecycle',True)
    return s


def patch_index(s):
    return add(s,'<link rel="stylesheet" href="/web/reviews.css">\n',
        '<link rel="stylesheet" href="/web/chemistry.css">\n','stylesheet')


def install(application,source_root=None,dry_run=False):
    application=Path(application).resolve(strict=True)
    source=Path(source_root or Path(__file__).parent).resolve(strict=True)
    if not (application/'model/workspace.py').is_file():
        raise ValueError('Select the original native application directory containing model/workspace.py')
    lock=application/'.locks/chemistry-install.lock';lock.parent.mkdir(exist_ok=True)
    with lock.open('a+') as handle:
        fcntl.flock(handle,fcntl.LOCK_EX)
        pending={}
        for f in (source/'reach_chemistry').glob('*.py'):
            pending['model/reach_chemistry/'+f.name]=f.read_bytes()
        for f in (source/'native').rglob('*'):
            if f.is_file() and '__pycache__' not in f.parts:pending[f.relative_to(source/'native').as_posix()]=f.read_bytes()
        for name,patch in [('operator/server.py',patch_server),('operator/web/app.mjs',patch_app),('operator/web/index.html',patch_index)]:
            pending[name]=patch((application/name).read_text()).encode()
        for name in ('CHEMISTRY.md','requirements-chemistry.txt'):
            if (source/name).is_file():pending[name]=(source/name).read_bytes()
        original={name:(application/name).read_bytes() if (application/name).exists() else None for name in pending}
        own=[n for n in pending if n not in ('operator/server.py','operator/web/app.mjs','operator/web/index.html')]
        for name in own:
            if original[name] is not None and original[name]!=pending[name]:
                raise ValueError('Reconcile the changed authored chemistry edition: '+name)
        for name,data in pending.items():
            if name.endswith('.py'):ast.parse(data,filename=name)
        changed=[n for n in pending if original[n]!=pending[n]]
        if not dry_run:
            with tempfile.TemporaryDirectory(prefix='.chemistry-stage-',dir=application.parent) as temporary:
                stage=Path(temporary)
                for name in changed:
                    f=stage/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(pending[name])
                # Check every current shared file before replacing any of them.
                for name in changed:
                    f=application/name;current=f.read_bytes() if f.exists() else None
                    if current!=original[name]:raise RuntimeError('Concurrent source change: '+name)
                for name in changed:
                    f=application/name;f.parent.mkdir(parents=True,exist_ok=True);os.replace(stage/name,f)
        return {'schema':'upstate.chemistry-install/v1','opening_route':'/#chemistry','dry_run':dry_run,'changed':changed,
                'files':[{'path':n,'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)} for n,b in sorted(pending.items())]}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--application',required=True);p.add_argument('--source-root');p.add_argument('--dry-run',action='store_true')
    a=p.parse_args();print(json.dumps(install(a.application,a.source_root,a.dry_run),indent=2))
