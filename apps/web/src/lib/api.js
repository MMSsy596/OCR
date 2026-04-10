const API_TOKEN = import.meta.env.VITE_API_TOKEN ?? "";

export function buildApiHeaders(inputHeaders = {}) {
  const headers = new Headers(inputHeaders);
  if (API_TOKEN && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${API_TOKEN}`);
  }
  return headers;
}

export function withApiAuth(options = {}) {
  return {
    ...options,
    headers: buildApiHeaders(options.headers),
  };
}

export function appendApiToken(url) {
  if (!API_TOKEN) return url;
  const nextUrl = new URL(url, window.location.origin);
  if (!nextUrl.searchParams.get("access_token")) {
    nextUrl.searchParams.set("access_token", API_TOKEN);
  }
  return nextUrl.toString();
}
