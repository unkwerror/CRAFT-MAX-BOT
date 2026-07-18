import {
  AdminAuthRequestSchema,
  AdminAuthResponseSchema,
  AdminCaseCreateRequestSchema,
  AdminCaseListResponseSchema,
  AdminCaseResponseSchema,
  AdminCaseUpdateRequestSchema,
  AdminContactHandoffResponseSchema,
  AdminContentCreateRequestSchema,
  AdminContentListResponseSchema,
  AdminContentPublishRequestSchema,
  AdminContentResponseSchema,
  AdminContentUpdateRequestSchema,
  AdminSessionResponseSchema,
  AdminSubmissionListResponseSchema,
  AdminSubmissionResponseSchema,
  AdminSubmissionUpdateRequestSchema,
  AdminUserListResponseSchema,
  ApiErrorResponseSchema,
  type AdminAuthResponse,
  type AdminCase,
  type AdminCaseCreateRequest,
  type AdminCaseUpdateRequest,
  type AdminContentCreateRequest,
  type AdminContentDocument,
  type AdminContentUpdateRequest,
  type AdminSessionResponse,
  type AdminSubmissionListItem,
  type AdminSubmissionUpdateRequest,
  type AdminUserListItem,
} from '@craft72/contracts/source';

interface RuntimeSchema<T> {
  safeParse(
    input: unknown,
  ): { readonly success: true; readonly data: T } | { readonly success: false };
}

export class AdminApiError extends Error {
  public readonly code: string;
  public readonly status: number;

  public constructor(status: number, code: string) {
    super(code);
    this.name = 'AdminApiError';
    this.code = code;
    this.status = status;
  }
}

let inMemorySessionToken: string | null = null;

const isSessionToken = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 20 &&
  value.length <= 512 &&
  /^[A-Za-z0-9._~-]+$/.test(value);

const readSessionToken = (): string | null => {
  return inMemorySessionToken;
};

const storeSessionToken = (token: string): void => {
  inMemorySessionToken = isSessionToken(token) ? token : null;
};

const clearSessionToken = (): void => {
  inMemorySessionToken = null;
};

const adminRequestHeaders = (init: RequestInit): Headers => {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  const token = readSessionToken();
  if (token !== null) headers.set('authorization', `Bearer ${token}`);
  return headers;
};

const parseBody = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const request = async <T>(
  path: string,
  schema: RuntimeSchema<T>,
  init: RequestInit = {},
): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'include',
      headers: adminRequestHeaders(init),
    });
  } catch {
    throw new AdminApiError(0, 'NETWORK_ERROR');
  }

  const body = await parseBody(response);
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/admin/auth/password') clearSessionToken();
    const parsed = ApiErrorResponseSchema.safeParse(body);
    throw new AdminApiError(
      response.status,
      parsed.success ? parsed.data.error.code : 'INVALID_RESPONSE',
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AdminApiError(response.status, 'INVALID_RESPONSE');
  return parsed.data;
};

const sendWithoutResponse = async (path: string, init: RequestInit): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'include',
      headers: adminRequestHeaders(init),
    });
  } catch {
    throw new AdminApiError(0, 'NETWORK_ERROR');
  }
  if (response.ok) return;
  if (response.status === 401) clearSessionToken();
  const parsed = ApiErrorResponseSchema.safeParse(await parseBody(response));
  throw new AdminApiError(
    response.status,
    parsed.success ? parsed.data.error.code : 'INVALID_RESPONSE',
  );
};

const jsonBody = (value: unknown): string => JSON.stringify(value);

export const adminApi = {
  authenticate: async (initData: string, password: string): Promise<AdminAuthResponse> => {
    const body = AdminAuthRequestSchema.parse({ initData, password });
    const authenticated = await request('/api/admin/auth/password', AdminAuthResponseSchema, {
      body: jsonBody(body),
      method: 'POST',
    });
    storeSessionToken(authenticated.sessionToken);
    return authenticated;
  },

  getSession: async (): Promise<AdminSessionResponse> => {
    try {
      return await request('/api/admin/session', AdminSessionResponseSchema);
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 401) clearSessionToken();
      throw error;
    }
  },

  logout: async (): Promise<void> => {
    try {
      await sendWithoutResponse('/api/admin/logout', { method: 'POST' });
    } finally {
      clearSessionToken();
    }
  },

  listUsers: async (
    cursor?: string,
  ): Promise<{
    readonly items: readonly AdminUserListItem[];
    readonly nextCursor: string | null;
  }> => {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor !== undefined) query.set('cursor', cursor);
    return request(`/api/admin/users?${query.toString()}`, AdminUserListResponseSchema);
  },

  listSubmissions: async (
    filters: {
      readonly cursor?: string;
      readonly reviewStatus?: string;
    } = {},
  ): Promise<{
    readonly items: readonly AdminSubmissionListItem[];
    readonly nextCursor: string | null;
  }> => {
    const query = new URLSearchParams({ limit: '100' });
    if (filters.cursor !== undefined) query.set('cursor', filters.cursor);
    if (filters.reviewStatus !== undefined && filters.reviewStatus !== '') {
      query.set('reviewStatus', filters.reviewStatus);
    }
    return request(`/api/admin/submissions?${query.toString()}`, AdminSubmissionListResponseSchema);
  },

  updateSubmission: async (
    submissionId: string,
    input: AdminSubmissionUpdateRequest,
  ): Promise<AdminSubmissionListItem> => {
    const body = AdminSubmissionUpdateRequestSchema.parse(input);
    const response = await request(
      `/api/admin/submissions/${encodeURIComponent(submissionId)}`,
      AdminSubmissionResponseSchema,
      { body: jsonBody(body), method: 'PATCH' },
    );
    return response.submission;
  },

  queueContactHandoff: async (submissionId: string): Promise<void> => {
    await request(
      `/api/admin/submissions/${encodeURIComponent(submissionId)}/contact-handoff`,
      AdminContactHandoffResponseSchema,
      { method: 'POST' },
    );
  },

  listCases: async (): Promise<readonly AdminCase[]> =>
    (await request('/api/admin/cases', AdminCaseListResponseSchema)).items,

  createCase: async (input: AdminCaseCreateRequest): Promise<AdminCase> => {
    const body = AdminCaseCreateRequestSchema.parse(input);
    return (
      await request('/api/admin/cases', AdminCaseResponseSchema, {
        body: jsonBody(body),
        method: 'POST',
      })
    ).item;
  },

  updateCase: async (id: string, input: AdminCaseUpdateRequest): Promise<AdminCase> => {
    const body = AdminCaseUpdateRequestSchema.parse(input);
    return (
      await request(`/api/admin/cases/${encodeURIComponent(id)}`, AdminCaseResponseSchema, {
        body: jsonBody(body),
        method: 'PATCH',
      })
    ).item;
  },

  deleteCase: async (id: string, expectedVersion: number): Promise<void> => {
    const query = new URLSearchParams({ expectedVersion: String(expectedVersion) });
    await sendWithoutResponse(`/api/admin/cases/${encodeURIComponent(id)}?${query.toString()}`, {
      method: 'DELETE',
    });
  },

  listContent: async (): Promise<readonly AdminContentDocument[]> =>
    (await request('/api/admin/content', AdminContentListResponseSchema)).items,

  createContent: async (input: AdminContentCreateRequest): Promise<AdminContentDocument> => {
    const body = AdminContentCreateRequestSchema.parse(input);
    return (
      await request('/api/admin/content', AdminContentResponseSchema, {
        body: jsonBody(body),
        method: 'POST',
      })
    ).document;
  },

  updateContent: async (
    key: string,
    input: AdminContentUpdateRequest,
  ): Promise<AdminContentDocument> => {
    const body = AdminContentUpdateRequestSchema.parse(input);
    return (
      await request(`/api/admin/content/${encodeURIComponent(key)}`, AdminContentResponseSchema, {
        body: jsonBody(body),
        method: 'PUT',
      })
    ).document;
  },

  publishContent: async (key: string, expectedVersion: number): Promise<AdminContentDocument> => {
    const body = AdminContentPublishRequestSchema.parse({ expectedVersion });
    return (
      await request(
        `/api/admin/content/${encodeURIComponent(key)}/publish`,
        AdminContentResponseSchema,
        { body: jsonBody(body), method: 'POST' },
      )
    ).document;
  },

  deleteContent: async (key: string, expectedVersion: number): Promise<void> => {
    const query = new URLSearchParams({ expectedVersion: String(expectedVersion) });
    await sendWithoutResponse(`/api/admin/content/${encodeURIComponent(key)}?${query.toString()}`, {
      method: 'DELETE',
    });
  },
};
