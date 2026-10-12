<?php
/** MIT. An original WordPress merchant surface for the same ERP operating journal. */
if (!defined('ABSPATH')) { exit; }
final class Starforge_SF104_ERP_Console {
    static function boot() {
        add_action('admin_menu', [__CLASS__, 'menu']);
        add_action('admin_enqueue_scripts', [__CLASS__, 'assets']);
    }
    static function menu() {
        add_submenu_page('woocommerce', 'Order ERP delivery', 'Order ERP delivery', 'manage_woocommerce',
            'sf104-erp', [__CLASS__, 'page']);
    }
    static function assets($hook) {
        if (!isset($_GET['page']) || !is_string($_GET['page']) || wp_unslash($_GET['page']) !== 'sf104-erp' ||
            !current_user_can('manage_woocommerce')) return;
        if (class_exists('Starforge_SF104_KCF_Console') && Starforge_SF104_KCF_Console::selected()) { Starforge_SF104_KCF_Console::assets(); return; }
        wp_enqueue_style('sf104-erp', plugins_url('merchant-erp.css', __FILE__), [], Starforge_SF104_ERP::VERSION);
        wp_enqueue_script('sf104-erp', plugins_url('merchant-erp.js', __FILE__), [], Starforge_SF104_ERP::VERSION, true);
        wp_add_inline_script('sf104-erp', 'window.SF104ERP=' . wp_json_encode([
            'api'=>rest_url('stellar-forge/v1/merchant-erp'),'nonce'=>wp_create_nonce('wp_rest'),
            'merchantUrl'=>admin_url('admin.php?page=sf98-woocommerce'),
            'connectorUrl'=>admin_url('admin.php?page=sf104-erp&workspace=connector'),
        ], JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) . ';', 'before');
    }
    static function page() {
        $permission = Starforge_SF104_Merchant_Console::permission();
        if ($permission !== true) { echo '<div class="wrap"><h1>Order ERP delivery</h1><p>' . esc_html($permission->get_error_message()) . '</p></div>'; return; }
        if (class_exists('Starforge_SF104_KCF_Console') && Starforge_SF104_KCF_Console::selected()) { Starforge_SF104_KCF_Console::page(); return; }
        echo '<div id="sf104-erp"><header class="erp-header"><div><p class="erp-eyebrow">COMMERCE OPERATIONS / ERP</p><h1>Order delivery</h1><p>Prepare the original Woo order, review its ERP mapping, and work its receiving record.</p></div><a class="erp-button" href="' . esc_url(admin_url('admin.php?page=sf98-woocommerce')) . '">Merchant operations</a></header>';
        echo '<nav class="erp-nav" aria-label="ERP workspace"><button type="button" data-view="orders" aria-current="page">Orders</button><button type="button" data-view="mapping">Mapping</button><button type="button" data-view="handoff">Handoff</button><a class="erp-button" href="' . esc_url(admin_url('admin.php?page=sf104-erp&workspace=connector')) . '">Connector sources</a><button type="button" data-action="refresh">Refresh</button></nav>';
        echo '<div id="sf104-erp-message" role="status" aria-live="polite"></div><main id="sf104-erp-content" tabindex="-1"><p>Reading original ERP records…</p></main><noscript><p>Enable JavaScript for this operating view. The authenticated ERP API and merchant command line use the same retained journal.</p></noscript><footer class="erp-footer">Original Woo order · Approved mapping revision · Native Acumatica receiving <span id="sf104-erp-observed"></span></footer></div>';
    }
}
Starforge_SF104_ERP_Console::boot();
