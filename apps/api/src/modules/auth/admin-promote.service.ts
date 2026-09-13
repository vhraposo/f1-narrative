import type { PrismaClient, Role } from "@prisma/client";

export class AdminPromoteError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AdminPromoteError";
  }
}

export interface PromotedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export type AdminPromotionOutcome =
  | { status: "PROMOTED"; user: PromotedUser }
  | { status: "ALREADY_ADMIN"; user: PromotedUser }
  | { status: "CANCELLED"; user: PromotedUser };

export interface AdminPromoteOptions {
  userIdentifier: string;
  confirm: (message: string) => Promise<boolean>;
}

export async function promoteUserToAdmin(
  db: PrismaClient,
  options: AdminPromoteOptions,
): Promise<AdminPromotionOutcome> {
  const identifier = options.userIdentifier.trim();
  if (!identifier) {
    throw new AdminPromoteError("INVALID_IDENTIFIER", "Informe o id ou e-mail do usuário");
  }

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const lookup = uuidPattern.test(identifier)
    ? { id: identifier.toLowerCase() }
    : { email: identifier };

  const user = await db.user.findUnique({
    where: lookup,
    select: { id: true, email: true, name: true, role: true },
  });
  if (!user) {
    throw new AdminPromoteError(
      "USER_NOT_FOUND",
      `Nenhum usuário encontrado para "${identifier}"`,
    );
  }

  if (user.role === "ADMIN") {
    return { status: "ALREADY_ADMIN", user };
  }

  const agreed = await options.confirm(
    `Promover ${user.name} <${user.email}> (${user.id}) para ADMIN? [s/N]`,
  );
  if (!agreed) {
    return { status: "CANCELLED", user };
  }

  const promoted = await db.user.update({
    where: { id: user.id },
    data: { role: "ADMIN" },
    select: { id: true, email: true, name: true, role: true },
  });
  return { status: "PROMOTED", user: promoted };
}