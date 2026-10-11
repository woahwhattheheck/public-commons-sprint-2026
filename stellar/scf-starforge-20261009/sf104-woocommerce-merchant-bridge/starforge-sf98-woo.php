<?php
/**
 * Plugin Name: Starforge SF98 WooCommerce Merchant Bridge
 * Description: Receives authenticated native Stellar x402 SF98 settlement notices and binds them to WooCommerce orders for explicit merchant release.
 * Version: 0.1.0
 * Requires PHP: 8.0
 * Requires Plugins: woocommerce
 * License: MIT
 */
if (!defined('ABSPATH')) { exit; }

final class Starforge_SF98_Woo {
    const META_READY = '_sf98_order_binding';
    const TOLERANCE = 300;
    const MAX_BODY = 8192;
    const MAX_AMOUNT = '170141183460469231731687303715884105727';

    static function table() {
        global $wpdb;
        return $wpdb->prefix . 'sf98_woo_events';
    }

    static function activate() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $table = self::table();
        $collate = $wpdb->get_charset_collate();
        dbDelta("CREATE TABLE {$table} (
            event_id char(64) NOT NULL,
            order_id bigint(20) unsigned NOT NULL,
            body_sha256 char(64) NOT NULL,
            state varchar(16) NOT NULL,
            occurred_at varchar(40) NOT NULL,
            received_at datetime NOT NULL,
            tx_hash char(64) DEFAULT NULL,
            reviewed_by bigint(20) unsigned DEFAULT NULL,
            reviewed_at datetime DEFAULT NULL,
            review_started_at datetime DEFAULT NULL,
            PRIMARY KEY  (event_id),
            UNIQUE KEY order_once (order_id)
        ) {$collate};");
    }

    static function boot() {
        add_action('rest_api_init', [__CLASS__, 'rest']);
        add_action('admin_menu', [__CLASS__, 'menu']);
        add_action('admin_post_sf98_bind', [__CLASS__, 'bind']);
        add_action('admin_post_sf98_release', [__CLASS__, 'release']);
        add_action('before_woocommerce_init', static function () {
            if (class_exists('Automattic\\WooCommerce\\Utilities\\FeaturesUtil')) {
                \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
            }
        });
    }

    static function rest() {
        register_rest_route('stellar-forge/v1', '/settlement', [
            'methods' => 'POST', 'callback' => [__CLASS__, 'receive'],
            // Signed raw-body HMAC is checked BEFORE any order or database action.
            'permission_callback' => '__return_true',
        ]);
    }

    static function response($code, $status) {
        $r = new WP_REST_Response(['status' => $status], $code);
        $r->header('Cache-Control', 'no-store');
        return $r;
    }

    static function amount_ok($x) {
        return is_string($x) && preg_match('/^[1-9][0-9]*$/D', $x) &&
            (strlen($x) < strlen(self::MAX_AMOUNT) ||
             (strlen($x) === strlen(self::MAX_AMOUNT) && strcmp($x, self::MAX_AMOUNT) <= 0));
    }

    static function event_ok($x) {
        if (!is_array($x) || !is_string($x['eventId'] ?? null) ||
            !is_string($x['routeId'] ?? null) || !is_string($x['assetDigest'] ?? null) ||
            ($x['schema'] ?? '') !== 'stellar-forge.sf98.webhook.v1' ||
            ($x['settlement'] ?? '') !== 'ORIGINAL_NATIVE_SUCCESS' ||
            !preg_match('/^[0-9a-f]{64}$/D', $x['eventId'] ?? '') ||
            !preg_match('/^[A-Za-z0-9_-]{1,80}$/D', $x['routeId'] ?? '') ||
            !in_array($x['method'] ?? null, ['GET', 'HEAD', 'POST'], true) ||
            !in_array($x['network'] ?? null, ['stellar:testnet', 'stellar:pubnet'], true) ||
            !self::amount_ok($x['amountAtomic'] ?? null) ||
            !preg_match('/^[0-9a-f]{64}$/D', $x['assetDigest'] ?? '') ||
            !is_string($x['orderReference'] ?? null) ||
            !preg_match('/^[1-9][0-9]{0,17}$/D', $x['orderReference']) ||
            !is_string($x['occurredAt'] ?? null) || strlen($x['occurredAt']) > 40 ||
            strtotime($x['occurredAt']) === false) return false;
        // Refuse accidental extra secrets or fields outside the ORIGINAL SF98 wire contract.
        $fields = ['schema','eventId','occurredAt','routeId','method','network',
                   'amountAtomic','assetDigest','orderReference','settlement'];
        $keys = array_keys($x);
        sort($fields); sort($keys);
        return $fields === $keys;
    }

    static function secret() {
        if (!defined('SF98_WEBHOOK_SECRET') || !is_string(SF98_WEBHOOK_SECRET)) return null;
        $s = SF98_WEBHOOK_SECRET;
        return strlen($s) >= 32 && strlen($s) <= 1024 ? $s : null;
    }

    static function receive($request) {
        global $wpdb;
        if (!function_exists('wc_get_order')) return self::response(503, 'WOOCOMMERCE_REQUIRED');
        $raw = $request->get_body();
        if (!is_string($raw) || strlen($raw) === 0 || strlen($raw) > self::MAX_BODY)
            return self::response(413, 'INVALID_BODY_LENGTH');
        $secret = self::secret();
        if ($secret === null) return self::response(503, 'RECEIVER_NOT_CONFIGURED');
        $stamp = $request->get_header('x-sf98-timestamp');
        $signature = $request->get_header('x-sf98-signature');
        if (!is_string($stamp) || !preg_match('/^[1-9][0-9]{0,15}$/D', $stamp) ||
            abs(time() - (int) $stamp) > self::TOLERANCE ||
            !is_string($signature) || !preg_match('/^sha256=[0-9a-f]{64}$/D', $signature))
            return self::response(401, 'INVALID_SIGNATURE_OR_TIMESTAMP');
        $expected = 'sha256=' . hash_hmac('sha256', $stamp . '.' . $raw, $secret);
        if (!hash_equals($expected, $signature)) return self::response(401, 'INVALID_SIGNATURE_OR_TIMESTAMP');
        $event = json_decode($raw, true, 16);
        if (!self::event_ok($event) || $request->get_header('idempotency-key') !== $event['eventId'])
            return self::response(422, 'INVALID_SF98_EVENT');
        $order_id = (int) $event['orderReference'];
        if ($order_id < 1 || (string) $order_id !== $event['orderReference'])
            return self::response(422, 'INVALID_ORDER_REFERENCE');
        $order = wc_get_order($order_id);
        if (!$order) return self::response(404, 'UNKNOWN_PREBOUND_ORDER');
        $terms = $order->get_meta(self::META_READY, true);
        if (!is_array($terms) || ($terms['approved'] ?? '') !== 'YES' ||
            !in_array($order->get_status(), ['pending', 'on-hold'], true) ||
            ($terms['routeId'] ?? '') !== $event['routeId'] ||
            ($terms['method'] ?? '') !== $event['method'] ||
            ($terms['network'] ?? '') !== $event['network'] ||
            ($terms['amountAtomic'] ?? '') !== $event['amountAtomic'] ||
            !is_string($terms['assetDigest'] ?? null) ||
            !hash_equals($terms['assetDigest'], $event['assetDigest'])) {
            // A replay after authorized fulfillment can still be acknowledged below.
            $existing = $wpdb->get_row($wpdb->prepare(
                'SELECT * FROM ' . self::table() . ' WHERE event_id=%s', $event['eventId']));
            if ($existing && (int) $existing->order_id === $order_id &&
                hash_equals($existing->body_sha256, hash('sha256', $raw)))
                return self::response(200, 'ALREADY_ACCEPTED');
            return self::response(409, 'ORDER_BINDING_OR_STATUS_MISMATCH');
        }
        $digest = hash('sha256', $raw);
        $success = $wpdb->insert(self::table(), [
            'event_id' => $event['eventId'], 'order_id' => $order_id,
            'body_sha256' => $digest, 'state' => 'RECEIVED',
            'occurred_at' => $event['occurredAt'], 'received_at' => current_time('mysql', true),
        ], ['%s','%d','%s','%s','%s','%s']);
        if ($success === 1) {
            $order->add_order_note('Original SF98 x402 delivery notice authenticated. Merchant chain review required; no fulfillment triggered. Event ' . substr($event['eventId'], 0, 12));
            return self::response(202, 'AWAITING_INDEPENDENT_REVIEW');
        }
        // Database unique keys prevent same event and second event for same order.
        $existing = $wpdb->get_row($wpdb->prepare(
            'SELECT * FROM ' . self::table() . ' WHERE event_id=%s OR order_id=%d LIMIT 1',
            $event['eventId'], $order_id));
        if ($existing && $existing->event_id === $event['eventId'] &&
            (int) $existing->order_id === $order_id && hash_equals($existing->body_sha256, $digest))
            return self::response(200, 'ALREADY_ACCEPTED');
        return self::response($existing ? 409 : 503, $existing ? 'CONFLICTING_ORDER_OR_EVENT' : 'JOURNAL_UNAVAILABLE');
    }

    static function menu() {
        add_submenu_page('woocommerce', 'Stellar x402 Orders', 'Stellar x402 Orders',
            'manage_woocommerce', 'sf98-woocommerce', [__CLASS__, 'page']);
    }

    static function admin_guard($nonce) {
        if (!current_user_can('manage_woocommerce')) wp_die('Forbidden', '', ['response' => 403]);
        check_admin_referer($nonce);
        if (!function_exists('wc_get_order')) wp_die('WooCommerce is required');
    }

    static function admin_redirect($flag) {
        wp_safe_redirect(add_query_arg(['page' => 'sf98-woocommerce', 'sf98_result' => $flag], admin_url('admin.php')));
        exit;
    }

    static function bind() {
        global $wpdb;
        self::admin_guard('sf98_bind_order');
        $order_id = absint($_POST['order_id'] ?? 0);
        $order = wc_get_order($order_id);
        $route = sanitize_text_field(wp_unslash($_POST['route_id'] ?? ''));
        $method = sanitize_text_field(wp_unslash($_POST['method'] ?? ''));
        $network = sanitize_text_field(wp_unslash($_POST['network'] ?? ''));
        $amount = sanitize_text_field(wp_unslash($_POST['amount_atomic'] ?? ''));
        $asset = sanitize_text_field(wp_unslash($_POST['asset'] ?? ''));
        if (!$order || !in_array($order->get_status(), ['pending','on-hold'], true) ||
            !preg_match('/^[A-Za-z0-9_-]{1,80}$/D', $route) ||
            !in_array($method, ['GET','HEAD','POST'], true) ||
            !in_array($network, ['stellar:testnet','stellar:pubnet'], true) ||
            !self::amount_ok($amount) || strlen($asset) < 3 || strlen($asset) > 128 ||
            preg_match('/[\x00-\x1f\x7f]/', $asset) ||
            $wpdb->get_var($wpdb->prepare('SELECT event_id FROM ' . self::table() . ' WHERE order_id=%d', $order_id))) {
            self::admin_redirect('binding_rejected');
        }
        $order->update_meta_data(self::META_READY, [
            'approved' => 'YES', 'routeId' => $route, 'method' => $method,
            'network' => $network, 'amountAtomic' => $amount,
            'assetDigest' => hash('sha256', $asset),
            'approvedBy' => get_current_user_id(), 'approvedAt' => gmdate('c'),
        ]);
        $order->save();
        $order->add_order_note('SF98 route and atomic Stellar payment terms explicitly prebound by store operator.');
        self::admin_redirect('bound');
    }

    static function release() {
        global $wpdb;
        self::admin_guard('sf98_release_order');
        $id = sanitize_text_field(wp_unslash($_POST['event_id'] ?? ''));
        $tx = strtolower(sanitize_text_field(wp_unslash($_POST['transaction_hash'] ?? '')));
        if (empty($_POST['independently_verified']) || !preg_match('/^[a-f0-9]{64}$/D', $id) ||
            !preg_match('/^[a-f0-9]{64}$/D', $tx)) self::admin_redirect('review_rejected');
        $table = self::table();
        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$table} WHERE event_id=%s", $id));
        $order = $row ? wc_get_order((int) $row->order_id) : null;
        if (!$row || !$order) self::admin_redirect('missing_order');
        if ($row->state === 'RELEASED') self::admin_redirect($row->tx_hash === $tx ? 'already_released' : 'transaction_conflict');
        // Crash recovery: if Woo already completed this EXACT tx, finalize journal, never pay twice.
        if ($row->state === 'REVIEWING') {
            if (strtolower((string) $order->get_transaction_id()) === $tx && $order->is_paid()) {
                $wpdb->update($table, ['state'=>'RELEASED','reviewed_at'=>current_time('mysql', true)],
                    ['event_id'=>$id,'state'=>'REVIEWING'], ['%s','%s'], ['%s','%s']);
                self::admin_redirect('recovered_release');
            }
            // The previous request may have died before payment_complete. A stale,
            // still-unpaid lock can be cleared only with the same operator tx hash.
            $started = strtotime((string) $row->review_started_at);
            if ($row->tx_hash === $tx && $started && time() - $started > 120 &&
                in_array($order->get_status(), ['pending','on-hold'], true) &&
                !$order->get_transaction_id()) {
                $reset = $wpdb->update($table,
                    ['state'=>'RECEIVED','tx_hash'=>null,'review_started_at'=>null],
                    ['event_id'=>$id,'state'=>'REVIEWING','tx_hash'=>$tx],
                    ['%s','%s','%s'], ['%s','%s','%s']);
                self::admin_redirect($reset === 1 ? 'stale_review_reset_retry' : 'review_race');
            }
            self::admin_redirect('review_in_progress');
        }
        if ($row->state !== 'RECEIVED' || !in_array($order->get_status(), ['pending','on-hold'], true))
            self::admin_redirect('order_not_releasable');
        // Compare-and-swap to stop concurrent admin requests invoking payment_complete twice.
        $won = $wpdb->update($table,
            ['state'=>'REVIEWING', 'tx_hash'=>$tx, 'reviewed_by'=>get_current_user_id(),
             'review_started_at'=>current_time('mysql', true)],
            ['event_id'=>$id, 'state'=>'RECEIVED'], ['%s','%s','%d','%s'], ['%s','%s']);
        if ($won !== 1) self::admin_redirect('review_race');
        try {
            $order->payment_complete($tx);
            $order->save();
        } catch (Throwable $e) {
            // Retain REVIEWING for reconciliation rather than silently allow a second fulfillment.
            self::admin_redirect('review_needs_recovery');
        }
        if (!$order->is_paid() || strtolower((string) $order->get_transaction_id()) !== $tx)
            self::admin_redirect('review_needs_recovery');
        $saved = $wpdb->update($table, ['state'=>'RELEASED','reviewed_at'=>current_time('mysql', true)],
            ['event_id'=>$id,'state'=>'REVIEWING'], ['%s','%s'], ['%s','%s']);
        self::admin_redirect($saved === 1 ? 'released' : 'released_journal_needs_recovery');
    }

    static function page() {
        global $wpdb;
        if (!current_user_can('manage_woocommerce')) return;
        $table = self::table();
        $rows = $wpdb->get_results("SELECT event_id,order_id,state,occurred_at,received_at,tx_hash
            FROM {$table} ORDER BY received_at DESC LIMIT 50");
        echo '<div class="wrap"><h1>Stellar x402 merchant orders</h1>';
        echo '<p>Original SF98 notice intake. Orders remain unfulfilled until the merchant independently verifies the original Stellar settlement and confirms release. The bridge does not verify the chain.</p>';
        $result = sanitize_key(wp_unslash($_GET['sf98_result'] ?? ''));
        if ($result) echo '<div class="notice notice-info"><p>' . esc_html(str_replace('_', ' ', $result)) . '</p></div>';
        if (self::secret() === null) echo '<div class="notice notice-error"><p>Define SF98_WEBHOOK_SECRET in wp-config.php before accepting notices.</p></div>';
        echo '<h2>Bind an existing unpaid WooCommerce order</h2><p>Enter exact ORIGINAL SF30 route and atomic payment terms. The asset identifier is hashed; no wallet secret is stored.</p>';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('sf98_bind_order');
        echo '<input type="hidden" name="action" value="sf98_bind">';
        foreach ([['order_id','Woo order ID'], ['route_id','Seller route ID'], ['amount_atomic','Atomic amount'], ['asset','SEP-41 asset identifier']] as $field) {
            echo '<p><label>' . esc_html($field[1]) . ' <input required name="' . esc_attr($field[0]) . '" autocomplete="off" size="42"></label></p>';
        }
        echo '<p><label>Method <select name="method"><option>GET</option><option>HEAD</option><option>POST</option></select></label> ';
        echo '<label>Network <select name="network"><option>stellar:testnet</option><option>stellar:pubnet</option></select></label></p>';
        submit_button('Prebind order (no charge, no fulfillment)');
        echo '</form><h2>Original accepted notice queue</h2><table class="widefat striped"><thead><tr><th>Order</th><th>Event</th><th>Status</th><th>Received UTC</th><th>Independent chain review and fulfillment</th></tr></thead><tbody>';
        foreach ($rows as $row) {
            $id = $row->event_id;
            echo '<tr><td>' . esc_html((string) $row->order_id) . '</td><td><code>' . esc_html(substr($id,0,16)) . '...</code></td>';
            echo '<td>' . esc_html($row->state) . '</td><td>' . esc_html($row->received_at) . '</td><td>';
            if (in_array($row->state, ['RECEIVED','REVIEWING'], true)) {
                echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
                wp_nonce_field('sf98_release_order');
                echo '<input type="hidden" name="action" value="sf98_release"><input type="hidden" name="event_id" value="' . esc_attr($id) . '">';
                echo '<label>Verified original chain tx hash (64 hex) <input required pattern="[a-fA-F0-9]{64}" size="30" name="transaction_hash" value="' . esc_attr((string) $row->tx_hash) . '"></label> ';
                echo '<label><input required type="checkbox" name="independently_verified" value="1"> I verified independent original Stellar settlement, correct asset, recipient, amount and order</label> ';
                echo '<button type="submit" class="button button-primary">Release order</button></form>';
            } else echo 'Woo payment completion recorded';
            echo '</td></tr>';
        }
        if (!$rows) echo '<tr><td colspan="5">No accepted events yet.</td></tr>';
        echo '</tbody></table><p>Receive at <code>/wp-json/stellar-forge/v1/settlement</code>. See plugin README for the exact SF98 sender command and review procedure.</p></div>';
    }
}
register_activation_hook(__FILE__, ['Starforge_SF98_Woo', 'activate']);
Starforge_SF98_Woo::boot();
