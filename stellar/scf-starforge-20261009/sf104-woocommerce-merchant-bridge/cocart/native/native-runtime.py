#!/usr/bin/env python3
"""Own an ordinary PHP/MariaDB/WooCommerce receiving instance and its lifetime."""
from __future__ import annotations
import argparse, contextlib, hashlib, json, os, pathlib, secrets, shutil, signal, socket, stat, subprocess, sys, tarfile, time, urllib.request, uuid, zipfile
from datetime import datetime, timezone

SCHEMA = "tjlabs.cocart-native-store/v1"
PLUGIN_COMMIT = "6a3a613936c1abc1d5d8b78cc920d862b1ae542d"
BRIDGE_COMMIT = "8bc1c6168fce0392f74bfea8b7d0efd387cd48f2"
PLUGIN_ARCHIVE_SHA256 = "3165184e7a50eafc82f499e1091e55ede447ce1ebd35f759e99efa6cb28e8102"
SDK_ARCHIVE_SHA256 = "dda3aa36e2163dfe4e4febbfbde64b55d38db4e8b161e939e0c4bcd63ec9fec8"
PLUGIN_FILES = ["starforge-sf98-woo.php", "checkout-gateway.php", "checkout-admission.php", "merchant-console.php", "merchant-console.js", "merchant-console.css", "merchant-operator.php", "merchant-refunds.php", "merchant-refunds.js", "merchant-refunds.css", "refund-networks.json"]
def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
def sha(data):
    return hashlib.sha256(data).hexdigest()
def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
def jread(path):
    return json.loads(pathlib.Path(path).read_text())
def jwrite(path, value, private=False):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".new")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    if private:
        temp.chmod(0o600)
    temp.replace(path)
def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)
def phps(value):
    return "'" + str(value).replace("\\", "\\\\").replace("'", "\\'") + "'"
def reserve_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]
def extract_zip(source, destination, prefix=None):
    destination = pathlib.Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        for entry in entries:
            name = entry.filename
            if prefix is not None:
                if not name.startswith(prefix):
                    raise ValueError("Unexpected archive root: " + name)
                name = name[len(prefix):]
            if not name:
                continue
            path = pathlib.PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError("Unsupported archive member: " + entry.filename)
            output = destination.joinpath(*path.parts)
            if entry.is_dir():
                output.mkdir(parents=True, exist_ok=True)
            else:
                output.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(entry) as reader, output.open("wb") as writer:
                    shutil.copyfileobj(reader, writer)
def extract_sdk(source, destination):
    pathlib.Path(destination).mkdir(parents=True, exist_ok=True)
    with tarfile.open(source, "r:gz") as archive:
        for entry in archive:
            parts = pathlib.PurePosixPath(entry.name).parts
            if not parts or parts[0] != "package" or ".." in parts or entry.issym() or entry.islnk():
                raise ValueError("Unsupported SDK member: " + entry.name)
            output = pathlib.Path(destination).joinpath(*parts)
            if entry.isdir():
                output.mkdir(parents=True, exist_ok=True)
            elif entry.isfile():
                output.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(entry) as reader, output.open("wb") as writer:
                    shutil.copyfileobj(reader, writer)
            else:
                raise ValueError("Unsupported SDK entry type.")
    package = jread(pathlib.Path(destination)/"package/package.json")
    if package.get("name") != "@cocartheadless/sdk" or package.get("version") != "1.2.1" or package.get("dependencies"):
        raise ValueError("The SDK dependency does not match the selected original release.")

class Runtime:
    def __init__(self, args):
        self.args = args
        self.root = pathlib.Path(args.root).resolve()
        self.donor = pathlib.Path(args.php_runtime).resolve()
        self.bin = self.donor/"root/usr"
        self.php = self.bin/"bin/php8.3"
        self.mysql = self.bin/"bin/mariadb"
        self.daemon = self.bin/"sbin/mariadbd"
        self.wpcli = self.donor/"downloads/wp-cli.phar"
        self.wp = self.root/"wordpress"
        self.children = []
        self.logs = []
        self.manifest = None
        self.creds = None
        self.env = dict(os.environ)
        self.checkpoint_dir=pathlib.Path(args.checkpoint_dir).resolve() if args.checkpoint_dir else None
        if self.checkpoint_dir:
            self.checkpoint_dir.mkdir(parents=True,exist_ok=True)
            self.env["COCART_CHECKPOINT_DIR"]=str(self.checkpoint_dir)
        self.env.update({
            "LD_LIBRARY_PATH": str(self.bin/"lib/x86_64-linux-gnu"),
            "PHPRC": str(self.root/"config/php.ini"),
            "PHP_INI_SCAN_DIR": "",
            "TMPDIR": str(self.root/"tmp"),
            "WP_CLI_CACHE_DIR": str(self.root/"cache"),
            "PATH": str(self.bin/"bin") + ":" + os.environ.get("PATH",""),
        })
    def record(self, kind, **values):
        row = dict(at=now(),kind=kind,**values)
        with (self.root/"operation.jsonl").open("a") as stream:
            stream.write(json.dumps(row,ensure_ascii=False)+"\n")
        if self.checkpoint_dir:
            with (self.checkpoint_dir/"runtime-events.jsonl").open("a") as stream:
                stream.write(json.dumps(row,ensure_ascii=False)+"\n")
        return row
    def checkpoint(self,status,error=None):
        if not self.checkpoint_dir:return
        manifest={"schema":"tjlabs.cocart-native-checkpoint/v1","status":status,"at":now(),"instanceId":(self.manifest or {}).get("instanceId"),"root":str(self.root)}
        if error:manifest["error"]=str(error)
        jwrite(self.checkpoint_dir/"Runtime_State.json",manifest)
        if self.manifest:jwrite(self.checkpoint_dir/"Native_Instance.json",self.manifest)
        selected=[]
        for relative in ["exports","headless-workspace","received-headless-workspace","source/woocommerce-native-source.json","source/sf104-source-pins.json","source/cocart-source-pins.json","source/cocart.gitattributes","source/original-mapping-source.json","operation.jsonl","logs/php-server.log","logs/php-errors.log","logs/receiving-operation.log"]:
            path=self.root/relative
            if path.is_file():selected.append(path)
            elif path.is_dir():selected.extend(p for p in path.rglob("*") if p.is_file())
        if selected:
            target=self.checkpoint_dir/"CoCart_Native_Receiving_Output.zip"
            temporary=target.with_suffix(".zip.new")
            with zipfile.ZipFile(temporary,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
                for path in sorted(selected):archive.write(path,path.relative_to(self.root).as_posix())
            temporary.replace(target)
    def run(self, label, command, *, input_text=None, timeout=180, env=None):
        output = self.root/"logs"/(label+".log")
        with output.open("wb") as stream:
            result = subprocess.run(command, input=input_text.encode() if input_text is not None else None,
                stdout=stream, stderr=subprocess.STDOUT, env=env or self.env, timeout=timeout)
        self.record("command",label=label,exitCode=result.returncode,outputBytes=output.stat().st_size)
        if result.returncode:
            raise RuntimeError(label+" failed with exit "+str(result.returncode)+": "+output.read_text(errors="replace")[-4000:])
        return output.read_text(errors="replace")
    def mysql_connection(self):
        return ["--no-defaults","--protocol=TCP","--host=127.0.0.1","--port="+str(self.manifest["databasePort"]),"--user=root"]
    def php_command(self, *args):
        return [str(self.php), "-c", str(self.root/"config/php.ini"), *map(str,args)]
    def wp_command(self,*args):
        return self.php_command(self.wpcli,"--allow-root","--path="+str(self.wp),"--url="+self.manifest["storeOrigin"],*args)
    def start(self, label, command):
        log=(self.root/"logs"/(label+".log")).open("ab");self.logs.append(log)
        child=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,env=self.env,start_new_session=True)
        self.children.append((label,child))
        self.record("process-start",label=label,pid=child.pid)
        return child
    def prepare(self):
        if self.root.exists() and any(self.root.iterdir()):
            raise ValueError("Preparation requires a new empty root. Reopen the existing owned instance with --reopen.")
        self.root.mkdir(parents=True,exist_ok=True);self.root.chmod(0o700)
        for name in ["config","database","sessions","tmp","run","logs","cache","source","sdk","exports"]:
            (self.root/name).mkdir(exist_ok=True)
        for executable in [self.php,self.mysql,self.daemon,self.wpcli]:
            if not executable.is_file():
                raise ValueError("Missing retained runtime dependency: "+str(executable))
        origin=self.args.origin
        from urllib.parse import urlparse
        u=urlparse(origin)
        if u.scheme!="https" or u.port is not None or u.path not in ("","/") or u.username or u.password or not u.hostname or not u.hostname.endswith(".test"):
            raise ValueError("The receiving origin must be an explicit HTTPS .test hostname without a port or path.")
        pins=jread(self.args.source_pins)
        upstream=jread(self.args.cocart_pins)
        self.manifest={
            "schema":SCHEMA,"instanceId":str(uuid.uuid4()),"createdAt":now(),"storeOrigin":origin.rstrip("/"),
            "bridgeSource":BRIDGE_COMMIT,"cocartSource":PLUGIN_COMMIT,"phpBinary":str(self.php),
            "databaseEngine":"MariaDB","databaseTransport":"TCP loopback","databasePort":reserve_port(),"databaseSocket":"",
            "phpPort":reserve_port(),"sourceFiles":[],"dependencyFiles":[],
            "originalSeedSourceSha256":sha(pathlib.Path(self.args.seed_source).read_bytes()),
        }
        for key,path,expected in [
            ("wordpress",self.args.wordpress_zip,None),
            *([] if self.args.woocommerce_directory else [("woocommerce",self.args.woocommerce_zip,None)]),
            ("cocart",self.args.cocart_zip,PLUGIN_ARCHIVE_SHA256),("sdk",self.args.sdk_tgz,SDK_ARCHIVE_SHA256)]:
            path=pathlib.Path(path);digest=sha(path.read_bytes())
            if expected and digest!=expected:
                raise ValueError("Retained "+key+" archive differs from the selected source.")
            self.manifest["dependencyFiles"].append({"name":key,"filename":path.name,"bytes":path.stat().st_size,"sha256":digest})
        extract_zip(self.args.wordpress_zip,self.wp,"wordpress/")
        if self.args.woocommerce_directory:
            source_wc=pathlib.Path(self.args.woocommerce_directory).resolve()
            header=(source_wc/"woocommerce.php").read_text()
            if "Version: 11.2.1" not in header:
                raise ValueError("The selected native WooCommerce source is not version 11.2.1.")
            destination_wc=self.wp/"wp-content/plugins/woocommerce"
            rows=[]
            for file in sorted(source_wc.rglob("*")):
                if file.is_symlink():
                    raise ValueError("The selected Woo source contains a link: "+str(file))
                relative=file.relative_to(source_wc)
                target=destination_wc/relative
                if file.is_dir():
                    target.mkdir(parents=True,exist_ok=True)
                elif file.is_file():
                    data=file.read_bytes()
                    target.parent.mkdir(parents=True,exist_ok=True)
                    target.write_bytes(data)
                    if target.read_bytes()!=data:
                        raise ValueError("The owned Woo source copy differs: "+str(relative))
                    rows.append({"path":relative.as_posix(),"bytes":len(data),"sha256":sha(data)})
            encoded=(json.dumps(rows,sort_keys=True,separators=(",",":"))+"\n").encode()
            (self.root/"source/woocommerce-native-source.json").write_bytes(encoded)
            self.manifest["dependencyFiles"].append({"name":"woocommerce","kind":"copied-installed-source","version":"11.2.1","sourceDirectory":str(source_wc),"files":len(rows),"bytes":sum(r["bytes"] for r in rows),"manifestSha256":sha(encoded)})
        else:
            extract_zip(self.args.woocommerce_zip,self.wp/"wp-content/plugins")
        plugin=self.wp/"wp-content/plugins/cart-rest-api-for-woocommerce"
        extract_zip(self.args.cocart_zip,plugin,"cocart-community-"+PLUGIN_COMMIT+"/")
        import fnmatch
        attributes=pathlib.Path(self.args.cocart_attributes).read_bytes()
        attributes_pin=next(e["sha"] for e in upstream if e["path"]==".gitattributes")
        if git_blob(attributes)!=attributes_pin:
            raise ValueError("The original Git archive attributes differ.")
        (self.root/"source/cocart.gitattributes").write_bytes(attributes)
        export_rules=[line.split()[0] for line in attributes.decode().splitlines() if line.strip() and not line.lstrip().startswith("#") and "export-ignore" in line.split()[1:]]
        def archive_excludes(path):
            parts=path.split("/")
            for rule in export_rules:
                if rule.startswith("/"):
                    rule=rule[1:]
                    if fnmatch.fnmatchcase(path,rule) or any(fnmatch.fnmatchcase("/".join(parts[:i]),rule) for i in range(1,len(parts))):
                        return True
                elif "/" in rule:
                    if fnmatch.fnmatchcase(path,rule):
                        return True
                elif any(fnmatch.fnmatchcase(part,rule) for part in parts):
                    return True
            return False
        known={entry["path"]:entry["sha"] for entry in upstream if entry["type"]=="blob"}
        excluded=[];verified=[]
        for path,pin in known.items():
            file=plugin/path
            if not file.is_file():
                if archive_excludes(path):
                    excluded.append(path);continue
                raise ValueError("The original CoCart release source is missing: "+path)
            if git_blob(file.read_bytes())!=pin:
                raise ValueError("The original CoCart source file differs: "+path)
            verified.append(path)
        for file in plugin.rglob("*"):
            if file.is_file() and file.relative_to(plugin).as_posix() not in known:
                raise ValueError("The archive contains an unregistered original source file.")
        self.manifest["cocartVerifiedFiles"]=len(verified)
        self.manifest["cocartArchiveExcludedFiles"]=excluded
        extract_sdk(self.args.sdk_tgz,self.root/"sdk")
        bridge=self.wp/"wp-content/plugins/starforge-sf98-woo";bridge.mkdir()
        source=pathlib.Path(self.args.bridge_source)
        for name in PLUGIN_FILES:
            selected=next(p for p in pins if p["name"]==name)
            data=(source/name).read_bytes()
            if git_blob(data)!=selected["sha"]:
                raise ValueError("The selected SF104 source differs: "+name)
            (bridge/name).write_bytes(data)
            self.manifest["sourceFiles"].append({"name":name,"gitBlob":selected["sha"],"sha256":sha(data),"bytes":len(data)})
        self.creds={"dbName":"wp_cocart","dbUser":"tjl_cocart","dbPassword":secrets.token_hex(24),"adminUser":"cocart_operator","adminPassword":secrets.token_urlsafe(32),"webhookSecret":secrets.token_hex(32)}
        jwrite(self.root/"config/private.json",self.creds,True)
        shutil.copyfile(self.args.seed_source,self.root/"source/original-mapping-source.json")
        jwrite(self.root/"source/sf104-source-pins.json",pins)
        jwrite(self.root/"source/cocart-source-pins.json",upstream)
        self.make_php_ini()
        self.write_router()
        jwrite(self.root/"instance.json",self.manifest)
        init=self.bin/"bin/mariadb-install-db"
        self.run("database-initialize",[str(init),"--no-defaults","--user=root","--basedir="+str(self.bin),"--datadir="+str(self.root/"database"),
            "--auth-root-authentication-method=normal","--skip-test-db"],timeout=180)
        self.start_database()
        sql="CREATE DATABASE "+self.creds["dbName"]+" CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\nCREATE USER '"+self.creds["dbUser"]+"'@'127.0.0.1' IDENTIFIED BY '"+self.creds["dbPassword"]+"';\nGRANT ALL PRIVILEGES ON "+self.creds["dbName"]+".* TO '"+self.creds["dbUser"]+"'@'127.0.0.1';\n"
        self.run("database-create",[str(self.mysql),*self.mysql_connection()],input_text=sql)
        self.run("database-application-connect",[str(self.mysql),"--no-defaults","--protocol=TCP","--host=127.0.0.1","--port="+str(self.manifest["databasePort"]),"--user="+self.creds["dbUser"],"--password="+self.creds["dbPassword"],"--database="+self.creds["dbName"],"--execute=SELECT 1"])
        self.make_wp_config()
        self.install_receiving_controls()
        self.run("wordpress-install",self.wp_command("core","install","--url="+self.manifest["storeOrigin"],"--title=Headless checkout receiving","--admin_user="+self.creds["adminUser"],"--admin_password="+self.creds["adminPassword"],"--admin_email=operator@receiving.example","--skip-email"),timeout=180)
        self.run("plugins-activate",self.wp_command("plugin","activate","woocommerce","starforge-sf98-woo","cart-rest-api-for-woocommerce"),timeout=240)
        self.run("native-permalink-structure",self.wp_command("rewrite","structure","/%postname%/"),timeout=120)
        profile_plugin=self.wp/"wp-content/mu-plugins/starforge-cocart-profile.php"
        profile_plugin.write_bytes((source/"cocart/profile-export.php").read_bytes())
        seed=self.root/"source/seed-product.php"
        seed.write_text(SEED_PHP)
        env=dict(self.env,COCART_RUNTIME_ROOT=str(self.root))
        self.run("native-product-seed",self.wp_command("eval-file",seed),timeout=180,env=env)
        self.manifest["seededAt"]=now()
        self.manifest["product"]=jread(self.root/"exports/native-product.json")
        jwrite(self.root/"instance.json",self.manifest)
        self.record("prepared",instanceId=self.manifest["instanceId"],productId=self.manifest["product"]["productId"])
    def reopen(self):
        if not (self.root/"instance.json").is_file():
            raise ValueError("The owned original instance record is missing.")
        self.manifest=jread(self.root/"instance.json")
        if self.manifest.get("schema")!=SCHEMA or self.manifest.get("bridgeSource")!=BRIDGE_COMMIT or self.manifest.get("cocartSource")!=PLUGIN_COMMIT:
            raise ValueError("The existing receiving instance has a different source identity.")
        self.creds=jread(self.root/"config/private.json")
        if self.manifest.get("phpBinary")!=str(self.php):
            raise ValueError("Use this instance's retained PHP runtime.")
        self.make_php_ini();self.write_router();self.start_database()
        self.record("reopened",instanceId=self.manifest["instanceId"])
    def make_php_ini(self):
        extension=self.bin/"lib/php/20230831"
        names=["ctype","curl","dom","exif","fileinfo","iconv","mbstring","mysqlnd","mysqli","pdo","pdo_mysql","phar","simplexml","tokenizer","xml","xmlreader","xmlwriter","zip"]
        text='extension_dir="'+str(extension)+'"\n'+"".join("extension="+n+".so\n" for n in names)
        text+='memory_limit=384M\nmax_execution_time=120\nupload_max_filesize=32M\npost_max_size=32M\ndate.timezone=UTC\nlog_errors=On\ndisplay_errors=Off\n'
        text+='error_log="'+str(self.root/"logs/php-errors.log")+'"\nsession.save_path="'+str(self.root/"sessions")+'"\nupload_tmp_dir="'+str(self.root/"tmp")+'"\n'
        (self.root/"config/php.ini").write_text(text)
    def make_wp_config(self):
        c=self.creds
        text="<?php\n"
        for key,value in {"DB_NAME":c["dbName"],"DB_USER":c["dbUser"],"DB_PASSWORD":c["dbPassword"],"DB_HOST":"127.0.0.1:"+str(self.manifest["databasePort"]),"DB_CHARSET":"utf8mb4","DB_COLLATE":"","WP_HOME":self.manifest["storeOrigin"],"WP_SITEURL":self.manifest["storeOrigin"],"SF98_WEBHOOK_SECRET":c["webhookSecret"]}.items():
            text+="define("+phps(key)+","+phps(value)+");\n"
        for key in ["AUTH_KEY","SECURE_AUTH_KEY","LOGGED_IN_KEY","NONCE_KEY","AUTH_SALT","SECURE_AUTH_SALT","LOGGED_IN_SALT","NONCE_SALT"]:
            text+="define("+phps(key)+","+phps(secrets.token_urlsafe(48))+");\n"
        text+="define('DISABLE_WP_CRON',true);\ndefine('AUTOMATIC_UPDATER_DISABLED',true);\ndefine('DISALLOW_FILE_MODS',true);\ndefine('WP_HTTP_BLOCK_EXTERNAL',true);\ndefine('WP_ACCESSIBLE_HOSTS','127.0.0.1,localhost,[::1]');\ndefine('WP_ENVIRONMENT_TYPE','local');\ndefine('WP_MEMORY_LIMIT','256M');\ndefine('WP_MAX_MEMORY_LIMIT','384M');\n"
        text+="$table_prefix='cocart_';\nif(!defined('ABSPATH'))define('ABSPATH',__DIR__.'/');\nrequire_once ABSPATH.'wp-settings.php';\n"
        (self.wp/"wp-config.php").write_text(text);(self.wp/"wp-config.php").chmod(0o600)
    def install_receiving_controls(self):
        mu=self.wp/"wp-content/mu-plugins";mu.mkdir(exist_ok=True)
        (mu/"tjlabs-cold-receiving.php").write_text("""<?php
/* Owned local receiving: native checkout uses the original loopback store.
   Optional WordPress/Woo admin services have no role in this operation. */
add_filter('pre_http_request', static function($pre,$args,$url){
    $host=strtolower((string)wp_parse_url($url,PHP_URL_HOST));
    if(in_array($host,['127.0.0.1','localhost','[::1]'],true))return $pre;
    return new WP_Error('tjlabs_receiving_external_http_disabled','This owned receiving instance uses local HTTP only.');
},PHP_INT_MAX,3);
add_filter('pre_wp_mail', static function($return,$attributes){return true;},10,2);
add_filter('woocommerce_allow_tracking', '__return_false');
add_filter('woocommerce_admin_disabled', '__return_true');
""")
    def write_router(self):
        from urllib.parse import urlparse
        host=urlparse(self.manifest["storeOrigin"]).hostname
        text="<?php\n$_SERVER['HTTPS']='on';$_SERVER['SERVER_PORT']='443';$_SERVER['HTTP_HOST']="+phps(host)+";$_SERVER['SERVER_NAME']="+phps(host)+";\n"
        text+="$root="+phps(self.wp)+";$path=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH);$file=realpath($root.rawurldecode($path));\n"
        text+="if(is_string($file)&&str_starts_with($file,$root.DIRECTORY_SEPARATOR)&&is_file($file)&&!str_ends_with(strtolower($file),'.php')){if(str_contains($file,'/woocommerce_uploads/')){http_response_code(403);exit;}return false;}\n"
        text+="if(is_string($file)&&str_starts_with($file,$root.DIRECTORY_SEPARATOR)&&is_file($file)&&str_ends_with(strtolower($file),'.php')){chdir(dirname($file));require $file;return true;}\n"
        text+="require $root.'/index.php';\n"
        (self.root/"router.php").write_text(text)
    def start_database(self):
        child=self.start("mariadb",[str(self.daemon),"--no-defaults","--user=root","--basedir="+str(self.bin),"--datadir="+str(self.root/"database"),"--socket=","--bind-address=127.0.0.1","--port="+str(self.manifest["databasePort"]),"--pid-file="+str(self.root/"run/mysql.pid"),"--log-error="+str(self.root/"logs/mariadb-native.log"),
            "--plugin-dir="+str(self.bin/"lib/mysql/plugin"),"--lc-messages-dir="+str(self.bin/"share/mysql"),"--skip-name-resolve",
            "--innodb-use-native-aio=0","--innodb-buffer-pool-size=64M","--innodb-log-file-size=32M","--max-connections=16","--performance-schema=OFF"])
        deadline=time.monotonic()+45
        while time.monotonic()<deadline:
            if child.poll() is not None:
                raise RuntimeError("Owned MariaDB stopped: "+(self.root/"logs/mariadb-native.log").read_text(errors="replace")[-3000:])
            result=subprocess.run([str(self.mysql),*self.mysql_connection(),"--execute=SELECT 1"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=self.env)
            if result.returncode==0:return
            time.sleep(.25)
        raise TimeoutError("Owned MariaDB did not accept its loopback TCP connection.")
    def serve(self):
        child=self.start("php-server",self.php_command("-S","127.0.0.1:"+str(self.manifest["phpPort"]),"-t",self.wp,self.root/"router.php"))
        origin="http://127.0.0.1:"+str(self.manifest["phpPort"])
        deadline=time.monotonic()+60
        while time.monotonic()<deadline:
            if child.poll() is not None:
                raise RuntimeError("Owned PHP server stopped.")
            try:
                with urllib.request.urlopen(origin+"/wp-json/cocart/v2/cart",timeout=15) as response:
                    data=json.loads(response.read())
                    if response.status==200 and isinstance(data,dict):
                        self.record("http-ready",status=200,endpoint="/wp-json/cocart/v2/cart")
                        self.transport=origin
                        return
            except Exception as error:
                last=str(error)
            time.sleep(.4)
        raise TimeoutError("Native CoCart route did not open: "+last)
    def public_state(self):
        return {"schema":SCHEMA,"root":str(self.root),"instanceId":self.manifest["instanceId"],"storeOrigin":self.manifest["storeOrigin"],
            "transportOrigin":self.transport,"product":self.manifest["product"],
            "sdkEntry":str(self.root/"sdk/package/dist/index.js"),
            "profileSource":str(self.root/"exports/native-product.json"),
            "sourceBinding":{"sf104":BRIDGE_COMMIT,"cocart":PLUGIN_COMMIT,"sdk":"@cocartheadless/sdk@1.2.1"}}
    def command(self,row):
        op=row.get("operation")
        if op=="state":return self.public_state()
        if op=="run":
            args=row.get("argv")
            if not isinstance(args,list) or not args or not all(isinstance(x,str) for x in args):
                raise ValueError("Provide the exact executable and argument list.")
            label="receiving-"+str(uuid.uuid4())
            env=dict(self.env,COCART_RUNTIME_ROOT=str(self.root),COCART_WP_ROOT=str(self.wp),COCART_STORE_ORIGIN=self.manifest["storeOrigin"],COCART_TRANSPORT_ORIGIN=self.transport,COCART_SDK_ENTRY=str(self.root/"sdk/package/dist/index.js"),
                COCART_ADMIN_USER=self.creds["adminUser"],COCART_ADMIN_PASSWORD=self.creds["adminPassword"])
            output=self.run(label,args,timeout=int(row.get("timeout",300)),env=env)
            return {"operation":op,"exitCode":0,"output":output[-12000:],"log":str(self.root/"logs"/(label+".log"))}
        if op=="wp":
            args=row.get("args")
            if not isinstance(args,list) or not all(isinstance(x,str) for x in args):
                raise ValueError("Provide native wp-cli arguments.")
            label="wp-"+str(uuid.uuid4())
            output=self.run(label,self.wp_command(*args),timeout=int(row.get("timeout",180)))
            return {"operation":op,"exitCode":0,"output":output[-12000:]}
        if op=="snapshot":
            self.snapshot()
            return {"operation":op,"path":str(self.root/"exports/native-store-public-state.json")}
        if op=="stop":
            return {"operation":op,"instanceId":self.manifest["instanceId"]}
        raise ValueError("Unknown native receiving operation.")
    def snapshot(self):
        query=self.root/"source/export-native-state.php";query.write_text(EXPORT_PHP)
        env=dict(self.env,COCART_RUNTIME_ROOT=str(self.root))
        self.run("native-state-export",self.wp_command("eval-file",query),env=env)
    def close(self):
        for label,child in reversed(self.children):
            if child.poll() is None:
                with contextlib.suppress(ProcessLookupError):os.killpg(child.pid,signal.SIGTERM)
                try:child.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    with contextlib.suppress(ProcessLookupError):os.killpg(child.pid,signal.SIGKILL)
                    child.wait(timeout=10)
            if self.root.exists():
                with contextlib.suppress(Exception):self.record("process-closed",label=label,pid=child.pid,exitCode=child.returncode)
        self.children.clear()
        for log in self.logs:log.close()
        self.logs.clear()

SEED_PHP=r"""<?php
$root=getenv('COCART_RUNTIME_ROOT');
$source=json_decode(file_get_contents($root.'/source/original-mapping-source.json'),true,512,JSON_THROW_ON_ERROR);
$mapping=$source['mapping'];
wp_set_current_user(1);
update_option('woocommerce_currency',$mapping['storefront']['currency']);
update_option('woocommerce_price_num_decimals',2);
update_option('woocommerce_calc_taxes','no');
update_option('woocommerce_enable_guest_checkout','yes');
update_option('woocommerce_enable_signup_and_login_from_checkout','no');
update_option('woocommerce_default_country','US:CO');
update_option('woocommerce_store_city','Denver');
update_option('woocommerce_store_postcode','80202');
update_option('woocommerce_store_address','Receiving instance');
update_option('woocommerce_store_address_2','');
update_option('woocommerce_onboarding_profile',['completed'=>true]);
if(get_option('permalink_structure')!=='/%postname%/')throw new RuntimeException('The native permalink bootstrap was not prepared.');
WC_Install::create_pages();
foreach(['cart'=>'[woocommerce_cart]','checkout'=>'[woocommerce_checkout]'] as $page=>$content){
$id=wc_get_page_id($page);if($id>0)wp_update_post(['ID'=>$id,'post_content'=>$content]);
}
$mapping['approvedBy']=get_current_user_id();$mapping['approvedAt']=gmdate('Y-m-d\TH:i:s\Z');
$mapping=Starforge_SF104_Checkout::mapping($mapping);
$product=new WC_Product_Simple();$product->set_name('Headless checkout receiving pilot');$product->set_status('publish');
$product->set_catalog_visibility('visible');$product->set_virtual(true);$product->set_regular_price($mapping['storefront']['total']);$product->set_price($mapping['storefront']['total']);
$product->set_description('A complete headless cart, native WooCommerce checkout and original Stellar payment handoff.');
$product->update_meta_data(Starforge_SF104_Checkout::PRODUCT_META,$mapping);$id=$product->save();
update_option('woocommerce_sf104_native_settings',['enabled'=>'yes','title'=>'Stellar x402 digital checkout','description'=>'Place the order and download its fixed payment instructions.']);
flush_rewrite_rules(false);
$result=['schema'=>'tjlabs.cocart-native-product/v1','createdAt'=>gmdate('c'),'productId'=>(string)$id,'mapping'=>Starforge_SF104_Checkout::product_mapping(wc_get_product($id)),
'routeExport'=>Starforge_SF104_Checkout::route_declaration(wc_get_product($id)),'storeOrigin'=>Starforge_SF104_Checkout::store_origin(),'checkoutUrl'=>wc_get_checkout_url(),
'headlessProfile'=>Starforge_CoCart_Profile_Export::profile(wc_get_product($id)),
'versions'=>['wordpress'=>get_bloginfo('version'),'woocommerce'=>WC_VERSION,'php'=>PHP_VERSION,'cocart'=>defined('COCART_VERSION')?COCART_VERSION:null]];
file_put_contents($root.'/exports/merchant-profile.json',wp_json_encode($result['headlessProfile'],JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES)."\n");
file_put_contents($root.'/exports/native-product.json',wp_json_encode($result,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES)."\n");
echo wp_json_encode(['productId'=>(string)$id,'versions'=>$result['versions']])."\n";
"""
EXPORT_PHP=r"""<?php
require_once ABSPATH.'wp-admin/includes/plugin.php';
$root=getenv('COCART_RUNTIME_ROOT');$product=json_decode(file_get_contents($root.'/exports/native-product.json'),true);
$orders=wc_get_orders(['limit'=>-1,'orderby'=>'ID','order'=>'ASC']);
$rows=[];
foreach($orders as $order){
 $row=['id'=>(string)$order->get_id(),'status'=>$order->get_status(),'currency'=>$order->get_currency(),'total'=>$order->get_total(),
 'paymentMethod'=>$order->get_payment_method(),'createdAt'=>$order->get_date_created()?$order->get_date_created()->date('c'):null,'items'=>[]];
 foreach($order->get_items() as $item)$row['items'][]=['productId'=>(string)$item->get_product_id(),'quantity'=>(string)$item->get_quantity(),'total'=>$item->get_total()];
 try{$row['snapshot']=Starforge_SF104_Checkout::snapshot($order);}catch(Throwable $e){$row['snapshotFinding']=$e->getMessage();}
 $rows[]=$row;
}
$out=['schema'=>'tjlabs.cocart-native-public-state/v1','exportedAt'=>gmdate('c'),'product'=>$product,'orders'=>$rows,'pluginVersions'=>get_plugins(),'databaseVersion'=>$GLOBALS['wpdb']->db_version()];
file_put_contents($root.'/exports/native-store-public-state.json',wp_json_encode($out,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES)."\n");
echo wp_json_encode(['orders'=>count($rows),'productId'=>$product['productId']])."\n";
"""

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root",required=True);parser.add_argument("--php-runtime",required=True)
    parser.add_argument("--origin",default="https://cocart.sf104.test")
    parser.add_argument("--wordpress-zip");parser.add_argument("--woocommerce-zip");parser.add_argument("--woocommerce-directory");parser.add_argument("--cocart-zip");parser.add_argument("--sdk-tgz")
    parser.add_argument("--bridge-source");parser.add_argument("--source-pins");parser.add_argument("--cocart-pins");parser.add_argument("--cocart-attributes");parser.add_argument("--seed-source")
    parser.add_argument("--reopen",action="store_true");parser.add_argument("--ready-file");parser.add_argument("--command-json");parser.add_argument("--checkpoint-dir")
    args=parser.parse_args()
    runtime=Runtime(args)
    try:
        runtime.reopen() if args.reopen else runtime.prepare()
        runtime.serve()
        state=runtime.public_state()
        if args.ready_file:jwrite(args.ready_file,state)
        emit(dict(event="ready",**state))
        runtime.checkpoint("ready")
        if args.command_json:
            row=jread(args.command_json)
            answer=runtime.command(row)
            emit({"event":"result","requestId":row.get("requestId"),**answer})
        else:
            for line in sys.stdin:
                if not line.strip():continue
                try:
                    row=json.loads(line);answer=runtime.command(row);emit({"event":"result","requestId":row.get("requestId"),**answer})
                    runtime.checkpoint("command-complete")
                    if row.get("operation")=="stop":break
                except Exception as error:
                    runtime.checkpoint("command-error",error)
                    emit({"event":"command-error","error":str(error)})
        runtime.snapshot()
        runtime.checkpoint("complete")
    except Exception as error:
        with contextlib.suppress(Exception):
            if runtime.manifest and runtime.creds:runtime.snapshot()
        with contextlib.suppress(Exception):runtime.checkpoint("error",error)
        emit({"event":"runtime-error","error":str(error),"root":str(runtime.root)})
        return 1
    finally:
        runtime.close()
        if runtime.checkpoint_dir and runtime.root.exists():
            with contextlib.suppress(Exception):
                status=jread(runtime.checkpoint_dir/"Runtime_State.json")
                status["processesClosedAt"]=now()
                jwrite(runtime.checkpoint_dir/"Runtime_State.json",status)
        if runtime.root.exists():
            emit({"event":"closed","root":str(runtime.root),"at":now()})
    return 0

if __name__=="__main__":sys.exit(main())
