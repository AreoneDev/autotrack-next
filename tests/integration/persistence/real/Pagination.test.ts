import { AnalyticsService } from "@/domain/business/AnalyticsService";
import { AgendaService } from "@/domain/business/AgendaService";
import { DashboardService } from "@/domain/business/DashboardService";
import { ScoringService } from "@/domain/business/ScoringService";
import { PriorityManager } from "@/domain/business/PriorityManager";
import { Task } from "@/domain/objects/Task";
import { LeadRepo } from "@/lib/persistence/real/supabase/LeadRepo";
import { NotificationRepo } from "@/lib/persistence/real/supabase/NotificationRepo";
import { hydrateLeadTableData } from "@/lib/persistence/real/supabase/LeadTableHydrator";
import { makeLead } from "@/tests/fixtures/domain";
import { scriptedClient } from "@/tests/helpers/supabase";

jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));

const leads = Array.from({ length: 2103 }, (_, i) => ({ lead_id: i + 1, first_name: `Customer ${i + 1}` }));
const notifications = leads.map(row => ({ notification_id: row.lead_id, lead_id: row.lead_id, date: "2026-11-07T12:00:00Z" }));

describe("complete collection reads", () => {
    it.each([1000, 137])("reads every lead beyond the server cap of %i", async cap => {
        const pages = [];
        for (let offset = 0; offset < leads.length; offset += cap) pages.push({ data: leads.slice(offset, offset + cap) });
        const db = scriptedClient([...pages, { data: [] }]);
        const result = await new LeadRepo(db.client).getAllLeads();
        expect(result.map(lead => lead.leadID)).toEqual(leads.map(row => row.lead_id));
        expect(new Set(result.map(lead => lead.leadID)).size).toBe(2103);
        db.queries.forEach((query, index) => {
            const offset = Math.min(index * cap, leads.length);
            expect(query.range).toHaveBeenCalledWith(offset, offset + 999);
            expect(query.order).toHaveBeenCalledWith("lead_id", { ascending: true });
        });
    });

    it.each([false, true])("reads notifications across pages, scoped=%s", async scoped => {
        const db = scriptedClient([{ data: notifications.slice(0, 1000) }, { data: notifications.slice(1000) }, { data: [] }]);
        const repo = new NotificationRepo(db.client);
        const result = await (scoped ? repo.getNotificationsByLeadId(7) : repo.getAllNotifications());
        expect(result.map(item => item.getEventID())).toEqual(notifications.map(row => row.notification_id));
        db.queries.forEach(query => {
            expect(query.order.mock.calls).toEqual([["date", { ascending: false }], ["notification_id", { ascending: false }]]);
            if (scoped) expect(query.eq).toHaveBeenCalledWith("lead_id", 7);
        });
    });

    it("applies follow-up date filters and unique ordering on every page", async () => {
        const db = scriptedClient([{ data: leads.slice(0, 2) }, { data: leads.slice(2, 3) }, { data: [] }]);
        expect(await new LeadRepo(db.client).getLeadsByFollowUpDate(new Date(2026, 10, 7))).toHaveLength(3);
        db.queries.forEach(query => {
            expect(query.gte).toHaveBeenCalledWith("follow_up_date", new Date(2026, 10, 7).toISOString());
            expect(query.lt).toHaveBeenCalledWith("follow_up_date", new Date(2026, 10, 8).toISOString());
            expect(query.order.mock.calls).toEqual([["follow_up_date", { ascending: true }], ["lead_id", { ascending: true }]]);
        });
    });

    it.each(["leads", "notifications", "followups"])("rejects %s when a later page fails", async kind => {
        const db = scriptedClient([{ data: kind === "notifications" ? notifications.slice(0, 2) : leads.slice(0, 2) }, { error: { message: "Page unavailable" } }]);
        const promise = kind === "notifications" ? new NotificationRepo(db.client).getAllNotifications()
            : kind === "followups" ? new LeadRepo(db.client).getLeadsByFollowUpDate(new Date()) : new LeadRepo(db.client).getAllLeads();
        await expect(promise).rejects.toThrow("Page unavailable");
    });

    it("preserves later-page leads and activity in Analytics, Agenda and Dashboard", async () => {
        const target = new Date(2026, 10, 7, 12);
        const db = scriptedClient([
            { data: leads.slice(0, 1000) }, { data: leads.slice(1000) }, { data: [] },
            { data: notifications.slice(0, 1000) },
            { data: [{ notification_id: 9999, lead_id: 2103, title: "Appointment", date: target.toISOString() }] }, { data: [] },
        ]);
        const allLeads = await new LeadRepo(db.client).getAllLeads();
        const activity = await new NotificationRepo(db.client).getAllNotifications();
        const scoring = new ScoringService();
        const agenda = new AgendaService(scoring, new PriorityManager(scoring));
        const summary = new AnalyticsService(scoring).getAnalyticsSummary(allLeads, [], activity);
        expect(summary.conversionPerformance.leadAppointmentRatio).toMatchObject({ numerator: 1, denominator: 2103 });
        const appointment = agenda.getDailyActivities([], activity, target).find(item => item.id === 9999);
        expect(appointment?.leadId).toBe(2103);
        const task = new Task(allLeads[2102], "Later page task", target, 42);
        const dashboard = new DashboardService(scoring, agenda).getDashboardData(allLeads, [task], activity, target);
        expect(dashboard.todayTasks[0]).toMatchObject({ leadId: 2103, leadName: "Customer 2103" });
        expect(dashboard.metrics.todayTaskCount).toBe(1);
    });

    it("rejects a missing response instead of returning partial data", async () => {
        const db = scriptedClient([{ data: leads.slice(0, 1) }, { data: null }]);
        await expect(new LeadRepo(db.client).getAllLeads()).rejects.toThrow("Missing data");
    });

    it("pages associations within a batch when the server cap is lower than 200", async () => {
        const vehicle = { vehicle_id: 9, make: "Test", model: "Car", year: 2026 };
        const db = scriptedClient([
            { data: [{ lead_id: 1, vehicles: vehicle }] }, { data: [] },
            { data: [{ lead_id: 2, vehicles: vehicle }] }, { data: [] },
        ]);
        const result = await hydrateLeadTableData([makeLead({ leadID: 1 }), makeLead({ leadID: 2 })], db.client);
        expect(result.map(lead => lead.vehicleInterest?.vehicleID)).toEqual([9, 9]);
        expect(db.from).toHaveBeenCalledTimes(4);
        expect(db.queries[2].range).toHaveBeenCalledWith(1, 1000);
    });
});
