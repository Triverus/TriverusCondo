import React, { useState, useEffect, useRef } from 'react';
import { Skeleton } from './Skeleton';

export interface AgentAvatarProps {
  src?: string | null;
  pendingSrc?: string | null;
  isChanging?: boolean;
  alt?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'custom';
  className?: string;
  imgClassName?: string;
  fallbackText?: string;
  theme?: 'light' | 'dark';
  onError?: () => void;
  onLoaded?: (loadedSrc: string) => void;
}

const sizeClasses = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-xs',
  lg: 'w-12 h-12 text-sm',
  xl: 'w-16 h-16 text-base',
  '2xl': 'w-24 h-24 text-xl',
  custom: '',
};

/**
 * Componente oficial de Avatar com Skeleton Loading, Preloading e Transição Suave.
 * Respeita integralmente os requisitos:
 * 1. Detecta imediatamente a operação de troca.
 * 2. Exibe Skeleton circular com efeito Shimmer contínuo na área do avatar.
 * 3. Mantém dimensões exatas do avatar existente sem layout shifts.
 * 4. Preserva a imagem anterior discretamente ao fundo (opacidade reduzida).
 * 5. Substitui suavemente pelo novo avatar ao concluir carregamento.
 * 6. Em caso de erro, restaura o avatar anterior sem exibir ícone quebrado.
 * 7. Evita condições de corrida em trocas rápidas via token de requisição incremental.
 */
export const AgentAvatar: React.FC<AgentAvatarProps> = ({
  src,
  pendingSrc,
  isChanging = false,
  alt = 'Avatar do Agente',
  size = 'md',
  className = '',
  imgClassName = '',
  fallbackText = '?',
  theme = 'dark',
  onError,
  onLoaded,
}) => {
  const [displayedSrc, setDisplayedSrc] = useState<string | null>(src || null);
  const [isLoading, setIsLoading] = useState<boolean>(!src ? false : true);
  const [isSwitching, setIsSwitching] = useState<boolean>(isChanging);
  const [hasError, setHasError] = useState<boolean>(false);
  const requestTokenRef = useRef<number>(0);
  const activeImageRef = useRef<HTMLImageElement | null>(null);

  // Determina o destino efetivo (pendingSrc tem prioridade durante salvamentos)
  const effectiveTarget = pendingSrc !== undefined && pendingSrc !== null ? pendingSrc : src;

  // Sincroniza estado de troca externa explícita
  useEffect(() => {
    if (isChanging) {
      setIsSwitching(true);
    }
  }, [isChanging]);

  // Monitora alterações na URL de destino para preloading assíncrono e transição
  useEffect(() => {
    if (!effectiveTarget) {
      setDisplayedSrc(null);
      setIsLoading(false);
      setIsSwitching(false);
      setHasError(false);
      return;
    }

    // Se a imagem de destino já é a que está atualmente exibida
    if (effectiveTarget === displayedSrc && !hasError) {
      if (!isChanging) {
        setIsLoading(false);
        setIsSwitching(false);
      }
      return;
    }

    // Há uma troca real em andamento
    const token = ++requestTokenRef.current;
    if (displayedSrc) {
      setIsSwitching(true);
    } else {
      setIsLoading(true);
    }
    setHasError(false);

    const img = new Image();
    activeImageRef.current = img;

    const handleSuccess = () => {
      if (token !== requestTokenRef.current) return;
      setDisplayedSrc(effectiveTarget);
      setIsLoading(false);
      setIsSwitching(false);
      setHasError(false);
      if (onLoaded) onLoaded(effectiveTarget);
    };

    const handleFailure = () => {
      if (token !== requestTokenRef.current) return;
      setIsLoading(false);
      setIsSwitching(false);
      // Se já tínhamos uma imagem anterior válida, mantemos ela intacta
      if (!displayedSrc) {
        setHasError(true);
      }
      if (onError) onError();
    };

    img.onload = () => {
      // Se suportar decode(), aguarda decodificação para transição 100% livre de flicker
      if ('decode' in img && typeof img.decode === 'function') {
        img.decode().then(handleSuccess).catch(handleSuccess);
      } else {
        handleSuccess();
      }
    };

    img.onerror = handleFailure;
    img.src = effectiveTarget;

    return () => {
      if (activeImageRef.current) {
        activeImageRef.current.onload = null;
        activeImageRef.current.onerror = null;
      }
    };
  }, [effectiveTarget, displayedSrc, isChanging, hasError, onLoaded, onError]);

  const dimension = sizeClasses[size] || sizeClasses.md;
  const isCurrentlySwitching = isSwitching || isChanging;

  return (
    <div
      className={`relative rounded-full overflow-hidden shrink-0 select-none ${dimension} ${className}`}
    >
      {/* 1. Estado de Skeleton Inicial (quando ainda não há nenhuma imagem exibida) */}
      {isLoading && !displayedSrc && (
        <Skeleton
          variant="circular"
          className="w-full h-full absolute inset-0"
          theme={theme}
        />
      )}

      {/* 2. Imagem Atual (esmaecida suavemente ao fundo enquanto a nova carrega) */}
      {displayedSrc && !hasError && (
        <img
          src={displayedSrc}
          alt={alt}
          className={`w-full h-full object-cover transition-all duration-300 ${
            isCurrentlySwitching ? 'opacity-30 scale-[0.98]' : 'opacity-100 scale-100'
          } ${imgClassName}`}
        />
      )}

      {/* 3. Skeleton Circular com Shimmer Sweep por cima durante a troca */}
      {isCurrentlySwitching && (
        <div
          aria-busy="true"
          aria-label="Carregando avatar..."
          className="avatar-shimmer-overlay flex items-center justify-center animate-in fade-in duration-150"
        >
          {/* Indicador de progresso central sutil */}
          <div className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
        </div>
      )}

      {/* 4. Estado de Fallback (sem src ou em caso de erro sem imagem anterior) */}
      {(!effectiveTarget || (hasError && !displayedSrc)) && !isLoading && (
        <div
          className={`w-full h-full flex items-center justify-center font-bold uppercase transition-colors ${
            theme === 'light'
              ? 'bg-[#E1E4E8] text-[#667085]'
              : 'bg-[#242428] text-slate-400'
          }`}
        >
          {fallbackText}
        </div>
      )}
    </div>
  );
};

export default AgentAvatar;
