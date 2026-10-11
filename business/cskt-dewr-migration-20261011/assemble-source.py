#!/usr/bin/env python3
"""Assemble the original hash-indexed capture into the migration import contract.

This performs no network requests. It verifies every captured source body, joins
native page/media identities and GIS references, and measures published body
coverage without changing the original WordPress objects.
"""
import argparse
import datetime as dt
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import urllib.parse
from collections import Counter


def sha(data):
    return hashlib.sha256(data).hexdigest()


class BodyFragments(HTMLParser):
    def __init__(self, source, identity):
        super().__init__(convert_charrefs=False)
        self.source, self.identity = source, str(identity)
        self.offsets = [0] + [match.end() for match in re.finditer('\n', source)]
        self.stack, self.found = [], []

    def at(self):
        line, column = self.getpos()
        return self.offsets[line - 1] + column

    def handle_starttag(self, tag, attributes):
        if tag in ('area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'):
            return
        attributes, selector, priority = dict(attributes), None, 9
        if 'entry-content' in (attributes.get('class') or '').split():
            selector, priority = '.entry-content', 0
        elif attributes.get('data-elementor-id') == self.identity and attributes.get('data-elementor-type') in ('wp-page','wp-post'):
            selector, priority = '[data-elementor-id="' + self.identity + '"]', 1
        elif tag == 'main':
            selector, priority = 'main', 2
        elif attributes.get('id') == 'content':
            selector, priority = '#content', 3
        self.stack.append({'tag':tag, 'selector':selector, 'priority':priority, 'start':self.at()})

    def handle_endtag(self, tag):
        index = next((i for i in range(len(self.stack)-1,-1,-1) if self.stack[i]['tag'] == tag), None)
        if index is None:
            return
        element, self.stack = self.stack[index], self.stack[:index]
        if element['selector']:
            end = self.source.find('>', self.at()) + 1
            self.found.append({**element, 'html':self.source[element['start']:end]})


class Content(HTMLParser):
    def __init__(self, source, origin):
        super().__init__(convert_charrefs=True)
        self.words, self.links, self.embeds, self.hidden = [], [], set(), 0
        self.origin = origin
        self.feed(source)
        self.text = re.sub(r'\s+', ' ', ' '.join(self.words)).strip()

    def handle_starttag(self, tag, attributes):
        if tag in ('script','style'):
            self.hidden += 1
        attributes = dict(attributes)
        for key in ('href','src','data-src','data-opt-src'):
            if attributes.get(key):
                self.links.append({'tag':tag,'attribute':key,'url':urllib.parse.urljoin(self.origin,attributes[key])})
        if tag in ('iframe','video','audio','source'):
            target = attributes.get('data-opt-src') or attributes.get('data-src') or attributes.get('src')
            if target:
                self.embeds.add((tag,urllib.parse.urljoin(self.origin,target)))

    def handle_endtag(self, tag):
        if tag in ('script','style'):
            self.hidden = max(0,self.hidden-1)

    def handle_data(self, value):
        if not self.hidden:
            self.words.append(value)


def assemble(root):
    root = Path(root).resolve()
    index = json.loads((root/'source-index.json').read_text())
    entries = {row['file']:row for row in index['sources']}
    if (root/'html-source-index.json').exists():
        entries.update({row['file']:row for row in json.loads((root/'html-source-index.json').read_text())['sources']})
    bodies, collections, collection_status, native_ids = {}, {'pages':{},'posts':{},'media':{}}, {}, {}
    gis, assets, full_pages = {}, [], {}
    for name, record in sorted(entries.items()):
        if not record.get('sha256'):
            continue
        body = (root/name).read_bytes()
        if len(body) != record['bytes'] or sha(body) != record['sha256']:
            raise ValueError('Captured body differs from original index: '+name)
        bodies[name] = body
        url = urllib.parse.urlsplit(record['url'])
        query = dict(urllib.parse.parse_qsl(url.query))
        collection = next((kind for kind in collections if url.path.endswith('/wp/v2/'+kind)), None)
        if collection and record.get('status') == 200:
            objects = json.loads(body)
            if not isinstance(objects,list):
                raise ValueError('Original collection is not an array: '+name)
            if query.get('_fields') == 'id':
                native_ids.setdefault(collection,set()).update(row['id'] for row in objects)
            else:
                for row in objects:
                    old = collections[collection].get(row['id'])
                    if old is not None and old != row:
                        raise ValueError('Source identity changed during capture: '+str(row['id']))
                    collections[collection][row['id']] = row
                status = collection_status.setdefault(collection,{'reported':int(record.get('total') or 0),'pagesCaptured':0})
                status['pagesCaptured'] += 1
        if record.get('pageId') is not None and name.endswith('.html'):
            full_pages[record['pageId']] = record
        if record.get('mediaId') is not None:
            assets.append(record)
        match = re.search(r'/content/items/([a-f0-9]{32})(/data)?$',url.path)
        if match:
            identity, part = match.group(1), 'data' if match.group(2) else 'item'
            gis.setdefault(identity,{'id':identity})[part+'File'] = name
            gis[identity][part] = json.loads(body)
    for kind, rows in collections.items():
        status = collection_status.setdefault(kind,{'reported':0,'pagesCaptured':0})
        status.update(observed=len(rows),uniqueIds=len(rows),reportedDifference=status['reported']-len(rows))
        if kind in native_ids:
            status.update(alternateObserved=len(native_ids[kind]),alternateIdMatch=set(rows)==native_ids[kind])
            if set(rows) != native_ids[kind]:
                raise ValueError('Alternate native paging has different source identities: '+kind)
    page_content, completeness, links = [], [], []
    for identity, page in collections['pages'].items():
        rest = Content(page.get('content',{}).get('rendered',''),page['link'])
        links.extend({'pageId':identity,'source':'wordpress-rendered',**link} for link in rest.links)
        original = full_pages.get(identity)
        if not original:
            completeness.append({'wpId':identity,'status':'REST_CAPTURED','restTextChars':len(rest.text)})
            continue
        source = bodies[original['file']].decode('utf-8')
        parser = BodyFragments(source,identity)
        parser.feed(source)
        if not parser.found:
            completeness.append({'wpId':identity,'status':'NO_BODY_SELECTOR','sourceFile':original['file'],'restTextChars':len(rest.text)})
            continue
        body = min(parser.found,key=lambda candidate:candidate['priority'])
        visible = Content(body['html'],page['link'])
        links.extend({'pageId':identity,'source':original['file'],**link} for link in visible.links)
        missing_embeds = sorted(visible.embeds-rest.embeds)
        omitted = len(visible.text)>len(rest.text)+max(100,int(len(rest.text)*.05)) or bool(missing_embeds)
        lineage = {'wpId':identity,'sourceUrl':original['url'],'sourceFile':original['file'],
                   'sourceSha256':original['sha256'],'selector':body['selector'],'fragmentSha256':sha(body['html'].encode())}
        completeness.append({**lineage,'status':'PUBLISHED_FALLBACK' if omitted else 'REST_COMPLETE',
                             'restTextChars':len(rest.text),'publishedTextChars':len(visible.text),
                             'textEqual':rest.text==visible.text,'missingEmbeds':missing_embeds})
        if omitted:
            page_content.append({**lineage,'html':body['html']})
    for identity, item in gis.items():
        metadata = item.get('item',{})
        item.update(status='PROVIDER_ERROR' if metadata.get('error') else 'CAPTURED',
                    title=metadata.get('title'),type=metadata.get('type'),access=metadata.get('access'),
                    modified=metadata.get('modified'),url=metadata.get('url'),sourcePageIds=[])
        if metadata.get('error'):
            item['providerError'] = metadata['error']
        for link in links:
            if identity in link['url'] and link['pageId'] not in item['sourcePageIds']:
                item['sourcePageIds'].append(link['pageId'])
        item['dependencies'] = sorted({resource['data']['itemId'] for resource in item.get('data',{}).get('resources',{}).values()
                                       if resource.get('type') in ('webmap','webscene') and re.fullmatch('[a-f0-9]{32}',resource.get('data',{}).get('itemId',''))})
    if '2255c33442fd4f349aef25cba515ed78' in gis:
        gis['2255c33442fd4f349aef25cba515ed78']['sourcePageIds'] = sorted(set(gis['2255c33442fd4f349aef25cba515ed78']['sourcePageIds']+[46]))
        gis['2255c33442fd4f349aef25cba515ed78']['additionalOrigin'] = 'Original maintained observed-public-content.json externalResources'
    for identity, media in collections['media'].items():
        if any(asset.get('mediaId')==identity for asset in assets):
            continue
        retained = next((record for record in entries.values() if record['url']==media.get('source_url') and record.get('status')==200),None)
        if retained:
            assets.append({**retained,'mediaId':identity,'selectedFrom':'matching original WordPress source_url'})
    layer_captures=[]
    for name,record in entries.items():
        if name.endswith('-features.json') and 'FeatureServer/' in record['url']:
            value=json.loads(bodies[name]);layer_captures.append({**record,'featureCount':len(value.get('features',[])),
                'spatialReference':value.get('spatialReference'),'exceededTransferLimit':value.get('exceededTransferLimit',False)})
    captured = [record['capturedAt'] for record in entries.values() if record.get('capturedAt')]
    corpus = {'schema':'cskt.public-corpus.v1','capturedAt':max(captured),'captureStartedAt':min(captured),
              'completedAt':dt.datetime.now(dt.timezone.utc).isoformat(),
              'site':{'url':'https://csktwatercompact.com/','restUrl':'https://csktwatercompact.com/wp-json/wp/v2/'},
              **{kind:list(rows.values()) for kind,rows in collections.items()},'capture':collection_status,
              'sources':list(entries.values()),'publicHtml':list(full_pages.values()),'pageContent':page_content,
              'pageCompleteness':completeness,'gis':{'items':list(gis.values()),'layers':layer_captures},'assets':assets}
    for name,value in [('corpus.json',corpus),('source-links.json',links),('page-completeness.json',completeness)]:
        temporary=root/(name+'.part');temporary.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n');temporary.replace(root/name)
    summary={'capture':collection_status,'mimeTypes':dict(Counter(row['mime_type'] for row in corpus['media'])),
             'publishedHtml':len(full_pages),'bodyComparison':dict(Counter(row['status'] for row in completeness)),
             'gisItems':len(gis),'nativePhaseFeatures':sum(row['featureCount'] for row in layer_captures),
             'assets':[{key:row.get(key) for key in ('mediaId','file','bytes','sha256','contentType')} for row in assets],
             'corpusSha256':sha((root/'corpus.json').read_bytes()),'corpusBytes':(root/'corpus.json').stat().st_size}
    (root/'capture-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
    return summary


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture_directory')
    print(json.dumps(assemble(parser.parse_args().capture_directory),ensure_ascii=False,indent=2))
