import React from 'react';
import { useTheme } from '../../lib/themeContext';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'rectangular' | 'rounded' | 'circular' | 'pill';
  width?: string | number;
  height?: string | number;
  className?: string;
  theme?: 'light' | 'dark';
  disableShimmer?: boolean;
}

/**
 * Componente base de Skeleton Loading com efeito Shimmer integrado.
 * Respeita preferências de redução de movimento e modo claro/escuro oficial.
 */
export const Skeleton: React.FC<SkeletonProps> = ({
  variant = 'rounded',
  width,
  height,
  className = '',
  style = {},
  theme: explicitTheme,
  disableShimmer = false,
  ...rest
}) => {
  const { theme: contextTheme } = useTheme();
  const currentTheme = explicitTheme || contextTheme;
  const isLight = currentTheme === 'light';

  const variantClasses = {
    text: 'rounded-md h-3.5',
    rectangular: 'rounded-none',
    rounded: 'rounded-xl',
    circular: 'rounded-full',
    pill: 'rounded-full',
  }[variant];

  // Cores neutras oficiais: Dark mode (#303034 / #2a2a2e) e Light mode (#E2E8F0 / #E1E4E8)
  const baseBg = isLight ? 'bg-[#E1E4E8]' : 'bg-[#303034]';
  const shimmerClass = disableShimmer ? '' : 'skeleton-shimmer';

  const inlineStyles: React.CSSProperties = {
    width: width !== undefined ? (typeof width === 'number' ? `${width}px` : width) : undefined,
    height: height !== undefined ? (typeof height === 'number' ? `${height}px` : height) : undefined,
    ...style,
  };

  return (
    <div
      aria-hidden="true"
      className={`${baseBg} ${variantClasses} ${shimmerClass} select-none pointer-events-none transition-colors duration-150 ${className}`}
      style={inlineStyles}
      {...rest}
    />
  );
};

/**
 * SKELETON OFICIAL DOS CARDS DA ABA PASTAS (REFERÊNCIA FIEL)
 * Reproduz com máxima precisão o layout de pasta com cabeçalho, indicador circular e 7 etapas documentais.
 */
export const SkeletonFolderCard: React.FC<{ className?: string; theme?: 'light' | 'dark' }> = ({
  className = '',
  theme = 'dark',
}) => {
  const isLight = theme === 'light';

  return (
    <div
      aria-hidden="true"
      className={`relative rounded-3xl overflow-hidden min-h-[230px] p-5 pt-7 flex flex-col justify-between border shadow-sm skeleton-shimmer select-none ${
        isLight
          ? 'bg-[#FFFFFF] border-[#D6DCE5]'
          : 'bg-[#242428] border-[#303034]'
      } ${className}`}
    >
      {/* Silhueta da orelha da pasta (Folder Tab) */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 380 230"
        fill="none"
        preserveAspectRatio="none"
      >
        <path
          d="M 0 30 C 0 14, 12 0, 28 0 L 130 0 C 148 0, 160 16, 180 16 L 352 16 C 368 16, 380 28, 380 44 L 380 208 C 380 220, 368 230, 352 230 L 28 230 C 12 230, 0 220, 0 208 Z"
          fill={isLight ? '#FFFFFF' : '#242428'}
          stroke={isLight ? '#D6DCE5' : '#303034'}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="relative z-10 w-full">
        {/* Placeholder horizontal para o nome do condomínio */}
        <div
          className={`h-5 w-44 rounded-lg mb-3 ${
            isLight ? 'bg-[#E1E4E8]' : 'bg-[#303036]'
          }`}
        />
        {/* Divisor abaixo do cabeçalho */}
        <div
          className={`border-b mb-3.5 ${
            isLight ? 'border-[#E1E4E8]' : 'border-[#303036]'
          }`}
        />

        {/* Corpo estrutural em 2 colunas: Progresso à esquerda, 7 etapas à direita */}
        <div className="grid grid-cols-12 gap-3 items-center">
          {/* Coluna Esquerda: Círculo de progresso vazio + contagem de etapas */}
          <div
            className={`col-span-5 flex flex-col items-center justify-center border-r pr-3 ${
              isLight ? 'border-[#E1E4E8]' : 'border-[#303036]'
            }`}
          >
            {/* Círculo com espessura de anel */}
            <div
              className={`w-20 h-20 rounded-full border-[6px] flex items-center justify-center my-1 ${
                isLight ? 'border-[#E1E4E8]' : 'border-[#303036]'
              }`}
            />
            {/* Placeholder para a contagem "0 de 7" */}
            <div
              className={`h-3 w-12 rounded-md mt-2 ${
                isLight ? 'bg-[#E1E4E8]' : 'bg-[#303036]'
              }`}
            />
          </div>

          {/* Coluna Direita: 7 linhas simulando as etapas documentais */}
          <div className="col-span-7 space-y-2 pl-2">
            {[72, 85, 60, 80, 65, 88, 70].map((widthPct, rIdx) => (
              <div key={rIdx} className="flex items-center gap-2">
                <div
                  className={`w-3.5 h-3.5 rounded-full shrink-0 ${
                    isLight ? 'bg-[#E1E4E8]' : 'bg-[#303036]'
                  }`}
                />
                <div
                  className={`h-2.5 rounded-md ${
                    isLight ? 'bg-[#E1E4E8]' : 'bg-[#303036]'
                  }`}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Grid de Skeletons para a aba Pastas (exibe 6 cards exatamente conforme a referência)
 */
export const SkeletonPastasGrid: React.FC<{ theme?: 'light' | 'dark' }> = ({ theme = 'dark' }) => (
  <div
    aria-busy="true"
    aria-label="Carregando pastas de condomínios..."
    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 animate-in fade-in duration-150"
  >
    {Array.from({ length: 6 }).map((_, idx) => (
      <SkeletonFolderCard key={`skeleton-folder-${idx}`} theme={theme} />
    ))}
  </div>
);

/**
 * SKELETON DE CARD DO PIPELINE COMERCIAL (CRM)
 */
export const SkeletonPipelineCard: React.FC<{ theme?: 'light' | 'dark' }> = ({
  theme: explicitTheme,
}) => {
  const { theme: contextTheme } = useTheme();
  const currentTheme = explicitTheme || contextTheme;
  const isLight = currentTheme === 'light';

  return (
    <div
      aria-hidden="true"
      className={`p-3.5 rounded-2xl border shadow-xs space-y-3 skeleton-shimmer select-none ${
        isLight ? 'bg-white border-[#D6DCE5]' : 'bg-[#242428] border-[#303034]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <Skeleton variant="rounded" width="55%" height={14} theme={currentTheme} />
        <Skeleton variant="pill" width={40} height={18} theme={currentTheme} />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton variant="text" width="40%" height={10} theme={currentTheme} />
        <Skeleton variant="text" width="30%" height={10} theme={currentTheme} />
      </div>
      <div className="pt-2 border-t border-slate-200/60 dark:border-[#303034] flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Skeleton variant="circular" width={22} height={22} theme={currentTheme} />
          <Skeleton variant="text" width={60} height={10} theme={currentTheme} />
        </div>
        <Skeleton variant="rounded" width={24} height={24} theme={currentTheme} />
      </div>
    </div>
  );
};

/**
 * SKELETON DE COLUNA DO PIPELINE COMERCIAL (CRM)
 */
export const SkeletonPipelineColumn: React.FC<{
  label?: string;
  theme?: 'light' | 'dark';
  cardCount?: number;
}> = ({ label, theme: explicitTheme, cardCount = 3 }) => {
  const { theme: contextTheme } = useTheme();
  const currentTheme = explicitTheme || contextTheme;
  const isLight = currentTheme === 'light';

  return (
    <div
      aria-busy="true"
      className={`w-72 sm:w-80 shrink-0 rounded-2xl p-3 flex flex-col gap-3 min-h-[500px] border ${
        isLight ? 'bg-[#F1F3F5] border-[#D6DCE5]' : 'bg-[#18181c] border-[#242428]'
      }`}
    >
      <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-[#242428] px-1">
        <div className="flex items-center gap-2">
          <Skeleton variant="circular" width={8} height={8} theme={currentTheme} />
          {label ? (
            <span className={`text-xs font-bold ${isLight ? 'text-[#111827]' : 'text-white'}`}>{label}</span>
          ) : (
            <Skeleton variant="text" width={80} height={14} theme={currentTheme} />
          )}
        </div>
        <Skeleton variant="pill" width={28} height={18} theme={currentTheme} />
      </div>

      <div className="flex-1 space-y-3">
        {Array.from({ length: cardCount }).map((_, idx) => (
          <SkeletonPipelineCard key={idx} theme={currentTheme} />
        ))}
      </div>
    </div>
  );
};

/**
 * SKELETON DE INTERAÇÃO / FOLLOW-UP (MODAL DE DETALHES DO CONDOMÍNIO)
 */
export const SkeletonTimelineItem: React.FC<{ theme?: 'light' | 'dark' }> = ({
  theme: explicitTheme,
}) => {
  const { theme: contextTheme } = useTheme();
  const currentTheme = explicitTheme || contextTheme;
  const isLight = currentTheme === 'light';

  return (
    <div
      aria-hidden="true"
      className={`w-full border rounded-2xl p-4 shadow-sm space-y-3 skeleton-shimmer select-none ${
        isLight ? 'bg-white border-[#D6DCE5]' : 'bg-[#242428] border-[#303034]'
      }`}
    >
      <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-[#303034]">
        <div className="flex items-center gap-2">
          <Skeleton variant="rounded" width={70} height={20} theme={currentTheme} />
          <Skeleton variant="text" width={90} height={12} theme={currentTheme} />
        </div>
        <Skeleton variant="text" width={40} height={12} theme={currentTheme} />
      </div>

      <div className="space-y-1.5 py-1">
        <Skeleton variant="text" width="95%" height={11} theme={currentTheme} />
        <Skeleton variant="text" width="80%" height={11} theme={currentTheme} />
        <Skeleton variant="text" width="60%" height={11} theme={currentTheme} />
      </div>

      <div className="pt-2 border-t border-slate-100 dark:border-[#303034] flex items-center justify-between">
        <Skeleton variant="text" width={120} height={10} theme={currentTheme} />
        <Skeleton variant="rounded" width={80} height={16} theme={currentTheme} />
      </div>
    </div>
  );
};

/**
 * SKELETON DE MODELO DE IA (CATÁLOGO DINÂMICO)
 */
export const SkeletonModelCard: React.FC<{ theme?: 'light' | 'dark' }> = ({
  theme = 'dark',
}) => {
  const isLight = theme === 'light';

  return (
    <div
      aria-hidden="true"
      className={`w-full p-4 rounded-2xl border flex items-center justify-between gap-4 skeleton-shimmer select-none ${
        isLight ? 'bg-white border-[#D6DCE5]' : 'bg-[#242428] border-[#303034]'
      }`}
    >
      <div className="flex items-center gap-3.5 flex-1 min-w-0">
        <div className={`w-11 h-11 rounded-2xl shrink-0 ${isLight ? 'bg-slate-100' : 'bg-[#18181c]'}`} />
        <div className="space-y-1.5 flex-1">
          <Skeleton variant="rounded" width="45%" height={14} theme={theme} />
          <Skeleton variant="text" width="80%" height={10} theme={theme} />
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Skeleton variant="rounded" width={75} height={28} theme={theme} />
        <Skeleton variant="circular" width={20} height={20} theme={theme} />
      </div>
    </div>
  );
};

/**
 * SKELETON DE ARQUIVO DO GOOGLE DRIVE
 */
export const SkeletonDriveFile: React.FC<{ theme?: 'light' | 'dark' }> = ({
  theme = 'dark',
}) => {
  const isLight = theme === 'light';

  return (
    <div
      aria-hidden="true"
      className={`p-3 rounded-xl border flex items-center justify-between gap-3 skeleton-shimmer select-none ${
        isLight ? 'bg-white border-[#D6DCE5]' : 'bg-[#242428] border-[#303034]'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Skeleton variant="rounded" width={32} height={32} theme={theme} />
        <div className="space-y-1 flex-1">
          <Skeleton variant="rounded" width="60%" height={12} theme={theme} />
          <Skeleton variant="text" width="30%" height={9} theme={theme} />
        </div>
      </div>
      <Skeleton variant="rounded" width={55} height={22} theme={theme} />
    </div>
  );
};

/**
 * SKELETON DE CARD DE FOLLOW-UP (ACOMPANHAMENTO COMERCIAL)
 */
export const SkeletonFollowUpCard: React.FC<{ theme?: 'light' | 'dark' }> = ({
  theme: explicitTheme,
}) => {
  const { theme: contextTheme } = useTheme();
  const currentTheme = explicitTheme || contextTheme;
  const isLight = currentTheme === 'light';

  return (
    <div
      aria-hidden="true"
      className={`rounded-[22px] p-4 flex flex-col justify-between border shadow-xs skeleton-shimmer select-none ${
        isLight ? 'bg-white border-[#D6DCE5]' : 'bg-[#242428] border-[#303034]'
      }`}
    >
      <div className="space-y-3">
        {/* Top: Condominium Name + Status Badge */}
        <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-100 dark:border-[#303034]">
          <div className="space-y-1.5 flex-1">
            <Skeleton variant="rounded" width="60%" height={15} theme={currentTheme} />
            <Skeleton variant="text" width="40%" height={10} theme={currentTheme} />
          </div>
          <Skeleton variant="rounded" width={56} height={22} theme={currentTheme} />
        </div>

        {/* Responsible & Scheduled Date/Time */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2">
            <Skeleton variant="circular" width={22} height={22} theme={currentTheme} />
            <Skeleton variant="text" width={80} height={11} theme={currentTheme} />
          </div>
          <Skeleton variant="rounded" width={75} height={18} theme={currentTheme} />
        </div>

        {/* Note preview lines */}
        <div className="space-y-1.5 py-1">
          <Skeleton variant="text" width="92%" height={10} theme={currentTheme} />
          <Skeleton variant="text" width="75%" height={10} theme={currentTheme} />
        </div>
      </div>

      {/* Footer Quick Action Buttons (WhatsApp, Email, Folder, View, Edit) */}
      <div className="pt-3 mt-3 border-t border-slate-100 dark:border-[#303034] flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Skeleton variant="circular" width={26} height={26} theme={currentTheme} />
          <Skeleton variant="circular" width={26} height={26} theme={currentTheme} />
          <Skeleton variant="circular" width={26} height={26} theme={currentTheme} />
        </div>
        <div className="flex items-center gap-1.5">
          <Skeleton variant="rounded" width={26} height={26} theme={currentTheme} />
          <Skeleton variant="rounded" width={26} height={26} theme={currentTheme} />
        </div>
      </div>
    </div>
  );
};

/**
 * Grid de Skeletons para Follow-ups
 */
export const SkeletonFollowUpGrid: React.FC<{ theme?: 'light' | 'dark' }> = ({ theme }) => (
  <div
    aria-busy="true"
    aria-label="Carregando follow-ups agendados..."
    className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 animate-in fade-in duration-150"
  >
    {Array.from({ length: 6 }).map((_, idx) => (
      <SkeletonFollowUpCard key={`skeleton-followup-${idx}`} theme={theme} />
    ))}
  </div>
);

export default Skeleton;

