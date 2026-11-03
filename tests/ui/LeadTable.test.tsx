/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LeadTable from "@/components/leads/LeadTable";
import { LeadRepo } from "@/lib/persistence/real/supabase/LeadRepo";
import { Vehicle } from "@/domain/objects/Vehicle";
import { makeLead } from "@/tests/fixtures/domain";

jest.mock("@/lib/persistence/real/supabase/LeadRepo");
jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));

describe("UI-LEAD — filtering and CRUD component integration", () => {
    const insert = jest.fn();
    const update = jest.fn();
    const remove = jest.fn();
    beforeEach(() => {
        insert.mockReset().mockResolvedValue(null);
        update.mockReset().mockResolvedValue(null);
        remove.mockReset().mockResolvedValue(null);
        jest.mocked(LeadRepo).mockImplementation(() => ({ insertLead: insert, updateLead: update, deleteLead: remove }) as unknown as LeadRepo);
    });

    function setup() {
        const leads = [
            makeLead({ firstName: "Ada", score: 49, leadEmail: "ada@example.test", vehicleInterest: new Vehicle("Volkswagen", "Golf", 2026) }),
            makeLead({ leadID: 2, firstName: "Ben", score: 50, status: false, stage: "CONTACTED", phone: "5551234" }),
            makeLead({ leadID: 3, firstName: "Cam", score: 79, stage: "CONTACTED" }),
            makeLead({ leadID: 4, firstName: "Dan", score: 80, tradeInVehicle: new Vehicle("Toyota", "RAV4", 2025) }),
        ];
        render(<LeadTable leads={leads} />);
    }

    it.each(["ADA", "ada@example.test", "5551234"])("UI-LEAD-01: case-insensitive search partition %s", async (query) => {
        setup();
        await userEvent.setup().type(screen.getByPlaceholderText("Search by customer name, email, or phone"), query);
        expect(screen.getAllByRole("row")).toHaveLength(2);
        expect(screen.getByRole("link", { name: query === "5551234" ? "Ben Chen" : "Ada Chen" })).toBeInTheDocument();
    });

    it.each([
        ["BELOW_50", ["Ada Chen"]], ["BETWEEN_50_79", ["Ben Chen", "Cam Chen"]], ["ABOVE_80", ["Dan Chen"]],
    ])("UI-LEAD-02: score boundaries in %s", async (filter, names) => {
        setup();
        await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "Filter by score" }), filter);
        expect(screen.getAllByRole("row")).toHaveLength(names.length + 1);
        names.forEach((name) => expect(screen.getByRole("link", { name })).toBeInTheDocument());
    });

    it("UI-LEAD-03: filters combine with AND; clearing restores all rows", async () => {
        setup();
        const user = userEvent.setup();
        await user.selectOptions(screen.getByRole("combobox", { name: "Filter by stage" }), "CONTACTED");
        await user.selectOptions(screen.getByRole("combobox", { name: "Filter by status" }), "ACTIVE");
        expect(screen.getAllByRole("row")).toHaveLength(2);
        expect(screen.getByRole("link", { name: "Cam Chen" })).toBeInTheDocument();
        await user.selectOptions(screen.getByRole("combobox", { name: "Filter by trade-in" }), "YES");
        expect(screen.getByText("No leads match the selected filters.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Clear Filters" }));
        expect(screen.getAllByRole("row")).toHaveLength(5);
    });

    it("UI-LEAD-04: VW alias finds Volkswagen catalog selections", async () => {
        setup();
        await userEvent.setup().type(screen.getByPlaceholderText("Any make"), "VW");
        expect(screen.getAllByRole("row")).toHaveLength(2);
        expect(screen.getByRole("link", { name: "Ada Chen" })).toBeInTheDocument();
    });

    it("UI-LEAD-05: blank names prevent creation; a valid lead appears after successful save", async () => {
        render(<LeadTable leads={[]} />);
        const user = userEvent.setup();
        // Pointer capture is exercised by browser tests; click here opens the form.
        fireEvent.click(screen.getByRole("button", { name: "Create new lead" }));
        await user.click(screen.getByRole("button", { name: "Create Lead" }));
        expect(screen.getByText("Lead must have at least a first name or last name.")).toBeInTheDocument();
        expect(insert).not.toHaveBeenCalled();
        insert.mockImplementation(async (lead) => { lead.leadID = 99; return null; });
        await user.type(screen.getByLabelText("First Name"), "New customer");
        await user.click(screen.getByRole("button", { name: "Create Lead" }));
        expect(await screen.findByRole("link", { name: "New customer" })).toHaveAttribute("href", "/leads/99");
        expect(screen.queryByLabelText("First Name")).not.toBeInTheDocument();
    });

    it("UI-LEAD-06: failed create keeps the form and does not add a row", async () => {
        render(<LeadTable leads={[]} />);
        insert.mockResolvedValueOnce("Insert denied");
        fireEvent.click(screen.getByRole("button", { name: "Create new lead" }));
        const user = userEvent.setup();
        await user.type(screen.getByLabelText("First Name"), "Unsaved");
        await user.click(screen.getByRole("button", { name: "Create Lead" }));
        expect(await screen.findByText("Insert denied")).toBeInTheDocument();
        expect(screen.getByLabelText("First Name")).toHaveValue("Unsaved");
        expect(screen.queryByRole("link", { name: "Unsaved" })).not.toBeInTheDocument();
    });

    it("UI-LEAD-07: failed status update rolls back; retry persists the new status", async () => {
        setup();
        const user = userEvent.setup();
        update.mockResolvedValueOnce("Update denied");
        const row = screen.getByRole("link", { name: "Ada Chen" }).closest("tr")!;
        await user.selectOptions(within(row).getByRole("combobox"), "LOST");
        expect(await screen.findByText("Update denied")).toBeInTheDocument();
        expect(within(row).getByRole("combobox")).toHaveValue("ACTIVE");
        await user.selectOptions(within(row).getByRole("combobox"), "LOST");
        expect(within(row).getByRole("combobox")).toHaveValue("LOST");
        expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ leadID: 1, status: false }));
    });

    it("UI-LEAD-08: failed delete preserves the row; successful retry removes only that row", async () => {
        setup();
        const user = userEvent.setup();
        remove.mockResolvedValueOnce("Delete denied");
        const row = screen.getByRole("link", { name: "Ada Chen" }).closest("tr")!;
        await user.click(within(row).getByRole("button", { name: "Delete Lead" }));
        expect(await screen.findByText("Delete denied")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Ada Chen" })).toBeInTheDocument();
        await user.click(within(row).getByRole("button", { name: "Delete Lead" }));
        expect(screen.queryByRole("link", { name: "Ada Chen" })).not.toBeInTheDocument();
        expect(screen.getAllByRole("row")).toHaveLength(4);
        expect(remove).toHaveBeenLastCalledWith(1);
    });
});
