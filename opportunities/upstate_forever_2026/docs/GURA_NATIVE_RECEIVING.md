# Continue the original Gura native receiving operation

The original first-case receiver, complete-operation supervisor, parameter-study
receiver and native workflow use the shared portable receiving lease and native
process backends. Their scientific commands, case values, retained Workspace IDs,
source identities and report formats are unchanged.

Use the selected native interpreter and the existing application and operation
directories. For the complete retained operation:

```text
<received-native-python> -B <application>/source_tools/receive_gura_operation.py --application <application> --operation <existing-operation> --workspace <existing-workspace>
```

Supply `--inputs <original-archives>` only when that same operation was created
with those archives. The original receiver accepts the maintained native sources;
it does not replace the scientific model or change the stored operation target.
Repeat the same command to continue the existing saved phases and cases. Keep
receiving output outside the scientific Workspace so its complete ZIP does not
recursively include itself. The original first-case and parameter-study entry
points retain their existing `--help` options.

The supervisor owns one Windows Job or POSIX process session per active phase.
Windows enters the original command inside that Job's selected Python process,
keeps its real PID, and explicitly adopts only the supplied custody handles.
Nested native cases retain their original batch and complete-operation leases.
Linux and macOS retain inherited descriptor custody. A surviving child prevents
a second receiver from entering its operation even after its parent disappears.
No stale lock marker is removed to resume work.

Ctrl+C requests the existing graceful stop. The receiver retains the original
attempt, process output and interruption record before another case is admitted.
A phase that does not drain is terminated through its owned process tree;
Windows status codes remain Windows status codes. Unrelated processes are never
selected by name. The complete operation's `operation.json`, phase logs and
parameter-suite state remain the original continuation records.

The component fragment appends this receiving chain and its existing platform
dependencies to the normal application source capture. Compose it with the
current core catalogue; retain newer shared filesystem and process backends.
This source belongs in the same Windows/Mac release, not a separate application.
