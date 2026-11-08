/** @jest-environment jsdom */
import { act, render, screen, waitFor } from "@testing-library/react";
import { resetAuth, router, supabase } from "@/tests/helpers/auth";
import { deferred } from "@/tests/helpers/deferred";
import AuthGate from "@/components/auth/AuthGate";

jest.mock("@/lib/supabase/client", () => jest.requireActual("@/tests/helpers/auth"));
jest.mock("next/navigation", () => ({ useRouter: () => jest.requireActual("@/tests/helpers/auth").router, usePathname: jest.fn(() => "/leads") }));
jest.mock("@/components/layout/Sidebar", () => function Sidebar() { return <nav>Sidebar</nav>; });
jest.mock("@/components/layout/TopBar", () => function TopBar() { return <header>TopBar</header>; });
import { usePathname } from "next/navigation";

describe("UI-GATE — protected content state transitions", () => {
    beforeEach(() => {
        resetAuth();
        jest.mocked(usePathname).mockReturnValue("/leads");
    });

    it("UI-GATE-01: checking → anonymous never reveals protected content", async () => {
        const request = deferred<unknown>();
        supabase.auth.getSession.mockReturnValue(request.promise);
        render(<AuthGate>Private customer</AuthGate>);
        expect(screen.getByRole("status")).toHaveTextContent("Checking your session");
        expect(screen.queryByText("Private customer")).not.toBeInTheDocument();
        await act(async () => request.resolve({ data: { session: null }, error: null }));
        expect(router.replace).toHaveBeenCalledWith("/login");
        expect(screen.queryByText("Private customer")).not.toBeInTheDocument();
    });

    it("UI-GATE-02: authenticated → signed out hides content and redirects", async () => {
        supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: "synthetic" } } }, error: null });
        const { unmount } = render(<AuthGate>Private customer</AuthGate>);
        expect(await screen.findByText("Private customer")).toBeInTheDocument();
        const callback = supabase.auth.onAuthStateChange.mock.calls[0][0];
        act(() => callback("SIGNED_OUT", null));
        expect(screen.queryByText("Private customer")).not.toBeInTheDocument();
        expect(router.replace).toHaveBeenCalledWith("/login");
        unmount();
        expect(supabase.auth.onAuthStateChange.mock.results[0].value.data.subscription.unsubscribe).toHaveBeenCalledTimes(2);
    });

    it("UI-GATE-03: session service failures produce an alert without showing data", async () => {
        supabase.auth.getSession.mockRejectedValue(new Error("Offline"));
        render(<AuthGate>Private customer</AuthGate>);
        expect(await screen.findByRole("alert")).toHaveTextContent("Unable to check your session");
        expect(screen.queryByText("Private customer")).not.toBeInTheDocument();
    });

    it.each(["/login", "/forgot-password", "/reset-password", "/resend-confirmation"])("UI-GATE-04: %s is public without a session check", (path) => {
        jest.mocked(usePathname).mockReturnValue(path);
        render(<AuthGate>Sign-in form</AuthGate>);
        expect(screen.getByText("Sign-in form")).toBeInTheDocument();
        expect(supabase.auth.getSession).not.toHaveBeenCalled();
    });

    it("UI-GATE-05: completing a request after unmount cannot redirect", async () => {
        const request = deferred<unknown>();
        supabase.auth.getSession.mockReturnValue(request.promise);
        const { unmount } = render(<AuthGate>Private customer</AuthGate>);
        unmount();
        await act(async () => request.resolve({ data: { session: null }, error: null }));
        await waitFor(() => expect(router.replace).not.toHaveBeenCalled());
    });
});
