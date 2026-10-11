<?php
if (!defined('ABSPATH')) { exit; }
function csktm_upload_key($header){return hash('sha256',$header['itemId'].'|'.$header['operationId']);}
function csktm_upload_path($releaseId,$key){$base=defined('CSKT_MIGRATION_PRIVATE_DIR')?CSKT_MIGRATION_PRIVATE_DIR:rtrim(sys_get_temp_dir(),'/').'/cskt-migration-'.substr(hash('sha256',home_url('/')),0,20);if(!is_string($base)||!str_starts_with($base,'/'))csktm_fail('private_directory','Configure an absolute private migration staging directory.',500);if(!is_dir($base)&&!wp_mkdir_p($base))csktm_fail('private_directory','The runtime could not create its private upload staging directory.',500);@chmod($base,0700);return rtrim($base,'/').'/'.hash('sha256',$releaseId.'|'.$key).'.part';}
function csktm_upload_state($id,$header){$record=csktm_load($id);$d=csktm_asset_descriptor($record,$header);$key=csktm_upload_key($header);$entry=$record['uploads'][$key]??null;if(!$entry||$entry['descriptor']!==$d)csktm_fail('upload_not_started','Begin the exact retained asset upload before sending its chunks.',409);return array($record,$d,$key,csktm_upload_path($id,$key));}
function csktm_upload_begin($id,$header){
    return csktm_transaction(function()use($id,$header){$record=csktm_load($id);$d=csktm_asset_descriptor($record,$header);$asset=$record['assets'][$d['itemId']]??null;if($asset){if($asset['sha256']!==$d['sha256']||$asset['bytes']!==$d['bytes'])csktm_fail('asset_identity_conflict','The source item already retained different asset bytes.',409);return array('complete'=>true,'asset'=>$asset);}
        $key=csktm_upload_key($header);$entry=$record['uploads'][$key]??null;if($entry&&$entry['descriptor']!==$d)csktm_fail('upload_identity_conflict','This stable operation already identifies different source file bytes.',409);
        $path=csktm_upload_path($id,$key);if(!$entry){$record['uploads'][$key]=array('descriptor'=>$d,'startedAt'=>csktm_now(),'status'=>'RECEIVING');csktm_save($record);}
        clearstatcache(true,$path);$offset=is_file($path)?filesize($path):0;if($offset>$d['bytes'])csktm_fail('upload_size_conflict','The retained upload is larger than its declared source file.',409);return array('complete'=>false,'offset'=>$offset,'prefixSha256'=>$offset?hash_file('sha256',$path):hash('sha256',''),'chunkBytes'=>CSKTM_CHUNK_BYTES,'sha256'=>$d['sha256']);
    });
}
function csktm_upload_chunk($id,$header,$bytes){
    if(!is_array($header)||!is_int($header['offset']??null)||$header['offset']<0||!csktm_sha($header['chunkSha256']??null)||strlen($bytes)<1||strlen($bytes)>CSKTM_CHUNK_BYTES||!hash_equals($header['chunkSha256'],hash('sha256',$bytes)))csktm_fail('invalid_upload_chunk','Retain the exact chunk offset, bytes and SHA-256, up to 2 MiB.');
    list($record,$d,$key,$path)=csktm_upload_state($id,$header);if($header['offset']+strlen($bytes)>$d['bytes'])csktm_fail('upload_size_conflict','This chunk exceeds the original file length.');
    $handle=fopen($path,'c+b');if(!$handle)csktm_fail('upload_write_failed','The runtime could not open the retained upload.',500);@chmod($path,0600);
    try{
        if(!flock($handle,LOCK_EX))csktm_fail('upload_busy','The retained file upload is already being written.',409);$stat=fstat($handle);$size=$stat['size'];
        if($header['offset']<$size){if($header['offset']+strlen($bytes)>$size)csktm_fail('upload_offset_conflict','The retained upload ends inside this retry chunk. Reopen its upload state.',409);fseek($handle,$header['offset']);$old='';while(strlen($old)<strlen($bytes)){$part=fread($handle,strlen($bytes)-strlen($old));if($part===false||$part==='')break;$old.=$part;}if(!hash_equals(hash('sha256',$bytes),hash('sha256',$old)))csktm_fail('upload_chunk_conflict','Different bytes already occupy this original chunk offset.',409);return array('offset'=>$header['offset']+strlen($bytes),'retainedOffset'=>$size,'recovered'=>true);}
        if($header['offset']!==$size)csktm_fail('upload_offset_conflict','Continue from the actual retained file offset.',409,array('offset'=>$size));fseek($handle,$size);$at=0;while($at<strlen($bytes)){$n=fwrite($handle,substr($bytes,$at));if(!$n)csktm_fail('upload_write_failed','The runtime could not retain the entire original chunk.',500);$at+=$n;}if(!fflush($handle))csktm_fail('upload_write_failed','The runtime could not flush the retained chunk.',500);if(function_exists('fsync'))@fsync($handle);return array('offset'=>$size+strlen($bytes),'recovered'=>false);
    }finally{flock($handle,LOCK_UN);fclose($handle);}
}
function csktm_upload_commit($id,$header){
    list($record,$d,$key,$path)=csktm_upload_state($id,$header);$asset=$record['assets'][$d['itemId']]??null;if($asset)return $asset;
    $handle=fopen($path,'rb');if(!$handle)csktm_fail('upload_missing','Reopen the original asset upload and send its missing chunks.',409);
    try{if(!flock($handle,LOCK_EX))csktm_fail('upload_busy','The retained upload is still being written.',409);clearstatcache(true,$path);if(filesize($path)!==$d['bytes']||!hash_equals($d['sha256'],hash_file('sha256',$path)))csktm_fail('upload_incomplete','The complete retained upload does not match the source byte count and SHA-256.',409);$asset=csktm_asset_file($id,$header,$path);}finally{flock($handle,LOCK_UN);fclose($handle);}
    csktm_transaction(function()use($id,$key){$record=csktm_load($id);$record['uploads'][$key]['status']='COMPLETE';$record['uploads'][$key]['completedAt']=csktm_now();csktm_save($record);});@unlink($path);return $asset;
}
