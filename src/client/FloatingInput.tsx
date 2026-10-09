import { useId, type InputHTMLAttributes } from 'react';
export function FloatingInput({
  label,
  id,
  placeholder,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <div className="floating-input">
      <input {...props} id={inputId} placeholder=" " className={className} />
      <label htmlFor={inputId}>{label}</label>
      {placeholder && <small className="muted">{placeholder}</small>}
    </div>
  );
}
