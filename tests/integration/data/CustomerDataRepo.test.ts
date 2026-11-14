import { createClient } from "@supabase/supabase-js";
import { CustomerDataRepo } from "@/lib/data/CustomerDataRepo";

jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));

const setupMessage = "Deleted customer recovery is unavailable. Ask an administrator to verify its database setup.";
const missingTable = {
    code: "PGRST205",
    message: "Could not find the table 'public.lead_recovery_snapshots' in the schema cache",
    details: null,
    hint: null,
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
});
function fixture() {
    const fetch = jest.fn();
    const client = createClient("http://127.0.0.1:54329", "synthetic-public-key", {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch },
    });
    return { fetch, repo: new CustomerDataRepo(client) };
}

describe("Customer recovery HTTP responses", () => {
    it("identifies the observed missing-table response and retains diagnostic evidence", async () => {
        const { fetch, repo } = fixture();
        fetch.mockResolvedValue(reply(missingTable, 404));
        await expect(repo.listDeleted()).rejects.toMatchObject({
            name: "CustomerRecoveryUnavailableError", message: setupMessage, cause: missingTable,
        });
        const [input, init] = fetch.mock.calls[0];
        const url = new URL(input);
        expect(url.pathname).toBe("/rest/v1/lead_recovery_snapshots");
        expect(url.searchParams.get("select")).toBe("recovery_id,lead_id::text,deleted_at,snapshot");
        expect(url.searchParams.get("restored_at")).toBe("is.null");
        expect(init.method).toBe("GET");
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("can load again once the table is available without caching the setup failure", async () => {
        const { fetch, repo } = fixture();
        fetch.mockResolvedValueOnce(reply(missingTable, 404)).mockResolvedValueOnce(reply([]));
        await expect(repo.listDeleted()).rejects.toThrow(setupMessage);
        await expect(repo.listDeleted()).resolves.toEqual([]);
    });

    it.each([
        [401, "42501", "permission denied"],
        [503, "PGRST002", "database unavailable"],
        [404, "PGRST999", "unrelated failure"],
    ])("keeps HTTP %s / %s failures distinct from unavailable setup", async (status, code, message) => {
        const { fetch, repo } = fixture();
        fetch.mockResolvedValue(reply({ code, message }, status));
        await expect(repo.listDeleted()).rejects.toThrow("Unable to load deleted customers");
    });

    it("still preserves text IDs and rejects malformed snapshots", async () => {
        const { fetch, repo } = fixture();
        const entry = { recovery_id: "11111111-1111-4111-8111-111111111111", lead_id: "9007199254740993",
            deleted_at: "2026-11-07T12:00:00Z", snapshot: { lead: { first_name: "Synthetic" }, tasks: [], notifications: [] } };
        fetch.mockResolvedValueOnce(reply([entry])).mockResolvedValueOnce(reply([{ ...entry, snapshot: null }]));
        await expect(repo.listDeleted()).resolves.toEqual([entry]);
        await expect(repo.listDeleted()).rejects.toThrow("Unable to load deleted customers");
    });
});
