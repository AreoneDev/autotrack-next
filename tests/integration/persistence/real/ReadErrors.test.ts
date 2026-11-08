import { LeadRepo } from "@/lib/persistence/real/supabase/LeadRepo";
import { TaskRepo } from "@/lib/persistence/real/supabase/TaskRepo";
import { NotificationRepo } from "@/lib/persistence/real/supabase/NotificationRepo";
import { RepositoryReadError } from "@/lib/persistence/RepositoryReadError";
import { scriptedClient } from "@/tests/helpers/supabase";
import { makeLead, makeTask, makeNotification } from "@/tests/fixtures/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));

const reads = {
    "lead list": (db: ReturnType<typeof scriptedClient>) => new LeadRepo(db.client).getAllLeads(),
    "lead detail": (db: ReturnType<typeof scriptedClient>) => new LeadRepo(db.client).getLeadById(1),
    "lead search": (db: ReturnType<typeof scriptedClient>) => new LeadRepo(db.client).searchLeads("Ada"),
    "follow-up leads": (db: ReturnType<typeof scriptedClient>) => new LeadRepo(db.client).getLeadsByFollowUpDate(new Date()),
    "task list": (db: ReturnType<typeof scriptedClient>) => new TaskRepo(db.client).getAllTasks(),
    "task detail": (db: ReturnType<typeof scriptedClient>) => new TaskRepo(db.client).getTaskById(1),
    "lead tasks": (db: ReturnType<typeof scriptedClient>) => new TaskRepo(db.client).getTasksByLeadId(1),
    "notification list": (db: ReturnType<typeof scriptedClient>) => new NotificationRepo(db.client).getAllNotifications(),
    "notification detail": (db: ReturnType<typeof scriptedClient>) => new NotificationRepo(db.client).getNotificationById(1),
    "lead notifications": (db: ReturnType<typeof scriptedClient>) => new NotificationRepo(db.client).getNotificationsByLeadId(1),
};

it.each(Object.entries(reads))("%s rejects database errors and preserves the cause", async (_name, read) => {
    const cause = { message: "Backend unavailable" };
    const db = scriptedClient([{ error: cause }]);
    await expect(read(db)).rejects.toMatchObject({
        name: "RepositoryReadError", cause, message: expect.stringContaining("Check your connection"),
    });
});

it.each(["lead list", "lead search", "follow-up leads", "task list", "lead tasks", "notification list", "lead notifications"])(
    "%s treats an absent collection response as a failed read", async (name) => {
        await expect(reads[name as keyof typeof reads](scriptedClient([{}]))).rejects.toBeInstanceOf(RepositoryReadError);
    }
);

it.each(["lead detail", "task detail", "notification detail"])("%s preserves genuine not-found results", async (name) => {
    await expect(reads[name as keyof typeof reads](scriptedClient([{}]))).resolves.toBeNull();
});

it.each([
    ["update lead", (db: ReturnType<typeof scriptedClient>) => new LeadRepo(db.client).updateLead(makeLead())],
    ["insert task", (db: ReturnType<typeof scriptedClient>) => new TaskRepo(db.client).insertTask(makeTask())],
    ["complete task", (db: ReturnType<typeof scriptedClient>) => new TaskRepo(db.client).updateTaskCompletion(1, true)],
    ["delete task", (db: ReturnType<typeof scriptedClient>) => new TaskRepo(db.client).deleteTask(1)],
    ["update notification", (db: ReturnType<typeof scriptedClient>) => new NotificationRepo(db.client).updateNotification(makeNotification("Reminder"))],
    ["delete notification", (db: ReturnType<typeof scriptedClient>) => new NotificationRepo(db.client).deleteNotification(1)],
] as const)("%s stops before writing when its preflight read fails", async (_name, write) => {
    const db = scriptedClient([{ error: { message: "Unavailable" } }]);
    await expect(write(db)).rejects.toBeInstanceOf(RepositoryReadError);
    expect(db.from).toHaveBeenCalledTimes(1);
    expect(db.queries[0].insert).not.toHaveBeenCalled();
    expect(db.queries[0].update).not.toHaveBeenCalled();
    expect(db.queries[0].delete).not.toHaveBeenCalled();
});

it("delete lead reports an uncertain RPC failure without attempting fallback writes", async () => {
    const rpc = jest.fn().mockRejectedValue(new Error("Unavailable"));
    const client = { rpc } as unknown as SupabaseClient;
    await expect(new LeadRepo(client).deleteLead(1)).resolves.toContain("Unable to confirm customer deletion");
    expect(rpc).toHaveBeenCalledWith("autotrack_delete_lead", { p_lead_id: 1 });
});
