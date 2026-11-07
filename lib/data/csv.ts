export const exportTables = [
    "leads", "tasks", "notifications", "lead_vehicle_interests", "lead_trade_in_vehicles",
    "vehicles", "recovery_snapshots", "sync_deleted",
] as const;
export type ExportTable = typeof exportTables[number];
export type DataExport = { format_version: 1; exported_at: string } & Record<ExportTable, Record<string, unknown>[]>;

/** RFC 4180 quoting plus spreadsheet formula neutralization, including leading controls. */
export function csvCell(value: unknown): string {
    let text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
}

/** One record per row; record_type identifies each table and IDs preserve joins.
 * Raw fields preserve nulls/dates/legacy values without domain-model defaults.
 * Nested recovery snapshots are JSON cells. This is a portable export, not import input.
 */
export function exportToCsv(data: DataExport): string {
    const fields = new Set<string>(["lead_id"]);
    for (const table of exportTables) for (const row of data[table]) {
        for (const key of Object.keys(row)) fields.add(key);
    }
    const columns = [...fields].sort();
    const rows = [["record_type", "export_format_version", "exported_at", ...columns].map(csvCell).join(",")];
    rows.push(["export_metadata", data.format_version, data.exported_at, ...columns.map(() => null)].map(csvCell).join(","));
    for (const table of exportTables) for (const row of data[table]) {
        rows.push([table, data.format_version, data.exported_at, ...columns.map(key => row[key])].map(csvCell).join(","));
    }
    // BOM makes UTF-8 names readable in spreadsheet applications.
    return "\uFEFF" + rows.join("\r\n") + "\r\n";
}
