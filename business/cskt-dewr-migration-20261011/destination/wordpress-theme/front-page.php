<?php
if (!defined('ABSPATH')) { exit; }
get_header();
?>
<main id="main-content" class="dewr-main dewr-shell dewr-home" tabindex="-1">
    <?php if (is_singular()) : ?>
        <?php while (have_posts()) : the_post(); ?>
            <article id="post-<?php the_ID(); ?>" <?php post_class('dewr-home-intro'); ?>>
                <header class="dewr-page-header"><h1><?php the_title(); ?></h1></header>
                <div class="dewr-entry-content dewr-home-content"><?php the_content(); ?></div>
                <?php wp_link_pages(array('before' => '<nav class="dewr-content-pages" aria-label="' . esc_attr__('Content pages', 'cskt-dewr') . '">', 'after' => '</nav>')); ?>
            </article>
        <?php endwhile; ?>
    <?php else : ?>
        <header class="dewr-page-header">
            <h1><?php echo esc_html(get_bloginfo('name')); ?></h1>
            <?php if (get_bloginfo('description') !== '') : ?><p class="dewr-lead"><?php echo esc_html(get_bloginfo('description')); ?></p><?php endif; ?>
        </header>
    <?php endif; ?>
    <nav class="dewr-home-links" aria-label="<?php esc_attr_e('Explore the website', 'cskt-dewr'); ?>">
        <?php foreach (array('projects','documents','notices','opportunities') as $role) : if (!isset(cskt_dewr_roles()[$role])) { continue; } ?>
            <a href="<?php echo esc_url(cskt_dewr_collection_url($role)); ?>"><?php echo esc_html(cskt_dewr_roles()[$role]['label']); ?></a>
        <?php endforeach; ?>
    </nav>
    <div class="dewr-home-sections">
        <?php foreach (array('notices','projects','documents','news','opportunities') as $role) { cskt_dewr_home_collection($role); } ?>
    </div>
</main>
<?php get_footer(); ?>
