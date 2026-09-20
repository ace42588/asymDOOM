#!/usr/bin/env node
/**
 * Validate contracts fixtures against JSON Schemas (AJV).
 * Expects ≥20 valid and ≥10 invalid fixtures.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SCHEMAS = path.join(ROOT, "schemas");
const FIXTURES = path.join(ROOT, "fixtures");

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

function loadSchemas(dir, prefix = "") {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) {
      loadSchemas(full, path.join(prefix, name.name));
      continue;
    }
    if (!name.name.endsWith(".schema.json")) continue;
    const schema = JSON.parse(readFileSync(full, "utf8"));
    ajv.addSchema(schema);
  }
}

loadSchemas(SCHEMAS);

/** Map fixture basename prefix → schema $id */
const ROUTING = [
  [/^join-/, "https://asymdoom.dev/schemas/protocol/join.schema.json"],
  [/^welcome-/, "https://asymdoom.dev/schemas/protocol/welcome.schema.json"],
  [/^role-change-/, "https://asymdoom.dev/schemas/protocol/role-change.schema.json"],
  [/^input-/, "https://asymdoom.dev/schemas/protocol/input.schema.json"],
  [/^snapshot-/, "https://asymdoom.dev/schemas/protocol/snapshot.schema.json"],
  [/^map-load-complete/, "https://asymdoom.dev/schemas/protocol/map-load-complete.schema.json"],
  [/^map-load/, "https://asymdoom.dev/schemas/protocol/map-load.schema.json"],
  [/^notice-/, "https://asymdoom.dev/schemas/protocol/notice.schema.json"],
  [/^bye/, "https://asymdoom.dev/schemas/protocol/bye.schema.json"],
  [/^actor-/, "https://asymdoom.dev/schemas/state/actor.schema.json"],
  [/^projectile/, "https://asymdoom.dev/schemas/state/projectile.schema.json"],
  [/^door/, "https://asymdoom.dev/schemas/state/door.schema.json"],
  [/^mover/, "https://asymdoom.dev/schemas/state/mover.schema.json"],
  [/^switch/, "https://asymdoom.dev/schemas/state/switch.schema.json"],
  [/^mods/, "https://asymdoom.dev/schemas/asym/mods.schema.json"],
  [/^event-/, "https://asymdoom.dev/schemas/state/event.schema.json"],
];

function schemaFor(file) {
  const base = path.basename(file, ".json");
  for (const [re, id] of ROUTING) {
    if (re.test(base)) return id;
  }
  throw new Error(`no schema routing for ${file}`);
}

function runDir(kind, expectValid) {
  const dir = path.join(FIXTURES, kind);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  let ok = 0;
  let fail = 0;
  for (const file of files) {
    const data = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
    const id = schemaFor(file);
    const validate = ajv.getSchema(id);
    if (!validate) throw new Error(`schema missing: ${id}`);
    const passed = validate(data);
    if (expectValid && !passed) {
      console.error(`FAIL valid/${file}`, validate.errors);
      fail++;
    } else if (!expectValid && passed) {
      console.error(`FAIL invalid/${file} unexpectedly passed`);
      fail++;
    } else {
      ok++;
    }
  }
  return { count: files.length, ok, fail };
}

const valid = runDir("valid", true);
const invalid = runDir("invalid", false);

console.log(`valid: ${valid.ok}/${valid.count} ok`);
console.log(`invalid: ${invalid.ok}/${invalid.count} correctly rejected`);

if (valid.count < 20) {
  console.error(`need ≥20 valid fixtures, got ${valid.count}`);
  process.exit(1);
}
if (invalid.count < 10) {
  console.error(`need ≥10 invalid fixtures, got ${invalid.count}`);
  process.exit(1);
}
if (valid.fail || invalid.fail) process.exit(1);
console.log("contracts: all fixtures OK");
