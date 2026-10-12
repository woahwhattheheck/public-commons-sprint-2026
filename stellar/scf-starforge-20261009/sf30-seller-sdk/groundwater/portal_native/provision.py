"""Native Tethys setup/readback phases. Called only in the selected portal Python."""
from __future__ import annotations
import argparse
import hashlib
import importlib.metadata as md
import json
import os
from pathlib import Path
import sqlite3
import sys
import zipfile

sys.dont_write_bytecode=True
from common import digest, git_sha, info, inventory, publish, publish_bytes, read, require, verify

HERE=Path(__file__).resolve().parent
CAPSULE_SHA="e0ea40cad53386320062f30b6c2a480859058008"

def installed(context, *, include_application=True):
    import tethys_portal
    require(md.version("tethys-platform")=="4.6.1","The installed portal is not the selected Tethys 4.6.1.")
    require(sys.version_info>=(3,11),"The composed portal requires Python 3.11 or later.")
    upstream=read(HERE/"UPSTREAM.json")
    site=Path(tethys_portal.__file__).resolve().parent.parent
    observed=[]
    for expected in upstream["files"]:
        path=site/expected["path"]
        raw=path.read_bytes()
        require(len(raw)==expected["bytes"] and git_sha(raw)==expected["git_blob_sha"],
                "The installed upstream source differs from the reviewed Tethys commit: "+expected["path"])
        observed.append({"path":expected["path"],"git_blob_sha":expected["git_blob_sha"],**info(path)})
    result={"python":sys.version,"executable":sys.executable,"prefix":sys.prefix,
            "tethys":md.version("tethys-platform"),"django":md.version("Django"),
            "upstream":observed,"dependencies":{d.metadata["Name"]:d.version for d in sorted(md.distributions(),key=lambda d:d.metadata["Name"].lower())
                if include_application or d.metadata["Name"].lower().replace("_","-") not in ("starforge-groundwater-workspace","stellar-groundwater-tethys")}}
    if include_application:
        django_setup(context)
        import groundwater_workspace
        from tethysapp.groundwater_workshare.app import App
        require(md.version("starforge-groundwater-workspace")=="1.0.0"
                and md.version("stellar-groundwater-tethys")=="1.0.0","The original core or adapter version differs.")
        capsule=read(context["source_capsule"],2097152)
        from groundwater_workspace.store import APPLICATION
        for expected in capsule["manifest"]:
            target=APPLICATION/expected["path"]
            raw=target.read_bytes()
            require(git_sha(raw)==expected["git_blob_sha"] and len(raw)==expected["bytes"],
                    "The installed complete application differs: "+expected["path"])
            if expected["path"].startswith("groundwater_workspace/"):
                actual=Path(groundwater_workspace.__file__).parent/expected["path"].split("/",1)[1]
                require(git_sha(actual.read_bytes())==expected["git_blob_sha"],"The imported original core differs.")
            marker="tethys_app/tethysapp/groundwater_workshare/"
            if expected["path"].startswith(marker):
                import tethysapp.groundwater_workshare
                actual=Path(tethysapp.groundwater_workshare.__file__).parent/expected["path"][len(marker):]
                require(git_sha(actual.read_bytes())==expected["git_blob_sha"],"The imported original adapter differs.")
        result["application"]={"directory":str(APPLICATION),"core":str(Path(groundwater_workspace.__file__).resolve()),
                               "files":len(capsule["manifest"]),"source_head":capsule["source_head"]}
    return result

def django_setup(context):
    database_path=Path(context["portal_home"])/"portal.sqlite3"
    require(database_path.is_file() and not database_path.is_symlink(),"The original configured portal database is missing; no replacement was initialized.")
    os.environ["DJANGO_SETTINGS_MODULE"]="tethys_portal.settings"
    require(Path(os.environ["TETHYS_HOME"]).resolve()==Path(context["portal_home"]).resolve(),"The selected private portal home changed.")
    import django
    django.setup()
    from django.conf import settings
    actual=Path(settings.DATABASES["default"]["NAME"]).resolve()
    require(settings.DATABASES["default"]["ENGINE"]=="django.db.backends.sqlite3"
            and actual==Path(context["portal_home"])/"portal.sqlite3","The original portal database configuration changed.")
    require(settings.USE_OLD_WORKSPACES_API is False,"The actual portal must use the current private Paths API.")
    require(settings.ENABLE_OPEN_PORTAL is False and settings.ENABLE_RESTRICTED_APP_ACCESS is True,
            "Use the selected restricted-account portal configuration.")
    require(Path(settings.TETHYS_WORKSPACES_ROOT).resolve()==Path(context["portal_home"])/"workspaces",
            "Native private workspaces must remain inside the selected portal.")
    return settings

def permission_state(user, app):
    names=("view_workspace","edit_workspace","review_workspace","execute_runs",
           "configure_runtime","publish_reports","receive_reports","backup_workspace","use_shared_workspace")
    return {name:user.has_perm("tethys_apps.groundwater_workshare:"+name,app) for name in names}

def account_setup(context, *, verify_only=False):
    django_setup(context)
    from django.contrib.auth import get_user_model
    from django.contrib.auth.models import Group
    from django.db import transaction
    from guardian.shortcuts import assign_perm
    from tethys_apps.models import TethysApp
    from tethysapp.groundwater_workshare.app import App
    from tethysapp.groundwater_workshare.policy import configuration, context_for_user
    # This is the actual upstream registration, not a local permission projection.
    if not verify_only:
        App().register_app_permissions()
    app=TethysApp.objects.get(package=App.package)
    secrets=read(context["credentials_file"],65536)
    expected_groups={"operator":"groundwater_operator","reader":"groundwater_reader"}
    expected_permissions={
        "operator":{"view_workspace","edit_workspace","review_workspace","execute_runs","publish_reports","receive_reports","backup_workspace"},
        "reader":{"view_workspace"},
    }
    users=get_user_model();observed={}
    with transaction.atomic():
        for role in ("operator","reader"):
            entry=secrets["accounts"][role];name=entry["username"]
            user=users._default_manager.filter(**{users.USERNAME_FIELD:name}).first()
            if user is None:
                require(not verify_only,"The original portal account is missing; it was not recreated.")
                user=users._default_manager.create_user(**{users.USERNAME_FIELD:name,"email":entry["email"],"password":entry["password"]})
            require(user.is_active and not user.is_staff and not user.is_superuser,
                    "This demonstration must use the original ordinary active account, without a privileged bypass.")
            require(user.check_password(entry["password"]) and user.email==entry["email"],
                    "The retained account no longer matches its original credential identity.")
            group=Group.objects.get(name=App.package+":"+expected_groups[role])
            if not verify_only:
                user.groups.add(group)
                assign_perm(App.package+":access_app",user,app)
            # A fresh object avoids any previously cached object permissions.
            user=users._default_manager.get(pk=user.pk)
            observed_permissions=permission_state(user,app)
            require({n for n,v in observed_permissions.items() if v}==expected_permissions[role],
                    "The ordinary account has a different original feature-permission set.")
            require(user.has_perm("tethys_apps."+App.package+":access_app",app),"The native app-access grant is absent.")
            require(set(user.groups.values_list("name",flat=True))=={group.name},"The account has a different original group membership.")
            observed[role]={"id":str(user.pk),"username":user.get_username(),"is_staff":False,"is_superuser":False,
                            "group":group.name,"permissions":observed_permissions,"access_app":True}
    config=configuration()
    require(config["workspace_scope"]=="user","This receiving uses the actual private user scope.")
    from django.urls import reverse
    observed["portal"]={"home":reverse("groundwater_workshare:home"),"login":reverse("accounts:login"),
                       "database":str(Path(context["portal_home"])/"portal.sqlite3"),"configuration":config}
    saved=Path(context["output_directory"])/"accounts.json"
    if verify_only:
        require(read(saved)==observed,"The original account or native portal address changed.")
    else:
        publish(saved,observed)
    return observed

def original_selection(context):
    """Derive selections from the actual completed run and its immutable backup DB."""
    from groundwater_workspace.delivery import inspect_package
    native=read(context["native_result"]["path"])
    verify(context["native_result"]["path"],context["native_result"])
    require(native["schema"]=="starforge.groundwater-publisher-native.v1" and native["state"]=="complete"
            and native["operation_id"]==context["parent_operation_id"] and native["all_owned_services_closed"] is True,
            "Receive the actual completed original publisher operation after all of its services closed.")
    capsule=read(context["source_capsule"],2097152)
    raw=Path(context["source_capsule"]).read_bytes()
    require(git_sha(raw)==CAPSULE_SHA,"The complete original source capsule changed.")
    require(native["source_head"]==capsule["source_head"],"The model run has another original source head.")
    expected_source=[{"path":r["path"],"bytes":r["bytes"],"sha256":hashlib.sha256(capsule["files"][r["path"]].encode("utf-8")).hexdigest()} for r in capsule["manifest"]]
    require(digest(expected_source)==native["application_sha256"],"The original model source closure differs from the selected capsule.")
    archive=context["backup"]
    verify(archive["path"],archive)
    require({k:native["backup"][k] for k in ("bytes","sha256")}=={k:archive[k] for k in ("bytes","sha256")},
            "The selected backup is not the exact original completed backup.")
    package=inspect_package(archive["path"])
    require(package["manifest"]["kind"]=="workspace_backup" and package["manifest"]["workspace_id"]==native["workspace_id"],
            "The original backup has another workspace identity.")
    entry=next((r for r in package["manifest"]["files"] if r["path"]=="workspace/groundwater.sqlite"),None)
    require(entry is not None,"The actual backup does not retain its original database.")
    with zipfile.ZipFile(archive["path"]) as z:
        matches=[i for i in z.infolist() if i.filename==entry["path"]]
        require(len(matches)==1,"The original database member is ambiguous.")
        database=z.read(matches[0])
    require(len(database)==entry["bytes"] and hashlib.sha256(database).hexdigest()==entry["sha256"],"The immutable incoming database changed.")
    db_path=Path(context["work_directory"])/"incoming-original.sqlite"
    publish_bytes(db_path,database)
    db=sqlite3.connect(db_path.as_uri()+"?mode=ro",uri=True)
    try:
        db.execute("PRAGMA query_only=ON")
        meta=dict(db.execute("SELECT key,value FROM meta"))
        require(meta["id"]==native["workspace_id"],"The native workspace and immutable DB disagree.")
        records={r[0]:{"id":r[0],"project_id":r[1],"kind":r[2],**json.loads(r[3])} for r in db.execute("SELECT id,project_id,kind,body FROM records")}
        selected_runs=[]
        for selected in native["runs"]:
            row=records.get(selected["id"])
            require(row and row["kind"]=="run" and row["edition_id"]==selected["edition_id"],"An original selected run is absent from the backup.")
            selected_runs.append({"id":row["id"],"result_sha256":selected["result_sha256"]})
        projects={records[r["id"]]["project_id"] for r in selected_runs}
        require(len(projects)==1,"The native result spans different original projects.")
        project_id=projects.pop()
        report=records.get(native["report"]["id"])
        require(report and report["kind"]=="report" and report["project_id"]==project_id,"The selected report is absent from the backup.")
        require(all(report["archive"][k]==native["report"]["archive"][k] for k in ("bytes","sha256")),"The original frozen report archive identity changed.")
        operations=[{"id":r[0],"request_sha256":r[1],"result_sha256":digest(json.loads(r[2]))}
                    for r in db.execute("SELECT id,request_sha256,result FROM operations ORDER BY id")]
        expected={"workspace_id":meta["id"],"workspace_version":int(meta["version"]),"project_id":project_id,
                  "source_ids":sorted(r["id"] for r in records.values() if r["kind"]=="source" and r["project_id"]==project_id),
                  "edition_ids":sorted(r["id"] for r in records.values() if r["kind"]=="edition" and r["project_id"]==project_id),
                  "runs":selected_runs,"reports":[{"id":report["id"],"report_sha256":report["sha256"],
                      "archive_sha256":report["archive"]["sha256"],"archive_bytes":report["archive"]["bytes"]}],
                  "operations":operations}
    finally:
        db.close()
    return expected

def receive(context):
    django_setup(context)
    from tethysapp.groundwater_workshare.receiving import run as receive_original
    expected=original_selection(context)
    accounts=account_setup(context,verify_only=True)
    value={"schema":"groundwater.tethys-receiving-input.v1","operation_id":context["operation_id"],
           "user":accounts["operator"]["username"],"slot":context["slot"],"archive":context["backup"],
           "expected":expected,"report_receivings":[{"report_id":expected["reports"][0]["id"],"name":"original-report"}]}
    request_path=Path(context["work_directory"])/"receiving-input.json"
    publish(request_path,value)
    result=receive_original(value)
    target=Path(context["output_directory"])/"receiving-readback.json"
    publish(target,result,replace=target.exists())
    return result

def portal_final(context):
    django_setup(context)
    account_setup(context,verify_only=True)
    from django.contrib.auth import get_user_model
    from groundwater_workspace import Workbench
    from groundwater_workspace.common import digest as core_digest
    from tethysapp.groundwater_workshare.policy import context_for_user, configuration
    from tethysapp.groundwater_workshare.receiving import verify_current
    selected=read(Path(context["work_directory"])/"receiving-input.json")["expected"]
    credentials=read(context["credentials_file"])
    User=get_user_model()
    operator=User._default_manager.get(**{User.USERNAME_FIELD:credentials["accounts"]["operator"]["username"]})
    scoped=context_for_user(operator,context["slot"],config=configuration(),create_roots=False)
    browser=read(Path(context["output_directory"])/"browser"/"browser-result.json")
    with Workbench(scoped.workspace,existing_only=True) as wb:
        actual=verify_current(wb,selected)
        state=wb.state(selected["project_id"])
        require(state["workspace"]["id"]==selected["workspace_id"],"The continued private portal workspace changed identity.")
        for original in browser["operations"]:
            operation=wb.operation(original["id"])
            require(operation["request_sha256"]==original["request_sha256"] and core_digest(operation["result"])==original["result_sha256"],
                    "A portal request's original committed outcome changed.")
            require(operation["request"]["actor"]==operator.get_username(),"The actual authenticated actor was not retained.")
        delivery=next(x for x in state["deliveries"] if x["id"]==browser["delivery_id"])
        receipt=next(x for x in state["acknowledgments"] if x["id"]==browser["acknowledgment_id"])
        require(delivery["state"]=="complete" and receipt["delivery_id"]==delivery["id"]
                and receipt["decision"]=="accepted" and receipt["by"]==operator.get_username(),
                "The actual local portal receiving decision is incomplete.")
        backup=wb.backup_file(browser["backup_id"])
        result={"workspace":state["workspace"],"original":actual,"portal_operations":browser["operations"],
                "delivery":delivery,"acknowledgment":receipt,"backup":{**backup,"path":str(backup["path"])},
                "native_run_ids":[x["id"] for x in state["runs"]],"native_runs_started":0}
        require(set(result["native_run_ids"])=={x["id"] for x in selected["runs"]},"Portal receiving created an extra native run.")
    reader=User._default_manager.get(**{User.USERNAME_FIELD:credentials["accounts"]["reader"]["username"]})
    separate=context_for_user(reader,context["slot"],config=configuration(),create_roots=False)
    require(not (separate.workspace/"groundwater.sqlite").exists(),"The foreign account unexpectedly initialized a model workspace.")
    result["foreign_account_model_database_created"]=False
    publish(Path(context["output_directory"])/"final-readback.json",result,replace=True)
    return result


def prepared_state(context):
    django_setup(context)
    accounts=account_setup(context,verify_only=True)
    from django.contrib.auth import get_user_model
    from tethysapp.groundwater_workshare.policy import configuration,context_for_user
    User=get_user_model();paths={}
    for role in ("operator","reader"):
        user=User._default_manager.get(**{User.USERNAME_FIELD:accounts[role]["username"]})
        selected=context_for_user(user,context["slot"],config=configuration(),create_roots=False)
        require(not any(selected.root.rglob("groundwater.sqlite")),"Portal preparation unexpectedly initialized a model database.")
        paths[role]={"private_root":str(selected.root),"model_databases":0}
    require(paths["operator"]["private_root"]!=paths["reader"]["private_root"],"The two original accounts share a private path.")
    return {"accounts":accounts,"private_paths":paths,"model_workspaces_initialized":0,"native_model_runs_started":0}

def configure(context):
    import yaml
    original=Path(context["work_directory"])/"generated-config"/"portal_config.yml"
    value=yaml.safe_load(original.read_text(encoding="utf-8"))
    require(isinstance(value,dict) and isinstance(value.get("settings"),dict),"The original generated portal configuration is invalid.")
    credentials=read(context["credentials_file"],65536)
    settings=value["settings"]
    settings.update({
        "SECRET_KEY":credentials["portal_secret"],"DEBUG":True,
        "ALLOWED_HOSTS":["127.0.0.1","localhost"],"PREFIX_URL":context["url_prefix"],
        "DATABASES":{"default":{"ENGINE":"django.db.backends.sqlite3","NAME":str(Path(context["portal_home"])/"portal.sqlite3")}},
        "USE_OLD_WORKSPACES_API":False,
        "EMAIL_BACKEND":"django.core.mail.backends.locmem.EmailBackend",
        "TETHYS_PORTAL_CONFIG":{
            "ENABLE_OPEN_SIGNUP":False,"ENABLE_OPEN_PORTAL":False,"ENABLE_RESTRICTED_APP_ACCESS":True,
            "STATICFILES_USE_NPM":True,
            "TETHYS_WORKSPACES_ROOT":str(Path(context["portal_home"])/"workspaces"),
            "STATIC_ROOT":str(Path(context["portal_home"])/"static"),
        },
    })
    target=Path(context["portal_home"])/"portal_config.yml"
    publish_bytes(target,yaml.safe_dump(value,sort_keys=False,allow_unicode=True).encode("utf-8"))
    return {"path":str(target),**info(target),"database_engine":"django.db.backends.sqlite3",
            "scope":"private_user","production_tenant_acceptance":False}

def database(context):
    settings=django_setup(context)
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    executor=MigrationExecutor(connection)
    require(not executor.migration_plan(executor.loader.graph.leaf_nodes()),"The actual portal schema still has unapplied migrations.")
    with connection.cursor() as cursor:
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables=sorted(row[0] for row in cursor.fetchall())
    require({"django_migrations","auth_user","auth_group"}<=set(tables),"The actual account/database schema is incomplete.")
    return {"database":str(settings.DATABASES["default"]["NAME"]),"tables":tables,
            "migration_count":len(executor.loader.applied_migrations),"same_original_portal":True}

def static_assets(context):
    import tethys_portal
    from tethys_portal.dependencies import vendor_static_dependencies
    directory=Path(tethys_portal.__file__).resolve().parent/"static"
    package=read(directory/"package.json")
    required={d.npm_name:d.version for d in vendor_static_dependencies.values()}
    require(package.get("dependencies")==required,"The original portal static dependency selection changed.")
    versions={}
    for name in sorted(required):
        selected=read(directory/"node_modules"/name/"package.json")
        require(selected["name"]==name,"The actual native static package name differs.")
        versions[name]={"declared":required[name],"installed":selected["version"]}
    require((directory/"package-lock.json").is_file(),"The actual npm package lock is missing.")
    return {"package":info(directory/"package.json"),"lock":info(directory/"package-lock.json"),
            "directory":str(directory),"dependencies":versions}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--context",required=True)
    parser.add_argument("--phase",choices=("upstream","installed","configure","database","static","accounts","prepared","receive","final"),required=True)
    args=parser.parse_args()
    context=read(args.context)
    if args.phase=="upstream":
        value=installed(context,include_application=False)
    elif args.phase=="installed":
        value=installed(context)
    elif args.phase=="configure":
        value=configure(context)
    elif args.phase=="database":
        value=database(context)
    elif args.phase=="static":
        value=static_assets(context)
    elif args.phase=="accounts":
        value=account_setup(context,verify_only=(Path(context["output_directory"])/"accounts.json").exists())
    elif args.phase=="prepared":
        value=prepared_state(context)
    elif args.phase=="receive":
        value=receive(context)
    else:
        value=portal_final(context)
    out=Path(context["output_directory"])/(args.phase+"-phase.json")
    publish(out,value,replace=args.phase in ("receive","final"))
    print(json.dumps({"phase":args.phase,"result_file":str(out),"identity":info(out)}),flush=True)

if __name__=="__main__":
    main()
