#!/usr/bin/env python3
"""Finish the original verified Counterpress MJPEG recording as a VFR H.264 MP4."""
import argparse,fcntl,hashlib,json,os,pathlib,resource,subprocess
def sha(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def stable(path,value):
 raw=(json.dumps(value,sort_keys=True,indent=2)+'\n').encode()
 if path.exists():
  if path.read_bytes()!=raw:raise ValueError('Retained result differs: '+str(path))
  return
 part=path.with_name(path.name+'.part')
 previous=part.read_bytes() if part.exists() else b''
 if not raw.startswith(previous):raise ValueError('Retained result prefix differs')
 with part.open('ab') as f:f.write(raw[len(previous):]);f.flush();os.fsync(f.fileno())
 os.replace(part,path)
def probe(tool,path):
 r=subprocess.run([tool,'-v','error','-show_format','-show_streams','-show_packets','-of','json',str(path)],stdin=subprocess.DEVNULL,capture_output=True,check=True)
 return json.loads(r.stdout)
def run(args):
 out=pathlib.Path(args.output).resolve()
 with (out/'.handoff.lock').open('a+b') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  copy=json.loads((out/'RESULT.json').read_text())
  binding=json.loads((out/'INPUT_BINDING.private.json').read_text())
  if copy.get('complete') is not True or copy.get('stage')!='PORTABLE_RECEIVED':raise ValueError('The complete original copy operation is required')
  source=pathlib.Path(copy['video']['path']).resolve()
  if source.stat().st_size!=copy['video']['bytes'] or sha(source)!=copy['video']['sha256']:raise ValueError('Original verified movie differs')
  movie=source.with_suffix('.mp4');result_path=out/'H264_RESULT.json'
  if result_path.exists():
   saved=json.loads(result_path.read_text())
   if saved['video']['sha256']!=sha(movie) or saved['video']['bytes']!=movie.stat().st_size:raise ValueError('Saved MP4 changed')
   print(json.dumps(saved),flush=True);return
  part=movie.with_name(movie.stem+'.encoding.part.mp4')
  command=[args.ffmpeg,'-hide_banner','-nostdin','-loglevel','warning','-filter_threads','1','-filter_complex_threads','1','-threads','1',
   '-i',str(source),'-map','0:v:0','-map','0:s:0','-c:v','libx264','-preset','ultrafast','-tune','zerolatency',
   '-crf','18','-threads','1','-x264-params','ref=1:bframes=0:rc-lookahead=0:sync-lookahead=0:threads=1:lookahead-threads=1',
   '-pix_fmt','yuv420p','-fps_mode:v','vfr','-enc_time_base:v','-1','-video_track_timescale','1000',
   '-c:s','mov_text','-metadata:s:s:0','language=eng','-disposition:s:0','default',
   '-metadata','title=Counterpress Compass: original captured operator journey','-movflags','+faststart',str(part)]
  request_path=out/'H264_REQUEST.json'
  if movie.exists() and not request_path.exists():raise ValueError('An unrelated MP4 already occupies the selected output')
  stable(request_path,{'schema':'counterpress.recording-h264-request.v1','originalVideo':copy['video'],
   'capturedCheckpointSha256':binding['captureCheckpointSha256'],'output':str(movie),'command':command})
  if not movie.exists():
   if part.exists():
    old=part.with_name(part.name+'.interrupted-'+sha(part)[:16])
    if old.exists():raise ValueError('A retained failed encode needs reconciliation')
    os.replace(part,old)
   print(json.dumps({'stage':'H264_STARTED','source':str(source),'frames':154,'packetCount':155,'variableFrameTiming':True,'captionMode':'switchable-track-and-sidecars'}),flush=True)
   with (out/'h264-encode.log').open('ab',buffering=0) as log:
    result=subprocess.run(command,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,pass_fds=(lock.fileno(),))
   print(json.dumps({'stage':'H264_ENCODER_RETURNED','returncode':result.returncode,'peakChildRssKiB':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss}),flush=True)
   if result.returncode:raise RuntimeError('H264 returned '+str(result.returncode)+'; original movie and frames remain retained')
  candidate=movie if movie.exists() else part
  before=probe(args.ffprobe,source);after=probe(args.ffprobe,candidate)
  old_packets=[p for p in before['packets'] if p.get('codec_type')=='video']
  new_packets=[p for p in after['packets'] if p.get('codec_type')=='video']
  videos=[s for s in after['streams'] if s.get('codec_type')=='video']
  subtitles=[s for s in after['streams'] if s.get('codec_type')=='subtitle']
  if len(old_packets)!=155 or len(new_packets)!=155:raise ValueError('Frame count changed')
  if len(videos)!=1 or videos[0].get('codec_name')!='h264' or videos[0].get('pix_fmt')!='yuv420p':raise ValueError('MP4 codec differs')
  if (videos[0]['width'],videos[0]['height'])!=(1600,900):raise ValueError('Captured dimensions changed')
  if len(subtitles)!=1 or subtitles[0].get('codec_name')!='mov_text':raise ValueError('Original captions missing')
  old_pts=[float(p['pts_time']) for p in old_packets];new_pts=[float(p['pts_time']) for p in new_packets]
  if any(b<a for a,b in zip(new_pts,new_pts[1:])):raise ValueError('MP4 timestamps are not monotonic')
  error=max(abs(a-b) for a,b in zip(old_pts,new_pts))
  if error>0.002:raise ValueError('Original VFR timestamps changed')
  duration=float(after['format']['duration']);original=float(before['format']['duration'])
  if not 0<duration<120 or abs(duration-original)>0.1:raise ValueError('Original duration changed')
  with candidate.open('rb') as f:os.fsync(f.fileno())
  if candidate==part:os.replace(part,movie)
  saved={'schema':'counterpress.recording-h264.v1','complete':True,'stage':'H264_VERIFIED',
   'capturedCheckpointSha256':binding['captureCheckpointSha256'],
   'originalVideo':copy['video'],'originalCaptureSeconds':112.018194305,
   'video':{'path':str(movie),'bytes':movie.stat().st_size,'sha256':sha(movie),'codec':'h264','pixelFormat':'yuv420p',
    'width':1600,'height':900,'packetCount':155,'actualBrowserFrames':154,'encodedDurationSeconds':duration,
    'maximumPacketTimestampErrorSeconds':error,'variableFrameTiming':True,'captionDelivery':'switchable-track-and-sidecars','audio':False},
   'encoder':{'command':command,
    'noFrameInterpolation':True,'noCaptionBurnIn':True,'sourceMoviePreserved':True},
   'subtitle':{'codec':'mov_text','language':subtitles[0].get('tags',{}).get('language')}}
  stable(result_path,saved);print(json.dumps(saved),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--ffmpeg',default='/usr/bin/ffmpeg');p.add_argument('--ffprobe',default='/usr/bin/ffprobe')
 run(p.parse_args())
