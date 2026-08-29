/**
 * scripts/diff-openapi.ts
 *
 * Compares two OpenAPI 3.x spec files (JSON) and appends a human-readable
 * markdown summary of API changes to API_CHANGELOG.md.
 *
 * Usage (via npm script):
 *   npm run diff:openapi -- --base docs/openapi.json --head docs/openapi.head.json
 *
 * Or with explicit output path:
 *   npm run diff:openapi -- --base <file> --head <file> --out API_CHANGELOG.md
 *
 * Exit codes:
 *   0 — success (no changes OR changes written to changelog)
 *   1 — error (missing file, parse failure, etc.)
 *
 * Environment variables consumed (all optional, used in the changelog header):
 *   GITHUB_REF_NAME   — branch or tag name  (e.g. "feat/add-notes")
 *   GITHUB_SHA        — full commit SHA
 *   GITHUB_PR_NUMBER  — PR number if running inside a pull_request event
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Minimal OpenAPI 3.x types (only the parts we inspect)
// ---------------------------------------------------------------------------

interface OpenApiSpec {
  info?: { version?: string; title?: string };
  paths?: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, SchemaObject>;
  };
}

type PathItem = Record<string, OperationObject | unknown>;

interface OperationObject {
  summary?: string;
  operationId?: string;
  tags?: string[];
  requestBody?: {
    content?: Record<string, { schema?: SchemaObject }>;
  };
  responses?: Record<
    string,
    { description?: string; content?: Record<string, { schema?: SchemaObject }> }
  >;
  parameters?: Array<{ name: string; in: string; required?: boolean; schema?: SchemaObject }>;
}

interface SchemaObject {
  type?: string;
  $ref?: string;
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  allOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  required?: string[];
  description?: string;
  enum?: unknown[];
}

// ---------------------------------------------------------------------------
// HTTP methods that map to operations on a PathItem
// ---------------------------------------------------------------------------

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadSpec(filePath: string): OpenApiSpec {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Spec file not found: ${abs}`);
  }
  const raw = fs.readFileSync(abs, 'utf8');
  return JSON.parse(raw) as OpenApiSpec;
}

function parseArgs(): { base: string; head: string; out: string } {
  const args = process.argv.slice(2);
  const get = (flag: string, def: string): string => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
  };
  return {
    base: get('--base', 'docs/openapi.json'),
    head: get('--head', 'docs/openapi.head.json'),
    out: get('--out', 'API_CHANGELOG.md'),
  };
}

/** Resolve a $ref like "#/components/schemas/Foo" against the spec's components. */
function resolveRef(ref: string, spec: OpenApiSpec): SchemaObject | null {
  if (!ref.startsWith('#/components/schemas/')) return null;
  const name = ref.replace('#/components/schemas/', '');
  return spec.components?.schemas?.[name] ?? null;
}

/**
 * Flatten a schema to a set of dotted property paths, e.g.
 * { a: { properties: { b: {} } } } → Set { "a", "a.b" }
 *
 * Handles $ref resolution, allOf/oneOf/anyOf merging, and arrays.
 * `depth` guards against circular references.
 */
function flattenProperties(
  schema: SchemaObject | undefined,
  spec: OpenApiSpec,
  prefix = '',
  seen = new Set<string>(),
  depth = 0,
): Set<string> {
  const result = new Set<string>();
  if (!schema || depth > 8) return result;

  // Resolve $ref
  if (schema.$ref) {
    const refKey = schema.$ref;
    if (seen.has(refKey)) return result;
    seen.add(refKey);
    const resolved = resolveRef(refKey, spec);
    if (resolved) {
      for (const p of flattenProperties(resolved, spec, prefix, seen, depth + 1)) {
        result.add(p);
      }
    }
    return result;
  }

  // Merge combiners
  const merged = [...(schema.allOf ?? []), ...(schema.oneOf ?? []), ...(schema.anyOf ?? [])];
  for (const sub of merged) {
    for (const p of flattenProperties(sub, spec, prefix, new Set(seen), depth + 1)) {
      result.add(p);
    }
  }

  // Array items
  if (schema.type === 'array' && schema.items) {
    for (const p of flattenProperties(schema.items, spec, prefix, new Set(seen), depth + 1)) {
      result.add(p);
    }
    return result;
  }

  // Object properties
  if (schema.properties) {
    for (const [key, child] of Object.entries(schema.properties)) {
      const full = prefix ? `${prefix}.${key}` : key;
      result.add(full);
      for (const p of flattenProperties(child, spec, full, new Set(seen), depth + 1)) {
        result.add(p);
      }
    }
  }

  return result;
}

/** Extract the first JSON schema from a content map (prefers application/json). */
function contentSchema(
  content: Record<string, { schema?: SchemaObject }> | undefined,
): SchemaObject | undefined {
  if (!content) return undefined;
  return (content['application/json'] ?? Object.values(content)[0])?.schema;
}

// ---------------------------------------------------------------------------
// Endpoint-level comparison
// ---------------------------------------------------------------------------

interface EndpointKey {
  method: string;
  path: string;
}

interface EndpointMeta {
  summary?: string;
  tags?: string[];
}

type EndpointMap = Map<string, OperationObject>;

function buildEndpointMap(spec: OpenApiSpec): EndpointMap {
  const map: EndpointMap = new Map();
  for (const [urlPath, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = (pathItem as PathItem)[method] as OperationObject | undefined;
      if (op) {
        map.set(`${method.toUpperCase()} ${urlPath}`, op);
      }
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Schema-level field change detection
// ---------------------------------------------------------------------------

interface SchemaChanges {
  addedFields: string[];
  removedFields: string[];
}

function diffSchemas(
  baseSchema: SchemaObject | undefined,
  headSchema: SchemaObject | undefined,
  baseSpec: OpenApiSpec,
  headSpec: OpenApiSpec,
): SchemaChanges {
  const baseFields = flattenProperties(baseSchema, baseSpec);
  const headFields = flattenProperties(headSchema, headSpec);
  return {
    addedFields: [...headFields].filter((f) => !baseFields.has(f)).sort(),
    removedFields: [...baseFields].filter((f) => !headFields.has(f)).sort(),
  };
}

// ---------------------------------------------------------------------------
// Parameter-level change detection
// ---------------------------------------------------------------------------

interface ParamChanges {
  added: string[];
  removed: string[];
}

function diffParameters(
  baseOp: OperationObject,
  headOp: OperationObject,
): ParamChanges {
  const baseParams = new Set((baseOp.parameters ?? []).map((p) => `${p.in}:${p.name}`));
  const headParams = new Set((headOp.parameters ?? []).map((p) => `${p.in}:${p.name}`));
  return {
    added: [...headParams].filter((p) => !baseParams.has(p)).sort(),
    removed: [...baseParams].filter((p) => !headParams.has(p)).sort(),
  };
}

// ---------------------------------------------------------------------------
// Endpoint change record
// ---------------------------------------------------------------------------

interface EndpointChange {
  key: string; // "POST /api/v1/engagements"
  summary?: string;
  requestBodyChanges?: SchemaChanges;
  responseChanges: Map<string, SchemaChanges>; // status code → changes
  parameterChanges?: ParamChanges;
}

// ---------------------------------------------------------------------------
// Main diff logic
// ---------------------------------------------------------------------------

interface DiffResult {
  addedEndpoints: Array<{ key: string; summary?: string; tags?: string[] }>;
  removedEndpoints: Array<{ key: string; summary?: string; tags?: string[] }>;
  changedEndpoints: EndpointChange[];
  addedSchemas: string[];
  removedSchemas: string[];
}

function diffSpecs(base: OpenApiSpec, head: OpenApiSpec): DiffResult {
  const baseMap = buildEndpointMap(base);
  const headMap = buildEndpointMap(head);

  // Endpoints
  const addedEndpoints: DiffResult['addedEndpoints'] = [];
  const removedEndpoints: DiffResult['removedEndpoints'] = [];
  const changedEndpoints: EndpointChange[] = [];

  for (const [key, headOp] of headMap) {
    if (!baseMap.has(key)) {
      addedEndpoints.push({ key, summary: headOp.summary, tags: headOp.tags });
    }
  }

  for (const [key, baseOp] of baseMap) {
    if (!headMap.has(key)) {
      removedEndpoints.push({ key, summary: baseOp.summary, tags: baseOp.tags });
    }
  }

  // Changed endpoints — inspect request body + responses
  for (const [key, headOp] of headMap) {
    const baseOp = baseMap.get(key);
    if (!baseOp) continue; // already counted as added

    const change: EndpointChange = {
      key,
      summary: headOp.summary,
      responseChanges: new Map(),
    };

    // Request body
    const baseReqSchema = contentSchema(baseOp.requestBody?.content);
    const headReqSchema = contentSchema(headOp.requestBody?.content);
    if (baseReqSchema || headReqSchema) {
      const reqChanges = diffSchemas(baseReqSchema, headReqSchema, base, head);
      if (reqChanges.addedFields.length || reqChanges.removedFields.length) {
        change.requestBodyChanges = reqChanges;
      }
    }

    // Responses
    const allStatusCodes = new Set([
      ...Object.keys(baseOp.responses ?? {}),
      ...Object.keys(headOp.responses ?? {}),
    ]);
    for (const code of allStatusCodes) {
      const baseResSchema = contentSchema(baseOp.responses?.[code]?.content);
      const headResSchema = contentSchema(headOp.responses?.[code]?.content);
      if (!baseResSchema && !headResSchema) continue;
      const resChanges = diffSchemas(baseResSchema, headResSchema, base, head);
      if (resChanges.addedFields.length || resChanges.removedFields.length) {
        change.responseChanges.set(code, resChanges);
      }
    }

    // Parameters
    const paramChanges = diffParameters(baseOp, headOp);
    if (paramChanges.added.length || paramChanges.removed.length) {
      change.parameterChanges = paramChanges;
    }

    const hasChanges =
      change.requestBodyChanges ||
      change.responseChanges.size > 0 ||
      change.parameterChanges;

    if (hasChanges) {
      changedEndpoints.push(change);
    }
  }

  // Top-level schemas (components.schemas)
  const baseSchemas = new Set(Object.keys(base.components?.schemas ?? {}));
  const headSchemas = new Set(Object.keys(head.components?.schemas ?? {}));
  const addedSchemas = [...headSchemas].filter((s) => !baseSchemas.has(s)).sort();
  const removedSchemas = [...baseSchemas].filter((s) => !headSchemas.has(s)).sort();

  // Sort for deterministic output
  addedEndpoints.sort((a, b) => a.key.localeCompare(b.key));
  removedEndpoints.sort((a, b) => a.key.localeCompare(b.key));
  changedEndpoints.sort((a, b) => a.key.localeCompare(b.key));

  return { addedEndpoints, removedEndpoints, changedEndpoints, addedSchemas, removedSchemas };
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function formatFieldList(fields: string[], icon: string): string {
  return fields.map((f) => `  - ${icon} \`${f}\``).join('\n');
}

function renderMarkdown(diff: DiffResult, meta: { ref?: string; sha?: string; pr?: string }): string {
  const hasChanges =
    diff.addedEndpoints.length > 0 ||
    diff.removedEndpoints.length > 0 ||
    diff.changedEndpoints.length > 0 ||
    diff.addedSchemas.length > 0 ||
    diff.removedSchemas.length > 0;

  if (!hasChanges) {
    return '';
  }

  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  const refLine = meta.pr
    ? `PR #${meta.pr}`
    : meta.ref
    ? `\`${meta.ref}\``
    : 'unknown ref';
  const shaLine = meta.sha ? ` · \`${meta.sha.slice(0, 8)}\`` : '';

  const lines: string[] = [];
  lines.push(`## API Changes — ${now}`);
  lines.push('');
  lines.push(`> ${refLine}${shaLine}`);
  lines.push('');

  // --- Added endpoints ---
  if (diff.addedEndpoints.length > 0) {
    lines.push('### ✅ New Endpoints');
    lines.push('');
    for (const ep of diff.addedEndpoints) {
      const tagStr = ep.tags?.length ? ` *(${ep.tags.join(', ')})*` : '';
      const summaryStr = ep.summary ? ` — ${ep.summary}` : '';
      lines.push(`- **\`${ep.key}\`**${tagStr}${summaryStr}`);
    }
    lines.push('');
  }

  // --- Removed endpoints ---
  if (diff.removedEndpoints.length > 0) {
    lines.push('### ❌ Removed Endpoints');
    lines.push('');
    for (const ep of diff.removedEndpoints) {
      const summaryStr = ep.summary ? ` — ${ep.summary}` : '';
      lines.push(`- **\`${ep.key}\`**${summaryStr}`);
    }
    lines.push('');
  }

  // --- Changed endpoints ---
  if (diff.changedEndpoints.length > 0) {
    lines.push('### 🔄 Changed Endpoints');
    lines.push('');
    for (const ep of diff.changedEndpoints) {
      const summaryStr = ep.summary ? ` — ${ep.summary}` : '';
      lines.push(`#### \`${ep.key}\`${summaryStr}`);
      lines.push('');

      if (ep.parameterChanges) {
        if (ep.parameterChanges.added.length) {
          lines.push('**Parameters added:**');
          lines.push(formatFieldList(ep.parameterChanges.added, '＋'));
          lines.push('');
        }
        if (ep.parameterChanges.removed.length) {
          lines.push('**Parameters removed:**');
          lines.push(formatFieldList(ep.parameterChanges.removed, '－'));
          lines.push('');
        }
      }

      if (ep.requestBodyChanges) {
        lines.push('**Request body:**');
        if (ep.requestBodyChanges.addedFields.length) {
          lines.push(formatFieldList(ep.requestBodyChanges.addedFields, '＋'));
        }
        if (ep.requestBodyChanges.removedFields.length) {
          lines.push(formatFieldList(ep.requestBodyChanges.removedFields, '－'));
        }
        lines.push('');
      }

      if (ep.responseChanges.size > 0) {
        for (const [code, changes] of ep.responseChanges) {
          lines.push(`**Response \`${code}\`:**`);
          if (changes.addedFields.length) {
            lines.push(formatFieldList(changes.addedFields, '＋'));
          }
          if (changes.removedFields.length) {
            lines.push(formatFieldList(changes.removedFields, '－'));
          }
          lines.push('');
        }
      }
    }
  }

  // --- Schema-level changes ---
  if (diff.addedSchemas.length > 0) {
    lines.push('### 📦 New Schemas');
    lines.push('');
    for (const s of diff.addedSchemas) {
      lines.push(`- \`${s}\``);
    }
    lines.push('');
  }

  if (diff.removedSchemas.length > 0) {
    lines.push('### 🗑 Removed Schemas');
    lines.push('');
    for (const s of diff.removedSchemas) {
      lines.push(`- \`${s}\``);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Changelog file management
// ---------------------------------------------------------------------------

const CHANGELOG_HEADER = `# API Changelog

This file records API shape changes (endpoints, request/response fields, schemas)
detected automatically by comparing OpenAPI specs between builds.

For conventional-commit-based changes see [CHANGELOG.md](./CHANGELOG.md).

---

`;

function appendToChangelog(outFile: string, entry: string): void {
  const abs = path.resolve(outFile);

  if (!fs.existsSync(abs)) {
    // Create fresh file with header
    fs.writeFileSync(abs, CHANGELOG_HEADER + entry, 'utf8');
    return;
  }

  const existing = fs.readFileSync(abs, 'utf8');

  // Insert after the file header (everything up to and including the first ---\n\n)
  const headerEnd = existing.indexOf('---\n\n');
  if (headerEnd === -1) {
    // Malformed file — just prepend
    fs.writeFileSync(abs, existing + '\n' + entry, 'utf8');
  } else {
    const insertAt = headerEnd + '---\n\n'.length;
    const updated = existing.slice(0, insertAt) + entry + existing.slice(insertAt);
    fs.writeFileSync(abs, updated, 'utf8');
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { base, head, out } = parseArgs();

  console.log(`Comparing specs:`);
  console.log(`  base: ${base}`);
  console.log(`  head: ${head}`);
  console.log(`  out:  ${out}`);

  let baseSpec: OpenApiSpec;
  let headSpec: OpenApiSpec;

  try {
    baseSpec = loadSpec(base);
  } catch (err: any) {
    console.error(`Error loading base spec: ${err.message}`);
    process.exit(1);
  }

  try {
    headSpec = loadSpec(head);
  } catch (err: any) {
    console.error(`Error loading head spec: ${err.message}`);
    process.exit(1);
  }

  const diff = diffSpecs(baseSpec, headSpec);

  const totalChanges =
    diff.addedEndpoints.length +
    diff.removedEndpoints.length +
    diff.changedEndpoints.length +
    diff.addedSchemas.length +
    diff.removedSchemas.length;

  if (totalChanges === 0) {
    console.log('No API changes detected.');
    process.exit(0);
  }

  console.log(`Detected ${totalChanges} change category(s):`);
  if (diff.addedEndpoints.length)   console.log(`  + ${diff.addedEndpoints.length} added endpoint(s)`);
  if (diff.removedEndpoints.length) console.log(`  - ${diff.removedEndpoints.length} removed endpoint(s)`);
  if (diff.changedEndpoints.length) console.log(`  ~ ${diff.changedEndpoints.length} changed endpoint(s)`);
  if (diff.addedSchemas.length)     console.log(`  + ${diff.addedSchemas.length} added schema(s)`);
  if (diff.removedSchemas.length)   console.log(`  - ${diff.removedSchemas.length} removed schema(s)`);

  const entry = renderMarkdown(diff, {
    ref: process.env.GITHUB_REF_NAME,
    sha: process.env.GITHUB_SHA,
    pr: process.env.GITHUB_PR_NUMBER,
  });

  appendToChangelog(out, entry);
  console.log(`API changelog updated: ${out}`);
}

main().catch((err) => {
  console.error('diff-openapi failed:', err);
  process.exit(1);
});
