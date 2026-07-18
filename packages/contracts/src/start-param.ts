import { z } from 'zod';

export const STATIC_START_PARAMS = [
  'home',
  'new_project',
  'services',
  'portfolio',
  'upload_brief',
  'admin',
] as const;

export const StaticStartParamSchema = z.enum(STATIC_START_PARAMS);
export type StaticStartParam = z.infer<typeof StaticStartParamSchema>;

export type SourceStartParam = `source_${string}`;

export const SourceStartParamSchema = z
  .string()
  .regex(/^source_[a-z0-9][a-z0-9_-]{0,63}$/)
  .transform((value): SourceStartParam => value as SourceStartParam);

export const StartParamSchema = z.union([StaticStartParamSchema, SourceStartParamSchema]);
export type StartParam = z.infer<typeof StartParamSchema>;
