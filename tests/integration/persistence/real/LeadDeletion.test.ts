import type { SupabaseClient } from "@supabase/supabase-js";
import { LeadRepo } from "@/lib/persistence/real/supabase/LeadRepo";

jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));

function setup() {
    const rpc = jest.fn();
    const from = jest.fn(() => { throw new Error("Deletion must use one transaction RPC"); });
    const repo = new LeadRepo({ rpc, from } as unknown as SupabaseClient);
    return { rpc, from, repo };
}

describe("Customer deletion transaction contract", () => {
    it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
        "rejects invalid or rounded bigint IDs (%s) before reaching the database", async (id) => {
            const { repo, rpc, from } = setup();
            expect(await repo.deleteLead(id)).toContain("Invalid customer ID");
            expect(rpc).not.toHaveBeenCalled();
            expect(from).not.toHaveBeenCalled();
        }
    );

    it("uses one RPC without a preflight read or direct deletes", async () => {
        const { repo, rpc, from } = setup();
        rpc.mockResolvedValue({ data: null, error: null });
        expect(await repo.deleteLead(7)).toBeNull();
        expect(rpc).toHaveBeenCalledTimes(1);
        expect(rpc).toHaveBeenCalledWith("autotrack_delete_lead", { p_lead_id: 7 });
        expect(from).not.toHaveBeenCalled();
    });

    it.each(["Lead not found.", "Sign in required.", "Dependent record prevents deletion."])(
        "reports transaction rejection: %s", async (message) => {
            const { repo, rpc, from } = setup();
            rpc.mockResolvedValue({ error: { code: "P0001", message } });
            expect(await repo.deleteLead(7)).toBe(message);
            expect(from).not.toHaveBeenCalled();
        }
    );

    it.each(["PGRST202", "42883"])("explains a missing migration (%s), with no fallback", async (code) => {
        const { repo, rpc, from } = setup();
        rpc.mockResolvedValue({ error: { code, message: "Function missing" } });
        expect(await repo.deleteLead(7)).toContain("required database migration");
        expect(from).not.toHaveBeenCalled();
    });

    it("handles a rejected transport without claiming rollback or retrying", async () => {
        const { repo, rpc } = setup();
        rpc.mockRejectedValue(new Error("Network unavailable"));
        expect(await repo.deleteLead(7)).toContain("Unable to confirm customer deletion");
        expect(rpc).toHaveBeenCalledTimes(1);
    });
});
