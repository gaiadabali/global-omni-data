"use client";

import { useId } from "react";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** A labelled native select. */
export function Select({
  label,
  options,
  value,
  onChange,
  name,
  disabled,
}: {
  label: string;
  options: SelectOption[];
  value: string;
  onChange?: (value: string) => void;
  name?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="ctl">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        name={name}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
