#!/usr/bin/env python3
"""Own the original Moodle 4.5 installation and services for complete course receiving."""
from __future__ import annotations
import hashlib, json, os, pwd, secrets, shutil, socket, subprocess, tarfile, time, urllib.request
from pathlib import Path
from urllib.parse import urlparse

PIN = "215f44380bdc3ccf852a3a22e34f8423ff64033a"
ARCHIVE = "https://codeload.github.com/moodle/moodle/tar.gz/" + PIN
def need(ok, message):
    if not ok: raise RuntimeError(message)
def read(file): return json.loads(file.read_text(encoding="utf-8"))
def save(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_name(file.name + ".pending")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2); stream.write("\n")
        stream.flush(); os.fsync(stream.fileno())
    temporary.chmod(0o600); temporary.replace(file)
def sha(file):
    value = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""): value.update(chunk)
    return value.hexdigest()
def phpstring(value): return "'" + str(value).replace("\\", "\\\\").replace("'", "\\'") + "'"
def port_open(port):
    with socket.socket() as client:
        client.settimeout(.3)
        return client.connect_ex(("127.0.0.1", port)) == 0
class OwnedMoodle:
    def __init__(self, config, work, environment, run):
        self.config, self.work, self.env, self.run = config, work, environment, run
        self.private = work / "private"; self.private.mkdir(parents=True, exist_ok=True)
        self.runtime = work / "runtime"; self.runtime.mkdir(parents=True, exist_ok=True)
        self.root = Path(config["moodleRoot"]).resolve() if config.get("moodleRoot") else self.runtime / "moodle"
        self.origin = config.get("origin", "http://127.0.0.1:34355").rstrip("/")
        url = urlparse(self.origin)
        need(url.scheme == "http" and url.hostname == "127.0.0.1" and url.path in {"", "/"} and url.port,
             "The complete receiving origin is an owned explicit loopback HTTP port")
        self.port = url.port; self.children = []; self.handles = []
        self.php = [config["phpExecutable"], *config.get("phpArguments", [])]
        self.setupfile = self.private / "moodle-setup.json"
        self.setup = read(self.setupfile) if self.setupfile.is_file() else {
            "schema": "dpsa.diso.owned-moodle.v1", "operationId": "f47a-dpsa-diso-native-20261012",
            "root": str(self.root), "origin": self.origin, "moodleCommit": PIN,
            "databaseName": "diso_receiving", "databaseUser": "diso",
            "databasePassword": "D9a" + secrets.token_hex(24),
            "adminUser": "diso_admin", "adminPassword": "D!9a" + secrets.token_urlsafe(28),
            "originToken": secrets.token_hex(24), "createdAt": time.time()}
        need(self.setup["root"] == str(self.root) and self.setup["origin"] == self.origin and self.setup["moodleCommit"] == PIN,
             "Resume the original owned Moodle source, site and private accounts")
        save(self.setupfile, self.setup)
    def capture(self, argv, **kwargs):
        result = subprocess.run([str(x) for x in argv], env=self.env, capture_output=True, text=True, **kwargs)
        need(result.returncode == 0, "Original runtime command failed:\n" + result.stderr[-4000:])
        return result.stdout
    def start(self, name, argv):
        log = self.work / "logs" / (name + ".log"); log.parent.mkdir(parents=True, exist_ok=True)
        stream = log.open("ab"); self.handles.append(stream)
        process = subprocess.Popen([str(v) for v in argv], env=self.env, cwd=self.root if self.root.is_dir() else self.work,
                                   stdin=subprocess.DEVNULL, stdout=stream, stderr=subprocess.STDOUT)
        self.children.append(process)
        self.setup.setdefault("children", {})[name] = {"pid": process.pid, "startedAt": time.time(), "log": str(log)}
        save(self.setupfile, self.setup)
        return process
    def original_source(self):
        if self.config.get("moodleRoot"):
            need((self.root / "config.php").is_file(), "Select the original installed receiving Moodle root")
            return
        archive = Path(self.config["moodleArchive"]).resolve() if self.config.get("moodleArchive") else self.runtime / ("moodle-" + PIN + ".tar.gz")
        sourceinfo = self.runtime / "MOODLE_SOURCE.json"
        if sourceinfo.is_file():
            info = read(sourceinfo)
            need(info["commit"] == PIN and archive.is_file() and sha(archive) == info["archiveSha256"],
                 "Reuse the exact retained original Moodle source archive")
        else:
            if self.config.get("moodleArchive"):
                need(archive.is_file() and self.config.get("moodleArchiveSha256") == sha(archive),
                     "Select the complete observed source archive and its actual SHA256")
            elif not archive.is_file():
                temporary = archive.with_suffix(".downloading")
                request = urllib.request.Request(ARCHIVE, headers={"User-Agent": "DISO-course-receiving/2026.10.12"})
                with urllib.request.urlopen(request, timeout=90) as response, temporary.open("wb") as output:
                    shutil.copyfileobj(response, output, 1024 * 1024)
                    output.flush(); os.fsync(output.fileno())
                temporary.replace(archive)
            info = {"repository": "moodle/moodle", "commit": PIN, "archiveUrl": ARCHIVE,
                    "archiveSha256": sha(archive), "archiveBytes": archive.stat().st_size}
            save(sourceinfo, info)
        if not (self.root / "version.php").is_file():
            need(not self.root.exists() or not any(self.root.iterdir()), "Preserve an existing incomplete Moodle tree for native source repair")
            self.root.mkdir(parents=True, exist_ok=True)
            prefix = "moodle-" + PIN + "/"
            with tarfile.open(archive, "r:gz") as bundle:
                members = bundle.getmembers()
                for member in members:
                    if member.name.rstrip("/") == prefix.rstrip("/"): continue
                    need(member.name.startswith(prefix), "Original source archive has its exact committed prefix")
                    relative = member.name[len(prefix):]
                    target = self.root / relative
                    need(not Path(relative).is_absolute() and ".." not in Path(relative).parts,
                         "Original Moodle source remains inside its owned directory")
                    if member.isdir():
                        target.mkdir(parents=True, exist_ok=True)
                    elif member.isfile():
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with bundle.extractfile(member) as input_, target.open("wb") as output:
                            shutil.copyfileobj(input_, output)
                        target.chmod(0o755 if member.mode & 0o111 else 0o644)
                    elif member.issym():
                        link = (target.parent / member.linkname).resolve()
                        need(link.is_relative_to(self.root.resolve()), "Retain only original internal source links")
                        target.parent.mkdir(parents=True, exist_ok=True); target.symlink_to(member.linkname)
                    else: raise RuntimeError("Inspect the original source archive member: " + member.name)
        need((self.root / "admin/cli/install_database.php").is_file(), "The original complete native installer is retained")
    def database(self):
        if self.config.get("moodleRoot"): return
        config = self.config["database"]
        prefix = Path(config["prefix"]).resolve()
        client = config.get("clientExecutable", str(prefix / "bin/mariadb"))
        server = config.get("serverExecutable", str(prefix / "sbin/mariadbd"))
        initializer = config.get("initializerExecutable", str(prefix / "bin/mariadb-install-db"))
        port = int(config.get("port", 34356))
        need(1024 <= port <= 65535 and port != self.port, "Use the original distinct owned database TCP port")
        if self.setup.get("databasePort"): need(self.setup["databasePort"] == port, "Retain the original database endpoint")
        self.setup["databasePort"] = port; save(self.setupfile, self.setup)
        data = self.runtime / "database"; data.mkdir(parents=True, exist_ok=True)
        user = pwd.getpwuid(os.getuid()).pw_name
        if not (data / "mysql").is_dir():
            self.run("initialize-mariadb", [initializer, "--no-defaults", "--basedir=" + str(prefix),
                "--datadir=" + str(data), "--auth-root-authentication-method=normal", "--skip-test-db", "--user=" + user])
        initfile = self.private / "database-init.sql"
        database, dbuser, password = self.setup["databaseName"], self.setup["databaseUser"], self.setup["databasePassword"]
        initfile.write_text("CREATE DATABASE IF NOT EXISTS " + database + " CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n" +
            "CREATE USER IF NOT EXISTS '" + dbuser + "'@'127.0.0.1' IDENTIFIED BY '" + password + "';\n" +
            "GRANT ALL PRIVILEGES ON " + database + ".* TO '" + dbuser + "'@'127.0.0.1';\n", encoding="utf-8")
        initfile.chmod(0o600)
        defaults = self.private / "database-client.cnf"
        defaults.write_text("[client]\nhost=127.0.0.1\nprotocol=tcp\nport=" + str(port) +
            "\nuser=" + dbuser + "\npassword=" + password + "\ndatabase=" + database + "\n", encoding="utf-8")
        defaults.chmod(0o600)
        process = None
        if not port_open(port):
            process = self.start("mariadb", [server, "--no-defaults", "--basedir=" + str(prefix), "--datadir=" + str(data),
                "--user=" + user, "--bind-address=127.0.0.1", "--port=" + str(port), "--socket=",
                "--init-file=" + str(initfile), "--pid-file=" + str(self.runtime / "database.pid"),
                "--plugin-dir=" + str(prefix / "lib/mysql/plugin"), "--lc-messages-dir=" + str(prefix / "share/mysql"),
                "--skip-name-resolve", "--innodb-use-native-aio=0", "--innodb-buffer-pool-size=64M",
                "--innodb-log-file-size=32M", "--max-connections=12", "--thread-stack=299008", "--performance-schema=OFF"])
        self.dbcommand = [client, "--defaults-extra-file=" + str(defaults), "--batch", "--skip-column-names"]
        deadline = time.monotonic() + 90; last = ""
        while time.monotonic() < deadline:
            if process is not None and process.poll() is not None:
                raise RuntimeError("Original MariaDB exited; read the retained mariadb.log for this same operation")
            result = subprocess.run([*self.dbcommand, "--execute=SELECT @@datadir, VERSION()"], env=self.env,
                                    capture_output=True, text=True)
            if result.returncode == 0:
                path, version = result.stdout.strip().split("\t", 1)
                need(Path(path).resolve() == data.resolve(), "The original database belongs to this operation")
                self.setup["mariadbVersion"] = version; save(self.setupfile, self.setup); break
            last = result.stderr[-1600:]; time.sleep(.4)
        else: raise RuntimeError("Original MariaDB did not become ready: " + last)
    def installation(self):
        loaded = json.loads(self.capture([*self.php, "-r", "echo json_encode(['version'=>PHP_VERSION,'versionId'=>PHP_VERSION_ID,'extensions'=>get_loaded_extensions()]);"]))
        required = {"ctype","curl","dom","fileinfo","gd","iconv","intl","json","mbstring","mysqli","openssl","simplexml","sodium","tokenizer","xml","xmlreader","zip","zlib"}
        need(80100 <= loaded["versionId"] < 80400, "Use the original Moodle4.5 supported PHP8.1–8.3 runtime")
        missing = sorted(required - {x.lower() for x in loaded["extensions"]})
        need(not missing, "The selected original PHP runtime needs its native modules: " + ", ".join(missing))
        self.setup["phpVersion"] = loaded["version"]; self.setup["phpExtensions"] = sorted(loaded["extensions"])
        save(self.setupfile, self.setup)
        configfile = self.root / "config.php"
        if not configfile.is_file():
            need(not self.config.get("moodleRoot"), "An installed original Moodle root retains config.php")
            data = self.runtime / "moodledata"; data.mkdir(parents=True, exist_ok=True)
            settings = {"dbtype": "mariadb", "dblibrary": "native", "dbhost": "127.0.0.1",
                        "dbname": self.setup["databaseName"], "dbuser": self.setup["databaseUser"],
                        "dbpass": self.setup["databasePassword"], "prefix": "mdl_", "wwwroot": self.origin,
                        "dataroot": str(data), "admin": "admin", "lang": "en",
                        "sessioncookie": "DISO_RECEIVING", "upgradekey": self.setup["originToken"]}
            content = "<?php\nunset($CFG);\nglobal $CFG;\n$CFG = new stdClass();\n"
            content += "".join("$CFG->" + key + " = " + phpstring(value) + ";\n" for key, value in settings.items())
            content += "$CFG->dboptions = ['dbpersist'=>false,'dbport'=>" + str(self.setup["databasePort"]) + ",'dbsocket'=>'','dbcollation'=>'utf8mb4_unicode_ci'];\n"
            content += "$CFG->directorypermissions = 0700;\n$CFG->noemailever = true;\n$CFG->enablecompletion = true;\n$CFG->enableavailability = true;\n"
            content += "$CFG->disableupdatenotifications = true;\n$CFG->cookiesecure = false;\nrequire_once(__DIR__ . '/lib/setup.php');\n"
            configfile.write_text(content, encoding="utf-8"); configfile.chmod(0o600)
        if not self.config.get("moodleRoot"):
            count = int(self.capture([*self.dbcommand, "--execute=SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='" + self.setup["databaseName"] + "'"]).strip())
            if count == 0:
                self.setup["installStartedAt"] = time.time(); save(self.setupfile, self.setup)
                self.run("install-original-moodle", [*self.php, self.root / "admin/cli/install_database.php",
                    "--lang=en", "--agree-license", "--adminuser=" + self.setup["adminUser"], "--adminpass=" + self.setup["adminPassword"],
                    "--adminemail=diso-admin@example.invalid", "--fullname=DISO course receiving", "--shortname=DISO receiving"])
        probe = "define('CLI_SCRIPT',true);require(" + phpstring(configfile) + ");require($CFG->dirroot.'/version.php');" + \
            "$admin=get_admin();echo json_encode(['branch'=>$branch,'release'=>$release,'installedVersion'=>$CFG->version??null," + \
            "'adminId'=>$admin?(int)$admin->id:null,'origin'=>$CFG->wwwroot,'completion'=>(bool)$CFG->enablecompletion," + \
            "'availability'=>(bool)$CFG->enableavailability,'mailDisabled'=>(bool)($CFG->noemailever??false)]);"
        info = json.loads(self.capture([*self.php, "-r", probe]))
        need(str(info["branch"]) == "405" and info["adminId"] and info["installedVersion"], "The complete original Moodle4.5 installation is ready")
        need(info["origin"].rstrip("/") == self.origin and info["completion"] and info["availability"] and info["mailDisabled"],
             "The owned receiving installation retains its original origin, completion, availability and local mail settings")
        self.setup["installed"] = info; self.setup["installedAt"] = self.setup.get("installedAt", time.time()); save(self.setupfile, self.setup)
        if not self.config.get("moodleRoot"):
            self.run("configure-course-appearance", [*self.php, self.root / "admin/cli/cfg.php",
                "--component=theme_boost", "--name=brandcolor", "--set=#424242"])
    def web(self):
        identity = self.root / "diso-receiving-identity.txt"
        text = "DISO-RECEIVING " + self.setup["originToken"] + "\n"
        if identity.is_file(): need(identity.read_text() == text, "Reuse this original local Moodle web endpoint")
        else: identity.write_text(text, encoding="utf-8")
        process = None
        if not port_open(self.port):
            process = self.start("moodle-http", [*self.php, "-S", "127.0.0.1:" + str(self.port), "-t", self.root])
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            if process is not None and process.poll() is not None: raise RuntimeError("Original Moodle web service exited; read moodle-http.log")
            try:
                with urllib.request.urlopen(self.origin + "/diso-receiving-identity.txt", timeout=2) as response:
                    actual = response.read().decode()
                need(actual == text, "The observed browser origin serves this exact original Moodle installation")
                return
            except (OSError, TimeoutError): time.sleep(.2)
        raise RuntimeError("The original Moodle browser origin did not become ready")
    def __enter__(self):
        try:
            self.original_source(); self.database(); self.installation(); self.web(); return self
        except Exception:
            self.__exit__(None, None, None); raise
    def __exit__(self, kind, value, traceback):
        # Only Popen children created by this invocation are stopped. Existing
        # services and the retained database/source remain available for resume.
        for process in reversed(self.children):
            if process.poll() is None:
                process.terminate()
                try: process.wait(timeout=20)
                except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=10)
        for stream in self.handles: stream.close()
        self.children = []; self.handles = []
