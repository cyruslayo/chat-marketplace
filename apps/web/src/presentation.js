export function conventionalSearch(query, filters) {
  return { channel: "web", artifact: query.search(filters) };
}

export function conventionalSearchRoute(filters = {}) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) parameters.set(key, String(value));
  }
  const query = parameters.toString();
  return `/stays/search${query ? `?${query}` : ""}`;
}
