# MIT. Receive the complete original STAC sources through the maintained session client.
import ast,base64,datetime,hashlib,json,os,pathlib,stat,sys,traceback
OPERATION='SCF-STAC-MANAGED-APPLICATION-RECEIVING-B710-20261012'
ROOT=pathlib.Path('/dev/b710-stac-applications-7169')
REPOSITORY='woahwhattheheck/public-commons-sprint-2026'
SOURCE_BLOB='e12ece6b6b7cd1fda53c522c9c0a5f0b16c58263'
SOURCE_BYTES=101193
SOURCE_SHA256='8d386d351e2650cef62d6bea9326ed64d395f775d9187665d346d2d1b9eb4551'
PACKET_BLOB='01b61e5e056abd203fe6f5de18c10b7ba38013b2'
PACKET_BYTES=2468401
PACKET_SHA256='4ab15fe3bdcd26648a896a251fcaaec41d6e4577c188f4412ba0ead3bcb50ea9'
CARRIER=base64.b64decode("aW1wb3J0IHN5cyxwYXRobGliLGpzb24sYmFzZTY0LGhhc2hsaWIsdGVybWlvcyxzdWJwcm9jZXNzLHNodXRpbCxvcyxkYXRldGltZSx6aXBmaWxlLHVybGxpYi5yZXF1ZXN0CnJvb3Q9cGF0aGxpYi5QYXRoKG9zLmVudmlyb24uZ2V0KCJPUEVORkVNQV9SRUNFSVZJTkdfUk9PVCIsIi9kZXYvb3BlbmZlbWEtbmF0aXZlLTNiZGEtMjAyNjEwMTIiKSk7cm9vdC5ta2Rpcihtb2RlPTBvNzAwLGV4aXN0X29rPVRydWUpCmFzc2VydCBub3Qgcm9vdC5pc19zeW1saW5rKCkgYW5kIHJvb3QuaXNfZGlyKCkgYW5kIHJvb3Quc3RhdCgpLnN0X3VpZD09b3MuZ2V0dWlkKCkgYW5kIHJvb3Quc3RhdCgpLnN0X21vZGUmMG8wNzc9PTAsIlVzZSBhbiBvd25lZCBwcml2YXRlIHJlY2VpdmluZyByb290IgppZiBzeXMuc3RkaW4uaXNhdHR5KCk6CiBhPXRlcm1pb3MudGNnZXRhdHRyKDApO2FbM10mPX4odGVybWlvcy5JQ0FOT058dGVybWlvcy5FQ0hPKTthWzZdW3Rlcm1pb3MuVk1JTl09MTthWzZdW3Rlcm1pb3MuVlRJTUVdPTA7dGVybWlvcy50Y3NldGF0dHIoMCx0ZXJtaW9zLlRDU0FOT1csYSkKZW52PXsqKm9zLmVudmlyb24sIlBZVEhPTkRPTlRXUklURUJZVEVDT0RFIjoiMSIsIlRNUERJUiI6c3RyKHJvb3QpfQpkZXBfY2FuZGlkYXRlcz1bb3MuZW52aXJvbi5nZXQoIk9QRU5GRU1BX05PREVfTU9EVUxFUyIsIiIpLCIvd29ya3NwYWNlL3NjcmF0Y2gvMmQ1ODliMTFmMDZkL3NjZi1vYXV0aC1kZXBzL25vZGVfbW9kdWxlcyIsb3MuZW52aXJvbi5nZXQoIkNPREVYX1BSSU1BUllfUlVOVElNRV9OT0RFX01PRFVMRVMiLCIiKV0KZGVwcz1bcCBmb3IgcCBpbiBkZXBfY2FuZGlkYXRlcyBpZiBwIGFuZCBwYXRobGliLlBhdGgocCkuaXNfZGlyKCldCmlmIGRlcHM6CiBlbnZbIk5PREVfUEFUSCJdPW9zLnBhdGhzZXAuam9pbihkZXBzKQogc2VsZWN0ZWRfZGVwcz1uZXh0KChwIGZvciBwIGluIGRlcHMgaWYgcGF0aGxpYi5QYXRoKHAsInJlMmpzIikuZXhpc3RzKCkpLGRlcHNbMF0pCiBpZiBub3QgKHJvb3QvIm5vZGVfbW9kdWxlcyIpLmV4aXN0cygpOm9zLnN5bWxpbmsoc2VsZWN0ZWRfZGVwcyxyb290LyJub2RlX21vZHVsZXMiLHRhcmdldF9pc19kaXJlY3Rvcnk9VHJ1ZSkKbm9kZT1vcy5lbnZpcm9uLmdldCgiQ09ERVhfUFJJTUFSWV9SVU5USU1FX05PREUiKSBvciBzaHV0aWwud2hpY2goIm5vZGUiKQpsb2dzPXJvb3QvIm5hdGl2ZS1sb2dzIjtsb2dzLm1rZGlyKG1vZGU9MG83MDAsZXhpc3Rfb2s9VHJ1ZSkKcGhhc2VzPVtdCmRlZiBzYXZlZCgpOgogcmVzdWx0PXsic2NoZW1hIjoic3RlbGxhci1mb3JnZS5vcGVuZmVtYS1uYXRpdmUtb3BlcmF0aW9uLnYxIiwib3BlcmF0aW9uSWQiOm9zLmVudmlyb24uZ2V0KCJPUEVORkVNQV9PUEVSQVRJT05fSUQiLCJTQ0YtT1BFTkZFTUEtUE9SVEZPTElPLTNCREEtMjAyNjEwMTIiKSwicm9vdCI6c3RyKHJvb3QpLCJwaWQiOm9zLmdldHBpZCgpLCJub2RlIjpub2RlLCJwaGFzZXMiOnBoYXNlcywidXBkYXRlZEF0IjpkYXRldGltZS5kYXRldGltZS5ub3coZGF0ZXRpbWUudGltZXpvbmUudXRjKS5pc29mb3JtYXQoKX0KIHA9cm9vdC8iTkFUSVZFX09QRVJBVElPTi5qc29uIjtwLndyaXRlX3RleHQoanNvbi5kdW1wcyhyZXN1bHQsaW5kZW50PTIpKyJcbiIpO3AuY2htb2QoMG82MDApO3JldHVybiByZXN1bHQKZGVmIHNlbGVjdGVkKG5hbWUpOgogcD1yb290L25hbWUKIGFzc2VydCBub3QgcGF0aGxpYi5QdXJlUGF0aChuYW1lKS5pc19hYnNvbHV0ZSgpIGFuZCBwLmlzX3JlbGF0aXZlX3RvKHJvb3QpIGFuZCAiLi4iIG5vdCBpbiBwYXRobGliLlB1cmVQYXRoKG5hbWUpLnBhcnRzCiByZXR1cm4gcApkZWYgcHV0KGZpbGVzKToKIG91dD1bXQogZm9yIGYgaW4gZmlsZXM6CiAgcD1zZWxlY3RlZChmWyJwYXRoIl0pO2I9YmFzZTY0LmI2NGRlY29kZShmWyJiYXNlNjQiXSx2YWxpZGF0ZT1UcnVlKSBpZiAiYmFzZTY0IiBpbiBmIGVsc2UgZlsidGV4dCJdLmVuY29kZSgidXRmLTgiKQogIGFzc2VydCBoYXNobGliLnNoYTI1NihiKS5oZXhkaWdlc3QoKT09Zlsic2hhMjU2Il0sZlsicGF0aCJdCiAgcC5wYXJlbnQubWtkaXIocGFyZW50cz1UcnVlLGV4aXN0X29rPVRydWUsbW9kZT0wbzcwMCkKICBpZiBwLmV4aXN0cygpOmFzc2VydCBwLnJlYWRfYnl0ZXMoKT09YixmWyJwYXRoIl0KICBlbHNlOgogICB3aXRoIHAub3BlbigieGIiKSBhcyBoOmgud3JpdGUoYikKICBwLmNobW9kKDBvNjAwKTtvdXQuYXBwZW5kKHsicGF0aCI6ZlsicGF0aCJdLCJieXRlcyI6bGVuKGIpLCJzaGEyNTYiOmZbInNoYTI1NiJdfSkKIHJldHVybiB7ImNvdW50IjpsZW4ob3V0KSwiYnl0ZXMiOnN1bShmWyJieXRlcyJdIGZvciBmIGluIG91dCl9CmRlZiBydW4ocSk6CiBsYWJlbD1xWyJsYWJlbCJdO2Fzc2VydCBsYWJlbC5yZXBsYWNlKCItIiwiIikucmVwbGFjZSgiXyIsIiIpLmlzYWxudW0oKQogYXJndj1bbm9kZSBpZiBhPT0iQG5vZGUiIGVsc2Ugc3RyKHJvb3QvYVs2Ol0pIGlmIGEuc3RhcnRzd2l0aCgiQHJvb3QvIikgZWxzZSBhIGZvciBhIGluIHFbImFyZ3YiXV0KIHByaW50KGpzb24uZHVtcHMoeyJwaGFzZSI6bGFiZWwsInN0YXJ0ZWRBdCI6ZGF0ZXRpbWUuZGF0ZXRpbWUubm93KGRhdGV0aW1lLnRpbWV6b25lLnV0YykuaXNvZm9ybWF0KCl9KSxmbHVzaD1UcnVlKQogcj1zdWJwcm9jZXNzLnJ1bihhcmd2LGN3ZD1yb290LGVudj1lbnYsY2FwdHVyZV9vdXRwdXQ9VHJ1ZSx0ZXh0PVRydWUpCiBmb3IgbmFtZSx0ZXh0IGluIFsobGFiZWwrIi5zdGRvdXQiLHIuc3Rkb3V0KSwobGFiZWwrIi5zdGRlcnIiLHIuc3RkZXJyKV06CiAgcD1sb2dzL25hbWU7cC53cml0ZV90ZXh0KHRleHQpO3AuY2htb2QoMG82MDApCiB0cnk6dmFsdWU9anNvbi5sb2FkcyhyLnN0ZG91dCkKIGV4Y2VwdDp2YWx1ZT17InN0ZG91dCI6ci5zdGRvdXRbLTEyMDAwOl19CiBpdGVtPXsicGhhc2UiOmxhYmVsLCJleGl0Q29kZSI6ci5yZXR1cm5jb2RlLCJyZXN1bHQiOnZhbHVlLCJzdGRlcnIiOnIuc3RkZXJyWy01MDAwOl0sImNvbXBsZXRlZEF0IjpkYXRldGltZS5kYXRldGltZS5ub3coZGF0ZXRpbWUudGltZXpvbmUudXRjKS5pc29mb3JtYXQoKX0KIHBoYXNlcy5hcHBlbmQoaXRlbSk7c2F2ZWQoKQogcmV0dXJuIGl0ZW0KcHJpbnQoIk9QRU5GRU1BX1BFUlNJU1RFTlRfUkVBRFkgIitqc29uLmR1bXBzKHsicm9vdCI6c3RyKHJvb3QpLCJwaWQiOm9zLmdldHBpZCgpLCJub2RlIjpub2RlLCJmcmVlQnl0ZXMiOnNodXRpbC5kaXNrX3VzYWdlKCIvZGV2IikuZnJlZSwibWVtb3J5Q3VycmVudCI6cGF0aGxpYi5QYXRoKCIvc3lzL2ZzL2Nncm91cC9tZW1vcnkuY3VycmVudCIpLnJlYWRfdGV4dCgpLnN0cmlwKCkgaWYgcGF0aGxpYi5QYXRoKCIvc3lzL2ZzL2Nncm91cC9tZW1vcnkuY3VycmVudCIpLmV4aXN0cygpIGVsc2UgTm9uZSwibWVtb3J5TWF4IjpwYXRobGliLlBhdGgoIi9zeXMvZnMvY2dyb3VwL21lbW9yeS5tYXgiKS5yZWFkX3RleHQoKS5zdHJpcCgpIGlmIHBhdGhsaWIuUGF0aCgiL3N5cy9mcy9jZ3JvdXAvbWVtb3J5Lm1heCIpLmV4aXN0cygpIGVsc2UgTm9uZSwiZGVwZW5kZW5jeVBhdGhzIjpkZXBzLCJwcmltYXJ5Tm9kZU1vZHVsZXMiOm9zLmVudmlyb24uZ2V0KCJDT0RFWF9QUklNQVJZX1JVTlRJTUVfTk9ERV9NT0RVTEVTIiksImNocm9taXVtIjpuZXh0KChwIGZvciBwIGluIFtvcy5lbnZpcm9uLmdldCgiT1BFTkZFTUFfQ0hST01JVU0iLCIiKSwiL3dvcmtzcGFjZS9zY3JhdGNoLzc1NzNkMTMwNjVkNS9hdXJvcmFfb3BzL2Jyb3dzZXItcnVudGltZS90bXAvY2hyb21pdW0iLCIvd29ya3NwYWNlL3NjcmF0Y2gvYmMwODUwZDdiYTIzL2Jyb3dzZXItcnVudGltZS9jaHJvbWUtaGVhZGxlc3Mtc2hlbGwiXSBpZiBwIGFuZCBwYXRobGliLlBhdGgocCkuaXNfZmlsZSgpKSxOb25lKX0pLGZsdXNoPVRydWUpCndoaWxlIFRydWU6CiByYXc9c3lzLnN0ZGluLmJ1ZmZlci5yZWFkbGluZSgpCiBpZiBub3QgcmF3OmJyZWFrCiB0cnk6CiAgcT1qc29uLmxvYWRzKHJhdyk7Y21kPXFbImNvbW1hbmQiXQogIGlmIGNtZD09InN0b3AiOnByaW50KCJPUEVORkVNQV9CUklER0VfU1RPUFBFRCIsZmx1c2g9VHJ1ZSk7YnJlYWsKICBpZiBjbWQ9PSJwdXQiOnByaW50KGpzb24uZHVtcHMoeyJjb21tYW5kIjoicHV0IiwicmVzdWx0IjpwdXQocVsiZmlsZXMiXSl9KSxmbHVzaD1UcnVlKQogIGVsaWYgY21kPT0icnVuIjpwcmludChqc29uLmR1bXBzKHsiY29tbWFuZCI6InJ1biIsInJlc3VsdCI6cnVuKHEpfSksZmx1c2g9VHJ1ZSkKICBlbGlmIGNtZD09InVwbG9hZCI6CiAgIHA9c2VsZWN0ZWQocVsic291cmNlIl0pO2I9cC5yZWFkX2J5dGVzKCk7ZGlnZXN0PWhhc2hsaWIuc2hhMjU2KGIpLmhleGRpZ2VzdCgpO2Fzc2VydCBkaWdlc3Q9PXFbInNoYTI1NiJdCiAgIHNlc3Npb249cVsidXBsb2FkIl07YXNzZXJ0IHNlc3Npb25bIm1ldGhvZCJdPT0iUFVUIiBhbmQgc2Vzc2lvblsidXBsb2FkX3VybCJdLnN0YXJ0c3dpdGgoImh0dHBzOi8vIikKICAgcmVxdWVzdD11cmxsaWIucmVxdWVzdC5SZXF1ZXN0KHNlc3Npb25bInVwbG9hZF91cmwiXSxkYXRhPWIsbWV0aG9kPXNlc3Npb25bIm1ldGhvZCJdLGhlYWRlcnM9c2Vzc2lvblsicmVxdWlyZWRfaGVhZGVycyJdKQogICB3aXRoIHVybGxpYi5yZXF1ZXN0LnVybG9wZW4ocmVxdWVzdCx0aW1lb3V0PTQ1KSBhcyByZXNwb25zZToKICAgIHJlc3BvbnNlX2JvZHk9cmVzcG9uc2UucmVhZCgpO3Jlc3VsdD17ImNvbW1hbmQiOiJ1cGxvYWQiLCJwYXRoIjpxWyJzb3VyY2UiXSwiYnl0ZXMiOmxlbihiKSwic2hhMjU2IjpkaWdlc3QsInN0YXR1cyI6cmVzcG9uc2Uuc3RhdHVzLCJ1cGxvYWRfc2Vzc2lvbl9pZCI6c2Vzc2lvblsidXBsb2FkX3Nlc3Npb25faWQiXX0KICAgcHJpbnQoanNvbi5kdW1wcyhyZXN1bHQpLGZsdXNoPVRydWUpCiAgZWxpZiBjbWQ9PSJwYWNrIjoKICAgdGFyZ2V0PXNlbGVjdGVkKHFbInRhcmdldCJdKTtzb3VyY2U9c2VsZWN0ZWQocVsic291cmNlIl0pO2VudHJpZXM9W10KICAgYXNzZXJ0IHNvdXJjZS5pc19kaXIoKSBhbmQgbm90IHNvdXJjZS5pc19zeW1saW5rKCkKICAgd2l0aCB6aXBmaWxlLlppcEZpbGUodGFyZ2V0LCJ3Iixjb21wcmVzc2lvbj16aXBmaWxlLlpJUF9ERUZMQVRFRCxjb21wcmVzc2xldmVsPTYpIGFzIGFyY2hpdmU6CiAgICBmb3IgcCBpbiBzb3J0ZWQoc291cmNlLnJnbG9iKCIqIikpOgogICAgIGlmIHAuaXNfc3ltbGluaygpOnJhaXNlIFZhbHVlRXJyb3IoIlN5bWJvbGljIGxpbmsgaW4gcmVjZWl2aW5nIGFyY2hpdmU6ICIrc3RyKHApKQogICAgIGlmIHAuaXNfZmlsZSgpOgogICAgICBuYW1lPXN0cihwLnJlbGF0aXZlX3RvKHNvdXJjZSkpO2FyY2hpdmUud3JpdGUocCxuYW1lKTtlbnRyaWVzLmFwcGVuZCh7InBhdGgiOm5hbWUsImJ5dGVzIjpwLnN0YXQoKS5zdF9zaXplfSkKICAgdGFyZ2V0LmNobW9kKDBvNjAwKTtiPXRhcmdldC5yZWFkX2J5dGVzKCkKICAgcHJpbnQoanNvbi5kdW1wcyh7ImNvbW1hbmQiOiJwYWNrIiwicGF0aCI6cVsidGFyZ2V0Il0sImJ5dGVzIjpsZW4oYiksInNoYTI1NiI6aGFzaGxpYi5zaGEyNTYoYikuaGV4ZGlnZXN0KCksImVudHJpZXMiOmxlbihlbnRyaWVzKX0pLGZsdXNoPVRydWUpCiAgZWxpZiBjbWQ9PSJzdGF0dXMiOnByaW50KGpzb24uZHVtcHMoeyJjb21tYW5kIjoic3RhdHVzIiwicmVzdWx0IjpzYXZlZCgpLCJmaWxlcyI6W3sicGF0aCI6c3RyKHAucmVsYXRpdmVfdG8ocm9vdCkpLCJieXRlcyI6cC5zdGF0KCkuc3Rfc2l6ZX0gZm9yIHAgaW4gcm9vdC5yZ2xvYigiKiIpIGlmIHAuaXNfZmlsZSgpXX0pLGZsdXNoPVRydWUpCiAgZWxpZiBjbWQ9PSJyZWFkIjoKICAgcD1zZWxlY3RlZChxWyJwYXRoIl0pO2I9cC5yZWFkX2J5dGVzKCk7b2Zmc2V0PWludChxLmdldCgib2Zmc2V0IiwwKSk7bGVuZ3RoPW1pbihpbnQocS5nZXQoImxlbmd0aCIsNDkxNTIpKSw0OTE1Mik7YXNzZXJ0IG9mZnNldD49MCBhbmQgbGVuZ3RoPjAKICAgcHJpbnQoanNvbi5kdW1wcyh7InBhdGgiOnFbInBhdGgiXSwiYnl0ZXMiOmxlbihiKSwic2hhMjU2IjpoYXNobGliLnNoYTI1NihiKS5oZXhkaWdlc3QoKSwib2Zmc2V0IjpvZmZzZXQsImJhc2U2NCI6YmFzZTY0LmI2NGVuY29kZShiW29mZnNldDpvZmZzZXQrbGVuZ3RoXSkuZGVjb2RlKCksImhhc01vcmUiOm9mZnNldCtsZW5ndGg8bGVuKGIpfSksZmx1c2g9VHJ1ZSkKICBlbHNlOnJhaXNlIFZhbHVlRXJyb3IoIlVzZSBwdXQsIHJ1biwgcmVhZCwgc3RhdHVzIG9yIHN0b3AiKQogZXhjZXB0IEV4Y2VwdGlvbiBhcyBlOnByaW50KGpzb24uZHVtcHMoeyJlcnJvciI6c3RyKGUpfSksZmx1c2g9VHJ1ZSkK",validate=True)
assert len(CARRIER)==6315 and hashlib.sha256(CARRIER).hexdigest()=='18508b5c566d13c7d6f4a4ec680f2d34c84d12fcc741f38a466b4679aeea66b9'
ast.parse(CARRIER)
prepare_original=len(sys.argv)==3 and sys.argv[1]=='--prepare-original'
if prepare_original:request={'attemptLabel':sys.argv[2]}
elif len(sys.argv)>2:raise SystemExit('Usage: receive-connected-source.py [PRIVATE_REQUEST_JSON] | --prepare-original native-N')
elif len(sys.argv)==2:
 with pathlib.Path(sys.argv[1]).open() as f:request=json.load(f)
else:request=json.load(sys.stdin)
sys.stdin=sys.__stdin__
if set(request)!=({'attemptLabel'} if prepare_original else {'archiveTransfers','upload','attemptLabel'}):raise ValueError('Use the same two original archive transfers, final upload and selected original continuation')
attempt_label=request['attemptLabel']
if not isinstance(attempt_label,str) or not attempt_label.startswith('native-') or not attempt_label[7:].isdigit() or int(attempt_label[7:])<3:raise ValueError('Use the selected numbered continuation of the original native operation')
ROOT.mkdir(mode=0o700,parents=True,exist_ok=True)
info=ROOT.lstat()
if not stat.S_ISDIR(info.st_mode) or ROOT.is_symlink() or info.st_uid!=os.getuid() or info.st_mode&0o077:raise ValueError('Use the original owned private operation root')
# mkdir(parents=True) does not apply its mode to intermediate parents.
delivery=ROOT/'delivery';delivery.mkdir(mode=0o700,exist_ok=True)
delivery_info=delivery.lstat()
if not stat.S_ISDIR(delivery_info.st_mode) or delivery.is_symlink() or delivery_info.st_uid!=os.getuid() or delivery_info.st_mode&0o077:raise ValueError('Preserve a non-private original delivery directory: '+str(delivery))
def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def exact(path,data):
 path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
 if path.exists():
  if path.is_symlink() or path.read_bytes()!=data:raise ValueError('Preserve a changed original source file: '+str(path))
 else:
  with path.open('xb') as f:f.write(data)
 path.chmod(0o600)
def carrier():
 os.environ['OPENFEMA_RECEIVING_ROOT']=str(ROOT)
 os.environ['OPENFEMA_OPERATION_ID']=OPERATION
 sys.stdin=sys.__stdin__
 exec(compile(CARRIER,'original-retained-carrier.py','exec'),{'__name__':'__main__'})
print(json.dumps({'stage':'ORIGINAL_CONNECTED_SOURCE_RECEIVING','operationId':OPERATION,'attemptLabel':attempt_label,'pid':os.getpid(),'root':str(ROOT),'sourceBlob':SOURCE_BLOB,'packetBlob':PACKET_BLOB}),flush=True)
client=None;selected=None;source_path=ROOT/'native-source-receiving.py'
packet_path=ROOT/'source-input'/'fixed7169-residual-source.json.gz.b64'
receipts=[]
try:
 helper=pathlib.Path('/workspace/scratch/b71092915960/wherobots/library-upload-20261012/library_hosted_apps.py')
 if hashlib.sha256(helper.read_bytes()).hexdigest()!='b7961301f7ca6f76b2f2f30e4e5673a303532680a790e545c3207a2bf5e63de4':raise ValueError('The maintained session client source changed')
 sys.path.insert(0,str(helper.parent))
 from library_hosted_apps import HostedAppsClient,HostedAppTool
 client=HostedAppsClient()
 def selected_tool(action):
  cursor=None;seen=set();found={}
  for _ in range(100):
   reply=client._rpc('tools/list',{} if cursor is None else {'cursor':cursor})
   rows=reply.get('tools')
   if not isinstance(rows,list):raise ValueError('Original session tool discovery returned no tools')
   for row in rows:
    name=row.get('name');meta=row.get('_meta')
    if not isinstance(name,str) or not isinstance(meta,dict):continue
    if name!=action and not name.endswith(('_'+action,'.'+action)):continue
    connector=next((meta.get(k) for k in ('connector_id','connectorId','app_id','appId') if meta.get(k) is not None),None)
    if not isinstance(connector,str) or not connector:continue
    found[(connector,name)]=HostedAppTool(name=name,meta=meta)
   next_cursor=reply.get('nextCursor',reply.get('next_cursor'))
   if not isinstance(next_cursor,str) or not next_cursor:break
   if next_cursor in seen:raise ValueError('Original tool discovery cursor repeated')
   seen.add(next_cursor);cursor=next_cursor
  if len(found)!=1:raise ValueError('Expected one discovered original '+action+' tool; found '+str(len(found)))
  (connector,name),tool=next(iter(found.items()))
  client._tools.append(tool)
  return connector,name
 def content(result):
  if result.get('isError') is True:raise ValueError('Original Git source read returned a tool error')
  value=result.get('structuredContent')
  if isinstance(value,dict) and isinstance(value.get('content'),str):return value['content']
  blocks=result.get('content')
  if isinstance(blocks,list):
   for block in blocks:
    if isinstance(block,dict) and block.get('type')=='text':
     try:value=json.loads(block.get('text',''))
     except (ValueError,TypeError):continue
     if isinstance(value,dict) and isinstance(value.get('content'),str):return value['content']
  raise ValueError('Original Git blob response has no complete text content')
 def receive(blob,path,size,wanted):
  global selected
  if path.is_file():
   data=path.read_bytes()
  else:
   if selected is None:selected=selected_tool('fetch_blob')
   connector,name=selected
   response=client.call_tool(connector,'fetch_blob',{'repository_full_name':REPOSITORY,'blob_sha':blob})
   data=content(response).encode('utf-8')
  if len(data)!=size or hashlib.sha256(data).hexdigest()!=wanted:raise ValueError('The complete original Git source changed: '+blob)
  if hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()!=blob:raise ValueError('Original Git object identity changed: '+blob)
  exact(path,data)
  receipts.append({'repository':REPOSITORY,'blob':blob,'path':str(path),'bytes':len(data),'sha256':wanted,'receivedAt':stamp(),'originalTool':selected[1] if selected else 'retained-verified-file'})
  print(json.dumps({'stage':'ORIGINAL_CONNECTED_SOURCE_RECEIVED',**receipts[-1]}),flush=True)
  return data
 source=receive(SOURCE_BLOB,source_path,SOURCE_BYTES,SOURCE_SHA256)
 ast.parse(source)
 receive(PACKET_BLOB,packet_path,PACKET_BYTES,PACKET_SHA256)

 if prepare_original:
  def payload(result,field):
   if result.get('isError') is True:raise ValueError('Original '+field+' request returned a tool error')
   value=result.get('structuredContent')
   if isinstance(value,dict) and isinstance(value.get(field),list):return value
   blocks=result.get('content')
   if isinstance(blocks,list):
    for block in blocks:
     if not isinstance(block,dict) or block.get('type')!='text':continue
     try:value=json.loads(block.get('text',''))
     except (ValueError,TypeError):continue
     if isinstance(value,dict) and isinstance(value.get(field),list):return value
   raise ValueError('Original preparation returned no complete '+field+' payload')
  def prepare(action,arguments,field):
   request_path=ROOT/'private-uploads'/(attempt_label+'-'+action+'-request.json')
   response_path=ROOT/'private-uploads'/(attempt_label+'-'+action+'-response.json')
   record={'operationId':OPERATION,'attemptLabel':attempt_label,'action':action,'arguments':arguments}
   encoded=(json.dumps(record,sort_keys=True,indent=2)+'\n').encode()
   if response_path.is_file():
    exact(request_path,encoded)
    response=json.loads(response_path.read_text())
   else:
    if request_path.exists():raise ValueError('Reconcile the original '+action+' reply before reissuing this saved request')
    exact(request_path,encoded)
    connector,name=selected_tool(action)
    response=client.call_tool(connector,action,arguments)
    exact(response_path,(json.dumps(response,indent=2)+'\n').encode())
   return payload(response,field)
  materialized=prepare('prepare_materialize',{'items':[
   {'library_file_id':'libfile_3f476ddd80548191bec55a808c89ce88','file_id':'file_0000000007c481f98c9b288dcdfa06a1','file_name':'source-db3d9cb3d64f.tgz'},
   {'library_file_id':'libfile_970767081ea88191a2ba37aa50dfc85b','file_id':'file_00000000b0cc81f9a1dc3f4138138e7a','file_name':'tokenjunkielabs-starforge-merchant-0.1.0-source.gd16e851341db.tgz'}
  ]},'transfers')
  transfers=materialized['transfers']
  if materialized.get('unavailable_items') or len(transfers)!=2:raise ValueError('Receive both original pinned source archives')
  expected=[('file_0000000007c481f98c9b288dcdfa06a1','libfile_3f476ddd80548191bec55a808c89ce88','source-db3d9cb3d64f.tgz'),
   ('file_00000000b0cc81f9a1dc3f4138138e7a','libfile_970767081ea88191a2ba37aa50dfc85b','tokenjunkielabs-starforge-merchant-0.1.0-source.gd16e851341db.tgz')]
  for transfer,(file_id,library_id,filename) in zip(transfers,expected):
   if transfer.get('file_id')!=file_id or transfer.get('library_file_id')!=library_id or transfer.get('current_version_number')!=0:raise ValueError('The original archive source selection changed')
   if transfer.get('workspace_path'):
    materializer_source=helper.parent/'library_file_transfer.py'
    if hashlib.sha256(materializer_source.read_bytes()).hexdigest()!='5c81478cd94a59d721a1677d0bd36f7cec23c18a21b48740b1c9ff94d27fb26f':raise ValueError('The maintained Library materializer source changed')
    from library_file_transfer import LibraryFileTransfer,LibraryFileMaterializer
    destination=ROOT/'donors'/filename;destination.parent.mkdir(mode=0o700,exist_ok=True)
    LibraryFileMaterializer().materialize(LibraryFileTransfer.parse(transfer),destination)
  prepared=prepare('prepare_uploads',{'uploads':[{'file_name':'SCF_STAC_Managed_Applications_Native_20261012.zip','purpose':'create_library_file','mime_type':'application/zip','library_artifact_type':'other'}]},'uploads')
  uploads=prepared['uploads']
  if len(uploads)!=1 or uploads[0].get('method')!='PUT' or not isinstance(uploads[0].get('upload_url'),str) or not uploads[0]['upload_url'].startswith('https://'):raise ValueError('Use the original prepared final archive upload')
  request={'attemptLabel':attempt_label,'archiveTransfers':transfers,'upload':uploads[0]}
  exact(ROOT/'private-uploads'/(attempt_label+'-prepared-original-input.json'),(json.dumps(request)+'\n').encode())
  print(json.dumps({'stage':'ORIGINAL_TRANSFERS_PREPARED','operationId':OPERATION,'attemptLabel':attempt_label,'archiveFileIds':[x['file_id'] for x in transfers],'uploadFileId':uploads[0]['file_id'],'preparedAt':stamp()}),flush=True)
 source_receipt=(json.dumps({'operationId':OPERATION,'attemptLabel':attempt_label,'files':receipts},indent=2)+'\n').encode()
 exact(ROOT/'delivery'/'original-source'/'connected-source-receiving.json',source_receipt)
 exact(ROOT/'delivery'/'original-operation'/'native-source-receiving.py',source)
 if '__file__' in globals():
  own=pathlib.Path(__file__)
  if own.is_file() and not own.is_symlink():exact(ROOT/'delivery'/'original-operation'/'receive-connected-source.py',own.read_bytes())
 selection={**request,'residualSourcePacket':{'path':str(packet_path),'bytes':PACKET_BYTES,'sha256':PACKET_SHA256,'gzipBytes':1851298,'gzipSha256':'82cb77166ab6f9e53efa748009ca3ff297bb2533691cd2760f1f2d34f6bd588e','decodedBytes':7127758,'decodedSha256':'eb133b97b3e7bb24ef10eef5aa45d7a45aefffa05062836ed6d6831a8b2d1bfc'}}
 selected_path=ROOT/'private-uploads'/(attempt_label+'-complete-source-input.json')
 exact(selected_path,(json.dumps(selection)+'\n').encode())
 sys.argv=[str(source_path),str(selected_path)]
 exec(compile(source,str(source_path),'exec'),{'__name__':'__main__','__file__':str(source_path)})
except (Exception,SystemExit) as error:
 if isinstance(error,SystemExit) and error.code in (None,0):raise
 diagnostic=ROOT/'private-uploads'/'connected-source-failure.txt'
 try:
  diagnostic.parent.mkdir(mode=0o700,exist_ok=True)
  with diagnostic.open('x') as f:f.write(traceback.format_exc())
  diagnostic.chmod(0o600)
  result=getattr(error,'result',None)
  if isinstance(result,dict):exact(ROOT/'private-uploads'/'connected-source-tool-error.json',(json.dumps(result)+'\n').encode())
 except OSError:pass
 print(json.dumps({'stage':'ORIGINAL_CONNECTED_SOURCE_ATTENTION','operationId':OPERATION,'attemptLabel':attempt_label,'errorType':type(error).__name__,'message':str(error) if 'http' not in str(error).lower() else 'Original connected source request failed; exact private error retained','privateDiagnostic':str(diagnostic),'root':str(ROOT)}),flush=True)
 carrier()
