<?php
/**
 * Plugin Name: Stellar Forge CoCart profile export
 * Description: Exports the current CoCart/Woo product mapping into the existing headless receiving workspace.
 * Version: 1.0.0
 * Requires PHP: 8.0
 * Requires Plugins: woocommerce, cart-rest-api-for-woocommerce
 * License: MIT
 */
if (!defined('ABSPATH')) { exit; }

final class Starforge_CoCart_Profile_Export {
    static function ready() {
        return class_exists('Starforge_SF104_Checkout') &&
            class_exists('WooCommerce') && defined('COCART_VERSION');
    }
    static function button() {
        global $product_object;
        if (!self::ready() || !current_user_can('manage_woocommerce') || !$product_object) { return; }
        $id = $product_object->get_id();
        if (!$id || !current_user_can('edit_post', $id)) { return; }
        try {
            Starforge_SF104_Checkout::product_mapping($product_object);
        } catch (Throwable $e) { return; }
        $url = wp_nonce_url(
            add_query_arg(['action'=>'sf104_cocart_profile','product_id'=>$id], admin_url('admin-post.php')),
            'sf104_cocart_profile_' . $id
        );
        echo '<div class="options_group"><p class="form-field"><label>CoCart receiving workspace</label>';
        echo '<a class="button" href="' . esc_url($url) . '">Download saved headless profile</a>';
        echo '<span class="description" style="display:block">Uses this saved product, exact storefront total and original Stellar route. Customer cart data is received separately.</span>';
        echo '</p></div>';
    }
    static function profile($product) {
        if (!self::ready()) { throw new RuntimeException('Activate the original Stellar Forge, WooCommerce and CoCart plugins.'); }
        $mapping = Starforge_SF104_Checkout::product_mapping($product);
        return [
            'label' => wp_strip_all_tags(get_bloginfo('name')) . ' — ' . wp_strip_all_tags($product->get_name()),
            'store_url' => untrailingslashit(home_url('/')),
            'checkout_url' => wc_get_checkout_url(),
            'merchant_origin' => Starforge_SF104_Checkout::store_origin(),
            'plugin' => 'legacy',
            'expected_plugin_version' => (string) COCART_VERSION,
            'timeout_ms' => 20000,
            'gateway_mapping' => array_merge(['productId'=>(string) $product->get_id()], $mapping),
            'route_export' => Starforge_SF104_Checkout::route_declaration($product),
            'environment' => [
                'wordpress'=>(string) get_bloginfo('version'),
                'woocommerce'=>(string) WC_VERSION,
                'php'=>(string) PHP_VERSION,
                'cocart'=>(string) COCART_VERSION,
                'exported_at'=>gmdate('Y-m-d\TH:i:s\Z'),
            ],
        ];
    }
    static function download() {
        $raw = isset($_GET['product_id']) && is_string($_GET['product_id']) ? wp_unslash($_GET['product_id']) : '';
        if (!preg_match('/^[1-9][0-9]{0,17}$/D', $raw) || !current_user_can('manage_woocommerce') || !current_user_can('edit_post', (int)$raw)) {
            wp_die('Forbidden.', '', ['response'=>403]);
        }
        check_admin_referer('sf104_cocart_profile_' . $raw);
        try {
            $product = wc_get_product((int)$raw);
            if (!$product) { throw new RuntimeException('The selected Woo product is unavailable.'); }
            $profile = self::profile($product);
            $bytes = wp_json_encode($profile, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
            if (!is_string($bytes) || $bytes === "\n") { throw new RuntimeException('The profile could not be encoded.'); }
        } catch (Throwable $e) {
            wp_die(esc_html($e->getMessage()), '', ['response'=>409]);
        }
        nocache_headers();
        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="stellar-cocart-product-' . $raw . '-profile.json"');
        header('X-Content-Type-Options: nosniff');
        echo $bytes;
        exit;
    }
}
add_action('woocommerce_product_options_general_product_data', ['Starforge_CoCart_Profile_Export','button']);
add_action('admin_post_sf104_cocart_profile', ['Starforge_CoCart_Profile_Export','download']);
