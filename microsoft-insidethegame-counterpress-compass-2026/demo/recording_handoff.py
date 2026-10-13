#!/usr/bin/env python3
"""Package the original Counterpress recording without a new capture or model call."""
import argparse, decimal, fcntl, hashlib, html, json, os, pathlib, shutil, subprocess, zipfile
SCHEMA="counterpress.recorded-handover.v1"
MOVIE="Counterpress_Compass_Running_Demo.mkv"
ZIP_NAME="Counterpress_Compass_Recorded_Demo_and_Editable_Product.zip"
def sha(path):
    h=hashlib.sha256()
    with open(path,"rb") as f:
        for block in iter(lambda:f.read(1024*1024),b""):h.update(block)
    return h.hexdigest()
def raw_sha(data):return hashlib.sha256(data).hexdigest()
def git_blob(data):return hashlib.sha1(b"blob "+str(len(data)).encode()+b"\0"+data).hexdigest()
def safe_rel(value):
    p=pathlib.PurePosixPath(value)
    if not value or p.is_absolute() or ".." in p.parts or "\\" in value:raise ValueError("Unsafe relative member")
    return p
def stable_write(path,data):
    path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    if isinstance(data,str):data=data.encode("utf-8")
    if path.exists():
        if path.read_bytes()!=data:raise ValueError("Existing retained bytes differ: "+str(path))
        return
    part=path.with_name(path.name+".part");previous=part.read_bytes() if part.exists() else b""
    if not data.startswith(previous):raise ValueError("Retained partial differs: "+str(part))
    with open(part,"ab") as f:f.write(data[len(previous):]);f.flush();os.fsync(f.fileno())
    os.replace(part,path);fd=os.open(path.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)
def write_json(path,value):stable_write(path,json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+"\n")
def command(args,log):
    with open(log,"ab",buffering=0) as stream:
        run=subprocess.run(args,stdin=subprocess.DEVNULL,stdout=stream,stderr=subprocess.STDOUT)
    if run.returncode:raise RuntimeError("Command failed "+str(run.returncode)+": "+pathlib.Path(args[0]).name+"; "+str(log))
def identify(path):return {"bytes":path.stat().st_size,"sha256":sha(path)}
def jpeg_size(path):
    with open(path,"rb") as f:
        if f.read(2)!=b"\xff\xd8":raise ValueError("Not JPEG")
        while True:
            b=f.read(1)
            if not b:raise ValueError("Missing JPEG size")
            if b!=b"\xff":continue
            while b==b"\xff":b=f.read(1)
            mark=b[0]
            if mark in (0xd8,0xd9) or 0xd0<=mark<=0xd7:continue
            length=int.from_bytes(f.read(2),"big")
            if length<2:raise ValueError("Bad JPEG marker")
            if mark in (0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf):
                s=f.read(5);return (int.from_bytes(s[3:5],"big"),int.from_bytes(s[1:3],"big"))
            f.seek(length-2,1)
def concat_quote(value):return "'"+str(value).replace("'","'\\''")+"'"
def build(args):
    root=pathlib.Path(args.output).resolve();root.mkdir(parents=True,exist_ok=True)
    lock=open(root/".handoff.lock","a+b");fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    payload=pathlib.Path(args.source_input);selection=json.loads(payload.read_text())
    capture=pathlib.Path(selection["captureRoot"]).resolve()
    captured_source=pathlib.Path(selection["capturedSourceRoot"]).resolve()
    manifest=selection["receivingManifest"]
    checkpoint_path=capture/"capture-recovery.private.json";checkpoint_bytes=checkpoint_path.read_bytes()
    checkpoint=json.loads(checkpoint_bytes)
    if checkpoint.get("phase")!="captured":raise ValueError("Original recording is not captured")
    frames=checkpoint["frames"];seconds=float(checkpoint["duration"])
    if len(frames)!=154 or abs(seconds-112.018194305)>.000001:raise ValueError("Unexpected original recording")
    raw_concat=(capture/"capture.concat").read_bytes();lines=raw_concat.decode().splitlines()
    file_lines=[s for s in lines if s.startswith("file ")]
    durations=[decimal.Decimal(s.split(" ",1)[1]) for s in lines if s.startswith("duration ")]
    if len(file_lines)!=155 or len(durations)!=154:raise ValueError("Unexpected original concat")
    public=root/"handover";public.mkdir(exist_ok=True)
    recording=public/"Recording";recording.mkdir(exist_ok=True)
    reviewdir=public/"Review";reviewdir.mkdir(exist_ok=True)
    records=[];timing=decimal.Decimal(0)
    for i,frame in enumerate(frames):
        relative="frames/frame-"+str(i).zfill(6)+".jpg"
        if pathlib.Path(frame["file"]).name!=pathlib.Path(relative).name:raise ValueError("Frame index differs")
        if file_lines[i]!="file '"+relative+"'":raise ValueError("Original concat path differs")
        p=capture/relative
        if p.is_symlink() or not p.is_file():raise ValueError("Missing original frame")
        width,height=jpeg_size(p)
        records.append({"file":relative,"at":float(frame["at"]),"durationSeconds":str(durations[i]),
                        "containerStartSeconds":float(timing),"width":width,"height":height,**identify(p)})
        timing+=durations[i]
    if file_lines[-1]!="file '"+records[-1]["file"]+"'":raise ValueError("Terminal frame differs")
    if sum(r["bytes"] for r in records)!=19690604:raise ValueError("Original frame total differs")
    if len({(r["width"],r["height"]) for r in records})!=1:raise ValueError("Recorded dimensions change")
    repeated={**records[-1],"containerStartSeconds":float(timing)}
    public_review=capture/"prepared/captured-review-for-recovery.json"
    coach=json.loads(public_review.read_text())
    if coach.get("format")!="counterpress.coach-review.v1":raise ValueError("Original coach format missing")
    if [len(m["package"]["match"]["events"]) for m in coach["matches"]]!=[941,948]:raise ValueError("Complete match counts differ")
    for m in coach["matches"]:
        if set(m["package"])!={"format","match","review"}:raise ValueError("Owner wrapper in public input")
    binding={"schema":SCHEMA,"sourceInputSha256":sha(payload),"captureCheckpointSha256":raw_sha(checkpoint_bytes),
             "concatSha256":raw_sha(raw_concat),"frameCount":154,"frameBytes":19690604,
             "reviewSha256":sha(public_review),"receivingRef":manifest["ref"]}
    write_json(root/"INPUT_BINDING.private.json",binding)
    stable_write(recording/"capture.concat",raw_concat)
    portable_lines=["ffconcat version 1.0"];execution_lines=["ffconcat version 1.0"]
    for i,rec in enumerate(records):
        for target,path in ((portable_lines,rec["file"]),(execution_lines,str(capture/rec["file"]))):
            target.extend(["file "+concat_quote(path),"option framerate 1000","duration "+str(durations[i])])
    for target,path in ((portable_lines,records[-1]["file"]),(execution_lines,str(capture/records[-1]["file"]))):
        target.extend(["file "+concat_quote(path),"option framerate 1000"])
    stable_write(recording/"copy.ffconcat","\n".join(portable_lines)+"\n")
    stable_write(root/"copy-input.private.ffconcat","\n".join(execution_lines)+"\n")
    for name in ["captions.vtt","captions.srt","captions.ass"]:stable_write(recording/name,(capture/name).read_bytes())
    movie=recording/MOVIE
    if not movie.exists():
        part=movie.with_name(movie.name+".part")
        if part.exists():
            failed=movie.with_name(movie.name+".interrupted-"+sha(part)[:16])
            if failed.exists():raise ValueError("Earlier partial video remains")
            os.replace(part,failed)
        argv=[args.ffmpeg,"-hide_banner","-nostdin","-loglevel","warning","-threads","1",
              "-f","concat","-safe","0","-i",str(root/"copy-input.private.ffconcat"),
              "-i",str(recording/"captions.srt"),"-map","0:v:0","-map","1:s:0","-c","copy",
              "-metadata","title=Counterpress Compass: original captured operator journey",
              "-metadata:s:s:0","language=eng","-f","matroska",str(part)]
        command(argv,root/"stream-copy.log")
        with open(part,"rb") as f:os.fsync(f.fileno())
        os.replace(part,movie)
    verify_records=records+[repeated]
    argv=[args.ffprobe,"-v","error","-show_format","-show_streams","-show_packets","-show_data_hash","sha256","-of","json",str(movie)]
    probe=subprocess.run(argv,stdin=subprocess.DEVNULL,capture_output=True)
    if probe.returncode:raise RuntimeError(probe.stderr.decode("utf-8","replace"))
    measured=json.loads(probe.stdout)
    vstreams=[s for s in measured.get("streams",[]) if s.get("codec_type")=="video"]
    packets=[p for p in measured.get("packets",[]) if p.get("codec_type")=="video"]
    if len(vstreams)!=1 or vstreams[0].get("codec_name")!="mjpeg" or len(packets)!=155:raise ValueError("Expected original MJPEG closure")
    previous=-1.0
    for i,(packet,frame) in enumerate(zip(packets,verify_records)):
        if packet.get("data_hash","").lower()!="sha256:"+frame["sha256"] or int(packet.get("size",0))!=frame["bytes"]:raise ValueError("Copied JPEG differs at "+str(i))
        pts=float(packet["pts_time"])
        if pts<previous or abs(pts-frame["containerStartSeconds"])>.003:raise ValueError("Copied timing differs at "+str(i))
        previous=pts
    actual=float(measured["format"]["duration"])
    if abs(actual-seconds)>.02 or actual>=120:raise ValueError("Captured duration differs")
    subs=[s for s in measured["streams"] if s.get("codec_type")=="subtitle"]
    subtitle_packets=[p for p in measured["packets"] if p.get("codec_type")=="subtitle"]
    if len(subs)!=1 or subs[0].get("codec_name")!="subrip" or not subtitle_packets:raise ValueError("Original subtitles absent")
    proof={"format":"matroska","videoCodec":"mjpeg","videoPackets":155,"distinctRecordedFrames":154,
           "terminalFrameRepeated":True,"allVideoPacketBytesMatchOriginalJpeg":True,
           "originalCapturedDurationSeconds":seconds,"originalConcatDurationSeconds":float(timing),
           "containerDurationSeconds":actual,"videoTimeBase":vstreams[0].get("time_base"),
           "width":vstreams[0]["width"],"height":vstreams[0]["height"],
           "subtitleCodec":"subrip","subtitlePackets":len(subtitle_packets),
           "audio":"The original capture contained no audio.","video":identify(movie)}
    write_json(recording/"VERIFICATION.json",proof)
    write_json(recording/"FRAMES.json",{"schema":"counterpress.original-recorded-frames.v1","capturedDurationSeconds":seconds,
                                      "frames":records,"terminalDuplicate":{"file":repeated["file"],"at":float(timing)}})
    print(json.dumps({"stage":"VIDEO_VERIFIED",**proof}),flush=True)
    if args.through=="video":
        result={"schema":SCHEMA,"stage":"VIDEO_VERIFIED","completeVideo":True,
                "video":{"path":str(movie),**identify(movie)},"recording":proof,
                "sourceInputSha256":sha(payload),"originalCaptureUnchanged":checkpoint_path.read_bytes()==checkpoint_bytes}
        if not result["originalCaptureUnchanged"]:raise ValueError("Original checkpoint changed")
        write_json(root/"VIDEO_RESULT.json",result);print(json.dumps(result),flush=True)
        lock.close();return 0
    source_manifest=[];available_captured=[]
    historical_tools={"demo/capture.mjs","demo/integrated-journey.mjs","demo/README.md"}
    for relative,expected in sorted(checkpoint["source"].items()):
        safe_rel(relative);candidate=captured_source/relative
        available=candidate.is_file() and not candidate.is_symlink() and sha(candidate)==expected
        if not available and relative not in historical_tools:raise ValueError("Unexpected captured source change: "+relative)
        row={"path":relative,"sha256":expected,"bytesAvailable":available}
        if available:
            row["bytes"]=candidate.stat().st_size;available_captured.append((relative,candidate))
        else:
            row["preservation"]="Original checksum retained; this demo tool was changed after the capture. The complete published receiving version is supplied in application/."
        source_manifest.append(row)
    if len(source_manifest)!=58:raise ValueError("Expected original 58-source identity map")
    overlays={v["path"]:v["content"].encode() for v in selection["overlays"]}
    application=public/"application";application.mkdir(exist_ok=True);receiving_files=[]
    for member in manifest["files"]:
        relative=member["path"];safe_rel(relative)
        data=overlays[relative] if relative in overlays else (pathlib.Path(selection["receivingBaseRoot"])/relative).read_bytes()
        if len(data)!=member["bytes"] or git_blob(data)!=member["blob"]:raise ValueError("Receiving source differs: "+relative)
        stable_write(application/relative,data);receiving_files.append({**member,"sha256":raw_sha(data)})
    if len(receiving_files)!=61:raise ValueError("Expected current 61-source closure")
    print(json.dumps({"stage":"SOURCE_READY","capturedIdentities":58,"capturedExactFiles":len(available_captured),"receivingFiles":61,"frames":154}),flush=True)
    stable_write(reviewdir/"Counterpress_Captured_Coach_Review.json",public_review.read_bytes())
    stable_write(reviewdir/"Counterpress_Automatic_Story.json",(capture/"Counterpress_Automatic_Story.json").read_bytes())
    export_script=pathlib.Path(__file__).with_name("customer_exports.mjs")
    command([args.node,str(export_script),str(application),str(reviewdir)],root/"native-exports.log")
    write_json(public/"SOURCE.json",{"schema":"counterpress.recorded-and-receiving-source.v1",
        "repository":manifest["repository"],"prefix":manifest["prefix"],
        "captured":{"identityBasis":"Original recording checkpoint SHA-256 file map","restoration":selection.get("capturedSourceRestoration"),"files":source_manifest},
        "receiving":{"ref":manifest["ref"],"files":receiving_files},
        "distinction":"The original recording preserves its complete 58-file checksum map and all still-available exact source bytes. Three demo tools changed after capture; their original identities remain in this map, and their complete later published versions are in the 61-file receiving application. The video is verified against the original JPEG bytes and timing.",
        "inputReview":identify(public_review),"savedInsights":"The original agent explanation remains in the public review. No model request was made by this handover."})
    readme="""# Counterpress Compass — recorded demo and editable product

Open READ_ME.html for the recording, complete coach review, bilingual player
recaps, standalone broadcast replay and the receiving application.

The Matroska recording contains the original 154 JPEG frames copied byte for byte
as MJPEG packets with their original variable timing. The final duplicate frame
closes the last duration. Original SRT captions are embedded; VTT, SRT and ASS are
also retained. Recording/VERIFICATION.json contains the actual packet-hash,
timing and stream readback. VLC and other Matroska/MJPEG players can open it.

The synthetic high-press and low-block matches contain 941 and 948 events. The
public coach-review JSON preserves the original notes, bookmarked moments,
selections, broadcast cues, evidence and already-saved agent explanation. The
HTML reports use the application's native export functions.

## Open and edit the product

Use Node.js 24 or later. From application/, run:

    node src/server.mjs

Open the loopback address printed by the server. Follow application/README.md
and application/COACH_REVIEW.md; import the full coach-review JSON from Review/.
The original CEDAR broadcaster guide is application/BROADCAST_HANDOVER.md.
The later four-match player-coaching case is included under application/demo/
with its original exporter and instructions.

The original recording's complete 58-file checksum map is in SOURCE.json.
The 55 source files whose bytes still match that map are in source-captured/.
Three demo tools changed after the recording; their original checksums remain
in the map and their complete published versions are in the receiving application.
The current complete 61-file receiving source at
7005be781e3bea1d91ab428f0c884229aa632e90 is in application/.
The video is independently verified against every original JPEG and its timing.

## Reuse the original recording

Recording/capture.concat is the original timeline. Recording/copy.ffconcat
selects a millisecond demuxer clock and retains those duration lines. All 154
original JPEGs are in Recording/frames/.

From Recording/, reproduce the packet-preserving container with:

    ffmpeg -f concat -safe 0 -i copy.ffconcat -i captions.srt -map 0:v:0 -map 1:s:0 -c copy -f matroska copy.mkv

The standalone broadcast's editorial cue times remain the original saved
decisions and are distinct from the full demo narration captions.

This packaging phase performed no source capture, model request, browser
session or external submission. Original entrant attribution and submission
custody remain with the established entrant and operator.

Implementation references:
https://ffmpeg.org/ffmpeg.html#Streamcopy
https://ffmpeg.org/ffmpeg-formats.html#concat
"""
    stable_write(public/"README.md",readme)
    links=[
        ("Review/Counterpress_Captured_Coach_Review.json","Complete editable coach review","Both matches, notes, saved insight and broadcast choices."),
        ("Review/Harbor_High_Press_Broadcast.html","Broadcast handover","Self-contained original-event replay with captions and editable-match downloads."),
        ("Review/Harbor_High_Press_H10_Recap_en.html","H10 player recap · English","Action evidence, pressure roles and first/second-half comparison."),
        ("Review/Harbor_High_Press_H10_Recap_es.html","H10 player recap · Español","The same original events and calculations in Spanish."),
        ("Review/Harbor_Low_Block_H10_Recap_en.html","Low-block comparison","The complete second match with the same player scope."),
        ("application/BROADCAST_HANDOVER.md","Broadcaster receiving guide","CEDAR's full original operating and receiving instructions."),
        ("application/COACH_REVIEW.md","Coach review guide","Import, edit, export and reopen in the current application."),
        ("README.md","Run and reproduce","Local application and packet-preserving recording instructions.")]
    cards="".join('<a class="card" href="'+html.escape(a)+'"><strong>'+html.escape(b)+'</strong><span>'+html.escape(c)+'</span></a>' for a,b,c in links)
    body='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Counterpress Compass · recorded demo and editable product</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#091511;color:#edf7ef;font:17px/1.55 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:42px 24px 64px}.kicker{color:#a8dd93;letter-spacing:.14em;text-transform:uppercase;font-size:12px;font-weight:750}h1{font-size:clamp(32px,5vw,60px);line-height:1.07;max-width:850px;letter-spacing:-.045em;margin:15px 0 22px}.lead{max-width:800px;color:#c6d5ce;font-size:20px}.facts{display:flex;gap:12px;flex-wrap:wrap;margin:28px 0}.facts span{padding:8px 13px;border:1px solid #355447;border-radius:30px;color:#d7ebdd}section{margin-top:34px}h2{font-size:25px}a{color:#c5f7ac}video{display:block;width:100%;max-height:650px;background:#020805;border-radius:14px}.actions{display:flex;gap:16px;flex-wrap:wrap}.button{padding:12px 20px;display:inline-block;background:#c0efac;color:#132015;border-radius:9px;text-decoration:none;font-weight:750}.muted{color:#afc4b6;font-size:14px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}.card{display:block;padding:22px;border:1px solid #355447;border-radius:12px;text-decoration:none;background:#10221a}.card strong{display:block;color:#ecf8e8;font-size:19px}.card span{display:block;color:#adc1b3;font-size:15px;margin-top:8px}footer{border-top:1px solid #355447;margin-top:42px;padding-top:24px;color:#afc4b6;font-size:14px}</style><main><div class="kicker">Counterpress Compass · complete original recording</div><h1>From the full match to a replayable coaching decision.</h1><p class="lead">Watch the recorded operator journey, inspect the original evidence, and continue editing the same complete matches in the supplied application.</p><div class="facts"><span>112.018 seconds captured</span><span>154 original frames</span><span>941 + 948 source events</span><span>English + Spanish recaps</span></div><section><h2>Recorded product demonstration</h2><video controls preload="metadata"><source src="Recording/Counterpress_Compass_Running_Demo.mkv" type="video/x-matroska"><track src="Recording/captions.vtt" kind="captions" srclang="en" label="English" default></video><p class="actions"><a class="button" href="Recording/Counterpress_Compass_Running_Demo.mkv" download>Download the complete recording</a><a href="Recording/captions.vtt">Open narration captions</a></p><p class="muted">This lossless Matroska copy opens in VLC and other MJPEG-capable players. Browser support varies. Every video packet is checked against the original JPEG bytes.</p></section><section><h2>Open the complete handover</h2><div class="grid">'''+cards+'''</div></section><footer>The matches are synthetic development inputs. Saved findings retain original event IDs, source team, counts and observation limits. The recorded source and later receiving release are independently identified in SOURCE.json. Original entrant attribution and submission custody remain with the established entrant and operator.</footer></main></html>'''
    stable_write(public/"READ_ME.html",body)
    toolsdir=public/"tools";toolsdir.mkdir(exist_ok=True)
    stable_write(toolsdir/"recording_handoff.py",pathlib.Path(__file__).read_bytes())
    stable_write(toolsdir/"customer_exports.mjs",export_script.read_bytes())
    entries=[]
    for p in sorted(public.rglob("*")):
        if p.is_file():
            rel=p.relative_to(public).as_posix()
            if rel=="MANIFEST.json" or rel.endswith(".part") or ".interrupted-" in rel:continue
            entries.append((rel,p))
    for rec in records:entries.append(("Recording/"+rec["file"],capture/rec["file"]))
    for relative,path in available_captured:entries.append(("source-captured/"+relative,path))
    if len(entries)!=len({n for n,p in entries}):raise ValueError("Duplicate portable member")
    inventory=[{"path":n,**identify(p)} for n,p in entries]
    write_json(public/"MANIFEST.json",{"schema":SCHEMA,"complete":True,"members":inventory,
               "recording":proof,"originalCaptureUnchanged":True,
               "externalSubmission":"Retained with the original entrant and operator; not invoked by this handoff."})
    entries.append(("MANIFEST.json",public/"MANIFEST.json"));target=root/ZIP_NAME
    if not target.exists():
        part=target.with_name(target.name+".part")
        if part.exists():
            old=target.with_name(target.name+".interrupted-"+sha(part)[:16])
            if old.exists():raise ValueError("Earlier partial ZIP remains")
            os.replace(part,old)
        with zipfile.ZipFile(part,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as z:
            for name,p in sorted(entries):
                zi=zipfile.ZipInfo(name,date_time=(2026,10,12,0,0,0));zi.external_attr=0o100644<<16
                zi.compress_type=zipfile.ZIP_STORED if p.suffix.lower() in (".jpg",".mkv") else zipfile.ZIP_DEFLATED
                with open(p,"rb") as src,z.open(zi,"w") as dest:shutil.copyfileobj(src,dest,1024*1024)
        with open(part,"rb") as f:os.fsync(f.fileno())
        os.replace(part,target)
    with zipfile.ZipFile(target) as z:
        if sorted(z.namelist())!=sorted(n for n,p in entries):raise ValueError("Portable list differs")
        expected={i["path"]:i for i in inventory}
        for name in z.namelist():
            if name=="MANIFEST.json":continue
            h=hashlib.sha256();n=0
            with z.open(name) as f:
                for block in iter(lambda:f.read(1024*1024),b""):h.update(block);n+=len(block)
            if h.hexdigest()!=expected[name]["sha256"] or n!=expected[name]["bytes"]:raise ValueError("Portable member changed: "+name)
    if checkpoint_path.read_bytes()!=checkpoint_bytes:raise ValueError("Original checkpoint changed")
    result={"schema":SCHEMA,"complete":True,"video":{"path":str(movie),**identify(movie)},
            "portable":{"path":str(target),**identify(target),"members":len(entries)},"recording":proof,
            "capturedSourceIdentities":58,"capturedExactSourceFiles":len(available_captured),"receivingSourceFiles":61,"receivingRef":manifest["ref"],
            "publicReview":identify(public_review),"originalCaptureUnchanged":True,"stage":"PORTABLE_RECEIVED"}
    write_json(root/"RESULT.json",result);print(json.dumps(result),flush=True)
    fcntl.flock(lock,fcntl.LOCK_UN);lock.close();return 0
if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--through",choices=["video","portable"],default="portable")
    p.add_argument("--source-input",required=True);p.add_argument("--output",required=True)
    p.add_argument("--node",required=True);p.add_argument("--ffmpeg",default="/usr/bin/ffmpeg")
    p.add_argument("--ffprobe",default="/usr/bin/ffprobe")
    raise SystemExit(build(p.parse_args()))
