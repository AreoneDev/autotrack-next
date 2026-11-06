import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Audit both production and development graphs; registry/network/schema errors fail closed.
const npmCLI = process.env.npm_execpath;
if (!npmCLI) throw new Error("Run via npm run test:dependencies");
mkdirSync("nfr-reports", { recursive: true });
let failed = false;
for (const [name, extra] of [["all", []], ["production", ["--omit=dev"]]]) {
    const result = spawnSync(process.execPath, [npmCLI, "audit", "--json", "--audit-level=high", ...extra],
        { encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    writeFileSync("nfr-reports/dependencies-" + name + ".json", result.stdout ?? "");
    let audit;
    try { audit = JSON.parse(result.stdout); } catch { failed = true; }
    const counts = audit?.metadata?.vulnerabilities;
    const valid = counts && ["low", "moderate", "high", "critical"].every(key => Number.isInteger(counts[key]));
    if (result.error || !valid || audit.error || result.status !== 0 || counts.high > 0 || counts.critical > 0) failed = true;
    const summary = { scope: name, validReport: !!valid, counts, exitCode: result.status,
        lockSha256: createHash("sha256").update(readFileSync("package-lock.json")).digest("hex"),
        capturedAt: new Date().toISOString(), error: result.error?.message ?? audit?.error };
    writeFileSync("nfr-reports/dependencies-" + name + "-summary.json", JSON.stringify(summary, null, 2));
    console.log("SEC-DEP-01", JSON.stringify(summary));
}
if (failed) process.exitCode = 1;
