# Retained native supervisor recovery

Operation: ECO-MAC-LIFECYCLE-CLOUD-8D21. Current owner direction: 2026-10-14.1, approved native portability through item 59.

`model/native_supervision.py` supplies request-bound worker adoption, registration recovery, persistent stop timing and retryable signal delivery for the existing native worker and supervisor. It does not create a second process controller or modify scientific values.

## Integrate with the active platform writers

Apply `integration/native-supervisor-recovery-8d21.patch` from this application directory to an owned staging copy. The patch is against native_worker Git blob `b66fe4d103e1458d0a7562b039818a3c0dc41ab8` and operator/native_jobs blob `2ee4079a69ef6283b108dd9472085b2a278cb1f2`. Retain the active Windows spawn/lease/identity implementation and Mac identity/resource dispatch while composing any overlapping function. The complete private source package also supplies both original preimages, both full postimages and an idempotent unique-context composer.

The Windows process owner retains final composition of the two shared callers. The existing Mac backend remains the identity provider. POSIX dispatch rechecks that identity and uses the original owned process group; Windows dispatch calls its existing `windows_process.signal_owned(identity, signum)`. No Mac-specific signal controller is required.

Admit the final composed native_worker.py, operator/native_jobs.py and new model/native_supervision.py together to the cumulative application installer. The new request source map includes native_supervision.py. Do not replace a running application's source files while calculations retain their original source pins.

## Behavior

Original launch/worker/stop/terminal receipts require the selected execution and request digest. Old heartbeat records remain readable through their original execution identity. A fresh supervisor adopts the same complete worker identity and respects the original worker lease during registration and draining.

New requests carry `supervision_protocol: upstate.native-supervision/v2`. Recovery and the child share .worker.lock. If the launcher disappeared before registration, recovery records that fact under the lock and the delayed child exits before scientific execution. An actively held registration lock is respected. Requests predating this handshake retain their original terminal reconciliation and are not given a marker their old worker could ignore.

Stop progression starts at the retained stop timestamp, then uses monotonic time. Reconnect does not reset the graceful/terminate/force-stop intervals. Existing signal-N.json intentions remain immutable. Separate signal-N.dispatch.json records distinguish successful delivery from failed or interrupted attempts. Unsuccessful delivery can retry only against the same freshly matched process identity. A send interrupted before its success was recorded may be retried; this is not an exactly-once signaling protocol.

The existing task snapshot adds readable cancellation progress. Original stop acknowledgement, failure, result and finished records continue to be used. Existing completed scientific results and operation IDs are preserved.

## Focused execution retained with the private source

The original NativeJobs monitor was exercised on real isolated Linux child processes using temporary disk-backed lifecycle requests: close/detach, cold reconnect, stop, an injected unsuccessful signal followed by successful retry, foreign-worker rejection, restored stop age, delayed registration, a held registering child, and retained-format handling. One registration-state ordering defect was discovered and fixed; only the corrected branch and the remaining legacy case were subsequently exercised.

Native Windows and Mac operation belongs in the existing consolidated receiving course with the final composed platform backends. Operate the affected status/cancel/reconnect controls there. These lifecycle exercises do not represent NDR/SDR results or target-OS execution.
