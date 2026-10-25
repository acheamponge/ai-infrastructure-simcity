import { prisma } from "../db";
import type { Prisma, RunKind } from "@prisma/client";

export interface RunHandle {
  id: string;
  log: (line: string) => Promise<void>;
  succeed: (output: Prisma.InputJsonValue, usage?: { model?: string; tokensIn?: number; tokensOut?: number }) => Promise<void>;
  fail: (error: unknown) => Promise<void>;
}

export async function startRun(kind: RunKind, input: Prisma.InputJsonValue, model?: string): Promise<RunHandle> {
  const run = await prisma.agentRun.create({ data: { kind, input, status: "RUNNING", model } });
  let buffer = "";
  return {
    id: run.id,
    async log(line) {
      buffer += `${new Date().toISOString().slice(11, 19)}  ${line}\n`;
      await prisma.agentRun.update({ where: { id: run.id }, data: { log: buffer } });
    },
    async succeed(output, usage) {
      await prisma.agentRun.update({
        where: { id: run.id },
        data: { status: "SUCCEEDED", output, finishedAt: new Date(), log: buffer, model: usage?.model ?? model, tokensIn: usage?.tokensIn, tokensOut: usage?.tokensOut },
      });
    },
    async fail(error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.agentRun.update({ where: { id: run.id }, data: { status: "FAILED", error: message, finishedAt: new Date(), log: buffer } });
    },
  };
}
