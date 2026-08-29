export function cursorPage<T extends { id: string }>(
  items: T[],
  limit: number,
) {
  const hasNextPage = items.length > limit;
  const data = hasNextPage ? items.slice(0, limit) : items;

  return {
    data,
    nextCursor: hasNextPage ? data[data.length - 1].id : null,
  };
}
