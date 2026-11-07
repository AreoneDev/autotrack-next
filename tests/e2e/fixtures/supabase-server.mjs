import { createServer } from "node:http";

// A deliberately small HTTP double for browser journeys, NOT a Supabase/RLS emulator.
// Bind to loopback only; unknown requests fail rather than silently succeeding.
const backendPort = Number(process.env.AUTOTRACK_TEST_BACKEND_PORT ?? process.env.E2E_BACKEND_PORT ?? 54329);
const appPort = Number(process.env.AUTOTRACK_TEST_BACKEND_PORT === "54339" ? 3200 : (process.env.E2E_APP_PORT ?? 3100));
if (![appPort, backendPort].every((port) => Number.isInteger(port) && port >= 1024 && port <= 65535)) throw new Error("Invalid E2E port");
const user = {
    id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated",
    email: "ada@example.test", email_confirmed_at: "2026-01-01T00:00:00Z",
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {},
    identities: [], created_at: "2026-01-01T00:00:00Z",
};
let tables;
let nextId;
let failure;
function reset(seed = {}) {
    tables = {
        leads: [], tasks: [], notifications: [], vehicles: [],
        lead_vehicle_interests: [], lead_trade_in_vehicles: [],
    };
    nextId = 100;
    failure = null;
    for (const [table, rows] of Object.entries(seed)) {
        if (!Object.hasOwn(tables, table) || !Array.isArray(rows)) throw new Error("Invalid synthetic seed");
        tables[table] = rows;
        for (const row of rows) {
            const idColumn = { leads: "lead_id", tasks: "task_id", notifications: "notification_id" }[table];
            const id = row[idColumn];
            if (Number.isInteger(id)) nextId = Math.max(nextId, id + 1);
        }
    }
}
reset();

function session() {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    // The SDK validates HS256 tokens through /auth/v1/user in this isolated double.
    const accessToken = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, aud: "authenticated", role: "authenticated", email: user.email, iat: now, exp: now + 3600 })}.c3ludGhldGlj`;
    return { access_token: accessToken, refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user };
}

function filterRows(rows, search) {
    return rows.filter((row) => [...search.entries()].every(([column, filter]) => {
        if (["select", "order", "limit", "offset", "on_conflict"].includes(column)) return true;
        if (column === "or") {
            return filter.slice(1, -1).split(",").some((clause) => {
                const match = /^(\w+)\.ilike\.(.*)$/.exec(clause);
                if (!match) throw new Error(`Unsupported test search: ${clause}`);
                const pattern = match[2].split("").map((character) =>
                    character === "%" ? ".*" : character === "_" ? "." : character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
                ).join("");
                return new RegExp(`^${pattern}$`, "i").test(String(row[match[1]] ?? ""));
            });
        }
        const dot = filter.indexOf(".");
        const operation = filter.slice(0, dot);
        const value = filter.slice(dot + 1);
        if (operation === "in") return value.slice(1, -1).split(",").includes(String(row[column]));
        if (operation === "eq") return String(row[column]) === value;
        if (operation === "neq") return String(row[column]) !== value;
        if (operation === "gte") return String(row[column]) >= value;
        if (operation === "lt") return String(row[column]) < value;
        throw new Error(`Unsupported test filter: ${column}=${filter}`);
    }));
}

const server = createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", `http://127.0.0.1:${appPort}`);
    response.setHeader("Access-Control-Allow-Headers", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    response.setHeader("Content-Type", "application/json");
    const send = (status, data) => { response.writeHead(status); response.end(JSON.stringify(data)); };
    if (request.method === "OPTIONS") return send(200, {});
    const url = new URL(request.url, `http://127.0.0.1:${backendPort}`);
    try {
        if (url.pathname === "/health") return send(200, { ready: true });
        let text = "";
        for await (const chunk of request) text += chunk;
        const body = text ? JSON.parse(text) : {};
        if (url.pathname === "/__test__/reset" && request.method === "POST") { reset(body); return send(200, {}); }
        if (url.pathname === "/__test__/state" && request.method === "GET") return send(200, tables);
        if (url.pathname === "/__test__/fail-next" && request.method === "POST") {
            if (!Object.hasOwn(tables, body.table) || !["GET", "POST", "PATCH", "DELETE"].includes(body.method) ||
                (body.count !== undefined && (!Number.isInteger(body.count) || body.count < 1 || body.count > 100))) {
                return send(400, { message: "Invalid failure rule" });
            }
            failure = { ...body, remaining: body.count ?? 1 };
            return send(200, {});
        }
        if (url.pathname === "/auth/v1/token" && request.method === "POST") {
            if (body.email !== user.email || body.password !== "test-password-123") {
                return send(400, { code: "invalid_credentials", msg: "Invalid login credentials" });
            }
            return send(200, session());
        }
        if (url.pathname === "/auth/v1/user" && request.method === "GET") {
            if (!request.headers.authorization?.startsWith("Bearer ey")) return send(401, { msg: "Missing test session" });
            return send(200, user);
        }
        if (url.pathname === "/auth/v1/signup" && request.method === "POST") return send(200, { user, session: null });
        if (url.pathname === "/auth/v1/otp" && request.method === "POST") return send(200, {});
        if (url.pathname === "/auth/v1/logout" && request.method === "POST") return send(200, {});
        const table = url.pathname.replace("/rest/v1/", "");
        if (!url.pathname.startsWith("/rest/v1/") || !Object.hasOwn(tables, table)) {
            return send(404, { message: `Unimplemented test endpoint: ${request.method} ${url.pathname}` });
        }
        if (!request.headers.authorization?.startsWith("Bearer ey")) return send(401, { message: "Missing test session" });
        if (failure?.table === table && failure.method === request.method) {
            failure.remaining -= 1;
            if (failure.remaining === 0) failure = null;
            return send(503, { message: request.method === "GET" ? "Synthetic read failure" : "Synthetic write failure" });
        }
        let selected = filterRows(tables[table], url.searchParams);
        if (request.method === "GET") {
            if (url.searchParams.get("select")?.includes("vehicles(*)")) {
                selected = selected.map(row => ({ ...row, vehicles: tables.vehicles.find(vehicle => vehicle.vehicle_id === row.vehicle_id) ?? null }));
            }
            const ordering = url.searchParams.get("order");
            if (ordering) {
                const [column, direction] = ordering.split(".");
                selected = [...selected].sort((a, b) => (a[column] > b[column] ? 1 : a[column] < b[column] ? -1 : 0) * (direction === "desc" ? -1 : 1));
            }
            const start = Number(url.searchParams.get("offset") ?? 0);
            const limit = Number(url.searchParams.get("limit") ?? 1000);
            selected = selected.slice(start, start + limit);
            if (request.headers.accept?.includes("vnd.pgrst.object+json")) {
                if (selected.length !== 1) return send(406, { code: "PGRST116", details: `The result contains ${selected.length} rows`, message: "Cannot coerce result to a single JSON object" });
                return send(200, selected[0]);
            }
            return send(200, selected);
        }
        if (request.method === "POST") {
            const idColumn = { leads: "lead_id", tasks: "task_id", notifications: "notification_id" }[table];
            if (!idColumn) return send(400, { message: `Unsupported test insert: ${table}` });
            const inserted = (Array.isArray(body) ? body : [body]).map((row) => ({ ...row, [idColumn]: row[idColumn] ?? nextId++ }));
            tables[table].push(...inserted);
            return send(201, request.headers.accept?.includes("vnd.pgrst.object+json") ? inserted[0] : inserted);
        }
        if (request.method === "PATCH") { selected.forEach((row) => Object.assign(row, body)); return send(200, selected); }
        if (request.method === "DELETE") { tables[table] = tables[table].filter((row) => !selected.includes(row)); return send(200, selected); }
        return send(405, { message: "Unsupported test method" });
    } catch (error) {
        return send(500, { message: error.message });
    }
});
server.listen(backendPort, "127.0.0.1");
