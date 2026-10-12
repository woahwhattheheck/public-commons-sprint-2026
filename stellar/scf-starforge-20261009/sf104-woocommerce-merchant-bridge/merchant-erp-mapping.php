<?php
/** MIT. Exact commerce-to-Acumatica mapping; no network or order mutation. */
if (!defined('ABSPATH')) { exit; }

final class Starforge_SF104_ERP_Decimal {
    static function trim($n) { return ltrim($n, '0') ?: '0'; }
    static function cmp($a, $b) {
        $a = self::trim($a); $b = self::trim($b);
        return strlen($a) <=> strlen($b) ?: strcmp($a, $b);
    }
    static function add($a, $b) {
        $out = ''; $carry = 0; $i = strlen($a) - 1; $j = strlen($b) - 1;
        while ($i >= 0 || $j >= 0 || $carry) {
            $n = ($i >= 0 ? (int) $a[$i--] : 0) + ($j >= 0 ? (int) $b[$j--] : 0) + $carry;
            $out = (string) ($n % 10) . $out; $carry = intdiv($n, 10);
        }
        return self::trim($out);
    }
    static function sub($a, $b) {
        if (self::cmp($a, $b) < 0) throw new RuntimeException('The selected order contains a negative amount. Select its separate adjustment flow.', 422);
        $out = ''; $borrow = 0; $j = strlen($b) - 1;
        for ($i = strlen($a) - 1; $i >= 0; $i--) {
            $n = (int) $a[$i] - ($j >= 0 ? (int) $b[$j--] : 0) - $borrow;
            $borrow = $n < 0 ? 1 : 0; $out = (string) ($n + ($borrow ? 10 : 0)) . $out;
        }
        return self::trim($out);
    }
    static function mul($a, $b) {
        $a = self::trim($a); $b = self::trim($b);
        $out = '0';
        for ($i = strlen($b) - 1, $zeros = ''; $i >= 0; $i--, $zeros .= '0') {
            $row = '0';
            for ($j = 0; $j < (int) $b[$i]; $j++) $row = self::add($row, $a);
            $out = self::add($out, $row . $zeros);
        }
        return self::trim($out);
    }
    static function div($a, $b) {
        if (self::trim($b) === '0') throw new RuntimeException('Order quantities must be greater than zero.', 422);
        $q = ''; $r = '0';
        foreach (str_split($a) as $digit) {
            $r = self::trim($r . $digit); $n = 0;
            while (self::cmp($r, $b) >= 0) { $r = self::sub($r, $b); $n++; }
            $q .= (string) $n;
        }
        return [self::trim($q), $r];
    }
    static function canonical($value) {
        if ((!is_string($value) && !is_int($value)) ||
            !preg_match('/^\+?([0-9]{1,36})(?:\.([0-9]{1,18}))?(?:[eE]([+-]?[0-9]{1,2}))?$/D', (string) $value, $m)) {
            throw new RuntimeException('Use exact non-negative decimal text for source quantities and money.', 422);
        }
        $whole = $m[1]; $fraction = $m[2] ?? ''; $exponent = (int) ($m[3] ?? 0);
        if (abs($exponent) > 18) throw new RuntimeException('The decimal exponent is outside the selected order contract.', 422);
        if ($exponent > 0) {
            $fraction = str_pad($fraction, $exponent, '0');
            $whole .= substr($fraction, 0, $exponent); $fraction = substr($fraction, $exponent);
        } elseif ($exponent < 0) {
            $whole = str_pad($whole, -$exponent + 1, '0', STR_PAD_LEFT);
            $fraction = substr($whole, $exponent) . $fraction; $whole = substr($whole, 0, $exponent);
        }
        $whole = self::trim($whole); $fraction = rtrim($fraction, '0');
        if (strlen($whole) > 36 || strlen($fraction) > 18) throw new RuntimeException('The decimal exceeds the supported source precision.', 422);
        return $whole . ($fraction !== '' ? '.' . $fraction : '');
    }
    static function units($value, $scale, $round = false) {
        $p = explode('.', self::canonical($value), 2); $fraction = $p[1] ?? '';
        if (!$round && strlen($fraction) > $scale) throw new RuntimeException('An amount has more precision than the approved currency or quantity map.', 422);
        $out = self::trim($p[0] . str_pad(substr($fraction, 0, $scale), $scale, '0'));
        if ($round && strlen($fraction) > $scale && (int) $fraction[$scale] >= 5) $out = self::add($out, '1');
        return $out;
    }
    static function decimal($units, $scale) {
        $s = str_pad(self::trim($units), $scale + 1, '0', STR_PAD_LEFT);
        return $scale ? substr($s, 0, -$scale) . '.' . substr($s, -$scale) : $s;
    }
    static function price($subtotal, $quantity, $money_scale, $price_scale) {
        $q = self::canonical($quantity); $parts = explode('.', $q, 2); $qscale = strlen($parts[1] ?? '');
        $quantity_units = self::units($q, $qscale);
        $numerator = self::units($subtotal, $money_scale) . str_repeat('0', $qscale + $price_scale);
        $denominator = $quantity_units . str_repeat('0', $money_scale);
        [$price, $remainder] = self::div($numerator, $denominator);
        if (self::cmp(self::mul($remainder, '2'), $denominator) >= 0) $price = self::add($price, '1');
        $extended = self::decimal(self::mul($price, $quantity_units), $price_scale + $qscale);
        if (self::units($extended, $money_scale, true) !== self::units($subtotal, $money_scale)) {
            throw new RuntimeException('The approved unit-price precision cannot reproduce the original line subtotal. Correct the selected price contract.', 422);
        }
        return self::decimal($price, $price_scale);
    }
}

final class Starforge_SF104_ERP_Map {
    const SCHEMA = 'stellar-forge.sf104.erp-map.v1';
    const PLAN_SCHEMA = 'stellar-forge.sf104.erp-plan.v1';
    const TARGET_VERSION = '25.200.001';
    const NUMBERS = ['OrderQty', 'UnitPrice', 'ExtendedPrice', 'DiscountAmount', 'ControlTotal', 'LineNbr'];
    static function need($ok, $message) { if (!$ok) throw new RuntimeException($message, 422); }
    static function text($v, $max, $name, $blank = false) {
        self::need(is_string($v), 'Enter a valid ' . $name . '.');
        $v = trim($v);
        self::need(($blank || $v !== '') && strlen($v) <= $max && !preg_match('/[\x00-\x1f\x7f]/', $v), 'Enter a valid ' . $name . '.');
        return $v;
    }
    static function keys($x, $allowed, $name) {
        self::need(is_array($x), $name . ' must be an object.');
        self::need(!array_diff(array_keys($x), $allowed), $name . ' contains unsupported fields.');
    }
    static function canonical($x) {
        if (!is_array($x)) return $x;
        $list = !$x || array_keys($x) === range(0, count($x) - 1);
        if (!$list) ksort($x, SORT_STRING);
        foreach ($x as $k => $v) $x[$k] = self::canonical($v);
        return $x;
    }
    static function json($x) {
        $s = wp_json_encode(self::canonical($x), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (!is_string($s)) throw new RuntimeException('The ERP project could not be encoded.', 503);
        return $s;
    }
    static function digest($x) { return hash('sha256', self::json($x)); }
    static function compile($raw) {
        self::keys($raw, ['schema','name','storeNamespace','target','currency','currencyDecimals','unitPriceDecimals',
            'admittedStatuses','customerBindings','productBindings','feeBindings','shippingBinding','addressMode','reviewOwner'], 'The map');
        self::need(($raw['schema'] ?? '') === self::SCHEMA, 'Select a supported ERP map.');
        $map = $raw;
        $map['name'] = self::text($raw['name'] ?? '', 120, 'map name');
        $map['storeNamespace'] = self::text($raw['storeNamespace'] ?? '', 16, 'store namespace');
        self::need(preg_match('/^[A-Za-z][A-Za-z0-9_-]{0,15}$/D', $map['storeNamespace']), 'Use a stable store namespace of at most 16 letters, numbers, underscores or hyphens.');
        $map['reviewOwner'] = self::text($raw['reviewOwner'] ?? '', 160, 'operating owner');
        self::need(is_string($raw['currency'] ?? null) && preg_match('/^[A-Z]{3}$/D', $raw['currency']), 'Select the original three-letter order currency.');
        foreach (['currencyDecimals' => [0,4], 'unitPriceDecimals' => [0,8]] as $key => $range) {
            self::need(is_int($raw[$key] ?? null) && $raw[$key] >= $range[0] && $raw[$key] <= $range[1], 'Select an approved ' . $key . ' value.');
        }
        self::need($raw['unitPriceDecimals'] >= $raw['currencyDecimals'], 'Unit-price precision must cover the currency precision.');
        self::need(is_array($raw['admittedStatuses'] ?? null) && count($raw['admittedStatuses']) > 0 &&
            !array_diff($raw['admittedStatuses'], ['pending','on-hold','processing','completed']), 'Select the Woo order states approved for this ERP flow.');
        $map['admittedStatuses'] = array_values(array_unique($raw['admittedStatuses'])); sort($map['admittedStatuses']);
        self::need(in_array($raw['addressMode'] ?? '', ['customer_default','order_override'], true), 'Select the approved source of ERP addresses.');
        $t = $raw['target'] ?? null;
        self::keys($t, ['baseUrl','endpoint','version','orderType','tokenEnv','branch','taxZone','hold','contractReference','allowLocal'], 'The target');
        $t['baseUrl'] = self::text($t['baseUrl'] ?? '', 2048, 'ERP application URL');
        $parts = parse_url($t['baseUrl']);
        self::need(is_array($parts) && isset($parts['scheme'], $parts['host']) && !isset($parts['user']) && !isset($parts['pass']) &&
            !isset($parts['query']) && !isset($parts['fragment']), 'Select the installed ERP HTTPS application URL.');
        $local = ($t['allowLocal'] ?? false) === true && $parts['scheme'] === 'http' && $parts['host'] === '127.0.0.1' &&
            isset($parts['port']) && $parts['port'] > 0 && $parts['port'] < 65536;
        self::need($local || ($parts['scheme'] === 'https' && ($t['allowLocal'] ?? false) === false), 'The target requires HTTPS, or the explicitly selected loopback development endpoint.');
        self::need(!preg_match('/%2f|%5c|\.\.|\\\\/i', $parts['path'] ?? ''), 'The ERP application path is invalid.');
        $t['baseUrl'] = rtrim($t['baseUrl'], '/');
        $t['endpoint'] = self::text($t['endpoint'] ?? '', 64, 'installed endpoint name');
        self::need(preg_match('/^[A-Za-z][A-Za-z0-9_-]{0,63}$/D', $t['endpoint']), 'The installed endpoint name is invalid.');
        self::need(($t['version'] ?? '') === self::TARGET_VERSION, 'This adapter implements the published 25.200.001 SalesOrder contract. Select a compatible installed endpoint.');
        $t['orderType'] = self::text($t['orderType'] ?? '', 2, 'sales order type');
        self::need(preg_match('/^[A-Za-z0-9]{2}$/D', $t['orderType']), 'Select the two-character ERP order type.');
        $t['tokenEnv'] = self::text($t['tokenEnv'] ?? '', 80, 'credential environment reference');
        self::need(preg_match('/^[A-Z][A-Z0-9_]{2,79}$/D', $t['tokenEnv']), 'Use an environment reference for the existing ERP bearer token.');
        foreach (['branch'=>30,'taxZone'=>10] as $k=>$max) $t[$k] = self::text($t[$k] ?? '', $max, $k, true);
        self::need(is_bool($t['hold'] ?? null), 'Select whether the received ERP order is on hold.');
        $t['contractReference'] = self::text($t['contractReference'] ?? '', 2048, 'installed contract reference');
        $t['allowLocal'] = $local; $map['target'] = $t;
        foreach (['customerBindings','productBindings','feeBindings'] as $key) {
            self::need(is_array($raw[$key] ?? null) && count($raw[$key]) <= 5000, 'Supply a supported ' . $key . ' table.');
            $seen = []; $normalized = [];
            foreach ($raw[$key] as $row) {
                $fields = $key === 'customerBindings' ? ['sourceKey','customerId','locationId'] : ['sourceKey','inventoryId','uom','taxCategory','warehouseId'];
                self::keys($row, $fields, $key);
                $source = self::text($row['sourceKey'] ?? '', 254, 'source reference');
                if (str_starts_with($source, 'email:')) $source = 'email:' . strtolower(substr($source, 6));
                $row['sourceKey'] = $source;
                self::need(!isset($seen[$source]), 'Each source reference can occur only once in its mapping table.'); $seen[$source] = true;
                if ($key === 'customerBindings') {
                    self::need(preg_match('/^(customer:[0-9]+|email:[^@\s]+@[^@\s]+)$/D', $source), 'Use customer:<Woo ID> or email:<approved billing email>.');
                    $row['customerId'] = self::text($row['customerId'] ?? '', 30, 'existing ERP customer ID');
                    $row['locationId'] = self::text($row['locationId'] ?? '', 30, 'customer location', true);
                } else {
                    self::need($key === 'feeBindings' ? str_starts_with($source, 'fee:') : preg_match('/^(product:[1-9][0-9]*|sku:.+)$/D', $source), 'Use a stable product, SKU or fee source reference.');
                    $row = array_merge($row, self::binding($row));
                }
                $normalized[] = $row;
            }
            $map[$key] = $normalized;
        }
        $map['shippingBinding'] = $raw['shippingBinding'] ?? null;
        if ($map['shippingBinding'] !== null) { self::keys($map['shippingBinding'], ['inventoryId','uom','taxCategory','warehouseId'], 'The shipping binding'); $map['shippingBinding'] = self::binding($map['shippingBinding']); }
        return self::canonical($map);
    }
    static function binding($row) {
        return ['inventoryId'=>self::text($row['inventoryId'] ?? '', 30, 'existing ERP inventory ID'),
            'uom'=>self::text($row['uom'] ?? '', 6, 'unit of measure'),
            'taxCategory'=>self::text($row['taxCategory'] ?? '', 10, 'tax category', true),
            'warehouseId'=>self::text($row['warehouseId'] ?? '', 30, 'warehouse', true)];
    }
    static function find($rows, $keys) {
        foreach ($keys as $key) foreach ($rows as $row) if ($row['sourceKey'] === $key) return $row;
        return null;
    }
    static function address($raw) {
        $result = [];
        foreach (['address_1'=>'AddressLine1','address_2'=>'AddressLine2','city'=>'City','country'=>'Country','postcode'=>'PostalCode','state'=>'State'] as $key=>$field) {
            $value = self::text((string) ($raw[$key] ?? ''), in_array($key, ['country','state'], true) ? 50 : 100, 'order address', true);
            $result[$field] = ['value'=>$value];
        }
        self::need($result['AddressLine1']['value'] !== '' && $result['Country']['value'] !== '', 'The selected address override requires a street and country.');
        return $result;
    }
    static function build($map, $source) {
        $d = Starforge_SF104_ERP_Decimal::class;
        self::need($source['currency'] === $map['currency'], 'The original order currency differs from the approved map.');
        self::need(in_array($source['status'], $map['admittedStatuses'], true), 'This Woo order state is outside the approved ERP admission states.');
        $customer = self::find($map['customerBindings'], ['customer:' . $source['customerId'], 'email:' . strtolower($source['billing']['email'] ?? '')]);
        self::need($customer !== null, 'Map this existing Woo customer or approved billing email to its ERP customer before preparing the order.');
        $external = $map['storeNamespace'] . '-' . $source['orderId'];
        self::need(strlen($external) <= 40, 'The original order reference exceeds the published CustomerOrder field.');
        $minor = $map['currencyDecimals']; $lines = []; $net = '0'; $discount = '0';
        foreach ($source['lines'] as $line) {
            if ($line['kind'] === 'product') {
                $binding = self::find($map['productBindings'], ['product:' . ($line['variationId'] !== '0' ? $line['variationId'] : $line['productId']), 'sku:' . $line['sku']]);
            } elseif ($line['kind'] === 'shipping') $binding = $map['shippingBinding'];
            else $binding = self::find($map['feeBindings'], ['fee:' . $line['name']]);
            self::need($binding !== null, 'Map original ' . $line['kind'] . ' line ' . $line['id'] . ' (' . $line['name'] . ') to its existing ERP inventory item.');
            $qty = $d::canonical($line['quantity']); self::need($qty !== '0', 'An original order line has zero quantity.');
            $subtotal = $d::units($line['subtotal'], $minor); $total = $d::units($line['total'], $minor);
            $line_discount = $d::sub($subtotal, $total); $net = $d::add($net, $total); $discount = $d::add($discount, $line_discount);
            $price = $d::price($line['subtotal'], $qty, $minor, $map['unitPriceDecimals']);
            $payload = ['ExternalRef'=>['value'=>'L-' . substr(hash('sha256', $external . ':' . $source['orderKeySha256'] . ':' . $line['kind'] . ':' . $line['id']), 0, 32)],
                'InventoryID'=>['value'=>$binding['inventoryId']], 'UOM'=>['value'=>$binding['uom']],
                'OrderQty'=>['value'=>$qty], 'UnitPrice'=>['value'=>$price], 'ManualPrice'=>['value'=>true],
                'ManualDiscount'=>['value'=>true], 'DiscountAmount'=>['value'=>$d::decimal($line_discount, $minor)],
                'CalculateDiscountsOnImport'=>['value'=>false]];
            if (($binding['taxCategory'] ?? '') !== '') $payload['TaxCategory'] = ['value'=>$binding['taxCategory']];
            if (($binding['warehouseId'] ?? '') !== '') $payload['WarehouseID'] = ['value'=>$binding['warehouseId']];
            if ($map['target']['taxZone'] !== '') $payload['TaxZone'] = ['value'=>$map['target']['taxZone']];
            $lines[] = ['sourceLineId'=>$line['kind'] . ':' . $line['id'], 'name'=>$line['name'], 'netMinor'=>$total,
                'subtotalMinor'=>$subtotal, 'sourceTax'=>$line['tax'], 'payload'=>$payload];
        }
        self::need(count($lines) > 0 && count($lines) <= 250, 'Select an order with between one and 250 mapped lines.');
        $tax = $d::units($source['totalTax'], $minor); $total = $d::units($source['total'], $minor);
        self::need($d::add($net, $tax) === $total, 'The original line, shipping, fee and tax totals do not reconcile to the Woo order total. Review the source order.');
        self::need($discount === $d::units($source['discountTotal'], $minor), 'The original line discounts do not reconcile to the Woo discount total.');
        $payload = ['OrderType'=>['value'=>$map['target']['orderType']], 'CustomerOrder'=>['value'=>$external],
            'ExternalRef'=>['value'=>$external . ':' . substr($source['orderKeySha256'], 0, 16)], 'CustomerID'=>['value'=>$customer['customerId']],
            'CurrencyID'=>['value'=>$map['currency']], 'Hold'=>['value'=>$map['target']['hold']],
            'Description'=>['value'=>self::text('WooCommerce order ' . $source['displayNumber'] . ' / ' . $map['storeNamespace'], 256, 'order description')],
            'DisableAutomaticDiscountUpdate'=>['value'=>true], 'DisableAutomaticTaxCalculation'=>['value'=>false],
            'ControlTotal'=>['value'=>$d::decimal($total, $minor)], 'Details'=>array_column($lines, 'payload'),
            'BillToAddressOverride'=>['value'=>false], 'ShipToAddressOverride'=>['value'=>false]];
        if (($customer['locationId'] ?? '') !== '') $payload['LocationID'] = ['value'=>$customer['locationId']];
        if ($map['target']['branch'] !== '') $payload['Branch'] = ['value'=>$map['target']['branch']];
        if ($map['addressMode'] === 'order_override') {
            $payload['BillToAddressOverride'] = ['value'=>true]; $payload['BillToAddress'] = self::address($source['billing']);
            $payload['ShipToAddressOverride'] = ['value'=>true];
            $shipping = ($source['shipping']['address_1'] ?? '') !== '' ? $source['shipping'] : $source['billing'];
            $payload['ShipToAddress'] = self::address($shipping);
        }
        $identity = $source; unset($identity['status'], $identity['observedAt'], $identity['siteUrl']);
        $plan = ['schema'=>self::PLAN_SCHEMA, 'mapId'=>self::digest($map), 'source'=>$source,
            'sourceSha256'=>self::digest($identity), 'externalReference'=>$external, 'lines'=>$lines,
            'expected'=>['currency'=>$map['currency'], 'currencyDecimals'=>$minor, 'netMinor'=>$net, 'taxMinor'=>$tax, 'totalMinor'=>$total, 'discountMinor'=>$discount],
            'target'=>$map['target'], 'payload'=>$payload, 'reviewOwner'=>$map['reviewOwner'],
            'rounding'=>'Unit price half-up at the approved precision; extended price must reproduce each source subtotal at currency precision. ERP calculates taxes; received totals are compared to the original Woo amounts.'];
        $plan['requestSha256'] = hash('sha256', self::wire_json($payload));
        return $plan;
    }
    /** Number tokens remain decimal text until emitted as JSON numbers. */
    static function wire_json($value, $parent = '') {
        if (is_array($value)) {
            if (in_array($parent, self::NUMBERS, true) && array_keys($value) === ['value']) {
                return '{"value":' . Starforge_SF104_ERP_Decimal::canonical($value['value']) . '}';
            }
            $list = !$value || array_keys($value) === range(0, count($value) - 1); $items = [];
            foreach ($value as $key=>$item) $items[] = ($list ? '' : wp_json_encode((string) $key) . ':') . self::wire_json($item, (string) $key);
            return ($list ? '[' : '{') . implode(',', $items) . ($list ? ']' : '}');
        }
        $json = wp_json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (!is_string($json)) throw new RuntimeException('The selected ERP request cannot be encoded.', 422);
        return $json;
    }
    /** Preserve numeric response lexemes before PHP's float conversion. */
    static function read_json($text) {
        $quoted = preg_replace_callback('/"(?:\\\\.|[^"\\\\])*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/s',
            static function ($m) { return $m[0][0] === '"' ? $m[0] : '"' . $m[0] . '"'; }, $text);
        $value = json_decode($quoted, true);
        if (json_last_error() !== JSON_ERROR_NONE) throw new RuntimeException('The ERP returned an invalid JSON document.', 422);
        return $value;
    }
    static function scalar($row, $key) { return is_array($row[$key] ?? null) ? ($row[$key]['value'] ?? null) : null; }
}
