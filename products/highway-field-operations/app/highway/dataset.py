"""Original local CSV/SF100 production under the staff operation's single owner."""
import fcntl, os, subprocess
from pathlib import Path
from .common import *
from .reconciliation import materialize_dataset

def prepare_dataset(workspace,source_root,operation_id,selection):
    identifier(operation_id)
    from .exchange import source_inventory
    source_inventory(source_root,loads(read_regular(Path(source_root)/"source-selection.json",2*1024*1024)))
    root=workspace.directory/"dataset-preparation";root.mkdir(exist_ok=True,mode=0o700)
    directory=root/operation_id;directory.mkdir(exist_ok=True,mode=0o700)
    guard=os.open(directory/"operation.lock",os.O_RDWR|os.O_CREAT|getattr(os,"O_NOFOLLOW",0),0o600)
    try:
        fcntl.flock(guard,fcntl.LOCK_EX)
        intent={"schema":"geocove.dataset-preparation.v1","operationId":operation_id,"workspaceId":workspace.current()["state"]["id"],"selection":selection}
        atomic_file(directory/"intent.json",canonical(intent),immutable=True)
        projection=materialize_dataset(workspace.current()["state"],selection,workspace.read_blob,directory/"projection")
        producer_input={"directory":str(directory/"delivery"),"producerOptions":projection["producerOptions"],"operationId":operation_id,"sourceBindingSha256":digest({"captureSha256":projection["captureSha256"],"formSha256":projection["formSha256"],"selection":selection,"csv":projection["csv"],"rows":projection["rows"]})}
        atomic_file(directory/"producer-input.json",canonical(producer_input),immutable=True)
        returned=directory/"producer-result.json"
        if returned.exists():result=loads(read_regular(returned,MAX_BLOB))
        else:
            # The original producer owns immutable pages and finalized output.
            # Its inherited original lock keeps a surviving child exclusive.
            log_index=0
            while (directory/("producer-"+str(log_index)+".stdout")).exists():log_index+=1
            stdout=directory/("producer-"+str(log_index)+".stdout");stderr=directory/("producer-"+str(log_index)+".stderr")
            with open(stdout,"xb",buffering=0) as out,open(stderr,"xb",buffering=0) as err:
                os.chmod(stdout,0o600);os.chmod(stderr,0o600)
                completed=subprocess.run([os.environ.get("GEOCOVE_NODE_EXECUTABLE","node"),"--max-old-space-size=192",str(Path(source_root)/"highway"/"local_delivery.mjs")],input=canonical(producer_input),stdout=out,stderr=err,pass_fds=(guard,),cwd=str(source_root),check=False)
                os.fsync(out.fileno());os.fsync(err.fileno())
            atomic_file(directory/("producer-"+str(log_index)+".exit.json"),canonical({"exitCode":completed.returncode}),immutable=True)
            require(completed.returncode==0,"DATASET_PRODUCER_FAILED","The original dataset producer did not complete. Its exact logs and original input are retained.")
            result=loads(read_regular(stdout,MAX_BLOB))
            atomic_file(returned,canonical(result),immutable=True)
        require(result.get("schema")=="geocove.local-delivery-result.v1" and result["operationId"]==operation_id and result["sourceBindingSha256"]==producer_input["sourceBindingSha256"],"DATASET_RESULT_CHANGED","The retained producer result belongs to another selection.")
        target=directory/"delivery";require(Path(result["directory"]).resolve()==target.resolve(),"DATASET_RESULT_CHANGED","Original producer directory differs.")
        total=0
        for entry in result["files"]:
            relative=safe_path(entry["path"]);path=target/relative
            require(path.resolve().is_relative_to(target.resolve()),"DATASET_RESULT_CHANGED","Original producer file escapes its directory.")
            raw=read_regular(path);total+=len(raw)
            require(total<=MAX_BLOBS and len(raw)==entry["bytes"] and sha(raw)==entry["sha256"],"DATASET_RESULT_CHANGED","Original producer file changed.")
        report=read_regular(result["reportPath"])
        require(Path(result["reportPath"]).resolve().is_relative_to(target.resolve()) and len(report)==result["reportBytes"] and sha(report)==result["reportSha256"],"DATASET_RESULT_CHANGED","Original finalized scan changed.")
        response={"operationId":operation_id,"selection":selection,"projection":projection,"reportPath":result["reportPath"],"delivery":result}
        atomic_file(directory/"ready.json",canonical(response),immutable=True)
        return response
    finally:os.close(guard)
