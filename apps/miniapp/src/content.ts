import type { UserRole } from '@craft72/contracts/source';

import type { ChoiceOption } from './components/FormControls.js';

export const MOCK_CONTENT_NOTICE =
  'Демонстрационные данные этапа 2. Перед production каталог, согласие и контакты утверждаются владельцем CRAFT72.';

export const MOCK_CONSENT_VERSION = 'mock-v1-not-for-production';

export const ROLE_OPTIONS: readonly ChoiceOption<UserRole>[] = [
  {
    description: 'Жилые и коммерческие проекты',
    icon: 'building',
    label: 'Девелопер',
    value: 'developer',
  },
  {
    description: 'Оценка идеи и потенциала',
    icon: 'spark',
    label: 'Инвестор',
    value: 'investor',
  },
  {
    description: 'Муниципальный или государственный объект',
    icon: 'projects',
    label: 'Государственный заказчик',
    value: 'government_customer',
  },
  {
    description: 'Развитие собственного объекта',
    icon: 'home',
    label: 'Собственник',
    value: 'property_owner',
  },
  {
    description: 'Проектирование в составе реализации',
    icon: 'brief',
    label: 'Генподрядчик',
    value: 'general_contractor',
  },
  {
    description: 'Расскажите о задаче в свободной форме',
    icon: 'compass',
    label: 'Другая роль',
    value: 'other',
  },
];

export const OBJECT_TYPE_OPTIONS = [
  { label: 'Жилой комплекс', value: 'residential' },
  { label: 'Общественное здание', value: 'public-building' },
  { label: 'Офис и бизнес-центр', value: 'office' },
  { label: 'Промышленный объект', value: 'industrial' },
  { label: 'Гостиница и туризм', value: 'hospitality' },
  { label: 'Территория / мастер-план', value: 'urban-development' },
  { label: 'Объект культурного наследия', value: 'cultural-heritage' },
  { label: 'Другой объект', value: 'other' },
] as const;

export const PROJECT_STAGE_OPTIONS = [
  { label: 'Идея или предпроект', value: 'idea' },
  { label: 'Концепция', value: 'concept' },
  { label: 'Проектная документация', value: 'design' },
  { label: 'Рабочая документация', value: 'working-documentation' },
  { label: 'Строительство', value: 'construction' },
  { label: 'Эксплуатация / реконструкция', value: 'reconstruction' },
] as const;

export const SERVICE_OPTIONS = [
  { label: 'Архитектурная концепция', value: 'architecture' },
  { label: 'Проектная документация', value: 'general-design' },
  { label: 'Инженерные изыскания', value: 'engineering-surveys' },
  { label: 'Сопровождение экспертизы', value: 'expertise-support' },
  { label: 'Мастер-план и градостроительство', value: 'urban-planning' },
  { label: 'Реконструкция и ОКН', value: 'restoration' },
  { label: 'Функция технического заказчика', value: 'technical-customer' },
  { label: 'Авторский надзор', value: 'author-supervision' },
] as const;

export const SERVICE_RESULT_OPTIONS = [
  { label: 'Понять потенциал площадки', value: 'site-assessment' },
  { label: 'Получить архитектурную концепцию', value: 'concept' },
  { label: 'Пройти экспертизу', value: 'project-documentation' },
  { label: 'Подготовить рабочую документацию', value: 'working-documentation' },
  { label: 'Разработать мастер-план', value: 'masterplan' },
  { label: 'Подготовить инженерные изыскания', value: 'engineering-surveys' },
] as const;

export const CONSTRUCTION_KIND_OPTIONS = [
  { label: 'Новое строительство', value: 'new-construction' },
  { label: 'Реконструкция', value: 'reconstruction' },
  { label: 'Объект культурного наследия', value: 'cultural-heritage' },
] as const;

export const SCALE_OPTIONS = [
  { label: 'Один объект', value: 'single-object' },
  { label: 'Крупный объект', value: 'large-object' },
  { label: 'Портфель', value: 'portfolio' },
  { label: 'Территория', value: 'territory' },
] as const;

export const TRI_STATE_OPTIONS = [
  { label: 'Да', value: 'yes' },
  { label: 'Нет', value: 'no' },
  { label: 'Пока не знаю', value: 'unknown' },
] as const;

export const labelFor = (
  options: readonly { readonly label: string; readonly value: string }[],
  value: string | undefined,
): string => options.find((option) => option.value === value)?.label ?? 'Не указано';
