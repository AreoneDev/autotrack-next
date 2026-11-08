/** @jest-environment jsdom */
import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { resetAuth, router, supabase } from "@/tests/helpers/auth";
import { deferred } from "@/tests/helpers/deferred";
import LoginPage from "@/app/login/page";

jest.mock("@/lib/supabase/client", () => jest.requireActual("@/tests/helpers/auth"));
jest.mock("next/navigation", () => ({ useRouter: () => jest.requireActual("@/tests/helpers/auth").router }));

describe("UI-AUTH — sign-in state transitions", () => {
    it("shows expired query and fragment errors with recovery navigation in Strict Mode", async () => {
        window.history.replaceState(null, "", "/login#error=access_denied&error_code=otp_expired&error_description=untrusted");
        render(<StrictMode><LoginPage /></StrictMode>);
        expect(await screen.findByRole("alert")).toHaveTextContent("expired");
        expect(window.location.hash).toBe("");
        expect(screen.getByRole("link", { name: "Forgot your password?" })).toHaveAttribute("href", "/forgot-password");
        expect(screen.getByRole("link", { name: "Resend confirmation email" })).toHaveAttribute("href", "/resend-confirmation");
    });

    it("session service failure leaves sign-in usable", async () => {
        supabase.auth.getSession.mockRejectedValue(new Error("offline"));
        render(<LoginPage />);
        expect(await screen.findByRole("alert")).toHaveTextContent("Unable to check");
        expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    });
    beforeEach(() => {
        resetAuth();
        window.history.replaceState(null, "", "/login");
    });

    async function fillCredentials() {
        const user = userEvent.setup();
        await waitFor(() => expect(screen.getByLabelText("Email", { exact: true })).toBeEnabled());
        await user.type(screen.getByLabelText("Email", { exact: true }), "ada@example.test");
        await user.type(screen.getByLabelText("Password", { exact: true }), "safe-test-password");
        return user;
    }

    it("UI-AUTH-09: form waits for client session readiness before accepting credentials", async () => {
        const session = deferred<{ data: { session: null } }>();
        supabase.auth.getSession.mockReturnValue(session.promise);
        render(<LoginPage />);
        expect(screen.getByLabelText("Email", { exact: true })).toBeDisabled();
        expect(screen.getByLabelText("Password", { exact: true })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Register" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
        await act(async () => session.resolve({ data: { session: null } }));
        await fillCredentials();
        expect(screen.getByLabelText("Email", { exact: true })).toHaveValue("ada@example.test");
        expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    });

    it("UI-AUTH-01: signed-in visitors are redirected", async () => {
        supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: "synthetic" } } } });
        render(<LoginPage />);
        await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    });

    it("UI-AUTH-02: empty and invalid email partitions cannot submit", async () => {
        const user = userEvent.setup();
        render(<LoginPage />);
        await user.click(screen.getByRole("button", { name: "Sign in" }));
        expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
        await user.type(screen.getByLabelText("Email", { exact: true }), "invalid-email");
        await user.type(screen.getByLabelText("Password", { exact: true }), "password");
        await user.click(screen.getByRole("button", { name: "Sign in" }));
        expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
    });

    it("UI-AUTH-03: pending → success prevents duplicate requests and redirects", async () => {
        const request = deferred<{ error: null }>();
        supabase.auth.signInWithPassword.mockReturnValue(request.promise);
        render(<LoginPage />);
        const user = await fillCredentials();
        await user.click(screen.getByRole("button", { name: "Sign in" }));
        const pending = screen.getByRole("button", { name: "Please wait…" });
        expect(pending).toBeDisabled();
        await user.click(pending);
        expect(supabase.auth.signInWithPassword).toHaveBeenCalledTimes(1);
        expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: "ada@example.test", password: "safe-test-password" });
        await act(async () => request.resolve({ error: null }));
        expect(router.replace).toHaveBeenCalledWith("/dashboard");
    });

    it("UI-AUTH-04: rejected credentials stay on the form and allow retry", async () => {
        supabase.auth.signInWithPassword.mockResolvedValueOnce({ error: { message: "Invalid credentials" } }).mockResolvedValueOnce({ error: null });
        render(<LoginPage />);
        const user = await fillCredentials();
        await user.click(screen.getByRole("button", { name: "Sign in" }));
        expect(await screen.findByText("Invalid credentials")).toBeInTheDocument();
        expect(router.replace).not.toHaveBeenCalled();
        await user.click(screen.getByRole("button", { name: "Sign in" }));
        await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
        expect(screen.queryByText("Invalid credentials")).not.toBeInTheDocument();
    });

    it("UI-AUTH-05: network rejection restores an enabled submit button", async () => {
        supabase.auth.signInWithPassword.mockRejectedValue(new Error("Network unavailable"));
        render(<LoginPage />);
        const user = await fillCredentials();
        await user.click(screen.getByRole("button", { name: "Sign in" }));
        expect(await screen.findByText("Network unavailable")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
        expect(router.replace).not.toHaveBeenCalled();
    });

    it("UI-AUTH-06: email-link mode removes password and sends a callback URL", async () => {
        supabase.auth.signInWithOtp.mockResolvedValue({ error: null });
        render(<LoginPage />);
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: "Email link" }));
        expect(screen.queryByLabelText("Password", { exact: true })).not.toBeInTheDocument();
        await user.type(screen.getByLabelText("Email", { exact: true }), "ada@example.test");
        await user.click(screen.getByRole("button", { name: "Send sign-in link" }));
        expect(await screen.findByText(/A sign-in link has been sent/)).toBeInTheDocument();
        expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({ email: "ada@example.test", options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
        await user.click(screen.getByRole("button", { name: "Password" }));
        expect(screen.queryByText(/A sign-in link has been sent/)).not.toBeInTheDocument();
    });

    it.each([7, 8, 9])("UI-AUTH-07: registration password boundary length %i", async (length) => {
        supabase.auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
        render(<LoginPage />);
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: "Register" }));
        await user.type(screen.getByLabelText("Email", { exact: true }), "ada@example.test");
        const password = screen.getByLabelText("Password", { exact: true });
        expect(password).toHaveAttribute("minlength", "8");
        await user.type(password, "x".repeat(length));
        // JSDOM does not enforce minLength; real browser boundaries live in auth.spec.ts.
        if (length >= 8) {
            await user.click(screen.getByRole("button", { name: "Create account" }));
            expect(await screen.findByText(/Check your email to confirm/)).toBeInTheDocument();
            expect(supabase.auth.signUp).toHaveBeenCalledTimes(1);
        }
    });

    it("UI-AUTH-08: registration with an immediate session redirects", async () => {
        supabase.auth.signUp.mockResolvedValue({ data: { session: { user: { id: "synthetic" } } }, error: null });
        render(<LoginPage />);
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: "Register" }));
        await fillCredentials();
        await user.click(screen.getByRole("button", { name: "Create account" }));
        await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
    });
});
