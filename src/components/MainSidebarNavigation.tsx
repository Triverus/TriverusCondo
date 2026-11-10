import React from 'react';
import { Folder, Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';

export type MainSection = 'clientes' | 'agentes';

interface MainSidebarNavigationProps {
  currentSection: MainSection;
  onSelectSection: (section: MainSection) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const MainSidebarNavigation: React.FC<MainSidebarNavigationProps> = ({
  currentSection,
  onSelectSection,
  isCollapsed,
  onToggleCollapse,
}) => {
  return (
    <aside
      className={`relative shrink-0 bg-[#242428] border-r border-[#303034] flex flex-col transition-all duration-200 z-30 select-none font-['Roboto',sans-serif] ${
        isCollapsed ? 'w-16' : 'w-52 sm:w-56'
      }`}
    >
      {/* Top Toggle Button Area */}
      <div className={`p-3.5 flex items-center ${isCollapsed ? 'justify-center' : 'justify-end'}`}>
        <button
          type="button"
          onClick={onToggleCollapse}
          title={isCollapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
          aria-label={isCollapsed ? 'Expandir menu' : 'Recolher menu'}
          className="w-8 h-8 rounded-full bg-[#303034] border border-[#3f3f46] hover:border-slate-500 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer shadow-xs hover:bg-[#38383e]"
        >
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Exactly Two Menu Options: 1. Pastas (antiga Clientes), 2. Agentes */}
      <nav className="flex-1 px-3 py-2 space-y-2">
        {/* Item 1: Pastas */}
        <button
          type="button"
          onClick={() => onSelectSection('clientes')}
          title={isCollapsed ? 'Pastas' : undefined}
          className={`w-full flex items-center rounded-2xl font-medium text-sm transition-all cursor-pointer ${
            isCollapsed ? 'justify-center py-3.5 px-0' : 'gap-3 px-4 py-3'
          } ${
            currentSection === 'clientes'
              ? 'bg-[#FF6600] text-white shadow-lg shadow-orange-500/25'
              : 'text-slate-400 hover:text-white hover:bg-[#303034]'
          }`}
        >
          <Folder className={`shrink-0 ${isCollapsed ? 'w-5 h-5' : 'w-4 h-4'}`} />
          {!isCollapsed && (
            <span className="truncate tracking-wide">Pastas</span>
          )}
        </button>

        {/* Item 2: Agentes */}
        <button
          type="button"
          onClick={() => onSelectSection('agentes')}
          title={isCollapsed ? 'Agentes' : undefined}
          className={`w-full flex items-center rounded-2xl font-medium text-sm transition-all cursor-pointer ${
            isCollapsed ? 'justify-center py-3.5 px-0' : 'gap-3 px-4 py-3'
          } ${
            currentSection === 'agentes'
              ? 'bg-[#FF6600] text-white shadow-lg shadow-orange-500/25'
              : 'text-slate-400 hover:text-white hover:bg-[#303034]'
          }`}
        >
          <Sparkles className={`shrink-0 ${isCollapsed ? 'w-5 h-5' : 'w-4 h-4'}`} />
          {!isCollapsed && (
            <span className="truncate tracking-wide">Agentes</span>
          )}
        </button>
      </nav>
    </aside>
  );
};
