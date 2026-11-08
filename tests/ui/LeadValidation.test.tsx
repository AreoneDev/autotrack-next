/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import LeadTable from "@/components/leads/LeadTable";
import LeadDetailPanel, { type LeadDetailViewModel } from "@/components/leads/LeadDetailPanel";
import { DuplicateLeadError } from "@/domain/business/LeadValidation";
import { LeadRepo } from "@/lib/persistence/real/supabase/LeadRepo";
import { makeLead } from "@/tests/fixtures/domain";
jest.mock("@/lib/persistence/real/supabase/LeadRepo");
jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }));
jest.mock("@/components/leads/VehicleInterestSelector", () => ({ __esModule: true, default: () => <div /> }));
jest.mock("@/domain/business/VehicleSelectionService", () => ({
    VehicleSelectionService: jest.fn().mockImplementation(() => ({
        saveLeadVehicleInterest: jest.fn().mockResolvedValue(null),
        saveLeadTradeInVehicle: jest.fn().mockResolvedValue(null),
    })),
}));
const insert = jest.fn(), update = jest.fn();
const match = { leadID: 8, name: "Existing Customer", email: true, phone: false };
beforeEach(() => {
    insert.mockReset().mockResolvedValue(null);
    update.mockReset().mockResolvedValue({ version: 2, vehicleInterestId: null, tradeInVehicleId: null });
    jest.mocked(LeadRepo).mockImplementation(() => ({ insertLead: insert, saveLeadDetails: update }) as unknown as LeadRepo);
});
const change = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name, { exact: true }), { target: { value } });
function create() {
    render(<LeadTable leads={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Create new lead" }));
    change("First Name", "New");
}
function detail(overrides: Partial<LeadDetailViewModel> = {}) {
    const view: LeadDetailViewModel = {
        ...makeLead(), followUpDate: "2026-11-07", createdAt: "2026-11-01", lastInteractionDate: "",
        vehicleInterest: "", vehicleInterestId: null, vehicleInterestYear: "", vehicleInterestMake: "",
        vehicleInterestModel: "", vehicleInterestTrim: "", tradeInVehicle: "", tradeInVehicleId: null,
        tradeInVehicleYear: "", tradeInVehicleMake: "", tradeInVehicleModel: "", tradeInVehicleTrim: "",
        priorityLevel: "LOW", priorityReasons: [], ...overrides,
    };
    render(<LeadDetailPanel lead={view} tasks={[]} notifications={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Modify" }));
}
describe("create validation and duplicate UX", () => {
    it("blocks bad fields, then saves normalized contact and budget values", async () => {
        create();
        change("Email", "bad"); change("Phone", "123"); change("Budget", "-20");
        fireEvent.click(screen.getByRole("button", { name: "Create Lead" }));
        expect(insert).not.toHaveBeenCalled();
        expect(screen.getAllByRole("alert")).toHaveLength(3);
        expect(screen.getByLabelText("Budget", { exact: true })).toHaveAttribute("aria-invalid", "true");
        change("Email", " NEW@EXAMPLE.TEST "); change("Phone", "(416) 555-0100"); change("Budget", "42000.50");
        fireEvent.click(screen.getByRole("button", { name: "Create Lead" }));
        expect(await screen.findByRole("link", { name: "New" })).toBeInTheDocument();
        expect(insert).toHaveBeenCalledWith(expect.objectContaining({
            leadEmail: "new@example.test", phone: "+14165550100", budget: 42000.5,
        }));
    });
    it("requires review and clears duplicate confirmation when the input changes", async () => {
        insert.mockRejectedValueOnce(new DuplicateLeadError([match]));
        create(); change("Email", "same@example.test");
        fireEvent.click(screen.getByRole("button", { name: "Create Lead" }));
        expect(await screen.findByRole("link", { name: match.name })).toHaveAttribute("href", "/leads/8");
        expect(screen.queryByRole("link", { name: "New" })).not.toBeInTheDocument();
        change("Email", "different@example.test");
        expect(screen.queryByRole("button", { name: "Create Anyway" })).not.toBeInTheDocument();
        insert.mockRejectedValueOnce(new DuplicateLeadError([match]));
        fireEvent.click(screen.getByRole("button", { name: "Create Lead" }));
        fireEvent.click(await screen.findByRole("button", { name: "Create Anyway" }));
        expect(await screen.findByRole("link", { name: "New" })).toBeInTheDocument();
        expect(insert).toHaveBeenLastCalledWith(expect.anything(), [8]);
    });
    it("prevents repeated submit while pending and recovers from a network rejection", async () => {
        let reject!: (error: Error) => void;
        insert.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
        create();
        const form = screen.getByRole("button", { name: "Create Lead" }).closest("form")!;
        fireEvent.submit(form); fireEvent.submit(form);
        expect(insert).toHaveBeenCalledTimes(1);
        expect(screen.getByLabelText("First Name")).toBeDisabled();
        reject(new Error("Network interrupted"));
        expect(await screen.findByRole("alert")).toHaveTextContent("Network interrupted");
        fireEvent.click(screen.getByRole("button", { name: "Create Lead" }));
        expect(await screen.findByRole("link", { name: "New" })).toBeInTheDocument();
    });
});
describe("edit validation and duplicate UX", () => {
    it("blocks bad edits and retains the exact budget input for correction", () => {
        detail();
        change("Email", "bad"); change("Phone", "123"); change("Budget", "bad-budget");
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
        expect(update).not.toHaveBeenCalled();
        expect(screen.getAllByRole("alert")).toHaveLength(3);
        expect(screen.getByLabelText("Budget", { exact: true })).toHaveValue("bad-budget");
    });
    it("allows unrelated changes to invalid legacy contact fields and budgets", async () => {
        detail({ phone: "legacy extension", leadEmail: "unknown", budget: -5 });
        change("First Name", "Renamed");
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
        expect(await screen.findByRole("button", { name: "Modify" })).toBeInTheDocument();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            firstName: "Renamed", phone: "legacy extension", leadEmail: "unknown", budget: -5,
        }), expect.anything(), expect.anything(), expect.any(String), []);
    });
    it("warns before saving a duplicate edit and persists only after explicit confirmation", async () => {
        update.mockRejectedValueOnce(new DuplicateLeadError([match]));
        detail(); change("Email", " SAME@EXAMPLE.TEST ");
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
        expect(await screen.findByRole("link", { name: match.name })).toHaveAttribute("href", "/leads/8");
        expect(screen.getByLabelText("Email", { exact: true })).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Save Anyway" }));
        expect(await screen.findByRole("button", { name: "Modify" })).toBeInTheDocument();
        expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ leadEmail: "same@example.test" }), expect.anything(), expect.anything(), expect.any(String), [8]);
    });
    it("clears pending warning and invalid draft values when edits are cancelled", async () => {
        update.mockRejectedValueOnce(new DuplicateLeadError([match]));
        detail(); change("Email", "same@example.test");
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
        await screen.findByRole("button", { name: "Save Anyway" });
        change("Budget", "-5");
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        fireEvent.click(screen.getByRole("button", { name: "Modify" }));
        expect(screen.getByLabelText("Budget", { exact: true })).toHaveValue("0");
        expect(screen.queryByRole("button", { name: "Save Anyway" })).not.toBeInTheDocument();
    });
});
