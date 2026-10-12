<?php
/** MIT. One merchant workspace; connector inputs and the existing order desk share access. */
if (!defined('ABSPATH')) { exit; }
final class Starforge_SF104_KCF_Console {
    static function selected() { return isset($_GET['workspace']) && is_string($_GET['workspace']) && wp_unslash($_GET['workspace']) === 'connector'; }
    static function assets() {
        wp_enqueue_style('sf104-kcf',plugins_url('merchant-kcf.css',__FILE__),[],Starforge_SF104_KCF::VERSION);
        wp_enqueue_script('sf104-kcf',plugins_url('merchant-kcf.js',__FILE__),[],Starforge_SF104_KCF::VERSION,true);
        wp_add_inline_script('sf104-kcf','window.SF104KCF=' . wp_json_encode([
            'api'=>rest_url('stellar-forge/v1/merchant-kcf'),'erpApi'=>rest_url('stellar-forge/v1/merchant-erp'),
            'nonce'=>wp_create_nonce('wp_rest'),'erpUrl'=>admin_url('admin.php?page=sf104-erp'),
            'merchantUrl'=>admin_url('admin.php?page=sf98-woocommerce')
        ],JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT) . ';','before');
    }
    static function page() {
        echo '<div id="sf104-kcf"><header class="kcf-header"><div><p class="kcf-eyebrow">COMMERCE OPERATIONS / ERP</p><h1>Connector sources</h1><p>Retain installation exports, review changes, and save their approved ERP mappings.</p></div><a class="kcf-button" href="' . esc_url(admin_url('admin.php?page=sf104-erp')) . '">Order delivery</a></header>';
        echo '<div id="kcf-selection"></div><nav class="kcf-nav" aria-label="Connector workspace"><button type="button" data-view="sources" aria-current="page">Sources</button><button type="button" data-view="mapping">Mapping</button><button type="button" data-view="changes">Changes & review</button><button type="button" data-view="handoff">Handoff & recovery</button><button type="button" data-action="refresh">Refresh</button></nav>';
        echo '<div id="kcf-message" role="status" aria-live="polite"></div><div id="kcf-pending"></div><main id="kcf-content" tabindex="-1"><p>Opening the retained workspace…</p></main><noscript><p>Enable JavaScript to operate this view. The authenticated merchant client and command line use the same retained source and mapping records.</p></noscript>';
        echo '<footer class="kcf-footer">Exact source files · Reviewed mapping revisions · Original order delivery <span id="kcf-observed"></span></footer><dialog id="kcf-dialog" aria-labelledby="kcf-dialog-title"></dialog></div>';
    }
}
