<?php if (!defined('ABSPATH')) { exit; } ?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo('charset'); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
<a class="dewr-skip-link" href="#main-content"><?php esc_html_e('Skip to main content', 'cskt-dewr'); ?></a>
<header class="dewr-header" id="site-header">
    <div class="dewr-shell dewr-header-top">
        <div class="dewr-identity">
            <?php if (has_custom_logo()) { echo '<div class="dewr-logo">' . get_custom_logo() . '</div>'; } ?>
            <div>
                <a class="dewr-site-name" href="<?php echo esc_url(home_url('/')); ?>"><?php
                    $config = cskt_dewr_config();
                    echo esc_html($config['siteName'] ?? get_bloginfo('name'));
                ?></a>
                <?php $tagline = trim((string) ($config['tagline'] ?? get_bloginfo('description'))); if ($tagline !== '') : ?>
                    <p class="dewr-tagline"><?php echo esc_html($tagline); ?></p>
                <?php endif; ?>
            </div>
        </div>
        <div class="dewr-header-tools">
            <?php if (cskt_dewr_has_menu('utility')) : ?>
                <nav aria-label="<?php esc_attr_e('Utility', 'cskt-dewr'); ?>"><?php cskt_dewr_menu('utility'); ?></nav>
            <?php endif; ?>
            <?php get_search_form(array('aria_label' => __('Site search', 'cskt-dewr'))); ?>
        </div>
    </div>
    <div class="dewr-nav-border">
        <div class="dewr-shell dewr-nav-shell">
            <button class="dewr-menu-toggle" type="button" aria-expanded="true" aria-controls="primary-navigation" hidden>
                <?php esc_html_e('Menu', 'cskt-dewr'); ?>
            </button>
            <nav id="primary-navigation" class="dewr-primary-nav" aria-label="<?php esc_attr_e('Primary', 'cskt-dewr'); ?>">
                <?php cskt_dewr_menu('primary', true); ?>
            </nav>
        </div>
    </div>
</header>

<?php $announcement = cskt_dewr_config()['announcement'] ?? null; if (is_array($announcement) && !empty($announcement['url']) && !empty($announcement['title'])) : ?>
<section class="dewr-announcement" aria-label="<?php esc_attr_e('Current notice', 'cskt-dewr'); ?>">
    <div class="dewr-shell"><p><span class="dewr-announcement-label"><?php esc_html_e('Notice', 'cskt-dewr'); ?></span><a href="<?php echo esc_url($announcement['url']); ?>"><?php echo esc_html($announcement['title']); ?></a></p></div>
</section>
<?php endif; ?>
