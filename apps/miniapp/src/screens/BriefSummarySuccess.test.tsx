import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { LeadDraftFormState, LeadFormData, Submission } from '@craft72/contracts/source';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEmptyDraft } from '../brief/draft.js';
import { BRIEF_STEP_META, BriefScreen, type BriefStep } from './BriefScreen.js';
import { SuccessScreen } from './SuccessScreen.js';
import { SummaryScreen } from './SummaryScreen.js';

const FORM: LeadFormData = {
  area: { squareMeters: 12_500, status: 'known' },
  consent: { accepted: true, version: 'mock-v1-not-for-production' },
  contact: { email: 'project@example.ru', phone: '+79990000000' },
  culturalHeritageSite: 'no',
  currentStage: 'concept',
  description: 'Архитектурная концепция общественного здания.',
  desiredStart: { date: '2026-09-15', status: 'known' },
  documentIds: ['10000000-0000-4000-8000-000000000001'],
  expertiseRequired: 'yes',
  fullName: 'Алексей Иванов',
  inn: null,
  links: ['https://example.ru/project'],
  location: { city: 'Тюмень', region: 'Тюменская область' },
  objectType: 'public-building',
  organization: 'ООО «Проект»',
  role: 'developer',
  scope: { kind: 'single_object' },
  selectedCaseIds: ['sample-case'],
  services: ['architecture'],
};

const SUBMISSION: Submission = {
  materials: [
    {
      createdAt: '2026-07-15T08:00:00.000Z',
      id: '10000000-0000-4000-8000-000000000001',
      mimeType: 'application/pdf',
      originalName: 'brief.pdf',
      scanStatus: 'clean',
      sha256: 'a'.repeat(64),
      sizeBytes: 2_048,
    },
  ],
  matchedCases: [
    {
      area: 8_400,
      categories: ['public-building'],
      city: 'Тюмень',
      constructionKind: 'new-construction',
      id: 'sample-case',
      image: null,
      published: true,
      region: 'Тюменская область',
      scale: 'single-object',
      services: ['architecture'],
      status: 'Реализован',
      tags: [],
      title: 'Общественный центр',
      url: 'https://example.ru/projects/sample-case',
    },
  ],
  payload: FORM,
  phoneVerified: true,
  status: 'received',
  submissionId: 'CRAFT-2026-001',
  submittedAt: '2026-07-15T08:00:00.000Z',
  updatedAt: '2026-07-15T08:00:00.000Z',
};

const STEPS: readonly BriefStep[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

afterEach(cleanup);

function briefScreen(step: BriefStep, draft: LeadDraftFormState = createEmptyDraft()) {
  return (
    <BriefScreen
      draft={draft}
      onBack={vi.fn()}
      onContinue={vi.fn()}
      onDraftChange={vi.fn()}
      onSaveAndExit={vi.fn()}
      step={step}
    />
  );
}

describe('BriefScreen', () => {
  it('renders every one of the 17 brief steps', () => {
    const view = render(briefScreen(1));

    for (const step of STEPS) {
      view.rerender(briefScreen(step));
      expect(screen.getByRole('heading', { name: BRIEF_STEP_META[step].title })).toBeTruthy();
    }
  });

  it('validates the current step and emits a lossless draft update', () => {
    const onContinue = vi.fn();
    const onDraftChange = vi.fn();
    render(
      <BriefScreen
        draft={createEmptyDraft()}
        onBack={vi.fn()}
        onContinue={onContinue}
        onDraftChange={onDraftChange}
        onSaveAndExit={vi.fn()}
        step={1}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    expect(screen.getByText('Выберите вашу роль')).toBeTruthy();
    expect(onContinue).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Девелопер/ }));
    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({ role: 'developer' }));
  });
});

describe('SummaryScreen', () => {
  it('shows the final payload and delegates section editing and submission', () => {
    const onEditStep = vi.fn();
    const onSubmit = vi.fn();
    render(
      <SummaryScreen
        documentNames={['brief.pdf']}
        form={FORM}
        onBack={vi.fn()}
        onEditStep={onEditStep}
        onSubmit={onSubmit}
        phoneVerified
      />,
    );

    expect(screen.getByText('ООО «Проект»')).toBeTruthy();
    expect(screen.getByText('brief.pdf')).toBeTruthy();
    const materialsCard = screen.getByRole('heading', { name: 'Материалы' }).closest('section');
    if (materialsCard === null) throw new Error('Expected materials summary card');
    fireEvent.click(within(materialsCard).getByRole('button', { name: 'Изменить' }));
    expect(onEditStep).toHaveBeenCalledWith(13);

    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('SuccessScreen', () => {
  it('confirms the immutable submission id and lists actual submission results', () => {
    const onAddMaterials = vi.fn();
    const onOpenChat = vi.fn();
    const onHome = vi.fn();
    render(
      <SuccessScreen
        onAddMaterials={onAddMaterials}
        onHome={onHome}
        onOpenChat={onOpenChat}
        submission={SUBMISSION}
      />,
    );

    expect(screen.getByText('CRAFT-2026-001')).toBeTruthy();
    expect(screen.getByText('brief.pdf')).toBeTruthy();
    expect(screen.getByText('Общественный центр')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/SLA|₽|стоимост|срок/i);

    fireEvent.click(screen.getByRole('button', { name: 'Новый бриф с материалами' }));
    fireEvent.click(screen.getByRole('button', { name: 'Открыть чат' }));
    fireEvent.click(screen.getByRole('button', { name: 'На главную' }));
    expect(onAddMaterials).toHaveBeenCalledTimes(1);
    expect(onOpenChat).toHaveBeenCalledTimes(1);
    expect(onHome).toHaveBeenCalledTimes(1);
  });
});
