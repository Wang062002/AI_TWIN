import fs from "node:fs";
import path from "node:path";

export function decodeEscapedUnicode(value) {
  return String(value || "").replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
    return String.fromCharCode(Number.parseInt(hex, 16));
  });
}

export function loadRelationshipTypes(file = "config/relationship_types.json") {
  const fullPath = path.resolve(file);
  if (!fs.existsSync(fullPath)) return null;
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

export function validateRelationship(relationship) {
  const config = loadRelationshipTypes();
  if (!config || !relationship || relationship === "unspecified") return null;
  const supported = new Set(config.supported_first_batch || []);
  if (!supported.has(relationship)) {
    return `Relationship "${relationship}" is not in first-batch supported types: ${[...supported].join(", ")}`;
  }
  return null;
}

export function loadPersonConfig(personId, options = {}) {
  const privateConfigPath = path.resolve("data", "person_configs", `${personId}.json`);
  const publicConfigPath = path.resolve("config", "people", `${personId}.json`);
  const configPath = options.config
    ? path.resolve(options.config)
    : fs.existsSync(privateConfigPath)
      ? privateConfigPath
      : publicConfigPath;

  let config = {};
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  }

  const person = options.person || config.person_id || personId;
  const displayName = decodeEscapedUnicode(options.displayName || config.display_name || person);
  const relationship = options.relationship || config.relationship_to_user || "unspecified";
  const rawInput = options.input || config.raw_input || `data/raw/${person}/raw.json`;
  const output = options.output || config.knowledge_base_output || `data/knowledge_bases/${person}`;

  return {
    person_id: person,
    display_name: displayName,
    relationship_to_user: relationship,
    source_type: config.source_type || "wechat",
    raw_input: rawInput,
    knowledge_base_output: output,
    privacy_level: config.privacy_level || "local_only",
    config_path: fs.existsSync(configPath) ? configPath : null
  };
}
