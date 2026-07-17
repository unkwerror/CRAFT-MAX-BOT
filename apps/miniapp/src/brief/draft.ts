import {
  EmailAddressSchema,
  HttpsUrlSchema,
  InnSchema,
  LeadFormDataSchema,
  PhoneNumberSchema,
  TaxonomyKeySchema,
  TriStateAnswerSchema,
  UserRoleSchema,
  type LeadDraftFormState,
  type LeadFormData,
} from '@craft72/contracts/source';

import { MOCK_CONSENT_VERSION } from '../content.js';

export type BriefErrors = Readonly<Record<string, string>>;

export const createEmptyDraft = (
  consentVersion: string = MOCK_CONSENT_VERSION,
): LeadDraftFormState => ({
  area: {},
  consent: { accepted: false, version: consentVersion },
  contact: {},
  documentIds: [],
  links: [],
  location: {},
  scope: {},
  selectedCaseIds: [],
  services: [],
});

const isNonBlank = (value: string | undefined, minimumLength = 1): boolean =>
  value !== undefined && value.trim().length >= minimumLength;

const numericValue = (value: string | undefined): number =>
  Number((value ?? '').trim().replace(',', '.'));

const validateTaxonomy = (value: string | undefined): boolean =>
  TaxonomyKeySchema.safeParse(value).success;

const validateHttpsLinks = (links: readonly string[] | undefined): boolean =>
  (links ?? []).every((link) => HttpsUrlSchema.safeParse(link).success);

export const validateBriefStep = (step: number, draft: LeadDraftFormState): BriefErrors => {
  switch (step) {
    case 1:
      return UserRoleSchema.safeParse(draft.role).success ? {} : { role: 'Выберите вашу роль' };
    case 2: {
      const errors: Record<string, string> = {};
      if (!isNonBlank(draft.fullName, 2)) errors.fullName = 'Укажите имя — минимум 2 символа';
      if (!isNonBlank(draft.organization)) errors.organization = 'Укажите организацию или ИП';
      return errors;
    }
    case 3:
      return draft.inn === undefined ||
        draft.inn === null ||
        draft.inn.trim() === '' ||
        InnSchema.safeParse(draft.inn.trim()).success
        ? {}
        : { inn: 'Проверьте ИНН: требуется 10 или 12 цифр с корректной контрольной суммой' };
    case 4:
      return validateTaxonomy(draft.objectType) ? {} : { objectType: 'Выберите тип объекта' };
    case 5:
      return isNonBlank(draft.location?.city) || isNonBlank(draft.location?.region)
        ? {}
        : { location: 'Укажите город или регион' };
    case 6: {
      if (draft.scope?.kind !== 'single_object' && draft.scope?.kind !== 'portfolio') {
        return { scope: 'Выберите один объект или портфель' };
      }
      if (
        draft.scope.kind === 'portfolio' &&
        (!Number.isInteger(numericValue(draft.scope.objectCount)) ||
          numericValue(draft.scope.objectCount) < 2)
      ) {
        return { objectCount: 'Для портфеля укажите количество от 2' };
      }
      return {};
    }
    case 7:
      if (draft.area?.status === 'unknown') return {};
      return draft.area?.status === 'known' && numericValue(draft.area.squareMeters) > 0
        ? {}
        : { area: 'Укажите площадь или выберите «Пока не знаю»' };
    case 8:
      return validateTaxonomy(draft.currentStage)
        ? {}
        : { currentStage: 'Выберите текущую стадию' };
    case 9:
      return (draft.services?.length ?? 0) > 0 ? {} : { services: 'Выберите хотя бы одну услугу' };
    case 10: {
      const errors: Record<string, string> = {};
      if (!TriStateAnswerSchema.safeParse(draft.expertiseRequired).success) {
        errors.expertiseRequired = 'Укажите, нужна ли экспертиза';
      }
      if (!TriStateAnswerSchema.safeParse(draft.culturalHeritageSite).success) {
        errors.culturalHeritageSite = 'Укажите статус объекта культурного наследия';
      }
      return errors;
    }
    case 11:
      if (draft.desiredStart?.status === 'unknown') return {};
      return draft.desiredStart?.status === 'known' &&
        /^\d{4}-\d{2}-\d{2}$/.test(draft.desiredStart.date ?? '')
        ? {}
        : { desiredStart: 'Выберите дату или «Пока не знаю»' };
    case 12:
      return isNonBlank(draft.description)
        ? {}
        : { description: 'Кратко опишите объект и ожидаемый результат' };
    case 13:
      return validateHttpsLinks(draft.links)
        ? {}
        : { links: 'Все ссылки должны начинаться с https://' };
    case 14:
      return PhoneNumberSchema.safeParse(draft.contact?.phone).success
        ? {}
        : { phone: 'Укажите телефон в международном формате, например +79990000000' };
    case 15:
      return EmailAddressSchema.safeParse(draft.contact?.email).success
        ? {}
        : { email: 'Проверьте адрес электронной почты' };
    case 16:
      return draft.consent?.accepted === true ? {} : { consent: 'Необходимо подтвердить согласие' };
    case 17:
      try {
        toFinalLeadForm(draft);
        return {};
      } catch {
        return { form: 'Проверьте заполненные разделы заявки' };
      }
    default:
      return { step: 'Неизвестный шаг анкеты' };
  }
};

export const toFinalLeadForm = (draft: LeadDraftFormState): LeadFormData => {
  const scope =
    draft.scope?.kind === 'portfolio'
      ? { kind: 'portfolio' as const, objectCount: numericValue(draft.scope.objectCount) }
      : { kind: 'single_object' as const };
  const area =
    draft.area?.status === 'known'
      ? { status: 'known' as const, squareMeters: numericValue(draft.area.squareMeters) }
      : { status: 'unknown' as const };
  const desiredStart =
    draft.desiredStart?.status === 'known'
      ? { status: 'known' as const, date: draft.desiredStart.date ?? '' }
      : { status: 'unknown' as const };

  return LeadFormDataSchema.parse({
    role: draft.role,
    fullName: draft.fullName?.trim(),
    organization: draft.organization?.trim(),
    inn:
      draft.inn === undefined || draft.inn === null || draft.inn.trim() === ''
        ? null
        : draft.inn.trim(),
    objectType: draft.objectType,
    location: {
      ...(isNonBlank(draft.location?.city) ? { city: draft.location?.city?.trim() } : {}),
      ...(isNonBlank(draft.location?.region) ? { region: draft.location?.region?.trim() } : {}),
    },
    scope,
    area,
    currentStage: draft.currentStage,
    services: draft.services ?? [],
    expertiseRequired: draft.expertiseRequired,
    culturalHeritageSite: draft.culturalHeritageSite,
    desiredStart,
    description: draft.description?.trim(),
    links: draft.links ?? [],
    documentIds: draft.documentIds ?? [],
    selectedCaseIds: draft.selectedCaseIds ?? [],
    contact: {
      phone: draft.contact?.phone,
      email: draft.contact?.email?.trim(),
    },
    consent: {
      version: draft.consent?.version ?? MOCK_CONSENT_VERSION,
      accepted: draft.consent?.accepted,
    },
  });
};

export const toggleDraftSelection = (
  values: readonly string[] | undefined,
  value: string,
  maximum = 20,
): string[] => {
  const selected = new Set(values ?? []);
  if (selected.has(value)) selected.delete(value);
  else if (selected.size < maximum) selected.add(value);
  return [...selected];
};
