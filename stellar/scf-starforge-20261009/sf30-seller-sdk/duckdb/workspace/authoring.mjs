// MIT. Compose the original catalog/query author with the retained merchant workspace.
import { open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readDuckdbSourceFile, compileDuckdbQueries } from '../config.mjs';
import { inspectDuckdbCatalog, assertDuckdbCatalogCurrent } from '../workbench/catalog.mjs';
import { compileDuckdbQueryPlan, duckdbColumnParameter } from '../workbench/author.mjs';
import { WorkspaceError, encodeAuthoring, json, sha256 } from './store.mjs';

const changed = () => new WorkspaceError('SOURCE_CHANGED', 409, 'The data source changed. Refresh its current relations and review the draft.');
function publicQuery(query) {
  const value = structuredClone(query);
  delete value.sql;
  for (const parameter of Object.values(value.parameters)) {
    parameter.optional = Object.hasOwn(parameter, 'default'); delete parameter.default;
  }
  return value;
}

/** Native catalog profiles remain in this process; the browser sends selected columns. */
export function createWorkspaceAuthoring({ sourceFile, python, environment }) {
  const profiles = new Map(), cursors = new WeakMap();
  async function inspect(cursor) {
    const result = await inspectDuckdbCatalog({ sourceFile, python, environment, cursor });
    for (const [key, profile] of profiles) if (profile.sourceSha256 !== result.profile.sourceSha256) profiles.delete(key);
    if (profiles.size >= 64) profiles.delete(profiles.keys().next().value);
    profiles.set(cursor ?? '', result.profile);
    cursors.set(result.profile, cursor);
    return result;
  }
  const publicCatalog = catalog => ({ ...catalog, relations: catalog.relations.map(relation => ({ ...relation,
    columns: relation.columns.map(column => ({ ...column, parameter: duckdbColumnParameter(column) })) })) });
  async function findRelation(relationId, expected) {
    for (const profile of profiles.values()) if (profile.sourceSha256 === expected &&
        profile.catalog.relations.some(relation => relation.id === relationId)) return profile;
    let cursor;
    do {
      const { profile, catalog } = await inspect(cursor);
      if (profile.sourceSha256 !== expected) throw changed();
      if (catalog.relations.some(relation => relation.id === relationId)) return profile;
      cursor = catalog.nextCursor;
    } while (cursor);
    throw new WorkspaceError('SOURCE_RELATION_MISSING', 409,
      'The saved relation is absent from the current source. Choose an available relation to replace this query.');
  }
  async function profileFor(entry, expected) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !entry.plan ||
        Object.keys(entry).some(key => !['plan', 'cursor'].includes(key)) ||
        entry.cursor !== undefined && entry.cursor !== null && (typeof entry.cursor !== 'string' || entry.cursor.length > 256))
      throw new WorkspaceError('QUERY_AUTHORING_DRAFT_INVALID');
    const key = entry.cursor ?? '';
    let profile = profiles.get(key);
    if (!profile || profile.sourceSha256 !== expected) {
      try { profile = (await inspect(entry.cursor)).profile; }
      catch (error) {
        if (error.code !== 'CATALOG_SOURCE_CHANGED') throw error;
        profile = await findRelation(entry.plan.relationId, expected);
      }
    }
    if (profile.sourceSha256 !== expected) throw changed();
    if (!profile.catalog.relations.some(relation => relation.id === entry.plan.relationId))
      profile = await findRelation(entry.plan.relationId, expected);
    await assertDuckdbCatalogCurrent(profile);
    return profile;
  }
  async function compile(authoring = [], expected) {
    encodeAuthoring(authoring);
    const original = await readDuckdbSourceFile(sourceFile);
    if (original.sourceSha256 !== expected) throw changed();
    const authored = [], queries = { ...structuredClone(original.config.queries) };
    for (const entry of authoring) {
      const profile = await profileFor(entry, expected);
      let built;
      try { built = compileDuckdbQueryPlan({ profile, plan: entry.plan }); }
      catch (error) { throw new WorkspaceError(error.code ?? 'QUERY_AUTHORING_INVALID', 422); }
      if (Object.hasOwn(queries, built.queryName)) throw new WorkspaceError('QUERY_NAME_ALREADY_EXISTS', 422,
        'Choose a distinct name for every authored query and existing approved query.');
      queries[built.queryName] = built.query;
      authored.push({ queryName: built.queryName, description: publicQuery(built.query),
        review: built.review, parameterDescriptions: built.parameterDescriptions, example: built.example, planId: built.planId });
    }
    if (!authoring.length) return { original, declaration: original, sourceConfig: original.config, authored };
    const sourceConfig = { ...structuredClone(original.config), queries };
    delete sourceConfig.bindings;
    if (Buffer.byteLength(json(sourceConfig)) > 262144) throw new WorkspaceError('AUTHORED_SOURCE_TOO_LARGE');
    const compiledQueries = compileDuckdbQueries(queries), snapshot = { ...original.snapshot, queries: compiledQueries };
    const declaration = { ...original, config: sourceConfig, queries: compiledQueries, snapshot,
      sourceSha256: sha256(JSON.stringify(snapshot)) };
    return { original, declaration, sourceConfig, authored };
  }
  return {
    compile,
    async catalog(input = {}) {
      const { catalog } = await inspect(input.cursor);
      if (input.sourceSha256 !== undefined && input.sourceSha256 !== catalog.sourceSha256) throw changed();
      return publicCatalog(catalog);
    },
    async reopen(input) {
      const current = await readDuckdbSourceFile(sourceFile);
      if (current.sourceSha256 !== input.sourceSha256) throw changed();
      const profile = await profileFor(input.entry, input.sourceSha256);
      const relation = profile.catalog.relations.find(value => value.id === input.entry.plan.relationId);
      const cursor = cursors.get(profile), schemaChanged = relation.fingerprint !== input.entry.plan.relationFingerprint;
      return { catalog: publicCatalog(profile.catalog), cursor, schemaChanged,
        entry: { ...structuredClone(input.entry), cursor } };
    },
    async review(input) {
      const result = await compile([input.entry], input.sourceSha256);
      return result.authored[0];
    },
    /** Only a private generated declaration is transient. Original files stay intact. */
    async withSource(compiled, action) {
      if (!compiled.authored.length) return action(sourceFile, compiled.declaration);
      const filename = join(dirname(sourceFile), '.stellar-forge-workspace-' + randomUUID() + '.json');
      let handle, created = false;
      try {
        handle = await open(filename, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        created = true; await handle.writeFile(json(compiled.sourceConfig)); await handle.sync(); await handle.close(); handle = null;
        const exact = await readDuckdbSourceFile(filename);
        if (exact.sourceSha256 !== compiled.declaration.sourceSha256) throw changed();
        const result = await action(filename, exact);
        if ((await readDuckdbSourceFile(sourceFile)).sourceSha256 !== compiled.original.sourceSha256) throw changed();
        return result;
      } finally {
        await handle?.close();
        if (created) await unlink(filename);
      }
    },
  };
}
