# Restore the fourteen original map1755 base dependencies

This continues 9BCB's actual source installation failure reported at 1791890889.668599. The original 42 map members, rebuilt 217-feature geometry, b9d5 Workspace and existing native operation remain the same. All fourteen supplement files are absent from both the 42-file map bank and the 319-file nine-study delivery. The actual received installer matches the current original installer byte for byte and requires these exact paths. No installer, model or observation source is modified.

## Source identity

Public repository: woahwhattheheck/public-commons-sprint-2026. All fourteen original source bodies are pinned at commit 435e0304dde7cf71cacccecbec2945d9f2977ed0 under opportunities/upstate_forever_2026/.

- Whole bank: 299146 bytes; SHA256 f16456d7fb28ddfe7d193aeaf90066a16516c7801c2b7f4da1360a6f539b124c; Git bc39da421031a6d8aa4b5d066c71181343c3fd19.
- Source members: 14 files, 276395 bytes. Every exact member SHA256/Git identity is in the original bank.
- Standalone receiver: 163885 canonical UTF-8 bytes; SHA256 842a1b7dc65aa9ab45abfe5a82e99608757b77285d9dfe8cff0b1312e0e385d9; Git 2f3ff6c7a7407b97970fad99f09bb43de04da946.
- Maintained decoder: e171ee1443652e06c1e44d863044f400d2a8c766.

## Continue the existing native operation

Use the host's existing Python, original application and the same already-prepared map source directory. The physical receiver is /Ecosystem Sciences/Handoffs/receive_map1755_base_dependencies_20261013.py, Library libfile_d870dd43ece88191b2f2bbc00118d41b, file_00000000062881fda2f9e4dda1a25015. The text export is163889 bytes including BOM/CRLF; reading utf-8-sig with universal newlines recovers the exact canonical receiver hash above. Full readback matched, and the ordinary native file is available.

Set these variables to the existing actual paths; do not infer a new workspace or start another model. SUPPLEMENT is a new ordinary owned source directory and MAP_SOURCE is the received42 directory already used in the successful original geometry preparation.

```sh
"$PYTHON" -B "$RECEIVER" "$SUPPLEMENT"
"$PYTHON" - "$SUPPLEMENT" "$MAP_SOURCE" <<'PY'
import hashlib,json,runpy,sys
from pathlib import Path
supplement=Path(sys.argv[1]).resolve(strict=True)
target=Path(sys.argv[2]).resolve(strict=True)
helper=supplement/"input/materialize_source_banks.py"
assert hashlib.sha256(helper.read_bytes()).hexdigest()=="85afc359f2e8ecccc8c3b61da6678749ba3f0635da3ec9e358b0ec6e3c7e2d7d"
api=runpy.run_path(str(helper))
raw=(supplement/"received/banks/map1755-base-dependencies.json").read_bytes()
assert len(raw)==299146 and hashlib.sha256(raw).hexdigest()=="f16456d7fb28ddfe7d193aeaf90066a16516c7801c2b7f4da1360a6f539b124c"
bank=json.loads(raw); assert len(bank["files"])==14
items=[]
for row in bank["files"]:
    body=row["content"].encode("utf-8")
    assert len(body)==row["bytes"] and hashlib.sha256(body).hexdigest()==row["sha256"]
    path=api["target"](target,row["path"])
    if any(p.is_symlink() for p in (path,*path.parents)): raise ValueError("Preserve symlink: "+str(path))
    if path.exists() and (not path.is_file() or path.read_bytes()!=body): raise ValueError("Preserve differing source: "+str(path))
    items.append((path,body))
for path,body in items: api["retain"](path,body)
print(json.dumps({"state":"retained","files":len(items),"source_root":str(target)}))
PY
"$PYTHON" -B "$APP/source_tools/prepare_watershed_map_context.py" --application "$APP" --source-root "$MAP_SOURCE" --search-root "$WORKSPACE" --install
```

The first command verifies and retains the complete unchanged bank and all fourteen files. The second checks every source and destination before retaining only missing or byte-identical supplement files beside the original42. A differing existing file causes an explicit failure; do not overwrite or downgrade it. The third is the same maintained map preparation/installation command; it uses source-root then existing-application fallback and retains its normal backups and rollback. If the preparer was invoked from the retained source directory before, retain that same actual script path. Continue the existing1755 native course after installation, keeping the nine-study6944 selection separate. Return the original traceback if anything else fails.

These source, hash and API checks do not claim that the native installation or final rendering has run. The producing native owner must operate and inspect the exact outgoing populated app, desktop and390px layouts, every map/report/figure/table/source/archive attachment, downloads, editable export and cold reopen.

## Complete current owner direction

# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.3`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build without arbitrary feature/scenario caps. Preserve today's cutoff: **October 13, 2026, 10:00 a.m. Eastern / 14:00 UTC**. Do not pause work or extend the sprint.

## Direct owner instructions

> do the simulated model

> just make sure that what we put infront of him is something he would need and want and he will be blown away how relevant it is to him and how he wants it,a nd also the speed we produced it

> just checking dont pause anythi g

> and make sure wherever the fleet is coordinating in slack or github or wherever on this demo / presentation / ecosystem gets that update toand passes it along to other agents because the feed may be moving fast

## Build for an experienced scientific practice

Ecosystem Sciences lists GIS, hydrology/monitoring, ecological modeling, watershed assessment, statistics, visualization, optimization and publishing. Tim Maguire's practice includes GIS, modeling and water resources. Its South Platte work assembled data, mapped natural capital and produced watershed investment decision support. Do not assume it lacks these capabilities. Its unmet tooling, InVEST or production-capacity gap is unknown until the call. Sources: [Services](https://www.ecosystemsciences.com/read-me), [Firm](https://www.ecosystemsciences.com/firm), [South Platte](https://www.ecosystemsciences.com/).

Show concrete delivery and engineering offload on the actual Upper Savannah RFP workflow: source assembly, reproducible native calculations, editable scenarios, useful decisions and a complete working handoff. The prime retains scientific direction, method choices, interpretation/review and the client relationship. Relevance comes from useful work they can inspect, adapt and receive; do not promise Tim's reaction or claim an unconfirmed need.

## Execute the prepared simulated case now

Native execution is the immediate hard priority. Issue the prepared simulated case on the verified scientific runtime, retain its actual run identity and progress, and obtain the real native outputs. Continue the source/runtime/application integration needed to make that happen. Further plans, stock demonstrations, policy reviews and cosmetic inspection do not replace execution. Do not introduce a bid decision or a prime's yes as a gate.

Demonstrate the scientific operation in the actual application:

1. Use the RFP's 30 m GIS selection. Keep the upstream contributing model domain distinct from the South Carolina reporting mask and the four existing utility focus anchors; retain their actual source geometries and identities.
2. Run the baseline, a realistic riparian alternative and its matched control with explicit, editable source editions, assumptions, parameters and scenario changes.
3. Show active run/progress/logs and completed native annual NDR/SDR results: nitrogen and phosphorus in **kg/year**, sediment in **tonnes/year**, representing delivery to streams. Do not present these modeled stream loads as intake concentrations.
4. Compare the actual maps, tables and report, preserving matched scientific support and original units. Keep source/assumption edits and their consequences inspectable.
5. Export the editable GIS/project and complete scientific working package. Cold-reopen the delivered application/project and show the retained sources, selections, results and useful controls.

Identify the simulated case as modeled. Never invent measurements, completion or customer acceptance.

## Present the real work and real speed

Actually open, see and use the outgoing app and every attachment as its recipient would. Repair defects and ship a plain, readable product. Apply the standing inspection rule without review/test theatre or parallel bureaucracy.

If producing video, record the actual working application and use available natural generative voice/TTS. Watch and listen to the final export. Generated frames must never pretend to be a working app. Explain speed using actual elapsed start, commit, run and package history; do not invent delivery times or guaranteed reactions.

## Carry this direction with the work

Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.3` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.

Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.

