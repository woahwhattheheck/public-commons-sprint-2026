<?php if (!defined('ABSPATH')) { exit; } get_header(); ?>
<main id="main" class="kfz-container"><div class="kzfr-article">
<?php while (have_posts()) : the_post(); ?>
<article <?php post_class(); ?>><div class="eyebrow"><?php echo esc_html(array('kzfr_program' => __('Our programs', 'kzfr-community-radio'), 'kzfr_event' => __('Community calendar', 'kzfr-community-radio'), 'kzfr_underwriter' => __('Community underwriters', 'kzfr-community-radio'))[get_post_type()] ?? __('From the station', 'kzfr-community-radio')); ?></div><h1 class="kzfr-content-title"><?php the_title(); ?></h1>
<?php if (get_post_type() === 'kzfr_event') : $event_day = kzfr_theme_event_day(get_the_ID()); ?>
<?php if ($event_day) : ?><p class="kzfr-chip"><?php kzfr_theme_event_time($event_day); ?></p><?php endif; ?>
<?php endif; ?>
<div class="kzfr-article-body"><?php the_content(); ?></div>
<?php if (get_post_type() === 'kzfr_program') : $creek = kzfr_theme_creek_link(get_the_ID()); ?>
<?php if ($creek) : ?><div class="kzfr-embedded-note"><?php kzfr_theme_external_link($creek, __('Listen to this program', 'kzfr-community-radio')); ?></div><?php else : ?><p><?php kzfr_theme_service_link('archive', __('Browse audio archives', 'kzfr-community-radio')); ?></p><?php endif; ?>
<p><?php kzfr_theme_service_link('schedule', __('See the program schedule', 'kzfr-community-radio')); ?></p>
<?php elseif (get_post_type() === 'kzfr_underwriter') : ?><p><?php kzfr_theme_external_link(kzfr_theme_underwriter_link(get_the_ID()), __('Visit their website', 'kzfr-community-radio')); ?></p>
<?php endif; ?></article>
<?php endwhile; ?>
</div></main><?php get_footer(); ?>
