import { z } from 'zod';

import { IsoDateTimeSchema } from './primitives.js';

export const HealthLiveResponseSchema = z.strictObject({
  status: z.literal('ok'),
  timestamp: IsoDateTimeSchema,
});
export type HealthLiveResponse = z.infer<typeof HealthLiveResponseSchema>;

export const DependencyHealthSchema = z.strictObject({
  status: z.enum(['ok', 'error']),
  latencyMs: z.number().nonnegative().max(60_000).optional(),
});
export type DependencyHealth = z.infer<typeof DependencyHealthSchema>;

const HealthCheckNameSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);

const ReadinessChecksSchema = z
  .record(HealthCheckNameSchema, DependencyHealthSchema)
  .pipe(z.object({ database: DependencyHealthSchema }).catchall(DependencyHealthSchema));

export const HealthReadyResponseSchema = z
  .strictObject({
    status: z.enum(['ok', 'degraded', 'unavailable']),
    timestamp: IsoDateTimeSchema,
    checks: ReadinessChecksSchema,
  })
  .superRefine((health, context) => {
    const database = health.checks.database;
    const hasFailedCheck = Object.values(health.checks).some((check) => check.status === 'error');
    const expectedStatus =
      database.status === 'error' ? 'unavailable' : hasFailedCheck ? 'degraded' : 'ok';

    if (health.status !== expectedStatus) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: `Expected status ${expectedStatus} for the reported checks`,
      });
    }
  });
export type HealthReadyResponse = z.infer<typeof HealthReadyResponseSchema>;
