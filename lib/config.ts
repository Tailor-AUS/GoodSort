// App configuration — all values from environment
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export function apiUrl(path: string): string {
  if (!API_URL) {
    console.warn("NEXT_PUBLIC_API_URL not set");
    return path;
  }
  return `${API_URL}${path}`;
}
