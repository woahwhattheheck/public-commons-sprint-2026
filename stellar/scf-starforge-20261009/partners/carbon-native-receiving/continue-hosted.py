"""Receive the complete carbon recovery source and continue the preserved native case.

The caller supplies the existing HostedAppsClient, current Notion connector, exact
published attachment identities, existing executables, and actual restored paths.
All Node execution stays inside the original accepted379A operation.
"""
def continue_carbon_saved(client, notion_connector_id, node, chromium, library_helpers,
                          preserved_output, preserved_source_root,
                          manifest_attachment, launcher_attachment,
                          work_parent="/dev", programme_path=None,
                          accounting_directory=None, capture_options=None,
                          capture_checkpoint=None, bundle_path=None,
                          node_options=None, timeout_seconds=None, original_recovery=None):
    import os, sys, json, time, hashlib, tempfile, subprocess, threading, shutil
    import tarfile, base64
    from pathlib import Path
    from concurrent.futures import ThreadPoolExecutor

    operation = "SCF-CARBON-NATIVE-8D45-20261012"
    old_output = Path(preserved_output).resolve(strict=True)
    old_source = Path(preserved_source_root).resolve(strict=True)
    node, chromium = str(Path(node).resolve(strict=True)), str(Path(chromium).resolve(strict=True))
    if not old_output.is_dir() or not old_source.is_dir():
        raise ValueError("Select the actual preserved output and its retained source directory")
    if not os.access(node, os.X_OK) or not os.access(chromium, os.X_OK):
        raise ValueError("Use the host's existing executable Node and Chromium paths")
    receipt_path = old_output/"receiving.json"
    receipt_bytes = receipt_path.read_bytes()
    receipt = json.loads(receipt_bytes)
    if receipt.get("schema") != "stellar-forge.carbon-native-receiving.v1" or receipt.get("operation") != operation:
        raise ValueError("Select the original carbon operation's complete receiving output")

    parent = Path(work_parent).resolve(strict=True)
    if any(parent == original or original in parent.parents for original in (old_output, old_source)):
        raise ValueError("Keep new receiving work outside the preserved source and output")
    base = Path(tempfile.mkdtemp(prefix="379a-carbon-preserved-", dir=str(parent))).resolve()
    downloads, source, output = base/"downloads", base/"source", base/"operated"
    downloads.mkdir(mode=0o700); (base/"tmp").mkdir(mode=0o700)
    state_path = base/"native-continuation.json"
    archive = base/"SCF_Carbon_GiveCredit_Complete_Receiving_379A_20261013.tar.gz"
    environment = dict(os.environ)
    environment.update(TMPDIR=str(base/"tmp"), TMP=str(base/"tmp"), TEMP=str(base/"tmp"))
    if node_options is not None:
        if not isinstance(node_options, str) or "\0" in node_options:
            raise ValueError("Use the host's explicit Node options as one string")
        environment["NODE_OPTIONS"] = node_options
    if timeout_seconds is not None and (not isinstance(timeout_seconds, (int, float)) or timeout_seconds <= 0):
        raise ValueError("An optional native timeout must be positive")
    state = {"schema":"stellar-forge.carbon-hosted-continuation.v1", "operation":operation,
             "base":str(base), "source":str(source), "output":str(output),
             "startedAt":time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
             "status":"preparing", "stages":[], "sourceFiles":[],
             "resume":{"directory":str(old_output), "source":str(old_source),
                       "receipt":str(receipt_path), "receiptBytes":len(receipt_bytes),
                       "receiptSha256":hashlib.sha256(receipt_bytes).hexdigest(),
                       "originalStatus":receipt.get("status"),
                       "originalRecordedOutput":receipt.get("output"),
                       "originalRecordedSource":receipt.get("sourceRoot")},
             "originalRecovery":original_recovery or {}}
    lock = threading.Lock()

    def digest(body):
        return hashlib.sha256(body).hexdigest()

    def file_digest(path):
        result = hashlib.sha256()
        with Path(path).open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024*1024), b""):
                result.update(chunk)
        return result.hexdigest()

    def git_blob(body):
        return hashlib.sha1(b"blob "+str(len(body)).encode()+b"\0"+body).hexdigest()

    def now():
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    def resources():
        values = {"observedAt":now(), "pid":os.getpid()}
        for name in ("memory.current", "memory.max", "memory.peak", "memory.events"):
            path = Path("/sys/fs/cgroup")/name
            try:
                values[name] = path.read_text().strip()
            except OSError as exc:
                values[name] = {"unavailable":exc.__class__.__name__}
        try:
            stat = Path("/proc/self/stat").read_text()
            fields = stat[stat.rfind(")")+2:].split()
            values["process"] = {"pid":os.getpid(), "procPid":int(stat.split(" ", 1)[0]),
                                "startTicks":fields[19], "state":fields[0],
                                "bootId":Path("/proc/sys/kernel/random/boot_id").read_text().strip()}
        except (OSError, ValueError, IndexError):
            pass
        return values

    def checkpoint():
        with lock:
            temporary = state_path.with_name(state_path.name+".partial")
            with temporary.open("w", encoding="utf-8") as handle:
                json.dump(state, handle, ensure_ascii=False, indent=2)
                handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
            os.replace(temporary, state_path)

    def report(stage, **values):
        print(json.dumps({"stage":stage, **values}, ensure_ascii=True), flush=True)

    def payload(value, keys):
        if isinstance(value, dict):
            if value.get("isError") is True:
                raise RuntimeError("Selected Notion action returned an error")
            if all(key in value for key in keys):
                return value
            for key in ("structuredContent", "result", "content"):
                if key in value:
                    try:
                        return payload(value[key], keys)
                    except LookupError:
                        pass
            if value.get("type") == "text":
                return payload(value.get("text", ""), keys)
        elif isinstance(value, list):
            for child in value:
                try:
                    return payload(child, keys)
                except LookupError:
                    pass
        elif isinstance(value, str):
            try:
                return payload(json.loads(value), keys)
            except (ValueError, TypeError):
                pass
        raise LookupError("Selected action did not expose "+",".join(keys))

    def attach(spec, name=None):
        upload_id = spec["file_upload_id"]
        name = name or spec.get("name")
        if not isinstance(name, str) or name != os.path.basename(name) or name in ("", ".", ".."):
            raise ValueError("Keep each original attachment basename")
        result = client.call_tool(notion_connector_id, "notion-download-attachment",
                                  {"file_upload_id":upload_id})
        item = payload(result, ("file_upload_id", "content", "content_length"))
        body = item["content"].encode("utf-8")
        if item["file_upload_id"] != upload_id or item["content_length"] != len(body):
            raise RuntimeError("Incomplete original attachment: "+name)
        actual_sha, actual_blob = digest(body), git_blob(body)
        if spec.get("bytes") is not None and len(body) != spec["bytes"]:
            raise RuntimeError("Original attachment byte count differs: "+name)
        if spec.get("sha256") and actual_sha != spec["sha256"]:
            raise RuntimeError("Original attachment SHA256 differs: "+name)
        if spec.get("gitBlobSha1") and actual_blob != spec["gitBlobSha1"]:
            raise RuntimeError("Original attachment Git identity differs: "+name)
        with (downloads/name).open("xb") as handle:
            handle.write(body); handle.flush(); os.fsync(handle.fileno())
        with lock:
            state["sourceFiles"].append({"file":name, "upload":upload_id, "bytes":len(body),
                                        "sha256":actual_sha, "gitBlobSha1":actual_blob})
        checkpoint()
        return body

    def copy_original(original, target):
        original, target = Path(original).resolve(strict=True), Path(target)
        before = original.stat()
        if not original.is_file():
            raise ValueError("Use an original regular file: "+str(original))
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with original.open("rb") as incoming, target.open("xb") as outgoing:
            shutil.copyfileobj(incoming, outgoing, 1024*1024)
            outgoing.flush(); os.fsync(outgoing.fileno())
        after = original.stat()
        same = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) == \
               (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
        copied_hash = file_digest(target)
        if not same or target.stat().st_size != before.st_size or file_digest(original) != copied_hash:
            raise RuntimeError("The selected original changed while retaining it: "+str(original))
        return {"original":str(original), "file":str(target),
                "bytes":before.st_size, "sha256":copied_hash}

    def command(label, argv, input_body=None, timeout=None):
        entry = {"name":label, "argv":argv, "startedAt":now(), "status":"running",
                 "resourcesBefore":resources(), "log":str(base/("stage-%02d.log"%(len(state["stages"])+1)))}
        state["stages"].append(entry); checkpoint()
        report(label, argv=argv, resources=entry["resourcesBefore"])
        proc = subprocess.Popen(argv, stdin=subprocess.PIPE if input_body is not None else subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=environment)
        entry["pid"] = proc.pid; checkpoint()
        reader_errors = []
        def drain():
            try:
                with open(entry["log"], "xb") as log:
                    for line in iter(proc.stdout.readline, b""):
                        log.write(line); log.flush()
                        displayed = line if len(line) <= 8192 else line[:8192]+b"\n[Full output retained in the native stage log.]\n"
                        print(displayed.decode("utf-8", "replace"), end="", flush=True)
                    log.flush(); os.fsync(log.fileno())
            except BaseException as exc:
                reader_errors.append({"type":type(exc).__name__, "message":str(exc)})
        reader = threading.Thread(target=drain, daemon=True); reader.start()
        started = time.monotonic(); last_report = started; interrupted = None
        try:
            if input_body is not None:
                proc.stdin.write(input_body); proc.stdin.close()
            while proc.poll() is None:
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    entry["latestResources"] = resources(); checkpoint()
                    elapsed = time.monotonic()-started
                    if timeout is not None and elapsed >= timeout and not entry.get("terminationRequested"):
                        entry["terminationRequested"] = now()
                        try:
                            proc.terminate()  # The installed CLI forwards this signal to its owned native process group.
                        except ProcessLookupError:
                            pass
                        checkpoint()
                    if time.monotonic()-last_report >= 30:
                        report(label+" active", pid=proc.pid, elapsedSeconds=round(elapsed),
                               resources=entry["latestResources"])
                        last_report = time.monotonic()
        except BaseException as exc:
            interrupted = exc
            if proc.poll() is None:
                try:
                    proc.terminate()
                except ProcessLookupError:
                    pass
            proc.wait()
        finally:
            reader.join()
            entry.update(status="complete" if proc.returncode == 0 and not reader_errors and not interrupted else "interrupted",
                         exit=proc.returncode, completedAt=now(), resourcesAfter=resources())
            if reader_errors:
                entry["logErrors"] = reader_errors
            checkpoint()
        report(label+" finished", exit=proc.returncode, resources=entry["resourcesAfter"])
        if interrupted:
            raise interrupted
        if proc.returncode or reader_errors:
            raise RuntimeError(label+" exited "+str(proc.returncode)+("; output log incomplete" if reader_errors else ""))

    try:
        state["initialResources"] = resources(); checkpoint()
        for spec in (manifest_attachment, launcher_attachment):
            if not isinstance(spec, dict) or not spec.get("file_upload_id") or not \
                    (spec.get("sha256") or spec.get("gitBlobSha1")) or not isinstance(spec.get("bytes"), int):
                raise ValueError("Use each published complete attachment's exact ID, byte count and digest")
        manifest_body = attach(manifest_attachment, "carbon-native-source-manifest.json")
        manifest = json.loads(manifest_body)
        if manifest.get("schema") != "stellar-forge.native-source-manifest.v1" or manifest.get("operation") != operation:
            raise ValueError("Select the complete original carbon native source manifest")
        if manifest.get("capabilities", {}).get("resumeFrom") != "preserved-output-v1":
            raise ValueError("Select the complete source edition implementing preserved-output continuation")
        if manifest.get("totalFiles") != len(manifest.get("files", [])) or \
                manifest.get("totalSourceBytes") != sum(row["bytes"] for row in manifest["files"]):
            raise ValueError("The whole source manifest member totals must agree")
        jobs = [{"file_upload_id":p["fileUploadId"], "name":p["name"],
                 "bytes":p["bytes"], "gitBlobSha1":p["gitBlobSha1"]} for p in manifest["parts"]]
        handover = manifest["handover"]
        if len(handover["partUploads"]) != len(handover["parts"]):
            raise ValueError("Retain all original editable handover parts")
        jobs.extend({"file_upload_id":uid, "name":name} for uid, name in zip(handover["partUploads"], handover["parts"]))
        bootstrap = manifest["bootstrap"]
        jobs.append({"file_upload_id":bootstrap["fileUploadId"], "name":bootstrap["name"],
                     "bytes":bootstrap["bytes"], "gitBlobSha1":bootstrap["gitBlobSha1"]})
        if len({job["name"] for job in jobs}) != len(jobs):
            raise ValueError("Use the original unique source attachment names")
        with ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(attach, jobs))
        command("Receive the complete preserved-output source",
                [node, "--input-type=module", "-", str(downloads), str(source)],
                (downloads/bootstrap["name"]).read_bytes(), timeout=120)

        retained = source/"receiving/preserved-operation"
        retained.mkdir(mode=0o700)
        state["resume"]["receiptOriginal"] = copy_original(receipt_path, retained/"original-receiving.json")
        if state["resume"]["receiptOriginal"]["sha256"] != state["resume"]["receiptSha256"]:
            raise RuntimeError("The original receipt changed during source preparation; preserve this partial continuation")
        old_manifest = old_source/"receiving/source-manifest.json"
        if old_manifest.is_file():
            state["resume"]["sourceManifest"] = copy_original(old_manifest, retained/"original-source-manifest.json")
        candidate = Path(capture_options).resolve(strict=True) if capture_options else \
                    (old_output/"givecredit-capture-options.json" if (old_output/"givecredit-capture-options.json").is_file()
                     else old_source/"receiving/public-ledger-inputs/capture-options.json")
        state["captureOptions"] = copy_original(candidate, retained/"capture-options.json")
        for name in ("archive-inputs.json", "sequence-inspection.json"):
            original = old_source/"receiving/public-ledger-inputs"/name
            if original.is_file():
                state.setdefault("originalSelections", []).append(copy_original(original, retained/name))
        selected_checkpoint = Path(capture_checkpoint).resolve(strict=True) if capture_checkpoint else old_output/"givecredit-ledger-capture-checkpoint.json"
        if selected_checkpoint.is_file():
            state["captureCheckpoint"] = {"path":str(selected_checkpoint), "bytes":selected_checkpoint.stat().st_size,
                                         "sha256":file_digest(selected_checkpoint), "explicit":capture_checkpoint is not None}

        programme = Path(programme_path or __file__).resolve(strict=True)
        state["programme"] = copy_original(programme, source/"receiving/continue-hosted.py")
        launcher_body = attach(launcher_attachment, launcher_attachment.get("name") or "carbon-native-installed-launcher-preserved-output-v1.json")
        launcher_carrier = json.loads(launcher_body)
        if launcher_carrier.get("schema") != "stellar-forge.carbon-native-launcher-source.v1" or launcher_carrier.get("operation") != operation:
            raise ValueError("Use the complete installed launcher for this original operation")
        launcher_path = downloads/(launcher_attachment.get("name") or "carbon-native-installed-launcher-preserved-output-v1.json")
        launcher = source/"receiving/installed-launcher"
        command("Receive the complete installed saved-output launcher",
                [node, "--input-type=module", "-", str(launcher_path), str(launcher)],
                launcher_carrier["bootstrap"].encode("utf-8"), timeout=120)
        launcher_cli = launcher/launcher_carrier["entryPoint"]
        state["installedLauncher"] = {"root":str(launcher), "cli":str(launcher_cli),
                       "carrierSha256":digest(launcher_body), "sourceFiles":launcher_carrier["totalFiles"],
                       "sourceBytes":launcher_carrier["totalSourceBytes"]}
        command("Inspect the complete selected source and recovery capability",
                [node, str(launcher_cli), "inspect-source", "--source-root", str(source)], timeout=120)

        bundle = Path(bundle_path).resolve(strict=True) if bundle_path else \
                 old_source/"receiving/stellar-sdk-16.3.1/stellar-sdk-16.3.1.cjs"
        bundle_identity = copy_original(bundle, retained/"stellar-sdk-16.3.1-original.min.js.txt")
        if bundle_identity["bytes"] != 487628 or bundle_identity["sha256"] != \
                base64.b64decode("ZEWtWqGPz98s2AlXZtmX4YwaBLKJBz21Tnrq5DzBxD8=").hex():
            raise ValueError("Retain the exact original published Stellar SDK16.3.1 bundle")
        donor = source/"receiving/stellar-sdk-16.3.1"
        command("Load the retained complete original published SDK",
                [node, str(launcher_cli), "sdk", "--bundle", str(retained/"stellar-sdk-16.3.1-original.min.js.txt"),
                 "--metadata", str(source/"receiving/sdk-originals/stellar-sdk-16.3.1-original-npm-metadata.json"),
                 "--output", str(donor)], timeout=180)
        sdk = donor/"stellar-sdk-16.3.1.mjs"
        selected_accounting = accounting_directory
        accounting = next((row.get("value") for row in reversed(receipt.get("stages", []))
                           if row.get("name") == "Original maintained accounting case and linked draft preparation"
                           and row.get("status") == "complete" and isinstance(row.get("value"), dict)), None)
        if accounting is None and (old_output/"accounting/case-result.json").is_file():
            accounting = json.loads((old_output/"accounting/case-result.json").read_bytes())
        if selected_accounting is None and accounting:
            selected_accounting = accounting.get("directory")
        native_argv = [node, str(launcher_cli), "run", "--source-root", str(source),
                       "--resume-from", str(old_output), "--output", str(output),
                       "--chromium", chromium, "--sdk-module", str(sdk),
                       "--capture-options", str(retained/"capture-options.json"),
                       "--archive-path", str(archive), "--actor", "379A native receiving operator"]
        if selected_accounting:
            selected_accounting = str(Path(selected_accounting).resolve(strict=True))
            native_argv.extend(["--accounting-directory", selected_accounting])
            state["accountingDirectory"] = selected_accounting
        if accounting and accounting.get("binding"):
            binding = accounting["binding"]
            for key, flag in (("workspaceId", "--expected-accounting-workspace-id"),
                              ("sourcesSha256", "--expected-accounting-sources-sha256")):
                if binding.get(key):
                    native_argv.extend([flag, binding[key]])
        if capture_checkpoint:
            native_argv.extend(["--capture-checkpoint", str(selected_checkpoint)])
        state.update(status="operating", sdk=str(sdk), chromium=chromium); checkpoint()
        command("Continue both saved applications through the complete browser and receiving workflow",
                native_argv, timeout=timeout_seconds)
        command("Verify the completed closed native archive",
                [node, str(launcher_cli), "verify", "--output", str(output), "--archive-path", str(archive)])
        state["status"] = "complete"
    except BaseException as exc:
        state["status"] = "interrupted"
        state["error"] = {"type":type(exc).__name__, "message":str(exc)}
        report("Preserved application continuation", **state["error"])
    finally:
        state["completedAt"] = now(); state["finalResources"] = resources(); checkpoint()
        target = archive
        if state["status"] != "complete" or not archive.is_file():
            target = base/"SCF_Carbon_GiveCredit_Preserved_Recovery_379A_20261013.tar.gz"
            with tarfile.open(target, "w:gz") as saved:
                saved.add(state_path, arcname="native-continuation.json")
                for folder in (source, output, downloads):
                    if folder.is_dir():
                        saved.add(folder, arcname=folder.name)
                for original in sorted(base.glob("stage-*.log")):
                    saved.add(original, arcname=original.name)
                for original in (archive, Path(str(archive)+".json")):
                    if original.is_file():
                        saved.add(original, arcname="retained-native-archive/"+original.name)
                for suffix in (".invocation.json", ".post-archive-error.json", ".live-reopened.json"):
                    original = Path(str(output)+suffix)
                    if original.is_file():
                        saved.add(original, arcname=original.name)
        transport = base/"SCF_Carbon_GiveCredit_Continuation_Transport_379A_20261013.tar.gz"
        with tarfile.open(transport, "w:gz") as saved:
            saved.add(state_path, arcname="native-continuation.json")
            for original in sorted(base.glob("stage-*.log")):
                saved.add(original, arcname=original.name)
            for suffix in (".invocation.json", ".post-archive-error.json", ".live-reopened.json"):
                original = Path(str(output)+suffix)
                if original.is_file():
                    saved.add(original, arcname=original.name)
        uploads = [{"local_path":str(target), "purpose":"create_library_file", "library_artifact_type":"other"},
                   {"local_path":str(transport), "purpose":"create_library_file", "library_artifact_type":"other"}]
        descriptor = Path(str(archive)+".json")
        if target == archive and descriptor.is_file():
            uploads.append({"local_path":str(descriptor), "purpose":"create_library_file", "library_artifact_type":"other"})
        state["archive"] = {"path":str(target), "bytes":target.stat().st_size, "sha256":file_digest(target)}
        state["transport"] = {"path":str(transport), "bytes":transport.stat().st_size, "sha256":file_digest(transport)}
        try:
            helper_root = str(Path(library_helpers).resolve(strict=True))
            if helper_root not in sys.path:
                sys.path.insert(0, helper_root)
            from library_upload import LibraryUploadWorkflow, LibraryFileMaterializer, SignedUrlUploader
            response = LibraryUploadWorkflow(apps_client=client, materializer=LibraryFileMaterializer(),
                      uploader=SignedUrlUploader(), state_parent=base/"tmp").run({"uploads":uploads})
            with (base/"save-result.json").open("x", encoding="utf-8") as handle:
                json.dump(response, handle, ensure_ascii=False, indent=2); handle.write("\n")
            state["saveResponse"] = response
            state["saveExit"] = 0 if response.get("results") and all(
                item.get("status") == "succeeded" for item in response["results"]) else 1
            identities = []
            def collect(value):
                if isinstance(value, dict):
                    item = {key:value[key] for key in ("library_file_id", "file_id", "version", "version_id",
                                                       "library_path", "filename", "status") if key in value}
                    if item:
                        identities.append(item)
                    for child in value.values():
                        collect(child)
                elif isinstance(value, list):
                    for child in value:
                        collect(child)
            collect(response)
            report("Whole preserved native result saved", exit=state["saveExit"], files=identities,
                   archive=state["archive"], transport=state["transport"])
        except BaseException as exc:
            state["saveError"] = {"type":type(exc).__name__, "message":str(exc)}
            report("Whole preserved native result retained", archive=state["archive"], saveError=state["saveError"])
        checkpoint()
        report("Saved-operation outcome", status=state["status"], base=str(base),
               source=str(source), output=str(output), archive=state["archive"])
    return state
