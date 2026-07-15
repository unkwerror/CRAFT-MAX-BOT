import type { LeadFormData } from '@craft72/contracts/source';

import { InlineNotice } from '../components/FormControls.js';
import { Page, ScreenHeader, StickyActions } from '../components/Layout.js';
import {
  OBJECT_TYPE_OPTIONS,
  PROJECT_STAGE_OPTIONS,
  ROLE_OPTIONS,
  SERVICE_OPTIONS,
  TRI_STATE_OPTIONS,
  labelFor,
} from '../content.js';
import type { BriefStep } from './BriefScreen.js';

interface SummaryRow {
  readonly label: string;
  readonly value: string;
}

interface SummarySection {
  readonly editStep: BriefStep;
  readonly rows: readonly SummaryRow[];
  readonly title: string;
}

const present = (value: string | null | undefined): string =>
  value === undefined || value === null || value.trim() === '' ? 'Не указано' : value;

function formatLocation(form: LeadFormData): string {
  return [form.location.city, form.location.region].filter(Boolean).join(', ');
}

function formatScope(form: LeadFormData): string {
  return form.scope.kind === 'portfolio'
    ? `Портфель, ${String(form.scope.objectCount)} объектов`
    : 'Один объект';
}

function formatArea(form: LeadFormData): string {
  return form.area.status === 'known'
    ? `${form.area.squareMeters.toLocaleString('ru-RU')} м²`
    : 'Пока не известно';
}

function formatDesiredStart(form: LeadFormData): string {
  if (form.desiredStart.status === 'unknown') return 'Пока не определено';
  const parts = form.desiredStart.date.split('-');
  return parts.length === 3 ? [...parts].reverse().join('.') : form.desiredStart.date;
}

function formatMaterials(form: LeadFormData, documentNames: readonly string[]): string {
  if (documentNames.length > 0) return documentNames.join(', ');
  const count = form.documentIds.length;
  return count === 0 ? 'Не добавлены' : `Добавлено файлов: ${String(count)}`;
}

function buildSummarySections(
  form: LeadFormData,
  documentNames: readonly string[],
  phoneVerified: boolean,
): readonly SummarySection[] {
  return [
    {
      editStep: 1,
      title: 'Роль',
      rows: [{ label: 'В проекте', value: labelFor(ROLE_OPTIONS, form.role) }],
    },
    {
      editStep: 2,
      title: 'Заказчик',
      rows: [
        { label: 'Контактное лицо', value: form.fullName },
        { label: 'Организация', value: form.organization },
        { label: 'ИНН', value: present(form.inn) },
      ],
    },
    {
      editStep: 4,
      title: 'Объект',
      rows: [
        { label: 'Тип', value: labelFor(OBJECT_TYPE_OPTIONS, form.objectType) },
        { label: 'Расположение', value: formatLocation(form) },
      ],
    },
    {
      editStep: 6,
      title: 'Масштаб',
      rows: [
        { label: 'Состав', value: formatScope(form) },
        { label: 'Площадь', value: formatArea(form) },
      ],
    },
    {
      editStep: 8,
      title: 'Задача и услуги',
      rows: [
        { label: 'Стадия', value: labelFor(PROJECT_STAGE_OPTIONS, form.currentStage) },
        {
          label: 'Услуги',
          value: form.services.map((service) => labelFor(SERVICE_OPTIONS, service)).join(', '),
        },
        {
          label: 'Экспертиза',
          value: labelFor(TRI_STATE_OPTIONS, form.expertiseRequired),
        },
        {
          label: 'Статус ОКН',
          value: labelFor(TRI_STATE_OPTIONS, form.culturalHeritageSite),
        },
        { label: 'Начало работ', value: formatDesiredStart(form) },
        { label: 'Описание', value: form.description },
      ],
    },
    {
      editStep: 13,
      title: 'Материалы',
      rows: [
        { label: 'Файлы', value: formatMaterials(form, documentNames) },
        {
          label: 'Ссылки',
          value: form.links.length === 0 ? 'Не добавлены' : form.links.join(', '),
        },
        {
          label: 'Выбранные проекты',
          value:
            form.selectedCaseIds.length === 0
              ? 'Не выбраны'
              : `Выбрано: ${String(form.selectedCaseIds.length)}`,
        },
      ],
    },
    {
      editStep: 14,
      title: 'Контакты',
      rows: [
        { label: 'Телефон', value: form.contact.phone },
        {
          label: 'Статус телефона',
          value: phoneVerified ? 'Получен через MAX · mock' : 'Указан вручную',
        },
        { label: 'Email', value: form.contact.email },
      ],
    },
    {
      editStep: 16,
      title: 'Согласие',
      rows: [
        { label: 'Обработка данных', value: 'Подтверждено' },
        { label: 'Версия текста', value: form.consent.version },
      ],
    },
  ];
}

interface SummaryCardProps extends SummarySection {
  readonly onEdit: (step: BriefStep) => void;
}

const SummaryCard = ({ editStep, onEdit, rows, title }: SummaryCardProps) => (
  <section className="summary-card">
    <div className="summary-card__head">
      <h2>{title}</h2>
      <button onClick={() => onEdit(editStep)} type="button">
        Изменить
      </button>
    </div>
    <dl>
      {rows.map((row) => (
        <div key={row.label} style={{ display: 'contents' }}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  </section>
);

export interface SummaryScreenProps {
  readonly documentNames?: readonly string[];
  readonly form: LeadFormData;
  readonly isSubmitting?: boolean;
  readonly onBack: () => void;
  readonly onEditStep: (step: BriefStep) => void;
  readonly onSubmit: () => void | Promise<void>;
  readonly phoneVerified?: boolean;
  readonly submitError?: string;
}

export const SummaryScreen = ({
  documentNames = [],
  form,
  isSubmitting = false,
  onBack,
  onEditStep,
  onSubmit,
  phoneVerified = false,
  submitError,
}: SummaryScreenProps) => {
  const sections = buildSummarySections(form, documentNames, phoneVerified);

  return (
    <Page className="page--narrow">
      <ScreenHeader
        eyebrow="Проверка"
        onBack={onBack}
        subtitle="Все разделы можно изменить до отправки"
        title="Резюме заявки"
      />

      <div className="summary-sections">
        {sections.map((section) => (
          <SummaryCard {...section} key={section.title} onEdit={onEditStep} />
        ))}
      </div>

      {submitError === undefined ? null : (
        <InlineNotice icon="warning" tone="warning">
          <strong>Не удалось отправить заявку</strong>
          <span>{submitError}</span>
        </InlineNotice>
      )}

      <StickyActions
        backLabel="Назад к брифу"
        continueDisabled={isSubmitting}
        continueLabel="Отправить заявку"
        loading={isSubmitting}
        onBack={onBack}
        onContinue={() => void onSubmit()}
      />
    </Page>
  );
};
