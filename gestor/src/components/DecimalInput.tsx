import { useEffect, useState } from 'react';
import { decimalInput, parseDecimal } from '../lib/format';

/**
 * Campo numérico que aceita vírgula decimal. Mantém o texto digitado enquanto o usuário edita
 * e só envia o valor quando ele é um número válido (≥ 0).
 */
export function DecimalInput({ value, onChange, ...rest }: { value: number; onChange: (v: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(decimalInput(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(decimalInput(value));
  }, [value, focused]);
  const parsed = parseDecimal(text);
  const invalid = text.trim() !== '' && (parsed === null || Number.isNaN(parsed) || parsed < 0);
  return (
    <input
      {...rest}
      inputMode="decimal"
      autoComplete="off"
      value={text}
      aria-invalid={invalid}
      style={invalid ? { borderColor: 'var(--bad-text)' } : undefined}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setText(decimalInput(value));
      }}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseDecimal(e.target.value);
        if (v !== null && !Number.isNaN(v) && v >= 0) onChange(v);
      }}
    />
  );
}
