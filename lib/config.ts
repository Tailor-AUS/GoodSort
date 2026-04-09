export const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export function apiUrl(path: string): string {
  return API_URL ? `${API_URL}${path}` : path;
}
