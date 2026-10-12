<?php
/** MIT. ERP records belong to the installed Woo store and its original order lock. */
if (!defined('ABSPATH')) { exit; }
require_once __DIR__ . '/merchant-erp-acumatica.php';

final class Starforge_SF104_ERP_Store {
    const VERSION = '1';
    const ORDER_SCHEMA = 'stellar-forge.sf104.erp-order.v1';
    const PROJECT_SCHEMA = 'stellar-forge.sf104.erp-project.v1';
    static function table($kind) {
        global $wpdb;
        return $wpdb->prefix . ($kind === 'maps' ? 'sf104_erp_maps' : 'sf104_erp_orders');
    }
    static function db_ok() {
        global $wpdb;
        if ($wpdb->last_error) throw new RuntimeException('The ERP project journal is unavailable. Check the installed WordPress database and reopen this same project.', 503);
    }
    static function install() {
        if (get_option('sf104_erp_schema_version') === self::VERSION) return;
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $maps = self::table('maps'); $orders = self::table('orders'); $collate = $wpdb->get_charset_collate();
        dbDelta("CREATE TABLE {$maps} (
            map_id char(64) NOT NULL,
            data longtext NOT NULL,
            created_at datetime NOT NULL,
            PRIMARY KEY  (map_id)
        ) {$collate};");
        dbDelta("CREATE TABLE {$orders} (
            operation_id char(64) NOT NULL,
            order_id bigint(20) unsigned NOT NULL,
            store_namespace varchar(16) NOT NULL,
            external_reference varchar(40) NOT NULL,
            target_reference varchar(20) NOT NULL DEFAULT '',
            state varchar(32) NOT NULL,
            revision bigint(20) unsigned NOT NULL,
            data longtext NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (operation_id),
            KEY order_lookup (order_id),
            KEY exception_queue (state,updated_at),
            KEY external_lookup (external_reference),
            KEY target_lookup (target_reference)
        ) {$collate};");
        self::db_ok();
        update_option('sf104_erp_schema_version', self::VERSION, false);
    }
    static function decode($data) {
        $x = json_decode($data, true);
        if (!is_array($x)) throw new RuntimeException('The retained ERP record cannot be read.', 503);
        return $x;
    }
    static function operation_id($namespace, $order_id) { return hash('sha256', 'sf104.erp.v1' . "\n" . $namespace . "\n" . $order_id); }
    static function map($id = null) {
        global $wpdb;
        $id = $id ?: get_option('sf104_erp_current_map', '');
        if (!$id) return null;
        if (!preg_match('/^[a-f0-9]{64}$/D', $id)) throw new RuntimeException('The selected mapping reference is invalid.', 422);
        $value = $wpdb->get_var($wpdb->prepare('SELECT data FROM ' . self::table('maps') . ' WHERE map_id=%s', $id));
        self::db_ok(); return $value === null ? null : self::decode($value);
    }
    static function map_summaries() {
        global $wpdb;
        $rows = $wpdb->get_results('SELECT map_id,data,created_at FROM ' . self::table('maps') . ' ORDER BY created_at DESC', ARRAY_A);
        self::db_ok(); $out = [];
        foreach ($rows as $row) {
            $data = self::decode($row['data']);
            $out[] = ['id'=>$row['map_id'], 'name'=>$data['mapping']['name'], 'createdAt'=>$data['createdAt'],
                'storeNamespace'=>$data['mapping']['storeNamespace'], 'target'=>$data['mapping']['target']['baseUrl'],
                'currency'=>$data['mapping']['currency'], 'check'=>$data['check'] ?? null];
        }
        return $out;
    }
    static function save_map($raw, $expected) {
        return Starforge_SF104_Checkout::with_order_lock('erp-mapping', static function () use ($raw, $expected) {
            global $wpdb;
            $current = get_option('sf104_erp_current_map', '');
            if ($expected !== $current) throw new RuntimeException('Another operator selected a newer map. Refresh the mapping page before saving.', 409);
            $map = Starforge_SF104_ERP_Map::compile($raw); $id = Starforge_SF104_ERP_Map::digest($map);
            $record = self::map($id);
            if (!$record) {
                $record = ['id'=>$id, 'mapping'=>$map, 'createdAt'=>gmdate('c'), 'createdBy'=>get_current_user_id(), 'check'=>null];
                if ($wpdb->insert(self::table('maps'), ['map_id'=>$id, 'data'=>Starforge_SF104_ERP_Map::json($record), 'created_at'=>gmdate('Y-m-d H:i:s')]) !== 1) {
                    throw new RuntimeException('The new mapping revision could not be retained.', 503);
                }
            }
            update_option('sf104_erp_current_map', $id, false);
            if (get_option('sf104_erp_current_map') !== $id) throw new RuntimeException('The mapping selection was not saved. Refresh this page.', 503);
            return $record;
        });
    }
    /** Retain exact original maps for recovery without selecting or authorizing them. */
    static function retain_maps($records) {
        $m = Starforge_SF104_ERP_Map::class; $prepared = [];
        foreach ($records as $record) {
            $mapping = $m::compile($record['mapping'] ?? null); $id = $m::digest($mapping);
            $m::need(($record['id'] ?? '') === $id, 'The retained original mapping digest does not match.');
            $prepared[$id] = $record;
        }
        return Starforge_SF104_Checkout::with_order_lock('erp-mapping', static function () use ($prepared,$m) {
            global $wpdb; $ids = [];
            foreach ($prepared as $id=>$map) {
                $existing = self::map($id);
                if ($existing) {
                    $m::need($m::digest($existing['mapping']) === $id, 'The installed mapping contains different original content.');
                } else {
                    $map['checkHistory'] = $map['checkHistory'] ?? [];
                    if ($map['check'] ?? null) $map['checkHistory'][] = $map['check'];
                    $map['check'] = null; $map['importedAt'] = gmdate('c');
                    if ($wpdb->insert(self::table('maps'), ['map_id'=>$id,'data'=>$m::json($map),'created_at'=>gmdate('Y-m-d H:i:s')]) !== 1)
                        throw new RuntimeException('An original mapping could not be retained for recovery.',503);
                }
                $ids[] = $id;
            }
            return $ids;
        });
    }
    static function record_check($id, $check) {
        return Starforge_SF104_Checkout::with_order_lock('erp-mapping', static function () use ($id, $check) {
            global $wpdb; $record = self::map($id);
            if (!$record) throw new RuntimeException('The selected mapping revision is missing.', 404);
            $record['checkHistory'] = $record['checkHistory'] ?? [];
            if ($record['check'] ?? null) $record['checkHistory'][] = $record['check'];
            $record['check'] = $check;
            $ok = $wpdb->update(self::table('maps'), ['data'=>Starforge_SF104_ERP_Map::json($record)], ['map_id'=>$id]);
            self::db_ok(); if ($ok === false) throw new RuntimeException('The installed contract check could not be retained.', 503);
            return $record;
        });
    }
    static function order($id) {
        global $wpdb;
        if (!is_string($id) || !preg_match('/^[a-f0-9]{64}$/D', $id)) throw new RuntimeException('The ERP operation reference is invalid.', 422);
        $row = $wpdb->get_var($wpdb->prepare('SELECT data FROM ' . self::table('orders') . ' WHERE operation_id=%s', $id));
        self::db_ok(); return $row === null ? null : self::decode($row);
    }
    static function for_order($order_id) {
        global $wpdb;
        $rows = $wpdb->get_col($wpdb->prepare('SELECT operation_id FROM ' . self::table('orders') . ' WHERE order_id=%d', $order_id));
        self::db_ok(); return $rows;
    }
    static function save(&$record, $expected) {
        global $wpdb;
        $record['revision'] = $expected + 1; $record['updatedAt'] = gmdate('c');
        $encoded = Starforge_SF104_ERP_Map::json($record);
        if (strlen($encoded) > 8388608) throw new RuntimeException('This order has reached its 8 MiB journal limit. Its retained history is intact. Export the complete project for the operating engineer to extend journal capacity before another edition or delivery.', 422);
        $data = ['operation_id'=>$record['operationId'], 'order_id'=>(int) $record['orderId'],
            'store_namespace'=>$record['storeNamespace'], 'external_reference'=>$record['externalReference'],
            'target_reference'=>isset($record['target']['key']) ? $record['target']['key']['orderType'] . '/' . $record['target']['key']['orderNbr'] : '',
            'state'=>$record['state'], 'revision'=>$record['revision'], 'data'=>$encoded, 'updated_at'=>gmdate('Y-m-d H:i:s')];
        $ok = $expected === 0 ? $wpdb->insert(self::table('orders'), $data) :
            $wpdb->update(self::table('orders'), $data, ['operation_id'=>$record['operationId'], 'revision'=>$expected]);
        self::db_ok();
        if ($ok !== 1) throw new RuntimeException('Another operator advanced this original ERP order. Refresh it before continuing.', 409);
    }
    static function source($order_id) {
        $order = wc_get_order((int) $order_id);
        if (!$order || $order->get_type() !== 'shop_order') throw new RuntimeException('The original WooCommerce order was not found in this store.', 404);
        if ((string) $order->get_order_key() === '') throw new RuntimeException('The original Woo order has no stable order key. Repair its source identity in WooCommerce before preparing ERP delivery.', 422);
        $lines = [];
        foreach ($order->get_items('line_item') as $item) {
            $product = $item->get_product();
            $lines[] = ['kind'=>'product', 'id'=>(string) $item->get_id(), 'name'=>(string) $item->get_name(),
                'productId'=>(string) $item->get_product_id(), 'variationId'=>(string) $item->get_variation_id(),
                'sku'=>$product ? (string) $product->get_sku() : '', 'quantity'=>(string) $item->get_quantity(),
                'subtotal'=>(string) $item->get_subtotal(), 'total'=>(string) $item->get_total(),
                'tax'=>(string) $item->get_total_tax(), 'taxDetails'=>$item->get_taxes()];
        }
        foreach (['shipping','fee'] as $kind) foreach ($order->get_items($kind) as $item) {
            $total = (string) $item->get_total();
            // Zero-price operational lines still retain their own source identity.
            $lines[] = ['kind'=>$kind, 'id'=>(string) $item->get_id(), 'name'=>(string) $item->get_name(),
                'quantity'=>'1', 'subtotal'=>$total, 'total'=>$total, 'tax'=>(string) $item->get_total_tax(), 'taxDetails'=>$item->get_taxes()];
        }
        $taxes = [];
        foreach ($order->get_items('tax') as $item) $taxes[] = ['id'=>(string) $item->get_id(),
            'rateId'=>(string) $item->get_rate_id(), 'label'=>(string) $item->get_label(),
            'taxTotal'=>(string) $item->get_tax_total(), 'shippingTaxTotal'=>(string) $item->get_shipping_tax_total(),
            'compound'=>(bool) $item->get_compound()];
        return ['orderId'=>(string) $order->get_id(), 'displayNumber'=>(string) $order->get_order_number(),
            'orderKeySha256'=>hash('sha256', (string) $order->get_order_key()),
            'siteUrl'=>untrailingslashit(home_url('/')), 'customerId'=>(string) $order->get_customer_id(),
            'createdAt'=>$order->get_date_created() ? $order->get_date_created()->date('c') : null,
            'currency'=>$order->get_currency(), 'status'=>$order->get_status(),
            'total'=>(string) $order->get_total(), 'totalTax'=>(string) $order->get_total_tax(),
            'discountTotal'=>(string) $order->get_discount_total(), 'shippingTotal'=>(string) $order->get_shipping_total(),
            'billing'=>$order->get_address('billing'), 'shipping'=>$order->get_address('shipping'),
            'lines'=>$lines, 'taxes'=>$taxes,
            'refundIds'=>array_map(static function ($r) { return (string) $r->get_id(); }, $order->get_refunds()),
            'observedAt'=>gmdate('c')];
    }
    static function edition_id($map, $source) {
        $admission = in_array($source['status'], $map['mapping']['admittedStatuses'], true) ? 'admitted' : 'waiting';
        return hash('sha256', $map['id'] . ':' . self::source_digest($source) . ':' . $admission);
    }
    static function source_digest($source) {
        unset($source['status'], $source['observedAt'], $source['siteUrl']);
        return Starforge_SF104_ERP_Map::digest($source);
    }
    static function edition($record, $id = null) {
        $id = $id ?: $record['currentEditionId'];
        foreach ($record['editions'] as $edition) if ($edition['id'] === $id) return $edition;
        throw new RuntimeException('The selected saved order edition is missing.', 404);
    }
    static function current_source($record, $edition) {
        try {
            $source = self::source($record['orderId']);
            return ['available'=>true, 'sameOrderKey'=>hash_equals($record['orderKeySha256'], $source['orderKeySha256']),
                'matchesEdition'=>hash_equals($edition['sourceSha256'], self::source_digest($source)),
                'status'=>$source['status'], 'siteUrl'=>$source['siteUrl']];
        } catch (Throwable $e) { return ['available'=>false, 'sameOrderKey'=>false, 'matchesEdition'=>false, 'message'=>$e->getMessage()]; }
    }
    static function queue($search, $state, $page, $limit) {
        global $wpdb; $table = self::table('orders'); $where = '1=1'; $args = [];
        if ($state !== '') { $where .= ' AND state=%s'; $args[] = $state; }
        if ($search !== '') {
            $where .= ' AND (external_reference LIKE %s OR target_reference LIKE %s OR operation_id=%s OR order_id=%d)';
            $args[] = '%' . $wpdb->esc_like($search) . '%'; $args[] = '%' . $wpdb->esc_like($search) . '%';
            $args[] = $search; $args[] = ctype_digit($search) ? (int) $search : 0;
        }
        $sql = "SELECT COUNT(*) FROM {$table} WHERE {$where}";
        $total = (int) $wpdb->get_var($args ? $wpdb->prepare($sql, ...$args) : $sql);
        $rows = $wpdb->get_results($wpdb->prepare("SELECT data FROM {$table} WHERE {$where} ORDER BY updated_at DESC,operation_id LIMIT %d OFFSET %d",
            ...array_merge($args, [$limit, ($page - 1) * $limit])), ARRAY_A);
        self::db_ok(); $out = [];
        foreach ($rows as $row) {
            $record = self::decode($row['data']); $edition = self::edition($record);
            $out[] = ['operationId'=>$record['operationId'], 'orderId'=>$record['orderId'], 'externalReference'=>$record['externalReference'],
                'state'=>$record['state'], 'revision'=>$record['revision'], 'updatedAt'=>$record['updatedAt'],
                'editionNumber'=>$edition['number'], 'owner'=>$edition['plan']['reviewOwner'] ?? $edition['reviewOwner'],
                'total'=>$edition['source']['total'], 'currency'=>$edition['source']['currency'],
                'targetKey'=>$record['target']['key'] ?? null, 'issues'=>$record['issues'] ?? []];
        }
        return ['orders'=>$out, 'total'=>$total, 'page'=>$page, 'limit'=>$limit, 'pages'=>(int) ceil($total / $limit)];
    }
}
