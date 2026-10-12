<?php
/** MIT. Immutable connector inputs beside the original ERP map and order journals. */
if (!defined('ABSPATH')) { exit; }
require_once __DIR__ . '/merchant-kcf-source.php';

final class Starforge_SF104_KCF_Store {
    const VERSION = '1';
    const PACKAGE_SCHEMA = 'stellar-forge.sf104.connector-project.v1';
    const MAX_PACKAGE = 33554432;
    static function table($kind) {
        global $wpdb;
        return $wpdb->prefix . ['objects'=>'sf104_kcf_objects','heads'=>'sf104_kcf_heads','operations'=>'sf104_kcf_operations'][$kind];
    }
    static function ok() { Starforge_SF104_ERP_Store::db_ok(); }
    static function install() {
        if (get_option('sf104_kcf_schema_version') === self::VERSION) return;
        global $wpdb; require_once ABSPATH . 'wp-admin/includes/upgrade.php'; $c = $wpdb->get_charset_collate();
        $objects = self::table('objects'); $heads = self::table('heads'); $ops = self::table('operations');
        dbDelta("CREATE TABLE {$objects} (
            object_id char(64) NOT NULL,
            installation_id char(64) NOT NULL,
            kind varchar(24) NOT NULL,
            content_sha256 char(64) NOT NULL,
            data longtext NOT NULL,
            created_at datetime NOT NULL,
            PRIMARY KEY  (object_id),
            KEY installation_kind (installation_id,kind,created_at)
        ) ENGINE=InnoDB {$c};");
        dbDelta("CREATE TABLE {$heads} (
            installation_id char(64) NOT NULL,
            revision bigint(20) unsigned NOT NULL,
            data longtext NOT NULL,
            PRIMARY KEY  (installation_id)
        ) ENGINE=InnoDB {$c};");
        dbDelta("CREATE TABLE {$ops} (
            operation_key char(64) NOT NULL,
            installation_id char(64) NOT NULL,
            request_sha256 char(64) NOT NULL,
            data longtext NOT NULL,
            created_at datetime NOT NULL,
            PRIMARY KEY  (operation_key),
            KEY installation_operations (installation_id,created_at)
        ) ENGINE=InnoDB {$c};");
        self::ok(); update_option('sf104_kcf_schema_version', self::VERSION, false);
    }
    static function lock($iid, $callback) { return Starforge_SF104_Checkout::with_order_lock('erp-kcf-' . substr(hash('sha256', $iid), 0, 32), $callback); }
    static function transaction($callback) {
        global $wpdb; $wpdb->query('START TRANSACTION'); self::ok();
        try { $result = $callback(); $wpdb->query('COMMIT'); self::ok(); return $result; }
        catch (Throwable $e) { $wpdb->query('ROLLBACK'); throw $e; }
    }
    static function put($id, $iid, $kind, $record) {
        global $wpdb; $json = Starforge_SF104_KCF_Source::json($record); $sha = hash('sha256', $json);
        $existing = self::object($id, null, false);
        if ($existing) {
            if (Starforge_SF104_KCF_Source::json($existing) !== $json) throw new RuntimeException('A retained source identity already contains different bytes.', 409);
            return $existing;
        }
        if ($wpdb->insert(self::table('objects'), ['object_id'=>$id,'installation_id'=>$iid,'kind'=>$kind,'content_sha256'=>$sha,
            'data'=>$json,'created_at'=>gmdate('Y-m-d H:i:s')]) !== 1) throw new RuntimeException('The source record could not be retained. Reopen and retry the same operation ID.', 503);
        return $record;
    }
    static function object($id, $iid = null, $required = true) {
        global $wpdb; Starforge_SF104_KCF_Source::id($id);
        $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::table('objects') . ' WHERE object_id=%s', $id), ARRAY_A); self::ok();
        if (!$row) { if (!$required) return null; throw new RuntimeException('The selected retained connector source was not found.', 404); }
        if ($iid !== null && $row['installation_id'] !== $iid) throw new RuntimeException('This source belongs to a different installation.', 409);
        if (!hash_equals($row['content_sha256'], hash('sha256', $row['data']))) throw new RuntimeException('The retained source digest does not match its bytes. Restore its complete private export.', 503);
        $record = Starforge_SF104_ERP_Store::decode($row['data']);
        if (($record['id'] ?? '') !== $id || ($record['kind'] ?? '') !== $row['kind']) throw new RuntimeException('The source identity is inconsistent.', 503);
        return $record;
    }
    static function typed($id, $iid, $kind) {
        $x = self::object($id, $iid);
        if ($x['kind'] !== $kind) throw new RuntimeException('Select the requested ' . $kind . ' record.', 422);
        return $x;
    }
    static function listing($iid, $kind, $page = 1, $limit = 50) {
        global $wpdb; $table = self::table('objects'); $where = $wpdb->prepare('kind=%s', $kind);
        if ($iid !== null) $where .= $wpdb->prepare(' AND installation_id=%s', $iid);
        $total = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$table} WHERE {$where}");
        $rows = $wpdb->get_col($wpdb->prepare("SELECT object_id FROM {$table} WHERE {$where} ORDER BY created_at DESC,object_id ASC LIMIT %d OFFSET %d", $limit, ($page-1)*$limit)); self::ok();
        $items = [];
        foreach ($rows as $id) {
            $item = self::object($id, $iid);
            if ($kind === 'recipe') unset($item['assignments'], $item['removals'], $item['substitutions']);
            if ($kind === 'import-receipt') { $item['historicalOperationCount'] = count($item['operationHistory'] ?? []); unset($item['operationHistory']); }
            $items[] = $item;
        }
        return ['items'=>$items,'page'=>$page,'limit'=>$limit,'total'=>$total,'pages'=>(int) ceil($total/$limit)];
    }
    static function all($iid, $kind) {
        $page = 1; $out = [];
        do { $batch = self::listing($iid, $kind, $page++, 200); $out = array_merge($out, $batch['items']); } while (count($out) < $batch['total']);
        return $out;
    }
    static function head($iid) {
        global $wpdb; self::typed($iid, $iid, 'installation');
        $row = $wpdb->get_row($wpdb->prepare('SELECT revision,data FROM ' . self::table('heads') . ' WHERE installation_id=%s', $iid), ARRAY_A); self::ok();
        if (!$row) throw new RuntimeException('The installation head is missing from this private workspace.', 503);
        $data = Starforge_SF104_ERP_Store::decode($row['data']);
        if ((int) $row['revision'] !== ($data['revision'] ?? -1)) throw new RuntimeException('The installation revision is inconsistent.', 503);
        return $data;
    }
    static function advance($iid, $expected, $patch, $op) {
        global $wpdb; $head = self::head($iid);
        if (!is_int($expected) || $head['revision'] !== $expected) throw new RuntimeException('Another operator changed this installation. Refresh its source selection; your draft is retained in this page.', 409);
        $next = array_merge($head, $patch, ['revision'=>$expected+1,'updatedAt'=>gmdate('c'),'lastOperationId'=>$op]);
        if ($wpdb->update(self::table('heads'), ['revision'=>$next['revision'],'data'=>Starforge_SF104_KCF_Source::json($next)],
            ['installation_id'=>$iid,'revision'=>$expected]) !== 1) throw new RuntimeException('The installation selection changed before saving. Reopen the same operation.', 409);
        return $next;
    }
    static function op($iid, $id) {
        global $wpdb; $key = Starforge_SF104_KCF_Source::digest([$iid,$id]);
        $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::table('operations') . ' WHERE operation_key=%s', $key), ARRAY_A); self::ok();
        return $row ? ['key'=>$key,'requestSha256'=>$row['request_sha256'],'data'=>Starforge_SF104_ERP_Store::decode($row['data'])] : null;
    }
    static function put_op($iid, $body, $route, $data, $update = false) {
        global $wpdb; $key = Starforge_SF104_KCF_Source::digest([$iid,$body['operationId']]);
        $request = Starforge_SF104_KCF_Source::digest(['route'=>$route,'body'=>$body]);
        $row = ['installation_id'=>$iid,'request_sha256'=>$request,'data'=>Starforge_SF104_KCF_Source::json($data)];
        $ok = $update ? $wpdb->update(self::table('operations'), $row, ['operation_key'=>$key]) :
            $wpdb->insert(self::table('operations'), $row + ['operation_key'=>$key,'created_at'=>gmdate('Y-m-d H:i:s')]);
        self::ok(); if ($ok === false) throw new RuntimeException('The operation result could not be retained. Retry the same operation ID.', 503);
    }
    static function change($iid, $route, $body, $callback) {
        Starforge_SF104_KCF_Source::operation($body['operationId'] ?? null);
        return self::lock($iid, static function () use ($iid,$route,$body,$callback) {
            $prior = self::op($iid, $body['operationId']); $hash = Starforge_SF104_KCF_Source::digest(['route'=>$route,'body'=>$body]);
            if ($prior) {
                if (!hash_equals($prior['requestSha256'], $hash)) throw new RuntimeException('This operation ID belongs to a different request. Keep it for the original outcome; use a new ID for changed work.', 409);
                if (($prior['data']['state'] ?? '') === 'DONE') return $prior['data']['result'] + ['replayed'=>true];
                throw new RuntimeException('The original operation is pending. Use its recovery action before changing this request.', 409);
            }
            return self::transaction(static function () use ($iid,$route,$body,$callback) {
                $result = $callback();
                self::put_op($iid, $body, $route, ['state'=>'DONE','operationId'=>$body['operationId'],'completedAt'=>gmdate('c'),'result'=>$result]);
                return $result + ['replayed'=>false];
            });
        });
    }
    static function create($body) {
        Starforge_SF104_KCF_Source::keys($body, ['operationId','identity','name'], 'The installation');
        $identity = Starforge_SF104_KCF_Source::identity($body['identity'] ?? []);
        $iid = Starforge_SF104_KCF_Source::digest(['schema'=>'stellar-forge.sf104.connector-installation.v1','identity'=>$identity]);
        return self::change($iid, 'create', $body, static function () use ($iid,$identity,$body) {
            global $wpdb; $existing = self::object($iid, $iid, false);
            if ($existing) return ['installation'=>$existing,'head'=>self::head($iid),'existing'=>true];
            $record = ['id'=>$iid,'kind'=>'installation','identity'=>$identity,'name'=>Starforge_SF104_KCF_Source::text($body['name'] ?? '', 160, 'installation name'),
                'createdAt'=>gmdate('c'),'actor'=>get_current_user_id()];
            self::put($iid, $iid, 'installation', $record);
            $head = ['revision'=>0,'currentEditionId'=>'','currentRecipeId'=>'','updatedAt'=>gmdate('c'),'lastOperationId'=>$body['operationId']];
            if ($wpdb->insert(self::table('heads'), ['installation_id'=>$iid,'revision'=>0,'data'=>Starforge_SF104_KCF_Source::json($head)]) !== 1) throw new RuntimeException('The new installation selection could not be retained.', 503);
            return ['installation'=>$record,'head'=>$head,'existing'=>false];
        });
    }
    static function receipt($iid, $body) {
        Starforge_SF104_KCF_Source::keys($body, ['operationId','slot','file','reuseReceiptId','scope','source','profile'], 'The source receipt');
        self::typed($iid, $iid, 'installation');
        return self::change($iid, 'receipt', $body, static function () use ($iid,$body) {
            $s = Starforge_SF104_KCF_Source::class;
            $slot = $s::text($body['slot'] ?? '', 160, 'logical source slot');
            $scope = $s::scope($body['scope'] ?? []); $profile = $s::profile($body['profile'] ?? []);
            $source = $body['source'] ?? []; $s::keys($source, ['screen','reference','observedAt','note'], 'The source observation');
            $observation = ['screen'=>$s::text($source['screen'] ?? '', 300, 'source screen or export command'),
                'reference'=>$s::text($source['reference'] ?? '', 2048, 'source reference', true),
                'observedAt'=>$s::when($source['observedAt'] ?? null, 'source extraction time'),
                'note'=>$s::text($source['note'] ?? '', 4000, 'source note', true)];
            $file = $body['file'] ?? null;
            if (!empty($body['reuseReceiptId'])) {
                $s::need($file === null, 'Select one original byte source.');
                $prior = self::typed($s::id($body['reuseReceiptId']), $iid, 'receipt');
                $blob = self::typed($prior['blobId'], null, 'blob'); $bytes = self::blob_bytes($blob);
                $name = $prior['name']; $format = $prior['format']; $delimiter = $prior['delimiter'];
            } else {
                $s::keys($file, ['name','format','delimiter','contentBase64','sha256','bytes'], 'The original file');
                $name = $s::text($file['name'] ?? '', 200, 'original filename');
                $s::need(!preg_match('/[\/\\\\\r\n]/', $name), 'Use a filename without directory separators.');
                $format = $file['format'] ?? ''; $delimiter = $file['delimiter'] ?? ',';
                $s::need(in_array($format, ['json','csv'], true), 'Select a JSON or CSV source file.');
                $encoded = $file['contentBase64'] ?? null;
                $s::need(is_string($encoded) && strlen($encoded) <= (int) ceil($s::MAX_FILE/3)*4, 'The source exceeds the 4 MiB receipt limit.', 413);
                $bytes = base64_decode($encoded, true);
                $s::need(is_string($bytes) && strlen($bytes) <= $s::MAX_FILE && base64_encode($bytes) === $encoded, 'The original source encoding is invalid.');
                $s::need(!array_key_exists('bytes', $file) || $file['bytes'] === strlen($bytes), 'The original byte count differs from the selected file.');
                $sha = hash('sha256', $bytes); $s::need(hash_equals($s::id($file['sha256'] ?? ''), $sha), 'The uploaded bytes differ from the selected SHA-256.');
                $blobId = $s::digest(['blobSha256'=>$sha]);
                $blob = ['id'=>$blobId,'kind'=>'blob','sha256'=>$sha,'bytes'=>strlen($bytes),'contentBase64'=>$encoded];
                self::put($blobId, '', 'blob', $blob);
            }
            $status = 'READY'; $error = null; $count = null; $headers = [];
            try {
                $tree = $s::parse($bytes, $format, $delimiter); $rows = $s::projection($tree, $profile); $count = count($rows);
                $headers = $tree['csvHeaders'] ?? [];
                if ($s::at($tree, $profile['rowPointer'])['type'] === 'missing') throw new RuntimeException('The selected row pointer is absent from this export.', 422);
            } catch (Throwable $e) { $status = 'INVALID'; $error = $e->getMessage(); }
            $id = $s::digest([$iid,'receipt',$body['operationId']]);
            $record = ['id'=>$id,'kind'=>'receipt','installationId'=>$iid,'slot'=>$slot,'blobId'=>$blob['id'],'name'=>$name,'format'=>$format,'delimiter'=>$delimiter,
                'sha256'=>$blob['sha256'],'bytes'=>$blob['bytes'],'scope'=>$scope,'source'=>$observation,'profile'=>$profile,'status'=>$status,
                'inspectionError'=>$error,'rowCount'=>$count,'headers'=>$headers,'reusesReceiptId'=>$body['reuseReceiptId'] ?? null,'receivedAt'=>gmdate('c'),'actor'=>get_current_user_id()];
            self::put($id, $iid, 'receipt', $record);
            return ['receipt'=>$record,'head'=>self::head($iid)];
        });
    }
    static function blob_bytes($blob) {
        $bytes = base64_decode($blob['contentBase64'] ?? '', true);
        if (!is_string($bytes) || strlen($bytes) !== ($blob['bytes'] ?? -1) || !hash_equals($blob['sha256'], hash('sha256', $bytes)))
            throw new RuntimeException('The retained original file failed its complete byte check.', 503);
        return $bytes;
    }
    static function tree($receipt) {
        return Starforge_SF104_KCF_Source::parse(self::blob_bytes(self::typed($receipt['blobId'], null, 'blob')), $receipt['format'], $receipt['delimiter']);
    }
    static function edition($iid, $body) {
        Starforge_SF104_KCF_Source::keys($body, ['operationId','expectedRevision','label','receiptIds','metadata','reason'], 'The source edition');
        return self::change($iid, 'edition', $body, static function () use ($iid,$body) {
            $s = Starforge_SF104_KCF_Source::class; $head = self::head($iid);
            $ids = $body['receiptIds'] ?? []; $s::need(is_array($ids) && Starforge_SF104_KCF_Source::is_list($ids) && count($ids) > 0 && count($ids) <= 100, 'Select one to 100 original receipts for this complete source edition.');
            $slots = [];
            foreach ($ids as $id) {
                $r = self::typed($s::id($id), $iid, 'receipt');
                $s::need(!isset($slots[base64_encode($r['slot'])]), 'Select exactly one receipt for each logical source slot. Use separate named slots for separate scoped exports.'); $slots[base64_encode($r['slot'])] = true;
            }
            $id = $s::digest([$iid,'edition',$body['operationId']]);
            $record = ['id'=>$id,'kind'=>'edition','installationId'=>$iid,'parentEditionId'=>$head['currentEditionId'],
                'label'=>$s::text($body['label'] ?? '', 160, 'source edition label'),'receiptIds'=>$ids,
                'metadata'=>$s::metadata($body['metadata'] ?? []),'reason'=>$s::text($body['reason'] ?? '', 4000, 'source selection reason'),
                'createdAt'=>gmdate('c'),'actor'=>get_current_user_id()];
            self::put($id, $iid, 'edition', $record);
            return ['edition'=>$record,'head'=>self::advance($iid, $body['expectedRevision'] ?? null, ['currentEditionId'=>$id,'currentRecipeId'=>''], $body['operationId'])];
        });
    }
    static function edition_detail($iid, $id) {
        $x = self::typed($id, $iid, 'edition'); $x['receipts'] = [];
        foreach ($x['receiptIds'] as $rid) $x['receipts'][] = self::typed($rid, $iid, 'receipt');
        return $x;
    }
    static function recipe($iid, $body) {
        Starforge_SF104_KCF_Source::keys($body, ['operationId','expectedRevision','sourceEditionId','baseMapId','label','assignments','removals','substitutions','acknowledgeLookupPriority','reason'], 'The mapping recipe');
        return self::change($iid, 'recipe', $body, static function () use ($iid,$body) {
            $s = Starforge_SF104_KCF_Source::class; self::typed($s::id($body['sourceEditionId'] ?? ''), $iid, 'edition');
            $s::need(Starforge_SF104_ERP_Store::map($s::id($body['baseMapId'] ?? '')) !== null, 'Select an existing ERP map as the starting point.');
            $id = $s::digest([$iid,'recipe',$body['operationId']]);
            $record = ['id'=>$id,'kind'=>'recipe','installationId'=>$iid,'sourceEditionId'=>$body['sourceEditionId'],'baseMapId'=>$body['baseMapId'],
                'label'=>$s::text($body['label'] ?? '', 160, 'mapping recipe label'),'assignments'=>$body['assignments'] ?? [],
                'removals'=>$body['removals'] ?? [],'substitutions'=>$body['substitutions'] ?? null,
                'acknowledgeLookupPriority'=>($body['acknowledgeLookupPriority'] ?? false) === true,
                'reason'=>$s::text($body['reason'] ?? '', 4000, 'mapping review reason'),'createdAt'=>gmdate('c'),'actor'=>get_current_user_id()];
            Starforge_SF104_KCF_Mapping::validate_recipe($record);
            $preview = Starforge_SF104_KCF_Mapping::preview($iid, $record);
            $record['status'] = $preview['ready'] ? 'READY' : 'NEEDS_REVIEW'; $record['issues'] = $preview['issues'];
            self::put($id, $iid, 'recipe', $record);
            return ['recipe'=>$record,'preview'=>$preview,'head'=>self::advance($iid, $body['expectedRevision'] ?? null, ['currentRecipeId'=>$id], $body['operationId'])];
        });
    }
    static function linked($mapId) {
        global $wpdb; $rows = $wpdb->get_col($wpdb->prepare('SELECT object_id FROM ' . self::table('objects') . ' WHERE kind=%s ORDER BY created_at,object_id', 'map-link'));
        self::ok(); $out = [];
        foreach ($rows as $id) { $x = self::object($id); if ($x['mapId'] === $mapId) $out[] = $x; }
        return $out;
    }
    static function impacts($iid, $recipeId, $page = 1, $limit = 50) {
        $recipe = self::typed($recipeId, $iid, 'recipe'); $maps = [$recipe['baseMapId']=>true];
        foreach (self::all($iid, 'map-link') as $link) if ($link['recipeId'] === $recipeId || $link['sourceEditionId'] === $recipe['sourceEditionId']) $maps[$link['mapId']] = true;
        global $wpdb; $table = Starforge_SF104_ERP_Store::table('orders'); $offset = 0; $items = []; $total = 0; $start = ($page-1)*$limit;
        do {
            $batch = $wpdb->get_results($wpdb->prepare("SELECT operation_id,data FROM {$table} ORDER BY operation_id LIMIT %d OFFSET %d", 100, $offset), ARRAY_A); self::ok(); $offset += count($batch);
            foreach ($batch as $row) {
                $record = Starforge_SF104_ERP_Store::decode($row['data']);
                foreach ($record['editions'] ?? [] as $edition) if (isset($maps[$edition['mapId'] ?? ''])) {
                    if ($total >= $start && count($items) < $limit) $items[] = ['operationId'=>$row['operation_id'],'orderId'=>$record['orderId'],
                        'state'=>$record['state'],'revision'=>$record['revision'],'editionId'=>$edition['id'],'mapId'=>$edition['mapId'],
                        'sourceSha256'=>$edition['sourceSha256'],'currentEdition'=>($record['currentEditionId'] ?? '') === $edition['id'],
                        'received'=>!empty($record['target']),'meaning'=>'Historical order editions are retained. Preparing another edition is an explicit action in Order delivery.'];
                    $total++;
                }
            }
        } while (count($batch) === 100);
        return ['items'=>$items,'total'=>$total,'page'=>$page,'limit'=>$limit,'mapIds'=>array_keys($maps)];
    }
}
