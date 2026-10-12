#!/usr/bin/env python3
"""Run the original complete Citation, Python/Analysis and Europe PMC programme."""
import os,sys,json,hashlib,subprocess,zipfile,stat,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parent
P="stellar/scf-starforge-20261009/sf88-operator-buyer-cli"
CITATION="SCF-RESEARCH-CITATION-REVIEW-396C-20261012"
PYTHON="SCF-RESEARCH-CITATION-PYTHON-396C-20261012"
EPMC="SCF-RESEARCH-EUROPE-PMC-396C-20261012"
def need(value,message):
    if not value:raise ValueError(message)
def read(path):return Path(path).read_bytes()
def digest(data):return hashlib.sha256(data).hexdigest()
def encoded(value):return (json.dumps(value,ensure_ascii=False,indent=2)+"\n").encode()
def save(path,value):
    data=encoded(value)
    if path.exists():need(read(path)==data,"Original saved selection differs: "+str(path))
    else:
        with path.open("xb") as f:f.write(data);f.flush();os.fsync(f.fileno())
        path.chmod(0o600)
def command(name,argv):
    log=ROOT/"native-logs"/(name+".output")
    print(json.dumps({"phase":name,"state":"RUNNING","argv":argv}),flush=True)
    with log.open("ab",buffering=0) as f:r=subprocess.run(argv,cwd=ROOT,stdout=f,stderr=f,env={**os.environ,"PYTHONDONTWRITEBYTECODE":"1","TMPDIR":str(ROOT)})
    need(r.returncode==0,name+" exited "+str(r.returncode)+"; "+read(log)[-6000:].decode("utf-8","replace"))
    print(json.dumps({"phase":name,"state":"COMPLETE","log":str(log),"logBytes":log.stat().st_size}),flush=True)
def original_result(path,state=True):
    value=json.loads(read(path))
    if state:need(value.get("state")=="COMPLETE","Original phase incomplete: "+str(path))
    return value
def package(target,source,manifest,items):
    rows={}
    for row in manifest["files"]:
        path=source/row["path"];body=read(path)
        need(len(body)==row["bytes"] and digest(body)==row["sha256"],"Selected source changed")
        rows["source/"+row["path"]]=(path,len(body),digest(body))
    for label,path,expected in items:
        path=Path(path);body=read(path)
        if expected:need(len(body)==expected["bytes"] and digest(body)==expected["sha256"],"Original native artifact changed")
        need(not path.is_symlink() and path.resolve().is_relative_to(ROOT),"Output leaves original root")
        rows[label]=(path,len(body),digest(body))
    document={"schema":"stellar-forge.complete-research-phase-delivery.v1","members":[{"path":n,"bytes":v[1],"sha256":v[2]} for n,v in sorted(rows.items())]}
    if not target.exists():
        with zipfile.ZipFile(target,"x",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
            for n,(path,size,sha) in sorted(rows.items()):archive.write(path,n)
            archive.writestr("DELIVERY_MANIFEST.json",encoded(document))
        target.chmod(0o600)
    with zipfile.ZipFile(target) as archive:
        need(set(archive.namelist())==set(rows)|{"DELIVERY_MANIFEST.json"},"Delivery membership differs")
        need(archive.read("DELIVERY_MANIFEST.json")==encoded(document),"Delivery manifest differs")
        for n,(_,size,sha) in rows.items():
            body=archive.read(n);need(len(body)==size and digest(body)==sha,"Delivery member differs")
    return {"file":str(target),"bytes":target.stat().st_size,"sha256":digest(read(target)),"members":len(rows)+1}
def main():
    node=Path(os.environ.get("RESEARCH_NODE") or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node") or "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node").resolve()
    python=Path(sys.executable).resolve()
    candidates=[os.environ.get("RESEARCH_NODE_MODULES",""),os.environ.get("OPENFEMA_NODE_MODULES",""),"/workspace/scratch/2d589b11f06d/scf-oauth-deps/node_modules",os.environ.get("CODEX_PRIMARY_RUNTIME_NODE_MODULES",""),"/dev/shm/3459-genomes-operations/dependencies/node_modules"]
    playwright=Path(os.environ["RESEARCH_PLAYWRIGHT_MODULE"]).resolve() if os.environ.get("RESEARCH_PLAYWRIGHT_MODULE") else next((Path(p,n,"index.mjs").resolve() for p in candidates if p for n in ["playwright","playwright-core"] if Path(p,n,"index.mjs").is_file()),None)
    chromium=next((Path(p).resolve() for p in [os.environ.get("RESEARCH_CHROMIUM",""),os.environ.get("OPENFEMA_CHROMIUM",""),"/workspace/scratch/7573d13065d5/aurora_ops/browser-runtime/tmp/chromium","/workspace/scratch/bc0850d7ba23/browser-runtime/chrome-headless-shell"] if p and Path(p).is_file()),None)
    need(node.is_file() and playwright and playwright.is_file() and chromium,"Original Node/Playwright/Chromium runtime must be present")
    (ROOT/"native-logs").mkdir(mode=0o700,exist_ok=True)
    deps=next((Path(p).resolve() for p in candidates if p and Path(p,"re2js").exists()),None)
    if deps and not (ROOT/"node_modules").exists():os.symlink(deps,ROOT/"node_modules",target_is_directory=True)
    import openpyxl
    need(openpyxl.__version__=="3.1.5","Original workbook dependency differs")
    selected={"schema":"stellar-forge.research-programme-selection.v2","operationId":CITATION,"pythonOperationId":PYTHON,"europePmcOperationId":EPMC,"root":str(ROOT),"node":str(node),"python":str(python),"playwright":str(playwright),"chromium":str(chromium),"sourceEnvelopes":{"citation":"750aaf8416d08dca67f3de27d574859a0d25e96561f7173c82238b2effb6f1b2","python":"5edf487427cf69152c6ce36bd7031efc840016360c20177a813f8522d96bd3ab","epmc":"6d85434ef1932f00faef9d3ae6be38fcc409d6cd8ed6865c68c5432462265210"}}
    save(ROOT/"PROGRAMME_SOURCE_SUCCESSOR_SELECTION.json",selected)
    source={}
    kits=[
        ("citation","citation","materialize-source.py",3703763,"c2587e00f484f4fde86945a8f5f2a6e997aae1e64266ab926585ad1eb65edbae",9615,286),
        ("python","python","materialize-python-source.py",6723862,"1179f8910c8d4e62eeb10d6146ed47abf2c3a0c495dc360c974bac9ebcef6f34",10540,452),
        ("epmc","europe-pmc","materialize-europe-pmc-source.py",7171993,"fc46d7214033a4cd5cc7814b6814637350192e5ebb8d7b52b6478eeaf1f21ea5",10934,476),
    ]
    for kind,packet_kind,helper,envelope_size,materializer_sha,materializer_size,source_count in kits:
        kit=ROOT/"kits"/kind
        if not all((kit/f).is_file() for f in ["source-envelope.json","materialize-source.py","KIT_SUCCESSOR.json"]):
            command(kind+"-compose-source",[str(python),"-B",str(ROOT/"inbox"/"compose-developer-assets.py"),"--kit",packet_kind,"--addition-packet",str(ROOT/"inbox"/"developer-assets.json"),"--source-envelope",str(ROOT/"inbox"/(kind+"-source-envelope.json")),"--source-materializer",str(ROOT/"inbox"/helper),"--output",str(kit)])
        envelope=read(kit/"source-envelope.json");materializer=read(kit/"materialize-source.py")
        need(len(envelope)==envelope_size and digest(envelope)==selected["sourceEnvelopes"][kind],"Complete successor envelope differs: "+kind)
        need(len(materializer)==materializer_size and digest(materializer)==materializer_sha,"Original successor materializer differs: "+kind)
        kit_receipt=json.loads(read(kit/"KIT_SUCCESSOR.json"))
        need(kit_receipt["state"]=="COMPLETE" and kit_receipt["sourceFiles"]==source_count and kit_receipt["sourceEnvelope"]["sha256"]==digest(envelope) and kit_receipt["materializer"]["sha256"]==digest(materializer),"Successor receiving receipt differs: "+kind)
        source[kind]=ROOT/(kind+"-source")
        command(kind+"-source",[str(python),"-B",str(kit/"materialize-source.py"),"--source-envelope",str(kit/"source-envelope.json"),"--directory",str(source[kind])])

    input_directory=ROOT/"input";input_directory.mkdir(mode=0o700,exist_ok=True)
    research=source["citation"]/P/"research-dossiers"
    original=research/"examples/crossref-retraction-1758835919874651"
    edition=input_directory/"crossref-document-edition.json"
    if not edition.exists():
        command("original-document-edition",[str(node),str(research/"crossref-document-cli.mjs"),"--provenance",str(original/"provenance.json"),"--source-dir",str(original),"--query","How does the registered retraction affect this cited work?","--doi","10.1177/1758835919874651","--doi","10.1177/17588359211061903","--updates-doi","10.1177/1758835919874651","--supporting","README.md","--output",str(edition)])
    customer=ROOT/"citation-customer"
    command("citation-customer",[str(node),str(research/"citation-review-workflow.mjs"),"--operation",CITATION,"--edition-file",str(edition),"--sha256",digest(read(edition)),"--run-directory",str(customer),"--playwright-module",str(playwright),"--chromium",str(chromium),"--target-doi","10.1177/1758835919874651","--source-reference","Retained original Crossref public source documents"])
    cit=original_result(customer/"result.json")
    need(cit["schema"]=="sf88-citation-review-workflow.v1" and cit["operation"]==CITATION,"Original citation identity differs")
    pyout=ROOT/"python-continuation"
    command("python-analysis",[str(node),str(source["python"]/P/"python/examples/research_citation_analyst.mjs"),"--existing-run",str(customer),"--directory",str(pyout),"--checkout",str(source["python"]),"--python",str(python),"--operation-id",PYTHON,"--with-workbook"])
    py=original_result(pyout/"complete.json")
    epout=ROOT/"europe-pmc-customer"
    command("europe-pmc-customer",[str(python),"-B",str(source["epmc"]/P/"research-dossiers/run-europe-pmc.py"),"--operation-id",EPMC,"--source-root",str(source["epmc"]),"--source-manifest",str(source["epmc"]/".europe-pmc-source-materialization.json"),"--workspace",str(customer/"workspace"),"--dossier",cit["seed"]["dossierId"],"--expected-revision",str(cit["selection"]["currentRevision"]),"--directory",str(epout),"--inputs",str(source["epmc"]/"stellar/scf-starforge-20261009/sf30-seller-sdk/europe-pmc/public-inputs"),"--node",str(node),"--playwright",str(playwright),"--chromium",str(chromium)])
    ep=original_result(epout/"complete-delivery.json",False)
    output=ROOT/"complete-delivery";output.mkdir(mode=0o700,exist_ok=True)
    cm=json.loads(read(source["citation"]/".citation-source-materialization.json"))
    items=[("receiving/result.json",customer/"result.json",None),("receiving/seed.json",customer/"seed.json",None)]
    items += [("receiving/"+a["file"],customer/a["file"],a) for a in cit["artifacts"]]
    citation_package=package(output/"Citation_Review_Complete_Receiving.zip",source["citation"],cm,items)
    pm=json.loads(read(source["python"]/".citation-python-source-materialization.json"))
    items=[("receiving/complete.json",pyout/"complete.json",None)]
    for a in py["files"]:
        path=Path(a["file"]);need(path.is_relative_to(pyout),"Python output leaves original continuation")
        items.append(("receiving/"+str(path.relative_to(pyout)),path,a))
    python_package=package(output/"Python_Analysis_Complete_Receiving.zip",source["python"],pm,items)
    epfile=epout/ep["filename"];need(epfile.stat().st_size==ep["bytes"] and digest(read(epfile))==ep["sha256"],"EPMC complete delivery differs")
    target=output/ep["filename"]
    if not target.exists():os.link(epfile,target)
    else:need(read(target)==read(epfile),"EPMC retained package differs")
    summary={"schema":"stellar-forge.complete-research-programme.v1","state":"COMPLETE","selection":selected,"workspaceId":py["workspaceId"],"dossierId":cit["seed"]["dossierId"],"citation":citation_package,"python":python_package,"europePmc":ep}
    save(output/"COMPLETE_RESEARCH_PROGRAMME.json",summary)
    print(json.dumps(summary),flush=True)
if __name__=="__main__":
    try:main()
    except Exception as error:print(json.dumps({"state":"INCOMPLETE","error":str(error)}),file=sys.stderr,flush=True);sys.exit(1)
