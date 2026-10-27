/** @jest-environment node */
import type { SupabaseClient } from "@supabase/supabase-js";
import { LeadRepo } from "@/lib/persistence/real/supabase/LeadRepo";

jest.mock("@/lib/supabase/client", () => ({ supabase: { from: jest.fn(() => { throw new Error("Unexpected default client"); }) } }));

describe("request-scoped lead repository", () => {
    function clientFor(leadId: number) {
        const order = jest.fn().mockResolvedValue({ data: [{ lead_id: leadId, first_name: "Synthetic" }], error: null });
        const select = jest.fn().mockReturnValue({ order });
        const from = jest.fn().mockReturnValue({ select });
        return { client: { from } as unknown as SupabaseClient, from };
    }
    it("keeps simultaneous request clients separate", async () => {
        const a = clientFor(1), b = clientFor(2);
        const [leadsA, leadsB] = await Promise.all([new LeadRepo(a.client).getAllLeads(), new LeadRepo(b.client).getAllLeads()]);
        expect(leadsA[0].leadID).toBe(1);
        expect(leadsB[0].leadID).toBe(2);
        expect(a.from).toHaveBeenCalledWith("leads");
        expect(b.from).toHaveBeenCalledWith("leads");
    });
});
