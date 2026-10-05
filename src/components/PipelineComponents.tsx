import React from 'react';
import type { Lead, PipelineStage } from '../lib/crmStore.tsx';
import type { UserProfile } from '../App.tsx';
import { useTheme } from '../lib/themeContext.tsx';
import {
  toDateInputValue,
  formatDateBR,
  getFollowUpTime,
} from '../lib/dateUtils.ts';

// Recognizeable SVG Icons
export function WhatsAppIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.456 5.711 1.457h.004c6.555 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.411z"/>
    </svg>
  );
}

export function EmailIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

export function NotesIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

export function FolderIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

export function EditIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
  );
}

export function TrashIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

export function EyeIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

export function PinIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v2a2 2 0 01-.586 1.414L16 11v5l2 2v1H6v-1l2-2v-5l-2.414-2.586A2 2 0 015 7V5z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 19v4" />
    </svg>
  );
}

export const PRESET_ROLES = [
  'Síndico',
  'Subsíndico',
  'Conselheiro',
  'Representante da administradora',
  'Gerente Predial',
  'Outro',
] as const;

// Pipeline visual configuration schema
export interface PipelineViewConfig {
  showCityAndType: boolean;
  showStage: boolean;
  showResponsible: boolean;
  showNextContact: boolean;
  showQuickActions?: boolean;
}

// ==========================================
// 1. PipelineToolbar (Header da Página)
// ==========================================
export interface PipelineToolbarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  stageFilter: string;
  onStageFilterChange: (value: string) => void;
  responsibleFilter: string;
  onResponsibleFilterChange: (value: string) => void;
  stages: PipelineStage[];
  profiles: UserProfile[];
  onOpenCreate: () => void;
  onOpenViewConfig?: () => void;
  isRefreshing?: boolean;
}

export function PipelineToolbar({
  searchTerm,
  onSearchChange,
  stageFilter,
  onStageFilterChange,
  responsibleFilter,
  stages,
  onOpenCreate,
  onOpenViewConfig,
  isRefreshing,
}: PipelineToolbarProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const isPersonaFiltered = responsibleFilter !== 'all';

  return (
    <div className={`mb-6 flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b ${isLight ? 'border-slate-200' : 'border-slate-900/60'}`}>
      {/* Controls Bar: Search + Stage Filter + Eye Customizer */}
      <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-0">
        {/* Search */}
        <div className="relative min-w-[200px] flex-1 sm:flex-initial">
          <input
            type="text"
            data-help-id="pipeline-search"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar..."
            className={`w-full pl-8 pr-7 py-2 rounded-xl text-xs focus:outline-none transition-colors ${
              isLight
                ? 'bg-white border border-slate-300 text-slate-900 placeholder-slate-400 focus:border-[#FF6600] focus:ring-1 focus:ring-[#FF6600] shadow-2xs'
                : 'bg-slate-900 border border-slate-800 focus:border-slate-700 text-white placeholder-slate-500'
            }`}
          />
          <svg
            className={`w-3.5 h-3.5 absolute left-2.5 top-2.5 ${isLight ? 'text-slate-400' : 'text-slate-500'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchTerm && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className={`absolute right-2.5 top-2 text-xs cursor-pointer ${isLight ? 'text-slate-400 hover:text-slate-700' : 'text-slate-500 hover:text-white'}`}
            >
              ×
            </button>
          )}
        </div>

        {/* Estágio Filter */}
        <select
          value={stageFilter}
          onChange={(e) => onStageFilterChange(e.target.value)}
          className={`px-3 py-2 rounded-xl text-xs focus:outline-none cursor-pointer transition-colors ${
            isLight
              ? 'bg-white border border-slate-300 text-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-2xs'
              : 'bg-slate-900 border border-slate-800 text-slate-300 focus:border-slate-700'
          }`}
        >
          <option value="all">Estágio: Todos</option>
          {stages.map((stg) => (
            <option key={stg.id} value={stg.id}>
              {stg.name}
            </option>
          ))}
        </select>

        {/* Eye icon - Bento Grid Customization & Persona Filter Modal */}
        {onOpenViewConfig && (
          <button
            type="button"
            onClick={onOpenViewConfig}
            title="Personalizar visualização (Modo Claro/Escuro, Campos dos Cards e Filtro)"
            className={`p-2 rounded-xl transition-all cursor-pointer flex items-center justify-center relative ${
              isPersonaFiltered
                ? 'bg-indigo-600/20 text-indigo-500 border border-indigo-500/50 shadow-2xs'
                : isLight
                ? 'bg-white hover:bg-slate-100 text-slate-700 hover:text-slate-950 border border-slate-300 shadow-2xs'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <EyeIcon className="w-4 h-4" />
            {isPersonaFiltered && (
              <span className={`w-1.5 h-1.5 rounded-full bg-indigo-500 absolute top-1.5 right-1.5 ring-2 ${isLight ? 'ring-white' : 'ring-slate-900'}`} />
            )}
          </button>
        )}

        {isRefreshing && (
          <span className="inline-flex items-center gap-1 text-[11px] text-indigo-500 font-medium ml-1">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
            sincronizando...
          </span>
        )}
      </div>

      {/* Right Action Button */}
      <div className="shrink-0 flex items-center justify-end">
        <button
          type="button"
          data-help-id="new-condominium"
          onClick={onOpenCreate}
          className="w-full sm:w-auto px-4 py-2 bg-[#FF6600] hover:bg-[#e65c00] text-white font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
        >
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className="text-white">Novo Condomínio</span>
        </button>
      </div>
    </div>
  );
}

// ==========================================
// 2. CardQuickActions (Rodapé do Card: Ícones à esquerda + Círculo "+" destacado à direita)
// ==========================================
export interface CardQuickActionsProps {
  lead: Lead;
  notesCount?: number;
  waCount: number;
  emCount: number;
  hasFolderLink?: boolean;
  onOpenTimeline?: () => void;
  onOpenWhatsApp: () => void;
  onOpenEmail: () => void;
  onOpenFolder: () => void;
  onOpenNotes: () => void;
}

export function CardQuickActions({
  notesCount = 0,
  waCount,
  emCount,
  hasFolderLink,
  onOpenTimeline,
  onOpenWhatsApp,
  onOpenEmail,
  onOpenFolder,
  onOpenNotes,
}: CardQuickActionsProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  return (
    <div className={`mt-2.5 pt-2 border-t flex items-center justify-between gap-1.5 ${isLight ? 'border-black/10' : 'border-white/15'}`}>
      {/* Ícones de ação alinhados à esquerda com destaque quando possuem dados */}
      <div className="flex items-center gap-1.5">
        {/* 1. Notas / Histórico de Interações (Primeiro ícone antes do WhatsApp) */}
        <button
          type="button"
          onClick={onOpenTimeline || onOpenNotes}
          title={notesCount > 0 ? `Linha do tempo (${notesCount} nota${notesCount === 1 ? '' : 's'})` : 'Linha do tempo (sem notas)'}
          aria-label="Linha do tempo e notas"
          className={`p-1.5 rounded-lg border transition-all cursor-pointer flex items-center gap-1 ${
            notesCount > 0
              ? isLight
                ? 'text-indigo-800 bg-white/95 border-2 border-indigo-600 shadow-xs ring-1 ring-indigo-300 font-bold'
                : 'text-indigo-300 bg-indigo-950/80 border border-indigo-500/70 hover:bg-indigo-900/80 shadow-xs'
              : isLight
              ? 'text-slate-700/60 hover:text-slate-950 bg-white/40 hover:bg-white/90 border border-black/10'
              : 'text-slate-400/60 hover:text-white bg-transparent border-transparent hover:bg-black/30'
          }`}
        >
          <NotesIcon className="w-3.5 h-3.5" />
          {notesCount > 0 && (
            <span className={`text-[10px] font-bold leading-none ${isLight ? 'text-indigo-900' : 'text-indigo-200'}`}>
              {notesCount}
            </span>
          )}
        </button>

        {/* 2. WhatsApp */}
        <button
          type="button"
          data-help-id="lead-card-whatsapp"
          onClick={onOpenWhatsApp}
          title={waCount > 0 ? `WhatsApp (${waCount} contato${waCount === 1 ? '' : 's'})` : 'WhatsApp (sem contato)'}
          aria-label="WhatsApp"
          className={`p-1.5 rounded-lg border transition-all cursor-pointer flex items-center gap-1 ${
            waCount > 0
              ? isLight
                ? 'text-emerald-800 bg-white/95 border-2 border-emerald-600 shadow-xs ring-1 ring-emerald-300 font-bold'
                : 'text-emerald-300 bg-emerald-950/80 border border-emerald-500/70 hover:bg-emerald-900/80 shadow-xs'
              : isLight
              ? 'text-slate-700/60 hover:text-slate-950 bg-white/40 hover:bg-white/90 border border-black/10'
              : 'text-slate-400/60 hover:text-white bg-transparent border-transparent hover:bg-black/30'
          }`}
        >
          <WhatsAppIcon className="w-3.5 h-3.5" />
          {waCount > 0 && (
            <span className={`text-[10px] font-bold leading-none ${isLight ? 'text-emerald-900' : 'text-emerald-200'}`}>
              {waCount}
            </span>
          )}
        </button>

        {/* 3. E-mail */}
        <button
          type="button"
          data-help-id="lead-card-email"
          onClick={onOpenEmail}
          title={emCount > 0 ? `E-mail (${emCount} contato${emCount === 1 ? '' : 's'})` : 'E-mail (sem e-mail)'}
          aria-label="E-mail"
          className={`p-1.5 rounded-lg border transition-all cursor-pointer flex items-center gap-1 ${
            emCount > 0
              ? isLight
                ? 'text-sky-800 bg-white/95 border-2 border-sky-600 shadow-xs ring-1 ring-sky-300 font-bold'
                : 'text-sky-300 bg-sky-950/80 border border-sky-500/70 hover:bg-sky-900/80 shadow-xs'
              : isLight
              ? 'text-slate-700/60 hover:text-slate-950 bg-white/40 hover:bg-white/90 border border-black/10'
              : 'text-slate-400/60 hover:text-white bg-transparent border-transparent hover:bg-black/30'
          }`}
        >
          <EmailIcon className="w-3.5 h-3.5" />
          {emCount > 0 && (
            <span className={`text-[10px] font-bold leading-none ${isLight ? 'text-sky-900' : 'text-sky-200'}`}>
              {emCount}
            </span>
          )}
        </button>

        {/* 4. Pasta / Google Drive */}
        <button
          type="button"
          data-help-id="lead-card-folder"
          onClick={onOpenFolder}
          title={hasFolderLink ? 'Pasta de Documentos vinculada' : 'Vincular pasta do Google Drive'}
          aria-label="Pasta de Documentos"
          className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
            hasFolderLink
              ? isLight
                ? 'text-amber-800 bg-white/95 border-2 border-amber-500 shadow-xs ring-1 ring-amber-300 font-bold'
                : 'text-amber-300 bg-amber-950/80 border border-amber-500/70 hover:bg-amber-900/80 shadow-xs'
              : isLight
              ? 'text-slate-700/60 hover:text-slate-950 bg-white/40 hover:bg-white/90 border border-black/10'
              : 'text-slate-400/60 hover:text-white bg-transparent border-transparent hover:bg-black/30'
          }`}
        >
          <FolderIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Círculo com "+" padronizado para registrar nova nota */}
      <button
        type="button"
        data-help-id="lead-card-notes"
        onClick={(e) => {
          e.stopPropagation();
          onOpenNotes();
        }}
        title="Adicionar nota ou registrar follow-up"
        aria-label="Adicionar nota / follow-up"
        className="w-7 h-7 rounded-full bg-[#FF6600] hover:bg-[#e65c00] active:scale-90 text-white flex items-center justify-center shadow-md ring-2 ring-[#FF6600]/25 transition-all cursor-pointer shrink-0 ml-auto"
      >
        <svg className="w-3.5 h-3.5 shrink-0 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}

export function getTemperatureCardClasses(temp?: string | null) {
  const norm = temp ? temp.trim().toLowerCase() : 'morno';
  if (norm === 'frio' || norm === 'cold') {
    return 'card-temp-frio';
  }
  if (norm === 'quente' || norm === 'hot') {
    return 'card-temp-quente';
  }
  if (norm === 'cliente' || norm === 'client' || norm === 'won') {
    return 'card-temp-cliente';
  }
  // Morno (default - Mais Amarelo)
  return 'card-temp-morno';
}

// ==========================================
// 3. LeadCard (Card do Condomínio Reconstruído)
// ==========================================
export interface LeadCardProps {
  lead: Lead;
  stageName: string;
  responsibleName: string;
  followUpInfo: {
    label: string;
    type: 'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'none';
    badgeClass: string;
    rawDate?: string | null;
    time?: string | null;
    displayFull?: string;
  };
  waCount: number;
  emCount: number;
  notesCount?: number;
  hasFolderLink?: boolean;
  isMenuOpen: boolean;
  isDragging?: boolean;
  viewConfig?: PipelineViewConfig;
  stages?: PipelineStage[];
  profiles?: UserProfile[];
  onQuickUpdate?: (
    leadId: string,
    field: 'stage' | 'responsible' | 'temperature' | 'follow_up_date',
    value: string
  ) => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDropOnCard: (e: React.DragEvent) => void;
  onDragOverCard?: (e: React.DragEvent) => void;
  onOpenView: () => void;
  onOpenEdit: () => void;
  onOpenTimeline?: () => void;
  onOpenNotes: () => void;
  onOpenFolder: () => void;
  onOpenWhatsApp: () => void;
  onOpenEmail: () => void;
  onRequestDelete: () => void;
}

export function LeadCard({
  lead,
  stageName,
  responsibleName,
  followUpInfo,
  waCount,
  emCount,
  notesCount = 0,
  hasFolderLink,
  isMenuOpen,
  isDragging = false,
  viewConfig,
  stages = [],
  profiles = [],
  onQuickUpdate,
  onToggleMenu,
  onCloseMenu,
  onDragStart,
  onDragEnd,
  onDropOnCard,
  onDragOverCard,
  onOpenView,
  onOpenEdit,
  onOpenTimeline,
  onOpenNotes,
  onOpenFolder,
  onOpenWhatsApp,
  onOpenEmail,
  onRequestDelete,
}: LeadCardProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [inlineEditing, setInlineEditing] = React.useState<'stage' | 'responsible' | 'temperature' | 'followup_date' | null>(null);
  const [quickDate, setQuickDate] = React.useState('');
  const [quickTime, setQuickTime] = React.useState('09:00');

  const showCityAndType = viewConfig?.showCityAndType ?? true;
  const showStage = viewConfig?.showStage ?? true;
  const showResponsible = viewConfig?.showResponsible ?? true;
  const showNextContact = viewConfig?.showNextContact ?? true;
  const showQuickActions = viewConfig?.showQuickActions ?? true;

  const getFollowUpBadgeThemedClass = () => {
    if (followUpInfo.type === 'overdue') {
      return isLight
        ? 'text-rose-700 font-bold bg-white/85 px-1.5 py-0.5 rounded-md border border-rose-300 shadow-2xs'
        : 'text-rose-300 font-semibold';
    }
    if (followUpInfo.type === 'today') {
      return isLight
        ? 'text-amber-900 font-bold bg-white/85 px-1.5 py-0.5 rounded-md border border-amber-400 shadow-2xs'
        : 'text-amber-300 font-bold';
    }
    if (followUpInfo.type === 'tomorrow') {
      return isLight
        ? 'text-sky-800 font-semibold bg-white/80 px-1.5 py-0.5 rounded-md border border-sky-300'
        : 'text-sky-300 font-medium';
    }
    if (followUpInfo.type === 'upcoming') {
      return isLight
        ? 'text-slate-900 font-semibold bg-white/75 px-1.5 py-0.5 rounded-md border border-black/10'
        : 'text-slate-100 font-medium';
    }
    return isLight
      ? 'text-slate-700 font-medium hover:text-indigo-700'
      : 'text-slate-200/80 font-normal hover:text-indigo-300';
  };

  return (
    <div
      draggable
      onDragStart={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button, a, input, select, textarea, .card-dropdown-menu')) {
          e.preventDefault();
          return;
        }
        try {
          e.dataTransfer.setData('text/plain', lead.id);
          e.dataTransfer.effectAllowed = 'move';
        } catch {}
        onDragStart(e);
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        try {
          e.dataTransfer.dropEffect = 'move';
        } catch {}
        onDragOverCard?.(e);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropOnCard(e);
      }}
      className={`${getTemperatureCardClasses(lead.temperature)} rounded-[22px] p-3.5 transition-all cursor-grab active:cursor-grabbing flex flex-col justify-between group relative select-none ${
        isDragging ? 'opacity-35 scale-[0.98]' : ''
      }`}
      data-lead-id={lead.id}
      style={{ minHeight: '155px' }}
    >
      <div>
        {/* Top: Condominium Name + ⋯ */}
        <div className={`flex items-start justify-between gap-2 pb-2 mb-2 border-b ${isLight ? 'border-black/10' : 'border-white/15'}`}>
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <h3
              onClick={onOpenView}
              className={`text-sm transition-colors cursor-pointer leading-snug line-clamp-1 truncate ${
                isLight
                  ? 'font-bold text-slate-950 hover:text-indigo-700'
                  : 'font-semibold text-white hover:text-indigo-300'
              }`}
              title={lead.name}
            >
              {lead.name}
            </h3>
          </div>

          {/* ⋯ Dropdown Menu: Ver detalhes, Editar card, Excluir */}
          <div className="relative card-dropdown-menu">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleMenu();
              }}
              className={`p-1 -mr-1 rounded-md transition-colors cursor-pointer ${
                isLight
                  ? 'text-slate-700 hover:text-slate-950 hover:bg-white/60'
                  : 'text-slate-300 hover:text-white hover:bg-black/30'
              }`}
              title="Opções do condomínio"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>

            {isMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-slate-900 border border-slate-800 rounded-xl shadow-xl z-30 py-1 text-xs">
                {/* 1. Ver detalhes */}
                <button
                  type="button"
                  onClick={() => {
                    onCloseMenu();
                    onOpenView();
                  }}
                  className="w-full text-left px-3 py-2 text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                >
                  <EyeIcon className="w-3.5 h-3.5 text-slate-400" />
                  <span>Ver detalhes</span>
                </button>

                {/* 2. Editar card */}
                <button
                  type="button"
                  data-help-id="lead-card-edit"
                  onClick={() => {
                    onCloseMenu();
                    onOpenEdit();
                  }}
                  className="w-full text-left px-3 py-2 text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                >
                  <EditIcon className="w-3.5 h-3.5 text-slate-400" />
                  <span>Editar card</span>
                </button>

                <div className="border-t border-slate-800 my-1" />

                <button
                  type="button"
                  onClick={() => {
                    onCloseMenu();
                    onRequestDelete();
                  }}
                  className="w-full text-left px-3 py-2 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 flex items-center gap-2 cursor-pointer"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                  <span>Excluir condomínio</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Subtitle: Tipo · Cidade */}
        {showCityAndType && (
          <div className={`text-[11px] mb-2 truncate ${isLight ? 'text-slate-800 font-medium' : 'text-slate-200/90 font-normal'}`}>
            <span>{lead.condominium_type || 'Residencial'}</span>
            {lead.city && <span> · {lead.city}</span>}
          </div>
        )}

        {/* Stage Badge with Pencil Quick-Edit */}
        {showStage && (
          <div className="mb-2" data-help-id="pipeline-stage">
            {inlineEditing === 'stage' && stages.length > 0 ? (
              <select
                autoFocus
                value={lead.current_stage_id || stages[0]?.id || ''}
                onChange={(e) => {
                  onQuickUpdate?.(lead.id, 'stage', e.target.value);
                  setInlineEditing(null);
                }}
                onBlur={() => setInlineEditing(null)}
                className="w-full px-2 py-1 bg-slate-900 border border-indigo-500 rounded-lg text-[11px] text-slate-100 focus:outline-none"
              >
                {stages.map((stg) => (
                  <option key={stg.id} value={stg.id}>
                    {stg.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center gap-1">
                <span
                  className={`inline-block px-2 py-0.5 rounded-md text-[10px] truncate max-w-[200px] border ${
                    isLight
                      ? 'bg-white/90 text-slate-900 border-black/15 font-semibold shadow-2xs'
                      : 'bg-black/35 text-slate-100 border-white/15 font-medium'
                  }`}
                >
                  {stageName}
                </span>
                {onQuickUpdate && (
                  <button
                    type="button"
                    onClick={() => setInlineEditing('stage')}
                    title="Editar estágio do funil"
                    className={`p-0.5 rounded transition-colors cursor-pointer shrink-0 ${
                      isLight
                        ? 'text-slate-700 hover:text-indigo-700 hover:bg-white/70'
                        : 'text-slate-300/80 hover:text-white hover:bg-black/30'
                    }`}
                  >
                    <EditIcon className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Responsible with Persona Icon and Pencil Quick-Edit */}
        {showResponsible && (
          <div className="flex items-center gap-1.5 mb-2" title={`Responsável: ${responsibleName}`}>
            <div
              className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                isLight
                  ? 'bg-white/85 text-slate-700 border border-black/10'
                  : 'bg-black/35 text-slate-200 border border-white/10'
              }`}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>

            {inlineEditing === 'responsible' && profiles.length > 0 ? (
              <select
                autoFocus
                value={lead.responsible_user_id || profiles[0]?.id || ''}
                onChange={(e) => {
                  onQuickUpdate?.(lead.id, 'responsible', e.target.value);
                  setInlineEditing(null);
                }}
                onBlur={() => setInlineEditing(null)}
                className="px-1.5 py-0.5 bg-slate-900 border border-indigo-500 rounded text-[11px] text-slate-100 focus:outline-none max-w-[150px]"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || 'Usuário'}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center gap-1 min-w-0">
                <span className={`text-[11px] truncate max-w-[150px] ${isLight ? 'text-slate-900 font-medium' : 'text-slate-200'}`}>
                  {responsibleName}
                </span>
                {onQuickUpdate && (
                  <button
                    type="button"
                    onClick={() => setInlineEditing('responsible')}
                    title="Alterar responsável"
                    className={`p-0.5 rounded transition-colors cursor-pointer shrink-0 ${
                      isLight
                        ? 'text-slate-700 hover:text-indigo-700 hover:bg-white/70'
                        : 'text-slate-300/80 hover:text-white hover:bg-black/30'
                    }`}
                  >
                    <EditIcon className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Operational Follow-up Row */}
        {showNextContact && (
          <div className="pt-1.5 text-[11px]">
            {inlineEditing === 'followup_date' ? (
              <div className="flex items-center gap-1 bg-slate-900 p-1.5 rounded-xl border border-indigo-500/80 shadow-md">
                <input
                  type="date"
                  autoFocus
                  value={quickDate}
                  onChange={(e) => setQuickDate(e.target.value)}
                  className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-[11px] text-slate-100 focus:outline-none flex-1 min-w-0"
                />
                <input
                  type="time"
                  value={quickTime}
                  onChange={(e) => setQuickTime(e.target.value)}
                  className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-[11px] text-slate-100 focus:outline-none w-16"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (quickDate && onQuickUpdate) {
                      onQuickUpdate(lead.id, 'follow_up_date', `${quickDate}T${quickTime || '09:00'}:00`);
                    }
                    setInlineEditing(null);
                  }}
                  className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] cursor-pointer shrink-0"
                  title="Salvar data e horário"
                >
                  ✓
                </button>
                <button
                  type="button"
                  onClick={() => setInlineEditing(null)}
                  className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 text-[10px] cursor-pointer shrink-0"
                  title="Cancelar"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className={isLight ? 'text-slate-800 font-medium' : 'text-slate-200/90'}>Próximo contato</span>
                <div className="flex items-center gap-1 min-w-0">
                  <span
                    onClick={onOpenNotes}
                    className={`${getFollowUpBadgeThemedClass()} flex items-center gap-1 cursor-pointer hover:opacity-90 truncate max-w-[170px]`}
                    title="Clique para agendar ou editar follow-up"
                  >
                    <span className="truncate">{followUpInfo.displayFull || followUpInfo.label}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const initialDate = followUpInfo.rawDate
                        ? toDateInputValue(followUpInfo.rawDate)
                        : toDateInputValue(new Date().toISOString());
                      setQuickDate(initialDate);
                      setQuickTime(followUpInfo.time || '09:00');
                      setInlineEditing('followup_date');
                    }}
                    title="Alterar data e horário de próximo contato"
                    className={`p-0.5 rounded transition-colors cursor-pointer shrink-0 ${
                      isLight
                        ? 'text-slate-700 hover:text-indigo-700 hover:bg-white/70'
                        : 'text-slate-300/80 hover:text-white hover:bg-black/30'
                    }`}
                  >
                    <EditIcon className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Card Quick Actions Footer: Left Contact Icons + Right Isolated "+" Button */}
      {showQuickActions && (
        <CardQuickActions
          lead={lead}
          notesCount={notesCount}
          waCount={waCount}
          emCount={emCount}
          hasFolderLink={hasFolderLink}
          onOpenTimeline={onOpenTimeline}
          onOpenWhatsApp={onOpenWhatsApp}
          onOpenEmail={onOpenEmail}
          onOpenFolder={onOpenFolder}
          onOpenNotes={onOpenNotes}
        />
      )}
    </div>
  );
}

// ==========================================
// 4. PipelineColumn (Coluna Visual Limpa - Sem Linhas/Bordas Pesadas)
// ==========================================
export interface PipelineColumnProps {
  id: 'Frio' | 'Morno' | 'Quente' | 'Cliente';
  label: string;
  leadCount: number;
  dotClass: string;
  isDropTarget: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  children: React.ReactNode;
}

export function PipelineColumn({
  label,
  leadCount,
  dotClass,
  isDropTarget,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: PipelineColumnProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        onDragOver(e);
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        onDragOver(e);
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`w-full flex flex-col transition-colors rounded-2xl p-2 min-w-0 min-h-[calc(100vh-200px)] h-full ${
        isDropTarget
          ? isLight ? 'bg-indigo-100/70 ring-2 ring-indigo-400' : 'bg-indigo-500/15 ring-2 ring-indigo-500/30'
          : isLight ? 'bg-slate-200/50' : 'bg-slate-900/30'
      }`}
    >
      {/* Column Header: ● FRIO  4 */}
      <div className="flex items-center justify-between px-2 pb-2 mb-2 pointer-events-none select-none">
        <div className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full shadow-xs ${dotClass}`} />
          <h2 className={`font-bold text-xs uppercase tracking-wider ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
            {label}
          </h2>
        </div>
        <span className={`text-xs font-bold tabular-nums ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
          {leadCount}
        </span>
      </div>

      {/* Cards stack */}
      <div className="space-y-3 flex-1 flex flex-col pb-6">
        {children}
      </div>
    </div>
  );
}

// ==========================================
// 5. PipelineBoard (Container Contínuo do Board - 100% Full Width Grid)
// ==========================================
export function PipelineBoard({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full pb-8 pt-1">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-5 w-full">
        {children}
      </div>
    </div>
  );
}

