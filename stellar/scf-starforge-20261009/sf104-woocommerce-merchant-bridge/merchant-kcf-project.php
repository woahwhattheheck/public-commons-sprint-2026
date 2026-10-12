<?php
/** MIT. Complete private connector recovery, with the original ERP project importer. */
if (!defined('ABSPATH')) { exit; }
require_once __DIR__ . '/merchant-kcf-mapping.php';

final class Starforge_SF104_KCF_Project {
    static $exporting = false;
    static $importing = false;
    static function export($iid, $includeOrders = true) {
        return Starforge_SF104_KCF_Store::transaction(static function () use ($iid,$includeOrders) { return self::snapshot_export($iid,$includeOrders); });
    }
    static function snapshot_export($iid, $includeOrders = true) {
        $s = Starforge_SF104_KCF_Source::class; $store = Starforge_SF104_KCF_Store::class;
        $installation = $store::typed($iid, $iid, 'installation'); $objects = []; $blobs = []; $mapIds = [];
        foreach (['installation','receipt','edition','recipe','review','map-link','import-receipt'] as $kind) {
            foreach ($store::all($iid, $kind) as $summary) {
                $row = $store::object($summary['id'], $iid);
                $objects[] = ['record'=>$row,'sha256'=>$s::digest($row)];
                if ($kind === 'receipt') $blobs[$row['blobId']] = true;
                if ($kind === 'recipe') $mapIds[$row['baseMapId']] = true;
                if ($kind === 'map-link') { $mapIds[$row['baseMapId']] = true; $mapIds[$row['mapId']] = true; }
            }
        }
        foreach (array_keys($blobs) as $id) { $blob = $store::typed($id, null, 'blob'); $store::blob_bytes($blob); $objects[] = ['record'=>$blob,'sha256'=>$s::digest($blob)]; }
        $maps = [];
        foreach (array_keys($mapIds) as $id) {
            $map = Starforge_SF104_ERP_Store::map($id); $s::need($map !== null, 'An original mapping needed by this project is missing.', 503); $maps[] = $map;
        }
        global $wpdb; $ops = $wpdb->get_results($wpdb->prepare('SELECT operation_key,request_sha256,data,created_at FROM ' . $store::table('operations') . ' WHERE installation_id=%s ORDER BY created_at,operation_key', $iid), ARRAY_A); $store::ok();
        $history = []; foreach ($ops as $op) $history[] = ['key'=>$op['operation_key'],'requestSha256'=>$op['request_sha256'],'record'=>Starforge_SF104_ERP_Store::decode($op['data']),'createdAt'=>$op['created_at']];
        $projects = []; $related = [];
        if ($mapIds) {
            $offset = 0; $oldFlag = self::$exporting; self::$exporting = true;
            try {
                do {
                    $batch = $wpdb->get_results($wpdb->prepare('SELECT operation_id,data FROM ' . Starforge_SF104_ERP_Store::table('orders') . ' ORDER BY operation_id LIMIT %d OFFSET %d', 100, $offset), ARRAY_A); $store::ok(); $offset += count($batch);
                    foreach ($batch as $r) {
                        $record = Starforge_SF104_ERP_Store::decode($r['data']); $matched = [];
                        foreach ($record['editions'] ?? [] as $e) if (isset($mapIds[$e['mapId'] ?? ''])) $matched[] = $e['id'];
                        if (!$matched) continue;
                        $related[] = ['operationId'=>$r['operation_id'],'orderId'=>$record['orderId'],'editionIds'=>$matched];
                        if ($includeOrders) {
                            $request = new WP_REST_Request('GET'); $request->set_param('id', $r['operation_id']);
                            $projects[] = Starforge_SF104_ERP::export_project($request);
                        }
                    }
                } while (count($batch) === 100);
            } finally { self::$exporting = $oldFlag; }
        }
        $package = ['schema'=>$store::PACKAGE_SCHEMA,'version'=>Starforge_SF104_KCF::VERSION,'exportedAt'=>gmdate('c'),
            'installationId'=>$iid,'installation'=>$installation,'head'=>$store::head($iid),'objects'=>$objects,'mappings'=>$maps,'operationHistory'=>$history,
            'includesOrders'=>$includeOrders,'relatedOrders'=>$related,'erpProjects'=>$projects,
            'reopen'=>'Import this complete private file into the original WordPress merchant plugin. Immutable source records are merged without overwriting a newer local selection. Imported ERP orders use the original bind-import and reconciliation workflow. Environment references retain their names. Original files may contain sensitive configuration; configure live credentials separately.'];
        $package['sha256'] = $s::digest($package);
        $s::need(strlen($s::json($package)) <= $store::MAX_PACKAGE - 4096, 'The complete selection exceeds the 32 MiB project limit. Export the connector workspace without orders, and retain each listed order through the original ERP export action. No source or order has been omitted from this request.', 413);
        return $package;
    }
    static function companion($mapIds) {
        if (self::$exporting) return [];
        $iids = [];
        foreach ($mapIds as $mapId) foreach (Starforge_SF104_KCF_Store::linked($mapId) as $link) $iids[$link['installationId']] = true;
        $out = [];
        foreach (array_keys($iids) as $iid) $out[] = self::export($iid, false);
        return $out;
    }
    static function validate($package) {
        $s = Starforge_SF104_KCF_Source::class; $store = Starforge_SF104_KCF_Store::class;
        $s::keys($package, ['schema','version','exportedAt','installationId','installation','head','objects','mappings','operationHistory','includesOrders','relatedOrders','erpProjects','reopen','sha256'], 'The complete connector project');
        $s::need(($package['schema'] ?? '') === $store::PACKAGE_SCHEMA, 'Select a complete connector workspace export.');
        $sha = $s::id($package['sha256'] ?? '', 'project SHA-256'); $copy = $package; unset($copy['sha256']);
        $s::need(hash_equals($sha, $s::digest($copy)), 'The complete connector project does not match its recorded SHA-256.');
        $s::need(strlen($s::json($package)) <= $store::MAX_PACKAGE, 'The connector project exceeds the 32 MiB import limit.', 413);
        $iid = $s::id($package['installationId'] ?? '');
        $identity = $s::identity($package['installation']['identity'] ?? []);
        $s::need($iid === $s::digest(['schema'=>'stellar-forge.sf104.connector-installation.v1','identity'=>$identity]), 'The installation tuple differs from its retained identity.');
        $objects = []; $maps = [];
        $s::need(is_array($package['objects'] ?? null) && Starforge_SF104_KCF_Source::is_list($package['objects']) && count($package['objects']) <= 20000, 'The project object inventory is invalid.');
        foreach ($package['objects'] as $item) {
            $s::keys($item, ['record','sha256'], 'The source object descriptor'); $r = $item['record'] ?? []; $id = $s::id($r['id'] ?? '');
            $s::need(!isset($objects[$id]) && hash_equals($s::id($item['sha256'] ?? ''), $s::digest($r)), 'A source record is duplicated or differs from its complete digest.');
            $s::need(in_array($r['kind'] ?? '', ['installation','receipt','edition','recipe','review','map-link','blob','import-receipt'], true), 'The project contains an unsupported source record.');
            if ($r['kind'] === 'blob') { $store::blob_bytes($r); $s::need($id === $s::digest(['blobSha256'=>$r['sha256']]), 'An original file has a different content identity.'); }
            elseif ($r['kind'] === 'installation') $s::need($id === $iid && $s::digest($r) === $s::digest($package['installation']), 'The project installation record is inconsistent.');
            else $s::need(($r['installationId'] ?? '') === $iid, 'A project source belongs to another installation.');
            $objects[$id] = $r;
        }
        $s::need(isset($objects[$iid]), 'The complete installation record is missing.');
        $s::need(is_array($package['mappings'] ?? null) && Starforge_SF104_KCF_Source::is_list($package['mappings']) && count($package['mappings']) <= 10000, 'The original mapping inventory is invalid.');
        foreach ($package['mappings'] as $m) {
            $compiled = Starforge_SF104_ERP_Map::compile($m['mapping'] ?? []); $id = $s::id($m['id'] ?? '');
            $s::need($id === $s::digest($compiled) && !isset($maps[$id]), 'An original mapping is duplicated or differs from its approved digest.'); $maps[$id] = $m;
        }
        foreach ($objects as $r) {
            if ($r['kind'] === 'receipt') {
                $s::need(isset($objects[$r['blobId']]) && $objects[$r['blobId']]['kind'] === 'blob', 'A complete original file is missing from this package.');
                $blob = $objects[$r['blobId']]; $s::need($r['sha256'] === $blob['sha256'] && $r['bytes'] === $blob['bytes'], 'A source receipt names different original bytes.');
                $s::scope($r['scope']); $s::profile($r['profile']); $s::text($r['slot'],160,'source slot');
                if ($r['status'] === 'READY') {
                    $tree = $s::parse($store::blob_bytes($blob), $r['format'], $r['delimiter']);
                    $rows = $s::projection($tree, $r['profile']); $s::need(count($rows) === $r['rowCount'], 'The retained source projection count differs from the original file.');
                } else $s::need($r['status'] === 'INVALID', 'The retained source inspection state is invalid.');
            } elseif ($r['kind'] === 'edition') {
                $s::metadata($r['metadata']); $slots = [];
                $s::need(is_array($r['receiptIds'] ?? null) && Starforge_SF104_KCF_Source::is_list($r['receiptIds']) && count($r['receiptIds']) > 0 && count($r['receiptIds']) <= 100, 'The source edition requires its complete receipt selections.');
                foreach ($r['receiptIds'] as $rid) {
                    $rr = $objects[$rid] ?? null; $s::need($rr && $rr['kind'] === 'receipt', 'An edition references a missing source receipt.');
                    $s::need(!isset($slots[$rr['slot']]), 'A source edition repeats a logical slot.'); $slots[$rr['slot']] = true;
                }
                if ($r['parentEditionId']) $s::need(isset($objects[$r['parentEditionId']]) && $objects[$r['parentEditionId']]['kind'] === 'edition', 'A prior source edition is missing from this complete project.');
            } elseif ($r['kind'] === 'recipe') {
                $s::need(isset($objects[$r['sourceEditionId']]) && $objects[$r['sourceEditionId']]['kind'] === 'edition' && isset($maps[$r['baseMapId']]), 'A recipe is missing its source edition or original base map.');
                Starforge_SF104_KCF_Mapping::validate_recipe($r);
            } elseif ($r['kind'] === 'map-link') {
                $s::need(isset($objects[$r['recipeId']]) && $objects[$r['recipeId']]['kind'] === 'recipe' &&
                    isset($objects[$r['sourceEditionId']], $maps[$r['mapId']], $maps[$r['baseMapId']]), 'A delivered mapping is missing its full source lineage.');
                $recipe = $objects[$r['recipeId']];
                $s::need($r['sourceEditionId'] === $recipe['sourceEditionId'] && $r['baseMapId'] === $recipe['baseMapId'], 'The applied mapping names a different source recipe or base map.');
            } elseif ($r['kind'] === 'review') {
                foreach (['beforeId','afterId'] as $k) $s::need(isset($objects[$r[$k]]) && $objects[$r[$k]]['kind'] === 'edition', 'A source review is missing its exact compared edition.');
                if (($r['recipeId'] ?? '') !== '') $s::need(isset($objects[$r['recipeId']]) && $objects[$r['recipeId']]['kind'] === 'recipe' && $objects[$r['recipeId']]['sourceEditionId'] === $r['afterId'], 'The source review is missing its selected mapping recipe.');
                $s::need(in_array($r['disposition'] ?? '', ['RETAIN_MAPPING','REVISE_MAPPING','RECAPTURE_SCOPE'], true), 'The source review disposition is invalid.');
            }
        }
        $head = $package['head'] ?? [];
        $s::keys($head, ['revision','currentEditionId','currentRecipeId','updatedAt','lastOperationId'], 'The retained source selection');
        $s::id($head['currentEditionId'] ?? null, 'selected source edition', true); $s::id($head['currentRecipeId'] ?? null, 'selected source recipe', true);
        $s::need(is_int($head['revision'] ?? null) && $head['revision'] >= 0, 'The retained installation revision is invalid.');
        foreach (['currentEditionId'=>'edition','currentRecipeId'=>'recipe'] as $k=>$kind) if (($head[$k] ?? '') !== '') $s::need(isset($objects[$head[$k]]) && $objects[$head[$k]]['kind'] === $kind, 'The retained current selection is absent from this complete project.');
        $s::need(is_array($package['operationHistory'] ?? null) && Starforge_SF104_KCF_Source::is_list($package['operationHistory']) && is_array($package['relatedOrders'] ?? null) && Starforge_SF104_KCF_Source::is_list($package['relatedOrders']) && is_array($package['erpProjects'] ?? null) && Starforge_SF104_KCF_Source::is_list($package['erpProjects']) && is_bool($package['includesOrders'] ?? null), 'The complete private history is invalid.');
        $native = [];
        foreach ($package['erpProjects'] as $p) { $v = Starforge_SF104_ERP::validate_project($p); $id = $v['record']['operationId']; $s::need(!isset($native[$id]), 'An ERP order project is duplicated.'); $native[$id] = $v; }
        $related = [];
        foreach ($package['relatedOrders'] as $r) {
            $id = $s::id($r['operationId'] ?? '', 'related original order');
            $s::need(!isset($related[$id]) && is_array($r['editionIds'] ?? null) && Starforge_SF104_KCF_Source::is_list($r['editionIds']) && count($r['editionIds']) > 0, 'A related original order or its edition selection is incomplete.'); $related[$id] = true;
            if ($package['includesOrders']) {
                $s::need(isset($native[$id]) && $native[$id]['record']['orderId'] === $r['orderId'], 'A listed original order is absent from this full private export.');
                $editions = []; foreach ($native[$id]['record']['editions'] as $edition) $editions[$edition['id']] = $edition;
                foreach ($r['editionIds'] as $eid) $s::need(isset($editions[$eid], $maps[$editions[$eid]['mapId']]), 'A related order edition does not use a retained source mapping.');
            }
        }
        if ($package['includesOrders']) $s::need(count($native) === count($related), 'The package contains an unlisted original order import.');
        else $s::need(!$native, 'A source-only project cannot silently contain order imports.');
        return ['installationId'=>$iid,'objects'=>$objects,'mappings'=>$maps,'native'=>$native,'sha256'=>$sha];
    }
    static function import($body) {
        $s = Starforge_SF104_KCF_Source::class; $store = Starforge_SF104_KCF_Store::class;
        $s::keys($body, ['operationId','project'], 'The private project import'); $s::operation($body['operationId'] ?? null);
        $package = $body['project'] ?? []; $valid = self::validate($package); $iid = $valid['installationId'];
        $request = ['operationId'=>$body['operationId'],'packageSha256'=>$valid['sha256']]; $route = 'import';
        return $store::lock($iid, static function () use ($body,$package,$valid,$iid,$request,$route,$s,$store) {
            $prior = $store::op($iid,$request['operationId']); $hash = $s::digest(['route'=>$route,'body'=>$request]);
            if ($prior) {
                $s::need(hash_equals($prior['requestSha256'],$hash), 'This import operation ID names a different private package.',409);
                if (($prior['data']['state'] ?? '') === 'DONE') return $prior['data']['result'] + ['replayed'=>true];
            }
            // Full source/map preflight precedes any write; existing immutable content may only agree.
            foreach ($valid['objects'] as $id=>$r) {
                $old = $store::object($id,null,false);
                $s::need(!$old || $s::digest($old) === $s::digest($r), 'This installation already retains a different source record with the same identity.',409);
            }
            foreach ($valid['native'] as $id=>$v) {
                $existing = Starforge_SF104_ERP_Store::order($id);
                $sameImport = false; foreach (($existing['imports'] ?? []) as $oldImport) if (($oldImport['sha256'] ?? '') === $v['sha256']) $sameImport = true;
                $s::need(!$existing || $sameImport, 'An original ERP order already exists here with different retained work. Preserve it and receive this full package into a separate store.',409);
            }
            if (!$prior) $store::put_op($iid,$request,$route,['state'=>'PENDING','operationId'=>$request['operationId'],'packageSha256'=>$valid['sha256'],'startedAt'=>gmdate('c')]);
            $sourceResult = $store::transaction(static function () use ($package,$valid,$iid,$s,$store) {
                global $wpdb; $hadInstallation = $store::object($iid,$iid,false) !== null;
                foreach ($valid['objects'] as $id=>$r) $store::put($id,$r['kind'] === 'blob' ? '' : $iid,$r['kind'],$r);
                Starforge_SF104_ERP_Store::retain_maps(array_values($valid['mappings']));
                if (!$hadInstallation) {
                    if ($wpdb->insert($store::table('heads'),['installation_id'=>$iid,'revision'=>$package['head']['revision'],'data'=>$s::json($package['head'])]) !== 1) throw new RuntimeException('The recovered source selection could not be retained.',503);
                }
                $receiptId = $s::digest([$iid,'import-receipt',$valid['sha256']]);
                $receipt = $store::object($receiptId,$iid,false);
                if (!$receipt) {
                    $receipt = ['id'=>$receiptId,'kind'=>'import-receipt','installationId'=>$iid,'packageSha256'=>$valid['sha256'],'exportedAt'=>$package['exportedAt'],
                        'importedAt'=>gmdate('c'),'actor'=>get_current_user_id(),'importedHead'=>$package['head'],'operationHistory'=>$package['operationHistory'],
                        'includesOrders'=>$package['includesOrders'],'relatedOrders'=>$package['relatedOrders']];
                    $store::put($receiptId,$iid,'import-receipt',$receipt);
                }
                return ['receiptId'=>$receiptId,'head'=>$store::head($iid),'keptExistingSelection'=>$hadInstallation];
            });
            $orders = []; $flag = self::$importing; self::$importing = true;
            try {
                foreach ($package['erpProjects'] as $p) {
                    $r = new WP_REST_Request('POST'); $r->set_header('Content-Type','application/json'); $r->set_body($s::json(['project'=>$p]));
                    $result = Starforge_SF104_ERP::import_project($r);
                    $orders[] = ['operationId'=>$p['operation']['operationId'],'result'=>$result];
                }
            } finally { self::$importing = $flag; }
            $result = ['installationId'=>$iid,'projectSha256'=>$valid['sha256'],'source'=>$sourceResult,'orders'=>$orders,
                'currentMapId'=>get_option('sf104_erp_current_map',''),'mappingSelectionChanged'=>false,
                'next'=>'Open the retained source edition. Imported ERP orders require the original bind-import and target reconciliation before another delivery.'];
            $store::put_op($iid,$request,$route,['state'=>'DONE','operationId'=>$request['operationId'],'completedAt'=>gmdate('c'),'result'=>$result],true);
            return $result + ['replayed'=>$prior !== null];
        });
    }
    static function import_companions($project) {
        if (self::$importing) return;
        $sources = $project['connectorSources'] ?? [];
        Starforge_SF104_KCF_Source::need(is_array($sources) && count($sources) <= 20,'The ERP connector source inventory is invalid.');
        foreach ($sources as $p) self::validate($p);
        foreach ($sources as $p) self::import(['operationId'=>'erp-source-import-' . $p['sha256'],'project'=>$p]);
    }
}
