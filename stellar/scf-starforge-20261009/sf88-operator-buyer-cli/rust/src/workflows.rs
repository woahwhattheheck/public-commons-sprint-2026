use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use crate::{Client, Context, Error, Result, VerifiedFile, types::*};

fn encoded(value: impl Serialize) -> Result<Value> {
    serde_json::to_value(value).map_err(|e| Error::caused("RUST_CALL_ENCODING_FAILED", e))
}
fn absolute(path: &Path, name: &str) -> Result<()> {
    if !path.is_absolute() { Err(Error::invalid(format!("{name} must be absolute"))) } else { Ok(()) }
}
impl Client {
    fn typed<T: DeserializeOwned>(&self, ctx: &Context, action: &str, id: Option<&str>, args: Value) -> Result<T> {
        Error::decode(self.call(ctx, action, id, args)?)
    }
    pub fn ready(&self, ctx: &Context) -> Result<Value> { self.call(ctx, "buyer.ready", None, json!({})) }
    pub fn list(&self, ctx: &Context) -> Result<Vec<OperationInfo>> { self.typed(ctx, "buyer.list", None, json!({})) }
    pub fn operation(&self, id: impl Into<String>) -> Operation { Operation { client:self.clone(), intent_id:id.into() } }
    fn created(&self, ctx: &Context, action: &str, args: Value) -> Result<Operation> {
        let info: OperationInfo = self.typed(ctx, action, None, args)?;
        Ok(self.operation(info.intent_id))
    }
    pub fn create(&self, ctx: &Context, config: Config, options: CreateOptions) -> Result<Operation> {
        if let Config::File(path) = &config { absolute(path, "config file")?; }
        self.created(ctx, "buyer.create", json!({"config":config,"options":options.payload()}))
    }
    pub fn request(&self, ctx: &Context, request: Request, options: CreateOptions) -> Result<Operation> {
        self.created(ctx, "buyer.request", json!({"request":request,"options":options.payload()}))
    }
    pub fn import_operation(&self, ctx: &Context, handoff: &Path, accept: usize, options: CreateOptions) -> Result<Operation> {
        absolute(handoff, "handoff")?;
        if options.body.is_some() { return Err(Error::invalid("the original handoff already carries its request body")); }
        let mut args = options.payload(); args["accept"] = json!(accept);
        self.created(ctx, "buyer.import", json!({"file":handoff,"options":args}))
    }
    pub fn discover(&self, ctx: &Context, catalog: Value, destination: Option<&Path>) -> Result<Value> {
        let mut args = json!({"catalog":catalog});
        if let Some(path) = destination { absolute(path,"destination")?; args["destination"]=json!(path); }
        self.call(ctx,"buyer.discover",None,args)
    }
    /// Original explicit catalog row and payment option selections are passed intact.
    pub fn prepare(&self, ctx: &Context, selection: Value) -> Result<Operation> {
        self.created(ctx,"buyer.prepare",selection)
    }
    pub fn inspect_handoff(&self, ctx: &Context, file: &Path, accept: Option<usize>) -> Result<Value> {
        absolute(file,"handoff")?;
        let mut args=json!({"file":file});
        if let Some(accept)=accept { args["options"]=json!({"accept":accept}); }
        self.call(ctx,"buyer.inspect-handoff",None,args)
    }
    pub fn inbox(&self, directory: impl Into<PathBuf>) -> Result<Inbox> {
        let directory=directory.into(); absolute(&directory,"inbox directory")?;
        Ok(Inbox {client:self.clone(),directory})
    }
    pub fn create_inbox(&self, ctx: &Context, directory: impl Into<PathBuf>) -> Result<Inbox> {
        let inbox=self.inbox(directory)?;
        self.call(ctx,"buyer.create-inbox",None,json!({"directory":inbox.directory}))?;
        Ok(inbox)
    }
    pub fn object(&self,id:impl Into<String>)->Object { Object{client:self.clone(),id:id.into()} }
    pub fn create_object(&self,ctx:&Context,options:ObjectOptions)->Result<Object> {
        let info:AcquisitionInfo=self.typed(ctx,"object.create",None,encoded(options)?)?;
        Ok(self.object(info.id))
    }
    pub fn attach_object(&self,ctx:&Context,id:&str,directory:&Path,accounting_only:bool)->Result<Object> {
        absolute(directory,"native object session")?;
        let info:AcquisitionInfo=self.typed(ctx,"object.attach",None,json!({"id":id,"directory":directory,"accountingOnly":accounting_only}))?;
        Ok(self.object(info.id))
    }
    pub fn objects(&self,ctx:&Context)->Result<Vec<AcquisitionInfo>> { self.typed(ctx,"object.list",None,json!({})) }
    pub fn dataset(&self,id:impl Into<String>)->Dataset { Dataset{client:self.clone(),id:id.into()} }
    pub fn create_dataset(&self,ctx:&Context,options:DatasetOptions)->Result<Dataset> {
        let info:AcquisitionInfo=self.typed(ctx,"dataset.create",None,encoded(options)?)?;
        Ok(self.dataset(info.id))
    }
    pub fn attach_dataset(&self,ctx:&Context,id:&str,directory:&Path,accounting_only:bool)->Result<Dataset> {
        absolute(directory,"native dataset session")?;
        let info:AcquisitionInfo=self.typed(ctx,"dataset.attach",None,json!({"id":id,"directory":directory,"accountingOnly":accounting_only}))?;
        Ok(self.dataset(info.id))
    }
    pub fn datasets(&self,ctx:&Context)->Result<Vec<AcquisitionInfo>> { self.typed(ctx,"dataset.list",None,json!({})) }
    /// Reopens an original BuyerResult record with the original response-file options.
    pub fn response(&self,record:Value,response_file:Value)->VerifiedFile {
        self.selected_file(json!({"kind":"response","record":record,"responseFile":response_file}))
    }
    pub fn selected_file(&self,selection:Value)->VerifiedFile { VerifiedFile{client:self.clone(),selection} }
}

#[derive(Clone)]
pub struct Operation { pub(crate) client:Client, pub intent_id:String }
impl Operation {
    pub fn review(&self,ctx:&Context)->Result<Review> {
        Review::from_value(self.client.call(ctx,"operation.review",Some(&self.intent_id),json!({}))?)
    }
    pub fn inspect(&self,ctx:&Context)->Result<OperationState> {
        self.client.typed(ctx,"operation.inspect",Some(&self.intent_id),json!({}))
    }
    pub fn execute(&self,ctx:&Context,review:&Review)->Result<ExecutionResult> {
        self.client.typed(ctx,"operation.execute",Some(&self.intent_id),json!({"review":review}))
    }
    /// Reads retained native outcome only; None means no complete outcome exists.
    pub fn recover(&self,ctx:&Context)->Result<Option<ExecutionResult>> {
        self.client.typed(ctx,"operation.recover",Some(&self.intent_id),json!({}))
    }
    pub fn file(&self)->VerifiedFile { self.client.selected_file(json!({"kind":"operation","id":self.intent_id})) }
}

#[derive(Clone)]
pub struct Inbox { client:Client, pub directory:PathBuf }
impl Inbox {
    fn command<T:DeserializeOwned>(&self,ctx:&Context,action:&str,id:Option<&str>,mut args:Value)->Result<T> {
        args["directory"]=json!(self.directory); self.client.typed(ctx,action,id,args)
    }
    pub fn list(&self,ctx:&Context)->Result<InboxProgress> { self.command(ctx,"inbox.list",None,json!({})) }
    pub fn show(&self,ctx:&Context,id:&str)->Result<InboxProgress> { self.command(ctx,"inbox.show",Some(id),json!({})) }
    pub fn enqueue(&self,ctx:&Context,operation:&Operation)->Result<InboxProgress> {
        if self.client.options().runtime_directory!=operation.client.options().runtime_directory
            || self.client.options().state_directory!=operation.client.options().state_directory {
            return Err(Error::invalid("operation must belong to the inbox's original buyer state"));
        }
        self.command(ctx,"inbox.enqueue",Some(&operation.intent_id),json!({}))
    }
    pub fn enqueue_config(&self,ctx:&Context,file:&Path)->Result<InboxProgress> {
        absolute(file,"config file")?;self.command(ctx,"inbox.enqueue-config",None,json!({"configFile":file}))
    }
    pub fn review(&self,ctx:&Context,id:&str)->Result<Review> {
        let value:Value=self.command(ctx,"inbox.review",Some(id),json!({}))?;Review::from_value(value)
    }
    pub fn execute(&self,ctx:&Context,id:&str,review:&Review,workspace:Option<&Path>)->Result<InboxProgress> {
        let mut options=json!({"review":review});
        if let Some(path)=workspace {absolute(path,"workspace")?;options["workspaceDirectory"]=json!(path);}
        self.command(ctx,"inbox.execute",Some(id),json!({"options":options}))
    }
    pub fn cancel(&self,ctx:&Context,id:&str)->Result<InboxProgress> {self.command(ctx,"inbox.cancel",Some(id),json!({}))}
    pub fn recover(&self,ctx:&Context,id:&str)->Result<InboxProgress> {self.command(ctx,"inbox.recover",Some(id),json!({}))}
    pub fn finalize(&self,ctx:&Context,id:&str,options:Value)->Result<InboxProgress> {
        self.command(ctx,"inbox.finalize",Some(id),json!({"options":options}))
    }
    pub fn export_report(&self,ctx:&Context,destination:&Path,workspace:Option<&Path>)->Result<InboxProgress> {
        absolute(destination,"report destination")?;let mut args=json!({"destination":destination});
        if let Some(path)=workspace {absolute(path,"workspace")?;args["options"]=json!({"workspaceDirectory":path});}
        self.command(ctx,"inbox.report",None,args)
    }
    pub fn response(&self,ctx:&Context,id:&str)->Result<Option<InboxResponse>> {self.command(ctx,"inbox.response",Some(id),json!({}))}
    pub fn file(&self,id:&str)->VerifiedFile {self.client.selected_file(json!({"kind":"inbox","directory":self.directory,"id":id}))}
}

#[derive(Clone)]
pub struct Object { client:Client,pub id:String }
impl Object {
    fn command(&self,ctx:&Context,action:&str,options:PageOptions)->Result<ObjectReport> {
        self.client.typed(ctx,action,Some(&self.id),json!({"options":options}))
    }
    pub fn initialize(&self,ctx:&Context,options:PageOptions)->Result<ObjectReport>{self.command(ctx,"object.initialize",options)}
    pub fn inspect(&self,ctx:&Context,options:PageOptions)->Result<ObjectReport>{self.command(ctx,"object.inspect",options)}
    pub fn recover(&self,ctx:&Context,options:PageOptions)->Result<ObjectReport>{self.command(ctx,"object.recover",options)}
    pub fn run(&self,ctx:&Context,options:PageOptions)->Result<ObjectReport>{self.command(ctx,"object.run",options)}
    fn delivery(&self,ctx:&Context,action:&str,destination:Option<&Path>,options:PageOptions)->Result<ObjectDelivery> {
        let mut args=json!({"options":options});
        if let Some(path)=destination {absolute(path,"delivery destination")?;args["destination"]=json!(path);}
        self.client.typed(ctx,action,Some(&self.id),args)
    }
    pub fn download(&self,ctx:&Context,destination:Option<&Path>,options:PageOptions)->Result<ObjectDelivery>{
        self.delivery(ctx,"object.download",destination,options)
    }
    pub fn assemble(&self,ctx:&Context,destination:Option<&Path>,options:PageOptions)->Result<ObjectDelivery>{
        self.delivery(ctx,"object.assemble",destination,options)
    }
    pub fn delivered(&self,ctx:&Context,destination:Option<&Path>,options:PageOptions)->Result<ObjectDelivery>{
        self.delivery(ctx,"object.delivery",destination,options)
    }
    pub fn file(&self,destination:Option<&Path>)->VerifiedFile {
        let mut selection=json!({"kind":"object","id":self.id});
        if let Some(path)=destination {selection["destination"]=json!(path);}
        self.client.selected_file(selection)
    }
    pub fn export_report(&self,ctx:&Context,destination:&Path,format:&str,options:PageOptions)->Result<ObjectReport> {
        absolute(destination,"report destination")?;
        self.client.typed(ctx,"object.report",Some(&self.id),json!({"destination":destination,"format":format,"options":options}))
    }
    pub fn accounting(&self,ctx:&Context,options:Value)->Result<Value>{self.client.call(ctx,"object.accounting",Some(&self.id),json!({"options":options}))}
    pub fn finalize(&self,ctx:&Context,options:Value)->Result<Value>{self.client.call(ctx,"object.finalize",Some(&self.id),json!({"options":options}))}
    pub fn recover_accounting(&self,ctx:&Context,options:Value)->Result<Value>{self.client.call(ctx,"object.recover-accounting",Some(&self.id),json!({"options":options}))}
}

#[derive(Clone)]
pub struct Dataset { client:Client,pub id:String }
impl Dataset {
    fn command(&self,ctx:&Context,action:&str)->Result<DatasetProgress>{self.client.typed(ctx,action,Some(&self.id),json!({}))}
    pub fn initialize(&self,ctx:&Context)->Result<DatasetProgress>{self.command(ctx,"dataset.initialize")}
    pub fn inspect(&self,ctx:&Context)->Result<DatasetProgress>{self.command(ctx,"dataset.inspect")}
    pub fn recover(&self,ctx:&Context)->Result<DatasetProgress>{self.command(ctx,"dataset.recover")}
    pub fn run(&self,ctx:&Context)->Result<DatasetProgress>{self.command(ctx,"dataset.run")}
    pub fn deliver(&self,ctx:&Context,destination:Option<&Path>)->Result<DatasetDelivery>{
        let mut args=json!({});if let Some(path)=destination {absolute(path,"dataset destination")?;args["destination"]=json!(path);}
        self.client.typed(ctx,"dataset.deliver",Some(&self.id),args)
    }
    pub fn file(&self,destination:Option<&Path>,name:&str)->VerifiedFile{
        let mut selection=json!({"kind":"dataset","id":self.id,"name":name});
        if let Some(path)=destination {selection["destination"]=json!(path);}
        self.client.selected_file(selection)
    }
    pub fn export_manifest(&self,ctx:&Context,destination:&Path)->Result<DatasetProgress>{
        absolute(destination,"manifest destination")?;
        self.client.typed(ctx,"dataset.manifest",Some(&self.id),json!({"destination":destination}))
    }
    pub fn accounting(&self,ctx:&Context,options:Value)->Result<Value>{self.client.call(ctx,"dataset.accounting",Some(&self.id),json!({"options":options}))}
    pub fn finalize(&self,ctx:&Context,options:Value)->Result<Value>{self.client.call(ctx,"dataset.finalize",Some(&self.id),json!({"options":options}))}
    pub fn recover_accounting(&self,ctx:&Context,options:Value)->Result<Value>{self.client.call(ctx,"dataset.recover-accounting",Some(&self.id),json!({"options":options}))}
}
