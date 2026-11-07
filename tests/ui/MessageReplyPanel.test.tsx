/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MessageReplyPanel from "@/components/leads/MessageReplyPanel";
const refresh = jest.fn();
const rpc = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
jest.mock("@/lib/supabase/client", () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

const result = { available: true as const, records: [{
    notification_id: 4, lead_id: 1, title: "Incoming email", date: "2026-11-07T12:00:00Z",
    contact_direction: "inbound", replied_at: null,
}] };

beforeEach(() => { rpc.mockReset(); refresh.mockReset(); });

it("shows unavailable separately from an empty inbox", () => {
    render(<MessageReplyPanel result={{ available: false, records: [] }} referenceTime="2026-11-07T16:00:00Z" />);
    expect(screen.getByRole("status")).toHaveTextContent("unavailable");
    expect(screen.queryByText("No recorded incoming contacts.")).not.toBeInTheDocument();
});

it("preserves pending status on failure and refreshes only after successful retry", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "failed" } }).mockResolvedValueOnce({ error: null });
    render(<MessageReplyPanel result={result} referenceTime="2026-11-07T16:00:00Z" />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as replied" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("retry");
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText(/Awaiting reply: 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark as replied" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenLastCalledWith("mark_notification_replied", { p_notification_id: 4 });
});

