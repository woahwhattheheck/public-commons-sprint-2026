use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::PathBuf};
use crate::{Error, Result};

/// Atomic amounts are decimal strings throughout all native configurations.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Config { File(PathBuf), Inline(Value) }

#[derive(Clone, Debug, Default)]
pub struct CreateOptions {
    /// None is absent; Some(vec![]) is a present zero-byte request body.
    pub body: Option<Vec<u8>>,
    pub response_file: Option<Value>,
    pub request_timeout_ms: Option<u64>,
    pub operator_profile: Option<PathBuf>,
}
impl CreateOptions {
    pub(crate) fn payload(&self) -> Value {
        let mut v = json!({});
        if let Some(body) = &self.body { v["bodyBase64"] = json!(STANDARD.encode(body)); }
        if let Some(response) = &self.response_file { v["responseFile"] = response.clone(); }
        if let Some(timeout) = self.request_timeout_ms { v["requestTimeoutMs"] = json!(timeout); }
        if let Some(profile) = &self.operator_profile { v["operatorProfile"] = json!(profile); }
        v
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub intent_id: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expect: Option<Value>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub headers: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order_reference: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ticket_file: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ticket_header: Option<String>,
}

/// An exact original review object. The native engine validates its bindings
/// again at execution; this wrapper preserves every field when saved/reopened.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Review(Value);
impl Review {
    pub fn from_value(value: Value) -> Result<Self> {
        if !value.is_object() { return Err(Error::invalid("original review must be a JSON object")); }
        Ok(Self(value))
    }
    pub fn value(&self) -> &Value { &self.0 }
    pub fn into_value(self) -> Value { self.0 }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationInfo { pub intent_id: String, pub directory: PathBuf }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationState {
    pub intent_id: String, pub directory: PathBuf, pub state: String,
    pub result_recoverable: bool, pub native_status: Option<String>,
    pub delivery_status: Option<String>, pub retry: String,
    #[serde(default)] pub inbox_directory: Option<PathBuf>,
    #[serde(flatten)] pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionResult {
    pub record: Value, pub native: Value, pub status: String,
    pub delivery: Value, pub stream: Value, pub ok: bool,
    #[serde(flatten)] pub extra: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessOutcome {
    pub exit_code: Option<i32>, pub exit_signal: Option<String>, pub error_code: Option<String>,
    #[serde(flatten)] pub extra: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxProgress {
    pub native: Value, pub process: ProcessOutcome,
    #[serde(default)] pub command_directory: Option<PathBuf>,
    #[serde(flatten)] pub extra: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxResponse {
    pub job: Value, pub native: Value, pub status: String, pub delivery: Value, pub stream: Value,
    #[serde(flatten)] pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageOptions {
    #[serde(skip_serializing_if = "Option::is_none")] pub chunk_offset: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub chunk_limit: Option<u64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcquisitionInfo { pub id: String, #[serde(default)] pub directory: Option<PathBuf> }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectOptions {
    pub id: String, pub config: Config, pub max_total_atomic: String,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub workspace_directory: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub operator_profile: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub description_file: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub object_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub chunk_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub expected_snapshot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub expected_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub expected_content_type: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectReport {
    pub record: Value, pub process: ProcessOutcome, pub status: String,
    pub native: Value, pub chunk_page: Value, pub assembly_page: Value,
    #[serde(flatten)] pub extra: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectDelivery {
    pub path: PathBuf, pub assembly: Value, pub receipt_recorded: bool, pub report: ObjectReport,
    #[serde(flatten)] pub extra: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetOptions {
    pub id: String, pub config: Config, pub max_pages: u64, pub max_total_atomic: String,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub workspace_directory: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub operator_profile: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub max_rows: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub max_page_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub expected_snapshot: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetProgress {
    pub native: Value, pub process: ProcessOutcome,
    #[serde(flatten)] pub extra: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetDelivery {
    pub report: Value, pub manifest: Value,
    #[serde(flatten)] pub extra: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    #[serde(default)] pub path: Option<PathBuf>, pub bytes: u64, pub sha256: String,
    #[serde(flatten)] pub extra: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transfer {
    pub bytes: u64, #[serde(default)] pub records: Option<u64>,
    #[serde(default)] pub sha256: Option<String>,
    #[serde(flatten)] pub extra: BTreeMap<String, Value>,
}
