<?php
if (!defined('ABSPATH')) { exit; }
class CSKTM_Problem extends RuntimeException { public $slug; public $status; public $detail; function __construct($slug,$message,$status=400,$detail=null){parent::__construct($message);$this->slug=$slug;$this->status=$status;$this->detail=$detail;} }
function csktm_fail($slug,$message,$status=400,$detail=null){throw new CSKTM_Problem($slug,$message,$status,$detail);}
function csktm_json($value){$j=wp_json_encode($value,JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE);if($j===false)csktm_fail('invalid_json','The destination record cannot be encoded.');return $j;}
function csktm_hash($value){return hash('sha256',csktm_json($value));}
function csktm_id($value){return is_string($value)&&preg_match('/^[A-Za-z0-9:_-]{1,180}$/D',$value);}
function csktm_sha($value){return is_string($value)&&preg_match('/^[a-f0-9]{64}$/D',$value);}
function csktm_now(){return gmdate('Y-m-d\TH:i:s\Z');}
function csktm_key($id){return 'cskt_release_'.hash('sha256',$id);}
function csktm_load($id){if(!csktm_id($id))csktm_fail('invalid_release','Use the exact retained release ID.');wp_cache_delete(csktm_key($id),'options');$x=get_option(csktm_key($id));if(!is_array($x))csktm_fail('release_missing','Preview this exact reviewed release on the destination first.',404);return $x;}
function csktm_save($record){if(!update_option(csktm_key($record['id']),$record,false)&&get_option(csktm_key($record['id']))!==$record)csktm_fail('journal_write_failed','The WordPress release journal could not be written.',500);}
function csktm_db($sql){global $wpdb;$v=$wpdb->query($sql);if($v===false)csktm_fail('database_operation_failed','WordPress could not complete its transactional operation.',500,array('databaseError'=>$wpdb->last_error));return $v;}
function csktm_uncache(){wp_cache_delete('alloptions','options');wp_cache_delete('notoptions','options');foreach(array('cskt_migration_mutex','cskt_migration_bindings','cskt_migration_routes','cskt_migration_releases')as$key)wp_cache_delete($key,'options');}
function csktm_database(){
    global $wpdb;static $result=null;if($result!==null)return $result;
    if((defined('DB_ENGINE')&&DB_ENGINE==='sqlite')||stripos(get_class($wpdb),'sqlite')!==false)return $result=array('adapter'=>get_class($wpdb),'transactional'=>true,'engine'=>'SQLite');
    $names=array($wpdb->options,$wpdb->posts,$wpdb->postmeta,$wpdb->terms,$wpdb->term_taxonomy,$wpdb->term_relationships);$rows=$wpdb->get_results($wpdb->prepare('SHOW TABLE STATUS WHERE Name IN ('.implode(',',array_fill(0,count($names),'%s')).')',...$names),ARRAY_A);$engines=array();foreach($rows?:array()as$row)$engines[$row['Name']]=$row['Engine'];
    return $result=array('adapter'=>get_class($wpdb),'transactional'=>count($engines)===count($names)&&count(array_filter($engines,function($engine){return strcasecmp($engine,'InnoDB')!==0;}))===0,'engines'=>$engines);
}
function csktm_transaction($work){
    global $wpdb;
    if(!csktm_database()['transactional'])csktm_fail('transactional_database_required','The selected WordPress content, metadata, taxonomy and options tables must support transactions before a reviewed release can be retained or applied.',409,csktm_database());
    add_option('cskt_migration_mutex','1','','no');
    csktm_db('START TRANSACTION');
    try{
        csktm_db($wpdb->prepare("UPDATE {$wpdb->options} SET option_value=option_value WHERE option_name=%s",'cskt_migration_mutex'));
        csktm_uncache();
        $result=$work();csktm_db('COMMIT');return $result;
    }catch(Throwable $e){$wpdb->query('ROLLBACK');csktm_uncache();throw $e;}
}
function csktm_lock_post($id){global $wpdb;csktm_db($wpdb->prepare("UPDATE {$wpdb->posts} SET ID=ID WHERE ID=%d",$id));csktm_db($wpdb->prepare("UPDATE {$wpdb->postmeta} SET meta_id=meta_id WHERE post_id=%d",$id));csktm_db($wpdb->prepare("UPDATE {$wpdb->term_relationships} SET object_id=object_id WHERE object_id=%d",$id));clean_post_cache($id);}
function csktm_snapshot($id){
    $p=get_post($id);if(!$p)return null;
    $fields=array();foreach(array('ID','post_type','post_status','post_title','post_content','post_excerpt','post_name','post_parent','menu_order','comment_status','ping_status','post_password','post_author','post_date','post_date_gmt','post_modified_gmt','post_mime_type')as$key)$fields[$key]=$p->$key;
    $meta=get_post_meta($id);unset($meta['_edit_lock'],$meta['_edit_last']);ksort($meta);foreach($meta as $key=>$values)$meta[$key]=array_map('maybe_unserialize',$values);
    $terms=array();foreach(get_object_taxonomies($p->post_type)as$tax){$ids=wp_get_object_terms($id,$tax,array('fields'=>'ids'));if(is_wp_error($ids))csktm_fail('taxonomy_read_failed',$ids->get_error_message(),500);sort($ids,SORT_NUMERIC);$terms[$tax]=$ids;}ksort($terms);
    $file=null;if($p->post_type==='attachment'){$path=get_attached_file($id);$file=array('relative'=>get_post_meta($id,'_wp_attached_file',true),'exists'=>is_string($path)&&is_file($path),'bytes'=>is_string($path)&&is_file($path)?filesize($path):null,'sha256'=>is_string($path)&&is_file($path)?hash_file('sha256',$path):null);}
    return array('fields'=>$fields,'meta'=>$meta,'terms'=>$terms,'file'=>$file);
}
function csktm_fingerprint($id){$state=csktm_snapshot($id);return $state===null?null:csktm_hash($state);}
function csktm_restore($before){
    $fields=$before['fields'];$id=(int)$fields['ID'];unset($fields['post_modified_gmt']);
    wp_save_post_revision($id);$result=wp_update_post(wp_slash($fields),true);if(is_wp_error($result))csktm_fail('native_restore_failed',$result->get_error_message(),500);
    foreach(get_post_meta($id)as$key=>$values)if(!in_array($key,array('_edit_lock','_edit_last'),true))delete_post_meta($id,$key);
    foreach($before['meta']as$key=>$values)foreach($values as$value)add_post_meta($id,$key,wp_slash($value));
    foreach($before['terms']as$tax=>$ids){$r=wp_set_object_terms($id,array_map('intval',$ids),$tax,false);if(is_wp_error($r))csktm_fail('taxonomy_restore_failed',$r->get_error_message(),500);}
    clean_post_cache($id);wp_save_post_revision($id);
}
function csktm_origin($url){$p=wp_parse_url($url);if(!is_array($p)||($p['scheme']??'')!=='https'||empty($p['host'])||isset($p['user'])||isset($p['pass']))csktm_fail('invalid_source_url','Retain a complete HTTPS source URL.');return strtolower($p['scheme'].'://'.$p['host']).(isset($p['port'])?':'.$p['port']:'');}
function csktm_source_key($origin,$source){return hash('sha256',$origin.'|'.$source['kind'].'|'.$source['wpId']);}
function csktm_path($value){
    if(!is_string($value)||strlen($value)>1600||!str_starts_with($value,'/')||str_starts_with($value,'//')||preg_match('/[?#\\\\\s\x00-\x1f]/',$value)||preg_match('/%2f/i',$value))csktm_fail('invalid_route','Use a complete local route without a query, fragment or encoded slash.');
    $decoded=rawurldecode($value);if(preg_match('/[\\\\\x00-\x1f]/',$decoded)||array_intersect(explode('/',$decoded),array('.','..')))csktm_fail('invalid_route','A reviewed route cannot contain traversal.');
    if(preg_match('~^/(?:wp-admin|wp-json|wp-includes)(?:/|$)|^/wp-login\.php$~i',$value))csktm_fail('reserved_route','The reviewed route is reserved for native WordPress administration.');
    return $value;
}
function csktm_post_type($kind){return array('page'=>'page','project'=>'cskt_project','document'=>'cskt_document','news'=>'post','notice'=>'cskt_notice','media'=>'attachment')[$kind]??null;}
function csktm_manifest($input){
    if(!is_array($input)||!csktm_sha($input['sha256']??null)||!is_string($input['manifestBase64']??null))csktm_fail('invalid_manifest','Provide the original release bytes and exact SHA-256.');
    $bytes=base64_decode($input['manifestBase64'],true);if($bytes===false||strlen($bytes)>CSKTM_MAX_MANIFEST||!hash_equals($input['sha256'],hash('sha256',$bytes)))csktm_fail('manifest_hash_mismatch','The exact original manifest bytes do not match their SHA-256.');
    $m=json_decode($bytes,true);if(!is_array($m)||($m['schema']??null)!=='cskt.migration.release.v1'||!csktm_id($m['id']??null)||!is_array($m['items']??null)||!count($m['items'])||count($m['items'])>5000||!is_array($m['redirects']??null))csktm_fail('invalid_manifest','Use a complete reviewed CSKT migration release v1.');
    $capture=$m['sourceCapture']??null;if(!is_array($capture)||!csktm_sha($capture['sha256']??null)||!is_string($capture['id']??null))csktm_fail('invalid_capture','Retain the original source capture ID and SHA-256.');$origin=csktm_origin($capture['origin']??'');
    $seen=array();$routes=array();foreach($m['items']as$item){
        if(!is_array($item)||!csktm_id($item['id']??null)||isset($seen[$item['id']])||!csktm_post_type($item['kind']??null)||!in_array($item['disposition']??null,array('retain','revise','consolidate','archive','remove'),true))csktm_fail('invalid_item','Every release item needs a distinct supported source identity, content kind and disposition.');
        $seen[$item['id']]=true;$s=$item['source']??null;if(!is_array($s)||!in_array($s['kind']??null,array('page','post','media'),true)||!is_int($s['wpId']??null)||$s['wpId']<1||!csktm_sha($s['sha256']??null))csktm_fail('invalid_source','Retain the original WordPress kind, numeric ID and source hash.');csktm_origin($s['url']??'');
        if(!is_string($item['revisionId']??null)||!is_array($item['review']??null)||empty($item['review']['reviewer'])||empty($item['review']['reviewedAt']))csktm_fail('review_required','Every native content item must retain its approved revision and reviewer.');
        foreach(array('title','contentHtml','summary','category')as$key)if(!is_string($item[$key]??null))csktm_fail('invalid_content','Retain the complete reviewed title, HTML, summary and category.');if(strlen($item['contentHtml'])>4*1048576)csktm_fail('content_too_large','One native content item exceeds 4 MiB.');
        csktm_path($item['route']??'');if(!in_array($item['disposition'],array('remove','consolidate'),true)){if(isset($routes[csktm_route_key($item['route'])]))csktm_fail('route_collision','Two release items claim the same reviewed route.');$routes[csktm_route_key($item['route'])]=$item['id'];}
        if(in_array($item['kind'],array('document','media'),true)&&!is_array($item['document']??null))csktm_fail('document_required','A native document or media record requires its reviewed file metadata.');
        if(!empty($item['document'])){$d=$item['document'];csktm_origin($d['sourceUrl']??'');foreach(array('mimeType','altText','versionLabel','downloadName')as$key)if(!is_string($d[$key]??null))csktm_fail('invalid_document','Retain the reviewed document type, filename, version and alternative text.');if(isset($d['sha256'])&&!csktm_sha($d['sha256']))csktm_fail('invalid_asset_hash','Use the captured original file SHA-256.');if(isset($d['bytes'])&&(!is_int($d['bytes'])||$d['bytes']<1||$d['bytes']>CSKTM_MAX_ASSET))csktm_fail('invalid_asset_size','Use the captured original file byte count, up to 1 GiB.');}
        if(!is_array($item['gis']??array())||count($item['gis']??array())>30)csktm_fail('invalid_gis','Use at most thirty original GIS resources per item.');foreach($item['gis']??array()as$g){$host=wp_parse_url($g['url']??'',PHP_URL_HOST);if(!preg_match('/^[a-f0-9]{32}$/i',$g['itemId']??'')||!is_string($host)||!preg_match('/(^|\.)(arcgis\.com|arcg\.is)$/i',$host)||!trim(wp_strip_all_tags($g['fallbackHtml']??'')))csktm_fail('invalid_gis','Retain the exact ArcGIS item, original URL and reviewed text equivalent.');csktm_origin($g['url']);}
    }
    foreach($m['items']as$item)foreach(array('parentId','canonicalId')as$key)if(!empty($item[$key])&&(!csktm_id($item[$key])||$item[$key]===$item['id']||($key==='canonicalId'&&!isset($seen[$item[$key]]))))csktm_fail('missing_related_item','Retain a distinct reviewed parent identity and include the consolidation destination in this release.',400,array('itemId'=>$item['id'],'relatedId'=>$item[$key]));
    $redirects=array();foreach($m['redirects']as$r){if(!is_array($r)||!isset($seen[$r['itemId']??''])||!in_array($r['status']??null,array(301,410),true))csktm_fail('invalid_redirect','Use reviewed 301 or 410 routes bound to a release item.');$path=csktm_route_key(csktm_path($r['sourcePath']??''));if(isset($routes[$path])||isset($redirects[$path]))csktm_fail('redirect_collision','A redirect shadows a content route or another redirect.');if($r['status']===301){$target=csktm_path($r['targetPath']??'');if($path===csktm_route_key($target))csktm_fail('redirect_loop','A redirect cannot point to itself.');}$redirects[$path]=$r;}
    foreach($redirects as$path=>$r){$trail=array($path=>true);while($r['status']===301&&isset($redirects[csktm_route_key($r['targetPath'])])){$path=csktm_route_key($r['targetPath']);if(isset($trail[$path]))csktm_fail('redirect_loop','The reviewed redirects contain a cycle.');$trail[$path]=true;$r=$redirects[$path];}}
    return array($m,$bytes,$origin);
}
function csktm_operation($record,$id,$action,$request){if(!csktm_id($id))csktm_fail('operation_id_required','Retain one stable operation ID before sending this action.');$hash=csktm_hash($request);if(isset($record['operations'][$id])){$old=$record['operations'][$id];if($old['action']!==$action||$old['requestSha256']!==$hash)csktm_fail('operation_conflict','This operation ID already identifies a different destination request.',409);return $old;}return null;}
function csktm_record_operation(&$record,$id,$action,$request,$result){$record['operations'][$id]=array('id'=>$id,'action'=>$action,'requestSha256'=>csktm_hash($request),'at'=>csktm_now(),'actor'=>get_current_user_id(),'result'=>$result);csktm_save($record);}
function csktm_inspect(){global $wp_version,$wpdb;$bindings=get_option('cskt_migration_bindings',array());return array('schema'=>'cskt.wordpress.destination.v1','pluginVersion'=>CSKTM_VERSION,'wordpressVersion'=>$wp_version,'phpVersion'=>PHP_VERSION,'baseUrl'=>untrailingslashit(home_url('/')),'restUrl'=>rest_url(CSKTM_NS),'actor'=>array('id'=>get_current_user_id(),'username'=>wp_get_current_user()->user_login),'databaseAdapter'=>get_class($wpdb),'database'=>csktm_database(),'postTypes'=>array_map('csktm_post_type',array('page','project','document','news','notice','media')),'limits'=>array('manifestBytes'=>CSKTM_MAX_MANIFEST,'assetBytes'=>CSKTM_MAX_ASSET,'chunkBytes'=>CSKTM_CHUNK_BYTES),'bindings'=>array_values($bindings),'releases'=>get_option('cskt_migration_releases',array()),'mediaTransport'=>'Verified exact bytes; selected source URL and response metadata retained.');}
function csktm_bind($body){
    if(!is_array($body)||!is_array($body['source']??null)||!is_int($body['postId']??null)||!csktm_sha($body['expectedFingerprint']??null))csktm_fail('invalid_binding','Inspect the native post and retain its fingerprint before binding its original source.');
    $origin=csktm_origin($body['sourceOrigin']??'');$source=$body['source'];if(!in_array($source['kind']??null,array('page','post','media'),true)||!is_int($source['wpId']??null)||$source['wpId']<1)csktm_fail('invalid_binding_source','Use the exact original source kind and WordPress ID.');
    return csktm_transaction(function()use($body,$origin,$source){$id=$body['postId'];csktm_lock_post($id);if(!get_post($id)||!current_user_can('edit_post',$id))csktm_fail('native_post_missing','Choose an existing editable native post.',404);if(!hash_equals($body['expectedFingerprint'],csktm_fingerprint($id)))csktm_fail('native_post_changed','The native post changed after inspection. Inspect it again before binding.',409);$key=csktm_source_key($origin,$source);$map=get_option('cskt_migration_bindings',array());if(isset($map[$key])&&(int)$map[$key]['postId']!==$id)csktm_fail('source_already_bound','The original source is already bound to a different native post.',409,array('binding'=>$map[$key]));$map[$key]=array('sourceKey'=>$key,'sourceOrigin'=>$origin,'source'=>$source,'postId'=>$id,'boundBy'=>get_current_user_id(),'boundAt'=>csktm_now());update_option('cskt_migration_bindings',$map,false);return array('binding'=>$map[$key],'fingerprint'=>csktm_fingerprint($id));});
}
