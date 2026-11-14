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
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: /More filters/ }));
        await user.click(screen.getByRole("combobox", { name: "Filter by score" }));
        await user.click(await screen.findByRole("option", { name: ({ BELOW_50: "Below 50", BETWEEN_50_79: "50 - 79", ABOVE_80: "80+" } as Record<string, string>)[filter as string] }));
        expect(screen.getAllByRole("row")).toHaveLength(names.length + 1);
        names.forEach((name) => expect(screen.getByRole("link", { name })).toBeInTheDocument());
    });

    it("UI-LEAD-03: filters combine with AND; clearing restores all rows", async () => {
        setup();
        const user = userEvent.setup();
        await user.click(screen.getByRole("combobox", { name: "Filter by stage" }));
        await user.click(await screen.findByRole("option", { name: "Contacted" }));
        await user.click(screen.getByRole("combobox", { name: "Filter by status" }));
        await user.click(await screen.findByRole("option", { name: "Active" }));
        expect(screen.getAllByRole("row")).toHaveLength(2);
        expect(screen.getByRole("link", { name: "Cam Chen" })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /More filters/ }));
        await user.click(screen.getByRole("combobox", { name: "Filter by trade-in" }));
        await user.click(await screen.findByRole("option", { name: "Yes" }));
        expect(screen.getByText("No leads match the selected filters.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Clear Filters" }));
        expect(screen.getAllByRole("row")).toHaveLength(5);
    });

    it("UI-LEAD-04: VW alias finds Volkswagen catalog selections", async () => {
        setup();
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: /More filters/ }));
        await user.type(screen.getByPlaceholderText("Any make"), "VW");
        expect(screen.getAllByRole("row")).toHaveLength(2);
        expect(screen.getByRole("link", { name: "Ada Chen" })).toBeInTheDocument();
    });

    it("keeps advanced filters active when collapsed and removes them individually", async () => {
        setup();
        const user = userEvent.setup();
        const toggle = screen.getByRole("button", { name: /More filters/ });
        expect(toggle).toHaveAttribute("aria-expanded", "false");
        await user.click(toggle);
        await user.type(screen.getByPlaceholderText("Any make"), "VW");
        await user.click(toggle);
        expect(toggle).toHaveAttribute("aria-expanded", "false");
        expect(screen.getByRole("button", { name: "Remove Make: VW" })).toBeInTheDocument();
        expect(screen.getAllByRole("row")).toHaveLength(2);
        await user.click(screen.getByRole("button", { name: "Remove Make: VW" }));
        expect(screen.getAllByRole("row")).toHaveLength(5);
    });

    it("paginates results and resets to the first page when filtering", async () => {
        render(<LeadTable leads={Array.from({ length: 30 }, (_, index) => makeLead({ leadID: index + 1, firstName: `Customer${index + 1}` }))} />);
        const user = userEvent.setup();
        expect(screen.getByText("1–25 of 30 leads")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Next" }));
        expect(screen.getByText("26–30 of 30 leads")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Customer30 Chen" })).toBeInTheDocument();
        await user.type(screen.getByRole("textbox", { name: "Search leads" }), "Customer1");
        expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Customer1 Chen" })).toBeInTheDocument();
    }, 10000);

    it("combines follow-up and unreplied filters while excluding inactive follow-ups", async () => {
        render(<LeadTable leads={[
            makeLead({ leadID: 1, firstName: "Active" }),
            makeLead({ leadID: 2, firstName: "Inactive", status: false }),
            makeLead({ leadID: 3, firstName: "Other" }),
        ]} followUpLeadIds={[1, 2]} unrepliedLeadIds={[1, 3]} />);
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: /More filters/ }));
        await user.click(screen.getByRole("checkbox", { name: "Follow-up due through today" }));
        expect(screen.getByRole("link", { name: "Active Chen" })).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Inactive Chen" })).not.toBeInTheDocument();
        await user.click(screen.getByRole("checkbox", { name: "Unreplied customer contact" }));
        expect(screen.getAllByRole("row")).toHaveLength(2);
        await user.click(screen.getByRole("button", { name: "Clear Filters" }));
        expect(screen.getAllByRole("row")).toHaveLength(4);
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

    it.each(["returned", "thrown"])("UI-LEAD-07: %s status failure rolls back; retry persists the new status", async (kind) => {
        setup();
        const user = userEvent.setup();
        if (kind === "returned") update.mockResolvedValueOnce("Update denied");
        else update.mockRejectedValueOnce(new Error("Unable to load leads. Check your connection and try again."));
        const row = screen.getByRole("link", { name: "Ada Chen" }).closest("tr")!;
        await user.click(within(row).getByRole("combobox"));
        await user.click(await screen.findByRole("option", { name: "Lost" }));
        expect(await screen.findByText(kind === "returned" ? "Update denied" : "Unable to load leads. Check your connection and try again.")).toBeInTheDocument();
        expect(within(row).getByRole("combobox")).toHaveTextContent("Active");
        expect(within(row).getByRole("combobox")).toBeEnabled();
        await user.click(within(row).getByRole("combobox"));
        await user.click(await screen.findByRole("option", { name: "Lost" }));
        expect(within(row).getByRole("combobox")).toHaveTextContent("Lost");
        expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ leadID: 1, status: false }));
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it.each(["returned", "thrown"])("UI-LEAD-08: %s delete failure preserves the row; successful retry removes only that row", async (kind) => {
        setup();
        const user = userEvent.setup();
        if (kind === "returned") remove.mockResolvedValueOnce("Delete denied");
        else remove.mockRejectedValueOnce(new Error("Unable to load leads. Check your connection and try again."));
        const row = screen.getByRole("link", { name: "Ada Chen" }).closest("tr")!;
        await user.click(within(row).getByRole("button", { name: "Delete Lead Ada Chen" }));
        expect(await screen.findByText(kind === "returned" ? "Delete denied" : "Unable to load leads. Check your connection and try again.")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Ada Chen" })).toBeInTheDocument();
        expect(within(row).getByRole("button", { name: "Delete Lead Ada Chen" })).toBeEnabled();
        await user.click(within(row).getByRole("button", { name: "Delete Lead Ada Chen" }));
        expect(screen.queryByRole("link", { name: "Ada Chen" })).not.toBeInTheDocument();
        expect(screen.getAllByRole("row")).toHaveLength(4);
        expect(remove).toHaveBeenLastCalledWith(1);
    });

    it.each([
        ["Active", "Open Chen"], ["Lost", "Lost Chen"],
        ["Delivered", "Won Chen"], ["Closed (outcome unconfirmed)", "Unconfirmed Chen"],
    ])("outcome filter %s uses stage precedence over the legacy status flag", async (filter, name) => {
        render(<LeadTable leads={[
            makeLead({ firstName: "Open" }),
            makeLead({ leadID: 2, firstName: "Lost", status: false }),
            makeLead({ leadID: 3, firstName: "Won", stage: " delivered ", status: false }),
            makeLead({ leadID: 4, firstName: "Unconfirmed", stage: " closed ", status: true }),
        ]} />);
        const user = userEvent.setup();
        expect(screen.getByRole("combobox", { name: "Status for Won Chen" })).toBeDisabled();
        expect(screen.getByRole("combobox", { name: "Status for Unconfirmed Chen" })).toBeDisabled();
        await user.click(screen.getByRole("combobox", { name: "Filter by status" }));
        await user.click(await screen.findByRole("option", { name: filter }));
        expect(screen.getAllByRole("row")).toHaveLength(2);
        expect(screen.getByRole("link", { name })).toBeInTheDocument();
    });

    it("closed stage filtering recognizes legacy whitespace and case", async () => {
        render(<LeadTable leads={[makeLead({ stage: " closed " }), makeLead({ leadID: 2, firstName: "Other" })]} />);
        const user = userEvent.setup();
        await user.click(screen.getByRole("combobox", { name: "Filter by stage" }));
        await user.click(await screen.findByRole("option", { name: "Closed" }));
        expect(screen.getAllByRole("row")).toHaveLength(2);
        expect(screen.getByRole("link", { name: "Ada Chen" })).toBeInTheDocument();
    });

    it.each(["Delivered", "Closed (outcome unconfirmed)"])("creating a %s lead saves an inactive consistent state", async (stage) => {
        render(<LeadTable leads={[]} />);
        const user = userEvent.setup();
        fireEvent.click(screen.getByRole("button", { name: "Create new lead" }));
        await user.type(screen.getByLabelText("First Name"), "Terminal");
        await user.click(screen.getByRole("combobox", { name: "Stage" }));
        await user.click(await screen.findByRole("option", { name: stage }));
        await user.click(screen.getByRole("button", { name: "Create Lead" }));
        expect(insert).toHaveBeenCalledWith(expect.objectContaining({ status: false, stage: stage === "Delivered" ? "DELIVERED" : "CLOSED" }));
    });
});
