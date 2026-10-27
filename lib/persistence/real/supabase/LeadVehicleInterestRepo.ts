import { Vehicle } from "@/domain/objects/Vehicle";
import { supabase } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { VehicleRepo } from "@/lib/persistence/real/supabase/VehicleRepo";

type LeadVehicleInterestRow = {
    lead_id: number;
    vehicle_id: number;
    trim_override: string | null;
    updated_at: string | null;
};

const TABLE_NAME = "lead_vehicle_interests";
const MISSING_TABLE_MESSAGE =
    "Vehicle interest table is not set up in Supabase. Run the lead_vehicle_interests migration SQL first.";

function isMissingTableError(message: string): boolean {
    return (
        message.includes("lead_vehicle_interests") &&
        (message.includes("schema cache") ||
            message.includes("does not exist") ||
            message.includes("Could not find the table"))
    );
}

export class LeadVehicleInterestRepo {
    private vehicleRepo: VehicleRepo;

    constructor(vehicleRepo = new VehicleRepo(), private readonly client: SupabaseClient = supabase) {
        this.vehicleRepo = vehicleRepo;
    }

    async getVehicleInterestByLeadId(leadId: number): Promise<Vehicle | null> {
        const { data, error } = await this.client
            .from(TABLE_NAME)
            .select("*")
            .eq("lead_id", leadId)
            .maybeSingle();

        if (error || !data) {
            return null;
        }

        const row = data as LeadVehicleInterestRow;
        const vehicle = await this.vehicleRepo.getVehicleById(row.vehicle_id);

        if (!vehicle) {
            return null;
        }

        if (row.trim_override) {
            vehicle.trim = row.trim_override;
        }

        return vehicle;
    }

    async saveVehicleInterest({
        leadId,
        year,
        make,
        model,
        trim,
    }: {
        leadId: number;
        year: number;
        make: string;
        model: string;
        trim?: string;
    }): Promise<string | null> {
        let vehicle = await this.vehicleRepo.findVehicleBySelection({
            year,
            make,
            model,
            trim,
        });

        if (!vehicle && trim?.trim()) {
            vehicle = await this.vehicleRepo.findVehicleBySelection({
                year,
                make,
                model,
            });
        }

        if (!vehicle) {
            return "Selected vehicle was not found in the catalog.";
        }

        const trimOverride =
            trim?.trim() && trim.trim() !== vehicle.trim
                ? trim.trim()
                : null;
        const { error } = await this.client
            .from(TABLE_NAME)
            .upsert(
                {
                    lead_id: leadId,
                    vehicle_id: vehicle.vehicleID,
                    trim_override: trimOverride,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: "lead_id" }
            );

        if (error?.message && isMissingTableError(error.message)) {
            return MISSING_TABLE_MESSAGE;
        }

        return error?.message ?? null;
    }

    async clearVehicleInterest(leadId: number): Promise<string | null> {
        const { error } = await this.client
            .from(TABLE_NAME)
            .delete()
            .eq("lead_id", leadId);

        if (error?.message && isMissingTableError(error.message)) {
            return MISSING_TABLE_MESSAGE;
        }

        return error?.message ?? null;
    }
}
