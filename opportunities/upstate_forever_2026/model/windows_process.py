"""Owned Windows workers and transferable batch custody for the original queue.

The scientific worker, request journal and model engine remain unchanged. Windows
children start suspended in an owned Job Object; only explicit handles inherit.
No console window, account setting or background service is created.
"""
from __future__ import annotations

import atexit
import ctypes
from ctypes import wintypes as w
import hashlib
import errno
import json
import msvcrt
import os
from pathlib import Path
import secrets
import signal
import subprocess
import threading
import time

from .windows_fs import native_path, fd_stat

_kernel=ctypes.WinDLL('kernel32',use_last_error=True)
_nt=ctypes.WinDLL('ntdll',use_last_error=True)
_INVALID=ctypes.c_void_p(-1).value
_CONTEXT='ECO_NATIVE_WINDOWS_CONTEXT'
_spawn_lock=threading.Lock()
_worker=None

class _FT(ctypes.Structure):
    _fields_=[('low',w.DWORD),('high',w.DWORD)]
class _SI(ctypes.Structure):
    _fields_=[('cb',w.DWORD),('lpReserved',w.LPWSTR),('lpDesktop',w.LPWSTR),('lpTitle',w.LPWSTR),
        ('dwX',w.DWORD),('dwY',w.DWORD),('dwXSize',w.DWORD),('dwYSize',w.DWORD),
        ('dwXCountChars',w.DWORD),('dwYCountChars',w.DWORD),('dwFillAttribute',w.DWORD),
        ('dwFlags',w.DWORD),('wShowWindow',w.WORD),('cbReserved2',w.WORD),
        ('lpReserved2',ctypes.c_void_p),('hStdInput',w.HANDLE),('hStdOutput',w.HANDLE),('hStdError',w.HANDLE)]
class _SIEX(ctypes.Structure):
    _fields_=[('StartupInfo',_SI),('attributes',ctypes.c_void_p)]
class _PI(ctypes.Structure):
    _fields_=[('process',w.HANDLE),('thread',w.HANDLE),('pid',w.DWORD),('tid',w.DWORD)]
class _BASIC_LIMIT(ctypes.Structure):
    _fields_=[('process_time',ctypes.c_longlong),('job_time',ctypes.c_longlong),('flags',w.DWORD),
        ('minimum_ws',ctypes.c_size_t),('maximum_ws',ctypes.c_size_t),('active_process_limit',w.DWORD),
        ('affinity',ctypes.c_size_t),('priority',w.DWORD),('scheduling',w.DWORD)]
class _IO(ctypes.Structure):
    _fields_=[(name,ctypes.c_ulonglong) for name in ('read_ops','write_ops','other_ops','read_bytes','write_bytes','other_bytes')]
class _LIMIT(ctypes.Structure):
    _fields_=[('basic',_BASIC_LIMIT),('io',_IO),('process_memory',ctypes.c_size_t),('job_memory',ctypes.c_size_t),
        ('peak_process_memory',ctypes.c_size_t),('peak_job_memory',ctypes.c_size_t)]
class _US(ctypes.Structure):
    _fields_=[('length',w.USHORT),('maximum',w.USHORT),('buffer',ctypes.c_void_p)]
class _TAG(ctypes.Structure):
    _fields_=[('attributes',w.DWORD),('tag',w.DWORD)]

def _bind(dll,name,args,result=w.BOOL):
    function=getattr(dll,name);function.argtypes=args;function.restype=result;return function
_close=_bind(_kernel,'CloseHandle',[w.HANDLE])
_current=_bind(_kernel,'GetCurrentProcess',[],w.HANDLE)
_open_process=_bind(_kernel,'OpenProcess',[w.DWORD,w.BOOL,w.DWORD],w.HANDLE)
_times=_bind(_kernel,'GetProcessTimes',[w.HANDLE,*[ctypes.POINTER(_FT)]*4])
_wait=_bind(_kernel,'WaitForSingleObject',[w.HANDLE,w.DWORD],w.DWORD)
_exit=_bind(_kernel,'GetExitCodeProcess',[w.HANDLE,ctypes.POINTER(w.DWORD)])
_image=_bind(_kernel,'QueryFullProcessImageNameW',[w.HANDLE,w.DWORD,w.LPWSTR,ctypes.POINTER(w.DWORD)])
_duplicate=_bind(_kernel,'DuplicateHandle',[w.HANDLE,w.HANDLE,w.HANDLE,ctypes.POINTER(w.HANDLE),w.DWORD,w.BOOL,w.DWORD])
_create_job=_bind(_kernel,'CreateJobObjectW',[ctypes.c_void_p,w.LPCWSTR],w.HANDLE)
_open_job=_bind(_kernel,'OpenJobObjectW',[w.DWORD,w.BOOL,w.LPCWSTR],w.HANDLE)
_job_limits=_bind(_kernel,'SetInformationJobObject',[w.HANDLE,ctypes.c_int,ctypes.c_void_p,w.DWORD])
_assign=_bind(_kernel,'AssignProcessToJobObject',[w.HANDLE,w.HANDLE])
_in_job=_bind(_kernel,'IsProcessInJob',[w.HANDLE,w.HANDLE,ctypes.POINTER(w.BOOL)])
_terminate_job=_bind(_kernel,'TerminateJobObject',[w.HANDLE,w.UINT])
_terminate_process=_bind(_kernel,'TerminateProcess',[w.HANDLE,w.UINT])
_create_event=_bind(_kernel,'CreateEventW',[ctypes.c_void_p,w.BOOL,w.BOOL,w.LPCWSTR],w.HANDLE)
_open_event=_bind(_kernel,'OpenEventW',[w.DWORD,w.BOOL,w.LPCWSTR],w.HANDLE)
_set_event=_bind(_kernel,'SetEvent',[w.HANDLE])
_init_attributes=_bind(_kernel,'InitializeProcThreadAttributeList',[ctypes.c_void_p,w.DWORD,w.DWORD,ctypes.POINTER(ctypes.c_size_t)])
_update_attributes=_bind(_kernel,'UpdateProcThreadAttribute',[ctypes.c_void_p,w.DWORD,ctypes.c_size_t,ctypes.c_void_p,ctypes.c_size_t,ctypes.c_void_p,ctypes.c_void_p])
_delete_attributes=_bind(_kernel,'DeleteProcThreadAttributeList',[ctypes.c_void_p],None)
_create_process=_bind(_kernel,'CreateProcessW',[w.LPCWSTR,w.LPWSTR,ctypes.c_void_p,ctypes.c_void_p,w.BOOL,w.DWORD,ctypes.c_void_p,w.LPCWSTR,ctypes.c_void_p,ctypes.POINTER(_PI)])
_resume=_bind(_kernel,'ResumeThread',[w.HANDLE],w.DWORD)
_create_file=_bind(_kernel,'CreateFileW',[w.LPCWSTR,w.DWORD,w.DWORD,ctypes.c_void_p,w.DWORD,w.DWORD,w.HANDLE],w.HANDLE)
_file_info=_bind(_kernel,'GetFileInformationByHandleEx',[w.HANDLE,ctypes.c_int,ctypes.c_void_p,w.DWORD])
_file_type=_bind(_kernel,'GetFileType',[w.HANDLE],w.DWORD)
_query=_bind(_nt,'NtQueryInformationProcess',[w.HANDLE,ctypes.c_int,ctypes.c_void_p,w.ULONG,ctypes.POINTER(w.ULONG)],ctypes.c_long)

def _check(value):
    if not value:raise ctypes.WinError(ctypes.get_last_error())
    return value
def _handle(value):
    if not value or value==_INVALID:raise ctypes.WinError(ctypes.get_last_error())
    return value
def _done(handle):
    if handle:_close(handle)
def _digest(value):return hashlib.sha256(value.encode('utf-16-le')).hexdigest()
def _birth(handle):
    values=[_FT() for _ in range(4)];_check(_times(handle,*[ctypes.byref(value) for value in values]))
    return values[0].low|(values[0].high<<32)
def _command(handle):
    needed=w.ULONG();_query(handle,60,None,0,ctypes.byref(needed))
    if not needed.value:raise OSError('The process command identity is unavailable.')
    buffer=ctypes.create_string_buffer(needed.value)
    status=_query(handle,60,buffer,len(buffer),ctypes.byref(needed))
    if status<0:raise OSError('The process command identity is unavailable: NTSTATUS '+hex(status&0xffffffff))
    text=_US.from_buffer(buffer);base=ctypes.addressof(buffer)
    if text.length%2 or not base<=text.buffer<=base+len(buffer)-text.length:
        raise OSError('The kernel returned an invalid process command descriptor.')
    return ctypes.string_at(text.buffer,text.length).decode('utf-16-le')
def _identity(handle,pid,job_name=None):
    if _wait(handle,0)!=258:return None
    size=w.DWORD(32768);image=ctypes.create_unicode_buffer(size.value);_check(_image(handle,0,image,ctypes.byref(size)))
    value={'backend':'win32-job/v1','pid':pid,'creation_filetime':_birth(handle),
        'image_sha256':_digest(image.value.casefold()),'command_sha256':_digest(_command(handle)),
        'process_group':pid}
    if job_name:
        job=_handle(_open_job(4,False,job_name))
        try:
            membership=w.BOOL();_check(_in_job(handle,job,ctypes.byref(membership)))
            if not membership.value:return None
            value['job_name']=job_name
        finally:_done(job)
    return value
def process_identity(pid=None,*,job_name=None):
    pid=os.getpid() if pid is None else int(pid)
    if pid<=0:return None
    if pid==os.getpid() and _worker:job_name=job_name or _worker['names']['job']
    handle=_open_process(0x0400|0x0010|0x100000,False,pid)
    if not handle:return None
    try:return _identity(handle,pid,job_name)
    except OSError:return None
    finally:_done(handle)
def identity_matches(expected):
    if not isinstance(expected,dict) or expected.get('backend')!='win32-job/v1':return False
    actual=process_identity(expected.get('pid',-1),job_name=expected.get('job_name'))
    keys=('backend','pid','creation_filetime','image_sha256','command_sha256','job_name')
    return bool(actual and all(actual.get(key)==expected.get(key) for key in keys))

def open_batch_lease(path):
    """Exclusive open-sharing survives inheritance; a byte-range lock does not."""
    path=native_path(path);path.parent.mkdir(parents=True,exist_ok=True)
    handle=_create_file(str(path),0x80000000|0x40000000,0,None,4,0x00200080,None)
    if not handle or handle==_INVALID:
        code=ctypes.get_last_error()
        if code in (32,33):raise BlockingIOError(errno.EAGAIN,'An original native batch still holds this lease.',str(path))
        raise ctypes.WinError(code)
    try:
        tag=_TAG();_check(_file_info(handle,9,ctypes.byref(tag),ctypes.sizeof(tag)))
        if tag.attributes&(0x400|0x10):raise ValueError('Choose an original regular batch lease file.')
        fd=msvcrt.open_osfhandle(handle,os.O_RDWR|os.O_BINARY);handle=None
        return fd
    finally:_done(handle)

def metadata_stat(path):
    """Read original metadata without requesting access denied by a live lease."""
    path=native_path(path)
    handle=_handle(_create_file(str(path),0,7,None,3,0x00200080,None))
    descriptor=None
    try:
        tag=_TAG();_check(_file_info(handle,9,ctypes.byref(tag),ctypes.sizeof(tag)))
        if tag.attributes&(0x400|0x10):raise ValueError('Choose an original regular metadata file.')
        descriptor=msvcrt.open_osfhandle(handle,os.O_RDONLY|os.O_BINARY);handle=None
        return fd_stat(descriptor)
    finally:
        if descriptor is not None:os.close(descriptor)
        _done(handle)

def exit_status(return_code):
    """Retain the unsigned Windows status without inventing a POSIX signal."""
    if type(return_code) is not int:return None
    raw=return_code&0xffffffff
    return {'platform':'Windows','raw_status':raw,'hex_status':'0x'+format(raw,'08X'),
            'abnormal_terminal_status':bool(raw&0x80000000)}

class OwnedProcess:
    def __init__(self,handle,job,pid,args,names):
        self._handle,self._job,self.pid,self.args,self.names=handle,job,pid,args,names
        self.returncode=None
    def poll(self):
        if self.returncode is not None:return self.returncode
        result=_wait(self._handle,0)
        if result==258:return None
        if result==0xffffffff:raise ctypes.WinError(ctypes.get_last_error())
        value=w.DWORD();_check(_exit(self._handle,ctypes.byref(value)));self.returncode=value.value
        return self.returncode
    def wait(self,timeout=None):
        if self.returncode is not None:return self.returncode
        milliseconds=0xffffffff if timeout is None else min(0xfffffffe,max(0,int(timeout*1000)))
        result=_wait(self._handle,milliseconds)
        if result==258:raise subprocess.TimeoutExpired(self.args,timeout)
        if result==0xffffffff:raise ctypes.WinError(ctypes.get_last_error())
        return self.poll()
    def identity(self):return _identity(self._handle,self.pid,self.names['job'])
    def terminate(self):return signal_owned(self.identity(),signal.SIGTERM)
    def kill(self):return signal_owned(self.identity(),9)
    def close(self):
        _done(self._handle);self._handle=None;_done(self._job);self._job=None
    def __del__(self):
        try:self.close()
        except Exception:pass

def spawn(argv,*,cwd=None,env=None,stdin=None,stdout=None,stderr=None,custody_fds=(),execution_id=None,request_sha256=None):
    """Create and assign an owned process before any of its child code runs."""
    arguments=[str(value) for value in argv]
    if not arguments or any('\0' in value for value in arguments):raise ValueError('Choose original argument strings.')
    nonce=secrets.token_hex(16);prefix='Local\\TJLabs.EcoNative.'+nonce
    names={'job':prefix+'.job','stop':prefix+'.stop'}
    job=_handle(_create_job(None,names['job']));event=None;duplicates=[];nulls=[];attributes=None;pi=_PI();assigned=False
    try:
        limits=_LIMIT();limits.basic.flags=0x2000
        _check(_job_limits(job,9,ctypes.byref(limits),ctypes.sizeof(limits)))
        event=_handle(_create_event(None,True,False,names['stop']))
        def dup(handle):
            result=w.HANDLE();_check(_duplicate(_current(),handle,_current(),ctypes.byref(result),0,True,2))
            duplicates.append(result.value);return result.value
        def stream_handle(value,read=False):
            if value is None or value==subprocess.DEVNULL:
                file=open(os.devnull,'rb' if read else 'ab');nulls.append(file);value=file
            if value in (subprocess.PIPE,subprocess.STDOUT):raise ValueError('Use retained file-backed child streams.')
            fd=value if isinstance(value,int) else value.fileno()
            return dup(msvcrt.get_osfhandle(fd))
        # Only our explicitly duplicated handles are temporarily inheritable.
        with _spawn_lock:
            input_handle=stream_handle(stdin,True);output_handle=stream_handle(stdout)
            error_handle=output_handle if stderr==subprocess.STDOUT else stream_handle(stderr)
            job_child=dup(job);event_child=dup(event)
            custody=[dup(msvcrt.get_osfhandle(fd)) for fd in custody_fds]
            environment=dict(os.environ if env is None else env)
            environment[_CONTEXT]=json.dumps({'schema':'upstate.windows-worker-context/v1','names':names,
                'execution_id':execution_id,'request_sha256':request_sha256,'job_handle':job_child,
                'stop_handle':event_child,'custody_handles':custody},separators=(',',':'))
            if any('\0' in str(key)+str(value) or '=' in str(key) for key,value in environment.items()):
                raise ValueError('Choose valid child environment entries.')
            block=ctypes.create_unicode_buffer('\0'.join(str(key)+'='+str(value) for key,value in sorted(environment.items(),key=lambda item:item[0].casefold()))+'\0\0')
            handles=(w.HANDLE*len(duplicates))(*duplicates)
            size=ctypes.c_size_t();_init_attributes(None,1,0,ctypes.byref(size))
            attributes=ctypes.create_string_buffer(size.value);_check(_init_attributes(attributes,1,0,ctypes.byref(size)))
            _check(_update_attributes(attributes,0,0x20002,handles,ctypes.sizeof(handles),None,None))
            startup=_SIEX();startup.StartupInfo.cb=ctypes.sizeof(startup);startup.StartupInfo.dwFlags=0x101
            startup.StartupInfo.wShowWindow=0;startup.StartupInfo.hStdInput=input_handle
            startup.StartupInfo.hStdOutput=output_handle;startup.StartupInfo.hStdError=error_handle
            startup.attributes=ctypes.addressof(attributes)
            command=ctypes.create_unicode_buffer(subprocess.list2cmdline(arguments))
            flags=0x4|0x200|0x400|0x80000|0x8000000
            _check(_create_process(None,command,None,None,True,flags,block,str(cwd) if cwd else None,ctypes.byref(startup),ctypes.byref(pi)))
            _check(_assign(job,pi.process))
            assigned=True
            if _resume(pi.thread)==0xffffffff:raise ctypes.WinError(ctypes.get_last_error())
        result=OwnedProcess(pi.process,job,pi.pid,arguments,names);pi.process=None;job=None
        return result
    except BaseException:
        if pi.process:
            if assigned:_terminate_job(job,1)
            else:_terminate_process(pi.process,1)
            _wait(pi.process,5000)
        raise
    finally:
        if attributes:_delete_attributes(attributes)
        _done(pi.thread);_done(pi.process);_done(job);_done(event)
        for handle in duplicates:_done(handle)
        for file in nulls:file.close()

def adopt_worker(execution_id,request_sha256):
    """Adopt only this queue-created process's inherited context and leases."""
    global _worker
    context=json.loads(os.environ.pop(_CONTEXT,''))
    if (context.get('schema')!='upstate.windows-worker-context/v1'
            or context.get('execution_id')!=execution_id or context.get('request_sha256')!=request_sha256):
        raise ValueError('The Windows worker context belongs to another original request.')
    membership=w.BOOL();_check(_in_job(_current(),context['job_handle'],ctypes.byref(membership)))
    if not membership.value:raise ValueError('The Windows worker is outside its owned job.')
    fds=[]
    try:
        for handle in context['custody_handles']:
            if _file_type(handle)!=1:raise ValueError('The inherited custody is not an original file handle.')
            fds.append(msvcrt.open_osfhandle(handle,os.O_RDWR|os.O_BINARY))
    except BaseException:
        for fd in fds:os.close(fd)
        raise
    _worker={**context,'fds':fds,'stop_closed':threading.Event()}
    def close():
        state=_worker
        if not state:return
        state['stop_closed'].set()
        for fd in state['fds']:
            try:os.close(fd)
            except OSError:pass
        _done(state['stop_handle']);_done(state['job_handle'])
    atexit.register(close)

def start_stop_bridge():
    if not _worker:raise ValueError('Adopt the original Windows worker context first.')
    state=_worker
    def observe():
        while not state['stop_closed'].is_set():
            value=_wait(state['stop_handle'],250)
            if value==0:
                signal.raise_signal(signal.SIGINT)
                return
            if value==0xffffffff:return
    threading.Thread(target=observe,name='native-windows-stop',daemon=True).start()

def signal_owned(identity,signum):
    """Notify or terminate only the fresh creation-bound, job-owned worker tree."""
    if not isinstance(identity,dict) or not identity.get('job_name') or not identity_matches(identity):return False
    process=_open_process(0x0400|0x0010|0x100000,False,identity['pid'])
    if not process:return False
    job=None;event=None
    try:
        if _identity(process,identity['pid'],identity.get('job_name'))!=identity:return False
        job=_handle(_open_job(4|8,False,identity['job_name']))
        if int(signum)==int(signal.SIGINT):
            event=_handle(_open_event(2,False,identity['job_name'].removesuffix('.job')+'.stop'))
            _check(_set_event(event))
        else:
            _check(_terminate_job(job,137 if int(signum)==9 else 143))
        return True
    finally:_done(event);_done(job);_done(process)
