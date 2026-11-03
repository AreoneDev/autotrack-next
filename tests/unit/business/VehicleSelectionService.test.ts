import { VehicleSelectionService, type VehicleSelection } from "@/domain/business/VehicleSelectionService";
import { Vehicle } from "@/domain/objects/Vehicle";
import { VehicleRepo } from "@/lib/persistence/real/supabase/VehicleRepo";
import { LeadVehicleInterestRepo } from "@/lib/persistence/real/supabase/LeadVehicleInterestRepo";
import { LeadTradeInVehicleRepo } from "@/lib/persistence/real/supabase/LeadTradeInVehicleRepo";

jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));

describe("VS — vehicle selection decision table", () => {
    const catalog = { searchYears: jest.fn(), searchMakes: jest.fn(), searchModels: jest.fn(), searchTrims: jest.fn() };
    const interest = { clearVehicleInterest: jest.fn(), saveVehicleInterest: jest.fn() };
    const tradeIn = { clearTradeInVehicle: jest.fn(), saveTradeInVehicle: jest.fn() };
    const service = new VehicleSelectionService(
        catalog as unknown as VehicleRepo,
        interest as unknown as LeadVehicleInterestRepo,
        tradeIn as unknown as LeadTradeInVehicleRepo,
    );
    const selection: VehicleSelection = { year: "2026", make: " Toyota ", model: " RAV4 ", trim: " XLE " };

    beforeEach(() => {
        Object.values(catalog).forEach((mock) => mock.mockReset().mockResolvedValue([]));
        [...Object.values(interest), ...Object.values(tradeIn)].forEach((mock) => mock.mockReset().mockResolvedValue(null));
    });

    describe.each([
        { name: "interest", save: service.saveLeadVehicleInterest.bind(service), write: interest.saveVehicleInterest, clear: interest.clearVehicleInterest },
        { name: "trade-in", save: service.saveLeadTradeInVehicle.bind(service), write: tradeIn.saveTradeInVehicle, clear: tradeIn.clearTradeInVehicle },
    ])("$name", ({ save, write, clear }) => {
        it("VS-01: all blank fields clear the association", async () => {
            expect(await save(7, { year: "", make: " ", model: "", trim: " " })).toBeNull();
            expect(clear).toHaveBeenCalledWith(7);
            expect(write).not.toHaveBeenCalled();
        });

        // All combinations of required field presence, except all-empty (clear) and all-present (save).
        it.each([1, 2, 3, 4, 5, 6])("VS-02: incomplete required fields (mask %i) never write", async (mask) => {
            const result = await save(7, {
                year: mask & 1 ? "2026" : "", make: mask & 2 ? "Toyota" : "", model: mask & 4 ? "RAV4" : "", trim: "",
            });
            expect(result).toMatch(/Year, make, and model are required/);
            expect(write).not.toHaveBeenCalled();
            expect(clear).not.toHaveBeenCalled();
        });

        it("VS-03: a trim alone is invalid and must not clear existing data", async () => {
            expect(await save(7, { year: "", make: "", model: "", trim: "XLE" })).toMatch(/required/);
            expect(clear).not.toHaveBeenCalled();
            expect(write).not.toHaveBeenCalled();
        });

        it.each(["", " XLE "])("VS-04: valid required fields save with optional trim '%s'", async (trim) => {
            expect(await save(7, { ...selection, trim })).toBeNull();
            expect(write).toHaveBeenCalledWith({ leadId: 7, year: 2026, make: "Toyota", model: "RAV4", trim: trim.trim() });
            expect(clear).not.toHaveBeenCalled();
        });

        it("VS-05: repository failures reach the caller", async () => {
            write.mockResolvedValueOnce("Permission denied");
            expect(await save(7, selection)).toBe("Permission denied");
            clear.mockResolvedValueOnce("Delete failed");
            expect(await save(7, { year: "", make: "", model: "", trim: "" })).toBe("Delete failed");
        });
    });

    it.each(["", " ", "not-a-year", "0"])("VS-06: invalid year '%s' prevents catalog searches", async (year) => {
        expect(await service.searchMakes(year, "to")).toEqual([]);
        expect(await service.searchModels(year, "Toyota", "ra")).toEqual([]);
        expect(await service.searchTrims(year, "Toyota", "RAV4", "x")).toEqual([]);
        expect(catalog.searchMakes).not.toHaveBeenCalled();
        expect(catalog.searchModels).not.toHaveBeenCalled();
        expect(catalog.searchTrims).not.toHaveBeenCalled();
    });

    it("VS-07: missing parents prevent downstream searches", async () => {
        expect(await service.searchModels("2026", " ", "")).toEqual([]);
        expect(await service.searchTrims("2026", "Toyota", " ", "")).toEqual([]);
        expect(catalog.searchModels).not.toHaveBeenCalled();
        expect(catalog.searchTrims).not.toHaveBeenCalled();
    });

    it("VS-08: catalog searches normalize parent fields and preserve the query", async () => {
        await service.searchYears("20");
        await service.searchMakes("2026", "to");
        await service.searchModels("2026", " Toyota ", "ra");
        await service.searchTrims("2026", " Toyota ", " RAV4 ", "x");
        expect(catalog.searchYears).toHaveBeenCalledWith("20");
        expect(catalog.searchMakes).toHaveBeenCalledWith(2026, "to");
        expect(catalog.searchModels).toHaveBeenCalledWith(2026, "Toyota", "ra");
        expect(catalog.searchTrims).toHaveBeenCalledWith(2026, "Toyota", "RAV4", "x");
    });

    it("VS-09: missing and populated vehicles convert to form fields", () => {
        expect(service.toSelection(null)).toEqual({ year: "", make: "", model: "", trim: "" });
        expect(service.toSelection(new Vehicle("Toyota", "RAV4", 2026, "XLE"))).toEqual({ year: "2026", make: "Toyota", model: "RAV4", trim: "XLE" });
    });
});
