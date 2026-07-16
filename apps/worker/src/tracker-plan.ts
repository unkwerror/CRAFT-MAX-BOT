import { createHash } from 'node:crypto';

import type { TrackerCreateIssueBody } from './tracker-api.js';

export type TrackerOperation = 'create_crm' | 'create_docs' | 'upsert_partner';

export interface TrackerDocumentSnapshot {
  readonly id: string;
  readonly mimeType: string;
  readonly originalName: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface TrackerSubmissionSnapshot {
  readonly areaSquareMeters: string | null;
  readonly city: string | null;
  readonly contactEmail: string;
  readonly contactName: string;
  readonly contactPhone: string;
  readonly culturalHeritage: boolean | null;
  readonly description: string;
  readonly desiredStart: string | null;
  readonly documents: readonly TrackerDocumentSnapshot[];
  readonly expertiseRequired: boolean | null;
  readonly inn: string | null;
  readonly materialLinks: readonly string[];
  readonly maxUserId: string;
  readonly objectCount: number;
  readonly objectType: string;
  readonly organization: string | null;
  readonly projectScope: 'portfolio' | 'single_object';
  readonly projectStage: string;
  readonly region: string | null;
  readonly role: string;
  readonly selectedCaseIds: readonly string[];
  readonly services: readonly string[];
  readonly submissionId: string;
}

export interface TrackerPlanDependencies {
  readonly crmKey: string | null;
  readonly partnerKey: string | null;
}

export interface TrackerIssuePlan {
  readonly body: TrackerCreateIssueBody;
  readonly operation: TrackerOperation;
  readonly payloadHash: string;
}

export interface TrackerPlanOptions {
  readonly assignee: string | null;
}

/** Read-only discovery snapshot approved on 2026-07-16. Fixed-list fields stay intentionally unmapped. */
export const TRACKER_DISCOVERY_SCHEMA = {
  crm: {
    contactField: '69bcddb4032fba225e55fc96--contactPerson',
    innField: '69bcddb4032fba225e55fc96--inn0',
    nameField: '69bcddb4032fba225e55fc96--name',
    queue: 'CRM',
    queueId: '25',
    squareField: '69bcddb4032fba225e55fc96--sqare',
    version: 15,
  },
  docs: { queue: 'DOCS', queueId: '27', type: 'documents', version: 6 },
  part: {
    cityField: '69e7541f05f9ba3198eb07fe--city',
    companyTypeField: '69e7541f05f9ba3198eb07fe--companyType',
    emailField: '69e7541f05f9ba3198eb07fe--generalMail',
    innField: '69e7541f05f9ba3198eb07fe--inn',
    maxField: '69e7541f05f9ba3198eb07fe--max',
    phoneField: '69e7541f05f9ba3198eb07fe--sharedPhoneNumber',
    preferredChannelField: '69e7541f05f9ba3198eb07fe--preferredCommunicationChannel',
    queue: 'PART',
    queueId: '32',
    type: 'kompania',
    version: 11,
  },
} as const;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`;
}

function payloadHash(body: TrackerCreateIssueBody): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

function safeText(value: string | null, maximumLength = 8_000): string {
  if (value === null || value.trim().length === 0) return 'Не указано';
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
    })
    .join('')
    .replaceAll('@', '@\u200b')
    .replaceAll('```', 'ʼʼʼ')
    .trim()
    .slice(0, maximumLength);
}

function normalizedAssignee(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 255 ||
    [...normalized].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    throw new TypeError('Tracker assignee is invalid');
  }
  return normalized;
}

function line(label: string, value: string | number | boolean | null): string {
  const rendered =
    typeof value === 'boolean'
      ? value
        ? 'Да'
        : 'Нет'
      : safeText(value === null ? null : String(value));
  return `- **${label}:** ${rendered}`;
}

function issueKey(value: string | null, name: string): string {
  if (value === null || !/^[A-Z][A-Z0-9_]{0,31}-[1-9]\d*$/.test(value)) {
    throw new TypeError(`Tracker ${name} dependency is missing or invalid`);
  }
  return value;
}

function summary(prefix: string, value: string): string {
  return `${prefix}: ${safeText(value, 180)}`.slice(0, 255);
}

function partnerPlan(submission: TrackerSubmissionSnapshot): TrackerCreateIssueBody {
  const withoutInn = submission.inn === null;
  return {
    ...(submission.inn === null
      ? {}
      : { [TRACKER_DISCOVERY_SCHEMA.part.innField]: submission.inn }),
    ...(submission.city === null
      ? {}
      : { [TRACKER_DISCOVERY_SCHEMA.part.cityField]: submission.city }),
    [TRACKER_DISCOVERY_SCHEMA.part.companyTypeField]: 'Клиент',
    [TRACKER_DISCOVERY_SCHEMA.part.emailField]: submission.contactEmail,
    [TRACKER_DISCOVERY_SCHEMA.part.maxField]: submission.maxUserId,
    [TRACKER_DISCOVERY_SCHEMA.part.phoneField]: submission.contactPhone,
    [TRACKER_DISCOVERY_SCHEMA.part.preferredChannelField]: ['MAX'],
    description: [
      '## Обращение CRAFT72 из MAX',
      line('Submission ID', submission.submissionId),
      line('Организация', submission.organization),
      line('ИНН', submission.inn),
      line('Контактное лицо', submission.contactName),
      line('Телефон', submission.contactPhone),
      line('E-mail', submission.contactEmail),
      line('Канал связи', 'MAX'),
      line('Ручная проверка дубля', withoutInn),
    ].join('\n'),
    markupType: 'md',
    queue: TRACKER_DISCOVERY_SCHEMA.part.queue,
    summary: summary('Партнёр', submission.organization ?? submission.contactName),
    type: TRACKER_DISCOVERY_SCHEMA.part.type,
    unique: withoutInn
      ? `craft72:part:submission:${submission.submissionId}`
      : `craft72:part:inn:${submission.inn}`,
  };
}

function crmPlan(
  submission: TrackerSubmissionSnapshot,
  dependencies: TrackerPlanDependencies,
): TrackerCreateIssueBody {
  const partnerKey = issueKey(dependencies.partnerKey, 'PART');
  return {
    ...(submission.inn === null ? {} : { [TRACKER_DISCOVERY_SCHEMA.crm.innField]: submission.inn }),
    ...(submission.organization === null
      ? {}
      : { [TRACKER_DISCOVERY_SCHEMA.crm.nameField]: submission.organization }),
    ...(submission.areaSquareMeters === null
      ? {}
      : { [TRACKER_DISCOVERY_SCHEMA.crm.squareField]: Number(submission.areaSquareMeters) }),
    [TRACKER_DISCOVERY_SCHEMA.crm.contactField]: [
      submission.contactName,
      submission.contactPhone,
      submission.contactEmail,
    ].join(' · '),
    description: [
      '## Лид CRAFT72 из MAX',
      line('Submission ID', submission.submissionId),
      line('MAX user ID', submission.maxUserId),
      line('Источник', 'MAX'),
      line('Организация', submission.organization),
      line('ИНН', submission.inn),
      line('Контакт', submission.contactName),
      line('Телефон', submission.contactPhone),
      line('E-mail', submission.contactEmail),
      line('Роль', submission.role),
      line('Тип объекта (исходное значение)', submission.objectType),
      line('Город', submission.city),
      line('Регион', submission.region),
      line('Масштаб', submission.projectScope),
      line('Количество объектов', submission.objectCount),
      line('Площадь, м²', submission.areaSquareMeters),
      line('Стадия (исходное значение)', submission.projectStage),
      line('Услуги', submission.services.join(', ')),
      line('Нужна экспертиза', submission.expertiseRequired),
      line('Объект культурного наследия', submission.culturalHeritage),
      line('Желаемое начало', submission.desiredStart),
      line('Описание', submission.description),
      line('Выбранные кейсы', submission.selectedCaseIds.join(', ')),
      line('PART', partnerKey),
    ].join('\n'),
    links: [{ issue: partnerKey, relationship: 'relates' }],
    markupType: 'md',
    queue: TRACKER_DISCOVERY_SCHEMA.crm.queue,
    summary: summary(
      'MAX-лид',
      `${submission.submissionId} · ${submission.organization ?? submission.contactName}`,
    ),
    unique: `craft72:crm:${submission.submissionId}`,
  };
}

function docsPlan(
  submission: TrackerSubmissionSnapshot,
  dependencies: TrackerPlanDependencies,
): TrackerCreateIssueBody {
  if (submission.documents.length === 0 && submission.materialLinks.length === 0) {
    throw new TypeError('Tracker DOCS operation requires materials');
  }
  const partnerKey = issueKey(dependencies.partnerKey, 'PART');
  const crmKey = issueKey(dependencies.crmKey, 'CRM');
  const documentLines = submission.documents.map(
    (document) =>
      `- ${safeText(document.originalName, 255)} · ${document.mimeType} · ${String(document.sizeBytes)} bytes · SHA-256 ${document.sha256}`,
  );
  const linkLines = submission.materialLinks.map((linkValue) => `- ${safeText(linkValue, 2_048)}`);
  return {
    description: [
      '## Материалы CRAFT72',
      line('Submission ID', submission.submissionId),
      line('CRM', crmKey),
      line('PART', partnerKey),
      '',
      '### Загруженные файлы',
      ...(documentLines.length === 0 ? ['- Нет'] : documentLines),
      '',
      '### Ссылки пользователя',
      ...(linkLines.length === 0 ? ['- Нет'] : linkLines),
      '',
      'Приватные storage keys и токены доступа в Tracker не передаются.',
    ].join('\n'),
    links: [
      { issue: crmKey, relationship: 'relates' },
      { issue: partnerKey, relationship: 'relates' },
    ],
    markupType: 'md',
    queue: TRACKER_DISCOVERY_SCHEMA.docs.queue,
    summary: summary('Материалы', submission.submissionId),
    type: TRACKER_DISCOVERY_SCHEMA.docs.type,
    unique: `craft72:docs:${submission.submissionId}`,
  };
}

export function buildTrackerIssuePlan(
  operation: TrackerOperation,
  submission: TrackerSubmissionSnapshot,
  dependencies: TrackerPlanDependencies,
  options: TrackerPlanOptions = { assignee: null },
): TrackerIssuePlan {
  const operationBody =
    operation === 'upsert_partner'
      ? partnerPlan(submission)
      : operation === 'create_crm'
        ? crmPlan(submission, dependencies)
        : docsPlan(submission, dependencies);
  const assignee = normalizedAssignee(options.assignee);
  const body = assignee === null ? operationBody : { ...operationBody, assignee };
  return { body, operation, payloadHash: payloadHash(body) };
}
