<?php
/** MIT. Apply independently verified native returns to the original Woo order. */
if (!defined('ABSPATH')) { exit; }

final class Starforge_SF104_Merchant_Refunds {
    const SCHEMA = 'stellar-forge.sf104.merchant-refund.v1';
    const VIEW_SCHEMA = 'stellar-forge.sf104.merchant-refunds.v1';
    const META = '_sf104_native_refund';
    const VERSION = '1';

    static function table() { global $wpdb; return $wpdb->prefix . 'sf104_woo_refunds'; }
    static function boot() {
        add_action('rest_api_init', [__CLASS__, 'routes']);
        add_action('admin_init', [__CLASS__, 'install']);
    }
    static function install() {
        if (get_option('sf104_refunds_schema') === self::VERSION) return;
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $table = self::table(); $collate = $wpdb->get_charset_collate();
        dbDelta("CREATE TABLE {$table} (
            adjustment_id char(36) NOT NULL,
            order_id bigint(20) unsigned NOT NULL,
            event_id char(64) NOT NULL,
            network varchar(24) NOT NULL,
            refund_tx char(64) NOT NULL,
            status varchar(16) NOT NULL,
            amount_atomic varchar(40) NOT NULL,
            woo_amount varchar(32) NOT NULL,
            currency varchar(12) NOT NULL,
            review_sha256 char(64) NOT NULL,
            payload longtext NOT NULL,
            refund_id bigint(20) unsigned DEFAULT NULL,
            history longtext NOT NULL,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (adjustment_id),
            UNIQUE KEY returned_transfer (network, refund_tx),
            KEY original_order (order_id)
        ) ENGINE=InnoDB {$collate};");
        if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table))) === $table)
            update_option('sf104_refunds_schema', self::VERSION, false);
    }
    static function routes() {
        $base = '/merchant/orders/(?P<order>[1-9][0-9]{0,17})/refunds';
        foreach (['' => ['GET', 'inspect'], '/prepare' => ['POST', 'prepare'], '/apply' => ['POST', 'apply']] as $suffix => $route) {
            register_rest_route('stellar-forge/v1', $base . $suffix, [
                'methods' => $route[0], 'callback' => [__CLASS__, $route[1]],
                'permission_callback' => ['Starforge_SF104_Merchant_Operator', 'allowed'],
            ]);
        }
    }
    static function need($value, $code, $status = 409) {
        if (!$value) throw new RuntimeException($code, $status);
    }
    static function hash_ok($value) { return is_string($value) && preg_match('/^[a-f0-9]{64}$/D', $value); }
    static function uuid_ok($value) { return is_string($value) && preg_match('/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/D', $value); }
    static function json($value) {
        $json = wp_json_encode($value, JSON_UNESCAPED_SLASHES);
        self::need(is_string($json), 'REFUND_RECORD_ENCODING_FAILED', 503); return $json;
    }
    static function decoded($value) {
        $data = json_decode($value, true);
        self::need(is_array($data), 'REFUND_JOURNAL_INVALID', 503); return $data;
    }
    static function compare($a, $b) {
        $a = ltrim($a, '0'); $b = ltrim($b, '0');
        $a = $a === '' ? '0' : $a; $b = $b === '' ? '0' : $b;
        return strlen($a) <=> strlen($b) ?: strcmp($a, $b);
    }
    static function add($a, $b) {
        $i = strlen($a) - 1; $j = strlen($b) - 1; $carry = 0; $out = '';
        while ($i >= 0 || $j >= 0 || $carry) {
            $sum = ($i >= 0 ? (int) $a[$i--] : 0) + ($j >= 0 ? (int) $b[$j--] : 0) + $carry;
            $out = (string) ($sum % 10) . $out; $carry = intdiv($sum, 10);
        }
        return $out === '' ? '0' : $out;
    }
    /** Monetary comparisons use the store's decimal scale; chain units stay strings. */
    static function minor($value, $decimals) {
        self::need(is_string($value) && is_int($decimals) && $decimals >= 0 && $decimals <= 6 &&
            preg_match('/^(0|[1-9][0-9]{0,11})(?:\.([0-9]{1,6}))?$/D', $value), 'WOO_REFUND_AMOUNT_INVALID', 422);
        $parts = explode('.', $value);
        self::need(strlen($parts[1] ?? '') <= $decimals, 'WOO_REFUND_DECIMALS_CHANGED', 422);
        $digits = ltrim($parts[0] . str_pad($parts[1] ?? '', $decimals, '0'), '0');
        $digits = $digits === '' ? '0' : $digits;
        self::need(self::compare($digits, '9007199254740991') <= 0, 'WOO_REFUND_AMOUNT_TOO_LARGE', 422);
        return (int) $digits;
    }
    static function money($value, $decimals) {
        $formatted = wc_format_decimal($value, $decimals);
        self::minor($formatted, $decimals); return $formatted;
    }
    static function rows($order_id) {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare('SELECT * FROM ' . self::table() .
            ' WHERE order_id=%d ORDER BY created_at,adjustment_id', $order_id));
        self::need(!$wpdb->last_error && is_array($rows), 'REFUND_JOURNAL_UNAVAILABLE', 503);
        return $rows;
    }
    static function row($id) {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::table() . ' WHERE adjustment_id=%s', $id));
        self::need(!$wpdb->last_error, 'REFUND_JOURNAL_UNAVAILABLE', 503); return $row;
    }
    static function row_view($row) {
        $payload = self::decoded($row->payload);
        return ['adjustmentId' => $row->adjustment_id, 'orderReference' => (string) $row->order_id,
            'eventId' => $row->event_id, 'network' => $row->network, 'transactionHash' => $row->refund_tx,
            'status' => $row->status, 'amountAtomic' => $row->amount_atomic,
            'wooAmount' => $row->woo_amount, 'currency' => $row->currency,
            'reviewSha256' => $row->review_sha256, 'refundId' => $row->refund_id ? (string) $row->refund_id : null,
            'sourceSha256' => $payload['sourceSha256'], 'requestSha256' => $payload['requestSha256'],
            'originalTransactionHash' => $payload['originalTransactionHash'],
            'reason' => $payload['reason'], 'reviewedRefund' => $payload['reviewedRefund'],
            'createdAt' => $row->created_at, 'updatedAt' => $row->updated_at,
            'history' => self::decoded($row->history)];
    }
    static function snapshot($order) {
        self::need($order && !is_a($order, 'WC_Order_Refund'), 'ORDER_NOT_FOUND', 404);
        $source = Starforge_SF104_Merchant_Operator::snapshot($order);
        $decimals = wc_get_price_decimals();
        self::need(is_int($decimals) && $decimals >= 0 && $decimals <= 6, 'WOO_PRICE_SCALE_UNSUPPORTED');
        $refunds = [];
        foreach ($order->get_refunds() as $refund) {
            $meta = $refund->get_meta(self::META, true);
            $refunds[] = ['id' => (string) $refund->get_id(),
                'amount' => self::money($refund->get_amount(), $decimals),
                'currency' => $refund->get_currency(), 'reason' => $refund->get_reason(),
                'adjustmentId' => is_array($meta) ? ($meta['adjustmentId'] ?? null) : null,
                'transactionHash' => is_array($meta) ? ($meta['transactionHash'] ?? null) : null,
                'reviewSha256' => is_array($meta) ? ($meta['reviewSha256'] ?? null) : null];
        }
        usort($refunds, static function ($a, $b) { return (int) $a['id'] <=> (int) $b['id']; });
        $event = $source['content']['event'];
        $view = ['schema' => self::VIEW_SCHEMA, 'siteUrl' => $source['siteUrl'],
            'orderReference' => $source['orderReference'], 'identitySha256' => $source['identitySha256'],
            'originalPayment' => ['eventId' => $event['id'] ?? null,
                'transactionHash' => $event['transactionHash'] ?? null, 'state' => $event['state'] ?? null,
                'binding' => $source['content']['identity']['binding'],
                'reviewedTransfer' => $source['nativeReview']['reviewedTransfer'] ?? null],
            'order' => ['currency' => $order->get_currency(), 'status' => $order->get_status(),
                'transactionHash' => $order->get_transaction_id() ?: null,
                'total' => self::money($order->get_total(), $decimals),
                'refundedTotal' => self::money($order->get_total_refunded(), $decimals),
                'remainingTotal' => self::money(max(0, $order->get_remaining_refund_amount()), $decimals),
                'priceDecimals' => $decimals, 'downloadsPermitted' => (bool) $order->is_download_permitted()],
            'refunds' => $refunds,
            'adjustments' => array_map([__CLASS__, 'row_view'], self::rows($order->get_id()))];
        $view['revision'] = Starforge_SF104_Checkout::digest($view);
        $view['observedAt'] = gmdate('c'); return $view;
    }
    static function response($status, $data) {
        return Starforge_SF104_Merchant_Operator::response($status, $data);
    }
    static function dispatch($request, $callback) {
        try {
            self::install();
            self::need(get_option('sf104_refunds_schema') === self::VERSION, 'REFUND_JOURNAL_UNAVAILABLE', 503);
            $id = Starforge_SF104_Merchant_Operator::order_id($request);
            return Starforge_SF104_Checkout::with_order_lock($id, static function () use ($id, $request, $callback) {
                self::clear_order_cache($id);
                $order = wc_get_order($id);
                self::need($order && !is_a($order, 'WC_Order_Refund'), 'ORDER_NOT_FOUND', 404);
                return $callback($order, $request);
            });
        } catch (Throwable $e) {
            $code = $e->getCode();
            $status = preg_match('/^[A-Z][A-Z0-9_]{2,100}$/D', $e->getMessage()) ? $e->getMessage() : 'REFUND_REOPEN_REQUIRED';
            return self::response(in_array($code, [404, 413, 422, 503], true) ? $code : 409,
                ['schema' => self::SCHEMA, 'status' => $status]);
        }
    }
    static function inspect($request) {
        return self::dispatch($request, static function ($order) {
            return self::response(200, self::snapshot($order));
        });
    }
    static function fields($raw, $fields) {
        self::need(is_array($raw), 'REFUND_REQUEST_INVALID', 422);
        $keys = array_keys($raw); sort($keys); sort($fields);
        self::need($keys === $fields, 'REFUND_REQUEST_FIELDS_INVALID', 422);
    }
    static function proof($proof, $payload, $snapshot) {
        self::need(is_array($proof), 'VERIFIED_REFUND_REQUIRED', 422);
        $native = $snapshot['originalPayment']['reviewedTransfer'];
        $binding = $snapshot['originalPayment']['binding'];
        self::need(is_array($native) && is_array($binding) && ($binding['approved'] ?? '') === 'YES',
            'ORIGINAL_NATIVE_REVIEW_REQUIRED');
        $profiles = json_decode((string) file_get_contents(__DIR__ . '/refund-networks.json'), true);
        $profile = is_array($profiles) ? ($profiles[$native['network'] ?? ''] ?? null) : null;
        self::need(is_array($profile), 'ORIGINAL_NETWORK_PROFILE_UNAVAILABLE', 503);
        self::need(($proof['schema'] ?? '') === 'stellar-forge.sf86.refund-reconciliation.v1' &&
            ($proof['origin'] ?? '') === 'MERCHANT_REFUND' &&
            ($proof['reservation'] ?? '') === 'NOT_APPLICABLE_MERCHANT_REFUND' &&
            ($proof['refundId'] ?? '') === $payload['adjustmentId'] &&
            ($proof['network'] ?? '') === $native['network'] &&
            ($proof['networkPassphrase'] ?? '') === $profile['passphrase'] &&
            ($proof['verdict'] ?? '') === $profile['transferVerdict'] &&
            ($proof['source'] ?? '') === $profile['rpcSource'] &&
            in_array($proof['rpcEndpoint'] ?? '', $profile['rpcEndpoints'], true) &&
            ($proof['asset'] ?? '') === $native['asset'] &&
            ($proof['payer'] ?? '') === $native['recipient'] &&
            ($proof['recipient'] ?? '') === $native['payer'] &&
            ($proof['atomicAmount'] ?? '') === $payload['amountAtomic'] &&
            ($proof['matchingTransfers'] ?? null) === 1 &&
            is_int($proof['ledger'] ?? null) && $proof['ledger'] > 0 && $proof['ledger'] <= 9007199254740991 &&
            is_string($proof['matchingEventId'] ?? null) && strlen($proof['matchingEventId']) > 0 &&
            strlen($proof['matchingEventId']) <= 512, 'REFUND_NATIVE_TERMS_MISMATCH');
        foreach (['transaction', 'transactionResultSha256', 'networkResultSha256'] as $name)
            self::need(self::hash_ok($proof[$name] ?? null), 'REFUND_NATIVE_PROOF_INVALID', 422);
        self::need($proof['transaction'] !== $payload['originalTransactionHash'] &&
            is_array($proof['eventPageSha256'] ?? null) && count($proof['eventPageSha256']) >= 1 &&
            count($proof['eventPageSha256']) <= 100, 'REFUND_NATIVE_PROOF_INVALID', 422);
        foreach ($proof['eventPageSha256'] as $hash) self::need(self::hash_ok($hash), 'REFUND_NATIVE_PROOF_INVALID', 422);
        foreach (['observedAt', 'transferAt'] as $date) {
            $value = $proof[$date] ?? null;
            if ($date === 'transferAt' && array_key_exists($date, $proof) && $value === null) continue;
            self::need(is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/D', $value) &&
                strtotime($value) !== false, 'REFUND_NATIVE_DATE_INVALID', 422);
            $normalized = strpos($value, '.') === false ? str_replace('Z', '.000Z', $value) : $value;
            self::need((new DateTimeImmutable($value))->format('Y-m-d\TH:i:s.v\Z') === $normalized,
                'REFUND_NATIVE_DATE_INVALID', 422);
        }
        self::need($snapshot['originalPayment']['state'] === 'RELEASED' &&
            $snapshot['originalPayment']['eventId'] === $payload['eventId'] &&
            $snapshot['originalPayment']['transactionHash'] === $payload['originalTransactionHash'] &&
            $snapshot['order']['transactionHash'] === $payload['originalTransactionHash'] &&
            ($native['transaction'] ?? '') === $payload['originalTransactionHash'] &&
            ($native['network'] ?? '') === ($binding['network'] ?? null) &&
            ($native['atomicAmount'] ?? '') === ($binding['amountAtomic'] ?? null) &&
            hash('sha256', $native['asset']) === ($binding['assetDigest'] ?? null) &&
            hash('sha256', $native['recipient']) === ($binding['recipientDigest'] ?? null),
            'REFUND_ORIGINAL_PAYMENT_CHANGED');
        $event_id = hash('sha256', implode("\n", ['sf98.v1', $binding['routeId'], $binding['method'],
            $native['network'], hash('sha256', $payload['originalTransactionHash'])]));
        self::need(hash_equals($event_id, $payload['eventId']), 'REFUND_ORIGINAL_EVENT_MISMATCH');
    }
    static function prepare_payload($request) {
        self::need(strlen($request->get_body()) <= 65536, 'REFUND_BODY_TOO_LARGE', 413);
        $raw = $request->get_json_params();
        self::fields($raw, ['schema', 'adjustmentId', 'eventId', 'originalTransactionHash',
            'expectedIdentitySha256', 'expectedRevision', 'sourceSha256', 'requestSha256',
            'amountAtomic', 'wooAmount', 'currency', 'reason', 'reviewedRefund', 'confirm']);
        self::need($raw['schema'] === self::SCHEMA && $raw['confirm'] === 'PREPARE_THIS_REFUND' &&
            self::uuid_ok($raw['adjustmentId']), 'REFUND_REQUEST_INVALID', 422);
        foreach (['eventId', 'originalTransactionHash', 'expectedIdentitySha256', 'expectedRevision', 'sourceSha256', 'requestSha256'] as $key)
            self::need(self::hash_ok($raw[$key]), 'REFUND_SOURCE_HASH_INVALID', 422);
        self::need(Starforge_SF98_Woo::amount_ok($raw['amountAtomic']) &&
            is_string($raw['currency']) && preg_match('/^[A-Z0-9]{3,12}$/D', $raw['currency']) &&
            is_string($raw['reason']) && strlen($raw['reason']) >= 1 && strlen($raw['reason']) <= 4000 &&
            !preg_match('/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/', $raw['reason']), 'REFUND_MAPPING_INVALID', 422);
        return $raw;
    }
    static function available($snapshot, $payload, $ignore_id = null) {
        $units = $payload['amountAtomic'];
        $decimals = $snapshot['order']['priceDecimals'];
        $woo = self::minor($payload['wooAmount'], $decimals);
        self::need($woo > 0 && $payload['currency'] === $snapshot['order']['currency'], 'WOO_REFUND_CURRENCY_OR_AMOUNT_CHANGED');
        $reserved = 0;
        foreach ($snapshot['adjustments'] as $row) {
            if ($row['adjustmentId'] === $ignore_id) continue;
            self::need(Starforge_SF98_Woo::amount_ok($row['amountAtomic']), 'REFUND_JOURNAL_INVALID', 503);
            $units = self::add($units, $row['amountAtomic']);
            if (in_array($row['status'], ['PREPARED', 'APPLYING'], true)) {
                // A refund saved before journal completion already reduces Woo remaining.
                $found = array_filter($snapshot['refunds'], static function ($refund) use ($row) {
                    return $refund['adjustmentId'] === $row['adjustmentId'];
                });
                if (!$found) $reserved += self::minor($row['wooAmount'], $decimals);
            }
        }
        self::need(self::compare($units, $snapshot['originalPayment']['binding']['amountAtomic']) <= 0,
            'REFUND_EXCEEDS_ORIGINAL_NATIVE_AMOUNT');
        self::need($woo + $reserved <= self::minor($snapshot['order']['remainingTotal'], $decimals),
            'REFUND_EXCEEDS_REMAINING_WOO_AMOUNT');
    }
    static function history($row, $status, $extra = []) {
        $history = $row ? self::decoded($row->history) : [];
        self::need(count($history) < 500, 'REFUND_HISTORY_LIMIT');
        $history[] = array_merge(['status' => $status, 'at' => gmdate('c'), 'operatorId' => get_current_user_id()], $extra);
        return self::json($history);
    }
    static function prepare($request) {
        return self::dispatch($request, static function ($order, $request) {
            global $wpdb;
            $payload = self::prepare_payload($request); $snapshot = self::snapshot($order);
            self::proof($payload['reviewedRefund'], $payload, $snapshot);
            self::need($snapshot['identitySha256'] === $payload['expectedIdentitySha256'], 'REFUND_ORDER_IDENTITY_CHANGED');
            $payload['wooAmount'] = self::money($payload['wooAmount'], $snapshot['order']['priceDecimals']);
            self::minor($request->get_json_params()['wooAmount'], $snapshot['order']['priceDecimals']);
            $encoded = self::json($payload); $review = hash('sha256', $encoded);
            $prior = self::row($payload['adjustmentId']);
            if ($prior) {
                self::need((string) $prior->order_id === (string) $order->get_id() &&
                    $prior->event_id === $payload['eventId'] && $prior->refund_tx === $payload['reviewedRefund']['transaction'] &&
                    $prior->amount_atomic === $payload['amountAtomic'], 'REFUND_IDENTITY_CONFLICT');
                if (hash_equals($prior->review_sha256, $review)) return self::response(200, [
                    'schema' => self::SCHEMA, 'status' => 'ALREADY_PREPARED',
                    'adjustment' => self::row_view($prior), 'order' => $snapshot]);
                // Same selected native refund can have its uncommitted Woo allocation reviewed again.
                self::need($prior->status === 'PREPARED', 'REFUND_MAPPING_ALREADY_COMMITTED');
            }
            self::need($snapshot['revision'] === $payload['expectedRevision'], 'REFUND_ORDER_REVISION_CHANGED');
            self::available($snapshot, $payload, $payload['adjustmentId']);
            $record = ['order_id' => $order->get_id(), 'event_id' => $payload['eventId'],
                'network' => $payload['reviewedRefund']['network'], 'refund_tx' => $payload['reviewedRefund']['transaction'],
                'status' => 'PREPARED', 'amount_atomic' => $payload['amountAtomic'], 'woo_amount' => $payload['wooAmount'],
                'currency' => $payload['currency'], 'review_sha256' => $review, 'payload' => $encoded,
                'history' => self::history($prior, 'PREPARED', ['reviewSha256' => $review,
                    'wooAmount' => $payload['wooAmount'], 'currency' => $payload['currency'],
                    'sourceSha256' => $payload['sourceSha256'], 'reason' => $payload['reason']]),
                'updated_at' => current_time('mysql', true)];
            if ($prior) $saved = $wpdb->update(self::table(), $record,
                ['adjustment_id' => $payload['adjustmentId'], 'status' => 'PREPARED', 'review_sha256' => $prior->review_sha256]);
            else $saved = $wpdb->insert(self::table(), array_merge($record,
                ['adjustment_id' => $payload['adjustmentId'], 'created_at' => current_time('mysql', true)]));
            self::need($saved === 1, 'REFUND_ID_OR_TRANSFER_ALREADY_ASSIGNED');
            $row = self::row($payload['adjustmentId']);
            return self::response(200, ['schema' => self::SCHEMA, 'status' => 'PREPARED',
                'adjustment' => self::row_view($row), 'order' => self::snapshot(wc_get_order($order->get_id()))]);
        });
    }
    static function find_refund($order, $row) {
        $found = [];
        foreach ($order->get_refunds() as $refund) {
            $meta = $refund->get_meta(self::META, true);
            if (is_array($meta) && ($meta['adjustmentId'] ?? '') === $row->adjustment_id) $found[] = $refund;
        }
        self::need(count($found) <= 1, 'DUPLICATE_WOO_REFUND_RECONCILIATION_REQUIRED');
        if (!$found) return null;
        $refund = $found[0]; $meta = $refund->get_meta(self::META, true);
        self::need(($meta['reviewSha256'] ?? '') === $row->review_sha256 &&
            ($meta['transactionHash'] ?? '') === $row->refund_tx &&
            ($meta['eventId'] ?? '') === $row->event_id &&
            (string) $refund->get_parent_id() === (string) $row->order_id &&
            self::money($refund->get_amount(), wc_get_price_decimals()) === $row->woo_amount &&
            $refund->get_currency() === $row->currency, 'WOO_REFUND_RECORD_CHANGED');
        if ($row->refund_id) self::need((string) $refund->get_id() === (string) $row->refund_id, 'WOO_REFUND_ID_CHANGED');
        return $refund;
    }
    static function finish($order, $row, $refund, $status) {
        global $wpdb;
        $current = wc_get_order($order->get_id());
        // A completed child survives an interrupted HTTP response. Never call
        // wc_create_refund again when its same saved metadata is already present.
        if ($status === 'RECOVERED' && $current->get_remaining_refund_amount() <= 0 &&
            !apply_filters('woocommerce_order_is_partially_refunded', false, $current->get_id(), $refund->get_id()) &&
            !$current->has_status('refunded')) {
            $next = apply_filters('woocommerce_order_fully_refunded_status', 'refunded',
                $current->get_id(), $refund->get_id());
            if ($next) self::need($current->update_status($next), 'WOO_REFUND_STATUS_REOPEN_REQUIRED');
        }
        if ($row->status !== 'APPLIED') {
            $saved = $wpdb->update(self::table(), ['status' => 'APPLIED', 'refund_id' => $refund->get_id(),
                'history' => self::history($row, 'APPLIED', ['refundId' => (string) $refund->get_id(), 'result' => $status]),
                'updated_at' => current_time('mysql', true)],
                ['adjustment_id' => $row->adjustment_id, 'review_sha256' => $row->review_sha256]);
            self::need($saved === 1, 'WOO_REFUND_SAVED_REOPEN_REQUIRED');
        }
        return self::response(200, ['schema' => self::SCHEMA, 'status' => $status,
            'adjustment' => self::row_view(self::row($row->adjustment_id)),
            'order' => self::snapshot(wc_get_order($order->get_id()))]);
    }
    /** Only native SQL stores with transactional tables can join the Woo child and journal. */
    static function transactional_storage($order) {
        global $wpdb;
        $order_store = $order->get_data_store()->get_current_class_name();
        $refund_store = WC_Data_Store::load('order-refund')->get_current_class_name();
        $hpos = 'Automattic\\WooCommerce\\Internal\\DataStores\\Orders\\';
        self::need(in_array($order_store, ['WC_Order_Data_Store_CPT', $hpos . 'OrdersTableDataStore'], true) &&
            in_array($refund_store, ['WC_Order_Refund_Data_Store_CPT', $hpos . 'OrdersTableRefundDataStore'], true),
            'REFUND_TRANSACTIONAL_STORE_REQUIRED', 503);
        $required = [self::table(), $wpdb->posts, $wpdb->postmeta, $wpdb->comments, $wpdb->commentmeta,
            $wpdb->options, $wpdb->prefix . 'woocommerce_order_items', $wpdb->prefix . 'woocommerce_order_itemmeta',
            $wpdb->prefix . 'woocommerce_downloadable_product_permissions'];
        $custom = array_map(static function ($name) use ($wpdb) { return $wpdb->prefix . $name; },
            ['wc_orders', 'wc_order_addresses', 'wc_order_operational_data', 'wc_orders_meta']);
        if ($order_store === $hpos . 'OrdersTableDataStore') $required = array_merge($required, $custom);
        $optional = array_map(static function ($name) use ($wpdb) { return $wpdb->prefix . $name; },
            ['wc_order_stats', 'wc_order_product_lookup', 'wc_order_tax_lookup', 'wc_order_coupon_lookup',
             'wc_customer_lookup', 'wc_download_log', 'sf98_woo_events', 'sf104_checkout_attempts',
             'actionscheduler_actions', 'actionscheduler_claims',
             'actionscheduler_groups', 'actionscheduler_logs']);
        $tables = array_values(array_unique(array_merge($required, $custom, $optional)));
        $marks = implode(',', array_fill(0, count($tables), '%s'));
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ({$marks})", $tables));
        self::need(!$wpdb->last_error && is_array($rows), 'REFUND_STORAGE_INSPECTION_FAILED', 503);
        $found = [];
        foreach ($rows as $row) {
            self::need(strtoupper((string) $row->engine) === 'INNODB', 'REFUND_INNODB_TABLES_REQUIRED', 503);
            $found[$row->name] = true;
        }
        foreach ($required as $table) self::need(isset($found[$table]), 'REFUND_NATIVE_TABLE_MISSING', 503);
        return $order_store === $hpos . 'OrdersTableDataStore' ? $wpdb->prefix . 'wc_orders' : $wpdb->posts;
    }
    /** Refresh only the selected order and children after commit, rollback, or a lost response. */
    static function clear_order_cache($order_id, $refund_ids = []) {
        $ids = array_values(array_unique(array_merge([(int) $order_id], array_map('intval', $refund_ids))));
        foreach ($ids as $id) {
            clean_post_cache($id);
            if (class_exists('Automattic\\WooCommerce\\Caches\\OrderCache'))
                wc_get_container()->get('Automattic\\WooCommerce\\Caches\\OrderCache')->remove($id);
        }
        wp_cache_delete(WC_Cache_Helper::get_cache_prefix('orders') . 'refund_ids' . $order_id, 'orders');
        $store = WC_Data_Store::load('order');
        if (method_exists($store->get_current_class_name(), 'clear_cached_data')) $store->clear_cached_data($ids);
    }
    static function atomic($order, $callback) {
        global $wpdb;
        $order_table = self::transactional_storage($order);
        self::need((string) $wpdb->get_var('SELECT @@SESSION.autocommit') === '1' && !$wpdb->last_error,
            'REFUND_TRANSACTION_CONTEXT_UNAVAILABLE', 503);
        // SET TRANSACTION without SESSION fails inside an existing transaction.
        // It therefore cannot implicitly commit a caller's unrelated work.
        self::need($wpdb->query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ') !== false,
            'REFUND_TRANSACTION_CONTEXT_UNAVAILABLE', 503);
        $retries = $wpdb->reconnect_retries;
        self::need(is_int($retries), 'REFUND_CONNECTION_GUARD_UNAVAILABLE', 503);
        $wpdb->reconnect_retries = 0; // A lost connection must not resume writes in autocommit mode.
        $started = false; $refund_ids = [];
        $created = static function ($id, $refund = null) use ($order, &$refund_ids) {
            if (!$refund || (string) $refund->get_parent_id() === (string) $order->get_id()) $refund_ids[] = (int) $id;
        };
        $guard = static function ($query) use ($wpdb) {
            // wpdb runs this filter before clearing last_error for the next query.
            self::need(!$wpdb->last_error, 'REFUND_DATABASE_WRITE_FAILED', 503);
            // Refund hooks may perform normal data operations, but cannot end this
            // transaction, run DDL, or call an opaque stored procedure within it.
            self::need(preg_match('/^\s*(?:SELECT|INSERT|UPDATE|DELETE|REPLACE|SHOW|DESCRIBE|EXPLAIN|WITH)\b/i', $query),
                'REFUND_TRANSACTION_CONTROL_CONFLICT', 503);
            return $query;
        };
        try {
            self::need($wpdb->query('START TRANSACTION') !== false, 'REFUND_TRANSACTION_START_FAILED', 503);
            $started = true;
            self::need($wpdb->query('SAVEPOINT sf104_refund_atomic') !== false, 'REFUND_TRANSACTION_START_FAILED', 503);
            add_filter('query', $guard, PHP_INT_MAX);
            add_action('woocommerce_new_order_refund', $created, 1, 2);
            $column = $order_table === $wpdb->posts ? 'ID' : 'id';
            self::need((string) $wpdb->get_var($wpdb->prepare(
                "SELECT {$column} FROM {$order_table} WHERE {$column}=%d FOR UPDATE", $order->get_id())) === (string) $order->get_id(),
                'REFUND_ORDER_CHANGED');
            self::clear_order_cache($order->get_id());
            $result = $callback(wc_get_order($order->get_id()));
            self::need(!$wpdb->last_error, 'REFUND_DATABASE_WRITE_FAILED', 503);
            remove_filter('query', $guard, PHP_INT_MAX);
            // The savepoint also detects a lost/ended transaction before completion.
            self::need($wpdb->query('RELEASE SAVEPOINT sf104_refund_atomic') !== false,
                'REFUND_TRANSACTION_REOPEN_REQUIRED', 503);
            self::need($wpdb->query('COMMIT') !== false, 'REFUND_COMMIT_REOPEN_REQUIRED', 503);
            $started = false;
            return $result;
        } finally {
            remove_filter('query', $guard, PHP_INT_MAX);
            remove_action('woocommerce_new_order_refund', $created, 1);
            if ($started) $wpdb->query('ROLLBACK');
            $wpdb->reconnect_retries = $retries;
            self::clear_order_cache($order->get_id(), $refund_ids);
        }
    }
    static function apply($request) {
        return self::dispatch($request, static function ($order, $request) {
            return self::atomic($order, static function ($order) use ($request) {
                global $wpdb;
                self::need(strlen($request->get_body()) <= 4096, 'REFUND_BODY_TOO_LARGE', 413);
                $payload = $request->get_json_params();
                self::fields($payload, ['schema', 'adjustmentId', 'reviewSha256', 'expectedRevision', 'confirm']);
                self::need($payload['schema'] === self::SCHEMA && $payload['confirm'] === 'RECORD_THIS_REFUND' &&
                    self::uuid_ok($payload['adjustmentId']) && self::hash_ok($payload['reviewSha256']) &&
                    self::hash_ok($payload['expectedRevision']), 'REFUND_APPLY_INVALID', 422);
                $row = self::row($payload['adjustmentId']);
                self::need($row && (string) $row->order_id === (string) $order->get_id() &&
                    hash_equals($row->review_sha256, $payload['reviewSha256']), 'REFUND_REVIEW_CHANGED');
                $original = self::decoded($row->payload); $snapshot = self::snapshot($order);
                self::need($snapshot['identitySha256'] === $original['expectedIdentitySha256'], 'REFUND_ORDER_IDENTITY_CHANGED');
                self::proof($original['reviewedRefund'], $original, $snapshot);
                $existing = self::find_refund($order, $row);
                if ($existing) return self::finish($order, $row, $existing, $row->status === 'APPLIED' ? 'ALREADY_APPLIED' : 'RECOVERED');
                self::need($row->status !== 'APPLIED', 'WOO_REFUND_MISSING_RECONCILIATION_REQUIRED');
                self::need(in_array($row->status, ['PREPARED', 'APPLYING'], true), 'REFUND_STATE_INVALID');
                self::need($snapshot['revision'] === $payload['expectedRevision'], 'REFUND_ORDER_REVISION_CHANGED');
                self::available($snapshot, $original, $row->adjustment_id);
                $saved = $wpdb->update(self::table(), ['status' => 'APPLYING',
                    'history' => self::history($row, 'APPLYING'),
                    'updated_at' => current_time('mysql', true)],
                    ['adjustment_id' => $row->adjustment_id, 'review_sha256' => $row->review_sha256, 'status' => $row->status]);
                self::need($saved === 1, 'REFUND_APPLY_STATE_CHANGED');
                // Woo update_taxes() already saves the child before this hook.
                // The enclosing transaction covers every early save and its identity.
                $stamp = static function ($refund, $args) use ($row) {
                    if ((string) ($args['order_id'] ?? '') === (string) $row->order_id &&
                        ($args['sf104_adjustment_id'] ?? '') === $row->adjustment_id) {
                        $refund->update_meta_data(self::META, ['schema' => self::SCHEMA,
                            'adjustmentId' => $row->adjustment_id, 'eventId' => $row->event_id,
                            'transactionHash' => $row->refund_tx, 'amountAtomic' => $row->amount_atomic,
                            'reviewSha256' => $row->review_sha256]);
                    }
                };
                add_action('woocommerce_create_refund', $stamp, 10, 2);
                try {
                    $refund = wc_create_refund(['order_id' => $order->get_id(), 'amount' => $row->woo_amount,
                        'reason' => $original['reason'], 'refund_payment' => false,
                        'restock_items' => false, 'line_items' => [], 'sf104_adjustment_id' => $row->adjustment_id]);
                } finally { remove_action('woocommerce_create_refund', $stamp, 10); }
                self::need(!is_wp_error($refund) && is_a($refund, 'WC_Order_Refund') && $refund->get_id() > 0,
                    'WOO_REFUND_CREATE_REOPEN_REQUIRED');
                $fresh = wc_get_order($order->get_id());
                $verified = self::find_refund($fresh, $row);
                self::need($verified && $verified->get_id() === $refund->get_id(), 'WOO_REFUND_SAVED_REOPEN_REQUIRED');
                return self::finish($fresh, self::row($row->adjustment_id), $verified, 'APPLIED');
            });
        });
    }
}
Starforge_SF104_Merchant_Refunds::boot();
