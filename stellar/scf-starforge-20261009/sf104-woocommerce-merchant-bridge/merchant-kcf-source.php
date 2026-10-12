<?php
/** MIT. Private source receipts and explicit, lossless connector projections. */
if (!defined('ABSPATH')) { exit; }

final class Starforge_SF104_KCF_Source {
    const MAX_FILE = 4194304;
    const MAX_NODES = 120000;
    const MAX_ROWS = 50000;
    const FAMILIES = ['configuration','product-schema','customer-schema','category-schema','products','customers','categories','countries','states','logs','installed-contract','other'];
    private $text; private $offset = 0; private $nodes = 0;
    static function need($ok, $message, $code = 422) { if (!$ok) throw new RuntimeException($message, $code); }
    static function text($v, $max, $label, $blank = false) {
        self::need(is_string($v) && strlen($v) <= $max && preg_match('//u', $v) === 1 && !preg_match('/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/', $v) && ($blank || $v !== ''), 'Supply a valid ' . $label . '.');
        return $v;
    }
    static function is_list($x) { return is_array($x) && (!$x || array_keys($x) === range(0, count($x) - 1)); }
    static function keys($x, $allowed, $label) { Starforge_SF104_ERP_Map::keys($x, $allowed, $label); }
    static function digest($x) { return Starforge_SF104_ERP_Map::digest($x); }
    static function json($x) { return Starforge_SF104_ERP_Map::json($x); }
    static function id($v, $label = 'retained reference', $blank = false) {
        self::need(is_string($v) && (($blank && $v === '') || preg_match('/^[a-f0-9]{64}$/D', $v)), 'Select a valid ' . $label . '.'); return $v;
    }
    static function operation($v) {
        self::need(is_string($v) && preg_match('/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/D', $v), 'Supply a stable operation ID of 8–128 letters, numbers, dots, colons, underscores or hyphens.'); return $v;
    }
    static function when($v, $label) {
        if ($v === null || $v === '') return null;
        self::text($v, 64, $label);
        self::need(preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/D', $v) && strtotime($v) !== false, 'Use the recorded ISO timestamp with its timezone for ' . $label . '.');
        return $v;
    }
    static function application_url($v) {
        self::text($v, 2048, 'Acumatica application URL'); $p = parse_url($v);
        self::need(is_array($p) && isset($p['scheme'], $p['host']) && !isset($p['user'], $p['pass']) &&
            !isset($p['query']) && !isset($p['fragment']) && !isset($p['user']) && !isset($p['pass']) &&
            ($p['scheme'] === 'https' || ($p['scheme'] === 'http' && $p['host'] === '127.0.0.1' && isset($p['port']))) &&
            !preg_match('/%2f|%5c|\.\.|\\\\/i', $p['path'] ?? ''), 'Use the installed application URL, including its application path, without credentials or query parameters.');
        return strtolower($p['scheme']) . '://' . strtolower($p['host']) . (isset($p['port']) ? ':' . $p['port'] : '') . rtrim($p['path'] ?? '', '/');
    }
    static function identity($raw) {
        self::keys($raw, ['applicationUrl','tenant','company','connectorId'], 'The installation identity');
        $out = ['applicationUrl'=>self::application_url($raw['applicationUrl'] ?? '')];
        foreach (['tenant','company','connectorId'] as $k) $out[$k] = self::text($raw[$k] ?? '', 200, 'exact ' . $k);
        return $out;
    }
    static function metadata($raw) {
        self::keys($raw, ['pluginId','pluginVersion','frameworkVersion','packageName','packageSha256','environment','credentialReferences'], 'The installation edition');
        $out = [];
        foreach (['pluginId','pluginVersion','frameworkVersion','packageName','environment'] as $k) $out[$k] = self::text($raw[$k] ?? '', 300, $k, true);
        $out['packageSha256'] = self::id($raw['packageSha256'] ?? '', 'package SHA-256', true);
        $refs = $raw['credentialReferences'] ?? [];
        self::need(is_array($refs) && Starforge_SF104_KCF_Source::is_list($refs) && count($refs) <= 50, 'Select at most 50 credential parameter references.');
        $out['credentialReferences'] = []; $seen = [];
        foreach ($refs as $r) {
            self::keys($r, ['name','environmentVariable'], 'The credential reference');
            $name = self::text($r['name'] ?? '', 200, 'parameter name'); $env = $r['environmentVariable'] ?? '';
            self::need(is_string($env) && preg_match('/^[A-Z][A-Z0-9_]{2,79}$/D', $env), 'Use the environment variable name, without a credential value.');
            self::need(!isset($seen[$name]), 'Each credential parameter must be named once.'); $seen[$name] = true;
            $out['credentialReferences'][] = ['name'=>$name,'environmentVariable'=>$env];
        }
        return $out;
    }
    static function scope($raw) {
        self::keys($raw, ['family','coverage','selection','ids','filter','window','activeSelection'], 'The source scope');
        self::need(in_array($raw['family'] ?? '', self::FAMILIES, true), 'Select the captured entity or configuration family.');
        self::need(in_array($raw['coverage'] ?? '', ['COMPLETE','PARTIAL','SINGLE_ENTITY','UNKNOWN'], true), 'Record the actual source coverage.');
        self::need(in_array($raw['selection'] ?? '', ['ALL','IDS','FILTER'], true), 'Select the original source selection.');
        $ids = $raw['ids'] ?? [];
        self::need(is_array($ids) && Starforge_SF104_KCF_Source::is_list($ids) && count($ids) <= self::MAX_ROWS, 'Supply the exact selected entity IDs.');
        $seen = []; $out = [];
        foreach ($ids as $id) { self::text($id, 1000, 'entity ID'); $key = base64_encode($id); self::need(!isset($seen[$key]), 'An entity ID occurs twice in this scope.'); $seen[$key] = true; $out[] = $id; }
        sort($out, SORT_STRING);
        self::need(($raw['selection'] === 'IDS' && count($out) > 0) || ($raw['selection'] !== 'IDS' && !$out), 'Use exact IDs only with an ID selection.');
        $filter = self::text($raw['filter'] ?? '', 4000, 'source filter', true);
        self::need($raw['selection'] !== 'FILTER' || $filter !== '', 'Record the actual filter used to capture this source.');
        self::need($raw['selection'] === 'FILTER' || $filter === '', 'A filter belongs only to a filter selection.');
        self::need($raw['coverage'] !== 'SINGLE_ENTITY' || ($raw['selection'] === 'IDS' && count($out) === 1), 'A single-entity capture must name its one actual entity ID.');
        return ['family'=>$raw['family'],'coverage'=>$raw['coverage'],'selection'=>$raw['selection'],'ids'=>$out,'filter'=>$filter,
            'window'=>self::text($raw['window'] ?? '', 2000, 'source window', true),
            'activeSelection'=>self::text($raw['activeSelection'] ?? '', 2000, 'active/inactive selection', true)];
    }
    static function pointer($v) {
        self::text($v, 4096, 'JSON pointer or escaped CSV column', true);
        self::need($v === '' || ($v[0] === '/' && !preg_match('/~(?![01])/', $v)), 'Use an RFC 6901 pointer: /rows/0/Field, escaping ~ as ~0 and / as ~1.');
        return $v;
    }
    static function profile($raw) {
        self::keys($raw, ['rowPointer','identityPointers','fields'], 'The source projection');
        $out = ['rowPointer'=>self::pointer($raw['rowPointer'] ?? ''),'identityPointers'=>[],'fields'=>[]];
        $ids = $raw['identityPointers'] ?? []; $fields = $raw['fields'] ?? [];
        self::need(is_array($ids) && Starforge_SF104_KCF_Source::is_list($ids) && count($ids) <= 8, 'Select at most eight exact identity fields.');
        foreach ($ids as $p) $out['identityPointers'][] = self::pointer($p);
        self::need(is_array($fields) && count($fields) <= 100, 'Select at most 100 explicit comparison fields.');
        foreach ($fields as $label=>$p) { self::text((string) $label, 150, 'projection field label'); $out['fields'][(string) $label] = self::pointer($p); }
        self::need(count(array_unique($out['identityPointers'], SORT_STRING)) === count($out['identityPointers']), 'Each identity field must be selected once.');
        return $out;
    }
    static function scalar($type, $value) { return ['type'=>$type,'value'=>$value]; }
    static function missing() { return ['type'=>'missing']; }
    static function child_pointer($path, $part) { return $path . '/' . str_replace(['~','/'], ['~0','~1'], (string) $part); }
    static function parse($bytes, $format, $delimiter = ',') {
        self::need(strlen($bytes) <= self::MAX_FILE, 'The source exceeds the 4 MiB receipt limit.', 413);
        self::need(preg_match('//u', $bytes) === 1, 'Use a UTF-8 source export. Retain its original encoding separately if conversion is needed.');
        if (str_starts_with($bytes, "\xef\xbb\xbf")) $bytes = substr($bytes, 3);
        if ($format === 'json') {
            $p = new self(); $p->text = $bytes; $tree = $p->value(0); $p->white();
            self::need($p->offset === strlen($bytes), 'The source contains trailing data after the JSON document.');
            return $tree;
        }
        self::need($format === 'csv' && in_array($delimiter, [',',"\t",';','|'], true), 'Select JSON or an explicitly delimited CSV source.');
        $f = fopen('php://temp/maxmemory:1048576', 'w+'); self::need($f !== false, 'The CSV reader is unavailable.', 503);
        try {
            self::need(fwrite($f, $bytes) === strlen($bytes), 'The original CSV could not be read completely.', 503); rewind($f);
            $headers = fgetcsv($f, null, $delimiter, '"', '');
            self::need(is_array($headers) && count($headers) > 0 && count($headers) <= 512, 'The CSV requires a header row with at most 512 columns.');
            $seen = [];
            foreach ($headers as $h) { self::text($h, 512, 'exact CSV header'); self::need(!isset($seen[base64_encode($h)]), 'CSV headers must be unique.'); $seen[base64_encode($h)] = true; }
            $rows = []; $physical = 1; $nodes = 1;
            while (($row = fgetcsv($f, null, $delimiter, '"', '')) !== false) {
                $physical++; $nodes += count($row) + 1; self::need($nodes <= self::MAX_NODES, 'The CSV exceeds the supported 120,000 values.', 413); self::need(count($rows) < self::MAX_ROWS, 'The source exceeds the 50,000-row receipt limit.', 413);
                self::need(count($row) === count($headers), 'CSV record ' . $physical . ' has a different column count from its original header.');
                $entries = [];
                foreach ($headers as $i=>$h) $entries[] = ['key'=>$h,'node'=>self::scalar('string', (string) $row[$i])];
                $rows[] = ['type'=>'object','value'=>$entries];
            }
            return ['type'=>'array','value'=>$rows,'csvHeaders'=>$headers];
        } finally { fclose($f); }
    }
    private function white() { $n = strlen($this->text); while ($this->offset < $n && str_contains(" \r\n\t", $this->text[$this->offset])) $this->offset++; }
    private function string_value() {
        $start = $this->offset++; $n = strlen($this->text); $escaped = false;
        while ($this->offset < $n) {
            $c = $this->text[$this->offset++];
            if ($escaped) { $escaped = false; continue; }
            if ($c === '\\') { $escaped = true; continue; }
            if ($c === '"') {
                $value = json_decode(substr($this->text, $start, $this->offset - $start), true);
                self::need(json_last_error() === JSON_ERROR_NONE && is_string($value), 'The original JSON contains an invalid string.'); return $value;
            }
        }
        throw new RuntimeException('The original JSON string is incomplete.', 422);
    }
    private function value($depth) {
        self::need(++$this->nodes <= self::MAX_NODES && $depth <= 64, 'The source exceeds the supported 120,000 values or 64 nesting levels.', 413);
        $this->white(); $c = $this->text[$this->offset] ?? '';
        if ($c === '"') return self::scalar('string', $this->string_value());
        if ($c === '{' || $c === '[') {
            $object = $c === '{'; $end = $object ? '}' : ']'; $this->offset++; $out = []; $seen = []; $this->white();
            if (($this->text[$this->offset] ?? '') === $end) { $this->offset++; return ['type'=>$object ? 'object' : 'array','value'=>[]]; }
            while (true) {
                $this->white();
                if ($object) {
                    self::need(($this->text[$this->offset] ?? '') === '"', 'A JSON object key is missing.'); $key = $this->string_value();
                    self::need(!isset($seen[base64_encode($key)]), 'The source repeats a JSON object key; resolve it in the source export.'); $seen[base64_encode($key)] = true;
                    $this->white(); self::need(($this->text[$this->offset++] ?? '') === ':', 'A JSON key/value separator is missing.');
                    $out[] = ['key'=>$key,'node'=>$this->value($depth + 1)];
                } else $out[] = $this->value($depth + 1);
                $this->white(); $next = $this->text[$this->offset++] ?? '';
                if ($next === $end) break; self::need($next === ',', 'The original JSON container is incomplete.');
            }
            return ['type'=>$object ? 'object' : 'array','value'=>$out];
        }
        foreach (['true'=>['boolean',true],'false'=>['boolean',false],'null'=>['null',null]] as $token=>$v) {
            if (substr($this->text, $this->offset, strlen($token)) === $token) { $this->offset += strlen($token); return self::scalar($v[0], $v[1]); }
        }
        if (preg_match('/\G-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/A', $this->text, $m, 0, $this->offset)) {
            $this->offset += strlen($m[0]); return self::scalar('number', $m[0]);
        }
        throw new RuntimeException('The original JSON is invalid near byte ' . $this->offset . '.', 422);
    }
    static function at($tree, $pointer) {
        self::pointer($pointer); if ($pointer === '') return $tree;
        $node = $tree;
        foreach (explode('/', substr($pointer, 1)) as $part) {
            $key = str_replace(['~1','~0'], ['/','~'], $part);
            if (($node['type'] ?? '') === 'object') {
                $found = null;
                foreach ($node['value'] as $entry) if ($entry['key'] === $key) { $found = $entry['node']; break; }
                if ($found === null) return self::missing(); $node = $found;
            } elseif (($node['type'] ?? '') === 'array') {
                if (!preg_match('/^(0|[1-9][0-9]*)$/D', $key) || strlen($key) > 8 || !array_key_exists((int) $key, $node['value'])) return self::missing();
                $node = $node['value'][(int) $key];
            } else return self::missing();
        }
        return $node;
    }
    static function node_summary($n) {
        $out = ['type'=>$n['type']];
        if (in_array($n['type'], ['object','array'], true)) $out['children'] = count($n['value']);
        elseif (array_key_exists('value', $n)) $out['value'] = $n['value'];
        return $out;
    }
    static function browse($tree, $pointer, $page = 1, $limit = 50) {
        $n = self::at($tree, $pointer); $items = [];
        if ($n['type'] === 'object') {
            foreach ($n['value'] as $e) $items[] = ['key'=>$e['key'],'pointer'=>self::child_pointer($pointer, $e['key'])] + self::node_summary($e['node']);
        } elseif ($n['type'] === 'array') {
            foreach ($n['value'] as $i=>$e) $items[] = ['key'=>(string) $i,'pointer'=>self::child_pointer($pointer, $i)] + self::node_summary($e);
        }
        return ['pointer'=>$pointer,'node'=>self::node_summary($n),'items'=>array_slice($items, ($page-1)*$limit, $limit),'total'=>count($items),'page'=>$page,'limit'=>$limit];
    }
    static function projection($tree, $profile) {
        $rows = self::at($tree, $profile['rowPointer']); $out = []; $seen = [];
        $items = $rows['type'] === 'array' ? $rows['value'] : ($rows['type'] === 'missing' ? [] : [$rows]);
        self::need(count($items) <= self::MAX_ROWS, 'The projection exceeds 50,000 source rows.', 413);
        foreach ($items as $i=>$row) {
            $pointer = $rows['type'] === 'array' ? self::child_pointer($profile['rowPointer'], $i) : $profile['rowPointer'];
            $identity = [];
            foreach ($profile['identityPointers'] as $p) {
                $v = self::at($row, $p); self::need(!in_array($v['type'], ['missing','null','object','array'], true), 'A selected identity field is absent, null or a container in source row ' . ($i+1) . '.');
                $identity[] = $v;
            }
            // Without an identity recipe this is a path projection, never a catalog census.
            $key = $identity ? self::digest($identity) : self::digest(['pointer'=>$pointer]);
            self::need(!isset($seen[$key]), 'Two source rows have the same selected identity. Include the actual country, company or parent key.'); $seen[$key] = true;
            $fields = [];
            foreach ($profile['fields'] as $label=>$p) $fields[$label] = self::at($row, $p);
            if (!$fields) $fields['record'] = $row;
            $out[] = ['key'=>$key,'pointer'=>$pointer,'identity'=>$identity,'fields'=>$fields,'sha256'=>self::digest($fields)];
        }
        return $out;
    }
    static function rule_value($node, $rule) {
        $translations = $rule['values'] ?? [];
        self::need(is_array($translations) && Starforge_SF104_KCF_Source::is_list($translations) && count($translations) <= 1000, 'Use at most 1,000 exact value translations.');
        $seen = []; $translated = false; $originalKey = self::digest($node);
        foreach ($translations as $r) {
            self::keys($r, ['from','to'], 'The exact value translation'); $key = self::digest($r['from']);
            self::need(!isset($seen[$key]), 'An exact source value occurs twice in the translation.'); $seen[$key] = true;
            self::validate_scalar($r['from']); self::validate_scalar($r['to']);
            if ($originalKey === $key) { $node = $r['to']; $translated = true; }
        }
        self::need(!$translations || $translated, 'The selected exact source value has no reviewed translation.');
        self::need(!in_array($node['type'] ?? '', ['missing','null','array','object'], true), 'The selected source value is absent, null or a container. Choose the actual field or an explicit reviewed constant.');
        $conversion = $rule['conversion'] ?? 'preserve';
        self::need(in_array($conversion, ['preserve','trim','upper','lower','number-text','integer'], true), 'Select an explicit supported value conversion.');
        if ($conversion === 'number-text') { self::need($node['type'] === 'number', 'Number-to-text applies only to a captured JSON number.'); return $node['value']; }
        if ($conversion === 'integer') {
            self::need(in_array($node['type'], ['string','number'], true) && preg_match('/^(0|[1-9][0-9]{0,8})$/D', $node['value']), 'The selected source is not an exact supported non-negative integer.');
            return (int) $node['value'];
        }
        if ($conversion !== 'preserve') {
            self::need($node['type'] === 'string', 'Text conversion applies only to a captured string.');
            if ($conversion === 'trim') return trim($node['value']);
            return $conversion === 'upper' ? strtoupper($node['value']) : strtolower($node['value']);
        }
        self::need($node['type'] !== 'number', 'A captured JSON number requires explicit number-to-text or integer conversion; identifiers are never converted implicitly.');
        return $node['value'];
    }
    static function validate_scalar($n) {
        self::keys($n, ['type','value'], 'The typed value');
        self::need(in_array($n['type'] ?? '', ['string','number','boolean','null'], true), 'Select an explicit scalar value type.');
        $type = $n['type']; $v = $n['value'] ?? null;
        self::need(($type === 'string' && is_string($v) && preg_match('//u', $v) === 1) ||
            ($type === 'boolean' && is_bool($v)) || ($type === 'null' && $v === null) ||
            ($type === 'number' && is_string($v) && preg_match('/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/D', $v)), 'The typed value does not match its declared type.');
    }
}
