export type LeadOutcome = "ACTIVE" | "LOST" | "DELIVERED" | "CLOSED";

export type LeadState = { stage: string; status: boolean };

export const leadOutcomeLabels: Record<LeadOutcome, string> = {
    ACTIVE: "Active",
    LOST: "Lost",
    DELIVERED: "Delivered",
    CLOSED: "Closed (outcome unconfirmed)",
};

export function normalizeLeadStage(stage: string): string {
    return stage.trim().toUpperCase();
}

// A legacy boolean cannot override an explicit terminal stage. Generic closure
// is not evidence of a sale or a loss; keep that outcome unconfirmed.
export function getLeadOutcome(lead: LeadState): LeadOutcome {
    const stage = normalizeLeadStage(lead.stage);
    if (stage === "DELIVERED" || stage === "CLOSED") {
        return stage;
    }
    return lead.status ? "ACTIVE" : "LOST";
}

export function isTerminalLeadStage(stage: string): boolean {
    const normalizedStage = normalizeLeadStage(stage);
    return normalizedStage === "DELIVERED" || normalizedStage === "CLOSED";
}

// Apply only on an explicit edit/write. Reading a legacy record never rewrites it.
export function leadStateForWrite(lead: LeadState): LeadState {
    return {
        stage: normalizeLeadStage(lead.stage),
        status: getLeadOutcome(lead) === "ACTIVE",
    };
}

export function leadStateAfterStageChange(lead: LeadState, stage: string): LeadState {
    return leadStateForWrite({
        stage,
        // Choosing an open stage explicitly reopens a previously terminal lead.
        status: isTerminalLeadStage(lead.stage) ? true : lead.status,
    });
}
