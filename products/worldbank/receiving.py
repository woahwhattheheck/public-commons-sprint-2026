#!/usr/bin/env python3
"""Receive the installed World Bank product through its original complete engines.

The public entrypoint is:
  starforge worldbank-product receive --runtime READY_DIR --workspace PRIVATE_DIR

The entrypoint supplies the original READY runtime binding. This receiver verifies
its exact selected manifest, holds one operation-directory lease through all
native children, and continues the original Applications and Analysis records.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import signal
import stat
import subprocess
import sys
import tempfile
import traceback

OPERATION = "WORLDBANK-STANDALONE-PRODUCT-FE85-20261012"
MODULE_SHA256 = "66af0f3b80cf5ebdb76e589a84e9f35a984dab185e43764828eeab112d36cf93"
PRODUCER_ID = "13c281c36fca40fe8377af367911bb4d"
SOURCE_REF = None
_active_child = None
_stop_signal = None

def emit(value):
    print(json.dumps(value, ensure_ascii=False, allow_nan=False), flush=True)


def digest(body):
    return hashlib.sha256(body).hexdigest()


def git_blob(body):
    return hashlib.sha1(b"blob " + str(len(body)).encode() + b"\0" + body).hexdigest()


def private(path):
    path = Path(path).expanduser().absolute()
    missing = []
    ancestor = path
    while not ancestor.exists():
        missing.append(ancestor)
        ancestor = ancestor.parent
    for created in reversed(missing):
        try:
            created.mkdir(mode=0o700)
        except FileExistsError:
            if not created.is_dir() or created.is_symlink():
                raise ValueError("An original directory changed during creation.")
    if path.resolve() != path or path.is_symlink() or not path.is_dir():
        raise ValueError("Select the original ordinary private directory: " + str(path))
    if path.stat().st_mode & 0o077:
        raise ValueError("Use a private directory with mode0700: " + str(path))
    return path


def read_regular(path, maximum=64 * 1024 * 1024):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > maximum:
            raise ValueError("Select the complete original regular file: " + str(path))
        body = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        if len(body) != after.st_size or len(body) > maximum or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
            raise ValueError("The original file changed during reading: " + str(path))
    return body


def retain(path, body):
    private(path.parent)
    if os.path.lexists(path):
        if read_regular(path) != body:
            raise ValueError("Continue the retained original bytes: " + str(path))
        return
    fd, temporary = tempfile.mkstemp(prefix=".original-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            if read_regular(path) != body:
                raise ValueError("Concurrent original source differs: " + str(path))
        descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        Path(temporary).unlink(missing_ok=True)



def selected_source(root, supplied):
    fields = ("directory", "installationId", "profileId", "profileSha256",
              "lockSha256", "sourceCommit", "sourceManifestSha256", "sourceRoot")
    if not isinstance(supplied, dict) or supplied.get("state") != "READY":
        raise ValueError("Use the original READY product entrypoint.")
    binding = {key: supplied[key] for key in fields}
    runtime = Path(binding["directory"])
    source_root = Path(binding["sourceRoot"])
    if runtime.resolve(strict=True) != runtime or source_root != runtime / "package/source":
        raise ValueError("Use the exact original installed source directory.")
    if source_root.resolve(strict=True) != source_root:
        raise ValueError("The installed source directory changed.")
    manifest_path = runtime / "package/manifest.json"
    manifest_body = read_regular(manifest_path)
    if digest(manifest_body) != binding["sourceManifestSha256"]:
        raise ValueError("The original installed source manifest changed.")
    manifest = json.loads(manifest_body)
    if manifest.get("schema") != "stellar-forge.merchant-distribution-manifest.v1" or manifest.get("sourceCommit") != binding["sourceCommit"]:
        raise ValueError("The installed source identity differs from its READY runtime.")
    if manifest.get("sourceSelection", {}).get("id") != "worldbank":
        raise ValueError("Use the World Bank source-selected distribution.")
    seen = set()
    total = 0
    for item in manifest["files"]:
        relative = item["path"]
        path = PurePosixPath(relative)
        if (not relative or path.is_absolute() or str(path) != relative or
                "\\" in relative or any(part in ("", ".", "..") for part in relative.split("/")) or
                relative in seen or item["packagePath"] != "source/" + relative or
                item["mode"] not in ("100644", "100755")):
            raise ValueError("The original source inventory contains an invalid member.")
        seen.add(relative)
        selected = source_root / relative
        if selected.resolve(strict=True) != selected:
            raise ValueError("The selected original source must remain ordinary: " + relative)
        body = read_regular(selected)
        if len(body) != item["bytes"] or digest(body) != item["sha256"] or git_blob(body) != item["gitBlob"]:
            raise ValueError("The selected original source differs: " + relative)
        if stat.S_IMODE(selected.stat().st_mode) != int(item["mode"][-3:], 8):
            raise ValueError("The selected original source mode differs: " + relative)
        total += len(body)
    needed = [
        "products/worldbank/cli.mjs", "products/worldbank/receiving.py",
        "stellar-forge/mcp-merchant-operator/examples/worldbank-managed-receiving.mjs",
        "stellar-forge/mcp-merchant-operator/examples/worldbank-reference-capture.json",
        "stellar/scf-starforge-20261009/sf30-seller-sdk/worldbank/core.py",
        "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/stellar_forge_buyer/worldbank_analysis.py",
        "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/stellar_forge_buyer/worldbank_recurring.py",
        "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/stellar_forge_buyer/worldbank_recurring_receive.py",
    ]
    if any(path not in seen for path in needed):
        raise ValueError("The selected package lacks the complete World Bank product closure.")
    package = source_root / "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python"
    if digest(read_regular(package / "stellar_forge_buyer/worldbank_analysis.py")) != MODULE_SHA256:
        raise ValueError("Use the original reviewed World Bank Analysis engine.")
    binding.update(schema="stellar-forge.worldbank-product-receiving-intent.v1",
                   operation=OPERATION, selected_product="worldbank")
    retain(root / "receiving-intent.json",
           (json.dumps(binding, sort_keys=True, separators=(",", ":")) + "\n").encode())
    emit({"phase": "INSTALLED_SOURCE_READY", "source_commit": binding["sourceCommit"],
          "source_manifest_sha256": binding["sourceManifestSha256"],
          "files": len(seen), "bytes": total, "selection": "worldbank"})
    return binding, source_root, package


def stop(signum, frame):
    global _stop_signal
    _stop_signal = signum
    if _active_child is not None and _active_child.poll() is None:
        emit({"phase": "STOP_REQUESTED", "signal": signum,
              "message": "The original managed operation is closing at its normal completion boundary."})
        return
    raise InterruptedError("Continue the same original product operation after the interruption.")


def managed_application(root, supplied, binding, source_root, lease):
    global _active_child
    directory = private(root / "managed")
    entry = source_root / "stellar-forge/mcp-merchant-operator/examples/worldbank-managed-receiving.mjs"
    # The original Node child inherits the lease. A terminated Python receiver
    # cannot permit another writer while this original child still owns models.
    log_fd = os.open(directory / "process.log",
        os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    with os.fdopen(log_fd, "ab", buffering=0) as log:
        if not stat.S_ISREG(os.fstat(log.fileno()).st_mode):
            raise ValueError("The managed process log must remain an ordinary private file.")
        emit({"phase": "MANAGED_APPLICATION_RUNNING", "log": str(directory / "process.log")})
        _active_child = subprocess.Popen([
            supplied["node"], str(entry), "--runtime", binding["directory"],
            "--workdir", str(directory), "--python", sys.executable,
        ], pass_fds=(lease,), start_new_session=True, stdout=log, stderr=subprocess.STDOUT)
        try:
            result = _active_child.wait()
        finally:
            # Its original driver closes Applications and customer hosts in
            # finally. Let that boundary settle before releasing the lease.
            # A separate session protects it from terminal group interruption;
            # the retained log also survives a lost parent's output transport.
            if _active_child.poll() is None:
                _active_child.wait()
            _active_child = None
    if _stop_signal is not None:
        raise InterruptedError("The original native child has closed; resume this same workspace.")
    if result:
        error = RuntimeError("The original managed application returned exit " + str(result) + ". Continue its retained directory.")
        error.exit_code = result
        raise error
    received = json.loads(read_regular(directory / "managed-journey.json"))
    if received.get("status") != "COMPLETE":
        raise ValueError("The original managed receiving is not complete.")
    for name in ("installationId", "sourceCommit", "sourceManifestSha256"):
        if received.get(name) != binding[name]:
            raise ValueError("The managed receiving differs from the selected installation: " + name)
    handover = read_regular(directory / "customer-download/handover.zip")
    retain(root / "WorldBank_Managed_Customer_Handover_20261012.zip", handover)
    emit({"phase": "MANAGED_CUSTOMER_HANDOVER", "bytes": len(handover),
          "sha256": digest(handover), "source_commit": binding["sourceCommit"]})
    return received, handover



def reopen_complete(root, binding, package):
    target = root / "product-receiving.json"
    if not target.exists():
        return None
    record = json.loads(read_regular(target))
    if record.get("status") != "COMPLETE" or record.get("installation") != binding:
        raise ValueError("The completed product receiving belongs to another installation.")
    from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace
    from stellar_forge_buyer.workspace_archive_receive import restore_archive
    from stellar_forge_buyer.analysis_workbooks import WorkbookDelivery
    result = json.loads(read_regular(root / "producer-result.json"))
    delivery = root / "producer/worldbank-analysis" / PRODUCER_ID / "delivery"
    files = {item["filename"]: item for item in result["files"]}
    for item in result["files"]:
        body = read_regular(delivery / item["filename"], maximum=1024**3)
        if len(body) != item["bytes"] or digest(body) != item["sha256"]:
            raise ValueError("The original customer delivery differs: " + item["filename"])
    handover = read_regular(root / "WorldBank_Managed_Customer_Handover_20261012.zip")
    if {"bytes": len(handover), "sha256": digest(handover)} != record["handover"]:
        raise ValueError("The completed economic handover changed.")
    archive = delivery / "WorldBank_Analysis_Workspace.zip"
    received = restore_archive(archive, root / "customer",
        operation="431e21b8c6e44f65a3d6c279f5b8e012",
        expected_sha256=files[archive.name]["sha256"])
    if received.get("reused") is not True:
        raise ValueError("Continue the original completed customer receiving.")
    workspace = AnalysisWorkspace(root / "customer")
    try:
        if workspace.identity != result["workspace"]["workspace_id"]:
            raise ValueError("The reopened customer workspace identity changed.")
        publication = workspace.workbooks.source(
            {"kind": "report", "id": result["report"]["id"], "section": 0})
        if publication["sha256"] != result["report"]["sha256"]:
            raise ValueError("The original report publication changed.")
    finally:
        workspace.close()
    workbook = WorkbookDelivery(root / "customer-workbook",
        expected_manifest_sha256=result["workbook"]["manifest_sha256"])
    workbook.verify_archive(delivery / "WorldBank_Workbook_Handover.zip")
    with workbook.open("workbook.xlsx") as stream:
        workbook_body = stream.read()
    if digest(workbook_body) != files["WorldBank_Analysis.xlsx"]["sha256"]:
        raise ValueError("The original received workbook changed.")
    emit({"phase": "COMPLETE", "operation": OPERATION, "reused": True,
          "result": str(target), "customer_workspace": str(root / "customer"),
          "customer_edits_preserved": True})
    return record


def main():
    global SOURCE_REF
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--python-dependencies")
    args = parser.parse_args()
    if sys.version_info < (3, 11):
        raise ValueError("Python 3.11 or later is required.")
    supplied = json.loads(os.environ.get("STARFORGE_WORLDBANK_PRODUCT_RUNTIME", "{}"))
    root = private(Path(args.workspace))
    lease = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(lease)
        emit({"phase": "OPERATION_BUSY", "workspace": str(root)})
        return 75
    previous = {kind: signal.getsignal(kind) for kind in (signal.SIGINT, signal.SIGTERM)}
    for kind in previous:
        signal.signal(kind, stop)
    try:
        temporary = private(root / "tmp")
        os.environ["TMPDIR"] = str(temporary)
        os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
        sys.dont_write_bytecode = True
        sys.pycache_prefix = str(temporary / "python-cache")
        binding, source_root, package = selected_source(root, supplied)
        SOURCE_REF = binding["sourceCommit"]
        if args.python_dependencies:
            dependencies = Path(args.python_dependencies).expanduser().resolve(strict=True)
            if not dependencies.is_dir():
                raise ValueError("Use the existing original Python dependency directory.")
            sys.path.insert(0, str(dependencies))
        sys.path.insert(0, str(package))
        import openpyxl
        if openpyxl.__version__ != "3.1.5":
            raise ValueError("Install the original workbooks extra: openpyxl==3.1.5.")
        if reopen_complete(root, binding, package) is not None:
            return 0
        managed, body = managed_application(root, supplied, binding, source_root, lease)
        from stellar_forge_buyer.worldbank_analysis import WorldBankAnalysis, encoded, write
        handover = root / "WorldBank_Managed_Customer_Handover_20261012.zip"
        operation = WorldBankAnalysis(root / "producer", operation_id=PRODUCER_ID, progress=emit)
        result = operation.prepare(handover,
            source_root / "stellar/scf-starforge-20261009/sf30-seller-sdk/worldbank/core.py",
            resume=True)
        write(root / "producer-result.json", encoded(result), exact=True)
        emit({"phase": "PRODUCER_COMPLETE", "operation_id": result["operation_id"],
              "source_rows": result["source"]["observations"],
              "workbook_rows": result["workbook"]["rows"]})
        receive_customer(root, package)
        customer = json.loads(read_regular(root / "customer-result.json"))
        complete = {
            "schema": "stellar-forge.worldbank-product-receiving.v1",
            "operation": OPERATION, "status": "COMPLETE",
            "installation": binding,
            "managed_application": {"directory": str(root / "managed"),
                "journey": str(root / "managed/managed-journey.json")},
            "handover": {"bytes": len(body), "sha256": digest(body)},
            "analysis": {"producer_operation": PRODUCER_ID,
                "source_observations": result["source"]["observations"],
                "workbook_rows": result["workbook"]["rows"],
                "delivery": str(root / "producer/worldbank-analysis" / PRODUCER_ID / "delivery")},
            "customer": customer,
        }
        retain(root / "product-receiving.json", encoded(complete))
        emit({"phase": "COMPLETE", "operation": OPERATION,
              "result": str(root / "product-receiving.json"),
              "source_observations": result["source"]["observations"],
              "workbook_rows": result["workbook"]["rows"],
              "customer_workspace": str(root / "customer")})
        return 0
    except BaseException as error:
        record = {"operation": OPERATION, "at": datetime.now(timezone.utc).isoformat(),
                  "error_type": type(error).__name__, "error": str(error),
                  "traceback": traceback.format_exc()}
        try:
            fd = os.open(root / "native-errors.jsonl",
                         os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "a", encoding="utf-8") as stream:
                stream.write(json.dumps(record, ensure_ascii=False) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
        except OSError:
            pass
        emit({"phase": "OPERATION_PAUSED", **record})
        return getattr(error, "exit_code", 130 if _stop_signal == signal.SIGINT else 143 if _stop_signal == signal.SIGTERM else 1)
    finally:
        for kind, handler in previous.items():
            signal.signal(kind, handler)
        os.close(lease)


def receive_customer(ROOT, PACKAGE):
    import hashlib,io,json,os,pathlib,sys,threading,time,urllib.parse,urllib.request,zipfile
    sys.path.insert(0,str(PACKAGE))
    from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace,serve
    from stellar_forge_buyer.worldbank_analysis import typed_rows,write,encoded,regular,sha
    from stellar_forge_buyer.workspace_archive_receive import restore_archive
    from stellar_forge_buyer.errors import StateError
    from stellar_forge_buyer.analysis_workbooks import WorkbookDelivery
    
    OP=OPERATION
    PRODUCER='13c281c36fca40fe8377af367911bb4d'
    RECEIVER='431e21b8c6e44f65a3d6c279f5b8e012'
    def emit(value):print(json.dumps(value,ensure_ascii=False),flush=True)
    def require(test,message):
     if not test:raise RuntimeError(message)
    result=json.loads((ROOT/'producer-result.json').read_text())
    delivery=ROOT/'producer/worldbank-analysis'/PRODUCER/'delivery'
    files={item['filename']:item for item in result['files']}
    for item in result['files']:
     body=regular(delivery/item['filename'],1024**3)
     require(len(body)==item['bytes'] and sha(body)==item['sha256'],'Retain the exact original delivery: '+item['filename'])
    archive=delivery/'WorldBank_Analysis_Workspace.zip'
    archive_sha=files[archive.name]['sha256']
    customer=ROOT/'customer'
    received=restore_archive(archive,customer,operation=RECEIVER,expected_sha256=archive_sha)
    write(ROOT/'customer-receiving.json',encoded(received))
    emit({'phase':'CUSTOMER_RECEIVED','result':received})
    
    with zipfile.ZipFile(ROOT/'WorldBank_Managed_Customer_Handover_20261012.zip') as original:
     columns,rows=typed_rows(original.read('dataset.csv'),json.loads(original.read('dataset.json')))
    expected=[]
    for row in rows:
     value=dict(row)
     if 'aggregate' in value:value['aggregate']='true' if value['aggregate'] else 'false'
     expected.append(value)
    def canonical_rows(items):
     return sorted(json.dumps(row,sort_keys=True,separators=(',',':'),ensure_ascii=False) for row in items)
    query_name='customer_canada_gdp'
    query_fields={'sql':'SELECT country_iso3,period,value FROM "'+result['view']['name']+'" WHERE country_iso3=? AND indicator_id=? ORDER BY period','parameters_text':json.dumps(['CAN','NY.GDP.MKTP.CD'],separators=(',',':')),'max_rows':1000}
    workspace=AnalysisWorkspace(customer)
    try:
     require(workspace.identity==result['workspace']['workspace_id'],'The customer workspace identity differs')
     state=workspace.state()
     original_query=workspace.saved_query(result['view']['name']+'_observations')
     request={key:original_query[key] for key in ('sql','parameters_text','max_rows')}
     query_id=hashlib.sha256((OP+'-customer-observations').encode()).hexdigest()[:32]
     request.update(id=query_id,expected_views=workspace.database.view_bindings())
     current=workspace.start('query',request)
     started=time.monotonic()
     while current['status']=='RUNNING':
      require(time.monotonic()-started<120,'The original customer query is still running')
      time.sleep(.05);current=workspace.job(query_id,limit=250)
     require(current['status']=='COMPLETE','The original customer query failed: '+json.dumps(current))
     exported,_,_=workspace.export_result(query_id,'json')
     queried=json.loads(exported)
     require(not queried['truncated'],'The customer query was truncated')
     actual=[dict(zip(queried['columns'],row)) for row in queried['rows']]
     require(canonical_rows(actual)==canonical_rows(expected),'The received source values differ from the original reviewed handover')
     require(len(actual)==42,'The original source row count differs')
     sample=next(row for row in actual if row['country_iso3']=='CAN' and row['indicator_id']=='NY.GDP.MKTP.CD' and row['period']=='2024')
     require(type(sample['value']) is str and sample['value']=='2270076189683.46','The original GDP token changed')
     try:
      saved=workspace.saved_query(query_name)
      require(all(saved[key]==value for key,value in query_fields.items()),'The existing customer query contains another edit')
     except StateError as error:
      if (getattr(error,'code',None) or str(error))!='ANALYSIS_QUERY_NOT_FOUND':raise
      saved=workspace.save_query(query_name,query_fields,expected_revision=0)
     source=workspace.workbooks.source({'kind':'report','id':result['report']['id'],'section':0})
     require(source['sha256']==result['report']['sha256'],'The customer report publication differs')
     before_query={key:saved[key] for key in ('name','revision','sql','parameters_text','max_rows','saved_at')}
     source_summary={'original_rows':len(rows),'received_rows':len(actual),'exact_source_rows':True,'sample':{'country_iso3':'CAN','period':'2024','indicator_id':'NY.GDP.MKTP.CD','value':sample['value']},'original_query_id':query_id,'query_result_sha256':queried['result_sha256'],'report_publication_id':result['report']['id'],'report_publication_sha256':source['sha256']}
     write(ROOT/'customer-original-observations.json',exported)
     write(ROOT/'customer-query-before-receive.json',encoded(before_query),exact=True)
     emit({'phase':'CUSTOMER_SOURCE_REOPENED',**source_summary})
    finally:workspace.close()
    repeated=restore_archive(archive,customer,operation=RECEIVER,expected_sha256=archive_sha)
    require(repeated.get('reused') is True,'The original completed receiving was not reused')
    workspace=AnalysisWorkspace(customer)
    try:
     saved=workspace.saved_query(query_name)
     after_query={key:saved[key] for key in before_query}
     require(after_query==before_query,'Completed receiving changed the customer saved query')
     final_state=workspace.state()
     require(len(final_state['queries'])>=5,'The customer did not retain original and new saved queries')
     server,control,url=serve(workspace)
     thread=threading.Thread(target=server.serve_forever,kwargs={'poll_interval':.05},daemon=True);thread.start()
     try:
      origin,token=url.split('#',1)
      with urllib.request.urlopen(origin,timeout=15) as response:html=response.read();html_status=response.status
      state_request=urllib.request.Request(origin+'api/state',headers={'X-Analysis-Capability':token})
      with urllib.request.urlopen(state_request,timeout=15) as response:http_state=json.load(response)
      require(http_state['workspace_id']==workspace.identity,'The native browser application opened another workspace')
      require(any(row['name']==query_name for row in http_state['queries']),'The browser application missed the retained customer query')
      http_summary={'html_status':html_status,'html_bytes':len(html),'workspace_id':http_state['workspace_id'],'saved_queries':len(http_state['queries']),'same_invocation':True}
     finally:
      server.shutdown();thread.join();server.server_close();control.unlink(missing_ok=True)
    finally:workspace.close()
    
    workbook_archive=delivery/'WorldBank_Workbook_Handover.zip'
    workbook_target=ROOT/'customer-workbook'
    if workbook_target.exists():
     workbook=WorkbookDelivery(workbook_target,expected_manifest_sha256=result['workbook']['manifest_sha256'])
    else:
     workbook=WorkbookDelivery.receive(workbook_archive,workbook_target,expected_sha256=files[workbook_archive.name]['sha256'])
    inspected=workbook.inspect()
    require(inspected['manifest_sha256']==result['workbook']['manifest_sha256'],'The received workbook manifest differs')
    import openpyxl
    workbook.verify_archive(workbook_archive)
    with workbook.open('workbook.xlsx') as stream:received_workbook_bytes=stream.read()
    require(sha(received_workbook_bytes)==files['WorldBank_Analysis.xlsx']['sha256'],'The received Excel file differs from its original delivery')
    book=openpyxl.load_workbook(io.BytesIO(received_workbook_bytes),data_only=False)
    workbook_rows={}
    metadata_sheets={}
    data_sheets={'Observations','Coverage','Annual change','GDP per person'}
    sample_cell=None
    numeric_counts={}
    for sheet in book.worksheets:
     matrix=list(sheet.iter_rows())
     if sheet.title not in data_sheets:
      metadata_sheets[sheet.title]=len(matrix)
      continue
     require(matrix,'An original workbook sheet is empty')
     headers=[cell.value for cell in matrix[0]]
     data=matrix[1:]
     workbook_rows[sheet.title]=len(data)
     if sheet.title=='Observations':
      positions={name:headers.index(name) for name in ('country_iso3','indicator_id','period','value')}
      require(len(data)==42,'The observations workbook changed its source row count')
      for cells in data:
       if cells[positions['country_iso3']].value=='CAN' and cells[positions['indicator_id']].value=='NY.GDP.MKTP.CD' and cells[positions['period']].value=='2024':
        sample_cell=cells[positions['value']]
      require(sample_cell is not None and sample_cell.value=='2270076189683.46' and sample_cell.data_type=='s','The source GDP token is not preserved as a text cell')
     if sheet.title in ('Annual change','GDP per person'):
      field='annual_change_percent' if sheet.title=='Annual change' else 'gdp_usd_per_person'
      position=headers.index(field)
      values=[cells[position] for cells in data if cells[position].value is not None]
      require(all(cell.data_type=='n' and type(cell.value) in (int,float) for cell in values),'The derived workbook cells are not numeric')
      numeric_counts[sheet.title]=len(values)
    book.close()
    require({'Readme','Sources'}<=set(metadata_sheets),'The original workbook guidance and source mappings are missing')
    require(workbook_rows=={'Observations':42,'Coverage':6,'Annual change':42,'GDP per person':21},'The original report/workbook section populations differ')
    require(sum(workbook_rows.values())==result['workbook']['rows']==111,'The complete workbook row count differs')
    record={'schema':'stellar-forge.worldbank-analysis-receiving.v1','operation':OP,'source_ref':SOURCE_REF,'producer_operation':PRODUCER,'receiving_operation':RECEIVER,'status':'COMPLETE','source':source_summary,'workspace':{'id':result['workspace']['workspace_id'],'directory':str(customer),'archive_sha256':archive_sha,'completed_receive_reused':True,'customer_query_preserved':before_query},'native_application':http_summary,'workbook':{'manifest_sha256':inspected['manifest_sha256'],'directory':str(workbook_target),'sheets':workbook_rows,'metadata_sheets':metadata_sheets,'rows':111,'derived_numeric_cells':numeric_counts,'source_value_type':'text','source_value':'2270076189683.46','openpyxl_version':openpyxl.__version__},'delivery_files':result['files']}
    write(ROOT/'customer-result.json',encoded(record),exact=True)
    emit({'phase':'CUSTOMER_COMPLETE','result':record})
    


if __name__ == '__main__':
    raise SystemExit(main())
