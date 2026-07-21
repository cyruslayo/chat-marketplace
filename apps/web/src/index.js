export function conventionalSearch(query, filters) {
  return { channel: "web", results: query.search(filters) };
}
