/** @jest-environment jsdom */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ContactHistoryPanel, { contactTimeToISO } from "@/components/leads/ContactHistoryPanel";
import { ContactHistoryRepo } from "@/lib/persistence/real/supabase/ContactHistoryRepo";
import type { ContactRecord } from "@/domain/objects/ContactRecord";

jest.mock("@/lib/persistence/real/supabase/ContactHistoryRepo");
jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));
// Base UI's focus/portal transitions can exceed Jest's 5s default during concurrent builds.
jest.setTimeout(15000);
const record: ContactRecord = { notificationID: 9, leadID: 7, title: "Received email", occurredAt: "2026-01-01T15:00:00Z",
    details: { direction: "inbound", channel: "email", outcome: "received", notes: "Customer requested a quote.", nextFollowUpAt: "2026-01-02T15:00:00Z" } };
let getPage: jest.Mock, save: jest.Mock;
beforeEach(() => {
    getPage = jest.fn().mockResolvedValue({ records: [], hasMore: false });
    save = jest.fn().mockResolvedValue(record);
    jest.mocked(ContactHistoryRepo).mockImplementation(() => ({ getPage, record: save }) as unknown as ContactHistoryRepo);
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: jest.fn().mockReturnValue("11111111-1111-4111-8111-111111111111") });
});

describe("Contact history UI", () => {
    it("displays actual contact fields while leaving legacy direction unknown", async () => {
        getPage.mockResolvedValue({ records: [record, { notificationID: 1, leadID: 7, title: "You called Ada", occurredAt: null, details: null }], hasMore: false });
        render(<ContactHistoryPanel leadID={7} />);
        expect(await screen.findByText("Incoming · Email · Received")).toBeVisible();
        expect(screen.getByText(record.details!.notes)).toBeVisible();
        expect(screen.getByText(/Next follow-up:/)).toBeVisible();
        expect(screen.getByText(/Legacy notification · Direction/)).toBeVisible();
        expect(screen.getByText("Time unknown")).toBeVisible();
        expect(screen.getByText(/Inbox messages are not imported/)).toBeVisible();
    });
    it("distinguishes a failed read from an empty history and supports retry", async () => {
        getPage.mockRejectedValueOnce(new Error("Offline")).mockResolvedValue({ records: [record], hasMore: false });
        const user = userEvent.setup(); render(<ContactHistoryPanel leadID={7} />);
        expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
        expect(screen.queryByText("No contact history for this lead.")).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Retry history" }));
        expect(await screen.findByText("Incoming · Email · Received")).toBeVisible();
    });
    it("preserves draft and idempotency key after save failure, then refreshes after confirmation", async () => {
        save.mockRejectedValueOnce(new Error("Connection interrupted")).mockResolvedValue(record);
        const onSaved = jest.fn(); const user = userEvent.setup();
        render(<ContactHistoryPanel leadID={7} onSaved={onSaved} />);
        await screen.findByText("No contact history for this lead.");
        await user.click(screen.getByRole("button", { name: "Log contact" }));
        screen.getByRole("combobox", { name: "Contact direction" }).focus();
        await user.keyboard("{ArrowDown}");
        await user.click(await screen.findByRole("option", { name: "Incoming" }));
        await user.type(screen.getByRole("textbox", { name: "Contact notes" }), "Quote requested");
        await user.click(screen.getByRole("button", { name: "Save contact" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
        expect(screen.getByRole("textbox", { name: "Contact notes" })).toHaveValue("Quote requested");
        await user.click(screen.getByRole("button", { name: "Save contact" }));
        await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
        expect(save).toHaveBeenCalledTimes(2);
        expect(save.mock.calls[0][0]).toEqual(save.mock.calls[1][0]);
        expect(save.mock.calls[0][0]).toMatchObject({ direction: "inbound", outcome: "received", notes: "Quote requested", nextFollowUpAt: null });
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(screen.getByText("Contact recorded.")).toBeVisible();
    });
    it("canceling does not write and a history refresh error after saving does not invite a second save", async () => {
        const user = userEvent.setup(); render(<ContactHistoryPanel leadID={7} />);
        await screen.findByText("No contact history for this lead.");
        await user.click(screen.getByRole("button", { name: "Log contact" }));
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        expect(save).not.toHaveBeenCalled();
        await user.click(screen.getByRole("button", { name: "Log contact" }));
        getPage.mockRejectedValueOnce(new Error("Reload offline"));
        await user.click(screen.getByRole("button", { name: "Save contact" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("Reload offline");
        expect(screen.getByText("Contact recorded.")).toBeVisible();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(save).toHaveBeenCalledTimes(1);
    });
    it("loads older contacts without duplicating already displayed records", async () => {
        getPage.mockResolvedValueOnce({ records: [record], hasMore: true })
            .mockResolvedValueOnce({ records: [record, { ...record, notificationID: 10 }], hasMore: false });
        const user = userEvent.setup(); render(<ContactHistoryPanel leadID={7} />);
        await user.click(await screen.findByRole("button", { name: "Load older contacts" }));
        await waitFor(() => expect(getPage).toHaveBeenLastCalledWith(7, 1));
        expect(within(screen.getByRole("list", { name: "Contact timeline" })).getAllByRole("listitem")).toHaveLength(2);
    });
    it("ignores a late history response for an earlier lead", async () => {
        let resolve!: (value: unknown) => void;
        getPage.mockReturnValueOnce(new Promise(done => { resolve = done; }));
        const view = render(<ContactHistoryPanel leadID={7} />);
        view.rerender(<ContactHistoryPanel leadID={8} />);
        await screen.findByText("No contact history for this lead.");
        await act(async () => resolve({ records: [record], hasMore: false }));
        expect(screen.queryByText(record.details!.notes)).not.toBeInTheDocument();
    });
    it("rejects invalid calendar dates and spring DST gaps; converts local time to an exact instant", () => {
        expect(() => contactTimeToISO("2026-02-30", "12:00")).toThrow("does not exist");
        expect(() => contactTimeToISO("2026-03-08", "02:30")).toThrow("does not exist");
        expect(contactTimeToISO("2026-01-01", "10:00")).toBe("2026-01-01T15:00:00.000Z");
    });
});
