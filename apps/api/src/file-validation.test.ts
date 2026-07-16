import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { validateStoredFile, type FileValidationError } from './file-validation.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function temporaryFile(name: string, contents: Buffer | string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'craft72-file-test-'));
  temporaryDirectories.push(directory);
  const path = join(directory, name);
  await writeFile(path, contents);
  return path;
}

function storedZip(entries: readonly { readonly name: string; readonly data: Buffer }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + entry.data.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, central, end]);
}

describe('stored file validation', () => {
  it('accepts exact PDF, image, CAD and IFC signatures', async () => {
    const fixtures = [
      ['brief.pdf', 'application/pdf', Buffer.from('%PDF-1.7\n')],
      ['photo.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])],
      ['model.dwg', 'application/octet-stream', Buffer.from('AC1027fixture')],
      ['drawing.dxf', 'application/octet-stream', Buffer.from('0\r\nSECTION\r\n')],
      ['model.ifc', 'application/octet-stream', Buffer.from('ISO-10303-21;\nHEADER;')],
    ] as const;

    for (const [name, mimeType, contents] of fixtures) {
      const path = await temporaryFile(name, contents);
      await expect(validateStoredFile(path, name, mimeType)).resolves.toBeDefined();
    }
  });

  it('rejects a declared PDF whose magic bytes do not match', async () => {
    const path = await temporaryFile('brief.pdf', 'not a pdf');
    await expect(validateStoredFile(path, 'brief.pdf', 'application/pdf')).rejects.toMatchObject({
      code: 'signature_mismatch',
    } satisfies Partial<FileValidationError>);
  });

  it('accepts an OOXML container only with its required application entries', async () => {
    const valid = storedZip([
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
      { name: 'word/document.xml', data: Buffer.from('<document/>') },
    ]);
    const path = await temporaryFile('brief.docx', valid);
    await expect(
      validateStoredFile(
        path,
        'brief.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).resolves.toMatchObject({ detectedFileType: 'docx' });
  });

  it('rejects traversal entries and a declared ZIP bomb before extraction', async () => {
    const traversal = storedZip([
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
      { name: '../word/document.xml', data: Buffer.from('<document/>') },
    ]);
    const traversalPath = await temporaryFile('traversal.docx', traversal);
    await expect(
      validateStoredFile(
        traversalPath,
        'traversal.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).rejects.toMatchObject({ code: 'archive_unsafe' } satisfies Partial<FileValidationError>);

    const bomb = storedZip([
      { name: '[Content_Types].xml', data: Buffer.from('x') },
      { name: 'word/document.xml', data: Buffer.from('x') },
    ]);
    const firstCentral = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bomb.writeUInt32LE(41 * 1024 * 1024, firstCentral + 24);
    const bombPath = await temporaryFile('bomb.docx', bomb);
    await expect(
      validateStoredFile(
        bombPath,
        'bomb.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).rejects.toMatchObject({ code: 'archive_unsafe' } satisfies Partial<FileValidationError>);
  });
});
