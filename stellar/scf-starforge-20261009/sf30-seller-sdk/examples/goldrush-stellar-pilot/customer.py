#!/usr/bin/env python3
"""Use the same generated GoldRush request with the maintained Python Buyer."""
from __future__ import annotations
import argparse
import json
import re
from urllib.parse import urlsplit
from stellar_forge_buyer import Buyer, BuyerError
from stellar_forge_buyer.storage import parse, read


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkout', required=True)
    parser.add_argument('--state', required=True)
    commands = parser.add_subparsers(dest='action', required=True)
    prepare = commands.add_parser('prepare', help='Offline import of customer.mjs request output')
    source = prepare.add_mutually_exclusive_group(required=True)
    source.add_argument('--config', help='The original customer.mjs authored request')
    source.add_argument('--workspace', help='Existing original native operator workspace; keys stay in Node')
    prepare.add_argument('--profile', help='Existing native operator profile; environment names and private paths only')
    for name in ['review', 'execute', 'recover']:
        commands.add_parser(name).add_argument('--intent', required=True)
    args = parser.parse_args()
    buyer = Buyer(checkout=args.checkout, state_dir=args.state)
    try:
        if args.action == 'prepare':
            operation = (buyer.from_workspace(args.workspace) if args.workspace else buyer.from_config(args.config))
            operation.configure(args.profile, max_response_bytes=1048576,
                                response_timeout_ms=30000, request_timeout_ms=90000)
            output = operation.review().native
        else:
            operation = buyer.operation(args.intent)
            if args.action == 'review':
                output = operation.review().native
            else:
                result = (operation.execute(review=operation.review())
                          if args.action == 'execute' else operation.recover())
                if result is None:
                    output = {'status': 'ORIGINAL_RESULT_NOT_RECORDED', 'intentId': args.intent}
                else:
                    output = {'intentId': args.intent, 'status': result.status,
                              'httpStatus': result.native.get('httpStatus'), 'delivery': result.delivery,
                              'ok': result.ok, 'runtimeError': result.record.get('runtimeError'),
                              'providerRead': {'status': 'NOT_READ'}}
                    if result.ok and result.delivery.get('status') == 'SAVED':
                        try:
                            result.raise_for_status()
                            wire = result.json(limit=1048576)
                            if (not isinstance(wire, dict) or wire.get('error') is not False
                                    or not isinstance(wire.get('data'), dict)):
                                raise ValueError('Provider did not return a successful wallet page')
                            data = wire['data']
                            request = parse(read(operation.config_path, 65536))['operation']
                            path = urlsplit(request['url']).path.split('/')
                            if (not isinstance(data.get('items'), list)
                                    or not isinstance(data.get('address'), str)
                                    or data['address'].lower() != path[4].lower()
                                    or data.get('chain_name') != path[2]):
                                raise ValueError('Provider result does not match the retained wallet request')
                            # Exact bytes and quantities remain in the original hash-verified file.
                            output['page'] = {'address': data.get('address'), 'chain': data.get('chain_name'),
                                              'updatedAt': data.get('updated_at'), 'items': len(data['items']),
                                              'pagination': data.get('pagination')}
                            output['providerRead'] = {'status': 'READ'}
                        except Exception as error:
                            # Preserve the original native outcome if saved-data interpretation fails.
                            code = getattr(error, 'code', None)
                            output['providerRead'] = {'status': 'FAILED', 'code': code
                                if isinstance(code, str) and re.fullmatch(r'[A-Z][A-Z0-9_]{0,79}', code)
                                else 'GOLDRUSH_RETAINED_RESPONSE_INVALID'}
                output['retry'] = 'NO_AUTOMATIC_RETRY'
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0
    except BuyerError as error:
        print(json.dumps({'error': error.code}))
        return 2
    except (ValueError, KeyError, TypeError):
        print(json.dumps({'error': 'GOLDRUSH_RETAINED_RESPONSE_INVALID'}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
