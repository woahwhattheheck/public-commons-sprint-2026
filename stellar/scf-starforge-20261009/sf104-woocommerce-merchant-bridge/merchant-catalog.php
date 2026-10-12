<?php
// MIT. Native Woo product-term commissioning; no order, payment or refund mutation.
if (!defined('ABSPATH')) exit;

final class Starforge_SF104_Catalog {
    const PLAN = 'stellar-forge.sf104.catalog-plan.v1';
    const WORKSPACE = 'stellar-forge.sf104.catalog-workspace.v1';
    const HANDOFF = 'stellar-forge.sf104.catalog-handoff.v1';
    const VERSION = '1';
    const MAX_INPUT = 2097152;
    const MAX_PACKET = 33554432;
    const OPTION = 'woocommerce_sf104_native_settings';
    private static $depth = 0;
    private static $connection = null;
    private static $guard_retries = null;
    private static $held_products = [];
    private static $table_ready = false;

    static function boot() {
        add_action('admin_menu', [__CLASS__, 'menu'], 35);
        add_action('admin_enqueue_scripts', [__CLASS__, 'assets']);
        add_action('rest_api_init', [__CLASS__, 'rest']);
        add_action('woocommerce_before_product_object_save', [__CLASS__, 'before_product_save'], 1, 2);
        add_action('woocommerce_after_product_object_save', [__CLASS__, 'after_product_save'], PHP_INT_MAX, 2);
        add_action('shutdown', [__CLASS__, 'shutdown']);
        add_action('woocommerce_product_options_general_product_data', [__CLASS__, 'product_link'], 30);
    }
    static function fail($message, $code = 409) { throw new RuntimeException($message, $code); }
    static function need($condition, $message, $code = 409) { if (!$condition) self::fail($message, $code); }
    static function now() { return (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.u\Z'); }
    static function hash($value) { return Starforge_SF104_Basket::hash($value); }
    static function json($value) {
        $json = wp_json_encode(Starforge_SF104_Basket::canonical($value),
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_LINE_TERMINATORS);
        self::need(is_string($json), 'The catalog record could not be encoded.', 503);
        return $json;
    }
    static function uuid($value) {
        return is_string($value) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/D', $value);
    }
    static function id($value) {
        return is_string($value) && preg_match('/^[1-9][0-9]{0,17}$/D', $value) && (string) (int) $value === $value;
    }
    static function text($value, $max = 500, $empty = true) {
        self::need(is_string($value) && strlen($value) <= $max && !preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $value) &&
            ($empty || trim($value) !== ''), 'Use a bounded text value without control characters.', 422);
        return $value;
    }
    static function fields($value, $keys) {
        self::need(is_array($value), 'Use a JSON object for this catalog value.', 422);
        foreach (array_keys($value) as $key) self::need(in_array($key, $keys, true), 'Unknown catalog field: ' . (string) $key, 422);
    }
    static function list_value($value, $max) {
        return is_array($value) && count($value) <= $max && ($value === [] || array_keys($value) === range(0, count($value) - 1));
    }
    static function permission() {
        if (!current_user_can('manage_woocommerce')) return new WP_Error('sf104_catalog_forbidden', 'A WooCommerce manager account is required.', ['status' => 403]);
        if (!function_exists('wc_get_product')) return new WP_Error('sf104_catalog_woo', 'WooCommerce must be active.', ['status' => 503]);
        return true;
    }
    static function can_product($id, $allow_missing = false) {
        $post = get_post((int) $id);
        if (!$post && $allow_missing) return;
        self::need($post && $post->post_type === 'product' && current_user_can('edit_post', (int) $id),
            'Your account cannot edit selected Woo product ' . $id . '.', 403);
    }
    static function table() { global $wpdb; return $wpdb->prefix . 'sf104_catalog_records'; }
    static function ensure() {
        if (self::$table_ready) return;
        global $wpdb;
        if (get_option('sf104_catalog_schema', '') !== self::VERSION) {
            require_once ABSPATH . 'wp-admin/includes/upgrade.php';
            $table = self::table(); $charset = $wpdb->get_charset_collate();
            dbDelta("CREATE TABLE {$table} (
                id char(36) NOT NULL,
                kind varchar(16) NOT NULL,
                project_id char(36) NOT NULL,
                revision bigint unsigned NOT NULL DEFAULT 0,
                created_at datetime NOT NULL,
                actor bigint unsigned NOT NULL,
                payload longtext NOT NULL,
                sha256 char(64) NOT NULL,
                PRIMARY KEY  (id),
                KEY project_kind (project_id,kind,created_at)
            ) ENGINE=InnoDB {$charset};");
            self::need($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table))) === $table,
                'The native catalog journal could not be created.', 503);
            update_option('sf104_catalog_schema', self::VERSION, false);
        }
        self::$table_ready = true;
    }
    static function lock_name() {
        global $wpdb;
        return 'sf104:catalog:' . substr(hash('sha256', DB_NAME . ':' . $wpdb->prefix), 0, 40);
    }
    static function assert_owned() {
        global $wpdb;
        self::need(self::$connection !== null &&
            (string) $wpdb->get_var('SELECT CONNECTION_ID()') === self::$connection &&
            (string) $wpdb->get_var($wpdb->prepare('SELECT IS_USED_LOCK(%s)', self::lock_name())) === self::$connection,
            'The original catalog connection or guard was interrupted. Reopen this same operation.', 503);
    }
    static function enter() {
        global $wpdb;
        if (self::$depth > 0) {
            self::assert_owned(); self::$depth++; return;
        }
        self::$guard_retries = $wpdb->reconnect_retries;
        $wpdb->reconnect_retries = 0;
        $acquired = false;
        try {
            $connection = (string) $wpdb->get_var('SELECT CONNECTION_ID()');
            self::need(preg_match('/^[1-9][0-9]*$/D', $connection), 'The original catalog database connection is unavailable.', 503);
            self::need((string) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 5)', self::lock_name())) === '1',
                'Another catalog or checkout preparation is finishing. Reopen this same request.', 409);
            $acquired = true; self::$connection = $connection;
            self::assert_owned(); self::$depth = 1;
        } catch (Throwable $e) {
            if ($acquired && (string) $wpdb->get_var('SELECT CONNECTION_ID()') === $connection &&
                (string) $wpdb->get_var($wpdb->prepare('SELECT IS_USED_LOCK(%s)', self::lock_name())) === $connection) {
                $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', self::lock_name()));
            }
            self::$connection = null; self::$depth = 0;
            $wpdb->reconnect_retries = self::$guard_retries; self::$guard_retries = null;
            throw $e;
        }
    }
    static function leave() {
        global $wpdb;
        if (self::$depth <= 0) return;
        if (--self::$depth > 0) return;
        try {
            self::assert_owned();
            self::need((string) $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', self::lock_name())) === '1',
                'The original catalog guard release was interrupted. Check this same request before continuing.', 503);
        } finally {
            self::$connection = null;
            $wpdb->reconnect_retries = self::$guard_retries; self::$guard_retries = null;
        }
    }
    static function with_lock($callback) {
        self::enter();
        try { $result = $callback(); self::assert_owned(); return $result; } finally { self::leave(); }
    }
    static function before_product_save($product, $data_store = null) {
        if (!$product) return;
        // A currently unmapped product can become mapped while its original
        // multi-query save is in progress. All native product saves share admission.
        $key = spl_object_hash($product);
        if (!isset(self::$held_products[$key])) { self::enter(); self::$held_products[$key] = true; }
    }
    static function after_product_save($product, $data_store = null) {
        if (!$product) return; $key = spl_object_hash($product);
        if (isset(self::$held_products[$key])) { unset(self::$held_products[$key]); self::leave(); }
    }
    static function shutdown() {
        self::$held_products = [];
        while (self::$depth > 0) { try { self::leave(); } catch (Throwable $e) { /* A lost connection already released its own lock. */ } }
    }
    static function clear_products($ids = []) {
        foreach ($ids as $id) { clean_post_cache((int) $id); wp_cache_delete((int) $id, 'post_meta'); }
        wp_cache_delete(self::OPTION, 'options'); wp_cache_delete('alloptions', 'options');
    }
    static function atomic($ids, $callback) {
        self::ensure(); global $wpdb;
        self::need(self::$depth > 0, 'Acquire the original catalog guard first.', 503);
        $tables = [self::table(), $wpdb->posts, $wpdb->postmeta, $wpdb->options, $wpdb->term_relationships];
        foreach ($tables as $table) {
            $engine = $wpdb->get_var($wpdb->prepare('SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s', $table));
            self::need(strtoupper((string) $engine) === 'INNODB', 'Catalog application requires native InnoDB tables: ' . $table . '.', 503);
        }
        self::need((string) $wpdb->get_var('SELECT @@SESSION.autocommit') === '1', 'Finish the existing database transaction before catalog application.', 503);
        self::need($wpdb->query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ') !== false,
            'A separate native catalog transaction is required.', 503);
        $retries = $wpdb->reconnect_retries; $wpdb->reconnect_retries = 0;
        $started = false; $watching = false;
        $watch = static function ($query) use ($wpdb) {
            if ($wpdb->last_error) self::fail('A native catalog write failed. Reopen the same request.', 503);
            self::need(preg_match('/^\s*(SELECT|INSERT|UPDATE|DELETE|REPLACE|SHOW|DESCRIBE|EXPLAIN|WITH)\b/i', $query),
                'A product hook attempted to leave the original catalog transaction.', 503);
            return $query;
        };
        try {
            self::need($wpdb->query('START TRANSACTION') !== false, 'The native catalog transaction could not start.', 503);
            $started = true;
            self::need($wpdb->query('SAVEPOINT sf104_catalog_apply') !== false, 'The catalog transaction marker could not be saved.', 503);
            add_filter('query', $watch, PHP_INT_MAX); $watching = true;
            foreach ($ids as $id) {
                self::need($wpdb->get_var($wpdb->prepare("SELECT ID FROM {$wpdb->posts} WHERE ID=%d AND post_type='product' FOR UPDATE", (int) $id)),
                    'The selected native product no longer exists: ' . $id . '.');
                $wpdb->get_results($wpdb->prepare("SELECT meta_id FROM {$wpdb->postmeta} WHERE post_id=%d FOR UPDATE", (int) $id));
                $wpdb->get_results($wpdb->prepare("SELECT object_id FROM {$wpdb->term_relationships} WHERE object_id=%d FOR UPDATE", (int) $id));
            }
            $wpdb->get_results($wpdb->prepare("SELECT option_id FROM {$wpdb->options} WHERE option_name IN (%s,%s,%s,%s,%s) FOR UPDATE",
                self::OPTION, 'woocommerce_currency', 'woocommerce_price_num_decimals', 'woocommerce_calc_taxes', 'woocommerce_prices_include_tax'));
            self::clear_products($ids);
            $result = $callback();
            if ($wpdb->last_error) self::fail('The catalog transaction reported a database error.', 503);
            remove_filter('query', $watch, PHP_INT_MAX); $watching = false;
            self::need($wpdb->query('RELEASE SAVEPOINT sf104_catalog_apply') !== false,
                'The original catalog transaction was interrupted. Reopen this same request.', 503);
            self::need($wpdb->query('COMMIT') !== false,
                'Catalog commit response unavailable. Check this original request before continuing.', 503);
            $started = false;
            return $result;
        } finally {
            if ($watching) remove_filter('query', $watch, PHP_INT_MAX);
            if ($started) $wpdb->query('ROLLBACK');
            $wpdb->reconnect_retries = $retries;
            self::clear_products($ids);
        }
    }
    static function row($id, $kind = null) {
        self::ensure(); self::need(self::uuid($id), 'Use the exact saved catalog identity.', 422);
        global $wpdb; $table = self::table();
        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$table} WHERE id=%s", $id), ARRAY_A);
        self::need(!$wpdb->last_error, 'The catalog journal is unavailable.', 503);
        if (!$row) return null;
        self::need($kind === null || $row['kind'] === $kind, 'This catalog identity belongs to another record.', 409);
        self::need(hash_equals($row['sha256'], hash('sha256', $row['payload'])), 'The saved catalog record differs from its byte identity.', 409);
        $value = json_decode($row['payload'], true, 64, JSON_BIGINT_AS_STRING);
        self::need(is_array($value) && json_last_error() === JSON_ERROR_NONE, 'The saved catalog record is invalid.', 409);
        return $value;
    }
    static function save_row($id, $kind, $project, $revision, $value, $previous = null) {
        global $wpdb; $table = self::table(); $raw = self::json($value);
        self::need(strlen($raw) <= self::MAX_PACKET, 'This catalog record exceeds its retained byte limit.', 422);
        $data = ['id' => $id, 'kind' => $kind, 'project_id' => $project, 'revision' => $revision,
            'created_at' => gmdate('Y-m-d H:i:s'), 'actor' => get_current_user_id(), 'payload' => $raw, 'sha256' => hash('sha256', $raw)];
        if ($previous === null) $saved = $wpdb->insert($table, $data, ['%s','%s','%s','%d','%s','%d','%s','%s']);
        else {
            unset($data['id'], $data['kind'], $data['project_id'], $data['created_at']);
            $saved = $wpdb->update($table, $data, ['id' => $id, 'kind' => $kind, 'sha256' => hash('sha256', self::json($previous))],
                ['%d','%d','%s','%s'], ['%s','%s','%s']);
        }
        self::need($saved === 1 && self::hash(self::row($id, $kind)) === self::hash($value), 'The native catalog record could not be committed. Reopen this request.', 503);
        return $value;
    }
    static function project($id) {
        $project = self::row($id, 'project'); self::need($project, 'This saved catalog workspace does not exist.', 404);
        return $project;
    }
    static function records($project, $kinds = [], $limit = 1000) {
        global $wpdb; $table = self::table();
        $rows = $wpdb->get_results($wpdb->prepare("SELECT id,kind FROM {$table} WHERE project_id=%s ORDER BY created_at,id LIMIT %d", $project, $limit + 1), ARRAY_A);
        self::need(!$wpdb->last_error, 'The catalog history is unavailable.', 503);
        self::need(count($rows) <= $limit, 'This project has more retained history than one export permits. Use the original full WordPress database backup.', 409);
        $result = [];
        foreach ($rows as $row) if (!$kinds || in_array($row['kind'], $kinds, true))
            $result[] = ['kind' => $row['kind'], 'id' => $row['id'], 'value' => self::row($row['id'], $row['kind'])];
        return $result;
    }
    static function request_result($id, $request = null) {
        $value = self::row($id, 'request');
        if ($value && $request !== null) self::need(hash_equals($value['inputSha256'], self::hash($request)),
            'This request ID belongs to different catalog inputs. Reopen the original saved request.', 409);
        return $value;
    }
    static function receipt($request, $project, $result) {
        $value = ['schema' => 'stellar-forge.sf104.catalog-request.v1', 'requestId' => $request['requestId'],
            'inputSha256' => self::hash($request), 'operation' => $request['action'], 'projectId' => $project,
            'at' => self::now(), 'actor' => get_current_user_id(), 'result' => $result];
        self::save_row($request['requestId'], 'request', $project, 0, $value);
        return $value;
    }


    static function settings() {
        $raw = get_option(self::OPTION, []);
        self::need(is_array($raw), 'The original gateway settings are invalid.');
        $ids = preg_split('/[,\s]+/', trim((string) ($raw['basket_product_ids'] ?? '')), -1, PREG_SPLIT_NO_EMPTY);
        return ['enabled' => ($raw['enabled'] ?? 'no') === 'yes', 'title' => (string) ($raw['title'] ?? 'Stellar x402'),
            'description' => (string) ($raw['description'] ?? 'Place your order, then download payment instructions for Stellar Forge. Your product is released after the store confirms settlement.'),
            'basketEnabled' => ($raw['basket_enabled'] ?? 'no') === 'yes', 'basketProductIds' => $ids ?: [],
            'basketRouteId' => (string) ($raw['basket_route_id'] ?? 'digital-basket'),
            'basketUrl' => (string) ($raw['basket_url'] ?? ''), 'basketMethod' => (string) ($raw['basket_method'] ?? 'GET')];
    }
    static function settings_native($settings, $base = null, $approve = false) {
        $out = $base === null ? get_option(self::OPTION, []) : $base;
        self::need(is_array($out), 'The original gateway settings are invalid.');
        foreach (['enabled' => 'enabled', 'title' => 'title', 'description' => 'description',
            'basketEnabled' => 'basket_enabled', 'basketRouteId' => 'basket_route_id',
            'basketUrl' => 'basket_url', 'basketMethod' => 'basket_method'] as $from => $to)
            $out[$to] = is_bool($settings[$from]) ? ($settings[$from] ? 'yes' : 'no') : $settings[$from];
        $out['basket_product_ids'] = implode(',', $settings['basketProductIds']);
        if ($approve && $settings['basketEnabled']) {
            $out['basket_approved_by'] = get_current_user_id(); $out['basket_approved_at'] = self::now();
        }
        return $out;
    }
    static function terms($mapping) {
        if (!is_array($mapping)) return null;
        $out = $mapping; unset($out['enabled'], $out['approvedBy'], $out['approvedAt']);
        return $out;
    }
    static function product_view($id, $allow_missing = false) {
        self::can_product($id, $allow_missing);
        $p = wc_get_product((int) $id);
        if (!$p) return ['productId' => $id, 'missing' => true, 'name' => 'Missing product ' . $id];
        $raw = $p->get_meta(Starforge_SF104_Checkout::PRODUCT_META, true, 'edit');
        $mapping = null; $error = null;
        if ($raw) try { $mapping = Starforge_SF104_Checkout::product_mapping($p); } catch (Throwable $e) { $error = $e->getMessage(); }
        $files = [];
        foreach ($p->get_downloads('edit') as $file) $files[] = ['id' => (string) $file->get_id(), 'name' => (string) $file->get_name(), 'file' => (string) $file->get_file()];
        $date = static function ($value) { return $value ? $value->date('c') : null; };
        return ['productId' => $id, 'missing' => false, 'name' => (string) $p->get_name('edit'), 'sku' => (string) $p->get_sku('edit'),
            'status' => (string) $p->get_status('edit'), 'type' => $p->get_type(), 'virtual' => $p->get_virtual('edit'),
            'downloadable' => $p->get_downloadable('edit'), 'price' => (string) $p->get_price('edit'),
            'regularPrice' => (string) $p->get_regular_price('edit'), 'salePrice' => (string) $p->get_sale_price('edit'),
            'saleFrom' => $date($p->get_date_on_sale_from('edit')), 'saleTo' => $date($p->get_date_on_sale_to('edit')),
            'taxStatus' => (string) $p->get_tax_status('edit'), 'taxClass' => (string) $p->get_tax_class('edit'),
            'stockStatus' => (string) $p->get_stock_status('edit'), 'downloads' => $files,
            'downloadLimit' => $p->get_download_limit('edit'), 'downloadExpiry' => $p->get_download_expiry('edit'),
            'mapping' => $mapping, 'rawMappingSha256' => self::hash($raw ?: null), 'mappingError' => $error,
            'editUrl' => get_edit_post_link((int) $id, '')];
    }
    static function observed($ids) {
        self::clear_products($ids);
        $products = [];
        foreach ($ids as $id) {
            $view = self::product_view($id, true); unset($view['editUrl']); $products[] = $view;
        }
        $body = ['storeOrigin' => Starforge_SF104_Checkout::store_origin(), 'currency' => get_woocommerce_currency(),
            'priceDecimals' => wc_get_price_decimals(), 'taxesEnabled' => wc_tax_enabled(),
            'pricesIncludeTax' => wc_prices_include_tax(), 'settings' => self::settings(),
            'settingsSha256' => self::hash(get_option(self::OPTION, [])), 'products' => $products];
        return ['sha256' => self::hash($body), 'at' => self::now(), 'content' => $body];
    }
    static function draft($ids) {
        $settings = self::settings();
        $settings['title'] = wp_strip_all_tags($settings['title']);
        $settings['description'] = wp_strip_all_tags($settings['description']);
        $ids = array_values(array_unique(array_merge($ids, $settings['basketProductIds'])));
        self::need(count($ids) <= 64, 'One commissioning plan supports up to 64 selected Woo products.', 422);
        usort($ids, [Starforge_SF104_Basket::class, 'compare']); $products = [];
        foreach ($ids as $id) {
            self::need(self::id($id), 'Choose exact existing Woo product IDs.', 422);
            $v = self::product_view($id);
            $products[] = ['productId' => $id, 'enabled' => $v['mapping'] !== null, 'terms' => $v['mapping'] ? self::terms($v['mapping']) :
                ['routeId' => 'product-' . $id, 'url' => '', 'method' => 'GET', 'network' => 'stellar:testnet',
                 'asset' => '', 'payTo' => '', 'amountAtomic' => '', 'maxTimeoutSeconds' => 60,
                 'storefront' => ['currency' => get_woocommerce_currency(), 'total' => $v['price']]]];
        }
        return ['schema' => self::PLAN, 'storeOrigin' => Starforge_SF104_Checkout::store_origin(),
            'settings' => $settings, 'products' => $products];
    }
    static function plan($raw) {
        self::fields($raw, ['schema','storeOrigin','settings','products']);
        self::need(($raw['schema'] ?? null) === self::PLAN && self::list_value($raw['products'] ?? null, 64) && count($raw['products']) >= 1,
            'Use a complete catalog plan with 1–64 product rows.', 422);
        $origin = self::text($raw['storeOrigin'] ?? null, 500, false);
        self::need(preg_match('~^https://[a-z0-9.-]+$~D', $origin), 'Keep the exact HTTPS store origin in this plan.', 422);
        $s = $raw['settings'] ?? null;
        self::fields($s, ['enabled','title','description','basketEnabled','basketProductIds','basketRouteId','basketUrl','basketMethod']);
        foreach (['enabled','basketEnabled'] as $key) self::need(is_bool($s[$key] ?? null), 'Use explicit enabled or disabled settings.', 422);
        foreach (['title' => 200,'description' => 4000,'basketRouteId' => 64,'basketUrl' => 2000,'basketMethod' => 8] as $key => $max)
            self::text($s[$key] ?? null, $max);
        foreach (['title', 'description'] as $key) self::need(wp_strip_all_tags($s[$key]) === $s[$key], 'Use plain text for the customer checkout label and instructions.', 422);
        self::need(self::list_value($s['basketProductIds'] ?? null, 64), 'Keep the complete selected basket product list.', 422);
        $seen = []; $out = [];
        foreach ($raw['products'] as $row) {
            self::fields($row, ['productId','enabled','terms']);
            $id = $row['productId'] ?? null;
            self::need(self::id($id) && !isset($seen[$id]) && is_bool($row['enabled'] ?? null), 'Keep distinct product IDs and an explicit mapping choice.', 422);
            $seen[$id] = true; $t = $row['terms'] ?? null;
            if ($t !== null) {
                self::fields($t, ['routeId','url','method','network','asset','payTo','amountAtomic','maxTimeoutSeconds','storefront']);
                foreach (['routeId' => 64,'url' => 2000,'method' => 8,'network' => 32,'asset' => 128,'payTo' => 128,'amountAtomic' => 128] as $key => $max)
                    self::text($t[$key] ?? null, $max);
                self::need(is_int($t['maxTimeoutSeconds'] ?? null) && $t['maxTimeoutSeconds'] >= 0 && $t['maxTimeoutSeconds'] <= 86400,
                    'Use a whole-number timeout up to 86400 seconds.', 422);
                self::fields($t['storefront'] ?? null, ['currency','total']);
                self::text($t['storefront']['currency'] ?? null, 8); self::text($t['storefront']['total'] ?? null, 32);
            }
            self::need(!$row['enabled'] || $t !== null, 'Enabled products need an explicit terms object.', 422);
            $out[] = ['productId' => $id, 'enabled' => $row['enabled'], 'terms' => $t];
        }
        $basket_seen = [];
        foreach ($s['basketProductIds'] as $id) {
            self::need(self::id($id) && isset($seen[$id]) && !isset($basket_seen[$id]),
                'Every basket product must be a distinct selected row in this complete plan.', 422);
            $basket_seen[$id] = true;
        }
        usort($out, static function ($a, $b) { return Starforge_SF104_Basket::compare($a['productId'], $b['productId']); });
        usort($s['basketProductIds'], [Starforge_SF104_Basket::class, 'compare']);
        return ['schema' => self::PLAN, 'storeOrigin' => $origin, 'settings' => $s, 'products' => $out];
    }
    static function compile_plan($plan) {
        $blockers = []; $warnings = []; $products = []; $routes = []; $maps = []; $catalog = null;
        $ids = []; $route_ids = []; $paths = [];
        if ($plan['storeOrigin'] !== Starforge_SF104_Checkout::store_origin()) $blockers[] = 'The plan belongs to another store origin. Save an explicitly rebound edition before applying it.';
        foreach ($plan['products'] as $row) {
            $id = $row['productId']; $ids[] = $id;
            try {
                self::can_product($id);
                $p = wc_get_product((int) $id);
                self::need($p, 'The selected product no longer exists.');
                $products[$id] = $p;
                if (!$row['enabled']) { $maps[$id] = null; $p->delete_meta_data(Starforge_SF104_Checkout::PRODUCT_META); continue; }
                $map = Starforge_SF104_Checkout::mapping(array_merge($row['terms'],
                    ['enabled' => 'yes', 'approvedBy' => get_current_user_id(), 'approvedAt' => self::now()]));
                self::need($map['storefront']['currency'] === get_woocommerce_currency(), 'The mapped store currency must match the current Woo currency.');
                if (!wc_tax_enabled() || $p->get_tax_status() !== 'taxable') {
                    $price = $p->get_price('edit');
                    self::need($price !== '' && Starforge_SF104_Checkout::decimal(wc_format_decimal($price, wc_get_price_decimals())) === $map['storefront']['total'],
                        'The declared store total differs from this current untaxed product price. Update the original Woo product first, then save and compare these exact terms.');
                }
                $p->update_meta_data(Starforge_SF104_Checkout::PRODUCT_META, $map);
                Starforge_SF104_Checkout::product_mapping($p);
                $route = Starforge_SF104_Checkout::route_declaration($p);
                $path = strtolower($route['method'] . ' ' . $route['url']);
                self::need(!isset($route_ids[$route['routeId']]) && !isset($paths[$path]), 'Current products need distinct seller route IDs and method/URL bindings.');
                $route_ids[$route['routeId']] = true; $paths[$path] = true;
                $maps[$id] = $map; $routes[] = $route;
                if ($p->get_status() !== 'publish') $warnings[] = 'Product ' . $id . ' is ' . $p->get_status() . '; its original Woo visibility still controls checkout.';
                if ($p->get_tax_status() === 'taxable' && wc_tax_enabled()) $warnings[] = 'Product ' . $id . ': the declared store total must include the exact applicable tax. The original checkout checks the final amount.';
            } catch (Throwable $e) { $blockers[] = 'Product ' . $id . ': ' . $e->getMessage(); }
        }
        if ($plan['settings']['enabled'] && !$routes) $blockers[] = 'Enable at least one valid product mapping before enabling Stellar checkout.';
        if ($plan['settings']['basketEnabled']) try {
            $settings = self::settings_native($plan['settings'], []);
            $catalog = Starforge_SF104_Basket::compile_catalog($settings, static function ($id) use ($products) { return $products[(string) $id] ?? null; });
        } catch (Throwable $e) { $blockers[] = 'Basket: ' . $e->getMessage(); }
        return ['productIds' => $ids, 'mappings' => $maps, 'routes' => $routes, 'catalog' => $catalog,
            'blockers' => array_values(array_unique($blockers)), 'warnings' => array_values(array_unique($warnings))];
    }
    static function retained_orders() {
        $rows = []; $route_versions = []; $catalogs = []; $page = 1;
        do {
            $result = wc_get_orders(['payment_method' => Starforge_SF104_Checkout::ID,
                'status' => ['pending','on-hold','checkout-draft'], 'limit' => 100, 'page' => $page,
                'paginate' => true, 'orderby' => 'ID', 'order' => 'ASC']);
            self::need(is_object($result) && isset($result->orders, $result->max_num_pages), 'The original pending-order inventory is unavailable.', 503);
            self::need($result->max_num_pages <= 200, 'The pending-order inventory exceeds this bounded catalog handoff. Keep the current seller and reconcile the store inventory before a new handoff.', 409);
            foreach ($result->orders as $order) {
                if ($order->is_paid()) continue;
                $record = $order->get_meta(Starforge_SF104_Checkout::SNAPSHOT_META, true);
                if (!$record) continue;
                self::need(is_array($record) && is_array($record['handoff'] ?? null) && is_string($record['digest'] ?? null),
                    'Unpaid order ' . $order->get_id() . ' has an incomplete original snapshot.');
                $body = $record; unset($body['digest']);
                self::need(hash_equals($record['digest'], Starforge_SF104_Checkout::digest($body)),
                    'Unpaid order ' . $order->get_id() . ' has a changed original snapshot.');
                $h = $record['handoff']; $error = null;
                try { Starforge_SF104_Checkout::snapshot($order); } catch (Throwable $e) { $error = $e->getMessage(); }
                self::need(($h['storeOrigin'] ?? null) === Starforge_SF104_Checkout::store_origin(),
                    'The original store origin changed for unpaid order ' . $order->get_id() . '. Keep its original seller origin and reconcile that site move first.');
                if (($h['schema'] ?? '') === Starforge_SF104_Basket::SCHEMA) {
                    $c = $record['catalog'] ?? null; Starforge_SF104_Basket::indexed($c);
                    $catalogs[$c['catalogDigest']] = $c;
                    $version = $c['catalogDigest'];
                } else {
                    self::need(($h['schema'] ?? '') === Starforge_SF104_Checkout::HANDOFF_SCHEMA, 'An unpaid order uses an unsupported frozen handoff.');
                    $route = ['productId' => $h['productId'], 'routeId' => $h['routeId'],
                        'url' => strtok($h['operation']['url'], '?'), 'method' => $h['operation']['method'],
                        'expect' => $h['operation']['expect'], 'description' => 'Retained original Woo product payment terms.'];
                    $version = self::route_digest($route); $route_versions[$version] = $route;
                }
                $rows[] = ['orderReference' => (string) $order->get_id(), 'status' => $order->get_status(),
                    'snapshotSha256' => $record['digest'], 'handoffSchema' => $h['schema'], 'versionSha256' => $version,
                    'availableNow' => $error === null, 'availabilityReason' => $error];
            }
            $page++;
        } while ($page <= (int) $result->max_num_pages);
        self::need(count($route_versions) <= 256 && count($catalogs) <= 256,
            'This store needs more than 256 retained payment versions. Keep its current seller and preserve the complete original order inventory.');
        return ['orders' => $rows, 'routeVersions' => array_values($route_versions), 'baskets' => array_values($catalogs)];
    }
    static function route_digest($route) {
        $value = $route; unset($value['description']);
        return self::hash($value);
    }
    static function seller_constraints($compiled, $retained) {
        $versions = []; $catalogs = []; $origins = []; $blockers = [];
        foreach (array_merge($retained['routeVersions'], $compiled['routes']) as $route) $versions[self::route_digest($route)] = $route;
        foreach ($retained['baskets'] as $catalog) $catalogs[$catalog['catalogDigest']] = $catalog;
        if ($compiled['catalog']) $catalogs[$compiled['catalog']['catalogDigest']] = $compiled['catalog'];
        foreach (array_merge(array_values($versions), array_values($catalogs)) as $entry) {
            $url = wp_parse_url($entry['url']);
            if (!is_array($url) || !isset($url['scheme'], $url['host'])) { $blockers[] = 'A saved seller URL is not available.'; continue; }
            $scheme = strtolower($url['scheme']); $port = $url['port'] ?? ($scheme === 'https' ? 443 : 80);
            $origins[$scheme . '://' . strtolower($url['host']) . ':' . $port] = true;
        }
        if (count($versions) > 256 || count($catalogs) > 256) $blockers[] = 'The current and pending-order terms exceed 256 retained route or basket versions. Keep the existing seller configuration and review its original order inventory.';
        if (count($origins) > 1) $blockers[] = 'One original seller configuration uses one public origin. Keep earlier pending-order URLs on that origin when changing paths or terms; a separate origin move needs its original ingress and seller migration first.';
        return $blockers;
    }
    static function seller_handoff($project, $edition, $compiled, $retained) {
        $versions = [];
        foreach (array_merge($retained['routeVersions'], $compiled['routes']) as $r) $versions[self::route_digest($r)] = $r;
        $baskets = [];
        foreach ($retained['baskets'] as $c) $baskets[$c['catalogDigest']] = $c;
        if ($compiled['catalog']) $baskets[$compiled['catalog']['catalogDigest']] = $compiled['catalog'];
        $out = ['schema' => self::HANDOFF, 'projectId' => $project['id'], 'editionId' => $edition['id'],
            'storeOrigin' => Starforge_SF104_Checkout::store_origin(), 'createdAt' => self::now(),
            'admissionUrl' => rest_url('stellar-forge/v1/checkout-admission'),
            'selectedProductIds' => array_column($edition['plan']['products'], 'productId'),
            'routes' => $compiled['routes'], 'routeVersions' => array_values($versions), 'baskets' => array_values($baskets),
            'retainedOrders' => $retained['orders'], 'settings' => $edition['plan']['settings'],
            'delivery' => 'The original Woo order, native SF30 verification, SF98 outbox and independent merchant release remain authoritative.'];
        $out['sha256'] = self::hash($out);
        self::need(strlen(self::json($out)) <= 16777216, 'The complete retained seller handoff exceeds 16 MiB. Keep the existing seller and original order inventory.', 409);
        return $out;
    }


    static function edition($project) {
        $edition = self::row($project['currentEdition'], 'edition');
        self::need($edition && $edition['projectId'] === $project['id'], 'The current saved catalog edition is missing.');
        return $edition;
    }
    static function check_revision($project, $request) {
        self::need(is_int($request['expectedRevision'] ?? null) && $request['expectedRevision'] === $project['revision'],
            'This catalog changed after it was opened. Refresh its saved history before a new decision.', 409);
    }
    static function view($id) {
        $p = self::project($id); $e = self::edition($p);
        foreach ($e['plan']['products'] as $row) self::can_product($row['productId'], true);
        $history = []; $review = null; $applied = null; $sources = [];
        foreach (self::records($id, ['edition','review','application','source','request']) as $row) {
            $v = $row['value'];
            $summary = ['id' => $row['id'], 'kind' => $row['kind'], 'at' => $v['at'] ?? $v['createdAt'] ?? '',
                'actor' => $v['actor'] ?? null, 'revision' => $v['revision'] ?? $v['projectRevision'] ?? null,
                'note' => $v['note'] ?? '', 'editionId' => $v['editionId'] ?? null];
            if ($row['kind'] === 'review' && $v['editionId'] === $e['id'] &&
                (!$review || strcmp($v['at'] . $v['id'], $review['at'] . $review['id']) > 0)) $review = $v;
            if ($row['kind'] === 'application' && (!$applied || $v['revision'] > $applied['revision'])) $applied = $v;
            if ($row['kind'] === 'source') $sources[] = ['id' => $v['id'], 'name' => $v['name'], 'sha256' => $v['sha256'],
                'bytes' => $v['bytes'], 'sourceKind' => $v['sourceKind'], 'at' => $v['at']];
            if ($row['kind'] !== 'request') $history[] = $summary;
        }
        usort($history, static function ($a, $b) { return strcmp($b['at'] . $b['id'], $a['at'] . $a['id']); });
        $ids = array_column($e['plan']['products'], 'productId');
        $links = []; foreach ($ids as $pid) if (get_post((int) $pid)) $links[$pid] = get_edit_post_link((int) $pid, '');
        return ['schema' => 'stellar-forge.sf104.catalog-view.v1', 'project' => $p, 'edition' => $e,
            'current' => self::observed($ids), 'review' => $review, 'application' => $applied, 'history' => $history, 'sources' => $sources,
            'links' => ['products' => $links, 'settings' => admin_url('admin.php?page=wc-settings&tab=checkout&section=sf104_native')]];
    }
    static function new_project($request, $plan, $origin = null) {
        $id = wp_generate_uuid4(); $eid = wp_generate_uuid4(); $at = self::now();
        $project = ['schema' => 'stellar-forge.sf104.catalog-project.v1', 'id' => $id,
            'title' => self::text($request['title'] ?? '', 200, false), 'revision' => 1, 'currentEdition' => $eid,
            'createdAt' => $at, 'updatedAt' => $at, 'createdBy' => get_current_user_id(), 'origin' => $origin];
        $edition = ['schema' => 'stellar-forge.sf104.catalog-edition.v1', 'id' => $eid, 'projectId' => $id,
            'revision' => 1, 'at' => $at, 'actor' => get_current_user_id(), 'note' => 'Initial saved catalog plan.',
            'plan' => $plan, 'planSha256' => self::hash($plan)];
        self::save_row($id, 'project', $id, 1, $project); self::save_row($eid, 'edition', $id, 1, $edition);
        return $project;
    }
    static function save_edition($project, $request, $plan) {
        self::check_revision($project, $request);
        $id = wp_generate_uuid4(); $at = self::now(); $revision = $project['revision'] + 1;
        $edition = ['schema' => 'stellar-forge.sf104.catalog-edition.v1', 'id' => $id, 'projectId' => $project['id'],
            'revision' => $revision, 'at' => $at, 'actor' => get_current_user_id(),
            'note' => self::text($request['note'] ?? '', 2000), 'plan' => $plan, 'planSha256' => self::hash($plan)];
        self::save_row($id, 'edition', $project['id'], $revision, $edition);
        $next = $project; $next['currentEdition'] = $id; $next['revision'] = $revision; $next['updatedAt'] = $at;
        if (isset($request['title'])) $next['title'] = self::text($request['title'], 200, false);
        self::save_row($project['id'], 'project', $project['id'], $revision, $next, $project);
        return $next;
    }
    static function create_review($project, $request) {
        self::check_revision($project, $request);
        $edition = self::edition($project);
        self::need(($request['editionId'] ?? null) === $edition['id'], 'Review the current saved catalog edition.');
        $compiled = self::compile_plan($edition['plan']);
        $observed = self::observed($compiled['productIds']);
        $retained = self::retained_orders();
        $compiled['blockers'] = array_merge($compiled['blockers'], self::seller_constraints($compiled, $retained));
        $proposed = ['settings' => $edition['plan']['settings'], 'products' => []];
        foreach ($edition['plan']['products'] as $r) $proposed['products'][] = [
            'productId' => $r['productId'], 'enabled' => $r['enabled'],
            'terms' => isset($compiled['mappings'][$r['productId']]) ? self::terms($compiled['mappings'][$r['productId']]) : $r['terms']];
        $review = ['schema' => 'stellar-forge.sf104.catalog-review.v1', 'id' => wp_generate_uuid4(), 'projectId' => $project['id'],
            'editionId' => $edition['id'], 'editionSha256' => $edition['planSha256'], 'projectRevision' => $project['revision'],
            'at' => self::now(), 'actor' => get_current_user_id(), 'current' => $observed, 'proposed' => $proposed,
            'blockers' => $compiled['blockers'], 'warnings' => $compiled['warnings'], 'retainedOrders' => $retained['orders'],
            'seller' => ['currentRoutes' => count($compiled['routes']), 'currentBasket' => $compiled['catalog'] ? $compiled['catalog']['catalogDigest'] : null,
                'retainedRoutes' => count($retained['routeVersions']), 'retainedBaskets' => count($retained['baskets'])]];
        self::save_row($review['id'], 'review', $project['id'], $project['revision'], $review);
        return ['projectId' => $project['id'], 'reviewId' => $review['id'], 'status' => $review['blockers'] ? 'CHANGES_REQUIRED' : 'REVIEW_READY'];
    }
    static function apply_review($project, $request) {
        self::check_revision($project, $request);
        self::need(($request['confirm'] ?? false) === true, 'Confirm the exact reviewed catalog application.', 422);
        $note = self::text($request['note'] ?? '', 2000, false);
        $review = self::row($request['reviewId'] ?? '', 'review'); $edition = self::edition($project);
        self::need($review && $review['projectId'] === $project['id'] && $review['editionId'] === $edition['id'] &&
            $review['editionSha256'] === $edition['planSha256'] && $review['projectRevision'] === $project['revision'],
            'This review is no longer the current saved edition. Create a fresh comparison.');
        self::need(!$review['blockers'], 'Complete the original review blockers before applying this catalog.');
        $compiled = self::compile_plan($edition['plan']);
        self::need(!$compiled['blockers'], implode(' ', $compiled['blockers']));
        $current = self::observed($compiled['productIds']);
        self::need(hash_equals($review['current']['sha256'], $current['sha256']),
            'Current product data or gateway settings changed after review. Nothing was applied; open a fresh comparison.');
        // The same guard covers native checkout preparation. New old-version
        // orders are therefore either in this inventory or use the new catalog.
        $retained = self::retained_orders();
        $seller_blockers = self::seller_constraints($compiled, $retained);
        self::need(!$seller_blockers, implode(' ', $seller_blockers));
        foreach ($compiled['mappings'] as $id => $mapping) {
            self::can_product((string) $id); $product = wc_get_product((int) $id);
            self::need($product && method_exists($product->get_data_store(), 'get_current_class_name') &&
                $product->get_data_store()->get_current_class_name() === 'WC_Product_Data_Store_CPT',
                'Atomic catalog application requires the original Woo product data store.');
            $old = $product->get_meta(Starforge_SF104_Checkout::PRODUCT_META, true, 'edit');
            if ($mapping === null) $product->delete_meta_data(Starforge_SF104_Checkout::PRODUCT_META);
            elseif (is_array($old) && self::hash(self::terms($old)) === self::hash(self::terms($mapping))) {
                // Preserve an unchanged original approval instead of rewriting it.
                $mapping = $old; $compiled['mappings'][$id] = $old;
            } else $product->update_meta_data(Starforge_SF104_Checkout::PRODUCT_META, $mapping);
            $product->save_meta_data();
        }
        $settings = self::settings_native($edition['plan']['settings'], null, true);
        update_option(self::OPTION, $settings);
        self::clear_products($compiled['productIds']);
        $after = self::observed($compiled['productIds']);
        foreach ($after['content']['products'] as $p) {
            $expected = $compiled['mappings'][$p['productId']] ?? null;
            self::need(self::hash(self::terms($p['mapping'])) === self::hash(self::terms($expected)),
                'A native product hook changed the requested catalog terms. No catalog application was committed.', 503);
        }
        self::need(self::hash(self::settings()) === self::hash($edition['plan']['settings']),
            'The native gateway settings did not retain this exact reviewed plan.', 503);
        $actual = self::compile_plan($edition['plan']);
        self::need(!$actual['blockers'], 'The resulting original catalog could not be compiled.', 503);
        $handoff = self::seller_handoff($project, $edition, $actual, $retained);
        $id = wp_generate_uuid4(); $revision = $project['revision'] + 1; $at = self::now();
        $application = ['schema' => 'stellar-forge.sf104.catalog-application.v1', 'id' => $id, 'projectId' => $project['id'],
            'editionId' => $edition['id'], 'reviewId' => $review['id'], 'requestId' => $request['requestId'],
            'revision' => $revision, 'at' => $at, 'actor' => get_current_user_id(), 'note' => $note,
            'before' => $current, 'after' => $after, 'handoff' => $handoff];
        self::save_row($id, 'application', $project['id'], $revision, $application);
        $next = $project; $next['revision'] = $revision; $next['updatedAt'] = $at; $next['latestApplication'] = $id;
        self::save_row($project['id'], 'project', $project['id'], $revision, $next, $project);
        return ['status' => 'CATALOG_APPLIED', 'projectId' => $project['id'], 'applicationId' => $id,
            'revision' => $revision, 'handoffSha256' => $handoff['sha256']];
    }
    static function source_bytes($source) {
        self::fields($source, ['name','base64','sha256']);
        self::text($source['name'] ?? null, 200, false);
        self::need(is_string($source['base64'] ?? null) && strlen($source['base64']) <= 22369624 &&
            is_string($source['sha256'] ?? null) && preg_match('/^[0-9a-f]{64}$/D', $source['sha256']),
            'Choose a complete UTF-8 catalog source or workspace up to 16 MiB.', 422);
        $bytes = base64_decode($source['base64'], true);
        self::need(is_string($bytes) && strlen($bytes) <= 16777216 && strlen($bytes) > 0 &&
            hash_equals(hash('sha256', $bytes), $source['sha256']) && preg_match('//u', $bytes),
            'The imported bytes differ from the selected UTF-8 source.', 422);
        return $bytes;
    }
    static function csv_plan($raw) {
        self::need(strlen($raw) <= self::MAX_INPUT, 'CSV catalog sources are limited to 2 MiB.', 422);
        $f = fopen('php://temp', 'w+'); fwrite($f, preg_replace('/^\xEF\xBB\xBF/', '', $raw)); rewind($f);
        try {
            $header = fgetcsv($f, 0, ',', '"', '');
            $columns = ['productId','enabled','routeId','url','method','network','asset','payTo','amountAtomic','maxTimeoutSeconds','currency','total'];
            self::need(is_array($header) && count($header) === count($columns) && !array_diff($header, $columns) &&
                count(array_unique($header)) === count($header), 'CSV needs each exact template column once.', 422);
            $rows = [];
            while (($values = fgetcsv($f, 0, ',', '"', '')) !== false) {
                if ($values === [null]) continue;
                self::need(count($values) === count($header) && count($rows) < 64, 'Use at most 64 complete CSV rows.', 422);
                $r = array_combine($header, $values);
                self::need(in_array($r['enabled'], ['true','false'], true) && preg_match('/^[0-9]{1,5}$/D', $r['maxTimeoutSeconds']),
                    'CSV enabled values are true/false; timeout is an exact integer.', 422);
                $rows[] = ['productId' => $r['productId'], 'enabled' => $r['enabled'] === 'true',
                    'terms' => ['routeId' => $r['routeId'], 'url' => $r['url'], 'method' => $r['method'], 'network' => $r['network'],
                        'asset' => $r['asset'], 'payTo' => $r['payTo'], 'amountAtomic' => $r['amountAtomic'],
                        'maxTimeoutSeconds' => (int) $r['maxTimeoutSeconds'], 'storefront' => ['currency' => $r['currency'], 'total' => $r['total']]]];
            }
        } finally { fclose($f); }
        $s = self::settings();
        $s['title'] = wp_strip_all_tags($s['title']); $s['description'] = wp_strip_all_tags($s['description']);
        $ids = array_column($rows, 'productId');
        if (array_diff($s['basketProductIds'], $ids)) {
            $s['basketEnabled'] = false; $s['basketProductIds'] = [];
        }
        return self::plan(['schema' => self::PLAN, 'storeOrigin' => Starforge_SF104_Checkout::store_origin(), 'settings' => $s, 'products' => $rows]);
    }
    static function source_id($sha, $project) {
        $hex = hash('sha256', 'sf104-catalog-source:' . $project . ':' . $sha);
        return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-4' . substr($hex, 13, 3) . '-8' . substr($hex, 17, 3) . '-' . substr($hex, 20, 12);
    }
    static function import_source($request) {
        $bytes = self::source_bytes($request['source'] ?? null);
        $source = $request['source']; $target = $request['projectId'] ?? null;
        self::need($target === null || self::uuid($target), 'Choose the exact target catalog workspace.', 422);
        $sid = self::source_id($source['sha256'], $target ?: 'new');
        $prior = self::row($sid, 'source');
        if ($prior) {
            self::need($prior['sha256'] === $source['sha256'] && $prior['bytes'] === strlen($bytes), 'The retained source identity conflicts.');
            $p = self::project($prior['projectId']);
            foreach (self::edition($p)['plan']['products'] as $r) self::can_product($r['productId'], true);
            return ['status' => 'SOURCE_REOPENED', 'projectId' => $p['id'], 'sourceId' => $sid, 'revision' => $p['revision']];
        }
        $value = json_decode(preg_replace('/^\xEF\xBB\xBF/', '', $bytes), true, 64, JSON_BIGINT_AS_STRING);
        $origin = null; $kind = 'plan';
        if (is_array($value) && ($value['schema'] ?? '') === self::WORKSPACE) {
            $kind = 'workspace'; $body = $value; unset($body['sha256']);
            self::need(is_string($value['sha256'] ?? null) && hash_equals(self::hash($body), $value['sha256']) &&
                self::list_value($value['records'] ?? null, 1000) && is_array($value['project'] ?? null), 'The complete workspace packet has changed.', 422);
            $incoming = $value['project']; $current = null; $seen = [];
            self::need(self::uuid($incoming['id'] ?? null) && self::uuid($incoming['currentEdition'] ?? null), 'The original workspace identity is invalid.', 422);
            foreach ($value['records'] as $row) {
                self::need(is_array($row) && self::uuid($row['id'] ?? null) && !isset($seen[$row['id']]) &&
                    in_array($row['kind'] ?? null, ['edition','review','application','source','request'], true) && is_array($row['value'] ?? null),
                    'The full workspace record inventory is invalid.', 422);
                $seen[$row['id']] = $row;
                self::need(($row['value']['id'] ?? $row['value']['requestId'] ?? null) === $row['id'], 'A retained record changed its original identity.', 422);
                self::need(($row['value']['projectId'] ?? null) === $incoming['id'], 'A retained record belongs to another workspace.', 422);
                if ($row['kind'] === 'edition') {
                    $plan = self::plan($row['value']['plan'] ?? null);
                    self::need(self::hash($plan) === ($row['value']['planSha256'] ?? null), 'A retained catalog edition changed.', 422);
                    if ($row['id'] === $incoming['currentEdition']) $current = $plan;
                }
                if ($row['kind'] === 'source') {
                    $source_raw = self::source_bytes(['name' => $row['value']['name'], 'base64' => $row['value']['base64'], 'sha256' => $row['value']['sha256']]);
                    self::need(strlen($source_raw) === ($row['value']['bytes'] ?? null), 'A retained source length changed.', 422);
                }
                if ($row['kind'] === 'application') {
                    $h = $row['value']['handoff'] ?? null; self::need(is_array($h) && ($h['schema'] ?? null) === self::HANDOFF, 'A retained application omitted its complete seller handoff.', 422);
                    $hc = $h; unset($hc['sha256']);
                    self::need(self::hash($hc) === ($h['sha256'] ?? null) && ($h['projectId'] ?? null) === $incoming['id'] &&
                        ($h['editionId'] ?? null) === ($row['value']['editionId'] ?? null), 'A retained seller handoff differs from its application.', 422);
                }
            }
            self::need($current !== null, 'The complete workspace omitted its current saved edition.', 422);
            if (isset($incoming['latestApplication'])) self::need(($seen[$incoming['latestApplication']]['kind'] ?? null) === 'application', 'The complete workspace omitted its latest application.', 422);
            foreach ($seen as $row) {
                if (in_array($row['kind'], ['review','application'], true)) self::need(($seen[$row['value']['editionId'] ?? '']['kind'] ?? null) === 'edition', 'A history entry omitted its original saved edition.', 422);
                if ($row['kind'] === 'application') self::need(($seen[$row['value']['reviewId'] ?? '']['kind'] ?? null) === 'review' &&
                    ($seen[$row['value']['requestId'] ?? '']['kind'] ?? null) === 'request', 'A retained application omitted its original review or request.', 422);
            }
            $plan = $current;
            $origin = ['storeOrigin' => $value['storeOrigin'], 'projectId' => $incoming['id'], 'workspaceSha256' => $value['sha256'],
                'sourceSha256' => $source['sha256'], 'history' => 'Retained original history is inside the exact imported workspace source; it grants no current-store application approval.'];
            if (!isset($request['title'])) $request['title'] = $incoming['title'];
        } elseif (is_array($value) && ($value['schema'] ?? '') === self::PLAN) $plan = self::plan($value);
        else { $kind = 'csv'; $plan = self::csv_plan($bytes); }
        foreach ($plan['products'] as $row) self::can_product($row['productId'], true);
        if ($target) $project = self::save_edition(self::project($target), $request, $plan);
        else $project = self::new_project($request, $plan, $origin);
        $record = ['schema' => 'stellar-forge.sf104.catalog-source.v1', 'id' => $sid, 'projectId' => $project['id'],
            'name' => $source['name'], 'sha256' => $source['sha256'], 'bytes' => strlen($bytes), 'base64' => base64_encode($bytes),
            'sourceKind' => $kind, 'at' => self::now(), 'actor' => get_current_user_id()];
        self::save_row($sid, 'source', $project['id'], $project['revision'], $record);
        return ['status' => 'SOURCE_IMPORTED', 'projectId' => $project['id'], 'sourceId' => $sid, 'revision' => $project['revision']];
    }
    static function mutate($request) {
        self::need(is_array($request) && self::uuid($request['requestId'] ?? null), 'Retain one UUID for this catalog request.', 422);
        $action = $request['action'] ?? '';
        self::need(in_array($action, ['create','save','review','apply','import'], true), 'Choose a supported catalog action.', 422);
        $allowed = [
            'create' => ['action','requestId','title','productIds'],
            'save' => ['action','requestId','projectId','expectedRevision','plan','note','title'],
            'review' => ['action','requestId','projectId','expectedRevision','editionId'],
            'apply' => ['action','requestId','projectId','expectedRevision','reviewId','confirm','note'],
            'import' => ['action','requestId','projectId','expectedRevision','source','note','title']
        ];
        self::fields($request, $allowed[$action]);
        return self::with_lock(static function () use ($request, $action) {
            self::ensure();
            $previous = self::request_result($request['requestId'], $request);
            if ($previous) {
                $p = self::project($previous['projectId']);
                foreach (self::edition($p)['plan']['products'] as $r) self::can_product($r['productId'], true);
                return ['reused' => true, 'receipt' => $previous];
            }
            $ids = [];
            if (isset($request['projectId']) && $request['projectId'] !== null) {
                $project = self::project($request['projectId']);
                $ids = array_column(self::edition($project)['plan']['products'], 'productId');
                foreach ($ids as $id) self::can_product($id, $action !== 'apply');
            }
            return self::atomic($action === 'apply' ? $ids : [], static function () use ($request, $action) {
                if ($action === 'create') {
                    self::need(self::list_value($request['productIds'] ?? null, 64), 'Select existing product IDs.', 422);
                    $plan = self::plan(self::draft($request['productIds']));
                    $project = self::new_project($request, $plan);
                    $result = ['status' => 'CATALOG_CREATED', 'projectId' => $project['id'], 'revision' => 1];
                } elseif ($action === 'import') $result = self::import_source($request);
                else {
                    $project = self::project($request['projectId']);
                    if ($action === 'save') {
                        $plan = self::plan($request['plan'] ?? null);
                        foreach ($plan['products'] as $row) self::can_product($row['productId'], true);
                        $project = self::save_edition($project, $request, $plan);
                        $result = ['status' => 'EDITION_SAVED', 'projectId' => $project['id'], 'revision' => $project['revision']];
                    } elseif ($action === 'review') $result = self::create_review($project, $request);
                    else $result = self::apply_review($project, $request);
                }
                return ['reused' => false, 'receipt' => self::receipt($request, $result['projectId'], $result)];
            });
        });
    }


    static function status() {
        self::ensure();
        return ['schema' => 'stellar-forge.sf104.catalog-status.v1', 'storeOrigin' => Starforge_SF104_Checkout::store_origin(),
            'currency' => get_woocommerce_currency(), 'priceDecimals' => wc_get_price_decimals(), 'settings' => self::settings(),
            'limits' => ['products' => 64, 'sourceBytes' => self::MAX_INPUT, 'workspaceBytes' => 16777216, 'historyRecords' => 1000],
            'gatewayConfigured' => Starforge_SF98_Woo::secret() !== null,
            'merchantUrl' => admin_url('admin.php?page=sf98-woocommerce'),
            'gatewayUrl' => admin_url('admin.php?page=wc-settings&tab=checkout&section=sf104_native'),
            'currentUser' => ['id' => get_current_user_id(), 'name' => wp_get_current_user()->display_name]];
    }
    static function projects($request) {
        self::ensure(); global $wpdb; $table = self::table();
        $page = max(1, min(100000, (int) ($request->get_param('page') ?: 1)));
        $limit = max(1, min(50, (int) ($request->get_param('limit') ?: 20)));
        $count = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$table} WHERE kind='project'");
        $ids = $wpdb->get_col($wpdb->prepare("SELECT id FROM {$table} WHERE kind='project' ORDER BY created_at DESC,id DESC LIMIT %d OFFSET %d", $limit, ($page - 1) * $limit));
        self::need(!$wpdb->last_error, 'The saved catalog list is unavailable.', 503); $items = [];
        foreach ($ids as $id) {
            $p = self::project($id); $e = self::edition($p);
            $allowed = true;
            foreach ($e['plan']['products'] as $row) if (get_post((int) $row['productId']) && !current_user_can('edit_post', (int) $row['productId'])) $allowed = false;
            if ($allowed) $items[] = ['id' => $p['id'], 'title' => $p['title'], 'revision' => $p['revision'],
                'updatedAt' => $p['updatedAt'], 'products' => count($e['plan']['products']),
                'mappedProducts' => count(array_filter($e['plan']['products'], static function ($r) { return $r['enabled']; })),
                'latestApplication' => $p['latestApplication'] ?? null, 'origin' => $p['origin']];
        }
        return ['schema' => 'stellar-forge.sf104.catalog-projects.v1', 'projects' => $items, 'page' => $page, 'limit' => $limit,
            'total' => $count, 'hasNext' => $page * $limit < $count];
    }
    static function products($request) {
        $page = max(1, min(100000, (int) ($request->get_param('page') ?: 1)));
        $limit = max(1, min(50, (int) ($request->get_param('limit') ?: 20)));
        $search = (string) ($request->get_param('q') ?? ''); self::text($search, 120);
        $query = ['limit' => $limit, 'page' => $page, 'paginate' => true, 'return' => 'ids',
            'status' => ['publish','private','draft','pending','future'], 'orderby' => 'ID', 'order' => 'ASC'];
        if ($search !== '') {
            if (self::id($search)) $query['include'] = [(int) $search]; else $query['s'] = $search;
        }
        $result = wc_get_products($query);
        self::need(is_object($result) && isset($result->products, $result->total, $result->max_num_pages), 'The Woo product inventory is unavailable.', 503);
        $rows = [];
        foreach ($result->products as $id) if (current_user_can('edit_post', $id)) $rows[] = self::product_view((string) $id);
        return ['schema' => 'stellar-forge.sf104.catalog-products.v1', 'products' => $rows, 'page' => $page,
            'limit' => $limit, 'total' => (int) $result->total, 'hasNext' => $page < (int) $result->max_num_pages];
    }
    static function export_workspace($id) {
        $project = self::project($id); self::view($id);
        $packet = ['schema' => self::WORKSPACE, 'storeOrigin' => Starforge_SF104_Checkout::store_origin(),
            'createdAt' => self::now(), 'project' => $project,
            'records' => self::records($id, ['edition','review','application','source','request'])];
        $packet['sha256'] = self::hash($packet);
        self::need(strlen(self::json($packet)) <= 16777216, 'This full workspace exceeds the portable 16 MiB limit. Preserve its original WordPress database backup.', 409);
        return $packet;
    }
    static function api($name, $request) {
        try {
            $permission = self::permission(); if ($permission !== true) return $permission;
            if ($name === 'status') $value = self::status();
            elseif ($name === 'projects') $value = self::projects($request);
            elseif ($name === 'products') $value = self::products($request);
            elseif ($name === 'view') $value = self::with_lock(static function () use ($request) { return self::view($request['id']); });
            elseif ($name === 'request') {
                $value = self::request_result($request['id']);
                if ($value) self::view($value['projectId']);
                $value = ['schema' => 'stellar-forge.sf104.catalog-request-status.v1', 'found' => $value !== null, 'receipt' => $value];
            } elseif ($name === 'record') {
                $value = self::row($request['id']);
                self::need($value && self::uuid($value['projectId'] ?? null), 'The saved catalog history entry is unavailable.', 404);
                self::view($value['projectId']);
                $value = ['schema' => 'stellar-forge.sf104.catalog-record.v1', 'record' => $value];
            } elseif ($name === 'export') {
                $id = $request['id']; $kind = $request->get_param('kind') ?: 'workspace';
                $value = self::with_lock(static function () use ($id, $kind, $request) {
                    if ($kind === 'workspace') return self::export_workspace($id);
                    self::need($kind === 'seller', 'Choose a workspace or seller handoff export.', 422);
                    $project = self::project($id); self::view($id);
                    $app = self::row($request->get_param('applicationId') ?: ($project['latestApplication'] ?? ''), 'application');
                    self::need($app && $app['projectId'] === $id, 'Apply a reviewed catalog before exporting its seller handoff.', 409);
                    return $app['handoff'];
                });
            } else {
                $body = $request->get_body();
                self::need(is_string($body) && strlen($body) > 0 && strlen($body) <= self::MAX_PACKET,
                    'Use a complete bounded catalog request.', 413);
                self::need(strtolower(trim(explode(';', $request->get_header('content-type'))[0])) === 'application/json',
                    'Catalog writes require application/json.', 415);
                $raw = json_decode($body, true, 64, JSON_BIGINT_AS_STRING);
                self::need(is_array($raw) && json_last_error() === JSON_ERROR_NONE, 'Use a valid JSON catalog request.', 422);
                $value = self::mutate($raw);
            }
            $response = new WP_REST_Response($value, 200);
            $response->header('Cache-Control', 'private, no-store'); $response->header('X-Content-Type-Options', 'nosniff');
            return $response;
        } catch (Throwable $e) {
            $status = in_array($e->getCode(), [400,401,403,404,409,413,415,422,503], true) ? $e->getCode() : 409;
            return new WP_Error('sf104_catalog_' . $status, $e->getMessage(), ['status' => $status]);
        }
    }
    static function rest() {
        $uuid = '[0-9a-f-]{36}';
        foreach ([
            ['GET','/status','status'], ['GET','/projects','projects'], ['GET','/products','products'],
            ['GET','/projects/(?P<id>' . $uuid . ')','view'], ['GET','/requests/(?P<id>' . $uuid . ')','request'],
            ['GET','/records/(?P<id>' . $uuid . ')','record'], ['GET','/projects/(?P<id>' . $uuid . ')/export','export'],
            ['POST','','write']
        ] as $route) {
            $name = $route[2];
            register_rest_route('stellar-forge/v1', '/merchant/catalog' . $route[1], [
                'methods' => $route[0], 'permission_callback' => [__CLASS__, 'permission'],
                'callback' => static function ($request) use ($name) { return self::api($name, $request); }]);
        }
        register_rest_route('stellar-forge/v1', '/catalog-order', ['methods' => 'POST',
            'permission_callback' => '__return_true', 'callback' => [__CLASS__, 'order_lookup']]);
    }
    static function order_lookup($request) {
        try {
            self::need(function_exists('wc_get_order'), 'WooCommerce is not active.', 503);
            $raw = $request->get_body(); $secret = Starforge_SF98_Woo::secret();
            self::need(is_string($raw) && strlen($raw) > 0 && strlen($raw) <= 2048, 'Use a bounded original order lookup.', 413);
            self::need($secret !== null, 'The original merchant secret is not configured.', 503);
            $stamp = $request->get_header('x-sf98-timestamp'); $signature = $request->get_header('x-sf98-signature');
            self::need(is_string($stamp) && preg_match('/^[1-9][0-9]{0,15}$/D', $stamp) &&
                abs(time() - (int) $stamp) <= Starforge_SF98_Woo::TOLERANCE &&
                is_string($signature) && preg_match('/^sha256=[0-9a-f]{64}$/D', $signature) &&
                hash_equals('sha256=' . hash_hmac('sha256', $stamp . '.' . $raw, $secret), $signature),
                'The original order lookup signature or timestamp is invalid.', 401);
            $input = json_decode($raw, true, 8); self::fields($input, ['schema','orderReference','attemptGeneration']);
            self::need(($input['schema'] ?? null) === 'stellar-forge.sf104.catalog-order-request.v1' &&
                self::id($input['orderReference'] ?? null) && is_int($input['attemptGeneration'] ?? null) &&
                $input['attemptGeneration'] >= 1 && $input['attemptGeneration'] <= 2147483647, 'Use the exact original order and attempt generation.', 422);
            $value = Starforge_SF104_Checkout::with_order_lock((int) $input['orderReference'], static function () use ($input) {
                $order = wc_get_order((int) $input['orderReference']);
                self::need($order && $order->get_payment_method() === Starforge_SF104_Checkout::ID &&
                    $order->has_status(['pending','on-hold']) && !$order->is_paid() && !$order->get_transaction_id() &&
                    !Starforge_SF104_Checkout::event_for_order($order->get_id()), 'This original order is no longer awaiting a new payment.');
                $record = Starforge_SF104_Checkout::snapshot($order);
                $handoff = Starforge_SF104_Checkout::available_handoff($order, $record);
                self::need($handoff['attemptGeneration'] === $input['attemptGeneration'], 'This original attempt generation is no longer available.');
                $catalog = null; $route = null;
                if ($handoff['schema'] === Starforge_SF104_Basket::SCHEMA) {
                    $catalog = $record['catalog']; Starforge_SF104_Basket::indexed($catalog);
                } else {
                    $route = ['productId' => $handoff['productId'], 'routeId' => $handoff['routeId'],
                        'url' => strtok($handoff['operation']['url'], '?'), 'method' => $handoff['operation']['method'],
                        'expect' => $handoff['operation']['expect'], 'description' => 'Retained original Woo product payment terms.'];
                }
                return ['schema' => 'stellar-forge.sf104.catalog-order-result.v1', 'status' => 'READY',
                    'orderReference' => $input['orderReference'], 'attemptGeneration' => $input['attemptGeneration'],
                    'snapshotSha256' => $record['digest'], 'handoff' => $handoff, 'route' => $route, 'catalog' => $catalog];
            });
            $response = new WP_REST_Response($value, 200); $response->header('Cache-Control', 'private, no-store');
            $response->header('X-Content-Type-Options', 'nosniff'); return $response;
        } catch (Throwable $e) {
            $status = in_array($e->getCode(), [401,413,422,503], true) ? $e->getCode() : 409;
            return new WP_Error('sf104_catalog_order_' . $status, $e->getMessage(), ['status' => $status]);
        }
    }
    static function menu() {
        add_submenu_page('woocommerce', 'Stellar product catalog', 'Stellar catalog', 'manage_woocommerce',
            'sf104-product-catalog', [__CLASS__, 'page']);
    }
    static function product_link() {
        if (!current_user_can('manage_woocommerce')) return;
        echo '<p class="form-field"><a class="button" href="' . esc_url(admin_url('admin.php?page=sf104-product-catalog')) .
            '">Open saved Stellar catalog plans</a><span class="description">Compare and apply exact terms across selected products.</span></p>';
    }
    static function assets($hook) {
        if ($hook !== 'woocommerce_page_sf104-product-catalog') return;
        wp_enqueue_style('sf104-catalog', plugins_url('merchant-catalog.css', __FILE__), [], '1.0.0');
        wp_enqueue_script('sf104-catalog', plugins_url('merchant-catalog.js', __FILE__), [], '1.0.0', true);
        wp_add_inline_script('sf104-catalog', 'window.SF104Catalog=' . wp_json_encode([
            'root' => rest_url('stellar-forge/v1/merchant/catalog'), 'nonce' => wp_create_nonce('wp_rest'),
            'user' => get_current_user_id(), 'merchantUrl' => admin_url('admin.php?page=sf98-woocommerce')]) . ';', 'before');
    }
    static function page() {
        if (self::permission() !== true) return;
        echo '<div id="sf104-catalog" class="sfc"><header class="sfc-mast"><div><p class="sfc-eyebrow">STELLAR / PRODUCT CATALOG</p>' .
            '<h1>Configure exact digital checkout terms</h1><p>Save a plan, compare current Woo products, then apply the reviewed mapping.</p></div>' .
            '<a class="sfc-button" href="' . esc_url(admin_url('admin.php?page=sf98-woocommerce')) . '">Merchant operations</a></header>' .
            '<div id="sfc-notice" role="status" aria-live="polite"></div><div id="sfc-pending"></div>' .
            '<main id="sfc-main" tabindex="-1"><p>Loading your saved catalog workspace…</p></main>' .
            '<noscript><p>JavaScript is required for the saved plan editor. The original Woo product settings remain available.</p></noscript>' .
            '<footer class="sfc-footer">Woo product authority · Original native seller and SF98 delivery · Saved edition history</footer></div>';
    }
}
Starforge_SF104_Catalog::boot();
