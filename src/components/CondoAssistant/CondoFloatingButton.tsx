import React from 'react';
import { useTheme } from '../../lib/themeContext.tsx';

interface CondoFloatingButtonProps {
  isOpen: boolean;
  onClick: () => void;
  unreadCount?: number;
}

const CONDO_AVATAR_URL = 'http://adm.triveruscondo.com/wp-content/uploads/2026/10/Avatar-condo-webp.webp';

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
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Condo • Assistente IA</span>
          </div>
        </div>
      )}

      {/* Main Floating Bubble Button */}
      <button
        type="button"
        onClick={onClick}
        aria-label={isOpen ? 'Fechar Condo IA' : 'Abrir assistente Condo'}
        className={`relative flex items-center justify-center w-14 h-14 rounded-full transition-all duration-300 transform active:scale-95 cursor-pointer shadow-xl hover:shadow-2xl ${
          isOpen
            ? isLight
              ? 'bg-indigo-600 text-white ring-4 ring-indigo-300 shadow-indigo-500/30'
              : 'bg-indigo-600 text-white ring-4 ring-indigo-500/40 shadow-indigo-600/40'
            : isLight
            ? 'bg-white hover:bg-slate-50 ring-2 ring-indigo-500/30 hover:ring-indigo-500 shadow-indigo-600/20 hover:scale-105'
            : 'bg-slate-900 hover:bg-slate-800 ring-2 ring-indigo-500/50 hover:ring-indigo-400 shadow-black/60 hover:scale-105'
        }`}
      >
        {isOpen ? (
          // Close icon when open
          <svg className="w-6 h-6 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          // Avatar when closed
          <div className="relative w-full h-full p-1 flex items-center justify-center">
            <img
              src={CONDO_AVATAR_URL}
              alt="Condo"
              className="w-12 h-12 rounded-full object-cover shadow-xs border border-indigo-500/30"
              onError={(e) => {
                // Fallback robot / sparkles icon if image load fails
                const target = e.currentTarget;
                target.style.display = 'none';
                if (target.nextElementSibling) {
                  (target.nextElementSibling as HTMLElement).style.display = 'flex';
                }
              }}
            />
            {/* Fallback avatar icon */}
            <div className="hidden w-12 h-12 rounded-full bg-gradient-to-tr from-indigo-600 to-sky-400 text-white items-center justify-center font-bold text-sm shadow-inner">
              🤖
            </div>

            {/* Online pulsing green indicator */}
            <span className="absolute bottom-1 right-1 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-slate-900" />
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
