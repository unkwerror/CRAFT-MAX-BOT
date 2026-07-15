import { useEffect, useState, type ReactNode } from 'react';
import type { LeadDraftFormState, LeadFormData } from '@craft72/contracts/source';

import {
  toFinalLeadForm,
  toggleDraftSelection,
  validateBriefStep,
  type BriefErrors,
} from '../brief/draft.js';
import {
  ChoiceGrid,
  InlineNotice,
  TextAreaField,
  TextField,
  ToggleRow,
} from '../components/FormControls.js';
import { Icon } from '../components/Icon.js';
import { Page, ProgressBar, ScreenHeader, StickyActions } from '../components/Layout.js';
import {
  MOCK_CONSENT_VERSION,
  MOCK_CONTENT_NOTICE,
  OBJECT_TYPE_OPTIONS,
  PROJECT_STAGE_OPTIONS,
  ROLE_OPTIONS,
  SERVICE_OPTIONS,
  TRI_STATE_OPTIONS,
  labelFor,
} from '../content.js';
import { MOCK_CASE_CATALOG } from '../domain/case-catalog.js';

export const BRIEF_TOTAL_STEPS = 17;

export type BriefStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17;

interface BriefStepMeta {
  readonly title: string;
  readonly subtitle: string;
}

export const BRIEF_STEP_META: Readonly<Record<BriefStep, BriefStepMeta>> = {
  1: {
    title: 'Ваша роль в проекте',
    subtitle: 'Это поможет говорить о задаче в подходящем контексте.',
  },
  2: {
    title: 'Представьтесь',
    subtitle: 'Укажите имя и организацию, от которой вы обращаетесь.',
  },
  3: {
    title: 'ИНН организации',
    subtitle: 'Необязательное поле — его можно заполнить позднее.',
  },
  4: {
    title: 'Тип объекта',
    subtitle: 'Выберите наиболее близкий вариант.',
  },
  5: {
    title: 'Где находится объект',
    subtitle: 'Достаточно указать город или регион.',
  },
  6: {
    title: 'Масштаб проекта',
    subtitle: 'Один объект или портфель из нескольких объектов.',
  },
  7: {
    title: 'Площадь объекта',
    subtitle: 'Если точной площади ещё нет, это можно отметить.',
  },
  8: {
    title: 'Текущая стадия',
    subtitle: 'На каком этапе проект находится сейчас?',
  },
  9: {
    title: 'Какие услуги нужны',
    subtitle: 'Можно выбрать несколько направлений.',
  },
  10: {
    title: 'Экспертиза и статус ОКН',
    subtitle: 'Ответ «Пока не знаю» тоже подходит.',
  },
  11: {
    title: 'Желаемое начало работ',
    subtitle: 'Укажите ориентир или отметьте, что дата пока неизвестна.',
  },
  12: {
    title: 'Расскажите о задаче',
    subtitle: 'Коротко опишите объект, исходную ситуацию и ожидаемый результат.',
  },
  13: {
    title: 'Материалы и ссылки',
    subtitle: 'Добавьте документы либо HTTPS-ссылки, если они уже есть.',
  },
  14: {
    title: 'Телефон для связи',
    subtitle: 'Можно передать контакт из MAX или ввести номер вручную.',
  },
  15: {
    title: 'Электронная почта',
    subtitle: 'На этот адрес можно будет отправлять материалы по проекту.',
  },
  16: {
    title: 'Согласие на обработку данных',
    subtitle: 'Подтвердите согласие перед проверкой заявки.',
  },
  17: {
    title: 'Бриф заполнен',
    subtitle: 'Проверьте основные сведения и перейдите к итоговому резюме.',
  },
};

const SCOPE_OPTIONS = [
  { label: 'Один объект', value: 'single_object' },
  { label: 'Портфель объектов', value: 'portfolio' },
] as const;

const AREA_STATUS_OPTIONS = [
  { label: 'Площадь известна', value: 'known' },
  { label: 'Пока не знаю', value: 'unknown' },
] as const;

const START_STATUS_OPTIONS = [
  { label: 'Есть ориентир по дате', value: 'known' },
  { label: 'Пока не знаю', value: 'unknown' },
] as const;

const errorProps = (error: string | undefined) => (error === undefined ? {} : { error });

function formatLocation(form: LeadFormData): string {
  return [form.location.city, form.location.region].filter(Boolean).join(', ');
}

function formatScope(form: LeadFormData): string {
  return form.scope.kind === 'portfolio'
    ? `Портфель · ${String(form.scope.objectCount)} объектов`
    : 'Один объект';
}

function finalFormFromDraft(draft: LeadDraftFormState): LeadFormData | null {
  try {
    return toFinalLeadForm(draft);
  } catch {
    return null;
  }
}

interface BriefStepFieldsProps {
  readonly consentVersion: string;
  readonly draft: LeadDraftFormState;
  readonly errors: BriefErrors;
  readonly materialCount: number;
  readonly onChange: (draft: LeadDraftFormState) => void;
  readonly onEditStep?: (step: BriefStep) => void;
  readonly onOpenMaterials?: () => void;
  readonly onRequestContact?: () => void | Promise<void>;
  readonly phoneVerified: boolean;
  readonly privacyPolicyUrl?: string;
  readonly requestingContact: boolean;
  readonly serverBacked: boolean;
  readonly step: BriefStep;
}

const BriefStepFields = ({
  consentVersion,
  draft,
  errors,
  materialCount,
  onChange,
  onEditStep,
  onOpenMaterials,
  onRequestContact,
  phoneVerified,
  privacyPolicyUrl,
  requestingContact,
  serverBacked,
  step,
}: BriefStepFieldsProps): ReactNode => {
  const update = (patch: Partial<LeadDraftFormState>): void => {
    onChange({ ...draft, ...patch });
  };

  switch (step) {
    case 1:
      return (
        <ChoiceGrid
          columns={2}
          {...errorProps(errors.role)}
          onChange={(role) => update({ role })}
          options={ROLE_OPTIONS}
          value={draft.role}
        />
      );

    case 2:
      return (
        <>
          <TextField
            autoComplete="name"
            {...errorProps(errors.fullName)}
            label="Имя и фамилия"
            onChange={(fullName) => update({ fullName })}
            placeholder="Алексей Иванов"
            value={draft.fullName ?? ''}
          />
          <TextField
            autoComplete="organization"
            {...errorProps(errors.organization)}
            label="Организация или ИП"
            onChange={(organization) => update({ organization })}
            placeholder="ООО «Компания»"
            value={draft.organization ?? ''}
          />
        </>
      );

    case 3:
      return (
        <TextField
          {...errorProps(errors.inn)}
          hint="10 цифр для юридического лица или 12 цифр для ИП"
          inputMode="numeric"
          label="ИНН"
          maxLength={12}
          onChange={(inn) => update({ inn: inn === '' ? null : inn })}
          optional
          placeholder="Введите ИНН"
          value={draft.inn ?? ''}
        />
      );

    case 4:
      return (
        <ChoiceGrid
          columns={2}
          {...errorProps(errors.objectType)}
          onChange={(objectType) => update({ objectType })}
          options={OBJECT_TYPE_OPTIONS}
          value={draft.objectType}
        />
      );

    case 5:
      return (
        <>
          <TextField
            autoComplete="address-level2"
            {...errorProps(errors.location)}
            label="Город"
            onChange={(city) => update({ location: { ...draft.location, city } })}
            placeholder="Тюмень"
            value={draft.location?.city ?? ''}
          />
          <TextField
            autoComplete="address-level1"
            label="Регион"
            onChange={(region) => update({ location: { ...draft.location, region } })}
            optional
            placeholder="Тюменская область"
            value={draft.location?.region ?? ''}
          />
        </>
      );

    case 6:
      return (
        <>
          <ChoiceGrid
            {...errorProps(errors.scope)}
            onChange={(kind) =>
              update({
                scope:
                  kind === 'portfolio'
                    ? { kind, objectCount: draft.scope?.objectCount ?? '' }
                    : { kind },
              })
            }
            options={SCOPE_OPTIONS}
            value={draft.scope?.kind}
          />
          {draft.scope?.kind === 'portfolio' ? (
            <TextField
              {...errorProps(errors.objectCount)}
              inputMode="numeric"
              label="Количество объектов"
              onChange={(objectCount) =>
                update({ scope: { ...draft.scope, kind: 'portfolio', objectCount } })
              }
              placeholder="2"
              type="number"
              value={draft.scope.objectCount ?? ''}
            />
          ) : null}
        </>
      );

    case 7:
      return (
        <>
          <ChoiceGrid
            {...errorProps(errors.area)}
            onChange={(status) =>
              update({
                area:
                  status === 'known'
                    ? { status, squareMeters: draft.area?.squareMeters ?? '' }
                    : { status },
              })
            }
            options={AREA_STATUS_OPTIONS}
            value={draft.area?.status}
          />
          {draft.area?.status === 'known' ? (
            <TextField
              {...errorProps(errors.area)}
              hint="Можно указать приблизительное значение"
              inputMode="decimal"
              label="Площадь, м²"
              onChange={(squareMeters) =>
                update({ area: { ...draft.area, status: 'known', squareMeters } })
              }
              placeholder="12 500"
              value={draft.area.squareMeters ?? ''}
            />
          ) : null}
        </>
      );

    case 8:
      return (
        <ChoiceGrid
          {...errorProps(errors.currentStage)}
          onChange={(currentStage) => update({ currentStage })}
          options={PROJECT_STAGE_OPTIONS}
          value={draft.currentStage}
        />
      );

    case 9:
      return (
        <ChoiceGrid
          columns={2}
          {...errorProps(errors.services)}
          multiple
          onChange={(service) =>
            update({ services: toggleDraftSelection(draft.services, service) })
          }
          options={SERVICE_OPTIONS}
          value={draft.services}
        />
      );

    case 10:
      return (
        <>
          <ChoiceGrid
            {...errorProps(errors.expertiseRequired)}
            label="Потребуется экспертиза?"
            onChange={(expertiseRequired) => update({ expertiseRequired })}
            options={TRI_STATE_OPTIONS}
            value={draft.expertiseRequired}
          />
          <ChoiceGrid
            {...errorProps(errors.culturalHeritageSite)}
            label="Объект относится к культурному наследию?"
            onChange={(culturalHeritageSite) => update({ culturalHeritageSite })}
            options={TRI_STATE_OPTIONS}
            value={draft.culturalHeritageSite}
          />
        </>
      );

    case 11:
      return (
        <>
          <ChoiceGrid
            {...errorProps(errors.desiredStart)}
            onChange={(status) =>
              update({
                desiredStart:
                  status === 'known'
                    ? { status, date: draft.desiredStart?.date ?? '' }
                    : { status },
              })
            }
            options={START_STATUS_OPTIONS}
            value={draft.desiredStart?.status}
          />
          {draft.desiredStart?.status === 'known' ? (
            <TextField
              {...errorProps(errors.desiredStart)}
              label="Ориентировочная дата"
              onChange={(date) =>
                update({ desiredStart: { ...draft.desiredStart, status: 'known', date } })
              }
              type="date"
              value={draft.desiredStart.date ?? ''}
            />
          ) : null}
        </>
      );

    case 12:
      return (
        <TextAreaField
          {...errorProps(errors.description)}
          hint="Например: что уже подготовлено, какая помощь требуется и что важно учесть"
          label="Описание задачи"
          onChange={(description) => update({ description })}
          placeholder="Опишите проект в свободной форме"
          rows={7}
          value={draft.description ?? ''}
        />
      );

    case 13: {
      const links = draft.links?.length === 0 || draft.links === undefined ? [''] : draft.links;
      const selectedCases = MOCK_CASE_CATALOG.filter((item) =>
        draft.selectedCaseIds?.includes(item.id),
      );
      const setLink = (index: number, value: string): void => {
        const next = [...(draft.links ?? [])];
        if (index >= next.length) next.push(value);
        else next[index] = value;
        update({ links: next });
      };
      const removeLink = (index: number): void => {
        update({ links: (draft.links ?? []).filter((_, itemIndex) => itemIndex !== index) });
      };

      return (
        <>
          <InlineNotice icon="paperclip">
            <strong>Материалов добавлено: {String(materialCount)}</strong>
            <span>Подойдут PDF, DOCX, XLSX, изображения, DWG, DXF и IFC.</span>
          </InlineNotice>
          {onOpenMaterials === undefined ? null : (
            <button className="chip" onClick={onOpenMaterials} type="button">
              <Icon name="upload" size={17} /> Добавить материалы
            </button>
          )}
          {selectedCases.length === 0 ? null : (
            <div className="form-stack">
              <span className="field__label">Проекты для ориентира</span>
              <div className="chip-list">
                {selectedCases.map((item) => (
                  <button
                    className="chip is-selected"
                    key={item.id}
                    onClick={() =>
                      update({
                        selectedCaseIds: (draft.selectedCaseIds ?? []).filter(
                          (caseId) => caseId !== item.id,
                        ),
                      })
                    }
                    type="button"
                  >
                    {item.title} ×
                  </button>
                ))}
              </div>
            </div>
          )}
          {links.map((link, index) => (
            <div className="form-stack" key={`link-${String(index)}`}>
              <TextField
                {...errorProps(errors.links)}
                inputMode="url"
                label={`Ссылка ${String(index + 1)}`}
                onChange={(value) => setLink(index, value)}
                optional
                placeholder="https://disk.example.ru/project"
                type="url"
                value={link}
              />
              {draft.links?.[index] === undefined ? null : (
                <button className="save-exit" onClick={() => removeLink(index)} type="button">
                  Удалить ссылку
                </button>
              )}
            </div>
          ))}
          {(draft.links?.length ?? 0) >= 10 ? null : (
            <button
              className="chip"
              onClick={() => update({ links: [...(draft.links ?? []), ''] })}
              type="button"
            >
              <Icon name="plus" size={17} /> Добавить ссылку
            </button>
          )}
        </>
      );
    }

    case 14:
      return (
        <>
          {onRequestContact === undefined ? null : (
            <button
              className="chip"
              disabled={requestingContact}
              onClick={() => void onRequestContact()}
              type="button"
            >
              <Icon name="phone" size={17} />
              {requestingContact ? 'Запрашиваем контакт…' : 'Передать контакт из MAX'}
            </button>
          )}
          {phoneVerified ? (
            <InlineNotice icon="check" tone="success">
              <strong>Контакт получен из MAX</strong>
              <span>
                {serverBacked
                  ? 'Подпись контакта проверена сервером.'
                  : 'В веб-превью используется демонстрационное состояние контакта.'}
              </span>
            </InlineNotice>
          ) : (
            <InlineNotice icon="phone">
              Отказ от передачи контакта не блокирует форму — номер можно ввести вручную.
            </InlineNotice>
          )}
          <TextField
            autoComplete="tel"
            {...errorProps(errors.phone)}
            hint="Международный формат, например +79990000000"
            inputMode="tel"
            label="Телефон"
            onChange={(phone) => update({ contact: { ...draft.contact, phone } })}
            placeholder="+7 999 000-00-00"
            type="tel"
            value={draft.contact?.phone ?? ''}
          />
        </>
      );

    case 15:
      return (
        <TextField
          autoComplete="email"
          {...errorProps(errors.email)}
          inputMode="email"
          label="Email"
          onChange={(email) => update({ contact: { ...draft.contact, email } })}
          placeholder="project@example.ru"
          type="email"
          value={draft.contact?.email ?? ''}
        />
      );

    case 16:
      return (
        <>
          <ToggleRow
            checked={draft.consent?.accepted === true}
            description="Для сохранения и рассмотрения брифа, связи со мной и подготовки предложения. Срок хранения заявки — до 3 лет; согласие можно отозвать через manager@craft72.ru. Без согласия отправка через Mini App невозможна."
            label="Даю согласие ООО «Крафт Групп» на обработку данных заявки"
            onChange={(event) =>
              update({
                consent: {
                  accepted: event.currentTarget.checked,
                  version: consentVersion,
                },
              })
            }
          />
          {errors.consent === undefined ? null : (
            <span className="field__error">{errors.consent}</span>
          )}
          {privacyPolicyUrl === undefined ? (
            <InlineNotice icon="warning" tone="warning">
              <strong>Демонстрационный текст согласия</strong>
              <span>{MOCK_CONTENT_NOTICE}</span>
            </InlineNotice>
          ) : (
            <InlineNotice icon="shield">
              <strong>Политика обработки данных</strong>
              <span>
                Перед подтверждением ознакомьтесь с{' '}
                <a href={privacyPolicyUrl} rel="noreferrer" target="_blank">
                  опубликованной политикой CRAFT72
                </a>
                . Версия согласия: {consentVersion}.
              </span>
            </InlineNotice>
          )}
        </>
      );

    case 17: {
      const form = finalFormFromDraft(draft);

      if (form === null) {
        return (
          <InlineNotice icon="warning" tone="warning">
            <strong>Нужно проверить заполненные разделы</strong>
            <span>
              {errors.form ?? 'Вернитесь к полям с пропущенными или некорректными данными.'}
            </span>
          </InlineNotice>
        );
      }

      const reviewSections: readonly {
        readonly editStep: BriefStep;
        readonly label: string;
        readonly value: string;
      }[] = [
        {
          editStep: 2,
          label: 'Заказчик',
          value: `${form.fullName} · ${form.organization}`,
        },
        {
          editStep: 4,
          label: 'Объект',
          value: `${labelFor(OBJECT_TYPE_OPTIONS, form.objectType)} · ${formatLocation(form)}`,
        },
        { editStep: 6, label: 'Масштаб', value: formatScope(form) },
        {
          editStep: 9,
          label: 'Услуги',
          value: form.services.map((service) => labelFor(SERVICE_OPTIONS, service)).join(', '),
        },
        {
          editStep: 13,
          label: 'Материалы',
          value: `${String(materialCount)} файлов · ${String(form.links.length)} ссылок`,
        },
        { editStep: 14, label: 'Контакт', value: `${form.contact.phone} · ${form.contact.email}` },
      ];

      return (
        <div className="summary-sections">
          {reviewSections.map((section) => (
            <section className="summary-card" key={section.label}>
              <div className="summary-card__head">
                <h2>{section.label}</h2>
                {onEditStep === undefined ? null : (
                  <button onClick={() => onEditStep(section.editStep)} type="button">
                    Изменить
                  </button>
                )}
              </div>
              <dl>
                <dt>Указано</dt>
                <dd>{section.value}</dd>
              </dl>
            </section>
          ))}
        </div>
      );
    }
  }
};

export interface BriefScreenProps {
  readonly consentVersion?: string;
  readonly draft: LeadDraftFormState;
  readonly isSaving?: boolean;
  readonly materialCount?: number;
  readonly onBack: () => void;
  readonly onContinue: (draft: LeadDraftFormState) => void | Promise<void>;
  readonly onDraftChange: (draft: LeadDraftFormState) => void;
  readonly onEditStep?: (step: BriefStep) => void;
  readonly onOpenMaterials?: () => void;
  readonly onRequestContact?: () => void | Promise<void>;
  readonly onSaveAndExit: (draft: LeadDraftFormState) => void | Promise<void>;
  readonly phoneVerified?: boolean;
  readonly privacyPolicyUrl?: string;
  readonly requestingContact?: boolean;
  readonly serverBacked?: boolean;
  readonly step: BriefStep;
}

export const BriefScreen = ({
  consentVersion = MOCK_CONSENT_VERSION,
  draft,
  isSaving = false,
  materialCount = draft.documentIds?.length ?? 0,
  onBack,
  onContinue,
  onDraftChange,
  onEditStep,
  onOpenMaterials,
  onRequestContact,
  onSaveAndExit,
  phoneVerified = false,
  privacyPolicyUrl,
  requestingContact = false,
  serverBacked = false,
  step,
}: BriefScreenProps) => {
  const [errors, setErrors] = useState<BriefErrors>({});
  const meta = BRIEF_STEP_META[step];

  useEffect(() => {
    setErrors({});
  }, [step]);

  const handleDraftChange = (nextDraft: LeadDraftFormState): void => {
    setErrors({});
    onDraftChange(nextDraft);
  };

  const handleContinue = (): void => {
    const nextErrors = validateBriefStep(step, draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) void onContinue(draft);
  };

  return (
    <Page className="page--narrow">
      <ScreenHeader
        eyebrow={`Шаг ${String(step)} из ${String(BRIEF_TOTAL_STEPS)}`}
        onBack={onBack}
        subtitle="Структурированный бриф проекта"
        title="Новый проект"
      />
      <ProgressBar current={step} label={meta.title} total={BRIEF_TOTAL_STEPS} />

      <section className="form-card">
        <h2 className="form-card__title">{meta.title}</h2>
        <p className="form-card__subtitle">{meta.subtitle}</p>
        <div className="form-stack">
          <BriefStepFields
            consentVersion={consentVersion}
            draft={draft}
            errors={errors}
            materialCount={materialCount}
            onChange={handleDraftChange}
            {...(onEditStep === undefined ? {} : { onEditStep })}
            {...(onOpenMaterials === undefined ? {} : { onOpenMaterials })}
            {...(onRequestContact === undefined ? {} : { onRequestContact })}
            phoneVerified={phoneVerified}
            {...(privacyPolicyUrl === undefined ? {} : { privacyPolicyUrl })}
            requestingContact={requestingContact}
            serverBacked={serverBacked}
            step={step}
          />
        </div>
      </section>

      <StickyActions
        continueDisabled={isSaving}
        continueLabel={step === 17 ? 'Перейти к проверке' : 'Продолжить'}
        loading={isSaving}
        onBack={onBack}
        onContinue={handleContinue}
      >
        <button className="save-exit" onClick={() => void onSaveAndExit(draft)} type="button">
          Сохранить и выйти
        </button>
      </StickyActions>
    </Page>
  );
};
