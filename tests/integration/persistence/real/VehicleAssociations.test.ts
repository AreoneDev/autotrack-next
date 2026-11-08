import { VehicleSelectionService } from "@/domain/business/VehicleSelectionService";
import { VehicleRepo } from "@/lib/persistence/real/supabase/VehicleRepo";
import { LeadVehicleInterestRepo } from "@/lib/persistence/real/supabase/LeadVehicleInterestRepo";
import { LeadTradeInVehicleRepo } from "@/lib/persistence/real/supabase/LeadTradeInVehicleRepo";
import { scriptedClient } from "@/tests/helpers/supabase";

jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));
const vehicleRow = { vehicle_id: 42, year: 2026, make: "Toyota", model: "RAV4", trim: "LE" };

describe.each(["interest", "trade-in"] as const)("DB-VEH — %s service/repository integration", (kind) => {
    function setup(replies: Parameters<typeof scriptedClient>[0]) {
        const db = scriptedClient(replies);
        const catalog = new VehicleRepo(db.client);
        const interest = new LeadVehicleInterestRepo(catalog, db.client);
        const tradeIn = new LeadTradeInVehicleRepo(catalog, db.client);
        const service = new VehicleSelectionService(catalog, interest, tradeIn);
        return {
            db,
            save: kind === "interest" ? service.saveLeadVehicleInterest.bind(service) : service.saveLeadTradeInVehicle.bind(service),
            load: kind === "interest" ? interest.getVehicleInterestByLeadId.bind(interest) : tradeIn.getTradeInVehicleByLeadId.bind(tradeIn),
            table: kind === "interest" ? "lead_vehicle_interests" : "lead_trade_in_vehicles",
        };
    }

    it("DB-VEH-01: catalog match saves the lead association without a trim override", async () => {
        const { db, save, table } = setup([{ data: [vehicleRow] }, {}]);
        expect(await save(7, { year: "2026", make: " Toyota ", model: "RAV4", trim: "LE" })).toBeNull();
        expect(db.from).toHaveBeenNthCalledWith(1, "vehicles");
        expect(db.from).toHaveBeenNthCalledWith(2, table);
        expect(db.queries[1].upsert).toHaveBeenCalledWith(expect.objectContaining({ lead_id: 7, vehicle_id: 42, trim_override: null }), { onConflict: "lead_id" });
    });

    it("DB-VEH-02: unknown trim falls back to model and preserves manual trim", async () => {
        const { db, save } = setup([{ data: [] }, { data: [vehicleRow] }, {}]);
        expect(await save(7, { year: "2026", make: "Toyota", model: "RAV4", trim: " Custom " })).toBeNull();
        expect(db.queries[0].ilike).toHaveBeenCalledWith("trim", "Custom");
        expect(db.queries[1].ilike).not.toHaveBeenCalledWith("trim", expect.anything());
        expect(db.queries[2].upsert).toHaveBeenCalledWith(expect.objectContaining({ trim_override: "Custom" }), expect.anything());
    });

    it("DB-VEH-03: unknown catalog selection never writes an association", async () => {
        const { db, save } = setup([{ data: [] }]);
        expect(await save(7, { year: "2026", make: "Unknown", model: "Unknown", trim: "" })).toMatch(/not found in the catalog/);
        expect(db.from).toHaveBeenCalledTimes(1);
    });

    it("DB-VEH-04: blank selection deletes only this lead's association", async () => {
        const { db, save, table } = setup([{}]);
        expect(await save(7, { year: "", make: "", model: "", trim: "" })).toBeNull();
        expect(db.from).toHaveBeenCalledWith(table);
        expect(db.queries[0].delete).toHaveBeenCalled();
        expect(db.queries[0].eq).toHaveBeenCalledWith("lead_id", 7);
    });

    it("DB-VEH-05: hydration applies a stored manual trim", async () => {
        const { db, load } = setup([{ data: { vehicle_id: 42, trim_override: "Custom" } }, { data: vehicleRow }]);
        const vehicle = await load(7);
        expect(vehicle?.getFullDescription()).toBe("2026 Toyota RAV4 (Custom)");
        expect(db.queries[1].eq).toHaveBeenCalledWith("vehicle_id", 42);
    });

    it("DB-VEH-06: a genuinely missing association returns null", async () => {
        const { db, load } = setup([{}]);
        expect(await load(7)).toBeNull();
        expect(db.from).toHaveBeenCalledTimes(1);
    });

    it("DB-VEH-09: an association read failure is not a missing vehicle", async () => {
        const { load } = setup([{ error: { message: "Unavailable" } }]);
        await expect(load(7)).rejects.toThrow("Unable to load lead vehicle details");
    });

    it("DB-VEH-07: deleted catalog vehicles hydrate as null", async () => {
        const { load } = setup([{ data: { vehicle_id: 42 } }, {}]);
        expect(await load(7)).toBeNull();
    });

    it("DB-VEH-08: missing-table failures explain the required migration", async () => {
        const table = kind === "interest" ? "lead_vehicle_interests" : "lead_trade_in_vehicles";
        const { save } = setup([{ error: { message: `Could not find the table ${table} in the schema cache` } }]);
        expect(await save(7, { year: "", make: "", model: "", trim: "" })).toContain("migration SQL");
    });
});
