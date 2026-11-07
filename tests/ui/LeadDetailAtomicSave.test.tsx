/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import LeadDetailPanel, { type LeadDetailViewModel } from "@/components/leads/LeadDetailPanel";
import { supabase } from "@/lib/supabase/client";
import type { VehicleSelection } from "@/domain/business/VehicleSelectionService";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: jest.fn() }) }));
jest.mock("@/lib/supabase/client", () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
jest.mock("@/components/leads/VehicleInterestSelector", () => ({
    __esModule: true,
    default: ({ label, selection, onChange }: { label: string; selection: VehicleSelection; onChange: (value: VehicleSelection) => void }) =>
        <input aria-label={label || "Vehicle selection"} value={selection?.trim ?? ""}
            onChange={event => onChange({ year: "2026", make: "Synthetic", model: "Catalogue", trim: event.target.value })} />,
}));
const rpc = jest.mocked(supabase.rpc);
const from = supabase.from as unknown as jest.Mock;
const success = { data: { version: 8, vehicle_interest_id: 11, trade_in_vehicle_id: 12 }, error: null };
const fixture: LeadDetailViewModel = {
    leadID: 1, version: 7, firstName: "Before", lastName: "Customer", phone: "4165550100", leadEmail: "a@example.test",
    leadDivision: "", leadAddress: "", leadCity: "", leadProvince: "ON", leadCountry: "Canada", leadPostalCode: "",
    budget: 35000, stage: "CONTACTED", followUpDate: "2026-11-08", score: 0, priorityLevel: "LOW", priorityReasons: [], notes: "",
    createdAt: "2026-11-01", lastInteractionDate: "2026-11-06", lastInteractionBy: "Customer", status: true,
    vehicleInterestId: null, vehicleInterest: "", vehicleInterestYear: "", vehicleInterestMake: "", vehicleInterestModel: "", vehicleInterestTrim: "",
    tradeInVehicleId: null, tradeInVehicle: "", tradeInVehicleYear: "", tradeInVehicleMake: "", tradeInVehicleModel: "", tradeInVehicleTrim: "",
};
beforeEach(() => {
    rpc.mockReset();
    refresh.mockReset();
    let next = 0;
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: jest.fn(() => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`) });
});
function edit(lead = fixture) {
    render(<LeadDetailPanel lead={lead} tasks={[]} notifications={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Modify" }));
    fireEvent.change(screen.getByLabelText("First Name", { exact: true }), { target: { value: "Updated" } });
}
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
const expectNoUnexpectedSupabaseTables = () => {
    // Contact history is loaded from notifications when the panel mounts.
    // These checks concern writes from the save flow, not that independent read.
    expect(from.mock.calls.every(([table]) => table === "notifications")).toBe(true);
};

it("keeps draft on failure; unchanged retry uses one RPC with the same request/version", async () => {
    rpc.mockRejectedValueOnce(new Error("Lost response")).mockResolvedValueOnce(success as never);
    edit({ ...fixture, followUpDate: "" });
    save();
    await screen.findByText("Lost response");
    expect(screen.getByLabelText("First Name", { exact: true })).toHaveValue("Updated");
    expect(refresh).not.toHaveBeenCalled();
    save();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
    expect(rpc.mock.calls[0]).toEqual(["autotrack_save_lead_details", expect.objectContaining({
        p_lead_id: 1, p_expected_version: 7, p_details: expect.objectContaining({ first_name: "Updated" }),
    })]);
    expectNoUnexpectedSupabaseTables();
    // A subsequent edit uses the version returned by the successful save.
    fireEvent.click(screen.getByRole("button", { name: "Modify" }));
    rpc.mockResolvedValueOnce({ ...success, data: { ...success.data, version: 9 } } as never);
    save();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(rpc.mock.calls[2][1]).toMatchObject({ p_expected_version: 8 });
});

it("changing a failed draft gets a new request ID; a conflict preserves the draft", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "Reload before saving again." } } as never);
    edit();
    save();
    await screen.findByText("Reload before saving again.");
    fireEvent.change(screen.getByLabelText("First Name", { exact: true }), { target: { value: "Changed again" } });
    save();
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(rpc.mock.calls[0][1]?.p_request_id).not.toEqual(rpc.mock.calls[1][1]?.p_request_id);
    expect(screen.getByLabelText("First Name", { exact: true })).toHaveValue("Changed again");
    expect(refresh).not.toHaveBeenCalled();
});

it.each(["PGRST202", "42883"])("missing RPC (%s) fails closed with migration guidance", async code => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "missing" } } as never);
    edit(); save();
    await screen.findByText("Atomic lead saving is unavailable. Apply the database migrations and reload before saving.");
    expectNoUnexpectedSupabaseTables();
});

it("missing version fails closed before any write", async () => {
    edit({ ...fixture, version: null }); save();
    await screen.findByText("Lead version is unavailable. Apply the database migrations and reload before saving.");
    expect(rpc).not.toHaveBeenCalled();
    expectNoUnexpectedSupabaseTables();
});
