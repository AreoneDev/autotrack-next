import { Event } from "./Event";
import { Lead } from "./Lead";
import type { ContactDetails } from "./ContactRecord";

export class Notification extends Event {
    constructor(
        lead: Lead | null,
        title: string,
        date: Date,
        id: number = -1,
        private readonly contactDetails: ContactDetails | null = null
    ) {
        super(lead, title, date);
        this.setEventID(id);
    }

    getLeadID(): number {
        return this.lead ? this.lead.leadID : 0;
    }

    getContactDetails(): ContactDetails | null {
        return this.contactDetails ? { ...this.contactDetails } : null;
    }
}
