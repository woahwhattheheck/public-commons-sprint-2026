// MIT. Operation-scoped inherited lease for the original installed Audit course.
import fs from "node:fs";
import cp from "node:child_process";
import {syncBuiltinESMExports} from "node:module";
const key = Symbol.for("commons.audit.installed.lease");
if (!globalThis[key]) {
  const fd = Number(process.env.AUDIT_INSTALLED_LEASE_FD);
  const expected = JSON.parse(process.env.AUDIT_INSTALLED_LEASE_ID || "null");
  if (!Number.isInteger(fd) || fd < 3 || !expected) throw new Error("Retain the original inherited installed-operation lease.");
  const held = fs.fstatSync(fd), named = fs.lstatSync(expected.path);
  if (!held.isFile() || !named.isFile() || named.isSymbolicLink() ||
      String(held.dev) !== expected.dev || String(held.ino) !== expected.ino ||
      held.dev !== named.dev || held.ino !== named.ino) throw new Error("The original operation lease identity differs.");
  globalThis[key] = {fd, expected};
  function options(value = {}, fork = false) {
    const original = value.stdio ?? (fork ? [value.silent ? "pipe" : 0,value.silent ? "pipe" : 1,value.silent ? "pipe" : 2,"ipc"] : "pipe");
    const stdio = Array.isArray(original) ? [...original] :
      original === "inherit" ? [0,1,2] :
      original === "ignore" ? ["ignore","ignore","ignore"] :
      original === "pipe" ? ["pipe","pipe","pipe"] : null;
    if (!stdio) throw new Error("The selected child uses an unsupported original stdio layout.");
    while (stdio.length < 3) stdio.push("pipe");
    const childFd = stdio.length; stdio.push(fd);
    const environment = {...(value.env || process.env)};
    // Application configuration may supply a filtered environment. Reattach only
    // this original operation's lease and preload, leaving all other fields intact.
    environment.AUDIT_INSTALLED_LEASE_FD = String(childFd);
    environment.AUDIT_INSTALLED_LEASE_ID = process.env.AUDIT_INSTALLED_LEASE_ID;
    const selected = environment.NODE_OPTIONS || "";
    environment.NODE_OPTIONS = selected.includes(import.meta.url) ? selected :
      selected + " --import=" + JSON.stringify(import.meta.url);
    return {...value,stdio,env:environment};
  }
  const spawn = cp.spawn, spawnSync = cp.spawnSync, fork = cp.fork;
  cp.spawn = function(command,args,value) {
    if (!Array.isArray(args)) return spawn.call(this,command,[],options(args));
    return spawn.call(this,command,args,options(value));
  };
  cp.spawnSync = function(command,args,value) {
    if (!Array.isArray(args)) return spawnSync.call(this,command,[],options(args));
    return spawnSync.call(this,command,args,options(value));
  };
  cp.fork = function(module,args,value) {
    if (!Array.isArray(args)) return fork.call(this,module,[],options(args,true));
    return fork.call(this,module,args,options(value,true));
  };
  syncBuiltinESMExports();
}
