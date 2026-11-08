import { TaskRepo } from "@/lib/persistence/real/supabase/TaskRepo";
import { scriptedClient } from "@/tests/helpers/supabase";
import { makeTask } from "@/tests/fixtures/domain";

jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));

const row = (overrides = {}) => ({ task_id: 10, lead_id: 1, title: "Call customer", task_date: "2026-06-20T09:30:00", completed: false, ...overrides });

describe("DB-TASK — task repository adapter integration", () => {
    it.each([0, 999, 1000, 1001])("DB-TASK-01: pagination boundary %i rows", async (count) => {
        const rows = Array.from({ length: count }, (_, i) => row({ task_id: i + 1, title: `Task ${i}` }));
        const db = scriptedClient(count < 1000 ? [{ data: rows }] : [{ data: rows.slice(0, 1000) }, { data: rows.slice(1000) }]);
        expect(await new TaskRepo(db.client).getAllTasks()).toHaveLength(count);
        expect(db.queries[0].range).toHaveBeenCalledWith(0, 999);
        if (count >= 1000) expect(db.queries[1].range).toHaveBeenCalledWith(1000, 1999);
        expect(db.remaining()).toBe(0);
    });

    it("DB-TASK-02: a later page failure does not return misleading partial data", async () => {
        const rows = Array.from({ length: 1000 }, (_, i) => row({ task_id: i, title: `Task ${i}` }));
        const db = scriptedClient([{ data: rows }, { error: { message: "Disconnected" } }]);
        await expect(new TaskRepo(db.client).getTasksByLeadId(7)).rejects.toThrow("Unable to load tasks");
        db.queries.forEach((query) => expect(query.eq).toHaveBeenCalledWith("lead_id", 7));
    });

    it("DB-TASK-03: duplicates use the earliest persisted task and merge completion", async () => {
        const db = scriptedClient([{ data: [
            row({ task_id: 12, task_date: "2026-06-20T11:00:00", completed: true }),
            row({ task_id: 11 }), row({ task_id: 10 }),
            row({ task_id: 13, lead_id: 2 }),
            row({ task_id: 14, task_date: "2026-06-21T09:30:00" }),
        ] }]);
        const tasks = await new TaskRepo(db.client).getAllTasks();
        expect(tasks).toHaveLength(3);
        expect(tasks[0].getEventID()).toBe(10);
        expect(tasks[0].isCompleted()).toBe(true);
        expect(tasks[0].getDate()).toEqual(new Date(2026, 5, 20, 9, 30));
    });

    it("DB-TASK-04: inserting an existing logical task reuses its id and state", async () => {
        const db = scriptedClient([{ data: [row({ completed: true, task_type: "Follow-up", notes: "Existing" })] }]);
        const task = makeTask();
        task.setEventID(-1);
        expect(await new TaskRepo(db.client).insertTask(task)).toBeNull();
        expect(task.getEventID()).toBe(10);
        expect(task.isCompleted()).toBe(true);
        expect(task.getNotes()).toBe("Existing");
        expect(db.from).toHaveBeenCalledTimes(1);
        expect(db.queries[0].insert).not.toHaveBeenCalled();
    });

    it("DB-TASK-05: unassociated tasks cannot be inserted or updated", async () => {
        const db = scriptedClient([]);
        const repo = new TaskRepo(db.client);
        expect(await repo.insertTask(makeTask(null))).toMatch(/associated with a lead/);
        expect(await repo.updateTask(makeTask(null))).toMatch(/associated with a lead/);
        expect(db.from).not.toHaveBeenCalled();
    });

    it("DB-TASK-06: legacy schema retries omit optional columns and preserve local date/time", async () => {
        const db = scriptedClient([
            { data: [] }, { error: { message: "task_type column does not exist" } }, { data: row({ task_id: 42 }) },
        ]);
        const task = makeTask();
        task.setEventID(-1);
        task.setDate(new Date(2026, 5, 20, 9, 30));
        task.setTaskType("Follow-up");
        task.setNotes("Notes");
        expect(await new TaskRepo(db.client).insertTask(task)).toBeNull();
        expect(task.getEventID()).toBe(42);
        expect(db.queries[1].insert).toHaveBeenCalledWith(expect.objectContaining({ task_type: "Follow-up", notes: "Notes", task_date: "2026-06-20T09:30:00" }));
        const payload = db.queries[2].insert.mock.calls[0][0];
        expect(payload).not.toHaveProperty("task_id");
        expect(payload).not.toHaveProperty("task_type");
        expect(payload).not.toHaveProperty("notes");
    });

    it("DB-TASK-07: ordinary write errors do not retry or assign an id", async () => {
        const db = scriptedClient([{ data: [] }, { error: { message: "Permission denied" } }]);
        const task = makeTask();
        task.setEventID(-1);
        expect(await new TaskRepo(db.client).insertTask(task)).toBe("Permission denied");
        expect(task.getEventID()).toBe(-1);
        expect(db.from).toHaveBeenCalledTimes(2);
    });

    it.each([true, false])("DB-TASK-08: completion=%s updates same-day duplicates only", async (completed) => {
        const db = scriptedClient([{ data: row() }, {}, {}]);
        expect(await new TaskRepo(db.client).updateTaskCompletion(10, completed)).toBeNull();
        expect(db.queries[1].update).toHaveBeenCalledWith({ completed });
        expect(db.queries[1].eq).toHaveBeenCalledWith("task_id", 10);
        const duplicateQuery = db.queries[2];
        expect(duplicateQuery.eq).toHaveBeenCalledWith("lead_id", 1);
        expect(duplicateQuery.eq).toHaveBeenCalledWith("title", "Call customer");
        expect(duplicateQuery.gte).toHaveBeenCalledWith("task_date", "2026-06-20T00:00:00");
        expect(duplicateQuery.lt).toHaveBeenCalledWith("task_date", "2026-06-21T00:00:00");
        expect(duplicateQuery.neq).toHaveBeenCalledWith("task_id", 10);
    });

    it("DB-TASK-09: failed completion stops before synchronizing duplicates", async () => {
        const db = scriptedClient([{ data: row() }, { error: { message: "Write failed" } }]);
        expect(await new TaskRepo(db.client).updateTaskCompletion(10, true)).toBe("Write failed");
        expect(db.from).toHaveBeenCalledTimes(2);
    });

    it("DB-TASK-10: absent tasks cannot be completed or deleted", async () => {
        const db = scriptedClient([{}, {}]);
        const repo = new TaskRepo(db.client);
        expect(await repo.updateTaskCompletion(999, true)).toBe("Task not found.");
        expect(await repo.deleteTask(999)).toBe("Task not found.");
        db.queries.forEach((query) => expect(query.delete).not.toHaveBeenCalled());
    });
});
