<?php
/** Original merchant checkout: signed readiness and single-attempt admission. */
if (!defined('ABSPATH')) { exit; }

final class Starforge_SF104_Admission {
    const SCHEMA = 'stellar-forge.sf104.checkout-admission.v1';
    const RESULT_SCHEMA = 'stellar-forge.sf104.checkout-admission-result.v1';
    const VERSION = '1';

    static function table() { global $wpdb; return $wpdb->prefix . 'sf104_checkout_attempts'; }

    static function activate() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $table = self::table();
        $collate = $wpdb->get_charset_collate();
        dbDelta("CREATE TABLE {$table} (
            order_id bigint(20) unsigned NOT NULL,
            attempt_digest char(64) NOT NULL,
            generation bigint(20) unsigned NOT NULL DEFAULT 1,
            state varchar(16) NOT NULL,
            reserved_at datetime NOT NULL,
            reset_at datetime DEFAULT NULL,
            reset_by bigint(20) unsigned DEFAULT NULL,
            reset_reason varchar(240) DEFAULT NULL,
            PRIMARY KEY  (order_id)
        ) {$collate};");
        $found = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table)));
        if ($found === $table) update_option('sf104_checkout_schema', self::VERSION, false);
    }

    static function ensure_schema() {
        if (get_option('sf104_checkout_schema') !== self::VERSION && current_user_can('manage_woocommerce')) self::activate();
    }

    static function boot() {
        register_activation_hook(__DIR__ . '/starforge-sf98-woo.php', [__CLASS__, 'activate']);
        add_action('admin_init', [__CLASS__, 'ensure_schema']);
        add_action('rest_api_init', [__CLASS__, 'rest']);
        add_action('admin_menu', [__CLASS__, 'menu']);
        add_action('admin_post_sf104_reset_attempt', [__CLASS__, 'reset']);
    }

    static function rest() {
        register_rest_route('stellar-forge/v1', '/checkout-admission', [
            'methods' => 'POST', 'callback' => [__CLASS__, 'receive'],
            'permission_callback' => '__return_true',
        ]);
    }

    static function response($http, $status, $order_reference = null) {
        $body = ['schema' => self::RESULT_SCHEMA, 'status' => $status];
        if ($order_reference !== null) $body['orderReference'] = $order_reference;
        $result = new WP_REST_Response($body, $http);
        $result->header('Cache-Control', 'no-store');
        return $result;
    }

    static function row($order_id) {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::table() . ' WHERE order_id=%d', $order_id));
        if ($wpdb->last_error) throw new RuntimeException('CHECKOUT_STORE_UNAVAILABLE', 503);
        return $row;
    }

    static function assert_available($order, $check_attempt = true) {
        if (!$order || !in_array($order->get_status(), ['pending', 'on-hold'], true) ||
            $order->is_paid() || $order->get_transaction_id()) {
            throw new RuntimeException('This order is no longer awaiting a new Stellar payment.', 409);
        }
        if (Starforge_SF104_Checkout::event_for_order($order->get_id())) {
            throw new RuntimeException('The store has received this order settlement notice and is reviewing it.', 409);
        }
        if ($check_attempt) {
            $attempt = self::row($order->get_id());
            if ($attempt && $attempt->state !== 'RESET') {
                throw new RuntimeException('This order already has a payment attempt awaiting reconciliation.', 409);
            }
        }
    }

    static function payload_ok($p) {
        if (!is_array($p) || ($p['schema'] ?? '') !== self::SCHEMA ||
            !in_array($p['phase'] ?? null, ['inspect', 'reserve'], true)) return false;
        $fields = ['schema', 'phase', 'orderReference', 'productId', 'attemptGeneration', 'routeId', 'method',
            'network', 'amountAtomic', 'assetDigest', 'recipientDigest', 'resourceUrl'];
        if ($p['phase'] === 'reserve') $fields[] = 'attemptDigest';
        $keys = array_keys($p); sort($keys); sort($fields);
        if ($keys !== $fields) return false;
        foreach (['orderReference', 'productId'] as $field) {
            if (!is_string($p[$field]) || !preg_match('/^[1-9][0-9]{0,17}$/D', $p[$field]) ||
                (string) (int) $p[$field] !== $p[$field]) return false;
        }
        foreach (['assetDigest', 'recipientDigest'] as $field) {
            if (!is_string($p[$field]) || !preg_match('/^[a-f0-9]{64}$/D', $p[$field])) return false;
        }
        return is_int($p['attemptGeneration']) && $p['attemptGeneration'] >= 1 && $p['attemptGeneration'] <= 2147483647 &&
            is_string($p['routeId']) && preg_match('/^[A-Za-z0-9_-]{1,64}$/D', $p['routeId']) &&
            in_array($p['method'], ['GET', 'HEAD'], true) &&
            in_array($p['network'], ['stellar:testnet', 'stellar:pubnet'], true) &&
            Starforge_SF98_Woo::amount_ok($p['amountAtomic']) &&
            is_string($p['resourceUrl']) && strlen($p['resourceUrl']) <= 4096 &&
            ($p['phase'] !== 'reserve' || (is_string($p['attemptDigest']) && preg_match('/^[a-f0-9]{64}$/D', $p['attemptDigest'])));
    }

    static function matches($payload, $record, $h) {
        if ($payload['attemptGeneration'] !== $h['attemptGeneration']) return false;
        $b = $record['binding'];
        $expect = [
            'orderReference' => $h['orderReference'], 'productId' => $h['productId'],
            'routeId' => $b['routeId'], 'method' => $b['method'], 'network' => $b['network'],
            'amountAtomic' => $b['amountAtomic'], 'assetDigest' => $b['assetDigest'],
            'recipientDigest' => $b['recipientDigest'], 'resourceUrl' => $h['operation']['url'],
        ];
        foreach ($expect as $field => $value) if (!hash_equals($value, $payload[$field])) return false;
        return true;
    }

    static function receive($request) {
        global $wpdb;
        if (!function_exists('wc_get_order')) return self::response(503, 'WOOCOMMERCE_REQUIRED');
        $secret = Starforge_SF98_Woo::secret();
        if ($secret === null) return self::response(503, 'RECEIVER_NOT_CONFIGURED');
        $raw = $request->get_body();
        if (!is_string($raw) || strlen($raw) === 0 || strlen($raw) > 8192) return self::response(413, 'INVALID_BODY_LENGTH');
        $stamp = $request->get_header('x-sf98-timestamp');
        $signature = $request->get_header('x-sf98-signature');
        if (!is_string($stamp) || !preg_match('/^[1-9][0-9]{0,15}$/D', $stamp) ||
            abs(time() - (int) $stamp) > Starforge_SF98_Woo::TOLERANCE ||
            !is_string($signature) || !preg_match('/^sha256=[0-9a-f]{64}$/D', $signature) ||
            !hash_equals('sha256=' . hash_hmac('sha256', $stamp . '.' . $raw, $secret), $signature)) {
            return self::response(401, 'INVALID_SIGNATURE_OR_TIMESTAMP');
        }
        $payload = json_decode($raw, true, 16);
        if (!self::payload_ok($payload)) return self::response(422, 'INVALID_CHECKOUT_ADMISSION');
        try {
            return Starforge_SF104_Checkout::with_order_lock((int) $payload['orderReference'], static function () use ($payload, $wpdb) {
                $order = wc_get_order((int) $payload['orderReference']);
                if (!$order) return self::response(409, 'ORDER_NOT_AVAILABLE');
                $record = Starforge_SF104_Checkout::snapshot($order);
                $handoff = Starforge_SF104_Checkout::available_handoff($order, $record);
                if (!self::matches($payload, $record, $handoff)) return self::response(409, 'ORDER_TERMS_MISMATCH');
                if ($payload['phase'] === 'inspect') return self::response(200, 'READY', $payload['orderReference']);
                $prior = self::row($order->get_id());
                if ($prior && hash_equals($prior->attempt_digest, $payload['attemptDigest'])) {
                    return self::response(409, 'PREVIOUS_ATTEMPT_REPLAY');
                }
                $data = ['attempt_digest' => $payload['attemptDigest'], 'state' => 'RESERVED', 'reserved_at' => current_time('mysql', true),
                    'generation' => $payload['attemptGeneration']];
                if ($prior) {
                    $won = $wpdb->update(self::table(), $data,
                        ['order_id' => $order->get_id(), 'state' => 'RESET', 'generation' => (int) $prior->generation],
                        ['%s', '%s', '%s', '%d'], ['%d', '%s', '%d']);
                } else {
                    $won = $wpdb->insert(self::table(), ['order_id' => $order->get_id()] + $data,
                        ['%d', '%s', '%s', '%s', '%d']);
                }
                if ($won !== 1) return self::response($wpdb->last_error ? 503 : 409, 'ATTEMPT_NOT_RESERVED');
                try { $order->add_order_note('Original native seller reserved this order payment attempt ' . substr($payload['attemptDigest'], 0, 16) . '. Awaiting settlement notice; no Woo fulfillment occurred.'); }
                catch (Throwable $e) { /* The durable reservation is authoritative; no retry is enabled. */ }
                return self::response(200, 'RESERVED', $payload['orderReference']);
            });
        } catch (Throwable $e) {
            return self::response($e->getCode() === 503 ? 503 : 409, $e->getCode() === 503 ? 'CHECKOUT_STORE_UNAVAILABLE' : 'ORDER_NOT_AVAILABLE');
        }
    }

    static function menu() {
        add_submenu_page('woocommerce', 'Stellar checkout recovery', 'Stellar checkout recovery',
            'manage_woocommerce', 'sf104-checkout-attempts', [__CLASS__, 'page']);
    }

    static function page() {
        global $wpdb;
        if (!current_user_can('manage_woocommerce')) return;
        $rows = $wpdb->get_results('SELECT * FROM ' . self::table() . " WHERE state='RESERVED' ORDER BY reserved_at DESC LIMIT 100");
        echo '<div class="wrap"><h1>Stellar checkout recovery</h1><p>Inspect the original native seller outbox and Stellar settlement before reopening an attempted payment. Reservations do not expire automatically.</p>';
        if ($wpdb->last_error) { echo '<div class="notice notice-error"><p>The checkout reservation store is unavailable.</p></div></div>'; return; }
        $flag = isset($_GET['sf104_result']) && is_string($_GET['sf104_result']) ? sanitize_key(wp_unslash($_GET['sf104_result'])) : '';
        if ($flag) echo '<div class="notice notice-info"><p>' . esc_html(str_replace('_', ' ', $flag)) . '</p></div>';
        echo '<table class="widefat striped"><thead><tr><th>Order</th><th>Attempt</th><th>Reserved UTC</th><th>Recovery</th></tr></thead><tbody>';
        foreach ($rows as $row) {
            $order = wc_get_order((int) $row->order_id);
            echo '<tr><td>' . esc_html((string) $row->order_id) . '</td><td><code>' . esc_html(substr($row->attempt_digest, 0, 16)) . '</code><br>Generation ' . esc_html((string) $row->generation) . '</td><td>' . esc_html($row->reserved_at) . '</td><td>';
            try {
                Starforge_SF104_Checkout::snapshot($order);
                self::assert_available($order, false);
                echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
                wp_nonce_field('sf104_reset_attempt');
                foreach (['action' => 'sf104_reset_attempt', 'order_id' => (string) $row->order_id,
                    'attempt_digest' => $row->attempt_digest, 'generation' => (string) $row->generation] as $key => $value) {
                    echo '<input type="hidden" name="' . esc_attr($key) . '" value="' . esc_attr($value) . '">';
                }
                echo '<p><label>Reconciliation note <input required name="reason" maxlength="240" size="45"></label></p>';
                echo '<p><label><input required type="checkbox" name="not_settled" value="1"> I independently confirmed this attempt did not settle and this order has no fulfillment notice.</label></p>';
                echo '<button type="submit" class="button">Reopen for a new payment attempt</button></form>';
            } catch (Throwable $e) {
                echo esc_html($e->getMessage());
                if ($order) echo '<p><a href="' . esc_url($order->get_edit_order_url()) . '">View WooCommerce order</a></p>';
            }
            echo '</td></tr>';
        }
        if (!$rows) echo '<tr><td colspan="4">No reserved payment attempts.</td></tr>';
        echo '</tbody></table></div>';
    }

    static function reset() {
        global $wpdb;
        Starforge_SF98_Woo::admin_guard('sf104_reset_attempt');
        $read = static function ($key) { $v = $_POST[$key] ?? ''; return is_string($v) ? wp_unslash($v) : ''; };
        $id = $read('order_id'); $digest = $read('attempt_digest'); $generation = $read('generation');
        $reason = sanitize_text_field($read('reason'));
        $result = 'reset_rejected';
        if ($read('not_settled') === '1' && preg_match('/^[1-9][0-9]{0,17}$/D', $id) &&
            preg_match('/^[a-f0-9]{64}$/D', $digest) && preg_match('/^[1-9][0-9]{0,9}$/D', $generation) &&
            (int) $generation < 2147483647 &&
            strlen($reason) > 0 && strlen($reason) <= 240) {
            try {
                $result = Starforge_SF104_Checkout::with_order_lock((int) $id, static function () use ($wpdb, $id, $digest, $generation, $reason) {
                    $order = wc_get_order((int) $id);
                    Starforge_SF104_Checkout::snapshot($order);
                    self::assert_available($order, false);
                    $next_generation = (int) $generation + 1;
                    $won = $wpdb->update(self::table(), ['state' => 'RESET', 'reset_at' => current_time('mysql', true),
                        'generation' => $next_generation,
                        'reset_by' => get_current_user_id(), 'reset_reason' => $reason],
                        ['order_id' => (int) $id, 'state' => 'RESERVED', 'attempt_digest' => $digest, 'generation' => (int) $generation],
                        ['%s', '%s', '%d', '%d', '%s'], ['%d', '%s', '%s', '%d']);
                    if ($won !== 1) return 'attempt_changed_or_reset_failed';
                    $order->add_order_note('Merchant reopened Stellar checkout as generation ' . $next_generation . ' after independently confirming non-settlement of generation ' . $generation . ', attempt ' . substr($digest, 0, 16) . '. ' . $reason);
                    return 'reopened_for_new_attempt';
                });
            } catch (Throwable $e) { $result = 'order_not_reopenable'; }
        }
        wp_safe_redirect(add_query_arg(['page' => 'sf104-checkout-attempts', 'sf104_result' => $result], admin_url('admin.php')));
        exit;
    }
}

Starforge_SF104_Admission::boot();
