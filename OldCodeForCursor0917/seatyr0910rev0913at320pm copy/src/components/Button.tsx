import React, { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'warning';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
}

const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  className = '',
  ...props
}) => {
  // Base classes using ZoeStyle1a
  const baseClasses = 'danstyle1c-btn';
  
  // Add variant-specific classes
  let variantClasses = '';
  if (variant === 'primary') {
    // Primary uses default ZoeStyle1a
    variantClasses = '';
  } else if (variant === 'secondary') {
    // Secondary has same colors but may need specific styles
    variantClasses = '';
  } else if (variant === 'danger') {
    // Danger buttons use the remove style
    variantClasses = 'danstyle1c-remove';
  } else if (variant === 'success') {
    // Success buttons - can use a specific background color
    variantClasses = 'bg-[#586D78] text-white';
  } else if (variant === 'warning') {
    // Warning buttons - custom style
    variantClasses = 'bg-[#FFEE8C] text-[#6f5700] border-none';
  }
  
  // Size variations - only adjust padding for size differences
  const sizeClasses = {
    sm: 'text-sm px-4',
    md: 'px-6',
    lg: 'text-lg px-8'
  };
  
  // Disabled state
  const disabledClasses = props.disabled ? 'opacity-50 cursor-not-allowed' : '';
  
  return (
    <button
      className={`${baseClasses} ${variantClasses} ${sizeClasses[size]} ${disabledClasses} ${className}`}
      {...props}
    >
      {icon && iconPosition === 'left' && <span className="mr-2">{icon}</span>}
      {children}
      {icon && iconPosition === 'right' && <span className="ml-2">{icon}</span>}
    </button>
  );
};

export default Button;