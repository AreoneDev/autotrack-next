/** @jest-environment jsdom */
import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetAuth, supabase } from "@/tests/helpers/auth";
import { deferred } from "@/tests/helpers/deferred";
import EmailRecoveryForm from "@/components/auth/EmailRecoveryForm";
import ResetPasswordPage from "@/app/reset-password/page";

jest.mock("@/lib/supabase/client", () => jest.requireActual("@/tests/helpers/auth"));

beforeEach(() => {
    resetAuth();
    window.history.replaceState(null, "", "/forgot-password");
});
afterEach(() => jest.useRealTimers());

describe("email recovery requests", () => {
    it.each(["password", "confirmation"] as const)("submits %s with the correct callback, neutral message, and resend cooldown", async kind => {
        supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
        supabase.auth.resend.mockResolvedValue({ error: null });
        render(<EmailRecoveryForm kind={kind} />);
        const user = userEvent.setup();
        await user.type(screen.getByLabelText("Email"), "ada@example.test");
        await user.click(screen.getByRole("button"));
        expect(await screen.findByRole("status")).toHaveTextContent("If");
        if (kind === "password") {
            expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith("ada@example.test", { redirectTo: "http://localhost/auth/callback?next=/reset-password" });
            expect(supabase.auth.resend).not.toHaveBeenCalled();
        } else {
            expect(supabase.auth.resend).toHaveBeenCalledWith({ type: "signup", email: "ada@example.test", options: { emailRedirectTo: "http://localhost/auth/callback" } });
            expect(supabase.auth.signUp).not.toHaveBeenCalled();
        }
        expect(screen.getByRole("button", { name: "Try again in 60s" })).toBeDisabled();
    });

    it("guards pending submissions and retries after a network failure", async () => {
        const pending = deferred<{ error: null }>();
        supabase.auth.resetPasswordForEmail.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ error: null });
        render(<EmailRecoveryForm kind="password" />);
        const user = userEvent.setup();
        await user.type(screen.getByLabelText("Email"), "ada@example.test");
        const form = screen.getByRole("button").closest("form")!;
        fireEvent.submit(form);
        fireEvent.submit(form);
        expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
        expect(screen.getByLabelText("Email")).toBeDisabled();
        await act(async () => pending.reject(new Error("offline")));
        expect(await screen.findByRole("alert")).toHaveTextContent("Unable to reach");
        await user.click(screen.getByRole("button"));
        expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledTimes(2);
    });

    it("rate limiting has a countdown and enables retry after it elapses", async () => {
        jest.useFakeTimers();
        supabase.auth.resend.mockResolvedValue({ error: { status: 429, message: "private backend detail" } });
        render(<EmailRecoveryForm kind="confirmation" />);
        fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.test" } });
        await act(async () => fireEvent.submit(screen.getByRole("button").closest("form")!));
        expect(screen.getByRole("alert")).toHaveTextContent("Too many requests");
        expect(screen.queryByText("private backend detail")).not.toBeInTheDocument();
        for (let second = 0; second < 60; second++) act(() => jest.advanceTimersByTime(1000));
        expect(screen.getByRole("button", { name: "Resend confirmation email" })).toBeEnabled();
    });

    it("server failures do not claim delivery or reveal account existence", async () => {
        supabase.auth.resend.mockResolvedValue({ error: { status: 500, message: "No user with that address" } });
        render(<EmailRecoveryForm kind="confirmation" />);
        fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.test" } });
        await act(async () => fireEvent.submit(screen.getByRole("button").closest("form")!));
        expect(screen.getByRole("alert")).toHaveTextContent("Unable to send");
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
        expect(screen.getByRole("button")).toBeEnabled();
    });

    it.each(["?error=callback", "#error=access_denied&error_code=otp_expired&error_description=untrusted"])("expired %s survives Strict Mode and removes URL errors", async suffix => {
        window.history.replaceState(null, "", "/forgot-password" + suffix);
        render(<StrictMode><EmailRecoveryForm kind="password" /></StrictMode>);
        expect(await screen.findByRole("alert")).toHaveTextContent("expired");
        expect(screen.getByRole("button", { name: "Send reset link" })).toBeEnabled();
        expect(window.location.search + window.location.hash).toBe("");
    });
});

describe("password update", () => {
    function allowUser() {
        supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "synthetic" } }, error: null });
    }
    async function fillPasswords(password = "new-password-123", confirmation = password) {
        const user = userEvent.setup();
        await user.type(await screen.findByLabelText("New password"), password);
        await user.type(screen.getByLabelText("Confirm new password"), confirmation);
        return user;
    }

    it("does not render a password form until the server verifies the user", async () => {
        const pending = deferred<unknown>();
        supabase.auth.getUser.mockReturnValue(pending.promise);
        render(<ResetPasswordPage />);
        expect(screen.getByRole("status")).toHaveTextContent("Verifying");
        expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
        await act(async () => pending.resolve({ data: { user: null }, error: null }));
        expect(screen.getByRole("alert")).toHaveTextContent("expired");
        expect(screen.getByRole("link", { name: "Request a new reset link" })).toHaveAttribute("href", "/forgot-password");
        expect(supabase.auth.updateUser).not.toHaveBeenCalled();
    });

    it("a delayed verification cannot re-enable the form after sign-out", async () => {
        const pending = deferred<unknown>();
        supabase.auth.getUser.mockReturnValue(pending.promise);
        render(<ResetPasswordPage />);
        act(() => supabase.auth.onAuthStateChange.mock.calls[0][0]("SIGNED_OUT", null));
        await act(async () => pending.resolve({ data: { user: { id: "synthetic" } }, error: null }));
        expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
        expect(screen.getByRole("alert")).toHaveTextContent("expired");
    });

    it("a failed verification remains recoverable", async () => {
        supabase.auth.getUser.mockRejectedValue(new Error("offline"));
        render(<ResetPasswordPage />);
        expect(await screen.findByRole("alert")).toHaveTextContent("Unable to verify");
        expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    });

    it("expired links cannot use an unrelated existing session", async () => {
        allowUser();
        window.history.replaceState(null, "", "/reset-password#error=access_denied&error_code=otp_expired");
        render(<StrictMode><ResetPasswordPage /></StrictMode>);
        expect(await screen.findByRole("alert")).toHaveTextContent("expired");
        expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    });

    it("validates matching passwords and minimum length before updating", async () => {
        allowUser();
        render(<ResetPasswordPage />);
        const user = await fillPasswords("short", "other");
        fireEvent.submit(screen.getByRole("button").closest("form")!);
        expect(await screen.findByRole("alert")).toHaveTextContent("at least 8");
        await user.clear(screen.getByLabelText("New password"));
        await user.type(screen.getByLabelText("New password"), "new-password-123");
        fireEvent.submit(screen.getByRole("button").closest("form")!);
        expect(screen.getByRole("alert")).toHaveTextContent("do not match");
        expect(supabase.auth.updateUser).not.toHaveBeenCalled();
    });

    it("updates once, clears passwords, and shows completion only after success", async () => {
        allowUser();
        const pending = deferred<{ error: null }>();
        supabase.auth.updateUser.mockReturnValue(pending.promise);
        render(<ResetPasswordPage />);
        const user = await fillPasswords();
        await user.click(screen.getByRole("button", { name: "Update password" }));
        fireEvent.submit(screen.getByRole("button").closest("form")!);
        expect(supabase.auth.updateUser).toHaveBeenCalledTimes(1);
        expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: "new-password-123" });
        expect(screen.getByRole("button")).toBeDisabled();
        await act(async () => pending.resolve({ error: null }));
        expect(screen.getByRole("status")).toHaveTextContent("Your password has been updated");
        expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Continue to AutoTrack" })).toHaveAttribute("href", "/dashboard");
    });

    it.each(["same_password", "weak_password"])("handles %s without claiming success and permits retry", async code => {
        allowUser();
        supabase.auth.updateUser.mockResolvedValue({ error: { code, status: 422 } });
        render(<ResetPasswordPage />);
        const user = await fillPasswords();
        await user.click(screen.getByRole("button", { name: "Update password" }));
        expect(await screen.findByRole("alert")).toHaveTextContent(code === "same_password" ? "different" : "stronger");
        expect(screen.getByRole("button")).toBeEnabled();
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it.each([{ status: 401 }, { status: 400, name: "AuthSessionMissingError" }])("an expired session during update offers another link: %j", async failure => {
        allowUser();
        supabase.auth.updateUser.mockResolvedValue({ error: failure });
        render(<ResetPasswordPage />);
        const user = await fillPasswords();
        await user.click(screen.getByRole("button", { name: "Update password" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("expired");
        expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    });

    it("signing out in another tab disables password updates and unsubscribes on unmount", async () => {
        allowUser();
        const { unmount } = render(<ResetPasswordPage />);
        await screen.findByLabelText("New password");
        act(() => supabase.auth.onAuthStateChange.mock.calls[0][0]("SIGNED_OUT", null));
        expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
        unmount();
        expect(supabase.auth.onAuthStateChange.mock.results[0].value.data.subscription.unsubscribe).toHaveBeenCalled();
    });
});
