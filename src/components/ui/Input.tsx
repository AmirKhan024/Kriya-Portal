'use client';

import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helpText?: string;
}

export function Input({ label, error, helpText, className = '', id, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className="text-xs font-semibold uppercase tracking-widest text-slate-400"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={[
          'bg-white/5 border rounded-xl px-4 py-2.5 text-white text-sm placeholder-slate-500',
          'focus:outline-none focus:ring-1 transition-colors duration-150',
          error
            ? 'border-red-500/60 focus:border-red-500/60 focus:ring-red-500/20'
            : 'border-white/10 focus:border-teal-400 focus:ring-teal-400/20',
          className,
        ].join(' ')}
        {...props}
      />
      {error && <p className="text-xs text-red-400 mt-0.5">{error}</p>}
      {helpText && !error && <p className="text-xs text-slate-500">{helpText}</p>}
    </div>
  );
}
