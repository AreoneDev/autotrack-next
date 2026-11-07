/** @jest-environment jsdom */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetAuth, router, supabase } from "@/tests/helpers/auth";
import { deferred } from "@/tests/helpers/deferred";
import AccountMenu from "@/components/auth/AccountMenu";
import { AccountProvider } from "@/components/auth/AccountProvider";
import SettingsPage from "@/app/settings/page";
jest.mock("@/lib/supabase/client", () => jest.requireActual("@/tests/helpers/auth"));
jest.mock("next/navigation", () => ({ useRouter: () => jest.requireActual("@/tests/helpers/auth").router, usePathname: () => "/settings" }));
const account = { id: "user-1", email: "ada@example.test", user_metadata: { display_name: "Ada Lovelace" } };
function setup(settings = false) { return render(<AccountProvider><AccountMenu />{settings && <SettingsPage />}</AccountProvider>); }
describe("account settings", () => {
    beforeEach(() => { resetAuth(); supabase.auth.getSession.mockResolvedValue({ data: { session: { user: account } } }); });
    it("shows the signed-in identity and clears it on auth changes", async () => {
        const { unmount } = setup();
        expect(await screen.findByText("ada@example.test")).toBeInTheDocument();
        expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
        act(() => supabase.auth.onAuthStateChange.mock.calls[0][0]("SIGNED_OUT", null));
        expect(screen.getByText("AutoTrack account")).toBeInTheDocument();
        const unsubscribe = supabase.auth.onAuthStateChange.mock.results[0].value.data.subscription.unsubscribe;
        unmount(); expect(unsubscribe).toHaveBeenCalled();
    });
    it("signs out locally, prevents duplicates and redirects", async () => {
        const request = deferred<{ error: null }>(); supabase.auth.signOut.mockReturnValue(request.promise);
        setup(); const user = userEvent.setup(); await screen.findByText("ada@example.test"); await user.click(screen.getByRole("button", { name: /ada@example.test/ }));
        await user.click(screen.getByRole("button", { name: "Sign out" }));
        expect(screen.getByRole("button", { name: "Signing out…" })).toBeDisabled();
        expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
        await act(async () => request.resolve({ error: null })); expect(router.replace).toHaveBeenCalledWith("/login");
    });
    it("keeps the user signed in on failure and allows retry", async () => {
        supabase.auth.signOut.mockResolvedValueOnce({ error: { message: "Failed" } }).mockResolvedValueOnce({ error: null });
        setup(); const user = userEvent.setup(); await screen.findByText("ada@example.test"); await user.click(screen.getByRole("button", { name: /ada@example.test/ })); await user.click(screen.getByRole("button", { name: "Sign out" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("Sign out failed"); expect(router.replace).not.toHaveBeenCalled();
        await user.click(screen.getByRole("button", { name: "Sign out" })); await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    });
    it("validates, saves and updates the sidebar identity", async () => {
        supabase.auth.updateUser.mockResolvedValue({ data: { user: { ...account, user_metadata: { display_name: "Grace Hopper" } } }, error: null });
        setup(true); const user = userEvent.setup(); const input = await screen.findByLabelText("Display name");
        await user.clear(input); await user.click(screen.getByRole("button", { name: "Save changes" }));
        expect(screen.getByRole("alert")).toHaveTextContent("between 1 and 60"); expect(supabase.auth.updateUser).not.toHaveBeenCalled();
        await user.type(input, "  Grace Hopper  "); await user.click(screen.getByRole("button", { name: "Save changes" }));
        await waitFor(() => expect(supabase.auth.updateUser).toHaveBeenCalledWith({ data: { display_name: "Grace Hopper" } }));
        expect(await screen.findAllByText("Grace Hopper")).toHaveLength(2); expect(screen.getByRole("status")).toHaveTextContent("Saved");
    });
    it("preserves an unsuccessful edit and blocks navigation when declined", async () => {
        supabase.auth.updateUser.mockResolvedValue({ data: { user: null }, error: { message: "offline" } });
        const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
        setup(true); const user = userEvent.setup(); const input = await screen.findByLabelText("Display name");
        await user.clear(input); await user.type(input, "Unsaved name"); await user.click(screen.getByRole("link", { name: "Back to Dashboard" }));
        expect(confirm).toHaveBeenCalled(); expect(input).toHaveValue("Unsaved name");
        await user.click(screen.getByRole("button", { name: "Save changes" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t save"); expect(input).toHaveValue("Unsaved name");
        confirm.mockRestore();
    });
});
