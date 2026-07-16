import { describe, expect, it } from 'vitest';

import {
  TRACKER_DISCOVERY_SCHEMA,
  buildTrackerIssuePlan,
  type TrackerSubmissionSnapshot,
} from './tracker-plan.js';

const submission: TrackerSubmissionSnapshot = {
  areaSquareMeters: '12500.00',
  city: 'Тюмень',
  contactEmail: 'client@example.com',
  contactName: 'Иван Петров',
  contactPhone: '+79991234567',
  culturalHeritage: false,
  description: 'Нужна концепция',
  desiredStart: '2026-09-01',
  documents: [
    {
      id: '10000000-0000-4000-8000-000000000001',
      mimeType: 'application/pdf',
      originalName: 'brief.pdf',
      sha256: 'a'.repeat(64),
      sizeBytes: 1_024,
    },
  ],
  expertiseRequired: null,
  inn: '7707083893',
  materialLinks: ['https://files.example.com/brief'],
  maxUserId: '123456789',
  objectCount: 1,
  objectType: 'office',
  organization: 'ООО Девелопмент',
  projectScope: 'single_object',
  projectStage: 'concept',
  region: 'Тюменская область',
  role: 'developer',
  selectedCaseIds: ['office-reconstruction'],
  services: ['architecture'],
  submissionId: 'CRAFT-20260716-ABCDEF',
};

describe('Tracker Stage 6 mapping', () => {
  it('uses an exact normalized INN and the discovered PART field IDs', () => {
    const plan = buildTrackerIssuePlan('upsert_partner', submission, {
      crmKey: null,
      partnerKey: null,
    });

    expect(plan.body).toMatchObject({
      [TRACKER_DISCOVERY_SCHEMA.part.companyTypeField]: 'Клиент',
      [TRACKER_DISCOVERY_SCHEMA.part.innField]: '7707083893',
      [TRACKER_DISCOVERY_SCHEMA.part.preferredChannelField]: ['MAX'],
      queue: 'PART',
      type: 'kompania',
      unique: 'craft72:part:inn:7707083893',
    });
    expect(plan.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('flags a no-INN partner for manual deduplication', () => {
    const plan = buildTrackerIssuePlan(
      'upsert_partner',
      { ...submission, inn: null },
      { crmKey: null, partnerKey: null },
    );
    expect(plan.body.unique).toBe(`craft72:part:submission:${submission.submissionId}`);
    expect(plan.body.description).toContain('Ручная проверка дубля:** Да');
    expect(plan.body).not.toHaveProperty(TRACKER_DISCOVERY_SCHEMA.part.innField);
  });

  it('links CRM to PART and renders taxonomy values in Russian', () => {
    const plan = buildTrackerIssuePlan('create_crm', submission, {
      crmKey: null,
      partnerKey: 'PART-10',
    });
    expect(plan.body).toMatchObject({
      [TRACKER_DISCOVERY_SCHEMA.crm.innField]: submission.inn,
      links: [{ issue: 'PART-10', relationship: 'relates' }],
      queue: 'CRM',
      unique: `craft72:crm:${submission.submissionId}`,
    });
    expect(plan.body).not.toHaveProperty('69bcddb4032fba225e55fc96--sourceLida');
    expect(plan.body).not.toHaveProperty('69bcddb4032fba225e55fc96--stage');
    expect(plan.body).not.toHaveProperty('69bcddb4032fba225e55fc96--type');
    const description = String(plan.body.description);
    expect(description).toContain('Роль заказчика:** Девелопер');
    expect(description).toContain('Тип объекта:** Офис и бизнес-центр');
    expect(description).toContain('Стадия проекта:** Концепция');
    expect(description).toContain('Услуги:** Архитектурная концепция');
    expect(description).toContain('Масштаб проекта:** Один объект');
    expect(description).toContain('Номер заявки:**');
    expect(description).not.toContain('objectType');
    expect(description).not.toMatch(/\*\*Роль:\*\* developer/);
    expect(description).not.toMatch(/\*\*Услуги:\*\* architecture/);
  });

  it('creates DOCS only for materials and links it to both predecessors', () => {
    const plan = buildTrackerIssuePlan('create_docs', submission, {
      crmKey: 'CRM-20',
      partnerKey: 'PART-10',
    });
    expect(plan.body).toMatchObject({
      queue: 'DOCS',
      type: 'documents',
      unique: `craft72:docs:${submission.submissionId}`,
      links: [
        { issue: 'CRM-20', relationship: 'relates' },
        { issue: 'PART-10', relationship: 'relates' },
      ],
    });
    expect(() =>
      buildTrackerIssuePlan(
        'create_docs',
        { ...submission, documents: [], materialLinks: [] },
        { crmKey: 'CRM-20', partnerKey: 'PART-10' },
      ),
    ).toThrow(TypeError);
  });

  it('requires predecessor result keys before dependent operations', () => {
    expect(() =>
      buildTrackerIssuePlan('create_crm', submission, { crmKey: null, partnerKey: null }),
    ).toThrow(TypeError);
    expect(() =>
      buildTrackerIssuePlan('create_docs', submission, { crmKey: null, partnerKey: 'PART-10' }),
    ).toThrow(TypeError);
  });

  it('adds a configured assignee to the body and payload hash, and otherwise omits it', () => {
    const withoutAssignee = buildTrackerIssuePlan(
      'upsert_partner',
      submission,
      { crmKey: null, partnerKey: null },
      { assignee: null },
    );
    const withAssignee = buildTrackerIssuePlan(
      'upsert_partner',
      submission,
      { crmKey: null, partnerKey: null },
      { assignee: 'craft72.tracker' },
    );

    expect(withoutAssignee.body).not.toHaveProperty('assignee');
    expect(withAssignee.body).toHaveProperty('assignee', 'craft72.tracker');
    expect(withAssignee.payloadHash).not.toBe(withoutAssignee.payloadHash);
  });
});
