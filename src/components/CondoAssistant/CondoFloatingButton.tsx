import React from 'react';
import { Sparkles, X } from 'lucide-react';
import { useTheme } from '../../lib/themeContext.tsx';

interface CondoFloatingButtonProps {
  isOpen: boolean;
  onClick: () => void;
  unreadCount?: number;
}

export function CondoFloatingButton({ isOpen, onClick, unreadCount = 0 }: CondoFloatingButtonProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  return (
    <div className="fixed bottom-5 right-5 z-40 select-none group">
      {/* Tooltip on hover (when drawer is closed) */}
      {!isOpen && (
        <div
          className={`absolute right-full mr-3 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap pointer-events-none transition-all duration-200 opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 shadow-lg ${
            isLight
              ? 'bg-slate-900 text-white border border-slate-700'
              : 'bg-slate-800 text-slate-100 border border-slate-700'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#FF6600]" />
            <span>Assistente IA • Triverus</span>
          </div>
        </div>
      )}

      {/* Main Floating Bubble Button */}
      <button
        type="button"
        onClick={onClick}
        aria-label={isOpen ? 'Fechar Assistente IA' : 'Abrir assistente de IA'}
        className={`relative flex items-center justify-center w-14 h-14 rounded-full transition-all duration-300 transform active:scale-95 cursor-pointer shadow-xl hover:shadow-2xl ${
          isOpen
            ? 'bg-slate-900 text-white border border-slate-700 ring-2 ring-slate-700'
            : 'bg-gradient-to-tr from-[#FF6600] to-orange-500 text-white shadow-orange-500/30 hover:scale-105 ring-2 ring-orange-400/40'
        }`}
      >
        {isOpen ? (
          <X className="w-6 h-6 text-slate-200 transition-transform duration-200" />
        ) : (
          <div className="relative flex items-center justify-center">
            <Sparkles className="w-6 h-6 stroke-[2.2] animate-pulse" />
            {/* Online pulsing green indicator */}
            <span className="absolute -bottom-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border-2 border-slate-900" />
            </span>
          </div>
        )}

        {/* Unread message badge */}
        {!isOpen && unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[20px] h-5 px-1 bg-rose-500 text-white text-[11px] font-bold rounded-full border-2 border-slate-900 shadow-md animate-bounce">
            {unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}
