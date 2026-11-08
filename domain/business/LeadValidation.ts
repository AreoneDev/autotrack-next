export type LeadContactInput = { leadEmail: string; phone: string; budget: string | number };
export type LeadFieldErrors = Partial<Record<keyof LeadContactInput, string>>;

export function normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
}

// Canadian/US local numbers use +1. International numbers require + or 00.
// Extensions are deliberately rejected rather than silently discarded.
export function normalizePhone(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (!/^[+\d\s().-]+$/.test(trimmed)) return null;
    let compact = trimmed.replace(/[\s().-]/g, "");
    if (compact.startsWith("00")) compact = "+" + compact.slice(2);
    if (/^\d{10}$/.test(compact)) compact = "+1" + compact;
    else if (/^1\d{10}$/.test(compact)) compact = "+" + compact;
    if (!/^\+[1-9]\d{7,14}$/.test(compact)) return null;
    if (compact.startsWith("+1") && compact.length !== 12) return null;
    return compact;
}

export function validateLeadContact(input: LeadContactInput, previous?: LeadContactInput) {
    const errors: LeadFieldErrors = {};
    const emailChanged = !previous || input.leadEmail !== previous.leadEmail;
    const phoneChanged = !previous || input.phone !== previous.phone;
    const budgetChanged = !previous || !Object.is(input.budget, previous.budget);
    const leadEmail = emailChanged ? normalizeEmail(input.leadEmail) : input.leadEmail;
    const normalizedPhone = phoneChanged ? normalizePhone(input.phone) : input.phone;
    const budgetText = String(input.budget).trim();
    const budget = budgetChanged ? (budgetText === "" ? 0 : Number(budgetText)) : Number(input.budget);
    if (emailChanged && leadEmail && (leadEmail.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(leadEmail))) {
        errors.leadEmail = "Enter a valid email address, or leave it blank.";
    }
    if (phoneChanged && normalizedPhone === null) {
        errors.phone = "Enter a 10-digit Canadian/US phone number or an international number starting with + (8–15 digits). Extensions are not supported.";
    }
    if (budgetChanged && (!Number.isFinite(budget) || budget < 0 || budget > Number.MAX_SAFE_INTEGER
        || (budgetText !== "" && !/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(budgetText)))) {
        errors.budget = "Enter a non-negative budget with at most two decimal places, or leave it blank for 0.";
    }
    return { errors, values: { leadEmail, phone: normalizedPhone ?? input.phone, budget } };
}

export interface DuplicateLeadMatch {
    leadID: number;
    name: string;
    email: boolean;
    phone: boolean;
}

export class DuplicateLeadError extends Error {
    constructor(public readonly matches: DuplicateLeadMatch[]) {
        super("Possible duplicate customers found. Review them before saving.");
        this.name = "DuplicateLeadError";
    }
}
