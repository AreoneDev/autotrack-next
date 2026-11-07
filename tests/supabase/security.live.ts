import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Lead } from "@/domain/objects/Lead";
import { Task } from "@/domain/objects/Task";
import { Notification } from "@/domain/objects/Notification";
import { Vehicle } from "@/domain/objects/Vehicle";
import { hydrateLeadTableData } from "@/lib/persistence/real/supabase/LeadTableHydrator";
import { LeadRepo } from "@/lib/persistence/real/supabase/LeadRepo";
import { TaskRepo } from "@/lib/persistence/real/supabase/TaskRepo";
import { NotificationRepo } from "@/lib/persistence/real/supabase/NotificationRepo";
import { VehicleRepo } from "@/lib/persistence/real/supabase/VehicleRepo";
import { LeadVehicleInterestRepo } from "@/lib/persistence/real/supabase/LeadVehicleInterestRepo";
import { LeadTradeInVehicleRepo } from "@/lib/persistence/real/supabase/LeadTradeInVehicleRepo";

// No mocks: password authentication, repository calls and attacks use real HTTP.
const url = process.env.AUTOTRACK_TEST_URL;
if (!/^autotrack-security-[0-9a-f]{8}$/.test(process.env.AUTOTRACK_DISPOSABLE_RUN ?? "")
    || url !== "http://127.0.0.1:56421") {
    throw new Error("Use npm run test:supabase; this suite requires its disposable local stack.");
}
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const client = () => createClient(url, process.env.AUTOTRACK_TEST_ANON_KEY!, options);
type Row = Record<string, unknown>;
async function ok<R extends { data: unknown; error: unknown }>(request: PromiseLike<R>): Promise<NonNullable<R["data"]>> {
    const result = await request;
    expect(result.error).toBeNull();
    return result.data as NonNullable<R["data"]>;
}
async function denied(request: PromiseLike<{ error: { code?: string } | null }>, code = "42501") {
    const result = await request;
    expect(result.error).toMatchObject({ code });
}
type Actor = { db: SupabaseClient; id: string; lead: Row; task: Row; notification: Row; vehicle: Row };
const links = ["lead_vehicle_interests", "lead_trade_in_vehicles"] as const;
const entities = [
    ["leads", "lead_id", "first_name"],
    ["tasks", "task_id", "title"],
    ["notifications", "notification_id", "title"],
    ["vehicles", "vehicle_id", "model"],
] as const;
let a: Actor, b: Actor;
const anonymous = client();

async function actor(label: string): Promise<Actor> {
    const admin = createClient(url!, process.env.AUTOTRACK_TEST_SERVICE_KEY!, options);
    const email = label + "-" + randomUUID() + "@example.invalid";
    const password = randomUUID() + "aA1!";
    const created = await ok(admin.auth.admin.createUser({ email, password, email_confirm: true }));
    expect(created.user?.id).toBeTruthy();
    const db = client();
    const signed = await ok(db.auth.signInWithPassword({ email, password }));
    expect(signed.user?.id).toBe(created.user?.id);
    const lead = await ok(db.from("leads").insert({ first_name: label }).select().single());
    const task = await ok(db.from("tasks").insert({ lead_id: lead.lead_id, title: label, task_date: "2026-11-02T10:00:00" }).select().single());
    const notification = await ok(db.from("notifications").insert({ lead_id: lead.lead_id, title: label, date: "2026-11-02T15:00:00Z" }).select().single());
    const vehicle = await ok(db.from("vehicles").insert({ make: "Synthetic", model: label, year: 2026 }).select().single());
    for (const table of links) await ok(db.from(table).insert({ lead_id: lead.lead_id, vehicle_id: vehicle.vehicle_id }));
    return { db, id: signed.user!.id, lead, task, notification, vehicle };
}
function rowFor(who: Actor, table: string): Row {
    return table === "leads" ? who.lead : table === "tasks" ? who.task : table === "notifications" ? who.notification : who.vehicle;
}
beforeAll(async () => {
    [a, b] = await Promise.all([actor("ActorA"), actor("ActorB")]);
    expect(a.id).not.toBe(b.id);
    // Tombstones exist for both actors before isolation assertions.
    for (const who of [a, b]) {
        const row = await ok(who.db.from("leads").insert({ first_name: "Deleted" }).select().single());
        await ok(who.db.from("leads").delete().eq("lead_id", row.lead_id));
    }
});

describe("RLS decision table: self / other / anonymous", () => {
    it.each(entities)("RLS-01 %s: owner reads; other user reads/updates/deletes zero rows", async (table, key, field) => {
        for (const [owner, other] of [[a, b], [b, a]]) {
            const row = rowFor(owner, table);
            expect(await ok(owner.db.from(table).select().eq(key, row[key]))).toEqual([row]);
            expect(await ok(other.db.from(table).select().eq(key, row[key]))).toEqual([]);
            expect(await ok(other.db.from(table).update({ [field]: "Hijacked" }).eq(key, row[key]).select())).toEqual([]);
            expect(await ok(other.db.from(table).delete().eq(key, row[key]).select())).toEqual([]);
            expect(await ok(owner.db.from(table).select().eq(key, row[key]))).toEqual([row]);
        }
    });
    it.each(entities)("RLS-02 %s: cannot insert for another owner", async (table) => {
        const payload: Row = table === "leads" ? { first_name: "Forged" }
            : table === "vehicles" ? { model: "Forged" } : { title: "Forged" };
        await denied(a.db.from(table).insert({ ...payload, owner_id: b.id }));
        await denied(b.db.from(table).insert({ ...payload, owner_id: a.id }));
    });
    it.each(["leads", "tasks", "notifications"])("RLS-03 %s: owner/sync identity immutable; revision cannot be forged", async (table) => {
        const key = entities.find(e => e[0] === table)![1];
        const payload: Row = table === "leads" ? { first_name: "Revision" } : { title: "Revision" };
        const row = await ok(a.db.from(table).insert(payload).select().single());
        for (const change of [{ owner_id: b.id }, { sync_id: randomUUID() }]) {
            await denied(a.db.from(table).update(change).eq(key, row[key]), "P0001");
            expect(await ok(a.db.from(table).select().eq(key, row[key]).single())).toEqual(row);
        }
        const updated = await ok(a.db.from(table).update({ ...payload, version: 999 }).eq(key, row[key]).select().single());
        expect(updated.version).toBe(2);
        expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(Date.parse(row.updated_at));
        await ok(a.db.from(table).delete().eq(key, row[key]));
        const tombstone = await ok(a.db.from("sync_deleted").select().eq("sync_id", row.sync_id).single());
        expect(tombstone).toMatchObject({ owner_id: a.id, entity: table, version: 3 });
        expect(await ok(b.db.from("sync_deleted").select().eq("sync_id", row.sync_id))).toEqual([]);
    });
    it.each(["tasks", "notifications"])("RLS-04 %s: cannot attach or move own child to a foreign lead", async table => {
        await denied(a.db.from(table).insert({ title: "Foreign", lead_id: b.lead.lead_id }));
        const key = table === "tasks" ? "task_id" : "notification_id";
        const row = rowFor(a, table);
        await denied(a.db.from(table).update({ lead_id: b.lead.lead_id }).eq(key, row[key]));
        expect(await ok(a.db.from(table).select().eq(key, row[key]).single())).toEqual(row);
        // Null lead is an explicit allowed partition in the ownership policy.
        const unlinked = await ok(a.db.from(table).insert({ title: "Standalone", lead_id: null }).select().single());
        expect(unlinked.owner_id).toBe(a.id);
    });
    it.each(links)("RLS-05 %s: foreign lead/vehicle rejected, foreign links invisible and unchanged", async table => {
        const original = await ok(a.db.from(table).select().eq("lead_id", a.lead.lead_id).single());
        await denied(a.db.from(table).insert({ lead_id: b.lead.lead_id, vehicle_id: a.vehicle.vehicle_id }));
        const emptyLead = await ok(a.db.from("leads").insert({ first_name: "Link" }).select().single());
        await denied(a.db.from(table).insert({ lead_id: emptyLead.lead_id, vehicle_id: b.vehicle.vehicle_id }));
        await denied(a.db.from(table).update({ vehicle_id: b.vehicle.vehicle_id }).eq("lead_id", a.lead.lead_id));
        expect(await ok(b.db.from(table).select().eq("lead_id", a.lead.lead_id))).toEqual([]);
        expect(await ok(b.db.from(table).update({ vehicle_id: b.vehicle.vehicle_id }).eq("lead_id", a.lead.lead_id).select())).toEqual([]);
        expect(await ok(b.db.from(table).delete().eq("lead_id", a.lead.lead_id).select())).toEqual([]);
        expect(await ok(a.db.from(table).select().eq("lead_id", a.lead.lead_id).single())).toEqual(original);
        // An own lead may link to the shared catalogue and clear its own link.
        await ok(a.db.from(table).insert({ lead_id: emptyLead.lead_id, vehicle_id: 1 }));
        await ok(a.db.from(table).delete().eq("lead_id", emptyLead.lead_id));
        expect(await ok(a.db.from(table).select().eq("lead_id", emptyLead.lead_id))).toEqual([]);
    });
    it("RLS-06 shared catalogue readable by both, immutable to authenticated users", async () => {
        for (const who of [a, b]) {
            const original = await ok(who.db.from("vehicles").select().eq("vehicle_id", 1).single());
            expect(original.owner_id).toBeNull();
            expect(await ok(who.db.from("vehicles").update({ model: "Hijacked" }).eq("vehicle_id", 1).select())).toEqual([]);
            expect(await ok(who.db.from("vehicles").delete().eq("vehicle_id", 1).select())).toEqual([]);
            await denied(who.db.from("vehicles").insert({ owner_id: null, model: "Shared" }));
            await denied(who.db.from("vehicles").update({ owner_id: null }).eq("vehicle_id", who.vehicle.vehicle_id));
            expect(await ok(who.db.from("vehicles").select().eq("vehicle_id", 1).single())).toEqual(original);
        }
    });
    it.each(["imported_cars", "sync_deleted"])("RLS-07 %s: read-only; insert/update/delete denied", async table => {
        const original = await ok(a.db.from(table).select());
        expect(original.length).toBeGreaterThan(0);
        if (table === "sync_deleted") expect(original.every(row => row.owner_id === a.id)).toBe(true);
        const payload: Row = table === "imported_cars" ? { make: "Forged" }
            : { owner_id: a.id, entity: "leads", sync_id: randomUUID(), version: 1 };
        await denied(a.db.from(table).insert(payload));
        await denied(a.db.from(table).update(table === "imported_cars" ? { make: "Forged" } : { version: 999 }).not(table === "imported_cars" ? "id" : "sync_id", "is", null));
        await denied(a.db.from(table).delete().not(table === "imported_cars" ? "id" : "sync_id", "is", null));
        expect(await ok(a.db.from(table).select())).toEqual(original);
    });
    it.each([...entities.map(e => e[0]), ...links, "imported_cars", "sync_deleted"])(
        "RLS-08 %s: anonymous CRUD denied", async table => {
            const key = entities.find(entity => entity[0] === table)?.[1]
                ?? (table === "sync_deleted" ? "sync_id" : table === "imported_cars" ? "id" : "lead_id");
            const value = table === "sync_deleted" ? a.lead.sync_id : 1;
            await denied(anonymous.from(table).select());
            await denied(anonymous.from(table).insert(table === "leads" ? { first_name: "Anonymous" }
                : table === "vehicles" ? { model: "Anonymous" }
                : table === "imported_cars" ? { make: "Anonymous" }
                : table === "sync_deleted" ? { owner_id: a.id, entity: "leads", sync_id: randomUUID(), version: 1 }
                : links.includes(table as typeof links[number]) ? { lead_id: a.lead.lead_id, vehicle_id: 1 }
                : { title: "Anonymous" }));
            // A valid filtered mutation must reach authorization, not pg_safeupdate.
            await denied(anonymous.from(table).update(table === "leads" ? { first_name: "Anonymous" }
                : table === "vehicles" ? { model: "Anonymous" }
                : table === "imported_cars" ? { make: "Anonymous" }
                : table === "sync_deleted" ? { version: 999 }
                : links.includes(table as typeof links[number]) ? { vehicle_id: 1 } : { title: "Anonymous" }).eq(key, value).select());
            await denied(anonymous.from(table).delete().eq(key, value).select());
        }
    );
    it("AUTH-LIVE-01 invalid JWT rejected by gateway", async () => {
        const response = await fetch(url + "/rest/v1/leads?select=*", {
            headers: { apikey: process.env.AUTOTRACK_TEST_ANON_KEY!, Authorization: "Bearer invalid" },
        });
        expect(response.status).toBe(401);
    });
});

describe("Real repository and database integration", () => {
    it("DB-LIVE-01 lead/task/notification/vehicle round trip, mapping and independent clients", async () => {
        const leads = new LeadRepo(a.db), tasks = new TaskRepo(a.db);
        const notifications = new NotificationRepo(a.db), vehicles = new VehicleRepo(a.db);
        const lead = new Lead({ firstName: "RoundTrip", budget: 12345, notes: "Synthetic", followUpDate: new Date("2026-11-03T15:00:00Z") });
        expect(await leads.insertLead(lead)).toBeNull();
        expect(lead.leadID).toBeGreaterThan(0);
        expect(await leads.getLeadById(lead.leadID)).toMatchObject({ firstName: "RoundTrip", budget: 12345 });
        expect(await new LeadRepo(b.db).getLeadById(lead.leadID)).toBeNull();
        lead.notes = "Updated";
        expect(await leads.updateLead(lead)).toBeNull();
        expect((await leads.getLeadById(lead.leadID))?.notes).toBe("Updated");
        const task = new Task(lead, "RoundTrip", new Date(2026, 10, 3, 10, 30), -1, "Follow-up", "Details");
        expect(await tasks.insertTask(task)).toBeNull();
        expect(await tasks.getTaskById(task.getEventID())).toMatchObject({});
        const loaded = await tasks.getTaskById(task.getEventID());
        expect(loaded?.getDate().getTime()).toBe(task.getDate().getTime());
        expect(loaded?.getNotes()).toBe("Details");
        expect(await tasks.updateTaskCompletion(task.getEventID(), true)).toBeNull();
        expect((await tasks.getTaskById(task.getEventID()))?.isCompleted()).toBe(true);
        const notification = new Notification(lead, "RoundTrip", new Date("2026-11-03T15:00:00Z"));
        expect(await notifications.insertNotification(notification)).toBeNull();
        notification.setTitle("Updated");
        expect(await notifications.updateNotification(notification)).toBeNull();
        expect((await notifications.getNotificationById(notification.getEventID()))?.getTitle()).toBe("Updated");
        const vehicle = new Vehicle("Synthetic", "RoundTrip", 2026, "Base", 12345, "Blue", true, "SYNTHETIC");
        expect(await vehicles.insertVehicle(vehicle)).toBeNull();
        vehicle.price = 23456;
        expect(await vehicles.updateVehicle(vehicle)).toBeNull();
        expect((await vehicles.getVehicleById(vehicle.vehicleID))?.price).toBe(23456);
        const interests = new LeadVehicleInterestRepo(vehicles, a.db);
        expect(await interests.saveVehicleInterest({ leadId: lead.leadID, year: 2026, make: "Synthetic", model: "RoundTrip" })).toBeNull();
        expect((await interests.getVehicleInterestByLeadId(lead.leadID))?.vehicleID).toBe(vehicle.vehicleID);
        expect(await interests.clearVehicleInterest(lead.leadID)).toBeNull();
        expect(await tasks.deleteTask(task.getEventID())).toBeNull();
        expect(await notifications.deleteNotification(notification.getEventID())).toBeNull();
        expect(await leads.deleteLead(lead.leadID)).toBeNull();
        expect(await vehicles.deleteVehicle(vehicle.vehicleID)).toBeNull();
        expect(await leads.getLeadById(lead.leadID)).toBeNull();
        expect(await tasks.getTaskById(task.getEventID())).toBeNull();
        expect(await notifications.getNotificationById(notification.getEventID())).toBeNull();
        expect(await vehicles.getVehicleById(vehicle.vehicleID)).toBeNull();
    });
    it("DB-LIVE-02 atomic delete RPC protects foreign lead and removes all own children with history", async () => {
        const lead = await ok(a.db.from("leads").insert({ first_name: "Cascade" }).select().single());
        const task = await ok(a.db.from("tasks").insert({ lead_id: lead.lead_id, title: "Cascade" }).select().single());
        const notification = await ok(a.db.from("notifications").insert({ lead_id: lead.lead_id, title: "Cascade" }).select().single());
        for (const table of links) await ok(a.db.from(table).insert({ lead_id: lead.lead_id, vehicle_id: 1 }));
        await denied(b.db.rpc("autotrack_delete_lead", { p_lead_id: lead.lead_id }), "P0001");
        expect(await ok(a.db.from("leads").select().eq("lead_id", lead.lead_id))).toHaveLength(1);
        await denied(anonymous.rpc("autotrack_delete_lead", { p_lead_id: lead.lead_id }));
        expect(await new LeadRepo(a.db).deleteLead(Number(lead.lead_id))).toBeNull();
        for (const table of ["leads", "tasks", "notifications", ...links]) {
            expect(await ok(a.db.from(table).select().eq("lead_id", lead.lead_id))).toEqual([]);
        }
        expect(await new LeadRepo(a.db).deleteLead(Number(lead.lead_id))).toBe("Lead not found.");
        const ids = [lead.sync_id, task.sync_id, notification.sync_id];
        expect(await ok(a.db.from("sync_deleted").select().in("sync_id", ids))).toHaveLength(3);
        expect(await ok(b.db.from("sync_deleted").select().in("sync_id", ids))).toEqual([]);
        expect(await ok(a.db.from("vehicles").select().eq("vehicle_id", 1))).toHaveLength(1);
    });
    it("DB-LIVE-03 trade-in adapter inserts, reads and clears own association", async () => {
        const lead = await ok(a.db.from("leads").insert({ first_name: "Trade" }).select().single());
        const repo = new LeadTradeInVehicleRepo(new VehicleRepo(a.db), a.db);
        expect(await repo.saveTradeInVehicle({ leadId: lead.lead_id, year: 2026, make: "Synthetic", model: "Catalogue" })).toBeNull();
        expect((await repo.getTradeInVehicleByLeadId(lead.lead_id))?.vehicleID).toBe(1);
        expect(await repo.clearTradeInVehicle(lead.lead_id)).toBeNull();
        expect(await repo.getTradeInVehicleByLeadId(lead.lead_id)).toBeNull();
    });

    it("CONTACT-LIVE-01 concurrent retries persist one notification and one lead revision", async () => {
        const lead = await ok(a.db.from("leads").insert({ first_name: "Concurrent contact", stage: "CONTACTED" }).select().single());
        const operation = {
            p_lead_id: lead.lead_id, p_operation_id: randomUUID(), p_channel: "call",
            p_occurred_at: new Date().toISOString(), p_expected_version: lead.version, p_score: 35,
        };
        const replies = await Promise.all([
            a.db.rpc("autotrack_log_communication", operation),
            a.db.rpc("autotrack_log_communication", operation),
        ]);
        for (const reply of replies) expect(reply.error).toBeNull();
        expect(replies[0].data.notification.notification_id).toBe(replies[1].data.notification.notification_id);
        expect(await ok(a.db.from("notifications").select().eq("sync_id", operation.p_operation_id))).toHaveLength(1);
        expect(await ok(a.db.from("leads").select().eq("lead_id", lead.lead_id).single())).toMatchObject({
            version: Number(lead.version) + 1, last_interaction_by: "USER", score: 35,
        });
    });

    it("DB-LIVE-04 batched FK hydration preserves per-lead trims and respects real relationship RLS", async () => {
        const rows = await ok(a.db.from("leads").insert([
            { first_name: "BatchOne" }, { first_name: "BatchTwo" },
        ]).select());
        for (const [i, row] of rows.entries()) {
            await ok(a.db.from("lead_vehicle_interests").insert({
                lead_id: row.lead_id, vehicle_id: 1, trim_override: "Interest" + i,
            }));
        }
        await ok(a.db.from("lead_trade_in_vehicles").insert({
            lead_id: rows[0].lead_id, vehicle_id: 1, trim_override: "Trade",
        }));
        const inputs = [...rows, b.lead].map(row => new Lead({ leadID: Number(row.lead_id), firstName: String(row.first_name ?? "Synthetic") }));
        const hydrated = await hydrateLeadTableData(inputs, a.db);
        expect(hydrated[0].vehicleInterest?.trim).toBe("Interest0");
        expect(hydrated[1].vehicleInterest?.trim).toBe("Interest1");
        expect(hydrated[0].tradeInVehicle?.trim).toBe("Trade");
        expect(hydrated[1].tradeInVehicle).toBeNull();
        expect(hydrated[0].vehicleInterest?.vehicleID).toBe(1);
        expect(hydrated[0].vehicleInterest).not.toBe(hydrated[1].vehicleInterest);
        expect(hydrated[2].vehicleInterest).toBeNull();
        expect(hydrated[2].tradeInVehicle).toBeNull();
        expect((await ok(a.db.from("vehicles").select("trim").eq("vehicle_id", 1).single())).trim).toBe("Base");
        const other = await hydrateLeadTableData(rows.map(row => new Lead({ leadID: Number(row.lead_id), firstName: String(row.first_name ?? "Synthetic") })), b.db);
        expect(other.every(lead => lead.vehicleInterest === null && lead.tradeInVehicle === null)).toBe(true);
    });

});
