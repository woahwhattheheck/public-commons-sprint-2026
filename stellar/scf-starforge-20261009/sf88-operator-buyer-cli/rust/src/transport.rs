use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap, ffi::OsString, fmt, fs::{self, File, OpenOptions},
    io::{self, Read, Write}, os::unix::{
        fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
        io::{AsRawFd, FromRawFd}, process::CommandExt,
    }, path::{Path, PathBuf}, process::{Child, Command, ExitStatus, Stdio},
    sync::{Arc, Mutex, MutexGuard, TryLockError, atomic::{AtomicBool, Ordering}}, thread, time::{Duration, Instant},
};

const SCHEMA: &str = "stellar-forge.go-buyer-call.v1";
const MAX_CALL_BYTES: usize = 32 << 20;
pub type Result<T> = std::result::Result<T, Error>;

/// Errors retain the original operation address and private invocation directory.
/// Native error/progress remains available to the application; Display emits only
/// the safe code and those local handles.
#[derive(Debug)]
pub struct Error {
    pub code: String,
    pub action: Option<String>,
    pub id: Option<String>,
    pub invocation_directory: Option<PathBuf>,
    pub native: Option<Value>,
    pub partial_result: Option<Value>,
    cause: Option<Box<dyn std::error::Error + Send + Sync>>,
}
impl Error {
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::caused("RUST_INVALID_INPUT", io::Error::new(io::ErrorKind::InvalidInput, message.into()))
    }
    pub(crate) fn caused(code: &str, cause: impl std::error::Error + Send + Sync + 'static) -> Self {
        Self { code: code.into(), action: None, id: None, invocation_directory: None,
            native: None, partial_result: None, cause: Some(Box::new(cause)) }
    }
    fn call(mut self, action: &str, id: Option<&str>, directory: &Path) -> Self {
        self.action = Some(action.into()); self.id = id.map(str::to_owned);
        self.invocation_directory = Some(directory.to_owned()); self
    }
    pub(crate) fn decode<T: DeserializeOwned>(value: Value) -> Result<T> {
        match T::deserialize(&value) {
            Ok(decoded) => Ok(decoded),
            Err(cause) => {
                let mut error=Self::caused("RUST_RESPONSE_DECODE_FAILED",cause);
                error.partial_result=Some(value);
                Err(error)
            }
        }
    }
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.code)?;
        if let Some(a) = &self.action { write!(f, " action={a}")?; }
        if let Some(id) = &self.id { write!(f, " id={id}")?; }
        if let Some(p) = &self.invocation_directory { write!(f, " invocation={}", p.display())?; }
        Ok(())
    }
}
impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.cause.as_ref().map(|v| v.as_ref() as &(dyn std::error::Error + 'static))
    }
}

/// Cancellation is local to this call context. Clones share cancellation.
/// The library installs no process-wide signal handlers.
#[derive(Clone, Default)]
pub struct Context {
    cancelled: Arc<AtomicBool>,
    deadline: Option<Instant>,
    external: Option<&'static AtomicBool>,
}
impl Context {
    pub fn background() -> Self { Self::default() }
    pub fn with_timeout(duration: Duration) -> Self {
        let now=Instant::now();
        Self { deadline: Some(now.checked_add(duration).unwrap_or(now)), ..Self::default() }
    }
    /// A CLI may supply its own async-signal-safe atomic flag.
    pub fn interrupted_by(mut self, flag: &'static AtomicBool) -> Self { self.external = Some(flag); self }
    pub fn cancel(&self) { self.cancelled.store(true, Ordering::Release); }
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire) || self.external.is_some_and(|v| v.load(Ordering::Acquire))
    }
    pub fn deadline_exceeded(&self) -> bool { self.deadline.is_some_and(|v| Instant::now() >= v) }
    fn stopped(&self) -> bool { self.is_cancelled() || self.deadline_exceeded() }
    fn check(&self) -> io::Result<()> {
        if self.deadline_exceeded() {
            Err(io::Error::new(io::ErrorKind::TimedOut, "Rust call deadline exceeded"))
        } else if self.is_cancelled() {
            // io::copy retries Interrupted; Other ends consumption and starts drain.
            Err(io::Error::new(io::ErrorKind::Other, "Rust call cancelled"))
        } else { Ok(()) }
    }
}

#[derive(Clone)]
pub struct Options {
    pub runtime_directory: PathBuf,
    pub state_directory: PathBuf,
    pub bridge_path: Option<PathBuf>,
    pub node: OsString,
    pub operator_profile: Option<PathBuf>,
    /// None inherits this process's environment; Some is the complete child environment.
    pub environment: Option<BTreeMap<OsString, OsString>>,
    /// Connect the actual terminal descriptor to original native approval.
    pub approval_stdin: bool,
    pub native_timeout: Duration,
    pub cleanup_grace: Duration,
    pub native_output_limit: usize,
    pub result_limit: usize,
}
impl Options {
    pub fn new(runtime: impl Into<PathBuf>, state: impl Into<PathBuf>) -> Self {
        Self { runtime_directory: runtime.into(), state_directory: state.into(), bridge_path: None,
            node: "node".into(), operator_profile: None, environment: None, approval_stdin: false,
            native_timeout: Duration::from_secs(360), cleanup_grace: Duration::from_secs(15),
            native_output_limit: 1 << 20, result_limit: 64 << 20 }
    }
}

#[derive(Clone)]
pub struct Client { options: Arc<Options> }
impl Client {
    /// Selects installed source and state without creating a purchase or calling Node.
    pub fn new(mut options: Options) -> Result<Self> {
        for p in [&options.runtime_directory, &options.state_directory] {
            if !p.is_absolute() { return Err(Error::invalid("runtime and state directories must be absolute")); }
        }
        if options.operator_profile.as_ref().is_some_and(|p| !p.is_absolute()) {
            return Err(Error::invalid("operator profile must be absolute"));
        }
        let bridge = options.bridge_path.get_or_insert_with(|| options.runtime_directory.join("go/bridge.mjs"));
        if !bridge.is_absolute() { return Err(Error::invalid("bridge path must be absolute")); }
        let node_entry = options.runtime_directory.join("node/index.mjs");
        for p in [bridge.as_path(), node_entry.as_path()] {
            if !fs::metadata(p).map_err(|e| Error::caused("RUST_RUNTIME_UNAVAILABLE", e))?.is_file() {
                return Err(Error::invalid("installed bridge and Node entry must be regular files"));
            }
        }
        for duration in [options.native_timeout, options.cleanup_grace] {
            if duration.as_millis() < 1 || duration.as_millis() > i32::MAX as u128 {
                return Err(Error::invalid("native timeout and cleanup grace must be 1..2147483647 milliseconds"));
            }
        }
        for limit in [options.native_output_limit, options.result_limit] {
            if !(1..=268_435_456).contains(&limit) { return Err(Error::invalid("runtime byte limit outside 1..256 MiB")); }
        }
        options.node = executable(&options.node, options.environment.as_ref())?.into_os_string();
        Ok(Self { options: Arc::new(options) })
    }
    pub fn options(&self) -> &Options { &self.options }

    /// Calls an original bridge action. Native argument/result JSON is retained
    /// losslessly; typed handles below cover the shipped customer workflows.
    pub fn call(&self, ctx: &Context, action: &str, id: Option<&str>, arguments: Value) -> Result<Value> {
        self.invoke(ctx, action, id, arguments, &mut |reader| {
            let bytes = io::copy(reader, &mut io::sink())?;
            if bytes != 0 { return Err(io::Error::new(io::ErrorKind::InvalidData, "unexpected bridge stdout")); }
            Ok(())
        })
    }
    pub(crate) fn invoke(&self, ctx: &Context, action: &str, id: Option<&str>, arguments: Value,
        consume: &mut dyn FnMut(&mut dyn Read) -> io::Result<()>) -> Result<Value>
    {
        ctx.check().map_err(|e| Error::caused("RUST_CALL_CANCELLED", e))?;
        let o = &self.options;
        let mut terminal=ForegroundTerminal::acquire(o.approval_stdin,ctx)
            .map_err(|e| Error::caused("RUST_APPROVAL_TERMINAL_UNAVAILABLE",e))?;
        private_directory(&o.state_directory).map_err(|e| Error::caused("RUST_STATE_UNAVAILABLE", e))?;
        let calls = o.state_directory.join(".rust-calls");
        private_directory(&calls).map_err(|e| Error::caused("RUST_STATE_UNAVAILABLE", e))?;
        let directory = invocation_directory(&calls).map_err(|e| Error::caused("RUST_CALL_CREATE_FAILED", e))?;
        let call_id = directory.file_name().and_then(|v| v.to_str()).unwrap().to_owned();
        let fail = |code: &str, error: io::Error| Error::caused(code, error).call(action, id, &directory);
        let mut settings = json!({
            "runtimeDirectory":o.runtime_directory, "stateDirectory":o.state_directory,
            "timeoutMs":o.native_timeout.as_millis() as u64, "cleanupGraceMs":o.cleanup_grace.as_millis() as u64,
            "outputLimit":o.native_output_limit
        });
        if let Some(profile) = &o.operator_profile { settings["operatorProfile"] = json!(profile); }
        let request = json!({"schema":SCHEMA, "callId":call_id, "action":action,
            "id":id, "client":settings, "arguments":arguments});
        let encoded = serde_json::to_vec(&request)
            .map_err(|e| Error::caused("RUST_CALL_ENCODING_FAILED", e).call(action, id, &directory))?;
        if encoded.len() > MAX_CALL_BYTES {
            return Err(fail("RUST_CALL_SIZE_LIMIT", io::Error::new(io::ErrorKind::InvalidInput, "call exceeds 32 MiB")));
        }
        let request_file = directory.join("request.json");
        write_private(&request_file, &encoded).map_err(|e| fail("RUST_CALL_WRITE_FAILED", e))?;
        File::open(&directory).and_then(|f| f.sync_all()).map_err(|e| fail("RUST_CALL_WRITE_FAILED", e))?;
        let log = OpenOptions::new().write(true).create_new(true).mode(0o600)
            .open(directory.join("bridge.stderr.log")).map_err(|e| fail("RUST_LOG_OPEN_FAILED", e))?;
        let mut command = Command::new(&o.node);
        command.arg(o.bridge_path.as_ref().unwrap()).arg(&request_file).current_dir(&o.runtime_directory)
            .stdin(if o.approval_stdin { Stdio::inherit() } else { Stdio::null() })
            .stdout(Stdio::piped()).stderr(log.try_clone().map_err(|e| fail("RUST_LOG_OPEN_FAILED", e))?)
            .process_group(0);
        if let Some(environment) = &o.environment { command.env_clear().envs(environment); }
        let child = command.spawn().map_err(|e| fail("RUST_BRIDGE_START_FAILED", e))?;
        let mut owned = OwnedChild { child: Some(child), grace: o.cleanup_grace + Duration::from_secs(5) };
        if let Some(terminal)=terminal.as_mut() {
            if let Err(cause)=terminal.grant(owned.child.as_ref().unwrap().id() as libc::pid_t) {
                let _=owned.finish(true,ctx);
                let _=terminal.restore();
                return Err(fail("RUST_APPROVAL_TERMINAL_UNAVAILABLE",cause));
            }
        }
        let stdout = owned.child.as_mut().unwrap().stdout.take().unwrap();
        let mut reader = CancellableReader { source: stdout, ctx };
        let consumed = consume(&mut reader);
        drop(reader);
        let waited = owned.finish(consumed.is_err() || ctx.stopped(), ctx);
        let terminal_error=terminal.as_mut().and_then(|terminal|terminal.restore().err());
        let _ = log.sync_all();
        let response = read_private_json(&directory.join("response.json"), o.result_limit)
            .map_err(|e| fail("RUST_BRIDGE_RESULT_UNAVAILABLE", e))?;
        let matches = response.get("schema").and_then(Value::as_str) == Some(SCHEMA)
            && response.get("callId").and_then(Value::as_str) == Some(call_id.as_str())
            && response.get("action").and_then(Value::as_str) == Some(action)
            && match id { Some(id) => response.get("id").and_then(Value::as_str) == Some(id),
                None => response.get("id").is_some_and(Value::is_null) };
        if !matches { return Err(fail("RUST_BRIDGE_RESPONSE_MISMATCH", io::Error::new(io::ErrorKind::InvalidData, "response identity differs"))); }
        let result = response.get("result").cloned().unwrap_or(Value::Null);
        let native = response.get("error").filter(|v| !v.is_null()).cloned();
        let mut error = if ctx.stopped() {
            Some(fail(if ctx.deadline_exceeded() { "RUST_DEADLINE_EXCEEDED" } else { "RUST_CALL_CANCELLED" },
                io::Error::new(io::ErrorKind::Other, "original native cleanup completed after cancellation")))
        } else if let Err(error) = consumed {
            Some(fail("RUST_OUTPUT_CONSUMER_FAILED", error))
        } else if response.get("ok").and_then(Value::as_bool) != Some(true) {
            Some(fail(native.as_ref().and_then(|v| v.get("code")).and_then(Value::as_str)
                .unwrap_or("RUST_BRIDGE_OPERATION_FAILED"), io::Error::new(io::ErrorKind::Other, "original bridge operation failed")))
        } else {
            match waited {
                Ok(status) if status.success() => terminal_error.map(|cause|fail("RUST_APPROVAL_TERMINAL_RESTORE_FAILED",cause)),
                Ok(status) => Some(fail("RUST_BRIDGE_PROCESS_FAILED", io::Error::new(io::ErrorKind::Other, format!("bridge exited {status}")))),
                Err(e) => Some(fail("RUST_BRIDGE_PROCESS_FAILED", e)),
            }
        };
        if let Some(mut error) = error.take() {
            error.native = native;
            if !result.is_null() { error.partial_result = Some(result); }
            return Err(error);
        }
        drop(log);
        if let Err(cause)=fs::remove_dir_all(&directory) {
            let mut error=fail("RUST_CALL_CLEANUP_FAILED",cause);
            error.partial_result=Some(result);
            return Err(error);
        }
        Ok(result)
    }
}

fn executable(name: &OsString, environment: Option<&BTreeMap<OsString, OsString>>) -> Result<PathBuf> {
    let path = Path::new(name);
    let candidates: Vec<PathBuf> = if path.is_absolute() { vec![path.into()] }
        else if path.components().count() == 1 {
            let path_env = match environment { Some(e) => e.get(&OsString::from("PATH")).cloned(), None => std::env::var_os("PATH") };
            path_env.map(|v| std::env::split_paths(&v).map(|p| p.join(path)).collect()).unwrap_or_default()
        } else { return Err(Error::invalid("Node must be an absolute executable or a PATH name")); };
    for candidate in candidates {
        if let Ok(m) = fs::metadata(&candidate) {
            if m.is_file() && m.permissions().mode() & 0o111 != 0 {
                return fs::canonicalize(candidate).map_err(|e| Error::caused("RUST_NODE_UNAVAILABLE", e));
            }
        }
    }
    Err(Error::invalid("Node executable not found in the selected environment"))
}
fn private_directory(path: &Path) -> io::Result<()> {
    fs::DirBuilder::new().recursive(true).mode(0o700).create(path)?;
    let meta = fs::symlink_metadata(path)?;
    if !meta.is_dir() || meta.permissions().mode() & 0o077 != 0 || meta.uid() != unsafe { libc::geteuid() } {
        return Err(io::Error::new(io::ErrorKind::PermissionDenied, "private owned directory required"));
    }
    Ok(())
}
fn invocation_directory(parent: &Path) -> io::Result<PathBuf> {
    let mut random = [0u8; 16];
    File::open("/dev/urandom")?.read_exact(&mut random)?;
    let name = format!("call-{}", random.iter().map(|b| format!("{b:02x}")).collect::<String>());
    let directory = parent.join(name);
    fs::DirBuilder::new().mode(0o700).create(&directory)?;
    File::open(parent)?.sync_all()?;
    Ok(directory)
}
pub(crate) fn write_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).mode(0o600).open(path)?;
    file.write_all(bytes)?; file.sync_all()
}
pub(crate) fn read_private_json(path: &Path, limit: usize) -> io::Result<Value> {
    let file = OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW).open(path)?;
    let meta = file.metadata()?;
    if !meta.is_file() || meta.permissions().mode() & 0o077 != 0
        || meta.uid() != unsafe { libc::geteuid() } || meta.len() > limit as u64 {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "private response file or size invalid"));
    }
    let mut bytes = Vec::new(); file.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > limit { return Err(io::Error::new(io::ErrorKind::InvalidData, "response exceeds limit")); }
    serde_json::from_slice(&bytes).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

// Only explicitly opted-in calls share this terminal lease. Other library calls
// retain independent cancellation and can execute concurrently.
static APPROVAL_TERMINAL:Mutex<()>=Mutex::new(());
struct ForegroundTerminal {
    file:File, original_group:libc::pid_t, child_group:Option<libc::pid_t>,
    _guard:MutexGuard<'static,()>,
}
impl ForegroundTerminal {
    fn acquire(enabled:bool,ctx:&Context)->io::Result<Option<Self>> {
        if !enabled || unsafe {libc::isatty(libc::STDIN_FILENO)}!=1 {return Ok(None);}
        let guard=loop {
            ctx.check()?;
            match APPROVAL_TERMINAL.try_lock() {
                Ok(guard)=>break guard,
                Err(TryLockError::Poisoned(error))=>break error.into_inner(),
                Err(TryLockError::WouldBlock)=>thread::sleep(Duration::from_millis(20)),
            }
        };
        let original_group=unsafe {libc::tcgetpgrp(libc::STDIN_FILENO)};
        if original_group<0 {return Err(io::Error::last_os_error());}
        if original_group!=unsafe {libc::getpgrp()} {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied,
                "interactive approval requires the caller to own the foreground terminal"));
        }
        let descriptor=unsafe {libc::fcntl(libc::STDIN_FILENO,libc::F_DUPFD_CLOEXEC,3)};
        if descriptor<0 {return Err(io::Error::last_os_error());}
        // The newly duplicated descriptor is exclusively owned by this File.
        let file=unsafe {File::from_raw_fd(descriptor)};
        Ok(Some(Self {file,original_group,child_group:None,_guard:guard}))
    }
    fn grant(&mut self,group:libc::pid_t)->io::Result<()> {
        if unsafe {libc::tcgetpgrp(self.file.as_raw_fd())}!=self.original_group {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied,"foreground terminal ownership changed before approval"));
        }
        self.child_group=Some(group);
        set_terminal_group(self.file.as_raw_fd(),group)?;
        // The just-created group may have reached stdin before the parent granted
        // its foreground lease and stopped with SIGTTIN. It is still our group.
        if unsafe {libc::kill(-group,libc::SIGCONT)}!=0 {
            let error=io::Error::last_os_error();
            if error.raw_os_error()!=Some(libc::ESRCH) {return Err(error);}
        }
        Ok(())
    }
    fn restore(&mut self)->io::Result<()> {
        let Some(group)=self.child_group else {return Ok(());};
        let current=unsafe {libc::tcgetpgrp(self.file.as_raw_fd())};
        if current==self.original_group {self.child_group=None;return Ok(());}
        if current<0 {return Err(io::Error::last_os_error());}
        if current!=group {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied,"foreground terminal was reassigned externally"));
        }
        set_terminal_group(self.file.as_raw_fd(),self.original_group)?;
        self.child_group=None;Ok(())
    }
}
impl Drop for ForegroundTerminal {
    fn drop(&mut self) {let _=self.restore();}
}
fn set_terminal_group(descriptor:libc::c_int,group:libc::pid_t)->io::Result<()> {
    // tcsetpgrp can be called after this thread's group became background.
    // Block SIGTTOU only in this thread, preserving the application's handlers.
    unsafe {
        let mut mask:libc::sigset_t=std::mem::zeroed();
        let mut previous:libc::sigset_t=std::mem::zeroed();
        libc::sigemptyset(&mut mask);libc::sigaddset(&mut mask,libc::SIGTTOU);
        let blocked=libc::pthread_sigmask(libc::SIG_BLOCK,&mask,&mut previous);
        if blocked!=0 {return Err(io::Error::from_raw_os_error(blocked));}
        let changed=libc::tcsetpgrp(descriptor,group);
        let change_error=if changed==0 {None} else {Some(io::Error::last_os_error())};
        let restored=libc::pthread_sigmask(libc::SIG_SETMASK,&previous,std::ptr::null_mut());
        if let Some(error)=change_error {return Err(error);}
        if restored!=0 {return Err(io::Error::from_raw_os_error(restored));}
    }
    Ok(())
}

struct CancellableReader<'a> { source: std::process::ChildStdout, ctx: &'a Context }
impl Read for CancellableReader<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if buffer.is_empty() { return Ok(0); }
        loop {
            self.ctx.check()?;
            let mut descriptor = libc::pollfd { fd: self.source.as_raw_fd(), events: libc::POLLIN, revents: 0 };
            // The descriptor is owned by self for this call; poll never retains its pointer.
            let ready = unsafe { libc::poll(&mut descriptor, 1, 50) };
            if ready < 0 {
                let e = io::Error::last_os_error();
                if e.kind() == io::ErrorKind::Interrupted { continue; }
                return Err(e);
            }
            if ready > 0 { return self.source.read(buffer); }
        }
    }
}
struct OwnedChild { child: Option<Child>, grace: Duration }
impl OwnedChild {
    fn interrupt(&self) {
        if let Some(child) = &self.child {
            // The child is still owned and unreaped. Its original bridge turns SIGINT
            // into AbortSignal and drains its own native subprocesses.
            unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGINT); }
        }
    }
    fn finish(&mut self, mut interrupt: bool, ctx: &Context) -> io::Result<ExitStatus> {
        let mut until = None;
        loop {
            if (interrupt || ctx.stopped()) && until.is_none() {
                self.interrupt(); until = Some(Instant::now() + self.grace);
            }
            if let Some(status) = self.child.as_mut().unwrap().try_wait()? {
                self.child.take(); return Ok(status);
            }
            if until.is_some_and(|v| Instant::now() >= v) {
                let child = self.child.as_mut().unwrap();
                // Only this still-owned process group is targeted after native drain grace.
                unsafe { libc::kill(-(child.id() as libc::pid_t), libc::SIGKILL); }
                let _ = child.kill();
                let status = child.wait()?;
                self.child.take(); return Ok(status);
            }
            interrupt = interrupt || ctx.stopped();
            thread::sleep(Duration::from_millis(20));
        }
    }
}
impl Drop for OwnedChild {
    fn drop(&mut self) {
        if self.child.is_some() { let _ = self.finish(true, &Context::background()); }
    }
}
