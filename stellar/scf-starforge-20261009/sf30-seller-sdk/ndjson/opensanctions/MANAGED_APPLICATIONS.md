# Source monitoring in Applications

The OpenSanctions console opens the original SF30 NDJSON workspace through the maintained Applications lifecycle. Source editions, original update operations, native requests and customer decisions stay in that one workspace. Its application provider shares the native `ndjson` writer resource, so the general JSON Lines console and the monitoring console coordinate access to the same data directory.

## Select an installation and original workspace

Receive the complete merchant release containing the `source-monitoring` command and `opensanctions` application provider. The distribution's original source inventory includes the adapter, Python application and browser assets. Inspect it with:

```sh
starforge registrations --source ndjson
```

The contribution retains the original JSON Lines commands and adds this source-owned monitoring entry. Applications lists **OpenSanctions source monitoring** beside **JSON Lines datasets**.

Create or receive the original workspace through the installed source command, selecting the existing Python explicitly:

```sh
starforge source-monitoring --python /absolute/path/to/python3 \
  --workspace /absolute/private/source-monitoring --create state

starforge source-monitoring --python /absolute/path/to/python3 \
  --workspace /absolute/private/source-monitoring import \
  --input /absolute/path/to/OpenSanctions_Receiving_Workspace.zip
```

Use a new private workspace directory for a complete customer receiving archive. The import retains source checksums, all original records, mapping/build identities, source changes, native request and response bytes, and the complete case/review history. The source packet is the existing product's portable transfer; it is separate from an installed application release.

A workspace received on a different host acquires that host's native storage identity. Review it in that host's Applications installation. This is ordinary receiving; no path or inode from the sending machine is copied into a managed launch identity.

## Review and save the application

Choose the existing managed home and installed runtime, then select **OpenSanctions source monitoring**. Fill in:

| Setting | Meaning |
| --- | --- |
| Original source-monitoring workspace | The existing private absolute NDJSON directory containing the received source and cases. |
| Existing Python executable | An absolute Python 3.11+ executable, including its actual virtual environment when one is selected. |
| Private console connection file | Optional new private file for the console URL. The original native console creates it atomically and removes only its unchanged file when stopped. |
| Local port | Use `0` for an available loopback port, or a deliberate local port. |
| Private environment JSON | Optional existing private file containing the environment values required by saved native service profiles. |

**Review** invokes the original NDJSON binding reader without taking its SQLite writer. The source-owned monitoring adapter then extends that same identity with its complete native source files. The saved review retains the actual Python identity, original workspace directory and marker/database identities, native binding, source hashes and any selected private environment hash.

**Save**, **Connect**, **Review Start**, and **Start** use the existing Applications operations and original request IDs. The command forwards to the existing Python console. Its authenticated startup readback must agree with the retained announcement, selected Python, installed source and current workspace binding before **Open** is offered.

A second application selecting that same workspace uses the original `ndjson` resource key. Stop the current owner through the original Applications action before opening the other view. No additional lock directory or independent scheduler is introduced by this provider.

## Operate the customer case

The browser opens directly at the monitoring workspace:

1. **Source editions** shows the complete original dataset metadata, published checksum, population and native build. Open any record with its physical source line or use the original dataset query.
2. **Data updates** receives every nonempty published delta between the selected editions. Original ADD/MOD/DEL operations remain available together with the complete target edition and the publisher's exact content comparison.
3. **Change review** separates identifier/property findings from routine observation metadata. It keeps adjacent designations and original authority links visible. Record identity and relevance decisions separately, with a reason and reviewer.
4. **Native screening** opens each exact prepared/received service operation, original response, returned scores and explanations. Selecting a native candidate continues the matching original case history. When multiple histories are possible, the console asks the operator to choose.
5. **Receiving** exports the complete source and customer case. The same archive can be imported into another private installation, including its original received native responses and review history.

Native service profiles select their existing yente endpoint, dataset, algorithm parameters and named environment references. Starting this console opens the source workspace. The configured screening service retains its own deployment and dataset-loading operation. A retained response remains inspectable after its original receiver stops.

A customer supplies the license/data scope, approved counterparty input and existing screening service or hosting selection. Original-source evaluation uses the selected public data and its retained source terms. The product records those choices with the edition and prepared request.

## Stop and reopen

Use **Stop** on the saved application. The original operation owns its process, console connection and release lifecycle. Wait for the actual stopped result, then use **Review Start** and **Start** on the same saved application.

The database, source objects, updates, native responses and reviews remain in the original workspace. The application binding deliberately excludes mutable source-row and case contents; ordinary edits do not require reinstalling the application. Changes to the selected Python, native workspace identity, source files or private environment are reviewed through the existing lifecycle.

**Open** uses the current authenticated native announcement. A stale console URL is never inferred from an earlier provider response.

## Receiving outcomes and source references

The original source operation retained the September 30 UN edition with 2,926 records and the October 12 edition with 2,923 records. It reconciled all three nonempty intervening delta editions, preserved their four MOD/four DEL/one ADD operations, and matched the publisher's complete content projection. The original identifier replacement continued one customer case across two review events; the same case, three native builds and complete originals were exported and reopened.

Original source index: <https://data.opensanctions.org/datasets/latest/un_sc_sanctions/index.json>.

Provider rules and exact source versions are in [SOURCE_CONTRACT.json](SOURCE_CONTRACT.json) and the original [operating guide](README.md). Current native provider results, their prepared request IDs and subsequent customer reviews belong to the exported workspace and its original operation result.

The source-owned registration is [application-provider.mjs](application-provider.mjs), the preparation/startup adapter is [managed.mjs](managed.mjs), and the native binding extension is [application_binding.py](application_binding.py). The common lifecycle contract remains [APPLICATION_PROVIDERS.md](../../../distribution/runtime-workspace/APPLICATION_PROVIDERS.md).
