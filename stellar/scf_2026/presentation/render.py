#!/usr/bin/env python3
"""Compose the recorded original UI, readable captions and presenter script."""
import json
import subprocess
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
data = json.loads((root / 'capture.json').read_text())
frames, chapters = data['frames'], data['chapters']
if data['errors'] or len(chapters) != len(data['film']['chapters']) or any('end' not in row for row in chapters):
    raise SystemExit('Recording is incomplete; resolve the actual recorded issue before rendering.')

def ass_time(value):
    value = round(value * 100)
    return f'{value//360000}:{value//6000%60:02}:{value//100%60:02}.{value%100:02}'

def vtt_time(value):
    value = round(value * 1000)
    return f'{value//3600000:02}:{value//60000%60:02}:{value//1000%60:02}.{value%1000:03}'

def escape(value):
    return value.replace('\\', '\\\\').replace('{', '\\{').replace('}', '\\}').replace('\n', r'\N')

ass = ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1920', 'PlayResY: 1080', 'WrapStyle: 0',
       '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
       'Style: Caption,Arial,30,&H00202020,&H00202020,&H00FFFFFF,&H00FFFFFF,0,0,0,0,100,100,0,0,1,0,0,2,110,110,34,1',
       'Style: Heading,Arial,29,&H00202020,&H00202020,&H00FFFFFF,&H00FFFFFF,-1,0,0,0,100,100,0,0,1,0,0,7,96,96,38,1',
       'Style: Label,Arial,17,&H00666666,&H00666666,&H00FFFFFF,&H00FFFFFF,0,0,0,0,100,100,1,0,1,0,0,9,96,96,42,1',
       '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
vtt = ['WEBVTT', '']
script = [data['film']['title'], data['film']['subtitle'], '',
          'Captioned product presentation. The script below matches the recorded captions; no synthetic founder voice or appearance is used.', '']
for chapter in chapters:
    start, end = chapter['start'], chapter['end']
    ass.append(f'Dialogue: 1,{ass_time(start)},{ass_time(end)},Heading,,0,0,0,,{escape(chapter["title"])}')
    ass.append(f'Dialogue: 1,{ass_time(start)},{ass_time(end)},Label,,0,0,0,,{escape(chapter["label"])}')
    script += [f'{vtt_time(start)[:8]} — {chapter["title"]}', ' '.join(chapter['captions']), '']
    count = len(chapter['captions'])
    for index, caption in enumerate(chapter['captions']):
        a, b = start+(end-start)*index/count, start+(end-start)*(index+1)/count
        ass.append(f'Dialogue: 2,{ass_time(a)},{ass_time(b)},Caption,,0,0,0,,{escape(caption)}')
        vtt += [f'{vtt_time(a)} --> {vtt_time(b)}', caption, '']
script += ['Source and interpretation',
           'Original product UI source: '+data['film']['sourceRepository']+'/tree/'+data['sourceCommit'],
           'Native transaction: '+data['transaction'],
           'Original native run source: '+data['originalNativeSource'],
           'Original response: '+str(data['responseBytes'])+' bytes; SHA-256 '+data['responseSha256'],
           'Independent observation: '+data['observationAt'],
           'The live UI recording uses the existing six-method configuration in a separate challenge-only session. The cancellation/reopen action belongs to that recording session. The separately retained native testnet result is not represented as a payment made by the recorded browser. No new payment or signing was performed for this presentation.', '']
script += [source['label']+': '+source['url'] for source in data['film']['sources']]
(root/'captions.ass').write_text('\n'.join(ass)+'\n')
(root/'stellar-forge-presentation.vtt').write_text('\n'.join(vtt))
(root/'stellar-forge-presenter-script.txt').write_text('\n'.join(script)+'\n')
lines = ['ffconcat version 1.0']
for index, frame in enumerate(frames):
    next_time = frames[index+1]['at'] if index+1 < len(frames) else chapters[-1]['end']
    duration = max(0.001, next_time-frame['at'])
    # Frame paths are recorder-generated numeric basenames beneath this folder.
    lines += ["file '"+frame['file']+"'", 'duration '+str(duration)]
lines += ["file '"+frames[-1]['file']+"'"]
(root/'frames.ffconcat').write_text('\n'.join(lines)+'\n')
subprocess.run(['ffmpeg','-hide_banner','-loglevel','warning','-y','-f','concat','-safe','1',
                '-i',str(root/'frames.ffconcat'),'-vf',
                'scale=1728:840:flags=lanczos,pad=1920:1080:96:100:color=0xf3f3f3,ass=captions.ass',
                '-an','-r','24','-c:v','libx264','-preset','medium','-crf','19','-threads','2',
                '-pix_fmt','yuv420p','-movflags','+faststart',str(root/'stellar-forge-scf46-presentation.mp4')],
               cwd=root, check=True)
