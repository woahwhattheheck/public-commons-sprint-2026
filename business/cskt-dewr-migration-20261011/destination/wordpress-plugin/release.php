<?php
if (!defined('ABSPATH')) { exit; }

function csktm_route_key($path){return '/'.trim($path,'/');}
function csktm_target($origin,$item,$bindings){$key=csktm_source_key($origin,$item['source']);$binding=$bindings[$key]??null;return array($key,$binding,(int)($binding['postId']??0));}
function csktm_parent_target($item,$bindings){$parent=$item['parentId']??'';if(!$parent)return 0;foreach($bindings as$binding){$identity=$binding['itemId']??(($binding['source']['kind']??'').':'.($binding['source']['wpId']??''));if($identity===$parent)return (int)$binding['postId'];}return 0;}
function csktm_plan($manifest,$origin){
    $bindings=get_option('cskt_migration_bindings',array());$routes=get_option('cskt_migration_routes',array());$rows=array();$issues=array();$summary=array('create'=>0,'update'=>0,'withdraw'=>0,'assets'=>0,'conflicts'=>0);
    $selected=array_column($manifest['items'],null,'id');$nativeClaims=array();
    foreach($manifest['items']as$item){
        list($key,$binding,$id)=csktm_target($origin,$item,$bindings);$p=$id?get_post($id):null;
        $action=in_array($item['disposition'],array('remove','consolidate'),true)?'WITHDRAW':($id?'UPDATE':'CREATE');
        $row=array('itemId'=>$item['id'],'sourceKey'=>$key,'kind'=>$item['kind'],'disposition'=>$item['disposition'],'title'=>$item['title'],'route'=>$item['route'],'postId'=>$id?:null,'action'=>$action,'beforeSha256'=>$id?csktm_fingerprint($id):null,'bindingBefore'=>$binding,'routeBefore'=>$routes[csktm_route_key($item['route'])]??null);
        if($id&&!$p)$issues[]=array('itemId'=>$item['id'],'code'=>'BOUND_POST_MISSING','message'=>'The previously bound WordPress post is missing. Restore it or explicitly correct its source binding.','postId'=>$id);
        if($id&&$item['kind']!=='media'){if(isset($nativeClaims[$id]))$issues[]=array('itemId'=>$item['id'],'code'=>'NATIVE_POST_BOUND_TWICE','message'=>'Two distinct original content items are bound to the same native post. Correct the explicit bindings before applying.','postId'=>$id,'otherItemId'=>$nativeClaims[$id]);$nativeClaims[$id]=$item['id'];}
        if($p&&(($p->post_type==='attachment')!==($item['kind']==='media')))$issues[]=array('itemId'=>$item['id'],'code'=>'NATIVE_ATTACHMENT_TYPE_CONFLICT','message'=>'The existing source binding cannot interchange a native attachment and a content record. Retain its native type or choose an explicitly reviewed destination record.','postId'=>$id);
        $parent=$item['parentId']??'';if($parent&&!isset($selected[$parent])){$nativeParent=csktm_parent_target($item,$bindings);$row['parent']=array('itemId'=>$parent,'postId'=>$nativeParent?:null,'beforeSha256'=>$nativeParent?csktm_fingerprint($nativeParent):null);if(!$nativeParent||!get_post($nativeParent)||!is_post_type_hierarchical(csktm_post_type($item['kind']))||get_post_type($nativeParent)!==csktm_post_type($item['kind']))$issues[]=array('itemId'=>$item['id'],'code'=>'NATIVE_PARENT_REQUIRED','message'=>'Include the reviewed parent in this release, or first publish its matching native hierarchical type.','parentItemId'=>$parent);}
        if($p&&!current_user_can('edit_post',$id))$issues[]=array('itemId'=>$item['id'],'code'=>'POST_PERMISSION','message'=>'The destination account cannot edit this native post.','postId'=>$id);
        $routeEntry=$row['routeBefore'];if($action!=='WITHDRAW'&&$routeEntry&&(($routeEntry['sourceKey']??null)!==$key))$issues[]=array('itemId'=>$item['id'],'code'=>'MANAGED_ROUTE_OCCUPIED','message'=>'The reviewed route belongs to a different original source.','route'=>$item['route'],'current'=>$routeEntry);
        if($action!=='WITHDRAW'&&!$routeEntry&&$item['kind']!=='media'){
            $candidate=url_to_postid(home_url($item['route']));
            if(!$candidate&&$item['route']!=='/'){$found=get_page_by_path(trim($item['route'],'/'),OBJECT,array('page','post','cskt_project','cskt_document','cskt_notice'));$candidate=$found?(int)$found->ID:0;}
            if($candidate&&$candidate!==$id)$issues[]=array('itemId'=>$item['id'],'code'=>'NATIVE_ROUTE_OCCUPIED','message'=>'Inspect and explicitly bind the existing native post, or choose a different reviewed route.','route'=>$item['route'],'candidateWordPressId'=>$candidate);
        }
        if($item['route']==='/'&&!$id&&get_option('show_on_front')==='page'&&(int)get_option('page_on_front'))$issues[]=array('itemId'=>$item['id'],'code'=>'NATIVE_HOME_OCCUPIED','message'=>'Inspect and explicitly bind the existing native front page before replacing its reviewed route.','candidateWordPressId'=>(int)get_option('page_on_front'));
        if($action!=='WITHDRAW'&&!empty($item['document'])){$summary['assets']++;$row['asset']=array_intersect_key($item['document'],array_flip(array('sourceUrl','mimeType','downloadName','sha256','bytes')));}
        $summary[$action==='CREATE'?'create':($action==='UPDATE'?'update':'withdraw')]++;$rows[]=$row;
    }
    $redirects=array();foreach($manifest['redirects']as$r){$key=csktm_route_key($r['sourcePath']);$before=$routes[$key]??null;$redirects[]=array('route'=>$r,'before'=>$before);if($before&&($before['itemId']??null)!==$r['itemId'])$issues[]=array('itemId'=>$r['itemId'],'code'=>'REDIRECT_OCCUPIED','message'=>'A different retained source owns this redirect path.','path'=>$r['sourcePath'],'current'=>$before);}
    $summary['conflicts']=count($issues);
    $plan=array('schema'=>'cskt.wordpress.preview.v1','releaseId'=>$manifest['id'],'destination'=>untrailingslashit(home_url('/')),'items'=>$rows,'redirects'=>$redirects,'summary'=>$summary,'issues'=>$issues,'contentTreatment'=>'WordPress post HTML allowlist; selected source links and verified media map to their native destination. Original release bytes are retained.','homeOptions'=>array('show_on_front'=>get_option('show_on_front'),'page_on_front'=>get_option('page_on_front'),'page_for_posts'=>get_option('page_for_posts')));
    $plan['planSha256']=csktm_hash($plan);return $plan;
}
function csktm_preview($input){
    list($manifest,$bytes,$origin)=csktm_manifest($input);
    return csktm_transaction(function()use($manifest,$bytes,$origin,$input){
        wp_cache_delete(csktm_key($manifest['id']),'options');$old=get_option(csktm_key($manifest['id']));
        if(is_array($old)&&$old['sha256']!==$input['sha256'])csktm_fail('release_identity_conflict','This release ID already belongs to different exact manifest bytes.',409);
        $record=is_array($old)?$old:array('id'=>$manifest['id'],'sha256'=>$input['sha256'],'manifestBase64'=>base64_encode($bytes),'manifest'=>$manifest,'origin'=>$origin,'createdAt'=>csktm_now(),'status'=>'PREVIEWED','plans'=>array(),'operations'=>array(),'assets'=>array(),'items'=>array(),'routes'=>array(),'bindings'=>array());
        $plan=csktm_plan($manifest,$origin);$plan['sha256']=$input['sha256'];
        $record['plans'][$plan['planSha256']]=$plan;$record['latestPlanSha256']=$plan['planSha256'];csktm_save($record);
        $list=get_option('cskt_migration_releases',array());$list[$record['id']]=array('id'=>$record['id'],'sha256'=>$record['sha256'],'status'=>$record['status'],'createdAt'=>$record['createdAt']);update_option('cskt_migration_releases',$list,false);
        return $plan;
    });
}
function csktm_item($record,$id){foreach($record['manifest']['items']as$item)if($item['id']===$id)return $item;csktm_fail('item_missing','This item is not in the exact retained release.',404);}
function csktm_file_type($mime){return array('application/pdf'=>'pdf','image/png'=>'png','image/jpeg'=>'jpg','image/gif'=>'gif','image/webp'=>'webp','image/avif'=>'avif','text/plain'=>'txt','text/csv'=>'csv','video/mp4'=>'mp4','video/webm'=>'webm','video/quicktime'=>'mov','audio/mpeg'=>'mp3','audio/mp4'=>'m4a','audio/wav'=>'wav','audio/x-wav'=>'wav','audio/ogg'=>'ogg','video/ogg'=>'ogv')[$mime]??null;}
function csktm_asset_descriptor($record,$header){
    if(!is_array($header)||($header['manifestSha256']??null)!==$record['sha256']||!csktm_id($header['operationId']??null)||!is_string($header['itemId']??null))csktm_fail('invalid_asset_request','Bind each file upload to its exact retained release, source item and stable operation.');
    if(in_array($record['status'],array('APPLIED','ROLLED_BACK','PARTIALLY_ROLLED_BACK'),true))csktm_fail('release_closed','This completed release cannot import new assets. Read its original result or create a new reviewed release.',409);
    $item=csktm_item($record,$header['itemId']);$d=$item['document']??null;if(!$d||in_array($item['disposition'],array('remove','consolidate'),true))csktm_fail('asset_not_selected','This release item does not select a file for native publication.');
    if(($header['sourceUrl']??null)!==$d['sourceUrl'])csktm_fail('asset_source_changed','The upload must retain the exact reviewed file URL.');csktm_origin($header['finalUrl']??'');
    $mime=strtolower(trim(explode(';',(string)($header['responseContentType']??''))[0]));$expected=strtolower($d['mimeType']);if($mime!==$expected||!csktm_file_type($mime))csktm_fail('asset_mime_mismatch','The actual response type must match the reviewed document type. Select the original file URL or correct its reviewed metadata.',400,array('reviewed'=>$expected,'response'=>$mime,'sourceUrl'=>$d['sourceUrl']));
    if(!csktm_sha($header['sha256']??null)||!is_int($header['bytes']??null)||$header['bytes']<1||$header['bytes']>CSKTM_MAX_ASSET)csktm_fail('asset_identity_required','Retain the actual file SHA-256 and byte count within the destination upload limit.');
    if(isset($d['sha256'])&&!hash_equals($d['sha256'],$header['sha256']))csktm_fail('asset_capture_changed','The downloaded file differs from the approved source capture SHA-256.');if(isset($d['bytes'])&&$d['bytes']!==$header['bytes'])csktm_fail('asset_size_changed','The downloaded byte count differs from the approved source capture.');
    return array('itemId'=>$item['id'],'operationId'=>$header['operationId'],'sourceUrl'=>$d['sourceUrl'],'finalUrl'=>$header['finalUrl'],'responseContentType'=>$header['responseContentType'],'mimeType'=>$mime,'filename'=>sanitize_file_name($d['downloadName']),'sha256'=>$header['sha256'],'bytes'=>$header['bytes'],'versionLabel'=>$d['versionLabel'],'sourceMediaId'=>$d['sourceMediaId']??null,'sourceSha256'=>$item['source']['sha256']);
}
function csktm_asset($id,$header,$bytes){
    if(strlen($bytes)>CSKTM_CHUNK_BYTES)csktm_fail('chunk_required','Use the resumable file upload endpoints for assets above 2 MiB.',413);
    $file=wp_tempnam('cskt-asset');if(!$file||file_put_contents($file,$bytes,LOCK_EX)!==strlen($bytes))csktm_fail('asset_write_failed','The runtime could not retain the complete upload.',500);
    try{return csktm_asset_file($id,$header,$file);}finally{@unlink($file);}
}
function csktm_asset_file($id,$header,$inputFile){
    $record=csktm_load($id);$d=csktm_asset_descriptor($record,$header);
    if(!is_file($inputFile)||filesize($inputFile)!==$d['bytes']||!hash_equals($d['sha256'],hash_file('sha256',$inputFile)))csktm_fail('asset_bytes_mismatch','The received file bytes do not match their retained SHA-256 and size.');
    $handle=fopen($inputFile,'rb');$head=fread($handle,32);fclose($handle);
    if($d['mimeType']==='application/pdf'&&!str_starts_with($head,'%PDF-'))csktm_fail('asset_signature_mismatch','The selected PDF response is not a PDF file.');
    if(str_starts_with($d['mimeType'],'image/')){$image=@getimagesize($inputFile);if(!$image||($image['mime']??'')!==$d['mimeType'])csktm_fail('asset_signature_mismatch','The actual image signature differs from its reviewed MIME type.');}
    if($d['mimeType']==='video/mp4'&&substr($head,4,4)!=='ftyp')csktm_fail('asset_signature_mismatch','The selected MP4 response does not contain its native file signature.');
    $uploads=wp_upload_dir();if($uploads['error'])csktm_fail('uploads_unavailable',$uploads['error'],500);$folder=$uploads['basedir'].'/cskt-retained';if(!wp_mkdir_p($folder))csktm_fail('asset_directory_failed','WordPress could not create its retained media directory.',500);$file=$folder.'/'.$d['sha256'].'.'.csktm_file_type($d['mimeType']);
    if(is_file($file)){if(filesize($file)!==$d['bytes']||!hash_equals($d['sha256'],hash_file('sha256',$file)))csktm_fail('retained_file_changed','A retained file with this identity has changed. Restore its original bytes before retrying.',409);}
    else{$part=$file.'.'.wp_generate_uuid4().'.part';if(!copy($inputFile,$part)||filesize($part)!==$d['bytes']){@unlink($part);csktm_fail('asset_write_failed','WordPress could not retain all original media bytes.',500);}if(!rename($part,$file)){@unlink($part);csktm_fail('asset_write_failed','WordPress could not finish retaining the media file.',500);}}
    return csktm_transaction(function()use($id,$header,$d,$file){
        $record=csktm_load($id);csktm_asset_descriptor($record,$header);$previous=$record['assets'][$d['itemId']]??null;if($previous){if($previous['sha256']!==$d['sha256']||$previous['bytes']!==$d['bytes'])csktm_fail('asset_identity_conflict','This source item already retained different file bytes in this release.',409);return $previous;}
        $ids=get_posts(array('post_type'=>'attachment','post_status'=>'any','numberposts'=>3,'fields'=>'ids','meta_key'=>'_cskt_asset_sha256','meta_value'=>$d['sha256']));if(count($ids)>1)csktm_fail('duplicate_asset_identity','Multiple native attachments claim this retained file hash. Reconcile the Media Library mapping first.',409);
        $created=!$ids;$attachment=$ids?(int)$ids[0]:0;
        if($attachment){csktm_lock_post($attachment);$nativeFile=get_attached_file($attachment);if(!is_file($nativeFile)||!hash_equals($d['sha256'],hash_file('sha256',$nativeFile)))csktm_fail('native_asset_changed','The existing native attachment no longer contains its retained bytes.',409);}
        else{
            $item=csktm_item($record,$d['itemId']);$attachment=wp_insert_attachment(wp_slash(array('post_mime_type'=>$d['mimeType'],'post_title'=>$item['title'],'post_content'=>'','post_status'=>'inherit')),$file,0,true);if(is_wp_error($attachment))csktm_fail('attachment_create_failed',$attachment->get_error_message(),500);
            update_post_meta($attachment,'_cskt_asset_sha256',$d['sha256']);update_post_meta($attachment,'_cskt_asset_descriptor',wp_slash(csktm_json($d)));update_post_meta($attachment,'_wp_attachment_image_alt',wp_slash($item['document']['altText']));
            if(str_starts_with($d['mimeType'],'image/')){require_once ABSPATH.'wp-admin/includes/image.php';add_filter('big_image_size_threshold','__return_false');try{$meta=wp_generate_attachment_metadata($attachment,$file);if(is_array($meta))wp_update_attachment_metadata($attachment,$meta);}finally{remove_filter('big_image_size_threshold','__return_false');}}else wp_update_attachment_metadata($attachment,array('filesize'=>$d['bytes']));
        }
        $d['attachmentId']=(int)$attachment;$d['nativeUrl']=wp_get_attachment_url($attachment);$d['created']=$created;$d['retainedAt']=csktm_now();$d['nativeSha256']=csktm_fingerprint($attachment);$record['assets'][$d['itemId']]=$d;csktm_save($record);return $d;
    });
}
function csktm_links($record,$bindings){
    $urls=array();$images=array();
    foreach($record['manifest']['items']as$item){
        if(in_array($item['disposition'],array('remove','consolidate'),true))continue;
        $to=$item['kind']==='media'?($record['assets'][$item['id']]['nativeUrl']??null):home_url($item['route']);
        if($to){$urls[$item['source']['url']]=$to;$urls[wp_parse_url($item['source']['url'],PHP_URL_PATH)]=$to;}
        if(!isset($record['assets'][$item['id']]))continue;
        $asset=$record['assets'][$item['id']];
        $urls[$asset['sourceUrl']]=$asset['nativeUrl'];$urls[$asset['finalUrl']]=$asset['nativeUrl'];$urls[wp_parse_url($asset['sourceUrl'],PHP_URL_PATH)]=$asset['nativeUrl'];
        // This source uses Optimole transformation URLs containing the original
        // upload URL. Bind only the host observed in this exact source record
        // and the original file whose complete bytes were verified.
        $original=wp_parse_url($item['source']['url']);$host=strtolower($original['host']??'');
        if(str_starts_with($asset['mimeType'],'image/')&&str_ends_with($host,'.optimole.com')&&str_ends_with(rawurldecode($original['path']??''),'/'.rawurldecode($asset['sourceUrl'])))
            $images[]=array('host'=>$host,'originalUrl'=>$asset['sourceUrl'],'nativeUrl'=>$asset['nativeUrl']);
    }
    return array('urls'=>$urls,'images'=>$images);
}
function csktm_rewrite_html($html,$links){
    $map=$links['urls']??$links;$images=$links['images']??array();$processor=new WP_HTML_Tag_Processor($html);$mapped=0;$transforms=0;$collapsed=0;$promoted=0;$promotedSets=0;
    $rewrite=function($url)use($map,$images,&$mapped,&$transforms){
        if(isset($map[$url])){$mapped++;return $map[$url];}
        $base=preg_replace('/[?#].*$/s','',$url);
        if(isset($map[$base])){$mapped++;return $map[$base].substr($url,strlen($base));}
        $parts=wp_parse_url($base);
        if(is_array($parts)&&($parts['scheme']??'')==='https'&&!isset($parts['user'])&&!isset($parts['pass'])){
            foreach($images as$image)if(strtolower($parts['host']??'')===$image['host']&&str_ends_with(rawurldecode($parts['path']??''),'/'.rawurldecode($image['originalUrl']))){
                $mapped++;$transforms++;$fragment=wp_parse_url($url,PHP_URL_FRAGMENT);
                return $image['nativeUrl'].(is_string($fragment)&&$fragment!==''?'#'.$fragment:'');
            }
        }
        return $url;
    };
    while($processor->next_tag()){
        $tag=$processor->get_tag();$src=$processor->get_attribute('src');
        foreach(array('href','src','poster','data-src','data-lazy-src','data-opt-src')as$key){$value=$processor->get_attribute($key);if(is_string($value)){$next=$rewrite($value);if($next!==$value)$processor->set_attribute($key,$next);}}
        // The captured Optimole markup uses a transparent data-URI placeholder.
        // Inspect the original src before WordPress URL normalization can turn
        // a scheme-stripped placeholder into an apparent HTTP URL.
        if($tag==='IMG'&&(!is_string($src)||trim($src)===''||preg_match('/^(?:data:)?image\/[a-z0-9.+-]+[;,]/i',ltrim($src)))){
            foreach(array('data-opt-src','data-src','data-lazy-src')as$key){
                $candidate=$processor->get_attribute($key);if(!is_string($candidate))continue;$parts=wp_parse_url($candidate);
                if(is_array($parts)&&in_array(strtolower($parts['scheme']??''),array('http','https'),true)&&!empty($parts['host'])&&!isset($parts['user'])&&!isset($parts['pass'])){
                    if($processor->set_attribute('src',$candidate)){$promoted++;break;}
                }
            }
        }
        foreach(array('srcset','data-srcset','data-lazy-srcset','old-srcset')as$key){
            $set=$processor->get_attribute($key);if(!is_string($set)||str_contains($set,'data:'))continue;
            $parts=array();$nativeUrls=array();$changed=false;
            foreach(explode(',',$set)as$part){
                if(!preg_match('/^\s*(\S+)(\s+\S+)?\s*$/',$part,$match)){$parts[]=$part;continue;}
                $next=$rewrite($match[1]);$changed=$changed||$next!==$match[1];$nativeUrls[]=$next;$parts[]=$next.($match[2]??'');
            }
            // All observed transformation widths now reference one verified
            // original. Do not attach inaccurate derivative-width descriptors.
            if($changed&&count($nativeUrls)>1&&count(array_unique($nativeUrls))===1){$nextSet=$nativeUrls[0];$collapsed++;}
            else $nextSet=implode(', ',$parts);
            $processor->set_attribute($key,$nextSet);
            $activeSet=$processor->get_attribute('srcset');
            if($key!=='srcset'&&in_array($tag,array('IMG','SOURCE'),true)&&(!is_string($activeSet)||trim($activeSet)==='')&&trim($nextSet)!==''){
                $processor->set_attribute('srcset',$nextSet);$promotedSets++;
            }
        }
    }
    $rewritten=$processor->get_updated_html();$safe=wp_kses_post($rewritten);
    return array($safe,array('mappedLinks'=>$mapped,'mappedImageTransforms'=>$transforms,'collapsedSourceSets'=>$collapsed,'promotedLazyImages'=>$promoted,'promotedSourceSets'=>$promotedSets,'htmlSanitized'=>$safe!==$rewritten,'sourceHtmlSha256'=>hash('sha256',$html),'nativeHtmlSha256'=>hash('sha256',$safe)));
}
function csktm_apply($id,$input){
    if(!is_array($input)||!csktm_id($input['operationId']??null)||!csktm_sha($input['sha256']??null))csktm_fail('invalid_apply','Use the exact release hash and stable retained operation ID.');
    return csktm_transaction(function()use($id,$input){
        $record=csktm_load($id);if($record['sha256']!==$input['sha256'])csktm_fail('release_hash_mismatch','Apply the exact manifest originally previewed on this destination.',409);
        $request=array('releaseId'=>$id,'sha256'=>$input['sha256'],'planSha256'=>$input['planSha256']??$record['latestPlanSha256']);$old=csktm_operation($record,$input['operationId'],'apply',$request);if($old)return $old['result']+array('recovered'=>true);
        if($record['status']==='APPLIED')return array('schema'=>'cskt.wordpress.apply.v1','releaseId'=>$id,'sha256'=>$record['sha256'],'status'=>'APPLIED','operationId'=>$record['appliedOperationId'],'alreadyApplied'=>true,'summary'=>$record['summary']);
        if(in_array($record['status'],array('ROLLED_BACK','PARTIALLY_ROLLED_BACK'),true))csktm_fail('release_rolled_back','Create a new reviewed release to publish after rollback.',409);
        $plan=$record['plans'][$request['planSha256']]??null;if(!$plan)csktm_fail('preview_required','Preview this destination and retain the displayed plan hash before applying.',409);
        foreach($plan['items']as$row){if($row['postId'])csktm_lock_post($row['postId']);if(!empty($row['parent']['postId']))csktm_lock_post($row['parent']['postId']);}
        $current=csktm_plan($record['manifest'],$record['origin']);if(!hash_equals($plan['planSha256'],$current['planSha256'])||$current['issues']){$result=array('schema'=>'cskt.wordpress.apply.v1','releaseId'=>$id,'status'=>'CONFLICT','operationId'=>$input['operationId'],'code'=>'DESTINATION_CHANGED','message'=>'The native destination differs from the reviewed preview. Inspect these current rows and preview again.','currentPlan'=>$current);csktm_record_operation($record,$input['operationId'],'apply',$request,$result);return $result;}
        $missing=array();foreach($record['manifest']['items']as$item)if(!empty($item['document'])&&!in_array($item['disposition'],array('remove','consolidate'),true)&&!isset($record['assets'][$item['id']]))$missing[]=$item['id'];if($missing)csktm_fail('media_required','Retain the selected original media bytes before applying native content.',409,array('itemIds'=>$missing));
        $bindings=get_option('cskt_migration_bindings',array());$routes=get_option('cskt_migration_routes',array());$beforeBindings=$bindings;$beforeRoutes=$routes;$map=csktm_links($record,$bindings);$pending=$record['manifest']['items'];$createdIds=array();$applied=array();$rounds=0;$selected=array_column($pending,null,'id');
        while($pending){$progress=false;$next=array();foreach($pending as$item){
            $parentId=$item['parentId']??'';if($parentId&&isset($selected[$parentId])&&!isset($applied[$parentId])){$next[]=$item;continue;}
            list($key,$binding,$postId)=csktm_target($record['origin'],$item,$bindings);$before=$postId?csktm_snapshot($postId):null;$withdraw=in_array($item['disposition'],array('remove','consolidate'),true);
            if($postId)csktm_lock_post($postId);$nativeParent=$parentId?(isset($selected[$parentId])?(int)($applied[$parentId]['postId']??0):csktm_parent_target($item,$bindings)):0;
            if($withdraw){if($postId){wp_save_post_revision($postId);$r=wp_update_post(wp_slash(array('ID'=>$postId,'post_status'=>'draft')),true);if(is_wp_error($r))csktm_fail('native_update_failed',$r->get_error_message(),500);} $treatment=array('withdrawn'=>true);}
            else{
                $type=csktm_post_type($item['kind']);list($html,$treatment)=csktm_rewrite_html($item['contentHtml'],$map);
                if($nativeParent&&(!is_post_type_hierarchical($type)||get_post_type($nativeParent)!==$type))csktm_fail('parent_type_conflict','The native parent must have the same hierarchical content type.',409,array('itemId'=>$item['id'],'parentId'=>$parentId));
                if($type==='attachment'){$postId=(int)$record['assets'][$item['id']]['attachmentId'];csktm_lock_post($postId);if(!$before&&(!$record['assets'][$item['id']]['created']))$before=csktm_snapshot($postId);$treatment['sharedAttachment']=!$record['assets'][$item['id']]['created'];}
                else{
                    $post=array('post_type'=>$type,'post_status'=>'publish','post_title'=>$item['title'],'post_content'=>$html,'post_excerpt'=>$item['summary'],'post_name'=>sanitize_title(basename(trim($item['route'],'/'))?:'home'),'post_parent'=>$nativeParent,'comment_status'=>'closed','ping_status'=>'closed');if($postId){$post['ID']=$postId;wp_save_post_revision($postId);}$postId=wp_insert_post(wp_slash($post),true);if(is_wp_error($postId))csktm_fail('native_write_failed',$postId->get_error_message(),500);if(!$before)$createdIds[]=(int)$postId;
                    update_post_meta($postId,'_cskt_route',wp_slash($item['route']));update_post_meta($postId,'_cskt_archive',$item['disposition']==='archive'?'1':'0');
                    $document=$item['document']??null;if($document){$asset=$record['assets'][$item['id']];$document+=array('familyId'=>$item['id'],'description'=>'');$document['attachmentId']=$asset['attachmentId'];$document['nativeUrl']=$asset['nativeUrl'];$document['sha256']=$asset['sha256'];$document['bytes']=$asset['bytes'];$document['responseContentType']=$asset['responseContentType'];}
                    foreach(array('_cskt_document'=>$document,'_cskt_gis'=>$item['gis']??array(),'_cskt_notice'=>$item['notice']??null)as$meta=>$value)update_post_meta($postId,$meta,wp_slash(csktm_json($value)));
                    $term=wp_set_object_terms($postId,array($item['category']),'cskt_topic',false);if(is_wp_error($term))csktm_fail('native_taxonomy_failed',$term->get_error_message(),500);wp_save_post_revision($postId);
                }
            }
            if($postId){$bindings[$key]=array('sourceKey'=>$key,'sourceOrigin'=>$record['origin'],'source'=>$item['source'],'itemId'=>$item['id'],'postId'=>(int)$postId,'releaseId'=>$id,'revisionId'=>$item['revisionId'],'boundAt'=>csktm_now());}
            if(!$withdraw){$routeKey=csktm_route_key($item['route']);$routes[$routeKey]=array('path'=>$item['route'],'type'=>$item['kind']==='media'?'asset':'content','sourceKey'=>$key,'itemId'=>$item['id'],'postId'=>(int)$postId,'releaseId'=>$id);if($item['kind']==='media')$routes[$routeKey]['targetUrl']=$record['assets'][$item['id']]['nativeUrl'];}
            $entry=array('itemId'=>$item['id'],'source'=>$item['source'],'revisionId'=>$item['revisionId'],'review'=>$item['review'],'postId'=>$postId?:null,'kind'=>$item['kind'],'disposition'=>$item['disposition'],'before'=>$before,'created'=>$before===null&&(bool)$postId,'applied'=>$postId?csktm_snapshot($postId):null,'appliedSha256'=>$postId?csktm_fingerprint($postId):null,'nativeUrl'=>$postId?($item['kind']==='media'?wp_get_attachment_url($postId):get_permalink($postId)):null,'treatment'=>$treatment,'status'=>'APPLIED');$applied[$item['id']]=$entry;$progress=true;
        }if(!$progress)csktm_fail('parent_cycle','The release parent relationships contain a cycle.');$pending=$next;if(++$rounds>count($record['manifest']['items']))csktm_fail('parent_cycle','The release parent relationships could not be ordered.');}
        foreach($record['manifest']['redirects']as$r){$item=csktm_item($record,$r['itemId']);$routes[csktm_route_key($r['sourcePath'])]=array('path'=>$r['sourcePath'],'type'=>'redirect','status'=>$r['status'],'targetPath'=>$r['targetPath']??null,'itemId'=>$r['itemId'],'sourceKey'=>csktm_source_key($record['origin'],$item['source']),'releaseId'=>$id);}
        $routeChanges=array();foreach($routes as$key=>$entry)if(($entry['releaseId']??null)===$id)$routeChanges[$key]=array('before'=>$beforeRoutes[$key]??null,'applied'=>$entry);
        $bindingChanges=array();foreach($bindings as$key=>$entry)if(($entry['releaseId']??null)===$id)$bindingChanges[$key]=array('before'=>$beforeBindings[$key]??null,'applied'=>$entry);
        update_option('cskt_migration_routes',$routes,false);update_option('cskt_migration_bindings',$bindings,false);
        $record['items']=$applied;$record['routes']=$routeChanges;$record['bindings']=$bindingChanges;$record['status']='APPLIED';$record['appliedAt']=csktm_now();$record['appliedOperationId']=$input['operationId'];$record['appliedPlanSha256']=$plan['planSha256'];$record['summary']=array('items'=>count($applied),'created'=>count($createdIds),'assets'=>count($record['assets']),'routes'=>count($routeChanges),'redirects'=>count($record['manifest']['redirects']));
        $result=array('schema'=>'cskt.wordpress.apply.v1','releaseId'=>$id,'sha256'=>$record['sha256'],'status'=>'APPLIED','operationId'=>$input['operationId'],'planSha256'=>$plan['planSha256'],'summary'=>$record['summary'],'items'=>array_map(function($r){return array_intersect_key($r,array_flip(array('itemId','postId','nativeUrl','appliedSha256','treatment','status')));},array_values($applied)));
        csktm_record_operation($record,$input['operationId'],'apply',$request,$result);$list=get_option('cskt_migration_releases',array());$list[$id]['status']='APPLIED';update_option('cskt_migration_releases',$list,false);return $result;
    });
}
function csktm_readback($id){
    $record=csktm_load($id);$rows=array();foreach($record['items']as$item){$current=$item['postId']?csktm_snapshot($item['postId']):null;$sha=$current?csktm_hash($current):null;$rows[]=array('itemId'=>$item['itemId'],'source'=>$item['source'],'revisionId'=>$item['revisionId'],'postId'=>$item['postId'],'kind'=>$item['kind'],'status'=>$item['status'],'nativeUrl'=>$item['postId']?($item['kind']==='media'?wp_get_attachment_url($item['postId']):get_permalink($item['postId'])):null,'appliedSha256'=>$item['appliedSha256'],'currentSha256'=>$sha,'changedSinceApply'=>$item['status']==='APPLIED'&&$sha!==$item['appliedSha256'],'current'=>$current,'treatment'=>$item['treatment']);}
    $routes=get_option('cskt_migration_routes',array());$routeRows=array();foreach($record['routes']as$key=>$route)$routeRows[]=array('key'=>$key,'before'=>$route['before'],'applied'=>$route['applied'],'current'=>$routes[$key]??null,'changedSinceApply'=>($routes[$key]??null)!==$route['applied']);
    $assets=array();foreach($record['assets']as$asset){$file=get_attached_file($asset['attachmentId']);$actual=is_string($file)&&is_file($file)?hash_file('sha256',$file):null;$assets[]=$asset+array('currentFileSha256'=>$actual,'fileMatches'=>$actual===$asset['sha256']);}
    $uploads=array();foreach($record['uploads']??array()as$upload){$descriptor=$upload['descriptor'];$path=csktm_upload_path($id,csktm_upload_key($descriptor));$uploads[]=array('itemId'=>$descriptor['itemId'],'operationId'=>$descriptor['operationId'],'sha256'=>$descriptor['sha256'],'bytes'=>$descriptor['bytes'],'status'=>$upload['status'],'retainedBytes'=>$upload['status']==='COMPLETE'?$descriptor['bytes']:(is_file($path)?filesize($path):0),'startedAt'=>$upload['startedAt']);}
    return array('schema'=>'cskt.wordpress.readback.v1','releaseId'=>$id,'sha256'=>$record['sha256'],'status'=>$record['status'],'destination'=>untrailingslashit(home_url('/')),'createdAt'=>$record['createdAt'],'appliedAt'=>$record['appliedAt']??null,'planSha256'=>$record['latestPlanSha256']??null,'appliedPlanSha256'=>$record['appliedPlanSha256']??null,'summary'=>$record['summary']??null,'items'=>$rows,'routes'=>$routeRows,'assets'=>$assets,'uploads'=>$uploads,'operations'=>array_values($record['operations']),'manifestBase64'=>$record['manifestBase64']);
}
function csktm_rollback($id,$input){
    if(!is_array($input)||!csktm_id($input['operationId']??null))csktm_fail('operation_id_required','Retain one stable rollback operation ID.');
    return csktm_transaction(function()use($id,$input){
        $record=csktm_load($id);$request=array('releaseId'=>$id);$old=csktm_operation($record,$input['operationId'],'rollback',$request);if($old)return $old['result']+array('recovered'=>true);
        if(!in_array($record['status'],array('APPLIED','ROLLED_BACK','PARTIALLY_ROLLED_BACK'),true))csktm_fail('release_not_applied','This release has no applied native content to roll back.',409);
        $conflicts=array();$restored=array();$routes=get_option('cskt_migration_routes',array());$bindings=get_option('cskt_migration_bindings',array());
        $blocked=array();
        foreach($record['items']as$key=>$item){if($item['status']==='ROLLED_BACK')continue;if($item['postId']){csktm_lock_post($item['postId']);$current=csktm_fingerprint($item['postId']);if($current!==$item['appliedSha256']){$blocked[$key]=true;$conflicts[]=array('itemId'=>$key,'postId'=>$item['postId'],'code'=>'NATIVE_POST_CHANGED','message'=>'The native post has changed since this release. Its current content and metadata were retained.','appliedSha256'=>$item['appliedSha256'],'currentSha256'=>$current);}}}
        foreach(array('routes','bindings')as$kind){$map=$kind==='routes'?$routes:$bindings;foreach($record[$kind]as$key=>$entry){$itemId=$entry['applied']['itemId']??null;if(!$itemId||($map[$key]??null)===$entry['applied']||($map[$key]??null)===$entry['before'])continue;$blocked[$itemId]=true;$conflicts[]=array('itemId'=>$itemId,'code'=>strtoupper($kind).'_CHANGED','key'=>$key,'message'=>'A later destination edit changed this mapping. Its current value and related native content were retained.');}}
        // Retain the parent of a changed child so rollback does not alter that
        // child's native hierarchy or permalink while preserving its edit.
        do{$changed=false;foreach($record['manifest']['items']as$item){$parent=$item['parentId']??'';if(isset($blocked[$item['id']])&&$parent&&isset($record['items'][$parent])&&!isset($blocked[$parent])){$blocked[$parent]=true;$changed=true;$conflicts[]=array('itemId'=>$parent,'code'=>'NATIVE_CHILD_RETAINED','childItemId'=>$item['id'],'message'=>'The parent was retained with its changed child to preserve the native hierarchy.');}}}while($changed);
        foreach(array_reverse(array_keys($record['items']))as$key){$item=$record['items'][$key];if(isset($blocked[$key]))continue;if($item['status']==='ROLLED_BACK'){$restored[$key]=true;continue;}if(!$item['postId']){$record['items'][$key]['status']='ROLLED_BACK';$restored[$key]=true;continue;}

            if($item['before'])csktm_restore($item['before']);elseif($item['kind']!=='media'){$r=wp_update_post(array('ID'=>$item['postId'],'post_status'=>'draft'),true);if(is_wp_error($r))csktm_fail('native_rollback_failed',$r->get_error_message(),500);}
            $record['items'][$key]['status']='ROLLED_BACK';$record['items'][$key]['rolledBackSha256']=csktm_fingerprint($item['postId']);$record['items'][$key]['rolledBackAt']=csktm_now();$restored[$key]=true;
        }
        foreach(array('routes','bindings')as$kind){$map=$kind==='routes'?$routes:$bindings;foreach($record[$kind]as$key=>$entry){$itemId=$entry['applied']['itemId']??null;if(!$itemId||!isset($restored[$itemId]))continue;if(($map[$key]??null)===$entry['before'])continue;if(($map[$key]??null)!==$entry['applied']){$conflicts[]=array('itemId'=>$itemId,'code'=>strtoupper($kind).'_CHANGED','key'=>$key,'message'=>'A later destination edit changed this mapping. Its current value was retained.');continue;}if($entry['before']===null)unset($map[$key]);else$map[$key]=$entry['before'];}if($kind==='routes')$routes=$map;else$bindings=$map;}
        update_option('cskt_migration_routes',$routes,false);update_option('cskt_migration_bindings',$bindings,false);$record['status']=$conflicts?'PARTIALLY_ROLLED_BACK':'ROLLED_BACK';$record['rolledBackAt']=csktm_now();
        $result=array('schema'=>'cskt.wordpress.rollback.v1','releaseId'=>$id,'status'=>$record['status'],'operationId'=>$input['operationId'],'restoredItemIds'=>array_keys($restored),'conflicts'=>$conflicts,'retainedAssets'=>array_values($record['assets']),'message'=>'Matching content, metadata and reviewed mappings restored. Original downloaded file bytes remain available in the native Media Library.');csktm_record_operation($record,$input['operationId'],'rollback',$request,$result);$list=get_option('cskt_migration_releases',array());$list[$id]['status']=$record['status'];update_option('cskt_migration_releases',$list,false);return $result;
    });
}
