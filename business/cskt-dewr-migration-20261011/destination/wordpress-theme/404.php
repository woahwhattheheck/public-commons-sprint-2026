<?php
if (!defined('ABSPATH')) { exit; }
get_header();
?>
<main id="main-content" class="dewr-main dewr-shell" tabindex="-1">
    <?php cskt_dewr_breadcrumbs(); ?>
    <header class="dewr-page-header"><h1><?php esc_html_e('Page not found', 'cskt-dewr'); ?></h1></header>
    <div class="dewr-entry-content">
        <p><?php esc_html_e('This address does not lead to a published page. Search the website or browse a collection below.', 'cskt-dewr'); ?></p>
        <?php get_search_form(); ?>
        <ul><?php foreach (array('projects','documents','notices','news') as $role) : if (!isset(cskt_dewr_roles()[$role])) { continue; } ?>
            <li><a href="<?php echo esc_url(cskt_dewr_collection_url($role)); ?>"><?php echo esc_html(cskt_dewr_roles()[$role]['label']); ?></a></li>
        <?php endforeach; ?></ul>
    </div>
</main>
<?php get_footer(); ?>
