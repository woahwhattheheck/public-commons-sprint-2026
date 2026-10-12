<?php
if (!defined('ABSPATH')) { exit; }
get_header();
?>
<main id="main-content" class="dewr-main dewr-shell" tabindex="-1">
    <?php cskt_dewr_breadcrumbs(); ?>
    <?php while (have_posts()) : the_post(); $resource = get_post(); ?>
        <article id="post-<?php the_ID(); ?>" <?php post_class('dewr-resource'); ?>>
            <header class="dewr-page-header">
                <?php if (get_post_type() !== 'page') : ?><p class="dewr-eyebrow"><?php echo esc_html(cskt_dewr_type_label(get_post_type())); ?></p><?php endif; ?>
                <h1><?php the_title(); ?></h1>
                <?php cskt_dewr_page_meta($resource); ?>
            </header>
            <div class="dewr-page-layout">
                <div class="dewr-entry-content">
                    <?php
                    $native_entry = cskt_dewr_public_entry($resource);
                    if ($resource->post_type === 'cskt_staff' && !empty($native_entry['thumbnail']) && !post_password_required($resource)) {
                        echo '<figure class="dewr-entry-photo">' . get_the_post_thumbnail($resource, 'medium', array('loading' => 'eager')) . '</figure>';
                    }
                    the_content();
                    wp_link_pages(array('before' => '<nav class="dewr-content-pages" aria-label="' . esc_attr__('Content pages', 'cskt-dewr') . '">', 'after' => '</nav>'));
                    ?>
                </div>
                <aside class="dewr-resource-aside">
                    <?php cskt_dewr_section_links($resource); ?>
                    <?php $role = cskt_dewr_role_for_type($resource->post_type); if ($role !== '' && $role !== 'pages') : ?>
                        <p><a href="<?php echo esc_url(cskt_dewr_collection_url($role)); ?>"><?php echo esc_html(sprintf(__('Browse %s', 'cskt-dewr'), strtolower(cskt_dewr_roles()[$role]['label']))); ?></a></p>
                    <?php endif; ?>
                </aside>
            </div>
            <?php
            $collection_role = cskt_dewr_collection_role($resource->ID);
            if ($collection_role !== '' && !post_password_required($resource)) {
                $landing = cskt_dewr_landing_collection($collection_role, $resource->ID);
                $context = $landing['context'];
                $collection = $landing['query'];
                echo '<section class="dewr-page-collection" aria-label="' . esc_attr(cskt_dewr_roles()[$collection_role]['label']) . '">';
                cskt_dewr_catalog($collection, $context, sprintf(__('Find %s', 'cskt-dewr'), strtolower(cskt_dewr_roles()[$collection_role]['label'])));
                echo '</section>';
            }
            ?>
        </article>
    <?php endwhile; ?>
</main>
<?php get_footer(); ?>
