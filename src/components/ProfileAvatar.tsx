import React, { useState } from 'react';

interface ProfileAvatarProps {
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const TRIVERUS_LOGO_URL = 'https://adm.triveruscondo.com/wp-content/uploads/2026/10/7.png';

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
  const [hasError, setHasError] = useState(false);

  const initial = (name || 'U').charAt(0).toUpperCase();
  const dimensionClass = sizeMap[size] || sizeMap.md;

  if (hasError) {
    return (
      <div
        className={`${dimensionClass} rounded-full bg-[#FF6600]/15 border border-[#FF6600]/30 flex items-center justify-center font-bold text-[#FF6600] shrink-0 ${className}`}
        title={name}
      >
        {initial}
      </div>
    );
  }

  return (
    <div
      className={`${dimensionClass} rounded-full bg-slate-900 border border-slate-700/80 p-0.5 flex items-center justify-center overflow-hidden shrink-0 shadow-xs ${className}`}
      title={name}
    >
      <img
        src={TRIVERUS_LOGO_URL}
        alt={name}
        className="w-full h-full object-contain rounded-full"
        onError={() => setHasError(true)}
      />
    </div>
  );
};

export default ProfileAvatar;
