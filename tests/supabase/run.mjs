import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const env = { ...process.env };
// Never load .env, a linked project, database URLs, or hosted CLI credentials.
for (const key of Object.keys(env)) {
    if (/^(SUPABASE_|NEXT_PUBLIC_SUPABASE_|PG|DATABASE_URL$)/i.test(key)) delete env[key];
}
if (env.DOCKER_HOST || env.DOCKER_CONTEXT) {
    throw new Error("Unset DOCKER_HOST and DOCKER_CONTEXT; only the default local Docker engine is allowed.");
}
const cli = "supabase";
function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: root, env, encoding: "utf8", timeout: 10 * 60 * 1000,
        stdio: options.capture ? "pipe" : ["pipe", "inherit", "inherit"],
        ...options,
    });
    if (result.error) throw new Error(command + ": " + result.error.message);
    if (result.status !== 0) {
        // Status JSON contains local secrets; never include captured stdout.
        throw new Error(command + " exited " + result.status);
    }
    return result.stdout;
}

let scratch;
let started = false;
let project;
let failed = false;
try {
    const context = JSON.parse(run("docker", ["context", "inspect"], { capture: true }))[0];
    const host = context.Endpoints?.docker?.Host ?? "";
    if (!/^(unix:\/\/|npipe:\/\/)/.test(host)) throw new Error("Docker engine must use a local unix socket or named pipe.");
    run("docker", ["info"], { capture: true });
    scratch = mkdtempSync(join(tmpdir(), "autotrack-supabase-"));
    project = "autotrack-security-" + randomUUID().slice(0, 8);
    const local = (args, options) => run(cli, [...args, "--workdir", scratch], options);
    if (local(["--version"], { capture: true }).trim() !== "2.75.0") throw new Error("Supabase CLI 2.75.0 is required.");
    local(["init", "--yes"]);
    const configPath = join(scratch, "supabase/config.toml");
    let config = readFileSync(configPath, "utf8");
    config = config.replace(/^project_id = .+$/m, 'project_id = "' + project + '"');
    // Dedicated ports: collisions fail startup; no existing service is reset.
    config = config.replace(/5432([0-9])/g, "5642$1");
    writeFileSync(configPath, config);
    started = true; // Also clean partial starts.
    local(["start", "-x", "studio,imgproxy,edge-runtime,logflare,vector,supavisor"]);
    const status = JSON.parse(local(["status", "-o", "json"], { capture: true }));
    if (status.API_URL !== "http://127.0.0.1:56421") throw new Error("Unexpected local API URL.");
    if (!status.ANON_KEY || !status.SERVICE_ROLE_KEY) throw new Error("Missing generated local keys.");

    const sql = (source, extra = []) => run("docker", [
        "exec", "-i", "supabase_db_" + project, "psql", "--no-psqlrc",
        "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", ...extra,
    ], { input: source });
    const migrationDir = join(root, "supabase/migrations");
    const migrations = readdirSync(migrationDir).filter(name => name.endsWith(".sql")).sort();
    const ownership = readFileSync(join(migrationDir, "20261025160000_per_user_data_access.sql"), "utf8");
    const legacyEmail = ownership.match(/lower\('([^']+)'\)/)?.[1];
    if (!legacyEmail) throw new Error("Legacy migration owner lookup changed; review bootstrap.");
    sql(readFileSync(join(root, "tests/supabase/legacy-schema.sql"), "utf8"), ["-v", "legacy_owner_email=" + legacyEmail]);
    for (const name of migrations) {
        console.log("Applying unmodified migration: " + name);
        sql(readFileSync(join(migrationDir, name), "utf8"));
    }
    sql(readFileSync(join(root, "tests/supabase/migration-checks.sql"), "utf8"));
    run(process.execPath, [
        join(root, "node_modules/jest/bin/jest.js"),
        "--config", "tests/supabase/jest.config.ts", "--runInBand",
        "--json", "--outputFile=test-results/supabase-results.json",
    ], {
        env: {
            ...env, AUTOTRACK_DISPOSABLE_RUN: project, TZ: "America/Toronto",
            AUTOTRACK_TEST_URL: status.API_URL,
            AUTOTRACK_TEST_ANON_KEY: status.ANON_KEY,
            AUTOTRACK_TEST_SERVICE_KEY: status.SERVICE_ROLE_KEY,
            NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
        },
    });
} catch (error) {
    failed = true;
    console.error(error.message);
} finally {
    if (started) {
        try { run(cli, ["stop", "--no-backup", "--workdir", scratch]); }
        catch (error) { failed = true; console.error("Cleanup failed: " + error.message); }
    }
    if (scratch) rmSync(scratch, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
