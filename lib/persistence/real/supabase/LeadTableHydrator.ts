import { readAllPages } from "./readAllPages";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Lead } from "@/domain/objects/Lead";
import { Vehicle } from "@/domain/objects/Vehicle";
import { ScoringService } from "@/domain/business/ScoringService";
import { supabase } from "@/lib/supabase/client";
import { mapRowToVehicle, type VehicleRow } from "./VehicleRepo";

type AssociationRow = { lead_id: number; trim_override: string | null; vehicles: VehicleRow | null };
const BATCH_SIZE = 200;

/** Bound URL length and query concurrency; PostgREST's FK embedding preserves RLS. */
export async function hydrateLeadTableData(leads: Lead[], client: SupabaseClient = supabase): Promise<Lead[]> {
    const interests = new Map<number, Vehicle>();
    const tradeIns = new Map<number, Vehicle>();
    const ids = [...new Set(leads.map(lead => lead.leadID))];
    for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
        const batch = ids.slice(offset, offset + BATCH_SIZE);
        await Promise.all([
            load("lead_vehicle_interests", interests, batch),
            load("lead_trade_in_vehicles", tradeIns, batch),
        ]);
    }
    const scoringService = new ScoringService();
    return leads.map(lead => {
        lead.vehicleInterest = interests.get(lead.leadID) ?? null;
        lead.tradeInVehicle = tradeIns.get(lead.leadID) ?? null;
        lead.updateScore(scoringService.calculatePriority(lead).score);
        return lead;
    });

    async function load(table: string, target: Map<number, Vehicle>, batch: number[]) {
        const data = await readAllPages<AssociationRow>((from, to) => client.from(table)
            .select("lead_id,trim_override,vehicles(*)")
            .in("lead_id", batch)
            .order("lead_id", { ascending: true })
            .range(from, to).returns<AssociationRow[]>());
        for (const row of data as unknown as AssociationRow[]) {
            // An invisible/deleted related vehicle is null under a left embedding.
            if (!row.vehicles) continue;
            const vehicle = mapRowToVehicle(row.vehicles);
            if (row.trim_override) vehicle.trim = row.trim_override;
            target.set(row.lead_id, vehicle);
        }
    }
}
