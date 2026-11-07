import { hydrateLeadTableData } from "@/lib/persistence/real/supabase/LeadTableHydrator";
import { makeLead } from "@/tests/fixtures/domain";
import { scriptedClient } from "@/tests/helpers/supabase";
jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));

const vehicle = { vehicle_id: 42, make: "Synthetic", model: "Catalogue", year: 2026, trim: "Base" };
describe("PERF-DB — bounded association hydration", () => {
    it.each([0, 1, 199, 200, 201, 1000])("PERF-DB-01: %i leads with no associations use two queries per 200-ID batch", async count => {
        const replies = Array.from({ length: Math.ceil(count / 200) * 2 }, () => ({ data: [] }));
        const db = scriptedClient(replies);
        const leads = Array.from({ length: count }, (_, i) => makeLead({ leadID: i + 1 }));
        const hydrated = await hydrateLeadTableData(leads, db.client);
        expect(hydrated).toHaveLength(count);
        expect(db.from).toHaveBeenCalledTimes(replies.length);
        db.queries.forEach((query, i) => {
            const batchStart = Math.floor(i / 2) * 200 + 1;
            expect(query.in).toHaveBeenCalledWith("lead_id",
                Array.from({ length: Math.min(200, count - batchStart + 1) }, (_, n) => batchStart + n));
        });
    });
    it("loads 1000 populated leads in bounded batches instead of per-lead queries", async () => {
        const replies = [];
        for (let start = 1; start <= 1000; start += 200) {
            replies.push({ data: Array.from({ length: 200 }, (_, i) => ({ lead_id: start + i, trim_override: null, vehicles: vehicle })) });
            replies.push({ data: [] }, { data: [] });
        }
        const db = scriptedClient(replies);
        const leads = Array.from({ length: 1000 }, (_, i) => makeLead({ leadID: i + 1 }));
        const result = await hydrateLeadTableData(leads, db.client);
        expect(result.every(lead => lead.vehicleInterest?.vehicleID === 42)).toBe(true);
        expect(db.from).toHaveBeenCalledTimes(15);
        expect(Math.max(...db.queries.map(query => query.in.mock.calls[0][1].length))).toBe(200);
    });

    it("PERF-DB-02: trims are independent per lead and relationship; inaccessible vehicles stay null", async () => {
        const db = scriptedClient([
            { data: [
                { lead_id: 1, trim_override: "Custom", vehicles: vehicle },
                { lead_id: 2, trim_override: null, vehicles: vehicle },
                { lead_id: 3, trim_override: null, vehicles: null },
            ] },
            { data: [{ lead_id: 1, trim_override: "Trade", vehicles: vehicle }] },
            { data: [] }, { data: [] },
        ]);
        const leads = await hydrateLeadTableData([1, 2, 3].map(leadID => makeLead({ leadID })), db.client);
        expect(leads[0].vehicleInterest?.trim).toBe("Custom");
        expect(leads[0].tradeInVehicle?.trim).toBe("Trade");
        expect(leads[1].vehicleInterest?.trim).toBe("Base");
        expect(leads[2].vehicleInterest).toBeNull();
        expect(leads[0].vehicleInterest?.vehicleID).toBe(42);
        expect(vehicle.trim).toBe("Base");
    });
    it("PERF-DB-03: failed relationship reads reject without mutating leads", async () => {
        const db = scriptedClient([{ error: { message: "Denied" } }, { data: [] }]);
        const lead = makeLead();
        await expect(hydrateLeadTableData([lead], db.client)).rejects.toThrow("Unable to load lead vehicle details");
        expect(lead.vehicleInterest).toBeNull();
    });
});
