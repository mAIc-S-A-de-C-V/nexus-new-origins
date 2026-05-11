#!/usr/bin/env node
/**
 * Nexus App CLI.
 *
 * The SDK is NEVER distributed via npm (public or private). It lives inside
 * apps-service and is fetched over an authenticated HTTPS connection at
 * `init` (or `vendor`) time, then vendored into the project so subsequent
 * `npm install` runs never call out for it.
 *
 * Subcommands:
 *   nexus-app login                  Prompt for URL/tenant/email/password, store token in ~/.nexus/credentials.json.
 *   nexus-app logout                 Remove the credential file.
 *   nexus-app whoami                 Show the active credential.
 *   nexus-app init <name>            Scaffold a new app and vendor the SDK locally.
 *   nexus-app vendor                 (Re)download the SDK tarball into ./node_modules/@nexus/app-sdk/.
 *   nexus-app dev                    Run the local dev server (Vite, mock SDK).
 *   nexus-app build                  Build production bundle to dist/.
 *   nexus-app publish                Build + publish to apps-service.
 *   nexus-app install                Convenience: install the just-published version in the current tenant.
 *   nexus-app versions <app_id>      List published versions.
 *   nexus-app brief                  Download AI context for the current tenant.
 */
import {
  existsSync, readFileSync, writeFileSync, mkdirSync, statSync,
  readdirSync, rmSync, chmodSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import * as readline from "node:readline";
import { Writable } from "node:stream";
import { create as tarCreate, extract as tarExtract } from "tar";

// Filesystem location of this script. In ESM-from-source `import.meta.url`
// is the way; in esbuild's CJS bundle `__filename` is defined and
// `import.meta.url` is undefined. Try both so the same source works in
// both modes. (The CJS bundle's __filename points at the install dir,
// e.g. ~/.nexus/bin/nexus-app — there's no sibling template/ there. The
// template is fetched from the server at init time instead; see cmdInit.)
const SELF_PATH = (() => {
  if (typeof __filename !== "undefined") return __filename;
  try { return fileURLToPath(import.meta.url); } catch { return process.argv[1] || ""; }
})();
const SELF_DIR = SELF_PATH ? dirname(SELF_PATH) : process.cwd();
// Only valid when running from the SDK source repo (npm run dev / linked install).
const TEMPLATE_DIR_LOCAL = resolve(SELF_DIR, "..", "template");

const CREDS_DIR = join(homedir(), ".nexus");
const CREDS_FILE = join(CREDS_DIR, "credentials.json");

const argv = process.argv.slice(2);
const cmd = argv[0];
const argFlag = (name) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 ? argv[i + 1] : undefined;
};

function die(msg, code = 1) {
  console.error("error: " + msg);
  process.exit(code);
}

// ── Credentials store ──
function loadCreds() {
  if (!existsSync(CREDS_FILE)) return null;
  try { return JSON.parse(readFileSync(CREDS_FILE, "utf8")); } catch { return null; }
}
function saveCreds(c) {
  if (!existsSync(CREDS_DIR)) mkdirSync(CREDS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CREDS_FILE, JSON.stringify(c, null, 2), { mode: 0o600 });
  try { chmodSync(CREDS_FILE, 0o600); } catch {}
}

function resolveCreds() {
  // Precedence: env vars (for CI) > stored creds.
  const stored = loadCreds() || {};
  return {
    apps_url:  process.env.NEXUS_APPS_URL  || stored.apps_url  || "",
    auth_url:  process.env.NEXUS_AUTH_URL  || stored.auth_url  || "",
    tenant_id: process.env.NEXUS_TENANT_ID || stored.tenant_id || "tenant-001",
    email:     process.env.NEXUS_EMAIL     || stored.email     || "",
    token:     process.env.NEXUS_TOKEN     || stored.token     || "",
  };
}

// Optional tenant impersonation. Only honoured by apps-service when the
// authenticated user is a superadmin; other roles get a silent no-op
// and operate in their home tenant.
function impersonateTenant() {
  return process.env.NEXUS_IMPERSONATE_TENANT || argFlag("as-tenant") || "";
}

function authHeaders(creds) {
  const h = { "x-tenant-id": creds.tenant_id };
  if (creds.token) h["Authorization"] = "Bearer " + creds.token;
  const imp = impersonateTenant();
  if (imp) h["x-impersonate-tenant"] = imp;
  return h;
}

async function apiFetch(path, opts = {}) {
  const creds = resolveCreds();
  if (!creds.apps_url) die("not logged in — run `nexus-app login`");
  const url = creds.apps_url + path;
  const res = await fetch(url, {
    ...opts,
    headers: { ...authHeaders(creds), ...(opts.headers || {}) },
  });
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`${opts.method || "GET"} ${path} → ${res.status}: ${detail}`);
  }
  return body;
}

function prompt(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const muteOut = new Writable({
      write: function (chunk, encoding, cb) {
        if (!hidden || (chunk + "").includes(question)) process.stdout.write(chunk, encoding);
        cb();
      },
    });
    const rl = readline.createInterface({ input: process.stdin, output: muteOut, terminal: true });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

function loadManifest() {
  const path = resolve(process.cwd(), "manifest.json");
  if (!existsSync(path)) die("manifest.json not found in cwd");
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { die("manifest.json parse error: " + e.message); }
}

// ── login ──
async function cmdLogin() {
  // Single base URL — both apps and auth live behind it (apps at root,
  // auth at /api/auth). Operators with a different topology can override
  // either piece via --apps-url / --auth-url or env vars.
  const base_url  = argFlag("base-url")  || await prompt("Nexus base URL (e.g. https://app.maic.ai): ");
  if (!base_url) die("base URL required");
  const trimmed   = base_url.replace(/\/+$/, "");
  const apps_url  = argFlag("apps-url")  || trimmed;
  const auth_url  = argFlag("auth-url")  || `${trimmed}/api/auth`;
  const tenant_id = argFlag("tenant")    || await prompt("Tenant id [tenant-001]: ") || "tenant-001";
  const email     = argFlag("email")     || await prompt("Email: ");
  if (!email) die("email required");
  const password  = argFlag("password")  || await prompt("Password: ", { hidden: true });

  const res = await fetch(`${auth_url}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tenant_id }),
  });
  if (!res.ok) die(`login failed: ${res.status} ${await res.text().catch(() => "")}\n(tried ${auth_url}/auth/login — override with --auth-url if your topology differs)`);
  const data = await res.json();
  if (!data.access_token) die("login response missing access_token");

  saveCreds({ apps_url, auth_url, tenant_id, email, token: data.access_token });
  console.log(`logged in as ${email} (${tenant_id}). credentials in ${CREDS_FILE}`);
}

// ── logout ──
async function cmdLogout() {
  if (existsSync(CREDS_FILE)) rmSync(CREDS_FILE);
  console.log("logged out");
}

// ── whoami ──
async function cmdWhoami() {
  const c = loadCreds();
  if (!c) { console.log("not logged in"); return; }
  const masked = { ...c, token: c.token ? c.token.slice(0, 12) + "…" : "" };
  console.log(JSON.stringify(masked, null, 2));
}

// ── vendor ──
// Saves the SDK tarball to ./vendor/nexus-app-sdk.tgz and pins
// package.json → "@nexus/app-sdk": "file:./vendor/nexus-app-sdk.tgz".
// `npm install` then installs from the local file — no registry call,
// nothing to prune.
async function cmdVendor() {
  const version = argFlag("version") || "latest";
  const creds = resolveCreds();
  if (!creds.apps_url) die("not logged in — run `nexus-app login` first");

  const vendorDir = resolve(process.cwd(), "vendor");
  if (!existsSync(vendorDir)) mkdirSync(vendorDir, { recursive: true });
  const tarballPath = resolve(vendorDir, "nexus-app-sdk.tgz");

  console.log(`fetching SDK ${version} from ${creds.apps_url}…`);
  const res = await fetch(`${creds.apps_url}/sdk/tarball/${version}`, { headers: authHeaders(creds) });
  if (!res.ok) die(`fetch SDK: ${res.status} ${await res.text()}`);
  writeFileSync(tarballPath, Buffer.from(await res.arrayBuffer()));
  console.log(`  saved ${tarballPath}`);

  const pkgFile = resolve(process.cwd(), "package.json");
  if (existsSync(pkgFile)) {
    const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
    pkg.dependencies = pkg.dependencies || {};
    pkg.dependencies["@nexus/app-sdk"] = "file:./vendor/nexus-app-sdk.tgz";
    writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
    console.log("  pinned in package.json → run `npm install` to install the SDK from the tarball");
  }

  // If node_modules already exists, install immediately so the developer
  // doesn't have to run an extra command.
  if (existsSync(resolve(process.cwd(), "node_modules"))) {
    const r = spawnSync("npm", ["install", "--no-audit", "--no-fund", "vendor/nexus-app-sdk.tgz"], { stdio: "inherit", shell: true });
    if (r.status !== 0) console.warn("npm install of the tarball failed — run it manually");
  }
}

// ── init ──
async function cmdInit() {
  const name = argv[1];
  if (!name) die("usage: nexus-app init <app-name>");
  const target = resolve(process.cwd(), name);
  if (existsSync(target)) die(`${target} already exists`);
  mkdirSync(target, { recursive: true });

  // Two ways to get the template files:
  //   1. Local SDK source — only available when running from `node cli/index.mjs`
  //      with the SDK repo nearby (dev mode).
  //   2. apps-service `/cli/template` endpoint — for the standalone bundled
  //      binary distributed via install.sh. Requires the user to be logged
  //      in, which they are by definition (install.sh seeded the creds).
  if (existsSync(TEMPLATE_DIR_LOCAL)) {
    const { cpSync } = await import("node:fs");
    cpSync(TEMPLATE_DIR_LOCAL, target, { recursive: true });
  } else {
    const creds = resolveCreds();
    if (!creds.apps_url) die("not logged in and no local template/ found — run `nexus-app login` first");
    console.log(`fetching template from ${creds.apps_url}…`);
    const r = await fetch(`${creds.apps_url}/cli/template`, { headers: authHeaders(creds) });
    if (!r.ok) die(`template fetch: ${r.status} ${await r.text().catch(() => "")}`);
    const { files } = await r.json();
    for (const [relPath, content] of Object.entries(files)) {
      const out = join(target, relPath);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, content, "utf8");
    }
  }

  for (const fn of ["package.json", "manifest.json", "index.html", "src/main.tsx", "AI_CONTEXT.md"]) {
    const f = join(target, fn);
    if (existsSync(f)) {
      writeFileSync(f, readFileSync(f, "utf8")
        .replaceAll("{{name}}", name)
        .replaceAll("{{slug}}", name.toLowerCase().replace(/[^a-z0-9-]/g, "-")));
    }
  }

  console.log(`created ${target}`);
  console.log("");

  const creds = loadCreds();
  if (creds && creds.apps_url && creds.token) {
    const prev = process.cwd();
    process.chdir(target);
    try {
      await cmdVendor();
    } catch (e) {
      console.warn("could not vendor SDK now — run `nexus-app vendor` inside the project:", e.message);
    }
    process.chdir(prev);
  } else {
    console.log("Not logged in — SDK was not vendored.");
    console.log("Run `nexus-app login` then `nexus-app vendor` inside the project to pull the SDK.");
  }

  console.log("");
  console.log("Next steps:");
  console.log(`  cd ${name}`);
  console.log("  npm install        # installs react + vite + the vendored SDK");
  console.log("  npm run dev        # mock-mode dev server");
  console.log("");
  console.log("AI_CONTEXT.md is included. For a brief with this tenant's live ontology:");
  console.log("  nexus-app brief --out=AI_CONTEXT.md");
}

// ── dev ──
function cmdDev() {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
  if (!pkg.scripts || !pkg.scripts.dev) die("package.json has no 'dev' script");
  const proc = spawn("npm", ["run", "dev"], { stdio: "inherit", shell: true });
  proc.on("exit", (code) => process.exit(code || 0));
}

// ── build ──
function cmdBuild() {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
  if (!pkg.scripts || !pkg.scripts.build) die("package.json has no 'build' script");
  const r = spawnSync("npm", ["run", "build"], { stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status || 1);
  console.log("built. dist/ ready to publish");
}

// ── publish ──
async function cmdPublish() {
  const manifest = loadManifest();
  const dist = resolve(process.cwd(), "dist");
  if (!existsSync(dist)) die("dist/ not found — run nexus-app build first");

  const tarball = resolve(process.cwd(), `.nexus-bundle-${manifest.id}-${manifest.version}.tar.gz`);
  await tarCreate({ gzip: true, file: tarball, cwd: dist }, readdirSync(dist));

  const size = statSync(tarball).size;
  console.log(`  bundle size: ${(size / 1024).toFixed(1)} KB`);

  const creds = resolveCreds();
  if (!creds.apps_url) die("not logged in — run `nexus-app login`");

  const form = new FormData();
  form.append("manifest_json", JSON.stringify(manifest));
  form.append("bundle", new Blob([readFileSync(tarball)]), `${manifest.id}-${manifest.version}.tar.gz`);

  const res = await fetch(creds.apps_url + "/app-registry/publish", {
    method: "POST",
    headers: authHeaders(creds),
    body: form,
  });
  const body = await res.json();
  if (!res.ok) die("publish failed: " + JSON.stringify(body));
  console.log(`published ${manifest.id} v${manifest.version}`);
  console.log(`  sha256:    ${body.sha256}`);
  console.log(`  bundle_url ${body.bundle_url}`);
  try { rmSync(tarball); } catch {}
}

// ── install ──
async function cmdInstall() {
  const manifest = loadManifest();
  const body = await apiFetch("/app-installs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: manifest.id, version: manifest.version,
      scopes_granted: manifest.scopes || [], config: {},
    }),
  });
  console.log(`installed ${manifest.id} v${manifest.version}`);
  console.log(`  install_id: ${body.id}`);
}

// ── versions ──
async function cmdVersions() {
  const appId = argv[1];
  if (!appId) die("usage: nexus-app versions <app_id>");
  const body = await apiFetch(`/app-registry/apps/${appId}`);
  console.log(`${body.app.display_name} (${body.app.app_id})`);
  for (const v of body.versions) {
    console.log(`  ${v.version}${v.yanked ? " [YANKED]" : ""}  sha256:${v.bundle_sha256.slice(0, 12)}  ${v.bundle_size_bytes}B  ${v.published_at}`);
  }
}

// ── brief ──
async function cmdBrief() {
  const out = argFlag("out") || "AI_CONTEXT.md";
  const text = await apiFetch("/app-studio/ai-context");
  writeFileSync(resolve(process.cwd(), out), text);
  console.log(`wrote ${out}`);
}

const commands = {
  login: cmdLogin, logout: cmdLogout, whoami: cmdWhoami,
  init: cmdInit, vendor: cmdVendor,
  dev: cmdDev, build: cmdBuild, publish: cmdPublish, install: cmdInstall,
  versions: cmdVersions, brief: cmdBrief,
};

if (!commands[cmd]) {
  console.log("Usage: nexus-app <command> [--as-tenant=<tenant_id>]");
  console.log("Commands: " + Object.keys(commands).join(", "));
  console.log("");
  console.log("Global flags:");
  console.log("  --as-tenant=<id>   Operate as a different tenant (superadmin only).");
  console.log("                     Or set NEXUS_IMPERSONATE_TENANT in your env.");
  process.exit(cmd ? 1 : 0);
}

// Heads-up message when impersonation is active so it's never a surprise.
const _imp = impersonateTenant();
if (_imp) console.error(`[impersonating tenant: ${_imp}]`);

commands[cmd]().catch((e) => die(e.message));
