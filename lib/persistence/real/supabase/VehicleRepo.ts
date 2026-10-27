import { supabase } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Vehicle } from "@/domain/objects/Vehicle";

type VehicleRow = {
    vehicle_id: number;
    make: string | null;
    model: string | null;
    year: number | null;
    trim: string | null;
    price: number | null;
    color: string | null;
    in_stock: boolean | null;
    vin: string | null;
    transmission: string | null;
};

type VehicleInsertRow = Omit<VehicleRow, "vehicle_id"> & {
    vehicle_id?: number;
};

const TABLE_NAME = "vehicles";

function mapRowToVehicle(row: VehicleRow): Vehicle {
    const vehicle = new Vehicle(
        row.make,
        row.model,
        row.year,
        row.trim,
        row.price ?? 0,
        row.color,
        row.in_stock ?? false,
        row.vin ?? "N/A",
        row.transmission ?? "Automatic"
    );

    vehicle.vehicleID = row.vehicle_id;
    return vehicle;
}

function mapVehicleToRow(vehicle: Vehicle): VehicleInsertRow {
    const row: VehicleInsertRow = {
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        trim: vehicle.trim,
        price: vehicle.price,
        color: vehicle.color,
        in_stock: vehicle.inStock,
        vin: vehicle.vin,
        transmission: vehicle.transmission,
    };

    if (vehicle.vehicleID !== 0) {
        row.vehicle_id = vehicle.vehicleID;
    }

    return row;
}

export class VehicleRepo {
    constructor(private readonly client: SupabaseClient = supabase) {}

    async searchYears(query = "", limit = 20): Promise<number[]> {
        const request = this.client
            .from(TABLE_NAME)
            .select("year")
            .not("year", "is", null)
            .order("year", { ascending: false })
            .limit(500);

        const { data, error } = await request;

        if (error || !data) {
            return [];
        }

        const normalizedQuery = query.trim();

        return [
            ...new Set(
                data
                    .map((row) => (row as Pick<VehicleRow, "year">).year)
                    .filter((year): year is number => year !== null)
                    .filter(
                        (year) =>
                            !normalizedQuery ||
                            year.toString().startsWith(normalizedQuery)
                    )
            ),
        ].slice(0, limit);
    }

    async searchMakes(
        year: number,
        query = "",
        limit = 20
    ): Promise<string[]> {
        let request = this.client
            .from(TABLE_NAME)
            .select("make")
            .eq("year", year)
            .not("make", "is", null)
            .order("make", { ascending: true })
            .limit(500);

        if (query.trim()) {
            request = request.ilike("make", `%${query.trim()}%`);
        }

        const { data, error } = await request;

        if (error || !data) {
            return [];
        }

        return [
            ...new Set(
                data
                    .map((row) => (row as Pick<VehicleRow, "make">).make)
                    .filter((make): make is string => Boolean(make))
            ),
        ].slice(0, limit);
    }

    async searchModels(
        year: number,
        make: string,
        query = "",
        limit = 20
    ): Promise<string[]> {
        let request = this.client
            .from(TABLE_NAME)
            .select("model")
            .eq("year", year)
            .ilike("make", make)
            .not("model", "is", null)
            .order("model", { ascending: true })
            .limit(500);

        if (query.trim()) {
            request = request.ilike("model", `%${query.trim()}%`);
        }

        const { data, error } = await request;

        if (error || !data) {
            return [];
        }

        return [
            ...new Set(
                data
                    .map((row) => (row as Pick<VehicleRow, "model">).model)
                    .filter((model): model is string => Boolean(model))
            ),
        ].slice(0, limit);
    }

    async searchTrims(
        year: number,
        make: string,
        model: string,
        query = "",
        limit = 20
    ): Promise<string[]> {
        let request = this.client
            .from(TABLE_NAME)
            .select("trim")
            .eq("year", year)
            .ilike("make", make)
            .ilike("model", model)
            .not("trim", "is", null)
            .order("trim", { ascending: true })
            .limit(500);

        if (query.trim()) {
            request = request.ilike("trim", `%${query.trim()}%`);
        }

        const { data, error } = await request;

        if (error || !data) {
            return [];
        }

        return [
            ...new Set(
                data
                    .map((row) => (row as Pick<VehicleRow, "trim">).trim)
                    .filter((trim): trim is string => Boolean(trim))
            ),
        ].slice(0, limit);
    }

    async findVehicleBySelection({
        year,
        make,
        model,
        trim,
    }: {
        year: number;
        make: string;
        model: string;
        trim?: string;
    }): Promise<Vehicle | null> {
        let request = this.client
            .from(TABLE_NAME)
            .select("*")
            .eq("year", year)
            .ilike("make", make)
            .ilike("model", model)
            .order("trim", { ascending: true })
            .limit(1);

        if (trim?.trim()) {
            request = request.ilike("trim", trim.trim());
        }

        const { data, error } = await request;

        if (error || !data || data.length === 0) {
            return null;
        }

        return mapRowToVehicle(data[0] as VehicleRow);
    }

    async getAllVehicles(): Promise<Vehicle[]> {
        const { data, error } = await this.client
            .from(TABLE_NAME)
            .select("*")
            .order("vehicle_id", { ascending: true });

        if (error || !data) {
            return [];
        }

        return data.map((row) => mapRowToVehicle(row as VehicleRow));
    }

    async getVehicleById(id: number): Promise<Vehicle | null> {
        const { data, error } = await this.client
            .from(TABLE_NAME)
            .select("*")
            .eq("vehicle_id", id)
            .maybeSingle();

        if (error || !data) {
            return null;
        }

        return mapRowToVehicle(data as VehicleRow);
    }

    async insertVehicle(vehicle: Vehicle): Promise<string | null> {
        const { data, error } = await this.client
            .from(TABLE_NAME)
            .insert(mapVehicleToRow(vehicle))
            .select("*")
            .single();

        if (error) {
            return error.message;
        }

        if (data) {
            vehicle.vehicleID = (data as VehicleRow).vehicle_id;
        }

        return null;
    }

    async updateVehicle(vehicle: Vehicle): Promise<string | null> {
        const existingVehicle = await this.getVehicleById(vehicle.vehicleID);

        if (!existingVehicle) {
            return "Vehicle not found.";
        }

        const { error } = await this.client
            .from(TABLE_NAME)
            .update(mapVehicleToRow(vehicle))
            .eq("vehicle_id", vehicle.vehicleID);

        return error?.message ?? null;
    }

    async deleteVehicle(id: number): Promise<string | null> {
        const existingVehicle = await this.getVehicleById(id);

        if (!existingVehicle) {
            return "Vehicle not found.";
        }

        const { error } = await this.client
            .from(TABLE_NAME)
            .delete()
            .eq("vehicle_id", id);

        return error?.message ?? null;
    }
}
