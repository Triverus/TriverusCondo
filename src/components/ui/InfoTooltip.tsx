import React, { useState, useRef, useEffect, useId } from 'react';
import { HelpCircle, Info, Sparkles } from 'lucide-react';
import { useTheme } from '../../lib/themeContext.tsx';

export interface InfoTooltipProps {
  title?: string;
  content: string;
  secondaryText?: string;
  side?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
  iconType?: 'help' | 'info' | 'sparkles';
  className?: string;
  triggerClassName?: string;
  badgeText?: string;
  theme?: 'light' | 'dark';
  as?: 'button' | 'span';
}

export function InfoTooltip({
  title,
  content,
  secondaryText,
  side = 'auto',
  iconType = 'help',
  className = '',
  triggerClassName = '',
  badgeText,
  theme: explicitTheme,
  as = 'button',
}: InfoTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; position: 'top' | 'bottom' }>({
    top: 0,
    left: 0,
    position: 'top',
  });

  const triggerRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const { theme: contextTheme } = useTheme();
  const currentTheme = explicitTheme || contextTheme;
  const isLight = currentTheme === 'light';

  // Reposition floating card dynamically to stay strictly inside viewport boundaries
  const updatePosition = () => {
    if (!triggerRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const cardWidth = 280; // Standard width
    const cardHeight = 120; // Estimated height

    let position: 'top' | 'bottom' = 'top';
    let top = triggerRect.top - cardHeight - 10;

    if (top < 12 || side === 'bottom') {
      top = triggerRect.bottom + 10;
      position = 'bottom';
    }

    let left = triggerRect.left + triggerRect.width / 2 - cardWidth / 2;

    // Prevent overflowing right boundary
    if (left + cardWidth > viewportWidth - 16) {
      left = viewportWidth - cardWidth - 16;
    }
    // Prevent overflowing left boundary
    if (left < 16) {
      left = 16;
    }

    setCoords({ top, left, position });
  };

  const handleOpen = () => {
    updatePosition();
    setIsOpen(true);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  const toggleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOpen) {
      handleClose();
    } else {
      handleOpen();
    }
  };

  // Close on outside click or scroll or Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        handleClose();
      }
    };

    const handleScroll = () => {
      updatePosition();
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen]);

  const renderIcon = () => {
    if (iconType === 'info') return <Info className="w-3.5 h-3.5" />;
    if (iconType === 'sparkles') return <Sparkles className="w-3.5 h-3.5 text-[#FF6A00]" />;
    return <HelpCircle className="w-3.5 h-3.5" />;
  };

  return (
    <span className={`inline-flex items-center align-middle ${className}`}>
      {as === 'span' ? (
        <span
          ref={triggerRef}
          role="button"
          tabIndex={0}
          onClick={toggleOpen}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              if (isOpen) handleClose();
              else handleOpen();
            }
          }}
          onMouseEnter={handleOpen}
          onMouseLeave={handleClose}
          onFocus={handleOpen}
          onBlur={handleClose}
          aria-describedby={isOpen ? tooltipId : undefined}
          aria-label={title || content}
          className={`p-0.5 rounded-full transition-all duration-150 cursor-pointer inline-flex items-center justify-center focus-visible:outline-2 focus-visible:outline-[#FF6A00] select-none ${
            isLight
              ? 'text-slate-400 hover:text-[#111827] focus:text-[#111827] hover:bg-slate-200/60'
              : 'text-slate-400 hover:text-white focus:text-white hover:bg-white/10'
          } ${triggerClassName}`}
        >
          {renderIcon()}
        </span>
      ) : (
        <button
          ref={triggerRef as React.RefObject<HTMLButtonElement>}
          type="button"
          onClick={toggleOpen}
          onMouseEnter={handleOpen}
          onMouseLeave={handleClose}
          onFocus={handleOpen}
          onBlur={handleClose}
          aria-describedby={isOpen ? tooltipId : undefined}
          aria-label={title || content}
          className={`p-0.5 rounded-full transition-all duration-150 cursor-pointer inline-flex items-center justify-center focus-visible:outline-2 focus-visible:outline-[#FF6A00] ${
            isLight
              ? 'text-slate-400 hover:text-[#111827] focus:text-[#111827] hover:bg-slate-200/60'
              : 'text-slate-400 hover:text-white focus:text-white hover:bg-white/10'
          } ${triggerClassName}`}
        >
          {renderIcon()}
        </button>
      )}

      {isOpen && (
        <div
          ref={popoverRef}
          id={tooltipId}
          role="tooltip"
          style={{
            position: 'fixed',
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            width: '280px',
            zIndex: 9999,
          }}
          className={`p-3.5 rounded-2xl border shadow-2xl transition-all duration-150 animate-in fade-in zoom-in-95 pointer-events-auto select-none ${
            isLight
              ? 'bg-white border-[#D6DCE5] text-[#111827] shadow-slate-300/50'
              : 'bg-[#242428] border-[#3f3f46] text-white shadow-black/60'
          }`}
        >
          {/* Header Row */}
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`p-1 rounded-lg ${isLight ? 'bg-orange-50 text-[#FF6A00]' : 'bg-orange-500/15 text-[#FF6A00]'}`}>
                {renderIcon()}
              </span>
              {title && (
                <h4 className={`text-xs font-bold truncate ${isLight ? 'text-[#111827]' : 'text-white'}`}>
                  {title}
                </h4>
              )}
            </div>
            {badgeText && (
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                isLight ? 'bg-slate-100 text-[#667085]' : 'bg-[#303034] text-slate-300'
              }`}>
                {badgeText}
              </span>
            )}
          </div>

          {/* Primary Prose */}
          <p className={`text-[11px] leading-relaxed font-normal ${isLight ? 'text-[#667085]' : 'text-slate-300'}`}>
            {content}
          </p>

          {/* Secondary Prose / Note */}
          {secondaryText && (
            <p className={`mt-2 pt-1.5 border-t text-[10px] leading-tight font-medium ${
              isLight ? 'border-slate-100 text-[#94A3B8]' : 'border-[#303034] text-slate-400'
            }`}>
              💡 {secondaryText}
            </p>
          )}

          {/* Pointer Arrow */}
          <div
            className={`absolute w-2.5 h-2.5 rotate-45 border ${
              coords.position === 'top' ? 'bottom-[-6px] border-b border-r' : 'top-[-6px] border-t border-l'
            } ${
              isLight ? 'bg-white border-[#D6DCE5]' : 'bg-[#242428] border-[#3f3f46]'
            }`}
            style={{
              left: 'calc(50% - 5px)',
            }}
          />
        </div>
      )}
    </span>
  );
}

export default InfoTooltip;
