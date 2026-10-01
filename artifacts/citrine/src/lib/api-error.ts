import { ApiError } from "@workspace/api-client-react";

/** Message from an API error body ({ error }) or a generic fallback. */
export function apiErrorMessage(error: unknown, fallback = "Something went wrong."): string {
  if (error instanceof ApiError) {
    const data = error.data as { error?: unknown } | null;
    if (data && typeof data.error === "string") return data.error;
    return fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
