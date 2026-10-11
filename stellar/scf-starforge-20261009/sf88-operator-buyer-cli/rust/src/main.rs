use starforge_buyer::{Client, Config, Context, CreateOptions, Options, RecordFormat, RecordOptions, Request, Review, Value};
use serde_json::json;
use std::{collections::BTreeMap, error::Error, fs::{self, File, OpenOptions},
    io::{self, Read, Write}, os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf}, sync::atomic::{AtomicBool, Ordering}, time::{Duration, SystemTime, UNIX_EPOCH}};

type CliResult<T> = Result<T, Box<dyn Error>>;
static INTERRUPTED: AtomicBool = AtomicBool::new(false);
extern "C" fn interrupted(_: libc::c_int) { INTERRUPTED.store(true, Ordering::Release); }

const HELP:&str=r#"Stellar Forge Rust buyer — original SF88 customer workflow

starforge-buyer-rust --runtime ABS_SF88 --state ABS_PRIVATE_STATE [global options] COMMAND
Global: --node PATH_OR_NAME --bridge ABS_FILE --profile ABS_FILE
        --deadline-ms N --native-timeout-ms N --cleanup-grace-ms N
        --approval-stdin (connect the actual terminal for original native approval)

Customer:
  ready | list
  create CONFIG.json [--body FILE] [--response-file OPTIONS.json]
  request REQUEST.json [--body FILE] [--response-file OPTIONS.json]
  review INTENT_ID [--out PRIVATE_REVIEW.json]
  inspect INTENT_ID
  execute INTENT_ID PRIVATE_REVIEW.json [--approval-stdin]
  recover INTENT_ID
  import HANDOFF.json --accept INDEX
  inspect-handoff HANDOFF.json [--accept INDEX]
  discover CATALOG.json [--destination ABS_FILE]
  prepare SELECTION.json

Inbox:
  inbox ABS_DIRECTORY create|list
  inbox ABS_DIRECTORY show|enqueue|review|cancel|recover|response INTENT_ID
  inbox ABS_DIRECTORY execute INTENT_ID REVIEW.json [--workspace ABS_DIRECTORY]
  inbox ABS_DIRECTORY enqueue-config CONFIG.json
  inbox ABS_DIRECTORY finalize INTENT_ID --args FINALIZATION_ARGUMENTS.json
  inbox ABS_DIRECTORY report --args REPORT_ARGUMENTS.json

Acquisition:
  object|dataset list
  object|dataset create --args ORIGINAL_OPTIONS.json
  object|dataset attach --args ORIGINAL_ATTACHMENT.json
  object ID initialize|inspect|recover|run|download|assemble|delivery|report
         [--args ORIGINAL_ARGUMENTS.json]
  dataset ID initialize|inspect|recover|run|deliver|manifest
          [--args ORIGINAL_ARGUMENTS.json]
  object|dataset ID accounting|finalize|recover-accounting --args ORIGINAL_ARGUMENTS.json

Files:
  file SELECTION.json verify
  file SELECTION.json copy ABS_DESTINATION
  file SELECTION.json bytes|json [--limit BYTES]
  file SELECTION.json stream
  file SELECTION.json records ndjson|sse|csv|dataset [--options OPTIONS.json] [--partial]

Exact selections: {"kind":"operation","id":"..."}; {"kind":"inbox","directory":"/...","id":"..."};
{"kind":"object","id":"...","destination":"/assembled/file"};
{"kind":"dataset","id":"...","destination":"/delivery/directory","name":"dataset.csv"};
{"kind":"response","record": ORIGINAL_RECORD,"responseFile": ORIGINAL_OPTIONS}.

Extension: call ORIGINAL_ACTION [--id ID] [--args ARGUMENTS.json]
Structured commands support --out FILE (private, atomic, create-only; equal retry is accepted).
Byte/stream/records commands write payload to stdout and final transfer receipt to stderr.
Money stays in original decimal-string atomic fields. Every execution uses the original
review, approval, payment and durable recovery engine. Ctrl-C cancels and drains its child.
"#;

struct Arguments { words:Vec<String>, flags:BTreeMap<String,String> }
impl Arguments {
    fn parse()->CliResult<Self>{
        let mut iter=std::env::args().skip(1);let mut words=Vec::new();let mut flags=BTreeMap::new();
        while let Some(value)=iter.next(){
            if value=="--help" || value=="-h" {println!("{HELP}");std::process::exit(0);}
            if value.starts_with("--"){
                let key=value.trim_start_matches("--").to_owned();
                let boolean=matches!(key.as_str(),"approval-stdin"|"partial");
                let known=boolean || matches!(key.as_str(),"runtime"|"state"|"node"|"bridge"|"profile"|"deadline-ms"
                    |"native-timeout-ms"|"cleanup-grace-ms"|"args"|"body"|"response-file"|"out"|"accept"
                    |"workspace"|"destination"|"options"|"limit"|"id");
                if !known {return Err(format!("unknown option --{key}").into());}
                let value=if boolean {"true".into()}else{iter.next().ok_or_else(||format!("--{key} requires a value"))?};
                if flags.insert(key.clone(),value).is_some(){return Err(format!("duplicate option --{key}").into());}
            }else{words.push(value);}
        }
        Ok(Self{words,flags})
    }
    fn word(&self,index:usize)->CliResult<&str>{self.words.get(index).map(String::as_str).ok_or_else(||"missing command argument; use --help".into())}
    fn flag(&self,key:&str)->Option<&str>{self.flags.get(key).map(String::as_str)}
    fn required(&self,key:&str)->CliResult<&str>{self.flag(key).ok_or_else(||format!("--{key} is required").into())}
    fn number(&self,key:&str,default:u64)->CliResult<u64>{self.flag(key).map(str::parse).transpose().map(|v|v.unwrap_or(default)).map_err(Into::into)}
    fn count(&self,count:usize)->CliResult<()>{
        if self.words.len()!=count{Err(format!("expected {count} command words, received {}; use --help",self.words.len()).into())}else{Ok(())}
    }
    fn native_args(&self)->CliResult<Value>{
        match self.flag("args"){Some(path)=>read_json(Path::new(path)),None=>Ok(json!({}))}
    }
}
fn read_bytes(path:&Path,limit:u64)->CliResult<Vec<u8>>{
    let mut bytes=Vec::new();File::open(path)?.take(limit+1).read_to_end(&mut bytes)?;
    if bytes.len() as u64>limit{return Err(format!("input exceeds {limit} bytes").into());}Ok(bytes)
}
fn read_json(path:&Path)->CliResult<Value>{Ok(serde_json::from_slice(&read_bytes(path,32<<20)?)?)}
fn abs(path:&str)->CliResult<PathBuf>{
    let path=PathBuf::from(path);if !path.is_absolute(){return Err(format!("absolute path required: {}",path.display()).into());}Ok(path)
}
fn as_json(value:impl serde::Serialize)->CliResult<Value>{Ok(serde_json::to_value(value)?)}
fn create_options(a:&Arguments)->CliResult<CreateOptions>{
    Ok(CreateOptions{body:a.flag("body").map(|p|read_bytes(Path::new(p),24<<20)).transpose()?,
        response_file:a.flag("response-file").map(|p|read_json(Path::new(p))).transpose()?,
        ..CreateOptions::default()})
}
fn review(path:&str)->CliResult<Review>{Ok(Review::from_value(read_json(Path::new(path))?)?)}
fn receipt(value:impl serde::Serialize)->CliResult<()>{
    let mut error=io::stderr().lock();serde_json::to_writer(&mut error,&json!({"schema":"stellar-forge.rust-transfer.v1","transfer":value}))?;
    writeln!(error)?;Ok(())
}
fn run(a:&Arguments)->CliResult<Option<Value>>{
    let mut options=Options::new(abs(a.required("runtime")?)?,abs(a.required("state")?)?);
    if let Some(node)=a.flag("node"){options.node=node.into();}
    options.bridge_path=a.flag("bridge").map(abs).transpose()?;
    options.operator_profile=a.flag("profile").map(abs).transpose()?;
    options.approval_stdin=a.flag("approval-stdin").is_some();
    options.native_timeout=Duration::from_millis(a.number("native-timeout-ms",360000)?);
    options.cleanup_grace=Duration::from_millis(a.number("cleanup-grace-ms",15000)?);
    let client=Client::new(options)?;
    let ctx=Context::with_timeout(Duration::from_millis(a.number("deadline-ms",420000)?)).interrupted_by(&INTERRUPTED);
    let result=match a.word(0)?{
        "ready"=>{a.count(1)?;client.ready(&ctx)?},
        "list"=>{a.count(1)?;as_json(client.list(&ctx)?)?},
        "create"=>{a.count(2)?;let op=client.create(&ctx,Config::File(abs(a.word(1)?)?),create_options(a)?)?;json!({"intentId":op.intent_id})},
        "request"=>{a.count(2)?;let request:Request=serde_json::from_value(read_json(Path::new(a.word(1)?))?)?;
            let op=client.request(&ctx,request,create_options(a)?)?;json!({"intentId":op.intent_id})},
        "prepare"=>{a.count(2)?;let op=client.prepare(&ctx,read_json(Path::new(a.word(1)?))?)?;json!({"intentId":op.intent_id})},
        "import"=>{a.count(2)?;let accept:usize=a.required("accept")?.parse()?;
            let op=client.import_operation(&ctx,&abs(a.word(1)?)?,accept,create_options(a)?)?;json!({"intentId":op.intent_id})},
        "inspect-handoff"=>{a.count(2)?;client.inspect_handoff(&ctx,&abs(a.word(1)?)?,a.flag("accept").map(str::parse).transpose()?)?},
        "discover"=>{a.count(2)?;client.discover(&ctx,read_json(Path::new(a.word(1)?))?,a.flag("destination").map(abs).transpose()?.as_deref())?},
        "review"=>{a.count(2)?;client.operation(a.word(1)?).review(&ctx)?.into_value()},
        "inspect"=>{a.count(2)?;as_json(client.operation(a.word(1)?).inspect(&ctx)?)?},
        "execute"=>{a.count(3)?;as_json(client.operation(a.word(1)?).execute(&ctx,&review(a.word(2)?)?)?)?},
        "recover"=>{a.count(2)?;as_json(client.operation(a.word(1)?).recover(&ctx)?)?},
        "inbox"=>{
            let directory=abs(a.word(1)?)?;let command=a.word(2)?;let inbox=client.inbox(directory.clone())?;
            match command{
                "create"=>{a.count(3)?;client.create_inbox(&ctx,directory.clone())?;json!({"directory":directory})},
                "list"=>{a.count(3)?;as_json(inbox.list(&ctx)?)?},
                "show"=>{a.count(4)?;as_json(inbox.show(&ctx,a.word(3)?)?)?},
                "enqueue"=>{a.count(4)?;as_json(inbox.enqueue(&ctx,&client.operation(a.word(3)?))?)?},
                "enqueue-config"=>{a.count(4)?;as_json(inbox.enqueue_config(&ctx,&abs(a.word(3)?)?)?)?},
                "review"=>{a.count(4)?;inbox.review(&ctx,a.word(3)?)?.into_value()},
                "execute"=>{a.count(5)?;as_json(inbox.execute(&ctx,a.word(3)?,&review(a.word(4)?)?,a.flag("workspace").map(abs).transpose()?.as_deref())?)?},
                "cancel"=>{a.count(4)?;as_json(inbox.cancel(&ctx,a.word(3)?)?)?},
                "recover"=>{a.count(4)?;as_json(inbox.recover(&ctx,a.word(3)?)?)?},
                "response"=>{a.count(4)?;as_json(inbox.response(&ctx,a.word(3)?)?)?},
                "finalize"=>{a.count(4)?;let mut args=a.native_args()?;args["directory"]=json!(directory);
                    client.call(&ctx,"inbox.finalize",Some(a.word(3)?),args)?},
                "report"=>{a.count(3)?;let mut args=a.native_args()?;args["directory"]=json!(directory);client.call(&ctx,"inbox.report",None,args)?},
                _=>return Err("unknown inbox command; use --help".into()),
            }
        },
        kind @ ("object"|"dataset")=>{
            let second=a.word(1)?;
            if matches!(second,"list"|"create"|"attach"){
                a.count(2)?;let args=a.native_args()?;
                if second!="list" && a.flag("args").is_none(){return Err("--args is required for creation/attachment".into());}
                client.call(&ctx,&format!("{kind}.{second}"),None,args)?
            }else{
                a.count(3)?;let command=a.word(2)?;
                let allowed=matches!(command,"initialize"|"inspect"|"recover"|"run"|"accounting"|"finalize"|"recover-accounting")
                    || (kind=="object" && matches!(command,"download"|"assemble"|"delivery"|"report"))
                    || (kind=="dataset" && matches!(command,"deliver"|"manifest"));
                if !allowed{return Err("unknown acquisition command; use --help".into());}
                client.call(&ctx,&format!("{kind}.{command}"),Some(second),a.native_args()?)?
            }
        },
        "file"=>{
            let file=client.selected_file(read_json(Path::new(a.word(1)?))?);
            match a.word(2)?{
                "verify"=>{a.count(3)?;as_json(file.verify(&ctx)?)?},
                "copy"=>{a.count(4)?;as_json(file.save_as(&ctx,&abs(a.word(3)?)?)?)?},
                "json"=>{a.count(3)?;file.json::<Value>(&ctx,a.number("limit",8<<20)?)?},
                "bytes"=>{a.count(3)?;if a.flag("out").is_some(){return Err("use file copy for an atomic saved destination".into());}
                    let bytes=file.bytes(&ctx,a.number("limit",8<<20)?)?;io::stdout().lock().write_all(&bytes)?;
                    receipt(json!({"bytes":bytes.len(),"complete":true}))?;return Ok(None);},
                "stream"=>{a.count(3)?;if a.flag("out").is_some(){return Err("use file copy for an atomic saved destination".into());}
                    receipt(file.write_to(&ctx,&mut io::stdout().lock())?)?;return Ok(None);},
                "records"=>{a.count(4)?;if a.flag("out").is_some(){return Err("records use stdout; retain effects only after a successful final receipt".into());}
                    let format=match a.word(3)?{"ndjson"=>RecordFormat::Ndjson,"sse"=>RecordFormat::Sse,"csv"=>RecordFormat::Csv,
                        "dataset"=>RecordFormat::DatasetRows,_=>return Err("unknown record format".into())};
                    let mut options:RecordOptions=a.flag("options").map(|p|read_json(Path::new(p))).transpose()?
                        .map(serde_json::from_value).transpose()?.unwrap_or_default();
                    if a.flag("partial").is_some(){options.allow_partial=Some(true);}
                    let mut out=io::stdout().lock();
                    let transfer=file.records::<Value>(&ctx,format,options,|value|{
                        serde_json::to_writer(&mut out,&value).map_err(io::Error::other)?;writeln!(out)
                    })?;receipt(transfer)?;return Ok(None);
                },
                _=>return Err("unknown file command; use --help".into()),
            }
        },
        "call"=>{a.count(2)?;client.call(&ctx,a.word(1)?,a.flag("id"),a.native_args()?)?},
        _=>return Err("unknown command; use --help".into()),
    };
    Ok(Some(result))
}

fn publish(path:&Path,bytes:&[u8])->CliResult<()>{
    if !path.is_absolute(){return Err("--out requires an absolute path".into());}
    let parent=path.parent().ok_or("output has no parent directory")?;
    fs::create_dir_all(parent)?;
    let name=path.file_name().ok_or("output has no filename")?.to_string_lossy();
    let stamp=SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let temporary=parent.join(format!(".{name}.{}.{stamp}.pending",std::process::id()));
    let mut file=OpenOptions::new().write(true).create_new(true).mode(0o600).open(&temporary)?;
    if let Err(e)=file.write_all(bytes).and_then(|_|file.sync_all()){let _=fs::remove_file(&temporary);return Err(e.into());}
    drop(file);
    match fs::hard_link(&temporary,path){
        Ok(())=>{},
        Err(e) if e.kind()==io::ErrorKind::AlreadyExists=>{
            let mut existing=OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW).open(path)?;
            if !existing.metadata()?.is_file() || existing.metadata()?.permissions().mode()&0o077!=0 {
                let _=fs::remove_file(&temporary);return Err("existing output must be a private regular file".into());
            }
            let mut old=Vec::new();Read::by_ref(&mut existing).take(bytes.len() as u64+1).read_to_end(&mut old)?;
            if old!=bytes{let _=fs::remove_file(&temporary);return Err("output already contains different bytes; select a new destination".into());}
        },
        Err(e)=>{let _=fs::remove_file(&temporary);return Err(e.into());},
    }
    fs::remove_file(&temporary)?;File::open(parent)?.sync_all()?;Ok(())
}
fn main(){
    unsafe{
        libc::umask(0o077);
        let mut action:libc::sigaction=std::mem::zeroed();action.sa_sigaction=interrupted as usize;
        libc::sigemptyset(&mut action.sa_mask);
        for signal in [libc::SIGINT,libc::SIGTERM]{
            if libc::sigaction(signal,&action,std::ptr::null_mut())!=0{
                eprintln!("RUST_SIGNAL_SETUP_FAILED");std::process::exit(2);
            }
        }
    }
    let result=(||->CliResult<()>{
        let args=Arguments::parse()?;if args.words.is_empty(){println!("{HELP}");return Ok(());}
        if let Some(value)=run(&args)?{
            let mut bytes=serde_json::to_vec_pretty(&value)?;bytes.push(b'\n');
            if let Some(path)=args.flag("out"){publish(Path::new(path),&bytes)?;}else{io::stdout().lock().write_all(&bytes)?;}
        }Ok(())
    })();
    if let Err(error)=result{
        eprintln!("{error}");
        if let Some(cause)=error.source(){eprintln!("cause: {cause}");}
        std::process::exit(if INTERRUPTED.load(Ordering::Acquire){130}else{2});
    }
}
