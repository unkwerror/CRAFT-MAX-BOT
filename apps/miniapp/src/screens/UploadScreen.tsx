import {
  ALLOWED_UPLOAD_EXTENSIONS,
  AllowedUploadMimeTypeSchema,
  MAX_UPLOAD_BYTES,
  UploadFileNameSchema,
  UploadInitRequestSchema,
  type AllowedUploadExtension,
  type AllowedUploadMimeType,
  type Document,
  type UploadCompleteRequest,
  type UploadCompleteResponse,
  type UploadInitRequest,
  type UploadInitResponse,
} from '@craft72/contracts/source';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';

import { InlineNotice, TextAreaField, TextField } from '../components/FormControls.js';
import { Icon } from '../components/Icon.js';
import { Page, ScreenHeader, StickyActions } from '../components/Layout.js';

const MAX_DOCUMENTS = 20;
const SCAN_POLL_INTERVAL_MILLISECONDS = 1_000;
const SCAN_POLL_REQUEST_TIMEOUT_MILLISECONDS = 5_000;
const SCAN_POLL_TIMEOUT_MILLISECONDS = 130_000;
const TERMINAL_SCAN_POLL_ERROR_CODES = new Set([
  'CONFLICT',
  'FORBIDDEN',
  'INVALID_REQUEST',
  'INVALID_RESPONSE',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'UPLOAD_NOT_FOUND',
]);
const ACCEPTED_FILE_TYPES = ALLOWED_UPLOAD_EXTENSIONS.map((extension) => `.${extension}`).join(',');

const FALLBACK_MIME_BY_EXTENSION: Readonly<Record<AllowedUploadExtension, AllowedUploadMimeType>> =
  {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    dwg: 'application/octet-stream',
    dxf: 'application/octet-stream',
    ifc: 'application/octet-stream',
  };

type Awaitable<T> = Promise<T> | T;

export interface UploadApi {
  completeUpload(uploadId: string, input: UploadCompleteRequest): Awaitable<UploadCompleteResponse>;
  getDocument(documentId: string): Document | null;
  fetchDocument?(
    documentId: string,
    options: { readonly signal: AbortSignal; readonly timeoutMilliseconds: number },
  ): Awaitable<UploadCompleteResponse>;
  initUpload(input: UploadInitRequest): Awaitable<UploadInitResponse>;
  uploadFile?(
    initialized: UploadInitResponse,
    file: File,
    options: {
      readonly onProgress: (progress: { readonly percent: number }) => void;
      readonly signal: AbortSignal;
    },
  ): Promise<void>;
}

type UploadStatus = 'checking' | 'complete' | 'error' | 'queued' | 'uploading';

interface UploadItem {
  readonly document?: Document | undefined;
  readonly error?: string | undefined;
  readonly file: File;
  readonly key: string;
  readonly progress?: number | undefined;
  readonly status: UploadStatus;
}

interface PreparedFile {
  readonly fileName: string;
  readonly mimeType: AllowedUploadMimeType;
  readonly sizeBytes: number;
}

type FilePreparation =
  | { readonly data: PreparedFile; readonly success: true }
  | { readonly error: string; readonly success: false };

class SafeUploadFlowError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SafeUploadFlowError';
  }
}

function isTerminalScanPollError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === 'string' && TERMINAL_SCAN_POLL_ERROR_CODES.has(code);
}

export interface UploadScreenProps {
  readonly description?: string;
  readonly documentLookupAuthoritative?: boolean;
  readonly documentIds: readonly string[];
  readonly fileUploadsEnabled?: boolean;
  readonly onBack?: () => void;
  readonly onDocumentAdded: (documentId: string) => void;
  readonly onDocumentDownload?: (documentId: string) => Promise<void> | void;
  readonly onDocumentRemoved?: (documentId: string) => void;
  readonly onDone?: () => void;
  readonly onDescriptionChange?: (description: string) => void;
  readonly onLinkChange?: (link: string) => void;
  readonly onToast?: (message: string) => void;
  readonly serverBacked?: boolean;
  readonly uploadApi: UploadApi;
  readonly uploadLink?: string;
}

function getAllowedExtension(fileName: string): AllowedUploadExtension | undefined {
  const extension = fileName.split('.').at(-1)?.toLowerCase();
  return ALLOWED_UPLOAD_EXTENSIONS.find((allowed) => allowed === extension);
}

function normalizeMimeType(
  file: File,
  extension: AllowedUploadExtension,
): AllowedUploadMimeType | undefined {
  const suppliedMimeType = file.type.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (suppliedMimeType === '') {
    return FALLBACK_MIME_BY_EXTENSION[extension];
  }

  const result = AllowedUploadMimeTypeSchema.safeParse(suppliedMimeType);
  return result.success ? result.data : undefined;
}

function prepareFile(file: File): FilePreparation {
  if (file.size === 0) {
    return { error: 'Файл пуст. Выберите файл с данными.', success: false };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: 'Размер файла превышает 50 МБ.', success: false };
  }

  const extension = getAllowedExtension(file.name);
  if (extension === undefined) {
    return { error: 'Формат файла не поддерживается.', success: false };
  }

  if (!UploadFileNameSchema.safeParse(file.name).success) {
    return { error: 'Недопустимое имя файла.', success: false };
  }

  const mimeType = normalizeMimeType(file, extension);
  if (mimeType === undefined) {
    return { error: 'Тип файла не поддерживается.', success: false };
  }

  const parsed = UploadInitRequestSchema.safeParse({
    fileName: file.name,
    mimeType,
    sizeBytes: file.size,
  });
  if (!parsed.success) {
    return { error: 'Расширение файла не совпадает с его типом.', success: false };
  }

  return {
    data: {
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
    },
    success: true,
  };
}

function waitForScanPoll(signal: AbortSignal, milliseconds: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new SafeUploadFlowError('Проверка файла отменена.'));
      return;
    }

    const handleAbort = (): void => {
      window.clearTimeout(timer);
      reject(new SafeUploadFlowError('Проверка файла отменена.'));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1_024) {
    return `${sizeBytes.toLocaleString('ru-RU')} Б`;
  }

  const unitSize = sizeBytes < 1_048_576 ? 1_024 : 1_048_576;
  const unit = unitSize === 1_024 ? 'КБ' : 'МБ';
  return `${(sizeBytes / unitSize).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ${unit}`;
}

function uploadStatus(item: UploadItem): { readonly error: boolean; readonly label: string } {
  switch (item.status) {
    case 'queued':
      return { error: false, label: 'В очереди' };
    case 'uploading':
      return {
        error: false,
        label: item.progress === undefined ? 'Загружаем…' : `Загружаем… ${String(item.progress)}%`,
      };
    case 'checking':
      return item.document === undefined
        ? { error: false, label: 'Проверяем файл…' }
        : documentStatus(item.document);
    case 'complete':
      return item.document === undefined
        ? { error: false, label: 'Загружен' }
        : documentStatus(item.document);
    case 'error':
      return { error: true, label: item.error ?? 'Не удалось загрузить файл.' };
  }
}

function documentStatus(document: Document): { readonly error: boolean; readonly label: string } {
  switch (document.scanStatus) {
    case 'clean':
      return { error: false, label: 'Загружен и проверен' };
    case 'pending':
      return { error: false, label: 'Ожидает проверки' };
    case 'scanning':
      return { error: false, label: 'Проверяем файл…' };
    case 'infected':
      return { error: true, label: 'Файл не прошёл проверку' };
    case 'failed':
      return { error: true, label: 'Ошибка проверки файла' };
  }
}

type FileRowProps =
  | {
      readonly document: Document;
      readonly item?: never;
      readonly onDownload?: () => void;
      readonly onRemove?: () => void;
      readonly onRetry?: never;
    }
  | {
      readonly document?: never;
      readonly item: UploadItem;
      readonly onDownload?: () => void;
      readonly onRemove?: () => void;
      readonly onRetry?: () => void;
    };

const FileRow = (props: FileRowProps) => {
  const { onDownload, onRemove, onRetry } = props;
  let name: string;
  let sizeBytes: number;
  let status: { readonly error: boolean; readonly label: string };
  if (props.document !== undefined) {
    name = props.document.originalName;
    sizeBytes = props.document.sizeBytes;
    status = documentStatus(props.document);
  } else {
    name = props.item.file.name;
    sizeBytes = props.item.file.size;
    status = uploadStatus(props.item);
  }

  return (
    <div className="file-row">
      <span className="file-row__icon">
        <Icon name="file" size={21} />
      </span>
      <div>
        <strong title={name}>{name}</strong>
        <small>{formatFileSize(sizeBytes)}</small>
        <span
          aria-live="polite"
          className={status.error ? 'file-row__status is-error' : 'file-row__status'}
        >
          {status.label}
        </span>
        {props.item?.status === 'uploading' && props.item.progress !== undefined ? (
          <progress
            aria-label={`Прогресс загрузки файла ${name}`}
            className="file-row__progress"
            max={100}
            value={props.item.progress}
          />
        ) : null}
      </div>
      {onDownload === undefined && onRemove === undefined && onRetry === undefined ? null : (
        <div className="file-row__actions">
          {onDownload === undefined ? null : (
            <button
              aria-label={`Скачать файл ${name}`}
              className="file-row__download"
              onClick={onDownload}
              type="button"
            >
              Скачать
            </button>
          )}
          {onRetry === undefined ? null : (
            <button
              aria-label={`Повторить загрузку файла ${name}`}
              className="file-row__retry"
              onClick={onRetry}
              type="button"
            >
              Повторить
            </button>
          )}
          {onRemove === undefined ? null : (
            <button
              aria-label={`Удалить файл ${name}`}
              className="file-row__remove"
              onClick={onRemove}
              type="button"
            >
              <Icon name="close" size={17} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const ReferencedFileRow = ({
  documentId,
  onRemove,
}: {
  readonly documentId: string;
  readonly onRemove?: () => void;
}) => (
  <div className="file-row">
    <span className="file-row__icon">
      <Icon name="file" size={21} />
    </span>
    <div>
      <strong>Ранее загруженный файл</strong>
      <small>Документ {documentId.slice(0, 8)}</small>
      <span className="file-row__status">Прикреплён</span>
    </div>
    {onRemove === undefined ? null : (
      <button
        aria-label={`Удалить ранее загруженный файл ${documentId.slice(0, 8)}`}
        className="file-row__remove"
        onClick={onRemove}
        type="button"
      >
        <Icon name="close" size={17} />
      </button>
    )}
  </div>
);

export const UploadScreen = ({
  description = '',
  documentLookupAuthoritative = true,
  documentIds,
  fileUploadsEnabled = true,
  onBack,
  onDocumentAdded,
  onDocumentDownload,
  onDocumentRemoved,
  onDone,
  onDescriptionChange,
  onLinkChange,
  onToast,
  serverBacked = false,
  uploadApi,
  uploadLink = '',
}: UploadScreenProps) => {
  const [items, setItems] = useState<readonly UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const dragDepth = useRef(0);
  const fileSequence = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadControllers = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const controllers = uploadControllers.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    };
  }, []);

  const updateItem = useCallback((key: string, update: Partial<UploadItem>) => {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...update } : item)),
    );
  }, []);

  const processItem = useCallback(
    async (item: UploadItem) => {
      const prepared = prepareFile(item.file);
      if (!prepared.success) {
        updateItem(item.key, { error: prepared.error, status: 'error' });
        onToast?.(prepared.error);
        return;
      }

      const controller = new AbortController();
      uploadControllers.current.set(item.key, controller);
      updateItem(item.key, {
        document: undefined,
        error: undefined,
        progress: 0,
        status: 'uploading',
      });

      let document: Document;
      try {
        const request = UploadInitRequestSchema.parse(prepared.data);
        const initialized = await uploadApi.initUpload(request);
        if (controller.signal.aborted) return;
        await uploadApi.uploadFile?.(initialized, item.file, {
          onProgress: ({ percent }) => {
            if (!controller.signal.aborted) updateItem(item.key, { progress: percent });
          },
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const completed = await uploadApi.completeUpload(initialized.uploadId, {
          sizeBytes: prepared.data.sizeBytes,
        });
        if (
          completed.document.id !== initialized.uploadId ||
          completed.document.originalName !== prepared.data.fileName ||
          completed.document.mimeType !== prepared.data.mimeType ||
          completed.document.sizeBytes !== prepared.data.sizeBytes
        ) {
          throw new Error('Completed upload metadata does not match the selected file');
        }
        document = completed.document;
        const authoritativeSha256 = document.sha256;
        if (document.scanStatus === 'pending' || document.scanStatus === 'scanning') {
          if (uploadApi.fetchDocument === undefined) {
            throw new SafeUploadFlowError('Не удалось проверить файл. Попробуйте ещё раз.');
          }
          updateItem(item.key, { document, progress: 100, status: 'checking' });
          const scanDeadline = globalThis.performance.now() + SCAN_POLL_TIMEOUT_MILLISECONDS;
          let firstPoll = true;
          while (globalThis.performance.now() < scanDeadline) {
            if (!firstPoll) {
              await waitForScanPoll(
                controller.signal,
                Math.min(
                  SCAN_POLL_INTERVAL_MILLISECONDS,
                  scanDeadline - globalThis.performance.now(),
                ),
              );
            }
            firstPoll = false;
            const remainingMilliseconds = scanDeadline - globalThis.performance.now();
            if (remainingMilliseconds <= 0) break;
            let refreshed: UploadCompleteResponse;
            try {
              refreshed = await uploadApi.fetchDocument(document.id, {
                signal: controller.signal,
                timeoutMilliseconds: Math.max(
                  1,
                  Math.floor(
                    Math.min(SCAN_POLL_REQUEST_TIMEOUT_MILLISECONDS, remainingMilliseconds),
                  ),
                ),
              });
            } catch (error) {
              if (controller.signal.aborted) return;
              if (isTerminalScanPollError(error)) {
                throw new SafeUploadFlowError('Не удалось проверить файл. Попробуйте ещё раз.');
              }
              continue;
            }
            if (
              refreshed.document.id !== document.id ||
              refreshed.document.originalName !== prepared.data.fileName ||
              refreshed.document.mimeType !== prepared.data.mimeType ||
              refreshed.document.sizeBytes !== prepared.data.sizeBytes ||
              refreshed.document.sha256 !== authoritativeSha256
            ) {
              throw new Error('Refreshed upload metadata does not match the completed upload');
            }
            document = refreshed.document;
            updateItem(item.key, { document, progress: 100, status: 'checking' });
            if (document.scanStatus === 'clean') break;
            if (document.scanStatus === 'infected') {
              throw new SafeUploadFlowError('Файл не прошёл проверку безопасности.');
            }
            if (document.scanStatus === 'failed') {
              throw new SafeUploadFlowError('Не удалось проверить файл. Попробуйте ещё раз.');
            }
          }
          if (document.scanStatus !== 'clean') {
            throw new SafeUploadFlowError(
              'Проверка файла занимает слишком много времени. Попробуйте позже.',
            );
          }
        } else if (document.scanStatus === 'infected') {
          throw new SafeUploadFlowError('Файл не прошёл проверку безопасности.');
        } else if (document.scanStatus === 'failed') {
          throw new SafeUploadFlowError('Не удалось проверить файл. Попробуйте ещё раз.');
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const message =
          error instanceof SafeUploadFlowError
            ? error.message
            : 'Не удалось загрузить файл. Попробуйте ещё раз.';
        updateItem(item.key, { error: message, status: 'error' });
        onToast?.(message);
        return;
      } finally {
        uploadControllers.current.delete(item.key);
      }

      updateItem(item.key, { document, progress: 100, status: 'complete' });
      onDocumentAdded(document.id);
      onToast?.(`Файл «${document.originalName}» загружен`);
    },
    [onDocumentAdded, onToast, updateItem, uploadApi],
  );

  const addFiles = useCallback(
    (fileList: FileList | readonly File[]) => {
      if (!fileUploadsEnabled) {
        onToast?.('Загрузка файлов будет доступна после подключения защищённого хранилища');
        return;
      }
      const selectedFiles = Array.from(fileList);
      if (selectedFiles.length === 0) return;

      setSelectionMessage(null);

      const currentItems = items;
      const uploadedIds = new Set(documentIds);
      for (const item of currentItems) {
        if (item.document !== undefined) uploadedIds.add(item.document.id);
      }
      const localRowsWithoutDocument = currentItems.filter(
        (item) => item.document === undefined,
      ).length;
      const availableSlots = Math.max(
        0,
        MAX_DOCUMENTS - uploadedIds.size - localRowsWithoutDocument,
      );
      const acceptedFiles = selectedFiles.slice(0, availableSlots);

      if (acceptedFiles.length < selectedFiles.length) {
        const message = 'Можно прикрепить не более 20 файлов.';
        setSelectionMessage(message);
        onToast?.(message);
      }

      if (acceptedFiles.length === 0) return;

      const queuedItems = acceptedFiles.map<UploadItem>((file) => {
        fileSequence.current += 1;
        return {
          file,
          key: `${String(fileSequence.current)}:${file.name}:${String(file.lastModified)}`,
          status: 'queued',
        };
      });

      setItems((current) => [...current, ...queuedItems]);

      void (async () => {
        for (const item of queuedItems) {
          await processItem(item);
        }
      })();
    },
    [documentIds, fileUploadsEnabled, items, onToast, processItem],
  );

  const localDocumentIds = useMemo(
    () => new Set(items.flatMap((item) => (item.document === undefined ? [] : [item.document.id]))),
    [items],
  );

  const externalDocuments = useMemo(() => {
    const seen = new Set<string>();
    const documents: Document[] = [];
    for (const documentId of documentIds) {
      if (seen.has(documentId) || localDocumentIds.has(documentId)) continue;
      seen.add(documentId);
      try {
        const document = uploadApi.getDocument(documentId);
        if (document !== null) documents.push(document);
      } catch {
        // A stale or malformed draft reference must not break the upload screen.
      }
    }
    return documents;
  }, [documentIds, localDocumentIds, uploadApi]);

  const staleDocumentIds = useMemo(
    () =>
      documentLookupAuthoritative
        ? documentIds.filter((documentId) => {
            if (localDocumentIds.has(documentId)) return false;
            try {
              return uploadApi.getDocument(documentId) === null;
            } catch {
              return true;
            }
          })
        : [],
    [documentIds, documentLookupAuthoritative, localDocumentIds, uploadApi],
  );

  const unresolvedDocumentIds = useMemo(
    () =>
      documentLookupAuthoritative
        ? []
        : documentIds.filter((documentId, index) => {
            if (documentIds.indexOf(documentId) !== index || localDocumentIds.has(documentId)) {
              return false;
            }
            try {
              return uploadApi.getDocument(documentId) === null;
            } catch {
              return true;
            }
          }),
    [documentIds, documentLookupAuthoritative, localDocumentIds, uploadApi],
  );

  const retryItem = useCallback(
    (item: UploadItem) => {
      if (item.status !== 'error') return;
      updateItem(item.key, {
        document: undefined,
        error: undefined,
        progress: undefined,
        status: 'queued',
      });
      void processItem(item);
    },
    [processItem, updateItem],
  );

  const removeItem = useCallback(
    (item: UploadItem) => {
      if (item.status !== 'complete' && item.status !== 'error') return;
      setItems((current) => current.filter((candidate) => candidate.key !== item.key));
      if (item.document !== undefined) onDocumentRemoved?.(item.document.id);
    },
    [onDocumentRemoved],
  );

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.currentTarget.files !== null) addFiles(event.currentTarget.files);
    event.currentTarget.value = '';
  };

  const handleDragEnter = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const handleDropzoneKeyDown = (event: KeyboardEvent<HTMLLabelElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    inputRef.current?.click();
  };

  const hasPendingUploads = items.some(
    (item) => item.status === 'checking' || item.status === 'queued' || item.status === 'uploading',
  );
  const hasFileRows =
    externalDocuments.length > 0 || unresolvedDocumentIds.length > 0 || items.length > 0;
  const hasAttachedDocuments =
    externalDocuments.length > 0 ||
    unresolvedDocumentIds.length > 0 ||
    items.some((item) => item.status === 'complete');

  return (
    <Page className="page--narrow" withNavigation={false}>
      <div className="page-stack">
        <ScreenHeader
          eyebrow="Материалы проекта"
          {...(onBack === undefined ? {} : { onBack })}
          subtitle="Приложите техническое задание, планы, фото или BIM/CAD-файлы."
          title="Загрузка файлов"
        />

        <InlineNotice icon="shield" {...(fileUploadsEnabled ? {} : { tone: 'warning' })}>
          <strong>
            {serverBacked
              ? 'Защищённая загрузка'
              : fileUploadsEnabled
                ? 'Демонстрационная загрузка'
                : 'Файловое хранилище подключается'}
          </strong>
          {serverBacked
            ? 'Файлы передаются в закрытое хранилище и связываются только с вашей MAX-сессией.'
            : fileUploadsEnabled
              ? 'В web preview сохраняются только mock-метаданные файла.'
              : 'Файлы пока не передаются на сервер. Добавьте HTTPS-ссылку на защищённое облако.'}
        </InlineNotice>

        <section aria-labelledby="upload-heading" className="form-card">
          <h2 className="form-card__title" id="upload-heading">
            Добавьте материалы
          </h2>
          <p className="form-card__subtitle">
            До 20 файлов, каждый не больше 50 МБ. Поддерживаются PDF, DOC(X), XLS(X), TXT, JPG, PNG,
            DWG, DXF и IFC.
          </p>

          <label
            aria-disabled={!fileUploadsEnabled}
            className={`${isDragging ? 'dropzone is-dragging' : 'dropzone'}${fileUploadsEnabled ? '' : ' is-disabled'}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onKeyDown={handleDropzoneKeyDown}
            tabIndex={fileUploadsEnabled ? 0 : -1}
          >
            <input
              accept={ACCEPTED_FILE_TYPES}
              aria-label="Выбрать файлы"
              disabled={!fileUploadsEnabled}
              multiple
              onChange={handleChange}
              ref={inputRef}
              tabIndex={-1}
              type="file"
            />
            <span>
              <span className="dropzone__icon">
                <Icon name="upload" size={25} />
              </span>
              <strong>Перетащите файлы сюда</strong>
              <small>или нажмите, чтобы выбрать на устройстве</small>
            </span>
          </label>
        </section>

        {onDescriptionChange === undefined && onLinkChange === undefined ? null : (
          <section className="form-card">
            <h2 className="form-card__title">Комментарий к материалам</h2>
            <p className="form-card__subtitle">Эти поля сохраняются в общий черновик.</p>
            <div className="form-stack">
              {onDescriptionChange === undefined ? null : (
                <TextAreaField
                  label="Кратко опишите задачу"
                  onChange={onDescriptionChange}
                  placeholder="Что находится в материалах и какой результат нужен"
                  rows={4}
                  value={description}
                />
              )}
              {onLinkChange === undefined ? null : (
                <TextField
                  inputMode="url"
                  label="HTTPS-ссылка на облако"
                  onChange={onLinkChange}
                  optional
                  placeholder="https://disk.example.ru/project"
                  type="url"
                  value={uploadLink}
                />
              )}
            </div>
          </section>
        )}

        {selectionMessage === null ? null : (
          <InlineNotice icon="paperclip" tone="warning">
            <strong>Не все файлы добавлены</strong>
            {selectionMessage}
          </InlineNotice>
        )}

        {staleDocumentIds.length === 0 ? null : (
          <InlineNotice icon="warning" tone="warning">
            <strong>Часть mock-файлов недоступна после восстановления</strong>
            Удалите недоступные ссылки и прикрепите файлы повторно.
            {onDocumentRemoved === undefined ? null : (
              <button
                className="save-exit"
                onClick={() => staleDocumentIds.forEach(onDocumentRemoved)}
                type="button"
              >
                Удалить недоступные файлы
              </button>
            )}
          </InlineNotice>
        )}

        {hasFileRows ? (
          <section aria-labelledby="files-heading" className="content-card">
            <h2 className="form-card__title" id="files-heading">
              Прикреплённые файлы
            </h2>
            <div className="file-list">
              {externalDocuments.map((document) => (
                <FileRow
                  document={document}
                  key={document.id}
                  {...(onDocumentDownload === undefined || document.scanStatus !== 'clean'
                    ? {}
                    : { onDownload: () => onDocumentDownload(document.id) })}
                  {...(onDocumentRemoved === undefined
                    ? {}
                    : { onRemove: () => onDocumentRemoved(document.id) })}
                />
              ))}
              {unresolvedDocumentIds.map((documentId) => (
                <ReferencedFileRow
                  documentId={documentId}
                  key={documentId}
                  {...(onDocumentRemoved === undefined
                    ? {}
                    : { onRemove: () => onDocumentRemoved(documentId) })}
                />
              ))}
              {items.map((item) => {
                const downloadableDocument =
                  item.document?.scanStatus === 'clean' ? item.document : null;
                return (
                  <FileRow
                    item={item}
                    key={item.key}
                    {...(onDocumentDownload === undefined || downloadableDocument === null
                      ? {}
                      : {
                          onDownload: () => onDocumentDownload(downloadableDocument.id),
                        })}
                    {...(item.status === 'error' ? { onRetry: () => retryItem(item) } : {})}
                    {...(item.status === 'error' ||
                    (item.status === 'complete' && onDocumentRemoved !== undefined)
                      ? { onRemove: () => removeItem(item) }
                      : {})}
                  />
                );
              })}
            </div>
          </section>
        ) : null}

        <InlineNotice icon="paperclip" tone="warning">
          <strong>Очень большой архив или закрытый BIM-проект?</strong>
          Добавьте HTTPS-ссылку на облако в описании проекта.
        </InlineNotice>
      </div>

      {onDone === undefined ? null : (
        <StickyActions
          continueDisabled={hasPendingUploads}
          continueLabel={hasAttachedDocuments ? 'Продолжить' : 'Продолжить без файлов'}
          {...(onBack === undefined ? {} : { onBack })}
          onContinue={onDone}
        />
      )}
    </Page>
  );
};
