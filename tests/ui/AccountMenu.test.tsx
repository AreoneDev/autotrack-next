/** @jest-environment jsdom */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetAuth, router, supabase } from "@/tests/helpers/auth";
import { deferred } from "@/tests/helpers/deferred";
import AccountMenu from "@/components/auth/AccountMenu";

jest.mock("@/lib/supabase/client", () => jest.requireActual("@/tests/helpers/auth"));
jest.mock("next/navigation", () => ({ useRouter: () => jest.requireActual("@/tests/helpers/auth").router }));

describe("UI-ACCOUNT — sign-out transitions", () => {
    beforeEach(() => resetAuth());

    it("UI-ACCOUNT-01: shows current identity, updates on auth changes, and unsubscribes", async () => {
        const { unsubscribe } = resetAuth();
        supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { email: "ada@example.test" } } } });
        const { unmount } = render(<AccountMenu />);
        expect(await screen.findByText("ada@example.test")).toBeInTheDocument();
        act(() => supabase.auth.onAuthStateChange.mock.calls[0][0]("SIGNED_OUT", null));
        expect(screen.getByText("AutoTrack account")).toBeInTheDocument();
        unmount();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it("UI-ACCOUNT-02: local sign-out prevents duplicates, then redirects and refreshes", async () => {
        const request = deferred<{ error: null }>();
        supabase.auth.signOut.mockReturnValue(request.promise);
        render(<AccountMenu />);
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: "Sign out" }));
        expect(screen.getByRole("button", { name: "Signing out…" })).toBeDisabled();
        expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
        await act(async () => request.resolve({ error: null }));
        expect(router.replace).toHaveBeenCalledWith("/login");
    });

    it.each(["returned", "thrown"])("UI-ACCOUNT-03: %s failure stays signed in and allows retry", async (kind) => {
        if (kind === "returned") supabase.auth.signOut.mockResolvedValueOnce({ error: { message: "Failed" } });
        else supabase.auth.signOut.mockRejectedValueOnce(new Error("Offline"));
        render(<AccountMenu />);
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: "Sign out" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("Sign out failed");
        expect(router.replace).not.toHaveBeenCalled();
        supabase.auth.signOut.mockResolvedValueOnce({ error: null });
        await user.click(screen.getByRole("button", { name: "Sign out" }));
        await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
});
