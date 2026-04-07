// App configuration
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.livelyfield-64227152.eastasia.azurecontainerapps.io";

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}
