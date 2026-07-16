import { open, stat } from 'node:fs/promises';

import type { AllowedUploadMimeType, UploadFileName } from '@craft72/contracts';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_MAX_TAIL_BYTES = 65_557;
const ZIP_MAX_CENTRAL_DIRECTORY_BYTES = 4 * 1024 * 1024;
const ZIP_MAX_ENTRIES = 10_000;
// Keep every OOXML entry and the whole container below the ClamAV production scan envelope.
const ZIP_MAX_UNCOMPRESSED_BYTES = 40 * 1024 * 1024;
const ZIP_MAX_COMPRESSION_RATIO = 100;

export type FileValidationErrorCode = 'archive_unsafe' | 'signature_mismatch';

export interface DetectedFileFacts {
  readonly detectedFileType: string;
  readonly detectedMimeType: AllowedUploadMimeType;
}

export class FileValidationError extends Error {
  public readonly code: FileValidationErrorCode;

  public constructor(code: FileValidationErrorCode) {
    super(
      code === 'archive_unsafe' ? 'The archive container is unsafe' : 'File signature mismatch',
    );
    this.name = 'FileValidationError';
    this.code = code;
  }
}

function extensionOf(fileName: UploadFileName): string {
  return fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
}

function startsWith(buffer: Buffer, signature: Buffer): boolean {
  return (
    buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature)
  );
}

function signatureMismatch(): never {
  throw new FileValidationError('signature_mismatch');
}

function unsafeArchive(): never {
  throw new FileValidationError('archive_unsafe');
}

function lastIndexOfUInt32LE(buffer: Buffer, value: number): number {
  for (let offset = buffer.length - 4; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === value) return offset;
  }
  return -1;
}

function safeZipEntryName(value: string): boolean {
  if (value.length === 0 || value.includes('\0') || value.includes('\\')) return false;
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  return !value.split('/').some((segment) => segment === '..');
}

async function validateOfficeOpenXml(path: string, extension: 'docx' | 'xlsx'): Promise<void> {
  const file = await open(path, 'r');
  try {
    const metadata = await file.stat();
    const tailLength = Math.min(metadata.size, ZIP_MAX_TAIL_BYTES);
    const tail = Buffer.alloc(tailLength);
    await file.read(tail, 0, tail.length, metadata.size - tailLength);
    const endOffset = lastIndexOfUInt32LE(tail, ZIP_EOCD_SIGNATURE);
    if (endOffset < 0 || endOffset + 22 > tail.length) signatureMismatch();

    const diskNumber = tail.readUInt16LE(endOffset + 4);
    const centralDisk = tail.readUInt16LE(endOffset + 6);
    const entriesOnDisk = tail.readUInt16LE(endOffset + 8);
    const entryCount = tail.readUInt16LE(endOffset + 10);
    const centralSize = tail.readUInt32LE(endOffset + 12);
    const centralOffset = tail.readUInt32LE(endOffset + 16);
    const commentLength = tail.readUInt16LE(endOffset + 20);
    if (
      diskNumber !== 0 ||
      centralDisk !== 0 ||
      entriesOnDisk !== entryCount ||
      entryCount === 0 ||
      entryCount === 0xffff ||
      centralSize === 0xffffffff ||
      centralOffset === 0xffffffff ||
      entryCount > ZIP_MAX_ENTRIES ||
      centralSize > ZIP_MAX_CENTRAL_DIRECTORY_BYTES ||
      centralOffset + centralSize > metadata.size ||
      endOffset + 22 + commentLength > tail.length
    ) {
      unsafeArchive();
    }

    const central = Buffer.alloc(centralSize);
    await file.read(central, 0, central.length, centralOffset);
    let offset = 0;
    let totalCompressed = 0;
    let totalUncompressed = 0;
    let hasContentTypes = false;
    let hasApplicationEntry = false;

    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > central.length || central.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE) {
        unsafeArchive();
      }
      const flags = central.readUInt16LE(offset + 8);
      const compressionMethod = central.readUInt16LE(offset + 10);
      const compressedSize = central.readUInt32LE(offset + 20);
      const uncompressedSize = central.readUInt32LE(offset + 24);
      const nameLength = central.readUInt16LE(offset + 28);
      const extraLength = central.readUInt16LE(offset + 30);
      const entryCommentLength = central.readUInt16LE(offset + 32);
      const localOffset = central.readUInt32LE(offset + 42);
      const recordLength = 46 + nameLength + extraLength + entryCommentLength;
      if (
        nameLength === 0 ||
        offset + recordLength > central.length ||
        (flags & 0x0001) !== 0 ||
        (compressionMethod !== 0 && compressionMethod !== 8) ||
        compressedSize === 0xffffffff ||
        uncompressedSize === 0xffffffff ||
        uncompressedSize > ZIP_MAX_UNCOMPRESSED_BYTES ||
        localOffset === 0xffffffff ||
        localOffset + 30 > centralOffset
      ) {
        unsafeArchive();
      }

      const name = central.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
      if (!safeZipEntryName(name)) unsafeArchive();
      const localHeader = Buffer.alloc(30);
      await file.read(localHeader, 0, localHeader.length, localOffset);
      if (
        localHeader.readUInt32LE(0) !== ZIP_LOCAL_SIGNATURE ||
        localHeader.readUInt16LE(6) !== flags ||
        localHeader.readUInt16LE(8) !== compressionMethod
      ) {
        unsafeArchive();
      }
      const localNameLength = localHeader.readUInt16LE(26);
      const localExtraLength = localHeader.readUInt16LE(28);
      const localDataOffset = localOffset + 30 + localNameLength + localExtraLength;
      if (localDataOffset + compressedSize > centralOffset) unsafeArchive();
      const localName = Buffer.alloc(localNameLength);
      await file.read(localName, 0, localName.length, localOffset + 30);
      if (localName.toString('utf8') !== name) unsafeArchive();
      if (name === '[Content_Types].xml') hasContentTypes = true;
      if (name === (extension === 'docx' ? 'word/document.xml' : 'xl/workbook.xml')) {
        hasApplicationEntry = true;
      }

      totalCompressed += compressedSize;
      totalUncompressed += uncompressedSize;
      if (
        totalUncompressed > ZIP_MAX_UNCOMPRESSED_BYTES ||
        totalUncompressed > Math.max(totalCompressed, 1) * ZIP_MAX_COMPRESSION_RATIO
      ) {
        unsafeArchive();
      }
      offset += recordLength;
    }

    if (offset !== central.length || !hasContentTypes || !hasApplicationEntry) signatureMismatch();
  } finally {
    await file.close();
  }
}

async function readPrefix(path: string, maximumBytes = 8_192): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const metadata = await file.stat();
    const buffer = Buffer.alloc(Math.min(metadata.size, maximumBytes));
    await file.read(buffer, 0, buffer.length, 0);
    return buffer;
  } finally {
    await file.close();
  }
}

/** Validates a bounded prefix or ZIP central directory; it never loads the whole upload into RAM. */
export async function validateStoredFile(
  path: string,
  fileName: UploadFileName,
  _mimeType: AllowedUploadMimeType,
): Promise<DetectedFileFacts> {
  const extension = extensionOf(fileName);
  const prefix = await readPrefix(path);

  switch (extension) {
    case 'pdf':
      if (!prefix.subarray(0, 5).equals(Buffer.from('%PDF-'))) signatureMismatch();
      return { detectedFileType: 'pdf', detectedMimeType: 'application/pdf' };
    case 'jpg':
    case 'jpeg':
      if (!(prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff)) signatureMismatch();
      return { detectedFileType: 'jpeg', detectedMimeType: 'image/jpeg' };
    case 'png':
      if (!startsWith(prefix, PNG_SIGNATURE)) signatureMismatch();
      return { detectedFileType: 'png', detectedMimeType: 'image/png' };
    case 'doc':
      if (!startsWith(prefix, OLE_SIGNATURE)) signatureMismatch();
      return { detectedFileType: 'doc', detectedMimeType: 'application/msword' };
    case 'xls':
      if (!startsWith(prefix, OLE_SIGNATURE)) signatureMismatch();
      return { detectedFileType: 'xls', detectedMimeType: 'application/vnd.ms-excel' };
    case 'docx':
      if (!(prefix[0] === 0x50 && prefix[1] === 0x4b)) signatureMismatch();
      await validateOfficeOpenXml(path, extension);
      return {
        detectedFileType: 'docx',
        detectedMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
    case 'xlsx':
      if (!(prefix[0] === 0x50 && prefix[1] === 0x4b)) signatureMismatch();
      await validateOfficeOpenXml(path, extension);
      return {
        detectedFileType: 'xlsx',
        detectedMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    case 'txt':
      if (prefix.includes(0)) signatureMismatch();
      return { detectedFileType: 'txt', detectedMimeType: 'text/plain' };
    case 'dwg':
      if (!/^AC10\d{2}/.test(prefix.subarray(0, 6).toString('ascii'))) signatureMismatch();
      return { detectedFileType: 'dwg', detectedMimeType: 'application/dwg' };
    case 'dxf': {
      const binarySignature = Buffer.from('AutoCAD Binary DXF\r\n\x1a\0', 'binary');
      const text = prefix
        .toString('utf8')
        .replace(/^\uFEFF/, '')
        .trimStart();
      if (!startsWith(prefix, binarySignature) && !/^0\s+SECTION(?:\s|$)/.test(text)) {
        signatureMismatch();
      }
      return { detectedFileType: 'dxf', detectedMimeType: 'application/dxf' };
    }
    case 'ifc':
      if (
        !prefix
          .toString('utf8')
          .replace(/^\uFEFF/, '')
          .trimStart()
          .startsWith('ISO-10303-21;')
      ) {
        signatureMismatch();
      }
      return { detectedFileType: 'ifc', detectedMimeType: 'application/step' };
    default:
      signatureMismatch();
  }
}

export async function assertRegularFile(path: string): Promise<void> {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new FileValidationError('signature_mismatch');
}
