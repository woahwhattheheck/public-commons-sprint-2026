<?php
/** MIT. Native Woo order preparation, approval, delivery, recovery and handoff. */
if (!defined('ABSPATH')) { exit; }
require_once __DIR__ . '/merchant-erp-store.php';

final class Starforge_SF104_ERP {
    const VERSION = '1.1.0';
    const API = '/merchant-erp';
    const MAX_BODY = 16777216;
    const STATES = ['WAITING_WOO','NEEDS_MAPPING','READY','APPROVED','RECEIVED','SOURCE_CHANGED','CONFLICT','UNCERTAIN','REJECTED','IMPORTED','NEEDS_RECONCILIATION'];
    static function boot() {
        add_action('init', [Starforge_SF104_ERP_Store::class, 'install'], 20);
        add_action('rest_api_init', [__CLASS__, 'rest']);
    }
    static function rest() {
        foreach ([
            ['GET', '', 'status'], ['GET', '/maps/(?P<map>[a-f0-9]{64})', 'get_map'],
            ['POST', '/maps', 'save_map'], ['POST', '/maps/(?P<map>[a-f0-9]{64})/check', 'check_map'],
            ['GET', '/orders', 'queue'], ['POST', '/prepare', 'prepare'],
            ['GET', '/orders/(?P<id>[a-f0-9]{64})', 'inspect'],
            ['GET', '/orders/(?P<id>[a-f0-9]{64})/export', 'export_project'],
            ['POST', '/orders/(?P<id>[a-f0-9]{64})/(?P<action>approve|deliver|reconcile|authorize-retry|identify-target|bind-import)', 'action'],
            ['POST', '/import', 'import_project'],
        ] as $route) {
            $method = $route[2];
            register_rest_route('stellar-forge/v1', self::API . $route[1], [
                'methods'=>$route[0], 'permission_callback'=>[Starforge_SF104_Merchant_Console::class, 'permission'],
                'callback'=>static function ($request) use ($method) {
                    try { return Starforge_SF104_Merchant_Console::reply(call_user_func([__CLASS__, $method], $request)); }
                    catch (Throwable $e) {
                        $code = in_array((int) $e->getCode(), [400,403,404,409,413,422,503], true) ? (int) $e->getCode() : 503;
                        return Starforge_SF104_Merchant_Console::reply(['error'=>'sf104_erp_error','message'=>$e->getMessage()], $code);
                    }
                },
            ]);
        }
    }
    static function body($request, $fields) {
        if (strlen($request->get_body()) > self::MAX_BODY) throw new RuntimeException('The selected ERP project exceeds the 16 MiB import limit.', 413);
        $body = $request->get_json_params();
        Starforge_SF104_ERP_Map::keys($body, $fields, 'The selected operation');
        return $body;
    }
    static function selected_map($id = null) {
        $map = Starforge_SF104_ERP_Store::map($id);
        if (!$map) throw new RuntimeException('Save and select the approved ERP mapping first.', 404);
        return $map;
    }
    static function contract_ready($map) {
        if (($map['check']['usable'] ?? false) !== true ||
            ($map['check']['endpoint'] ?? '') !== Starforge_SF104_ERP_Acumatica::endpoint($map['mapping']['target'])) {
            throw new RuntimeException('Read the installed ERP contract for this mapping before approving a delivery.', 422);
        }
    }
    static function status($request = null) {
        $map = Starforge_SF104_ERP_Store::map();
        return ['schema'=>'stellar-forge.sf104.erp-status.v1','version'=>self::VERSION,'observedAt'=>gmdate('c'),
            'currentMapId'=>$map['id'] ?? '', 'selectedMap'=>$map, 'maps'=>Starforge_SF104_ERP_Store::map_summaries(),
            'states'=>self::STATES, 'storeUrl'=>untrailingslashit(home_url('/')),
            'operatorId'=>get_current_user_id(), 'maxImportBytes'=>self::MAX_BODY,
            'connections'=>Starforge_SF104_ERP_Acumatica::connections(),
            'connectionAuthorized'=>$map ? Starforge_SF104_ERP_Acumatica::authorized_connection($map['mapping']['target']) : false,
            'credentialConfigured'=>$map ? is_string(getenv($map['mapping']['target']['tokenEnv'])) && getenv($map['mapping']['target']['tokenEnv']) !== '' : false];
    }
    static function get_map($request) { return self::selected_map($request['map']); }
    static function save_map($request) {
        $body = self::body($request, ['mapping','expectedCurrentMapId']);
        $expected = $body['expectedCurrentMapId'] ?? null;
        if (!is_string($expected) || ($expected !== '' && !preg_match('/^[a-f0-9]{64}$/D', $expected))) throw new RuntimeException('Refresh the original mapping selection before saving a revision.', 409);
        return Starforge_SF104_ERP_Store::save_map($body['mapping'] ?? null, $expected);
    }
    static function check_map($request) {
        $map = self::selected_map($request['map']);
        return Starforge_SF104_ERP_Store::record_check($map['id'], Starforge_SF104_ERP_Acumatica::schema_check($map['mapping']['target']));
    }
    static function queue($request) {
        $integer = [Starforge_SF104_Merchant_Console::class, 'integer'];
        $search = Starforge_SF104_ERP_Map::text($request['q'] ?? '', 100, 'order search', true);
        $state = $request['state'] ?? '';
        if (!is_string($state) || ($state !== '' && !in_array($state, self::STATES, true))) throw new RuntimeException('Select a supported ERP queue state.', 400);
        return Starforge_SF104_ERP_Store::queue($search, $state,
            call_user_func($integer, $request['page'], 1, 1, 1000000),
            call_user_func($integer, $request['limit'], 25, 1, 100));
    }
    static function record($id) {
        $record = Starforge_SF104_ERP_Store::order($id);
        if (!$record) throw new RuntimeException('The original ERP order project was not found.', 404);
        return $record;
    }
    static function view($record) {
        $edition = Starforge_SF104_ERP_Store::edition($record);
        return ['schema'=>'stellar-forge.sf104.erp-order-view.v1','record'=>$record,
            'sourceStatus'=>Starforge_SF104_ERP_Store::current_source($record, $edition), 'observedAt'=>gmdate('c')];
    }
    static function inspect($request) { return self::view(self::record($request['id'])); }
    static function live_source($record, $edition) {
        if (!empty($record['imported']) || !empty($record['importNeedsReconcile'])) throw new RuntimeException('Bind the imported project to this original Woo store and reconcile its target before approving another delivery.', 409);
        $source = Starforge_SF104_ERP_Store::source($record['orderId']);
        if (!hash_equals($record['orderKeySha256'], $source['orderKeySha256'])) throw new RuntimeException('This Woo numeric order ID belongs to a different original order. Open the store retained with this project.', 409);
        if (!hash_equals($edition['sourceSha256'], Starforge_SF104_ERP_Store::source_digest($source))) throw new RuntimeException('The original Woo order changed. Prepare its current edition and review the differences before delivery.', 409);
        $map = self::selected_map($edition['mapId']);
        if (!in_array($source['status'], $map['mapping']['admittedStatuses'], true)) throw new RuntimeException('The current Woo order state is outside this approved ERP flow.', 409);
        return $source;
    }
    static function target_identity($target) {
        return array_intersect_key($target, array_flip(['baseUrl','endpoint','version','orderType']));
    }
    static function prepare($request) {
        $body = self::body($request, ['orderId','mapId','expectedRevision']);
        $order_id = Starforge_SF104_Merchant_Console::order_id($body['orderId'] ?? null);
        $map = self::selected_map($body['mapId'] ?? null);
        return Starforge_SF104_Checkout::with_order_lock($order_id, static function () use ($order_id, $map, $body) {
            $s = Starforge_SF104_ERP_Store::class; $m = Starforge_SF104_ERP_Map::class;
            $source = $s::source($order_id); $id = $s::operation_id($map['mapping']['storeNamespace'], $order_id);
            foreach ($s::for_order($order_id) as $existing) if ($existing !== $id) throw new RuntimeException('This Woo order already belongs to another retained ERP namespace. Continue its original operation instead of creating a second delivery.', 409);
            $record = $s::order($id); $expected = $record['revision'] ?? 0;
            if ($record && ($body['expectedRevision'] ?? null) !== $expected) throw new RuntimeException('Refresh this original ERP order before preparing another edition.', 409);
            if (!$record && isset($body['expectedRevision']) && $body['expectedRevision'] !== 0) throw new RuntimeException('The selected ERP order revision does not exist.', 409);
            if ($record && (!empty($record['imported']) || !hash_equals($record['orderKeySha256'], $source['orderKeySha256']))) throw new RuntimeException('Bind this retained project to its original Woo order before preparing a new edition.', 409);
            if ($record && ($record['attempts'] || $record['target'])) {
                $prior = $s::edition($record);
                $old_map = self::selected_map($prior['mapId']);
                if (self::target_identity($old_map['mapping']['target']) !== self::target_identity($map['mapping']['target'])) throw new RuntimeException('This order has an existing ERP delivery history. Continue its original installed target; a target migration requires a separate reviewed migration of that history.', 409);
            }
            if (!$record) $record = ['schema'=>$s::ORDER_SCHEMA, 'operationId'=>$id, 'orderId'=>(string) $order_id,
                'storeNamespace'=>$map['mapping']['storeNamespace'], 'externalReference'=>$map['mapping']['storeNamespace'] . '-' . $order_id,
                'orderKeySha256'=>$source['orderKeySha256'], 'revision'=>0, 'state'=>'READY', 'createdAt'=>gmdate('c'),
                'editions'=>[], 'currentEditionId'=>null, 'approvedEditionId'=>null, 'approval'=>null,
                'target'=>null, 'pendingWrite'=>null, 'attempts'=>[], 'decisions'=>[], 'lastLookup'=>null,
                'issues'=>[], 'imported'=>false, 'importNeedsReconcile'=>false, 'imports'=>[]];
            $source_sha = $s::source_digest($source); $edition_id = $s::edition_id($map, $source);
            if ($record['currentEditionId'] === $edition_id) return self::view($record) + ['reused'=>true];
            // A source may return to an earlier edition; retain its original identity and review anew.
            $edition = null;
            foreach ($record['editions'] as $saved) if ($saved['id'] === $edition_id) $edition = $saved;
            if (!$edition) {
                $errors = []; $plan = null;
                try { $plan = $m::build($map['mapping'], $source); } catch (Throwable $e) { $errors[] = $e->getMessage(); }
                $edition = ['id'=>$edition_id,'number'=>count($record['editions']) + 1,'mapId'=>$map['id'],
                    'preparedAt'=>gmdate('c'),'preparedBy'=>get_current_user_id(),'reviewOwner'=>$map['mapping']['reviewOwner'],
                    'sourceSha256'=>$source_sha,'source'=>$source,'plan'=>$plan,'errors'=>$errors,
                    'admittedWhenPrepared'=>in_array($source['status'], $map['mapping']['admittedStatuses'], true)];
                $record['editions'][] = $edition;
            }
            $record['currentEditionId'] = $edition_id; $record['approvedEditionId'] = null; $record['approval'] = null;
            $record['issues'] = $edition['errors'];
            $record['state'] = $record['pendingWrite'] ? 'UNCERTAIN' : (!$edition['admittedWhenPrepared'] ? 'WAITING_WOO' : ($edition['plan'] ? ($record['target'] ? 'SOURCE_CHANGED' : 'READY') : 'NEEDS_MAPPING'));
            $record['decisions'][] = self::decision('prepare', $edition_id, 'Selected the current original Woo order and approved mapping revision.');
            $s::save($record, $expected);
            return self::view($record);
        });
    }
    static function decision($action, $edition_id, $reason, $extra = []) {
        return ['id'=>wp_generate_uuid4(),'action'=>$action,'editionId'=>$edition_id,
            'operatorId'=>get_current_user_id(),'at'=>gmdate('c'),'reason'=>$reason] + $extra;
    }
    static function reason($body) { return Starforge_SF104_ERP_Map::text($body['reason'] ?? '', 2000, 'operating reason'); }
    static function issue_text($lookup) {
        if (($lookup['matches'] ?? null) === null) return $lookup['error'] ?? ('The ERP read returned HTTP ' . ($lookup['httpStatus'] ?? 'unavailable') . '.');
        return count($lookup['matches']) > 1 ? 'More than one ERP order uses this customer order reference. Select and resolve the original target in the ERP before continuing.' :
            (count($lookup['matches']) === 0 ? 'No matching ERP order was returned by this read.' : 'The ERP order differs from the selected source edition.');
    }
    static function observe(&$record, $edition, $lookup) {
        $a = Starforge_SF104_ERP_Acumatica::class;
        $copy = $lookup; unset($copy['data'], $copy['matches']);
        $matches = $lookup['matches'] ?? null;
        $copy['editionId'] = $edition['id']; $copy['matchCount'] = is_array($matches) ? count($matches) : null;
        $copy['candidates'] = is_array($matches) ? array_map(static function ($document) use ($a) {
            return ['key'=>is_array($document) ? $a::key($document) : null,
                'sha256'=>is_array($document) ? $a::fingerprint($document) : null];
        }, $matches) : [];
        if (is_array($matches) && count($matches) === 1 && is_array($matches[0])) {
            $copy['document'] = $matches[0]; $copy['documentSha256'] = $a::fingerprint($matches[0]);
            $copy['comparison'] = $a::comparison($edition['plan'], $matches[0]);
        }
        $record['lastLookup'] = $copy;
        return $copy;
    }
    static function apply_receiving(&$record, $edition, $lookup) {
        $observation = self::observe($record, $edition, $lookup);
        if (($observation['comparison']['matched'] ?? false) === true) {
            $record['target'] = ['key'=>$observation['comparison']['targetKey'], 'document'=>$observation['document'],
                'documentSha256'=>$observation['documentSha256'], 'lineLinks'=>$observation['comparison']['lineLinks'],
                'status'=>'RECEIVED', 'basisEditionId'=>$edition['id'], 'receivedEditionId'=>$edition['id'], 'receivedAt'=>gmdate('c')];
            $record['pendingWrite'] = null; $record['importNeedsReconcile'] = false;
            $record['issues'] = [];
            $record['state'] = $record['currentEditionId'] === $edition['id'] ? 'RECEIVED' : 'SOURCE_CHANGED';
            if ($record['currentEditionId'] === $edition['id']) {
                $live = Starforge_SF104_ERP_Store::current_source($record, $edition);
                if (!$live['available'] || !$live['sameOrderKey'] || !$live['matchesEdition']) $record['state'] = 'SOURCE_CHANGED';
            }
        } else {
            $record['issues'] = $observation['comparison']['differences'] ?? [self::issue_text($lookup)];
            $record['state'] = ($observation['matchCount'] ?? 0) > 0 ? 'CONFLICT' : ($record['pendingWrite'] ? 'UNCERTAIN' : 'NEEDS_RECONCILIATION');
        }
        return $observation;
    }
    static function action($request) {
        $body = self::body($request, ['expectedRevision','editionId','reason','targetBaselineSha256','confirmNoOrder','confirmOperationEnded','providerOutcome']);
        if (!is_int($body['expectedRevision'] ?? null) || $body['expectedRevision'] < 1) throw new RuntimeException('Select the current retained ERP order revision.', 409);
        $found = self::record($request['id']); $action = $request['action'];
        return Starforge_SF104_Checkout::with_order_lock($found['orderId'], static function () use ($found, $action, $body) {
            $record = self::record($found['operationId']);
            if ($record['revision'] !== $body['expectedRevision']) throw new RuntimeException('Another operator advanced this order. Refresh its retained edition before continuing.', 409);
            $method = str_replace('-', '_', $action);
            return self::view(call_user_func_array([__CLASS__, $method], [$record, $body]));
        });
    }
    static function approve($record, $body) {
        $s = Starforge_SF104_ERP_Store::class; $a = Starforge_SF104_ERP_Acumatica::class;
        if ($record['pendingWrite']) throw new RuntimeException('Reconcile the earlier delivery before approving another write for this order.', 409);
        $edition = $s::edition($record);
        if (($body['editionId'] ?? '') !== $edition['id'] || !$edition['plan']) throw new RuntimeException('Select the current complete mapped edition for approval.', 409);
        self::live_source($record, $edition); $map = self::selected_map($edition['mapId']); self::contract_ready($map);
        $reason = self::reason($body); $baseline = null; $payload = $edition['plan']['payload'];
        if ($record['target']) {
            $lookup = $a::lookup($edition['plan'], $record['target']['key']);
            $observation = self::observe($record, $edition, $lookup);
            if (($observation['matchCount'] ?? null) !== 1 || !isset($observation['document'])) {
                $record['state'] = 'CONFLICT'; $record['issues'] = [self::issue_text($lookup)];
                $s::save($record, $record['revision']); return $record;
            }
            $expected_baseline = $body['targetBaselineSha256'] ?? $record['target']['documentSha256'];
            if ($observation['documentSha256'] !== $expected_baseline) {
                $record['state'] = 'CONFLICT'; $record['issues'] = ['The ERP order changed since the selected review. Review the current target differences and approve that exact baseline.'];
                $s::save($record, $record['revision']); return $record;
            }
            try { $payload = $a::correction_payload($edition['plan'], $observation['document'], $record['target']['lineLinks']); }
            catch (Throwable $e) {
                $record['state'] = 'CONFLICT'; $record['issues'] = [$e->getMessage()];
                $s::save($record, $record['revision']); return $record;
            }
            $baseline = $observation['documentSha256'];
        }
        $record['approvedEditionId'] = $edition['id'];
        $record['approval'] = ['editionId'=>$edition['id'],'at'=>gmdate('c'),'operatorId'=>get_current_user_id(),
            'reason'=>$reason,'targetBaselineSha256'=>$baseline,'payload'=>$payload,
            'requestSha256'=>hash('sha256', Starforge_SF104_ERP_Map::wire_json($payload))];
        $record['state'] = 'APPROVED'; $record['issues'] = [];
        $record['decisions'][] = self::decision('approve', $edition['id'], $reason, ['targetBaselineSha256'=>$baseline]);
        $s::save($record, $record['revision']); return $record;
    }
    static function deliver($record, $body) {
        $s = Starforge_SF104_ERP_Store::class; $a = Starforge_SF104_ERP_Acumatica::class;
        if ($record['pendingWrite']) throw new RuntimeException('The original delivery is unresolved. Reconcile it before another write.', 409);
        $edition = $s::edition($record);
        if ($record['state'] !== 'APPROVED' || $record['approvedEditionId'] !== $edition['id'] ||
            ($body['editionId'] ?? '') !== $edition['id'] || !$record['approval']) throw new RuntimeException('Approve the selected current source edition before delivery.', 409);
        self::live_source($record, $edition); self::contract_ready(self::selected_map($edition['mapId']));
        $lookup = $a::lookup($edition['plan'], $record['target']['key'] ?? null);
        $observation = self::observe($record, $edition, $lookup); $update = $record['target'] !== null;
        if (($observation['comparison']['matched'] ?? false) === true) {
            self::apply_receiving($record, $edition, $lookup);
            $record['decisions'][] = self::decision('adopt-existing', $edition['id'], 'The selected original ERP order already matches the approved edition; no write was needed.');
            $s::save($record, $record['revision']); return $record;
        }
        if (!$update && ($observation['matchCount'] ?? null) !== 0) {
            self::apply_receiving($record, $edition, $lookup); $s::save($record, $record['revision']); return $record;
        }
        if ($update && (($observation['matchCount'] ?? null) !== 1 ||
            ($observation['documentSha256'] ?? '') !== $record['approval']['targetBaselineSha256'])) {
            $record['state'] = 'CONFLICT'; $record['issues'] = ['The target order changed after correction approval, or could not be read. Review its current state before another approval.'];
            $record['approval'] = null; $record['approvedEditionId'] = null;
            $s::save($record, $record['revision']); return $record;
        }
        $payload = $record['approval']['payload'];
        if ($update) $payload = $a::correction_payload($edition['plan'], $observation['document'], $record['target']['lineLinks']);
        if (hash('sha256', Starforge_SF104_ERP_Map::wire_json($payload)) !== $record['approval']['requestSha256']) throw new RuntimeException('The exact approved ERP request changed. Review the selected edition again.', 409);
        $attempt_id = wp_generate_uuid4();
        $record['attempts'][] = ['id'=>$attempt_id,'type'=>$update ? 'update' : 'create','editionId'=>$edition['id'],
            'startedAt'=>gmdate('c'),'operatorId'=>get_current_user_id(),'request'=>$payload,
            'requestSha256'=>$record['approval']['requestSha256'],'targetBaselineSha256'=>$record['approval']['targetBaselineSha256'],
            'response'=>null,'readback'=>null,'resolution'=>null];
        $index = count($record['attempts']) - 1;
        $record['pendingWrite'] = ['attemptId'=>$attempt_id,'editionId'=>$edition['id']];
        $record['state'] = 'UNCERTAIN'; $record['issues'] = ['The exact original request is retained. A receiving read must resolve it before another write.'];
        $s::save($record, $record['revision']); // The original intent survives timeout, process exit or lost response.
        try {
            $response = $a::request($edition['plan']['target'], 'PUT', '/SalesOrder', ['$expand'=>$a::EXPAND], $payload, $update ? 'update' : 'create');
        } catch (Throwable $e) {
            $response = ['httpStatus'=>null,'error'=>$e->getMessage(),'completedAt'=>gmdate('c')];
        }
        $record['attempts'][$index]['response'] = $response;
        // Retain the response before making another network call.
        $s::save($record, $record['revision']);
        $key = $record['target']['key'] ?? null;
        if (!$key && ($response['httpStatus'] ?? null) === 200 && is_array($response['data'] ?? null)) $key = $a::key($response['data']);
        try {
            $received = $a::lookup($edition['plan'], $key);
            $record['attempts'][$index]['readback'] = self::apply_receiving($record, $edition, $received);
        } catch (Throwable $e) {
            $record['issues'] = [$e->getMessage()]; $record['state'] = 'UNCERTAIN';
        }
        if ($record['pendingWrite'] && ($response['httpStatus'] ?? null) === 422) {
            $record['state'] = 'REJECTED';
            $record['issues'][] = 'The ERP rejected fields in the original request. Inspect its retained response, correct the source or map, and reconcile the original attempt before another delivery.';
        }
        if (!$record['pendingWrite']) $record['attempts'][$index]['resolution'] = ['at'=>gmdate('c'),'outcome'=>'RECEIVED','targetKey'=>$record['target']['key']];
        $s::save($record, $record['revision']); return $record;
    }
    static function reconcile($record, $body) {
        $s = Starforge_SF104_ERP_Store::class; $a = Starforge_SF104_ERP_Acumatica::class;
        if (!empty($record['imported'])) throw new RuntimeException('Bind the imported project to its original Woo order before making its live ERP read.', 409);
        $edition_id = $record['pendingWrite']['editionId'] ?? $record['currentEditionId'];
        $edition = $s::edition($record, $edition_id);
        if (!$edition['plan']) throw new RuntimeException('Prepare a complete mapped source edition before reading its ERP target.', 422);
        $pending = $record['pendingWrite'];
        $lookup = $a::lookup($edition['plan'], $record['target']['key'] ?? null);
        $observation = self::apply_receiving($record, $edition, $lookup);
        if ($pending) foreach ($record['attempts'] as &$attempt) if ($attempt['id'] === $pending['attemptId']) {
            $attempt['readback'] = $observation;
            if (!$record['pendingWrite']) $attempt['resolution'] = ['at'=>gmdate('c'),'outcome'=>'RECEIVED','targetKey'=>$record['target']['key']];
        }
        unset($attempt);
        if (!$pending && ($observation['matchCount'] ?? null) === 0 && !$record['target']) {
            $record['importNeedsReconcile'] = false; $record['approval'] = null; $record['approvedEditionId'] = null;
            $record['state'] = 'READY'; $record['issues'] = ['No target order was returned. Review and approve this source edition before its first delivery.'];
        }
        $record['decisions'][] = self::decision('reconcile', $edition['id'], 'Read the original target and retained the native receiving comparison.');
        $s::save($record, $record['revision']); return $record;
    }
    static function authorize_retry($record, $body) {
        $s = Starforge_SF104_ERP_Store::class; $a = Starforge_SF104_ERP_Acumatica::class;
        if (!empty($record['imported']) || !$record['pendingWrite']) throw new RuntimeException('Select the original unresolved delivery for this recovery decision.', 409);
        if (($body['confirmNoOrder'] ?? false) !== true) throw new RuntimeException('Confirm that the original ERP operation has ended and no order was received before authorizing a retry.', 422);
        $reason = self::reason($body);
        $provider_outcome = Starforge_SF104_ERP_Map::text($body['providerOutcome'] ?? '', 2000, 'completed ERP operation check');
        $edition = $s::edition($record, $record['pendingWrite']['editionId']);
        $lookup = $a::lookup($edition['plan'], $record['target']['key'] ?? null);
        $observation = self::observe($record, $edition, $lookup);
        if (($observation['matchCount'] ?? null) !== 0 || $record['target']) {
            self::apply_receiving($record, $edition, $lookup);
            $s::save($record, $record['revision']); return $record;
        }
        $pending = $record['pendingWrite'];
        foreach ($record['attempts'] as &$attempt) if ($attempt['id'] === $pending['attemptId']) {
            $attempt['readback'] = $observation;
            $attempt['resolution'] = ['at'=>gmdate('c'),'outcome'=>'OPERATOR_CONFIRMED_NOT_RECEIVED','operatorId'=>get_current_user_id(),'reason'=>$reason,'providerOutcome'=>$provider_outcome];
        }
        unset($attempt);
        $record['decisions'][] = self::decision('authorize-retry', $edition['id'], $reason, ['providerOutcome'=>$provider_outcome,'attemptId'=>$pending['attemptId']]);
        $record['pendingWrite'] = null; $record['importNeedsReconcile'] = false; $record['approvedEditionId'] = null; $record['approval'] = null;
        $current = $s::edition($record); $record['state'] = !$current['admittedWhenPrepared'] ? 'WAITING_WOO' : ($current['plan'] ? 'READY' : 'NEEDS_MAPPING');
        $record['issues'] = $current['errors'];
        $s::save($record, $record['revision']); return $record;
    }
    static function identify_target($record, $body) {
        $s = Starforge_SF104_ERP_Store::class; $a = Starforge_SF104_ERP_Acumatica::class;
        if (!empty($record['imported'])) throw new RuntimeException('Bind the original imported project before identifying its actual ERP document.', 409);
        $reason = self::reason($body); $pending = $record['pendingWrite'];
        $provider_outcome = null;
        if ($pending) {
            if (($body['confirmOperationEnded'] ?? false) !== true) throw new RuntimeException('Confirm that the prior ERP operation has finished before using this document as a new correction baseline.', 422);
            $provider_outcome = Starforge_SF104_ERP_Map::text($body['providerOutcome'] ?? '', 2000, 'completed ERP operation check');
        }
        $edition = $s::edition($record, $pending['editionId'] ?? $record['currentEditionId']);
        if (!$edition['plan']) throw new RuntimeException('Prepare the complete mapped source edition before identifying its target.', 422);
        $lookup = $a::lookup($edition['plan'], $record['target']['key'] ?? null);
        $observation = self::observe($record, $edition, $lookup);
        if (($observation['matchCount'] ?? null) !== 1 || !isset($observation['document']) ||
            ($body['targetBaselineSha256'] ?? '') !== $observation['documentSha256']) {
            $record['state'] = 'CONFLICT'; $record['issues'] = ['Review the unique current ERP document and select its exact baseline before identifying it for correction.'];
            $s::save($record, $record['revision']); return $record;
        }
        $identity = $a::identity_check($edition['plan'], $observation['document'], $record['target']['lineLinks'] ?? []);
        if (!$identity['identified']) {
            $record['state'] = 'CONFLICT'; $record['issues'] = $identity['issues'];
            $s::save($record, $record['revision']); return $record;
        }
        $record['target'] = ['status'=>'IDENTIFIED','key'=>$identity['targetKey'],'document'=>$observation['document'],
            'documentSha256'=>$observation['documentSha256'],'lineLinks'=>$identity['lineLinks'],
            'basisEditionId'=>$edition['id'],'receivedEditionId'=>null,'identifiedAt'=>gmdate('c')];
        if ($pending) foreach ($record['attempts'] as &$attempt) if ($attempt['id'] === $pending['attemptId']) {
            $attempt['readback'] = $observation;
            $attempt['resolution'] = ['at'=>gmdate('c'),'outcome'=>'IDENTIFIED_FOR_CORRECTION','operatorId'=>get_current_user_id(),'reason'=>$reason,'providerOutcome'=>$provider_outcome,'targetKey'=>$identity['targetKey']];
        }
        unset($attempt);
        $record['pendingWrite'] = null; $record['importNeedsReconcile'] = false;
        $record['approval'] = null; $record['approvedEditionId'] = null;
        $record['state'] = 'SOURCE_CHANGED'; $record['issues'] = ['The original target is identified. Its amounts or mapped fields have not been accepted. Prepare and approve the reviewed correction against this exact ERP baseline.'];
        $record['decisions'][] = self::decision('identify-target', $edition['id'], $reason, ['targetKey'=>$identity['targetKey'],'targetBaselineSha256'=>$observation['documentSha256']]);
        $s::save($record, $record['revision']); return $record;
    }
    static function bind_import($record, $body) {
        $s = Starforge_SF104_ERP_Store::class; $m = Starforge_SF104_ERP_Map::class;
        if (empty($record['imported'])) throw new RuntimeException('This project is already bound to its original Woo store.', 409);
        $edition = $s::edition($record); $current = $s::source($record['orderId']);
        if (!hash_equals($record['orderKeySha256'], $current['orderKeySha256']) ||
            !hash_equals($edition['sourceSha256'], $s::source_digest($current))) throw new RuntimeException('The retained project and current Woo source do not match. Restore the original Woo order and project together before binding.', 409);
        $map = self::selected_map($edition['mapId']);
        if (get_option('sf104_erp_current_map', '') !== $edition['mapId']) throw new RuntimeException('Select this retained mapping revision before binding the imported project.', 409);
        $check = Starforge_SF104_ERP_Acumatica::schema_check($map['mapping']['target']);
        $map = $s::record_check($map['id'], $check); self::contract_ready($map);
        $record['decisions'][] = self::decision('bind-import', $edition['id'], self::reason($body), ['sourceSha256'=>$s::source_digest($current),'installedContractSha256'=>$check['schemaSha256']]);
        $record['imported'] = false; $record['importNeedsReconcile'] = true; $record['state'] = 'NEEDS_RECONCILIATION';
        $record['approval'] = null; $record['approvedEditionId'] = null; $record['issues'] = ['The original Woo source is bound. Reconcile its actual ERP target before another write.'];
        $s::save($record, $record['revision']); return $record;
    }
    static function export_project($request) {
        $found = self::record($request['id']);
        return Starforge_SF104_Checkout::with_order_lock($found['orderId'], static function () use ($found) {
            $record = self::record($found['operationId']); $maps = [];
            foreach ($record['editions'] as $edition) $maps[$edition['mapId']] = self::selected_map($edition['mapId']);
            $project = ['schema'=>Starforge_SF104_ERP_Store::PROJECT_SCHEMA,'exportedAt'=>gmdate('c'),
                'sourceVersion'=>self::VERSION,'siteUrl'=>untrailingslashit(home_url('/')),
                'operation'=>$record,'mappings'=>array_values($maps),
                'reopen'=>'Install the same plugin and original Woo database, configure the named environment credentials, import this ERP project, select its map, bind the original source, then reconcile the target before delivery. This export contains private order/customer data and no credential values.'];
            if (class_exists('Starforge_SF104_KCF_Project')) {
                $companions = Starforge_SF104_KCF_Project::companion(array_keys($maps));
                if ($companions) { $project['connectorSources'] = $companions; $project['reopen'] .= ' The companion includes exact private source exports; those files may contain sensitive configuration values. Configure live credentials separately.'; }
            }
            $project['sha256'] = Starforge_SF104_ERP_Map::digest($project);
            if (strlen(Starforge_SF104_ERP_Map::json($project)) > self::MAX_BODY - 1024) throw new RuntimeException('The complete project exceeds the portable import limit. Retain the original Woo database and ERP tables together for the operating engineer.', 422);
            return $project;
        });
    }
    static function validate_project($project) {
        $s = Starforge_SF104_ERP_Store::class; $m = Starforge_SF104_ERP_Map::class; $a = Starforge_SF104_ERP_Acumatica::class;
        $m::need(is_array($project) && ($project['schema'] ?? '') === $s::PROJECT_SCHEMA, 'Select a complete native ERP project export.');
        $sha = $project['sha256'] ?? ''; $content = $project; unset($content['sha256']);
        $m::need(is_string($sha) && preg_match('/^[a-f0-9]{64}$/D', $sha) && hash_equals($sha, $m::digest($content)), 'The complete ERP project digest does not match.');
        $record = $project['operation'] ?? null; $maps = [];
        $m::need(is_array($record) && ($record['schema'] ?? '') === $s::ORDER_SCHEMA, 'The original ERP operation is missing.');
        $order_id = Starforge_SF104_Merchant_Console::order_id($record['orderId'] ?? null);
        $m::need(is_string($record['storeNamespace'] ?? null) && preg_match('/^[A-Za-z][A-Za-z0-9_-]{0,15}$/D', $record['storeNamespace']), 'The retained store namespace is invalid.');
        $m::need(($record['operationId'] ?? '') === $s::operation_id($record['storeNamespace'], $order_id) &&
            ($record['externalReference'] ?? '') === $record['storeNamespace'] . '-' . $order_id, 'The retained original order identity does not match.');
        $m::need(is_string($record['orderKeySha256'] ?? null) && preg_match('/^[a-f0-9]{64}$/D', $record['orderKeySha256']), 'The original Woo order key reference is missing.');
        $m::need(is_array($project['mappings'] ?? null) && count($project['mappings']) <= 500, 'The complete mapping revisions are missing.');
        foreach ($project['mappings'] as $map) {
            $compiled = $m::compile($map['mapping'] ?? null); $id = $m::digest($compiled);
            $m::need(($map['id'] ?? '') === $id && !isset($maps[$id]), 'A retained mapping revision is duplicated or changed.');
            $map['mapping'] = $compiled; $maps[$id] = $map;
        }
        $m::need(is_array($record['editions'] ?? null) && count($record['editions']) > 0 && count($record['editions']) <= 500, 'The complete original source editions are missing.');
        $seen = [];
        foreach ($record['editions'] as $index=>$edition) {
            $source = $edition['source'] ?? null; $map = $maps[$edition['mapId'] ?? ''] ?? null;
            $m::need(is_array($source) && $map && ($source['orderId'] ?? '') === (string) $order_id &&
                ($source['orderKeySha256'] ?? '') === $record['orderKeySha256'], 'A source edition refers to another original order.');
            $source_sha = $s::source_digest($source); $id = $s::edition_id($map, $source);
            $m::need(($edition['sourceSha256'] ?? '') === $source_sha && ($edition['id'] ?? '') === $id && !isset($seen[$id]) &&
                ($edition['number'] ?? null) === $index + 1 &&
                ($edition['admittedWhenPrepared'] ?? null) === in_array($source['status'], $map['mapping']['admittedStatuses'], true) && $map['mapping']['storeNamespace'] === $record['storeNamespace'], 'A retained source edition is changed or duplicated.');
            if ($edition['plan'] ?? null) $m::need($m::digest($m::build($map['mapping'], $source)) === $m::digest($edition['plan']), 'A retained mapped request differs from its original source and mapping.');
            $seen[$id] = $edition;
        }
        $m::need(isset($seen[$record['currentEditionId'] ?? '']) && is_array($record['attempts'] ?? null) &&
            is_array($record['decisions'] ?? null) && is_int($record['revision'] ?? null) && $record['revision'] > 0, 'The current original edition and journal are incomplete.');
        $attempt_ids = [];
        foreach ($record['attempts'] as $attempt) {
            $m::need(is_array($attempt) && is_string($attempt['id'] ?? null) && !isset($attempt_ids[$attempt['id']]) &&
                isset($seen[$attempt['editionId'] ?? '']) && in_array($attempt['type'] ?? '', ['create','update'], true), 'A retained delivery attempt is invalid.');
            $m::need(hash('sha256', $m::wire_json($attempt['request'] ?? null)) === ($attempt['requestSha256'] ?? ''), 'A retained original delivery request is changed.');
            $attempt_ids[$attempt['id']] = $attempt;
        }
        if ($record['pendingWrite'] ?? null) {
            $pending = $record['pendingWrite'];
            $m::need(isset($attempt_ids[$pending['attemptId'] ?? '']) &&
                $attempt_ids[$pending['attemptId']]['editionId'] === ($pending['editionId'] ?? ''), 'The unresolved original delivery is missing.');
        }
        if ($record['target'] ?? null) {
            $target = $record['target']; $basis = $seen[$target['basisEditionId'] ?? $target['receivedEditionId'] ?? ''] ?? null;
            $m::need($basis && $basis['plan'] && is_array($target['document'] ?? null), 'The original ERP receiving document is missing.');
            $m::need($a::fingerprint($target['document']) === $target['documentSha256'], 'The retained ERP document has changed.');
            if (($target['status'] ?? 'RECEIVED') === 'RECEIVED') {
                $comparison = $a::comparison($basis['plan'], $target['document']);
                $m::need($comparison['matched'] && $comparison['targetKey'] === $target['key'] &&
                    $comparison['lineLinks'] === $target['lineLinks'] && $target['receivedEditionId'] === $basis['id'], 'The retained ERP receiving crosswalk has changed.');
            } else {
                $m::need($target['status'] === 'IDENTIFIED' && $target['receivedEditionId'] === null, 'The retained target disposition is invalid.');
                $all_links = [];
                foreach ($seen as $source_edition) foreach (($source_edition['plan']['lines'] ?? []) as $line) {
                    $all_links[] = ['externalReference'=>$line['payload']['ExternalRef']['value'],'sourceLineId'=>$line['sourceLineId']];
                }
                $identity = $a::identity_check($basis['plan'], $target['document'], $all_links);
                $m::need($identity['identified'] && $identity['targetKey'] === $target['key'] && $identity['lineLinks'] === $target['lineLinks'], 'The retained identified ERP document has changed.');
            }
        }
        return ['record'=>$record,'maps'=>$maps,'sha256'=>$sha,'exportedAt'=>$project['exportedAt'] ?? null];
    }
    static function import_project($request) {
        $body = self::body($request, ['project']); $validated = self::validate_project($body['project'] ?? null);
        if (class_exists('Starforge_SF104_KCF_Project')) Starforge_SF104_KCF_Project::import_companions($body['project']);
        elseif (!empty($body['project']['connectorSources'])) throw new RuntimeException('Install the connector source workspace shipped with this complete ERP project before importing it.',422);
        $record = $validated['record'];
        return Starforge_SF104_Checkout::with_order_lock('erp-mapping', static function () use ($validated, $record) {
            return Starforge_SF104_Checkout::with_order_lock($record['orderId'], static function () use ($validated, $record) {
                global $wpdb; $s = Starforge_SF104_ERP_Store::class; $m = Starforge_SF104_ERP_Map::class;
                $existing = $s::order($record['operationId']);
                if ($existing) {
                    foreach (($existing['imports'] ?? []) as $import) if (($import['sha256'] ?? '') === $validated['sha256']) return self::view($existing) + ['reused'=>true];
                    throw new RuntimeException('This original ERP project is already present. Continue its retained journal; import never replaces a live or divergent history.', 409);
                }
                foreach ($s::for_order($record['orderId']) as $id) if ($id !== $record['operationId']) throw new RuntimeException('This numeric Woo order already has an ERP project in another namespace. Reopen the exported project in its original store.', 409);
                foreach ($validated['maps'] as $id=>$map) if (!$s::map($id)) {
                    $map['checkHistory'] = $map['checkHistory'] ?? [];
                    if ($map['check'] ?? null) $map['checkHistory'][] = $map['check'];
                    $map['check'] = null; $map['importedAt'] = gmdate('c');
                    if ($wpdb->insert($s::table('maps'), ['map_id'=>$id,'data'=>$m::json($map),'created_at'=>gmdate('Y-m-d H:i:s')]) !== 1) throw new RuntimeException('A retained mapping revision could not be imported.', 503);
                }
                $record['imports'] = $record['imports'] ?? [];
                $record['imports'][] = ['sha256'=>$validated['sha256'],'exportedAt'=>$validated['exportedAt'],'sourceRevision'=>$record['revision'],'importedAt'=>gmdate('c'),'operatorId'=>get_current_user_id()];
                $record['imported'] = true; $record['importNeedsReconcile'] = true; $record['state'] = 'IMPORTED';
                $record['approvedEditionId'] = null; $record['approval'] = null;
                $record['issues'] = ['The complete project is retained. Select its map, bind the original Woo source, and reconcile the actual ERP target before delivery.'];
                $record['decisions'][] = self::decision('import', $record['currentEditionId'], 'Reopened the complete original ERP project without replacing another live history.', ['exportSha256'=>$validated['sha256']]);
                $s::save($record, 0); return self::view($record);
            });
        });
    }
}
Starforge_SF104_ERP::boot();
require_once __DIR__ . '/merchant-erp-console.php';
