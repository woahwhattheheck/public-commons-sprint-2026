<?php
if (!defined('ABSPATH')) { exit; }
get_header();
global $wp_query;
$role = is_post_type_archive() ? cskt_dewr_role_for_type(is_string(get_query_var('post_type')) ? get_query_var('post_type') : '') : '';
$context = cskt_dewr_catalog_context($role);
?>
<main id="main-content" class="dewr-main dewr-shell" tabindex="-1">
    <?php cskt_dewr_breadcrumbs(); ?>
    <header class="dewr-page-header">
        <h1><?php echo esc_html(wp_strip_all_tags(get_the_archive_title())); ?></h1>
        <?php if (get_the_archive_description() !== '') : ?><div class="dewr-lead"><?php echo wp_kses_post(get_the_archive_description()); ?></div><?php endif; ?>
    </header>
    <?php cskt_dewr_catalog($wp_query, $context, __('Published resources', 'cskt-dewr')); ?>
</main>
<?php get_footer(); ?>
