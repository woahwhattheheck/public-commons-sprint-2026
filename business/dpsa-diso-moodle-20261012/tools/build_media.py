#!/usr/bin/env python3
"""Render editable DISO module scripts as low-bandwidth MP4 presentations and captions."""
from __future__ import annotations
import argparse, hashlib, html, json, math, os, re, shutil, subprocess, tempfile, textwrap, wave
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT, FPS = 960, 540, 10
def require(ok, message):
    if not ok: raise RuntimeError(message)
def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()
def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()
def metadata(root, file):
    return {"path": file.relative_to(root).as_posix(), "bytes": file.stat().st_size, "sha256": digest(file)}
def font(size, bold=False):
    names = ["/usr/share/fonts/truetype/dejavu/DejaVuSans" + ("-Bold" if bold else "") + ".ttf",
             "/usr/share/fonts/truetype/liberation2/LiberationSans-" + ("Bold" if bold else "Regular") + ".ttf",
             "/Library/Fonts/Arial" + (" Bold" if bold else "") + ".ttf"]
    for name in names:
        if Path(name).is_file(): return ImageFont.truetype(name, size)
    try: return ImageFont.truetype("DejaVuSans" + ("-Bold" if bold else "") + ".ttf", size)
    except OSError: raise RuntimeError("Provide an installed readable TrueType presentation font")
def wrap_pixels(draw, value, face, width):
    lines, current = [], ""
    for word in value.split():
        trial = (current + " " + word).strip()
        if current and draw.textlength(trial, font=face) > width:
            lines.append(current); current = word
        else: current = trial
    if current: lines.append(current)
    return lines
def captions(text):
    result = []
    for sentence in re.split(r"(?<=[.!?])\s+", text.strip()):
        result.extend(textwrap.wrap(sentence, 105, break_long_words=False, break_on_hyphens=False))
    require(result, "Every module scene has a complete narration")
    return result
def stamp(seconds, srt=False):
    milliseconds = round(seconds * 1000)
    hours, milliseconds = divmod(milliseconds, 3600000)
    minutes, milliseconds = divmod(milliseconds, 60000)
    seconds, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02}:{minutes:02}:{seconds:02}" + ("," if srt else ".") + f"{milliseconds:03}"
def frame(file, video, scene, caption, number, total):
    image = Image.new("RGB", (WIDTH, HEIGHT), "white"); draw = ImageDraw.Draw(image)
    label, titleface, bodyface, captionface = font(17, True), font(32, True), font(25), font(22)
    draw.text((42, 24), video["moduleId"] + "  |  DISO PUBLIC SERVICE", font=label, fill="#505050")
    draw.text((870, 24), f"{number}/{total}", font=label, fill="#505050")
    draw.line((42, 60, 918, 60), fill="#303030", width=2)
    titlelines = wrap_pixels(draw, scene["heading"], titleface, 868)
    require(len(titlelines) <= 2, "Presentation heading needs a shorter editable line: " + scene["id"])
    y = 78
    for line in titlelines:
        draw.text((42, y), line, font=titleface, fill="#202020"); y += 40
    y += 16
    for point in scene["onScreen"]:
        lines = wrap_pixels(draw, point, bodyface, 818)
        for n, line in enumerate(lines):
            draw.text((47 if n == 0 else 76, y), ("•  " if n == 0 else "") + line, font=bodyface, fill="#242424")
            y += 34
        y += 13
    require(y < 411, "Edit an overfull scene before rendering: " + scene["id"])
    draw.rounded_rectangle((30, 427, 930, 524), radius=3, fill="#eeeeee", outline="#b0b0b0", width=1)
    lines = wrap_pixels(draw, caption, captionface, 858)
    require(len(lines) <= 3, "Readable caption does not fit its original frame")
    y = 438 + max(0, (3 - len(lines)) * 13)
    for line in lines:
        draw.text((51, y), line, font=captionface, fill="#202020"); y += 26
    image.save(file, optimize=True)
def choose_ffmpeg(explicit):
    if explicit: return str(Path(explicit).resolve())
    binary = shutil.which("ffmpeg")
    if binary: return binary
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError: raise RuntimeError("Use the worker's installed FFmpeg executable")
def speech_engine(mode, explicit):
    if mode == "captioned": return None
    binary = explicit or shutil.which("espeak-ng") or shutil.which("espeak") or shutil.which("say")
    require(binary or mode == "auto", "A local speech executable is required by this receiving configuration")
    return binary
def speak(binary, text, destination, ffmpeg, voice):
    textfile = destination.with_suffix(".txt"); textfile.write_text(text, encoding="utf-8")
    name = Path(binary).name
    if name == "say":
        aiff = destination.with_suffix(".aiff")
        command = [binary, "-r", "145", "-o", str(aiff), "-f", str(textfile)]
        if voice: command[1:1] = ["-v", voice]
        subprocess.run(command, check=True, capture_output=True)
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(aiff),
                        "-ac", "1", "-ar", "22050", "-c:a", "pcm_s16le", str(destination)], check=True)
    else:
        command = [binary, "-s", "145", "-w", str(destination), "-f", str(textfile)]
        if voice: command[1:1] = ["-v", voice]
        subprocess.run(command, check=True, capture_output=True)
    with wave.open(str(destination), "rb") as audio:
        require(audio.getnchannels() == 1 and audio.getsampwidth() == 2, "Native speech is mono16-bit PCM")
        return audio.getframerate(), audio.readframes(audio.getnframes())
def render(source, output, ffmpeg, mode, speech, voice):
    scriptfile = source / "media/scripts.json"; raw = scriptfile.read_bytes(); scripts = json.loads(raw)
    require(scripts["schema"] == "dpsa.diso.media.v1" and len(scripts["videos"]) == 13, "Complete13-module editable media scripts required")
    require(len({item["moduleId"] for item in scripts["videos"]}) == 13, "Unique native module presentation identities")
    catalog = {item["id"]: item for item in json.loads((source / "sources.json").read_text())["sources"]}
    output.mkdir(parents=True, exist_ok=True)
    manifest = {"schema": "dpsa.diso.rendered-media.v1", "scriptSha256": hashlib.sha256(raw).hexdigest(),
                "frameSize": [WIDTH, HEIGHT], "framesPerSecond": FPS, "speechExecutable": Path(speech).name if speech else None,
                "videos": [], "files": []}
    for video in scripts["videos"]:
        require(len(video["scenes"]) >= 4 and video["sourceIds"], "Complete substantive source-linked presentation: " + video["id"])
        folder = output / video["moduleId"]; frames = folder / "frames"; frames.mkdir(parents=True, exist_ok=True)
        subtitles, concat, clock, counter = [], [], 0.0, 0
        with tempfile.TemporaryDirectory(prefix="diso-media-") as temporary:
            work = Path(temporary); pcm = bytearray(); rate = None
            for position, scene in enumerate(video["scenes"], 1):
                pieces = captions(scene["narration"])
                for caption in pieces:
                    counter += 1; image = frames / f"caption-{counter:03}.png"
                    frame(image, video, scene, caption, position, len(video["scenes"]))
                    if speech:
                        frequency, data = speak(speech, caption, work / f"caption-{counter:03}.wav", ffmpeg, voice)
                        rate = rate or frequency
                        require(rate == frequency, "Keep one original speech sample rate per presentation")
                        duration = math.ceil((len(data) / (rate * 2) + .22) * FPS) / FPS
                        samples = round(duration * rate)
                        pcm.extend(data); pcm.extend(b"\0" * max(0, samples * 2 - len(data)))
                    else:
                        duration = max(3.0, len(caption.split()) / 145 * 60 + .7)
                        duration = math.ceil(duration * FPS) / FPS
                    subtitles.append({"start": clock, "end": clock + duration, "text": caption, "sceneId": scene["id"]})
                    clock += duration
                    quoted = str(image.resolve()).replace("'", "'\\''")
                    concat.extend(["file '" + quoted + "'", f"duration {duration:.3f}"])
            require(counter > 4 and clock > 30, "Substantive complete module presentation")
            concat.append(concat[-2]); playlist = work / "frames.ffconcat"
            playlist.write_text("\n".join(concat) + "\n")
            base = folder / video["id"]; mp4 = base.with_suffix(".mp4")
            command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(playlist)]
            wav = work / "narration.wav"
            if speech:
                with wave.open(str(wav), "wb") as audio:
                    audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(rate); audio.writeframes(pcm)
                command += ["-i", str(wav)]
            command += ["-map", "0:v:0", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-threads", "2",
                        "-r", str(FPS), "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", f"{clock:.3f}"]
            if speech: command += ["-map", "1:a:0", "-c:a", "aac", "-b:a", "48k"]
            command.append(str(mp4)); subprocess.run(command, check=True)
            mp3 = None
            if speech:
                mp3 = base.with_suffix(".mp3")
                subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
                                "-c:a", "libmp3lame", "-b:a", "48k", str(mp3)], check=True)
        srt, vtt = base.with_suffix(".srt"), base.with_suffix(".vtt")
        srt.write_text("\n\n".join(str(i) + "\n" + stamp(item["start"], True) + " --> " + stamp(item["end"], True) +
                                 "\n" + item["text"] for i, item in enumerate(subtitles, 1)) + "\n", encoding="utf-8")
        vtt.write_text("WEBVTT\n\n" + "\n\n".join(stamp(item["start"]) + " --> " + stamp(item["end"]) +
                       "\n" + html.escape(item["text"]) for item in subtitles) + "\n", encoding="utf-8")
        poster = base.with_suffix(".png"); shutil.copyfile(frames / "caption-001.png", poster)
        transcript = base.with_suffix(".html")
        transcript.write_text("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
            "<title>" + html.escape(video["title"]) + "</title><style>body{font:17px/1.6 system-ui;color:#222;max-width:55rem;margin:auto;padding:2rem}a{color:inherit}h2{border-top:1px solid #777;padding-top:1rem}</style>" +
            "<h1>" + html.escape(video["title"]) + "</h1>" + "".join("<h2>" + html.escape(scene["heading"]) +
            "</h2><p>" + html.escape(scene["narration"]) + "</p>" for scene in video["scenes"]) +
            "<h2>Primary sources</h2><ul>" + "".join('<li><a href="' + html.escape(catalog[key]["url"], quote=True) + '">' +
            html.escape(catalog[key]["title"]) + "</a></li>" for key in video["sourceIds"]) + "</ul></html>", encoding="utf-8")
        delivered = [mp4, vtt, srt, transcript, poster] + ([mp3] if mp3 else [])
        item = {"id": video["id"], "moduleId": video["moduleId"], "title": video["title"],
            "durationSeconds": round(clock, 3), "sceneCount": len(video["scenes"]), "captionCount": counter,
            "mode": "narrated-captioned" if speech else "captioned", "sourceIds": video["sourceIds"],
            "videoFile": mp4.relative_to(output).as_posix(), "captionsFile": vtt.relative_to(output).as_posix(),
            "transcriptFile": transcript.relative_to(output).as_posix(), "posterFile": poster.relative_to(output).as_posix(),
            "audioFile": mp3.relative_to(output).as_posix() if mp3 else None,
            "files": [metadata(output, file) for file in delivered]}
        manifest["videos"].append(item)
        print(json.dumps({"moduleId": video["moduleId"], "durationSeconds": item["durationSeconds"], "mode": item["mode"], "videoBytes": mp4.stat().st_size}), flush=True)
    manifest["files"] = [metadata(output, file) for file in sorted(output.rglob("*")) if file.is_file() and file.name != "media.json"]
    (output / "media.json").write_bytes(encoded(manifest))
    return {"state": "COMPLETE", "videos": len(manifest["videos"]), "durationSeconds": round(sum(v["durationSeconds"] for v in manifest["videos"]), 3),
            "mode": "narrated-captioned" if speech else "captioned", "manifest": str(output / "media.json"), "files": len(manifest["files"])}
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True); parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ffmpeg"); parser.add_argument("--speech-executable"); parser.add_argument("--voice")
    parser.add_argument("--speech-mode", choices=["auto", "require", "captioned"], default="auto")
    args = parser.parse_args()
    print(json.dumps(render(args.source.resolve(), args.output.resolve(), choose_ffmpeg(args.ffmpeg),
        args.speech_mode, speech_engine(args.speech_mode, args.speech_executable), args.voice), indent=2))
