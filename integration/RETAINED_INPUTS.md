# Reuse retained scientific inputs

Regional source manifests can reference the same original national archive from several prepared entries. The maintained importer previously copied that archive into another temporary file before discovering that its content-addressed object already existed. This consumed both write bandwidth and a second archive's worth of free disk on every repeated intake.

This function-local overlay changes `model.common.retain_file` while preserving its arguments, return fields and resulting content identities:

- A supplied SHA256 selects the existing object before any temporary file is created. The selected source and retained object are checked, then the original object is reused.
- A lock for that exact object serializes concurrent imports of the same known source. Different source objects remain independent.
- A known-hash copy uses one recoverable temporary path. Resuming after a killed importer truncates only that operation's unfinished copy; repeated interruptions cannot accumulate more copies of that archive.
- New retained objects are installed atomically without replacing an existing object. External mutable sources remain separate files.
- When the selected source is already a verified hard link to the retained object, its bytes are read once. Other source/object pairs are verified independently.

## Apply in the current application

Use the same maintained source-context installer already supplied with the selected-model core. Apply this overlay after that core and preserve newer unrelated work:

```sh
python3 integration/apply_selected_model_overlay.py /absolute/current/application \
  --packet integration/retained-inputs-overlay.json
```

The single replacement changes only `retain_file`. The installer parses the resulting source, retains the prior file, and reports the exact resulting hash. Its packet includes the complete resulting common module as a reference, while the installer merges only the named function context.

The native receiving check is to import the same real climate source manifest twice and confirm the same collection ID, unchanged input bodies and no second archive-size temporary copy. Existing source and model identifiers keep their original meaning. Continue directly into the actual regional model job afterward.

The recoverable temporary names belong to this importer and its exact source hash. Existing unrelated workspace files and retained results are untouched.

Authored by TokenJunkieLabs.
