/** @jest-environment jsdom */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CustomerDataPage from "@/app/data/page";
import { CustomerDataRepo } from "@/lib/data/CustomerDataRepo";
import { exportTables } from "@/lib/data/csv";

jest.mock("@/lib/data/CustomerDataRepo");
let authChanged: () => void;
jest.mock("@/lib/supabase/client", () => ({ supabase: { auth: { onAuthStateChange: jest.fn((callback: () => void) => {
    authChanged = callback; return { data: { subscription: { unsubscribe: jest.fn() } } };
}) } } }));
const entry = { recovery_id: "11111111-1111-4111-8111-111111111111", lead_id: 7, deleted_at: "2026-11-07T00:00:00Z",
    snapshot: { lead: { first_name: "<script>恢复</script>", last_name: null }, tasks: [1], notifications: [] } };
const list = jest.fn(); const restore = jest.fn(); const exportData = jest.fn();
beforeEach(() => {
    list.mockReset().mockResolvedValue([entry]); restore.mockReset().mockResolvedValue("7"); exportData.mockReset();
    jest.mocked(CustomerDataRepo).mockImplementation(() => ({ listDeleted: list, restore, exportData }) as unknown as CustomerDataRepo);
    URL.createObjectURL = jest.fn().mockReturnValue("blob:synthetic"); URL.revokeObjectURL = jest.fn();
});

it("requires explicit restore, preserves text safety and links to the restored customer", async () => {
    render(<CustomerDataPage />);
    expect(await screen.findByText("<script>恢复</script>")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Restore customer #7" }));
    expect(restore).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Confirm restore" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore customer #7" }));
    await user.click(screen.getByRole("button", { name: "Confirm restore" }));
    expect(restore).toHaveBeenCalledWith(entry.recovery_id);
    expect(await screen.findByRole("link", { name: "View restored customer" })).toHaveAttribute("href", "/leads/7");
    expect(screen.getByText("No deleted customers to restore.")).toBeInTheDocument();
});
it("keeps a failed restore available for retry", async () => {
    restore.mockRejectedValue(new Error("Restore failed. Retry."));
    render(<CustomerDataPage />); const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Restore customer #7" }));
    await user.click(screen.getByRole("button", { name: "Confirm restore" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Restore failed");
    expect(screen.getByRole("button", { name: "Confirm restore" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Restore customer #7" })).toBeInTheDocument();
});
it("shows a list failure and allows retry without claiming an empty bin", async () => {
    list.mockRejectedValueOnce(new Error("offline"));
    render(<CustomerDataPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load");
    expect(screen.queryByText("No deleted customers to restore.")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh deleted customers" }));
    expect(await screen.findByRole("button", { name: "Restore customer #7" })).toBeInTheDocument();
});
it("does not create a partial CSV after an export failure", async () => {
    exportData.mockRejectedValue(new Error("No file was downloaded."));
    render(<CustomerDataPage />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Download CSV" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No file was downloaded");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it("discards an export after an account change", async () => {
    let resolve!: (value: unknown) => void;
    exportData.mockReturnValue(new Promise(done => { resolve = done; }));
    render(<CustomerDataPage />);
    await screen.findByRole("button", { name: "Restore customer #7" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Download CSV" }));
    act(() => { authChanged(); });
    await act(async () => {
        resolve({ format_version: 1, exported_at: "2026-11-07", ...Object.fromEntries(exportTables.map(t => [t, []])) });
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Download CSV" })).toBeEnabled());
    expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it("downloads a complete CSV with a predictable safe filename", async () => {
    exportData.mockResolvedValue({ format_version: 1, exported_at: "2026-11-07T12:00:00Z",
        ...Object.fromEntries(exportTables.map(table => [table, []])) });
    let filename = "";
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function(this: HTMLAnchorElement) {
        filename = this.download;
    });
    render(<CustomerDataPage />);
    await screen.findByRole("button", { name: "Restore customer #7" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Download CSV" }));
    expect(await screen.findByRole("status")).toHaveTextContent("CSV export downloaded");
    expect(filename).toBe("autotrack-data-2026-11-07.csv");
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect((URL.createObjectURL as jest.Mock).mock.calls[0][0].type).toBe("text/csv;charset=utf-8");
    expect(document.querySelector('a[download]')).toBeNull();
    click.mockRestore();
});
