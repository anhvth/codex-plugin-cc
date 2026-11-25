import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";
import {
  applyProfile,
  configOverrideArgs,
  extractProfileArg,
  listProfileDataDirs
} from "../plugins/codex/scripts/lib/profiles.mjs";

function writeProfiles(dir, profiles) {
  const file = path.join(dir, "profiles.json");
  fs.writeFileSync(file, JSON.stringify(profiles));
  return file;
}

test("extractProfileArg removes both flag forms and keeps other args", () => {
  assert.deepEqual(extractProfileArg(["--write", "--profile", "alibaba", "fix it"]), {
    name: "alibaba",
    argv: ["--write", "fix it"]
  });
  assert.deepEqual(extractProfileArg(["--profile=local", "--json"]), { name: "local", argv: ["--json"] });
  assert.deepEqual(extractProfileArg(["--json"]), { name: null, argv: ["--json"] });
  assert.throws(() => extractProfileArg(["--profile"]), /requires a profile name/);
});

test("applyProfile sets home, env, secrets, overrides and an isolated data dir", () => {
  const dir = makeTempDir();
  const tokenFile = path.join(dir, "token");
  fs.writeFileSync(tokenFile, "secret-token\n");
  const env = {
    CODEX_PROFILES_FILE: writeProfiles(dir, {
      alibaba: {
        codex_home: "/x/codex-home",
        env: { EXTRA: 1 },
        env_files: { API_KEY: tokenFile },
        config: { model_provider: "alibaba-direct", model: "qwen4-max" }
      }
    }),
    CLAUDE_PLUGIN_DATA: path.join(dir, "data")
  };

  applyProfile("alibaba", env);

  assert.equal(env.CODEX_HOME, "/x/codex-home");
  assert.equal(env.EXTRA, "1");
  assert.equal(env.API_KEY, "secret-token");
  assert.equal(env.CLAUDE_PLUGIN_DATA, path.join(dir, "data", "profiles", "alibaba"));
  assert.equal(env.CODEX_COMPANION_PROFILE, "alibaba");
  assert.deepEqual(configOverrideArgs(env), [
    "-c",
    'model_provider="alibaba-direct"',
    "-c",
    'model="qwen4-max"'
  ]);
});

test("applyProfile rejects unknown names, bad names and empty secrets", () => {
  const dir = makeTempDir();
  const empty = path.join(dir, "empty");
  fs.writeFileSync(empty, "  \n");
  const env = { CODEX_PROFILES_FILE: writeProfiles(dir, { ok: {}, blank: { env_files: { K: empty } } }) };

  assert.throws(() => applyProfile("missing", { ...env }), /Unknown Codex profile "missing".*Available: ok, blank/);
  assert.throws(() => applyProfile("../escape", { ...env }), /Invalid Codex profile name/);
  assert.throws(() => applyProfile("blank", { ...env }), /is empty/);
});

test("configOverrideArgs is empty without a profile", () => {
  assert.deepEqual(configOverrideArgs({}), []);
});

test("listProfileDataDirs lists profile dirs under the data root", () => {
  const root = makeTempDir();
  assert.deepEqual(listProfileDataDirs(root), []);
  fs.mkdirSync(path.join(root, "profiles", "alibaba"), { recursive: true });
  assert.deepEqual(listProfileDataDirs(root), [path.join(root, "profiles", "alibaba")]);
});
