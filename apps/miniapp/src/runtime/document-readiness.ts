import type { Document } from '@craft72/contracts/source';

export type DocumentReadiness = 'checking' | 'ready' | 'rejected';

export function getDocumentReadiness(
  documentIds: readonly string[],
  resolveDocument: (documentId: string) => Document | null,
): DocumentReadiness {
  let readiness: DocumentReadiness = 'ready';

  for (const documentId of new Set(documentIds)) {
    let document: Document | null;
    try {
      document = resolveDocument(documentId);
    } catch {
      document = null;
    }

    if (
      document === null ||
      document.scanStatus === 'pending' ||
      document.scanStatus === 'scanning'
    ) {
      readiness = 'checking';
      continue;
    }
    if (document.scanStatus === 'failed' || document.scanStatus === 'infected') return 'rejected';
  }

  return readiness;
}
