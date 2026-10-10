<?php if (!defined('ABSPATH')) { exit; } ?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo('charset'); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#231c19">
<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
<a class="skip" href="#main"><?php esc_html_e('Skip to main content', 'kzfr-community-radio'); ?></a>
<div class="concept-banner" role="note"><span class="signal-dot" aria-hidden="true"></span> Independent candidate theme for KZFR, not the live station website</div>
<header class="site-header" id="top"><div class="shell header-inner">
<a href="<?php echo esc_url(home_url('/')); ?>" class="brand" aria-label="Home, community radio">
<span class="brand-mark">90<span class="point">.</span>1</span>
<span class="brand-copy"><strong><?php echo esc_html(get_bloginfo('name')); ?></strong><span>PEOPLE POWERED RADIO</span></span>
</a>
<button class="menu-toggle" type="button" id="menu-toggle" aria-controls="primary-nav" aria-expanded="false" aria-label="Open navigation"><span aria-hidden="true">☰</span> MENU</button>
<nav class="primary-nav" id="primary-nav" aria-label="Main navigation">
<?php wp_nav_menu(array('theme_location' => 'primary', 'container' => false, 'menu_class' => 'kzfr-menu', 'fallback_cb' => 'kzfr_theme_fallback_menu')); ?>
<a class="nav-donate" href="https://kzfr-donate.creek.org/" target="_blank" rel="noopener noreferrer">Support KZFR ↗ <span class="sr-only">(opens a new tab)</span></a>
</nav>
</div></header>
