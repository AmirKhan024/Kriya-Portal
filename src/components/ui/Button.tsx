'use client';

import React from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: React.ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary:   'bg-teal-400 text-slate-900 hover:bg-teal-300 font-semibold',
  secondary: 'bg-white/10 text-white border border-white/20 hover:bg-white/20',
  ghost:     'bg-transparent text-slate-400 hover:text-white',
  danger:    'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-lg',
  md: 'px-4 py-2.5 text-sm rounded-xl',
  lg: 'px-6 py-3 text-base rounded-xl',
};

const Spinner = () => (
  <svg
    className="animate-spin h-4 w-4 inline-block mr-2"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
  </svg>
);

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      disabled={isDisabled}
      className={[
        'inline-flex items-center justify-center transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-teal-400/40',
        variantClasses[variant],
        sizeClasses[size],
        isDisabled ? 'opacity-50 pointer-events-none' : '',
        className,
      ].join(' ')}
      {...props}
    >
      {loading && <Spinner />}
      <span className={loading ? 'opacity-50' : ''}>{children}</span>
    </button>
  );
}
