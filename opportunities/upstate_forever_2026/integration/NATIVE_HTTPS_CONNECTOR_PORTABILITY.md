# Native connector lifecycle on Windows, macOS and Linux

This is the current platform supplement to NATIVE_HTTPS_CONNECTOR.md. It replaces that guide's Linux-only lifecycle and directory-sync descriptions. The HTTPS protocol, original operation identity and scientific journal are unchanged.

## Receiving the complete component

Ship source_tools/workbench_transport.py and source_tools/eco_native_connector.py from the same release with the original model/portable_fs.py and model/windows_fs.py platform layer. Retain the native HTTPS component fragment and both connector guides. The selected bundled Python 3.12 runs the connector in isolated mode; it resolves the platform layer from that same application directory, not an installed Python package or the current shell directory. No additional service, package installation or operator is created.

Use the normal root Windows or Mac launcher for the collection. The existing workbench session starts or reuses the native operator, writes its private current session, and owns the optional connector after that session is ready. A missing private connector selection leaves ordinary local operation unchanged.

## Private configuration and data locations

Continue the original private configuration, operator ID, canonical HTTPS origin, connector credential and journal. The native_session_file must refer to this launcher's original private workbench-session.json. Place configuration, token files and transport state outside the application and every scientific Workspace. Do not copy a donor machine's credentials or private session into the ZIP.

The launcher uses its maintained per-user state route: Windows LocalAppData, macOS Library/Application Support, or the existing Linux state directory. JSON paths may be absolute or relative to the private configuration file. On Windows, use forward slashes or escaped backslashes inside JSON. Spaces and Unicode in paths remain ordinary path values; subprocess calls use argument arrays rather than a shell.

POSIX configuration and token files retain owner-only mode 0600 and state directories mode 0700. On Windows, keep them in the receiving user's private application-data directory with that user's access controls. Windows chmod bits are not an ACL substitute. The shared file layer rejects final reparse points when opening private files and lock files. Credential contents never enter command arguments, events or the ownership pipe.

The advertised endpoint remains the exact configured HTTPS origin on port 443. The physical native operator remains its authenticated literal loopback HTTP address. Reopening reads its current port and credential from the same maintained session. TLS verification, original Host/Origin binding, redirect rejection and native Workspace authorization remain unchanged.

## Ownership, reopen and closing

Both the launcher owner lock and connector instance lock use the existing cross-platform whole-file lock implementation. A second matching launcher reuses the existing owner; a conflicting selection is not silently attached. Lock files are not removed or recreated while another owner can hold them. The operating system releases the owned handles when a process exits.

The launcher starts one connector child with an anonymous stdin pipe. It retains the only writing end. The pipe carries no commands or credentials: its open lifetime is the ownership lease. Windows uses an owned process group with redirected standard handles and close_fds; macOS and Linux use a separate POSIX session. No Unix-only pass_fds or Linux prctl is required.

Normal close shuts the pipe first. EOF sets the connector's existing STOP event, preventing new polls or recovered requests from starting and allowing the original journal path to finish. Abrupt launcher exit also closes the pipe, independently of PID reuse. After a 15-second grace period, only that connector child is stopped if an HTTP read is still outstanding. The native operator and scientific tasks keep their existing owners and recovery semantics.

Ordinary reconnect starts another child against the same private configuration and journal. The old parent pipe is closed before restart. Failed startup releases the owner lock. Standalone diagnostics continue to support --register-only; interactive standalone operation handles Ctrl+C and the available platform stop signals, including Windows Ctrl+Break.

## Durable bytes and disk capacity

Incoming bytes and responses retain their existing file fsync, contiguous chunk hashes, SQLite FULL journal and native operation identity. Directory publication uses the shared platform layer: POSIX directory fsync, or Windows directory-handle validation plus the existing flushed file bodies and write-through replacement for mutable launch records. These are the platform's existing durability semantics, not a new storage protocol.

Free capacity uses shutil.disk_usage on the selected private spool directory for all three operating systems. The configured spool ceiling and 32 MiB free-space reserve remain in force. Retained input, responses and journal are reused after a restart; they are not deleted to repeat a write.

## Release integration

Include this source change in the same shared application used for all three runtime bundles. Preserve all seven original Workspaces, the selected own-data opening and all 82 completed scientific runs. The existing final Windows receiving pass can exercise configured connector opening, matching session reuse and close/reopen alongside the root launcher. Runtime assembly and the final private ZIP remain the current release workflow, with Bryce as the recipient.
