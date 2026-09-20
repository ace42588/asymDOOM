import { PROTOCOL_VERSION } from "asymdoom-contracts";
import { z } from "zod";

export { PROTOCOL_VERSION };

export const IntentSchema = z.object({
  forward: z.number().min(-1).max(1),
  strafe: z.number().min(-1).max(1),
  turnDelta: z.number(),
  run: z.boolean(),
  fire: z.boolean(),
  use: z.boolean(),
  lookFly: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional().default(0),
  arti: z.number().int().min(0).max(63).optional().default(0),
});

export const ClientInputSchema = z.object({
  type: z.literal("input"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  seq: z.number().int().nonnegative(),
  input: z.object({
    intent: IntentSchema,
    bodySwap: z
      .object({ targetId: z.number().int().nullable().optional() })
      .nullable()
      .optional(),
    spectatorPossess: z
      .object({ targetId: z.number().int().nullable().optional() })
      .nullable()
      .optional(),
    spectatorFollow: z.enum(["next", "prev"]).nullable().optional(),
  }),
});

export const MapLoadCompleteSchema = z.object({
  type: z.literal("mapLoadComplete"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
});

export const ClientMessageSchema = z.union([ClientInputSchema, MapLoadCompleteSchema]);

export type ClientInput = z.infer<typeof ClientInputSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export function parseClientMessage(raw: unknown): ClientMessage | { error: string } {
  const r = ClientMessageSchema.safeParse(raw);
  if (!r.success) return { error: r.error.message };
  return r.data;
}
