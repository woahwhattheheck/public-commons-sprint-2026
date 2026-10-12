#!/usr/bin/env python3
"""Run one official Directus 12.5 instance and the complete SF30 customer/browser.

All runtime, source, browser and output paths are explicit. The caller supplies
its existing installed SF30 dependency closure and owns native job admission.
Private credentials and SQLite state remain in the selected project directory.
"""
from __future__ import annotations
import argparse,fcntl,hashlib,json,os,pathlib,re,shutil,socket,subprocess,sys,time,traceback,urllib.error,urllib.parse,urllib.request,uuid

VERSION="12.5.0"
API_VERSION="40.0.0"
SCHEMA="stellar-forge.directus-equipped-native.v1"
PREFIX="stellar/scf-starforge-20261009"
def encoded(value):
    return (json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+"\n").encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def write(path,value,*,exact=False):
    path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    data=value if isinstance(value,bytes) else encoded(value)
    if exact and path.exists():
        if path.read_bytes()!=data:raise RuntimeError("Retained original file differs: "+str(path))
        return
    temp=path.with_name(path.name+".pending-"+uuid.uuid4().hex)
    with temp.open("xb") as out:
        os.chmod(temp,0o600);out.write(data);out.flush();os.fsync(out.fileno())
    if exact:
        try:os.link(temp,path)
        except FileExistsError:
            if path.read_bytes()!=data:raise RuntimeError("Concurrent original file differs: "+str(path))
        finally:temp.unlink(missing_ok=True)
    else:os.replace(temp,path)
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--project",required=True)
    parser.add_argument("--sources",required=True)
    parser.add_argument("--operation-id",required=True)
    parser.add_argument("--runtime-root",required=True,help="Owned runtime staging directory; retain it for the complete process tree")
    parser.add_argument("--sdk-source",required=True,help="Original installed stellar/scf-starforge-20261009 source")
    parser.add_argument("--node-modules",required=True,help="Existing installed SF30 node_modules directory")
    parser.add_argument("--node",required=True)
    parser.add_argument("--npm",required=True)
    parser.add_argument("--playwright",required=True,help="Existing Playwright module path")
    parser.add_argument("--chromium",required=True,help="Existing Chromium executable")
    args=parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{8,92}",args.operation_id):
        parser.error("--operation-id must be 8-92 letters, digits or ._:-")
    donor=pathlib.Path(args.sdk_source).resolve(strict=True)
    modules_root=pathlib.Path(args.node_modules).resolve(strict=True)
    node=str(pathlib.Path(args.node).resolve(strict=True))
    npm=str(pathlib.Path(args.npm).resolve(strict=True))
    playwright=str(pathlib.Path(args.playwright).resolve(strict=True))
    chromium=str(pathlib.Path(args.chromium).resolve(strict=True))
    os.umask(0o077)
    project=pathlib.Path(args.project).resolve(strict=True)
    source_packet=pathlib.Path(args.sources).resolve(strict=True)
    run_lock=(project/"native-run.lock").open("a+b")
    try:fcntl.flock(run_lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:
        run_lock.close()
        raise RuntimeError("This native project already has an active setup/customer owner")
    packet=json.loads(source_packet.read_bytes())
    if packet["schema"]!="stellar-forge.directus-native-source-packet.v1":raise ValueError("Original source packet required")
    runtime=pathlib.Path(args.runtime_root).resolve()
    runtime.mkdir(parents=True,exist_ok=True,mode=0o700)
    logs=project/"logs";logs.mkdir(exist_ok=True,mode=0o700)
    private=project/"private";private.mkdir(exist_ok=True,mode=0o700)
    receipts=project/"receipts";receipts.mkdir(exist_ok=True,mode=0o700)
    report_file=project/"NATIVE_RESULT.json"
    source_root=runtime/"source";provider=None;provider_log=None
    phases=[]
    started=time.time()
    def phase(name,**facts):
        row={"name":name,"observed_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),**facts}
        phases.append(row)
        write(project/"native-progress.json",{"schema":SCHEMA,"operationId":args.operation_id,"phases":phases})
        print(json.dumps(row),flush=True)
    def command(name,argv,*,cwd=None,env=None,timeout=900):
        logfile=logs/(name+".log")
        with logfile.open("ab") as log:
            child=subprocess.Popen(argv,cwd=str(cwd or project),env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT)
            try:code=child.wait(timeout=timeout)
            except BaseException:
                child.terminate()
                try:child.wait(timeout=15)
                except subprocess.TimeoutExpired:child.kill();child.wait()
                raise
        phase(name,exit_code=code,log=str(logfile),log_sha256=sha(logfile.read_bytes()))
        if code:raise RuntimeError(name+" exited "+str(code)+"; original log "+str(logfile))
        return logfile.read_bytes()
    try:
        write(project/"native-intent.json",{"schema":SCHEMA,"operationId":args.operation_id,
            "sourcePacketSha256":sha(source_packet.read_bytes()),"productCommit":packet["productCommit"],
            "version":VERSION,"apiVersion":API_VERSION,"sourceDonor":str(donor),"dependencyRoot":str(modules_root),"runtimeRoot":str(runtime),
            "node":node,"npm":npm,"playwright":playwright,"chromium":chromium},exact=True)
        if report_file.exists():
            result=json.loads(report_file.read_bytes())
            if result.get("status")=="PASS":
                for name in ("customer_result","customer_project","browser_result"):
                    original=pathlib.Path(result[name])
                    if sha(original.read_bytes())!=result[name+"_sha256"]:
                        raise RuntimeError("Completed native artifact changed: "+name)
                print(json.dumps({"status":"PASS","reused":True,"result":str(report_file)}),flush=True);return 0
        if not donor.is_dir() or not modules_root.is_dir():raise RuntimeError("Original installed e287 source and dependencies must be present")
        foundation=source_root/PREFIX
        if not foundation.exists():
            foundation.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            staged_foundation=foundation.with_name(foundation.name+".pending-"+uuid.uuid4().hex)
            try:
                shutil.copytree(donor,staged_foundation,symlinks=False)
                os.rename(staged_foundation,foundation)
            finally:
                if staged_foundation.exists():shutil.rmtree(staged_foundation)
        modules=source_root/"node_modules"
        if not modules.exists():modules.symlink_to(modules_root,target_is_directory=True)
        elif modules.resolve()!=modules_root.resolve():raise RuntimeError("SDK dependency source differs")
        for row in packet["files"]:
            relative=pathlib.PurePosixPath(row["path"])
            if relative.is_absolute() or ".." in relative.parts:raise ValueError("Source member path differs")
            data=row["content"].encode("utf-8")
            if len(data)!=row["bytes"] or sha(data)!=row["sha256"] or hashlib.sha1(b"blob "+str(len(data)).encode()+b"\0"+data).hexdigest()!=row["gitBlob"]:
                raise RuntimeError("Original source member failed identity: "+row["path"])
            write(source_root/pathlib.Path(*relative.parts),data)
        files=[]
        for path in sorted(foundation.rglob("*")):
            if path.is_symlink():continue
            if path.is_file():
                data=path.read_bytes();files.append({"path":path.relative_to(source_root).as_posix(),"bytes":len(data),"sha256":sha(data)})
        execution={"schema":"stellar-forge.directus-executed-source.v1","productCommit":packet["productCommit"],
            "sourceDonor":str(donor),"files":files,"authored": [{k:v for k,v in r.items() if k!="content"} for r in packet["files"]]}
        write(receipts/"execution-source.json",execution,exact=True)
        phase("original-source-composed",files=len(files),source_manifest_sha256=sha(encoded(execution)))
        provider_home=runtime/"directus";provider_home.mkdir(exist_ok=True,mode=0o700)
        cache=runtime/"npm-cache";cache.mkdir(exist_ok=True,mode=0o700)
        environment=dict(os.environ)
        environment.update({"npm_config_cache":str(cache),"npm_config_audit":"false","npm_config_fund":"false",
            "npm_config_fetch_retries":"1","npm_config_fetch_timeout":"30000","npm_config_jobs":"2",
            "TMPDIR":str(runtime/"tmp"),"NODE_ENV":"production",
            "PATH":str(pathlib.Path(node).parent)+os.pathsep+os.environ.get("PATH","")})
        pathlib.Path(environment["TMPDIR"]).mkdir(exist_ok=True,mode=0o700)
        registry=subprocess.run([npm,"config","get","registry"],capture_output=True,text=True,env=environment,timeout=20)
        if registry.returncode:raise RuntimeError("The original npm registry configuration could not be read")
        registry_url=registry.stdout.strip()
        parsed=urllib.parse.urlsplit(registry_url)
        if parsed.scheme not in ("http","https") or parsed.username or parsed.password:raise RuntimeError("Use the configured public npm registry transport without credentials in the URL")
        phase("official-package-transport",registry_origin=parsed.scheme+"://"+parsed.netloc,node=subprocess.check_output([node,"--version"],text=True).strip())
        package=provider_home/"node_modules/directus/package.json"
        lock=provider_home/"package-lock.json"
        installed_marker=provider_home/"runtime-complete.json"
        if not installed_marker.is_file():
            command("install-directus-12.5.0",[npm,"install","--prefix",str(provider_home),"--save-exact","--omit=dev","--no-audit","--no-fund",
                "--fetch-retries=1","--fetch-timeout=30000","directus@"+VERSION],cwd=provider_home,env=environment,timeout=1800)
        installed=json.loads(package.read_bytes())
        api=json.loads((provider_home/"node_modules/@directus/api/package.json").read_bytes())
        if installed["version"]!=VERSION or api["version"]!=API_VERSION:raise RuntimeError("Installed Directus/API versions differ from the controlling originals")
        installation={"version":VERSION,"apiVersion":API_VERSION,
            "packageSha256":sha(package.read_bytes()),"apiPackageSha256":sha(encoded(api)),
            "lockSha256":sha(lock.read_bytes())}
        write(installed_marker,installation,exact=True)
        write(receipts/"directus-package.json",package.read_bytes(),exact=True)
        write(receipts/"directus-api-package.json",encoded(api),exact=True)
        write(receipts/"directus-package-lock.json",lock.read_bytes(),exact=True)
        phase("official-runtime-installed",directus=installed["version"],api=api["version"],lock_sha256=sha(lock.read_bytes()))
        connection_file=private/"connection.json"
        if connection_file.exists():connection=json.loads(connection_file.read_bytes())
        else:
            with socket.socket() as listener:
                listener.bind(("127.0.0.1",0));port=listener.getsockname()[1]
            connection={"baseUrl":"http://127.0.0.1:"+str(port)+"/","port":port,
                "adminEmail":"native-"+sha(args.operation_id.encode())[:12]+"@directus-customer.invalid","adminPassword":uuid.uuid4().hex+uuid.uuid4().hex,
                "token":uuid.uuid4().hex+uuid.uuid4().hex,"secret":uuid.uuid4().hex+uuid.uuid4().hex}
            write(connection_file,connection,exact=True)
        database=private/"directus.sqlite3"
        environment.update({"DB_CLIENT":"sqlite3","DB_FILENAME":str(database),
            "HOST":"127.0.0.1","PORT":str(connection["port"]),"PUBLIC_URL":connection["baseUrl"],
            "SECRET":connection["secret"],"ADMIN_EMAIL":connection["adminEmail"],
            "ADMIN_PASSWORD":connection["adminPassword"],"ADMIN_TOKEN":connection["token"],
            "STORAGE_LOCATIONS":"local","STORAGE_LOCAL_ROOT":str(private/"uploads"),
            "TELEMETRY":"false","SERVE_APP":"false","WEBSOCKETS_ENABLED":"false","EXTENSIONS_AUTO_RELOAD":"false",
            "LOG_LEVEL":"info","DIRECTUS_TOKEN":connection["token"]})
        (private/"uploads").mkdir(exist_ok=True,mode=0o700)
        cli=provider_home/"node_modules/directus/cli.js"
        if not cli.is_file():
            bins=installed["bin"];entry=bins if isinstance(bins,str) else bins["directus"];cli=package.parent/entry
        command("bootstrap-directus",[node,str(cli),"bootstrap"],cwd=provider_home,env=environment,timeout=180)
        provider_log=(logs/"directus-server.log").open("ab")
        provider=subprocess.Popen([node,str(cli),"start"],cwd=provider_home,env=environment,stdin=subprocess.DEVNULL,stdout=provider_log,stderr=subprocess.STDOUT)
        http_sequence=0
        def request(label,method,relative,body=None,allow=()):
            nonlocal http_sequence
            http_sequence+=1
            raw=None if body is None else (body if isinstance(body,bytes) else encoded(body))
            url=urllib.parse.urljoin(connection["baseUrl"],relative)
            if not url.startswith(connection["baseUrl"]):raise ValueError("Native setup request escaped its original loopback source")
            headers={"Authorization":"Bearer "+connection["token"],"Accept":"application/json"}
            if raw is not None:headers["Content-Type"]="application/json"
            req=urllib.request.Request(url,data=raw,method=method,headers=headers)
            folder=receipts/"setup-http";folder.mkdir(exist_ok=True,mode=0o700)
            record=folder/(f"{http_sequence:04d}-"+label+"-"+uuid.uuid4().hex[:8]+".json")
            initial={"method":method,"url":url,"request_bytes":0 if raw is None else len(raw),"request_sha256":sha(raw or b"")}
            write(record,{**initial,"phase":"invoking"})
            try:
                with urllib.request.urlopen(req,timeout=30) as response:status=response.status;data=response.read()
            except urllib.error.HTTPError as error:status=error.code;data=error.read()
            write(record,{**initial,"phase":"received","status":status,"body_bytes":len(data),"body_sha256":sha(data),"body_text":data.decode("utf-8")})
            if not 200<=status<300 and status not in allow:raise RuntimeError("Native "+label+" returned HTTP "+str(status)+": "+data.decode("utf-8")[:2000])
            return status,json.loads(data) if data else None
        deadline=time.monotonic()+150
        while True:
            if provider.poll() is not None:raise RuntimeError("Directus server exited before readiness; original log "+str(logs/"directus-server.log"))
            try:
                _,info=request("readiness","GET","server/info")
                if info["data"]["version"]!=VERSION:raise RuntimeError("Native server version differs")
                break
            except (urllib.error.URLError,ConnectionError,TimeoutError):
                if time.monotonic()>=deadline:raise
                time.sleep(1)
        phase("actual-directus-ready",base_url=connection["baseUrl"],version=info["data"]["version"])
        scope="sf30_"+sha(args.operation_id.encode())[:12]
        collection=scope+"_collection"
        owners=scope+"_owners"
        ready=private/"setup-complete.json"
        if not ready.exists():
            def ensure_collection(name,fields,versioning=False):
                status,current=request(name+"-lookup","GET","collections/"+name,allow=(403,404))
                if status==200:
                    if current["data"].get("collection")!=name:raise RuntimeError("Existing isolated collection identity differs")
                    return
                request(name+"-create","POST","collections",{"collection":name,"meta":{"icon":"table","versioning":versioning},
                    "schema":{},"fields":fields})
            def native_field(name,kind,**schema):
                return {"field":name,"type":kind,"schema":schema,"meta":{"interface":"input"}}
            key=native_field("id","integer",is_primary_key=True,is_nullable=False,has_auto_increment=False)
            ensure_collection(owners,[key,native_field("name","string",is_nullable=False)])
            ensure_collection(collection,[key,native_field("title","string",is_nullable=False),
                native_field("amount","decimal",numeric_precision=24,numeric_scale=6,is_nullable=False),
                native_field("large_numeric_text","string",is_nullable=False),native_field("note","text",is_nullable=True),
                native_field("not_selected","string",is_nullable=True),native_field("owner","integer",is_nullable=True)],True)
            status,relation=request("owner-relation-lookup","GET","relations/"+collection+"/owner",allow=(403,404))
            if status!=200:request("owner-relation-create","POST","relations",{"collection":collection,"field":"owner",
                "related_collection":owners,"schema":{"on_delete":"SET NULL"},"meta":{}})
            for item in [{"id":1,"name":"Receiving team"},{"id":2,"name":"Publishing team"}]:
                status,_=request("owner-"+str(item["id"])+"-lookup","GET","items/"+owners+"/"+str(item["id"]),allow=(403,404))
                if status!=200:request("owner-"+str(item["id"])+"-create","POST","items/"+owners,item)
            fixtures=[
                {"id":1,"title":"Original reviewed title","amount":"123456789012.345678","large_numeric_text":"900719925474099312345",
                 "note":None,"not_selected":"Field is intentionally omitted by the actual source query","owner":1},
                {"id":2,"title":"Second actual item","amount":"42.125000","large_numeric_text":"9007199254740993","note":"","not_selected":"omitted","owner":2},
                {"id":3,"title":"Third actual item","amount":"0.000001","large_numeric_text":"18446744073709551615","note":"Unicode café and quoted text","not_selected":"omitted","owner":1}]
            for item in fixtures:
                status,_=request("item-"+str(item["id"])+"-lookup","GET","items/"+collection+"/"+str(item["id"]),allow=(403,404))
                if status!=200:request("item-"+str(item["id"])+"-create","POST","items/"+collection,item)
            _,native_schema=request("configured-collection","GET","collections/"+collection)
            if native_schema["data"]["meta"].get("versioning") is not True:raise RuntimeError("Original collection versioning is not enabled")
            _,native_items=request("configured-items","GET","items/"+collection+"?fields=*&sort=id&limit=100&meta=filter_count")
            if len(native_items["data"])!=3:raise RuntimeError("The original isolated collection must contain exactly three configured native items")
            write(ready,{"schema":SCHEMA,"collection":collection,"owners":owners,"version":VERSION,
                "original_fixture_request":fixtures,"observed_items":native_items},exact=True)
        phase("native-collection-configured",collection=collection,rows=3,versioning=True)
        input_file=project/"customer-input.json"
        if not input_file.exists():
            public_key=subprocess.check_output([node,"--input-type=module","-e",
                "import {Keypair} from '@stellar/stellar-sdk';process.stdout.write(Keypair.random().publicKey());"],cwd=source_root,text=True).strip()
            customer_input={"operationId":args.operation_id,"baseUrl":connection["baseUrl"],"collection":collection,"item":"1",
                "patchJson":'{"title":"Native reviewed and promoted title","note":"Approved native version"}',
                "fields":["id","title","amount","large_numeric_text","note","not_selected","owner"],
                "query":{"fields":["id","title","amount","large_numeric_text","note","owner.*"],"sort":["id"]},
                "rights":{"attribution":"Token Junkie Labs owned Directus native receiving collection",
                    "basis":"Owned source records created for the complete native customer operation"},
                "payment":{"scheme":"exact","network":"stellar:testnet","asset":"native","amount":"1000","payTo":public_key,"maxTimeoutSeconds":60},
                "name":"Native Directus collection customer","actor":"Directus native customer","capturePageSize":2}
            write(input_file,customer_input,exact=True)
        customer_dir=project/"customer";customer_dir.mkdir(exist_ok=True,mode=0o700)
        directus=foundation/"sf30-seller-sdk/directus"
        command("complete-native-customer",[node,str(directus/"native-customer.mjs"),"--input",str(input_file),"--out",str(customer_dir)],
            cwd=source_root,env=environment,timeout=900)
        result_file=customer_dir/"CUSTOMER_RESULT.json";customer=json.loads(result_file.read_bytes())
        if customer.get("status")!="PASS":raise RuntimeError("The original native customer did not return PASS")
        phase("complete-native-customer-received",workspace_id=customer["workspace_id"],phases=len(customer["phases"]),project_sha256=customer["project_sha256"])
        browser=directus/"native-browser.mjs"
        if not browser.is_file():raise RuntimeError("The exact original browser receiving module is required for complete delivery")
        browser_input=project/"browser-input.json"
        write(browser_input,{"operationId":args.operation_id+"-browser","customerDirectory":str(customer_dir),
            "customerResult":str(result_file),"sourceDirectory":str(directus),"playwright":playwright,"chromium":chromium,
            "baseUrl":connection["baseUrl"],"collection":collection},exact=True)
        command("complete-native-browser",[node,str(browser),"--input",str(browser_input),"--out",str(project/"browser")],
            cwd=source_root,env=environment,timeout=900)
        browser_result_file=project/"browser"/"BROWSER_RESULT.json"
        browser_result=json.loads(browser_result_file.read_bytes())
        if browser_result.get("status")!="PASS":
            raise RuntimeError("The original browser customer did not return PASS")
        if provider is not None and provider.poll() is None:
            provider.terminate()
            try:provider.wait(timeout=20)
            except subprocess.TimeoutExpired:provider.kill();provider.wait()
        phase("native-server-closed",exit_code=provider.returncode)
        result={"schema":SCHEMA,"operationId":args.operation_id,"status":"PASS","finished_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
            "productCommit":packet["productCommit"],"source_manifest":str(receipts/"execution-source.json"),
            "source_manifest_sha256":sha(encoded(execution)),"directus_version":VERSION,"directus_api_version":API_VERSION,
            "customer_result":str(result_file),"customer_result_sha256":sha(result_file.read_bytes()),
            "customer_project":customer["project"],"customer_project_sha256":customer["project_sha256"],
            "browser_result":str(browser_result_file),"browser_result_sha256":sha(browser_result_file.read_bytes()),
            "private_database":str(database),"phases":phases,"elapsed_seconds":time.time()-started}
        write(project/"result-history"/("native-"+uuid.uuid4().hex+".json"),result,exact=True)
        write(report_file,result)
        print(json.dumps({"status":"PASS","result":str(report_file)}),flush=True)
        return 0
    except BaseException as exc:
        result={"schema":SCHEMA,"operationId":args.operation_id,"status":"FAILED","error":type(exc).__name__,"message":str(exc),
            "traceback":traceback.format_exc(),"phases":phases,"elapsed_seconds":time.time()-started}
        try:
            write(project/"result-history"/("native-"+uuid.uuid4().hex+".json"),result,exact=True)
            write(report_file,result)
        except OSError:pass
        print(json.dumps(result),file=sys.stderr,flush=True)
        return 1
    finally:
        if provider is not None and provider.poll() is None:
            provider.terminate()
            try:provider.wait(timeout=20)
            except subprocess.TimeoutExpired:provider.kill();provider.wait()
        if provider_log is not None:provider_log.close()
        fcntl.flock(run_lock.fileno(),fcntl.LOCK_UN)
        run_lock.close()

if __name__=="__main__":
    raise SystemExit(main())
