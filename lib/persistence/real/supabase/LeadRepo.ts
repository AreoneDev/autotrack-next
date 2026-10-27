import { Lead } from "@/domain/objects/Lead";
import { supabase } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

type LeadRow = {
    lead_id: number;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    lead_email: string | null;
    lead_division: string | null;
    lead_address: string | null;
    lead_city: string | null;
    lead_province: string | null;
    lead_country: string | null;
    lead_postal_code: string | null;
    budget: number | null;
    stage: string | null;
    follow_up_date: string | null;
    score: number | null;
    notes: string | null;
    created_at: string | null;
    last_interaction_date: string | null;
    last_interaction_by: string | null;
    status: boolean | null;
};

type LeadInsertRow = Omit<LeadRow, "lead_id"> & {
    lead_id?: number;
};

const TABLE_NAME = "leads";

function toDate(value: string | null, fallback = new Date()): Date {
    if (!value) {
        return fallback;
    }

    return new Date(value);
}

function mapRowToLead(row: LeadRow): Lead {
    return new Lead({
        leadID: row.lead_id,
        firstName: row.first_name ?? "",
        lastName: row.last_name ?? "",
        phone: row.phone ?? "",
        leadEmail: row.lead_email ?? "",
        leadDivision: row.lead_division ?? "",
        leadAddress: row.lead_address ?? "",
        leadCity: row.lead_city ?? "",
        leadProvince: row.lead_province ?? "ON",
        leadCountry: row.lead_country ?? "Canada",
        leadPostalCode: row.lead_postal_code ?? "",
        budget: row.budget ?? 0,
        vehicleInterest: null,
        tradeInVehicle: null,
        stage: row.stage ?? "NEW",
        followUpDate: toDate(row.follow_up_date),
        score: row.score ?? 0,
        notes: row.notes ?? "",
        createdAt: toDate(row.created_at),
        lastInteractionDate: row.last_interaction_date
            ? new Date(row.last_interaction_date)
            : null,
        lastInteractionBy: row.last_interaction_by ?? "",
        status: row.status ?? true,
    });
}

function mapLeadToRow(lead: Lead): LeadInsertRow {
    const row: LeadInsertRow = {
        first_name: lead.firstName,
        last_name: lead.lastName,
        phone: lead.phone,
        lead_email: lead.leadEmail,
        lead_division: lead.leadDivision,
        lead_address: lead.leadAddress,
        lead_city: lead.leadCity,
        lead_province: lead.leadProvince,
        lead_country: lead.leadCountry,
        lead_postal_code: lead.leadPostalCode,
        budget: lead.budget,
        stage: lead.stage,
        follow_up_date: lead.followUpDate.toISOString(),
        score: lead.score,
        notes: lead.notes,
        created_at: lead.createdAt.toISOString(),
        last_interaction_date: lead.lastInteractionDate?.toISOString() ?? null,
        last_interaction_by: lead.lastInteractionBy,
        status: lead.status,
    };

    if (lead.leadID !== 0) {
        row.lead_id = lead.leadID;
    }

    return row;
}

export class LeadRepo {
    constructor(private readonly client: SupabaseClient = supabase) {}

    async getAllLeads(): Promise<Lead[]> {
        const { data, error } = await this.client
            .from(TABLE_NAME)
            .select("*")
            .order("lead_id", { ascending: true });

        if (error || !data) {
            return [];
        }

        return data.map((row) => mapRowToLead(row as LeadRow));
    }

    async getLeadById(id: number): Promise<Lead | null> {
        const { data, error } = await this.client
            .from(TABLE_NAME)
            .select("*")
            .eq("lead_id", id)
            .maybeSingle();

        if (error || !data) {
            return null;
        }

        return mapRowToLead(data as LeadRow);
    }

    async searchLeads(query: string, limit = 8): Promise<Lead[]> {
        const searchTerm = query.trim();

        if (!searchTerm) {
            return [];
        }

        const sanitizedTerm = searchTerm.replaceAll(",", " ");
        const pattern = `%${sanitizedTerm}%`;

        const { data, error } = await this.client
            .from(TABLE_NAME)
            .select("*")
            .or(
                [
                    `first_name.ilike.${pattern}`,
                    `last_name.ilike.${pattern}`,
                    `phone.ilike.${pattern}`,
                    `lead_email.ilike.${pattern}`,
                ].join(",")
            )
            .order("last_name", { ascending: true })
            .limit(limit);

        if (error || !data) {
            return [];
        }

        return data.map((row) => mapRowToLead(row as LeadRow));
    }

    async getLeadsByFollowUpDate(targetDate: Date): Promise<Lead[]> {
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(startOfDay);
        endOfDay.setDate(endOfDay.getDate() + 1);

        const { data, error } = await this.client
            .from(TABLE_NAME)
            .select("*")
            .not("follow_up_date", "is", null)
            .gte("follow_up_date", startOfDay.toISOString())
            .lt("follow_up_date", endOfDay.toISOString())
            .order("follow_up_date", { ascending: true });

        if (error || !data) {
            return [];
        }

        return data.map((row) => mapRowToLead(row as LeadRow));
    }

    async insertLead(lead: Lead): Promise<string | null> {
        const { data, error } = await this.client
            .from(TABLE_NAME)
            .insert(mapLeadToRow(lead))
            .select("*")
            .single();

        if (error) {
            return error.message;
        }

        if (data) {
            lead.leadID = (data as LeadRow).lead_id;
        }

        return null;
    }

    async updateLead(lead: Lead): Promise<string | null> {
        const existingLead = await this.getLeadById(lead.leadID);

        if (!existingLead) {
            return "Lead not found.";
        }

        const { error } = await this.client
            .from(TABLE_NAME)
            .update(mapLeadToRow(lead))
            .eq("lead_id", lead.leadID);

        return error?.message ?? null;
    }

    async deleteLead(id: number): Promise<string | null> {
        const existingLead = await this.getLeadById(id);

        if (!existingLead) {
            return "Lead not found.";
        }

        const { error } = await this.client
            .from(TABLE_NAME)
            .delete()
            .eq("lead_id", id);

        return error?.message ?? null;
    }
}
