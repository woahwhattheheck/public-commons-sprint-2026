"""Exercise native transfer bytes and interruption; no model output is simulated."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

MODULE = Path(__file__).parents[1] / 'model/project_transfer.py'
spec = importlib.util.spec_from_file_location('transfer', MODULE)
t = importlib.util.module_from_spec(spec)
spec.loader.exec_module(t)

class ReceivingRecoveryTests(unittest.TestCase):
    def test_interruption_and_editable_replay(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            project = {'schema': t.WORKSPACE_SCHEMA, 'id': 'receiving-mechanics-fixture'}
            originals = {'workspace/workspace.json': t.canonical(project),
                         'workspace/source/original.bin': bytes(range(256)) * 600,
                         'application/native-tool.sh': b'#!/bin/sh\nexit 0\n',
                         'workspace/source/.transfer-file-original': b'original-name-must-survive'}
            manifest = {'schema': t.ARCHIVE_FORMAT, 'project': project,
                        'members': {name: {'bytes': len(data), 'sha256': t.sha(data),
                                          'mode': '100755' if name.endswith('.sh') else '100644'}
                                    for name, data in originals.items()}}
            archive = root / 'original.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                for name, data in originals.items():
                    member = zipfile.ZipInfo(name)
                    member.external_attr = int(manifest['members'][name]['mode'], 8) << 16
                    z.writestr(member, data)
                z.writestr('ARCHIVE.json', t.canonical(manifest))
            sender = t.TransferStore(root / 'sender')
            snapshot = sender.capture_archive(archive, chunk_bytes=65536)
            receiver = t.TransferStore(root / 'receiver')
            receiver.accept_snapshot(snapshot)
            for key, size in t.block_inventory(snapshot).items():
                data = sender.get_block(key, size)
                halfway = size // 2
                receiver.receive_block(snapshot['id'], key, io.BytesIO(data[:halfway]), length=halfway)
                result = receiver.receive_block(snapshot['id'], key, io.BytesIO(data[halfway:]), offset=halfway)
                assert result['complete']
            destination = root / 'editable'
            def interrupted(progress):
                if progress['files_done'] == 2:
                    raise t.Cancelled('represent interrupted receiving')
            try:
                t.receive_directory(receiver, snapshot['id'], destination, progress=interrupted)
                raise AssertionError('expected interruption')
            except t.Cancelled:
                pass
            stage, = root.glob('.transfer-receive-*')
            pending = stage / 'workspace/source/.transfer-file-abandoned'
            pending.parent.mkdir(parents=True, exist_ok=True)
            pending.write_bytes(b'incomplete bytes left by process termination')
            receipt = t.receive_directory(receiver, snapshot['id'], destination)
            assert receipt['identity'] == 'MATCH' and receipt['reused_files'] >= 2
            assert not (destination / pending.relative_to(stage)).exists()
            for name, data in originals.items():
                assert (destination / name).read_bytes() == data
            t.verify_directory(receiver, snapshot['id'], destination)
            unexpected = destination / 'workspace/source/unexpected.bin'
            unexpected.write_bytes(b'recipient edit')
            try:
                t.verify_directory(receiver, snapshot['id'], destination)
                raise AssertionError('unexpected members must fail original-byte verification')
            except t.TransferError:
                pass
            replay = t.receive_directory(receiver, snapshot['id'], destination)
            assert replay['reused'] and unexpected.read_bytes() == b'recipient edit'
            (destination / 'workspace/source/original.bin').write_bytes(b'editable recipient revision')
            t.receive_directory(receiver, snapshot['id'], destination)
            assert (destination / 'workspace/source/original.bin').read_bytes() == b'editable recipient revision'
            print(json.dumps({'status': 'PASS', 'original_files': len(originals),
                              'interrupted_prefix_resume': True, 'private_stage_cleanup': True,
                              'original_pending_name_preserved': True, 'executable_mode_preserved': True,
                              'strict_original_inventory': True, 'recipient_edits_preserved': True}))

if __name__ == "__main__":
    unittest.main()
