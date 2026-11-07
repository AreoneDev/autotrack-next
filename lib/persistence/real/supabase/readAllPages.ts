const PAGE_SIZE = 1000;

type Page<T> = { data: T[] | null; error: { message: string } | null };

/** Queries must use a stable, unique order. Never expose a partially read collection. */
export async function readAllPages<T>(
    queryPage: (from: number, to: number) => PromiseLike<Page<T>>,
): Promise<T[]> {
    const rows: T[] = [];
    while (true) {
        const { data, error } = await queryPage(rows.length, rows.length + PAGE_SIZE - 1);
        if (error) throw new Error(error.message, { cause: error });
        if (!data) throw new Error("Missing data in collection response.");
        if (data.length === 0) return rows;
        rows.push(...data);
        // Advance by the actual response size: the server cap may be below PAGE_SIZE.
        // An empty page, rather than a short page, establishes completion.
    }
}
