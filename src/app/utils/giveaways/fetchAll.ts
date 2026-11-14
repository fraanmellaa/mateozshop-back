const PAGE_SIZE = 1000;

/**
 * Supabase corta cada `select` a 1000 filas. Recorre todas las páginas de una
 * consulta; `page` debe aplicar `.range(from, to)` sobre una consulta con
 * orden estable.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;

    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}
