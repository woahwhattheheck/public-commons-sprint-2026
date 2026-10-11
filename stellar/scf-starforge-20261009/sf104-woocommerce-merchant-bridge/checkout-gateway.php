<?php
/** Optional Woo checkout entrypoint. The original SF98 receiver owns fulfillment. */
if (!defined('ABSPATH')) { exit; }

final class Starforge_SF104_Checkout {
    const ID = 'sf104_native';
    const PRODUCT_META = '_sf104_native_product';
    const SNAPSHOT_META = '_sf104_checkout_snapshot';
    const HANDOFF_SCHEMA = 'stellar-forge.sf104.checkout-handoff.v1';

    static function boot() {
        add_action('plugins_loaded', [__CLASS__, 'register_gateway'], 20);
        add_action('woocommerce_product_options_general_product_data', [__CLASS__, 'product_fields']);
        add_action('woocommerce_admin_process_product_object', [__CLASS__, 'save_product']);
        add_action('woocommerce_thankyou_' . self::ID, [__CLASS__, 'order_page']);
        add_action('woocommerce_view_order', [__CLASS__, 'order_page'], 20);
        add_action('admin_post_sf104_handoff', [__CLASS__, 'download']);
        add_action('admin_post_nopriv_sf104_handoff', [__CLASS__, 'download']);
        add_action('admin_post_sf104_route', [__CLASS__, 'download_route']);
        add_action('template_redirect', [__CLASS__, 'private_page_headers']);
        add_action('woocommerce_blocks_payment_method_type_registration', [__CLASS__, 'register_blocks']);
    }

    static function decimal($value) {
        $value = (string) $value;
        if (!preg_match('/^(0|[1-9][0-9]{0,17})(?:\.[0-9]{1,8})?$/D', $value)) {
            throw new RuntimeException('The store total must be an ordinary decimal amount.');
        }
        if (strpos($value, '.') !== false) $value = rtrim(rtrim($value, '0'), '.');
        return $value;
    }

    static function currency($value) {
        if (!is_string($value) || !preg_match('/^[A-Z][A-Z0-9]{2,7}$/D', $value)) {
            throw new RuntimeException('The store currency is invalid.');
        }
        return $value;
    }

    static function seller_url($value, $base = true) {
        if (!is_string($value) || strlen($value) > 2048 || preg_match('/[^\x21-\x7e]|[\\\\]/', $value)) {
            throw new RuntimeException('Use the exact HTTPS seller resource URL.');
        }
        $p = wp_parse_url($value);
        $host = is_array($p) ? strtolower($p['host'] ?? '') : '';
        if (!is_array($p) || ($p['scheme'] ?? '') !== 'https' ||
            isset($p['user']) || isset($p['pass']) || isset($p['fragment']) ||
            (isset($p['port']) && $p['port'] !== 443) ||
            strlen($host) > 253 || !preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/D', $host) ||
            filter_var($host, FILTER_VALIDATE_IP) ||
            preg_match('/(?:^|\.)(?:localhost|local|localdomain|internal|home\.arpa)$/D', $host)) {
            throw new RuntimeException('Use an HTTPS resource on the merchant public hostname and port 443.');
        }
        $path = $p['path'] ?? '/';
        if ($path === '') $path = '/';
        if ($path[0] !== '/' || preg_match('/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i', $path)) {
            throw new RuntimeException('The seller resource path is invalid.');
        }
        if (preg_match('/%(?![0-9a-f]{2})/i', $path)) throw new RuntimeException('Use valid percent encoding in the seller path.');
        foreach (explode('/', $path) as $segment) {
            $decoded = rawurldecode($segment);
            if (in_array($decoded, ['.', '..'], true) || str_contains($decoded, '/') || str_contains($decoded, '\\')) {
                throw new RuntimeException('Use the canonical seller resource path without dot or encoded slash segments.');
            }
        }
        if ($base && isset($p['query'])) throw new RuntimeException('Use the fixed seller resource URL without a query; checkout adds the actual order.');
        return 'https://' . $host . $path . (isset($p['query']) && $p['query'] !== '' ? '?' . $p['query'] : '');
    }

    static function store_origin() {
        $url = self::seller_url(home_url('/'), false);
        return 'https://' . wp_parse_url($url, PHP_URL_HOST);
    }

    static function mapping($value) {
        if (!is_array($value) || ($value['enabled'] ?? '') !== 'yes') {
            throw new RuntimeException('This product has no enabled Stellar checkout mapping.');
        }
        $amount = $value['amountAtomic'] ?? null;
        $asset = $value['asset'] ?? null;
        $pay_to = $value['payTo'] ?? null;
        $timeout = $value['maxTimeoutSeconds'] ?? null;
        if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/D', (string) ($value['routeId'] ?? '')) ||
            !in_array($value['method'] ?? null, ['GET', 'HEAD'], true) ||
            !in_array($value['network'] ?? null, ['stellar:testnet', 'stellar:pubnet'], true) ||
            !Starforge_SF98_Woo::amount_ok($amount) ||
            !is_string($asset) || !preg_match('/^C[A-Z2-7]{55}$/D', $asset) ||
            !is_string($pay_to) || !preg_match('/^[GC][A-Z2-7]{55}$/D', $pay_to) ||
            !is_int($timeout) || $timeout < 1 || $timeout > 86400 ||
            !is_int($value['approvedBy'] ?? null) || $value['approvedBy'] < 1 ||
            !is_string($value['approvedAt'] ?? null)) {
            throw new RuntimeException('Complete the exact seller route, Stellar asset, recipient, atomic amount and timeout.');
        }
        $total = self::decimal($value['storefront']['total'] ?? '');
        if ($total === '0') throw new RuntimeException('A Stellar checkout mapping needs a positive store total.');
        return [
            'enabled' => 'yes', 'routeId' => $value['routeId'],
            'url' => self::seller_url($value['url'] ?? ''), 'method' => $value['method'],
            'network' => $value['network'], 'asset' => $asset, 'payTo' => $pay_to,
            'amountAtomic' => $amount, 'maxTimeoutSeconds' => $timeout,
            'storefront' => ['currency' => self::currency($value['storefront']['currency'] ?? ''), 'total' => $total],
            'approvedBy' => $value['approvedBy'], 'approvedAt' => $value['approvedAt'],
        ];
    }

    static function product_mapping($product) {
        if (!$product || !$product->is_type('simple') || !$product->is_virtual()) {
            throw new RuntimeException('Stellar checkout supports one simple virtual product at quantity one.');
        }
        return self::mapping($product->get_meta(self::PRODUCT_META, true));
    }

    static function route_declaration($product) {
        $m = self::product_mapping($product);
        return ['productId' => (string) $product->get_id(), 'routeId' => $m['routeId'],
            'url' => $m['url'], 'method' => $m['method'],
            'expect' => ['scheme' => 'exact', 'network' => $m['network'], 'asset' => $m['asset'],
                'payTo' => $m['payTo'], 'maxAtomic' => $m['amountAtomic'], 'maxTimeoutSeconds' => $m['maxTimeoutSeconds']],
            'description' => 'Digital checkout for ' . wp_strip_all_tags($product->get_name())];
    }

    static function download_route() {
        $id = isset($_GET['product_id']) && is_string($_GET['product_id']) ? wp_unslash($_GET['product_id']) : '';
        if (!preg_match('/^[1-9][0-9]{0,17}$/D', $id) || !current_user_can('manage_woocommerce') ||
            !current_user_can('edit_post', (int) $id)) wp_die('Forbidden.', '', ['response' => 403]);
        check_admin_referer('sf104_route_' . $id);
        try { $json = wp_json_encode(self::route_declaration(wc_get_product((int) $id)), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n"; }
        catch (Throwable $e) { wp_die(esc_html($e->getMessage()), '', ['response' => 409]); }
        nocache_headers();
        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="stellar-product-' . $id . '-route.json"');
        header('X-Content-Type-Options: nosniff');
        echo $json;
        exit;
    }

    static function cart_mapping() {
        $cart = function_exists('WC') && WC() ? WC()->cart : null;
        if (!$cart || count($cart->get_cart()) !== 1 || $cart->needs_shipping() ||
            $cart->get_applied_coupons() || $cart->get_fees()) {
            throw new RuntimeException('Use a single mapped digital item without coupons, fees or shipping.');
        }
        $item = array_values($cart->get_cart())[0];
        if ((string) ($item['quantity'] ?? '') !== '1' || !empty($item['variation_id'])) {
            throw new RuntimeException('Use quantity one of the mapped simple product.');
        }
        $mapping = self::product_mapping($item['data'] ?? null);
        if ($mapping['storefront']['currency'] !== get_woocommerce_currency() ||
            $mapping['storefront']['total'] !== self::decimal($cart->get_total('edit')) ||
            self::decimal($cart->get_discount_total()) !== '0') {
            throw new RuntimeException('The checkout total has changed from the merchant Stellar price mapping.');
        }
        return ['productId' => (string) $item['product_id'], 'mapping' => $mapping];
    }

    // Uses the actual order line, never current product pricing, for restart/drift checks.
    static function order_shape($order) {
        $items = $order->get_items('line_item');
        if (count($items) !== 1 || $order->get_items('shipping') || $order->get_items('fee') ||
            $order->get_coupon_codes() || self::decimal($order->get_discount_total()) !== '0') {
            throw new RuntimeException('The order must contain one item without coupons, fees or shipping.');
        }
        $item = array_values($items)[0];
        if ((string) $item->get_quantity() !== '1' || $item->get_variation_id() ||
            self::decimal($item->get_subtotal()) !== self::decimal($item->get_total())) {
            throw new RuntimeException('The order quantity, product or discount has changed.');
        }
        return [
            'productId' => (string) $item->get_product_id(), 'quantity' => '1',
            'currency' => self::currency($order->get_currency()), 'total' => self::decimal($order->get_total()),
            'lineTotal' => self::decimal($item->get_total()), 'lineTax' => self::decimal($item->get_total_tax()),
            'orderTax' => self::decimal($order->get_total_tax()),
        ];
    }

    static function digest($value) {
        $json = wp_json_encode($value, JSON_UNESCAPED_SLASHES);
        if (!is_string($json)) throw new RuntimeException('The order snapshot could not be encoded.');
        return hash('sha256', $json);
    }

    static function with_order_lock($order_id, $callback) {
        global $wpdb;
        $key = 'sf104:' . substr(hash('sha256', $wpdb->prefix . ':' . (string) $order_id), 0, 56);
        if ((string) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 0)', $key)) !== '1') {
            throw new RuntimeException('This order is being processed. Reopen this same order shortly.');
        }
        try { return $callback(); }
        finally { $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $key)); }
    }

    static function event_for_order($order_id) {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . Starforge_SF98_Woo::table() . ' WHERE order_id=%d', $order_id));
        if ($wpdb->last_error) throw new RuntimeException('The merchant settlement journal is unavailable.', 503);
        return $row;
    }

    static function binding_matches($actual, $expected) {
        if (!is_array($actual) || ($actual['approved'] ?? '') !== 'YES') return false;
        foreach (['routeId', 'method', 'network', 'amountAtomic', 'assetDigest', 'recipientDigest'] as $key) {
            if (!is_string($actual[$key] ?? null) || !hash_equals($expected[$key], $actual[$key])) return false;
        }
        return true;
    }

    static function snapshot($order, $require_binding = true) {
        $record = $order->get_meta(self::SNAPSHOT_META, true);
        if (!is_array($record) || !is_array($record['handoff'] ?? null) ||
            !is_array($record['binding'] ?? null) || !is_array($record['shape'] ?? null) ||
            !is_string($record['digest'] ?? null)) {
            throw new RuntimeException('This order has no completed Stellar checkout snapshot.');
        }
        $digest = $record['digest'];
        $content = $record;
        unset($content['digest']);
        if (!hash_equals($digest, self::digest($content)) ||
            $record['handoff']['schema'] !== self::HANDOFF_SCHEMA ||
            $record['handoff']['orderReference'] !== (string) $order->get_id() ||
            $order->get_payment_method() !== self::ID ||
            $record['shape'] !== self::order_shape($order) ||
            ($require_binding && !self::binding_matches($order->get_meta(Starforge_SF98_Woo::META_READY, true), $record['binding']))) {
            throw new RuntimeException('The order or approved payment binding differs from its saved checkout.');
        }
        return $record;
    }

    // Product and order terms stay immutable. Only an audited merchant reset can
    // advance the available attempt and therefore the original buyer intent.
    static function available_handoff($order, $record) {
        Starforge_SF104_Admission::assert_available($order, false);
        $attempt = Starforge_SF104_Admission::row($order->get_id());
        if ($attempt && $attempt->state !== 'RESET') {
            throw new RuntimeException('This order already has a payment attempt awaiting reconciliation.', 409);
        }
        $generation = $attempt ? (int) $attempt->generation : 1;
        if ($generation < 1 || $generation > 2147483647) {
            throw new RuntimeException('The order attempt generation is unavailable.', 409);
        }
        $handoff = $record['handoff'];
        $base = self::seller_url(explode('?', $handoff['operation']['url'], 2)[0]);
        $handoff['attemptGeneration'] = $generation;
        $handoff['operation']['url'] = $base . '?sf98_order=' . $handoff['orderReference'] . '&sf104_attempt=' . $generation;
        return $handoff;
    }

    static function prepare_order($order_id) {
        return self::with_order_lock($order_id, static function () use ($order_id) {
            $order = wc_get_order($order_id);
            if (!$order || $order->get_payment_method() !== self::ID ||
                !in_array($order->get_status(), ['pending', 'on-hold', 'checkout-draft'], true) ||
                $order->is_paid() || $order->get_transaction_id() || self::event_for_order($order_id)) {
                throw new RuntimeException('This order is no longer awaiting a new Stellar payment.');
            }
            $record = $order->get_meta(self::SNAPSHOT_META, true);
            if ($record) {
                $record = self::snapshot($order, false);
            } else {
                if ($order->get_meta(Starforge_SF98_Woo::META_READY, true)) {
                    throw new RuntimeException('This order already has a separate merchant payment binding.');
                }
                $shape = self::order_shape($order);
                $item = array_values($order->get_items('line_item'))[0];
                $map = self::product_mapping($item->get_product());
                if ($shape['currency'] !== $map['storefront']['currency'] || $shape['total'] !== $map['storefront']['total']) {
                    throw new RuntimeException('The order total differs from the merchant Stellar price mapping.');
                }
                $reference = (string) $order_id;
                $url = $map['url'] . '?sf98_order=' . $reference . '&sf104_attempt=1';
                $binding = [
                    'approved' => 'YES', 'routeId' => $map['routeId'], 'method' => $map['method'],
                    'network' => $map['network'], 'amountAtomic' => $map['amountAtomic'],
                    'assetDigest' => hash('sha256', $map['asset']), 'recipientDigest' => hash('sha256', $map['payTo']),
                    'approvedBy' => $map['approvedBy'], 'approvedAt' => $map['approvedAt'],
                ];
                $handoff = [
                    'schema' => self::HANDOFF_SCHEMA, 'storeOrigin' => self::store_origin(),
                    'orderReference' => $reference, 'productId' => $shape['productId'], 'attemptGeneration' => 1,
                    'routeId' => $map['routeId'], 'createdAt' => gmdate('Y-m-d\TH:i:s\Z'),
                    'storefront' => $map['storefront'],
                    'operation' => ['url' => $url, 'method' => $map['method'],
                        'expect' => ['scheme' => 'exact', 'network' => $map['network'], 'asset' => $map['asset'],
                            'payTo' => $map['payTo'], 'maxAtomic' => $map['amountAtomic'],
                            'maxTimeoutSeconds' => $map['maxTimeoutSeconds']], 'orderReference' => $reference],
                ];
                $record = ['handoff' => $handoff, 'binding' => $binding, 'shape' => $shape];
                $record['digest'] = self::digest($record);
                // Save the immutable record first. A crash can repair the original binding from this same record.
                $order->update_meta_data(self::SNAPSHOT_META, $record);
                $order->save();
            }
            $binding = $order->get_meta(Starforge_SF98_Woo::META_READY, true);
            if ($binding && !self::binding_matches($binding, $record['binding'])) {
                throw new RuntimeException('The merchant payment binding changed; contact the store with this order.');
            }
            if (!$binding) {
                $order->update_meta_data(Starforge_SF98_Woo::META_READY, $record['binding']);
                $order->save();
                $order->add_order_note('Stellar checkout terms saved from the approved digital-product mapping. Awaiting original native payment and merchant settlement review.');
            }
            // Ordinary Woo pay-for-order must not offer another gateway while
            // the customer is authorizing this native payment attempt.
            if ($order->get_status() !== 'on-hold') $order->update_status('on-hold', 'Awaiting the original Stellar payment and independent merchant settlement review.');
            return self::available_handoff($order, $record);
        });
    }

    static function can_read($order) {
        if (!$order) return false;
        if (current_user_can('manage_woocommerce')) return true;
        $owner = (int) $order->get_customer_id();
        if ($owner > 0) return get_current_user_id() > 0 && get_current_user_id() === $owner;
        $key = isset($_GET['key']) && is_string($_GET['key']) ? wp_unslash($_GET['key']) : '';
        return $key !== '' && hash_equals((string) $order->get_order_key(), $key);
    }

    static function private_page_headers() {
        if (function_exists('is_wc_endpoint_url') && (is_wc_endpoint_url('order-received') || is_wc_endpoint_url('view-order'))) {
            nocache_headers();
            header('Referrer-Policy: no-referrer');
        }
    }

    static function download() {
        $id = isset($_GET['order_id']) && is_string($_GET['order_id']) ? wp_unslash($_GET['order_id']) : '';
        if (!preg_match('/^[1-9][0-9]{0,17}$/D', $id)) wp_die('Order not found.', '', ['response' => 404]);
        $order = wc_get_order((int) $id);
        if (!self::can_read($order)) wp_die('Order not found.', '', ['response' => 404]);
        try {
            $record = self::snapshot($order);
            $json = wp_json_encode(self::available_handoff($order, $record), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
        } catch (Throwable $e) { wp_die(esc_html($e->getMessage()), '', ['response' => 409]); }
        nocache_headers();
        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="stellar-order-' . $id . '.json"');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        echo $json;
        exit;
    }

    static function order_page($order_id) {
        $order = wc_get_order($order_id);
        if (!$order || $order->get_payment_method() !== self::ID || !self::can_read($order)) return;
        echo '<section class="woocommerce-order-details"><h2>Stellar payment</h2>';
        if ($order->is_paid()) {
            echo '<p>The store has confirmed this order. Use the order downloads and fulfillment details above.</p></section>';
            return;
        }
        try {
            $record = self::snapshot($order);
            $h = self::available_handoff($order, $record);
            $link = add_query_arg(['action' => 'sf104_handoff', 'order_id' => (string) $order_id,
                'key' => $order->get_order_key()], admin_url('admin-post.php'));
            echo '<p>Your order is awaiting payment. Download its payment instructions, then use Stellar Forge to review and authorize the exact merchant payment.</p>';
            echo '<p><strong>' . esc_html($h['operation']['expect']['maxAtomic']) . ' atomic units</strong> on ' . esc_html($h['operation']['expect']['network']) . '.</p>';
            echo '<p><a class="button" rel="noreferrer" href="' . esc_url($link) . '">Download payment instructions</a></p>';
            echo '<p>The same order retains the same payment terms. If payment was already attempted, resume that existing operation before starting another. The store will release your product after confirming settlement.</p>';
        } catch (Throwable $e) {
            echo '<p>' . esc_html($e->getMessage()) . '</p><p>Keep this order number and resume your existing buyer operation or contact the store.</p>';
        }
        echo '</section>';
    }

    static function product_fields() {
        global $product_object;
        if (!current_user_can('manage_woocommerce')) return;
        $m = $product_object ? $product_object->get_meta(self::PRODUCT_META, true) : [];
        if (!is_array($m)) $m = [];
        echo '<div class="options_group show_if_simple"><h4 style="padding-left:12px">Stellar digital-product checkout</h4>';
        echo '<p class="form-field">Map the exact final store total to the original merchant route and fixed atomic price. Use a simple virtual product at quantity one.</p>';
        wp_nonce_field('sf104_product_mapping', '_sf104_mapping_nonce', false);
        echo '<input type="hidden" name="_sf104_mapping_present" value="1">';
        woocommerce_wp_checkbox(['id' => '_sf104_enabled', 'label' => 'Enable Stellar mapping', 'value' => $m['enabled'] ?? 'no']);
        $fields = [
            'total' => ['Final store total (' . get_woocommerce_currency() . ')', $m['storefront']['total'] ?? ''],
            'url' => ['Seller resource URL', $m['url'] ?? ''],
            'routeId' => ['Seller route ID', $m['routeId'] ?? ''],
            'asset' => ['Stellar asset contract', $m['asset'] ?? ''],
            'payTo' => ['Stellar recipient', $m['payTo'] ?? ''],
            'amountAtomic' => ['Atomic Stellar amount', $m['amountAtomic'] ?? ''],
            'maxTimeoutSeconds' => ['Maximum timeout (seconds)', $m['maxTimeoutSeconds'] ?? 300],
        ];
        foreach ($fields as $key => $field) woocommerce_wp_text_input(['id' => '_sf104_' . $key, 'label' => $field[0], 'value' => $field[1]]);
        woocommerce_wp_select(['id' => '_sf104_method', 'label' => 'Method', 'value' => $m['method'] ?? 'GET', 'options' => ['GET' => 'GET', 'HEAD' => 'HEAD']]);
        woocommerce_wp_select(['id' => '_sf104_network', 'label' => 'Network', 'value' => $m['network'] ?? 'stellar:testnet',
            'options' => ['stellar:testnet' => 'Stellar testnet', 'stellar:pubnet' => 'Stellar public network']]);
        if ($product_object && ($m['enabled'] ?? '') === 'yes') {
            $id = (string) $product_object->get_id();
            $export = wp_nonce_url(add_query_arg(['action' => 'sf104_route', 'product_id' => $id], admin_url('admin-post.php')), 'sf104_route_' . $id);
            echo '<p class="form-field"><a class="button" href="' . esc_url($export) . '">Download saved merchant route</a></p>';
        }
        echo '<p class="form-field">The store currency and final total are an explicit merchant price mapping. Product edits apply to new orders; saved orders retain their original terms.</p></div>';
    }

    static function save_product($product) {
        if (empty($_POST['_sf104_mapping_present']) || !current_user_can('manage_woocommerce') ||
            !current_user_can('edit_post', $product->get_id()) ||
            !isset($_POST['_sf104_mapping_nonce']) || !is_string($_POST['_sf104_mapping_nonce']) ||
            !wp_verify_nonce(wp_unslash($_POST['_sf104_mapping_nonce']), 'sf104_product_mapping')) return;
        if (empty($_POST['_sf104_enabled'])) { $product->delete_meta_data(self::PRODUCT_META); return; }
        $read = static function ($key) {
            $value = $_POST['_sf104_' . $key] ?? '';
            return is_string($value) ? trim(wp_unslash($value)) : '';
        };
        try {
            if (!$product->is_type('simple') || !$product->is_virtual()) throw new RuntimeException('Select a simple virtual product before enabling Stellar checkout.');
            $timeout = $read('maxTimeoutSeconds');
            $map = self::mapping([
                'enabled' => 'yes', 'routeId' => $read('routeId'), 'url' => $read('url'), 'method' => $read('method'),
                'network' => $read('network'), 'asset' => $read('asset'), 'payTo' => $read('payTo'),
                'amountAtomic' => $read('amountAtomic'), 'maxTimeoutSeconds' => ctype_digit($timeout) ? (int) $timeout : null,
                'storefront' => ['currency' => get_woocommerce_currency(), 'total' => $read('total')],
                'approvedBy' => get_current_user_id(), 'approvedAt' => gmdate('Y-m-d\TH:i:s\Z'),
            ]);
            self::store_origin();
            $product->update_meta_data(self::PRODUCT_META, $map);
        } catch (Throwable $e) {
            if (class_exists('WC_Admin_Meta_Boxes')) WC_Admin_Meta_Boxes::add_error('Stellar mapping was not changed: ' . $e->getMessage());
        }
    }

    static function register_gateway() { starforge_sf104_register_gateway(); }
    static function register_blocks($registry) { starforge_sf104_register_blocks($registry); }
}

// Load optional Woo classes only after their parent APIs are available. These
// declarations live in file-level functions, outside the checkout class.
function starforge_sf104_register_gateway() {
    if (!class_exists('WC_Payment_Gateway') || class_exists('Starforge_SF104_Gateway')) return;
    class Starforge_SF104_Gateway extends WC_Payment_Gateway {
        function __construct() {
            $this->id = Starforge_SF104_Checkout::ID;
            $this->has_fields = false;
            $this->method_title = 'Stellar x402 digital checkout';
            $this->method_description = 'Prepare a fixed-price digital order for the original Stellar Forge buyer and merchant settlement review.';
            $this->supports = ['products'];
            $this->init_form_fields(); $this->init_settings();
            $this->enabled = $this->get_option('enabled', 'no');
            $this->title = $this->get_option('title', 'Stellar x402');
            $this->description = $this->get_option('description', 'Place your order, then download payment instructions for Stellar Forge. Your product is released after the store confirms settlement.');
            add_action('woocommerce_update_options_payment_gateways_' . $this->id, [$this, 'process_admin_options']);
        }
        function init_form_fields() {
            $this->form_fields = [
                'enabled' => ['title' => 'Enable', 'type' => 'checkbox', 'label' => 'Enable Stellar checkout for explicitly mapped digital products', 'default' => 'no'],
                'title' => ['title' => 'Checkout label', 'type' => 'text', 'default' => 'Stellar x402'],
                'description' => ['title' => 'Customer instructions', 'type' => 'textarea', 'default' => 'Place your order, then download payment instructions for Stellar Forge. Your product is released after the store confirms settlement.'],
            ];
        }
        function is_available() {
            if ($this->enabled !== 'yes' || Starforge_SF98_Woo::secret() === null) return false;
            try {
                Starforge_SF104_Checkout::store_origin();
                $order_id = function_exists('get_query_var') ? absint(get_query_var('order-pay')) : 0;
                if ($order_id) {
                    $order = wc_get_order($order_id);
                    if (!Starforge_SF104_Checkout::can_read($order)) return false;
                    Starforge_SF104_Checkout::snapshot($order);
                    Starforge_SF104_Admission::assert_available($order);
                } else Starforge_SF104_Checkout::cart_mapping();
                return true;
            } catch (Throwable $e) { return false; }
        }
        function process_payment($order_id) {
            try {
                if ($this->enabled !== 'yes' || Starforge_SF98_Woo::secret() === null) throw new RuntimeException('Stellar checkout is currently unavailable.');
                Starforge_SF104_Checkout::prepare_order($order_id);
                if (WC()->cart) WC()->cart->empty_cart();
                return ['result' => 'success', 'redirect' => $this->get_return_url(wc_get_order($order_id))];
            } catch (Throwable $e) {
                wc_add_notice($e->getMessage(), 'error');
                return ['result' => 'failure'];
            }
        }
    }
    add_filter('woocommerce_payment_gateways', static function ($gateways) { $gateways[] = 'Starforge_SF104_Gateway'; return $gateways; });
}

function starforge_sf104_register_blocks($registry) {
    if (!class_exists('Automattic\\WooCommerce\\Blocks\\Payments\\Integrations\\AbstractPaymentMethodType')) return;
    if (!class_exists('Starforge_SF104_Blocks')) {
        class Starforge_SF104_Blocks extends \Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType {
            protected $name = 'sf104_native';
            function initialize() { $this->settings = get_option('woocommerce_sf104_native_settings', []); }
            function is_active() { return ($this->settings['enabled'] ?? 'no') === 'yes' && Starforge_SF98_Woo::secret() !== null; }
            function get_payment_method_script_handles() {
                $handle = 'sf104-checkout-blocks';
                wp_register_script($handle, false, ['wc-blocks-registry', 'wc-settings', 'wp-element'], '0.4.0', true);
                wp_add_inline_script($handle, <<<'JS'
(function () {
const settings = window.wc.wcSettings.getSetting('sf104_native_data', {});
const label = settings.title || 'Stellar x402';
const content = window.wp.element.createElement('p', null, settings.description || '');
window.wc.wcBlocksRegistry.registerPaymentMethod({
    name: 'sf104_native', paymentMethodId: 'sf104_native', label: label, ariaLabel: label,
    content: content, edit: content, placeOrderButtonLabel: 'Continue to payment instructions',
    canMakePayment: function (context) {
        const q = settings.quote, cart = context.cart || {}, totals = context.cartTotals || {};
        const items = cart.cartItems || cart.items || [];
        if (!q || context.cartNeedsShipping || items.length !== 1 || Number(items[0].quantity) !== 1 || String(items[0].id) !== q.productId) return false;
        return totals.currency_code === q.currency && String(totals.total_price).replace(/^0+(?=\d)/, '') === q.minorTotal;
    },
    supports: { features: ['products'] }
});
}());
JS
                );
                return [$handle];
            }
            function get_payment_method_data() {
                $quote = null;
                try {
                    Starforge_SF104_Checkout::store_origin();
                    $c = Starforge_SF104_Checkout::cart_mapping();
                    $places = wc_get_price_decimals();
                    $parts = explode('.', $c['mapping']['storefront']['total'], 2);
                    $fraction = $parts[1] ?? '';
                    if (strlen($fraction) > $places) throw new RuntimeException('Unsupported store precision.');
                    $minor = ltrim($parts[0] . str_pad($fraction, $places, '0'), '0');
                    $quote = ['productId' => $c['productId'], 'currency' => $c['mapping']['storefront']['currency'], 'minorTotal' => $minor ?: '0'];
                } catch (Throwable $e) { /* Server order checks remain authoritative. */ }
                return ['title' => $this->settings['title'] ?? 'Stellar x402',
                    'description' => $this->settings['description'] ?? 'Place your order, then download payment instructions for Stellar Forge. Your product is released after the store confirms settlement.',
                    'supports' => ['products'], 'quote' => $quote];
            }
        }
    }
    $registry->register(new Starforge_SF104_Blocks());
}


require_once __DIR__ . '/checkout-admission.php';
Starforge_SF104_Checkout::boot();

