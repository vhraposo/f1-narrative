import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  AdminPromoteError,
  promoteUserToAdmin,
} from "../modules/auth/admin-promote.service.js";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(here, "../../../.env"), quiet: true });

const USAGE = "Uso: admin:promote --user <id-de-usuario-ou-email>";

async function promptConfirmation(message: string): Promise<boolean> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => {
      readline.question(message, resolve);
    });
    const normalized = answer.trim().toLowerCase();
    return normalized === "s" || normalized === "sim" || normalized === "y" || normalized === "yes";
  } finally {
    readline.close();
  }
}

async function main(): Promise<void> {
  let userIdentifier: string;
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: { user: { type: "string" } },
      allowPositionals: false,
    });
    userIdentifier = values.user ?? "";
  } catch {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  if (!userIdentifier) {
    console.error(`Parâmetro --user é obrigatório.\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  try {
    const outcome = await promoteUserToAdmin(prisma, {
      userIdentifier,
      confirm: promptConfirmation,
    });
    switch (outcome.status) {
      case "PROMOTED":
        console.log(`Usuário ${outcome.user.email} promovido para ADMIN.`);
        break;
      case "ALREADY_ADMIN":
        console.log(`Usuário ${outcome.user.email} já é ADMIN. Nada alterado.`);
        break;
      case "CANCELLED":
        console.log("Operação cancelada. Nada alterado.");
        break;
    }
  } catch (error) {
    if (error instanceof AdminPromoteError) {
      console.error(error.message);
      process.exitCode = 1;
    } else {
      throw error;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});