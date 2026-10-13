#!/usr/bin/env node
/**
 * Finish the existing Counterpress capture with Node, ffmpeg and ffprobe.
 * The original recorder resumes its recipient journey from the encoded checkpoint.
 */
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {join, resolve} from 'node:path';

const usage = 'node demo/encode-retained-capture.mjs --out EXISTING_CAPTURE_DIRECTORY [--ffmpeg EXECUTABLE] [--ffprobe EXECUTABLE]';
const options = {};
if (process.argv.length === 3 && process.argv[2] === '--help') {
  process.stdout.write(usage + '\n');
  process.exit(0);
}
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]?.slice(2), value = process.argv[i + 1];
  if (!process.argv[i]?.startsWith('--') || !['out', 'ffmpeg', 'ffprobe'].includes(key) ||
      !value || Object.hasOwn(options, key)) throw new Error(usage);
  options[key] = value;
}
if (!options.out) throw new Error(usage);

const output = resolve(options.out);
const recoveryPath = join(output, 'capture-recovery.private.json');
const videoName = 'Counterpress_Compass_Running_Demo.mp4';
const videoPath = join(output, videoName);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const need = (condition, message) => { if (!condition) throw new Error(message); };
const announce = value => process.stdout.write(JSON.stringify(value) + '\n');

async function regular(path) {
  const stat = await fs.lstat(path);
  need(stat.isFile(), 'Expected an original regular file: ' + path);
  return stat;
}
async function present(path) {
  try { return await regular(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function fingerprint(path) {
  const before = await regular(path), digest = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path, {highWaterMark: 256 * 1024})) {
    bytes += chunk.length; digest.update(chunk);
  }
  const after = await regular(path);
  need(before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
    before.mtimeMs === after.mtimeMs && bytes === after.size, 'The original file changed while reading: ' + path);
  return {bytes, sha256: digest.digest('hex')};
}
const sameFile = (left, right) => left?.bytes === right?.bytes && left?.sha256 === right?.sha256;
async function syncDirectory(path) {
  const handle = await fs.open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

await regular(recoveryPath);
let raw = await fs.readFile(recoveryPath);
let recovery = JSON.parse(raw.toString('utf8'));
need(recovery.schema === 'counterpress.capture-recovery.v1' &&
  ['captured', 'encoded'].includes(recovery.phase), 'Select the original captured or encoded recovery record.');
need(['core', 'integrated'].includes(recovery.mode) && Number.isFinite(recovery.duration) &&
  recovery.duration > 0 && recovery.duration < 118 &&
  Array.isArray(recovery.frames) && recovery.frames.length >= 20, 'The original complete recording is required.');
const duration = recovery.duration;
const currentRecord = async () => {
  await regular(recoveryPath);
  need(hash(await fs.readFile(recoveryPath)) === hash(raw),
    'The capture checkpoint changed. Continue the current original recording operation.');
};
async function saveRecovery(next) {
  await currentRecord();
  const temporary = join(output, '.capture-recovery-' + randomUUID() + '.private.json');
  const bytes = Buffer.from(json(next)), handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  try {
    await currentRecord();
    await fs.rename(temporary, recoveryPath);
    await syncDirectory(output);
    raw = bytes; recovery = next;
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

let child = null, cancelled = null;
const signals = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => {
  cancelled = signal; process.exitCode = signal === 'SIGINT' ? 130 : 143; child?.kill(signal);
}]));
for (const [signal, handler] of signals) process.on(signal, handler);
function command(program, args, capture = false) {
  need(!cancelled, 'Encoding interrupted by ' + cancelled + '; rerun the same command.');
  return new Promise((done, fail) => {
    let stdout = '', stderr = '';
    const owned = spawn(program, args, {cwd: output, stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe']});
    child = owned;
    if (capture) owned.stdout.setEncoding('utf8').on('data', text => {
      stdout += text;
      if (stdout.length > 1024 * 1024) owned.kill('SIGTERM');
    });
    owned.stderr.setEncoding('utf8').on('data', text => { stderr = (stderr + text).slice(-12000); });
    owned.once('error', fail);
    owned.once('close', (code, signal) => {
      if (child === owned) child = null;
      if (code === 0 && !cancelled) done(stdout);
      else fail(new Error(program + ' exited ' + code + '/' + signal + ': ' + stderr));
    });
  });
}
async function inspectVideo(path) {
  await regular(path);
  const result = JSON.parse(await command(options.ffprobe || 'ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_name,codec_type,width,height,pix_fmt,avg_frame_rate',
    '-of', 'json', path
  ], true));
  const seconds = Number(result.format?.duration), streams = result.streams ?? [];
  const video = streams.filter(stream => stream.codec_type === 'video');
  need(Number.isFinite(seconds) && seconds > 0 && seconds < 120 && Math.abs(seconds - duration) <= .1,
    'The encoded video must retain the original recording duration.');
  need(video.length === 1 && !streams.some(stream => stream.codec_type === 'audio') &&
    video[0].codec_name === 'h264' && video[0].width === 1600 && video[0].height === 1000 &&
    video[0].pix_fmt === 'yuv420p' && video[0].avg_frame_rate === '24/1',
    'Expected the original 1600 x 1000 captioned H.264 layout at 24 frames per second.');
  const identity = await fingerprint(path);
  return {file: videoName, ...identity, capturedDurationSeconds: duration,
    encodedDurationSeconds: seconds, actualBrowserFrames: recovery.frames.length, captioned: true, audio: false};
}

function originalState(record) {
  const {retainedEncoding, ...original} = record;
  return hash(Buffer.from(json(original)));
}
async function inputs() {
  need((await fs.lstat(join(output, 'frames'))).isDirectory(), 'Select the original retained frame directory.');
  let concat = '', previous = -1, totalFrameBytes = 0;
  const result = [];
  for (let i = 0; i < recovery.frames.length; i++) {
    const frame = recovery.frames[i];
    need(frame.file === 'frames/frame-' + String(i).padStart(6, '0') + '.jpg' &&
      Number.isFinite(frame.at) && frame.at >= 0 && frame.at >= previous && frame.at <= duration,
      'Keep the original ordered browser frames and capture times.');
    previous = frame.at;
    const identity = await fingerprint(join(output, frame.file));
    need(identity.bytes > 0, 'The browser frame is empty: ' + frame.file);
    totalFrameBytes += identity.bytes;
    result.push({path: frame.file, ...identity});
    const start = i === 0 ? 0 : frame.at;
    const end = i + 1 < recovery.frames.length ? recovery.frames[i + 1].at : duration;
    concat += "file '" + frame.file + "'\nduration " + Math.max(.001, end - start).toFixed(6) + '\n';
  }
  need(totalFrameBytes === recovery.frameBytes, 'Keep every original browser frame.');
  concat += "file '" + recovery.frames.at(-1).file + "'\n";
  need((await fs.readFile(join(output, 'capture.concat'), 'utf8')) === concat,
    'The retained concatenation must preserve every original frame interval.');
  for (const path of ['capture.concat', 'captions.ass', 'captions.srt', 'captions.vtt']) {
    const identity = await fingerprint(join(output, path));
    need(identity.bytes > 0, 'The original caption or timing file is empty: ' + path);
    result.push({path, ...identity});
  }
  return result;
}
async function unchangedInputs(expected) {
  for (const item of expected) {
    need(sameFile(await fingerprint(join(output, item.path)), item),
      'The captured frame or authored caption changed: ' + item.path);
  }
}

try {
  if (recovery.phase === 'encoded') {
    const video = await inspectVideo(videoPath);
    need(sameFile(video, recovery.video), 'The completed original video changed after encoding.');
    announce({phase: 'encoded', reused: true, output, video});
  } else {
    const retained = await inputs();
    const inputSha256 = hash(Buffer.from(json(retained)));
    let job = recovery.retainedEncoding;
    if (job) {
      need(job.schema === 'counterpress.retained-encoder.v1' &&
        ['encoding', 'ready'].includes(job.phase) &&
        job.recoverySha256 === originalState(recovery) && job.inputSha256 === inputSha256 &&
        /^\.retained-encoding-[a-f0-9-]+$/.test(job.stage), 'Continue the same retained encoding and complete original input.');
      need((await fs.lstat(join(output, job.stage))).isDirectory(), 'The original encoding staging directory is required.');
    } else {
      const stage = '.retained-encoding-' + randomUUID();
      await fs.mkdir(join(output, stage), {mode: 0o700});
      job = {schema: 'counterpress.retained-encoder.v1', recoverySha256: originalState(recovery),
        inputSha256, stage, phase: 'encoding',
        previousVideo: await present(videoPath) ? await fingerprint(videoPath) : null};
      await saveRecovery({...recovery, retainedEncoding: job});
    }
    const stagedVideo = join(output, job.stage, 'recording.mp4');
    let video = null;
    if (await present(stagedVideo)) {
      try { video = await inspectVideo(stagedVideo); }
      catch (error) {
        if (job.phase === 'ready' || cancelled || error.code === 'ENOENT') throw error;
        await fs.rename(stagedVideo, join(output, job.stage, 'interrupted-' + randomUUID() + '.mp4'));
      }
    }
    if (job.phase === 'ready') {
      need(video && sameFile(video, job.video), 'The prepared encoded recording changed.');
    }
    if (!video) {
      announce({phase: 'encoding', durationSeconds: duration, retainedBrowserFrames: recovery.frames.length});
      // Keep the recorder's filters, caption bytes, dimensions, frame rate and CRF.
      // x264 zerolatency disables both lookaheads and B frames; every thread count stays one.
      await command(options.ffmpeg || 'ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
        '-filter_threads', '1', '-filter_complex_threads', '1',
        '-threads', '1', '-f', 'concat', '-safe', '1', '-i', 'capture.concat',
        '-vf', 'scale=1600:900:flags=lanczos,pad=1600:1000:0:0:color=0x202020,tpad=stop_mode=clone:stop_duration=' +
          Math.ceil(duration) + ',fps=24,subtitles=captions.ass',
        '-t', duration.toFixed(3), '-c:v', 'libx264', '-threads', '1',
        '-preset', 'veryfast', '-tune', 'zerolatency', '-crf', '20',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', stagedVideo
      ]);
      video = await inspectVideo(stagedVideo);
      await fs.chmod(stagedVideo, 0o600);
      const handle = await fs.open(stagedVideo, 'r');
      try { await handle.sync(); } finally { await handle.close(); }
      await syncDirectory(join(output, job.stage));
    }
    await unchangedInputs(retained);
    await currentRecord();
    if (job.phase !== 'ready') {
      job = {...job, phase: 'ready', video};
      await saveRecovery({...recovery, retainedEncoding: job});
    }
    if (await present(videoPath)) {
      const current = await fingerprint(videoPath);
      if (!sameFile(current, video)) {
        need(job.previousVideo && sameFile(current, job.previousVideo),
          'A different recording now occupies the final path. Continue its current encoding operation.');
        const previous = join(output, job.stage, 'previous-recording.mp4');
        try { await fs.link(videoPath, previous); }
        catch (error) {
          if (error.code !== 'EEXIST' || !sameFile(await fingerprint(previous), current)) throw error;
        }
        await currentRecord();
        need(sameFile(await fingerprint(videoPath), current), 'The previous recording changed during publication.');
        await fs.unlink(videoPath);
      }
    }
    try { await fs.link(stagedVideo, videoPath); }
    catch (error) {
      if (error.code !== 'EEXIST' || !sameFile(await fingerprint(videoPath), video)) throw error;
    }
    await syncDirectory(output);
    await saveRecovery({...recovery, phase: 'encoded', video,
      retainedEncoding: {...job, phase: 'encoded'}});
    announce({phase: 'encoded', reused: false, output, video});
  }
} finally {
  for (const [signal, handler] of signals) process.off(signal, handler);
}
