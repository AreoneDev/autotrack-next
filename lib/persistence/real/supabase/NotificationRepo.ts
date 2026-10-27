import { Lead } from "@/domain/objects/Lead";
import { Notification } from "@/domain/objects/Notification";
import { supabase } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

type NotificationRow = {
    notification_id: number;
    lead_id: number | null;
    title: string | null;
    date: string | null;
};

type NotificationInsertRow = Omit<NotificationRow, "notification_id"> & {
    notification_id?: number;
};

const TABLE_NAME = "notifications";

function createLeadReference(leadId: number | null): Lead | null {
    if (!leadId) {
        return null;
    }

    return new Lead({
        leadID: leadId,
        firstName: `Lead ${leadId}`,
    });
}

function mapRowToNotification(row: NotificationRow): Notification {
    return new Notification(
        createLeadReference(row.lead_id),
        row.title ?? "",
        row.date ? new Date(row.date) : new Date(),
        row.notification_id
    );
}

function mapNotificationToRow(
    notification: Notification
): NotificationInsertRow {
    const row: NotificationInsertRow = {
        lead_id: notification.getLead()?.leadID ?? null,
        title: notification.getTitle(),
        date: notification.getDate().toISOString(),
    };

    if (notification.getEventID() !== -1) {
        row.notification_id = notification.getEventID();
    }

    return row;
}

export class NotificationRepo {
    constructor(private readonly client: SupabaseClient = supabase) {}

    async getAllNotifications(): Promise<Notification[]> {
        const { data, error } = await this.client
            .from(TABLE_NAME)
            .select("*")
            .order("date", { ascending: false });

        if (error || !data) {
            return [];
        }

        return data.map((row) => mapRowToNotification(row as NotificationRow));
    }

    async getNotificationById(id: number): Promise<Notification | null> {
        const { data, error } = await this.client
            .from(TABLE_NAME)
            .select("*")
            .eq("notification_id", id)
            .maybeSingle();

        if (error || !data) {
            return null;
        }

        return mapRowToNotification(data as NotificationRow);
    }

    async getNotificationsByLeadId(leadId: number): Promise<Notification[]> {
        const { data, error } = await this.client
            .from(TABLE_NAME)
            .select("*")
            .eq("lead_id", leadId)
            .order("date", { ascending: false });

        if (error || !data) {
            return [];
        }

        return data.map((row) => mapRowToNotification(row as NotificationRow));
    }

    async insertNotification(
        notification: Notification
    ): Promise<string | null> {
        const { data, error } = await this.client
            .from(TABLE_NAME)
            .insert(mapNotificationToRow(notification))
            .select("*")
            .single();

        if (error) {
            return error.message;
        }

        if (data) {
            notification.setEventID((data as NotificationRow).notification_id);
        }

        return null;
    }

    async updateNotification(
        notification: Notification
    ): Promise<string | null> {
        const existingNotification = await this.getNotificationById(
            notification.getEventID()
        );

        if (!existingNotification) {
            return "Notification not found.";
        }

        const { error } = await this.client
            .from(TABLE_NAME)
            .update(mapNotificationToRow(notification))
            .eq("notification_id", notification.getEventID());

        return error?.message ?? null;
    }

    async deleteNotification(id: number): Promise<string | null> {
        const existingNotification = await this.getNotificationById(id);

        if (!existingNotification) {
            return "Notification not found.";
        }

        const { error } = await this.client
            .from(TABLE_NAME)
            .delete()
            .eq("notification_id", id);

        return error?.message ?? null;
    }
}
