<?php
/**
 * Plugin Name: CSKT Reviewed Migration
 * Description: Native content, verified media, reviewed releases and recoverable migration operations.
 * Version: 1.0.0
 * Requires at least: 6.8
 * Requires PHP: 8.1
 */
if (!defined('ABSPATH')) { exit; }
define('CSKTM_VERSION', '1.0.0');
define('CSKTM_NS', 'cskt-migration/v1');
define('CSKTM_MAX_MANIFEST', 32 * 1048576);
define('CSKTM_MAX_ASSET', 1024 * 1048576);
define('CSKTM_CHUNK_BYTES', 2 * 1048576);
require_once __DIR__ . '/state.php';
require_once __DIR__ . '/release.php';
require_once __DIR__ . '/uploads.php';
require_once __DIR__ . '/public.php';
require_once __DIR__ . '/editor.php';

function csktm_types() {
    foreach (array('cskt_project'=>'Projects', 'cskt_document'=>'Documents', 'cskt_notice'=>'Notices') as $type=>$label) {
        register_post_type($type, array('label'=>$label, 'public'=>true, 'show_in_rest'=>true, 'has_archive'=>true, 'hierarchical'=>$type==='cskt_project', 'rewrite'=>array('slug'=>substr($type,5).'s'), 'capability_type'=>'page', 'map_meta_cap'=>true, 'supports'=>array('title','editor','excerpt','revisions','author','thumbnail','custom-fields','page-attributes'), 'taxonomies'=>array('cskt_topic')));
    }
    register_taxonomy('cskt_topic', array('page','post','cskt_project','cskt_document','cskt_notice','attachment'), array('label'=>'Topics', 'public'=>true, 'hierarchical'=>true, 'show_in_rest'=>true, 'rewrite'=>array('slug'=>'topics')));
    foreach (array('page','post','cskt_project','cskt_document','cskt_notice','attachment') as $type) {
        foreach (array('_cskt_document','_cskt_gis','_cskt_notice','_cskt_archive') as $key) {
            register_post_meta($type,$key,array('type'=>'string','single'=>true,'show_in_rest'=>true,'revisions_enabled'=>$type!=='attachment','auth_callback'=>function($allowed,$meta_key,$post_id){return current_user_can('edit_post',$post_id);}));
        }
    }
}
add_action('init','csktm_types');
register_activation_hook(__FILE__,function(){csktm_types();add_option('cskt_migration_mutex','1','','no');add_option('cskt_migration_bindings',array(),'','no');add_option('cskt_migration_routes',array(),'','no');add_option('cskt_migration_releases',array(),'','no');flush_rewrite_rules();});
register_deactivation_hook(__FILE__,'flush_rewrite_rules');
function csktm_allowed() { return current_user_can('manage_options') && current_user_can('edit_pages') && current_user_can('upload_files'); }
function csktm_endpoint($callback) {
    return function($request)use($callback){try{return $callback($request);}catch(Throwable $e){return new WP_Error($e instanceof CSKTM_Problem?$e->slug:'cskt_destination_error',$e->getMessage(),array('status'=>$e instanceof CSKTM_Problem?$e->status:500,'detail'=>$e instanceof CSKTM_Problem?$e->detail:null));}};
}
add_action('rest_api_init',function(){
    $routes=array(
        array('/inspect','GET',function(){return csktm_inspect();}),
        array('/preview','POST',function($r){return csktm_preview($r->get_json_params());}),
        array('/releases/(?P<id>[A-Za-z0-9:_-]+)','GET',function($r){return csktm_readback($r['id']);}),
        array('/releases/(?P<id>[A-Za-z0-9:_-]+)/apply','POST',function($r){return csktm_apply($r['id'],$r->get_json_params());}),
        array('/releases/(?P<id>[A-Za-z0-9:_-]+)/rollback','POST',function($r){return csktm_rollback($r['id'],$r->get_json_params());}),
        array('/releases/(?P<id>[A-Za-z0-9:_-]+)/assets','POST',function($r){$raw=base64_decode((string)$r->get_header('x-cskt-asset'),true);$header=$raw===false?null:json_decode($raw,true);return csktm_asset($r['id'],$header,$r->get_body());}),
        array('/releases/(?P<id>[A-Za-z0-9:_-]+)/assets/begin','POST',function($r){return csktm_upload_begin($r['id'],$r->get_json_params());}),
        array('/releases/(?P<id>[A-Za-z0-9:_-]+)/assets/chunk','POST',function($r){$raw=base64_decode((string)$r->get_header('x-cskt-asset'),true);return csktm_upload_chunk($r['id'],$raw===false?null:json_decode($raw,true),$r->get_body());}),
        array('/releases/(?P<id>[A-Za-z0-9:_-]+)/assets/commit','POST',function($r){return csktm_upload_commit($r['id'],$r->get_json_params());}),
        array('/native/(?P<id>\d+)','GET',function($r){$p=get_post((int)$r['id']);if(!$p||!current_user_can('edit_post',$p->ID))csktm_fail('native_post_missing','Choose an existing editable native WordPress post.',404);return array('post'=>csktm_snapshot($p->ID),'fingerprint'=>csktm_fingerprint($p->ID),'url'=>get_permalink($p->ID));}),
        array('/bindings','POST',function($r){return csktm_bind($r->get_json_params());})
    );
    foreach($routes as $route){register_rest_route(CSKTM_NS,$route[0],array('methods'=>$route[1],'permission_callback'=>'csktm_allowed','callback'=>csktm_endpoint($route[2])));}
});
