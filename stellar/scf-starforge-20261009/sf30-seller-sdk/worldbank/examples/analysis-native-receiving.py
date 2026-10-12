"""Finish the original World Bank Analysis operation and its customer receiving.

Run with Python 3.11+ and openpyxl==3.1.5:
  python3 analysis-native-receiving.py --workspace /absolute/private/worldbank-analysis \
    --handover /absolute/WorldBank_Managed_Customer_Handover_20261012.zip

The complete source is selected from the original immutable public repository.
Every existing source body must match its retained Git blob. Original source
review, SQL, report, workbook and archive actions use their maintained engines.
Repeat the same command and directory to continue the same original operation.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tarfile
import tempfile
import traceback
import urllib.request

OPERATION = "SCF-WORLDBANK-ANALYSIS-WORKBOOK-FE85-20261012"
SOURCE_REF = "ad176c013d239cbb307e7d3a168fe9029e0570eb"
MODULE_SHA256 = "923fa1b5ad8476cc9294e78d33d8a891b0ea5a13ec79f61dc350c8e438c9721f"
HANDOVER_SHA256 = "c99f7386ae02742eb0d5c91b1c051eab753fc210d2cd689eb21127109de391fb"
PRODUCER_ID = "13c281c36fca40fe8377af367911bb4d"


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


def original_source(root):
    prefixes = [
        "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/",
        "stellar/scf-starforge-20261009/sf30-seller-sdk/worldbank/",
    ]
    selection_path = root / "source-selection.json"
    if selection_path.exists():
        selected = json.loads(read_regular(selection_path))
        if selected.get("ref") != SOURCE_REF or not selected.get("files"):
            raise ValueError("Continue the original selected source edition.")
        for entry in selected["files"]:
            path = Path(entry["path"])
            if path.is_absolute() or ".." in path.parts or not any(entry["path"].startswith(prefix) for prefix in prefixes):
                raise ValueError("The retained source selection changed.")
            body = read_regular(root / "checkout" / path)
            if len(body) != entry["bytes"] or git_blob(body) != entry["git_blob"]:
                raise ValueError("The selected source body changed: " + str(path))
        emit({"phase": "SOURCE_REUSED", "ref": SOURCE_REF, "files": len(selected["files"])})
    else:
        selected = {"ref": SOURCE_REF, "files": []}
        prefix = "public-commons-sprint-2026-" + SOURCE_REF + "/"
        url = "https://codeload.github.com/woahwhattheheck/public-commons-sprint-2026/tar.gz/" + SOURCE_REF
        emit({"phase": "SOURCE_RECEIVING", "ref": SOURCE_REF})
        with urllib.request.urlopen(url, timeout=60) as response, tarfile.open(fileobj=response, mode="r|gz") as archive:
            for member in archive:
                if not member.isfile() or not member.name.startswith(prefix):
                    continue
                relative = member.name[len(prefix):]
                if not any(relative.startswith(start) for start in prefixes):
                    continue
                path = Path(relative)
                if path.is_absolute() or ".." in path.parts or member.size > 64 * 1024 * 1024:
                    raise ValueError("An original source archive member is invalid.")
                with archive.extractfile(member) as stream:
                    body = stream.read()
                if len(body) != member.size:
                    raise ValueError("The original source member is incomplete.")
                retain(root / "checkout" / path, body)
                selected["files"].append({"path": relative, "bytes": len(body), "git_blob": git_blob(body)})
        retain(selection_path, (json.dumps(selected, sort_keys=True) + "\n").encode())
    base = root / "checkout/stellar/scf-starforge-20261009"
    package = base / "sf88-operator-buyer-cli/python"
    module = package / "stellar_forge_buyer/worldbank_analysis.py"
    if digest(read_regular(module)) != MODULE_SHA256:
        raise ValueError("The original World Bank Analysis module changed.")
    emit({"phase": "SOURCE_READY", "ref": SOURCE_REF, "files": len(selected["files"]),
          "bytes": sum(row["bytes"] for row in selected["files"]),
          "module_sha256": MODULE_SHA256})
    return base, package


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, help="Retained private operation directory")
    parser.add_argument("--handover", required=True, help="Original 14,330-byte managed customer handover")
    parser.add_argument("--python-dependencies", help="Existing private Python dependency directory")
    args = parser.parse_args()
    root = private(Path(args.workspace))
    lease = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
    try:
        temporary = private(root / "tmp")
        os.environ["TMPDIR"] = str(temporary)
        os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
        sys.dont_write_bytecode = True
        body = read_regular(Path(args.handover).expanduser().absolute())
        if len(body) != 14330 or digest(body) != HANDOVER_SHA256:
            raise ValueError("Select the exact original managed customer handover.")
        handover = root / "WorldBank_Managed_Customer_Handover_20261012.zip"
        retain(handover, body)
        emit({"phase": "ORIGINAL_HANDOVER", "operation": OPERATION,
              "bytes": len(body), "sha256": HANDOVER_SHA256})
        base, package = original_source(root)
        if args.python_dependencies:
            dependencies = Path(args.python_dependencies).expanduser().resolve(strict=True)
            sys.path.insert(0, str(dependencies))
        sys.path.insert(0, str(package))
        import openpyxl
        if openpyxl.__version__ != "3.1.5":
            raise ValueError("Use the original openpyxl==3.1.5 workbook dependency.")
        from stellar_forge_buyer.worldbank_analysis import WorldBankAnalysis, encoded, write
        operation = WorldBankAnalysis(root / "producer", operation_id=PRODUCER_ID, progress=emit)
        result = operation.prepare(handover, base / "sf30-seller-sdk/worldbank/core.py", resume=True)
        write(root / "producer-result.json", encoded(result), exact=True)
        emit({"phase": "PRODUCER_COMPLETE", "operation_id": result["operation_id"],
              "source_rows": result["source"]["observations"],
              "workbook_rows": result["workbook"]["rows"]})
        receive_customer(root, package)
        emit({"phase": "COMPLETE", "operation": OPERATION, "workspace": str(root),
              "delivery": str(root / "producer/worldbank-analysis" / PRODUCER_ID / "delivery"),
              "customer_result": str(root / "customer-result.json")})
        return 0
    except BaseException as error:
        record = {"operation": OPERATION, "at": datetime.now(timezone.utc).isoformat(),
                  "error_type": type(error).__name__, "error": str(error),
                  "traceback": traceback.format_exc()}
        try:
            path = root / "native-errors.jsonl"
            fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "a", encoding="utf-8") as stream:
                stream.write(json.dumps(record, ensure_ascii=False) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
        except OSError:
            pass
        emit({"phase": "ORIGINAL_OPERATION_ERROR", **record})
        return 1
    finally:
        os.close(lease)


def receive_customer(ROOT, PACKAGE):
    import hashlib,io,json,os,pathlib,sys,threading,time,urllib.parse,urllib.request,zipfile
    sys.path.insert(0,str(PACKAGE))
    from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace,serve
    from stellar_forge_buyer.worldbank_analysis import typed_rows,write,encoded,regular,sha
    from stellar_forge_buyer.workspace_archive_receive import restore_archive
    from stellar_forge_buyer.errors import StateError
    from stellar_forge_buyer.analysis_workbooks import WorkbookDelivery
    
    OP='SCF-WORLDBANK-ANALYSIS-WORKBOOK-FE85-20261012'
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
    record={'schema':'stellar-forge.worldbank-analysis-receiving.v1','operation':OP,'source_ref':'ad176c013d239cbb307e7d3a168fe9029e0570eb','producer_operation':PRODUCER,'receiving_operation':RECEIVER,'status':'COMPLETE','source':source_summary,'workspace':{'id':result['workspace']['workspace_id'],'directory':str(customer),'archive_sha256':archive_sha,'completed_receive_reused':True,'customer_query_preserved':before_query},'native_application':http_summary,'workbook':{'manifest_sha256':inspected['manifest_sha256'],'directory':str(workbook_target),'sheets':workbook_rows,'metadata_sheets':metadata_sheets,'rows':111,'derived_numeric_cells':numeric_counts,'source_value_type':'text','source_value':'2270076189683.46','openpyxl_version':openpyxl.__version__},'delivery_files':result['files']}
    write(ROOT/'customer-result.json',encoded(record),exact=True)
    emit({'phase':'CUSTOMER_COMPLETE','result':record})
    

if __name__ == '__main__':
    raise SystemExit(main())
