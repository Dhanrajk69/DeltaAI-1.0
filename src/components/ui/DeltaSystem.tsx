import React from 'react';
import type { LucideIcon } from 'lucide-react';
import type { DeltaBadgeVariant } from '../../config/navigation';

export type DeltaButtonVariant = 'primary' | 'danger' | 'secondary' | 'toggle-active';
export type DeltaButtonSize = 'sm' | 'md' | 'lg';

interface DeltaButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: DeltaButtonVariant;
  size?: DeltaButtonSize;
}

const BUTTON_SIZE_MAP: Record<DeltaButtonSize, string> = {
  sm: 'btn-delta-sm',
  md: 'btn-delta',
  lg: 'btn-delta-lg',
};

const BUTTON_VARIANT_MAP: Record<DeltaButtonVariant, string> = {
  primary: 'btn-primary',
  danger: 'btn-danger',
  secondary: 'btn-secondary',
  'toggle-active': 'btn-toggle-active',
};

export const DeltaButton: React.FC<DeltaButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  className = '',
  type = 'button',
  children,
  ...rest
}) => (
  <button
    type={type}
    className={`${BUTTON_SIZE_MAP[size]} ${BUTTON_VARIANT_MAP[variant]} ${className}`.trim()}
    {...rest}
  >
    {children}
  </button>
);

const BADGE_VARIANT_MAP: Record<DeltaBadgeVariant, string> = {
  live: 'badge-delta-live',
  paper: 'badge-delta-paper',
  armed: 'badge-delta-armed',
  warning: 'badge-delta-warning',
  danger: 'badge-delta-danger',
  standby: 'badge-delta-standby',
};

interface DeltaBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: DeltaBadgeVariant;
}

export const DeltaBadge: React.FC<DeltaBadgeProps> = ({
  variant = 'standby',
  className = '',
  children,
  ...rest
}) => (
  <span className={`badge-delta ${BADGE_VARIANT_MAP[variant]} ${className}`.trim()} {...rest}>
    {children}
  </span>
);

interface DeltaPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  padded?: boolean;
}

export const DeltaPanel: React.FC<DeltaPanelProps> = ({
  padded = false,
  className = '',
  children,
  ...rest
}) => (
  <div className={`panel-delta ${padded ? 'panel-delta-body' : ''} ${className}`.trim()} {...rest}>
    {children}
  </div>
);

interface DeltaPanelHeaderProps {
  icon: LucideIcon;
  iconClassName?: string;
  title: React.ReactNode;
  rightSlot?: React.ReactNode;
  className?: string;
}

export const DeltaPanelHeader: React.FC<DeltaPanelHeaderProps> = ({
  icon: Icon,
  iconClassName = 'text-cyan-400',
  title,
  rightSlot,
  className = '',
}) => (
  <div className={`panel-delta-header ${className}`.trim()}>
    <div className="panel-delta-title">
      <Icon className={`w-4 h-4 shrink-0 ${iconClassName}`} aria-hidden="true" />
      <span className="truncate">{title}</span>
    </div>
    {rightSlot && <div className="flex items-center gap-1.5 shrink-0">{rightSlot}</div>}
  </div>
);
