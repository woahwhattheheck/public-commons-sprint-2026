"""Optional AWS S3 adapter. No live calls in the local demo.

Environment: ORCHARDCUE_INPUT_BUCKET and ORCHARDCUE_REVIEW_BUCKET must differ.
Package numpy/opencv into a suitable Lambda layer/container. Do not enable
this code on unrestricted public buckets. S3 event source needs input allowlist.
"""
import json
import os
from urllib.parse import unquote_plus

from engine import analyze_bytes


def lambda_handler(event, context):
    input_bucket = os.environ['ORCHARDCUE_INPUT_BUCKET']
    review_bucket = os.environ['ORCHARDCUE_REVIEW_BUCKET']
    if not input_bucket or not review_bucket or input_bucket == review_bucket:
        raise ValueError('separate configured input and review buckets required')
    records = event.get('Records')
    if not isinstance(records, list) or len(records) != 1:
        raise ValueError('expected one S3 event record')
    record = records[0]
    if record.get('eventSource') != 'aws:s3':
        raise ValueError('eventSource must be aws:s3')
    source_bucket = record['s3']['bucket']['name']
    if source_bucket != input_bucket:
        raise ValueError('bucket rejected by allowlist')
    key = unquote_plus(record['s3']['object']['key'])
    if not key.lower().endswith(('.jpg', '.jpeg', '.png')) or '..' in key or key.startswith('/'):
        raise ValueError('unsupported S3 image key')
    import boto3  # Optional runtime dependency, deliberately not loaded by local engine
    s3 = boto3.client('s3')
    obj = s3.get_object(Bucket=source_bucket, Key=key)
    if int(obj.get('ContentLength', 0)) > 8_000_000:
        raise ValueError('source object exceeds image size budget')
    raw = obj['Body'].read(8_000_001)
    report, overlay = analyze_bytes(raw)
    prefix = 'operator-review/' + report['input_sha256']
    s3.put_object(Bucket=review_bucket, Key=prefix+'/report.json',
                  Body=(json.dumps(report,indent=2)+'\n').encode('utf-8'), ContentType='application/json')
    s3.put_object(Bucket=review_bucket, Key=prefix+'/overlay.png',
                  Body=overlay, ContentType='image/png')
    return {'review_prefix':prefix, 'action':report['decision']['action'],
            'red_candidates':report['candidate_count'], 'human_confirmation_required':True}
