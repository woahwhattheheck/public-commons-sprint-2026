"""Read a privileged host's exact one-generation SF36 resume permit.

The file contains private authorization material. Callers receive its token only
inside the original operator process; public review receives hashes and IDs.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import stat

from governor import Denied, canonical, validate_request

SCHEMA = 'stellar-forge.sf36.expired-resume-permit.v1'
ENVIRONMENT_NAME = 'SF36_EXPIRED_RESUME_FILE'
FIELDS = frozenset({'schema', 'request_id', 'request_sha256', 'proof_sha256',
                    'release_journal_mac', 'expires_at', 'token'})


def _unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise Denied('EXPIRY_RESUME_FILE_DUPLICATE_KEY')
        value[key] = item
    return value


def read_expired_resume_permit(governor, request, path=None):
    """Authenticate a host-selected permit; unrelated later page IDs use normal consent."""
    if path is None:
        return None
    path = Path(path)
    if not path.is_absolute() or path.resolve() != path:
        raise Denied('EXPIRY_RESUME_FILE_MUST_BE_ABSOLUTE_WITHOUT_SYMLINKS')
    parent = path.parent.stat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.geteuid() or parent.st_mode & 0o077:
        raise Denied('EXPIRY_RESUME_FILE_PARENT_NOT_PRIVATE')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as reader:
        info = os.fstat(reader.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077 or \
                info.st_size > 16384:
            raise Denied('EXPIRY_RESUME_FILE_NOT_PRIVATE')
        raw = reader.read(16385)
    if len(raw) > 16384:
        raise Denied('EXPIRY_RESUME_FILE_TOO_LARGE')
    try:
        value = json.loads(raw, object_pairs_hook=_unique,
            parse_constant=lambda _: (_ for _ in ()).throw(Denied('EXPIRY_RESUME_FILE_NONFINITE')))
    except (ValueError, UnicodeError) as error:
        raise Denied('EXPIRY_RESUME_FILE_INVALID') from error
    if type(value) is not dict or set(value) != FIELDS or value.get('schema') != SCHEMA:
        raise Denied('EXPIRY_RESUME_FILE_SCHEMA_INVALID')
    request = validate_request(request)
    # A dataset continuation retains one host environment across later pages.
    # This permit cannot authorize any different request; those still need the
    # original fresh initial consent and budget reservation.
    if value['request_id'] != request['request_id']:
        return None
    digest = hashlib.sha256(canonical(request)).hexdigest()
    if value['request_sha256'] != digest:
        raise Denied('EXPIRY_RESUME_FILE_REQUEST_CHANGED')
    governor.db.execute('BEGIN')
    try:
        row = governor._audit().get(request['request_id'])
        if row is None or row['request_digest'] != digest or row['state'] != 'expired':
            raise Denied('EXPIRY_RESUME_REQUIRES_ORIGINAL_RELEASED_GENERATION')
        claim = governor._validate_expired_resume(value['token'], request, digest, row)
        if claim['release_journal_mac'] != value['release_journal_mac'] or \
                claim['release_proof_sha256'] != value['proof_sha256'] or \
                claim['expires_at'] != value['expires_at']:
            raise Denied('EXPIRY_RESUME_FILE_CLAIMS_CHANGED')
        governor.db.execute('COMMIT')
    except BaseException:
        governor.db.execute('ROLLBACK')
        raise
    return value


def operator_resume_selection(governor, request, environment=None):
    environment = os.environ if environment is None else environment
    path = environment.get(ENVIRONMENT_NAME)
    if path is not None and (not isinstance(path, str) or not path or len(path) > 4096 or '\0' in path):
        raise Denied('EXPIRY_RESUME_PATH_INVALID')
    return read_expired_resume_permit(governor, request, path)


def public_resume_review(value):
    if value is None:
        return None
    return {'schema': 'stellar-forge.sf36.expired-resume-review.v1',
        'request_id': value['request_id'], 'request_sha256': value['request_sha256'],
        'release_journal_mac': value['release_journal_mac'],
        'release_proof_sha256': value['proof_sha256'], 'permit_expires_at': value['expires_at'],
        'approval': 'NEW_RESERVATION_OF_THE_SAME_EXPIRED_UNTRANSFERRED_REQUEST'}
