<?php if (!defined('ABSPATH')) { exit; } ?>
<footer class="dewr-footer">
    <div class="dewr-shell dewr-footer-main">
        <div>
            <p class="dewr-footer-name"><?php $config = cskt_dewr_config(); echo esc_html($config['siteName'] ?? get_bloginfo('name')); ?></p>
            <?php $tagline = trim((string) ($config['tagline'] ?? get_bloginfo('description'))); if ($tagline !== '') : ?>
                <p><?php echo esc_html($tagline); ?></p>
            <?php endif; ?>
            <?php if (cskt_dewr_has_menu('footer')) : ?>
                <nav aria-label="<?php esc_attr_e('Footer', 'cskt-dewr'); ?>"><?php cskt_dewr_menu('footer'); ?></nav>
            <?php endif; ?>
            <?php if (get_privacy_policy_url()) : ?>
                <p><a href="<?php echo esc_url(get_privacy_policy_url()); ?>"><?php esc_html_e('Privacy', 'cskt-dewr'); ?></a></p>
            <?php endif; ?>
        </div>
        <?php cskt_dewr_contact(); ?>
    </div>
    <div class="dewr-shell dewr-footer-bottom">
        <p>&copy; <?php echo esc_html(wp_date('Y')); ?> <?php echo esc_html($config['siteName'] ?? get_bloginfo('name')); ?></p>
        <p><a href="#site-header"><?php esc_html_e('Back to top', 'cskt-dewr'); ?></a></p>
    </div>
</footer>
<?php wp_footer(); ?>
</body>
</html>
