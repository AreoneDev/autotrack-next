import type { SupabaseClient } from "@supabase/supabase-js";
import { CustomerDataRepo } from "@/lib/data/CustomerDataRepo";
import { exportTables } from "@/lib/data/csv";

jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));
const recoveryId = "11111111-1111-4111-8111-111111111111";

describe("Customer data repository", () => {
    it("uses only the restore RPC and validates IDs", async () => {
        const rpc = jest.fn().mockResolvedValue({ data: "7", error: null });
        const repo = new CustomerDataRepo({ rpc } as unknown as SupabaseClient);
        expect(await repo.restore(recoveryId)).toBe("7");
        expect(rpc).toHaveBeenCalledWith("autotrack_restore_lead", { p_recovery_id: recoveryId });
        await expect(repo.restore("bad)id")).rejects.toThrow("Invalid recovery selection");
        expect(rpc).toHaveBeenCalledTimes(1);
        rpc.mockResolvedValue({ data: "9007199254740993", error: null });
        expect(await repo.restore(recoveryId)).toBe("9007199254740993");
    });
    it("surfaces RPC and incomplete export failures", async () => {
        const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: "denied" } });
        const repo = new CustomerDataRepo({ rpc } as unknown as SupabaseClient);
        await expect(repo.restore(recoveryId)).rejects.toThrow("Unable to restore");
        await expect(repo.exportData()).rejects.toThrow("No file was downloaded");
        rpc.mockResolvedValue({ data: { format_version: 1, exported_at: "today", leads: [] }, error: null });
        await expect(repo.exportData()).rejects.toThrow("No file was downloaded");
    });
    it("fetches the complete consistent export in one call", async () => {
        const data = { format_version: 1, exported_at: "2026-11-07", ...Object.fromEntries(exportTables.map(t => [t, []])) };
        const rpc = jest.fn().mockResolvedValue({ data, error: null });
        expect(await new CustomerDataRepo({ rpc } as unknown as SupabaseClient).exportData()).toEqual(data);
        expect(rpc).toHaveBeenCalledWith("autotrack_export_data");
        expect(rpc).toHaveBeenCalledTimes(1);
    });
    it("pages the recycle bin and rejects a failed later page", async () => {
        let page = 0;
        const result = { data: Array.from({ length: 100 }, () => ({ recovery_id: recoveryId, lead_id: "7", deleted_at: "2026-11-07", snapshot: { lead: {}, tasks: [], notifications: [] } })), error: null };
        const range = jest.fn().mockImplementation(() => Promise.resolve(page++ === 0 ? result : { data: [], error: null }));
        const chain = { select: jest.fn(), is: jest.fn(), order: jest.fn(), range };
        chain.select.mockReturnValue(chain); chain.is.mockReturnValue(chain); chain.order.mockReturnValue(chain);
        const from = jest.fn().mockReturnValue(chain);
        const repo = new CustomerDataRepo({ from } as unknown as SupabaseClient);
        expect(await repo.listDeleted()).toHaveLength(100);
        expect(range.mock.calls).toEqual([[0, 99], [100, 199]]);
        expect(chain.is).toHaveBeenCalledWith("restored_at", null);
        range.mockResolvedValue({ data: null, error: { message: "offline" } });
        await expect(repo.listDeleted()).rejects.toThrow("Unable to load deleted customers");
    });
});
