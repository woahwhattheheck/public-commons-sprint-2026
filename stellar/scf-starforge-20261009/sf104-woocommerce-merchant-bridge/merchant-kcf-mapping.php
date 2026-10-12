<?php
/** MIT. Explicit source rules compile into the existing ERP map, never a new delivery engine. */
if (!defined('ABSPATH')) { exit; }
require_once __DIR__ . '/merchant-kcf-store.php';

final class Starforge_SF104_KCF_Mapping {
    const HEADERS = ['/name','/reviewOwner','/currency','/currencyDecimals','/unitPriceDecimals','/addressMode','/target/baseUrl','/target/endpoint','/target/version','/target/orderType','/target/branch','/target/taxZone','/target/hold','/target/contractReference','/target/tokenEnv'];
    const TABLES = ['customerBindings','productBindings','feeBindings','shippingBinding'];
    static function fields($table) { return $table === 'customerBindings' ? ['customerId','locationId'] : ['inventoryId','uom','taxCategory','warehouseId']; }
    static function rule($r) {
        $s = Starforge_SF104_KCF_Source::class;
        $s::keys($r, ['constant','receiptId','pointer','conversion','values','allowInactive','inactiveReason'], 'The source value rule');
        if (array_key_exists('constant', $r)) { $s::need(!isset($r['receiptId']) && !isset($r['pointer']), 'Select a source field or a reviewed constant.'); $s::validate_scalar($r['constant']); }
        else { $s::id($r['receiptId'] ?? '', 'receipt reference'); $s::pointer($r['pointer'] ?? ''); }
        $s::need(!isset($r['allowInactive']) || is_bool($r['allowInactive']), 'The inactive-source selection must be explicit.');
        if (($r['allowInactive'] ?? false) === true) $s::text($r['inactiveReason'] ?? '', 2000, 'reason for using an inactive source row');
    }
    static function target($t) {
        $s = Starforge_SF104_KCF_Source::class; $s::keys($t, ['path','table','sourceKey','field'], 'The mapping destination');
        if (isset($t['path'])) { $s::need(count($t) === 1 && in_array($t['path'], self::HEADERS, true), 'Select a supported ERP mapping field.'); return $t; }
        $s::need(in_array($t['table'] ?? '', self::TABLES, true), 'Select a supported original binding table.');
        $s::need(in_array($t['field'] ?? '', self::fields($t['table']), true), 'Select a supported binding field.');
        $s::text($t['sourceKey'] ?? '', 254, 'exact Woo product, customer, SKU or fee key', $t['table'] === 'shippingBinding');
        $s::need($t['table'] !== 'shippingBinding' || $t['sourceKey'] === '', 'Shipping has one original binding, without a source key.');
        return $t;
    }
    static function validate_recipe($r) {
        $s = Starforge_SF104_KCF_Source::class;
        $s::need(is_array($r['assignments']) && Starforge_SF104_KCF_Source::is_list($r['assignments']) && count($r['assignments']) <= 10000, 'Select at most 10,000 explicit field assignments.');
        $s::need(is_array($r['removals']) && Starforge_SF104_KCF_Source::is_list($r['removals']) && count($r['removals']) <= 5000, 'Select at most 5,000 explicit binding removals.');
        $seen = [];
        foreach ($r['assignments'] as $a) {
            $s::keys($a, ['target','rule'], 'The field assignment'); self::target($a['target'] ?? []); self::rule($a['rule'] ?? []);
            $key = $s::digest($a['target']); $s::need(!isset($seen[$key]), 'An ERP destination is assigned twice.'); $seen[$key] = true;
        }
        $removed = [];
        foreach ($r['removals'] as $x) {
            $s::keys($x, ['table','sourceKey','reason'], 'The deliberate removal'); $s::need(in_array($x['table'] ?? '', self::TABLES, true), 'Select an original binding table for removal.');
            $s::text($x['sourceKey'] ?? '', 254, 'exact key to remove', $x['table'] === 'shippingBinding'); $s::text($x['reason'] ?? '', 2000, 'reason to remove this binding');
            $key = $s::digest([$x['table'],$x['sourceKey']]); $s::need(!isset($removed[$key]), 'A binding is removed twice.'); $removed[$key] = true;
        }
        foreach ($r['assignments'] as $a) if (isset($a['target']['table'])) $s::need(!isset($removed[$s::digest([$a['target']['table'],$a['target']['sourceKey']])]), 'Do not remove and reassign the same binding in one recipe.');
        if ($r['substitutions'] !== null) {
            $sub = $r['substitutions']; $s::keys($sub, ['unmappedCountries','unmappedStates','countries','states'], 'The address substitutions');
            foreach (['unmappedCountries','unmappedStates'] as $k) $s::need(in_array($sub[$k] ?? '', ['preserve','error'], true), 'Select explicit behavior for unmatched address values.');
            foreach (['countries'=>['connectorCountry','acumaticaCountry'],'states'=>['connectorCountry','acumaticaCountry','connectorState','acumaticaState']] as $key=>$fields) {
                $s::need(is_array($sub[$key] ?? null) && Starforge_SF104_KCF_Source::is_list($sub[$key]) && count($sub[$key]) <= 5000, 'Select at most 5,000 ' . $key . ' substitution rows.');
                foreach ($sub[$key] as $row) { $s::keys($row, $fields, 'The address substitution row'); foreach ($fields as $field) self::rule($row[$field] ?? []); }
            }
        }
    }
    static function resolve($iid, $edition, $rule, &$cache) {
        $s = Starforge_SF104_KCF_Source::class; self::rule($rule); $source = null;
        if (array_key_exists('constant', $rule)) $node = $rule['constant'];
        else {
            $id = $rule['receiptId']; $s::need(in_array($id, $edition['receiptIds'], true), 'The mapping references a receipt outside its frozen source edition.');
            if (!isset($cache[$id])) {
                $receipt = Starforge_SF104_KCF_Store::typed($id, $iid, 'receipt');
                $s::need($receipt['status'] === 'READY', 'Correct the retained invalid source before using it in a mapping: ' . $receipt['name']);
                $tree = Starforge_SF104_KCF_Store::tree($receipt);
                $cache[$id] = ['receipt'=>$receipt,'tree'=>$tree,'projection'=>$s::projection($tree, $receipt['profile'])];
            }
            $selected = $cache[$id]; $node = $s::at($selected['tree'], $rule['pointer']);
            $source = ['receiptId'=>$id,'sha256'=>$selected['receipt']['sha256'],'pointer'=>$rule['pointer'],'slot'=>$selected['receipt']['slot']];
            foreach ($selected['projection'] as $row) {
                if (($rule['pointer'] === $row['pointer'] || str_starts_with($rule['pointer'], $row['pointer'] . '/')) &&
                    ($row['fields']['active']['type'] ?? '') === 'boolean' && $row['fields']['active']['value'] === false) {
                    $s::need(($rule['allowInactive'] ?? false) === true, 'The selected source row is explicitly inactive. Select another row or record the deliberate inactive-source decision.');
                    $source['inactiveReason'] = $rule['inactiveReason'];
                }
            }
        }
        return ['value'=>$s::rule_value($node, $rule),'captured'=>$s::node_summary($node),'source'=>$source,'conversion'=>$rule['conversion'] ?? 'preserve'];
    }
    static function get_target($map, $t) {
        if (isset($t['path'])) { $v = $map; foreach (explode('/', substr($t['path'], 1)) as $p) { if (!is_array($v) || !array_key_exists($p, $v)) return ['present'=>false]; $v = $v[$p]; } return ['present'=>true,'value'=>$v]; }
        if ($t['table'] === 'shippingBinding') return array_key_exists($t['field'], $map['shippingBinding'] ?? []) ? ['present'=>true,'value'=>$map['shippingBinding'][$t['field']]] : ['present'=>false];
        foreach ($map[$t['table']] as $r) if ($r['sourceKey'] === $t['sourceKey']) return array_key_exists($t['field'], $r) ? ['present'=>true,'value'=>$r[$t['field']]] : ['present'=>false];
        return ['present'=>false];
    }
    static function set_target(&$map, $t, $value) {
        if (isset($t['path'])) { $parts = explode('/', substr($t['path'], 1)); $ref =& $map; foreach ($parts as $p) $ref =& $ref[$p]; $ref = $value; unset($ref); return; }
        if ($t['table'] === 'shippingBinding') { if ($map['shippingBinding'] === null) $map['shippingBinding'] = array_fill_keys(self::fields($t['table']), ''); $map['shippingBinding'][$t['field']] = $value; return; }
        foreach ($map[$t['table']] as &$row) if ($row['sourceKey'] === $t['sourceKey']) { $row[$t['field']] = $value; unset($row); return; } unset($row);
        $row = array_fill_keys(self::fields($t['table']), ''); $row['sourceKey'] = $t['sourceKey']; $row[$t['field']] = $value; $map[$t['table']][] = $row;
    }
    static function preview($iid, $recipe) {
        $s = Starforge_SF104_KCF_Source::class; self::validate_recipe($recipe);
        $installation = Starforge_SF104_KCF_Store::typed($iid, $iid, 'installation');
        $edition = Starforge_SF104_KCF_Store::typed($recipe['sourceEditionId'], $iid, 'edition');
        $base = Starforge_SF104_ERP_Store::map($recipe['baseMapId']);
        $s::need($base !== null, 'The original ERP base map is missing. Import the complete private project first.');
        $map = $base['mapping']; $issues = []; $rows = []; $cache = []; $removals = [];
        foreach ($recipe['removals'] as $r) {
            $old = null;
            if ($r['table'] === 'shippingBinding') { $old = $map['shippingBinding']; $map['shippingBinding'] = null; }
            else {
                $keep = []; foreach ($map[$r['table']] as $row) { if ($row['sourceKey'] === $r['sourceKey']) $old = $row; else $keep[] = $row; } $map[$r['table']] = $keep;
            }
            if ($old === null) $issues[] = ['path'=>'removals','message'=>'The explicitly removed binding was not present: ' . $r['table'] . ' / ' . $r['sourceKey']];
            $removals[] = $r + ['before'=>$old];
        }
        foreach ($recipe['assignments'] as $i=>$a) {
            try { $value = self::resolve($iid, $edition, $a['rule'], $cache); $before = self::get_target($map, $a['target']); self::set_target($map, $a['target'], $value['value']); $rows[] = ['index'=>$i,'target'=>$a['target'],'before'=>$before,'after'=>['present'=>true,'value'=>$value['value']],'source'=>$value]; }
            catch (Throwable $e) { $issues[] = ['path'=>'assignments/' . $i,'message'=>$e->getMessage()]; }
        }
        if ($recipe['substitutions'] !== null) {
            try {
                $raw = $recipe['substitutions']; $compiled = ['sourceEditionId'=>$edition['id'],'unmappedCountries'=>$raw['unmappedCountries'],'unmappedStates'=>$raw['unmappedStates'],'countries'=>[],'states'=>[]];
                foreach (['countries','states'] as $table) foreach ($raw[$table] as $i=>$row) {
                    $values = [];
                    foreach ($row as $field=>$rule) {
                        $r = self::resolve($iid, $edition, $rule, $cache); $values[$field] = $r['value'];
                        $rows[] = ['index'=>'substitutions/' . $table . '/' . $i . '/' . $field,'target'=>['path'=>'/addressSubstitutions/' . $table . '/' . $i . '/' . $field],
                            'before'=>['present'=>false],'after'=>['present'=>true,'value'=>$r['value']],'source'=>$r];
                    }
                    $compiled[$table][] = $values;
                }
                $map['addressSubstitutions'] = $compiled;
            } catch (Throwable $e) { $issues[] = ['path'=>'substitutions','message'=>$e->getMessage()]; }
        }
        $final = null;
        try {
            $final = Starforge_SF104_ERP_Map::compile($map);
            $s::need($s::application_url($final['target']['baseUrl']) === $installation['identity']['applicationUrl'], 'This map targets a different Acumatica application path. Select the correct installation.');
            if ($recipe['substitutions'] !== null) $s::need($final['addressMode'] === 'order_override', 'New address substitutions apply to order_override only. Customer-default addresses remain under the ERP customer configuration.');
            $fallback = false;
            foreach ($final['productBindings'] as $r) if (str_starts_with($r['sourceKey'], 'sku:')) $fallback = true;
            foreach ($final['customerBindings'] as $r) if (str_starts_with($r['sourceKey'], 'email:')) $fallback = true;
            $s::need(!$fallback || $recipe['acknowledgeLookupPriority'], 'Review the existing lookup priority: customer ID before billing email, variation/product ID before SKU.');
            // The original compiler trims text. A source rule must make that transformation explicit.
            foreach ($rows as &$row) {
                if (isset($row['target']['table']) || isset($row['target']['path'])) {
                    $actual = self::get_target($final, $row['target']);
                    if (($row['source']['source'] ?? null) && ($row['source']['conversion'] ?? '') === 'preserve' &&
                        is_string($row['after']['value']) && $actual !== $row['after']) {
                        $issues[] = ['path'=>'assignments/' . $row['index'],'message'=>'The ERP compiler normalizes this selected string. Choose an explicit trim/case translation and review the resulting value.'];
                    }
                    $row['compiledAfter'] = $actual;
                }
            } unset($row);
        } catch (Throwable $e) { $issues[] = ['path'=>'mapping','message'=>$e->getMessage()]; }
        $result = ['schema'=>'stellar-forge.sf104.connector-map-preview.v1','recipeId'=>$recipe['id'] ?? null,'installationId'=>$iid,'sourceEditionId'=>$edition['id'],
            'baseMapId'=>$recipe['baseMapId'],'mapId'=>$final ? $s::digest($final) : null,'mapping'=>$final,'assignments'=>$rows,'removals'=>$removals,
            'issues'=>$issues,'ready'=>count($issues) === 0,'lookupPriority'=>'Customer ID before billing email; variation/product ID before SKU. Existing order editions are unchanged.'];
        $result['sha256'] = $s::digest($result); return $result;
    }
    static function apply($iid, $rid, $body) {
        $s = Starforge_SF104_KCF_Source::class;
        $s::keys($body, ['operationId','expectedCurrentMapId','previewSha256','reason','allowHistoricalSource'], 'The mapping application');
        $s::operation($body['operationId'] ?? null); $s::id($body['expectedCurrentMapId'] ?? '', 'current original map'); $s::id($body['previewSha256'] ?? '', 'reviewed preview');
        $reason = $s::text($body['reason'] ?? '', 4000, 'mapping application reason'); $route = 'apply/' . $rid;
        return Starforge_SF104_KCF_Store::lock($iid, static function () use ($iid,$rid,$body,$reason,$route) {
            $s = Starforge_SF104_KCF_Source::class; $store = Starforge_SF104_KCF_Store::class;
            $requestHash = $s::digest(['route'=>$route,'body'=>$body]); $prior = $store::op($iid, $body['operationId']);
            if ($prior) {
                $s::need(hash_equals($prior['requestSha256'], $requestHash), 'This operation ID already names a different mapping request.', 409);
                if (($prior['data']['state'] ?? '') === 'DONE') return $prior['data']['result'] + ['replayed'=>true];
            }
            $recipe = $store::typed($rid, $iid, 'recipe'); $preview = self::preview($iid, $recipe);
            $s::need($preview['ready'] && hash_equals($body['previewSha256'], $preview['sha256']), 'Review the complete current mapping preview before saving it.', 409);
            $s::need($recipe['baseMapId'] === $body['expectedCurrentMapId'], 'Create a new recipe from the current ERP map before applying this source; do not discard another operator’s mapping changes.', 409);
            if (!$prior) {
                $head = $store::head($iid);
                $s::need($head['currentEditionId'] === $recipe['sourceEditionId'] || ($body['allowHistoricalSource'] ?? false) === true, 'The selected source edition is historical. Review the current edition or explicitly retain this historical source for the operation.', 409);
                $store::put_op($iid, $body, $route, ['state'=>'PENDING','operationId'=>$body['operationId'],'recipeId'=>$rid,'mapId'=>$preview['mapId'],'startedAt'=>gmdate('c')]);
            }
            $current = get_option('sf104_erp_current_map', '');
            if ($current === $preview['mapId']) $native = Starforge_SF104_ERP_Store::map($current);
            else {
                $s::need($current === $body['expectedCurrentMapId'], 'The original ERP map selection changed. The pending request is retained; it has not overwritten the newer selection.', 409);
                $native = Starforge_SF104_ERP_Store::save_map($preview['mapping'], $body['expectedCurrentMapId']);
            }
            $s::need(($native['id'] ?? '') === $preview['mapId'], 'The original ERP save returned a different mapping.', 503);
            return $store::transaction(static function () use ($iid,$rid,$body,$reason,$route,$recipe,$preview,$native,$store,$s,$prior) {
                $id = $s::digest([$iid,'map-link',$body['operationId']]);
                $link = $store::object($id, $iid, false);
                if (!$link) {
                    $link = ['id'=>$id,'kind'=>'map-link','installationId'=>$iid,'recipeId'=>$rid,'sourceEditionId'=>$recipe['sourceEditionId'],
                        'baseMapId'=>$recipe['baseMapId'],'mapId'=>$native['id'],'previewSha256'=>$preview['sha256'],'reason'=>$reason,
                        'createdAt'=>gmdate('c'),'actor'=>get_current_user_id(),'operationId'=>$body['operationId']];
                    $store::put($id, $iid, 'map-link', $link);
                }
                $result = ['map'=>$native,'link'=>$link,'currentMapId'=>get_option('sf104_erp_current_map', ''),'ordersChanged'=>false];
                $store::put_op($iid, $body, $route, ['state'=>'DONE','operationId'=>$body['operationId'],'completedAt'=>gmdate('c'),'result'=>$result], true);
                return $result + ['replayed'=>$prior !== null];
            });
        });
    }
    static function comparable_scope($a, $b) {
        foreach (['family','selection','ids','filter','window','activeSelection'] as $key) if (Starforge_SF104_KCF_Source::digest($a[$key]) !== Starforge_SF104_KCF_Source::digest($b[$key])) return false;
        return true;
    }
    static function compare($iid, $beforeId, $afterId, $filter = 'all', $q = '', $page = 1, $limit = 50) {
        $store = Starforge_SF104_KCF_Store::class; $s = Starforge_SF104_KCF_Source::class;
        $before = $store::edition_detail($iid, $beforeId); $after = $store::edition_detail($iid, $afterId);
        $old = []; $new = [];
        foreach ($before['receipts'] as $r) $old[$r['slot']] = $r;
        foreach ($after['receipts'] as $r) $new[$r['slot']] = $r;
        $scopes = []; $counts = []; $total = 0; $items = []; $start = ($page-1)*$limit;
        // Retain only the requested page; every scoped observation still contributes to the complete counts.
        $emit = static function ($row) use (&$counts,&$total,&$items,$start,$limit,$filter,$q,$s) {
            $counts[$row['change']] = ($counts[$row['change']] ?? 0) + 1;
            if (($filter !== 'all' && $row['change'] !== $filter) || ($q !== '' && stripos($s::json($row), $q) === false)) return;
            if ($total >= $start && count($items) < $limit) $items[] = $row; $total++;
        };
        if ($s::digest($before['metadata']) !== $s::digest($after['metadata'])) $emit(['slot'=>'installation','key'=>'metadata','change'=>'INSTALLATION_CHANGED','before'=>$before['metadata'],'after'=>$after['metadata'],
            'meaning'=>'Plugin identity, versions, packages, environment and credential reference names belong to the captured edition. No credential value is resolved.']);
        foreach (array_unique(array_merge(array_keys($old), array_keys($new))) as $slot) {
            $a = $old[$slot] ?? null; $b = $new[$slot] ?? null;
            if (!$a || !$b) {
                $emit(['slot'=>$slot,'key'=>'scope','change'=>$a ? 'SCOPE_NOT_SELECTED' : 'SCOPE_ADDED','before'=>$a,'after'=>$b,
                    'meaning'=>'A source slot selection is not evidence that an entity was removed from Acumatica.']); continue;
            }
            $common = self::comparable_scope($a['scope'], $b['scope']);
            $sameProfile = $s::digest($a['profile']) === $s::digest($b['profile']);
            $complete = $common && $sameProfile && $a['scope']['coverage'] === 'COMPLETE' && $b['scope']['coverage'] === 'COMPLETE';
            $scopes[] = ['slot'=>$slot,'sameDeclaredScope'=>$common,'sameProjection'=>$sameProfile,'completeCommonScope'=>$complete,'before'=>$a['scope'],'after'=>$b['scope']];
            if (!$common || !$sameProfile || $a['scope']['coverage'] !== $b['scope']['coverage']) $emit(['slot'=>$slot,'key'=>'scope','change'=>'SCOPE_CHANGED',
                'before'=>['scope'=>$a['scope'],'profile'=>$a['profile']],'after'=>['scope'=>$b['scope'],'profile'=>$b['profile']],
                'meaning'=>'Only values actually observed on both sides can be compared outside an unchanged complete scope.']);
            if ($a['status'] !== 'READY' || $b['status'] !== 'READY') { $emit(['slot'=>$slot,'key'=>'invalid','change'=>'SOURCE_INVALID','before'=>$a['inspectionError'],'after'=>$b['inspectionError']]); continue; }
            if (!$sameProfile || $a['scope']['family'] !== $b['scope']['family']) continue;
            $ar = $s::projection($store::tree($a), $a['profile']); $br = $s::projection($store::tree($b), $b['profile']);
            $am = []; $bm = []; foreach ($ar as $r) $am[$r['key']] = $r; foreach ($br as $r) $bm[$r['key']] = $r;
            foreach (array_unique(array_merge(array_keys($am), array_keys($bm))) as $key) {
                $left = $am[$key] ?? null; $right = $bm[$key] ?? null;
                if ($left && $right) $change = $left['sha256'] === $right['sha256'] ? 'UNCHANGED' : 'CHANGED';
                elseif ($complete && $a['profile']['identityPointers']) $change = $left ? 'REMOVED_FROM_COMPLETE_SCOPE' : 'ADDED_TO_COMPLETE_SCOPE';
                else $change = $left ? 'NOT_OBSERVED_AFTER' : 'NEW_OBSERVATION';
                $fields = [];
                if ($left && $right) foreach (array_unique(array_merge(array_keys($left['fields']), array_keys($right['fields']))) as $field) {
                    $x = $left['fields'][$field] ?? $s::missing(); $y = $right['fields'][$field] ?? $s::missing();
                    if ($s::digest($x) !== $s::digest($y)) $fields[] = ['field'=>$field,'before'=>$x,'after'=>$y];
                }
                $emit(['slot'=>$slot,'key'=>$key,'change'=>$change,'identity'=>($right ?? $left)['identity'],'fields'=>$fields,
                    'before'=>$left,'after'=>$right,'beforeReceiptId'=>$a['id'],'afterReceiptId'=>$b['id'],'completeCommonScope'=>$complete,
                    'meaning'=>'Observed source change; existing ERP mappings and order editions are unchanged.']);
            }
            unset($ar,$br,$am,$bm,$left,$right,$fields);
        }
        return ['schema'=>'stellar-forge.sf104.connector-comparison.v1','installationId'=>$iid,'beforeId'=>$beforeId,'afterId'=>$afterId,'items'=>$items,'total'=>$total,'page'=>$page,'limit'=>$limit,
            'counts'=>$counts,'scopes'=>$scopes,'selectionSha256'=>$s::digest([$beforeId,$afterId,$before['receiptIds'],$after['receiptIds'],$before['metadata'],$after['metadata']])];
    }
}
