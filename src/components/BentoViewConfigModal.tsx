import React, { useState, useRef, useEffect } from 'react';
import type { UserProfile } from '../App.tsx';
import { useTheme } from '../lib/themeContext.tsx';

// Pipeline View Configuration
export interface PipelineViewConfig {
  showCityAndType: boolean;
  showStage: boolean;
  showResponsible: boolean;
  showNextContact: boolean;
  showQuickActions?: boolean;
}

// Follow-ups View Configuration
import ProfileAvatar from './ProfileAvatar.tsx';

export interface FollowUpsViewConfig {
  showCityAndType: boolean;
  showStage: boolean;
  showTemperature: boolean;
  showFollowUpDate: boolean;
  showLatestNotes: boolean;
  showResponsible: boolean;
  showQuickAction: boolean;
}

export const DEFAULT_PIPELINE_VIEW_CONFIG: PipelineViewConfig = {
  showCityAndType: true,
  showStage: true,
  showResponsible: true,
  showNextContact: true,
  showQuickActions: true,
};

export const DEFAULT_FOLLOWUPS_VIEW_CONFIG: FollowUpsViewConfig = {
  showCityAndType: true,
  showStage: true,
  showTemperature: true,
  showFollowUpDate: true,
  showLatestNotes: true,
  showResponsible: true,
  showQuickAction: true,
};

interface BentoViewConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description: string;
  profiles: UserProfile[];
  selectedResponsible: string;
  onSelectResponsible: (responsibleId: string) => void;
  toggles: {
    key: string;
    label: string;
    description?: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
  }[];
  onResetDefaults: () => void;
}

export function BentoViewConfigModal({
  isOpen,
  onClose,
  title,
  description,
  profiles,
  selectedResponsible,
  onSelectResponsible,
  toggles,
  onResetDefaults,
}: BentoViewConfigModalProps) {
  const { theme, setTheme } = useTheme();
  const isLight = theme === 'light';
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event?.target as Node || e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      return () => document.removeEventListener('mousedown', handleOutsideClick);
    }
  }, [isDropdownOpen]);

  if (!isOpen) return null;

  // Selected persona label
  const activeProfile = profiles.find((p) => p.id === selectedResponsible);
  const selectedLabel = selectedResponsible === 'all' ? 'Todos' : (activeProfile?.full_name || 'Usuário');

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-xl rounded-3xl shadow-2xl overflow-visible my-auto flex flex-col border ${
          isLight ? 'bg-white border-slate-200' : 'bg-slate-900/95 border-slate-800'
        }`}
      >
        {/* Header - Conciso & Elegante */}
        <div className="px-6 pt-5 pb-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-600/15 text-indigo-500 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </div>
            <div>
              <h2 className={`text-sm font-semibold tracking-tight ${isLight ? 'text-slate-950' : 'text-white'}`}>{title}</h2>
              <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{description}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-colors cursor-pointer ${
              isLight ? 'text-slate-400 hover:text-slate-900 hover:bg-slate-100' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="px-6 py-3 space-y-5">
          {/* 0. Tema / Modo de Exibição */}
          <div>
            <span className={`text-[11px] font-semibold uppercase tracking-wider block mb-1.5 ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
              Tema / Modo da Página
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  theme === 'dark'
                    ? 'bg-indigo-600 text-white border-indigo-500 shadow-md'
                    : isLight
                    ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
                    : 'bg-slate-800/40 hover:bg-slate-800 border-slate-700/50 text-slate-300'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
                <span>Modo Escuro</span>
              </button>

              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  theme === 'light'
                    ? 'bg-indigo-600 text-white border-indigo-500 shadow-md'
                    : isLight
                    ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
                    : 'bg-slate-800/40 hover:bg-slate-800 border-slate-700/50 text-slate-300'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                <span>Modo Claro</span>
              </button>
            </div>
          </div>

          {/* 1. Filtro de Responsável */}
          <div>
            <span className={`text-[11px] font-semibold uppercase tracking-wider block mb-1.5 ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
              Filtrar por Responsável
            </span>

            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className={`w-full flex items-center justify-between px-3.5 py-2 rounded-xl text-xs transition-colors cursor-pointer border ${
                  isLight
                    ? 'bg-slate-50 hover:bg-slate-100 border-slate-300 text-slate-900 shadow-2xs'
                    : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700/50 text-white'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${
                    selectedResponsible === 'all'
                      ? 'bg-indigo-600/20 text-indigo-500'
                      : 'bg-indigo-600 text-white'
                  }`}>
                    {selectedResponsible === 'all' ? '●' : selectedLabel.charAt(0).toUpperCase()}
                  </span>
                  <span className="font-medium truncate">{selectedLabel}</span>
                </div>
                <svg
                  className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Lista Suspensa */}
              {isDropdownOpen && (
                <div className={`absolute left-0 right-0 top-full mt-1.5 rounded-xl shadow-2xl z-50 py-1 max-h-52 overflow-y-auto border ${
                  isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-slate-900 border-slate-800 text-slate-200'
                }`}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectResponsible('all');
                      setIsDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3.5 py-2 text-xs flex items-center justify-between transition-colors cursor-pointer ${
                      isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'
                    } ${
                      selectedResponsible === 'all'
                        ? 'text-indigo-600 font-semibold'
                        : isLight ? 'text-slate-800' : 'text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center ${
                        isLight ? 'bg-slate-100 text-indigo-600' : 'bg-slate-800 text-indigo-300'
                      }`}>
                        ●
                      </span>
                      <span>Todos</span>
                    </div>
                    {selectedResponsible === 'all' && (
                      <span className="text-indigo-600 text-xs font-bold">✓</span>
                    )}
                  </button>

                  {profiles.map((p) => {
                    const isSelected = selectedResponsible === p.id;
                    const initial = (p.full_name || 'U').charAt(0).toUpperCase();

                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          onSelectResponsible(p.id);
                          setIsDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3.5 py-2 text-xs flex items-center justify-between transition-colors cursor-pointer ${
                          isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'
                        } ${
                          isSelected
                            ? 'text-indigo-600 font-semibold'
                            : isLight ? 'text-slate-800' : 'text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <ProfileAvatar name={p.full_name || 'Usuário'} size="xs" />
                          <span className="truncate">{p.full_name || 'Usuário'}</span>
                        </div>
                        {isSelected && (
                          <span className="text-indigo-600 text-xs font-bold">✓</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 2. Visualização dos Cards */}
          <div>
            <span className={`text-[11px] font-semibold uppercase tracking-wider block mb-2 ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
              Campos dos Cards
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {toggles.map((item) => (
                <div
                  key={item.key}
                  onClick={() => item.onChange(!item.checked)}
                  className={`px-3.5 py-2.5 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-all select-none ${
                    isLight
                      ? 'bg-slate-50 hover:bg-slate-100 border-slate-200'
                      : 'bg-slate-800/40 hover:bg-slate-800/70 border-slate-800/50'
                  }`}
                >
                  <span className={`text-xs font-semibold leading-snug whitespace-nowrap ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
                    {item.label}
                  </span>

                  {/* Smooth iOS Switch */}
                  <div
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ease-in-out cursor-pointer ${
                      item.checked ? 'bg-indigo-600' : isLight ? 'bg-slate-300' : 'bg-slate-700/80'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out mt-0.5 ml-0.5 ${
                        item.checked ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={`px-6 py-4 flex items-center justify-between gap-3 border-t mt-1 ${
          isLight ? 'border-slate-200' : 'border-slate-800/40'
        }`}>
          <button
            type="button"
            onClick={onResetDefaults}
            className={`text-xs transition-colors cursor-pointer ${isLight ? 'text-slate-500 hover:text-slate-900' : 'text-slate-400 hover:text-white'}`}
          >
            Restaurar padrão
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-xs transition-colors cursor-pointer shadow-sm"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
}
