<?php if (!defined('ABSPATH')) { exit; } get_header(); ?>
<main id="main" class="kfz-container"><header><div class="eyebrow">KZFR STORIES</div><h1 class="kzfr-content-title"><?php echo esc_html(get_bloginfo('name')); ?></h1></header>
<?php if (have_posts()) : ?><div class="kzfr-grid">
<?php while (have_posts()) : the_post(); ?><article <?php post_class('kzfr-card'); ?>><h2><a href="<?php echo esc_url(get_permalink()); ?>"><?php the_title(); ?></a></h2><p><?php echo esc_html(wp_trim_words(wp_strip_all_tags(get_the_excerpt()), 32)); ?></p></article><?php endwhile; ?></div>
<div class="kzfr-page-links"><?php the_posts_pagination(); ?></div>
<?php else : ?><p>No published posts yet.</p><?php endif; ?></main>
<?php get_footer(); ?>
