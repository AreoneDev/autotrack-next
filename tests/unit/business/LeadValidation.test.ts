import { normalizeEmail, normalizePhone, validateLeadContact } from "@/domain/business/LeadValidation";
const valid = { phone: "", leadEmail: "", budget: "" };
describe("lead contact validation", () => {
    it("normalizes email without rewriting provider-specific identifiers", () => {
        expect(normalizeEmail("  Ada.Chen+Cars@Example.TEST ")).toBe("ada.chen+cars@example.test");
    });
    it.each([
        ["(416) 555-0100", "+14165550100"], ["1-416-555-0100", "+14165550100"],
        ["+44 20 7946 0958", "+442079460958"], ["0044 20 7946 0958", "+442079460958"],
        ["", ""], ["  ", ""],
    ])("normalizes %s", (input, expected) => expect(normalizePhone(input)).toBe(expected));
    it.each(["123", "5550100", "4165550100 ext 9", "+1 555", "++442079460958", "+0123456789", "call 4165550100", "+4412345678901234"])("blocks invalid phone %s", (phone) => {
        expect(validateLeadContact({ ...valid, phone }).errors.phone).toBeTruthy();
    });
    it.each(["no-at-sign", "a@b", "a b@example.test", "a@@example.test", "a@example..test"])("blocks invalid email %s", (leadEmail) => {
        expect(validateLeadContact({ ...valid, leadEmail }).errors.leadEmail).toBeTruthy();
    });
    it.each(["-1", "NaN", "Infinity", "1e3", "bad", "12.345", NaN, Infinity, -1])("blocks invalid budget %s", (budget) => {
        expect(validateLeadContact({ ...valid, budget }).errors.budget).toBeTruthy();
    });
    it.each([["", 0], ["0", 0], ["42000.25", 42000.25], [".50", 0.5]])("accepts budget %s", (budget, expected) => {
        const result = validateLeadContact({ ...valid, budget });
        expect(result.errors).toEqual({});
        expect(result.values.budget).toBe(expected);
    });
    it("keeps unchanged invalid historical fields, while validating each changed field", () => {
        const previous = { phone: "extension 2", leadEmail: "unknown", budget: -7 };
        expect(validateLeadContact(previous, previous)).toEqual({ errors: {}, values: previous });
        expect(validateLeadContact({ ...previous, leadEmail: "new-invalid" }, previous).errors).toEqual({
            leadEmail: expect.any(String),
        });
        expect(validateLeadContact({ ...previous, phone: "", leadEmail: "", budget: 0 }, previous).errors).toEqual({});
    });
});
