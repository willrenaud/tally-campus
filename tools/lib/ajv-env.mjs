/**
 * Shared Ajv environment for every validator in this repository.
 *
 * The seven schema files reference each other by RELATIVE URI (for example
 * "common.defs.schema.json#/$defs/timeOfDay"), which resolve against each file's
 * $id base of https://fsu-campus.example/schemas/v0/. That base is a namespace,
 * not a fetchable document -- the .example TLD is reserved by IANA and will never
 * resolve -- so nothing may be loaded over the network. Every file must therefore
 * be added to one Ajv instance up front, keyed by its $id, before any of them is
 * compiled. Compiling one file in isolation fails with a missing-ref error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ajvModule from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const Ajv2020 = ajvModule.Ajv2020 ?? ajvModule.default;

export const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
export const PLUGIN_ROOT = path.join(REPO_ROOT, 'plugins', 'fsu-schedule');
export const SCHEMA_DIR = path.join(PLUGIN_ROOT, 'schemas');
export const DATA_DIR = path.join(PLUGIN_ROOT, 'data');

/** Base URI the schema $ids live under. Keep in sync with the $id values. */
export const SCHEMA_BASE = 'https://fsu-campus.example/schemas/v0/';

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Build an Ajv instance with all seven schemas registered.
 *
 * strict: true is deliberate. It is what catches a misspelled keyword -- an
 * "additionalProperites" typo would otherwise silently validate nothing at all,
 * which is precisely the failure mode these schemas exist to prevent.
 */
export function buildAjv() {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    allowUnionTypes: false,
    validateFormats: true,
    // The one strict-mode check we turn off, and only this one.
    //
    // parking-zone models its rules array as head-plus-tail: prefixItems pins
    // rules[0] to the mandatory catch-all, items constrains every rule after it.
    // That is exactly what draft 2020-12 says those two keywords mean together.
    // Ajv's strictTuples heuristic assumes any prefixItems means a FIXED-LENGTH
    // tuple and demands minItems === maxItems === prefixItems.length, which would
    // cap the zone at exactly one rule. The heuristic does not model this shape,
    // so it is disabled rather than the schema being bent around it.
    strictTuples: false
  });
  addFormats(ajv);

  const files = fs
    .readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith('.schema.json'))
    .sort();

  if (files.length === 0) {
    throw new Error(`No schemas found in ${SCHEMA_DIR}`);
  }

  for (const f of files) {
    const schema = readJson(path.join(SCHEMA_DIR, f));
    if (!schema.$id) throw new Error(`${f} has no $id; relative $refs cannot resolve without one.`);
    ajv.addSchema(schema, schema.$id);
  }

  return { ajv, schemaFiles: files };
}

/** Compile the root schema of one schema file, by filename. */
export function compileFor(ajv, schemaFileName, pointer = '') {
  return ajv.getSchema(SCHEMA_BASE + schemaFileName + pointer);
}

export function formatErrors(errors, indent = '    ') {
  if (!errors || errors.length === 0) return `${indent}(no error detail)`;
  return errors
    .map((e) => {
      const where = e.instancePath || '<root>';
      const extra = e.params && Object.keys(e.params).length
        ? ' ' + JSON.stringify(e.params)
        : '';
      return `${indent}${where} ${e.message}${extra}`;
    })
    .join('\n');
}
