import type { SupabaseClient } from "@supabase/supabase-js";

type Reply = { data?: unknown; error?: { message: string } | null };

/** A strict ordered query double. It records filters but does not simulate SQL or RLS. */
export function scriptedClient(replies: Reply[]) {
    const queries: ReturnType<typeof makeQuery>[] = [];
    const pending = [...replies];
    const from = jest.fn((table: string) => {
        if (pending.length === 0) throw new Error(`Unexpected query to ${table}`);
        const reply = pending.shift()!;
        const query = makeQuery({ data: null, error: null, ...reply });
        queries.push(query);
        return query;
    });
    return { client: { from } as unknown as SupabaseClient, from, queries, remaining: () => pending.length };
}

function makeQuery(reply: Reply) {
    const chain = {
        returns: jest.fn(), select: jest.fn(), order: jest.fn(), eq: jest.fn(), neq: jest.fn(), not: jest.fn(), gte: jest.fn(), lt: jest.fn(),
        in: jest.fn(), or: jest.fn(), ilike: jest.fn(), limit: jest.fn(), range: jest.fn(), insert: jest.fn(), update: jest.fn(),
        delete: jest.fn(), upsert: jest.fn(), maybeSingle: jest.fn(), single: jest.fn(),
        then: (resolve: (value: Reply) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(reply).then(resolve, reject),
    };
    Object.entries(chain).forEach(([key, value]) => {
        if (key !== "then") (value as jest.Mock).mockReturnValue(chain);
    });
    return chain;
}
