import type { Document, DocumentScanStatus } from '@craft72/contracts/source';
import { describe, expect, it } from 'vitest';

import { getDocumentReadiness } from './document-readiness.js';

const DOCUMENT_ID = '20000000-0000-4000-8000-000000000002';

function documentWithStatus(scanStatus: DocumentScanStatus): Document {
  return {
    id: DOCUMENT_ID,
    originalName: 'brief.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1_024,
    sha256: 'a'.repeat(64),
    scanStatus,
    createdAt: '2026-07-16T08:00:00.000Z',
  };
}

describe('document submission readiness', () => {
  it('allows an empty list and documents that passed scanning', () => {
    expect(getDocumentReadiness([], () => null)).toBe('ready');
    expect(getDocumentReadiness([DOCUMENT_ID], () => documentWithStatus('clean'))).toBe('ready');
  });

  it.each(['pending', 'scanning'] as const)(
    'blocks submission while a document is %s',
    (status) => {
      expect(getDocumentReadiness([DOCUMENT_ID], () => documentWithStatus(status))).toBe(
        'checking',
      );
    },
  );

  it('blocks submission when metadata is temporarily unavailable', () => {
    expect(getDocumentReadiness([DOCUMENT_ID], () => null)).toBe('checking');
    expect(
      getDocumentReadiness([DOCUMENT_ID], () => {
        throw new Error('private API diagnostic');
      }),
    ).toBe('checking');
  });

  it.each(['failed', 'infected'] as const)('rejects a terminal %s document', (status) => {
    expect(getDocumentReadiness([DOCUMENT_ID], () => documentWithStatus(status))).toBe('rejected');
  });
});
