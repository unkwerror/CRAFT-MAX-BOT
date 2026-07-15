import {
  ProjectScopeSchema,
  TaxonomyKeySchema,
  TriStateAnswerSchema,
  type ProjectScope,
  type TaxonomyKey,
  type TriStateAnswer,
} from '@craft72/contracts/source';

export interface ServiceDiagnosticInput {
  readonly objectType: TaxonomyKey;
  readonly currentStage: TaxonomyKey;
  readonly desiredResult: TaxonomyKey;
  readonly expertiseRequired: TriStateAnswer;
  readonly culturalHeritageSite: TriStateAnswer;
  readonly scope: ProjectScope;
}

export interface ServiceRecommendation {
  readonly service: TaxonomyKey;
  readonly title: string;
  readonly explanation: string;
}

interface ScoredDirection {
  readonly recommendation: ServiceRecommendation;
  readonly score: number;
  readonly order: number;
}

interface DirectionDefinition {
  readonly service: TaxonomyKey;
  readonly title: string;
  readonly fallbackExplanation: string;
  readonly score: (input: ServiceDiagnosticInput) => {
    readonly points: number;
    readonly explanation?: string;
  };
}

const EARLY_STAGES = new Set(['idea', 'pre-design', 'concept', 'site-selection']);
const ARCHITECTURE_RESULTS = new Set(['concept', 'architecture', 'design-concept']);
const DESIGN_RESULTS = new Set([
  'project-documentation',
  'working-documentation',
  'design-and-working-documentation',
]);
const SURVEY_RESULTS = new Set(['engineering-surveys', 'site-assessment', 'survey-report']);
const URBAN_RESULTS = new Set(['masterplan', 'land-planning', 'territory-concept']);

const directionDefinitions: readonly DirectionDefinition[] = [
  {
    service: 'restoration',
    title: 'Реставрация и приспособление ОКН',
    fallbackExplanation:
      'Для объекта культурного наследия нужна профильная реставрационная работа.',
    score: (input) => {
      if (input.culturalHeritageSite === 'yes') {
        return {
          points: 120,
          explanation:
            'Вы указали объект культурного наследия — требуется профильная реставрационная компетенция.',
        };
      }

      if (input.objectType === 'cultural-heritage') {
        return {
          points: 90,
          explanation: 'Тип объекта относится к культурному наследию.',
        };
      }

      return { points: 0 };
    },
  },
  {
    service: 'expertise-support',
    title: 'Сопровождение экспертизы',
    fallbackExplanation: 'Поможем подготовить и провести документацию через экспертизу.',
    score: (input) => {
      if (input.expertiseRequired === 'yes') {
        return {
          points: 100,
          explanation: 'Вы отметили обязательную экспертизу проектной документации.',
        };
      }

      if (input.expertiseRequired === 'unknown') {
        return {
          points: 15,
          explanation: 'Необходимость экспертизы стоит определить на установочной консультации.',
        };
      }

      return { points: 0 };
    },
  },
  {
    service: 'technical-customer',
    title: 'Функция технического заказчика',
    fallbackExplanation: 'Единая координация помогает управлять несколькими объектами.',
    score: (input) =>
      input.scope.kind === 'portfolio'
        ? {
            points: 85,
            explanation: `Для портфеля из ${String(input.scope.objectCount)} объектов полезна единая координация.`,
          }
        : { points: 0 },
  },
  {
    service: 'architecture',
    title: 'Архитектурная концепция',
    fallbackExplanation: 'Направление помогает сформировать архитектурное решение объекта.',
    score: (input) => {
      if (ARCHITECTURE_RESULTS.has(input.desiredResult)) {
        return {
          points: 95,
          explanation: 'Запрошенный результат напрямую относится к архитектурной концепции.',
        };
      }

      if (EARLY_STAGES.has(input.currentStage)) {
        return {
          points: 55,
          explanation: 'На текущей ранней стадии важно сформировать архитектурную концепцию.',
        };
      }

      return { points: 0 };
    },
  },
  {
    service: 'general-design',
    title: 'Генеральное проектирование',
    fallbackExplanation: 'Базовое направление для комплексной разработки проектной документации.',
    score: (input) => {
      if (DESIGN_RESULTS.has(input.desiredResult)) {
        return {
          points: 90,
          explanation: 'Нужна комплексная разработка проектной и рабочей документации.',
        };
      }

      if (input.currentStage === 'design' || input.currentStage === 'reconstruction') {
        return {
          points: 50,
          explanation: 'Текущая стадия требует координации основных проектных разделов.',
        };
      }

      return {
        points: 10,
        explanation: 'Комплекс задачи стоит уточнить с командой генерального проектирования.',
      };
    },
  },
  {
    service: 'engineering-surveys',
    title: 'Инженерные изыскания',
    fallbackExplanation: 'Изыскания дают исходные данные для последующего проектирования.',
    score: (input) => {
      if (SURVEY_RESULTS.has(input.desiredResult)) {
        return {
          points: 95,
          explanation: 'Запрошенный результат — комплект инженерных изысканий.',
        };
      }

      if (input.currentStage === 'site-selection') {
        return {
          points: 45,
          explanation: 'При выборе площадки нужны подтверждённые исходные данные.',
        };
      }

      return { points: 0 };
    },
  },
  {
    service: 'urban-planning',
    title: 'Градостроительные решения',
    fallbackExplanation: 'Направление подходит для концепций развития территории.',
    score: (input) =>
      URBAN_RESULTS.has(input.desiredResult) || input.objectType === 'urban-development'
        ? {
            points: 95,
            explanation: 'Задача связана с планированием и развитием территории.',
          }
        : { points: 0 },
  },
];

function parseDiagnosticInput(input: ServiceDiagnosticInput): ServiceDiagnosticInput {
  return {
    objectType: TaxonomyKeySchema.parse(input.objectType),
    currentStage: TaxonomyKeySchema.parse(input.currentStage),
    desiredResult: TaxonomyKeySchema.parse(input.desiredResult),
    expertiseRequired: TriStateAnswerSchema.parse(input.expertiseRequired),
    culturalHeritageSite: TriStateAnswerSchema.parse(input.culturalHeritageSite),
    scope: ProjectScopeSchema.parse(input.scope),
  };
}

/** Returns deterministic directions only; commercial estimates are deliberately out of scope. */
export function diagnoseServices(input: ServiceDiagnosticInput): readonly ServiceRecommendation[] {
  const diagnostic = parseDiagnosticInput(input);

  const scored: ScoredDirection[] = directionDefinitions
    .map((definition, order) => {
      const result = definition.score(diagnostic);
      return {
        recommendation: {
          service: definition.service,
          title: definition.title,
          explanation: result.explanation ?? definition.fallbackExplanation,
        },
        score: result.points,
        order,
      };
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.order - right.order);

  return scored.slice(0, 3).map((result) => result.recommendation);
}
