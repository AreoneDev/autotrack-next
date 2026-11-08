/** @jest-environment node */
import type { SupabaseClient } from "@supabase/supabase-js";
import { LeadRepo } from "@/lib/persistence/real/supabase/LeadRepo";
import { DuplicateLeadError } from "@/domain/business/LeadValidation";
import { makeLead } from "@/tests/fixtures/domain";
jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));
describe("validated lead persistence", () => {
    const match = { leadID: 2, name: "Existing Customer", email: true, phone: false };
    const rpc = jest.fn();
    const existing = { lead_id: 1, first_name: "Old", phone: "old-invalid", lead_email: "legacy", budget: -5 };
    const from = jest.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }) }) }));
    const client = { rpc, from } as unknown as SupabaseClient;
    beforeEach(() => { rpc.mockReset(); });
    it("blocks invalid writes before making a request", async () => {
        const lead = makeLead({ leadID: 0, budget: NaN });
        expect(await new LeadRepo(client).insertLead(lead)).toMatch(/budget/);
        expect(rpc).not.toHaveBeenCalled();
    });
    it("normalizes outgoing contacts and uses the returned persisted values", async () => {
        const lead = makeLead({ leadID: 0, phone: "(416) 555-0100", leadEmail: " ADA@EXAMPLE.TEST " });
        rpc.mockResolvedValue({ data: { lead_id: 3, phone: "+14165550100", lead_email: "ada@example.test", budget: 0 }, error: null });
        expect(await new LeadRepo(client).insertLead(lead)).toBeNull();
        expect(rpc).toHaveBeenCalledWith("save_lead_validated", {
            p_lead: expect.objectContaining({ phone: "+14165550100", lead_email: "ada@example.test" }), p_duplicate_ids: [],
        });
        expect(lead).toMatchObject({ leadID: 3, phone: "+14165550100", leadEmail: "ada@example.test" });
    });
    it("surfaces matches and only sends explicitly confirmed IDs on retry", async () => {
        const lead = makeLead({ leadID: 0, leadEmail: "same@example.test" });
        rpc.mockResolvedValueOnce({ data: null, error: { message: "AUTOTRACK_DUPLICATE_LEAD", details: JSON.stringify([match]) } });
        await expect(new LeadRepo(client).insertLead(lead)).rejects.toMatchObject({ matches: [match] });
        expect(lead.leadID).toBe(0);
        rpc.mockResolvedValue({ data: { lead_id: 4, lead_email: "same@example.test" }, error: null });
        expect(await new LeadRepo(client).insertLead(lead, [2])).toBeNull();
        expect(rpc.mock.calls[1][1].p_duplicate_ids).toEqual([2]);
    });
    it("keeps ordinary write errors and malformed duplicate payloads actionable", async () => {
        rpc.mockResolvedValue({ data: null, error: { message: "Permission denied" } });
        expect(await new LeadRepo(client).insertLead(makeLead())).toBe("Permission denied");
        rpc.mockResolvedValue({ data: null, error: { message: "AUTOTRACK_DUPLICATE_LEAD", details: "invalid" } });
        expect(await new LeadRepo(client).insertLead(makeLead())).toMatch(/reload and review/);
        expect(new DuplicateLeadError([match])).toBeInstanceOf(Error);
    });
    it("permits unrelated updates to old invalid contacts and budgets", async () => {
        const lead = makeLead({ phone: existing.phone, leadEmail: existing.lead_email, budget: existing.budget, notes: "Updated" });
        rpc.mockResolvedValue({ data: existing, error: null });
        expect(await new LeadRepo(client).updateLead(lead)).toBeNull();
        expect(rpc.mock.calls[0][1].p_lead).toMatchObject({ phone: "old-invalid", lead_email: "legacy", budget: -5 });
    });
});
