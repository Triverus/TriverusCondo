import React, { useState } from 'react';

interface ProfileAvatarProps {
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeMap = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-7 h-7 text-xs',
  md: 'w-8 h-8 text-xs',
  lg: 'w-10 h-10 text-sm',
  xl: 'w-12 h-12 text-base',
};

export const ProfileAvatar: React.FC<ProfileAvatarProps> = ({
  name = 'Usuário',
  size = 'md',
  className = '',
}) => {
  const initial = (name || 'U').trim().charAt(0).toUpperCase();
  const dimensionClass = sizeMap[size] || sizeMap.md;

  return (
    <div
      className={`${dimensionClass} rounded-full bg-slate-800 border border-slate-700/80 flex items-center justify-center font-bold text-slate-200 shrink-0 select-none shadow-xs ${className}`}
      title={name}
    >
      {initial}
    </div>
  );
};

export default ProfileAvatar;
