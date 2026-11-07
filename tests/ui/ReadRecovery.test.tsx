/** @jest-environment jsdom */
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LeadsPage from "@/app/leads/page";
import AgendaPage from "@/app/agenda/page";
import TopBar from "@/components/layout/TopBar";
import { LeadRepo } from "@/lib/persistence/real/supabase/LeadRepo";
import { TaskRepo } from "@/lib/persistence/real/supabase/TaskRepo";
import { NotificationRepo } from "@/lib/persistence/real/supabase/NotificationRepo";
import { hydrateLeadTableData } from "@/lib/persistence/real/supabase/LeadTableHydrator";
import { makeLead } from "@/tests/fixtures/domain";
import { deferred } from "@/tests/helpers/deferred";

jest.mock("next/navigation", () => ({ usePathname: () => "/agenda" }));
jest.mock("@/lib/persistence/real/supabase/LeadRepo");
jest.mock("@/lib/persistence/real/supabase/TaskRepo");
jest.mock("@/lib/persistence/real/supabase/NotificationRepo");
jest.mock("@/lib/persistence/real/supabase/LeadTableHydrator");
jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("@/components/auth/AccountMenu", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/leads/LeadTable", () => ({
    __esModule: true, default: ({ leads }: { leads: unknown[] }) => <div>Loaded leads: {leads.length}</div>,
}));
jest.mock("@/components/agenda/AgendaCalendar", () => ({ __esModule: true, default: () => <div>Loaded calendar</div> }));
jest.mock("@/components/agenda/AgendaActivityPanel", () => ({
    __esModule: true, default: ({ loading }: { loading: boolean }) => loading ? <div>Loading agenda...</div> : <div>Loaded activities</div>,
}));

const getLeads = jest.fn();
const getTasks = jest.fn();
const getNotifications = jest.fn();
const search = jest.fn();
const insertTask = jest.fn();

beforeEach(() => {
    getLeads.mockReset().mockResolvedValue([]);
    getTasks.mockReset().mockResolvedValue([]);
    getNotifications.mockReset().mockResolvedValue([]);
    search.mockReset().mockResolvedValue([]);
    insertTask.mockReset().mockResolvedValue(null);
    jest.mocked(LeadRepo).mockImplementation(() => ({ getAllLeads: getLeads, searchLeads: search }) as unknown as LeadRepo);
    jest.mocked(TaskRepo).mockImplementation(() => ({ getAllTasks: getTasks, insertTask }) as unknown as TaskRepo);
    jest.mocked(NotificationRepo).mockImplementation(() => ({ getAllNotifications: getNotifications }) as unknown as NotificationRepo);
    jest.mocked(hydrateLeadTableData).mockImplementation(async (leads) => leads);
});

it.each(["leads", "vehicle details"])("the leads page recovers from failed %s reads and allows a genuine empty result", async (resource) => {
    if (resource === "leads") getLeads.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    else jest.mocked(hydrateLeadTableData).mockRejectedValueOnce(new Error("Unavailable"));
    render(<LeadsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load leads");
    expect(screen.queryByText("Loaded leads: 0")).not.toBeInTheDocument();
    const request = deferred<never[]>();
    getLeads.mockReturnValueOnce(request.promise);
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("button", { name: "Retrying..." })).toBeDisabled();
    await act(async () => request.resolve([]));
    expect(await screen.findByText("Loaded leads: 0")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it.each(["leads", "tasks", "notifications"] as const)("agenda hides empty activities on a failed %s read and retries safely", async (resource) => {
    ({ leads: getLeads, tasks: getTasks, notifications: getNotifications })[resource].mockRejectedValueOnce(new Error("Offline"));
    render(<AgendaPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load agenda");
    expect(screen.queryByText("Loaded calendar")).not.toBeInTheDocument();
    expect(screen.queryByText("Loaded activities")).not.toBeInTheDocument();
    expect(insertTask).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Loaded activities")).toBeInTheDocument();
});

it("agenda search distinguishes failure from no matches and retries the same query", async () => {
    search.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce([makeLead()]);
    render(<AgendaPage />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox", { name: "Lead" }), "Ada");
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load lead search results");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /Ada/ })).toBeInTheDocument();
    expect(search).toHaveBeenLastCalledWith("Ada", 6);
});

it("an outdated lead search cannot replace a newer result with an error", async () => {
    const oldRequest = deferred<never[]>();
    search.mockReturnValueOnce(oldRequest.promise).mockResolvedValueOnce([makeLead()]);
    render(<AgendaPage />);
    const user = userEvent.setup();
    const input = screen.getByRole("searchbox", { name: "Lead" });
    await user.type(input, "Old");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await user.clear(input);
    await user.type(input, "Ada");
    expect(await screen.findByRole("button", { name: /Ada/ })).toBeInTheDocument();
    await act(async () => oldRequest.reject(new Error("Old request failed")));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("a successful empty search displays no matches", async () => {
    render(<AgendaPage />);
    await userEvent.setup().type(screen.getByRole("searchbox", { name: "Lead" }), "Unknown");
    expect(await screen.findByText("No matching leads.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it.each(["leads", "notifications"] as const)("the notification panel recovers from a failed %s read", async (resource) => {
    ({ leads: getLeads, notifications: getNotifications })[resource].mockRejectedValueOnce(new Error("Offline"));
    render(<TopBar />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Open notifications/ }));
    const panel = within(screen.getByRole("region", { name: "Notifications" }));
    expect(await panel.findByRole("alert")).toHaveTextContent("Unable to load notifications");
    expect(panel.queryByText("No notifications.")).not.toBeInTheDocument();
    await userEvent.setup().click(panel.getByRole("button", { name: "Try again" }));
    expect(await panel.findByText("No notifications.")).toBeInTheDocument();
});

it("a background notification refresh failure replaces the empty state with a retry", async () => {
    jest.useFakeTimers();
    try {
        render(<TopBar />);
        const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
        await user.click(screen.getByRole("button", { name: /Open notifications/ }));
        expect(await screen.findByText("No notifications.")).toBeInTheDocument();
        getNotifications.mockRejectedValueOnce(new Error("Offline"));
        await act(async () => { jest.advanceTimersByTime(60000); });
        expect(screen.getByRole("alert")).toHaveTextContent("Unable to load notifications");
        expect(screen.queryByText("No notifications.")).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Try again" }));
        expect(await screen.findByText("No notifications.")).toBeInTheDocument();
    } finally {
        jest.useRealTimers();
    }
});
