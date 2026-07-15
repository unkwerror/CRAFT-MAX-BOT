import { z } from 'zod';

import { HttpsUrlSchema, IsoDateTimeSchema, Sha256Schema, UuidSchema } from './primitives.js';

export const MAX_UPLOAD_BYTES = 52_428_800;

export const ALLOWED_UPLOAD_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'txt',
  'jpg',
  'jpeg',
  'png',
  'dwg',
  'dxf',
  'ifc',
] as const;

export type AllowedUploadExtension = (typeof ALLOWED_UPLOAD_EXTENSIONS)[number];

export const ALLOWED_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/vnd.dwg',
  'image/x-dwg',
  'application/acad',
  'application/dwg',
  'application/x-dwg',
  'image/vnd.dxf',
  'application/dxf',
  'application/x-dxf',
  'application/step',
  'application/x-step',
  'application/octet-stream',
] as const;

export const AllowedUploadMimeTypeSchema = z.enum(ALLOWED_UPLOAD_MIME_TYPES);
export type AllowedUploadMimeType = z.infer<typeof AllowedUploadMimeTypeSchema>;

const allowedExtensionSet = new Set<string>(ALLOWED_UPLOAD_EXTENSIONS);

const mimeTypesByExtension: Readonly<
  Record<AllowedUploadExtension, readonly AllowedUploadMimeType[]>
> = {
  pdf: ['application/pdf'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  txt: ['text/plain'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  dwg: [
    'image/vnd.dwg',
    'image/x-dwg',
    'application/acad',
    'application/dwg',
    'application/x-dwg',
    'application/octet-stream',
  ],
  dxf: ['image/vnd.dxf', 'application/dxf', 'application/x-dxf', 'application/octet-stream'],
  ifc: ['application/step', 'application/x-step', 'application/octet-stream'],
};

function getFileExtension(value: string): AllowedUploadExtension | undefined {
  const extension = value.includes('.') ? value.split('.').at(-1)?.toLowerCase() : undefined;
  return extension !== undefined && allowedExtensionSet.has(extension)
    ? (extension as AllowedUploadExtension)
    : undefined;
}

function mimeTypeMatchesFileExtension(fileName: string, mimeType: AllowedUploadMimeType): boolean {
  const extension = getFileExtension(fileName);
  return extension === undefined || mimeTypesByExtension[extension].includes(mimeType);
}

function hasUnsafeFileNameCharacter(value: string): boolean {
  if (value.includes('/') || value.includes('\\')) {
    return true;
  }

  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

export const UploadFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => value !== '.' && value !== '..', 'Invalid file name')
  .refine((value) => !hasUnsafeFileNameCharacter(value), 'File name must not contain a path')
  .refine((value) => getFileExtension(value) !== undefined, 'Unsupported file extension');
export type UploadFileName = z.infer<typeof UploadFileNameSchema>;

export const UploadIdParamsSchema = z.strictObject({
  id: UuidSchema,
});
export type UploadIdParams = z.infer<typeof UploadIdParamsSchema>;

export const UploadInitRequestSchema = z
  .strictObject({
    fileName: UploadFileNameSchema,
    mimeType: AllowedUploadMimeTypeSchema,
    sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    sha256: Sha256Schema.optional(),
  })
  .superRefine((upload, context) => {
    if (!mimeTypeMatchesFileExtension(upload.fileName, upload.mimeType)) {
      context.addIssue({
        code: 'custom',
        path: ['mimeType'],
        message: 'MIME type does not match the file extension',
      });
    }
  });
export type UploadInitRequest = z.infer<typeof UploadInitRequestSchema>;

export const UploadInitResponseSchema = z.strictObject({
  uploadId: UuidSchema,
  uploadUrl: HttpsUrlSchema,
  method: z.enum(['PUT', 'POST']),
  headers: z.record(z.string().min(1).max(128), z.string().max(2_048)),
  expiresAt: IsoDateTimeSchema,
  maxBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});
export type UploadInitResponse = z.infer<typeof UploadInitResponseSchema>;

export const UploadCompleteRequestSchema = z.strictObject({
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  sha256: Sha256Schema,
});
export type UploadCompleteRequest = z.infer<typeof UploadCompleteRequestSchema>;

export const DocumentScanStatusSchema = z.enum([
  'pending',
  'scanning',
  'clean',
  'infected',
  'failed',
]);
export type DocumentScanStatus = z.infer<typeof DocumentScanStatusSchema>;

export const DocumentSchema = z
  .strictObject({
    id: UuidSchema,
    originalName: UploadFileNameSchema,
    mimeType: AllowedUploadMimeTypeSchema,
    sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    sha256: Sha256Schema,
    scanStatus: DocumentScanStatusSchema,
    createdAt: IsoDateTimeSchema,
  })
  .superRefine((document, context) => {
    if (!mimeTypeMatchesFileExtension(document.originalName, document.mimeType)) {
      context.addIssue({
        code: 'custom',
        path: ['mimeType'],
        message: 'MIME type does not match the file extension',
      });
    }
  });
export type Document = z.infer<typeof DocumentSchema>;

export const UploadCompleteResponseSchema = z.strictObject({
  document: DocumentSchema,
});
export type UploadCompleteResponse = z.infer<typeof UploadCompleteResponseSchema>;
