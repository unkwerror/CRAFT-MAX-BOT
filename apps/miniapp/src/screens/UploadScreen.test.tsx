import { MAX_UPLOAD_BYTES } from '@craft72/contracts/source';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockUploadApi } from '../mock/upload-api.js';
import { UploadScreen } from './UploadScreen.js';

const originalCrypto = globalThis.crypto;
const digest = vi.fn(async () => new Uint8Array(32).fill(0xab).buffer);

beforeEach(() => {
  digest.mockClear();
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { subtle: { digest } },
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: originalCrypto,
  });
});

describe('UploadScreen', () => {
  it('hashes and completes a valid file, then returns its document id', async () => {
    const api = new MockUploadApi({ now: () => new Date('2026-07-15T08:00:00.000Z') });
    const onDocumentAdded = vi.fn();
    const user = userEvent.setup();

    render(<UploadScreen documentIds={[]} onDocumentAdded={onDocumentAdded} uploadApi={api} />);

    const file = new File(['project brief'], 'brief.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText('Выбрать файлы'), file);

    await waitFor(() => expect(onDocumentAdded).toHaveBeenCalledTimes(1));
    const documentId = onDocumentAdded.mock.calls[0]?.[0] as string;
    expect(api.getDocument(documentId)?.sha256).toBe('ab'.repeat(32));
    expect(digest).toHaveBeenCalledWith('SHA-256', expect.any(ArrayBuffer));
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

  it('rejects an unsupported format before hashing', async () => {
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
    expect(digest).not.toHaveBeenCalled();
  });

  it('rejects a file larger than 50 MB before hashing', async () => {
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
    expect(digest).not.toHaveBeenCalled();
  });
});
