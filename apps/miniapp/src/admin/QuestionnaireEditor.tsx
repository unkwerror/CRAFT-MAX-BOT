import type { QuestionnaireContent } from './questionnaire-content.js';

const OPTION_GROUPS: readonly {
  readonly key: keyof QuestionnaireContent['options'];
  readonly title: string;
}[] = [
  { key: 'roles', title: 'Роли заказчика' },
  { key: 'objectTypes', title: 'Типы объектов' },
  { key: 'projectStages', title: 'Стадии проекта' },
  { key: 'services', title: 'Услуги' },
  { key: 'triState', title: 'Да / нет / не знаю' },
  { key: 'scope', title: 'Масштаб проекта' },
  { key: 'areaStatus', title: 'Статус площади' },
  { key: 'startStatus', title: 'Статус даты старта' },
];

export interface QuestionnaireEditorProps {
  readonly onChange: (value: QuestionnaireContent) => void;
  readonly value: QuestionnaireContent;
}

export const QuestionnaireEditor = ({ onChange, value }: QuestionnaireEditorProps) => {
  const updateStep = (key: string, field: 'subtitle' | 'title', nextValue: string): void => {
    const current = value.steps[key];
    if (current === undefined) return;
    onChange({
      ...value,
      steps: {
        ...value.steps,
        [key]: { ...current, [field]: nextValue },
      },
    });
  };

  const updateOption = (
    group: keyof QuestionnaireContent['options'],
    index: number,
    field: 'description' | 'label',
    nextValue: string,
  ): void => {
    const options = value.options[group];
    const current = options[index];
    if (current === undefined) return;
    const nextOptions = options.map((option, optionIndex) =>
      optionIndex === index
        ? {
            ...option,
            [field]: nextValue,
          }
        : option,
    );
    onChange({
      ...value,
      options: { ...value.options, [group]: nextOptions },
    });
  };

  return (
    <div className="admin-questionnaire">
      <div className="admin-callout">
        <strong>Безопасное редактирование анкеты</strong>
        <p>
          Меняйте заголовки, подсказки и подписи вариантов. Системные коды остаются неизменными,
          поэтому старые черновики и заявки продолжат открываться корректно.
        </p>
      </div>

      <details className="admin-editor-group" open>
        <summary>
          <span>
            <strong>Экраны анкеты</strong>
            <small>17 шагов</small>
          </span>
        </summary>
        <div className="admin-step-editor-list">
          {Object.entries(value.steps).map(([key, step]) => (
            <article className="admin-step-editor" key={key}>
              <span className="admin-step-editor__number">{key.padStart(2, '0')}</span>
              <label>
                <span>Заголовок</span>
                <input
                  maxLength={160}
                  onChange={(event) => updateStep(key, 'title', event.currentTarget.value)}
                  value={step.title}
                />
              </label>
              <label>
                <span>Подсказка</span>
                <textarea
                  maxLength={320}
                  onChange={(event) => updateStep(key, 'subtitle', event.currentTarget.value)}
                  rows={2}
                  value={step.subtitle}
                />
              </label>
            </article>
          ))}
        </div>
      </details>

      {OPTION_GROUPS.map(({ key, title }) => (
        <details className="admin-editor-group" key={key}>
          <summary>
            <span>
              <strong>{title}</strong>
              <small>{value.options[key].length} вариантов</small>
            </span>
          </summary>
          <div className="admin-option-editor-list">
            {value.options[key].map((option, index) => (
              <article className="admin-option-editor" key={option.value}>
                <code>{option.value}</code>
                <label>
                  <span>Подпись</span>
                  <input
                    maxLength={120}
                    onChange={(event) =>
                      updateOption(key, index, 'label', event.currentTarget.value)
                    }
                    value={option.label}
                  />
                </label>
                {option.description === undefined ? null : (
                  <label>
                    <span>Описание</span>
                    <input
                      maxLength={240}
                      onChange={(event) =>
                        updateOption(key, index, 'description', event.currentTarget.value)
                      }
                      value={option.description}
                    />
                  </label>
                )}
              </article>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
};
