export function conventionalSearch(query: any, filters: any) {
  return { channel: "web" as const, artifact: query.search(filters) };
}

export function conventionalSearchRoute(filters: Record<string, any> = {}) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) parameters.set(key, String(value));
  }
  const query = parameters.toString();
  return `/stays/search${query ? `?${query}` : ""}`;
}
