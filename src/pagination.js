export function paginate(items, requestedPage = 1, requestedPageSize = 30) {
  const pageSize = clampInteger(requestedPageSize, 1, 100, 30);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(clampInteger(requestedPage, 1, Number.MAX_SAFE_INTEGER, 1), totalPages);
  const offset = (page - 1) * pageSize;
  return {
    items: items.slice(offset, offset + pageSize),
    page,
    pageSize,
    total,
    totalPages
  };
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}
