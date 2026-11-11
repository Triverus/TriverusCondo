import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useCRM, type Lead } from '../lib/crmStore.tsx';
import type { UserProfile } from '../App.tsx';
import { ContactIcon, FolderIcon } from './PipelineComponents.tsx';
import { supabase } from '../lib/supabase.ts';
import { usePermissions } from '../lib/permissionsContext.tsx';
import AuditoriaPopup from './AuditoriaPopup.tsx';
import {
  getSavedAgents,
  getAssignedAgentForCategory,
  assignAgentToAuditoriaCategory,
  removeAgentFromAuditoriaCategory,
  subscribeToAgents,
} from '../lib/agentStore.ts';
import type { AgentSlotData } from '../types/agentBuilder.ts';
import { Skeleton, SkeletonPastasGrid, SkeletonDriveFile } from './ui/Skeleton.tsx';
import { AgentAvatar } from './ui/AgentAvatar.tsx';

export interface AuditoriaModuleProps {
  currentProfile: UserProfile;
  currentPath: string;
  onNavigate: (path: string) => void;
  onBackToPipeline: () => void;
}

export interface CanonicalCategory {
  id: string;
  name: string;
  description: string;
  aliases: string[];
}

export const CANONICAL_CATEGORIES: CanonicalCategory[] = [
  {
    id: 'convencao',
    name: 'Convenção',
    description: 'Convenção do condomínio',
    aliases: ['convencao', 'convencao_condominio'],
  },
  {
    id: 'regimento_interno',
    name: 'Regimento Interno',
    description: 'Regras do condomínio',
    aliases: ['regimento_interno', 'regimento'],
  },
  {
    id: 'atas_assembleias',
    name: 'Atas',
    description: 'Assembleias do período auditado',
    aliases: ['atas_assembleias', 'ata_assembleia', 'atas'],
  },
  {
    id: 'pastas_prestacao_contas',
    name: 'Prestação de contas',
    description: 'Contas do condomínio',
    aliases: ['pastas_prestacao_contas', 'prestacao_contas', 'balancetes', 'pastas_contas', 'pasta_prestacao_contas'],
  },
  {
    id: 'extratos_bancarios',
    name: 'Extratos',
    description: 'Todos os extratos bancários',
    aliases: ['extratos_bancarios', 'extratos', 'extrato_bancario', 'banco'],
  },
  {
    id: 'previsao_orcamentaria',
    name: 'Previsão Orçamentária',
    description: 'Período auditado',
    aliases: ['previsao_orcamentaria', 'orcamento', 'previsao_orcamento'],
  },
  {
    id: 'contratos_fornecedores',
    name: 'Contratos',
    description: 'Fornecedores vigentes no período auditado',
    aliases: ['contratos_fornecedores', 'contratos', 'contrato_fornecedores'],
  },
  {
    id: 'inadimplencia',
    name: 'Inadimplência',
    description: 'Relatórios e controle de inadimplência',
    aliases: ['inadimplencia', 'inadimplentes', 'inadimplente', 'cobranca'],
  },
];

export function resolveCanonicalCategory(rawCategory?: string | null): CanonicalCategory | null {
  if (!rawCategory) return null;
  const norm = rawCategory.trim().toLowerCase();
  for (const cat of CANONICAL_CATEGORIES) {
    if (cat.id === norm || cat.aliases.includes(norm)) {
      return cat;
    }
  }
  return null;
}

export interface DrivePdfFile {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string | null;
  createdTime: string | null;
}

export interface FolderLink {
  id: string;
  condo_id: string;
  category: string;
  drive_folder_id: string;
  drive_folder_name: string;
  last_synced_at?: string;
  persisted_definitively?: boolean;
}

export interface AvailableFolder {
  id: string;
  name: string;
  path: string;
  is_condo_root: boolean;
  pdf_count?: number;
  createdTime?: string;
  modifiedTime?: string;
}

export interface LinkedDocument {
  id: string;
  condo_id: string;
  category: string;
  drive_file_id: string;
  drive_file_name: string;
  drive_file_size: number | null;
  drive_file_modified_at: string | null;
  linked_by_user_id: string | null;
  origin_folder_id?: string | null;
  origin_folder_name?: string | null;
  sync_status?: string | null;
  created_at: string;
  updated_at: string;
  persisted_definitively?: boolean;
}

export interface AuditoriaMemory {
  id: string;
  condo_id: string;
  category: string;
  stage_id?: string;
  stageId?: string;
  label: string;
  fill_mode: 'manual' | 'ai';
  manual_value?: string | null;
  instruction?: string | null;
  source_document_id?: string | null;
  source_drive_file_id?: string | null;
  source_drive_file_name?: string | null;
  last_result?: string | null;
  page_reference?: string | null;
  last_result_metadata?: {
    found?: boolean;
    page_reference?: string | null;
    quoted_excerpt?: string | null;
    confidence?: 'alta' | 'moderada' | 'baixa';
    notes?: string | null;
  } | null;
  status: 'never_searched' | 'result_available' | 'outdated' | 'failed';
  last_executed_at?: string | null;
  source_file_modified_at?: string | null;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
}

export interface DocumentAnalysisResult {
  document_identification: {
    title: string;
    detected_type: string;
    is_convention: boolean;
    compatibility_status: 'compatible' | 'incompatible' | 'uncertain';
    compatibility_notes: string;
    condominium_name_in_doc?: string | null;
    estimated_date?: string | null;
    registry_info?: string | null;
    total_pages_detected?: number | null;
  };
  executive_summary: {
    summary: string;
    main_purpose: string;
    overall_structure: string;
  };
  relevant_clauses: Array<{
    topic: string;
    page_reference?: string | null;
    summary: string;
    quoted_excerpt?: string | null;
    relevance: 'alta' | 'media' | 'informativa';
  }>;
  points_of_attention: Array<{
    type: 'ambiguidade' | 'lacuna' | 'potencial_conflito' | 'desatualizacao' | 'incompatibilidade';
    description: string;
    page_reference?: string | null;
    recommendation: string;
  }>;
  preliminary_checklist: Array<{
    item: string;
    status: 'confirmado_no_documento' | 'ausente_ou_nao_localizado' | 'requer_validacao_humana';
    details: string;
    page_reference?: string | null;
  }>;
  analysis_limitations: {
    reading_quality: 'alta' | 'media' | 'baixa' | 'ilegivel';
    unreadable_pages?: string | null;
    limitations_notes: string;
    confidence_level: 'alta' | 'moderada' | 'baixa';
    legal_disclaimer: string;
  };
}

export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return 'Tamanho não informado';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export function normalizeString(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function getAuditoriaProgress(completedCount: number) {
  const total = CANONICAL_CATEGORIES.length;
  const clamped = Math.max(0, Math.min(total, completedCount));
  const percentage = Math.round((clamped / total) * 100);

  let color = '#64748B'; // 0%
  if (percentage >= 100) color = '#00D66B';
  else if (percentage >= 86) color = '#4DDB35';
  else if (percentage >= 71) color = '#9BE000';
  else if (percentage >= 57) color = '#FFD600';
  else if (percentage >= 43) color = '#FFA31A';
  else if (percentage >= 29) color = '#FF7824';
  else if (percentage >= 14) color = '#EF6040';

  return { percentage, color, clamped, total };
}

export function GoogleDriveLogoSvg({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 87.3 78" fill="none">
      <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5l5.4 9.35z" fill="#0066DA" />
      <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.5c-.8 1.4-1.2 2.95-1.2 4.5h27.5L43.65 25z" fill="#00AC47" />
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 10.15 7.9 13.65z" fill="#EA4335" />
      <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.4-4.5 1.2L43.65 25z" fill="#00832D" />
      <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.4 4.5-1.2L59.8 53z" fill="#2684FC" />
      <path d="M73.4 26.5l-12.7-22C59.9 3.1 58.75 2 57.4 1.2L43.65 25l16.15 28h27.5c0-1.55-.4-3.1-1.2-4.5l-12.7-22z" fill="#FFBA00" />
    </svg>
  );
}

export function OwlIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4c0 3 1.5 6 4 7-2 1-3.5 3-3.5 6 0 2.5 3 4 7.5 4s7.5-1.5 7.5-4c0-3-1.5-5-3.5-6 2.5-1 4-4 4-7-3 1-6 .5-8 3-2-2.5-5-2-8-3z" />
      <circle cx="9" cy="12" r="2" strokeWidth={1.8} />
      <circle cx="15" cy="12" r="2" strokeWidth={1.8} />
      <path strokeLinecap="round" strokeWidth={1.8} d="M12 14.5l-1 2h2l-1-2z" />
    </svg>
  );
}

export function SparklesIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  );
}

export function BookmarkIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
    </svg>
  );
}

export default function AuditoriaModule({
  currentProfile,
  currentPath,
  onNavigate,
  onBackToPipeline,
}: AuditoriaModuleProps) {
  const {
    leads,
    stages,
    profileMap,
    getContactsForLead,
    isInitialLoading,
    isRefreshing,
    error: crmError,
    refreshAll,
  } = useCRM();

  const { canAccessAuditoria, canManageAuditoria, isAdmin } = usePermissions();

  const [searchTerm, setSearchTerm] = useState('');
  const [sortOption, setSortOption] = useState<'nome_asc' | 'progresso_desc' | 'progresso_asc'>(() => {
    try {
      const saved = localStorage.getItem('triverus:clientes:sort');
      if (saved === 'progresso_desc' || saved === 'progresso_asc' || saved === 'nome_asc') {
        return saved;
      }
    } catch {
      // localStorage indisponível
    }
    return 'nome_asc';
  });
  const [condoSummaryMap, setCondoSummaryMap] = useState<Record<string, string[]>>(() => {
    try {
      const cachedSummary = localStorage.getItem('triverus:auditoria-summary:v1');
      return cachedSummary ? JSON.parse(cachedSummary) : {};
    } catch {
      return {};
    }
  });
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [contingencyWarning, setContingencyWarning] = useState<string | null>(null);

  const handleSortChange = useCallback((newSort: 'nome_asc' | 'progresso_desc' | 'progresso_asc') => {
    setSortOption(newSort);
    try {
      localStorage.setItem('triverus:clientes:sort', newSort);
    } catch {
      // localStorage indisponível
    }
  }, []);

  // Extrair condoId dos parâmetros da URL (suporte a /app/auditoria?condoId=UUID)
  const currentCondoId = useMemo(() => {
    try {
      const searchStr = currentPath.includes('?')
        ? currentPath.slice(currentPath.indexOf('?'))
        : window.location.search;
      const params = new URLSearchParams(searchStr);
      return params.get('condoId');
    } catch {
      return null;
    }
  }, [currentPath]);

  // Carregar resumo em lote do progresso de auditoria dos condomínios
  const fetchAllAuditoriaSummary = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch('/api/auditoria/all-summary', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.summary) {
          setCondoSummaryMap(data.summary);
          try {
            localStorage.setItem('triverus:auditoria-summary:v1', JSON.stringify(data.summary));
          } catch {}
        }
      }
    } catch (err) {
      console.warn('[AuditoriaModule] Falha ao carregar resumo de progresso:', err);
    }
  }, []);

  useEffect(() => {
    fetchAllAuditoriaSummary();
  }, [fetchAllAuditoriaSummary]);

  // Estados dos documentos vinculados (múltiplos documentos por categoria)
  const [linkedDocuments, setLinkedDocuments] = useState<Record<string, LinkedDocument[]>>({});
  const [otherDocuments, setOtherDocuments] = useState<LinkedDocument[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState<boolean>(false);

  // Estados dos vínculos de pasta e navegador do Google Drive
  const [folderLinks, setFolderLinks] = useState<Record<string, FolderLink>>({});

  // Sincronizar condomínio atualmente aberto no popup com o mapa de progresso geral em tempo real
  useEffect(() => {
    if (currentCondoId) {
      const completed: string[] = [];
      CANONICAL_CATEGORIES.forEach((cat) => {
        const docs = linkedDocuments[cat.id] || [];
        if (docs.length > 0) {
          completed.push(cat.id);
        }
      });
      setCondoSummaryMap((prev) => ({
        ...prev,
        [currentCondoId]: completed,
      }));
    }
  }, [currentCondoId, linkedDocuments, folderLinks]);
  const [isFolderModalOpen, setIsFolderModalOpen] = useState<boolean>(false);
  const [activeFolderCategory, setActiveFolderCategory] = useState<string>('convencao');
  const [availableFolders, setAvailableFolders] = useState<AvailableFolder[]>([]);
  const [folderBreadcrumb, setFolderBreadcrumb] = useState<Array<{ id: string; name: string }>>([]);
  const [currentFolderMeta, setCurrentFolderMeta] = useState<{ id: string; name: string } | null>(null);
  const [currentFolderPdfs, setCurrentFolderPdfs] = useState<DrivePdfFile[]>([]);
  const [navFolderId, setNavFolderId] = useState<string | null>(null);
  const [isLoadingAvailableFolders, setIsLoadingAvailableFolders] = useState<boolean>(false);
  const [availableFoldersError, setAvailableFoldersError] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedFolderName, setSelectedFolderName] = useState<string | null>(null);
  const [selectedFolderPdfCount, setSelectedFolderPdfCount] = useState<number | null>(null);
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);
  const [folderSearchTerm, setFolderSearchTerm] = useState<string>('');
  const [isLinkingFolder, setIsLinkingFolder] = useState<boolean>(false);
  const [linkingFolderError, setLinkingFolderError] = useState<string | null>(null);

  // Estado de sincronização em andamento por categoria
  const [syncingCategory, setSyncingCategory] = useState<string | null>(null);

  // Estados de confirmação para desvinculação de pasta
  const [folderToUnlink, setFolderToUnlink] = useState<{ category: string; folder: FolderLink } | null>(null);
  const [isConfirmUnlinkFolderOpen, setIsConfirmUnlinkFolderOpen] = useState<boolean>(false);
  const [isUnlinkingFolder, setIsUnlinkingFolder] = useState<boolean>(false);
  const [unlinkFolderError, setUnlinkFolderError] = useState<string | null>(null);

  // Estados do modal de seleção de arquivos do Google Drive
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [activeModalCategory, setActiveModalCategory] = useState<string>('convencao');
  const [isLoadingDriveFiles, setIsLoadingDriveFiles] = useState<boolean>(false);
  const [driveFilesError, setDriveFilesError] = useState<string | null>(null);
  const [driveFolderFound, setDriveFolderFound] = useState<boolean>(false);
  const [driveFolderName, setDriveFolderName] = useState<string | null>(null);
  const [driveMessage, setDriveMessage] = useState<string | null>(null);
  const [driveFiles, setDriveFiles] = useState<DrivePdfFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [isSavingLink, setIsSavingLink] = useState<boolean>(false);
  const [saveLinkError, setSaveLinkError] = useState<string | null>(null);

  // Estados para desvinculação de documento específico
  const [docToUnlink, setDocToUnlink] = useState<{ category: string; doc: LinkedDocument } | null>(null);
  const [isUnlinking, setIsUnlinking] = useState<boolean>(false);
  const [isConfirmUnlinkOpen, setIsConfirmUnlinkOpen] = useState<boolean>(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [isStreamingFile, setIsStreamingFile] = useState<boolean>(false);

  // Estados para análise inteligente assistida por IA
  const [analysesMap, setAnalysesMap] = useState<Record<string, {
    analysis: DocumentAnalysisResult;
    analyzedAt: string;
    fileName: string;
  }>>({});
  const [isAnalyzingDoc, setIsAnalyzingDoc] = useState<boolean>(false);
  const [analyzingCategory, setAnalyzingCategory] = useState<string | null>(null);
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState<boolean>(false);
  const [activeAnalysisCategory, setActiveAnalysisCategory] = useState<string>('convencao');
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [activeAnalysisTab, setActiveAnalysisTab] = useState<'geral' | 'clausulas' | 'atencao' | 'checklist' | 'limitacoes'>('geral');
  const [copyFeedback, setCopyFeedback] = useState<boolean>(false);

  // =========================================================================
  // ESTADOS DA RECONSTRUÇÃO VISUAL DO POPUP DE AUDITORIA (FASE 1)
  // =========================================================================
  const [activeStageId, setActiveStageId] = useState<string>('convencao');
  const [activeRightTab, setActiveRightTab] = useState<'ia' | 'documentos' | 'memorias'>('ia');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState<boolean>(false);
  const [isAgentModalOpen, setIsAgentModalOpen] = useState<boolean>(false);
  const [selectedAgent, setSelectedAgent] = useState<string>('auditoria_doc');
  const [chatInput, setChatInput] = useState<string>('');
  const [chatMessagesByStage, setChatMessagesByStage] = useState<Record<string, Array<{ id: string; role: 'user' | 'assistant'; content: string; timestamp: string; results?: any[] }>>>({});
  const [isSendingChatMessage, setIsSendingChatMessage] = useState<boolean>(false);
  const [savedAgents, setSavedAgentsState] = useState<AgentSlotData[]>(() => getSavedAgents());

  useEffect(() => {
    const unsubscribe = subscribeToAgents(() => {
      setSavedAgentsState(getSavedAgents());
    });
    return () => unsubscribe();
  }, []);

  // Estados das Memórias Personalizadas (Fase 2 + Evolução)
  const [memoriesList, setMemoriesList] = useState<AuditoriaMemory[]>([]);
  const [isLoadingMemories, setIsLoadingMemories] = useState<boolean>(false);
  const [extractingMemoryId, setExtractingMemoryId] = useState<string | null>(null);
  const [isBatchExecutingMemories, setIsBatchExecutingMemories] = useState<boolean>(false);
  const [isAddMemoryModalOpen, setIsAddMemoryModalOpen] = useState<boolean>(false);
  const [editingMemory, setEditingMemory] = useState<AuditoriaMemory | null>(null);
  const [memoryToDelete, setMemoryToDelete] = useState<AuditoriaMemory | null>(null);
  const [isSavingMemory, setIsSavingMemory] = useState<boolean>(false);
  const [isDeletingMemory, setIsDeletingMemory] = useState<boolean>(false);

  // Formulário de Memórias
  const [memoryFormMode, setMemoryFormMode] = useState<'manual' | 'ai'>('ai');
  const [memoryFormLabel, setMemoryFormLabel] = useState<string>('');
  const [memoryFormManualValue, setMemoryFormManualValue] = useState<string>('');
  const [memoryFormInstruction, setMemoryFormInstruction] = useState<string>('');
  const [memoryFormSourceDriveFileId, setMemoryFormSourceDriveFileId] = useState<string>('');

  // Auto-dismiss do feedback discreto após 4 segundos
  useEffect(() => {
    if (!feedbackMessage) return;
    const timer = setTimeout(() => {
      setFeedbackMessage(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [feedbackMessage]);



  // Identificação canônica da etapa "Cliente"
  const clientStageIds = useMemo(() => {
    return new Set(
      stages
        .filter(
          (s) =>
            Boolean(s.is_won) ||
            s.id === 'stg_cliente' ||
            (s.name && s.name.toLowerCase().includes('cliente'))
        )
        .map((s) => s.id)
    );
  }, [stages]);

  // Filtragem estrita dos condomínios clientes com isolamento por usuário responsável (quando não for admin)
  const clientLeads = useMemo(() => {
    const firstStageId = stages[0]?.id;
    return leads.filter((lead) => {
      const currentStage = lead.current_stage_id || firstStageId;
      const isClient = currentStage ? clientStageIds.has(currentStage) : false;
      if (!isClient) return false;
      if (isAdmin) return true;
      return lead.responsible_user_id === currentProfile.id;
    });
  }, [leads, clientStageIds, stages, isAdmin, currentProfile.id]);

  // Filtragem insensível a acentos/caixa e ordenação por progresso/nome
  const processedClients = useMemo(() => {
    const termNorm = normalizeString(searchTerm);

    const filtered = clientLeads.filter((lead) => {
      if (termNorm) {
        const nameNorm = normalizeString(lead.name || '');
        if (!nameNorm.includes(termNorm)) return false;
      }
      return true;
    });

    return filtered.sort((a, b) => {
      const aCount = (condoSummaryMap[a.id] || []).length;
      const bCount = (condoSummaryMap[b.id] || []).length;
      const aPct = Math.round((aCount / CANONICAL_CATEGORIES.length) * 100);
      const bPct = Math.round((bCount / CANONICAL_CATEGORIES.length) * 100);

      if (sortOption === 'progresso_desc') {
        if (bPct !== aPct) return bPct - aPct;
        return (a.name || '').localeCompare(b.name || '');
      }
      if (sortOption === 'progresso_asc') {
        if (aPct !== bPct) return aPct - bPct;
        return (a.name || '').localeCompare(b.name || '');
      }
      // Padrão: nome_asc
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [clientLeads, searchTerm, sortOption, condoSummaryMap]);

  // Condomínio selecionado para a visualização de detalhe
  const selectedCondo = useMemo(() => {
    if (!currentCondoId) return null;
    return leads.find((l) => l.id === currentCondoId) || null;
  }, [currentCondoId, leads]);

  // Carregar documentos vinculados quando abrir a tela do condomínio
  const loadLinkedDocuments = useCallback(async (condoId: string) => {
    try {
      setIsLoadingDocuments(true);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/auditoria/condo/${condoId}/documents`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        const map: Record<string, LinkedDocument[]> = {};
        const unmapped: LinkedDocument[] = [];
        (data.documents || []).forEach((d: LinkedDocument) => {
          const docItem = {
            ...d,
            persisted_definitively: d.persisted_definitively ?? data.persisted_definitively,
          };
          const resolved = resolveCanonicalCategory(d.category);
          if (resolved) {
            if (!map[resolved.id]) map[resolved.id] = [];
            map[resolved.id].push(docItem);
          } else {
            // Documento em categoria personalizada/legada que não mapeia para as 7 canônicas
            unmapped.push(docItem);
          }
        });
        setLinkedDocuments(map);
        setOtherDocuments(unmapped);
        if (data.persisted_definitively === false) {
          setContingencyWarning(
            data.warning || 'Migração SQL pendente no Supabase. Os vínculos estão em contingência local temporária.'
          );
        } else {
          setContingencyWarning(null);
        }
      }

      // Carregar também vínculos de pasta por fase
      try {
        const foldersRes = await fetch(`/api/auditoria/condo/${condoId}/folder-links`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (foldersRes.ok) {
          const fData = await foldersRes.json();
          const fMap: Record<string, FolderLink> = {};
          (fData.folder_links || fData.folders || []).forEach((f: FolderLink) => {
            fMap[f.category] = f;
          });
          setFolderLinks(fMap);
        }
      } catch (fErr) {
        console.warn('[Auditoria] Falha ao carregar vínculos de pasta:', fErr);
      }
    } catch (err) {
      console.warn('[Auditoria] Falha ao carregar documentos do condomínio:', err);
    } finally {
      setIsLoadingDocuments(false);
    }
  }, []);

  // Carregar memórias personalizadas do condomínio (Fase 2)
  const loadMemories = useCallback(async (condoId: string) => {
    try {
      setIsLoadingMemories(true);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/auditoria/condo/${condoId}/memories`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setMemoriesList(data.memories || []);
      }
    } catch (err) {
      console.warn('[Auditoria] Falha ao carregar memórias do condomínio:', err);
    } finally {
      setIsLoadingMemories(false);
    }
  }, []);

  useEffect(() => {
    if (currentCondoId) {
      setActiveRightTab('ia');
      setActiveStageId('convencao');
      setIsPlusMenuOpen(false);
      loadLinkedDocuments(currentCondoId);
      loadMemories(currentCondoId);
    } else {
      setLinkedDocuments({});
      setOtherDocuments([]);
      setMemoriesList([]);
    }
  }, [currentCondoId, loadLinkedDocuments, loadMemories]);

  // Buscar pastas e navegar pela hierarquia do Google Drive do condomínio
  const fetchAvailableFolders = useCallback(async (condoId: string, folderId?: string | null, search?: string | null) => {
    try {
      setIsLoadingAvailableFolders(true);
      setAvailableFoldersError(null);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      let queryUrl: string;
      if (search && search.trim()) {
        queryUrl = `/api/auditoria/condo/${condoId}/drive-folders?search=${encodeURIComponent(search.trim())}`;
      } else if (folderId) {
        queryUrl = `/api/auditoria/condo/${condoId}/drive-folders?folderId=${encodeURIComponent(folderId)}`;
      } else {
        queryUrl = `/api/auditoria/condo/${condoId}/drive-folders`;
      }

      const res = await fetch(queryUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.ok === false) {
        throw new Error(data.error || data.details || 'Falha ao navegar pelas pastas do condomínio no Google Drive');
      }

      setAvailableFolders(data.subfolders || []);
      if (data.isSearch) {
        // Modo de busca ativo
      } else {
        setFolderBreadcrumb(data.breadcrumb || []);
        setCurrentFolderMeta(data.currentFolder || null);
        setCurrentFolderPdfs(data.pdfs || []);
        setNavFolderId(data.currentFolder?.id || null);
      }
    } catch (err: any) {
      console.warn('[Auditoria] Erro ao carregar pastas:', err);
      setAvailableFoldersError(err.message || 'Erro ao carregar pasta do Google Drive');
      if (!search) {
        setCurrentFolderMeta(null);
        setAvailableFolders([]);
        setFolderBreadcrumb([]);
        setCurrentFolderPdfs([]);
      }
    } finally {
      setIsLoadingAvailableFolders(false);
    }
  }, []);

  // Manipular busca de pastas com debounce
  const handleFolderSearchChange = useCallback((text: string) => {
    setFolderSearchTerm(text);
  }, []);

  useEffect(() => {
    if (!isFolderModalOpen || !selectedCondo) return;
    if (!folderSearchTerm.trim()) {
      return;
    }
    const timer = setTimeout(() => {
      fetchAvailableFolders(selectedCondo.id, null, folderSearchTerm.trim());
    }, 350);
    return () => clearTimeout(timer);
  }, [folderSearchTerm, isFolderModalOpen, selectedCondo, fetchAvailableFolders]);

  const handleClearFolderSearch = useCallback(() => {
    setFolderSearchTerm('');
    if (selectedCondo) {
      fetchAvailableFolders(selectedCondo.id, navFolderId || null);
    }
  }, [selectedCondo, navFolderId, fetchAvailableFolders]);

  // Abrir modal para vincular pasta a uma fase canônica (inicia sem seleção prévia)
  const handleOpenLinkFolderModal = useCallback((category: string) => {
    if (!currentCondoId) return;
    setActiveFolderCategory(category);
    setSelectedFolderId(null);
    setSelectedFolderName(null);
    setSelectedFolderPdfCount(null);
    setSelectedFolderPath(null);
    setLinkingFolderError(null);
    setFolderSearchTerm('');
    setIsFolderModalOpen(true);
    fetchAvailableFolders(currentCondoId, null);
  }, [currentCondoId, fetchAvailableFolders]);

  // Confirmar vínculo da pasta atualmente aberta (Regra B) e sincronização automática idempotente dos PDFs
  const handleConfirmLinkFolder = useCallback(async () => {
    const targetFolder = currentFolderMeta;
    if (!currentCondoId || !targetFolder || !targetFolder.id) return;
    const folderId = targetFolder.id;
    const folderName = targetFolder.name || 'Pasta Selecionada';

    try {
      setIsLinkingFolder(true);
      setLinkingFolderError(null);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`/api/auditoria/condo/${currentCondoId}/phases/${activeFolderCategory}/link-folder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          drive_folder_id: folderId,
          drive_folder_name: folderName,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.details || errData.error || 'Falha ao vincular pasta da fase');
      }

      const resData = await res.json();
      await loadLinkedDocuments(currentCondoId);
      setIsFolderModalOpen(false);
      setActiveRightTab('ia');
      const syncedCount = resData.imported_count ?? resData.syncedCount ?? resData.total_in_folder ?? 0;
      setFeedbackMessage(`Pasta "${folderName}" vinculada com sucesso! ${syncedCount} PDFs sincronizados.`);
      setTimeout(() => setFeedbackMessage(null), 5000);
    } catch (err: any) {
      setLinkingFolderError(err.message || 'Erro ao vincular pasta');
    } finally {
      setIsLinkingFolder(false);
    }
  }, [currentCondoId, currentFolderMeta, activeFolderCategory, loadLinkedDocuments]);

  // Sincronizar PDFs da pasta vinculada à fase sob demanda (idempotente)
  const handleSyncFolder = useCallback(async (category: string) => {
    if (!currentCondoId) return;
    try {
      setSyncingCategory(category);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`/api/auditoria/condo/${currentCondoId}/phases/${category}/sync-folder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.details || errData.error || 'Falha ao sincronizar pasta');
      }

      const resData = await res.json();
      await loadLinkedDocuments(currentCondoId);
      const newCount = resData.syncedCount || 0;
      const totalCount = resData.totalPdfsInFolder || 0;
      setFeedbackMessage(`Sincronização concluída: ${newCount} novos PDFs vinculados (${totalCount} no total na pasta).`);
      setTimeout(() => setFeedbackMessage(null), 5000);
    } catch (err: any) {
      setFeedbackMessage(`Erro na sincronização: ${err.message}`);
      setTimeout(() => setFeedbackMessage(null), 6000);
    } finally {
      setSyncingCategory(null);
    }
  }, [currentCondoId, loadLinkedDocuments]);

  // Solicitar desvinculação da pasta (abre modal de confirmação)
  const handleRequestUnlinkFolder = useCallback((category: string, folder: FolderLink) => {
    setFolderToUnlink({ category, folder });
    setUnlinkFolderError(null);
    setIsConfirmUnlinkFolderOpen(true);
  }, []);

  // Confirmar desvinculação seletiva da pasta (mantém arquivos intactos no Drive)
  const handleConfirmUnlinkFolder = useCallback(async () => {
    if (!currentCondoId || !folderToUnlink) return;
    try {
      setIsUnlinkingFolder(true);
      setUnlinkFolderError(null);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`/api/auditoria/condo/${currentCondoId}/phases/${folderToUnlink.category}/unlink-folder`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.details || errData.error || 'Falha ao desvincular pasta');
      }

      await loadLinkedDocuments(currentCondoId);
      setIsConfirmUnlinkFolderOpen(false);
      setFolderToUnlink(null);
      setFeedbackMessage('Pasta e documentos desvinculados no CRM. Arquivos no Drive permanecem 100% intactos.');
      setTimeout(() => setFeedbackMessage(null), 5000);
    } catch (err: any) {
      setUnlinkFolderError(err.message || 'Erro ao desvincular pasta');
    } finally {
      setIsUnlinkingFolder(false);
    }
  }, [currentCondoId, folderToUnlink, loadLinkedDocuments]);

  // Buscar arquivos PDF no Drive para vincular
  const fetchDriveFiles = useCallback(async (condoId: string, condoName: string) => {
    try {
      setIsLoadingDriveFiles(true);
      setDriveFilesError(null);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/auditoria/condo/${condoId}/drive-files?condoName=${encodeURIComponent(condoName)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao consultar arquivos do Google Drive.');
      }
      setDriveFiles(data.files || []);
      setDriveFolderFound(Boolean(data.found));
      setDriveFolderName(data.folder?.name || null);
      setDriveMessage(data.message || null);
    } catch (err: any) {
      console.warn('[Auditoria] Erro ao carregar arquivos do Drive:', err);
      setDriveFilesError(err?.message || 'Falha ao consultar pasta do condomínio no Google Drive.');
      setDriveFiles([]);
      setDriveFolderFound(false);
      setDriveFolderName(null);
      setDriveMessage(null);
    } finally {
      setIsLoadingDriveFiles(false);
    }
  }, []);

  const handleOpenVincularModal = (category: string = 'convencao') => {
    if (!selectedCondo) return;
    setActiveModalCategory(category);
    setIsModalOpen(true);
    setSaveLinkError(null);
    setSelectedFileId(null);
    fetchDriveFiles(selectedCondo.id, selectedCondo.name);
  };

  // Confirmar vínculo do arquivo selecionado
  const handleConfirmLink = async () => {
    if (!selectedCondo || !selectedFileId) return;
    const selectedFile = driveFiles.find((f) => f.id === selectedFileId);
    if (!selectedFile) return;

    setIsSavingLink(true);
    setSaveLinkError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/auditoria/condo/${selectedCondo.id}/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          category: activeModalCategory,
          drive_file_id: selectedFile.id,
          drive_file_name: selectedFile.name,
          drive_file_size: selectedFile.size,
          drive_file_modified_at: selectedFile.modifiedTime,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao salvar vínculo no banco de dados.');
      }

      const docItem: LinkedDocument = {
        ...data.document,
        persisted_definitively: data.persisted_definitively,
      };

      setLinkedDocuments((prev) => {
        const currentList = prev[activeModalCategory] || [];
        const existsIdx = currentList.findIndex((d) => d.drive_file_id === docItem.drive_file_id);
        let updatedList: LinkedDocument[];
        if (existsIdx >= 0) {
          updatedList = [...currentList];
          updatedList[existsIdx] = docItem;
        } else {
          updatedList = [docItem, ...currentList];
        }
        return {
          ...prev,
          [activeModalCategory]: updatedList,
        };
      });

      setIsModalOpen(false);

      const catName = resolveCanonicalCategory(activeModalCategory)?.name || activeModalCategory;
      if (data.persisted_definitively === false) {
        setContingencyWarning(
          data.warning || 'Vínculo registrado em contingência local temporária (migração SQL pendente no Supabase).'
        );
        setFeedbackMessage(`${catName} vinculada em contingência local (migração SQL pendente).`);
      } else {
        setContingencyWarning(null);
        setFeedbackMessage(`${catName} vinculada com sucesso no Supabase!`);
      }
    } catch (err: any) {
      setSaveLinkError(err?.message || 'Erro inesperado ao salvar vínculo.');
    } finally {
      setIsSavingLink(false);
    }
  };

  // Abrir modal de confirmação para desvincular um documento específico
  const handleRequestUnlink = (category: string, doc: LinkedDocument) => {
    if (!selectedCondo) return;
    setDocToUnlink({ category, doc });
    setUnlinkError(null);
    setIsConfirmUnlinkOpen(true);
  };

  // Cancelar e fechar modal de confirmação de desvinculação
  const handleCancelUnlink = () => {
    if (isUnlinking) return;
    setIsConfirmUnlinkOpen(false);
    setDocToUnlink(null);
    setUnlinkError(null);
  };

  // Executar desvinculação do documento específico após confirmação
  const handleExecuteUnlink = async () => {
    if (!selectedCondo || !docToUnlink) return;

    setIsUnlinking(true);
    setUnlinkError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const url = `/api/auditoria/condo/${selectedCondo.id}/documents/${encodeURIComponent(docToUnlink.category)}?driveFileId=${encodeURIComponent(docToUnlink.doc.drive_file_id)}&documentId=${encodeURIComponent(docToUnlink.doc.id)}`;
      const res = await fetch(url, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        const errorMsg = data?.error || `Falha ao desvincular documento (código HTTP ${res.status}).`;
        setUnlinkError(errorMsg);
        setFeedbackMessage(errorMsg);
        return;
      }

      setLinkedDocuments((prev) => {
        const list = prev[docToUnlink.category] || [];
        return {
          ...prev,
          [docToUnlink.category]: list.filter(
            (d) => d.drive_file_id !== docToUnlink.doc.drive_file_id && d.id !== docToUnlink.doc.id
          ),
        };
      });
      setIsConfirmUnlinkOpen(false);
      setDocToUnlink(null);
      setFeedbackMessage('Documento desvinculado com sucesso no Triverus. O arquivo no Google Drive foi mantido intacto.');
    } catch (err: any) {
      const errorMsg = err?.message || 'Falha de comunicação com o servidor ao desvincular documento.';
      setUnlinkError(errorMsg);
      setFeedbackMessage(errorMsg);
    } finally {
      setIsUnlinking(false);
    }
  };

  // Visualizar PDF através do proxy autenticado do servidor
  const handleViewPdf = async (fileId: string) => {
    setIsStreamingFile(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const condoParam = selectedCondo?.id ? `?condoId=${encodeURIComponent(selectedCondo.id)}` : '';
      const res = await fetch(`/api/auditoria/documents/file/${fileId}/stream${condoParam}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        throw new Error('Não foi possível carregar o arquivo do Google Drive.');
      }

      const blob = await res.blob();
      const fileUrl = URL.createObjectURL(blob);
      window.open(fileUrl, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      setFeedbackMessage(err?.message || 'Erro ao abrir visualização do PDF.');
    } finally {
      setIsStreamingFile(false);
    }
  };

  // Executar a análise com IA do documento da categoria especificada
  const executeAnalysis = async (category: string = 'convencao', targetDoc?: LinkedDocument) => {
    if (!selectedCondo) return;
    const catDocs = linkedDocuments[category] || [];
    const doc = targetDoc || catDocs[0];
    if (!doc) {
      setFeedbackMessage('Nenhum documento vinculado nesta categoria para analisar.');
      return;
    }

    setIsAnalyzingDoc(true);
    setAnalyzingCategory(category);
    setActiveAnalysisCategory(category);
    setAnalysisError(null);
    setIsAnalysisModalOpen(true);
    setActiveAnalysisTab('geral');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`/api/auditoria/condo/${selectedCondo.id}/documents/${category}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          drive_file_id: doc.drive_file_id,
          document_id: doc.id,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok || !data?.analysis) {
        throw new Error(data?.error || `Falha no processamento da análise com IA (HTTP ${res.status}).`);
      }

      setAnalysesMap((prev) => ({
        ...prev,
        [category]: {
          analysis: data.analysis,
          analyzedAt: data.analyzed_at || new Date().toISOString(),
          fileName: doc.drive_file_name,
        },
      }));

      setFeedbackMessage('Análise inteligente concluída com sucesso!');
    } catch (err: any) {
      console.error('[Auditoria] Falha ao analisar documento com IA:', err);
      setAnalysisError(err?.message || 'Falha de comunicação ao analisar documento com IA.');
    } finally {
      setIsAnalyzingDoc(false);
      setAnalyzingCategory(null);
    }
  };

  // Abrir modal de análise (usa cache da sessão ou inicia análise)
  const handleOpenAnalysis = (category: string = 'convencao', targetDoc?: LinkedDocument) => {
    setActiveAnalysisCategory(category);
    if (analysesMap[category]) {
      setAnalysisError(null);
      setIsAnalysisModalOpen(true);
    } else {
      executeAnalysis(category, targetDoc);
    }
  };

  // Copiar resumo estruturado da análise para a área de transferência
  const handleCopyAnalysisSummary = (result: DocumentAnalysisResult) => {
    try {
      const lines: string[] = [];
      lines.push(`ANÁLISE INTELIGENTE DE AUDITORIA — TRIVERUS CRM`);
      lines.push(`Condomínio: ${selectedCondo?.name || 'Não identificado'}`);
      lines.push(`Documento: ${result.document_identification.title} (${result.document_identification.detected_type})`);
      lines.push(`Status de Compatibilidade: ${result.document_identification.compatibility_status.toUpperCase()}`);
      lines.push(`\n1. RESUMO EXECUTIVO`);
      lines.push(`Finalidade: ${result.executive_summary.main_purpose}`);
      lines.push(`Síntese: ${result.executive_summary.summary}`);
      lines.push(`\n2. CLÁUSULAS RELEVANTES`);
      result.relevant_clauses.forEach((c) => {
        lines.push(`- [${c.relevance.toUpperCase()}] ${c.topic} (${c.page_reference || 'Pág. não indicada'}): ${c.summary}`);
      });
      lines.push(`\n3. PONTOS DE ATENÇÃO`);
      result.points_of_attention.forEach((p) => {
        lines.push(`- [${p.type.toUpperCase()}] ${p.description} (${p.page_reference || 'Ref. geral'}) -> Recomendação: ${p.recommendation}`);
      });
      lines.push(`\n4. CHECKLIST PRELIMINAR`);
      result.preliminary_checklist.forEach((item) => {
        lines.push(`- [${item.status.toUpperCase()}] ${item.item}: ${item.details}`);
      });
      lines.push(`\n${result.analysis_limitations.legal_disclaimer}`);

      navigator.clipboard.writeText(lines.join('\n'));
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2500);
    } catch {
      setFeedbackMessage('Não foi possível copiar o texto para a área de transferência.');
    }
  };

  // Manipulador para abrir detalhe do condomínio via query param
  const handleOpenCondo = (condoId: string) => {
    setActiveRightTab('ia');
    setActiveStageId('convencao');
    setIsPlusMenuOpen(false);
    onNavigate(`/app/auditoria?condoId=${condoId}`);
  };

  // Voltar para a listagem de clientes
  const handleBackToList = () => {
    onNavigate('/app/auditoria');
  };

  // Determinar o status da etapa documental (pendente, com_documento, vinculada_vazia ou nao_verificada)
  const getStageStatus = (stageId: string): 'pendente' | 'com_documento' | 'vinculada_vazia' | 'nao_verificada' => {
    if (isLoadingDocuments && (!linkedDocuments || Object.keys(linkedDocuments).length === 0)) {
      return 'nao_verificada';
    }
    const docs = linkedDocuments[stageId] || [];
    const folder = folderLinks[stageId];
    if (docs.length > 0) {
      return 'com_documento';
    }
    if (folder) {
      return 'vinculada_vazia';
    }
    return 'pendente';
  };

  // Envio de mensagem para o assistente de IA no painel direito
  const handleSendChatMessage = async () => {
    const text = chatInput.trim();
    if (!text || isSendingChatMessage || !selectedCondo) return;

    const currentStageCategory = CANONICAL_CATEGORIES.find((c) => c.id === activeStageId);
    const stageName = currentStageCategory?.name || activeStageId;
    const stageDocs = linkedDocuments[activeStageId] || [];

    const userMsg = {
      id: `usr_${Date.now()}`,
      role: 'user' as const,
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setChatMessagesByStage((prev) => ({
      ...prev,
      [activeStageId]: [...(prev[activeStageId] || []), userMsg],
    }));
    setChatInput('');
    setIsSendingChatMessage(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const existingAnalysis = analysesMap[activeStageId]?.analysis;
      const contextSummary = existingAnalysis
        ? `Resumo da análise: ${existingAnalysis.executive_summary.summary}.`
        : '';

      const assignedAgent = getAssignedAgentForCategory(activeStageId);
      const agentOverride = assignedAgent ? {
        name: assignedAgent.name,
        role: assignedAgent.role,
        prompt: assignedAgent.prompt,
        modelId: assignedAgent.modelId,
        brainProfile: assignedAgent.brainProfile,
      } : undefined;

      const res = await fetch('/api/condo/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: [
            ...(chatMessagesByStage[activeStageId] || []).map((m) => ({
              role: m.role,
              content: m.content,
            })),
            { role: 'user', content: text },
          ],
          agent: agentOverride,
          client_context: {
            condoName: selectedCondo.name,
            stage: stageName,
            documentsCount: stageDocs.length,
            documentNames: stageDocs.map((d) => d.drive_file_name),
            analysisContext: contextSummary,
          },
        }),
      });

      const data = await res.json().catch(() => null);
      let replyContent = '';

      if (data && (data.reply || data.text || data.message)) {
        replyContent = data.reply || data.text || data.message;
      } else if (stageDocs.length === 0) {
        replyContent = `Para responder com precisão sobre **${stageName}**, por favor vincule a pasta correspondente no Google Drive. Assim poderei extrair dados diretamente dos PDFs originais.`;
      } else {
        replyContent = `Analisei os arquivos da etapa **${stageName}** do condomínio **${selectedCondo.name}**. Há ${stageDocs.length} documento(s) disponível(is). O que mais deseja saber ou auditar?`;
      }

      const assistantMsg = {
        id: `ast_${Date.now()}`,
        role: 'assistant' as const,
        content: replyContent,
        results: Array.isArray(data?.results) ? data.results : undefined,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setChatMessagesByStage((prev) => ({
        ...prev,
        [activeStageId]: [...(prev[activeStageId] || []), assistantMsg],
      }));
    } catch (err) {
      console.warn('[Auditoria Chat Error]', err);
      const fallbackMsg = {
        id: `ast_${Date.now()}`,
        role: 'assistant' as const,
        content: `Recebi sua solicitação sobre **${stageName}**. Os ${stageDocs.length} documento(s) desta fase estão registrados no acervo da auditoria.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatMessagesByStage((prev) => ({
        ...prev,
        [activeStageId]: [...(prev[activeStageId] || []), fallbackMsg],
      }));
    } finally {
      setIsSendingChatMessage(false);
    }
  };

  // Manipuladores de Ação para Memórias Personalizadas (Modo Manual e Modo IA)
  const handleSaveMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCondoId || !memoryFormLabel.trim()) return;

    if (memoryFormMode === 'manual') {
      if (!memoryFormManualValue.trim()) {
        setFeedbackMessage('Informe o valor para a memória manual.');
        return;
      }
    } else {
      if (!memoryFormSourceDriveFileId) {
        setFeedbackMessage('Selecione um documento PDF desta etapa.');
        return;
      }
      if (!memoryFormInstruction.trim()) {
        setFeedbackMessage('Informe a instrução de busca para a IA.');
        return;
      }
    }

    setIsSavingMemory(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      let sourceName: string | null = null;
      if (memoryFormMode === 'ai' && memoryFormSourceDriveFileId) {
        const stageDocs = linkedDocuments[activeStageId] || [];
        const foundDoc = stageDocs.find((d) => d.drive_file_id === memoryFormSourceDriveFileId);
        if (foundDoc) {
          sourceName = foundDoc.drive_file_name;
        }
      }

      if (editingMemory) {
        const res = await fetch(`/api/auditoria/condo/${currentCondoId}/memories/${editingMemory.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            label: memoryFormLabel.trim(),
            fill_mode: memoryFormMode,
            manual_value: memoryFormMode === 'manual' ? memoryFormManualValue.trim() : null,
            instruction: memoryFormMode === 'ai' ? memoryFormInstruction.trim() : null,
            source_drive_file_id: memoryFormMode === 'ai' ? (memoryFormSourceDriveFileId || null) : null,
            source_drive_file_name: memoryFormMode === 'ai' ? sourceName : null,
          }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          setMemoriesList((prev) =>
            prev.map((m) => (m.id === editingMemory.id ? data.memory : m))
          );
          setIsAddMemoryModalOpen(false);
          setEditingMemory(null);
          setFeedbackMessage(
            memoryFormMode === 'manual'
              ? 'Memória manual atualizada com sucesso!'
              : 'Configuração da memória atualizada!'
          );
        } else {
          setFeedbackMessage(data.error || 'Erro ao atualizar memória.');
        }
      } else {
        const res = await fetch(`/api/auditoria/condo/${currentCondoId}/memories`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            stage_id: activeStageId,
            category: activeStageId,
            label: memoryFormLabel.trim(),
            fill_mode: memoryFormMode,
            manual_value: memoryFormMode === 'manual' ? memoryFormManualValue.trim() : null,
            instruction: memoryFormMode === 'ai' ? memoryFormInstruction.trim() : null,
            source_drive_file_id: memoryFormMode === 'ai' ? (memoryFormSourceDriveFileId || null) : null,
            source_drive_file_name: memoryFormMode === 'ai' ? sourceName : null,
          }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          setMemoriesList((prev) => [data.memory, ...prev]);
          setIsAddMemoryModalOpen(false);
          setFeedbackMessage(
            memoryFormMode === 'manual'
              ? 'Memória manual salva com sucesso!'
              : 'Memória configurada! Clique em "Buscar com IA" quando desejar extrair os dados.'
          );
        } else {
          setFeedbackMessage(data.error || 'Erro ao criar memória.');
        }
      }
    } catch (err: any) {
      setFeedbackMessage(err.message || 'Erro ao salvar memória.');
    } finally {
      setIsSavingMemory(false);
    }
  };

  const handleDeleteMemory = async () => {
    if (!currentCondoId || !memoryToDelete) return;

    setIsDeletingMemory(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/auditoria/condo/${currentCondoId}/memories/${memoryToDelete.id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMemoriesList((prev) => prev.filter((m) => m.id !== memoryToDelete.id));
        setMemoryToDelete(null);
        setFeedbackMessage('Memória excluída com sucesso.');
      } else {
        setFeedbackMessage(data.error || 'Erro ao excluir memória.');
      }
    } catch (err: any) {
      setFeedbackMessage(err.message || 'Erro ao excluir memória.');
    } finally {
      setIsDeletingMemory(false);
    }
  };

  const handleExecuteMemory = async (memoryId: string) => {
    if (!currentCondoId) return;

    setExtractingMemoryId(memoryId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`/api/auditoria/condo/${currentCondoId}/memories/${memoryId}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      const data = await res.json();
      if (res.ok && data.ok && data.memory) {
        setMemoriesList((prev) =>
          prev.map((m) => (m.id === memoryId ? data.memory : m))
        );
        if (data.memory.status === 'result_available') {
          setFeedbackMessage(`Extração concluída para "${data.memory.label}"!`);
        } else if (data.memory.status === 'failed') {
          setFeedbackMessage(`Não foi possível extrair informação para "${data.memory.label}".`);
        }
      } else {
        setFeedbackMessage(data.error || 'Falha ao executar extração da memória.');
      }
    } catch (err: any) {
      setFeedbackMessage(err.message || 'Erro ao conectar ao serviço de IA.');
    } finally {
      setExtractingMemoryId(null);
    }
  };

  // Executar busca agrupada por documento para as memórias pendentes da etapa atual
  const handleBatchExecuteMemories = async () => {
    if (!currentCondoId || isBatchExecutingMemories) return;

    setIsBatchExecutingMemories(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`/api/auditoria/condo/${currentCondoId}/memories/batch-execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          category: activeStageId,
        }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        if (Array.isArray(data.updated_memories) && data.updated_memories.length > 0) {
          const updatedMap = new Map(data.updated_memories.map((m: AuditoriaMemory) => [m.id, m]));
          setMemoriesList((prev) =>
            prev.map((m) => (updatedMap.has(m.id) ? (updatedMap.get(m.id) as AuditoriaMemory) : m))
          );
        }
        setFeedbackMessage(data.message || `Busca agrupada concluída com sucesso (${data.processed_count || 0} memórias processadas).`);
      } else {
        setFeedbackMessage(data.error || 'Falha ao processar busca agrupada.');
      }
    } catch (err: any) {
      setFeedbackMessage(err.message || 'Erro ao conectar ao serviço de busca agrupada.');
    } finally {
      setIsBatchExecutingMemories(false);
    }
  };

  const selectedDriveFile = driveFiles.find((f) => f.id === selectedFileId);

  // Controle de permissão de acesso ao módulo de Auditoria
  if (!canAccessAuditoria && !isAdmin) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 py-16 max-w-2xl mx-auto text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-white">Acesso Restrito ao Módulo de Auditoria</h2>
        <p className="text-xs text-slate-400 leading-relaxed max-w-md mx-auto">
          Seu usuário não possui a permissão <strong className="text-slate-200">can_access_auditoria</strong>. Entre em contato com um Administrador do Triverus CRM para liberar seu acesso.
        </p>
        <button
          type="button"
          onClick={onBackToPipeline}
          className="px-4 py-2 bg-[#FF6600] hover:bg-[#e65c00] text-white rounded-xl text-xs font-bold cursor-pointer transition-colors"
        >
          Voltar para o Pipeline
        </button>
      </div>
    );
  }

  /* =========================================================================
     TELA DE DETALHE DO CONDOMÍNIO (condoId presente na URL)
     ========================================================================= */
  if (currentCondoId) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200 dark bg-[#141418] text-slate-100">
        {/* Notificação Discreta de Feedback */}
        {feedbackMessage && (
          <div className="fixed bottom-6 right-6 z-60 flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 text-xs shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200">
            <span className="w-2 h-2 rounded-full bg-[#FF6600] shrink-0" />
            <span className="font-medium">{feedbackMessage}</span>
            <button
              type="button"
              onClick={() => setFeedbackMessage(null)}
              className="text-slate-400 hover:text-white ml-2 text-sm leading-none cursor-pointer p-0.5"
              aria-label="Fechar mensagem"
            >
              ✕
            </button>
          </div>
        )}

        {selectedCondo ? (
          <AuditoriaPopup
            selectedCondo={selectedCondo}
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
            onClose={handleBackToList}
            activeStageId={activeStageId}
            onSelectStage={(id) => {
              setActiveStageId(id);
              setActiveRightTab('ia');
              setIsPlusMenuOpen(false);
            }}
            activeRightTab={activeRightTab}
            onSelectRightTab={setActiveRightTab}
            linkedDocuments={linkedDocuments}
            folderLinks={folderLinks}
            analysesMap={analysesMap}
            isLoadingDocuments={isLoadingDocuments}
            syncingCategory={syncingCategory}
            isStreamingFile={isStreamingFile}
            canManage={canManageAuditoria || isAdmin}
            onOpenLinkFolderModal={handleOpenLinkFolderModal}
            onOpenVincularModal={handleOpenVincularModal}
            onOpenUnlinkFolderModal={handleRequestUnlinkFolder}
            onRequestUnlinkDoc={handleRequestUnlink}
            onViewPdf={handleViewPdf}
            onSyncFolder={handleSyncFolder}
            onOpenAnalysis={handleOpenAnalysis}
            chatMessagesByStage={chatMessagesByStage}
            chatInput={chatInput}
            onChatInputChange={setChatInput}
            onSendChatMessage={handleSendChatMessage}
            isSendingChatMessage={isSendingChatMessage}
            isPlusMenuOpen={isPlusMenuOpen}
            onTogglePlusMenu={() => setIsPlusMenuOpen(!isPlusMenuOpen)}
            onOpenAgentModal={() => {
              setIsPlusMenuOpen(false);
              setIsAgentModalOpen(true);
            }}
            assignedAgent={getAssignedAgentForCategory(activeStageId)}
            memoriesList={memoriesList}
            isLoadingMemories={isLoadingMemories}
            extractingMemoryId={extractingMemoryId}
            isBatchExecutingMemories={isBatchExecutingMemories}
            onBatchExecuteMemories={handleBatchExecuteMemories}
            onOpenAddMemoryModal={() => {
              setEditingMemory(null);
              setMemoryFormMode('manual');
              setMemoryFormLabel('');
              setMemoryFormManualValue('');
              setMemoryFormInstruction('');
              const activePdfs = linkedDocuments[activeStageId] || [];
              setMemoryFormSourceDriveFileId(activePdfs[0]?.drive_file_id || '');
              setIsAddMemoryModalOpen(true);
            }}
            onOpenEditMemoryModal={(mem) => {
              setEditingMemory(mem);
              setMemoryFormMode(mem.fill_mode || (mem.instruction ? 'ai' : 'manual'));
              setMemoryFormLabel(mem.label || '');
              setMemoryFormManualValue(mem.manual_value || '');
              setMemoryFormInstruction(mem.instruction || '');
              setMemoryFormSourceDriveFileId(mem.source_drive_file_id || '');
              setIsAddMemoryModalOpen(true);
            }}
            onOpenDeleteMemoryModal={(mem) => {
              setMemoryToDelete(mem);
            }}
            onExecuteMemory={handleExecuteMemory}
            onSetFeedbackMessage={setFeedbackMessage}
          />
        ) : (
          <div className="p-10 bg-[#070c18] border border-slate-800 rounded-2xl text-center space-y-3">
            <p className="text-sm text-slate-400">
              Condomínio não encontrado ou registro inexistente.
            </p>
            <button
              type="button"
              onClick={handleBackToList}
              className="px-4 py-2 bg-[#FF6600] hover:bg-[#e65c00] text-white rounded-xl text-xs font-bold cursor-pointer transition-colors"
            >
              Voltar para Auditoria
            </button>
          </div>
        )}

        {/* Modal de Escolher Agente Especialista */}
        {isAgentModalOpen && (
          <div className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="bg-[#0b1220] border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-5 animate-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#FF6600]/15 flex items-center justify-center text-[#FF6600]">
                    <OwlIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Escolher Agente de IA</h3>
                    <p className="text-[11px] text-slate-400">Atribua um agente personalizado a esta etapa</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAgentModalOpen(false)}
                  className="text-slate-400 hover:text-white text-xs cursor-pointer p-1"
                >
                  ✕
                </button>
              </div>

              {(() => {
                const currentAssigned = getAssignedAgentForCategory(activeStageId);
                if (savedAgents.length === 0) {
                  return (
                    <div className="py-6 text-center space-y-3">
                      <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
                        <SparklesIcon className="w-6 h-6" />
                      </div>
                      <p className="text-xs text-slate-300 font-semibold">
                        Nenhum agente personalizado criado ainda.
                      </p>
                      <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                        Crie agentes no Construtor de Agentes para vinculá-los às etapas de auditoria.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAgentModalOpen(false);
                          onNavigate('/app/auditoria?builder=true');
                        }}
                        className="px-4 py-2 bg-[#FF6600] hover:bg-[#e65c00] text-white rounded-xl text-xs font-bold cursor-pointer transition-colors shadow-md"
                      >
                        Abrir Construtor de Agentes
                      </button>
                    </div>
                  );
                }

                return (
                  <div className="space-y-3">
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {savedAgents.map((agent) => {
                        const isAssigned = currentAssigned?.id === agent.id;
                        return (
                          <button
                            key={agent.id}
                            type="button"
                            onClick={() => {
                              const catLabel = CANONICAL_CATEGORIES.find((c) => c.id === activeStageId)?.name || activeStageId;
                              assignAgentToAuditoriaCategory(agent.id, activeStageId, catLabel);
                              setIsAgentModalOpen(false);
                              setFeedbackMessage(`Agente "${agent.name}" atribuído à etapa de auditoria.`);
                            }}
                            className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer flex items-center gap-3 ${
                              isAssigned
                                ? 'bg-[#FF6600]/10 border-[#FF6600] text-white'
                                : 'bg-slate-900/60 border-slate-800/90 text-slate-300 hover:bg-slate-800/80 hover:border-slate-700'
                            }`}
                          >
                            <AgentAvatar
                              src={agent.avatarUrl}
                              alt={agent.name}
                              size="custom"
                              className="w-9 h-9 border border-[#FF6600]/40 shrink-0"
                              imgClassName="w-full h-full object-cover"
                              theme="dark"
                              fallbackText="AI"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-xs font-bold text-white truncate">{agent.name}</span>
                                {isAssigned && (
                                  <span className="text-[10px] uppercase font-bold text-[#FF6600] shrink-0">Atribuído</span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-400 truncate">{agent.role || 'Agente de IA'}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {currentAssigned && (
                      <div className="pt-2 border-t border-slate-800">
                        <button
                          type="button"
                          onClick={() => {
                            removeAgentFromAuditoriaCategory(activeStageId);
                            setIsAgentModalOpen(false);
                            setFeedbackMessage('Agente desvinculado da etapa.');
                          }}
                          className="w-full py-2 bg-slate-800 hover:bg-rose-950/40 hover:text-rose-300 hover:border-rose-800/50 border border-transparent text-slate-400 text-xs font-semibold rounded-xl cursor-pointer transition-colors"
                        >
                          Desvincular Agente desta Etapa
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setIsAgentModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl cursor-pointer transition-colors"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de Adicionar / Editar Memória (Fase 2 / Evolução de Memórias) */}
        {isAddMemoryModalOpen && (
          <div className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="bg-[#0b1220] border border-slate-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center text-emerald-400">
                    <BookmarkIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      {editingMemory ? 'Editar Memória' : 'Adicionar Nova Memória'}
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      {memoryFormMode === 'manual'
                        ? 'Informe manualmente o valor para este campo sem consultar a IA'
                        : 'Defina a instrução e o documento para consulta sob demanda pela IA'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAddMemoryModalOpen(false)}
                  className="text-slate-400 hover:text-white text-xs cursor-pointer p-1"
                >
                  ✕
                </button>
              </div>

              {/* Seletor de Modo: Modo Manual vs Buscar com IA */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-900 border border-slate-800 rounded-xl">
                <button
                  type="button"
                  onClick={() => setMemoryFormMode('manual')}
                  className={`py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                    memoryFormMode === 'manual'
                      ? 'bg-sky-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  <span>Modo Manual</span>
                </button>

                <button
                  type="button"
                  onClick={() => setMemoryFormMode('ai')}
                  className={`py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                    memoryFormMode === 'ai'
                      ? 'bg-gradient-to-r from-amber-500 to-[#FF6600] text-white shadow-md shadow-orange-500/20'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <SparklesIcon className="w-3.5 h-3.5" />
                  <span>Buscar com IA</span>
                </button>
              </div>

              <form onSubmit={handleSaveMemory} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Nome da Informação / Campo *
                  </label>
                  <input
                    type="text"
                    required
                    value={memoryFormLabel}
                    onChange={(e) => setMemoryFormLabel(e.target.value)}
                    placeholder="Ex: Condôminos, Quantidade de unidades, Fundo de reserva, Síndico..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700/80 text-white placeholder-slate-500 text-xs focus:outline-hidden focus:border-[#FF6600]"
                  />
                </div>

                {/* Campos do Modo Manual */}
                {memoryFormMode === 'manual' ? (
                  <div className="space-y-4 animate-in fade-in duration-150">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                        Valor da Informação *
                      </label>
                      <textarea
                        rows={3}
                        required
                        value={memoryFormManualValue}
                        onChange={(e) => setMemoryFormManualValue(e.target.value)}
                        placeholder="Informe diretamente o valor (ex: 53, R$ 12.500,00, Síndico: Carlos Silva...)"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700/80 text-white placeholder-slate-500 text-xs focus:outline-hidden focus:border-sky-500 resize-none leading-relaxed"
                      />
                    </div>
                    <div className="p-3 bg-sky-950/30 border border-sky-800/40 rounded-xl text-[11px] text-sky-300 leading-relaxed">
                      💡 <strong>Modo Manual:</strong> O valor será gravado diretamente, sem consumir tokens nem acionar a IA. Você poderá editar ou remover o valor a qualquer momento.
                    </div>
                  </div>
                ) : (
                  /* Campos do Modo Buscar com IA */
                  <div className="space-y-4 animate-in fade-in duration-150">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                        Documento PDF de Origem (Nesta etapa) *
                      </label>
                      {(() => {
                        const activePdfs = linkedDocuments[activeStageId] || [];
                        return (
                          <div className="space-y-1.5">
                            <select
                              value={memoryFormSourceDriveFileId}
                              onChange={(e) => setMemoryFormSourceDriveFileId(e.target.value)}
                              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700/80 text-white text-xs focus:outline-hidden focus:border-[#FF6600]"
                            >
                              <option value="">Selecione um PDF desta etapa...</option>
                              {activePdfs.map((pdf) => (
                                <option key={pdf.drive_file_id} value={pdf.drive_file_id}>
                                  {pdf.drive_file_name}
                                </option>
                              ))}
                            </select>
                            {activePdfs.length === 0 && (
                              <p className="text-[10px] text-amber-400/90">
                                Nenhum PDF vinculado a esta etapa ainda. Vincule a pasta da etapa no Google Drive para selecionar o documento.
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                        Instrução de Busca para a IA *
                      </label>
                      <textarea
                        rows={3}
                        required
                        value={memoryFormInstruction}
                        onChange={(e) => setMemoryFormInstruction(e.target.value)}
                        placeholder="Ex: Identifique a quantidade de condôminos mencionada neste documento. Se houver mais de um número, indique o mais recente..."
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700/80 text-white placeholder-slate-500 text-xs focus:outline-hidden focus:border-[#FF6600] resize-none leading-relaxed"
                      />
                    </div>
                    <div className="p-3 bg-amber-950/20 border border-amber-800/40 rounded-xl text-[11px] text-amber-300/90 leading-relaxed">
                      ⚡ <strong>Busca com IA:</strong> Salvar apenas configura o campo (status inicial: <em>Nunca pesquisada</em>). A IA só será executada quando você clicar em "Buscar com IA" ou "Buscar memórias pendentes".
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsAddMemoryModalOpen(false)}
                    disabled={isSavingMemory}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl cursor-pointer transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={
                      isSavingMemory ||
                      !memoryFormLabel.trim() ||
                      (memoryFormMode === 'manual'
                        ? !memoryFormManualValue.trim()
                        : !memoryFormInstruction.trim())
                    }
                    className="px-4 py-2 bg-[#FF6600] hover:bg-[#e65c00] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl cursor-pointer transition-colors shadow-md flex items-center gap-2"
                  >
                    {isSavingMemory ? (
                      <>
                        <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Salvando...</span>
                      </>
                    ) : (
                      <span>{editingMemory ? 'Atualizar Memória' : 'Salvar Memória'}</span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal de Confirmar Exclusão de Memória (Fase 2) */}
        {memoryToDelete && (
          <div className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="bg-[#0b1220] border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center shrink-0 mt-0.5">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-white">Excluir Memória</h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Tem certeza de que deseja excluir a memória <strong className="text-slate-200">"{memoryToDelete.label}"</strong>?
                  </p>
                </div>
              </div>

              <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1 text-xs">
                <span className="font-semibold text-slate-300 block">{memoryToDelete.label}</span>
                <p className="text-[11px] text-slate-400 leading-relaxed">{memoryToDelete.instruction}</p>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setMemoryToDelete(null)}
                  disabled={isDeletingMemory}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleDeleteMemory}
                  disabled={isDeletingMemory}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl cursor-pointer transition-colors shadow-md flex items-center gap-2"
                >
                  {isDeletingMemory ? (
                    <>
                      <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Excluindo...</span>
                    </>
                  ) : (
                    <span>Excluir Memória</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
           MODAL DE SELEÇÃO DE ARQUIVO PDF DO GOOGLE DRIVE
           ========================================================================= */}
        {isModalOpen && selectedCondo && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
              {/* Topo do Modal */}
              <div className="p-5 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white tracking-tight">
                    Vincular {CANONICAL_CATEGORIES.find((c) => c.id === activeModalCategory)?.name || 'Documento'}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Condomínio: <span className="text-slate-200 font-semibold">{selectedCondo.name}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="w-8 h-8 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center cursor-pointer transition-colors"
                  aria-label="Fechar modal"
                >
                  ✕
                </button>
              </div>

              {/* Corpo do Modal */}
              <div className="p-5 overflow-y-auto space-y-4 flex-1">
                {/* 1. Estado de Carregamento dos Arquivos com Shimmer */}
                {isLoadingDriveFiles && (
                  <div className="space-y-2.5 animate-in fade-in duration-150" aria-busy="true">
                    <div className="flex items-center justify-between pb-1 px-1">
                      <span className="text-xs text-slate-400 font-medium">Buscando arquivos no Google Drive...</span>
                      <span className="w-2.5 h-2.5 rounded-full border-2 border-[#FF6600] border-t-transparent animate-spin" />
                    </div>
                    {Array.from({ length: 4 }).map((_, idx) => (
                      <SkeletonDriveFile key={idx} theme="dark" />
                    ))}
                  </div>
                )}

                {/* 2. Estado de Erro de Conexão ou API */}
                {!isLoadingDriveFiles && driveFilesError && (
                  <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs space-y-3">
                    <div className="flex items-center gap-2 font-semibold">
                      <svg className="w-4 h-4 text-rose-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span>Falha ao consultar Google Drive</span>
                    </div>
                    <p className="leading-relaxed text-slate-300">{driveFilesError}</p>
                    <button
                      type="button"
                      onClick={() => fetchDriveFiles(selectedCondo.id, selectedCondo.name)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                    >
                      Tentar novamente
                    </button>
                  </div>
                )}

                {/* 3. Pasta não localizada no Google Drive central */}
                {!isLoadingDriveFiles && !driveFilesError && !driveFolderFound && (
                  <div className="p-5 rounded-2xl bg-slate-800/60 border border-slate-700/80 space-y-3 text-left">
                    <div className="w-10 h-10 rounded-xl bg-orange-500/15 border border-orange-500/30 text-[#FF6600] flex items-center justify-center">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                    </div>

                    <div>
                      <h4 className="text-sm font-bold text-white">
                        Pasta do condomínio não encontrada no Drive
                      </h4>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                        Não encontramos uma subpasta para este condomínio dentro da pasta raiz{' '}
                        <strong className="text-white">Triverus - Documentos dos Condomínios</strong>.
                      </p>
                    </div>

                    <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-xl space-y-1.5 text-xs text-slate-400">
                      <span className="font-semibold text-slate-200 block">Passos para criação:</span>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>Acesse o Google Drive na conta central (<span className="text-slate-300">plataformatriverus@gmail.com</span>).</li>
                        <li>Abra a pasta raiz <strong className="text-slate-300">Triverus - Documentos dos Condomínios</strong>.</li>
                        <li>
                          Crie uma subpasta com o nome do condomínio: <strong className="text-[#FF6600]">"{selectedCondo.name}"</strong>.
                        </li>
                        <li>Faça o upload do arquivo PDF da Convenção nessa subpasta.</li>
                      </ol>
                    </div>

                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => fetchDriveFiles(selectedCondo.id, selectedCondo.name)}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white rounded-xl text-xs font-semibold cursor-pointer transition-colors inline-flex items-center gap-1.5"
                      >
                        <svg className="w-3.5 h-3.5 text-[#FF6600]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <span>Verificar novamente no Drive</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* 4. Pasta encontrada, mas sem arquivos PDF */}
                {!isLoadingDriveFiles && !driveFilesError && driveFolderFound && driveFiles.length === 0 && (
                  <div className="p-6 rounded-2xl bg-slate-800/40 border border-slate-800 text-center space-y-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <h4 className="text-sm font-bold text-white">Nenhum arquivo PDF encontrado</h4>
                    <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                      A pasta <strong className="text-slate-200">"{driveFolderName}"</strong> foi localizada no Google Drive, mas não contém nenhum documento PDF. Adicione o arquivo da Convenção nessa pasta e atualize.
                    </p>
                    <button
                      type="button"
                      onClick={() => fetchDriveFiles(selectedCondo.id, selectedCondo.name)}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold cursor-pointer transition-colors inline-flex items-center gap-1.5"
                    >
                      <svg className="w-3.5 h-3.5 text-[#FF6600]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span>Atualizar lista de arquivos</span>
                    </button>
                  </div>
                )}

                {/* 5. Lista de Arquivos PDF Disponíveis para Seleção */}
                {!isLoadingDriveFiles && !driveFilesError && driveFolderFound && driveFiles.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-300">
                        Selecione o arquivo na pasta "{driveFolderName}":
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {driveFiles.length} {driveFiles.length === 1 ? 'arquivo PDF' : 'arquivos PDF'}
                      </span>
                    </div>

                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {driveFiles.map((file) => {
                        const isSelected = selectedFileId === file.id;
                        return (
                          <div
                            key={file.id}
                            onClick={() => setSelectedFileId(file.id)}
                            className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                              isSelected
                                ? 'border-[#FF6600] bg-orange-500/10 shadow-xs'
                                : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                                  isSelected
                                    ? 'border-[#FF6600] bg-[#FF6600]'
                                    : 'border-slate-600 bg-transparent'
                                }`}
                              >
                                {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                              </div>

                              <div className="min-w-0">
                                <p
                                  className={`text-xs font-semibold truncate ${
                                    isSelected ? 'text-white' : 'text-slate-200'
                                  }`}
                                  title={file.name}
                                >
                                  {file.name}
                                </p>
                                <p className="text-[11px] text-slate-400 mt-0.5">
                                  {formatBytes(file.size)}
                                  {file.modifiedTime && ` · Modificado em ${formatDate(file.modifiedTime)}`}
                                </p>
                              </div>
                            </div>

                            <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-slate-800 text-slate-400 border border-slate-700 shrink-0">
                              PDF
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Resumo do Arquivo Selecionado */}
                    {selectedDriveFile && (
                      <div className="p-3 bg-slate-800/60 border border-slate-700 rounded-xl space-y-1 animate-in fade-in duration-100">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#FF6600] block">
                          Arquivo selecionado para vínculo:
                        </span>
                        <p className="text-xs font-semibold text-white truncate">
                          {selectedDriveFile.name}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {formatBytes(selectedDriveFile.size)}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Exibição de erro ao salvar vínculo */}
                {saveLinkError && (
                  <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
                    {saveLinkError}
                  </div>
                )}
              </div>

              {/* Rodapé do Modal */}
              <div className="p-4 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSavingLink}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-semibold cursor-pointer transition-colors"
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  onClick={handleConfirmLink}
                  disabled={!selectedFileId || isSavingLink}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-2 ${
                    !selectedFileId || isSavingLink
                      ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/60'
                      : 'bg-[#FF6600] hover:bg-[#e65c00] text-white cursor-pointer shadow-md'
                  }`}
                >
                  {isSavingLink ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Salvando vínculo...</span>
                    </>
                  ) : (
                    <span>Confirmar Vínculo</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
           MODAL DE CONFIRMAÇÃO PARA DESVINCULAR DOCUMENTO ESPECÍFICO
           ========================================================================= */}
        {isConfirmUnlinkOpen && selectedCondo && docToUnlink && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="modal-unlink-title"
              className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 p-6 space-y-5"
            >
              {/* Topo do Modal */}
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 id="modal-unlink-title" className="text-base font-bold text-white tracking-tight">
                    Desvincular documento de {resolveCanonicalCategory(docToUnlink.category)?.name || docToUnlink.category}?
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Condomínio: <span className="text-slate-200 font-semibold">{selectedCondo.name}</span>
                  </p>
                </div>
              </div>

              {/* Informações do Documento Vinculado */}
              <div className="p-3.5 rounded-xl bg-slate-800/80 border border-slate-700/80 space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Arquivo selecionado para desvincular
                </div>
                <div className="text-xs font-semibold text-white flex items-center gap-2 truncate">
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/20 text-red-400 border border-red-500/30 shrink-0">
                    PDF
                  </span>
                  <span className="truncate" title={docToUnlink.doc.drive_file_name}>
                    {docToUnlink.doc.drive_file_name}
                  </span>
                </div>
                {docToUnlink.doc.drive_file_size && (
                  <div className="text-[11px] text-slate-400">
                    {formatBytes(docToUnlink.doc.drive_file_size)}
                  </div>
                )}
              </div>

              {/* Garantia explícita sobre o Google Drive */}
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs flex items-start gap-2.5">
                <svg className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="space-y-0.5 leading-relaxed">
                  <span className="font-semibold block text-emerald-200">Arquivo original preservado no Google Drive</span>
                  <span className="text-[11px] text-emerald-300/90">
                    Esta ação remove apenas a vinculação deste documento no Triverus. O arquivo original permanecerá intacto e inalterado na pasta do Google Drive.
                  </span>
                </div>
              </div>

              {/* Banner de Erro com mensagem real caso ocorra falha */}
              {unlinkError && (
                <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2 animate-in fade-in duration-100">
                  <svg className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="leading-relaxed flex-1">{unlinkError}</span>
                </div>
              )}

              {/* Ações do Modal */}
              <div className="pt-2 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCancelUnlink}
                  disabled={isUnlinking}
                  className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleExecuteUnlink}
                  disabled={isUnlinking}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer transition-colors shadow-lg shadow-rose-900/30 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  {isUnlinking ? (
                    <>
                      <span className="inline-block animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
                      <span>Desvinculando...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      <span>Sim, desvincular documento</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        
        {/* =========================================================================
           MODAL NAVEGADOR DE PASTAS DO GOOGLE DRIVE POR FASE
           ========================================================================= */}
        {/* =========================================================================
           MODAL NAVEGADOR DE PASTAS DO GOOGLE DRIVE (DESIGN MINIMALISTA)
           ========================================================================= */}
        {isFolderModalOpen && selectedCondo && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-[#090e1c] border border-slate-800 rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
              {/* Topo do Modal */}
              <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-[#0a0f1e] shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-[#0f172a] border border-slate-800 flex items-center justify-center shrink-0">
                    <GoogleDriveLogoSvg className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm md:text-base font-bold text-white tracking-tight truncate">
                      Selecionar pasta no Google Drive
                    </h3>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">
                      Fase: <span className="text-[#FF6600] font-semibold">{CANONICAL_CATEGORIES.find((c) => c.id === activeFolderCategory)?.name || activeFolderCategory}</span>
                      <span className="text-slate-600 mx-1.5">·</span>
                      Condomínio: <span className="text-slate-200 font-semibold">{selectedCondo.name}</span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsFolderModalOpen(false)}
                  className="w-8 h-8 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center cursor-pointer transition-colors shrink-0 ml-2"
                  aria-label="Fechar modal"
                >
                  ✕
                </button>
              </div>

              {/* Barra de Pesquisa Larga */}
              <div className="px-5 py-3 border-b border-slate-800/80 bg-[#0a0f1e]/80 shrink-0">
                <div className="relative flex items-center">
                  <span className="absolute left-3.5 text-slate-500 pointer-events-none">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    value={folderSearchTerm}
                    onChange={(e) => handleFolderSearchChange(e.target.value)}
                    placeholder="Buscar pastas no Google Drive..."
                    className="w-full bg-[#0d1525] border border-slate-800 focus:border-[#FF6600]/80 focus:ring-1 focus:ring-[#FF6600]/40 rounded-xl pl-10 pr-9 py-2.5 text-xs text-white placeholder-slate-500 transition-all outline-none"
                  />
                  {folderSearchTerm && (
                    <button
                      type="button"
                      onClick={handleClearFolderSearch}
                      className="absolute right-3 text-slate-400 hover:text-white text-xs cursor-pointer p-0.5"
                      title="Limpar busca"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Breadcrumb de Navegação entre Pastas */}
              {folderBreadcrumb.length > 0 && !folderSearchTerm && (
                <div className="px-5 py-2.5 bg-[#070b16] border-b border-slate-800/70 flex items-center gap-1.5 overflow-x-auto text-xs text-slate-400 shrink-0">
                  {folderBreadcrumb.map((item, idx) => {
                    const isLast = idx === folderBreadcrumb.length - 1;
                    const displayName = item.name === 'Google Drive' ? 'Meu Drive' : item.name;
                    return (
                      <React.Fragment key={item.id}>
                        {idx > 0 && <span className="text-slate-600 select-none">›</span>}
                        <button
                          type="button"
                          onClick={() => {
                            setFolderSearchTerm('');
                            fetchAvailableFolders(selectedCondo.id, item.id);
                          }}
                          disabled={isLoadingAvailableFolders}
                          className={`hover:text-white transition-colors cursor-pointer truncate max-w-[180px] ${
                            isLast ? 'text-white font-semibold' : 'text-slate-400'
                          }`}
                          title={displayName}
                        >
                          {displayName}
                        </button>
                      </React.Fragment>
                    );
                  })}
                </div>
              )}

              {/* Lista Minimalista de Pastas */}
              <div className="p-4 overflow-y-auto space-y-2 flex-1 min-h-[240px] max-h-[50vh]">
                {/* 1. Indicador de Carregamento com Skeleton Shimmer */}
                {isLoadingAvailableFolders && (
                  <div className="space-y-2 animate-in fade-in duration-150" aria-busy="true">
                    <div className="flex items-center justify-between pb-1 px-1">
                      <span className="text-xs text-slate-400">
                        {folderSearchTerm ? 'Buscando pastas no Google Drive...' : 'Carregando pastas...'}
                      </span>
                      <span className="w-2.5 h-2.5 rounded-full border-2 border-[#FF6600] border-t-transparent animate-spin" />
                    </div>
                    {Array.from({ length: 3 }).map((_, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl border border-[#303034] bg-[#242428] flex items-center justify-between gap-3 skeleton-shimmer select-none"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <Skeleton variant="rounded" width={28} height={28} theme="dark" />
                          <Skeleton variant="text" width="65%" height={12} theme="dark" />
                        </div>
                        <Skeleton variant="rounded" width={60} height={22} theme="dark" />
                      </div>
                    ))}
                  </div>
                )}

                {/* 2. Mensagem de Erro */}
                {!isLoadingAvailableFolders && availableFoldersError && (
                  <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs space-y-2.5">
                    <p className="font-semibold">{availableFoldersError}</p>
                    <button
                      type="button"
                      onClick={() => fetchAvailableFolders(selectedCondo.id, navFolderId)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                    >
                      Tentar novamente
                    </button>
                  </div>
                )}

                {/* 3. Indicador de Busca com Resultados */}
                {!isLoadingAvailableFolders && !availableFoldersError && folderSearchTerm && (
                  <div className="pb-1 text-[11px] font-semibold text-slate-400 flex items-center justify-between">
                    <span>Resultados da busca ({availableFolders.length})</span>
                    <button
                      type="button"
                      onClick={handleClearFolderSearch}
                      className="text-[#FF6600] hover:underline cursor-pointer"
                    >
                      Voltar à navegação
                    </button>
                  </div>
                )}

                {/* 4. Linhas de Pastas */}
                {!isLoadingAvailableFolders && !availableFoldersError && availableFolders.length > 0 && (
                  <div className="space-y-1.5">
                    {availableFolders.map((folder) => (
                      <div
                        key={folder.id}
                        onClick={() => {
                          setFolderSearchTerm('');
                          fetchAvailableFolders(selectedCondo.id, folder.id);
                        }}
                        className="w-full px-4 py-3 bg-[#0d1525] hover:bg-[#111c30] border border-slate-800/80 hover:border-slate-700 rounded-xl flex items-center justify-between cursor-pointer group transition-all duration-150"
                        title={`Entrar na pasta "${folder.name}"`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-8 h-8 rounded-lg bg-orange-500/10 text-[#FF6600] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                            </svg>
                          </div>
                          <span className="text-xs md:text-sm font-medium text-slate-200 group-hover:text-white truncate">
                            {folder.name}
                          </span>
                        </div>

                        <div className="shrink-0 text-slate-500 group-hover:text-slate-300 pl-2">
                          <svg className="w-4 h-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 5. Estado Vazio */}
                {!isLoadingAvailableFolders && !availableFoldersError && availableFolders.length === 0 && (
                  <div className="py-12 px-4 text-center space-y-2">
                    <div className="w-10 h-10 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-center mx-auto text-slate-500 mb-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                    </div>
                    <p className="text-xs font-semibold text-slate-300">
                      {folderSearchTerm ? 'Nenhuma pasta encontrada com esse nome' : 'Esta pasta não contém subpastas'}
                    </p>
                    <p className="text-[11px] text-slate-500 max-w-sm mx-auto leading-relaxed">
                      {folderSearchTerm
                        ? 'Verifique o termo digitado ou navegue pelas pastas usando o caminho acima.'
                        : 'Você pode selecionar esta pasta diretamente clicando no botão abaixo.'}
                    </p>
                  </div>
                )}

                {/* Mensagem de Erro ao Vincular */}
                {linkingFolderError && (
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs">
                    {linkingFolderError}
                  </div>
                )}
              </div>

              {/* Rodapé Fixo com exatamente Cancelar e Selecionar pasta */}
              <div className="px-5 py-3.5 border-t border-slate-800 flex items-center justify-between gap-3 bg-[#0a0f1e] shrink-0">
                <div className="min-w-0 flex-1 pr-2">
                  {currentFolderMeta ? (
                    <div className="text-xs text-slate-300 truncate">
                      Pasta atual: <strong className="text-white font-semibold">{currentFolderMeta.name === 'Google Drive' ? 'Meu Drive' : currentFolderMeta.name}</strong>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 truncate">
                      Navegue até a pasta desejada
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsFolderModalOpen(false)}
                    disabled={isLinkingFolder}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 cursor-pointer transition-colors disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmLinkFolder}
                    disabled={isLinkingFolder || !currentFolderMeta || isLoadingAvailableFolders}
                    className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-[#FF6600] hover:bg-[#ff7711] active:scale-[0.99] cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-orange-500/25 flex items-center gap-2"
                  >
                    {isLinkingFolder ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Vinculando pasta...</span>
                      </>
                    ) : (
                      <span>Selecionar pasta</span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
           MODAL DE CONFIRMAÇÃO DE DESVINCULAÇÃO SELETIVA DE PASTA{/* =========================================================================
           MODAL DE CONFIRMAÇÃO DE DESVINCULAÇÃO SELETIVA DE PASTA
           ========================================================================= */}
        {isConfirmUnlinkFolderOpen && selectedCondo && folderToUnlink && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
              <div className="p-5 border-b border-slate-800 flex items-center justify-between">
                <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                  <svg className="w-5 h-5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>Desvincular Pasta</span>
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setIsConfirmUnlinkFolderOpen(false);
                    setFolderToUnlink(null);
                  }}
                  className="w-8 h-8 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center cursor-pointer transition-colors"
                  aria-label="Fechar"
                >
                  ✕
                </button>
              </div>

              <div className="p-5 space-y-4 text-xs leading-relaxed">
                <p className="text-slate-300">
                  Deseja desvincular a pasta <strong className="text-white">"{folderToUnlink.folder.drive_folder_name}"</strong> da fase <strong className="text-white">{CANONICAL_CATEGORIES.find((c) => c.id === folderToUnlink.category)?.name}</strong>?
                </p>

                <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/80 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Segurança dos arquivos:</span>
                  </div>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    Esta ação remove apenas os vínculos locais com os documentos desta pasta no CRM.
                    <strong className="text-white block mt-1">Os arquivos originais no seu Google Drive permanecerão 100% intactos.</strong>
                    Vínculos de outras fases também não são afetados.
                  </p>
                </div>

                {unlinkFolderError && (
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300">
                    {unlinkFolderError}
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-slate-800 flex items-center justify-end gap-2 bg-slate-900/50">
                <button
                  type="button"
                  onClick={() => {
                    setIsConfirmUnlinkFolderOpen(false);
                    setFolderToUnlink(null);
                  }}
                  disabled={isUnlinkingFolder}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmUnlinkFolder}
                  disabled={isUnlinkingFolder}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 cursor-pointer transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {isUnlinkingFolder ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Desvinculando...</span>
                    </>
                  ) : (
                    <span>Sim, desvincular pasta</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

{/* =========================================================================
           MODAL DE ANÁLISE INTELIGENTE DE DOCUMENTOS COM IA
           ========================================================================= */}
        {isAnalysisModalOpen && selectedCondo && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-150">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="modal-analysis-title"
              className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
            >
              {/* Header do Modal */}
              <div className="p-4 sm:p-5 border-b border-slate-800 flex items-start justify-between gap-4 bg-slate-900/95 shrink-0">
                <div className="min-w-0 flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-[#FF6600]/30 border border-amber-500/40 text-amber-400 flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 id="modal-analysis-title" className="text-base font-bold text-white tracking-tight">
                        Análise Inteligente: Convenção do Condomínio
                      </h3>
                      {analysesMap[activeAnalysisCategory]?.analysis?.document_identification && (
                        (() => {
                          const ident = analysesMap[activeAnalysisCategory].analysis.document_identification;
                          if (ident.compatibility_status === 'compatible') {
                            return (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                ✓ Convenção Reconhecida
                              </span>
                            );
                          } else if (ident.compatibility_status === 'incompatible') {
                            return (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                ⚠️ Incompatível com Convenção
                              </span>
                            );
                          }
                          return (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                              ⚠️ Classificação Incerta
                            </span>
                          );
                        })()
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">
                      Condomínio: <span className="text-slate-200 font-semibold">{selectedCondo.name}</span>
                      {analysesMap[activeAnalysisCategory]?.fileName && (
                        <span> · Arquivo: <span className="text-slate-300 font-mono">{analysesMap[activeAnalysisCategory].fileName}</span></span>
                      )}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsAnalysisModalOpen(false)}
                  className="w-8 h-8 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center cursor-pointer transition-colors shrink-0"
                  aria-label="Fechar análise"
                >
                  ✕
                </button>
              </div>

              {/* Corpo do Modal */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
                {/* 1. Estado de Carregamento / Execução com IA */}
                {isAnalyzingDoc && (
                  <div className="py-14 text-center space-y-4 max-w-md mx-auto">
                    <div className="relative inline-block">
                      <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400">
                        <span className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">
                        Analisando documento com IA...
                      </h4>
                      <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                        Recuperando o PDF original do Google Drive central, realizando leitura multimodal de cláusulas, quóruns e estruturando o checklist de conformidade.
                      </p>
                    </div>
                    <div className="p-3 bg-slate-800/60 border border-slate-700/60 rounded-xl text-[11px] text-slate-400 text-left space-y-1">
                      <div className="flex items-center gap-2 text-slate-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        <span>Arquivo obtido com segurança via Service Account</span>
                      </div>
                      <div className="flex items-center gap-2 text-amber-300 animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                        <span>Processando inteligência documental com Gemini 3.8 Flash</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-500">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                        <span>Estruturando pontos de atenção e checklist para o auditor</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. Estado de Erro na Análise */}
                {!isAnalyzingDoc && analysisError && (
                  <div className="p-4 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs space-y-3">
                    <div className="flex items-start gap-2.5">
                      <svg className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div className="space-y-1">
                        <span className="font-bold text-sm text-rose-200 block">Falha no processamento da análise com IA</span>
                        <p className="leading-relaxed">{analysisError}</p>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-rose-500/20 flex justify-end">
                      <button
                        type="button"
                        onClick={() => executeAnalysis(activeAnalysisCategory)}
                        className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-semibold text-xs transition-colors cursor-pointer"
                      >
                        Tentar novamente
                      </button>
                    </div>
                  </div>
                )}

                {/* 3. Conteúdo da Análise Carregada com Sucesso */}
                {!isAnalyzingDoc && !analysisError && analysesMap[activeAnalysisCategory]?.analysis && (() => {
                  const analysis = analysesMap[activeAnalysisCategory].analysis;
                  const isNotConvention = !analysis.document_identification.is_convention || analysis.document_identification.compatibility_status === 'incompatible';

                  return (
                    <div className="space-y-5">
                      {/* Alerta de Incompatibilidade de Tipo (quando o documento NÃO é uma convenção) */}
                      {isNotConvention && (
                        <div className="p-4 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs flex items-start gap-3 animate-in fade-in">
                          <svg className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <div className="space-y-1">
                            <span className="font-bold text-sm text-rose-100 block">
                              Atenção: Documento Incompatível com a Categoria Convenção
                            </span>
                            <p className="leading-relaxed">
                              O conteúdo do arquivo foi identificado pela IA como <strong>"{analysis.document_identification.detected_type}"</strong> e não corresponde a uma Convenção de Condomínio.
                            </p>
                            <p className="text-rose-300 text-[11px] mt-0.5">
                              {analysis.document_identification.compatibility_notes}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Abas de Navegação Interna */}
                      <div className="flex items-center gap-1.5 border-b border-slate-800 pb-2 overflow-x-auto text-xs font-semibold">
                        <button
                          type="button"
                          onClick={() => setActiveAnalysisTab('geral')}
                          className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                            activeAnalysisTab === 'geral'
                              ? 'bg-slate-800 text-white border border-slate-700'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                          }`}
                        >
                          Visão Geral
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveAnalysisTab('clausulas')}
                          className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 ${
                            activeAnalysisTab === 'clausulas'
                              ? 'bg-slate-800 text-white border border-slate-700'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                          }`}
                        >
                          <span>Cláusulas Relevantes</span>
                          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-700 text-slate-300">
                            {analysis.relevant_clauses.length}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveAnalysisTab('atencao')}
                          className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 ${
                            activeAnalysisTab === 'atencao'
                              ? 'bg-slate-800 text-white border border-slate-700'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                          }`}
                        >
                          <span>Pontos de Atenção</span>
                          <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                            analysis.points_of_attention.length > 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-700 text-slate-300'
                          }`}>
                            {analysis.points_of_attention.length}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveAnalysisTab('checklist')}
                          className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 ${
                            activeAnalysisTab === 'checklist'
                              ? 'bg-slate-800 text-white border border-slate-700'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                          }`}
                        >
                          <span>Checklist do Auditor</span>
                          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-700 text-slate-300">
                            {analysis.preliminary_checklist.length}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveAnalysisTab('limitacoes')}
                          className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                            activeAnalysisTab === 'limitacoes'
                              ? 'bg-slate-800 text-white border border-slate-700'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                          }`}
                        >
                          Limitações & Isenção
                        </button>
                      </div>

                      {/* CONTEÚDO DA ABA: VISÃO GERAL */}
                      {activeAnalysisTab === 'geral' && (
                        <div className="space-y-4 animate-in fade-in duration-100">
                          {/* Ficha de Identificação Documental */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            <div className="p-3.5 rounded-xl bg-slate-800/70 border border-slate-700/70 space-y-1">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                                Tipo Detectado
                              </span>
                              <span className="text-xs font-semibold text-white block">
                                {analysis.document_identification.detected_type}
                              </span>
                            </div>

                            <div className="p-3.5 rounded-xl bg-slate-800/70 border border-slate-700/70 space-y-1">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                                Título do Documento
                              </span>
                              <span className="text-xs font-semibold text-white block truncate" title={analysis.document_identification.title}>
                                {analysis.document_identification.title || 'Não especificado'}
                              </span>
                            </div>

                            <div className="p-3.5 rounded-xl bg-slate-800/70 border border-slate-700/70 space-y-1">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                                Total de Páginas Lidas
                              </span>
                              <span className="text-xs font-semibold text-white block">
                                {analysis.document_identification.total_pages_detected !== null
                                  ? `${analysis.document_identification.total_pages_detected} páginas`
                                  : 'Não identificado'}
                              </span>
                            </div>

                            <div className="p-3.5 rounded-xl bg-slate-800/70 border border-slate-700/70 space-y-1">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                                Condomínio no Texto
                              </span>
                              <span className="text-xs font-semibold text-slate-200 block truncate" title={analysis.document_identification.condominium_name_in_doc || ''}>
                                {analysis.document_identification.condominium_name_in_doc || 'Não citado explicitamente'}
                              </span>
                            </div>

                            <div className="p-3.5 rounded-xl bg-slate-800/70 border border-slate-700/70 space-y-1">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                                Data / Ano Identificado
                              </span>
                              <span className="text-xs font-semibold text-slate-200 block">
                                {analysis.document_identification.estimated_date || 'Não identificado'}
                              </span>
                            </div>

                            <div className="p-3.5 rounded-xl bg-slate-800/70 border border-slate-700/70 space-y-1">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                                Registro / Cartório de Imóveis
                              </span>
                              <span className="text-xs font-semibold text-slate-200 block truncate" title={analysis.document_identification.registry_info || ''}>
                                {analysis.document_identification.registry_info || 'Sem dados de registro'}
                              </span>
                            </div>
                          </div>

                          {/* Resumo Executivo */}
                          <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/70 space-y-3">
                            <div className="flex items-center gap-2">
                              <svg className="w-4 h-4 text-[#FF6600]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                                Resumo Executivo da Auditoria
                              </h4>
                            </div>

                            <div className="space-y-2 text-xs text-slate-300 leading-relaxed">
                              <div>
                                <span className="font-semibold text-slate-200">Finalidade Principal: </span>
                                <span>{analysis.executive_summary.main_purpose}</span>
                              </div>
                              <div>
                                <span className="font-semibold text-slate-200">Síntese dos Conteúdos: </span>
                                <span>{analysis.executive_summary.summary}</span>
                              </div>
                              {analysis.executive_summary.overall_structure && (
                                <div>
                                  <span className="font-semibold text-slate-200">Estrutura Geral: </span>
                                  <span>{analysis.executive_summary.overall_structure}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* CONTEÚDO DA ABA: CLÁUSULAS RELEVANTES */}
                      {activeAnalysisTab === 'clausulas' && (
                        <div className="space-y-3 animate-in fade-in duration-100">
                          {analysis.relevant_clauses.length === 0 ? (
                            <div className="p-8 text-center bg-slate-800/40 border border-slate-800 rounded-xl text-xs text-slate-400">
                              Nenhuma cláusula condominial identificada neste documento.
                            </div>
                          ) : (
                            analysis.relevant_clauses.map((clause, idx) => (
                              <div
                                key={idx}
                                className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/60 space-y-2"
                              >
                                <div className="flex items-start justify-between gap-3 flex-wrap">
                                  <div className="flex items-center gap-2">
                                    <h5 className="text-xs font-bold text-white">
                                      {clause.topic}
                                    </h5>
                                    {clause.page_reference && (
                                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-700/80 text-amber-300 border border-amber-500/20">
                                        {clause.page_reference}
                                      </span>
                                    )}
                                  </div>

                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                    clause.relevance === 'alta'
                                      ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                                      : clause.relevance === 'media'
                                      ? 'bg-blue-500/15 text-blue-300 border border-blue-500/30'
                                      : 'bg-slate-700/70 text-slate-300 border border-slate-600/50'
                                  }`}>
                                    Relevância {clause.relevance}
                                  </span>
                                </div>

                                <p className="text-xs text-slate-300 leading-relaxed">
                                  {clause.summary}
                                </p>

                                {clause.quoted_excerpt && (
                                  <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400 italic">
                                    "{clause.quoted_excerpt}"
                                  </div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      )}

                      {/* CONTEÚDO DA ABA: PONTOS DE ATENÇÃO */}
                      {activeAnalysisTab === 'atencao' && (
                        <div className="space-y-3 animate-in fade-in duration-100">
                          {analysis.points_of_attention.length === 0 ? (
                            <div className="p-8 text-center bg-slate-800/40 border border-slate-800 rounded-xl text-xs text-slate-400">
                              Nenhum ponto crítico de atenção ou conflito detectado.
                            </div>
                          ) : (
                            analysis.points_of_attention.map((point, idx) => (
                              <div
                                key={idx}
                                className="p-4 rounded-xl bg-slate-800/60 border border-amber-500/25 space-y-2.5"
                              >
                                <div className="flex items-start justify-between gap-3 flex-wrap">
                                  <div className="flex items-center gap-2">
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                      {point.type.replace('_', ' ')}
                                    </span>
                                    {point.page_reference && (
                                      <span className="text-[11px] font-mono text-slate-400">
                                        Ref: {point.page_reference}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <p className="text-xs text-slate-200 font-medium leading-relaxed">
                                  {point.description}
                                </p>

                                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-200 flex items-start gap-2">
                                  <span className="font-bold text-amber-300 shrink-0">Recomendação:</span>
                                  <span>{point.recommendation}</span>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}

                      {/* CONTEÚDO DA ABA: CHECKLIST DO AUDITOR */}
                      {activeAnalysisTab === 'checklist' && (
                        <div className="space-y-2.5 animate-in fade-in duration-100">
                          {analysis.preliminary_checklist.map((item, idx) => (
                            <div
                              key={idx}
                              className="p-3.5 rounded-xl bg-slate-800/50 border border-slate-700/60 flex items-start gap-3"
                            >
                              <div className="shrink-0 mt-0.5">
                                {item.status === 'confirmado_no_documento' ? (
                                  <div className="w-6 h-6 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                                    ✓
                                  </div>
                                ) : item.status === 'ausente_ou_nao_localizado' ? (
                                  <div className="w-6 h-6 rounded-lg bg-slate-700/50 border border-slate-600 text-slate-400 flex items-center justify-center">
                                    ✕
                                  </div>
                                ) : (
                                  <div className="w-6 h-6 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center">
                                    !
                                  </div>
                                )}
                              </div>

                              <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <span className="text-xs font-bold text-white">
                                    {item.item}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    {item.page_reference && (
                                      <span className="text-[10px] font-mono text-slate-400">
                                        {item.page_reference}
                                      </span>
                                    )}
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                      item.status === 'confirmado_no_documento'
                                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                        : item.status === 'ausente_ou_nao_localizado'
                                        ? 'bg-slate-700 text-slate-300 border border-slate-600'
                                        : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                    }`}>
                                      {item.status === 'confirmado_no_documento'
                                        ? 'Confirmado'
                                        : item.status === 'ausente_ou_nao_localizado'
                                        ? 'Ausente no texto'
                                        : 'Validação Humana'}
                                    </span>
                                  </div>
                                </div>
                                <p className="text-xs text-slate-300 leading-relaxed">
                                  {item.details}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* CONTEÚDO DA ABA: LIMITAÇÕES & ISENÇÃO */}
                      {activeAnalysisTab === 'limitacoes' && (
                        <div className="space-y-4 animate-in fade-in duration-100">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="p-3.5 rounded-xl bg-slate-800/70 border border-slate-700/70 space-y-1">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                                Qualidade da Leitura do PDF
                              </span>
                              <span className="text-xs font-semibold text-white capitalize block">
                                {analysis.analysis_limitations.reading_quality}
                              </span>
                            </div>

                            <div className="p-3.5 rounded-xl bg-slate-800/70 border border-slate-700/70 space-y-1">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                                Nível de Confiança da IA
                              </span>
                              <span className="text-xs font-semibold text-white capitalize block">
                                {analysis.analysis_limitations.confidence_level}
                              </span>
                            </div>
                          </div>

                          {analysis.analysis_limitations.unreadable_pages && (
                            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-200 text-xs">
                              <span className="font-semibold">Páginas de baixa legibilidade: </span>
                              <span>{analysis.analysis_limitations.unreadable_pages}</span>
                            </div>
                          )}

                          <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/70 space-y-2 text-xs text-slate-300 leading-relaxed">
                            <span className="font-bold text-white block">Notas sobre limitações técnicas:</span>
                            <p>{analysis.analysis_limitations.limitations_notes || 'Documento analisado sem restrições de OCR detectadas.'}</p>
                          </div>

                          {/* Aviso Legal Obrigatório */}
                          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 text-xs space-y-1.5">
                            <span className="font-bold text-slate-200 flex items-center gap-1.5">
                              <span>⚖️</span>
                              <span>Aviso Legal Obrigatório da Plataforma Triverus</span>
                            </span>
                            <p className="leading-relaxed text-[11px] text-slate-400">
                              {analysis.analysis_limitations.legal_disclaimer}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Rodapé do Modal com Ações */}
              <div className="p-4 border-t border-slate-800 bg-slate-900/95 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
                <div className="text-[11px] text-slate-500">
                  {analysesMap[activeAnalysisCategory]?.analyzedAt && (
                    <span>
                      Análise gerada em {formatDate(analysesMap[activeAnalysisCategory].analyzedAt)}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2.5">
                  {analysesMap[activeAnalysisCategory]?.analysis && (
                    <button
                      type="button"
                      onClick={() => handleCopyAnalysisSummary(analysesMap[activeAnalysisCategory].analysis)}
                      className="px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-semibold cursor-pointer transition-colors inline-flex items-center gap-1.5"
                    >
                      {copyFeedback ? (
                        <>
                          <span className="text-emerald-400">✓</span>
                          <span>Copiado!</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          <span>Copiar Resumo</span>
                        </>
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => executeAnalysis(activeAnalysisCategory)}
                    disabled={isAnalyzingDoc}
                    className="px-3 py-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 hover:text-white text-xs font-semibold cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Reanalisar</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsAnalysisModalOpen(false)}
                    className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold cursor-pointer transition-colors"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* =========================================================================
     TELA PRINCIPAL: LISTAGEM DE PASTAS DE CONDOMÍNIOS CLIENTES (MINI-DASHBOARDS)
     ========================================================================= */
  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-150 font-['Roboto',sans-serif]">
      {/* Barra Compacta de Busca, Ordenação e Contador */}
      <div className="pb-4 border-b border-[#242428] flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Esquerda: Busca por nome do condomínio */}
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por nome do condomínio..."
            className="w-full pl-10 pr-9 py-2.5 bg-[#242428] border border-[#303034] focus:border-[#FF6600] rounded-2xl text-white text-xs focus:outline-none placeholder-slate-400 transition-colors"
          />
          <svg
            className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-2.5 text-slate-400 hover:text-white p-0.5 rounded text-xs cursor-pointer"
            >
              ×
            </button>
          )}
        </div>

        {/* Direita: Select de Ordenação Persistente e Contador */}
        <div className="flex items-center gap-3 justify-between md:justify-end">
          <div className="relative">
            <select
              value={sortOption}
              onChange={(e) => handleSortChange(e.target.value as any)}
              className="appearance-none bg-[#242428] border border-[#303034] focus:border-[#FF6600] text-slate-200 text-xs rounded-2xl py-2.5 pl-4 pr-9 focus:outline-none cursor-pointer font-medium"
            >
              <option value="progresso_desc">Maior progresso primeiro</option>
              <option value="progresso_asc">Menor progresso primeiro</option>
              <option value="nome_asc">Nome A–Z</option>
            </select>
            <svg className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-3 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>

          <span className="text-xs text-slate-200 font-medium px-4 py-2.5 bg-[#242428] rounded-2xl border border-[#303034] shrink-0">
            {processedClients.length} {processedClients.length === 1 ? 'condomínio' : 'condomínios'}
          </span>
        </div>
      </div>

      {/* SKELETON LOADING COM EFEITO SHIMMER (Quando carregando pastas de condomínios) */}
      {(isInitialLoading || (isRefreshing && leads.length === 0)) && clientLeads.length === 0 ? (
        <SkeletonPastasGrid theme="dark" />
      ) : crmError && clientLeads.length === 0 ? (
        /* Erro ao carregar condomínios com botão de nova tentativa */
        <div className="p-12 text-center bg-[#242428] border border-rose-900/40 rounded-3xl space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-rose-950/60 border border-rose-700/50 text-rose-400 flex items-center justify-center mx-auto">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="text-base font-bold text-white">Falha ao carregar condomínios</h3>
          <p className="text-xs text-rose-300/80 max-w-md mx-auto leading-relaxed">
            {crmError}
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => refreshAll(false, true)}
              className="px-4 py-2 bg-[#FF6600] hover:bg-[#e65c00] text-white rounded-xl text-xs font-semibold cursor-pointer transition-colors shadow-xs"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      ) : clientLeads.length === 0 ? (
        /* Estado Vazio: Nenhum cliente no CRM ainda */
        <div className="p-12 text-center bg-[#242428] border border-[#303034] rounded-3xl space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-[#303034] border border-[#3a3a40] text-slate-400 flex items-center justify-center mx-auto">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h3 className="text-base font-bold text-white">Nenhum condomínio cliente registrado</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            Quando uma oportunidade alcançar a etapa <strong className="text-emerald-400">Cliente</strong> no Pipeline comercial, o condomínio aparecerá automaticamente nesta área para auditoria.
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={onBackToPipeline}
              className="px-4 py-2 bg-[#303034] hover:bg-[#3a3a40] text-slate-200 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
            >
              Ir para o Pipeline
            </button>
          </div>
        </div>
      ) : processedClients.length === 0 ? (
        /* Estado Vazio: Busca sem resultados */
        <div className="p-10 text-center bg-[#242428] border border-[#303034] rounded-3xl space-y-2">
          <p className="text-sm text-slate-200 font-semibold">
            Nenhum condomínio encontrado para "{searchTerm}"
          </p>
          <p className="text-xs text-slate-400">
            Tente buscar por outro nome de condomínio.
          </p>
          <button
            type="button"
            onClick={() => setSearchTerm('')}
            className="mt-2 text-xs text-[#FF6600] hover:underline cursor-pointer font-semibold"
          >
            Limpar busca
          </button>
        </div>
      ) : (
        /* Grade de Cards em formato de Pastas Físicas (3 por linha no desktop, 2 no tablet, 1 no mobile) */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {processedClients.map((lead: Lead) => {
            const completedCategories = condoSummaryMap[lead.id] || [];
            const completedSet = new Set(completedCategories);
            const completedCount = completedSet.size;
            const { percentage, color } = getAuditoriaProgress(completedCount);
            const filterId = `neon-glow-${lead.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;

            return (
              <div
                key={lead.id}
                tabIndex={0}
                role="button"
                onClick={() => handleOpenCondo(lead.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleOpenCondo(lead.id);
                  }
                }}
                className="relative group cursor-pointer transition-all duration-200 hover:-translate-y-0.5 rounded-2xl min-h-[235px] flex flex-col justify-between focus-visible:ring-2 focus-visible:ring-[#FF6600]/50 outline-none"
              >
                {/* SVG Folder Silhouette com aba superior na esquerda */}
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none drop-shadow-sm"
                  viewBox="0 0 380 230"
                  fill="none"
                  preserveAspectRatio="none"
                >
                  <defs>
                    <radialGradient id={`tab-glow-${lead.id}`} cx="20%" cy="10%" r="45%">
                      <stop offset="0%" stopColor="#f97316" stopOpacity="0.32" />
                      <stop offset="50%" stopColor="#ea580c" stopOpacity="0.10" />
                      <stop offset="100%" stopColor="#ea580c" stopOpacity="0" />
                    </radialGradient>
                    <linearGradient id={`folder-stroke-${lead.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#484852" />
                      <stop offset="50%" stopColor="#303036" />
                      <stop offset="100%" stopColor="#25252a" />
                    </linearGradient>
                  </defs>

                  {/* Silhueta da Pasta: Aba no topo esquerdo com descida suave */}
                  <path
                    d="M 0 30 C 0 14, 12 0, 28 0 L 130 0 C 148 0, 160 16, 180 16 L 352 16 C 368 16, 380 28, 380 44 L 380 208 C 380 220, 368 230, 352 230 L 28 230 C 12 230, 0 220, 0 208 Z"
                    fill="#242428"
                    stroke={`url(#folder-stroke-${lead.id})`}
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                    className="group-hover:stroke-[#4a4a56] group-focus-visible:stroke-[#FF6600]/60 transition-colors"
                  />

                  {/* Brilho quente suave na aba da pasta exibido SOMENTE no hover ou focus-visible */}
                  <path
                    d="M 0 30 C 0 14, 12 0, 28 0 L 130 0 C 148 0, 160 16, 180 16 L 352 16 C 368 16, 380 28, 380 44 L 380 208 C 380 220, 368 230, 352 230 L 28 230 C 12 230, 0 220, 0 208 Z"
                    fill={`url(#tab-glow-${lead.id})`}
                    className="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-200 pointer-events-none"
                  />
                </svg>

                {/* Conteúdo interno da Pasta com alinhamento rigoroso */}
                <div className="relative z-10 pt-6 pb-4 px-5 flex flex-col justify-between flex-1">
                  {/* Cabeçalho do Card: Nome do Condomínio com Linha Divisória */}
                  <div className="pb-2.5 border-b border-[#303034]">
                    <h3 className="text-sm sm:text-base font-bold text-white group-hover:text-[#FF6600] transition-colors truncate tracking-tight">
                      {lead.name}
                    </h3>
                  </div>

                  {/* Corpo da Pasta: Círculo de Progresso à Esquerda e 7 Etapas à Direita */}
                  <div className="py-2.5 grid grid-cols-12 gap-3 items-center">
                    {/* Coluna Esquerda: Círculo de Progresso + Contagem "X de 7" */}
                    <div className="col-span-5 flex flex-col items-center justify-center border-r border-[#303034] pr-3 pl-1 py-1">
                      <div className="relative w-24 h-24 flex items-center justify-center p-1">
                        <svg
                          className="w-24 h-24 -rotate-90"
                          viewBox="0 0 112 112"
                          style={{ overflow: 'visible' }}
                        >
                          <defs>
                            <filter id={filterId} x="-100%" y="-100%" width="300%" height="300%">
                              <feGaussianBlur stdDeviation="3.5" result="blur" />
                              <feMerge>
                                <feMergeNode in="blur" />
                                <feMergeNode in="SourceGraphic" />
                              </feMerge>
                            </filter>
                          </defs>
                          {/* Círculo de Fundo */}
                          <circle
                            cx="56"
                            cy="56"
                            r="44"
                            fill="none"
                            stroke="#1a1a1e"
                            strokeWidth="7.5"
                          />
                          {/* Anel de Progresso com Glow Neon Suave */}
                          <circle
                            cx="56"
                            cy="56"
                            r="44"
                            fill="none"
                            stroke={color}
                            strokeWidth="7.5"
                            strokeLinecap="round"
                            strokeDasharray={276.46}
                            strokeDashoffset={276.46 - (percentage / 100) * 276.46}
                            filter={percentage > 0 ? `url(#${filterId})` : undefined}
                            style={{
                              transition: 'stroke-dashoffset 0.4s ease, stroke 0.4s ease',
                            }}
                          />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <span className="text-lg sm:text-xl font-extrabold text-white tracking-tight">
                            {percentage}%
                          </span>
                        </div>
                      </div>
                      <span className="text-xs text-slate-400 font-medium mt-1">
                        {completedCount} de {CANONICAL_CATEGORIES.length}
                      </span>
                    </div>

                    {/* Coluna Direita: As 7 Etapas com Check Verde e Círculo Vazado */}
                    <div className="col-span-7 space-y-1.5 pl-1">
                      {CANONICAL_CATEGORIES.map((cat) => {
                        const isDone = completedSet.has(cat.id);
                        return (
                          <div key={cat.id} className="flex items-center gap-2 text-xs">
                            {isDone ? (
                              <span className="w-4 h-4 rounded-full bg-[#00D66B] text-black flex items-center justify-center shrink-0">
                                <svg className="w-2.5 h-2.5 stroke-[3]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              </span>
                            ) : (
                              <span className="w-4 h-4 rounded-full border border-slate-500/80 flex items-center justify-center shrink-0" />
                            )}
                            <span className={`truncate text-xs ${isDone ? 'text-white font-medium' : 'text-slate-400 font-normal'}`}>
                              {cat.name}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
