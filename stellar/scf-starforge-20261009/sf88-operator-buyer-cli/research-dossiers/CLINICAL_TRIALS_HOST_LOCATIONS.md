# Receiving an existing ClinicalTrials dossier on another host

The ClinicalTrials example can continue an existing reviewed request after its complete working directory is moved to another host or filesystem. The reviewed options file remains unchanged. A separate file selects the current host paths.

Keep the complete original sender directory, receiving directory, output directory and workflow journal together. Preserve the original request, dossier, question, prepared operation, input SHA and source-packet SHA. The original input packet can be copied to another canonical local path if its exact bytes are preserved.

Create a locations JSON file with exactly these four keys:

```json
{
  "sourcePacket": "/absolute/path/to/original-source-packet.zip",
  "workspaceDirectory": "/absolute/path/to/copied-workspace/sender",
  "receivingDirectory": "/absolute/path/to/copied-workspace/receiver",
  "outputDirectory": "/absolute/path/to/copied-workspace/outputs"
}
```

Then pass the original options file and the current host locations file to the maintained example:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/examples/clinical-trials-dossier.mjs original-options.json current-locations.json
```

The JavaScript API accepts the same selection as its second argument:

```js
await runClinicalTrialsDossierExample(originalOptions, { locations });
```

All four selected paths must be canonical absolute paths. The sender and receiver remain separate. The original options still determine the retained input SHA. Native preparation, source validation, selected-edition validation, Research receiving and revision recovery continue through their existing APIs and original operation IDs. The selected source packet is checked against the original SHA before it is used.

For an already completed workflow, the driver locates the retained report files in the current output directory and checks their original byte lengths and SHAs. It returns the current paths with the original recorded paths retained. Cohort analysis consumes the existing receiving edition, retaining all original source occurrences.

The locations file does not copy files or replace a current workspace. Select a complete original checkpoint. To receive only the completed customer dossier into a new Research workspace, use the existing portable receiving API on the generated `clinicaltrials-dossier.json.gz`.

The ordinary command without a locations file continues to use the paths from its original options file.
