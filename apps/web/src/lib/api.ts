const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
};

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body } = options;

  const hasBody = body !== undefined;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message =
      typeof data?.error === "string"
        ? data.error
        : "Ocorreu um erro inesperado.";
    throw new ApiError(message, res.status, data?.code);
  }

  return data as T;
}

export function get<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

export function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body });
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "PATCH", body });
}

export function put<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "PUT", body });
}

export function remove<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}
