/* eslint-disable react-refresh/only-export-components */

import { useId } from 'react';
import type { ReactNode } from 'react';

import { cn } from '../utils';

interface BaseFieldProps {
  autoComplete?: string;
  className?: string;
  disabled?: boolean;
  error?: string;
  hint?: ReactNode;
  id?: string;
  label: string;
  name: string;
  onChange: (value: string) => void;
  required?: boolean;
  value: string;
}

export interface TextFieldProps extends BaseFieldProps {
  inputMode?: 'none' | 'text' | 'email' | 'numeric' | 'decimal' | 'search' | 'url';
  maxLength?: number;
  placeholder?: string;
  type?: 'text' | 'email' | 'search' | 'url';
}

export interface TextAreaFieldProps extends BaseFieldProps {
  maxLength?: number;
  placeholder?: string;
  rows?: number;
}

export interface SelectOption {
  disabled?: boolean;
  label: string;
  value: string;
}

export interface SelectFieldProps extends BaseFieldProps {
  options: readonly SelectOption[];
  placeholder?: string;
}

export type DateFieldProps = Omit<BaseFieldProps, 'autoComplete'>;

export interface NumberFieldProps extends Omit<BaseFieldProps, 'autoComplete' | 'inputMode'> {
  max?: number;
  min?: number;
  placeholder?: string;
  step?: number | 'any';
}

export interface CheckboxFieldProps extends Omit<
  BaseFieldProps,
  'autoComplete' | 'inputMode' | 'onChange' | 'value'
> {
  onChange: (checked: boolean) => void;
  value: boolean;
}

export interface FormErrorSummaryProps {
  className?: string;
  errors?: Readonly<Record<string, string>>;
  id?: string;
  message?: ReactNode;
  title?: string;
}

interface FieldIdentifiers {
  errorId: string;
  hintId: string;
  inputId: string;
}

export function fieldErrorId(name: string, idPrefix?: string): string {
  return `${idPrefix ?? name}-error`;
}

export function fieldHintId(name: string, idPrefix?: string): string {
  return `${idPrefix ?? name}-hint`;
}

function useFieldIdentifiers(name: string, id?: string): FieldIdentifiers {
  const generatedId = useId();
  const inputId = id ?? `${name}-${generatedId.replaceAll(':', '')}`;

  return {
    errorId: fieldErrorId(name, inputId),
    hintId: fieldHintId(name, inputId),
    inputId,
  };
}

function FieldRequirement({ required }: { required: boolean | undefined }) {
  return required === true ? (
    <span aria-hidden="true" className="field__required">
      Required
    </span>
  ) : (
    <span aria-hidden="true" className="field__optional">
      Optional
    </span>
  );
}

function FieldMessages({
  error,
  errorId,
  hint,
  hintId,
}: {
  error: string | undefined;
  errorId: string;
  hint: ReactNode;
  hintId: string;
}) {
  const errorText = error?.trim();

  return (
    <>
      {hint === undefined ? null : (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {errorText === undefined || errorText.length === 0 ? null : (
        <p className="field__error" id={errorId}>
          {errorText}
        </p>
      )}
    </>
  );
}

function describedByFor(
  hint: ReactNode,
  error: string | undefined,
  hintId: string,
  errorId: string,
): string {
  const ids: string[] = [];
  if (hint !== undefined) {
    ids.push(hintId);
  }
  if (error !== undefined && error.trim().length > 0) {
    ids.push(errorId);
  }
  return ids.join(' ');
}

interface TextLikeFieldProps extends BaseFieldProps {
  inputMode?: TextFieldProps['inputMode'];
  max?: number;
  maxLength?: number;
  min?: number;
  placeholder?: string;
  step?: number | 'any';
  type: 'date' | 'email' | 'number' | 'search' | 'text' | 'url';
}

function TextLikeField({
  autoComplete,
  className,
  disabled,
  error,
  hint,
  id,
  inputMode,
  label,
  max,
  maxLength,
  min,
  name,
  onChange,
  placeholder,
  required,
  step,
  type,
  value,
}: TextLikeFieldProps) {
  const identifiers = useFieldIdentifiers(name, id);
  const hasError = error !== undefined && error.trim().length > 0;
  const describedBy = describedByFor(hint, error, identifiers.hintId, identifiers.errorId);

  return (
    <div className={cn('field', className)} data-field-name={name}>
      <label className="field__label" htmlFor={identifiers.inputId}>
        {label} <FieldRequirement required={required} />
      </label>
      <input
        aria-label={label}
        aria-describedby={describedBy.length > 0 ? describedBy : undefined}
        aria-invalid={hasError || undefined}
        autoComplete={autoComplete}
        disabled={disabled}
        id={identifiers.inputId}
        inputMode={inputMode}
        max={max}
        maxLength={maxLength}
        min={min}
        name={name}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        placeholder={placeholder}
        required={required}
        step={step}
        type={type}
        value={value}
      />
      <FieldMessages
        error={error}
        errorId={identifiers.errorId}
        hint={hint}
        hintId={identifiers.hintId}
      />
    </div>
  );
}

export function TextField(props: TextFieldProps) {
  return <TextLikeField {...props} type={props.type ?? 'text'} />;
}

export function DateField(props: DateFieldProps) {
  return <TextLikeField {...props} type="date" />;
}

export function NumberField(props: NumberFieldProps) {
  return <TextLikeField {...props} inputMode="decimal" type="number" />;
}

export function TextAreaField({
  autoComplete,
  className,
  disabled,
  error,
  hint,
  id,
  label,
  maxLength,
  name,
  onChange,
  placeholder,
  required,
  rows = 5,
  value,
}: TextAreaFieldProps) {
  const identifiers = useFieldIdentifiers(name, id);
  const hasError = error !== undefined && error.trim().length > 0;
  const describedBy = describedByFor(hint, error, identifiers.hintId, identifiers.errorId);

  return (
    <div className={cn('field', className)} data-field-name={name}>
      <label className="field__label" htmlFor={identifiers.inputId}>
        {label} <FieldRequirement required={required} />
      </label>
      <textarea
        aria-label={label}
        aria-describedby={describedBy.length > 0 ? describedBy : undefined}
        aria-invalid={hasError || undefined}
        autoComplete={autoComplete}
        disabled={disabled}
        id={identifiers.inputId}
        maxLength={maxLength}
        name={name}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        placeholder={placeholder}
        required={required}
        rows={rows}
        value={value}
      />
      <FieldMessages
        error={error}
        errorId={identifiers.errorId}
        hint={hint}
        hintId={identifiers.hintId}
      />
    </div>
  );
}

export function SelectField({
  autoComplete,
  className,
  disabled,
  error,
  hint,
  id,
  label,
  name,
  onChange,
  options,
  placeholder,
  required,
  value,
}: SelectFieldProps) {
  const identifiers = useFieldIdentifiers(name, id);
  const hasError = error !== undefined && error.trim().length > 0;
  const describedBy = describedByFor(hint, error, identifiers.hintId, identifiers.errorId);

  return (
    <div className={cn('field', className)} data-field-name={name}>
      <label className="field__label" htmlFor={identifiers.inputId}>
        {label} <FieldRequirement required={required} />
      </label>
      <select
        aria-label={label}
        aria-describedby={describedBy.length > 0 ? describedBy : undefined}
        aria-invalid={hasError || undefined}
        autoComplete={autoComplete}
        disabled={disabled}
        id={identifiers.inputId}
        name={name}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        required={required}
        value={value}
      >
        {placeholder === undefined ? null : <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option disabled={option.disabled} key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldMessages
        error={error}
        errorId={identifiers.errorId}
        hint={hint}
        hintId={identifiers.hintId}
      />
    </div>
  );
}

export function CheckboxField({
  className,
  disabled,
  error,
  hint,
  id,
  label,
  name,
  onChange,
  required,
  value,
}: CheckboxFieldProps) {
  const identifiers = useFieldIdentifiers(name, id);
  const hasError = error !== undefined && error.trim().length > 0;
  const describedBy = describedByFor(hint, error, identifiers.hintId, identifiers.errorId);

  return (
    <div className={cn('field', className)} data-field-name={name}>
      <label className="checkbox-field" htmlFor={identifiers.inputId}>
        <input
          aria-label={label}
          aria-describedby={describedBy.length > 0 ? describedBy : undefined}
          aria-invalid={hasError || undefined}
          checked={value}
          disabled={disabled}
          id={identifiers.inputId}
          name={name}
          onChange={(event) => {
            onChange(event.currentTarget.checked);
          }}
          required={required}
          type="checkbox"
        />
        <span>
          {label} <FieldRequirement required={required} />
        </span>
      </label>
      <FieldMessages
        error={error}
        errorId={identifiers.errorId}
        hint={hint}
        hintId={identifiers.hintId}
      />
    </div>
  );
}

export function FormErrorSummary({
  className,
  errors,
  id,
  message,
  title = 'Please check the form.',
}: FormErrorSummaryProps) {
  const generatedId = useId();
  const summaryId = id ?? `form-error-summary-${generatedId.replaceAll(':', '')}`;
  const fieldEntries =
    errors === undefined
      ? []
      : Object.entries(errors)
          .map(([field, value]) => [field, value.trim()] as const)
          .filter(([, value]) => value.length > 0);
  const showMessage =
    message !== undefined &&
    (typeof message !== 'string' || !fieldEntries.some(([, value]) => value === message));

  if (message === undefined && fieldEntries.length === 0) {
    return null;
  }

  return (
    <div
      aria-live="assertive"
      className={cn('form-error-summary', className)}
      data-error-summary
      id={summaryId}
      role="alert"
      tabIndex={-1}
    >
      <p className="form-error-summary__title">{title}</p>
      {showMessage ? <div>{message}</div> : null}
      {fieldEntries.length === 0 ? null : (
        <ul>
          {fieldEntries.map(([field, value]) => (
            <li key={`${field}-${value}`}>
              <span className="mono">{field}</span>: {value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
