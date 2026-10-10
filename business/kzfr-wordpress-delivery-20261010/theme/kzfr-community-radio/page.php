<?php if (!defined('ABSPATH')) { exit; } get_header(); ?>
<main id="main" class="kfz-container"><div class="kzfr-article">
<?php while (have_posts()) : the_post(); ?><article <?php post_class(); ?>><h1 class="kzfr-content-title"><?php the_title(); ?></h1><div><?php the_content(); ?></div></article><?php endwhile; ?>
</div></main>
<?php get_footer(); ?>
