import { LeadRepo } from "@/lib/persistence/real/supabase/LeadRepo";
import { NotificationRepo } from "@/lib/persistence/real/supabase/NotificationRepo";
import { VehicleRepo } from "@/lib/persistence/real/supabase/VehicleRepo";
import { makeLead, makeNotification } from "@/tests/fixtures/domain";
import { scriptedClient } from "@/tests/helpers/supabase";

jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));

describe("DB — repository mapping and failure contracts", () => {
    it("DB-LEAD-01: nullable columns map to domain defaults without losing false or zero", async () => {
        const db = scriptedClient([{ data: { lead_id: 7, first_name: " Ada ", last_name: null, status: false, budget: 0, stage: null } }]);
        const lead = await new LeadRepo(db.client).getLeadById(7);
        expect(lead).toMatchObject({ leadID: 7, firstName: "Ada", lastName: "", status: false, budget: 0, stage: "NEW", leadProvince: "ON", lastInteractionDate: null });
        expect(db.queries[0].eq).toHaveBeenCalledWith("lead_id", 7);
    });

    it("DB-LEAD-02: inserts serialize dates, omit generated id, and adopt returned id", async () => {
        const db = scriptedClient([{ data: { lead_id: 42 } }]);
        const lead = makeLead({ leadID: 0, lastInteractionDate: null });
        expect(await new LeadRepo(db.client).insertLead(lead)).toBeNull();
        expect(lead.leadID).toBe(42);
        const payload = db.queries[0].insert.mock.calls[0][0];
        expect(payload).toMatchObject({ first_name: "Ada", follow_up_date: lead.followUpDate.toISOString(), created_at: lead.createdAt.toISOString(), last_interaction_date: null });
        expect(payload).not.toHaveProperty("lead_id");
    });

    it("DB-LEAD-03: failed insert preserves id and reports error", async () => {
        const db = scriptedClient([{ error: { message: "Permission denied" } }]);
        const lead = makeLead({ leadID: 0 });
        expect(await new LeadRepo(db.client).insertLead(lead)).toBe("Permission denied");
        expect(lead.leadID).toBe(0);
    });

    it("DB-LEAD-04: empty search does not issue a query; commas cannot add OR terms", async () => {
        const db = scriptedClient([{ data: [] }]);
        const repo = new LeadRepo(db.client);
        expect(await repo.searchLeads("  ")).toEqual([]);
        expect(db.from).not.toHaveBeenCalled();
        await repo.searchLeads(" Ada,Chen ", 3);
        expect(db.queries[0].or).toHaveBeenCalledWith("first_name.ilike.%Ada Chen%,last_name.ilike.%Ada Chen%,phone.ilike.%Ada Chen%,lead_email.ilike.%Ada Chen%");
        expect(db.queries[0].limit).toHaveBeenCalledWith(3);
    });

    it("DB-LEAD-05: follow-up range includes midnight and excludes next midnight", async () => {
        const db = scriptedClient([{ data: [] }]);
        const target = new Date(2026, 5, 20, 15);
        await new LeadRepo(db.client).getLeadsByFollowUpDate(target);
        expect(db.queries[0].gte).toHaveBeenCalledWith("follow_up_date", new Date(2026, 5, 20).toISOString());
        expect(db.queries[0].lt).toHaveBeenCalledWith("follow_up_date", new Date(2026, 5, 21).toISOString());
        expect(target.getHours()).toBe(15);
    });

    it("DB-LEAD-06: absent leads cannot be updated or deleted", async () => {
        const db = scriptedClient([{}, {}]);
        const repo = new LeadRepo(db.client);
        expect(await repo.updateLead(makeLead())).toBe("Lead not found.");
        expect(await repo.deleteLead(1)).toBe("Lead not found.");
        db.queries.forEach((query) => {
            expect(query.update).not.toHaveBeenCalled();
            expect(query.delete).not.toHaveBeenCalled();
        });
    });

    it("DB-LEAD-07: update and delete use the requested lead id", async () => {
        const db = scriptedClient([{ data: { lead_id: 7, first_name: "Ada" } }, {}, { data: { lead_id: 7, first_name: "Ada" } }, {}]);
        const repo = new LeadRepo(db.client);
        expect(await repo.updateLead(makeLead({ leadID: 7, status: false }))).toBeNull();
        expect(db.queries[1].update).toHaveBeenCalledWith(expect.objectContaining({ lead_id: 7, status: false }));
        expect(db.queries[1].eq).toHaveBeenCalledWith("lead_id", 7);
        expect(await repo.deleteLead(7)).toBeNull();
        expect(db.queries[3].delete).toHaveBeenCalled();
        expect(db.queries[3].eq).toHaveBeenCalledWith("lead_id", 7);
    });

    it("DB-NOTIF-01: notifications map timestamps and optional lead references", async () => {
        const db = scriptedClient([{ data: [
            { notification_id: 1, lead_id: null, title: null, date: "2026-06-20T14:30:00Z" },
            { notification_id: 2, lead_id: 7, title: "Incoming call", date: "2026-06-20T15:30:00Z" },
        ] }]);
        const result = await new NotificationRepo(db.client).getAllNotifications();
        expect(result[0].getLead()).toBeNull();
        expect(result[0].getTitle()).toBe("");
        expect(result[0].getDate().toISOString()).toBe("2026-06-20T14:30:00.000Z");
        expect(result[1].getLeadID()).toBe(7);
        expect(db.queries[0].order).toHaveBeenCalledWith("date", { ascending: false });
    });

    it("DB-NOTIF-02: insert serializes UTC time and adopts generated id", async () => {
        const db = scriptedClient([{ data: { notification_id: 88 } }]);
        const notification = makeNotification("Incoming call", makeLead(), -1);
        expect(await new NotificationRepo(db.client).insertNotification(notification)).toBeNull();
        expect(notification.getEventID()).toBe(88);
        expect(db.queries[0].insert).toHaveBeenCalledWith({ lead_id: 1, title: "Incoming call", date: notification.getDate().toISOString() });
    });

    it("DB-NOTIF-03: scoped reads filter by lead; missing writes return not found", async () => {
        const db = scriptedClient([{ data: [] }, {}, {}]);
        const repo = new NotificationRepo(db.client);
        expect(await repo.getNotificationsByLeadId(7)).toEqual([]);
        expect(db.queries[0].eq).toHaveBeenCalledWith("lead_id", 7);
        expect(await repo.updateNotification(makeNotification("Reminder"))).toBe("Notification not found.");
        expect(await repo.deleteNotification(999)).toBe("Notification not found.");
    });

    it("DB-CAT-01: year search removes nulls and duplicates, matches prefixes and limits results", async () => {
        const db = scriptedClient([{ data: [{ year: 2026 }, { year: 2026 }, { year: 2025 }, { year: 1999 }, { year: null }] }]);
        expect(await new VehicleRepo(db.client).searchYears(" 202 ", 1)).toEqual([2026]);
    });

    it.each(["searchMakes", "searchModels", "searchTrims"] as const)("DB-CAT-02: %s filters its parent selection and deduplicates options", async (method) => {
        const column = method === "searchMakes" ? "make" : method === "searchModels" ? "model" : "trim";
        const db = scriptedClient([{ data: [{ [column]: "One" }, { [column]: "One" }, { [column]: "Two" }, { [column]: null }] }]);
        const repo = new VehicleRepo(db.client);
        const result = method === "searchMakes" ? await repo.searchMakes(2026, " o ")
            : method === "searchModels" ? await repo.searchModels(2026, "Toyota", " o ")
                : await repo.searchTrims(2026, "Toyota", "RAV4", " o ");
        expect(result).toEqual(["One", "Two"]);
        expect(db.queries[0].eq).toHaveBeenCalledWith("year", 2026);
        expect(db.queries[0].ilike).toHaveBeenCalledWith(column, "%o%");
        if (method !== "searchMakes") expect(db.queries[0].ilike).toHaveBeenCalledWith("make", "Toyota");
        if (method === "searchTrims") expect(db.queries[0].ilike).toHaveBeenCalledWith("model", "RAV4");
    });

    it("DB-ERR-01: read failures follow the empty/null repository contract", async () => {
        const db = scriptedClient(Array.from({ length: 6 }, () => ({ error: { message: "Unavailable" } })));
        expect(await new LeadRepo(db.client).getAllLeads()).toEqual([]);
        expect(await new LeadRepo(db.client).getLeadById(1)).toBeNull();
        expect(await new NotificationRepo(db.client).getAllNotifications()).toEqual([]);
        expect(await new NotificationRepo(db.client).getNotificationById(1)).toBeNull();
        expect(await new VehicleRepo(db.client).getAllVehicles()).toEqual([]);
        expect(await new VehicleRepo(db.client).getVehicleById(1)).toBeNull();
    });
});
