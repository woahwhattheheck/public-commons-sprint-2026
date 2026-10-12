//! Reopen an original paid dataset and consume native typed rows from Rust.
//! Usage: received-dataset ABS_SF88 ABS_STATE DATASET_ID ABS_DELIVERY ABS_CSV_COPY [ABS_BRIDGE]
use serde::{Deserialize, Serialize};
use starforge_buyer::{Client,Context,Options,RecordFormat,RecordOptions};
use std::{collections::BTreeMap,error::Error,path::Path,time::Duration};
use serde_json::{json,Value};

#[derive(Debug,Deserialize,Serialize)]
struct InventoryRow {
    sku:String, units:i64, available:bool, description:String,
    #[serde(default)] rating:Option<serde_json::Number>,
    #[serde(flatten)] extra:BTreeMap<String,Value>,
}
fn main()->Result<(),Box<dyn Error>>{
    let args:Vec<String>=std::env::args().collect();
    if args.len()!=6 && args.len()!=7{return Err("expected SF88 STATE DATASET_ID DELIVERY CSV_COPY [BRIDGE]".into());}
    let mut options=Options::new(&args[1],&args[2]);
    if let Some(bridge)=args.get(6) { options.bridge_path=Some(bridge.into()); }
    let client=Client::new(options)?;
    let context=Context::with_timeout(Duration::from_secs(180));
    client.ready(&context)?;
    let dataset=client.dataset(&args[3]);
    let recovered=dataset.recover(&context)?;
    let delivery=Path::new(&args[4]);
    let mut count=0u64;
    let mut available_units=0i64;
    let transfer=dataset.file(Some(delivery),"dataset.jsonl").records::<InventoryRow>(
        &context,RecordFormat::DatasetRows,RecordOptions::default(),|row|{
            count+=1;
            if row.available {
                available_units=available_units.checked_add(row.units)
                    .ok_or_else(||std::io::Error::other("inventory total overflow"))?;
            }
            Ok(())
        })?;
    let csv=dataset.file(Some(delivery),"dataset.csv").save_as(&context,Path::new(&args[5]))?;
    // Publish the summary only after the original dataset and file readers finish.
    println!("{}",serde_json::to_string_pretty(&json!({
        "native":recovered.native,"rows":count,"availableUnits":available_units,
        "transfer":transfer,"csv":csv
    }))?);
    Ok(())
}
