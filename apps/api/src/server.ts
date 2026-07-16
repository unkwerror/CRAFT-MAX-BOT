import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Readable } from 'node:stream';

import {
  ALLOWED_UPLOAD_MIME_TYPES,
  ApiErrorResponseSchema,
  DocumentDownloadLinkResponseSchema,
  DocumentDownloadQuerySchema,
  HealthLiveResponseSchema,
  HealthReadyResponseSchema,
  LeadDraftGetResponseSchema,
  LeadDraftUpsertRequestSchema,
  LeadDraftUpsertResponseSchema,
  MaxAuthRequestSchema,
  MaxAuthResponseSchema,
  MaxContactVerifyRequestSchema,
  MaxContactVerifyResponseSchema,
  SubmissionCreateRequestSchema,
  SubmissionCreateResponseSchema,
  SubmissionParamsSchema,
  SubmissionReadResponseSchema,
  UploadCompleteRequestSchema,
  UploadCompleteResponseSchema,
  UploadIdParamsSchema,
  UploadInitRequestSchema,
  UploadInitResponseSchema,
  type ApiErrorCode,
  type ApiErrorIssue,
} from '@craft72/contracts';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import { ZodError, type ZodType } from 'zod';

import { MaxProofError, validateMaxInitData, verifyMaxContact } from './max-auth.js';
import {
  MaxWebhookUpdateSchema,
  isValidMaxWebhookSecret,
  parseMaxWebhookUpdate,
} from './max-webhook.js';
import {
  StoreConflictError,
  StoreNotFoundError,
  StoreUnauthorizedError,
  type AuthenticatedSession,
  type Stage3Store,
} from './repository.js';
import { UploadServiceError, type SecureUploadService } from './upload-service.js';

const AUTHORIZATION_PATTERN = /^Bearer ([A-Za-z0-9_-]{43})$/;

class ApiHttpError extends Error {
  public readonly code: ApiErrorCode;
  public readonly issues: readonly ApiErrorIssue[] | undefined;
  public readonly statusCode: number;

  public constructor(
    statusCode: number,
    code: ApiErrorCode,
    message: string,
    issues?: readonly ApiErrorIssue[],
  ) {
    super(message);
    this.name = 'ApiHttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.issues = issues;
  }
}

interface RateLimitBucket {
  count: number;
  expiresAt: number;
}

class FixedWindowRateLimiter {
  readonly #buckets = new Map<string, RateLimitBucket>();
  readonly #limit: number;
  readonly #windowMilliseconds: number;

  public constructor(limit: number, windowSeconds: number) {
    this.#limit = limit;
    this.#windowMilliseconds = windowSeconds * 1_000;
  }

  public consume(key: string, now: Date): boolean {
    const nowMilliseconds = now.getTime();
    const bucket = this.#buckets.get(key);
    if (bucket === undefined || bucket.expiresAt <= nowMilliseconds) {
      this.#buckets.set(key, { count: 1, expiresAt: nowMilliseconds + this.#windowMilliseconds });
      return true;
    }
    if (bucket.count >= this.#limit) return false;
    bucket.count += 1;

    if (this.#buckets.size > 10_000) {
      for (const [candidate, value] of this.#buckets) {
        if (value.expiresAt <= nowMilliseconds) this.#buckets.delete(candidate);
      }
    }
    return true;
  }
}

export interface Stage3ApiOptions {
  readonly botToken: string;
  readonly consentVersion: string;
  readonly contactMaxAgeSeconds: number;
  readonly initDataMaxAgeSeconds: number;
  readonly ipRateLimitMax: number;
  readonly logger?: FastifyServerOptions['logger'];
  readonly maxWebhookSecret: string;
  readonly now?: () => Date;
  readonly publicBaseUrl: string;
  readonly rateLimitMax: number;
  readonly rateLimitWindowSeconds: number;
  readonly store: Stage3Store;
  readonly uploads?: Pick<
    SecureUploadService,
    | 'completeUpload'
    | 'createDownloadLink'
    | 'getDocument'
    | 'initializeUpload'
    | 'isReady'
    | 'open'
    | 'receiveUpload'
    | 'resolveDownload'
  >;
}

function safeAttachmentName(value: string): string {
  const fallback = value.replaceAll(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'document';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(value)}`;
}

function validNow(clock: () => Date): Date {
  const now = clock();
  if (Number.isNaN(now.getTime())) throw new RangeError('API clock returned an invalid date');
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

function proofHttpError(error: MaxProofError): ApiHttpError {
  return error.code === 'expired'
    ? new ApiHttpError(401, 'MAX_AUTH_EXPIRED', 'MAX authentication data has expired')
    : new ApiHttpError(401, 'MAX_AUTH_INVALID', 'MAX authentication data is invalid');
}

function getStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined;
  return typeof error.statusCode === 'number' ? error.statusCode : undefined;
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

export async function buildStage3Api(options: Stage3ApiOptions): Promise<FastifyInstance> {
  const clock = options.now ?? (() => new Date());
  const allowedOrigin = new URL(options.publicBaseUrl).origin;
  const userRateLimiter = new FixedWindowRateLimiter(
    options.rateLimitMax,
    options.rateLimitWindowSeconds,
  );
  const app = Fastify({
    bodyLimit: 256 * 1_024,
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
    logger: options.logger ?? false,
    requestIdHeader: false,
    trustProxy: '127.0.0.1',
  });

  app.addContentTypeParser([...ALLOWED_UPLOAD_MIME_TYPES], (_request, payload, done) => {
    done(null, payload);
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    allowedHeaders: [
      'authorization',
      'content-length',
      'content-type',
      'x-craft72-upload-token',
      'x-request-id',
    ],
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    origin: allowedOrigin,
  });
  await app.register(rateLimit, {
    global: true,
    max: options.ipRateLimitMax,
    timeWindow: options.rateLimitWindowSeconds * 1_000,
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    reply.header('cache-control', 'no-store');
    return payload;
  });

  const authenticate = async (request: FastifyRequest): Promise<AuthenticatedSession> => {
    const match = AUTHORIZATION_PATTERN.exec(request.headers.authorization ?? '');
    if (match?.[1] === undefined) {
      throw new ApiHttpError(401, 'UNAUTHORIZED', 'A valid server session is required');
    }
    const session = await options.store.authenticate(match[1]);
    if (session === null) {
      throw new ApiHttpError(401, 'UNAUTHORIZED', 'The server session is invalid or expired');
    }
    if (
      session.consentVersion !== options.consentVersion ||
      session.termsVersion !== options.consentVersion
    ) {
      throw new ApiHttpError(401, 'UNAUTHORIZED', 'The privacy consent is no longer current');
    }
    if (!userRateLimiter.consume(session.maxUserId, validNow(clock))) {
      throw new ApiHttpError(429, 'RATE_LIMITED', 'Too many requests');
    }
    return session;
  };

  app.setNotFoundHandler(async (request, reply) => {
    const response = ApiErrorResponseSchema.parse({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
        requestId: request.id,
      },
    });
    await reply.status(404).send(response);
  });

  app.setErrorHandler(async (error, request, reply) => {
    let apiError: ApiHttpError;
    if (error instanceof ApiHttpError) {
      apiError = error;
    } else if (error instanceof StoreConflictError) {
      apiError = new ApiHttpError(409, 'CONFLICT', 'The request conflicts with existing data');
    } else if (error instanceof StoreUnauthorizedError) {
      apiError = new ApiHttpError(401, 'UNAUTHORIZED', 'The server session is invalid or expired');
    } else if (error instanceof StoreNotFoundError) {
      apiError =
        error.resource === 'draft'
          ? new ApiHttpError(404, 'DRAFT_NOT_FOUND', 'Draft not found')
          : new ApiHttpError(404, 'UPLOAD_NOT_FOUND', 'Uploaded material not found');
    } else if (error instanceof UploadServiceError) {
      switch (error.code) {
        case 'invalid_file':
          apiError = new ApiHttpError(
            415,
            'UNSUPPORTED_MEDIA_TYPE',
            'The uploaded file did not pass validation',
          );
          break;
        case 'conflict':
        case 'not_clean':
          apiError = new ApiHttpError(409, 'CONFLICT', 'The uploaded file is not ready');
          break;
        case 'unavailable':
          apiError = new ApiHttpError(503, 'SERVICE_UNAVAILABLE', 'File service is unavailable');
          break;
        case 'expired':
        case 'not_found':
          apiError = new ApiHttpError(404, 'UPLOAD_NOT_FOUND', 'Uploaded material not found');
          break;
      }
    } else if (error instanceof ZodError) {
      apiError = new ApiHttpError(500, 'INTERNAL_ERROR', 'The server produced an invalid response');
    } else if (getStatusCode(error) === 429) {
      apiError = new ApiHttpError(429, 'RATE_LIMITED', 'Too many requests');
    } else if (
      getStatusCode(error) === 413 ||
      getErrorCode(error) === 'FST_ERR_CTP_BODY_TOO_LARGE'
    ) {
      apiError = new ApiHttpError(413, 'PAYLOAD_TOO_LARGE', 'Request payload is too large');
    } else if (
      getStatusCode(error) === 415 ||
      getErrorCode(error) === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
    ) {
      apiError = new ApiHttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Media type is not supported');
    } else if (
      getStatusCode(error) === 400 ||
      getErrorCode(error) === 'FST_ERR_CTP_INVALID_JSON_BODY'
    ) {
      apiError = new ApiHttpError(400, 'BAD_REQUEST', 'Request body is invalid');
    } else {
      request.log.error(
        {
          errorCode: getErrorCode(error) ?? 'unknown',
          errorName: error instanceof Error ? error.name : 'UnknownError',
          requestId: request.id,
        },
        'Unhandled API error',
      );
      apiError = new ApiHttpError(500, 'INTERNAL_ERROR', 'An internal server error occurred');
    }

    const response = ApiErrorResponseSchema.parse({
      error: {
        code: apiError.code,
        message: apiError.message,
        requestId: request.id,
        ...(apiError.issues === undefined ? {} : { issues: apiError.issues }),
      },
    });
    await reply.status(apiError.statusCode).send(response);
  });

  app.get('/health/live', async () =>
    HealthLiveResponseSchema.parse({ status: 'ok', timestamp: validNow(clock).toISOString() }),
  );

  app.get('/health/ready', async (_request, reply) => {
    const startedAt = performance.now();
    let databaseReady = true;
    let scannerReady = true;
    try {
      await options.store.isReady();
    } catch {
      databaseReady = false;
    }
    if (options.uploads !== undefined) {
      try {
        await options.uploads.isReady();
      } catch {
        scannerReady = false;
      }
    }
    const status = !databaseReady ? 'unavailable' : !scannerReady ? 'degraded' : 'ok';
    const response = HealthReadyResponseSchema.parse({
      status,
      timestamp: validNow(clock).toISOString(),
      checks: {
        database: {
          status: databaseReady ? 'ok' : 'error',
          latencyMs: performance.now() - startedAt,
        },
        ...(options.uploads === undefined
          ? {}
          : { antivirus: { status: scannerReady ? 'ok' : 'error' } }),
      },
    });
    return status === 'ok' ? response : reply.status(503).send(response);
  });

  app.post('/webhooks/max', { config: { rateLimit: false } }, async (request, reply) => {
    const secretHeader = request.headers['x-max-bot-api-secret'];
    const providedSecret = typeof secretHeader === 'string' ? secretHeader : undefined;
    if (!isValidMaxWebhookSecret(providedSecret, options.maxWebhookSecret)) {
      throw new ApiHttpError(401, 'UNAUTHORIZED', 'Webhook authentication failed');
    }

    const payload = parseWithSchema(MaxWebhookUpdateSchema, request.body);
    const accepted = parseMaxWebhookUpdate(payload);
    const inserted = await options.store.acceptMaxWebhook(accepted);
    request.log.info(
      { duplicate: !inserted, eventKey: accepted.eventKey, eventType: accepted.eventType },
      'MAX webhook accepted',
    );
    return reply.status(200).send({ accepted: true, duplicate: !inserted });
  });

  app.post('/api/auth/max', async (request) => {
    const body = parseWithSchema(MaxAuthRequestSchema, request.body);
    if (body.privacyConsent.version !== options.consentVersion) {
      throw new ApiHttpError(400, 'VALIDATION_ERROR', 'Request validation failed', [
        {
          path: ['privacyConsent', 'version'],
          code: 'invalid_value',
          message: 'The privacy consent version is no longer current',
        },
      ]);
    }
    if (body.termsAcceptance.version !== options.consentVersion) {
      throw new ApiHttpError(400, 'VALIDATION_ERROR', 'Request validation failed', [
        {
          path: ['termsAcceptance', 'version'],
          code: 'invalid_value',
          message: 'The terms version is no longer current',
        },
      ]);
    }
    let validated;
    try {
      validated = validateMaxInitData(body.initData, {
        botToken: options.botToken,
        maxAgeSeconds: options.initDataMaxAgeSeconds,
        now: clock,
      });
    } catch (error) {
      if (error instanceof MaxProofError) throw proofHttpError(error);
      throw error;
    }
    return MaxAuthResponseSchema.parse(
      await options.store.createSession(validated, body.privacyConsent, body.termsAcceptance),
    );
  });

  app.post('/api/contact/verify', async (request) => {
    const session = await authenticate(request);
    const body = parseWithSchema(MaxContactVerifyRequestSchema, request.body);
    let contact;
    try {
      contact = verifyMaxContact(body, session.maxUserId, {
        botToken: options.botToken,
        maxAgeSeconds: options.contactMaxAgeSeconds,
        now: clock,
      });
    } catch (error) {
      if (error instanceof MaxProofError) {
        throw new ApiHttpError(
          401,
          'CONTACT_VERIFICATION_FAILED',
          'MAX contact proof is invalid or expired',
        );
      }
      throw error;
    }
    await options.store.setVerifiedContact(session, contact);
    return MaxContactVerifyResponseSchema.parse({
      phone: contact.phone,
      verified: true,
      verifiedAt: contact.verifiedAt.toISOString(),
    });
  });

  if (options.uploads !== undefined) {
    app.post('/api/uploads/init', async (request) => {
      const session = await authenticate(request);
      const body = parseWithSchema(UploadInitRequestSchema, request.body);
      return UploadInitResponseSchema.parse(
        await options.uploads?.initializeUpload(session.maxUserId, body),
      );
    });

    app.put(
      '/api/uploads/:id/content',
      { bodyLimit: 50 * 1024 * 1024 + 1 },
      async (request, reply) => {
        const parameters = parseWithSchema(UploadIdParamsSchema, request.params);
        const tokenHeader = request.headers['x-craft72-upload-token'];
        const token = typeof tokenHeader === 'string' ? tokenHeader : '';
        const lengthHeader = request.headers['content-length'];
        const contentLength =
          typeof lengthHeader === 'string' && /^\d+$/.test(lengthHeader)
            ? Number(lengthHeader)
            : null;
        const contentType =
          typeof request.headers['content-type'] === 'string'
            ? request.headers['content-type']
            : null;
        if (request.body === null || typeof request.body !== 'object') {
          throw new ApiHttpError(400, 'BAD_REQUEST', 'Upload body is required');
        }
        await options.uploads?.receiveUpload({
          uploadId: parameters.id,
          token,
          contentLength,
          contentType,
          input: request.body as NodeJS.ReadableStream as Readable,
        });
        await reply.status(204).send();
      },
    );

    app.post('/api/uploads/:id/complete', async (request) => {
      const session = await authenticate(request);
      const parameters = parseWithSchema(UploadIdParamsSchema, request.params);
      const body = parseWithSchema(UploadCompleteRequestSchema, request.body);
      return UploadCompleteResponseSchema.parse(
        await options.uploads?.completeUpload(session.maxUserId, parameters.id, body),
      );
    });

    app.get('/api/uploads/:id', async (request) => {
      const session = await authenticate(request);
      const parameters = parseWithSchema(UploadIdParamsSchema, request.params);
      return UploadCompleteResponseSchema.parse({
        document: await options.uploads?.getDocument(session.maxUserId, parameters.id),
      });
    });

    app.post('/api/uploads/:id/download-link', async (request) => {
      const session = await authenticate(request);
      const parameters = parseWithSchema(UploadIdParamsSchema, request.params);
      return DocumentDownloadLinkResponseSchema.parse(
        await options.uploads?.createDownloadLink(session.maxUserId, parameters.id),
      );
    });

    app.get('/files/:id', async (request, reply) => {
      const parameters = parseWithSchema(UploadIdParamsSchema, request.params);
      const query = parseWithSchema(DocumentDownloadQuerySchema, request.query);
      const file = await options.uploads?.resolveDownload(parameters.id, query);
      if (file === undefined) throw new UploadServiceError('not_found');
      reply.header('content-disposition', safeAttachmentName(file.originalName));
      reply.header('content-length', String(file.sizeBytes));
      reply.header('content-type', file.mimeType);
      return reply.send(options.uploads?.open(file.storageKey));
    });
  }

  app.get('/api/leads/draft', async (request) => {
    const session = await authenticate(request);
    return LeadDraftGetResponseSchema.parse({ draft: await options.store.getDraft(session) });
  });

  app.post('/api/leads/draft', async (request) => {
    const session = await authenticate(request);
    const body = parseWithSchema(LeadDraftUpsertRequestSchema, request.body);
    return LeadDraftUpsertResponseSchema.parse({
      draft: await options.store.upsertDraft(session, body),
    });
  });

  app.post('/api/submissions', async (request) => {
    const session = await authenticate(request);
    const body = parseWithSchema(SubmissionCreateRequestSchema, request.body);
    if (body.payload.consent.version !== options.consentVersion) {
      throw new ApiHttpError(400, 'VALIDATION_ERROR', 'Request validation failed', [
        {
          path: ['payload', 'consent', 'version'],
          code: 'invalid_value',
          message: 'The consent version is no longer current',
        },
      ]);
    }
    return SubmissionCreateResponseSchema.parse({
      submission: await options.store.createSubmission(session, body),
    });
  });

  app.get('/api/submissions/:submissionId', async (request) => {
    const session = await authenticate(request);
    const parameters = parseWithSchema(SubmissionParamsSchema, request.params);
    const submission = await options.store.getSubmission(session, parameters.submissionId);
    if (submission === null) {
      throw new ApiHttpError(404, 'SUBMISSION_NOT_FOUND', 'Submission not found');
    }
    return SubmissionReadResponseSchema.parse({ submission });
  });

  return app;
}
