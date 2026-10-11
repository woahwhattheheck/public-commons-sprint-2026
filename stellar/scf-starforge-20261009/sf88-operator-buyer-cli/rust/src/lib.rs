//! Rust customer applications over the installed, original SF88 Node buyer.
//!
//! A Client addresses the original durable state. Operation review, native
//! approval, settlement, file verification and recovery execute in that runtime.
//! The existing Go bridge is a language-neutral private-file/pipe protocol.
//!
//! All methods are synchronous and accept a clonable Context. A worker may cancel
//! a context from another thread; no executor or background service is required.
#![forbid(unsafe_op_in_unsafe_fn)]
#[cfg(not(unix))]
compile_error!("starforge-buyer currently requires a Unix host for the original native runtime");

mod transport;
mod types;
mod workflows;
mod files;
pub use transport::{Client, Context, Error, Options, Result};
pub use types::*;
pub use workflows::{Dataset, Inbox, Object, Operation};
pub use files::{RecordFormat, RecordOptions, VerifiedFile};
pub use serde_json::{self, Value};
