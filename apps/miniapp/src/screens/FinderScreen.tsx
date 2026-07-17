import { Button } from '@maxhub/max-ui';
import { useState } from 'react';
import type { ProjectScope, TaxonomyKey, TriStateAnswer } from '@craft72/contracts/source';

import { InlineNotice } from '../components/FormControls.js';
import { Page, ScreenHeader, StickyActions } from '../components/Layout.js';
import {
  MOCK_CONTENT_NOTICE,
  OBJECT_TYPE_OPTIONS,
  PROJECT_STAGE_OPTIONS,
  SERVICE_RESULT_OPTIONS,
  TRI_STATE_OPTIONS,
} from '../content.js';
import {
  diagnoseServices,
  type ServiceDiagnosticInput,
  type ServiceRecommendation,
} from '../domain/service-diagnostic.js';

const SCOPE_OPTIONS = [
  { label: 'Один объект', value: 'single_object' },
  { label: 'Портфель объектов', value: 'portfolio' },
] as const;

interface FinderAnswers {
  readonly objectType?: TaxonomyKey;
  readonly currentStage?: TaxonomyKey;
  readonly desiredResult?: TaxonomyKey;
  readonly expertiseRequired?: TriStateAnswer;
  readonly culturalHeritageSite?: TriStateAnswer;
  readonly scopeKind?: ProjectScope['kind'];
  readonly objectCount: string;
}

interface ChipQuestionProps<T extends string> {
  readonly onChange: (value: T) => void;
  readonly options: readonly { readonly label: string; readonly value: T }[];
  readonly title: string;
  readonly value: T | undefined;
}

const ChipQuestion = <T extends string>({
  onChange,
  options,
  title,
  value,
}: ChipQuestionProps<T>) => (
  <section className="finder-question">
    <h2>{title}</h2>
    <div className="chip-list">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            aria-pressed={selected}
            className={selected ? 'chip is-selected' : 'chip'}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  </section>
);

function answersFromInput(input: ServiceDiagnosticInput | undefined): FinderAnswers {
  if (input === undefined) {
    return { objectCount: '' };
  }

  return {
    objectType: input.objectType,
    currentStage: input.currentStage,
    desiredResult: input.desiredResult,
    expertiseRequired: input.expertiseRequired,
    culturalHeritageSite: input.culturalHeritageSite,
    scopeKind: input.scope.kind,
    objectCount: input.scope.kind === 'portfolio' ? String(input.scope.objectCount) : '',
  };
}

function diagnosticInputFromAnswers(answers: FinderAnswers): ServiceDiagnosticInput | null {
  const {
    culturalHeritageSite,
    currentStage,
    desiredResult,
    expertiseRequired,
    objectType,
    scopeKind,
  } = answers;

  if (
    objectType === undefined ||
    currentStage === undefined ||
    desiredResult === undefined ||
    expertiseRequired === undefined ||
    culturalHeritageSite === undefined ||
    scopeKind === undefined
  ) {
    return null;
  }

  let scope: ProjectScope;
  if (scopeKind === 'single_object') {
    scope = { kind: 'single_object' };
  } else {
    const objectCount = Number(answers.objectCount);
    if (!Number.isInteger(objectCount) || objectCount < 2 || objectCount > 100_000) {
      return null;
    }
    scope = { kind: 'portfolio', objectCount };
  }

  return {
    objectType,
    currentStage,
    desiredResult,
    expertiseRequired,
    culturalHeritageSite,
    scope,
  };
}

export interface FinderScreenProps {
  readonly initialInput?: ServiceDiagnosticInput;
  readonly onBack: () => void;
  readonly onDiscuss: (recommendations: readonly ServiceRecommendation[]) => void;
}

export const FinderScreen = ({ initialInput, onBack, onDiscuss }: FinderScreenProps) => {
  const [answers, setAnswers] = useState<FinderAnswers>(() => answersFromInput(initialInput));
  const [recommendations, setRecommendations] = useState<readonly ServiceRecommendation[] | null>(
    null,
  );
  const diagnosticInput = diagnosticInputFromAnswers(answers);

  const updateAnswers = (patch: Partial<FinderAnswers>): void => {
    setAnswers((current) => ({ ...current, ...patch }));
    setRecommendations(null);
  };

  const runDiagnostic = (): void => {
    if (diagnosticInput !== null) {
      setRecommendations(diagnoseServices(diagnosticInput));
    }
  };

  return (
    <Page className="page--narrow" withNavigation={false}>
      <ScreenHeader
        eyebrow="Короткая диагностика"
        onBack={onBack}
        subtitle="Ответьте на шесть вопросов — покажем до трёх подходящих направлений."
        title="Подобрать услугу"
      />

      {recommendations === null ? (
        <>
          <div className="finder-steps">
            <ChipQuestion
              onChange={(objectType) => updateAnswers({ objectType })}
              options={OBJECT_TYPE_OPTIONS}
              title="1. Какой у вас объект?"
              value={answers.objectType}
            />
            <ChipQuestion
              onChange={(currentStage) => updateAnswers({ currentStage })}
              options={PROJECT_STAGE_OPTIONS}
              title="2. На какой стадии проект?"
              value={answers.currentStage}
            />
            <ChipQuestion
              onChange={(desiredResult) => updateAnswers({ desiredResult })}
              options={SERVICE_RESULT_OPTIONS}
              title="3. Какой результат нужен?"
              value={answers.desiredResult}
            />
            <ChipQuestion
              onChange={(expertiseRequired) => updateAnswers({ expertiseRequired })}
              options={TRI_STATE_OPTIONS}
              title="4. Потребуется экспертиза?"
              value={answers.expertiseRequired}
            />
            <ChipQuestion
              onChange={(culturalHeritageSite) => updateAnswers({ culturalHeritageSite })}
              options={TRI_STATE_OPTIONS}
              title="5. Объект относится к ОКН?"
              value={answers.culturalHeritageSite}
            />
            <section className="finder-question">
              <h2>6. Один объект или портфель?</h2>
              <div className="chip-list">
                {SCOPE_OPTIONS.map((option) => {
                  const selected = answers.scopeKind === option.value;
                  return (
                    <button
                      aria-pressed={selected}
                      className={selected ? 'chip is-selected' : 'chip'}
                      key={option.value}
                      onClick={() =>
                        updateAnswers({
                          scopeKind: option.value,
                          ...(option.value === 'single_object' ? { objectCount: '' } : {}),
                        })
                      }
                      type="button"
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              {answers.scopeKind !== 'portfolio' ? null : (
                <label className="filter-control filter-control--wide">
                  <span>Количество объектов</span>
                  <input
                    aria-label="Количество объектов в портфеле"
                    inputMode="numeric"
                    max={100_000}
                    min={2}
                    onChange={(event) => updateAnswers({ objectCount: event.currentTarget.value })}
                    placeholder="Например, 5"
                    type="number"
                    value={answers.objectCount}
                  />
                </label>
              )}
            </section>
          </div>

          <InlineNotice icon="spark">{MOCK_CONTENT_NOTICE}</InlineNotice>
          <StickyActions
            continueDisabled={diagnosticInput === null}
            continueLabel="Подобрать"
            onBack={onBack}
            onContinue={runDiagnostic}
          />
        </>
      ) : (
        <>
          <section aria-live="polite">
            <div className="section-heading">
              <div>
                <h2>Подходящие направления</h2>
                <p>Результат основан только на выбранных параметрах</p>
              </div>
              <Button mode="secondary" onClick={() => setRecommendations(null)} size="small">
                Изменить ответы
              </Button>
            </div>
            <div className="recommendation-list">
              {recommendations.map((recommendation, index) => (
                <article className="recommendation-card" key={recommendation.service}>
                  <span className="recommendation-card__number">{index + 1}</span>
                  <h3>{recommendation.title}</h3>
                  <p>{recommendation.explanation}</p>
                </article>
              ))}
            </div>
          </section>

          <InlineNotice icon="compass">
            Это предварительный ориентир для разговора с командой. Диагностика не рассчитывает
            стоимость и срок проекта.
          </InlineNotice>
          <StickyActions
            backLabel="Изменить ответы"
            continueLabel="Обсудить проект"
            onBack={() => setRecommendations(null)}
            onContinue={() => onDiscuss(recommendations)}
          />
        </>
      )}
    </Page>
  );
};
