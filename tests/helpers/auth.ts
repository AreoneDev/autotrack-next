export const supabase = {
    auth: {
        getSession: jest.fn(),
        onAuthStateChange: jest.fn(),
        signInWithPassword: jest.fn(),
        signInWithOtp: jest.fn(),
        signUp: jest.fn(),
        signOut: jest.fn(),
    },
};

export const router = { replace: jest.fn(), refresh: jest.fn(), push: jest.fn() };

export function resetAuth() {
    Object.values(supabase.auth).forEach((mock) => mock.mockReset());
    Object.values(router).forEach((mock) => mock.mockReset());
    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const unsubscribe = jest.fn();
    supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } });
    return { unsubscribe };
}
