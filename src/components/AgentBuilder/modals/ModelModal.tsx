import React, { useState, useEffect, useMemo, Component, type ErrorInfo, type ReactNode } from 'react';
import {
  X,
  Check,
  RefreshCw,
  AlertTriangle,
  Cpu,
  Search,
  Sparkles,
  KeyRound,
  Database,
  Coins,
} from 'lucide-react';
import { fetchDynamicModelCatalog, refreshDynamicModelCatalog } from '../../../lib/agentStore';
import { useUserPermissions } from '../../../lib/permissionsContext';
import { InfoTooltip } from '../../ui/InfoTooltip';
import { SkeletonModelCard } from '../../ui/Skeleton';

export interface CatalogModelItem {
  id: string;
  provider: 'openai' | 'google';
  displayName: string;
  description?: string;
  category?: 'recommended' | 'compatible';
  supportsTools?: boolean | null;
  supportsThinking?: boolean | null;
  supportsTemperature?: boolean | null;
  supportsVision?: boolean;
  supportsPdfReading?: boolean;
  supportsStructuredOutput?: boolean;
  contextWindow?: number;
  maxFileSizeMb?: number;
  maxOutputTokens?: number;
  status: 'discovered' | 'compatible' | 'operational' | 'unsupported';
  lastVerifiedAt?: string;
  createdAt?: number;
  hasKnownDate?: boolean;
  dateFormatted?: string;
  versionScore?: number;
  versionLabel?: string;
}

export interface ProviderCatalogStatus {
  provider: 'openai' | 'google';
  state: 'success' | 'stale_cache' | 'missing_key' | 'rate_limit' | 'network_error' | 'not_checked';
  ok: boolean;
  rawCount: number;
  acceptedCount: number;
  recommendedCount: number;
  compatibleCount: number;
  discardedCount: number;
  discardReasons?: Record<string, number>;
  source: 'live_api' | 'cached' | 'not_configured';
  lastCheckedAt: string;
  lastSuccessAt?: string;
  message: string;
  errorDetail?: string;
}

interface ModelModalProps {
  isOpen: boolean;
  initialValue?: string;
  capabilities?: Record<string, boolean>;
  onSave: (modelId: string) => void;
  onClose: () => void;
}

type ProviderFilter = 'all' | 'openai' | 'google';

/**
 * Error Boundary específico para o Catálogo de Modelos.
 */
interface ErrorBoundaryProps {
  children: ReactNode;
  onClose: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ModelErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: any): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: String(error?.message || error || 'Erro de renderização no catálogo de modelos.'),
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ModelModal Render Error Caught]:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150 font-['Roboto',sans-serif]"
          onClick={this.props.onClose}
        >
          <div
            className="w-full max-w-lg bg-[#141418] border border-rose-500/40 rounded-3xl p-6 shadow-2xl text-center space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 rounded-2xl bg-rose-950/60 border border-rose-500/40 text-rose-400 mx-auto flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-white tracking-wide">
                Falha ao Renderizar Catálogo de Modelos
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Ocorreu uma inconsistência na exibição dos modelos. A plataforma permanece segura e operacional.
              </p>
            </div>
            <div className="text-[11px] font-mono text-rose-300 bg-[#1c1d27] p-3 rounded-xl border border-slate-800 text-left overflow-x-auto max-h-28 custom-scrollbar">
              {this.state.errorMessage}
            </div>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleRetry}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-[#242428] hover:bg-[#303034] transition-colors cursor-pointer"
              >
                Tentar Novamente
              </button>
              <button
                type="button"
                onClick={this.props.onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 transition-colors cursor-pointer"
              >
                Fechar Janela
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Logo SVG OpenAI (Official 6-spiral Rosette emblem com gradiente oficial de prestígio)
const OpenAILogo: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none">
    <path
      d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.259 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7466-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1683a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4947zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1683a.0757.0757 0 0 1-.071 0l-4.8303-2.7866A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.6667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1635a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813v6.7227zm1.1448-1.7454l2.5484-1.4704 2.5484 1.4704v2.9408l-2.5484 1.4704-2.5484-1.4704z"
      fill="url(#openai-grad)"
    />
    <defs>
      <linearGradient id="openai-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
        <stop stopColor="#34d399" />
        <stop offset="0.5" stopColor="#10b981" />
        <stop offset="1" stopColor="#059669" />
      </linearGradient>
    </defs>
  </svg>
);

// Logo SVG Google Gemini (4-point gradient star)
const GeminiLogo: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none">
    <path
      d="M12 2C12 7.52285 7.52285 12 2 12C7.52285 12 12 16.4772 12 22C12 16.4772 16.4772 12 22 12C16.4772 12 12 7.52285 12 2Z"
      fill="url(#gemini-grad)"
    />
    <defs>
      <linearGradient id="gemini-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
        <stop stopColor="#38bdf8" />
        <stop offset="0.5" stopColor="#818cf8" />
        <stop offset="1" stopColor="#fb7185" />
      </linearGradient>
    </defs>
  </svg>
);

const ModelModalContent: React.FC<ModelModalProps> = ({
  isOpen,
  initialValue = '',
  capabilities = {},
  onSave,
  onClose,
}) => {
  const { isAdmin } = useUserPermissions();
  const safeInitialValue = String(initialValue || '').trim();
  const [selectedModelId, setSelectedModelId] = useState<string>(safeInitialValue);
  const [searchQuery, setSearchQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all');
  const [catalog, setCatalog] = useState<CatalogModelItem[]>([]);
  const [providerStatus, setProviderStatus] = useState<{
    openai?: ProviderCatalogStatus;
    google?: ProviderCatalogStatus;
  }>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [costModalModel, setCostModalModel] = useState<CatalogModelItem | null>(null);

  const evaluateModelCompatibility = (
    model: CatalogModelItem,
    agentCaps: Record<string, boolean> = {}
  ): { isCompatible: boolean; reason?: string } => {
    const mId = String(model?.id || '').trim().toLowerCase();
    const reqCrm = Boolean(agentCaps.crm || agentCaps.google_drive || agentCaps.memorias || agentCaps.agenda);
    const reqAuditoria = Boolean(agentCaps.auditoria);

    const supportsTools = model.supportsTools === true && !mId.includes('o1-preview') && !mId.includes('o1-mini');
    if ((reqCrm || reqAuditoria) && !supportsTools) {
      return {
        isCompatible: false,
        reason: 'Sem suporte comprovado a chamadas de ferramentas (Function Calling) exigidas pelas capacidades ativas.',
      };
    }

    const supportsPdf = model.supportsPdfReading === true;
    if (reqAuditoria && !supportsPdf) {
      return {
        isCompatible: false,
        reason: 'Sem suporte comprovado à leitura de PDFs exigida para a capacidade Auditoria.',
      };
    }

    return { isCompatible: true };
  };

  useEffect(() => {
    setSelectedModelId(String(initialValue || '').trim());
    setSearchQuery('');
  }, [initialValue, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setIsLoading(true);

    fetchDynamicModelCatalog()
      .then((res) => {
        if (!isMounted) return;
        setIsLoading(false);
        if (res && res.ok && Array.isArray(res.catalog)) {
          setCatalog(res.catalog.filter(Boolean));
          if (res.providerStatus && typeof res.providerStatus === 'object') {
            setProviderStatus(res.providerStatus);
          }
        } else {
          setCatalog([]);
          if (res?.providerStatus) {
            setProviderStatus(res.providerStatus);
          }
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setIsLoading(false);
        setCatalog([]);
        console.error('Falha ao carregar catálogo dinâmico:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleManualRefresh = async () => {
    if (!isAdmin || isRefreshing) return;
    setIsRefreshing(true);

    try {
      const res = await refreshDynamicModelCatalog();
      setIsRefreshing(false);

      if (res && res.ok && Array.isArray(res.catalog)) {
        setCatalog(res.catalog.filter(Boolean));
        if (res.providerStatus) {
          setProviderStatus(res.providerStatus);
        }
      }
    } catch (err: any) {
      setIsRefreshing(false);
      console.error('Erro ao atualizar catálogo:', err);
    }
  };

  const handleSave = () => {
    onSave(selectedModelId);
    onClose();
  };

  // Filtragem
  const safeCatalog = useMemo(() => (Array.isArray(catalog) ? catalog.filter((m) => m && m.id) : []), [catalog]);

  const openAiCount = safeCatalog.filter((m) => m?.provider === 'openai').length;
  const googleCount = safeCatalog.filter((m) => m?.provider === 'google').length;

  const filteredModels = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    return safeCatalog.filter((m) => {
      if (!m || typeof m !== 'object') return false;
      if (providerFilter === 'openai' && m.provider !== 'openai') return false;
      if (providerFilter === 'google' && m.provider !== 'google') return false;

      if (q) {
        const matchesName = String(m.displayName || '').toLowerCase().includes(q);
        const matchesId = String(m.id || '').toLowerCase().includes(q);
        const matchesDesc = String(m.description || '').toLowerCase().includes(q);
        return matchesName || matchesId || matchesDesc;
      }
      return true;
    });
  }, [safeCatalog, providerFilter, searchQuery]);

  // Obter o nome de exibição do modelo atualmente selecionado
  const selectedModelDisplayName = useMemo(() => {
    if (!selectedModelId) return 'Nenhum';
    const found = safeCatalog.find(
      (m) => m && String(m.id).toLowerCase() === selectedModelId.toLowerCase()
    );
    return found?.displayName || selectedModelId;
  }, [selectedModelId, safeCatalog]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150 font-['Roboto',sans-serif]"
      onClick={onClose}
    >
      {/* Outer Shell with Neon Gradient Border */}
      <div
        className="w-full max-w-3xl neon-modal-shell overflow-hidden shadow-2xl flex flex-col h-[90vh] max-h-[800px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="neon-modal-inner p-6 sm:p-7 flex flex-col overflow-hidden flex-1">
          {/* Header */}
          <div className="flex items-start justify-between pb-4 shrink-0">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-fuchsia-500/10 border border-fuchsia-500/40 flex items-center justify-center text-fuchsia-400 shadow-[0_0_15px_rgba(217,70,239,0.35)] shrink-0">
                <Cpu className="w-6 h-6 stroke-[2.2]" />
              </div>
              <div className="flex items-center gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-bold text-white tracking-wide">
                      Modelo do Agente
                    </h3>
                    <InfoTooltip
                      title="Modelo do Agente"
                      content="Selecione o modelo de inteligência artificial homologado responsável pelo raciocínio e geração de respostas deste agente."
                      secondaryText="Os modelos com suporte a ferramentas e chamadas de API nativas oferecem maior precisão em auditorias."
                      theme="dark"
                    />
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Escolha o modelo de IA que será usado por este agente.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-[#242428] transition-colors cursor-pointer"
              aria-label="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Subheader: Tabs de Filtro por Provedor + Botão Atualizar Modelos */}
          <div className="flex items-center justify-between gap-3 flex-wrap pb-3.5 shrink-0">
            {/* Tabs */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Tab Todos */}
              <button
                type="button"
                onClick={() => setProviderFilter('all')}
                className={`px-4 py-2 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
                  providerFilter === 'all'
                    ? 'bg-[#3b1849] border-2 border-fuchsia-500/80 text-white shadow-[0_0_12px_rgba(217,70,239,0.35)]'
                    : 'bg-[#242428] border border-[#303034] text-slate-300 hover:text-white hover:bg-[#303034]'
                }`}
              >
                Todos ({safeCatalog.length})
              </button>

              {/* Tab OpenAI */}
              <button
                type="button"
                onClick={() => setProviderFilter('openai')}
                className={`px-4 py-2 rounded-2xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                  providerFilter === 'openai'
                    ? 'bg-[#3b1849] border-2 border-fuchsia-500/80 text-white shadow-[0_0_12px_rgba(217,70,239,0.35)]'
                    : 'bg-[#242428] border border-[#303034] text-slate-300 hover:text-white hover:bg-[#303034]'
                }`}
              >
                <OpenAILogo className="w-4 h-4" />
                <span>OpenAI ({openAiCount})</span>
              </button>

              {/* Tab Google Gemini */}
              <button
                type="button"
                onClick={() => setProviderFilter('google')}
                className={`px-4 py-2 rounded-2xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                  providerFilter === 'google'
                    ? 'bg-[#3b1849] border-2 border-fuchsia-500/80 text-white shadow-[0_0_12px_rgba(217,70,239,0.35)]'
                    : 'bg-[#242428] border border-[#303034] text-slate-300 hover:text-white hover:bg-[#303034]'
                }`}
              >
                <GeminiLogo className="w-4 h-4" />
                <span>Google Gemini ({googleCount})</span>
              </button>
            </div>

            {/* Botão Atualizar Modelos */}
            {isAdmin && (
              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-medium text-slate-300 bg-[#242428] hover:bg-[#303034] hover:text-white transition-all cursor-pointer border border-[#303034] disabled:opacity-50 shrink-0"
                title="Atualizar lista de modelos oficiais via API"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-fuchsia-400' : ''}`} />
                <span>{isRefreshing ? 'Atualizando...' : 'Atualizar Modelos'}</span>
              </button>
            )}
          </div>

          {/* Campo de Pesquisa */}
          <div className="relative pb-4 shrink-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-4 top-3 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar modelo por nome..."
              className="w-full bg-[#242428] border border-[#303034] focus:border-fuchsia-500/70 focus:ring-1 focus:ring-fuchsia-500/30 rounded-2xl pl-11 pr-4 py-2.5 text-xs text-white placeholder-slate-400 focus:outline-none transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3.5 top-2.5 text-slate-400 hover:text-white p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Lista Rolável de Cards dos Modelos */}
          <div className="overflow-y-auto flex-1 space-y-2.5 pr-1 custom-scrollbar">
            {isLoading ? (
              <div className="space-y-2.5 animate-in fade-in duration-150" aria-busy="true">
                <div className="flex items-center justify-between pb-1 px-1">
                  <span className="text-xs text-slate-400 font-medium">Consultando catálogo oficial de modelos...</span>
                  <span className="w-2.5 h-2.5 rounded-full border-2 border-fuchsia-500 border-t-transparent animate-spin" />
                </div>
                {Array.from({ length: 4 }).map((_, idx) => (
                  <SkeletonModelCard key={idx} theme="dark" />
                ))}
              </div>
            ) : filteredModels.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-xs space-y-2 bg-[#242428]/60 rounded-2xl p-6 border border-[#303034]">
                <p className="text-slate-300 font-medium">Nenhum modelo disponível para os filtros selecionados.</p>
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="text-fuchsia-400 hover:underline text-xs"
                  >
                    Limpar busca "{searchQuery}"
                  </button>
                )}
              </div>
            ) : (
              filteredModels.map((model) => {
                const isSelected = selectedModelId?.toLowerCase() === model.id.toLowerCase();
                const isGoogle = model.provider === 'google';
                const compat = evaluateModelCompatibility(model, capabilities);

                return (
                  <div
                    key={model.id}
                    onClick={() => setSelectedModelId(model.id)}
                    className={`w-full p-4 rounded-2xl border transition-all flex items-center justify-between gap-4 cursor-pointer select-none text-left ${
                      !compat.isCompatible
                        ? isSelected
                          ? 'bg-amber-950/30 border-amber-500/70 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                          : 'bg-[#242428]/80 border-amber-500/30 opacity-75 hover:bg-[#2b2b30]'
                        : isSelected
                        ? 'bg-[#303034] border-fuchsia-500 shadow-[0_0_15px_rgba(217,70,239,0.3)]'
                        : 'bg-[#242428] border-[#303034] hover:border-[#3f3f46] hover:bg-[#2b2b30]'
                    }`}
                  >
                    {/* Left & Middle: Provider Icon + Name + Description + Technical Tags */}
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      {/* Provider Logo Box */}
                      <div className="w-11 h-11 rounded-2xl bg-[#18181c] border border-[#303034] flex items-center justify-center shrink-0">
                        {isGoogle ? (
                          <GeminiLogo className="w-6 h-6" />
                        ) : (
                          <OpenAILogo className="w-5 h-5 text-white" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-white tracking-wide">
                            {model.displayName || model.id}
                          </span>

                          {/* Technical Tags */}
                          {model.supportsTools === true && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
                              Ferramentas
                            </span>
                          )}
                          {model.supportsVision && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-sky-500/10 text-sky-300 border border-sky-500/20">
                              Visão
                            </span>
                          )}
                          {model.supportsPdfReading && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                              PDFs
                            </span>
                          )}
                          {model.supportsThinking && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-fuchsia-500/10 text-fuchsia-300 border border-fuchsia-500/20">
                              Raciocínio
                            </span>
                          )}

                          {/* Compatibility Badge */}
                          {!compat.isCompatible && (
                            <span
                              className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 inline-flex items-center gap-1"
                              title={compat.reason}
                            >
                              <AlertTriangle className="w-3 h-3 text-amber-400" />
                              Incompatível
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5 line-clamp-1 leading-relaxed">
                          {!compat.isCompatible ? (
                            <span className="text-amber-300/90 font-medium">{compat.reason}</span>
                          ) : (
                            model.description || 'Modelo de inteligência artificial homologado pela plataforma.'
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Right: "Ver custo" button + Radio */}
                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCostModalModel(model);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#303034] hover:bg-[#38383e] border border-[#3f3f46] text-slate-300 hover:text-white text-xs font-medium transition-colors cursor-pointer"
                        title="Ver especificações e consumo de tokens deste modelo"
                      >
                        <Database className="w-3.5 h-3.5 text-slate-400" />
                        <span>Ver custo</span>
                      </button>

                      {/* Radio Selector */}
                      <div
                        className={`w-5 h-5 rounded-full flex items-center justify-center border transition-all ${
                          isSelected
                            ? !compat.isCompatible
                              ? 'border-amber-500 bg-transparent'
                              : 'border-fuchsia-500 bg-transparent'
                            : 'border-slate-600 bg-transparent'
                        }`}
                      >
                        {isSelected && (
                          <div
                            className={`w-2.5 h-2.5 rounded-full ${
                              !compat.isCompatible
                                ? 'bg-amber-500 shadow-[0_0_8px_#f59e0b]'
                                : 'bg-fuchsia-500 shadow-[0_0_8px_#d946ef]'
                            }`}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Fixo */}
          <div className="border-t border-[#242428] pt-4 mt-3 flex items-center justify-between gap-3 shrink-0">
            {/* Left: Modelo Selecionado Pill */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-slate-400 font-medium whitespace-nowrap">
                Modelo selecionado:
              </span>
              <span
                className={`px-3 py-1 rounded-xl border text-xs font-mono font-semibold truncate max-w-[220px] ${
                  (() => {
                    const selObj = safeCatalog.find((m) => m && String(m.id).toLowerCase() === selectedModelId.toLowerCase());
                    const compat = selObj ? evaluateModelCompatibility(selObj, capabilities) : { isCompatible: true };
                    return !compat.isCompatible
                      ? 'bg-amber-950/60 border-amber-500/60 text-amber-300'
                      : 'bg-[#221c32] border-fuchsia-500/50 text-white';
                  })()
                }`}
              >
                {selectedModelDisplayName}
              </span>
            </div>

            {/* Right: Cancelar e Salvar Modelo */}
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-[#242428] hover:bg-[#303034] border border-[#303034] transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              {(() => {
                const selObj = safeCatalog.find((m) => m && String(m.id).toLowerCase() === selectedModelId.toLowerCase());
                const compat = selObj ? evaluateModelCompatibility(selObj, capabilities) : { isCompatible: true };
                return (
                  <button
                    type="button"
                    disabled={!compat.isCompatible}
                    onClick={handleSave}
                    className={`px-6 py-2.5 rounded-xl text-xs font-bold text-white transition-all shadow-lg flex items-center gap-2 ${
                      !compat.isCompatible
                        ? 'bg-slate-700 opacity-50 cursor-not-allowed shadow-none'
                        : 'bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-700 hover:to-fuchsia-700 shadow-purple-500/25 cursor-pointer'
                    }`}
                  >
                    <Check className="w-4 h-4 stroke-[3]" />
                    <span>Salvar Modelo</span>
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Popover / Modal Informativo "Ver Custo" */}
      {costModalModel && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-100"
          onClick={() => setCostModalModel(null)}
        >
          <div
            className="w-full max-w-sm bg-[#242428] border border-[#303034] rounded-3xl p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#242428] pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-fuchsia-500/10 border border-fuchsia-500/30 flex items-center justify-center text-fuchsia-400">
                  <Coins className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Especificações & Custo</h4>
                  <span className="text-[11px] font-mono text-fuchsia-300">{costModalModel.displayName || costModalModel.id}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCostModalModel(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Provedor:</span>
                <span className="text-white font-medium capitalize">{costModalModel.provider}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800">
                <span className="text-slate-400">ID Oficial da API:</span>
                <span className="text-slate-200 font-mono text-[11px]">{costModalModel.id}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Suporte a Ferramentas:</span>
                <span className="text-emerald-400 font-medium">
                  {costModalModel.supportsTools === true ? 'Sim (Habilitado)' : 'Não'}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Status Operacional:</span>
                <span className="text-sky-400 font-medium capitalize">{costModalModel.status}</span>
              </div>
              <div className="p-3 bg-[#141418] rounded-xl border border-slate-800 text-[11px] text-slate-400 leading-relaxed">
                As cobranças de uso são faturadas diretamente na conta da sua chave de API junto ao provedor oficial ({costModalModel.provider === 'openai' ? 'OpenAI' : 'Google Gemini'}).
              </div>
            </div>

            <button
              type="button"
              onClick={() => setCostModalModel(null)}
              className="w-full py-2.5 rounded-xl bg-[#242428] hover:bg-[#303034] text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const ModelModal: React.FC<ModelModalProps> = (props) => {
  if (!props.isOpen) return null;
  return (
    <ModelErrorBoundary onClose={props.onClose}>
      <ModelModalContent {...props} />
    </ModelErrorBoundary>
  );
};
