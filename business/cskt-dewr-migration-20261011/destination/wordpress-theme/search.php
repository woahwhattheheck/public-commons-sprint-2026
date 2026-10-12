<?php
if (!defined('ABSPATH')) { exit; }
get_header();
global $wp_query;
$context = cskt_dewr_catalog_context();
$roles = cskt_dewr_roles();
?>
<main id="main-content" class="dewr-main dewr-shell" tabindex="-1">
    <?php cskt_dewr_breadcrumbs(); ?>
    <header class="dewr-page-header">
        <h1><?php echo esc_html($context['query'] !== '' ? sprintf(__('Search: %s', 'cskt-dewr'), $context['query']) : ($roles[$context['role']]['label'] ?? __('Search the website', 'cskt-dewr'))); ?></h1>
        <p class="dewr-lead"><?php esc_html_e('Find published pages, projects, documents and updates.', 'cskt-dewr'); ?></p>
    </header>
    <?php cskt_dewr_catalog($wp_query, $context, __('Published resources', 'cskt-dewr')); ?>
</main>
<?php get_footer(); ?>
