import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

// Named model profiles: run Codex with another CODEX_HOME, provider or model
// without touching the default ~/.codex setup.
export const PROFILE_ENV = "CODEX_COMPANION_PROFILE";
export const CONFIG_OVERRIDES_ENV = "CODEX_COMPANION_CONFIG_OVERRIDES";
export const PROFILES_FILE_ENV = "CODEX_PROFILES_FILE";
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const PROFILE_NAME = /^[A-Za-z0-9._-]+$/;

function expandHome(value) {
  return String(value).replace(/^~(?=$|\/)/, os.homedir());
}

export function resolveProfilesFile(env = process.env) {
  return expandHome(env[PROFILES_FILE_ENV] || path.join(os.homedir(), ".config", "codex-plugin-cc", "profiles.json"));
}

export function readProfiles(env = process.env) {
  const file = resolveProfilesFile(env);
  let profiles;
  try {
    profiles = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read Codex profiles from ${file}: ${error.message}`);
  }
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
    throw new Error(`Codex profiles file ${file} must contain a JSON object of profiles.`);
  }
  return { file, profiles };
}

/** Remove `--profile <name>` / `--profile=<name>` from argv and return the name. */
export function extractProfileArg(argv) {
  const rest = [];
  let name = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--profile") {
      name = argv[index + 1];
      index += 1;
      if (!name) {
        throw new Error("--profile requires a profile name.");
      }
    } else if (arg.startsWith("--profile=")) {
      name = arg.slice("--profile=".length);
    } else {
      rest.push(arg);
    }
  }
  return { name, argv: rest };
}

/**
 * Apply a profile to `env` (process.env by default) so this process, its
 * task workers, brokers and `codex app-server` children all inherit it.
 */
export function applyProfile(name, env = process.env) {
  if (!PROFILE_NAME.test(name)) {
    throw new Error(`Invalid Codex profile name "${name}"; use letters, digits, ".", "_" or "-".`);
  }
  const { file, profiles } = readProfiles(env);
  const profile = profiles[name];
  if (!profile || typeof profile !== "object") {
    const available = Object.keys(profiles).join(", ") || "none";
    throw new Error(`Unknown Codex profile "${name}" in ${file}. Available: ${available}.`);
  }

  if (profile.codex_home) {
    env.CODEX_HOME = expandHome(profile.codex_home);
  }
  for (const [key, value] of Object.entries(profile.env ?? {})) {
    env[key] = String(value);
  }
  for (const [key, source] of Object.entries(profile.env_files ?? {})) {
    const sourcePath = expandHome(source);
    let value;
    try {
      value = fs.readFileSync(sourcePath, "utf8").trim();
    } catch (error) {
      throw new Error(`Codex profile "${name}": cannot read ${key} from ${sourcePath}: ${error.message}`);
    }
    if (!value) {
      throw new Error(`Codex profile "${name}": ${sourcePath} is empty.`);
    }
    env[key] = value;
  }

  const overrides = Object.entries(profile.config ?? {}).map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  env[CONFIG_OVERRIDES_ENV] = JSON.stringify(overrides);

  // Separate state per profile, so each profile gets its own broker and jobs.
  const dataRoot = env[PLUGIN_DATA_ENV] || path.join(os.tmpdir(), "codex-companion");
  env[PLUGIN_DATA_ENV] = path.join(dataRoot, "profiles", name);
  env[PROFILE_ENV] = name;
  return profile;
}

/** `-c key=value` arguments for `codex app-server` from an applied profile. */
export function configOverrideArgs(env = process.env) {
  const raw = env[CONFIG_OVERRIDES_ENV];
  if (!raw) {
    return [];
  }
  return JSON.parse(raw).flatMap((override) => ["-c", override]);
}

/** Plugin data dirs of profiles used under `dataRoot`, for session cleanup. */
export function listProfileDataDirs(dataRoot) {
  const root = path.join(dataRoot, "profiles");
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}
