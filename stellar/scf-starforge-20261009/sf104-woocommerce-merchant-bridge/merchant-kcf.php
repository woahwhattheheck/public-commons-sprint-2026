<?php
/** MIT. Authenticated source intake and mapping review in the original Woo merchant application. */
if (!defined('ABSPATH')) { exit; }
require_once __DIR__ . '/merchant-kcf-project.php';

final class Starforge_SF104_KCF {
    const VERSION = '1.0.0';
    const API = '/merchant-kcf';
    static function boot() {
        add_action('init', [Starforge_SF104_KCF_Store::class,'install'], 21);
        add_action('rest_api_init', [__CLASS__,'rest']);
    }
    static function rest() {
        foreach ([
            ['GET','','status'],['POST','/installations','create'],
            ['GET','/installations/(?P<iid>[a-f0-9]{64})','installation'],
            ['POST','/installations/(?P<iid>[a-f0-9]{64})/select','select'],
            ['GET','/installations/(?P<iid>[a-f0-9]{64})/(?P<collection>receipts|editions|recipes|reviews|links|imports)','listing'],
            ['POST','/installations/(?P<iid>[a-f0-9]{64})/receipts','receipt'],
            ['GET','/installations/(?P<iid>[a-f0-9]{64})/receipts/(?P<id>[a-f0-9]{64})','get_receipt'],
            ['GET','/installations/(?P<iid>[a-f0-9]{64})/receipts/(?P<id>[a-f0-9]{64})/browse','browse'],
            ['GET','/installations/(?P<iid>[a-f0-9]{64})/receipts/(?P<id>[a-f0-9]{64})/download','download'],
            ['GET','/installations/(?P<iid>[a-f0-9]{64})/receipts/(?P<id>[a-f0-9]{64})/original','original'],
            ['POST','/installations/(?P<iid>[a-f0-9]{64})/editions','edition'],
            ['GET','/installations/(?P<iid>[a-f0-9]{64})/editions/(?P<id>[a-f0-9]{64})','get_edition'],
            ['POST','/installations/(?P<iid>[a-f0-9]{64})/recipes','recipe'],
            ['POST','/installations/(?P<iid>[a-f0-9]{64})/preview','preview_draft'],
            ['GET','/installations/(?P<iid>[a-f0-9]{64})/recipes/(?P<id>[a-f0-9]{64})','get_recipe'],
            ['GET','/installations/(?P<iid>[a-f0-9]{64})/recipes/(?P<id>[a-f0-9]{64})/preview','preview'],
            ['GET','/installations/(?P<iid>[a-f0-9]{64})/recipes/(?P<id>[a-f0-9]{64})/impacts','impacts'],
            ['POST','/installations/(?P<iid>[a-f0-9]{64})/recipes/(?P<id>[a-f0-9]{64})/apply','apply'],
            ['GET','/installations/(?P<iid>[a-f0-9]{64})/compare','compare'],
            ['POST','/installations/(?P<iid>[a-f0-9]{64})/reviews','review'],
            ['GET','/installations/(?P<iid>[a-f0-9]{64})/reviews/(?P<id>[a-f0-9]{64})','get_review'],
            ['GET','/installations/(?P<iid>[a-f0-9]{64})/operations/(?P<operation>[A-Za-z0-9][A-Za-z0-9_.:-]{7,127})','operation'],
            ['GET','/installations/(?P<iid>[a-f0-9]{64})/export','export'],
            ['POST','/import','import'],
        ] as $route) {
            $method = $route[2];
            register_rest_route('stellar-forge/v1', self::API . $route[1], ['methods'=>$route[0],
                'permission_callback'=>[Starforge_SF104_Merchant_Console::class,'permission'],
                'callback'=>static function ($request) use ($method) {
                    try { return Starforge_SF104_Merchant_Console::reply(call_user_func([__CLASS__,$method],$request)); }
                    catch (Throwable $e) {
                        $code = in_array((int) $e->getCode(), [400,403,404,409,413,422,503], true) ? (int) $e->getCode() : 503;
                        return Starforge_SF104_Merchant_Console::reply(['error'=>'sf104_connector_error','message'=>$e->getMessage()],$code);
                    }
                }]);
        }
    }
    static function body($r) {
        if (strlen($r->get_body()) > Starforge_SF104_KCF_Store::MAX_PACKAGE + 4096) throw new RuntimeException('This complete request exceeds the 32 MiB private project limit.',413);
        $body = $r->get_json_params();
        Starforge_SF104_KCF_Source::need(is_array($body), 'Supply the selected JSON operation.'); return $body;
    }
    static function page($r) {
        $fn = [Starforge_SF104_Merchant_Console::class,'integer'];
        return [call_user_func($fn,$r['page'],1,1,1000000),call_user_func($fn,$r['limit'],50,1,200)];
    }
    static function status($r) {
        [$page,$limit] = self::page($r);
        $out = Starforge_SF104_KCF_Store::listing(null,'installation',$page,$limit);
        foreach ($out['items'] as &$item) $item['head'] = Starforge_SF104_KCF_Store::head($item['id']); unset($item);
        return $out + ['schema'=>'stellar-forge.sf104.connector-status.v1','version'=>self::VERSION,'observedAt'=>gmdate('c'),
            'families'=>Starforge_SF104_KCF_Source::FAMILIES,'coverage'=>['COMPLETE','PARTIAL','SINGLE_ENTITY','UNKNOWN'],
            'limits'=>['fileBytes'=>Starforge_SF104_KCF_Source::MAX_FILE,'rows'=>Starforge_SF104_KCF_Source::MAX_ROWS,'projectBytes'=>Starforge_SF104_KCF_Store::MAX_PACKAGE],
            'mappingFields'=>Starforge_SF104_KCF_Mapping::HEADERS,'mappingTables'=>Starforge_SF104_KCF_Mapping::TABLES,
            'currentMapId'=>get_option('sf104_erp_current_map',''),'maps'=>Starforge_SF104_ERP_Store::map_summaries(),
            'transport'=>['kind'=>'RETAINED_UI_EXPORT','liveKcfApiConfigured'=>false,'meaning'=>'Import the actual installed configuration, schema-screen JSON or exported CSV. This workspace does not infer a vendor HTTP API.']];
    }
    static function create($r) { return Starforge_SF104_KCF_Store::create(self::body($r)); }
    static function installation($r) {
        return ['installation'=>Starforge_SF104_KCF_Store::typed($r['iid'],$r['iid'],'installation'),
            'head'=>Starforge_SF104_KCF_Store::head($r['iid']),'currentMapId'=>get_option('sf104_erp_current_map',''),'observedAt'=>gmdate('c')];
    }
    static function listing($r) {
        [$p,$n] = self::page($r); $k = ['receipts'=>'receipt','editions'=>'edition','recipes'=>'recipe','reviews'=>'review','links'=>'map-link','imports'=>'import-receipt'][$r['collection']];
        Starforge_SF104_KCF_Store::typed($r['iid'],$r['iid'],'installation');
        return Starforge_SF104_KCF_Store::listing($r['iid'],$k,$p,$n);
    }
    static function receipt($r) { return Starforge_SF104_KCF_Store::receipt($r['iid'],self::body($r)); }
    static function get_receipt($r) { return Starforge_SF104_KCF_Store::typed($r['id'],$r['iid'],'receipt'); }
    static function browse($r) {
        [$p,$n] = self::page($r); $receipt = self::get_receipt($r);
        return Starforge_SF104_KCF_Source::browse(Starforge_SF104_KCF_Store::tree($receipt),$r['pointer'] ?? '',$p,$n) +
            ['receiptId'=>$receipt['id'],'originalSha256'=>$receipt['sha256'],'scope'=>$receipt['scope'],'profile'=>$receipt['profile']];
    }
    static function original($r) {
        $receipt = self::get_receipt($r); $blob = Starforge_SF104_KCF_Store::typed($receipt['blobId'],null,'blob');
        Starforge_SF104_KCF_Store::blob_bytes($blob);
        return ['receiptId'=>$receipt['id'],'name'=>$receipt['name'],'format'=>$receipt['format'],'sha256'=>$blob['sha256'],'bytes'=>$blob['bytes'],'contentBase64'=>$blob['contentBase64']];
    }
    static function download($r) {
        $receipt = self::get_receipt($r); $bytes = Starforge_SF104_KCF_Store::blob_bytes(Starforge_SF104_KCF_Store::typed($receipt['blobId'],null,'blob'));
        nocache_headers(); header('Content-Type: application/octet-stream'); header('Content-Length: ' . strlen($bytes));
        header('Content-Disposition: attachment; filename="source-' . substr($receipt['sha256'],0,12) . '.' . $receipt['format'] . '"');
        header('X-Content-Type-Options: nosniff'); echo $bytes; exit;
    }
    static function edition($r) { return Starforge_SF104_KCF_Store::edition($r['iid'],self::body($r)); }
    static function get_edition($r) { return Starforge_SF104_KCF_Store::edition_detail($r['iid'],$r['id']); }
    static function recipe($r) { return Starforge_SF104_KCF_Store::recipe($r['iid'],self::body($r)); }
    static function get_recipe($r) { return Starforge_SF104_KCF_Store::typed($r['id'],$r['iid'],'recipe'); }
    static function preview($r) { return Starforge_SF104_KCF_Mapping::preview($r['iid'],self::get_recipe($r)); }
    static function preview_draft($r) {
        $b = self::body($r); Starforge_SF104_KCF_Source::keys($b,['recipe'],'The draft preview');
        $x = $b['recipe'] ?? []; Starforge_SF104_KCF_Source::keys($x,['sourceEditionId','baseMapId','label','assignments','removals','substitutions','acknowledgeLookupPriority','reason'],'The draft recipe');
        $x += ['id'=>null,'assignments'=>[],'removals'=>[],'substitutions'=>null,'acknowledgeLookupPriority'=>false];
        Starforge_SF104_KCF_Source::id($x['sourceEditionId'] ?? ''); Starforge_SF104_KCF_Source::id($x['baseMapId'] ?? '');
        return Starforge_SF104_KCF_Mapping::preview($r['iid'],$x);
    }
    static function impacts($r) { [$p,$n] = self::page($r); return Starforge_SF104_KCF_Store::impacts($r['iid'],$r['id'],$p,$n); }
    static function apply($r) { return Starforge_SF104_KCF_Mapping::apply($r['iid'],$r['id'],self::body($r)); }
    static function compare($r) {
        [$p,$n] = self::page($r); $s = Starforge_SF104_KCF_Source::class;
        return Starforge_SF104_KCF_Mapping::compare($r['iid'],$s::id($r['before'] ?? ''),$s::id($r['after'] ?? ''),
            $s::text($r['change'] ?? 'all',64,'change filter'),$s::text($r['q'] ?? '',200,'source search',true),$p,$n);
    }
    static function review($r) {
        $iid = $r['iid']; $b = self::body($r); $s = Starforge_SF104_KCF_Source::class;
        $s::keys($b,['operationId','expectedRevision','beforeId','afterId','selectionSha256','disposition','reason','recipeId'],'The source change review');
        $s::need(in_array($b['disposition'] ?? '',['RETAIN_MAPPING','REVISE_MAPPING','RECAPTURE_SCOPE'],true),'Select the actual source-review decision.');
        return Starforge_SF104_KCF_Store::change($iid,'review',$b,static function () use ($iid,$b,$s) {
            $c = Starforge_SF104_KCF_Mapping::compare($iid,$s::id($b['beforeId'] ?? ''),$s::id($b['afterId'] ?? ''),'all','',1,1);
            $s::need(hash_equals($s::id($b['selectionSha256'] ?? ''),$c['selectionSha256']),'The reviewed comparison selection changed.',409);
            $recipe = $b['recipeId'] ?? '';
            if ($recipe !== '') { $r = Starforge_SF104_KCF_Store::typed($s::id($recipe),$iid,'recipe'); $s::need($r['sourceEditionId'] === $b['afterId'],'The linked recipe uses a different source edition.'); }
            $id = $s::digest([$iid,'review',$b['operationId']]);
            $record = ['id'=>$id,'kind'=>'review','installationId'=>$iid,'beforeId'=>$b['beforeId'],'afterId'=>$b['afterId'],'selectionSha256'=>$c['selectionSha256'],
                'disposition'=>$b['disposition'],'recipeId'=>$recipe,'reason'=>$s::text($b['reason'] ?? '',4000,'review reason'),
                'counts'=>$c['counts'],'scopes'=>$c['scopes'],'createdAt'=>gmdate('c'),'actor'=>get_current_user_id(),'operationId'=>$b['operationId']];
            Starforge_SF104_KCF_Store::put($id,$iid,'review',$record);
            return ['review'=>$record,'head'=>Starforge_SF104_KCF_Store::advance($iid,$b['expectedRevision'] ?? null,[],$b['operationId']),'mappingChanged'=>false];
        });
    }
    static function get_review($r) { return Starforge_SF104_KCF_Store::typed($r['id'],$r['iid'],'review'); }
    static function select($r) {
        $iid = $r['iid']; $b = self::body($r); $s = Starforge_SF104_KCF_Source::class;
        $s::keys($b,['operationId','expectedRevision','editionId','recipeId','reason'],'The retained selection');
        return Starforge_SF104_KCF_Store::change($iid,'select',$b,static function () use ($iid,$b,$s) {
            $edition = Starforge_SF104_KCF_Store::typed($s::id($b['editionId'] ?? ''),$iid,'edition');
            $recipe = $b['recipeId'] ?? '';
            if ($recipe !== '') { $r = Starforge_SF104_KCF_Store::typed($s::id($recipe),$iid,'recipe'); $s::need($r['sourceEditionId'] === $edition['id'],'The recipe belongs to a different source edition.'); }
            $s::text($b['reason'] ?? '',4000,'selection reason');
            return ['head'=>Starforge_SF104_KCF_Store::advance($iid,$b['expectedRevision'] ?? null,['currentEditionId'=>$edition['id'],'currentRecipeId'=>$recipe],$b['operationId']),'mappingChanged'=>false];
        });
    }
    static function operation($r) {
        Starforge_SF104_KCF_Store::typed($r['iid'],$r['iid'],'installation');
        $op = Starforge_SF104_KCF_Store::op($r['iid'],$r['operation']);
        if (!$op) throw new RuntimeException('No result is retained for this operation ID. Retry the exact original request if its response was interrupted.',404);
        return $op + ['head'=>Starforge_SF104_KCF_Store::head($r['iid']),'currentMapId'=>get_option('sf104_erp_current_map','')];
    }
    static function export($r) {
        $include = $r['includeOrders'] ?? 'true'; Starforge_SF104_KCF_Source::need(in_array($include,['true','false'],true),'Select whether to include the complete related order projects.');
        return Starforge_SF104_KCF_Project::export($r['iid'],$include === 'true');
    }
    static function import($r) { return Starforge_SF104_KCF_Project::import(self::body($r)); }
}
Starforge_SF104_KCF::boot();
require_once __DIR__ . '/merchant-kcf-console.php';
