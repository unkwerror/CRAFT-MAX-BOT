import type { AdminJsonValue } from '@craft72/contracts/source';

import {
  OBJECT_TYPE_OPTIONS,
  PROJECT_STAGE_OPTIONS,
  ROLE_OPTIONS,
  SERVICE_OPTIONS,
  TRI_STATE_OPTIONS,
} from '../content.js';

export interface QuestionnaireStepCopy {
  readonly subtitle: string;
  readonly title: string;
}

export interface QuestionnaireChoiceCopy {
  readonly description?: string;
  readonly label: string;
  readonly value: string;
}

export interface QuestionnaireContent {
  readonly options: {
    readonly areaStatus: readonly QuestionnaireChoiceCopy[];
    readonly objectTypes: readonly QuestionnaireChoiceCopy[];
    readonly projectStages: readonly QuestionnaireChoiceCopy[];
    readonly roles: readonly QuestionnaireChoiceCopy[];
    readonly scope: readonly QuestionnaireChoiceCopy[];
    readonly services: readonly QuestionnaireChoiceCopy[];
    readonly startStatus: readonly QuestionnaireChoiceCopy[];
    readonly triState: readonly QuestionnaireChoiceCopy[];
  };
  readonly steps: Readonly<Record<string, QuestionnaireStepCopy>>;
}

const DEFAULT_STEPS: Readonly<Record<string, QuestionnaireStepCopy>> = {
  '1': {
    title: 'Ваша роль в проекте',
    subtitle: 'Это поможет говорить о задаче в подходящем контексте.',
  },
  '2': {
    title: 'Представьтесь',
    subtitle: 'Укажите имя и организацию, от которой вы обращаетесь.',
  },
  '3': {
    title: 'ИНН организации',
    subtitle: 'Необязательное поле — его можно заполнить позднее.',
  },
  '4': { title: 'Тип объекта', subtitle: 'Выберите наиболее близкий вариант.' },
  '5': { title: 'Где находится объект', subtitle: 'Достаточно указать город или регион.' },
  '6': {
    title: 'Масштаб проекта',
    subtitle: 'Один объект или портфель из нескольких объектов.',
  },
  '7': {
    title: 'Площадь объекта',
    subtitle: 'Если точной площади ещё нет, это можно отметить.',
  },
  '8': { title: 'Текущая стадия', subtitle: 'На каком этапе проект находится сейчас?' },
  '9': { title: 'Какие услуги нужны', subtitle: 'Можно выбрать несколько направлений.' },
  '10': {
    title: 'Экспертиза и статус ОКН',
    subtitle: 'Ответ «Пока не знаю» тоже подходит.',
  },
  '11': {
    title: 'Желаемое начало работ',
    subtitle: 'Укажите ориентир или отметьте, что дата пока неизвестна.',
  },
  '12': {
    title: 'Расскажите о задаче',
    subtitle: 'Коротко опишите объект, исходную ситуацию и ожидаемый результат.',
  },
  '13': {
    title: 'Материалы и ссылки',
    subtitle: 'Добавьте документы либо HTTPS-ссылки, если они уже есть.',
  },
  '14': {
    title: 'Телефон для связи',
    subtitle: 'Можно передать контакт из MAX или ввести номер вручную.',
  },
  '15': {
    title: 'Электронная почта',
    subtitle: 'На этот адрес можно будет отправлять материалы по проекту.',
  },
  '16': {
    title: 'Согласие на обработку данных',
    subtitle: 'Подтвердите согласие на обработку данных этой заявки — это нужно для отправки.',
  },
  '17': {
    title: 'Анкета заполнена',
    subtitle: 'Осталось открыть итоговое резюме и отправить заявку.',
  },
};

const normalizeChoices = (
  input: readonly {
    readonly label: string;
    readonly value: string;
    readonly description?: string;
  }[],
): readonly QuestionnaireChoiceCopy[] =>
  input.map(({ description, label, value }) => ({
    label,
    value,
    ...(description === undefined ? {} : { description }),
  }));

export const DEFAULT_QUESTIONNAIRE_CONTENT: QuestionnaireContent = {
  steps: DEFAULT_STEPS,
  options: {
    roles: normalizeChoices(ROLE_OPTIONS),
    objectTypes: normalizeChoices(OBJECT_TYPE_OPTIONS),
    projectStages: normalizeChoices(PROJECT_STAGE_OPTIONS),
    services: normalizeChoices(SERVICE_OPTIONS),
    triState: normalizeChoices(TRI_STATE_OPTIONS),
    scope: [
      { label: 'Один объект', value: 'single_object' },
      { label: 'Портфель объектов', value: 'portfolio' },
    ],
    areaStatus: [
      { label: 'Площадь известна', value: 'known' },
      { label: 'Пока не знаю', value: 'unknown' },
    ],
    startStatus: [
      { label: 'Есть ориентир по дате', value: 'known' },
      { label: 'Пока не знаю', value: 'unknown' },
    ],
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const boundedText = (value: unknown, fallback: string, maxLength: number): string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= maxLength
    ? value.trim()
    : fallback;

const mergeChoices = (
  input: unknown,
  defaults: readonly QuestionnaireChoiceCopy[],
): readonly QuestionnaireChoiceCopy[] => {
  if (!Array.isArray(input)) return defaults;
  return defaults.map((fallback) => {
    const candidate = input.find(
      (item): item is Record<string, unknown> => isRecord(item) && item.value === fallback.value,
    );
    if (candidate === undefined) return fallback;
    const description =
      fallback.description === undefined
        ? undefined
        : boundedText(candidate.description, fallback.description, 240);
    return {
      value: fallback.value,
      label: boundedText(candidate.label, fallback.label, 120),
      ...(description === undefined ? {} : { description }),
    };
  });
};

/**
 * Published admin content may change copy, but stable values and all 17 required steps stay intact.
 * This keeps already saved drafts and the server-side lead schema backwards compatible.
 */
export const normalizeQuestionnaireContent = (input: unknown): QuestionnaireContent => {
  if (!isRecord(input)) return DEFAULT_QUESTIONNAIRE_CONTENT;
  const rawSteps = isRecord(input.steps) ? input.steps : {};
  const rawOptions = isRecord(input.options) ? input.options : {};
  const steps = Object.fromEntries(
    Object.entries(DEFAULT_QUESTIONNAIRE_CONTENT.steps).map(([key, fallback]) => {
      const candidate = isRecord(rawSteps[key]) ? rawSteps[key] : {};
      return [
        key,
        {
          title: boundedText(candidate.title, fallback.title, 160),
          subtitle: boundedText(candidate.subtitle, fallback.subtitle, 320),
        },
      ];
    }),
  );

  return {
    steps,
    options: {
      roles: mergeChoices(rawOptions.roles, DEFAULT_QUESTIONNAIRE_CONTENT.options.roles),
      objectTypes: mergeChoices(
        rawOptions.objectTypes,
        DEFAULT_QUESTIONNAIRE_CONTENT.options.objectTypes,
      ),
      projectStages: mergeChoices(
        rawOptions.projectStages,
        DEFAULT_QUESTIONNAIRE_CONTENT.options.projectStages,
      ),
      services: mergeChoices(rawOptions.services, DEFAULT_QUESTIONNAIRE_CONTENT.options.services),
      triState: mergeChoices(rawOptions.triState, DEFAULT_QUESTIONNAIRE_CONTENT.options.triState),
      scope: mergeChoices(rawOptions.scope, DEFAULT_QUESTIONNAIRE_CONTENT.options.scope),
      areaStatus: mergeChoices(
        rawOptions.areaStatus,
        DEFAULT_QUESTIONNAIRE_CONTENT.options.areaStatus,
      ),
      startStatus: mergeChoices(
        rawOptions.startStatus,
        DEFAULT_QUESTIONNAIRE_CONTENT.options.startStatus,
      ),
    },
  };
};

export const questionnaireContentAsJson = (
  content: QuestionnaireContent,
): Record<string, AdminJsonValue> =>
  JSON.parse(JSON.stringify(content)) as Record<string, AdminJsonValue>;
