import {
  AdminAuthRequestSchema,
  AdminAuthResponseSchema,
  AdminCaseCreateRequestSchema,
  AdminCaseListResponseSchema,
  AdminCaseParamsSchema,
  AdminCaseResponseSchema,
  AdminCaseUpdateRequestSchema,
  AdminContactHandoffResponseSchema,
  AdminContentCreateRequestSchema,
  AdminContentListResponseSchema,
  AdminContentParamsSchema,
  AdminContentPublishRequestSchema,
  AdminContentResponseSchema,
  AdminContentUpdateRequestSchema,
  AdminSessionResponseSchema,
  AdminSubmissionListQuerySchema,
  AdminSubmissionListResponseSchema,
  AdminSubmissionParamsSchema,
  AdminSubmissionResponseSchema,
  AdminSubmissionUpdateRequestSchema,
  AdminUserListQuerySchema,
  AdminUserListResponseSchema,
  AdminVersionQuerySchema,
  CaseCatalogQuerySchema,
  CaseCatalogResponseSchema,
  PublicContentResponseSchema,
  SessionTokenSchema,
  type ApiErrorIssue,
} from '@craft72/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodError, ZodType } from 'zod';

import {
  AdminStoreActiveDialogNotFoundError,
  AdminStoreConflictError,
  AdminStoreNotFoundError,
  InvalidAdminCursorError,
  type AdminStore,
  type AuthenticatedAdmin,
} from './admin-repository.js';
import type { AdminPasswordVerifier } from './admin-password.js';
import { MaxProofError, validateMaxInitData } from './max-auth.js';
import { ApiHttpError, type Stage3ApiModule } from './server.js';

export const ADMIN_SESSION_COOKIE = '__Host-craft72-admin' as const;

export interface AdminApiOptions {
  readonly botToken: string;
  readonly initDataMaxAgeSeconds: number;
  readonly now?: () => Date;
  readonly passwordVerifier: Pick<AdminPasswordVerifier, 'verify'>;
  readonly publicBaseUrl: string;
  readonly store: AdminStore;
}

function validNow(clock: () => Date): Date {
  const now = clock();
  if (Number.isNaN(now.getTime())) throw new RangeError('Admin API clock returned an invalid date');
  return now;
}

function validationIssues(error: ZodError): ApiErrorIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((part) => (typeof part === 'symbol' ? String(part) : part)),
    code: issue.code.replaceAll('-', '_'),
    message: issue.message,
  }));
}

function parseWithSchema<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApiHttpError(
      400,
      'VALIDATION_ERROR',
      'Request validation failed',
      validationIssues(result.error),
    );
  }
  return result.data;
}

function sessionTokenFromCookie(request: FastifyRequest): string | null {
  const cookie = request.headers.cookie;
  if (cookie === undefined) return null;
  const values = cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${ADMIN_SESSION_COOKIE}=`))
    .map((part) => part.slice(ADMIN_SESSION_COOKIE.length + 1));
  if (values.length !== 1) return null;
  const parsed = SessionTokenSchema.safeParse(values[0]);
  return parsed.success ? parsed.data : null;
}

function sessionTokenFromAuthorization(request: FastifyRequest): string | null | undefined {
  const values: string[] = [];
  const rawHeaders = request.raw.rawHeaders;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === 'authorization') {
      values.push(rawHeaders[index + 1] ?? '');
    }
  }
  if (values.length === 0) return undefined;
  if (values.length !== 1) return null;

  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(values[0] ?? '');
  if (match?.[1] === undefined) return null;
  const parsed = SessionTokenSchema.safeParse(match[1]);
  return parsed.success ? parsed.data : null;
}

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date, now: Date): void {
  const maxAge = Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1_000));
  reply.header(
    'set-cookie',
    `${ADMIN_SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; Expires=${expiresAt.toUTCString()}; Secure; HttpOnly; SameSite=None; Partitioned`,
  );
}

function clearSessionCookie(reply: FastifyReply): void {
  reply.header(
    'set-cookie',
    `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=None; Partitioned`,
  );
}

async function translateStoreErrors<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof AdminStoreNotFoundError) {
      throw new ApiHttpError(404, 'NOT_FOUND', 'Admin resource not found');
    }
    if (error instanceof AdminStoreConflictError) {
      throw new ApiHttpError(409, 'CONFLICT', 'The resource was changed by another administrator');
    }
    if (error instanceof AdminStoreActiveDialogNotFoundError) {
      throw new ApiHttpError(
        409,
        'CONTACT_HANDOFF_UNAVAILABLE',
        'Open the administrator panel from an active direct bot dialog and try again',
      );
    }
    if (error instanceof InvalidAdminCursorError) {
      throw new ApiHttpError(400, 'VALIDATION_ERROR', 'The pagination cursor is invalid');
    }
    throw error;
  }
}

function encodeCaseCursor(id: string): string {
  return Buffer.from(JSON.stringify({ id })).toString('base64url');
}

function decodeCaseCursor(value: string): string {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('id' in parsed) ||
      typeof parsed.id !== 'string' ||
      parsed.id.length === 0
    ) {
      throw new Error('invalid');
    }
    return parsed.id;
  } catch {
    throw new ApiHttpError(400, 'VALIDATION_ERROR', 'The case catalog cursor is invalid');
  }
}

export function buildAdminApiModule(options: AdminApiOptions): Stage3ApiModule {
  const clock = options.now ?? (() => new Date());
  const allowedOrigin = new URL(options.publicBaseUrl).origin;

  const requireSameOrigin = (request: FastifyRequest): void => {
    if (request.headers.origin !== allowedOrigin) {
      throw new ApiHttpError(403, 'FORBIDDEN', 'A same-origin admin request is required');
    }
  };

  const authenticate = async (
    request: FastifyRequest,
  ): Promise<{ admin: AuthenticatedAdmin; token: string }> => {
    const bearerToken = sessionTokenFromAuthorization(request);
    const token = bearerToken === undefined ? sessionTokenFromCookie(request) : bearerToken;
    if (token === null) {
      throw new ApiHttpError(401, 'UNAUTHORIZED', 'A valid admin session is required');
    }
    const admin = await options.store.authenticate(token);
    if (admin === null) {
      throw new ApiHttpError(401, 'UNAUTHORIZED', 'The admin session is invalid or expired');
    }
    return { admin, token };
  };

  return {
    async register(app: FastifyInstance): Promise<void> {
      app.post(
        '/api/admin/auth/password',
        {
          config: {
            rateLimit: {
              groupId: 'admin-password-auth',
              max: 5,
              timeWindow: 15 * 60 * 1_000,
            },
          },
        },
        async (request, reply) => {
          requireSameOrigin(request);
          const body = parseWithSchema(AdminAuthRequestSchema, request.body);
          let validated = null;
          try {
            validated = validateMaxInitData(body.initData, {
              botToken: options.botToken,
              maxAgeSeconds: options.initDataMaxAgeSeconds,
              now: clock,
            });
          } catch (error) {
            if (!(error instanceof MaxProofError)) throw error;
          }
          const passwordValid = await options.passwordVerifier.verify(body.password);
          if (validated?.startParam !== 'admin' || !passwordValid) {
            throw new ApiHttpError(401, 'UNAUTHORIZED', 'Admin credentials are invalid');
          }
          const session = await options.store.createSession(validated.user, request.id);
          setSessionCookie(reply, session.token, session.expiresAt, validNow(clock));
          return AdminAuthResponseSchema.parse({
            authenticated: true,
            user: session.user,
            expiresAt: session.expiresAt.toISOString(),
            sessionToken: session.token,
          });
        },
      );

      app.get('/api/admin/session', async (request) => {
        const { admin } = await authenticate(request);
        return AdminSessionResponseSchema.parse({
          authenticated: true,
          user: admin.user,
          expiresAt: admin.expiresAt.toISOString(),
        });
      });

      app.post('/api/admin/logout', async (request, reply) => {
        requireSameOrigin(request);
        const { admin, token } = await authenticate(request);
        await options.store.revokeSession(token, admin, request.id);
        clearSessionCookie(reply);
        return reply.status(204).send();
      });

      app.get('/api/admin/users', async (request) => {
        await authenticate(request);
        const query = parseWithSchema(AdminUserListQuerySchema, request.query);
        const page = await translateStoreErrors(options.store.listUsers(query));
        return AdminUserListResponseSchema.parse(page);
      });

      app.get('/api/admin/submissions', async (request) => {
        await authenticate(request);
        const query = parseWithSchema(AdminSubmissionListQuerySchema, request.query);
        const page = await translateStoreErrors(options.store.listSubmissions(query));
        return AdminSubmissionListResponseSchema.parse(page);
      });

      app.get('/api/admin/submissions/:submissionId', async (request) => {
        await authenticate(request);
        const parameters = parseWithSchema(AdminSubmissionParamsSchema, request.params);
        const submission = await options.store.getSubmission(parameters.submissionId);
        if (submission === null) {
          throw new ApiHttpError(404, 'NOT_FOUND', 'Submission not found');
        }
        return AdminSubmissionResponseSchema.parse({ submission });
      });

      app.patch('/api/admin/submissions/:submissionId', async (request) => {
        requireSameOrigin(request);
        const { admin } = await authenticate(request);
        const parameters = parseWithSchema(AdminSubmissionParamsSchema, request.params);
        const body = parseWithSchema(AdminSubmissionUpdateRequestSchema, request.body);
        const submission = await translateStoreErrors(
          options.store.updateSubmission(parameters.submissionId, body, admin, request.id),
        );
        return AdminSubmissionResponseSchema.parse({ submission });
      });

      app.post(
        '/api/admin/submissions/:submissionId/contact-handoff',
        {
          config: {
            rateLimit: {
              groupId: 'admin-contact-handoff',
              max: 10,
              timeWindow: 60 * 1_000,
            },
          },
        },
        async (request, reply) => {
          requireSameOrigin(request);
          const { admin } = await authenticate(request);
          const parameters = parseWithSchema(AdminSubmissionParamsSchema, request.params);
          await translateStoreErrors(
            options.store.queueContactHandoff(parameters.submissionId, admin, request.id),
          );
          return reply.status(202).send(AdminContactHandoffResponseSchema.parse({ queued: true }));
        },
      );

      app.get('/api/admin/cases', async (request) => {
        await authenticate(request);
        return AdminCaseListResponseSchema.parse({ items: await options.store.listCases() });
      });

      app.post('/api/admin/cases', async (request, reply) => {
        requireSameOrigin(request);
        const { admin } = await authenticate(request);
        const body = parseWithSchema(AdminCaseCreateRequestSchema, request.body);
        const item = await translateStoreErrors(options.store.createCase(body, admin, request.id));
        return reply.status(201).send(AdminCaseResponseSchema.parse({ item }));
      });

      app.patch('/api/admin/cases/:id', async (request) => {
        requireSameOrigin(request);
        const { admin } = await authenticate(request);
        const parameters = parseWithSchema(AdminCaseParamsSchema, request.params);
        const body = parseWithSchema(AdminCaseUpdateRequestSchema, request.body);
        const item = await translateStoreErrors(
          options.store.updateCase(parameters.id, body, admin, request.id),
        );
        return AdminCaseResponseSchema.parse({ item });
      });

      app.delete('/api/admin/cases/:id', async (request, reply) => {
        requireSameOrigin(request);
        const { admin } = await authenticate(request);
        const parameters = parseWithSchema(AdminCaseParamsSchema, request.params);
        const query = parseWithSchema(AdminVersionQuerySchema, request.query);
        await translateStoreErrors(
          options.store.deleteCase(parameters.id, query.expectedVersion, admin, request.id),
        );
        return reply.status(204).send();
      });

      app.get('/api/admin/content', async (request) => {
        await authenticate(request);
        return AdminContentListResponseSchema.parse({ items: await options.store.listContent() });
      });

      app.get('/api/admin/content/:key', async (request) => {
        await authenticate(request);
        const parameters = parseWithSchema(AdminContentParamsSchema, request.params);
        const document = await options.store.getContent(parameters.key);
        if (document === null) throw new ApiHttpError(404, 'NOT_FOUND', 'Content not found');
        return AdminContentResponseSchema.parse({ document });
      });

      app.post('/api/admin/content', async (request, reply) => {
        requireSameOrigin(request);
        const { admin } = await authenticate(request);
        const body = parseWithSchema(AdminContentCreateRequestSchema, request.body);
        const document = await translateStoreErrors(
          options.store.createContent(body, admin, request.id),
        );
        return reply.status(201).send(AdminContentResponseSchema.parse({ document }));
      });

      app.put('/api/admin/content/:key', async (request) => {
        requireSameOrigin(request);
        const { admin } = await authenticate(request);
        const parameters = parseWithSchema(AdminContentParamsSchema, request.params);
        const body = parseWithSchema(AdminContentUpdateRequestSchema, request.body);
        const document = await translateStoreErrors(
          options.store.updateContent(parameters.key, body, admin, request.id),
        );
        return AdminContentResponseSchema.parse({ document });
      });

      app.post('/api/admin/content/:key/publish', async (request) => {
        requireSameOrigin(request);
        const { admin } = await authenticate(request);
        const parameters = parseWithSchema(AdminContentParamsSchema, request.params);
        const body = parseWithSchema(AdminContentPublishRequestSchema, request.body);
        const document = await translateStoreErrors(
          options.store.publishContent(parameters.key, body.expectedVersion, admin, request.id),
        );
        return AdminContentResponseSchema.parse({ document });
      });

      app.delete('/api/admin/content/:key', async (request, reply) => {
        requireSameOrigin(request);
        const { admin } = await authenticate(request);
        const parameters = parseWithSchema(AdminContentParamsSchema, request.params);
        const query = parseWithSchema(AdminVersionQuerySchema, request.query);
        await translateStoreErrors(
          options.store.deleteContent(parameters.key, query.expectedVersion, admin, request.id),
        );
        return reply.status(204).send();
      });

      app.get('/api/content/:key', async (request) => {
        const parameters = parseWithSchema(AdminContentParamsSchema, request.params);
        const content = await options.store.getPublishedContent(parameters.key);
        if (content === null) throw new ApiHttpError(404, 'NOT_FOUND', 'Content not found');
        return PublicContentResponseSchema.parse(content);
      });

      app.get('/api/cases', async (request) => {
        const query = parseWithSchema(CaseCatalogQuerySchema, request.query);
        let items = [...(await options.store.listPublishedCases())].filter(
          (item) =>
            (query.objectType === undefined || item.categories.includes(query.objectType)) &&
            (query.service === undefined || item.services.includes(query.service)) &&
            (query.region === undefined || item.region === query.region) &&
            (query.city === undefined || item.city === query.city) &&
            (query.scale === undefined || item.scale === query.scale) &&
            (query.constructionKind === undefined ||
              item.constructionKind === query.constructionKind),
        );
        if (query.cursor !== undefined) {
          const cursorId = decodeCaseCursor(query.cursor);
          const cursorIndex = items.findIndex(({ id }) => id === cursorId);
          if (cursorIndex < 0) {
            throw new ApiHttpError(400, 'VALIDATION_ERROR', 'The case catalog cursor is stale');
          }
          items = items.slice(cursorIndex + 1);
        }
        const limit = query.limit ?? 25;
        const visible = items.slice(0, limit);
        return CaseCatalogResponseSchema.parse({
          items: visible,
          nextCursor:
            items.length > limit && visible.length > 0
              ? encodeCaseCursor(visible[visible.length - 1]?.id ?? '')
              : null,
        });
      });
    },
  };
}
