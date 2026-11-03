import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(root);
mkdirSync("nfr-reports", { recursive: true });
const report = { case: "REC-01", scope: "disposable PostgreSQL 17, synthetic historical-schema contract", passed: false, rtoBudgetMs: 60000 };
let container;
function docker(args, input, allowFailure = false) {
    const result = spawnSync("docker", args, { input, encoding: "utf8", timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
    if (result.error || (result.status !== 0 && !allowFailure)) {
        throw new Error("docker " + args[0] + " failed: " + (result.error?.message ?? result.stderr));
    }
    return result;
}
function exec(args, input, allowFailure = false) {
    return docker(["exec", "-i", container, ...args], input, allowFailure);
}
function sql(database, text) {
    return exec(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-qAt", "-U", "postgres", "-d", database], text).stdout;
}
const file = (name) => readFileSync("tests/recovery/" + name, "utf8");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const schema = (database) => exec(["pg_dump", "-U", "postgres", "--schema-only", "--no-owner", database]).stdout
    .split("\n").filter(line => !line.startsWith("--") && !line.startsWith("\\restrict") && !line.startsWith("\\unrestrict") && line.trim()).join("\n");
try {
    if (process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT) throw new Error("Unset Docker host/context overrides; use the local engine only");
    const context = JSON.parse(docker(["context", "inspect"]).stdout)[0];
    if (!/^(unix:\/\/|npipe:\/\/)/.test(context.Endpoints?.docker?.Host ?? "")) throw new Error("Docker engine must use a local Unix socket or named pipe");
    docker(["version", "--format", "{{.Server.Version}}"]);
    container = docker(["run", "-d", "--network", "none", "--name", "autotrack-recovery-" + randomBytes(6).toString("hex"),
        "-e", "POSTGRES_PASSWORD=synthetic-disposable-only", "postgres:17"]).stdout.trim();
    if (!/^[a-f0-9]{64}$/.test(container)) throw new Error("Unexpected container ID");
    // The image boots a temporary Unix-socket-only server during initdb.
    // Internal TCP readiness waits for the final server; no host port is exposed.
    let ready = false;
    for (let i = 0; i < 60; i++) {
        if (exec(["pg_isready", "-h", "127.0.0.1", "-U", "postgres"], undefined, true).status === 0) { ready = true; break; }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
    if (!ready) throw new Error("Disposable PostgreSQL did not become ready");
    report.postgresVersion = sql("postgres", "select version();").trim();
    exec(["createdb", "-U", "postgres", "autotrack_source"]);
    sql("autotrack_source", file("bootstrap.sql"));
    const migrations = ["20261025160000_per_user_data_access.sql", "20261031010000_restrict_extra_table_privileges.sql"];
    report.migrations = [];
    for (const name of migrations) {
        let migration = readFileSync("supabase/migrations/" + name, "utf8");
        report.migrations.push({ name, sha256: hash(migration) });
        if (name === migrations[0]) {
            // Replace only the historic selected-login literal, never create/use that real account.
            const matches = migration.match(/lower\('[^']+@[^']+'\)/g) ?? [];
            if (matches.length !== 1) throw new Error("Historic migration owner literal changed; review fixture adaptation");
            migration = migration.replace(matches[0], "lower('owner-a@example.test')");
        }
        sql("autotrack_source", migration);
    }
    sql("autotrack_source", file("seed.sql"));
    console.log(sql("autotrack_source", file("verify.sql")).trim());
    const snapshot = sql("autotrack_source", file("snapshot.sql"));
    const sourceSchema = schema("autotrack_source");
    const backupStarted = performance.now();
    exec(["pg_dump", "-U", "postgres", "-Fc", "-f", "/tmp/autotrack.dump", "autotrack_source"]);
    report.backupMs = performance.now() - backupStarted;
    report.archiveSha256 = exec(["sha256sum", "/tmp/autotrack.dump"]).stdout.split(" ")[0];
    // A committed post-backup row must NOT appear in the restored point-in-time snapshot.
    sql("autotrack_source", "insert into public.leads(first_name,owner_id) values('After snapshot','11111111-1111-4111-8111-111111111111');");
    const restoreStarted = performance.now();
    exec(["createdb", "-U", "postgres", "autotrack_restored"]);
    exec(["pg_restore", "-U", "postgres", "--exit-on-error", "--single-transaction", "-d", "autotrack_restored", "/tmp/autotrack.dump"]);
    const restored = sql("autotrack_restored", file("snapshot.sql"));
    const restoredSchema = schema("autotrack_restored");
    if (snapshot !== restored) throw new Error("Restored rows/sequence states differ from backup snapshot");
    if (sourceSchema !== restoredSchema) throw new Error("Restored schema, policies, grants, indexes or functions differ");
    report.snapshotSha256 = hash(snapshot);
    report.schemaSha256 = hash(sourceSchema);
    console.log(sql("autotrack_restored", file("verify.sql")).trim());
    report.restoreAndVerifyMs = performance.now() - restoreStarted;
    if (report.restoreAndVerifyMs >= report.rtoBudgetMs) throw new Error("Recovery exceeded 60-second fixture RTO");
    if (sql("autotrack_restored", "select count(*) from public.leads where first_name='After snapshot';").trim() !== "0") throw new Error("Point-in-time boundary violated");
    // REC-02: a truncated archive must be rejected; never restore over the source.
    exec(["createdb", "-U", "postgres", "autotrack_corrupt"]);
    const archive = exec(["head", "-c", "64", "/tmp/autotrack.dump"]).stdout;
    const corrupt = exec(["pg_restore", "-U", "postgres", "--exit-on-error", "--single-transaction", "-d", "autotrack_corrupt"], archive, true);
    if (corrupt.status === 0) throw new Error("Truncated archive was accepted");
    report.corruptArchiveRejected = true;
    report.rpo = "Zero missing rows relative to the completed synthetic backup snapshot; post-backup write intentionally absent";
    report.passed = true;
} catch (error) {
    report.error = error.message;
    process.exitCode = 1;
} finally {
    if (container && /^[a-f0-9]{64}$/.test(container)) {
        const cleanup = docker(["rm", "-f", container], undefined, true);
        report.containerRemoved = cleanup.status === 0;
        if (!report.containerRemoved) { report.passed = false; process.exitCode = 1; }
    }
    writeFileSync("nfr-reports/recovery.json", JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
}
