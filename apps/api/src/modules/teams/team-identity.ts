import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import type { CreateTeamInput, UpdateTeamInput } from "./team.schema.js";

let capability: boolean | null = null;

export async function visualIdentityCapability(): Promise<boolean> {
  if (capability !== null) return capability;
  try {
    await prisma.team.findFirst({ select: { id: true, visualIdentity: true } });
    capability = true;
  } catch {
    capability = false;
  }
  return capability;
}

export async function teamSelectWithIdentity<
  S extends Record<string, boolean>,
>(base: S): Promise<S | (S & { visualIdentity: true })> {
  if (!(await visualIdentityCapability())) return base;
  return { ...base, visualIdentity: true };
}

export async function sanitizeTeamPayload<T extends Record<string, unknown>>(
  data: T,
): Promise<T> {
  if (data.visualIdentity === undefined) return data;
  if (!(await visualIdentityCapability())) {
    const next = { ...data };
    delete next.visualIdentity;
    return next as T;
  }
  return data;
}

type TeamVisualIdentityValue = CreateTeamInput["visualIdentity"];

export function normalizeVisualIdentity(
  value: TeamVisualIdentityValue,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined || value === null) {
    return value === null ? Prisma.JsonNull : undefined;
  }
  return value as Prisma.InputJsonValue;
}

export async function buildTeamCreateInput(
  userId: string,
  universeId: string,
  data: CreateTeamInput,
): Promise<Prisma.TeamUncheckedCreateInput> {
  const normalized = await sanitizeTeamPayload(data);
  const { visualIdentity, ...rest } = normalized;
  return {
    userId,
    universeId,
    ...rest,
    ...(visualIdentity !== undefined
      ? { visualIdentity: normalizeVisualIdentity(visualIdentity) }
      : {}),
  };
}


export async function buildTeamUpdateInput(
  data: UpdateTeamInput,
): Promise<Prisma.TeamUncheckedUpdateInput> {
  const normalized = await sanitizeTeamPayload(data);
  const { visualIdentity, ...rest } = normalized;
  return {
    ...rest,
    ...(visualIdentity !== undefined
      ? { visualIdentity: normalizeVisualIdentity(visualIdentity) }
      : {}),
  };
}