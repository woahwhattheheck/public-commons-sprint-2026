use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{io::{self, BufReader, Read, Write}, path::Path};
use crate::{Client, Context, Error, FileInfo, Result, Transfer};

/// Selects an original verified response, object or dataset export.
/// Streaming callbacks may observe bytes before final verification; commit their
/// downstream effects only after the method returns Ok.
#[derive(Clone)]
pub struct VerifiedFile { pub(crate) client:Client, pub(crate) selection:Value }
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all="lowercase")]
pub enum RecordFormat { Ndjson, Sse, Csv, #[serde(rename="dataset")] DatasetRows }
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct RecordOptions {
    #[serde(default,skip_serializing_if="Option::is_none")] pub allow_partial:Option<bool>,
    #[serde(default,skip_serializing_if="Option::is_none")] pub max_record_bytes:Option<u64>,
    #[serde(default,skip_serializing_if="Option::is_none")] pub max_records:Option<u64>,
    #[serde(default,skip_serializing_if="Option::is_none")] pub headers:Option<bool>,
    #[serde(default,skip_serializing_if="Option::is_none")] pub max_field_characters:Option<u64>,
    #[serde(default,skip_serializing_if="Option::is_none")] pub max_row_characters:Option<u64>,
}
impl VerifiedFile {
    pub fn selection(&self)->&Value {&self.selection}
    pub fn verify(&self,ctx:&Context)->Result<FileInfo>{
        Error::decode(self.client.call(ctx,"file.verify",None,json!({"selection":self.selection}))?)
    }
    /// Uses the original fsynced, non-overwriting verified file publication.
    pub fn save_as(&self,ctx:&Context,destination:&Path)->Result<FileInfo>{
        if !destination.is_absolute(){return Err(Error::invalid("destination must be absolute"));}
        Error::decode(self.client.call(ctx,"file.copy",None,json!({"selection":self.selection,"destination":destination}))?)
    }
    pub fn write_to(&self,ctx:&Context,writer:&mut dyn Write)->Result<Transfer>{
        let mut copied=0;
        let value=self.client.invoke(ctx,"file.stream",None,json!({"selection":self.selection}),&mut |reader|{
            copied=io::copy(reader,writer)?;Ok(())
        })?;
        let transfer:Transfer=Error::decode(value)?;
        if transfer.bytes!=copied{return Err(Error::invalid("original file transfer byte count mismatch"));}
        Ok(transfer)
    }
    /// Returns complete verified bytes within the selected memory limit.
    /// A zero limit accepts a real empty file.
    pub fn bytes(&self,ctx:&Context,limit:u64)->Result<Vec<u8>>{
        if limit>268_435_456{return Err(Error::invalid("byte limit exceeds 256 MiB; use write_to"));}
        let mut bytes=Vec::new();
        let value=self.client.invoke(ctx,"file.bytes",None,json!({"selection":self.selection,"limit":limit}),&mut |reader|{
            reader.take(limit+1).read_to_end(&mut bytes)?;
            if bytes.len() as u64>limit{return Err(io::Error::new(io::ErrorKind::InvalidData,"Rust response byte limit exceeded"));}
            Ok(())
        })?;
        let transfer:Transfer=Error::decode(value)?;
        if transfer.bytes!=bytes.len() as u64{return Err(Error::invalid("original file byte count mismatch"));}
        Ok(bytes)
    }
    /// Deserializes one complete verified JSON value. serde_json's arbitrary
    /// precision feature retains integer/decimal lexemes in Value.
    pub fn json<T:DeserializeOwned>(&self,ctx:&Context,limit:u64)->Result<T>{
        let bytes=self.bytes(ctx,limit)?;
        serde_json::from_slice(&bytes).map_err(|e|Error::caused("RUST_RESPONSE_JSON_INVALID",e))
    }
    /// Original NDJSON/SSE framing and CSV/dataset interpretation execute in Node.
    /// A failed callback cancels and drains the original operation before return.
    pub fn records<T:DeserializeOwned>(&self,ctx:&Context,format:RecordFormat,options:RecordOptions,
        mut consume:impl FnMut(T)->io::Result<()>)->Result<Transfer>
    {
        let mut count=0u64;
        let value=self.client.invoke(ctx,"file.records",None,json!({
            "selection":self.selection,"format":format,"options":options
        }),&mut |reader|{
            let reader=BufReader::with_capacity(64*1024,reader);
            for value in serde_json::Deserializer::from_reader(reader).into_iter::<T>(){
                let value=value.map_err(|e|io::Error::new(io::ErrorKind::InvalidData,e))?;
                consume(value)?;
                count=count.checked_add(1).ok_or_else(||io::Error::new(io::ErrorKind::InvalidData,"record count overflow"))?;
            }
            Ok(())
        })?;
        let transfer:Transfer=Error::decode(value)?;
        if transfer.records!=Some(count){return Err(Error::invalid("original stream record count mismatch"));}
        Ok(transfer)
    }
}
