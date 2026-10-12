#!/usr/bin/env python3
"""Compose retained UI frames or chapter clips, captions and a source-linked script.

Python standard library + FFmpeg/libass/libx264 + ffprobe. No browser or audio is
created. Both the original frames capture and capture/2 chapter clips are accepted.
"""
import argparse
import hashlib
import html
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import textwrap
from fractions import Fraction
from pathlib import Path

VIDEO = 'stellar-forge-scf46-presentation.mp4'
VTT = 'stellar-forge-presentation.vtt'
SCRIPT = 'stellar-forge-presenter-script.txt'
SOURCES = 'stellar-forge-sources.md'
REPORT = 'stellar-forge-render.json'
OUTPUT_FPS = 24


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def write(path, value):
    text = value if isinstance(value, str) else json.dumps(value, indent=2, ensure_ascii=False) + '\n'
    with path.open('w', encoding='utf-8', newline='\n') as stream:
        stream.write(text)
        stream.flush()
        os.fsync(stream.fileno())


def finite(value, name, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(name + ' must be a finite number')
    if value < 0 or (positive and value == 0):
        raise ValueError(name + ' must be positive' if positive else name + ' must be nonnegative')
    return float(value)


def rate(value):
    try:
        result = Fraction(str(value))
    except (ValueError, ZeroDivisionError):
        raise ValueError('Invalid frame rate') from None
    if result <= 0 or result > 240:
        raise ValueError('Frame rate must be in (0, 240]')
    return result


def media_path(root, value):
    if not isinstance(value, str) or not value or any(c in value for c in '\x00\r\n'):
        raise ValueError('A media filename must be nonempty and contain no control line breaks')
    relative = Path(value)
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError('Capture media must use paths beneath its own directory')
    path = (root / relative).resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError('Capture media must remain a regular file beneath its directory')
    return path


def probe(path, executable):
    call = subprocess.run([executable, '-v', 'error', '-show_entries',
        'format=duration,size:stream=index,codec_type,codec_name,pix_fmt,width,height,r_frame_rate,avg_frame_rate,time_base,nb_frames,duration',
        '-of', 'json', str(path)], capture_output=True, text=True, check=True)
    value = json.loads(call.stdout)
    video = [stream for stream in value.get('streams', []) if stream.get('codec_type') == 'video']
    if len(video) != 1:
        raise ValueError('Expected exactly one video stream: ' + path.name)
    stream = video[0]
    return {'codec': stream.get('codec_name'), 'pixel_format': stream.get('pix_fmt'),
        'width': stream.get('width'), 'height': stream.get('height'),
        'fps': str(rate(stream.get('avg_frame_rate') or stream.get('r_frame_rate'))),
        'time_base': stream.get('time_base'),
        'frames': int(stream['nb_frames']) if stream.get('nb_frames', '').isdigit() else None,
        'duration': float(stream.get('duration') or value['format']['duration']),
        'bytes': path.stat().st_size,
        'audio_streams': sum(row.get('codec_type') == 'audio' for row in value.get('streams', []))}


def read_capture(root, ffprobe):
    data = json.loads((root / 'capture.json').read_text(encoding='utf-8'))
    film = data.get('film', {})
    declared, recorded = film.get('chapters', []), data.get('chapters', [])
    if data.get('errors') or not declared or len(recorded) != len(declared):
        raise ValueError('Recording is incomplete: retain the original failure and finish its missing chapters')
    expected = [row.get('id') for row in declared]
    if len(set(expected)) != len(expected) or any(not isinstance(key, str) or not key for key in expected):
        raise ValueError('Film chapters need unique nonempty IDs')
    if [row.get('id') for row in recorded] != expected:
        raise ValueError('Recorded chapters must retain the film order and IDs')
    chapters, previous_end = [], 0.0
    for spec, row in zip(declared, recorded):
        item = {**spec, **row}
        start = finite(item.get('start'), 'chapter.start')
        end = finite(item.get('end'), 'chapter.end', positive=True)
        if end <= start or start < previous_end - 0.001:
            raise ValueError('Chapter times must be chronological and non-overlapping')
        if not isinstance(item.get('captions'), list) or not item['captions']:
            raise ValueError('Each chapter needs its retained caption text')
        if any(not isinstance(text, str) or not text.strip() for text in item['captions']):
            raise ValueError('Caption text must be nonempty')
        item.update(start=start, end=end)
        chapters.append(item)
        previous_end = end
    files, media, mode = [], [], 'frames'
    if data.get('clips'):
        mode = 'clips'
        clips = data['clips']
        if [row.get('id') for row in clips] != expected:
            raise ValueError('capture/2 must contain one ordered clip per recorded chapter')
        elapsed, signature = Fraction(0), None
        for clip, chapter in zip(clips, chapters):
            path = media_path(root, clip.get('file'))
            count = clip.get('frames')
            if isinstance(count, bool) or not isinstance(count, int) or count < 1:
                raise ValueError('Each clip needs its positive accepted encoded frame count')
            fps = rate(clip.get('fps'))
            duration = Fraction(count, 1) / fps
            if abs(finite(clip.get('duration'), 'clip.duration', True) - float(duration)) > 0.002:
                raise ValueError('Clip duration must equal frames/fps')
            if abs(chapter['start'] - float(elapsed)) > 0.002 or abs(chapter['end'] - float(elapsed + duration)) > 0.002:
                raise ValueError('capture/2 chapter boundaries must use cumulative encoded frames/fps')
            sha = digest(path)
            if not isinstance(clip.get('sha256'), str) or sha != clip['sha256'].lower():
                raise ValueError('Clip bytes no longer match the retained capture: ' + clip['id'])
            actual = probe(path, ffprobe)
            current = tuple(actual[key] for key in ('codec', 'pixel_format', 'width', 'height', 'fps', 'time_base'))
            if actual['codec'] != 'h264' or actual['pixel_format'] != 'yuv420p' or actual['audio_streams']:
                raise ValueError('Chapter clips must be video-only H.264/yuv420p')
            if actual['frames'] != count or rate(actual['fps']) != fps:
                raise ValueError('Clip frame count/rate disagrees with the encoded video: ' + clip['id'])
            if actual['width'] != clip.get('width') or actual['height'] != clip.get('height'):
                raise ValueError('Clip dimensions disagree with the encoded video')
            if abs(actual['duration'] - float(duration)) > 0.002:
                raise ValueError('Encoded clip duration disagrees with frames/fps')
            if signature is not None and current != signature:
                raise ValueError('All chapter clips must share codec, pixel format, dimensions, frame rate and time base')
            signature = current
            files.append((path, None))
            media.append({'id': clip['id'], 'file': clip['file'], 'sha256': sha, **actual})
            elapsed += duration
        duration = float(elapsed)
    else:
        frames = data.get('frames', [])
        if not frames:
            raise ValueError('The capture contains neither chapter clips nor original frames')
        duration = chapters[-1]['end']
        times = [finite(frame.get('at'), 'frame.at') for frame in frames]
        if times[0] > 0.001 or any(b <= a for a, b in zip(times, times[1:])):
            raise ValueError('Original frame times must begin at zero and increase')
        used = [(frame, at) for frame, at in zip(frames, times) if at < duration]
        for index, (frame, at) in enumerate(used):
            end = used[index + 1][1] if index + 1 < len(used) else duration
            files.append((media_path(root, frame.get('file')), end - at))
        if not files:
            raise ValueError('No original frame occurs within the recorded timeline')
        media.append({'frames': len(files), 'duration': duration, 'original_frames_retained': len(frames)})
    return data, chapters, files, media, mode, duration


def clock(value, precision=3):
    factor = 10 ** precision
    ticks = round(value * factor)
    return f'{ticks // (3600 * factor):02}:{ticks // (60 * factor) % 60:02}:{ticks // factor % 60:02}.{ticks % factor:0{precision}d}'


def ass_time(value):
    ticks = round(value * 100)
    return f'{ticks // 360000}:{ticks // 6000 % 60:02}:{ticks // 100 % 60:02}.{ticks % 100:02}'


def ass_escape(value):
    return str(value).replace('\\', '\\\\').replace('{', '\\{').replace('}', '\\}').replace('\n', r'\N')


def cue_texts(text):
    # Plain text and exact word order are retained; only line/cue boundaries change.
    lines = textwrap.wrap(' '.join(text.split()), width=78, break_long_words=True, break_on_hyphens=False)
    return ['\n'.join(lines[index:index + 2]) for index in range(0, len(lines), 2)]


def cues_for(chapter):
    texts = [cue for text in chapter['captions'] for cue in cue_texts(text)]
    weights = [max(32, len(text.replace('\n', ' '))) for text in texts]
    start, available = chapter['start'], chapter['end'] - chapter['start']
    total, used, cues = sum(weights), 0, []
    for text, weight in zip(texts, weights):
        begin = start + available * used / total
        used += weight
        end = start + available * used / total
        characters = len(text.replace('\n', ' '))
        cues.append({'chapter': chapter['id'], 'start': begin, 'end': end, 'text': text,
            'characters_per_second': round(characters / (end - begin), 2)})
    return cues


def sources_and_facts(data):
    film = data['film']
    sources, seen = [], set()
    repository = film.get('sourceRepository')
    commit = data.get('sourceCommit') or film.get('sourceCommit')
    if repository and commit:
        sources.append({'label': 'Recorded product source', 'url': repository.rstrip('/') + '/tree/' + commit})
    for row in [*film.get('sources', []), *data.get('sources', [])]:
        if isinstance(row, dict) and row.get('label') and row.get('url'):
            sources.append({'label': str(row['label']), 'url': str(row['url'])})
    sources = [row for row in sources if not (row['url'] in seen or seen.add(row['url']))]
    provided = data.get('sourceFacts', film.get('sourceFacts', {}))
    if isinstance(provided, dict):
        facts = [{'label': str(key), 'value': value} for key, value in provided.items()]
    elif isinstance(provided, list):
        facts = [row for row in provided if isinstance(row, dict) and 'label' in row and 'value' in row]
    else:
        raise ValueError('sourceFacts must be an object or an array of {label,value,source?}')
    if 'sourceFacts' not in data and 'sourceFacts' not in film:
        # Existing captures have these actual top-level fields. No old value or
        # transaction is supplied when a successor does not contain that field.
        for key, label in [('transaction', 'Retained transaction'), ('originalNativeSource', 'Original native run source'),
                ('responseBytes', 'Original response bytes'), ('responseSha256', 'Original response SHA-256'),
                ('observationAt', 'Independent observation time')]:
            if key in data:
                facts.append({'label': label, 'value': data[key]})
    return sources, facts


def printable(value):
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2)


def assets(directory, data, chapters, files, mode, font):
    cues = [cue for chapter in chapters for cue in cues_for(chapter)]
    styles = ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1920', 'PlayResY: 1080', 'WrapStyle: 2',
        '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        f'Style: Caption,{font},32,&H00202020,&H00202020,&H00F3F3F3,&H00F3F3F3,0,0,0,0,100,100,0,0,1,0,0,5,110,110,0,1',
        f'Style: Heading,{font},31,&H00202020,&H00202020,&H00F3F3F3,&H00F3F3F3,-1,0,0,0,100,100,0,0,1,0,0,7,96,96,46,1',
        f'Style: Label,{font},16,&H00606060,&H00606060,&H00F3F3F3,&H00F3F3F3,0,0,0,0,100,100,1,0,1,0,0,7,96,96,20,1',
        '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
    for chapter in chapters:
        for style, value in [('Heading', chapter.get('title', chapter['id'])), ('Label', chapter.get('label', ''))]:
            styles.append(f'Dialogue: 1,{ass_time(chapter["start"])},{ass_time(chapter["end"])},{style},,0,0,0,,{ass_escape(value)}')
    vtt = ['WEBVTT', '']
    script = [data['film'].get('title', 'Product presentation'), data['film'].get('subtitle', ''), '',
        'Presenter script synchronized to the retained visual capture. The film has captions and no generated voice or presenter likeness.', '']
    for chapter in chapters:
        script.extend([f'{clock(chapter["start"])} — {chapter.get("title", chapter["id"])}', ''])
        for cue in [row for row in cues if row['chapter'] == chapter['id']]:
            a, b, text = cue['start'], cue['end'], cue['text']
            styles.append(f'Dialogue: 2,{ass_time(a)},{ass_time(b)},Caption,,0,0,0,,{{\\pos(960,1008)}}{ass_escape(text)}')
            vtt.extend([f'{clock(a)} --> {clock(b)}', html.escape(text, quote=False), ''])
            script.extend([f'[{clock(a)} – {clock(b)}]', text.replace('\n', ' '), ''])
    sources, facts = sources_and_facts(data)
    provenance = ['# Source links and retained facts', '',
        'The entries below come from this capture and its film declaration. They identify the material shown; they do not add a new transaction or observation.', '']
    for fact in facts:
        line = str(fact['label']) + ': ' + printable(fact['value'])
        if fact.get('source'):
            line += '\nSource: ' + printable(fact['source'])
        provenance.extend([line, ''])
    provenance.extend([row['label'] + ': ' + row['url'] for row in sources])
    script.extend(['Source links and retained facts', '', *provenance[4:]])
    if data.get('interpretation'):
        script.extend(['', 'Capture interpretation', printable(data['interpretation'])])
        provenance.extend(['', '## Capture interpretation', '', printable(data['interpretation'])])
    write(directory / 'captions.ass', '\n'.join(styles) + '\n')
    write(directory / VTT, '\n'.join(vtt) + '\n')
    write(directory / SCRIPT, '\n'.join(script) + '\n')
    write(directory / SOURCES, '\n'.join(provenance) + '\n')
    concat = ['ffconcat version 1.0']
    quote = lambda value: "'" + str(value).replace("'", "'\\''") + "'"
    for path, duration in files:
        concat.append('file ' + quote(path))
        if duration is not None:
            concat.append(f'duration {duration:.9f}')
    if mode == 'frames':
        concat.append('file ' + quote(files[-1][0]))
    write(directory / 'inputs.ffconcat', '\n'.join(concat) + '\n')
    return cues, sources, facts


def render(args):
    root = Path(args.capture).resolve(strict=True)
    output = Path(args.output).resolve() if args.output else root
    output.mkdir(parents=True, exist_ok=True)
    if any(character in args.font for character in ',\r\n'):
        raise ValueError('Font family must be a plain ASS font name')
    data, chapters, files, media, mode, duration = read_capture(root, args.ffprobe)
    with tempfile.TemporaryDirectory(prefix='.render-', dir=output) as temporary:
        stage = Path(temporary)
        cues, sources, facts = assets(stage, data, chapters, files, mode, args.font)
        video = None
        if not args.prepare_only:
            filters = ('setpts=PTS-STARTPTS,fps=24,scale=1728:840:force_original_aspect_ratio=decrease:flags=lanczos,'
                'pad=1728:840:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,'
                'pad=1920:1080:96:100:color=0xf3f3f3,ass=captions.ass')
            command = [args.ffmpeg, '-hide_banner', '-loglevel', 'warning', '-nostdin', '-y',
                '-threads', '2', '-filter_threads', '2', '-f', 'concat', '-safe', '0', '-i', str(stage / 'inputs.ffconcat'),
                '-vf', filters, '-t', f'{duration:.9f}', '-an', '-r', str(OUTPUT_FPS),
                '-c:v', 'libx264', '-preset', args.preset, '-crf', str(args.crf), '-threads', '2',
                '-x264-params', 'rc-lookahead=0:sync-lookahead=0:ref=1:bframes=0',
                '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-metadata',
                'title=' + data['film'].get('title', 'Product presentation'), str(stage / VIDEO)]
            with (stage / 'render.log').open('w', encoding='utf-8') as log:
                result = subprocess.run(command, cwd=stage, stdout=log, stderr=subprocess.STDOUT)
            if result.returncode:
                # Keep the diagnostic, without replacing any previously completed film.
                os.replace(stage / 'render.log', output / 'render-failed.log')
                write(output / 'render-failed.json', {'encoder_returncode': result.returncode, 'input_mode': mode, 'duration': duration})
                raise RuntimeError('FFmpeg exited ' + str(result.returncode) + '; retained render-failed.log and render-failed.json contain the native diagnostic')
            video = probe(stage / VIDEO, args.ffprobe)
            if (video['width'], video['height'], video['codec'], video['pixel_format'], rate(video['fps'])) != (1920, 1080, 'h264', 'yuv420p', Fraction(24)):
                raise RuntimeError('Encoded video does not match the requested 1080p H.264/24fps profile')
            if abs(video['duration'] - duration) > 1 / OUTPUT_FPS + 0.002:
                raise RuntimeError('Encoded video duration does not match the retained chapter timeline')
            video['sha256'] = digest(stage / VIDEO)
        fast = [cue for cue in cues if cue['characters_per_second'] > 20 or cue['end'] - cue['start'] < 2]
        report = {'schema': 'stellar-forge.presentation.render/2', 'input_mode': mode,
            'capture_sha256': digest(root / 'capture.json'), 'duration': duration,
            'chapters': [{'id': row['id'], 'title': row.get('title'), 'start': row['start'], 'end': row['end']} for row in chapters],
            'media': media, 'video': video, 'caption_cues': len(cues),
            'caption_readability': {'target_characters_per_second': 17, 'review_above': 20,
                'maximum_actual': max(row['characters_per_second'] for row in cues),
                'short_or_fast_cues': fast},
            'sources': sources, 'source_facts': facts, 'font': args.font, 'encoding_threads': 2,
            'outputs': {name: {'bytes': (stage / name).stat().st_size, 'sha256': digest(stage / name)}
                for name in [VTT, SCRIPT, SOURCES, 'captions.ass']}}
        write(stage / REPORT, report)
        # Each completed artifact is atomically replaced; the manifest is last.
        names = [VTT, SCRIPT, SOURCES, 'captions.ass', 'inputs.ffconcat']
        if video:
            names += [VIDEO, 'render.log']
        names.append(REPORT)
        for name in names:
            os.replace(stage / name, output / name)
        fd = os.open(output, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    return {'status': 'PREPARED' if args.prepare_only else 'RENDERED', 'output': str(output),
        'input_mode': mode, 'duration': duration, 'chapter_count': len(chapters),
        'caption_cues': len(cues), 'readability_review_count': len(fast), 'video': video}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture', help='Directory containing capture.json and its retained media')
    parser.add_argument('--output', help='Separate output directory; defaults to the capture directory')
    parser.add_argument('--ffmpeg', default='ffmpeg')
    parser.add_argument('--ffprobe', default='ffprobe')
    parser.add_argument('--font', default='DejaVu Sans')
    parser.add_argument('--preset', choices=['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'], default='medium')
    parser.add_argument('--crf', type=int, choices=range(0, 36), default=19)
    parser.add_argument('--prepare-only', action='store_true', help='Validate retained inputs and write timed captions/script without encoding')
    args = parser.parse_args()
    try:
        print(json.dumps(render(args), ensure_ascii=False))
    except (ValueError, OSError, RuntimeError, subprocess.CalledProcessError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
