import { Input, Textarea } from '@maxhub/max-ui';
import type { ChangeEventHandler, ReactNode } from 'react';

import { Icon, type IconName } from './Icon.js';

export interface FieldProps {
  readonly children: ReactNode;
  readonly error?: string;
  readonly hint?: string;
  readonly label: string;
  readonly optional?: boolean;
}

export const Field = ({ children, error, hint, label, optional = false }: FieldProps) => (
  <label className={error === undefined ? 'field' : 'field field--error'}>
    <span className="field__label">
      {label}
      {optional ? <small>необязательно</small> : null}
    </span>
    {children}
    {error === undefined ? null : <span className="field__error">{error}</span>}
    {hint === undefined || error !== undefined ? null : <span className="field__hint">{hint}</span>}
  </label>
);

export interface TextFieldProps {
  readonly autoComplete?: string;
  readonly error?: string;
  readonly hint?: string;
  readonly inputMode?: 'decimal' | 'email' | 'numeric' | 'search' | 'tel' | 'text' | 'url';
  readonly label: string;
  readonly maxLength?: number;
  readonly onChange: (value: string) => void;
  readonly optional?: boolean;
  readonly placeholder?: string;
  readonly type?: 'date' | 'email' | 'number' | 'tel' | 'text' | 'url';
  readonly value: string;
}

export const TextField = ({
  autoComplete,
  error,
  hint,
  inputMode,
  label,
  maxLength,
  onChange,
  optional,
  placeholder,
  type = 'text',
  value,
}: TextFieldProps) => (
  <Field
    {...(error === undefined ? {} : { error })}
    {...(hint === undefined ? {} : { hint })}
    label={label}
    {...(optional === undefined ? {} : { optional })}
  >
    <Input
      aria-invalid={error === undefined ? undefined : true}
      autoComplete={autoComplete}
      inputMode={inputMode}
      maxLength={maxLength}
      mode="secondary"
      onChange={(event) => onChange(event.currentTarget.value)}
      placeholder={placeholder}
      type={type}
      value={value}
    />
  </Field>
);

export interface TextAreaFieldProps {
  readonly error?: string;
  readonly hint?: string;
  readonly label: string;
  readonly maxLength?: number;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly rows?: number;
  readonly value: string;
}

export const TextAreaField = ({
  error,
  hint,
  label,
  maxLength = 5_000,
  onChange,
  placeholder,
  rows = 5,
  value,
}: TextAreaFieldProps) => (
  <Field
    {...(error === undefined ? {} : { error })}
    {...(hint === undefined ? {} : { hint })}
    label={label}
  >
    <Textarea
      aria-invalid={error === undefined ? undefined : true}
      maxLength={maxLength}
      mode="secondary"
      onChange={(event) => onChange(event.currentTarget.value)}
      placeholder={placeholder}
      rows={rows}
      value={value}
    />
    <span className="field__counter">
      {value.length.toLocaleString('ru-RU')} / {maxLength.toLocaleString('ru-RU')}
    </span>
  </Field>
);

export interface ChoiceOption<T extends string> {
  readonly description?: string;
  readonly icon?: IconName;
  readonly label: string;
  readonly value: T;
}

export interface ChoiceGridProps<T extends string> {
  readonly columns?: 1 | 2;
  readonly error?: string;
  readonly label?: string;
  readonly multiple?: boolean;
  readonly onChange: (value: T) => void;
  readonly options: readonly ChoiceOption<T>[];
  readonly value: readonly T[] | T | undefined;
}

export const ChoiceGrid = <T extends string>({
  columns = 1,
  error,
  label,
  multiple = false,
  onChange,
  options,
  value,
}: ChoiceGridProps<T>) => {
  const selected = Array.isArray(value)
    ? new Set<string>(value)
    : new Set(value === undefined ? [] : [value]);

  return (
    <fieldset className={error === undefined ? 'choice-field' : 'choice-field field--error'}>
      {label === undefined ? null : <legend className="field__label">{label}</legend>}
      <div className={`choice-grid choice-grid--${String(columns)}`}>
        {options.map((option) => {
          const isSelected = selected.has(option.value);
          return (
            <button
              aria-pressed={isSelected}
              className={isSelected ? 'choice-card is-selected' : 'choice-card'}
              key={option.value}
              onClick={() => onChange(option.value)}
              type="button"
            >
              {option.icon === undefined ? null : (
                <span className="choice-card__icon">
                  <Icon name={option.icon} size={22} />
                </span>
              )}
              <span className="choice-card__copy">
                <strong>{option.label}</strong>
                {option.description === undefined ? null : <small>{option.description}</small>}
              </span>
              <span
                aria-hidden="true"
                className={multiple ? 'choice-card__check is-square' : 'choice-card__check'}
              >
                {isSelected ? <Icon name="check" size={15} /> : null}
              </span>
            </button>
          );
        })}
      </div>
      {error === undefined ? null : <span className="field__error">{error}</span>}
    </fieldset>
  );
};

export interface ToggleRowProps {
  readonly checked: boolean;
  readonly description?: string;
  readonly label: string;
  readonly onChange: ChangeEventHandler<HTMLInputElement>;
}

export const ToggleRow = ({ checked, description, label, onChange }: ToggleRowProps) => (
  <label className="toggle-row">
    <span>
      <strong>{label}</strong>
      {description === undefined ? null : <small>{description}</small>}
    </span>
    <input checked={checked} onChange={onChange} type="checkbox" />
  </label>
);

export interface InlineNoticeProps {
  readonly children: ReactNode;
  readonly icon?: IconName;
  readonly tone?: 'default' | 'warning' | 'success';
}

export const InlineNotice = ({
  children,
  icon = 'shield',
  tone = 'default',
}: InlineNoticeProps) => (
  <div className={`notice notice--${tone}`}>
    <Icon name={icon} size={20} />
    <div>{children}</div>
  </div>
);
