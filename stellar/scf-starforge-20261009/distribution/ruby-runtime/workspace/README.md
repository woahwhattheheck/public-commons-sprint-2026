# Managed Ruby desk

This browser opens the complete managed Ruby runtime: selected interpreter, private Bundler installation, retained Gemfile and lock, native operations, original Rails applications, and full portable receiving. It uses the same saved workspace and operations as the command line and the Applications catalog.

## Open the desk

Use the maintained Node runtime and an existing absolute Ruby executable on the receiving host. The runtime directory and all ancestors must resolve to the selected real filesystem paths. The runtime directory is private to the current user; its parent must already exist.

From the selected checkout:

~~~bash
node stellar/scf-starforge-20261009/distribution/ruby-runtime/cli.mjs serve \
  --directory /ABS/private/ruby-runtime --create --port 8474 --startup-json
~~~

The direct browser entry is equivalent:

~~~bash
node stellar/scf-starforge-20261009/distribution/ruby-runtime/workspace/cli.mjs \
  --directory /ABS/private/ruby-runtime --create --port 8474 --startup-json
~~~

The server prints a compact startup record with schema "stellar-forge.ruby-runtime-workspace-startup.v1", status "RUBY_RUNTIME_WORKSPACE_READY", the selected directory and a private browser URL. Open that complete URL. Port 0 selects an available browser port.

The launch record includes the initialized workspace identity and the complete installed browser source files. These are read before and after startup. The Applications provider uses this same foreground entry and returned address. Reopening the original directory restores its environments, applications, operation histories and receiving selections.

## Install an environment

1. Open **Environments → Add environment**. Choose the environment ID and title.
2. Enter the absolute Ruby invocation path. **Probe Ruby** returns the actual interpreter version, target and hash, platform, and installed Bundler versions.
3. Select one exact Bundler version. Keep a version such as "2.6.9" as an explicit selection. A version absent from the host can be installed into the private runtime on an online installation.
4. Leave the project directory empty to use the Rails operator Gemfile, or select the complete existing project and its Gemfile. The original project is copied into the environment before installation.
5. Save the environment, inspect its full Gemfile and source selection, and choose **Install**.
6. Open the resulting original operation. Its stage and complete native log show Bundler installation, lock resolution, source review, dependency installation and the real Rails/SQLite probe.

The initial online installation uses the configured gem source and the host's available native compilation dependencies. It retains the exact Bundler gem, complete gem cache, client source, project source and resolved lock. Later attempts use the saved lock. The operating environment uses its own Bundler directories.

The runtime preserves the selected Ruby invocation path, including the way that executable enters its environment. The saved probe records its resolved target separately. An environment review shows the executable, Ruby version, exact Bundler version, Gemfile, lock, installation and all original operations.

**Verify** reopens the saved source, bundle lock and gem cache and runs the installed Rails/SQLite dependency probe. Its downloaded installation and lock files come from that actual operation.

## Operate an original Rails application

Finish the original native dataset or Baserow customer lifecycle first, using the same operation and full received data. The managed runtime's fixed customer command can run either maintained lifecycle within the selected private bundle. See the core guide and **../examples/customer-runtime.mjs** for the complete native customer continuation.

In **Applications → Register application**, select the installed environment and the original completed application directory. Give this application an ID and title. Registration accepts:

- A native dataset application with its original **application-delivery.json**.
- A Baserow customer Rails application with its original **operator-result.json**.

Registration copies the complete original application into the runtime's private working directory and opens the maintained DatasetOperator. It runs the actual Rails forms, import job, row previews, receipts, history and attachment streams over the original received source. The complete registration result belongs to its saved operation.

**Launch application** starts that working copy with its selected bundle and a loopback Rails port from 1 to 65535. **Open running application** appears after the core has started Puma and received a successful authenticated HTTP response. The opened application retains its original Rails authentication and CSRF behavior.

The application review displays the actual phase, original source, working directory, current operation, address and complete run history. **Stop application** addresses the existing launch. After it has stopped:

- **Verify stopped application** checks the original delivered dataset, actual current database rows, complete edition history and rendered HTTP pages. Download **application-verification.json** from that operation.
- **Export environment and stopped application** retains the working application's complete database and files with the environment, lock and full dependency cache.

The ordinary browser desk and an opened Rails application have separate private local sessions.

## Export and receive the full product

An environment export contains the complete source and dependencies. An application export includes its complete stopped working copy as well.

1. Choose **Export** for the environment, or **Export environment and stopped application** in the application review.
2. Open the resulting operation and download its original **ruby-runtime.tar**.
3. Retain the complete archive SHA-256 shown in the export result.
4. Open a Ruby desk on the receiving host and choose **Receive**.
5. Select the new receiving environment ID, title and its existing absolute Ruby executable. Use a compatible Ruby engine, ABI and platform for the archive.
6. Supply the original SHA-256 and either choose the archive in the browser or enter its absolute existing host path.
7. Complete the receiving action. The original receive operation restores the full archive and installs its exact retained bundle offline.
8. Open the received environment and application. Launch the received application and use its actual returned browser address.

The format is ordinary uncompressed TAR, with a complete manifest followed by regular files. The archive ceiling is 4 GiB and the core member ceiling is 100,000 files. The receiver checks the original archive, every member and the selected runtime platform before exposing the completed product.

Browser uploading streams the selected file without loading a multi-gigabyte archive into browser memory. The upload selection is saved before bytes are transferred. It contains the original operation UUID, target environment, selected Ruby, byte length and export SHA-256. A completed transfer stays in that workspace and commits into the same native receiving operation.

If transfer is interrupted, reopen its saved transfer and choose the same original archive. A partial transfer restarts the transport from the beginning under that same selection. A fully received archive is reused; the saved complete file is checked before native receiving.

## Operations, logs and files

The **Operations** table searches original IDs, environment, action and stage. Opening a row shows the actual state, current attempt, active worker, full request/result and any saved error.

Use **Resume original operation** for an interrupted, failed or cancelled attempt that should continue. Its saved inputs and operation UUID remain selected. **Cancel original operation** asks its current native worker to stop and preserves the source and lock for continuation.

Logs are read in pages of at most 64 KiB. Previous, next, explicit byte offset and follow controls keep browser memory bounded. Every returned log page retains its real byte offset and total length. Completed result files have individual download links, including their original names, sizes and SHA-256 values. The server streams a verified independent file handle and supports ordinary range downloads.

The browser saves each pending mutation before it sends it. If a response is lost, the **Pending actions** menu can retry that exact request with its original IDs. Each reminder is bound to the original runtime directory. A successful response removes the local reminder while the complete operation remains saved in the core.

The **Complete operation JSON** download exports the full current operation record. The named saved-file form retrieves an actual file from that selected operation; filenames are resolved by the core.

## Local session and shutdown

The desk binds to 127.0.0.1. Its initial URL carries the private token in the fragment. The browser removes that fragment from its visible history and exchanges the token for an HttpOnly, host-only, SameSite session cookie. API access requires that private session and the exact local host; supplied origins must match it.

The server serves its installed static files with a same-origin content policy and disables caching. All dynamic browser values use text nodes. Archive upload, complete output downloads and mutations use the authenticated API.

The launcher remains in the foreground. SIGINT or SIGTERM stops HTTP admission, closes its connections, drains already admitted file operations and closes the core handle. Native operations own their worker leases independently; their operation record remains the place to resume or cancel them after reopening the desk.

## Integration files

| File | Responsibility |
| --- | --- |
| cli.mjs | Foreground entry, arguments, startup output and shutdown. |
| launch.mjs | Read-only initialized workspace and installed source binding. |
| server.mjs | Authenticated local API, real core dispatch and streaming downloads. |
| uploads.mjs | Complete archive transfer, original receiving selection and same-operation commit. |
| browser.mjs | Environment, application, operation, pending action and receiving flows. |
| index.html | Accessible forms, full record views, tables and file controls. |
| style.css | Neutral industrial layout, responsive tables and visible focus states. |
| README.md | Complete local operation and receiving guide. |

The maintained core remains in **../model.mjs**, **../worker.mjs**, **../engine.rb** and **../application.rb**. Native operations and their saved source, results and leases are shared by the browser, command line and Applications integration.
