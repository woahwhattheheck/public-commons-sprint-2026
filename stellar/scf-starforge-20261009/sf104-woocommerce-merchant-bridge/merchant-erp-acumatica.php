<?php
/** MIT. The published Acumatica contract, exact wire numbers and native readback. */
if (!defined('ABSPATH')) { exit; }
require_once __DIR__ . '/merchant-erp-mapping.php';

final class Starforge_SF104_ERP_Acumatica {
    const MODEL_REF = 'https://github.com/Acumatica/AcumaticaRESTAPIClientForCSharp/blob/bc657f6f8a703057ed8d623fcab48617ba6180f2/EndpointDefinitions/Default_25.200.001';
    const EXPAND = 'Details,BillToAddress,ShipToAddress,TaxDetails';
    static function endpoint($target) {
        return $target['baseUrl'] . '/entity/' . rawurlencode($target['endpoint']) . '/' . rawurlencode($target['version']);
    }
    static function connections() {
        $raw = getenv('SF104_ERP_CONNECTIONS');
        if (!is_string($raw) || strlen($raw) > 65536) return [];
        $rows = json_decode($raw, true); $out = [];
        if (!is_array($rows)) return [];
        foreach ($rows as $row) if (is_array($row) && is_string($row['baseUrl'] ?? null) && is_string($row['tokenEnv'] ?? null)) {
            $out[] = ['baseUrl'=>rtrim($row['baseUrl'], '/'),'tokenEnv'=>$row['tokenEnv']];
        }
        return $out;
    }
    static function authorized_connection($target) {
        foreach (self::connections() as $connection) if ($connection['baseUrl'] === $target['baseUrl'] && $connection['tokenEnv'] === $target['tokenEnv']) return true;
        return false;
    }
    static function request($target, $method, $path, $query = [], $body = null, $existence = null, $max = 2097152) {
        if (!self::authorized_connection($target)) throw new RuntimeException('The WordPress administrator must register this exact ERP application URL and credential reference in SF104_ERP_CONNECTIONS before a live connection.', 422);
        $token = getenv($target['tokenEnv']);
        if (!is_string($token) || strlen($token) < 8 || strlen($token) > 16384 || preg_match('/[\x00-\x20\x7f]/', $token)) {
            throw new RuntimeException('The selected ERP token environment reference is unavailable. Configure the existing authorized token in this WordPress environment.', 422);
        }
        $local = $target['allowLocal'] === true;
        if ($local && getenv('SF104_ERP_ALLOW_LOOPBACK') !== '1') {
            throw new RuntimeException('Loopback ERP development calls require SF104_ERP_ALLOW_LOOPBACK=1 in this WordPress environment.', 422);
        }
        $url = self::endpoint($target) . $path . ($query ? '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986) : '');
        $headers = ['Authorization'=>'Bearer ' . $token, 'Accept'=>'application/json'];
        if ($body !== null) $headers['Content-Type'] = 'application/json';
        if ($existence === 'create') $headers['If-None-Match'] = '*';
        if ($existence === 'update') $headers['If-Match'] = '*';
        $args = ['method'=>$method, 'headers'=>$headers, 'timeout'=>20, 'redirection'=>0,
            'limit_response_size'=>$max + 1, 'reject_unsafe_urls'=>!$local, 'sslverify'=>true];
        if ($body !== null) $args['body'] = Starforge_SF104_ERP_Map::wire_json($body);
        $result = ['method'=>$method, 'url'=>$url, 'startedAt'=>gmdate('c')];
        $response = $local ? wp_remote_request($url, $args) : wp_safe_remote_request($url, $args);
        $result['completedAt'] = gmdate('c');
        if (is_wp_error($response)) {
            $result['httpStatus'] = null;
            $result['error'] = substr(str_replace($token, '[credential removed]', $response->get_error_message()), 0, 2000);
            $result['errorCodes'] = $response->get_error_codes();
            return $result;
        }
        $result['httpStatus'] = (int) wp_remote_retrieve_response_code($response);
        $raw = (string) wp_remote_retrieve_body($response);
        $result['bodySha256'] = hash('sha256', $raw);
        $result['bodyBytes'] = strlen($raw);
        $result['headers'] = [];
        foreach (['content-type','etag','retry-after','x-correlation-id'] as $name) {
            $v = wp_remote_retrieve_header($response, $name);
            if (is_string($v) && $v !== '') $result['headers'][$name] = substr(str_replace($token, '[credential removed]', $v), 0, 512);
        }
        if (strlen($raw) > $max) { $result['error'] = 'The ERP response exceeds the selected project response limit.'; return $result; }
        $safe = str_replace($token, '[credential removed]', $raw);
        try { $result['data'] = Starforge_SF104_ERP_Map::read_json($safe); }
        catch (Throwable $e) { $result['error'] = $e->getMessage(); $result['responseText'] = substr($safe, 0, 4000); }
        return $result;
    }
    static function schema_properties($schema, $root, $depth = 0) {
        if (!is_array($schema) || $depth > 12) return [];
        if (isset($schema['$ref'])) {
            $path = explode('/', substr($schema['$ref'], 2)); $next = $root;
            foreach ($path as $part) { $part = str_replace(['~1','~0'], ['/','~'], $part); $next = $next[$part] ?? null; }
            return self::schema_properties($next, $root, $depth + 1);
        }
        $properties = $schema['properties'] ?? [];
        foreach (($schema['allOf'] ?? []) as $part) $properties = array_replace($properties, self::schema_properties($part, $root, $depth + 1));
        return $properties;
    }
    static function schema_check($target) {
        $result = self::request($target, 'GET', '/swagger.json', [], null, null, 8388608);
        $issues = []; $schema = $result['data'] ?? [];
        if (($result['httpStatus'] ?? null) !== 200 || !is_array($schema)) $issues[] = 'Read the installed endpoint OpenAPI document with the selected authorized credential.';
        $schemas = $schema['components']['schemas'] ?? $schema['definitions'] ?? [];
        $required = [
            'SalesOrder'=>[
                'string'=>['OrderType','OrderNbr','CustomerOrder','ExternalRef','CustomerID','CurrencyID','LocationID','Branch','Description'],
                'boolean'=>['Hold','DisableAutomaticDiscountUpdate','DisableAutomaticTaxCalculation','BillToAddressOverride','ShipToAddressOverride'],
                'number'=>['ControlTotal','OrderTotal','TaxTotal'],
            ],
            'SalesOrderDetail'=>[
                'string'=>['ExternalRef','InventoryID','UOM','TaxCategory','TaxZone','WarehouseID','LineDescription'],
                'integer'=>['LineNbr'],
                'number'=>['OrderQty','UnitPrice','ExtendedPrice','Amount','DiscountAmount'],
                'boolean'=>['ManualPrice','ManualDiscount','CalculateDiscountsOnImport'],
            ],
            'Address'=>['string'=>['AddressLine1','AddressLine2','City','Country','PostalCode','State']],
        ];
        $observed = []; $types = [];
        foreach ($required as $entity=>$groups) {
            $props = self::schema_properties($schemas[$entity] ?? [], $schema); $observed[$entity] = array_keys($props);
            foreach ($groups as $expected=>$fields) foreach ($fields as $field) {
                if (!array_key_exists($field, $props)) {
                    $issues[] = $entity . '.' . $field . ' is absent from this installed contract.';
                    continue;
                }
                $wrapped = self::schema_properties($props[$field], $schema);
                $kind = $wrapped['value']['type'] ?? null; $types[$entity . '.' . $field] = $kind;
                if ($kind !== $expected && !(is_array($kind) && in_array($expected, $kind, true)))
                    $issues[] = $entity . '.' . $field . ' must expose a wrapped ' . $expected . ' value.';
            }
        }
        $order_props = self::schema_properties($schemas['SalesOrder'] ?? [], $schema);
        $detail_schema = $order_props['Details'] ?? [];
        if (($detail_schema['type'] ?? null) !== 'array' ||
            !isset(self::schema_properties($detail_schema['items'] ?? [], $schema)['LineNbr']))
            $issues[] = 'SalesOrder.Details must expose the native SalesOrderDetail array.';
        foreach (['BillToAddress','ShipToAddress'] as $field) {
            $address_props = self::schema_properties($order_props[$field] ?? [], $schema);
            foreach ($required['Address']['string'] as $address_field) if (!isset($address_props[$address_field]))
                $issues[] = 'SalesOrder.' . $field . '.' . $address_field . ' is absent from the installed address contract.';
        }
        $paths = $schema['paths'] ?? [];
        foreach (['get','put'] as $method) if (!isset($paths['/SalesOrder'][$method])) $issues[] = 'The installed SalesOrder contract does not expose ' . strtoupper($method) . '.';
        return ['schema'=>'stellar-forge.sf104.erp-contract-check.v1', 'usable'=>!$issues, 'checkedAt'=>gmdate('c'),
            'endpoint'=>self::endpoint($target), 'installedReference'=>$target['contractReference'],
            'publishedReference'=>self::MODEL_REF, 'schemaSha256'=>$result['bodySha256'] ?? null,
            'httpStatus'=>$result['httpStatus'] ?? null, 'issues'=>$issues, 'fields'=>$observed, 'valueTypes'=>$types,
            'transportError'=>$result['error'] ?? null];
    }
    static function lookup($plan, $key = null) {
        $t = $plan['target'];
        $query = ['$expand'=>self::EXPAND];
        if ($key) {
            $path = '/SalesOrder/' . rawurlencode($key['orderType']) . '/' . rawurlencode($key['orderNbr']);
        } else {
            $path = '/SalesOrder';
            $quote = static function ($x) { return "'" . str_replace("'", "''", $x) . "'"; };
            $query['$filter'] = 'OrderType eq ' . $quote($t['orderType']) . ' and CustomerOrder eq ' . $quote($plan['externalReference']);
            $query['$top'] = '2';
        }
        $result = self::request($t, 'GET', $path, $query);
        $data = $result['data'] ?? null; $matches = null;
        if (($result['httpStatus'] ?? null) === 200 && is_array($data)) {
            if ($key && isset($data['OrderNbr'])) $matches = [$data];
            elseif (!$key && (!$data || array_keys($data) === range(0, count($data) - 1))) $matches = $data;
            else $result['error'] = 'The ERP search response is not a native SalesOrder result.';
        } elseif ($key && ($result['httpStatus'] ?? null) === 404) $matches = [];
        $result['matches'] = $matches;
        return $result;
    }
    static function key($record) {
        $m = Starforge_SF104_ERP_Map::class;
        $type = $m::scalar($record, 'OrderType'); $number = $m::scalar($record, 'OrderNbr');
        if (!is_string($type) || !preg_match('/^[A-Za-z0-9]{2}$/D', $type) ||
            !is_string($number) || $number === '' || strlen($number) > 15 || preg_match('/[\x00-\x20\/\\\\]/', $number)) return null;
        return ['orderType'=>$type, 'orderNbr'=>$number, 'id'=>is_string($record['id'] ?? null) ? $record['id'] : null];
    }
    static function comparison($plan, $record) {
        $m = Starforge_SF104_ERP_Map::class; $d = Starforge_SF104_ERP_Decimal::class;
        $issues = []; $links = [];
        $difference = static function ($path, $expected, $actual) use (&$issues) {
            if ($expected !== $actual) $issues[] = ['field'=>$path, 'expected'=>$expected, 'actual'=>$actual];
        };
        if (!self::key($record)) $issues[] = ['field'=>'OrderNbr', 'expected'=>'An actual ERP document key', 'actual'=>null];
        foreach (['OrderType','CustomerOrder','ExternalRef','CustomerID','CurrencyID','LocationID','Branch','Hold','Description','BillToAddressOverride','ShipToAddressOverride','DisableAutomaticDiscountUpdate','DisableAutomaticTaxCalculation'] as $field) {
            if (isset($plan['payload'][$field])) $difference($field, $plan['payload'][$field]['value'], $m::scalar($record, $field));
        }
        foreach (['OrderTotal'=>'totalMinor','TaxTotal'=>'taxMinor'] as $field=>$expected) {
            try { $actual = $d::units($m::scalar($record, $field), $plan['expected']['currencyDecimals']); }
            catch (Throwable $e) { $actual = null; }
            $difference($field . ' (minor units)', $plan['expected'][$expected], $actual);
        }
        foreach (['BillToAddress','ShipToAddress'] as $field) {
            if (isset($plan['payload'][$field])) foreach ($plan['payload'][$field] as $key=>$wrapped) {
                $value = $m::scalar($record[$field] ?? [], $key);
                $difference($field . '.' . $key, $wrapped['value'], $wrapped['value'] === '' && $value === null ? '' : $value);
            }
        }
        $details = $record['Details'] ?? null; $by_ref = [];
        if (!is_array($details)) $issues[] = ['field'=>'Details', 'expected'=>'Expanded native order lines', 'actual'=>null];
        else foreach ($details as $line) {
            $ref = is_array($line) ? $m::scalar($line, 'ExternalRef') : null;
            if (!is_string($ref) || $ref === '' || isset($by_ref[$ref])) $issues[] = ['field'=>'Details.ExternalRef', 'expected'=>'One unique original line reference per ERP line', 'actual'=>$ref];
            else $by_ref[$ref] = $line;
        }
        $difference('Details count', count($plan['lines']), is_array($details) ? count($details) : null);
        foreach ($plan['lines'] as $line) {
            $ref = $line['payload']['ExternalRef']['value']; $actual = $by_ref[$ref] ?? [];
            $prefix = 'Line ' . $line['sourceLineId'] . '.';
            foreach (['InventoryID','UOM','TaxCategory','TaxZone','WarehouseID','ManualPrice','ManualDiscount','CalculateDiscountsOnImport'] as $field) {
                if (isset($line['payload'][$field])) $difference($prefix . $field, $line['payload'][$field]['value'], $m::scalar($actual, $field));
            }
            foreach (['OrderQty','UnitPrice','DiscountAmount'] as $field) {
                try { $observed = $d::canonical($m::scalar($actual, $field)); }
                catch (Throwable $e) { $observed = null; }
                $difference($prefix . $field, $d::canonical($line['payload'][$field]['value']), $observed);
            }
            foreach (['ExtendedPrice'=>'subtotalMinor','Amount'=>'netMinor'] as $field=>$expected) {
                try { $observed = $d::units($m::scalar($actual, $field), $plan['expected']['currencyDecimals']); }
                catch (Throwable $e) { $observed = null; }
                $difference($prefix . $field . ' (minor units)', $line[$expected], $observed);
            }
            $number = $m::scalar($actual, 'LineNbr'); $id = $actual['id'] ?? null;
            if (!is_string($number) || !preg_match('/^[1-9][0-9]*$/D', $number)) $issues[] = ['field'=>$prefix . 'LineNbr', 'expected'=>'The actual positive ERP line key', 'actual'=>$number];
            $links[] = ['sourceLineId'=>$line['sourceLineId'], 'externalReference'=>$ref, 'erpId'=>$id, 'erpLineNbr'=>$number];
        }
        if (!empty($record['error'])) $issues[] = ['field'=>'ERP error', 'expected'=>null, 'actual'=>substr((string) $record['error'], 0, 2000)];
        return ['matched'=>!$issues, 'differences'=>$issues, 'lineLinks'=>$links, 'targetKey'=>self::key($record)];
    }
    static function identity_check($plan, $record, $additional_links = []) {
        $m = Starforge_SF104_ERP_Map::class; $issues = []; $links = []; $allowed = [];
        foreach ($plan['lines'] as $line) $allowed[$line['payload']['ExternalRef']['value']] = $line['sourceLineId'];
        foreach ($additional_links as $link) $allowed[$link['externalReference']] = $link['sourceLineId'];
        $key = self::key($record);
        if (!$key || $key['orderType'] !== $plan['target']['orderType'] ||
            $m::scalar($record, 'CustomerOrder') !== $plan['externalReference'] ||
            $m::scalar($record, 'ExternalRef') !== $plan['payload']['ExternalRef']['value']) $issues[] = 'The returned ERP document does not have the original Woo order identity.';
        $seen = [];
        if (!is_array($record['Details'] ?? null)) $issues[] = 'The native ERP detail rows were not expanded.';
        else foreach ($record['Details'] as $row) {
            $ref = is_array($row) ? $m::scalar($row, 'ExternalRef') : null;
            $number = is_array($row) ? $m::scalar($row, 'LineNbr') : null;
            if (!is_string($ref) || !isset($allowed[$ref]) || isset($seen[$ref]) ||
                !is_string($number) || !preg_match('/^[1-9][0-9]*$/D', $number)) { $issues[] = 'A target line is unowned, duplicated, or missing its original native key.'; continue; }
            $seen[$ref] = true;
            $links[] = ['sourceLineId'=>$allowed[$ref],'externalReference'=>$ref,'erpId'=>$row['id'] ?? null,'erpLineNbr'=>$number];
        }
        return ['identified'=>!$issues,'issues'=>$issues,'targetKey'=>$key,'lineLinks'=>$links];
    }
    static function fingerprint($record) {
        // Native rowNumber and link URLs are request presentation, not document revisions.
        $clean = static function ($x) use (&$clean) {
            if (!is_array($x)) return $x;
            unset($x['rowNumber'], $x['_links'], $x['links']);
            foreach ($x as $key=>$value) $x[$key] = $clean($value);
            return $x;
        };
        return Starforge_SF104_ERP_Map::digest($clean($record));
    }
    static function correction_payload($plan, $prior, $line_links) {
        $m = Starforge_SF104_ERP_Map::class; $key = self::key($prior);
        $m::need($key !== null, 'Reconcile the original target order before preparing a correction.');
        $payload = $plan['payload']; $payload['OrderNbr'] = ['value'=>$key['orderNbr']];
        $owned = []; $next = []; $references = [];
        foreach ($line_links as $link) $references[$link['externalReference']] = $link;
        $m::need($key['orderType'] === $plan['target']['orderType'] &&
            $m::scalar($prior, 'CustomerOrder') === $plan['externalReference'] &&
            $m::scalar($prior, 'ExternalRef') === $plan['payload']['ExternalRef']['value'],
            'The selected ERP document no longer has this original order identity.');
        foreach (($prior['Details'] ?? []) as $row) {
            $ref = $m::scalar($row, 'ExternalRef');
            $m::need(is_string($ref) && $ref !== '' && !isset($owned[$ref]), 'Resolve ambiguous original ERP line references before correcting this order.');
            $m::need(isset($references[$ref]), 'The ERP order contains an unowned line. Resolve it in the ERP before applying this source correction.');
            $m::need((string) $m::scalar($row, 'LineNbr') === (string) $references[$ref]['erpLineNbr'] &&
                (($references[$ref]['erpId'] ?? null) === null || ($row['id'] ?? null) === $references[$ref]['erpId']),
                'An original ERP line identity changed. Reconcile its native key before applying this correction.');
            $owned[$ref] = $row;
        }
        foreach ($payload['Details'] as $row) {
            $ref = $row['ExternalRef']['value'];
            if (isset($owned[$ref])) {
                $original = $owned[$ref];
                $number = $m::scalar($original, 'LineNbr');
                $m::need(is_string($number) && preg_match('/^[1-9][0-9]*$/D', $number), 'The original ERP line key is unavailable.');
                $row['LineNbr'] = ['value'=>$number];
                if (is_string($original['id'] ?? null)) $row['id'] = $original['id'];
                unset($owned[$ref]);
            }
            $next[] = $row;
        }
        foreach ($owned as $row) {
            $number = $m::scalar($row, 'LineNbr');
            $m::need(is_string($number) && preg_match('/^[1-9][0-9]*$/D', $number), 'A removed ERP line has no retained native key.');
            $removed = ['LineNbr'=>['value'=>$number], 'delete'=>true];
            if (is_string($row['id'] ?? null)) $removed['id'] = $row['id'];
            $next[] = $removed;
        }
        $payload['Details'] = $next;
        return $payload;
    }
}
