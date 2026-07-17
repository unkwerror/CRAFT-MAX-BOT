import { MAX_UPLOAD_BYTES, type Document } from '@craft72/contracts/source';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MockUploadApi } from '../mock/upload-api.js';
import { UploadScreen } from './UploadScreen.js';

const UPLOAD_ID = '20000000-0000-4000-8000-000000000002';

const SERVER_DOCUMENT: Document = {
  id: UPLOAD_ID,
  originalName: 'brief.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 13,
  sha256: 'ab'.repeat(32),
  scanStatus: 'pending',
  createdAt: '2026-07-16T08:00:00.000Z',
};

const SERVER_UPLOAD = {
  uploadId: UPLOAD_ID,
  uploadUrl: `https://craft72app.ru/api/uploads/${UPLOAD_ID}/content`,
  method: 'PUT',
  headers: {
    'Content-Type': 'application/pdf',
    'X-Craft72-Upload-Token': 'B'.repeat(43),
  },
  expiresAt: '2026-07-16T08:15:00.000Z',
  maxBytes: MAX_UPLOAD_BYTES,
} as const;

afterEach(() => {
  cleanup();
});

describe('UploadScreen', () => {
  it('completes a valid file without buffering it for a client-side hash', async () => {
    const api = new MockUploadApi({ now: () => new Date('2026-07-15T08:00:00.000Z') });
    const onDocumentAdded = vi.fn();
    const user = userEvent.setup();

    render(<UploadScreen documentIds={[]} onDocumentAdded={onDocumentAdded} uploadApi={api} />);

    const file = new File(['project brief'], 'brief.pdf', { type: 'application/pdf' });
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(file.size));
    Object.defineProperty(file, 'arrayBuffer', { configurable: true, value: arrayBuffer });
    await user.upload(screen.getByLabelText('Выбрать файлы'), file);

    await waitFor(() => expect(onDocumentAdded).toHaveBeenCalledTimes(1));
    const documentId = onDocumentAdded.mock.calls[0]?.[0] as string;
    expect(api.getDocument(documentId)?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(screen.queryByText('Загружен и проверен')).not.toBeNull();
  });

  it('accepts a valid file dropped onto the dropzone', async () => {
    const api = new MockUploadApi();
    const onDocumentAdded = vi.fn();
    render(<UploadScreen documentIds={[]} onDocumentAdded={onDocumentAdded} uploadApi={api} />);

    const dropzone = screen.getByText('Перетащите файлы сюда').closest('label');
    expect(dropzone).not.toBeNull();
    const file = new File(['drawing'], 'plan.dwg', { type: '' });
    fireEvent.drop(dropzone as HTMLLabelElement, {
      dataTransfer: { files: [file], types: ['Files'] },
    });

    await waitFor(() => expect(onDocumentAdded).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('plan.dwg')).not.toBeNull();
  });

  it('rejects an unsupported format before upload initialization', async () => {
    const onDocumentAdded = vi.fn();
    const user = userEvent.setup({ applyAccept: false });
    render(
      <UploadScreen
        documentIds={[]}
        onDocumentAdded={onDocumentAdded}
        uploadApi={new MockUploadApi()}
      />,
    );

    await user.upload(
      screen.getByLabelText('Выбрать файлы'),
      new File(['binary'], 'archive.exe', { type: 'application/octet-stream' }),
    );

    await waitFor(() =>
      expect(screen.queryByText('Формат файла не поддерживается.')).not.toBeNull(),
    );
    expect(onDocumentAdded).not.toHaveBeenCalled();
  });

  it('rejects a file larger than 50 MB before upload initialization', async () => {
    const onDocumentAdded = vi.fn();
    const user = userEvent.setup();
    const file = new File(['oversized'], 'oversized.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { configurable: true, value: MAX_UPLOAD_BYTES + 1 });

    render(
      <UploadScreen
        documentIds={[]}
        onDocumentAdded={onDocumentAdded}
        uploadApi={new MockUploadApi()}
      />,
    );

    await user.upload(screen.getByLabelText('Выбрать файлы'), file);

    await waitFor(() => expect(screen.queryByText('Размер файла превышает 50 МБ.')).not.toBeNull());
    expect(onDocumentAdded).not.toHaveBeenCalled();
  });

  it('runs the authenticated init, byte-transfer, and complete flow with progress', async () => {
    let finishTransfer!: () => void;
    let reportProgress!: (progress: { readonly percent: number }) => void;
    const transfer = new Promise<void>((resolve) => {
      finishTransfer = resolve;
    });
    const uploadApi = {
      completeUpload: vi.fn(async () => ({ document: SERVER_DOCUMENT })),
      fetchDocument: vi.fn(async () => ({
        document: { ...SERVER_DOCUMENT, scanStatus: 'clean' as const },
      })),
      getDocument: vi.fn(() => null),
      initUpload: vi.fn(async () => SERVER_UPLOAD),
      uploadFile: vi.fn(
        async (
          _initialized: typeof SERVER_UPLOAD,
          _file: File,
          options: { readonly onProgress: (progress: { readonly percent: number }) => void },
        ) => {
          reportProgress = options.onProgress;
          await transfer;
        },
      ),
    };
    const onDocumentAdded = vi.fn();
    const user = userEvent.setup();

    render(
      <UploadScreen
        documentIds={[]}
        onDocumentAdded={onDocumentAdded}
        serverBacked
        uploadApi={uploadApi}
      />,
    );

    const file = new File(['project brief'], 'brief.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText('Выбрать файлы'), file);
    await waitFor(() => expect(uploadApi.uploadFile).toHaveBeenCalledTimes(1));

    act(() => reportProgress({ percent: 42 }));
    expect(await screen.findByText('Загружаем… 42%')).toBeTruthy();
    expect(
      screen.getByRole('progressbar', { name: 'Прогресс загрузки файла brief.pdf' }),
    ).toHaveProperty('value', 42);

    await act(async () => finishTransfer());
    await waitFor(() => expect(onDocumentAdded).toHaveBeenCalledWith(UPLOAD_ID));

    expect(uploadApi.initUpload).toHaveBeenCalledWith({
      fileName: 'brief.pdf',
      mimeType: 'application/pdf',
      sizeBytes: file.size,
    });
    expect(uploadApi.uploadFile).toHaveBeenCalledWith(
      SERVER_UPLOAD,
      file,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(uploadApi.completeUpload).toHaveBeenCalledWith(UPLOAD_ID, {
      sizeBytes: file.size,
    });
    expect(uploadApi.initUpload.mock.invocationCallOrder[0]).toBeLessThan(
      uploadApi.uploadFile.mock.invocationCallOrder[0] ?? 0,
    );
    expect(uploadApi.uploadFile.mock.invocationCallOrder[0]).toBeLessThan(
      uploadApi.completeUpload.mock.invocationCallOrder[0] ?? 0,
    );
    expect(uploadApi.fetchDocument).toHaveBeenCalledWith(
      UPLOAD_ID,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        timeoutMilliseconds: expect.any(Number),
      }),
    );
    expect(uploadApi.completeUpload.mock.invocationCallOrder[0]).toBeLessThan(
      uploadApi.fetchDocument.mock.invocationCallOrder[0] ?? 0,
    );
    expect(screen.getByText('Защищённая загрузка')).toBeTruthy();
    expect(screen.getByText('Загружен и проверен')).toBeTruthy();
  });

  it('polls scanning status at one-second intervals and blocks completion until clean', async () => {
    const uploadApi = {
      completeUpload: vi.fn(async () => ({ document: SERVER_DOCUMENT })),
      fetchDocument: vi
        .fn()
        .mockResolvedValueOnce({
          document: { ...SERVER_DOCUMENT, scanStatus: 'scanning' as const },
        })
        .mockResolvedValueOnce({
          document: { ...SERVER_DOCUMENT, scanStatus: 'clean' as const },
        }),
      getDocument: vi.fn(() => null),
      initUpload: vi.fn(async () => SERVER_UPLOAD),
      uploadFile: vi.fn(async () => undefined),
    };
    const onDocumentAdded = vi.fn();
    const user = userEvent.setup();
    render(
      <UploadScreen
        documentIds={[]}
        onDocumentAdded={onDocumentAdded}
        onDone={vi.fn()}
        serverBacked
        uploadApi={uploadApi}
      />,
    );

    await user.upload(
      screen.getByLabelText('Выбрать файлы'),
      new File(['project brief'], 'brief.pdf', { type: 'application/pdf' }),
    );

    expect(await screen.findByText('Проверяем файл…')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Без файлов' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await waitFor(() => expect(onDocumentAdded).toHaveBeenCalledWith(UPLOAD_ID), {
      timeout: 2_500,
    });
    expect(uploadApi.fetchDocument).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Загружен и проверен')).toBeTruthy();
  });

  it('does not attach a document rejected by the security scan', async () => {
    const uploadApi = {
      completeUpload: vi.fn(async () => ({ document: SERVER_DOCUMENT })),
      fetchDocument: vi.fn(async () => ({
        document: { ...SERVER_DOCUMENT, scanStatus: 'infected' as const },
      })),
      getDocument: vi.fn(() => null),
      initUpload: vi.fn(async () => SERVER_UPLOAD),
      uploadFile: vi.fn(async () => undefined),
    };
    const onDocumentAdded = vi.fn();
    render(
      <UploadScreen documentIds={[]} onDocumentAdded={onDocumentAdded} uploadApi={uploadApi} />,
    );

    fireEvent.change(screen.getByLabelText('Выбрать файлы'), {
      target: {
        files: [new File(['project brief'], 'brief.pdf', { type: 'application/pdf' })],
      },
    });

    expect(await screen.findByText('Файл не прошёл проверку безопасности.')).toBeTruthy();
    expect(onDocumentAdded).not.toHaveBeenCalled();
  });

  it('shows an upload error and retries the same file safely', async () => {
    const uploadApi = {
      completeUpload: vi.fn(async () => ({
        document: { ...SERVER_DOCUMENT, scanStatus: 'clean' as const },
      })),
      getDocument: vi.fn(() => null),
      initUpload: vi.fn(async () => SERVER_UPLOAD),
      uploadFile: vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error('private storage diagnostics'))
        .mockResolvedValueOnce(undefined),
    };
    const onDocumentAdded = vi.fn();
    const onToast = vi.fn();
    const user = userEvent.setup();
    render(
      <UploadScreen
        documentIds={[]}
        onDocumentAdded={onDocumentAdded}
        onToast={onToast}
        serverBacked
        uploadApi={uploadApi}
      />,
    );

    await user.upload(
      screen.getByLabelText('Выбрать файлы'),
      new File(['project brief'], 'brief.pdf', { type: 'application/pdf' }),
    );
    expect(await screen.findByText('Не удалось загрузить файл. Попробуйте ещё раз.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('private storage diagnostics');

    await user.click(screen.getByRole('button', { name: 'Повторить загрузку файла brief.pdf' }));
    await waitFor(() => expect(onDocumentAdded).toHaveBeenCalledWith(UPLOAD_ID));

    expect(uploadApi.initUpload).toHaveBeenCalledTimes(2);
    expect(uploadApi.uploadFile).toHaveBeenCalledTimes(2);
    expect(uploadApi.completeUpload).toHaveBeenCalledTimes(1);
  });

  it('offers signed download only for a clean authenticated document', async () => {
    const cleanDocument = { ...SERVER_DOCUMENT, scanStatus: 'clean' as const };
    const onDocumentDownload = vi.fn();
    const uploadApi = {
      completeUpload: vi.fn(),
      getDocument: vi.fn(() => cleanDocument),
      initUpload: vi.fn(),
    };
    render(
      <UploadScreen
        documentIds={[UPLOAD_ID]}
        documentLookupAuthoritative={false}
        onDocumentAdded={vi.fn()}
        onDocumentDownload={onDocumentDownload}
        serverBacked
        uploadApi={uploadApi}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Скачать файл brief.pdf' }));

    expect(onDocumentDownload).toHaveBeenCalledWith(UPLOAD_ID);
  });
});
