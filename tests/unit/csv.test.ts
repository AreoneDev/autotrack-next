import { csvCell, exportToCsv, exportTables, type DataExport } from "@/lib/data/csv";

describe("CSV safety and legacy compatibility", () => {
    it.each(["=1+1", "+SUM(A1)", "-1+2", "@SUM(A1)", " \t=1", "\u0000+1", "\tplain", "\rplain", "\nplain"])("neutralizes %j", value => {
        expect(csvCell(value)).toBe(`"'${value}"`);
    });
    it("quotes delimiters, newlines and quotes; preserves nulls, Unicode and raw dates", () => {
        expect(csvCell('恢复,café "🚗"\r\nsecond')).toBe('"恢复,café ""🚗""\r\nsecond"');
        expect(csvCell(null)).toBe('""');
        expect(csvCell("2020-01-01T00:00:00Z")).toBe('"2020-01-01T00:00:00Z"');
    });
    it("includes typed linked records, archive JSON, BOM and CRLF without domain defaults", () => {
        const data = { format_version: 1, exported_at: "2026-11-07T00:00:00Z",
            ...Object.fromEntries(exportTables.map(table => [table, []])),
            leads: [{ lead_id: 4, first_name: "=HYPERLINK(1)", follow_up_date: null }],
            tasks: [{ lead_id: 4, task_id: 9, completed: true }],
            recovery_snapshots: [{ snapshot: { lead: { notes: "恢复 🚗" } } }],
        } as unknown as DataExport;
        const csv = exportToCsv(data);
        expect(csv.startsWith('\uFEFF"record_type"')).toBe(true);
        expect(csv).toContain('"leads"');
        expect(csv).toContain('"tasks"');
        expect(csv).toContain("'=HYPERLINK(1)");
        expect(csv).toContain('""notes"":""恢复 🚗""');
        expect(csv.endsWith("\r\n")).toBe(true);
        expect(csv).not.toContain("Invalid Date");
    });
});
