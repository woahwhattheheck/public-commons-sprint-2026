<?php
/** Native SF86 review and explicit completion of the original Woo order. */
if (!defined('ABSPATH')) { exit; }

final class Starforge_SF104_Merchant_Operator {
    const SCHEMA = 'stellar-forge.sf104.merchant-order.v1';
    const RELEASE_SCHEMA = 'stellar-forge.sf104.merchant-release.v1';
    const REVIEW_META = '_sf104_native_merchant_review';

    static function boot() { add_action('rest_api_init', [__CLASS__, 'routes']); }

    static function allowed() {
        return current_user_can('manage_woocommerce') && function_exists('wc_get_order');
    }

    static function routes() {
        register_rest_route('stellar-forge/v1', '/merchant/orders/(?P<order>[1-9][0-9]{0,17})', [
            'methods' => 'GET', 'callback' => [__CLASS__, 'inspect'],
            'permission_callback' => [__CLASS__, 'allowed'],
        ]);
        register_rest_route('stellar-forge/v1', '/merchant/orders/(?P<order>[1-9][0-9]{0,17})/release', [
            'methods' => 'POST', 'callback' => [__CLASS__, 'release'],
            'permission_callback' => [__CLASS__, 'allowed'],
        ]);
    }

    static function response($http, $value) {
        $response = new WP_REST_Response($value, $http);
        $response->header('Cache-Control', 'private, no-store');
        $response->header('X-Content-Type-Options', 'nosniff');
        return $response;
    }

    static function order_id($request) {
        $raw = $request->get_param('order');
        if (!is_string($raw) || !preg_match('/^[1-9][0-9]{0,17}$/D', $raw) || (string) (int) $raw !== $raw) {
            throw new RuntimeException('ORDER_ID_INVALID', 422);
        }
        return (int) $raw;
    }

    static function journal_event($row) {
        if (!$row) return null;
        return ['id' => $row->event_id, 'orderReference' => (string) $row->order_id,
            'bodySha256' => $row->body_sha256, 'state' => $row->state,
            'occurredAt' => $row->occurred_at, 'receivedAt' => $row->received_at,
            'transactionHash' => $row->tx_hash ?: null,
            'reviewStartedAt' => $row->review_started_at ?: null,
            'reviewedAt' => $row->reviewed_at ?: null];
    }

    /** Only payment/product data leaves WordPress. The complete native order
     * identity is hashed locally, including shipping and billing changes. */
    static function snapshot($order, $row = null) {
        if (!$order) throw new RuntimeException('ORDER_NOT_FOUND', 404);
        if ($row === null) $row = Starforge_SF104_Checkout::event_for_order($order->get_id());
        $binding = $order->get_meta(Starforge_SF98_Woo::META_READY, true);
        $checkout = $order->get_meta(Starforge_SF104_Checkout::SNAPSHOT_META, true);
        $items = [];
        foreach ($order->get_items('line_item') as $item) {
            $items[] = ['id' => (string) $item->get_id(), 'productId' => (string) $item->get_product_id(),
                'variationId' => (string) $item->get_variation_id(), 'quantity' => (string) $item->get_quantity(),
                'subtotal' => (string) $item->get_subtotal(), 'total' => (string) $item->get_total(),
                'subtotalTax' => (string) $item->get_subtotal_tax(), 'totalTax' => (string) $item->get_total_tax(),
                'taxes' => $item->get_taxes()];
        }
        $private_shape = $order->get_data();
        // Completion, its dates and our own retained review may advance while
        // this same immutable order is recovered. All other source remains bound.
        foreach (['status', 'transaction_id', 'date_modified', 'date_paid', 'date_completed', 'meta_data'] as $key) {
            unset($private_shape[$key]);
        }
        $identity = ['orderReference' => (string) $order->get_id(),
            'orderShapeSha256' => Starforge_SF104_Checkout::digest($private_shape),
            'itemsSha256' => Starforge_SF104_Checkout::digest($items),
            'binding' => is_array($binding) ? $binding : null,
            'checkoutSha256' => $checkout ? Starforge_SF104_Checkout::digest($checkout) : null,
            'event' => $row ? ['id' => $row->event_id, 'bodySha256' => $row->body_sha256,
                'occurredAt' => $row->occurred_at, 'receivedAt' => $row->received_at] : null];
        $checkout_valid = null;
        if ($checkout || $order->get_payment_method() === Starforge_SF104_Checkout::ID) {
            try { Starforge_SF104_Checkout::snapshot($order); $checkout_valid = true; }
            catch (Throwable $e) { $checkout_valid = false; }
        }
        $view = ['identity' => $identity, 'event' => self::journal_event($row),
            'order' => ['status' => $order->get_status(), 'paid' => $order->is_paid(),
                'transactionHash' => $order->get_transaction_id() ?: null,
                'currency' => $order->get_currency(), 'total' => (string) $order->get_total(),
                'discountTotal' => (string) $order->get_discount_total(),
                'totalTax' => (string) $order->get_total_tax(),
                'shippingTotal' => (string) $order->get_shipping_total(),
                'paymentMethod' => $order->get_payment_method(), 'items' => $items],
            'checkout' => ['present' => (bool) $checkout, 'valid' => $checkout_valid]];
        return ['schema' => self::SCHEMA, 'siteUrl' => untrailingslashit(home_url('/')),
            'orderReference' => (string) $order->get_id(),
            'identitySha256' => Starforge_SF104_Checkout::digest($identity),
            'revision' => Starforge_SF104_Checkout::digest($view),
            'observedAt' => gmdate('c'), 'content' => $view,
            'nativeReview' => $order->get_meta(self::REVIEW_META, true) ?: null];
    }

    static function inspect($request) {
        try {
            $id = self::order_id($request);
            return Starforge_SF104_Checkout::with_order_lock($id, static function () use ($id) {
                return self::response(200, self::snapshot(wc_get_order($id)));
            });
        } catch (Throwable $e) {
            $code = $e->getCode();
            return self::response(in_array($code, [404, 422, 503], true) ? $code : 409,
                ['status' => in_array($code, [404, 422], true) ? $e->getMessage() : 'ORDER_READ_UNAVAILABLE']);
        }
    }

    static function release_payload($raw) {
        if (!is_array($raw)) return false;
        $fields = ['schema', 'eventId', 'transactionHash', 'expectedRevision', 'expectedIdentitySha256',
            'reviewSha256', 'reviewedTransfer', 'confirm'];
        $keys = array_keys($raw); sort($keys); sort($fields);
        if ($keys !== $fields || $raw['schema'] !== self::RELEASE_SCHEMA || $raw['confirm'] !== 'RELEASE_THIS_ORDER') return false;
        foreach (['eventId', 'transactionHash', 'expectedRevision', 'expectedIdentitySha256', 'reviewSha256'] as $key) {
            if (!is_string($raw[$key]) || !preg_match('/^[a-f0-9]{64}$/D', $raw[$key])) return false;
        }
        $t = $raw['reviewedTransfer'];
        if (!is_array($t)) return false;
        $fields = ['schema', 'verdict', 'network', 'transaction', 'asset', 'recipient', 'payer', 'atomicAmount',
            'ledger', 'matchingTransfers', 'matchingEventId', 'rpcEndpoint'];
        $keys = array_keys($t); sort($keys); sort($fields);
        return $keys === $fields && $t['schema'] === 'stellar-forge.sf86.rpc-reconciliation.v1' &&
            (($t['network'] === 'stellar:testnet' && $t['verdict'] === 'CHAIN_TRANSFER_MATCHED_RPC_TESTNET') ||
             ($t['network'] === 'stellar:pubnet' && $t['verdict'] === 'CHAIN_TRANSFER_MATCHED_RPC_PUBNET')) &&
            $t['transaction'] === $raw['transactionHash'] && is_int($t['ledger']) && $t['ledger'] > 0 &&
            $t['matchingTransfers'] === 1 && is_string($t['matchingEventId']) && strlen($t['matchingEventId']) > 0 &&
            strlen($t['matchingEventId']) <= 256 && is_string($t['rpcEndpoint']) && strlen($t['rpcEndpoint']) <= 2048 &&
            strpos($t['rpcEndpoint'], 'https://') === 0 && is_string($t['asset']) && preg_match('/^C[A-Z2-7]{55}$/D', $t['asset']) &&
            is_string($t['recipient']) && preg_match('/^[GC][A-Z2-7]{55}$/D', $t['recipient']) &&
            is_string($t['payer']) && preg_match('/^G[A-Z2-7]{55}$/D', $t['payer']) &&
            Starforge_SF98_Woo::amount_ok($t['atomicAmount']);
    }

    static function release($request) {
        try {
            $id = self::order_id($request);
            if (strlen($request->get_body()) > 16384) return self::response(413, ['status' => 'REVIEW_BODY_TOO_LARGE']);
            $payload = $request->get_json_params();
            if (!self::release_payload($payload)) return self::response(422, ['status' => 'NATIVE_REVIEW_INVALID']);
            $guard = static function ($row, $order) use ($payload, $id) {
                if ((int) $row->order_id !== $id) return 'review_order_mismatch';
                $snapshot = self::snapshot($order, $row);
                if (!hash_equals($payload['expectedIdentitySha256'], $snapshot['identitySha256'])) return 'review_source_changed';
                $recovery = in_array($row->state, ['REVIEWING', 'RELEASED'], true) &&
                    is_string($row->tx_hash) && hash_equals($row->tx_hash, $payload['transactionHash']);
                if (!$recovery && !hash_equals($payload['expectedRevision'], $snapshot['revision'])) return 'review_source_changed';
                if ($snapshot['content']['checkout']['valid'] === false) return 'review_checkout_changed';
                $binding = $snapshot['content']['identity']['binding'];
                $t = $payload['reviewedTransfer'];
                if (!is_array($binding) || ($binding['approved'] ?? '') !== 'YES' ||
                    ($binding['network'] ?? '') !== $t['network'] || ($binding['amountAtomic'] ?? '') !== $t['atomicAmount'] ||
                    !hash_equals((string) ($binding['assetDigest'] ?? ''), hash('sha256', $t['asset'])) ||
                    !hash_equals((string) ($binding['recipientDigest'] ?? ''), hash('sha256', $t['recipient']))) return 'review_terms_changed';
                // Match the ORIGINAL SF98 transaction-derived event identity.
                $event_id = hash('sha256', implode("\n", ['sf98.v1', $binding['routeId'], $binding['method'],
                    $t['network'], hash('sha256', $t['transaction'])]));
                if (!hash_equals($row->event_id, $event_id)) return 'review_transaction_event_mismatch';
                $prior = $order->get_meta(self::REVIEW_META, true);
                if ($prior && (($prior['eventId'] ?? '') !== $payload['eventId'] ||
                    ($prior['transactionHash'] ?? '') !== $payload['transactionHash'] ||
                    ($prior['reviewSha256'] ?? '') !== $payload['reviewSha256'])) return 'review_identity_conflict';
                return null;
            };
            $retain_review = static function ($result, $order_id) use ($payload) {
                $order = wc_get_order($order_id);
                if (!$order) return 'released_review_needs_recovery';
                if (!$order->get_meta(self::REVIEW_META, true)) {
                    $order->update_meta_data(self::REVIEW_META, ['eventId' => $payload['eventId'],
                        'transactionHash' => $payload['transactionHash'], 'reviewSha256' => $payload['reviewSha256'],
                        'sourceRevision' => $payload['expectedRevision'], 'reviewedTransfer' => $payload['reviewedTransfer'],
                        'operatorId' => get_current_user_id(), 'recordedAt' => gmdate('c')]);
                    try { $order->save(); }
                    catch (Throwable $e) { return 'released_review_needs_recovery'; }
                }
                return $result;
            };
            $result = Starforge_SF98_Woo::release_order($payload['eventId'], $payload['transactionHash'], $guard, $retain_review);
            $completed = in_array($result, ['released', 'already_released', 'recovered_release'], true);
            $order = wc_get_order($id);
            return self::response($completed ? 200 : 409, ['schema' => self::RELEASE_SCHEMA,
                'status' => strtoupper($result), 'orderReference' => (string) $id,
                'eventId' => $payload['eventId'], 'transactionHash' => $payload['transactionHash'],
                'reviewSha256' => $payload['reviewSha256'], 'order' => $order ? self::snapshot($order) : null]);
        } catch (Throwable $e) {
            return self::response($e->getCode() === 422 ? 422 : 409,
                ['schema' => self::RELEASE_SCHEMA, 'status' => 'RELEASE_REOPEN_REQUIRED']);
        }
    }
}
Starforge_SF104_Merchant_Operator::boot();
