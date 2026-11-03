/** @jest-environment jsdom */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DashboardTaskCard from "@/components/dashboard/DashboardTaskCard";
import { TaskRepo } from "@/lib/persistence/real/supabase/TaskRepo";
import { router } from "@/tests/helpers/auth";
import { deferred } from "@/tests/helpers/deferred";
import type { DashboardTaskItem } from "@/domain/business/DashboardService";

jest.mock("next/navigation", () => ({ useRouter: () => jest.requireActual("@/tests/helpers/auth").router }));
jest.mock("@/lib/persistence/real/supabase/TaskRepo");
jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));

const task: DashboardTaskItem = { id: 10, leadId: 7, leadName: "Ada Chen", title: "Call Ada", type: "Follow-up call", time: "09:30", status: "scheduled", score: 80, date: new Date(2026, 5, 20) };

describe("UI-TASK — completion state transitions", () => {
    const update = jest.fn();
    beforeEach(() => {
        update.mockReset().mockResolvedValue(null);
        jest.mocked(TaskRepo).mockImplementation(() => ({ updateTaskCompletion: update }) as unknown as TaskRepo);
    });

    it.each(["scheduled", "overdue", "completed"] as const)("UI-TASK-01: renders %s state and the correct lead link", (status) => {
        render(<DashboardTaskCard task={{ ...task, status }} />);
        expect(screen.getByRole("link")).toHaveAttribute("href", "/leads/7");
        expect(screen.getByRole("button", { name: `${status === "completed" ? "Completed" : "Complete"}: Call Ada. Mark as ${status === "completed" ? "uncompleted" : "completed"}` })).toBeEnabled();
        expect(screen.getAllByText(status === "scheduled" ? "Scheduled" : status === "overdue" ? "Overdue" : "Completed").length).toBeGreaterThan(0);
    });

    it("UI-TASK-02: pending disables clicks; success allows completion and reopening", async () => {
        const request = deferred<null>();
        update.mockReturnValueOnce(request.promise);
        render(<DashboardTaskCard task={task} />);
        const user = userEvent.setup();
        const button = screen.getByRole("button", { name: "Complete: Call Ada. Mark as completed" });
        await user.click(button);
        expect(button).toBeDisabled();
        await user.click(button);
        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith(10, true);
        await act(async () => request.resolve(null));
        expect(router.refresh).toHaveBeenCalledTimes(1);
        await user.click(screen.getByRole("button", { name: "Completed: Call Ada. Mark as uncompleted" }));
        expect(update).toHaveBeenLastCalledWith(10, false);
        expect(screen.getByRole("button", { name: "Complete: Call Ada. Mark as completed" })).toBeEnabled();
    });

    it.each(["returned", "thrown"])("UI-TASK-03: %s failure preserves status and displays an error", async (kind) => {
        if (kind === "returned") update.mockResolvedValueOnce("Permission denied");
        else update.mockRejectedValueOnce(new Error("Permission denied"));
        render(<DashboardTaskCard task={task} />);
        await userEvent.setup().click(screen.getByRole("button", { name: "Complete: Call Ada. Mark as completed" }));
        expect(await screen.findByText("Permission denied")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Complete: Call Ada. Mark as completed" })).toBeEnabled();
        expect(router.refresh).not.toHaveBeenCalled();
    });

    it("UI-TASK-04: unassigned tasks do not link to an invalid lead", () => {
        render(<DashboardTaskCard task={{ ...task, leadId: null }} />);
        expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
});
