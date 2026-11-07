import { Vehicle } from "./Vehicle";
import { getLeadOutcome } from "./LeadOutcome";

export class Lead {

    leadID: number;
    version: number | null;
    firstName: string;
    lastName: string;
    phone: string;
    leadEmail: string;
    leadDivision: string;
    leadAddress: string;
    leadCity: string;
    leadProvince: string;
    leadCountry: string;
    leadPostalCode: string;

    budget: number;

    vehicleInterest: Vehicle | null;
    tradeInVehicle: Vehicle | null;

    stage: string;
    followUpDate: Date;

    score: number;
    notes: string;

    createdAt: Date;
    lastInteractionDate: Date | null;
    lastInteractionBy: string;

    status: boolean;

    constructor({
                    leadID = 0,
                    version = null,
                    firstName = "",
                    lastName = "",
                    phone = "",
                    leadEmail = "",
                    leadDivision = "",
                    leadAddress = "",
                    leadCity = "",
                    leadProvince = "ON",
                    leadCountry = "Canada",
                    leadPostalCode = "",
                    budget = 0,
                    vehicleInterest = null,
                    tradeInVehicle = null,
                    stage = "NEW",
                    followUpDate = new Date(),
                    score = 0,
                    notes = "",
                    createdAt = new Date(),
                    lastInteractionDate = null,
                    lastInteractionBy = "",
                    status = true,
                }: {
        leadID?: number;
        version?: number | null;
        firstName?: string;
        lastName?: string;
        phone?: string;
        leadEmail?: string;
        leadDivision?: string;
        leadAddress?: string;
        leadCity?: string;
        leadProvince?: string;
        leadCountry?: string;
        leadPostalCode?: string;
        budget?: number;
        vehicleInterest?: Vehicle | null;
        tradeInVehicle?: Vehicle | null;
        stage?: string;
        followUpDate?: Date;
        score?: number;
        notes?: string;
        createdAt?: Date;
        lastInteractionDate?: Date | null;
        lastInteractionBy?: string;
        status?: boolean;
    } = {}) {

        const isFirstEmpty =
            firstName === null ||
            firstName.trim() === "";

        const isLastEmpty =
            lastName === null ||
            lastName.trim() === "";

        if (isFirstEmpty && isLastEmpty) {
            throw new Error(
                "Lead must have at least a First Name or a Last Name."
            );
        }

        this.leadID = leadID;
        this.version = version;

        this.firstName =
            isFirstEmpty ? "" : firstName.trim();

        this.lastName =
            isLastEmpty ? "" : lastName.trim();

        this.phone = phone;
        this.leadEmail = leadEmail;

        this.leadDivision = leadDivision;
        this.leadAddress = leadAddress;
        this.leadCity = leadCity;
        this.leadProvince = leadProvince;
        this.leadCountry = leadCountry;
        this.leadPostalCode = leadPostalCode;

        this.budget = budget;

        this.vehicleInterest = vehicleInterest;
        this.tradeInVehicle = tradeInVehicle;

        this.stage = stage;
        this.followUpDate = followUpDate;

        this.score = score;
        this.notes = notes;

        this.createdAt = createdAt;
        this.lastInteractionDate = lastInteractionDate;
        this.lastInteractionBy = lastInteractionBy;

        this.status = status;
    }

    getLeadName(): string {
        return `${this.firstName} ${this.lastName}`.trim();
    }

    setLeadName(fullName: string): void {

        if (!fullName || fullName.trim() === "") {
            this.firstName = "";
            this.lastName = "";
            return;
        }

        const trimmedName = fullName.trim();
        const firstSpaceIndex = trimmedName.indexOf(" ");

        if (firstSpaceIndex === -1) {
            this.firstName = trimmedName;
            this.lastName = "";
        } else {
            this.firstName =
                trimmedName.substring(0, firstSpaceIndex).trim();

            this.lastName =
                trimmedName.substring(firstSpaceIndex + 1).trim();
        }
    }

    isActive(): boolean {
        return getLeadOutcome(this) === "ACTIVE";
    }

    isClosed(): boolean {
        return !this.isActive();
    }

    updateScore(score: number): void {
        this.score = score;
    }

    updateFollowUpDate(date: Date): void {
        this.followUpDate = date;
    }

    recordInteraction(
        interactionDate: Date,
        interactionBy: string
    ): void {

        this.lastInteractionDate = interactionDate;
        this.lastInteractionBy = interactionBy;
    }

    equals(otherLead: Lead): boolean {
        return this.leadID === otherLead.leadID;
    }

    toString(): string {

        const interest =
            this.vehicleInterest
                ? this.vehicleInterest.toString()
                : "None";

        const tradeIn =
            this.tradeInVehicle
                ? this.tradeInVehicle.toString()
                : "None";

        return (
            `Lead{id=${this.leadID}, ` +
            `name='${this.getLeadName()}', ` +
            `interest='${interest}', ` +
            `tradeIn='${tradeIn}', ` +
            `score=${this.score}}`
        );
    }
}
