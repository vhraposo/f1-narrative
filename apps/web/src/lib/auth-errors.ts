export function authErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Ocorreu um erro inesperado.";
}

export function authErrorCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return null;
}
