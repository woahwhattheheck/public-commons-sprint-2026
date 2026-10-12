#!/usr/bin/env python3
"""MIT. One original Commons native admission for the complete Kafka customer operation."""
from pathlib import Path
from types import SimpleNamespace
import argparse
import hashlib
import json
import os
import stat
import sys
import tempfile

OPERATION = "SCF-KAFKA-MERCHANT-8F43-20261012"
SOURCE_PIN = "d6938e1f333d92670a653f47d136b7d7cfb3abfa"
NATIVE = "b93dcc336452c70124f49c62d67c0cd2385295d4d9659254936cc07cad46453e"
HOST_FILES=json.loads("{\"CAPACITY_FAILURE_RECOVERY.md\":{\"sha\":\"6bc76ddf50ccc595d6c76641f289dc89e2955889\",\"mode\":\"0o644\"},\"CLOUD_DISK_ADMISSION.md\":{\"sha\":\"e1f950922da1bbc54b05e768c377ea0a480c319a\",\"mode\":\"0o644\"},\"CLOUD_MEMORY_ADMISSION.md\":{\"sha\":\"c63f80c2b44d41c0845c13c0398fd79c1106b28a\",\"mode\":\"0o644\"},\"NATIVE_ARTIFACT_RETENTION.md\":{\"sha\":\"9cff9f35b3536115a1c88d2e62fce262ad48e0da\",\"mode\":\"0o644\"},\"NATIVE_ARTIFACT_SELECTION.md\":{\"sha\":\"b866a7280161e9b7c61fdd8f855e5c7ece5cf861\",\"mode\":\"0o644\"},\"NATIVE_COMPLETION.md\":{\"sha\":\"9b90a9227b7c6e0341ae1f3333636dc279a18c95\",\"mode\":\"0o644\"},\"NATIVE_FOREGROUND.md\":{\"sha\":\"be17574423b695fdd2f07197b859ca6fd694f627\",\"mode\":\"0o644\"},\"NATIVE_PLACEMENT.md\":{\"sha\":\"56bcca2503b629139a1556682313713ade342e55\",\"mode\":\"0o644\"},\"NATIVE_QUEUE_HISTORY.md\":{\"sha\":\"4fb4aab30c96092c28dd1fe92433e0aa12fe566e\",\"mode\":\"0o644\"},\"NATIVE_RECORD_RELOCATION.md\":{\"sha\":\"ba0d9aad92841dab083f3606aefbee0ea7b9e541\",\"mode\":\"0o644\"},\"RUNTIME_CONSUMERS.md\":{\"sha\":\"06103367a13b181478c0a9413fa13427b2bba85b\",\"mode\":\"0o644\"},\"RUNTIME_DECLARATIONS.md\":{\"sha\":\"c6b089432cb50031068c04be05bdb1921b868009\",\"mode\":\"0o644\"},\"SOURCE_REUSE.md\":{\"sha\":\"495367d5e892509d872f2abcb4edee7616f59adb\",\"mode\":\"0o644\"},\"SWARM_CLOUD_BROWSER.md\":{\"sha\":\"4ff018a68da5b69b2a4d2bc6246ea31cfa0a7865\",\"mode\":\"0o644\"},\"SWARM_CLOUD_CACHE.md\":{\"sha\":\"96db065c3ce0076a95f0e95fcdfaab3148669f38\",\"mode\":\"0o644\"},\"SWARM_CLOUD_ENVIRONMENT.md\":{\"sha\":\"07b6c88cedfe531e2df9430f51fabbcb755b67da\",\"mode\":\"0o644\"},\"WORKER_CAPACITY.md\":{\"sha\":\"9957caf81a7de40e5f46215bd063fdbeaa92b8e2\",\"mode\":\"0o644\"},\"capacity_fairness.py\":{\"sha\":\"3af54bf8637d76646a52e9bbc148814f96403505\",\"mode\":\"0o644\"},\"capacity_recovery.py\":{\"sha\":\"c789218ee10a8152b2f37513f1773fc1873aaf18\",\"mode\":\"0o644\"},\"cloud_cache_workspace.py\":{\"sha\":\"59e0afb5f85c7066f69476734e4a0eb6b60692d4\",\"mode\":\"0o644\"},\"cloud_disk.py\":{\"sha\":\"00954b2cfb49cfd8cf32285e09f6b5475a8e2ad8\",\"mode\":\"0o644\"},\"cloud_job_sources.py\":{\"sha\":\"be62bec9fa03f801ca13ae7dde0276c9ec99d858\",\"mode\":\"0o644\"},\"cloud_job_workflows.py\":{\"sha\":\"a5831ea56a8e5786901dbc838eacb667232ef9c2\",\"mode\":\"0o644\"},\"cloud_job_workspace/CACHE_OPERATIONS.md\":{\"sha\":\"6bb3fc7451112f6d8ca8079784675849af019015\",\"mode\":\"0o644\"},\"cloud_job_workspace/README.md\":{\"sha\":\"fe91c35d0a836bccbc0b140f2599a8767a8fc382\",\"mode\":\"0o644\"},\"cloud_job_workspace/app.js\":{\"sha\":\"b49a47cd52c92e9f97e3ec141d4ab507add26fcf\",\"mode\":\"0o644\"},\"cloud_job_workspace/cache.js\":{\"sha\":\"8d5b95d743f04b1d644047ca9022773d9b9ed2be\",\"mode\":\"0o644\"},\"cloud_job_workspace/index.html\":{\"sha\":\"8fcee00e86ce19a86de03252c5f0c082820ee24b\",\"mode\":\"0o644\"},\"cloud_job_workspace/style.css\":{\"sha\":\"c5cf49bf34f48b91f31907263023803df4b5e3b5\",\"mode\":\"0o644\"},\"cloud_job_workspace.py\":{\"sha\":\"95a9546cfddb7e854ffe43b5f022a2a66104ab0c\",\"mode\":\"0o644\"},\"cloud_memory.py\":{\"sha\":\"e99380609c80101be173183099c4e6a7cd22769f\",\"mode\":\"0o644\"},\"cloud_residency.py\":{\"sha\":\"60b28a472ae21d247566fe414ee115e0578598f7\",\"mode\":\"0o644\"},\"cloud_source_command.py\":{\"sha\":\"533bfef89138d6685f059bcc2256a380810f05ba\",\"mode\":\"0o644\"},\"cloud_source_packet.mjs\":{\"sha\":\"3ce78d882ff5b6ddb12bebd61d5916e0a86d78e2\",\"mode\":\"0o644\"},\"connected_github_source.py\":{\"sha\":\"2f9dfde150cb6c3cbe8b5f8b385b8b4921eb96b3\",\"mode\":\"0o755\"},\"connected_github_source_reuse.py\":{\"sha\":\"b8938853c4d9ddf5e51b213887bd73ea85a6357e\",\"mode\":\"0o644\"},\"heavy_dispatch.py\":{\"sha\":\"a35553e86028a79dfaa1c98b41f7fb88c5917b65\",\"mode\":\"0o644\"},\"heavy_slot.py\":{\"sha\":\"0417a29faf30891130a5adc0e378bfbc9a6d0932\",\"mode\":\"0o644\"},\"native_artifact_retention.py\":{\"sha\":\"718a4e314390df666329f4f10dc260fa58757bcd\",\"mode\":\"0o644\"},\"native_artifact_selection.py\":{\"sha\":\"318eb38b9c4b6323e53e4e4a8dd227b8fdd0fee5\",\"mode\":\"0o644\"},\"native_capacity.py\":{\"sha\":\"0afbac17123d1966669fe72147aee7fd880e93fe\",\"mode\":\"0o644\"},\"native_completion.py\":{\"sha\":\"835b72f255bcd1f5b1ff649a9be5f5ff31aa6c99\",\"mode\":\"0o644\"},\"native_foreground.py\":{\"sha\":\"afb28c62e1635ab329c8c611f90184eeae03398f\",\"mode\":\"0o644\"},\"native_handoff_capacity.py\":{\"sha\":\"3249b2d779b2e0f8a0199588f0bc9c0cda1f27e8\",\"mode\":\"0o644\"},\"native_placement.py\":{\"sha\":\"d90ec7fa6e270fd718a3ee676388847540306eb3\",\"mode\":\"0o644\"},\"native_placement_files.py\":{\"sha\":\"3b0bb442d4d075f2b669ed127634c0232d2c9bba\",\"mode\":\"0o644\"},\"native_reservation.py\":{\"sha\":\"5a3eb43c035827d951998a60683e9b371f5c2041\",\"mode\":\"0o644\"},\"native_result_view.py\":{\"sha\":\"b9a52b40e2a32da20f1ff3fd704acfd73f375177\",\"mode\":\"0o644\"},\"native_runtime_handoff.py\":{\"sha\":\"16373eb1e3160352ade64042ebae5e9c679fc4cb\",\"mode\":\"0o644\"},\"node_dependency_borrow.py\":{\"sha\":\"2f64b8b97a2ce8afb90d30a708ec47d6f999f88c\",\"mode\":\"0o644\"},\"node_lockfile_cache.py\":{\"sha\":\"661566492bb0ae8e44b40b349187c3036b23451e\",\"mode\":\"0o644\"},\"node_package_cache.py\":{\"sha\":\"20b224d96f453de5b7de71c2cb386a3871005a9e\",\"mode\":\"0o644\"},\"offload_build.py\":{\"sha\":\"7ae4b9b51858b8e47c6e5655fd7083cec529ff72\",\"mode\":\"0o644\"},\"run_bounded.py\":{\"sha\":\"05819dc9379cfc2a12c3db2378a5cc2b625ca85b\",\"mode\":\"0o644\"},\"runtime_catalog.py\":{\"sha\":\"dd9b963c1a10d1db2b79d0df4db6766c2a06034f\",\"mode\":\"0o644\"},\"runtime_consumers.py\":{\"sha\":\"6dc59325617ee88728fcad276d25d2abf6301a95\",\"mode\":\"0o644\"},\"runtime_declarations.py\":{\"sha\":\"718c2f35821f0fac28c0d9c661a1d441b834baba\",\"mode\":\"0o644\"},\"runtime_source.py\":{\"sha\":\"2f499158af7971304843bb58bd2136fc4540d9c3\",\"mode\":\"0o644\"},\"swarm_cloud_browser.mjs\":{\"sha\":\"1fe3ccf9efd78d614af21e4d538e7c0bb43d2933\",\"mode\":\"0o644\"},\"swarm_cloud_browser.py\":{\"sha\":\"327494cd43a8bd6790a6a93f960e4ac3c0261cbb\",\"mode\":\"0o755\"},\"swarm_cloud_cache.py\":{\"sha\":\"b84af64cbccda3967003e47d8efdf23f634cebe3\",\"mode\":\"0o644\"},\"swarm_cloud_dependencies.py\":{\"sha\":\"cab4cdf4b06157478b66fea570e377f4794b95d6\",\"mode\":\"0o644\"},\"swarm_cloud_job.py\":{\"sha\":\"d73a913a0cedcb39fb8ebdef325c67962240bf39\",\"mode\":\"0o644\"},\"swarm_cloud_worker.py\":{\"sha\":\"dcc991d9051a6a985253a6a91c108d402b0768e2\",\"mode\":\"0o644\"},\"worker_capacity.py\":{\"sha\":\"9960d377e95526f2919f40e9824ff37799d26158\",\"mode\":\"0o644\"},\"worker_storage.py\":{\"sha\":\"fbf5bbd03cc9eba88c385d7726fb1e5ddaa11238\",\"mode\":\"0o644\"},\"workflow_delivery.py\":{\"sha\":\"9ea9c7cb73a791d3a3faa3050082f168452e04f8\",\"mode\":\"0o644\"},\"workflow_local.py\":{\"sha\":\"5e34636220bcf0b28cbbca44851c225a32c7c3bf\",\"mode\":\"0o644\"},\"NATIVE_ARTIFACT_CHECKPOINTS.md\":{\"sha\":\"4308268532e95de242f809e637667cc182ed8a20\",\"mode\":\"0o644\"},\"cloud_job_workspace/checkpoints.js\":{\"sha\":\"c5c1753c8e713f0a3bf39ee35c23cdb061927a0b\",\"mode\":\"0o644\"},\"native_artifact_checkpoints.py\":{\"sha\":\"6234a05effb3fc69776c889fa00529b5a8936abd\",\"mode\":\"0o644\"}}")
SOURCE_FILES = json.loads("{\"stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/shared.py\":\"5c1bb58409a1f2b0f072387093a63c096896646e\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/contract.py\":\"85cfc7696f22fc2f5d039b97605fbe423b5b39eb\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/transport.py\":\"9fe2bd50a9b3cec980bd5fc73545cecf1dc992b0\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/model.py\":\"0d0ce7f81da40388cbb92027cdb8cafa26a0cc01\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/httpd.py\":\"6663232fffe7de57bdea076665cdb4e2909a96b5\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/managed.py\":\"5e2edca8e80190aaf241c672627d640ab7272f0e\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/cli.py\":\"06143933299eb4d28d8965f0e16f77ada7150656\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/cli.mjs\":\"5ac04952d1f1624edf4ae12bbbc39c99cf12e524\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/browser-assets.json\":\"b59983e9622a77d920b3da2c43ec80a25ae63adf\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/public/index.html\":\"4fb284a77c3d0382526b4bfd64c9b3a0a836cbf9\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/public/app.js\":\"bdf661d1576a8ee569088a56132db18858109cdd\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/kafka/public/style.css\":\"38115616ceaaae1fd4dd93a6726468bd9fa2f8f4\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/application.py\":\"61efda1abe1624087ad3e2ededec350d17063dc0\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/cli.py\":\"f3390c8e60b3b23eb26a2360df72ab6d95c53a91\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/cli.mjs\":\"43221fe7bc81ea0d51487ed274404fe9fa38c2a9\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/ndjson_source.py\":\"7a9f68391f0c7ea2196606ffe0743924214266eb\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/managed.py\":\"33ba0f8ecf87a78825a8b494a96fd871262171e0\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/merchant.mjs\":\"f69b3b00dd3a51b30641f66085d88769f0e8e1d8\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/public/index.html\":\"b788da27a2c3a66e5d754c62c9846a5c47d9baad\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/public/app.js\":\"91ccdeca2d66a46b652d7110f4c1b20edb67b79c\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/public/style.css\":\"b36f889a9b96ae8fbdfc65791c9e299eb686aa73\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/xml/xml_source.py\":\"8f02d9545ae2959f354cff555ddb0e8595f1b8e0\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/xml/workspace.py\":\"24c4fb7ccf08f6d350bcfb4eae6accc251a60a4e\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/xml/server.py\":\"ebc353d198ea0772cea0400c7b523a8d4d51ee39\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/xml/native.mjs\":\"b335d4148f82cc40b3d5bdb08891c0d6b98f67ac\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-handler.mjs\":\"7496dd29c59c23b3bc16c7d24a327a30b867625f\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-cli.mjs\":\"553cf09648e9cc0e06d4ddeb635cca25a193b1c3\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/resource-server.mjs\":\"c13bb0273cb0922071948c522f42a479285a3200\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/developer-portal.mjs\":\"56787ded05cb9a029d30f055d5998c1e8c4f4adb\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/developer/client-export.mjs\":\"a064bbe24b3471854e622f8dd2c490d49fc70f4f\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/release.mjs\":\"83e19ffb77f84f21124f8dbea7cd11bbef38444b\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/seller.mjs\":\"eabd88d563f388bc25e3a68d89d9d687cfe9887c\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/admission.mjs\":\"ee141eb0a9cd858a6cad95d0cd2cd4857ec13ea0\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/handler-execution.mjs\":\"5966bbf721f0cfbdf94059a069df4a5442dac24a\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/request-lifetime.mjs\":\"1ffd645db0dd64409255907e2addbf802d7e2462\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/route-path.mjs\":\"4884fc0106dd3221f80490c1b30aac00c648f433\",\"stellar-forge/payment-auto-catalog/schema-validation.mjs\":\"ca655b81ab92ba81ac5209912543452955313b10\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/http-methods.mjs\":\"06d82311e7cd4ebec0a5421b00f5c57205a673cf\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/multipart.mjs\":\"c19284dc59e2f648f691233b3a31988936b22e41\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/stream-response.mjs\":\"c2a29adc60cec32cf3edc19696a213269346c63b\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/developer/client-generator.mjs\":\"ec33b1c19cff9be71792aa6f7842532388778ceb\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/developer/client-export-contracts.mjs\":\"c4cd2152361c992f6cfdb41b4062db3f20ef3e9d\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/versions.mjs\":\"fe4261675844ca6e2ab89ad59fdc14fff9f1f8e3\",\"stellar/scf-starforge-20261009/sf82-seller-pilot/release-dataset.mjs\":\"ddf465966b9b912839a75f5bf32c44d314e07a4e\",\"stellar-forge/payment-auto-catalog/schema-pattern.mjs\":\"cbd80107c5718667939ef4dfe3a5ec5c53166611\",\"stellar/scf-starforge-20261009/sf31-buyer-client/request-body.mjs\":\"9505955700d595d3fc69aef41dcac48da1570d72\",\"stellar/scf-starforge-20261009/sf31-buyer-client/response-stream.mjs\":\"d84fcd3adbf5a3f262d39ba23b641d56754050ea\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/developer/client-types.mjs\":\"d31b06c40b502d6a4c25dd4895717571461a71e9\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/writer-lease.mjs\":\"ff6d39faa87195e0986327f1b838662f9fb89897\",\"stellar/scf-starforge-20261009/sf82-seller-pilot/release-source-contracts.mjs\":\"3e60b0d6f2f687d3290fbed1553f0a9c647f9475\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/serve.mjs\":\"d211bfdff7ab42d18bbda96ebd0256ea7aa3360e\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/service.mjs\":\"d6373662efe5548c05a2585848b5aada1cc1785f\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/configured-admission.mjs\":\"0f5c9d4026dd888a46a512a3f026c3cad99632ed\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/response-file.mjs\":\"332e84f219644494cc0d3b2c6b089b2641397d6d\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/lifecycle.mjs\":\"669a2b91801d351d8a3fcc227c397aa0650cc183\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/availability/gate.mjs\":\"046a5b025be8b167d3dc142256356f88319afc9b\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/availability/store.mjs\":\"4a3cc142545531b6230e61d654dae5b92132079a\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/response-asset.mjs\":\"ce09c70ced6ff1e4f0330fd3a2f52ad99849e53b\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/developer/client-runtime.mjs\":\"ef70522cad6fa6d979b195a5164c3a5d3eaa2d91\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/developer/request.mjs\":\"ab36be3a4d864dac0b2b336ad4d205df2cd44d2c\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/query-parameters.mjs\":\"320ee0b5500ad24c76372aeca60de92b1d293587\",\"stellar/scf-starforge-20261009/sf89-live-request-admission/index.mjs\":\"1a4939ca1b5596c56edebc2e6efd222871b92518\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/developer/index.html\":\"684a401e4d23d6e49847ec4909d7cae9275b9b1c\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/developer/browser.mjs\":\"fb09624f2ca813ece875cfd2546cc449a7321f1e\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/developer/style.css\":\"1651243b074251cb0148571880cbd4abde4b9b5b\",\"stellar/scf-starforge-20261009/sf30-seller-sdk/examples/dataset-application.mjs\":\"eb2521577a48181e8fc5b66f93f7fdeb6dd95d5d\"}")
TOOL_FILES = json.loads("{\"native-customer-receiving.py\":\"3db6c6ac9a2d25d347c36777a2fc52cc85ce7791\",\"native-customer-browser.mjs\":\"6db30d09de394d721657f72486d38d36f2fa26a6\",\"native-owned-source.py\":\"81822500b51aa710c34c650fe465320acfd8b7b2\",\"native-merchant-receiving.mjs\":\"1843579f4b2eaa1e2620e624e3ec8c1d720f2408\",\"native-lifecycle.py\":\"08edaf4f0bcaddd8c94e0c5d1f05c496ec50394c\",\"RECEIVING.md\":\"ea136fb0bcfd82ebbaca586c77050b2fa9638fe2\",\"original-apache-server.properties\":\"7f1773d354ea1c30e16de259fc87d4b6b389408f\"}")

def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

def private(path):
    path = Path(path).expanduser().absolute()
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or path.resolve() != path or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError("Select this original operation's real private directory: " + str(path))
    return path

def exact_write(path, data):
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if not stat.S_ISREG(path.lstat().st_mode) or path.read_bytes() != data:
                raise RuntimeError("Preserve the original Kafka native command and input: " + path.name)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)

def main():
    parser = argparse.ArgumentParser(description="Use the original full Commons native foreground for Kafka receiving")
    parser.add_argument("--root", required=True)
    parser.add_argument("--records", default="/workspace/scratch/8f4370a17e6f/kafka-native-records")
    parser.add_argument("--host", default="/workspace/scratch/d76c9c89fb9e/native-prepared-stop-20261012/host")
    parser.add_argument("--node", default="/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node")
    parser.add_argument("--browser-executable", default="/workspace/scratch/bc0850d7ba23/browser-runtime/chrome-headless-shell")
    parser.add_argument("--playwright-module", default="/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs")
    parser.add_argument("--resume", action="store_true", help="Resume capacity on the same original retained foreground operation")
    args = parser.parse_args()
    if sys.version_info < (3, 11):
        raise RuntimeError("Use the selected original Python 3.11 or newer")
    os.umask(0o077)
    root = private(args.root)
    records = private(args.records)
    host = Path(args.host).expanduser().resolve(strict=True)
    node = Path(args.node).expanduser().resolve(strict=True)
    chrome = Path(args.browser_executable).expanduser().resolve(strict=True)
    playwright = Path(args.playwright_module).expanduser().resolve(strict=True)
    python = Path(sys.executable).resolve(strict=True)
    for name, path in [("Node", node), ("Chromium", chrome), ("Playwright", playwright)]:
        if not path.is_file():
            raise RuntimeError("Select the actual installed " + name)
    manifest_file = host.parent / "source-manifest.json"
    manifest_bytes = manifest_file.read_bytes()
    receipt = json.loads(manifest_bytes)
    if (receipt.get("schema") != "commons.prepared-stop-install.v1"
            or receipt.get("base") != "46bbfc4da90915400033074f4c72b79582b5d95f"
            or receipt.get("source_bundle") != "9e5d792d3ed1d819b7ed78422ca591c31223a280"
            or receipt.get("host") != str(host)):
        raise RuntimeError("Select the complete original D76C native runtime")
    rows = receipt.get("files")
    if not isinstance(rows, list) or len(rows) != len(HOST_FILES) or {row.get("path") for row in rows} != set(HOST_FILES):
        raise RuntimeError("The selected host needs its whole original 71-file closure")
    for row in rows:
        name = row["path"]
        wanted = HOST_FILES[name]
        path = host / name
        if set(row) != {"path", "sha", "bytes"} or row["sha"] != wanted["sha"]:
            raise RuntimeError("Original native manifest member changed: " + name)
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != int(wanted["mode"], 8):
            raise RuntimeError("Original native source placement changed: " + name)
        raw = path.read_bytes()
        if len(raw) != row["bytes"] or git_blob(raw) != wanted["sha"]:
            raise RuntimeError("Original native source bytes changed: " + name)
    if hashlib.sha256((host / "swarm_cloud_job.py").read_bytes()).hexdigest() != NATIVE:
        raise RuntimeError("Selected original native runtime identity changed")
    materialization_bytes = (root / "source-materialization.json").read_bytes()
    materialization = json.loads(materialization_bytes)
    if (materialization.get("operation") != OPERATION or materialization.get("sourcePin") != SOURCE_PIN
            or materialization.get("status") != "SOURCE_MATERIALIZED" or materialization.get("root") != str(root)):
        raise RuntimeError("Materialize this complete original Kafka capsule at the same root")
    for prefix, files in [(root / "source", SOURCE_FILES), (root, TOOL_FILES)]:
        for name, expected in files.items():
            path = prefix / name
            if not stat.S_ISREG(path.lstat().st_mode) or git_blob(path.read_bytes()) != expected:
                raise RuntimeError("Original Kafka customer source changed: " + name)
    merchant_path = root / "merchant-request.json"
    if not stat.S_ISREG(merchant_path.lstat().st_mode):
        raise RuntimeError("Use the original materialized merchant request")
    merchant_bytes = merchant_path.read_bytes()
    merchant_expected = (json.dumps(materialization.get("merchant"), ensure_ascii=False,
        sort_keys=True, separators=(",", ":")) + "\n").encode()
    if merchant_bytes != merchant_expected:
        raise RuntimeError("The original materialized merchant origin, route or payment bytes changed")
    inventory_bytes = (root / "source-inventory.json").read_bytes()
    inventory = json.loads(inventory_bytes)
    if inventory.get("sourcePin") != SOURCE_PIN or inventory.get("merchantFiles") != SOURCE_FILES:
        raise RuntimeError("The complete original 66-file merchant source inventory changed")
    command = [str(python), "-B", str(root / "native-lifecycle.py"), "--root", str(root),
        "--node", str(node), "--browser-executable", str(chrome), "--playwright-module", str(playwright)]
    runtime_paths = list(dict.fromkeys([str(host), str(python.parent.parent), str(node.parent.parent),
        str(playwright.parent), str(chrome.parent)]))
    artifacts = ["native-job-input.json", "source-materialization.json", "source-inventory.json",
        "merchant-request.json", "RECEIVING.md", "lifecycle-input.json", "lifecycle-result.json",
        "logs", "seed/source-input.json", "seed/result.json", "receiving/result.json",
        "receiving/receipts", "receiving/delivery", "receiving/browser", "receiving/customer",
        "software/software.json", "software/confluent-kafka-install.json"]
    intent = {"schema": "stellar-forge.kafka-native-admission.v1", "operationId": OPERATION,
        "sourcePin": SOURCE_PIN, "project": str(root), "records": str(records), "command": command,
        "nativeHost": str(host), "nativeRuntimeSha256": NATIVE, "nativeSourceBundle": receipt["source_bundle"],
        "nativeManifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "sourceMaterializationSha256": hashlib.sha256(materialization_bytes).hexdigest(),
        "sourceInventorySha256": hashlib.sha256(inventory_bytes).hexdigest(),
        "merchantRequestSha256": hashlib.sha256(merchant_bytes).hexdigest(), "sourceFiles": SOURCE_FILES,
        "receivingFiles": TOOL_FILES, "runtimePaths": runtime_paths, "artifacts": artifacts,
        "memoryMiB": 768, "memoryReserveMiB": 128, "memoryReclaim": "clean-cache",
        "projectStorageMiB": 768, "recordStorageMiB": 128, "brokerClosesBeforeBrowser": True}
    exact_write(root / "native-job-input.json", (json.dumps(intent, sort_keys=True, indent=2) + "\n").encode())
    sys.path.insert(0, str(host))
    # The original native host resolves this existing Node directory through its retained runtime shim.
    os.environ["SWARM_NODE24_BIN"] = str(node.parent)
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    import swarm_cloud_job as native
    from native_foreground import ForegroundLaunch, resume_foreground
    if args.resume:
        report = resume_foreground(native, OPERATION, str(records), action="resume-capacity", report_format="summary")
        if report is not None:
            print(json.dumps({key: report.get(key) for key in ["operation_id", "record", "state",
                "supervisor_alive", "process_alive", "reused"]}), flush=True)
        return 0
    selected = SimpleNamespace(operation_id=OPERATION, peer="8f43-kafka-native-customer", project=str(root),
        command=command, java=None, node="24", artifact=artifacts, artifact_on_success=[],
        artifact_on_failure=[], retain_artifacts=True, runtime_path=runtime_paths,
        runtime_consumers_root="/workspace/shared/swarm/jobs/runtime-consumers",
        memory_mib=768, memory_reserve_mib=128, memory_reclaim="clean-cache",
        memory_reservations_root="/workspace/shared/swarm/capacity/memory",
        disk_space=[str(root) + "=768", str(records) + "=128"],
        disk_inodes=[str(root) + "=8192", str(records) + "=2048"],
        disk_reserve_mib=4, disk_reserve_inodes=128,
        disk_reservations_root="/workspace/shared/swarm/capacity/disk",
        records_root=str(records), worker_root=str(root / "workers"), temp_root=str(root / "temporary"))
    launch = ForegroundLaunch(native)
    try:
        report = native.start(selected, launcher=launch)
        print(json.dumps({key: report.get(key) for key in ["operation_id", "record", "state",
            "supervisor_alive", "process_alive", "reused"]}), flush=True)
    finally:
        if launch.root is not None:
            code = launch.handoff()
            if code is not None:
                return code
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as issue:
        print("Original Kafka native admission: " + str(issue), file=sys.stderr, flush=True)
        sys.exit(1)
