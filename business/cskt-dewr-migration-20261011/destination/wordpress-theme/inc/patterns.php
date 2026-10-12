<?php
if (!defined('ABSPATH')) { exit; }
add_action('init', function () {
    if (!function_exists('register_block_pattern')) { return; }
    register_block_pattern_category('cskt-dewr', array('label' => __('DEWR content', 'cskt-dewr')));
    register_block_pattern('cskt-dewr/image-comparison', array(
        'title' => __('Before and after images', 'cskt-dewr'),
        'description' => __('Choose two approved images with matching proportions, then write meaningful alt text and captions. The public comparison also offers both originals.', 'cskt-dewr'),
        'categories' => array('cskt-dewr'),
        'content' => '<!-- wp:group {"className":"dewr-image-comparison","layout":{"type":"constrained"}} --><div class="wp-block-group dewr-image-comparison"><!-- wp:heading {"level":3} --><h3 class="wp-block-heading">' . esc_html__('Before and after', 'cskt-dewr') . '</h3><!-- /wp:heading --><!-- wp:paragraph --><p>' . esc_html__('Describe the location, work completed, image dates, and what the comparison shows.', 'cskt-dewr') . '</p><!-- /wp:paragraph --><!-- wp:image /--><!-- wp:image /--></div><!-- /wp:group -->',
    ));
    register_block_pattern('cskt-dewr/project-overview', array(
        'title' => __('Project overview', 'cskt-dewr'),
        'description' => __('A structured project page using native headings, lists and documents.', 'cskt-dewr'),
        'categories' => array('cskt-dewr'),
        'content' => '<!-- wp:heading --><h2 class="wp-block-heading">' . esc_html__('Project overview', 'cskt-dewr') . '</h2><!-- /wp:heading --><!-- wp:paragraph --><p>' . esc_html__('Explain the approved project purpose, location, and current stage in plain language.', 'cskt-dewr') . '</p><!-- /wp:paragraph --><!-- wp:heading --><h2 class="wp-block-heading">' . esc_html__('Work and schedule', 'cskt-dewr') . '</h2><!-- /wp:heading --><!-- wp:paragraph --><p>' . esc_html__('Describe the work, confirmed dates, and any effects on public access.', 'cskt-dewr') . '</p><!-- /wp:paragraph --><!-- wp:heading --><h2 class="wp-block-heading">' . esc_html__('Documents and maps', 'cskt-dewr') . '</h2><!-- /wp:heading --><!-- wp:paragraph --><p>' . esc_html__('Link the approved native document records and GIS references. Include a text explanation for each map.', 'cskt-dewr') . '</p><!-- /wp:paragraph --><!-- wp:heading --><h2 class="wp-block-heading">' . esc_html__('Contact', 'cskt-dewr') . '</h2><!-- /wp:heading --><!-- wp:paragraph --><p>' . esc_html__('Add the responsible department or approved staff contact.', 'cskt-dewr') . '</p><!-- /wp:paragraph -->',
    ));
    register_block_pattern('cskt-dewr/project-timeline', array(
        'title' => __('Project milestones', 'cskt-dewr'),
        'description' => __('A native ordered list for confirmed project milestones.', 'cskt-dewr'),
        'categories' => array('cskt-dewr'),
        'content' => '<!-- wp:heading --><h2 class="wp-block-heading">' . esc_html__('Project milestones', 'cskt-dewr') . '</h2><!-- /wp:heading --><!-- wp:list {"ordered":true,"className":"dewr-project-timeline"} --><ol class="wp-block-list dewr-project-timeline"><!-- wp:list-item --><li><strong>' . esc_html__('Milestone and confirmed date', 'cskt-dewr') . '</strong><br>' . esc_html__('Describe the agreed outcome and current status.', 'cskt-dewr') . '</li><!-- /wp:list-item --></ol><!-- /wp:list -->',
    ));
});
