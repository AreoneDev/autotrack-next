/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LeadDetailPanel, { type LeadDetailViewModel } from "@/components/leads/LeadDetailPanel";
import { CommunicationRepo, type CommunicationOperation } from "@/lib/persistence/real/supabase/CommunicationRepo";
import { ContactHistoryRepo } from "@/lib/persistence/real/supabase/ContactHistoryRepo";
import { Notification } from "@/domain/objects/Notification";
import { makeLead } from "@/tests/fixtures/domain";
import { localDateInput } from "@/lib/date";

const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("@/lib/persistence/real/supabase/CommunicationRepo");
jest.mock("@/lib/persistence/real/supabase/ContactHistoryRepo");
jest.mock("@/components/leads/VehicleInterestSelector", () => function VehicleSelector() { return null; });

const log = jest.fn();
const getPage = jest.fn();
let historyRecords: Array<{ notificationID: number; leadID: number; title: string; occurredAt: string; details: null }> = [];
const operationId = "12345678-1234-4234-8234-123456789abc";
function viewModel(): LeadDetailViewModel {
    const lead = makeLead({ leadID: 1, firstName: "Ada", lastName: "Chen", stage: "CONTACTED", notes: "", lastInteractionDate: null });
    return { ...lead, vehicleInterestId: null, vehicleInterest: "", vehicleInterestYear: "",
        vehicleInterestMake: "", vehicleInterestModel: "", vehicleInterestTrim: "",
        tradeInVehicleId: null, tradeInVehicle: "", tradeInVehicleYear: "",
        tradeInVehicleMake: "", tradeInVehicleModel: "", tradeInVehicleTrim: "",
        followUpDate: localDateInput(lead.followUpDate), createdAt: localDateInput(lead.createdAt),
        lastInteractionDate: "", priorityLevel: "LOW", priorityReasons: [], score: 0 };
}
function result(operation: CommunicationOperation) {
    const lead = makeLead({ leadID: 1, firstName: "Ada", lastName: "Chen", stage: "CONTACTED", notes: "",
        lastInteractionDate: new Date(operation.occurredAt), lastInteractionBy: "USER", score: 35 });
    const prefix = { call: "You called ", email: "You sent an email to ", message: "You sent a message to " }[operation.channel];
    return { lead, notification: new Notification(lead, prefix + "Ada Chen", new Date(operation.occurredAt), 9) };
}
beforeEach(() => {
    sessionStorage.clear();
    historyRecords = [];
    getPage.mockReset().mockImplementation(async () => ({ records: historyRecords, hasMore: false }));
    log.mockReset().mockImplementation(async (operation) => {
        const saved = result(operation);
        historyRecords = [{ notificationID: saved.notification.getEventID(), leadID: operation.leadId,
            title: saved.notification.getTitle(), occurredAt: operation.occurredAt, details: null }];
        return saved;
    });
    mockRefresh.mockReset();
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: () => operationId });
    jest.mocked(CommunicationRepo).mockImplementation(() => ({ logCommunication: log }) as unknown as CommunicationRepo);
    jest.mocked(ContactHistoryRepo).mockImplementation(() => ({ getPage }) as unknown as ContactHistoryRepo);
});

async function renderPanel(props: { lead?: LeadDetailViewModel; tasks?: []; notifications?: [] } = {}) {
    const panel = render(<LeadDetailPanel lead={props.lead ?? viewModel()} tasks={props.tasks ?? []} notifications={props.notifications ?? []} />);
    await screen.findByText("No contact history for this lead.");
    return panel;
}

it.each(["Call", "Email", "Message"])("logs %s through the synchronized path and displays confirmed contact time", async (label) => {
    await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatchObject({ operationId, channel: label.toLowerCase(), leadId: 1 });
    expect(await screen.findByText(result(log.mock.calls[0][0]).notification.getTitle())).toBeInTheDocument();
    expect(screen.getByText(/UTC$/)).toBeInTheDocument();
    expect(sessionStorage.getItem(`autotrack:communication:1:${label.toLowerCase()}`)).toBeNull();
});

it("prevents a second synchronous submission while the first write is pending", async () => {
    let complete!: (value: ReturnType<typeof result>) => void;
    log.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    await renderPanel();
    const button = screen.getByRole("button", { name: "Call" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(log).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Email" })).toBeDisabled();
    await act(async () => complete(result(log.mock.calls[0][0])));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
});

it("keeps a failed request across remount and retries with the original identity and timestamp", async () => {
    log.mockRejectedValueOnce(new Error("Transport failed"));
    const first = await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Call" }));
    await screen.findByText("Transport failed");
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(screen.queryByText("You called Ada Chen")).not.toBeInTheDocument();
    const original = log.mock.calls[0][0];
    first.unmount();
    await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Call" }));
    await screen.findByText("You called Ada Chen");
    expect(log.mock.calls[1][0]).toEqual(original);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
});

it("adopts refreshed lead, tasks and notifications without leaving mounted state stale", async () => {
    const lead = viewModel();
    const panel = await renderPanel({ lead });
    historyRecords = [{ notificationID: 9, leadID: 1, title: "Server contact",
        occurredAt: "2026-11-07T15:12:00Z", details: null }];
    panel.rerender(<LeadDetailPanel lead={{ ...lead, lastInteractionDate: "2026-11-07T15:12:00Z", lastInteractionBy: "USER", score: 35 }}
        tasks={[{ taskID: 5, leadID: 1, title: "Server follow-up", taskType: "Follow-up", notes: "", date: "2026-11-08", time: "09:00", completed: false }]}
        notifications={[{ notificationID: 9, leadID: 1, title: "Server contact", date: "2026-11-07" }]} />);
    expect(screen.getByText("Server follow-up")).toBeInTheDocument();
    expect(await screen.findByText("Server contact")).toBeInTheDocument();
    expect(screen.getByText(/UTC$/)).toBeInTheDocument();
});
