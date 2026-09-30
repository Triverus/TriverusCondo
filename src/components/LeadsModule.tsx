import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase.ts';
import type { UserProfile } from '../App.tsx';

export interface Lead {
  id: string;
  name: string;
  cnpj?: string | null;
  condominium_type?: string | null;
  administrator?: string | null;
  unit_count?: number | null;
  address?: string | null;
  city?: string | null;
  lead_source?: string | null;
  temperature?: string | null;
  current_stage_id?: string | null;
  responsible_user_id?: string | null;
  loss_reason?: string | null;
  created_at?: string;
}

export interface PipelineStage {
  id: string;
  name: string;
  position: number;
  is_lost?: boolean | null;
}

export interface ServiceItem {
  id: string;
  name?: string | null;
  title?: string | null;
}

export interface LeadServiceRelation {
  lead_id: string;
  service_id: string;
}

interface LeadsModuleProps {
  currentProfile: UserProfile;
}

const CONDOMINIUM_TYPES = [
  'Residencial',
  'Comercial',
  'Associação de Moradores',
  'Misto',
];

const LEAD_SOURCES = [
  'Indicação (BNI/rede)',
  'Prospecção ativa',
  'Conteúdo/Marketing',
  'Outro',
];

const TEMPERATURE_OPTIONS = ['Quente', 'Morno', 'Frio'];

export default function LeadsModule({ currentProfile }: LeadsModuleProps) {
  // Data states
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [leadServices, setLeadServices] = useState<LeadServiceRelation[]>([]);

  // Loading and error states
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFeedback, setStatusFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Modal states: 'create' | 'edit' | 'view' | null
  const [modalMode, setModalMode] = useState<'create' | 'edit' | 'view' | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  // Form field states
  const [formName, setFormName] = useState('');
  const [formCnpj, setFormCnpj] = useState('');
  const [formCondominiumType, setFormCondominiumType] = useState('Residencial');
  const [formAdministrator, setFormAdministrator] = useState('');
  const [formUnitCount, setFormUnitCount] = useState<string>('');
  const [formAddress, setFormAddress] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formLeadSource, setFormLeadSource] = useState('Indicação (BNI/rede)');
  const [formTemperature, setFormTemperature] = useState('Morno');
  const [formCurrentStageId, setFormCurrentStageId] = useState('');
  const [formResponsibleUserId, setFormResponsibleUserId] = useState('');
  const [formLossReason, setFormLossReason] = useState('');
  const [formSelectedServices, setFormSelectedServices] = useState<string[]>([]);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Load all necessary initial data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Load pipeline stages ordered by position
      const stagesRes = await supabase
        .from('pipeline_stages')
        .select('*')
        .order('position', { ascending: true });
      const stagesList = stagesRes.data || [];
      setStages(stagesList);

      // 2. Load profiles
      const profilesRes = await supabase
        .from('profiles')
        .select('id, full_name, role');
      const profilesList = profilesRes.data || [];
      setProfiles(profilesList);

      // 3. Load services dynamically
      const servicesRes = await supabase
        .from('services')
        .select('*');
      const servicesList = servicesRes.data || [];
      setServices(servicesList);

      // 4. Load leads
      const leadsRes = await supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false });
      const leadsList = leadsRes.data || [];
      setLeads(leadsList);

      // 5. Load lead_services relations
      const leadServicesRes = await supabase
        .from('lead_services')
        .select('lead_id, service_id');
      setLeadServices(leadServicesRes.data || []);
    } catch (err: any) {
      console.error('Error loading CRM leads data:', err);
      setStatusFeedback({
        type: 'error',
        message: 'Erro ao carregar dados do Supabase. Verifique a conexão.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Lookup maps for fast and resilient rendering
  const stageMap = useMemo(() => {
    const map = new Map<string, string>();
    stages.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [stages]);

  const profileMap = useMemo(() => {
    const map = new Map<string, string>();
    profiles.forEach((p) => map.set(p.id, p.full_name || 'Sem nome'));
    return map;
  }, [profiles]);

  const serviceMap = useMemo(() => {
    const map = new Map<string, string>();
    services.forEach((s) => map.set(s.id, s.name || s.title || 'Serviço'));
    return map;
  }, [services]);

  // Get services associated with a specific lead
  const getLeadServices = useCallback(
    (leadId: string): string[] => {
      return leadServices
        .filter((ls) => ls.lead_id === leadId)
        .map((ls) => ls.service_id);
    },
    [leadServices]
  );

  // Filter leads by search term
  const filteredLeads = useMemo(() => {
    if (!searchTerm.trim()) return leads;
    const term = searchTerm.toLowerCase();
    return leads.filter(
      (l) =>
        l.name.toLowerCase().includes(term) ||
        (l.city && l.city.toLowerCase().includes(term)) ||
        (l.administrator && l.administrator.toLowerCase().includes(term))
    );
  }, [leads, searchTerm]);

  // Check if a stage represents "Perdido" using is_lost or fallback to name
  const checkIsLostStage = useCallback(
    (stageId?: string | null): boolean => {
      if (!stageId) return false;
      const stage = stages.find((s) => s.id === stageId);
      if (!stage) return false;
      if (typeof stage.is_lost === 'boolean') {
        return stage.is_lost;
      }
      return (stage.name || '').toLowerCase().includes('perdid');
    },
    [stages]
  );

  // Handle stage change in form: if moved away from Lost, clear loss_reason
  const handleStageChange = (newStageId: string) => {
    setFormCurrentStageId(newStageId);
    if (!checkIsLostStage(newStageId)) {
      setFormLossReason('');
    }
  };

  // Open modal in create mode
  const handleOpenCreate = () => {
    setFormError(null);
    setFormName('');
    setFormCnpj('');
    setFormCondominiumType('Residencial');
    setFormAdministrator('');
    setFormUnitCount('');
    setFormAddress('');
    setFormCity('');
    setFormLeadSource('Indicação (BNI/rede)');
    setFormTemperature('Morno');
    // If no stage chosen, use first available
    const initialStageId = stages.length > 0 ? stages[0].id : '';
    setFormCurrentStageId(initialStageId);
    // Default responsible to current profile
    setFormResponsibleUserId(currentProfile.id);
    setFormLossReason('');
    setFormSelectedServices([]);
    setSelectedLead(null);
    setModalMode('create');
  };

  // Open modal in edit mode
  const handleOpenEdit = (lead: Lead) => {
    setFormError(null);
    setFormName(lead.name || '');
    setFormCnpj(lead.cnpj || '');
    setFormCondominiumType(lead.condominium_type || 'Residencial');
    setFormAdministrator(lead.administrator || '');
    setFormUnitCount(lead.unit_count != null ? String(lead.unit_count) : '');
    setFormAddress(lead.address || '');
    setFormCity(lead.city || '');
    setFormLeadSource(lead.lead_source || 'Indicação (BNI/rede)');
    setFormTemperature(lead.temperature || 'Morno');
    const stageId = lead.current_stage_id || (stages.length > 0 ? stages[0].id : '');
    setFormCurrentStageId(stageId);
    setFormResponsibleUserId(lead.responsible_user_id || currentProfile.id);
    const isStageLost = checkIsLostStage(stageId);
    setFormLossReason(isStageLost ? (lead.loss_reason || '') : '');
    setFormSelectedServices(getLeadServices(lead.id));
    setSelectedLead(lead);
    setModalMode('edit');
  };

  // Open modal in view mode
  const handleOpenView = (lead: Lead) => {
    setSelectedLead(lead);
    setModalMode('view');
  };

  const handleCloseModal = () => {
    setModalMode(null);
    setSelectedLead(null);
    setFormError(null);
  };

  // Toggle service selection in form
  const toggleService = (serviceId: string) => {
    setFormSelectedServices((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId]
    );
  };

  // Save Lead (Create or Edit)
  const handleSubmitLead = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // 1. Validate mandatory field: name
    if (!formName.trim()) {
      setFormError('O nome do condomínio é obrigatório.');
      return;
    }

    // 1. Validate mandatory field: unit_count
    const unitCountTrimmed = formUnitCount.trim();
    if (!unitCountTrimmed) {
      setFormError('O número de unidades é obrigatório.');
      return;
    }
    const unitCountNum = parseInt(unitCountTrimmed, 10);
    if (isNaN(unitCountNum) || unitCountNum <= 0) {
      setFormError('O número de unidades deve ser um valor numérico válido maior que zero.');
      return;
    }

    const stageIdToUse = formCurrentStageId || (stages.length > 0 ? stages[0].id : null);
    const isStageLost = checkIsLostStage(stageIdToUse);

    // 2. Validate mandatory loss_reason if stage is Lost
    if (isStageLost && !formLossReason.trim()) {
      setFormError('O preenchimento do motivo de perda é obrigatório quando o estágio for Perdido.');
      return;
    }

    setFormSaving(true);

    try {
      const leadPayload = {
        name: formName.trim(),
        cnpj: formCnpj.trim() || null,
        condominium_type: formCondominiumType || null,
        administrator: formAdministrator.trim() || null,
        unit_count: unitCountNum,
        address: formAddress.trim() || null,
        city: formCity.trim() || null,
        lead_source: formLeadSource || null,
        temperature: formTemperature || null,
        current_stage_id: stageIdToUse,
        responsible_user_id: formResponsibleUserId || null,
        loss_reason: isStageLost ? formLossReason.trim() : null,
      };

      if (modalMode === 'create') {
        // Insert lead
        const { data: newLead, error: insertError } = await supabase
          .from('leads')
          .insert([leadPayload])
          .select()
          .single();

        if (insertError) {
          throw new Error(insertError.message);
        }

        // Insert junction rows in lead_services
        if (newLead?.id && formSelectedServices.length > 0) {
          const serviceRows = formSelectedServices.map((serviceId) => ({
            lead_id: newLead.id,
            service_id: serviceId,
          }));
          const { error: relError } = await supabase
            .from('lead_services')
            .insert(serviceRows);
          if (relError) {
            console.warn('Warning inserting lead_services:', relError.message);
          }
        }

        setStatusFeedback({
          type: 'success',
          message: `Lead "${leadPayload.name}" cadastrado com sucesso!`,
        });
      } else if (modalMode === 'edit' && selectedLead) {
        // Update lead
        const { error: updateError } = await supabase
          .from('leads')
          .update(leadPayload)
          .eq('id', selectedLead.id);

        if (updateError) {
          throw new Error(updateError.message);
        }

        // Sync lead_services: delete existing then insert new
        await supabase
          .from('lead_services')
          .delete()
          .eq('lead_id', selectedLead.id);

        if (formSelectedServices.length > 0) {
          const serviceRows = formSelectedServices.map((serviceId) => ({
            lead_id: selectedLead.id,
            service_id: serviceId,
          }));
          const { error: relError } = await supabase
            .from('lead_services')
            .insert(serviceRows);
          if (relError) {
            console.warn('Warning syncing lead_services:', relError.message);
          }
        }

        setStatusFeedback({
          type: 'success',
          message: `Lead "${leadPayload.name}" atualizado com sucesso!`,
        });
      }

      handleCloseModal();
      await loadData();
    } catch (err: any) {
      console.error('Error saving lead:', err);
      setFormError(err.message || 'Erro ao salvar o lead. Tente novamente.');
    } finally {
      setFormSaving(false);
    }
  };

  // Temperature color helper
  const getTemperatureBadge = (temp?: string | null) => {
    switch (temp) {
      case 'Quente':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
            Quente
          </span>
        );
      case 'Morno':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            Morno
          </span>
        );
      case 'Frio':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-500/15 text-sky-300 border border-sky-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
            Frio
          </span>
        );
      default:
        return (
          <span className="text-xs text-slate-400">
            {temp || 'Não definido'}
          </span>
        );
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Top Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Leads
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Gestão comercial de condomínios e oportunidades
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleOpenCreate}
            className="inline-flex items-center justify-center px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors cursor-pointer"
          >
            <svg
              className="w-4 h-4 mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Novo lead
          </button>
        </div>
      </div>

      {/* Status Feedback banner */}
      {statusFeedback && (
        <div
          className={`mt-4 p-4 rounded-lg flex items-center justify-between text-sm ${
            statusFeedback.type === 'success'
              ? 'bg-emerald-950/70 border border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/70 border border-rose-500/40 text-rose-200'
          }`}
        >
          <span>{statusFeedback.message}</span>
          <button
            onClick={() => setStatusFeedback(null)}
            className="text-xs opacity-70 hover:opacity-100 cursor-pointer ml-4"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Search and stats bar */}
      <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar condomínio por nome ou cidade..."
            className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-xs text-slate-400 hover:text-white"
            >
              Limpar
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>Total:</span>
          <span className="font-semibold text-white px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
            {leads.length} {leads.length === 1 ? 'condomínio' : 'condomínios'}
          </span>
        </div>
      </div>

      {/* Main Table / List */}
      <div className="mt-6 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center text-slate-400">
            <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm">Carregando lista de condomínios...</p>
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="py-16 px-4 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-slate-800 flex items-center justify-center text-slate-400 mb-3">
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                />
              </svg>
            </div>
            <h3 className="text-base font-medium text-white mb-1">
              {searchTerm ? 'Nenhum lead encontrado' : 'Nenhum lead cadastrado ainda'}
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto mb-4">
              {searchTerm
                ? 'Tente ajustar os termos da sua pesquisa para encontrar o condomínio.'
                : 'Cadastre seu primeiro condomínio para iniciar o acompanhamento comercial.'}
            </p>
            {!searchTerm && (
              <button
                onClick={handleOpenCreate}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors cursor-pointer"
              >
                Cadastrar primeiro lead
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 text-xs uppercase tracking-wider font-semibold">
                  <th className="py-3.5 px-4 sm:px-6">Condomínio</th>
                  <th className="py-3.5 px-4 hidden md:table-cell">Cidade</th>
                  <th className="py-3.5 px-4 hidden lg:table-cell">Tipo</th>
                  <th className="py-3.5 px-4">Temperatura</th>
                  <th className="py-3.5 px-4">Estágio</th>
                  <th className="py-3.5 px-4 hidden sm:table-cell">Responsável</th>
                  <th className="py-3.5 px-4 hidden xl:table-cell">Criação</th>
                  <th className="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-slate-200">
                {filteredLeads.map((lead) => {
                  const stageName = lead.current_stage_id
                    ? stageMap.get(lead.current_stage_id) || 'Estágio inicial'
                    : 'Estágio inicial';
                  const responsibleName = lead.responsible_user_id
                    ? profileMap.get(lead.responsible_user_id) || 'Não atribuído'
                    : 'Não atribuído';
                  const createdDate = lead.created_at
                    ? new Date(lead.created_at).toLocaleDateString('pt-BR')
                    : '-';

                  return (
                    <tr
                      key={lead.id}
                      className="hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3.5 px-4 sm:px-6 font-medium text-white">
                        <div className="flex flex-col">
                          <span>{lead.name}</span>
                          {lead.administrator && (
                            <span className="text-[11px] text-slate-400">
                              Adm: {lead.administrator}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-300 hidden md:table-cell">
                        {lead.city || '-'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-300 hidden lg:table-cell">
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-800 border border-slate-700/60">
                          {lead.condominium_type || 'Residencial'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        {getTemperatureBadge(lead.temperature)}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="text-xs font-medium text-indigo-300 bg-indigo-950/60 border border-indigo-800/50 px-2 py-0.5 rounded">
                          {stageName}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-300 hidden sm:table-cell">
                        <div className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] text-slate-300 uppercase font-semibold">
                            {responsibleName.charAt(0)}
                          </span>
                          <span className="text-xs truncate max-w-[130px]">
                            {responsibleName}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-400 text-xs hidden xl:table-cell">
                        {createdDate}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => handleOpenView(lead)}
                            title="Visualizar detalhes"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                              />
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                              />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleOpenEdit(lead)}
                            title="Editar lead"
                            className="p-1.5 rounded-lg text-indigo-400 hover:text-indigo-300 hover:bg-indigo-950/60 transition-colors cursor-pointer"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                              />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal / Drawer for Create & Edit */}
      {(modalMode === 'create' || modalMode === 'edit') && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <div>
                <h3 className="text-lg font-bold text-white">
                  {modalMode === 'create' ? 'Novo Condomínio (Lead)' : 'Editar Condomínio'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Preencha as informações cadastrais e comerciais
                </p>
              </div>
              <button
                onClick={handleCloseModal}
                disabled={formSaving}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Error Message */}
            {formError && (
              <div className="mx-6 mt-4 p-3 bg-rose-950/80 border border-rose-500/50 rounded-lg text-rose-200 text-xs flex items-center gap-2">
                <span className="font-bold">Erro:</span>
                <span>{formError}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmitLead} className="p-6 space-y-6">
              {/* Section 1: Dados do Condomínio */}
              <div>
                <h4 className="text-xs uppercase tracking-wider font-semibold text-indigo-400 mb-3">
                  1. Dados do Condomínio
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Nome do Condomínio <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="Ex: Condomínio Edifício Solar das Flores"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      CNPJ
                    </label>
                    <input
                      type="text"
                      value={formCnpj}
                      onChange={(e) => setFormCnpj(e.target.value)}
                      placeholder="00.000.000/0000-00"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Tipo de Condomínio
                    </label>
                    <select
                      value={formCondominiumType}
                      onChange={(e) => setFormCondominiumType(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    >
                      {CONDOMINIUM_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Administradora
                    </label>
                    <input
                      type="text"
                      value={formAdministrator}
                      onChange={(e) => setFormAdministrator(e.target.value)}
                      placeholder="Ex: Lello, Hub, etc."
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Quantidade de Unidades <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={formUnitCount}
                      onChange={(e) => setFormUnitCount(e.target.value)}
                      placeholder="Ex: 84"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Cidade
                    </label>
                    <input
                      type="text"
                      value={formCity}
                      onChange={(e) => setFormCity(e.target.value)}
                      placeholder="Ex: São Paulo"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Endereço
                    </label>
                    <input
                      type="text"
                      value={formAddress}
                      onChange={(e) => setFormAddress(e.target.value)}
                      placeholder="Rua, número, bairro"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Qualificação Comercial */}
              <div className="pt-4 border-t border-slate-800">
                <h4 className="text-xs uppercase tracking-wider font-semibold text-indigo-400 mb-3">
                  2. Qualificação Comercial
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Origem do Lead
                    </label>
                    <select
                      value={formLeadSource}
                      onChange={(e) => setFormLeadSource(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    >
                      {LEAD_SOURCES.map((source) => (
                        <option key={source} value={source}>
                          {source}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Temperatura
                    </label>
                    <select
                      value={formTemperature}
                      onChange={(e) => setFormTemperature(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    >
                      {TEMPERATURE_OPTIONS.map((temp) => (
                        <option key={temp} value={temp}>
                          {temp}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Estágio do Pipeline
                    </label>
                    <select
                      value={formCurrentStageId}
                      onChange={(e) => handleStageChange(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    >
                      {stages.map((stage) => (
                        <option key={stage.id} value={stage.id}>
                          {stage.name}
                        </option>
                      ))}
                      {stages.length === 0 && (
                        <option value="">Carregando estágios...</option>
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Responsável Comercial
                    </label>
                    <select
                      value={formResponsibleUserId}
                      onChange={(e) => setFormResponsibleUserId(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    >
                      {profiles.map((prof) => (
                        <option key={prof.id} value={prof.id}>
                          {prof.full_name || 'Sem nome'} ({prof.role || 'user'})
                        </option>
                      ))}
                      {profiles.length === 0 && (
                        <option value={currentProfile.id}>
                          {currentProfile.full_name || 'Meu usuário'}
                        </option>
                      )}
                    </select>
                  </div>

                  {checkIsLostStage(formCurrentStageId) && (
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-rose-300 mb-1">
                        Motivo de Perda <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formLossReason}
                        onChange={(e) => setFormLossReason(e.target.value)}
                        placeholder="Informe o motivo pelo qual o lead foi perdido..."
                        className="w-full px-3 py-2 bg-slate-800 border border-rose-500/50 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Section 3: Tipos de Trabalho / Serviços (múltipla seleção) */}
              <div className="pt-4 border-t border-slate-800">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs uppercase tracking-wider font-semibold text-indigo-400">
                    3. Tipos de Trabalho / Serviços de Interesse
                  </h4>
                  <span className="text-[11px] text-slate-400">
                    {formSelectedServices.length} selecionado(s)
                  </span>
                </div>

                {services.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">
                    Nenhum serviço disponível em public.services.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                    {services.map((service) => {
                      const isSelected = formSelectedServices.includes(service.id);
                      const serviceTitle = service.name || service.title || 'Serviço';

                      return (
                        <button
                          type="button"
                          key={service.id}
                          onClick={() => toggleService(service.id)}
                          className={`p-2.5 rounded-lg border text-left text-xs font-medium transition-all flex items-center justify-between cursor-pointer ${
                            isSelected
                              ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200'
                              : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:border-slate-600'
                          }`}
                        >
                          <span className="truncate mr-2">{serviceTitle}</span>
                          <span
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 text-[10px] ${
                              isSelected
                                ? 'bg-indigo-600 border-indigo-500 text-white'
                                : 'border-slate-600 bg-slate-800'
                            }`}
                          >
                            {isSelected && '✓'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Footer Buttons */}
              <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  disabled={formSaving}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={formSaving}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:text-indigo-400 text-white text-xs font-medium rounded-lg shadow-sm transition-colors flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                >
                  {formSaving ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <span>{modalMode === 'create' ? 'Cadastrar Lead' : 'Salvar Alterações'}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal for View Details */}
      {modalMode === 'view' && selectedLead && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <div>
                <span className="text-xs font-mono text-slate-400">
                  ID: {selectedLead.id.slice(0, 8)}...
                </span>
                <h3 className="text-xl font-bold text-white mt-0.5">
                  {selectedLead.name}
                </h3>
              </div>
              <button
                onClick={handleCloseModal}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Badges strip */}
              <div className="flex flex-wrap items-center gap-2">
                {getTemperatureBadge(selectedLead.temperature)}
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-950 border border-indigo-800/60 text-indigo-300 font-medium">
                  {selectedLead.current_stage_id
                    ? stageMap.get(selectedLead.current_stage_id) || 'Estágio inicial'
                    : 'Estágio inicial'}
                </span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
                  {selectedLead.condominium_type || 'Residencial'}
                </span>
              </div>

              {/* Grid with info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs bg-slate-950/50 p-4 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-400 block mb-0.5">CNPJ:</span>
                  <span className="text-slate-200 font-mono font-medium">
                    {selectedLead.cnpj || 'Não informado'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Administradora:</span>
                  <span className="text-slate-200 font-medium">
                    {selectedLead.administrator || 'Não informada'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Cidade:</span>
                  <span className="text-slate-200 font-medium">
                    {selectedLead.city || 'Não informada'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Endereço:</span>
                  <span className="text-slate-200 font-medium">
                    {selectedLead.address || 'Não informado'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Unidades:</span>
                  <span className="text-slate-200 font-medium">
                    {selectedLead.unit_count != null ? `${selectedLead.unit_count} unidades` : 'Não informado'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Origem do Lead:</span>
                  <span className="text-slate-200 font-medium">
                    {selectedLead.lead_source || 'Não informada'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Responsável Comercial:</span>
                  <span className="text-slate-200 font-medium">
                    {selectedLead.responsible_user_id
                      ? profileMap.get(selectedLead.responsible_user_id) || 'Não atribuído'
                      : 'Não atribuído'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Cadastrado em:</span>
                  <span className="text-slate-200 font-medium">
                    {selectedLead.created_at
                      ? new Date(selectedLead.created_at).toLocaleString('pt-BR')
                      : '-'}
                  </span>
                </div>
              </div>

              {checkIsLostStage(selectedLead.current_stage_id) && selectedLead.loss_reason && (
                <div className="p-3 bg-amber-950/40 border border-amber-800/40 rounded-lg text-xs">
                  <span className="text-amber-400 font-semibold block mb-0.5">
                    Motivo de perda:
                  </span>
                  <span className="text-amber-200">{selectedLead.loss_reason}</span>
                </div>
              )}

              {/* Associated Services */}
              <div>
                <h4 className="text-xs uppercase tracking-wider font-semibold text-slate-400 mb-2">
                  Serviços de Interesse
                </h4>
                {(() => {
                  const leadServiceIds = getLeadServices(selectedLead.id);
                  if (leadServiceIds.length === 0) {
                    return (
                      <p className="text-xs text-slate-500 italic">
                        Nenhum serviço vinculado a este condomínio.
                      </p>
                    );
                  }
                  return (
                    <div className="flex flex-wrap gap-2">
                      {leadServiceIds.map((sId) => (
                        <span
                          key={sId}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-950/80 border border-indigo-800 text-indigo-300"
                        >
                          {serviceMap.get(sId) || 'Serviço'}
                        </span>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
              <button
                onClick={() => {
                  handleCloseModal();
                  handleOpenEdit(selectedLead);
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
                Editar este lead
              </button>
              <button
                onClick={handleCloseModal}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
