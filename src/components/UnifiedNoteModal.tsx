import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useCRM, type Lead } from '../lib/crmStore.tsx';
import type { UserProfile } from '../App.tsx';
import { NotesIcon } from './PipelineComponents.tsx';
import {
  formatDateBR,
  toDateInputValue,
  getFollowUpTime,
  saveFollowUpTime,
  parseCalendarDate,
} from '../lib/dateUtils.ts';

export interface UnifiedNoteModalProps {
  isOpen: boolean;
  lead: Lead | null;
  editingInteractionId?: string | null;
  currentProfile: UserProfile;
  onClose: () => void;
  onSuccessFeedback?: (msg: string) => void;
}

export const CONTACT_TYPES = [
  'Ligação',
  'WhatsApp',
  'E-mail',
  'Reunião',
  'Evento',
  'Redes Sociais',
  'Visita',
  'Outro',
] as const;

export { formatDateBR };

const isValidUUID = (str?: string | null): boolean => {
  if (!str) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
};

export function sanitizeInteractionTypeForDB(type?: string | null): string {
  if (!type) return 'Ligação';
  const val = type.trim();
  const lower = val.toLowerCase();
  if (lower.includes('liga') || lower.includes('call') || lower.includes('tel')) return 'Ligação';
  if (lower.includes('whats') || lower.includes('zap') || lower.includes('msg')) return 'WhatsApp';
  if (lower.includes('mail')) return 'E-mail';
  if (lower.includes('reun') || lower.includes('meet')) return 'Reunião';
  if (lower.includes('event')) return 'Evento';
  if (lower.includes('visit')) return 'Visita';
  if (lower.includes('outro') || lower.includes('other') || lower.includes('nota')) return 'Outro';
  return 'Ligação';
}

async function saveInteractionToSupabase(
  mode: 'insert' | 'update',
  payload: any,
  interactionId?: string
) {
  const primaryType = sanitizeInteractionTypeForDB(payload.interaction_type);
  const attemptPayload = { ...payload, interaction_type: primaryType };

  const query = mode === 'insert'
    ? supabase.from('interactions').insert([attemptPayload]).select().single()
    : supabase.from('interactions').update(attemptPayload).eq('id', interactionId!).select().single();

  const res = await query;
  if (!res.error && res.data) return res.data;

  // Fallback for check constraint violation (code 23514)
  if (res.error && res.error.code === '23514') {
    const candidateTypes = ['Ligação', 'WhatsApp', 'E-mail', 'Reunião', 'Outro', 'Anotação', 'call', 'meeting', 'email', 'other'];
    for (const cand of candidateTypes) {
      if (cand === primaryType) continue;
      const retryPayload = { ...payload, interaction_type: cand };
      const retryQuery = mode === 'insert'
        ? supabase.from('interactions').insert([retryPayload]).select().single()
        : supabase.from('interactions').update(retryPayload).eq('id', interactionId!).select().single();
      const retryRes = await retryQuery;
      if (!retryRes.error && retryRes.data) {
        return retryRes.data;
      }
    }
  }

  throw res.error;
}

export default function UnifiedNoteModal({
  isOpen,
  lead,
  editingInteractionId = null,
  currentProfile,
  onClose,
  onSuccessFeedback,
}: UnifiedNoteModalProps) {
  const { profiles, interactions, upsertInteractionLocally, refreshAll } = useCRM();

  // Typeform Step state (1 to 5)
  const [step, setStep] = useState<number>(1);
  const totalSteps = 5;

  // Form states
  const [formType, setFormType] = useState<string>('');
  const [formNotes, setFormNotes] = useState<string>('');
  
  // Date & Time for current interaction
  const [formDate, setFormDate] = useState<string>(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });
  const [formTime, setFormTime] = useState<string>(() => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${min}`;
  });

  // Calendar month navigation
  const [viewCalendarMonth, setViewCalendarMonth] = useState<Date>(new Date());

  // Responsible profile
  const [formResponsibleId, setFormResponsibleId] = useState<string>('');

  // Next follow-up states
  const [wantNextFollowUp, setWantNextFollowUp] = useState<boolean>(true);
  const [formNextFollowUpDate, setFormNextFollowUpDate] = useState<string>('');
  const [formNextFollowUpTime, setFormNextFollowUpTime] = useState<string>('09:00');
  const [formNextChannel, setFormNextChannel] = useState<string>('WhatsApp');

  const [formSaving, setFormSaving] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Quick next follow-up helper
  const handleSelectQuickNextDate = (daysAhead: number) => {
    setWantNextFollowUp(true);
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    setFormNextFollowUpDate(`${yyyy}-${mm}-${dd}`);
  };

  // Reset/Initialize state when modal opens
  useEffect(() => {
    if (isOpen && lead) {
      setStep(1);
      setFormError(null);

      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const hh = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');

      if (editingInteractionId) {
        const found = interactions.find((i) => i.id === editingInteractionId);
        if (found) {
          setFormType(found.interaction_type || 'Ligação');
          setFormNotes(found.notes || '');
          if (found.occurred_at) {
            const occ = parseCalendarDate(found.occurred_at) || new Date(found.occurred_at);
            setFormDate(toDateInputValue(found.occurred_at));
            setFormTime(`${String(occ.getHours()).padStart(2, '0')}:${String(occ.getMinutes()).padStart(2, '0')}`);
            setViewCalendarMonth(occ);
          }
          setFormResponsibleId(found.responsible_user_id || currentProfile.id);
          if (found.next_follow_up_date) {
            setWantNextFollowUp(true);
            setFormNextFollowUpDate(toDateInputValue(found.next_follow_up_date));
            setFormNextFollowUpTime(getFollowUpTime(found.next_follow_up_date, found.id, lead.id));
          } else {
            setWantNextFollowUp(false);
            setFormNextFollowUpDate('');
            setFormNextFollowUpTime('09:00');
          }
          return;
        }
      }

      // Default new note values (no pre-selected type so user explicitly chooses)
      setFormType('');
      setFormNotes('');
      setFormDate(`${yyyy}-${mm}-${dd}`);
      setFormTime(`${hh}:${min}`);
      setViewCalendarMonth(new Date());
      setFormResponsibleId(currentProfile.id);
      setWantNextFollowUp(true);
      setFormNextFollowUpDate('');
      setFormNextFollowUpTime('09:00');
      setFormNextChannel('WhatsApp');
    }
  }, [isOpen, lead, editingInteractionId, currentProfile.id, interactions]);

  if (!isOpen || !lead) return null;

  // Calendar calculations for Step 3
  const year = viewCalendarMonth.getFullYear();
  const month = viewCalendarMonth.getMonth();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const monthNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  const todayStr = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  })();

  // Submit Handler
  const handleSubmit = async () => {
    setFormError(null);

    if (!formNotes.trim() && !formNextFollowUpDate) {
      setStep(2);
      setFormError('Por favor, digite as anotações do contato ou defina a data do próximo follow-up.');
      return;
    }

    setFormSaving(true);
    try {
      // Build ISO occurred_at (Safety check: occurred_at is when this note/history was recorded)
      let occurredAtIso = new Date().toISOString();
      if (formDate) {
        const [y, m, d] = formDate.split('-').map(Number);
        const [h, min] = (formTime || '12:00').split(':').map(Number);
        const dateObj = new Date(y, m - 1, d, h || 0, min || 0, 0);
        
        // Prevent accidental future date in occurred_at when creating a new note
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        if (!editingInteractionId && dateObj > todayEnd) {
          occurredAtIso = new Date().toISOString();
        } else {
          occurredAtIso = dateObj.toISOString();
        }
      }

      const validResponsibleId = isValidUUID(formResponsibleId)
        ? formResponsibleId
        : isValidUUID(currentProfile.id)
        ? currentProfile.id
        : null;

      const nextFollowUpFinal = wantNextFollowUp && formNextFollowUpDate
        ? (formNextFollowUpDate.includes('T') ? formNextFollowUpDate : `${formNextFollowUpDate}T${formNextFollowUpTime || '09:00'}:00`)
        : null;

      const payload = {
        lead_id: lead.id,
        interaction_type: formType,
        occurred_at: occurredAtIso,
        responsible_user_id: validResponsibleId,
        notes: formNotes.trim() || null,
        next_follow_up_date: nextFollowUpFinal,
      };

      if (editingInteractionId) {
        const savedData = await saveInteractionToSupabase('update', payload, editingInteractionId);
        if (savedData) {
          if (wantNextFollowUp && formNextFollowUpTime) {
            saveFollowUpTime(savedData.id, lead.id, formNextFollowUpTime);
          }
          upsertInteractionLocally({
            ...savedData,
            interaction_type: formType || savedData.interaction_type,
            next_follow_up_date: nextFollowUpFinal || savedData.next_follow_up_date,
          });
        }
        if (onSuccessFeedback) onSuccessFeedback('Nota atualizada com sucesso!');
      } else {
        const savedData = await saveInteractionToSupabase('insert', payload);
        if (savedData) {
          if (wantNextFollowUp && formNextFollowUpTime) {
            saveFollowUpTime(savedData.id, lead.id, formNextFollowUpTime);
          }
          upsertInteractionLocally({
            ...savedData,
            interaction_type: formType || savedData.interaction_type,
            next_follow_up_date: nextFollowUpFinal || savedData.next_follow_up_date,
          });
        }
        if (onSuccessFeedback) {
          onSuccessFeedback(
            nextFollowUpFinal
              ? `Nota salva! Próximo contato (${formNextChannel}) agendado para ${formatDateBR(nextFollowUpFinal)}.`
              : 'Nota registrada com sucesso!'
          );
        }
      }

      onClose();
      refreshAll(true);
    } catch (err: any) {
      console.error('Erro ao salvar nota:', err);
      setFormError(err?.message || 'Erro ao gravar nota no banco de dados.');
    } finally {
      setFormSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-auto flex flex-col max-h-[92vh]"
      >
        {/* Top Header: Clean title without clutter */}
        <div className="px-6 pt-5 pb-4 border-b border-slate-800/80 bg-slate-950/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 font-bold shrink-0">
                <NotesIcon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-sm text-white truncate max-w-[260px] sm:max-w-xs">
                  {lead.name}
                </h3>
                <div className="text-[11px] text-slate-400 truncate">
                  <span>{lead.condominium_type || 'Residencial'}</span>
                  {lead.city && <span> · {lead.city}</span>}
                </div>
              </div>
            </div>

            {/* Close "X" Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
              title="Fechar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Minimalist Progress Indicator */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5 font-medium">
              <span>Pergunta {step} de {totalSteps}</span>
              <span className="text-indigo-400 font-semibold">
                {step === 1 && 'Tipo de Contato'}
                {step === 2 && 'Anotações'}
                {step === 3 && 'Data & Horário'}
                {step === 4 && 'Atendente'}
                {step === 5 && 'Próximo Follow-up'}
              </span>
            </div>
            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-indigo-500 h-full transition-all duration-300 ease-out rounded-full"
                style={{ width: `${(step / totalSteps) * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* Modal Body: One Step at a Time (Typeform) */}
        <div className="p-6 sm:p-7 overflow-y-auto flex-1 text-sm">
          {formError && (
            <div className="mb-4 p-3 bg-rose-950/80 border border-rose-600/50 rounded-xl text-rose-200 text-xs">
              {formError}
            </div>
          )}

          {/* STEP 1: Tipo de Contato (Sem emojis, auto-avança, sem botões embaixo) */}
          {step === 1 && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-indigo-400 font-bold block mb-1">
                  Passo 1
                </span>
                <h3 className="text-lg sm:text-xl font-bold text-white leading-snug">
                  Qual foi o tipo de contato?
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-2">
                {CONTACT_TYPES.map((type) => {
                  const isSelected = formType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        setFormType(type);
                        // Auto-advance to next step
                        setTimeout(() => setStep(2), 120);
                      }}
                      className={`p-3.5 rounded-2xl border text-center font-bold text-sm transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-600 text-white border-indigo-500 shadow-md ring-2 ring-indigo-500/30'
                          : 'bg-slate-950/80 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      {type}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 2: Anotações (Título limpo, legenda curta, voltar + avançar) */}
          {step === 2 && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-indigo-400 font-bold block mb-1">
                  Passo 2
                </span>
                <h3 className="text-lg sm:text-xl font-bold text-white leading-snug">
                  O que foi tratado nesta conversa?
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Anote os principais pontos
                </p>
              </div>

              <div className="pt-2">
                <textarea
                  rows={5}
                  autoFocus
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Digite os principais pontos da conversa, dúvidas ou decisões tomadas..."
                  className="w-full px-4 py-3.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-2xl text-white placeholder-slate-500 text-xs focus:outline-none leading-relaxed"
                />
              </div>
            </div>
          )}

          {/* STEP 3: Data & Horário do Atendimento Realizado */}
          {step === 3 && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-indigo-400 font-bold block mb-1">
                  Passo 3
                </span>
                <h3 className="text-lg sm:text-xl font-bold text-white leading-snug">
                  Data do atendimento realizado
                </h3>
                <p className="text-xs text-indigo-300 bg-indigo-950/60 border border-indigo-800/50 p-2.5 rounded-xl mt-1.5 leading-relaxed">
                  💡 <strong>Registro Histórico:</strong> Esta é a data em que o contato ocorreu (por padrão, <strong>Hoje</strong>). A data do próximo contato/follow-up futuro será definida no <strong>Passo 5</strong>.
                </p>
              </div>

              {/* Quick Date Buttons: Hoje, Ontem */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setFormDate(todayStr);
                    setViewCalendarMonth(new Date());
                  }}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                    formDate === todayStr
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  Hoje
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const yest = new Date();
                    yest.setDate(yest.getDate() - 1);
                    const yestStr = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;
                    setFormDate(yestStr);
                    setViewCalendarMonth(yest);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 hover:text-white text-xs font-semibold cursor-pointer"
                >
                  Ontem
                </button>
              </div>

              {/* Inline Month Calendar */}
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-2xl">
                {/* Month Navigator */}
                <div className="flex items-center justify-between mb-3 text-xs font-bold text-white">
                  <span>{monthNames[month]} {year}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setViewCalendarMonth(new Date(year, month - 1, 1))}
                      className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewCalendarMonth(new Date(year, month + 1, 1))}
                      className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                    >
                      ›
                    </button>
                  </div>
                </div>

                {/* Day headers */}
                <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-slate-500 mb-1">
                  <span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span>
                </div>

                {/* Calendar Days */}
                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: firstDayOfWeek }).map((_, idx) => (
                    <div key={`empty-${idx}`} className="h-7" />
                  ))}
                  {Array.from({ length: daysInMonth }).map((_, idx) => {
                    const dNum = idx + 1;
                    const thisDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`;
                    const isSelected = formDate === thisDateStr;
                    const isToday = thisDateStr === todayStr;

                    return (
                      <button
                        key={dNum}
                        type="button"
                        onClick={() => setFormDate(thisDateStr)}
                        className={`h-7 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center justify-center relative ${
                          isSelected
                            ? 'bg-indigo-600 text-white font-bold shadow-xs'
                            : isToday
                            ? 'border border-indigo-500/60 text-indigo-300 bg-indigo-500/10'
                            : 'text-slate-300 hover:bg-slate-850 hover:text-white'
                        }`}
                      >
                        {dNum}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Time selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Horário do contato
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={formTime}
                    onChange={(e) => setFormTime(e.target.value)}
                    className="px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white text-xs focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const now = new Date();
                      setFormTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
                    }}
                    className="px-3 py-2 bg-slate-950 border border-slate-800 text-slate-400 hover:text-white rounded-xl text-xs cursor-pointer"
                  >
                    Agora
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Quem realizou o atendimento (Lista de atendentes como cards, auto-avança ao clicar, botão voltar) */}
          {step === 4 && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-indigo-400 font-bold block mb-1">
                  Passo 4
                </span>
                <h3 className="text-lg sm:text-xl font-bold text-white leading-snug">
                  Quem realizou o atendimento?
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Selecione o atendente responsável
                </p>
              </div>

              <div className="space-y-2 pt-2">
                {profiles.map((profile) => {
                  const isSelected = (formResponsibleId || currentProfile.id) === profile.id;
                  const isYou = profile.id === currentProfile.id;

                  return (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => {
                        setFormResponsibleId(profile.id);
                        setTimeout(() => setStep(5), 120);
                      }}
                      className={`w-full p-3.5 rounded-2xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-600/20 border-indigo-500 text-white ring-2 ring-indigo-500/20'
                          : 'bg-slate-950/80 border-slate-800 text-slate-300 hover:bg-slate-800/60 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center font-bold text-xs text-indigo-300 border border-slate-700">
                          {(profile.full_name || 'U').slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <span className="font-semibold text-xs text-white block">
                            {profile.full_name || 'Sem nome'} {isYou && '(Você)'}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {profile.role || 'Membro da equipe'}
                          </span>
                        </div>
                      </div>

                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs">
                          ✓
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 5: Próximo follow-up (Atalhos + data específica com horário + escolha do próximo canal) */}
          {step === 5 && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-indigo-400 font-bold block mb-1">
                  Passo 5
                </span>
                <h3 className="text-lg sm:text-xl font-bold text-white leading-snug">
                  Quer agendar um próximo follow-up?
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Defina a data do próximo contato. Isso aparecerá na aba Follow-ups.
                </p>
              </div>

              {/* Atalhos Rápidos (3 Botões sem "Em 1 semana") */}
              <div className="pt-1 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">
                    Atalhos de data:
                  </label>
                  <div className="grid grid-cols-3 gap-2.5">
                    <button
                      type="button"
                      onClick={() => handleSelectQuickNextDate(0)}
                      className="py-2.5 px-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500 text-xs font-semibold text-white transition-all cursor-pointer text-center shadow-xs"
                    >
                      ⚡ Hoje
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectQuickNextDate(1)}
                      className="py-2.5 px-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500 text-xs font-semibold text-white transition-all cursor-pointer text-center shadow-xs"
                    >
                      📅 Amanhã
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectQuickNextDate(3)}
                      className="py-2.5 px-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500 text-xs font-semibold text-white transition-all cursor-pointer text-center shadow-xs"
                    >
                      🗓️ Em 3 dias
                    </button>
                  </div>
                </div>

                {/* Escolha do Canal do Próximo Contato - Lista Suspensa (Dropdown com todos os canais) */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Canal do próximo contato:
                  </label>
                  <div className="relative">
                    <select
                      value={formNextChannel}
                      onChange={(e) => setFormNextChannel(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white text-xs focus:outline-none appearance-none cursor-pointer pr-10 shadow-xs"
                    >
                      {CONTACT_TYPES.map((ch) => (
                        <option key={ch} value={ch} className="bg-slate-900 text-white">
                          {ch}
                        </option>
                      ))}
                    </select>
                    <div className="absolute inset-y-0 right-0 flex items-center px-3.5 pointer-events-none text-slate-400">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Data e Horário Específicos */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Data do próximo contato:
                    </label>
                    <input
                      type="date"
                      value={formNextFollowUpDate}
                      onChange={(e) => {
                        setWantNextFollowUp(true);
                        setFormNextFollowUpDate(e.target.value);
                      }}
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white text-xs focus:outline-none shadow-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Horário previsto:
                    </label>
                    <input
                      type="time"
                      value={formNextFollowUpTime}
                      onChange={(e) => setFormNextFollowUpTime(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-white text-xs focus:outline-none shadow-xs"
                    />
                  </div>
                </div>

                {/* Opção de Não Agendar (Concluído) */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setWantNextFollowUp(false);
                      setFormNextFollowUpDate('');
                    }}
                    className={`text-xs underline cursor-pointer transition-colors ${
                      !wantNextFollowUp || !formNextFollowUpDate
                        ? 'text-amber-400 font-bold'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    Não agendar próximo contato agora (concluído)
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Footer Navigation */}
        <div className="px-6 py-4 border-t border-slate-800/80 bg-slate-950/80 flex items-center justify-between">
          <div>
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((p) => p - 1)}
                disabled={formSaving}
                className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold cursor-pointer transition-colors"
              >
                ← Voltar
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {step < totalSteps ? (
              // Step 1 doesn't have Avançar button (user clicks the option to advance)
              step !== 1 && (
                <button
                  type="button"
                  onClick={() => setStep((p) => p + 1)}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-all cursor-pointer"
                >
                  Avançar →
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={formSaving}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-50 shadow-md shadow-emerald-950/60"
              >
                {formSaving ? 'Salvando...' : 'Finalizar e Salvar Nota'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
