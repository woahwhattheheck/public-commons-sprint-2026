// MIT. Offline projection of the original, verified STAC customer delivery.
// This renderer does not fetch data, run a receiver, or change an edition.
const STYLE = [
  ':root{font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c1c1c;background:#f4f4f2;color-scheme:light}',
  '*{box-sizing:border-box}body{margin:0}a{color:inherit;text-underline-offset:3px}button,input,select{font:inherit;color:inherit}',
  'button,.download{border:1px solid #777;background:#fff;border-radius:3px;padding:7px 11px;cursor:pointer;text-decoration:none;display:inline-block}',
  'button:hover,.download:hover{background:#ededeb}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,[tabindex]:focus-visible{outline:3px solid #555;outline-offset:3px}',
  'button:disabled{opacity:.45;cursor:default}header{background:#fff;border-bottom:1px solid #c4c4be;padding:24px max(20px,calc((100vw - 1600px)/2))}',
  'h1{font-size:28px;line-height:1.15;margin:4px 0 10px;font-weight:650}h2{font-size:18px;line-height:1.25;margin:0 0 12px}h3{font-size:15px;margin:0 0 8px}',
  '.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:11px;font-weight:650}.muted{color:#62625d}.small{font-size:12px}.mono,code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}',
  '.break{overflow-wrap:anywhere}.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.heading{display:flex;gap:24px;justify-content:space-between;align-items:flex-start}',
  'main{max-width:1640px;margin:auto;padding:20px;min-width:0}.summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1px;border:1px solid #c4c4be;background:#c4c4be;margin:0 0 20px}',
  '.summary>div{background:#fff;padding:12px 15px}.summary b{display:block;font-size:26px;font-weight:600}.summary span{display:block;color:#62625d;font-size:12px}',
  '.panel{background:#fff;border:1px solid #c4c4be;padding:18px;min-width:0}.filters{display:grid;grid-template-columns:2fr 1.2fr 1fr 1fr 1fr 1.2fr;gap:12px;margin-bottom:10px}',
  'label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:#555}input,select{width:100%;min-width:0;background:#fff;border:1px solid #999;border-radius:2px;padding:8px;font-size:14px}',
  '.layout{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:20px;margin-top:20px}.stack{display:grid;gap:20px;align-content:start;min-width:0}',
  '.table-scroll{overflow:auto;max-width:100%}table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #ddd;padding:10px 8px;overflow-wrap:anywhere}th{font-weight:650;background:#f2f2f0;color:#50504b}',
  '.scene-table{min-width:550px}.scene-table td:first-child{width:43%}.scene-button{border:0;padding:0;background:transparent;text-align:left;font-size:12px;font-weight:600;max-width:100%;overflow-wrap:anywhere;text-decoration:underline;text-underline-offset:3px}',
  'tr.selected{background:#ededeb}.badge{display:inline-block;border:1px solid #aaa;border-radius:2px;padding:2px 5px;font-size:10px;letter-spacing:.02em;margin:0 4px 3px 0}.badge.retained{background:#333;color:#fff;border-color:#333}',
  '.pager{display:flex;gap:10px;align-items:center;justify-content:space-between;margin-top:14px}.pager .toolbar{flex-wrap:nowrap}.empty{padding:28px 12px;color:#62625d;text-align:center}',
  '.map-wrap{border:1px solid #bbb;background:#f6f6f3;position:relative;aspect-ratio:1.6;min-height:250px;overflow:hidden;margin-top:12px}.map-wrap svg{width:100%;height:100%;display:block}',
  '.map-empty{position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center}.footprint{cursor:pointer;fill:#acaca5;fill-opacity:.24;stroke:#70706a;stroke-width:1;vector-effect:non-scaling-stroke}.footprint.selected{fill:#32322e;fill-opacity:.28;stroke:#171715;stroke-width:2}',
  '.footprint:hover{stroke:#111;stroke-width:2}.grid-line{stroke:#d8d8d0;stroke-width:1}.grid-label{font:11px system-ui;fill:#62625d}.map-caption{display:flex;justify-content:space-between;gap:12px;margin-top:8px;font-size:11px;color:#62625d}',
  '.facts{display:grid;grid-template-columns:135px minmax(0,1fr);gap:6px 12px;font-size:12px;margin:15px 0}.facts dt{color:#62625d}.facts dd{margin:0;overflow-wrap:anywhere}.scene-title{overflow-wrap:anywhere}',
  '.asset{border-top:1px solid #ddd;padding:13px 0}.asset h3{display:flex;gap:8px;align-items:center;flex-wrap:wrap;overflow-wrap:anywhere}.asset .facts{margin:8px 0;grid-template-columns:90px minmax(0,1fr)}.asset .reason{font-size:12px;background:#f2f2f0;border-left:2px solid #999;padding:8px 10px;margin:10px 0}',
  '.preview{margin:12px 0;border:1px solid #c4c4be;background:#f1f1ef;padding:8px}.preview img{display:block;max-height:350px;max-width:100%;margin:auto;object-fit:contain}.preview figcaption{font-size:11px;color:#555;margin-top:8px;overflow-wrap:anywhere}',
  'details{border-top:1px solid #ddd;padding-top:10px;margin-top:12px}summary{cursor:pointer;font-weight:600;font-size:12px}pre{font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f1;padding:12px;max-height:480px;overflow:auto}',
  '.collections{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-top:20px}.provider{font-size:12px;margin:8px 0}.notice{border-left:3px solid #777;padding:10px 13px;background:#eee;overflow-wrap:anywhere;font-size:12px;margin:12px 0}.endnote{margin:20px 0;color:#62625d;font-size:12px}',
  '.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}[hidden]{display:none!important}',
  '@media(max-width:1100px){.filters{grid-template-columns:repeat(3,minmax(0,1fr))}.layout{grid-template-columns:1fr}.map-wrap{max-height:480px}.summary{grid-template-columns:repeat(5,minmax(0,1fr))}.heading{display:block}.heading .toolbar{margin-top:15px}}',
  '@media(max-width:560px){main{padding:12px}header{padding:20px 12px}h1{font-size:25px}.panel{padding:13px}.filters{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.filters label:first-child{grid-column:1/-1}.summary{grid-template-columns:repeat(2,minmax(0,1fr))}.summary>div:last-child{grid-column:1/-1}.summary b{font-size:23px}.collections{grid-template-columns:1fr}.map-wrap{min-height:230px;aspect-ratio:1.35}.facts{grid-template-columns:100px minmax(0,1fr)}.pager{align-items:flex-start;gap:6px;flex-direction:column}}',
  '@media print{body{background:#fff;font-size:11px}header{padding:0 0 15px}main{padding:0}.filters,.toolbar,.pager,.scene-button::after{display:none}.layout,.collections{display:block}.panel{border:0;padding:12px 0;break-inside:avoid}.summary{margin:12px 0}.table-scroll{overflow:visible}.scene-table{min-width:0}.map-wrap{height:280px;min-height:0}.stack{display:block}.panel{margin-bottom:12px}.preview img{max-height:220px}details{display:none}a{color:#000;text-decoration:none}}',
].join('\n');

function runExplorer() {
  'use strict';
  const data = JSON.parse(document.getElementById('stac-data').textContent);
  const $ = id => document.getElementById(id);
  const number = value => new Intl.NumberFormat('en').format(value);
  const text = value => value === null || value === undefined || value === '' ? 'Not reported' : String(value);
  const el = (tag, value, className) => {
    const node = document.createElement(tag);
    if (value !== undefined && value !== null) node.textContent = String(value);
    if (className) node.className = className;
    return node;
  };
  const safeWeb = href => {
    try { const url = new URL(href); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
    catch { return null; }
  };
  const localHref = path => typeof path === 'string' && path.length > 0 && !/[\\\x00-\x1f\x7f]/u.test(path) &&
    path.split('/').every(p => p && p !== '.' && p !== '..') ? path.split('/').map(encodeURIComponent).join('/') : null;
  const link = (label, href, local = false) => {
    const url = local ? localHref(href) : safeWeb(href);
    if (!url) return el('span', label, 'break');
    const a = el('a', label, 'break'); a.href = url;
    if (!local) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    return a;
  };
  const fact = (list, label, value) => { const dd = el('dd'); if (value instanceof Node) dd.append(value); else dd.textContent = text(value); list.append(el('dt', label), dd); };
  const prettyBytes = bytes => {
    if (!Number.isSafeInteger(bytes) || bytes < 0) return 'Not reported';
    if (bytes < 1024) return bytes + ' B';
    const unit = bytes < 1024 * 1024 ? 'KiB' : bytes < 1024 * 1024 * 1024 ? 'MiB' : 'GiB';
    const scale = unit === 'KiB' ? 1024 : unit === 'MiB' ? 1024 * 1024 : 1024 * 1024 * 1024;
    return (bytes / scale).toFixed(2) + ' ' + unit + ' (' + number(bytes) + ' B)';
  };
  const badge = asset => el('span', asset.file ? 'RETAINED' : asset.outcome, 'badge' + (asset.file ? ' retained' : ''));
  const scenes = data.scenes;
  const index = new Map(scenes.map(s => [s.key, s]));
  const collections = new Map(data.collections.map(c => [c.id, c]));
  let shown = scenes.slice(), selected = scenes[0]?.key ?? null, page = 0, fitSelected = false;
  const pageSize = 30;
  for (const scene of scenes) {
    const p = scene.original.properties ?? {};
    scene.searchText = [scene.id, scene.collection ?? '', p.title ?? '', p.platform ?? '',
      JSON.stringify(p.instruments ?? []), ...scene.assets.map(a => a.key)].join(' ').toLowerCase();
    const instant = p.datetime === null || p.datetime === undefined ? NaN : Date.parse(p.datetime);
    scene.start = Number.isFinite(instant) ? instant : Date.parse(p.start_datetime ?? '');
    scene.end = Number.isFinite(instant) ? instant : Date.parse(p.end_datetime ?? '');
  }
  $('edition').textContent = data.edition.editionId;
  $('source-description').textContent = data.description;
  $('counts-scenes').textContent = number(scenes.length);
  $('counts-assets').textContent = number(data.summary.assets);
  $('counts-retained').textContent = number(data.summary.retained);
  $('counts-missing').textContent = number(data.summary.notRetained);
  $('counts-collections').textContent = number(data.collections.length);
  for (const [id, title] of [...collections].map(([id, c]) => [id, c.original.title ?? id]).sort((a, b) => a[1].localeCompare(b[1]))) {
    const option = el('option', title); option.value = id; $('collection').append(option);
  }
  if (scenes.some(s => s.collection === null)) { const option = el('option', 'No source Collection'); option.value = '@standalone'; $('collection').append(option); }
  for (const name of ['catalog', 'footprints', 'asset-inventory', 'portable-manifest']) {
    const a = $(name + '-download'), href = localHref(data.paths[name]);
    if (href) a.href = href; else a.hidden = true;
  }
  const filter = () => {
    const query = $('search').value.trim().toLowerCase(), collection = $('collection').value, receipt = $('receipt').value;
    const min = $('from').value ? Date.parse($('from').value + 'T00:00:00Z') : -Infinity;
    const max = $('through').value ? Date.parse($('through').value + 'T23:59:59.999Z') : Infinity;
    const cloud = $('cloud').value === '' ? Infinity : Number($('cloud').value);
    const validCloud = cloud === Infinity || Number.isFinite(cloud) && cloud >= 0 && cloud <= 100;
    $('filter-error').hidden = min <= max && validCloud;
    $('filter-error').textContent = min > max ? 'The start date is later than the end date.' : validCloud ? '' : 'Cloud cover must be a percentage from 0 to 100.';
    shown = scenes.filter(s => {
      const p = s.original.properties ?? {}, c = p['eo:cloud_cover'], retained = s.assets.some(a => a.file);
      return min <= max && validCloud && (!query || s.searchText.includes(query)) &&
        (!collection || (collection === '@standalone' ? s.collection === null : s.collection === collection)) &&
        (receipt !== 'retained' || retained) && (receipt !== 'missing' || !retained) &&
        (!Number.isFinite(s.end) || s.end >= min) && (!Number.isFinite(s.start) || s.start <= max) &&
        (typeof c !== 'number' || !Number.isFinite(c) || c <= cloud);
    });
    const sort = $('sort').value;
    shown.sort((a, b) => {
      if (sort === 'id') return String(a.collection ?? '').localeCompare(String(b.collection ?? '')) || a.id.localeCompare(b.id);
      const av = sort === 'cloud' ? a.original.properties?.['eo:cloud_cover'] : a.start;
      const bv = sort === 'cloud' ? b.original.properties?.['eo:cloud_cover'] : b.start;
      if (!Number.isFinite(av)) return Number.isFinite(bv) ? 1 : a.key.localeCompare(b.key);
      if (!Number.isFinite(bv)) return -1;
      return (sort === 'newest' ? bv - av : av - bv) || a.key.localeCompare(b.key);
    });
    if (!shown.some(s => s.key === selected)) selected = shown[0]?.key ?? null;
    page = 0; render();
  };
  const sceneTime = scene => {
    const p = scene.original.properties ?? {};
    return p.datetime ?? (p.start_datetime || p.end_datetime ? text(p.start_datetime) + ' / ' + text(p.end_datetime) : 'Not reported');
  };
  function renderTable() {
    $('scene-rows').replaceChildren();
    const slice = shown.slice(page * pageSize, (page + 1) * pageSize);
    for (const scene of slice) {
      const tr = el('tr'); if (scene.key === selected) tr.className = 'selected';
      const cell = el('td'), button = el('button', scene.id, 'scene-button'); button.type = 'button';
      button.dataset.scene = scene.key; button.setAttribute('aria-pressed', String(scene.key === selected));
      cell.append(button, el('div', scene.collection ?? 'No source Collection', 'muted small'));
      const p = scene.original.properties ?? {}, count = scene.assets.filter(a => a.file).length;
      tr.append(cell, el('td', sceneTime(scene)), el('td', Number.isFinite(p['eo:cloud_cover']) ? p['eo:cloud_cover'] + '%' : 'Not reported'),
        el('td', count + ' / ' + scene.assets.length)); $('scene-rows').append(tr);
    }
    $('scene-empty').hidden = shown.length > 0;
    $('count-filtered').textContent = number(shown.length) + ' of ' + number(scenes.length) + ' scenes';
    $('page-status').textContent = shown.length ? 'Rows ' + (page * pageSize + 1) + '–' + Math.min(shown.length, (page + 1) * pageSize) + ' of ' + number(shown.length) : 'No matching scenes';
    $('previous').disabled = page === 0; $('next').disabled = (page + 1) * pageSize >= shown.length;
    $('filtered-download').disabled = shown.length === 0;
  }
  function details(label, value) {
    const node = el('details'); node.append(el('summary', label), el('pre', JSON.stringify(value, null, 2))); return node;
  }
  function renderSelection() {
    const panel = $('selection-body'); panel.replaceChildren();
    const scene = index.get(selected);
    $('selection-empty').hidden = Boolean(scene);
    $('fit-selected').disabled = !scene || scene.original.geometry === null;
    if (!scene) return;
    panel.append(el('div', scene.collection ?? 'Standalone source Item', 'eyebrow muted'), el('h2', scene.id, 'scene-title'));
    const props = scene.original.properties ?? {}, facts = el('dl', null, 'facts');
    fact(facts, 'Source time', sceneTime(scene));
    fact(facts, 'Cloud cover', Number.isFinite(props['eo:cloud_cover']) ? props['eo:cloud_cover'] + '%' : null);
    fact(facts, 'Platform', props.platform); fact(facts, 'Instruments', Array.isArray(props.instruments) ? props.instruments.join(', ') : props.instruments);
    fact(facts, 'Footprint', scene.geometryMessage);
    fact(facts, 'Local STAC Item', link('Open Item JSON', scene.path, true));
    const collection = collections.get(scene.collection);
    fact(facts, 'Collection license', collection?.original.license ?? null);
    panel.append(facts);
    if (!collection && scene.collection !== null) panel.append(el('p', 'The source Collection metadata was not retained in this delivery. Original collection references remain in the Item metadata.', 'notice'));
    const preview = scene.assets.find(a => a.file && ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif'].includes((a.file.contentType ?? a.original.type ?? '').split(';')[0].trim()) &&
      (Array.isArray(a.original.roles) ? a.original.roles : []).some(r => ['thumbnail', 'overview', 'visual'].includes(r))) ??
      scene.assets.find(a => a.file && ['image/png', 'image/jpeg', 'image/webp'].includes((a.file.contentType ?? a.original.type ?? '').split(';')[0].trim()));
    if (preview && localHref(preview.file.path)) {
      const figure = el('figure', null, 'preview'), img = document.createElement('img');
      img.loading = 'lazy'; img.alt = 'Retained source preview: ' + scene.id + ' / ' + preview.key; img.src = localHref(preview.file.path);
      const caption = el('figcaption', 'Original retained preview · ' + preview.key + ' · ' + prettyBytes(preview.file.bytes));
      img.addEventListener('error', () => { img.hidden = true; caption.textContent = 'The retained preview file could not be opened at its saved local path. Reopen through the original customer receiver to check current bytes.'; }, { once: true });
      figure.append(img, caption); panel.append(figure);
    }
    panel.append(el('h3', 'Declared assets'));
    if (!scene.assets.length) panel.append(el('p', 'The original Item declares no assets.', 'muted small'));
    for (const asset of scene.assets) {
      const section = el('section', null, 'asset'), heading = el('h3');
      heading.append(el('span', asset.original.title ?? asset.key), badge(asset)); section.append(heading);
      const f = el('dl', null, 'facts');
      fact(f, 'Asset key', asset.key); fact(f, 'Type', asset.original.type);
      fact(f, 'Roles', Array.isArray(asset.original.roles) ? asset.original.roles.join(', ') : null);
      fact(f, 'Source href', link(asset.original.href, asset.sourceHref ?? asset.original.href));
      if (asset.file) {
        fact(f, 'Local file', link(asset.file.path, asset.file.path, true)); fact(f, 'Size', prettyBytes(asset.file.bytes));
        fact(f, 'SHA-256', asset.file.sha256); fact(f, 'Receipt time', asset.receivedAt);
      }
      section.append(f);
      if (asset.reason) section.append(el('p', asset.reason, 'reason'));
      section.append(details('Original asset metadata and receiver outcome', { source: asset.original, receiver: asset.receipt }));
      panel.append(section);
    }
    panel.append(details('Complete original STAC Item metadata', scene.original));
  }
  // A longitude/latitude schematic of source coordinates, not a raster reprojection.
  // Wrap display segments at the dateline; exported coordinates are never modified.
  function geometryParts(geometry) {
    if (!geometry || typeof geometry !== 'object') return [];
    const c = geometry.coordinates;
    if (geometry.type === 'Point') return [{ kind: 'point', rings: [[c]] }];
    if (geometry.type === 'MultiPoint') return c.map(p => ({ kind: 'point', rings: [[p]] }));
    if (geometry.type === 'LineString') return [{ kind: 'line', rings: [c] }];
    if (geometry.type === 'MultiLineString') return c.map(line => ({ kind: 'line', rings: [line] }));
    if (geometry.type === 'Polygon') return [{ kind: 'polygon', rings: c }];
    if (geometry.type === 'MultiPolygon') return c.map(poly => ({ kind: 'polygon', rings: poly }));
    return [];
  }
  function renderMap() {
    const svg = $('map'), ns = 'http://www.w3.org/2000/svg'; svg.replaceChildren();
    const source = fitSelected && selected ? shown.filter(s => s.key === selected) : shown;
    const groups = [];
    for (const scene of source.filter(s => s.geometryRenderable)) for (const part of geometryParts(scene.original.geometry)) {
      if (!Array.isArray(part.rings) || !part.rings.every(r => Array.isArray(r) && r.length && r.every(p =>
        Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90))) continue;
      groups.push({ scene, kind: part.kind, rings: part.rings });
    }
    $('map-empty').hidden = groups.length > 0;
    if (!groups.length) { $('map-caption').textContent = 'No renderable source geometry in this view.'; return; }
    const longitudes = [];
    for (const g of groups) for (const ring of g.rings) for (const p of ring) longitudes.push(((p[0] % 360) + 360) % 360);
    longitudes.sort((a, b) => a - b);
    let maxGap = -1, beginning = longitudes[0];
    for (let i = 0; i < longitudes.length; i++) {
      const after = i === longitudes.length - 1 ? longitudes[0] + 360 : longitudes[i + 1];
      if (after - longitudes[i] > maxGap) { maxGap = after - longitudes[i]; beginning = after % 360; }
    }
    const center = beginning + (360 - maxGap) / 2;
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    for (const g of groups) {
      g.display = g.rings.map(ring => {
        const world = ring.some(p => p[0] <= -179.999) && ring.some(p => p[0] >= 179.999);
        let previous = center;
        const unwrapped = ring.map(p => {
          let x = p[0];
          if (!world) { while (x - previous > 180) x -= 360; while (x - previous < -180) x += 360; }
          previous = x; return [x, p[1]];
        });
        const mean = unwrapped.reduce((sum, p) => sum + p[0], 0) / unwrapped.length;
        const shift = world ? 0 : Math.round((center - mean) / 360) * 360;
        return unwrapped.map(p => [p[0] + shift, p[1]]);
      });
      for (const ring of g.display) for (const [x, y] of ring) { west = Math.min(west, x); east = Math.max(east, x); south = Math.min(south, y); north = Math.max(north, y); }
    }
    if (east === west) { west -= .02; east += .02; } if (north === south) { south -= .02; north += .02; }
    const width = 800, height = 500, padding = 36, scale = Math.min((width - padding * 2) / (east - west), (height - padding * 2) / (north - south));
    const cx = (west + east) / 2, cy = (north + south) / 2;
    const project = p => [width / 2 + (p[0] - cx) * scale, height / 2 - (p[1] - cy) * scale];
    const node = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    for (let i = 0; i < 5; i++) {
      const x = west + (east - west) * i / 4, y = south + (north - south) * i / 4, px = project([x, cy])[0], py = project([cx, y])[1];
      svg.append(node('line', { x1: px, y1: 18, x2: px, y2: height - 18, class: 'grid-line' }));
      svg.append(node('line', { x1: 18, y1: py, x2: width - 18, y2: py, class: 'grid-line' }));
      const tx = node('text', { x: px + 3, y: height - 8, class: 'grid-label' }); tx.textContent = ((((x + 180) % 360 + 360) % 360) - 180).toFixed(3) + '°';
      const ty = node('text', { x: 5, y: py - 4, class: 'grid-label' }); ty.textContent = y.toFixed(3) + '°'; svg.append(tx, ty);
    }
    for (const g of groups.sort((a, b) => Number(a.scene.key === selected) - Number(b.scene.key === selected))) {
      let shape;
      if (g.kind === 'point') { const [x, y] = project(g.display[0][0]); shape = node('circle', { cx: x, cy: y, r: 4 }); }
      else {
        const path = g.display.map(ring => ring.map((p, i) => (i ? 'L' : 'M') + project(p).map(x => x.toFixed(3)).join(' ')).join(' ') + (g.kind === 'polygon' ? 'Z' : '')).join(' ');
        shape = node('path', { d: path, 'fill-rule': 'evenodd' }); if (g.kind === 'line') shape.style.fill = 'none';
      }
      shape.setAttribute('class', 'footprint' + (g.scene.key === selected ? ' selected' : ''));
      shape.setAttribute('tabindex', '0'); shape.setAttribute('role', 'button'); shape.setAttribute('aria-label', 'Inspect scene ' + g.scene.id);
      shape.dataset.scene = g.scene.key; const title = node('title', {}); title.textContent = g.scene.id + ' · ' + (g.scene.collection ?? 'Standalone Item'); shape.append(title);
      svg.append(shape);
    }
    const mapped = new Set(groups.map(g => g.scene.key)).size;
    $('map-caption').textContent = number(mapped) + ' source footprints · ' + (fitSelected ? 'Selected scene' : 'Filtered scenes') + ' · Display wrap only; export coordinates unchanged.';
  }
  function select(key) { if (!index.has(key)) return; selected = key; render(); $('selection-heading').focus({ preventScroll: true }); }
  function render() { renderTable(); renderSelection(); renderMap(); }
  for (const id of ['search', 'collection', 'receipt', 'from', 'through', 'cloud', 'sort']) $(id).addEventListener(id === 'search' ? 'input' : 'change', filter);
  $('clear').addEventListener('click', () => { for (const id of ['search', 'collection', 'receipt', 'from', 'through', 'cloud']) $(id).value = ''; $('sort').value = 'newest'; fitSelected = false; filter(); });
  $('previous').addEventListener('click', () => { if (page > 0) { page--; renderTable(); } });
  $('next').addEventListener('click', () => { if ((page + 1) * pageSize < shown.length) { page++; renderTable(); } });
  $('fit-all').addEventListener('click', () => { fitSelected = false; renderMap(); });
  $('fit-selected').addEventListener('click', () => { fitSelected = true; renderMap(); });
  $('print').addEventListener('click', () => window.print());
  $('scene-rows').addEventListener('click', event => { const b = event.target.closest('[data-scene]'); if (b) select(b.dataset.scene); });
  $('map').addEventListener('click', event => { const b = event.target.closest('[data-scene]'); if (b) select(b.dataset.scene); });
  $('map').addEventListener('keydown', event => { const b = event.target.closest('[data-scene]'); if (b && ['Enter', ' '].includes(event.key)) { event.preventDefault(); select(b.dataset.scene); } });
  $('filtered-download').addEventListener('click', () => {
    const output = { type: 'FeatureCollection', features: shown.map(s => s.original), selection: {
      editionId: data.edition.editionId, query: $('search').value, collection: $('collection').value || null,
      from: $('from').value || null, through: $('through').value || null, maxCloud: $('cloud').value || null,
      receipt: $('receipt').value || null, note: 'Original Feature objects; display filters do not alter source coordinates or metadata.' } };
    const url = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2) + '\n'], { type: 'application/geo+json' }));
    const a = el('a'); a.href = url; a.download = 'selected-footprints.geojson'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  for (const c of data.collections) {
    const section = el('section', null, 'panel'), original = c.original;
    section.append(el('div', 'Original Collection metadata', 'eyebrow muted'), el('h2', original.title ?? c.id, 'break'));
    const f = el('dl', null, 'facts'); fact(f, 'Collection ID', c.id); fact(f, 'License', original.license); fact(f, 'STAC version', original.stac_version);
    fact(f, 'Local Collection', link('Open Collection JSON', c.path, true)); section.append(f);
    if (original.description) section.append(el('p', original.description, 'small break'));
    for (const p of original.providers ?? []) {
      const div = el('div', null, 'provider'); div.append(p.url ? link(p.name ?? p.url, p.url) : el('strong', p.name ?? 'Provider'));
      if (Array.isArray(p.roles)) div.append(document.createTextNode(' · ' + p.roles.join(', ')));
      if (p.description) div.append(el('p', p.description)); section.append(div);
    }
    for (const l of c.attributionLinks) {
      const p = el('p', null, 'small'); p.append(link(l.title ?? l.rel, l.href)); section.append(p);
    }
    section.append(details('Complete original Collection metadata', original)); $('collections').append(section);
  }
  if (!data.collections.length) $('collection-heading').hidden = true;
  if (data.issues.length) {
    $('issues').hidden = false;
    for (const issue of data.issues) $('issue-list').append(el('li', issue.message + (issue.itemId ? ' [' + issue.itemId + ']' : '')));
  }
  filter();
}

/** Returns one standalone HTML document. Relative bytes remain with StacDelivery. */
export function renderSceneExplorer(model) {
  if (!model || model.schema !== 'starforge.stac-portable-review.v1' || !Array.isArray(model.scenes) ||
      !Array.isArray(model.collections)) throw new TypeError('A complete original STAC portable projection is required.');
  const data = JSON.stringify(model).replace(/[<>&\u2028\u2029]/gu, c => ({
    '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029',
  })[c]);
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="referrer" content="no-referrer"><title>STAC scene delivery</title><style>', STYLE, '</style></head><body>',
    '<header><div class="heading"><div><div class="eyebrow">STAC · Retained customer delivery</div><h1>Scene and asset explorer</h1><div id="edition" class="small mono break"></div><p id="source-description" class="small muted"></p></div>',
    '<nav class="toolbar" aria-label="Download complete delivery projections"><a id="catalog-download" class="download">STAC catalog</a><a id="footprints-download" class="download">GeoJSON</a><a id="asset-inventory-download" class="download">Asset inventory</a><a id="portable-manifest-download" class="download">Export manifest</a><button id="print" type="button">Print view</button></nav></div></header>',
    '<main><section class="summary" aria-label="Complete delivery totals"><div><b id="counts-scenes"></b><span>Source scenes</span></div><div><b id="counts-assets"></b><span>Declared assets</span></div><div><b id="counts-retained"></b><span>Retained asset files</span></div><div><b id="counts-missing"></b><span>Assets not retained</span></div><div><b id="counts-collections"></b><span>Source Collections</span></div></section>',
    '<section class="panel"><h2>Explore this delivery</h2><div class="filters">',
    '<label>Scene, platform or asset<input id="search" type="search" autocomplete="off" placeholder="Search retained scenes"></label>',
    '<label>Collection<select id="collection"><option value="">All Collections</option></select></label>',
    '<label>From date (UTC)<input id="from" type="date"></label><label>Through date (UTC)<input id="through" type="date"></label>',
    '<label>Maximum cloud %<input id="cloud" type="number" min="0" max="100" step="any" placeholder="All"></label>',
    '<label>Asset availability<select id="receipt"><option value="">All scenes</option><option value="retained">With retained assets</option><option value="missing">Without retained assets</option></select></label></div>',
    '<p class="small muted">Date filters include overlapping source intervals. Scenes with unreported time or cloud cover remain listed. Local availability reflects the original receiver at the recorded delivery, not a new filesystem check.</p>',
    '<div class="toolbar"><label>Order<select id="sort"><option value="newest">Newest acquisition first</option><option value="oldest">Oldest acquisition first</option><option value="id">Collection and scene ID</option><option value="cloud">Lowest reported cloud first</option></select></label><button id="clear" type="button">Clear filters</button><button id="filtered-download" type="button">Export filtered GeoJSON</button></div><p id="filter-error" class="notice" role="alert" hidden></p></section>',
    '<div class="layout"><div class="stack"><section class="panel"><div class="heading"><h2>Source footprints</h2><div class="toolbar"><button id="fit-all" type="button">Fit filtered scenes</button><button id="fit-selected" type="button">Fit selected scene</button></div></div>',
    '<div class="map-wrap"><svg id="map" role="group" aria-label="Original scene footprints in longitude and latitude"></svg><div id="map-empty" class="map-empty" hidden>No source geometry is available for this view.</div></div>',
    '<div class="map-caption"><span id="map-caption"></span></div><p class="small muted">Longitude/latitude schematic of original geometry. No basemap, remote tiles, area measurement, or raster reprojection.</p></section>',
    '<section class="panel"><h2>Scenes <span id="count-filtered" class="small muted" aria-live="polite"></span></h2><div class="table-scroll"><table class="scene-table"><thead><tr><th scope="col">Scene / Collection</th><th scope="col">Acquisition time</th><th scope="col">Cloud</th><th scope="col">Retained / declared</th></tr></thead><tbody id="scene-rows"></tbody></table></div>',
    '<p id="scene-empty" class="empty" hidden>No scenes match these filters.</p><div class="pager"><span id="page-status" class="small muted"></span><div class="toolbar"><button id="previous" type="button">Previous</button><button id="next" type="button">Next</button></div></div></section></div>',
    '<section class="panel" aria-labelledby="selection-heading"><h2 id="selection-heading" tabindex="-1">Selected scene</h2><p id="selection-empty" class="empty" hidden>Select a scene to inspect its original metadata and asset receipts.</p><div id="selection-body"></div></section></div>',
    '<h2 id="collection-heading" style="margin-top:28px">Attribution and collection rights</h2><div id="collections" class="collections"></div>',
    '<section id="issues" class="notice" hidden><h2>Source details to retain</h2><ul id="issue-list"></ul></section>',
    '<p class="endnote">This view is derived from the original immutable customer delivery. Original Item properties, geometry, collection licenses, source asset metadata and receiver outcomes remain available in the JSON exports. A local thumbnail is an original retained file; no satellite pixels are generated by this explorer. Use the original StacDelivery reopen command to verify current file bytes.</p></main>',
    '<script id="stac-data" type="application/json">', data, '</script><script>', '(' + runExplorer.toString() + ')();', '</script></body></html>\n',
  ].join('\n');
}
