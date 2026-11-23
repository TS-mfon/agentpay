export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as {
    success: boolean;
    data?: T;
    error?: { code: string; message: string };
  } | null;
  if (!response.ok || !result?.success)
    throw new ApiError(
      result?.error?.message ??
        "The request could not be completed. Try again.",
      result?.error?.code ?? "REQUEST_FAILED",
      response.status,
    );
  return result.data as T;
}
export const errorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : "The action could not be completed. Try again.";
