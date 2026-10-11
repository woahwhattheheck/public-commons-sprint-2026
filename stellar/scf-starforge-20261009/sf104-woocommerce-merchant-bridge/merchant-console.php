<?php
/** Native merchant administration around the original Woo checkout and SF98 handlers. */
if (!defined('ABSPATH')) { exit; }

final class Starforge_SF104_Merchant_Console {
    const VERSION = '0.4.0';
    const API = '/merchant-console';
    const HANDOFF_SCHEMA = 'stellar-forge.sf104.merchant-handoff.v1';

    static function boot() {
        add_action('admin_enqueue_scripts', [__CLASS__, 'assets']);
        add_action('rest_api_init', [__CLASS__, 'rest']);
        add_filter('woocommerce_order_query_args', [__CLASS__, 'hpos_query']);
        add_filter('woocommerce_order_data_store_cpt_get_orders_query', [__CLASS__, 'legacy_query'], 10, 2);
        add_filter('woocommerce_product_data_store_cpt_get_products_query', [__CLASS__, 'product_query'], 10, 2);
    }

    static function is_hpos() {
        return class_exists('Automattic\WooCommerce\Utilities\OrderUtil') &&
            \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled();
    }

    static function binding_query() {
        return ['relation' => 'OR',
            ['key' => Starforge_SF98_Woo::META_READY, 'compare' => 'EXISTS'],
            ['key' => Starforge_SF104_Checkout::SNAPSHOT_META, 'compare' => 'EXISTS']];
    }

    static function hpos_query($args) {
        if (!empty($args['sf104_console_bound']) && self::is_hpos()) {
            $args['meta_query'] = isset($args['meta_query']) ? ['relation' => 'AND', $args['meta_query'], self::binding_query()] : self::binding_query();
            unset($args['sf104_console_bound']);
        }
        return $args;
    }

    static function legacy_query($query, $vars) {
        if (!empty($vars['sf104_console_bound'])) $query['meta_query'][] = self::binding_query();
        return $query;
    }

    static function product_query($query, $vars) {
        if (!empty($vars['sf104_console_mapped'])) $query['meta_query'][] = [
            'key' => Starforge_SF104_Checkout::PRODUCT_META, 'compare' => 'EXISTS'];
        return $query;
    }

    static function permission() {
        if (!current_user_can('manage_woocommerce')) return new WP_Error('sf104_forbidden', 'A WooCommerce manager account is required.', ['status' => 403]);
        if (!function_exists('wc_get_order')) return new WP_Error('sf104_woo_missing', 'WooCommerce is not active.', ['status' => 503]);
        return true;
    }

    static function rest() {
        foreach ([
            ['GET', '', 'status'],
            ['GET', '/orders', 'orders'],
            ['GET', '/orders/(?P<id>[1-9][0-9]{0,17})', 'order'],
            ['GET', '/orders/(?P<id>[1-9][0-9]{0,17})/notes', 'notes'],
            ['POST', '/orders/(?P<id>[1-9][0-9]{0,17})/notes', 'add_note'],
            ['GET', '/products', 'products'],
            ['POST', '/handoff', 'handoff'],
        ] as $route) {
            $method = $route[2];
            register_rest_route('stellar-forge/v1', self::API . $route[1], [
                'methods' => $route[0], 'permission_callback' => [__CLASS__, 'permission'],
                'callback' => static function ($request) use ($method) {
                    try { return self::reply(call_user_func([__CLASS__, $method], $request)); }
                    catch (Throwable $e) {
                        $code = in_array((int) $e->getCode(), [400, 403, 404, 409, 422, 503], true) ? (int) $e->getCode() : 503;
                        return self::reply(['error' => 'sf104_console_error', 'message' => $e->getMessage()], $code);
                    }
                },
            ]);
        }
    }

    static function reply($data, $status = 200) {
        $response = new WP_REST_Response($data, $status);
        $response->header('Cache-Control', 'no-store, private');
        $response->header('X-Content-Type-Options', 'nosniff');
        return $response;
    }

    static function integer($value, $fallback, $min, $max) {
        if ($value === null || $value === '') return $fallback;
        if ((!is_string($value) && !is_int($value)) || !preg_match('/^[0-9]+$/D', (string) $value)) throw new RuntimeException('Use a whole number for the requested page or limit.', 400);
        $n = (int) $value;
        if ($n < $min || $n > $max) throw new RuntimeException('The requested number is outside the supported range.', 400);
        return $n;
    }

    static function order_id($value) {
        if ((!is_string($value) && !is_int($value)) || !preg_match('/^[1-9][0-9]{0,17}$/D', (string) $value)) throw new RuntimeException('Enter the native numeric WooCommerce order ID.', 400);
        return (int) $value;
    }

    static function utc($date) {
        if (!$date) return null;
        return method_exists($date, 'getTimestamp') ? gmdate('Y-m-d\TH:i:s\Z', $date->getTimestamp()) : null;
    }

    static function retained_time($value) {
        if (!is_string($value) || $value === '') return null;
        if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/D', $value)) return str_replace(' ', 'T', $value) . 'Z';
        $time = strtotime($value);
        return $time === false ? $value : gmdate('Y-m-d\TH:i:s\Z', $time);
    }

    static function origin_or_null() {
        try { return Starforge_SF104_Checkout::store_origin(); }
        catch (Throwable $e) { return null; }
    }

    static function db_check() {
        global $wpdb;
        if ($wpdb->last_error) throw new RuntimeException('The merchant journal could not be read. Check the database connection and original plugin tables, then refresh.', 503);
    }

    static function rows($table, $ids) {
        global $wpdb;
        if (!$ids) return [];
        $marks = implode(',', array_fill(0, count($ids), '%d'));
        $found = $wpdb->get_results($wpdb->prepare("SELECT * FROM {$table} WHERE order_id IN ({$marks})", ...$ids), ARRAY_A);
        self::db_check();
        $result = [];
        foreach ($found as $row) $result[(string) $row['order_id']] = $row;
        return $result;
    }

    static function event($id) {
        $row = Starforge_SF104_Checkout::event_for_order($id);
        return $row ? (array) $row : null;
    }

    static function attempt($id) {
        $row = Starforge_SF104_Admission::row($id);
        return $row ? (array) $row : null;
    }

    static function status($request = null) {
        global $wpdb;
        $health = [];
        $counts = ['notices' => [], 'attempts' => []];
        foreach (['notices' => Starforge_SF98_Woo::table(), 'attempts' => Starforge_SF104_Admission::table()] as $kind => $table) {
            $exists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table)));
            if ($wpdb->last_error || $exists !== $table) {
                $health[] = ['code' => $kind . '_store', 'ready' => false, 'message' => 'The original ' . $kind . ' table is unavailable. Reopen the plugin administration after checking installation and the database.'];
                continue;
            }
            $rows = $wpdb->get_results("SELECT state,COUNT(*) AS count FROM {$table} GROUP BY state", ARRAY_A);
            self::db_check();
            foreach ($rows as $row) $counts[$kind][$row['state']] = (int) $row['count'];
            $health[] = ['code' => $kind . '_store', 'ready' => true, 'message' => 'Original ' . $kind . ' table is available.'];
        }
        $origin = null;
        try { $origin = Starforge_SF104_Checkout::store_origin(); $health[] = ['code' => 'origin', 'ready' => true, 'message' => 'The store has a valid HTTPS origin.']; }
        catch (Throwable $e) { $health[] = ['code' => 'origin', 'ready' => false, 'message' => $e->getMessage()]; }
        $secret = Starforge_SF98_Woo::secret() !== null;
        $health[] = ['code' => 'secret', 'ready' => $secret, 'message' => $secret ? 'The WordPress SF98 signing secret is configured.' : 'Define SF98_WEBHOOK_SECRET in wp-config.php and configure the same private value for the original Node seller and sender.'];
        $settings = get_option('woocommerce_sf104_native_settings', []);
        $enabled = is_array($settings) && ($settings['enabled'] ?? 'no') === 'yes';
        $health[] = ['code' => 'gateway', 'ready' => $enabled, 'message' => $enabled ? 'Stellar checkout is enabled for configured products.' : 'Enable Stellar checkout in the existing WooCommerce payment settings after completing a product mapping.'];
        return ['version' => self::VERSION, 'observedAt' => gmdate('Y-m-d\TH:i:s\Z'),
            'wordpress' => get_bloginfo('version'), 'woocommerce' => defined('WC_VERSION') ? WC_VERSION : null,
            'php' => PHP_VERSION, 'orderStorage' => self::is_hpos() ? 'HPOS' : 'Legacy posts',
            'storeOrigin' => $origin, 'currency' => get_woocommerce_currency(), 'health' => $health,
            'counts' => $counts, 'endpoints' => ['admission' => rest_url('stellar-forge/v1/checkout-admission'), 'settlement' => rest_url('stellar-forge/v1/settlement')],
            'links' => ['gateway' => admin_url('admin.php?page=wc-settings&tab=checkout&section=sf104_native'),
                'newProduct' => admin_url('post-new.php?post_type=product'), 'permalinks' => admin_url('options-permalink.php')],
            'operator' => ['id' => get_current_user_id(), 'name' => wp_get_current_user()->display_name]];
    }

    static function selected_order($id) {
        $order = wc_get_order($id);
        if (!$order || $order->get_type() === 'shop_order_refund') throw new RuntimeException('That original WooCommerce order is unavailable.', 404);
        return $order;
    }

    static function orders($request) {
        global $wpdb;
        $page = self::integer($request->get_param('page'), 1, 1, 1000000);
        $limit = self::integer($request->get_param('limit'), 25, 1, 100);
        $scope = $request->get_param('scope') ?: 'checkout';
        if (!in_array($scope, ['checkout', 'bound', 'notices', 'attempts'], true)) throw new RuntimeException('Select an existing order queue.', 400);
        $state = $request->get_param('state') ?: '';
        if (!is_string($state)) throw new RuntimeException('Select a valid queue status.', 400);
        $sort = $request->get_param('sort') === 'oldest' ? 'ASC' : 'DESC';
        $search = $request->get_param('orderId');
        if ($search !== null && $search !== '') {
            $id = self::order_id($search);
            $order = self::selected_order($id);
            $event = self::event($id); $attempt = self::attempt($id);
            if ($order->get_payment_method() !== Starforge_SF104_Checkout::ID &&
                !$order->get_meta(Starforge_SF98_Woo::META_READY, true) &&
                !$order->get_meta(Starforge_SF104_Checkout::SNAPSHOT_META, true) && !$event && !$attempt) {
                return ['scope' => $scope, 'page' => 1, 'limit' => $limit, 'total' => 0, 'pages' => 0, 'orders' => [],
                    'message' => 'This Woo order has no Stellar checkout, binding, attempt or notice. Use the existing manual prebinding form when it is the intended merchant order.'];
            }
            return ['scope' => $scope, 'page' => 1, 'limit' => $limit, 'total' => 1, 'pages' => 1,
                'orders' => [self::describe($order, $event, $attempt, false)], 'observedAt' => gmdate('Y-m-d\TH:i:s\Z')];
        }
        $ids = []; $orders = []; $total = 0;
        if ($scope === 'checkout' || $scope === 'bound') {
            $args = ['type' => 'shop_order', 'limit' => $limit, 'paged' => $page, 'paginate' => true, 'orderby' => 'ID', 'order' => $sort];
            if ($scope === 'checkout') $args['payment_method'] = Starforge_SF104_Checkout::ID;
            else $args['sf104_console_bound'] = true;
            if ($state !== '') {
                if (!array_key_exists('wc-' . $state, wc_get_order_statuses())) throw new RuntimeException('Select a current WooCommerce order status.', 400);
                $args['status'] = $state;
            }
            $result = wc_get_orders($args);
            $orders = $result->orders; $total = (int) $result->total;
            foreach ($orders as $order) $ids[] = (int) $order->get_id();
        } else {
            $allowed = $scope === 'notices' ? ['RECEIVED', 'REVIEWING', 'RELEASED'] : ['RESERVED', 'RESET'];
            if ($state !== '' && !in_array($state, $allowed, true)) throw new RuntimeException('Select a valid native journal state.', 400);
            $table = $scope === 'notices' ? Starforge_SF98_Woo::table() : Starforge_SF104_Admission::table();
            $where = $state === '' ? '' : $wpdb->prepare(' WHERE state=%s', $state);
            $total = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$table}{$where}");
            self::db_check();
            $ids = array_map('intval', $wpdb->get_col($wpdb->prepare("SELECT order_id FROM {$table}{$where} ORDER BY order_id {$sort} LIMIT %d OFFSET %d", $limit, ($page - 1) * $limit)));
            self::db_check();
            foreach ($ids as $id) $orders[] = wc_get_order($id);
        }
        $events = self::rows(Starforge_SF98_Woo::table(), $ids);
        $attempts = self::rows(Starforge_SF104_Admission::table(), $ids);
        $items = [];
        foreach ($orders as $i => $order) {
            $id = $order ? (string) $order->get_id() : (string) $ids[$i];
            if (!$order) {
                $items[] = ['id' => $id, 'number' => $id, 'missing' => true, 'lifecycle' => ['code' => 'ORDER_UNAVAILABLE', 'label' => 'Woo order unavailable', 'detail' => 'The original journal still exists; restore or locate this original order before a financial action.'],
                    'notice' => $events[$id] ?? null, 'attempt' => $attempts[$id] ?? null];
            } else $items[] = self::describe($order, $events[$id] ?? null, $attempts[$id] ?? null, false);
        }
        return ['scope' => $scope, 'page' => $page, 'limit' => $limit, 'total' => $total, 'pages' => (int) ceil($total / $limit),
            'orders' => $items, 'observedAt' => gmdate('Y-m-d\TH:i:s\Z')];
    }

    static function describe($order, $event, $attempt, $detail) {
        $id = (string) $order->get_id();
        $binding = $order->get_meta(Starforge_SF98_Woo::META_READY, true);
        $record = $order->get_meta(Starforge_SF104_Checkout::SNAPSHOT_META, true);
        $binding = is_array($binding) ? $binding : null;
        $snapshot = ['present' => !empty($record), 'valid' => false, 'error' => null, 'digest' => is_array($record) ? ($record['digest'] ?? null) : null];
        $requires_snapshot = $order->get_payment_method() === Starforge_SF104_Checkout::ID || !empty($record);
        if ($requires_snapshot) {
            try { Starforge_SF104_Checkout::snapshot($order); $snapshot['valid'] = true; }
            catch (Throwable $e) { $snapshot['error'] = $e->getMessage(); }
        }
        $items = [];
        foreach ($order->get_items('line_item') as $item) $items[] = [
            'id' => (string) $item->get_id(), 'productId' => (string) $item->get_product_id(), 'variationId' => (string) $item->get_variation_id(),
            'name' => wp_strip_all_tags($item->get_name()), 'quantity' => (string) $item->get_quantity(),
            'subtotal' => (string) $item->get_subtotal(), 'total' => (string) $item->get_total(), 'tax' => (string) $item->get_total_tax()];
        $base = ['id' => $id, 'number' => (string) $order->get_order_number(), 'status' => $order->get_status(),
            'statusLabel' => wc_get_order_status_name($order->get_status()), 'paid' => $order->is_paid(),
            'currency' => (string) $order->get_currency(), 'total' => (string) $order->get_total(),
            'tax' => (string) $order->get_total_tax(), 'discount' => (string) $order->get_discount_total(),
            'shipping' => (string) $order->get_shipping_total(), 'paymentMethod' => $order->get_payment_method(),
            'createdAt' => self::utc($order->get_date_created()), 'updatedAt' => self::utc($order->get_date_modified()),
            'paidAt' => self::utc($order->get_date_paid()), 'transactionId' => (string) $order->get_transaction_id(),
            'items' => $items, 'binding' => $binding, 'snapshot' => $snapshot, 'notice' => $event, 'attempt' => $attempt,
            'orderUrl' => $order->get_edit_order_url()];
        $base['stateDigest'] = Starforge_SF104_Checkout::digest([
            'order' => $base, 'snapshotRecord' => $record ?: null]);
        $closed = !in_array($order->get_status(), ['pending', 'on-hold'], true);
        $changed = $requires_snapshot && !$snapshot['valid'];
        if ($event && $event['state'] === 'RELEASED') {
            $same = $order->is_paid() && strtolower((string) $order->get_transaction_id()) === (string) $event['tx_hash'];
            $life = $same ? ['RELEASED', 'Woo release recorded', 'The original notice journal and Woo paid transaction agree.'] :
                ['RELEASE_STATE_CHANGED', 'Released order needs review', 'The original journal says released, while the current Woo paid state or transaction differs.'];
        } elseif ($changed) $life = ['ORDER_CHANGED', 'Saved order differs', $snapshot['error']];
        elseif ($event && $event['state'] === 'REVIEWING') $life = ['REVIEWING', 'Release in progress / recovery', 'Reconcile the recorded transaction before continuing the original release.'];
        elseif ($event) $life = ['NOTICE_RECEIVED', 'Settlement review required', 'An authenticated SF98 notice is retained. The merchant still verifies the original transfer before releasing this order.'];
        elseif ($order->is_paid() || $order->get_transaction_id()) $life = ['OTHER_PAID_STATE', 'Woo payment needs reconciliation', 'Woo has a payment or transaction without an original released SF98 notice.'];
        elseif ($closed) $life = ['ORDER_CLOSED', 'Order is not payable', 'Current Woo status is ' . $order->get_status() . '; inspect the original order and any attempt.'];
        elseif ($attempt && $attempt['state'] === 'RESERVED') $life = ['ATTEMPT_RESERVED', 'Payment attempt reserved', 'Keep this original attempt until independent settlement reconciliation is complete.'];
        elseif ($attempt && $attempt['state'] === 'RESET') $life = ['READY_AFTER_RESET', 'Ready for approved new attempt', 'The merchant approved a new generation while preserving the original order terms.'];
        elseif ($snapshot['valid']) $life = ['AWAITING_PAYMENT', 'Awaiting native payment', 'The frozen buyer instructions are available for this original order.'];
        elseif ($binding) $life = ['BOUND_ORDER', 'Awaiting original notice', 'The original manual binding is retained.'];
        else $life = ['INCOMPLETE_CHECKOUT', 'Checkout preparation incomplete', 'Open the original Woo order and product mapping before a payment attempt.'];
        $base['lifecycle'] = ['code' => $life[0], 'label' => $life[1], 'detail' => $life[2]];
        if (!$detail) return $base;

        $base['snapshot']['record'] = is_array($record) ? $record : null;
        $base['currentShape'] = null; $base['shapeError'] = null;
        try { $base['currentShape'] = Starforge_SF104_Checkout::order_shape($order); }
        catch (Throwable $e) { $base['shapeError'] = $e->getMessage(); }
        $base['currentProduct'] = null;
        if (count($items) === 1) {
            $product = wc_get_product((int) $items[0]['productId']);
            if ($product) $base['currentProduct'] = self::describe_product($product);
        }
        $base['actions'] = ['release' => ['enabled' => false, 'mode' => null, 'reason' => 'No original accepted notice is awaiting release.'],
            'reset' => ['enabled' => false, 'reason' => 'No reserved native attempt is eligible for merchant reset.'],
            'handoff' => ['url' => null, 'reason' => 'No currently available frozen buyer instructions.']];
        if ($event && in_array($event['state'], ['RECEIVED', 'REVIEWING'], true)) {
            $recovery = $event['state'] === 'REVIEWING' &&
                $order->is_paid() && $event['tx_hash'] &&
                strtolower((string) $order->get_transaction_id()) === $event['tx_hash'];
            if ($recovery || (!$changed && !$closed && !$order->is_paid() && !$order->get_transaction_id())) {
                $base['actions']['release'] = ['enabled' => true, 'mode' => $recovery ? 'recover' : ($event['state'] === 'REVIEWING' ? 'continue' : 'release'),
                    'reason' => $recovery ? 'Reconcile the already-paid original transaction into its existing notice journal.' :
                        'Independently verify the exact original transfer before using the existing Woo release action.'];
            } else $base['actions']['release']['reason'] = $changed ? $snapshot['error'] : 'The current Woo status or transaction requires reconciliation.';
        }
        if ($attempt && $attempt['state'] === 'RESERVED') {
            try {
                Starforge_SF104_Checkout::snapshot($order);
                Starforge_SF104_Admission::assert_available($order, false);
                if ((int) $attempt['generation'] >= 2147483647) throw new RuntimeException('The original attempt generation cannot be advanced.');
                $base['actions']['reset'] = ['enabled' => true, 'reason' => 'Only after independent non-settlement review: reopen the next generation of this same order.'];
            } catch (Throwable $e) { $base['actions']['reset']['reason'] = $e->getMessage(); }
        }
        if ($snapshot['valid']) {
            try {
                $handoff = Starforge_SF104_Checkout::available_handoff($order, $record);
                $base['actions']['handoff'] = ['url' => add_query_arg(['action' => 'sf104_handoff', 'order_id' => $id], admin_url('admin-post.php')),
                    'reason' => 'Current generation ' . $handoff['attemptGeneration'] . ' on the original order.', 'generation' => $handoff['attemptGeneration']];
            } catch (Throwable $e) { $base['actions']['handoff']['reason'] = $e->getMessage(); }
        }
        $timeline = [];
        $add = static function ($at, $label, $detail, $actor = null) use (&$timeline) {
            if ($at) $timeline[] = ['at' => self::retained_time($at), 'label' => $label, 'detail' => $detail, 'actorId' => $actor];
        };
        $add($base['createdAt'], 'Woo order created', 'Original order #' . $base['number']);
        if (is_array($record)) $add($record['handoff']['createdAt'] ?? null, 'Checkout terms retained', 'Immutable order/payment snapshot ' . ($record['digest'] ?? ''));
        elseif ($binding) $add($binding['approvedAt'] ?? null, 'Merchant binding approved', ($binding['method'] ?? '') . ' ' . ($binding['routeId'] ?? ''), $binding['approvedBy'] ?? null);
        if ($attempt) {
            $add($attempt['reserved_at'], 'Original attempt reserved', 'Generation currently ' . $attempt['generation'] . '; payment-header SHA-256 ' . $attempt['attempt_digest']);
            $add($attempt['reset_at'] ?? null, 'Merchant reset recorded', $attempt['reset_reason'] ?? '', $attempt['reset_by'] ?? null);
        }
        if ($event) {
            $add($event['occurred_at'], 'Sender event time', 'As declared by original authenticated SF98 notice ' . $event['event_id']);
            $add($event['received_at'], 'SF98 notice received', 'Original body SHA-256 ' . $event['body_sha256']);
            $add($event['review_started_at'] ?? null, 'Release review started', $event['tx_hash'] ?? '', $event['reviewed_by'] ?? null);
            $add($event['reviewed_at'] ?? null, 'Release journal updated', $event['state'], $event['reviewed_by'] ?? null);
        }
        $add($base['paidAt'], 'Woo paid date', $base['transactionId']);
        usort($timeline, static function ($a, $b) { return strcmp((string) $a['at'], (string) $b['at']); });
        $base['timeline'] = $timeline;
        return $base;
    }

    static function order($request) {
        $id = self::order_id($request->get_param('id'));
        return Starforge_SF104_Checkout::with_order_lock($id, static function () use ($id) {
            $order = self::selected_order($id);
            $event = self::event($id); $attempt = self::attempt($id);
            if ($order->get_payment_method() !== Starforge_SF104_Checkout::ID && !$order->get_meta(Starforge_SF98_Woo::META_READY, true) &&
                !$order->get_meta(Starforge_SF104_Checkout::SNAPSHOT_META, true) && !$event && !$attempt) throw new RuntimeException('This is not a retained Stellar merchant order.', 404);
            return ['order' => self::describe($order, $event, $attempt, true), 'observedAt' => gmdate('Y-m-d\TH:i:s\Z')];
        });
    }

    static function notes($request) {
        $id = self::order_id($request->get_param('id'));
        self::selected_order($id);
        $offset = self::integer($request->get_param('offset'), 0, 0, 10000000);
        $limit = self::integer($request->get_param('limit'), 25, 1, 100);
        $notes = wc_get_order_notes(['order_id' => $id, 'limit' => $limit + 1, 'offset' => $offset, 'orderby' => 'comment_ID', 'order' => 'DESC']);
        $more = count($notes) > $limit;
        $rows = [];
        foreach (array_slice($notes, 0, $limit) as $note) $rows[] = ['id' => (string) $note->id, 'at' => self::utc($note->date_created),
            'content' => wp_strip_all_tags($note->content), 'addedBy' => $note->added_by, 'customerVisible' => (bool) $note->customer_note];
        return ['orderId' => (string) $id, 'offset' => $offset, 'notes' => $rows, 'nextOffset' => $more ? $offset + $limit : null];
    }

    static function add_note($request) {
        $id = self::order_id($request->get_param('id'));
        $body = $request->get_json_params();
        if (!is_array($body) || !is_string($body['note'] ?? null) || !is_string($body['stateDigest'] ?? null)) throw new RuntimeException('Provide the selected order state and an operator note.', 400);
        $note = sanitize_textarea_field($body['note']);
        if (trim($note) === '' || strlen($note) > 4000) throw new RuntimeException('Use an operator note between 1 and 4000 bytes.', 400);
        return Starforge_SF104_Checkout::with_order_lock($id, static function () use ($id, $body, $note) {
            $order = self::selected_order($id);
            $current = self::describe($order, self::event($id), self::attempt($id), true);
            if (!hash_equals($current['stateDigest'], $body['stateDigest'])) throw new RuntimeException('This order changed since your last read. Refresh and review the current state before attaching the note.', 409);
            $note_id = $order->add_order_note($note, false, true);
            if (!$note_id) throw new RuntimeException('The native WooCommerce note could not be saved.', 503);
            return ['noteId' => (string) $note_id, 'order' => self::describe(self::selected_order($id), self::event($id), self::attempt($id), true)];
        });
    }

    static function describe_product($product) {
        $raw = $product->get_meta(Starforge_SF104_Checkout::PRODUCT_META, true);
        $result = ['id' => (string) $product->get_id(), 'name' => wp_strip_all_tags($product->get_name()), 'status' => $product->get_status(),
            'type' => $product->get_type(), 'virtual' => $product->is_virtual(), 'downloadable' => $product->is_downloadable(),
            'basePrice' => (string) $product->get_price(), 'mapping' => is_array($raw) ? $raw : null, 'valid' => false,
            'error' => null, 'route' => null, 'exportUrl' => null, 'editUrl' => get_edit_post_link($product->get_id(), 'raw')];
        try {
            $result['route'] = Starforge_SF104_Checkout::route_declaration($product);
            $result['valid'] = true;
            if (current_user_can('edit_post', $product->get_id())) $result['exportUrl'] = add_query_arg(
                ['action' => 'sf104_route', 'product_id' => (string) $product->get_id(),
                    '_wpnonce' => wp_create_nonce('sf104_route_' . $product->get_id())], admin_url('admin-post.php'));
        } catch (Throwable $e) { $result['error'] = $e->getMessage(); }
        return $result;
    }

    static function products($request) {
        $page = self::integer($request->get_param('page'), 1, 1, 1000000);
        $limit = self::integer($request->get_param('limit'), 20, 1, 100);
        $search = $request->get_param('productId');
        if ($search !== null && $search !== '') {
            $product = wc_get_product(self::order_id($search));
            return ['page' => 1, 'pages' => $product ? 1 : 0, 'total' => $product ? 1 : 0, 'products' => $product ? [self::describe_product($product)] : []];
        }
        $result = wc_get_products(['sf104_console_mapped' => true, 'limit' => $limit, 'page' => $page, 'paginate' => true, 'orderby' => 'ID', 'order' => 'DESC',
            'status' => ['publish', 'private', 'draft', 'pending']]);
        return ['page' => $page, 'pages' => (int) $result->max_num_pages, 'total' => (int) $result->total,
            'products' => array_map([__CLASS__, 'describe_product'], $result->products)];
    }

    static function handoff($request) {
        $body = $request->get_json_params();
        if (!is_array($body) || !is_array($body['orders'] ?? null) || !$body['orders'] || count($body['orders']) > 100) throw new RuntimeException('Select between 1 and 100 observed orders for this handoff.', 400);
        $selected = [];
        foreach ($body['orders'] as $item) {
            if (!is_array($item) || !is_string($item['stateDigest'] ?? null) || !preg_match('/^[a-f0-9]{64}$/D', $item['stateDigest'])) throw new RuntimeException('Refresh the selected orders before exporting their observed state.', 400);
            $id = self::order_id($item['id'] ?? null);
            if (isset($selected[$id])) throw new RuntimeException('The handoff contains the same order twice.', 400);
            $selected[$id] = $item['stateDigest'];
        }
        ksort($selected, SORT_NUMERIC);
        $records = [];
        foreach ($selected as $id => $digest) {
            $records[] = Starforge_SF104_Checkout::with_order_lock($id, static function () use ($id, $digest) {
                $order = self::selected_order($id);
                $current = self::describe($order, self::event($id), self::attempt($id), true);
                if (!hash_equals($current['stateDigest'], $digest)) throw new RuntimeException('Order ' . $id . ' changed after selection. Refresh it and select its current state before exporting.', 409);
                unset($current['orderUrl'], $current['actions']);
                if ($current['currentProduct']) unset($current['currentProduct']['editUrl'], $current['currentProduct']['exportUrl']);
                return ['observedAt' => gmdate('Y-m-d\TH:i:s\Z'), 'order' => $current];
            });
        }
        return ['schema' => self::HANDOFF_SCHEMA, 'generatedAt' => gmdate('Y-m-d\TH:i:s\Z'),
            'storeOrigin' => self::origin_or_null(), 'operatorId' => get_current_user_id(),
            'records' => $records,
            'meaning' => 'Selected original Woo order, checkout, admission and notice observations. Each order was reread under its native order lock and matched to the selected state. This is not a database backup, a buyer payment instruction, or independent proof of Stellar settlement. Native Woo order notes remain in WordPress and are not included.',
            'source' => ['plugin' => 'Starforge SF98 WooCommerce Merchant Bridge', 'version' => self::VERSION]];
    }

    static function assets($hook) {
        $page = isset($_GET['page']) && is_string($_GET['page']) ? sanitize_key(wp_unslash($_GET['page'])) : '';
        if (!in_array($page, ['sf98-woocommerce', 'sf104-checkout-attempts'], true) || !current_user_can('manage_woocommerce') || !function_exists('wc_get_order_statuses')) return;
        wp_enqueue_style('sf104-merchant-console', plugins_url('merchant-console.css', __FILE__), [], self::VERSION);
        wp_enqueue_script('sf104-merchant-console', plugins_url('merchant-console.js', __FILE__), [], self::VERSION, true);
        wp_add_inline_script('sf104-merchant-console', 'window.SF104Console=' . wp_json_encode([
            'api' => rest_url('stellar-forge/v1/merchant-console'), 'nonce' => wp_create_nonce('wp_rest'),
            'adminPost' => admin_url('admin-post.php'), 'page' => $page,
            'nonces' => ['release' => wp_create_nonce('sf98_release_order'), 'reset' => wp_create_nonce('sf104_reset_attempt'), 'bind' => wp_create_nonce('sf98_bind_order')],
            'wooStatuses' => wc_get_order_statuses(),
        ], JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) . ';', 'before');
    }

    static function page() {
        $permission = self::permission();
        if ($permission !== true) { echo '<div class="wrap"><h1>Stellar merchant operations</h1><p>' . esc_html($permission->get_error_message()) . '</p></div>'; return; }
        echo '<div id="sf104-console" class="sf104"><div class="sf104-masthead"><div><span class="sf104-eyebrow">STELLAR / MERCHANT OPERATIONS</span><h1>Orders and fulfillment</h1><p>Work from the original Woo order, payment attempt and settlement notice.</p></div><button type="button" class="sf104-button" data-action="refresh">Refresh</button></div>';
        echo '<nav class="sf104-nav" aria-label="Merchant workspace"><button type="button" data-view="orders" aria-current="page">Orders</button><button type="button" data-view="products">Products</button><button type="button" data-view="setup">Setup</button></nav>';
        echo '<div id="sf104-message" role="status" aria-live="polite"></div><main id="sf104-workspace" tabindex="-1"><p class="sf104-loading">Loading original merchant records…</p></main>';
        echo '<noscript><div class="sf104-notice">JavaScript is required for this paged operating view. The original WooCommerce order pages and native plugin handlers remain available.</div></noscript>';
        echo '<footer class="sf104-footer">Original WooCommerce orders · Native Stellar x402 · SF98 merchant fulfillment <span id="sf104-observed"></span></footer></div>';
    }
}
Starforge_SF104_Merchant_Console::boot();

