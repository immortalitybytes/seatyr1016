import React, { ReactNode } from 'react';

interface CardProps {
  title?: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
  style?: React.CSSProperties;
}

const Card: React.FC<CardProps> = ({ title, children, className = '', actions, style }) => {
  return (
    <div className={`bg-white rounded-lg shadow-md overflow-hidden ${className}`} style={style}>
      {title && (
        <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100 flex justify-between items-center">
          <h2 className="text-lg font-bold text-[#586D78]">{title}</h2>
          {actions && <div className="flex space-x-2">{actions}</div>}
        </div>
      )}
      <div className={title ? "p-2" : "p-4"}>{children}</div>
    </div>
  );
};

export default Card;