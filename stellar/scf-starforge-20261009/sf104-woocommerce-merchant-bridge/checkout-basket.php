<?php
/** Exact multi-line digital orders, using the original checkout/order reservation. */
if (!defined('ABSPATH')) { exit; }

final class Starforge_SF104_Basket {
    const SCHEMA = 'stellar-forge.sf104.checkout-handoff.v2';
    const CATALOG_SCHEMA = 'stellar-forge.sf104.basket-catalog.v1';
    const ADMISSION_SCHEMA = 'stellar-forge.sf104.checkout-admission.v2';
    const MAX_LINES = 20;
    const MAX_UNITS = 100;
    const MAX_ATOMIC = '170141183460469231731687303715884105727';

    static function boot() {
        add_action('admin_post_sf104_basket_catalog', [__CLASS__, 'download_catalog']);
    }
    static function fields() {
        $url = wp_nonce_url(add_query_arg(['action' => 'sf104_basket_catalog'], admin_url('admin-post.php')), 'sf104_basket_catalog');
        return [
            'basket_section' => ['title' => 'Digital baskets', 'type' => 'title', 'description' =>
                'Combine approved simple virtual products into one exact Stellar payment. Each saved product mapping is a per-unit price including applicable store tax. Coupons, shipping and fees are excluded.'],
            'basket_enabled' => ['title' => 'Enable baskets', 'type' => 'checkbox', 'label' =>
                'Accept several mapped products or an integer quantity above one', 'default' => 'no'],
            'basket_product_ids' => ['title' => 'Approved product IDs', 'type' => 'text', 'description' =>
                'Comma-separated existing mapped product IDs, up to 64. All products must use the same store currency, Stellar network, asset and recipient.', 'default' => ''],
            'basket_route_id' => ['title' => 'Basket route ID', 'type' => 'text', 'description' =>
                'A distinct merchant route, for example digital-basket. Keep existing product route IDs separate.', 'default' => 'digital-basket'],
            'basket_url' => ['title' => 'Basket seller URL', 'type' => 'text', 'description' =>
                'Exact public HTTPS endpoint on the existing native seller, without query parameters.', 'default' => ''],
            'basket_method' => ['title' => 'Basket method', 'type' => 'select', 'options' => ['GET' => 'GET', 'HEAD' => 'HEAD'], 'default' => 'GET'],
            'basket_export' => ['title' => 'Native seller catalog', 'type' => 'title', 'description' =>
                'Save settings and the product mappings, then <a href="' . esc_url($url) . '">download this exact basket catalog</a>. Prepare the original seller with this file before accepting baskets. Retain earlier catalog exports for pending orders.'],
        ];
    }
    static function settings_saved() {
        $settings = get_option('woocommerce_sf104_native_settings', []);
        if (($settings['basket_enabled'] ?? 'no') !== 'yes') return;
        try {
            self::catalog();
            $settings['basket_approved_by'] = get_current_user_id();
            $settings['basket_approved_at'] = gmdate('Y-m-d\TH:i:s\Z');
            update_option('woocommerce_sf104_native_settings', $settings);
        } catch (Throwable $e) {
            if (class_exists('WC_Admin_Settings')) WC_Admin_Settings::add_error($e->getMessage());
        }
    }
    static function text($value) {
        $value = trim(wp_strip_all_tags((string) $value));
        $value = preg_replace('/[\x00-\x1f\x7f]/u', ' ', $value);
        if (!is_string($value) || $value === '') throw new RuntimeException('A mapped product or download has no usable name.');
        // Byte-bounded valid UTF-8, independent of the mbstring extension.
        while (strlen($value) > 240) $value = preg_replace('/.$/us', '', $value);
        return $value;
    }
    static function canonical($value) {
        if (is_array($value)) {
            if ($value === [] || array_keys($value) === range(0, count($value) - 1)) return array_map([__CLASS__, 'canonical'], $value);
            ksort($value, SORT_STRING);
            foreach ($value as $key => $entry) $value[$key] = self::canonical($entry);
        }
        return $value;
    }
    static function hash($value) {
        $json = wp_json_encode(self::canonical($value), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_LINE_TERMINATORS);
        if (!is_string($json)) throw new RuntimeException('The basket terms could not be encoded.');
        return hash('sha256', $json);
    }
    static function compare($a, $b) { return strlen($a) <=> strlen($b) ?: strcmp($a, $b); }
    static function integer($value) {
        if (!is_string($value) || !preg_match('/^(0|[1-9][0-9]*)$/D', $value)) throw new RuntimeException('Invalid exact integer amount.');
        return $value;
    }
    static function add($a, $b) {
        self::integer($a); self::integer($b);
        $i = strlen($a) - 1; $j = strlen($b) - 1; $carry = 0; $out = '';
        while ($i >= 0 || $j >= 0 || $carry) {
            $sum = ($i >= 0 ? (int) $a[$i--] : 0) + ($j >= 0 ? (int) $b[$j--] : 0) + $carry;
            $out = (string) ($sum % 10) . $out; $carry = intdiv($sum, 10);
        }
        return $out ?: '0';
    }
    static function multiply($value, $quantity) {
        self::integer($value);
        if (!is_int($quantity) || $quantity < 1 || $quantity > self::MAX_UNITS) throw new RuntimeException('Use an integer quantity between 1 and 100.');
        $carry = 0; $out = '';
        for ($i = strlen($value) - 1; $i >= 0; $i--) {
            $part = (int) $value[$i] * $quantity + $carry;
            $out = (string) ($part % 10) . $out; $carry = intdiv($part, 10);
        }
        return ($carry ? (string) $carry : '') . $out;
    }
    static function amount($value) {
        self::integer($value);
        if ($value === '0' || self::compare($value, self::MAX_ATOMIC) > 0) throw new RuntimeException('The basket amount exceeds the original native Stellar range.');
        return $value;
    }
    static function minor($value) {
        $value = Starforge_SF104_Checkout::decimal($value);
        $parts = explode('.', $value, 2);
        return ltrim($parts[0] . str_pad($parts[1] ?? '', 8, '0'), '0') ?: '0';
    }
    static function decimal($value) {
        self::integer($value);
        $value = str_pad($value, 9, '0', STR_PAD_LEFT);
        $fraction = rtrim(substr($value, -8), '0');
        return Starforge_SF104_Checkout::decimal(substr($value, 0, -8) . ($fraction === '' ? '' : '.' . $fraction));
    }
    static function quantity($value) {
        $value = (string) $value;
        if (!preg_match('/^[1-9][0-9]{0,2}$/D', $value) || (int) $value > self::MAX_UNITS) throw new RuntimeException('Use an integer quantity between 1 and 100.');
        return (int) $value;
    }
    static function catalog() {
        $settings = get_option('woocommerce_sf104_native_settings', []);
        if (($settings['basket_enabled'] ?? 'no') !== 'yes') throw new RuntimeException('Digital baskets are not enabled by this store.');
        $route = $settings['basket_route_id'] ?? '';
        if (!is_string($route) || !preg_match('/^[A-Za-z0-9_-]{1,64}$/D', $route)) throw new RuntimeException('Save a distinct basket route ID.');
        $url = Starforge_SF104_Checkout::seller_url($settings['basket_url'] ?? '');
        $method = $settings['basket_method'] ?? 'GET';
        if (!in_array($method, ['GET', 'HEAD'], true)) throw new RuntimeException('Use GET or HEAD for the basket endpoint.');
        $raw = $settings['basket_product_ids'] ?? '';
        if (!is_string($raw) || strlen($raw) > 1600 || !preg_match('/^[0-9,\s]+$/D', $raw)) throw new RuntimeException('Save the comma-separated approved product IDs.');
        $ids = preg_split('/[,\s]+/', trim($raw), -1, PREG_SPLIT_NO_EMPTY);
        if (!$ids || count($ids) > 64 || count(array_unique($ids)) !== count($ids)) throw new RuntimeException('Choose between 1 and 64 distinct mapped products.');
        usort($ids, [__CLASS__, 'compare']);
        $products = []; $identity = null;
        foreach ($ids as $id) {
            if (!preg_match('/^[1-9][0-9]{0,17}$/D', $id) || (string) (int) $id !== $id) throw new RuntimeException('Invalid approved product ID.');
            $product = wc_get_product((int) $id);
            $map = Starforge_SF104_Checkout::product_mapping($product);
            if ($map['routeId'] === $route || $map['url'] === $url) throw new RuntimeException('Use a basket endpoint and route ID distinct from the individual product routes.');
            $terms = [$map['storefront']['currency'], $map['network'], $map['asset'], $map['payTo']];
            if ($identity !== null && $terms !== $identity) throw new RuntimeException('Every basket product must use the same currency, network, asset and recipient.');
            $identity = $terms;
            $products[] = ['productId' => $id, 'name' => self::text($product->get_name()),
                'storefront' => $map['storefront'], 'expect' => ['scheme' => 'exact', 'network' => $map['network'],
                    'asset' => $map['asset'], 'payTo' => $map['payTo'], 'maxAtomic' => $map['amountAtomic'],
                    'maxTimeoutSeconds' => $map['maxTimeoutSeconds']]];
        }
        $catalog = ['schema' => self::CATALOG_SCHEMA, 'storeOrigin' => Starforge_SF104_Checkout::store_origin(),
            'routeId' => $route, 'url' => $url, 'method' => $method,
            'limits' => ['maxLines' => self::MAX_LINES, 'maxUnits' => self::MAX_UNITS], 'products' => $products];
        $catalog['catalogDigest'] = self::hash($catalog);
        return $catalog;
    }
    static function download_catalog() {
        if (!current_user_can('manage_woocommerce')) wp_die('Forbidden.', '', ['response' => 403]);
        check_admin_referer('sf104_basket_catalog');
        try { $catalog = self::catalog(); }
        catch (Throwable $e) { wp_die(esc_html($e->getMessage()), '', ['response' => 409]); }
        nocache_headers(); header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="stellar-basket-' . substr($catalog['catalogDigest'], 0, 16) . '.json"');
        header('X-Content-Type-Options: nosniff');
        echo wp_json_encode($catalog, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";
        exit;
    }
    static function needs_basket($items, $cart = false) {
        $settings = get_option('woocommerce_sf104_native_settings', []);
        if (($settings['basket_enabled'] ?? 'no') === 'yes') return true;
        if (count($items) !== 1) return true;
        $item = array_values($items)[0];
        return (string) ($cart ? ($item['quantity'] ?? '') : $item->get_quantity()) !== '1';
    }
    static function indexed($catalog) {
        if (!is_array($catalog) || ($catalog['schema'] ?? '') !== self::CATALOG_SCHEMA ||
            !is_array($catalog['products'] ?? null) || !is_string($catalog['catalogDigest'] ?? null)) throw new RuntimeException('The saved basket catalog is unavailable.');
        $body = $catalog; unset($body['catalogDigest']);
        if (!hash_equals(self::hash($body), $catalog['catalogDigest'])) throw new RuntimeException('The saved basket catalog has changed.');
        $products = [];
        foreach ($catalog['products'] as $p) $products[$p['productId']] = $p;
        return $products;
    }
    static function client_catalog() {
        $catalog = self::catalog(); $places = wc_get_price_decimals(); $products = [];
        if ($places < 0 || $places > 8) throw new RuntimeException('Unsupported store currency precision.');
        foreach ($catalog['products'] as $p) {
            $parts = explode('.', $p['storefront']['total'], 2); $fraction = $parts[1] ?? '';
            if (strlen($fraction) > $places) throw new RuntimeException('The unit price exceeds this store currency precision.');
            $products[] = ['productId' => $p['productId'], 'unitMinor' => ltrim($parts[0] . str_pad($fraction, $places, '0'), '0') ?: '0'];
        }
        return ['maxLines' => self::MAX_LINES, 'maxUnits' => self::MAX_UNITS,
            'currency' => $catalog['products'][0]['storefront']['currency'], 'products' => $products];
    }
    static function cart_mapping($cart) {
        if (!$cart || $cart->needs_shipping() || $cart->get_applied_coupons() || $cart->get_fees() ||
            Starforge_SF104_Checkout::decimal($cart->get_discount_total()) !== '0') throw new RuntimeException('Use mapped digital products without coupons, fees or shipping.');
        $catalog = self::catalog(); $products = self::indexed($catalog);
        $items = $cart->get_cart();
        if (!$items || count($items) > self::MAX_LINES) throw new RuntimeException('A digital basket supports up to 20 product lines.');
        $seen = []; $units = 0; $total = '0'; $quote = [];
        foreach ($items as $item) {
            $id = (string) ($item['product_id'] ?? ''); $q = self::quantity($item['quantity'] ?? '');
            if (isset($seen[$id]) || !isset($products[$id]) || !empty($item['variation_id'])) throw new RuntimeException('Each basket line must be a distinct approved simple product.');
            $seen[$id] = true; $units += $q;
            Starforge_SF104_Checkout::product_mapping($item['data'] ?? null);
            $p = $products[$id];
            $gross = self::add(self::minor($item['line_total']), self::minor($item['line_tax']));
            if ($p['storefront']['currency'] !== get_woocommerce_currency() ||
                self::minor($item['line_subtotal']) !== self::minor($item['line_total']) ||
                $gross !== self::multiply(self::minor($p['storefront']['total']), $q)) throw new RuntimeException('A basket line differs from its declared per-unit price including tax.');
            $total = self::add($total, $gross);
            $quote[] = ['productId' => $id, 'quantity' => (string) $q];
        }
        if ($units > self::MAX_UNITS || $total !== self::minor($cart->get_total('edit'))) throw new RuntimeException('The basket quantity or exact store total is unavailable.');
        return ['basket' => true, 'items' => $quote, 'catalog' => $catalog,
            'mapping' => ['storefront' => ['currency' => get_woocommerce_currency(), 'total' => self::decimal($total)]]];
    }
    static function delivery($product) {
        if (!$product || !$product->is_type('simple') || !$product->is_virtual()) throw new RuntimeException('A basket product is no longer an available simple virtual product.');
        $files = [];
        foreach ($product->get_downloads() as $id => $download) {
            if (count($files) >= 64) throw new RuntimeException('A product contains too many download definitions.');
            $files[] = ['id' => (string) $id, 'name' => self::text($download->get_name()),
                'file' => (string) $download->get_file()];
        }
        usort($files, static function ($a, $b) { return strcmp($a['id'], $b['id']); });
        return ['virtual' => true, 'downloadable' => (bool) $product->is_downloadable(), 'files' => $files,
            'limit' => (string) $product->get_download_limit(), 'expiry' => (string) $product->get_download_expiry()];
    }
    static function order_shape($order) {
        $items = $order->get_items('line_item');
        if (!$items || count($items) > self::MAX_LINES || $order->get_items('shipping') || $order->get_items('fee') ||
            $order->get_coupon_codes() || Starforge_SF104_Checkout::decimal($order->get_discount_total()) !== '0') throw new RuntimeException('The basket order lines, coupons, fees or shipping have changed.');
        $lines = []; $seen = []; $units = 0;
        foreach ($items as $item) {
            $id = (string) $item->get_product_id(); $q = self::quantity($item->get_quantity());
            if (isset($seen[$id]) || $item->get_variation_id() ||
                self::minor($item->get_subtotal()) !== self::minor($item->get_total()) ||
                self::minor($item->get_subtotal_tax()) !== self::minor($item->get_total_tax())) throw new RuntimeException('A basket line identity, quantity or discount has changed.');
            $seen[$id] = true; $units += $q;
            $lines[] = ['lineId' => (string) $item->get_id(), 'productId' => $id, 'quantity' => (string) $q,
                'name' => self::text($item->get_name()), 'total' => self::decimal(self::minor($item->get_total())),
                'tax' => self::decimal(self::minor($item->get_total_tax())), 'delivery' => self::delivery($item->get_product())];
        }
        if ($units > self::MAX_UNITS) throw new RuntimeException('A basket supports at most 100 units.');
        usort($lines, static function ($a, $b) { return self::compare($a['lineId'], $b['lineId']); });
        return ['items' => $lines, 'currency' => Starforge_SF104_Checkout::currency($order->get_currency()),
            'total' => Starforge_SF104_Checkout::decimal($order->get_total()),
            'orderTax' => Starforge_SF104_Checkout::decimal($order->get_total_tax())];
    }
    static function handoff($order, $catalog, $created_at) {
        $products = self::indexed($catalog); $shape = self::order_shape($order);
        if ($catalog['storeOrigin'] !== Starforge_SF104_Checkout::store_origin()) throw new RuntimeException('The basket belongs to a different store origin.');
        $amount = '0'; $store = '0'; $tax = '0'; $timeout = 86400; $items = []; $identity = null;
        foreach ($shape['items'] as $line) {
            $p = $products[$line['productId']] ?? null;
            if (!$p || $shape['currency'] !== $p['storefront']['currency']) throw new RuntimeException('A basket product is outside its saved catalog.');
            $q = (int) $line['quantity'];
            $line_store = self::add(self::minor($line['total']), self::minor($line['tax']));
            $line_amount = self::amount(self::multiply($p['expect']['maxAtomic'], $q));
            if ($line_store !== self::multiply(self::minor($p['storefront']['total']), $q)) throw new RuntimeException('A saved basket line no longer has its declared exact price including tax.');
            $id = [$p['expect']['scheme'], $p['expect']['network'], $p['expect']['asset'], $p['expect']['payTo']];
            if ($identity !== null && $identity !== $id) throw new RuntimeException('A basket requires one exact native payment identity.');
            $identity = $id; $amount = self::add($amount, $line_amount); $store = self::add($store, $line_store);
            $tax = self::add($tax, self::minor($line['tax'])); $timeout = min($timeout, $p['expect']['maxTimeoutSeconds']);
            $items[] = ['lineId' => $line['lineId'], 'productId' => $line['productId'], 'quantity' => $line['quantity'],
                'name' => $line['name'], 'unitStoreTotal' => $p['storefront']['total'], 'lineStoreTotal' => self::decimal($line_store),
                'unitAmountAtomic' => $p['expect']['maxAtomic'], 'lineAmountAtomic' => $line_amount,
                'maxTimeoutSeconds' => $p['expect']['maxTimeoutSeconds'],
                'downloads' => $line['delivery']['downloadable'] ? array_column($line['delivery']['files'], 'name') : []];
        }
        if ($store !== self::minor($shape['total']) || $tax !== self::minor($shape['orderTax'])) throw new RuntimeException('The basket aggregate, tax or order total has changed.');
        $expect = ['scheme' => $identity[0], 'network' => $identity[1], 'asset' => $identity[2], 'payTo' => $identity[3],
            'maxAtomic' => self::amount($amount), 'maxTimeoutSeconds' => $timeout];
        $reference = (string) $order->get_id();
        $terms = ['storeOrigin' => $catalog['storeOrigin'], 'orderReference' => $reference,
            'catalogDigest' => $catalog['catalogDigest'], 'routeId' => $catalog['routeId'],
            'storefront' => ['currency' => $shape['currency'], 'total' => $shape['total']], 'items' => $items,
            'resource' => ['url' => $catalog['url'], 'method' => $catalog['method']], 'expect' => $expect];
        $digest = self::hash($terms);
        $handoff = ['schema' => self::SCHEMA, 'storeOrigin' => $catalog['storeOrigin'], 'orderReference' => $reference,
            'attemptGeneration' => 1, 'catalogDigest' => $catalog['catalogDigest'], 'basketDigest' => $digest,
            'routeId' => $catalog['routeId'], 'createdAt' => $created_at, 'storefront' => $terms['storefront'], 'items' => $items,
            'operation' => ['url' => $catalog['url'] . '?sf98_order=' . $reference . '&sf104_attempt=1&sf104_basket=' . $digest,
                'method' => $catalog['method'], 'expect' => $expect, 'orderReference' => $reference]];
        $encoded = wp_json_encode($handoff, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        // Reserve room for the same order's maximum later attempt generation.
        if (!is_string($encoded) || strlen($encoded) + 32 > 65536) throw new RuntimeException('This basket exceeds the original buyer instruction size; reduce the product lines or download labels.');
        return $handoff;
    }
    static function record($order) {
        $catalog = self::catalog(); $handoff = self::handoff($order, $catalog, gmdate('Y-m-d\TH:i:s\Z'));
        $settings = get_option('woocommerce_sf104_native_settings', []);
        $terms = $handoff['operation']['expect'];
        $binding = ['approved' => 'YES', 'routeId' => $handoff['routeId'], 'method' => $handoff['operation']['method'],
            'network' => $terms['network'], 'amountAtomic' => $terms['maxAtomic'], 'assetDigest' => hash('sha256', $terms['asset']),
            'recipientDigest' => hash('sha256', $terms['payTo']), 'approvedBy' => (int) ($settings['basket_approved_by'] ?? 0),
            'approvedAt' => $settings['basket_approved_at'] ?? $handoff['createdAt']];
        $record = ['handoff' => $handoff, 'binding' => $binding, 'shape' => self::order_shape($order), 'catalog' => $catalog];
        $record['digest'] = Starforge_SF104_Checkout::digest($record); return $record;
    }
    static function validate_snapshot($order, $record) {
        if (!isset($record['catalog']) || self::handoff($order, $record['catalog'], $record['handoff']['createdAt']) !== $record['handoff']) {
            throw new RuntimeException('The frozen basket terms differ from this order.');
        }
    }
    static function payload_ok($p) {
        if (!is_array($p) || ($p['schema'] ?? '') !== self::ADMISSION_SCHEMA ||
            !in_array($p['phase'] ?? '', ['quote', 'inspect', 'reserve'], true)) return false;
        $fields = ['schema', 'phase', 'orderReference', 'attemptGeneration', 'routeId', 'resourceUrl', 'basketDigest'];
        if ($p['phase'] !== 'quote') $fields = array_merge($fields, ['catalogDigest', 'method', 'network', 'amountAtomic', 'assetDigest', 'recipientDigest']);
        if ($p['phase'] === 'reserve') $fields[] = 'attemptDigest';
        $keys = array_keys($p); sort($keys); sort($fields);
        if ($keys !== $fields || !is_string($p['orderReference']) || !preg_match('/^[1-9][0-9]{0,17}$/D', $p['orderReference']) ||
            (string) (int) $p['orderReference'] !== $p['orderReference'] ||
            !is_int($p['attemptGeneration']) || $p['attemptGeneration'] < 1 || $p['attemptGeneration'] > 2147483647 ||
            !is_string($p['routeId']) || !preg_match('/^[A-Za-z0-9_-]{1,64}$/D', $p['routeId']) ||
            !is_string($p['resourceUrl']) || strlen($p['resourceUrl']) > 2048) return false;
        foreach (['basketDigest', 'catalogDigest', 'assetDigest', 'recipientDigest', 'attemptDigest'] as $field) {
            if (array_key_exists($field, $p) && (!is_string($p[$field]) || !preg_match('/^[a-f0-9]{64}$/D', $p[$field]))) return false;
        }
        return $p['phase'] === 'quote' || (in_array($p['method'], ['GET', 'HEAD'], true) &&
            in_array($p['network'], ['stellar:testnet', 'stellar:pubnet'], true) && Starforge_SF98_Woo::amount_ok($p['amountAtomic']));
    }
    static function matches($p, $record, $h) {
        if ($h['schema'] !== self::SCHEMA || $p['attemptGeneration'] !== $h['attemptGeneration']) return false;
        $expected = ['orderReference' => $h['orderReference'], 'routeId' => $h['routeId'],
            'resourceUrl' => $h['operation']['url'], 'basketDigest' => $h['basketDigest']];
        if ($p['phase'] !== 'quote') {
            $b = $record['binding'];
            $expected += ['catalogDigest' => $h['catalogDigest'], 'method' => $b['method'], 'network' => $b['network'],
                'amountAtomic' => $b['amountAtomic'], 'assetDigest' => $b['assetDigest'], 'recipientDigest' => $b['recipientDigest']];
        }
        foreach ($expected as $key => $value) if (!hash_equals($value, $p[$key])) return false;
        return true;
    }
    static function quote_response($handoff) {
        $response = new WP_REST_Response(['schema' => 'stellar-forge.sf104.checkout-basket-quote.v1', 'status' => 'READY',
            'orderReference' => $handoff['orderReference'], 'handoff' => $handoff], 200);
        $response->header('Cache-Control', 'no-store'); return $response;
    }
    static function render_summary($handoff) {
        if (($handoff['schema'] ?? '') !== self::SCHEMA) return;
        echo '<h3>Items in this payment</h3><table class="shop_table"><thead><tr><th>Product</th><th>Quantity</th><th>Store total</th><th>Atomic amount</th></tr></thead><tbody>';
        foreach ($handoff['items'] as $line) {
            echo '<tr><td>' . esc_html($line['name']) . '</td><td>' . esc_html($line['quantity']) . '</td><td>' .
                esc_html($handoff['storefront']['currency'] . ' ' . $line['lineStoreTotal']) . '</td><td>' .
                esc_html($line['lineAmountAtomic']) . '</td></tr>';
        }
        echo '</tbody></table><p>One payment covers these exact items. The store releases each product through the original order after settlement review.</p>';
    }
}
Starforge_SF104_Basket::boot();

