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

export async function readApiErrorMessage(input, fallback = "request_failed") {
  if (!input) return fallback;

  if (input instanceof Response) {
    let bodyText = "";
    try {
      bodyText = await input.text();
    } catch {
      return fallback;
    }
    if (!bodyText) return `HTTP ${input.status}`;
    try {
      const parsed = JSON.parse(bodyText);
      if (parsed?.detail) return String(parsed.detail);
      if (parsed?.message) return String(parsed.message);
    } catch {
      return bodyText;
    }
    return bodyText;
  }

  const message = input?.message || "";
  if (!message) return fallback;
  try {
    const parsed = JSON.parse(message);
    if (parsed?.detail) return String(parsed.detail);
    if (parsed?.message) return String(parsed.message);
  } catch {
    return message;
  }
  return message;
}
