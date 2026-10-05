import React, { useState } from 'react';

export interface CondoResultItem {
  type: 'lead' | 'contact' | 'whatsapp' | 'email' | 'link' | 'followup' | 'service' | 'help' | 'copyable_text';
  id?: string;
  lead_id?: string;
  contact_id?: string;
  title?: string;
  subtitle?: string;
  label?: string;
  value?: string;
  display_value?: string;
  url?: string;
  city?: string;
  temperature?: string;
  stage_name?: string;
  responsible_name?: string;
  unit_count?: number | null;
  role_title?: string;
  interaction_type?: string;
  notes?: string;
  next_follow_up_date_br?: string;
  status?: string;
  steps?: string[];
  route?: string;
  target?: string;
  image?: string | null;
  imageHighlight?: { x: number; y: number; width: number; height: number; label?: string } | null;
}

export interface CondoResultRendererProps {
  results: CondoResultItem[];
  onOpenLead?: (leadId: string) => void;
  onOpenFollowUp?: (leadId?: string) => void;
  onShowHelpTarget?: (helpId: string, route?: string, leadId?: string, title?: string) => void;
}

// Utility: Copy text with temporary discrete badge feedback
export function CopyableValue({
  textToCopy,
  label,
  displayValue,
  className = '',
}: {
  textToCopy: string;
  label?: string;
  displayValue?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      {label && <span className="text-xs text-slate-400 font-medium">{label}:</span>}
      <span className="text-xs font-mono text-slate-200 select-all font-semibold">
        {displayValue || textToCopy}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        className="px-2 py-1 text-[11px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors cursor-pointer flex items-center gap-1 shrink-0"
        title="Copiar para área de transferência"
      >
        {copied ? (
          <span className="text-emerald-400 font-bold flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Copiado
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Copiar
          </span>
        )}
      </button>
    </div>
  );
}

// WhatsApp Result Card Component
function WhatsAppResultCard({ item }: { item: CondoResultItem }) {
  const [copied, setCopied] = useState(false);
  const rawNum = (item.value || '').replace(/\D/g, '');
  const cleanPhone = rawNum.startsWith('55') ? rawNum : rawNum.length >= 10 ? `55${rawNum}` : rawNum;
  const waUrl = cleanPhone ? `https://wa.me/${cleanPhone}` : '#';

  const handleCopy = () => {
    if (!item.value) return;
    navigator.clipboard.writeText(item.display_value || item.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 text-white flex flex-col gap-2.5 shadow-md">
      <div className="flex items-center justify-between min-w-0">
        <div className="min-w-0">
          <div className="font-bold text-sm text-white truncate flex items-center gap-1.5">
            <span className="text-emerald-500">📞</span>
            <span className="truncate">{item.label || item.title || 'Contato WhatsApp'}</span>
          </div>
          {item.subtitle && <div className="text-[11px] text-slate-400 truncate mt-0.5">{item.subtitle}</div>}
        </div>
        <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950/40 px-2.5 py-1 rounded-lg border border-emerald-800/50 shrink-0">
          {item.display_value || item.value}
        </span>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <a
          href={waUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm cursor-pointer"
        >
          <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
            <path d="M12.012 2c-5.508 0-9.988 4.479-9.988 9.987 0 1.763.459 3.486 1.332 5.006L2 22l5.148-1.348c1.472.803 3.132 1.223 4.864 1.223 5.508 0 9.988-4.479 9.988-9.987 0-5.508-4.48-9.988-9.988-9.988z" />
          </svg>
          Abrir WhatsApp
        </a>
        <button
          type="button"
          onClick={handleCopy}
          className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-colors cursor-pointer shrink-0 flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {copied ? '✓ Copiado' : 'Copiar'}
        </button>
      </div>
    </div>
  );
}

// Email Result Card Component
function EmailResultCard({ item }: { item: CondoResultItem }) {
  const [copied, setCopied] = useState(false);
  const emailAddr = item.value || '';
  const mailtoUrl = emailAddr ? `mailto:${emailAddr}` : '#';

  const handleCopy = () => {
    if (!emailAddr) return;
    navigator.clipboard.writeText(emailAddr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 text-white flex flex-col gap-2.5 shadow-md">
      <div className="flex items-center justify-between min-w-0">
        <div className="min-w-0">
          <div className="font-bold text-sm text-white truncate flex items-center gap-1.5">
            <span>✉️</span>
            <span className="truncate">{item.label || item.title || 'E-mail de Contato'}</span>
          </div>
          {item.subtitle && <div className="text-[11px] text-slate-400 truncate mt-0.5">{item.subtitle}</div>}
        </div>
      </div>

      <div className="text-xs font-mono text-sky-300 bg-slate-950/80 px-3 py-2 rounded-xl border border-slate-800 truncate">
        {emailAddr}
      </div>

      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={handleCopy}
          className="flex-1 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-colors cursor-pointer flex items-center justify-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {copied ? '✓ Copiado' : 'Copiar'}
        </button>
        <a
          href={mailtoUrl}
          className="flex-1 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm cursor-pointer"
        >
          Enviar e-mail
        </a>
      </div>
    </div>
  );
}

// Link Result Card Component (Strict http:, https:, mailto:)
function LinkResultCard({ item }: { item: CondoResultItem }) {
  const [copied, setCopied] = useState(false);
  const rawUrl = item.url || item.value || '';

  // Whitelist http:, https:, mailto: only
  const isSafeProtocol = /^(https?:|mailto:)/i.test(rawUrl) && !/^(javascript|data|vbscript):/i.test(rawUrl);
  const safeUrl = isSafeProtocol ? rawUrl : '#';

  const handleCopy = () => {
    if (!rawUrl) return;
    navigator.clipboard.writeText(rawUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isMeetingLink = /meet|zoom|teams|whereby/i.test(rawUrl);

  return (
    <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 text-white flex flex-col gap-2.5 shadow-md">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-xl bg-[#FF6600]/15 text-[#FF6600] border border-[#FF6600]/30 flex items-center justify-center font-bold shrink-0">
          {isMeetingLink ? '🔗' : '📁'}
        </div>
        <div className="min-w-0">
          <div className="font-bold text-sm text-white truncate">{item.title || item.label || 'Link Relevante'}</div>
          {item.subtitle && <div className="text-[11px] text-slate-400 truncate">{item.subtitle}</div>}
        </div>
      </div>

      <div className="text-[11px] font-mono text-slate-300 bg-slate-950/80 px-3 py-1.5 rounded-xl border border-slate-800 truncate">
        {rawUrl}
      </div>

      <div className="flex items-center gap-2 pt-0.5">
        {isSafeProtocol ? (
          <a
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 px-3 py-1.5 rounded-xl bg-[#FF6600] hover:bg-[#e65c00] text-white font-bold text-xs flex items-center justify-center gap-1 transition-colors cursor-pointer shadow-sm"
          >
            {isMeetingLink ? 'Entrar na reunião ↗' : 'Abrir link ↗'}
          </a>
        ) : (
          <span className="flex-1 px-3 py-1.5 rounded-xl bg-slate-800 text-slate-400 font-medium text-xs text-center">
            Link indisponível
          </span>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-colors cursor-pointer shrink-0"
        >
          {copied ? '✓ Copiado' : 'Copiar link'}
        </button>
      </div>
    </div>
  );
}

// Lead Mini Card Result (Commercial / Cadastral -> Pipeline)
function LeadResultCard({
  item,
  onOpenLead,
}: {
  item: CondoResultItem;
  onOpenLead?: (leadId: string) => void;
}) {
  const handleOpen = () => {
    if (item.lead_id && onOpenLead) {
      onOpenLead(item.lead_id);
    }
  };

  const getTempColor = (temp?: string) => {
    const t = (temp || '').toLowerCase();
    if (t.includes('quente') || t.includes('hot')) return 'bg-rose-500/20 text-rose-300 border-rose-500/30';
    if (t.includes('cliente') || t.includes('won')) return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    if (t.includes('frio') || t.includes('cold')) return 'bg-sky-500/20 text-sky-300 border-sky-500/30';
    return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
  };

  return (
    <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 text-white flex flex-col gap-2 shadow-md">
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <h4 className="font-bold text-sm text-white truncate">{item.title || item.label}</h4>
          <div className="text-[11px] text-slate-400 truncate mt-0.5">
            {item.city && <span>{item.city}</span>}
            {item.unit_count ? <span> · {item.unit_count} un.</span> : null}
          </div>
        </div>
        {item.temperature && (
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-lg border ${getTempColor(item.temperature)} shrink-0 capitalize`}>
            {item.temperature}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300 pt-1">
        <div className="bg-slate-950/60 p-2 rounded-xl border border-slate-800/80">
          <span className="text-slate-500 block text-[10px]">Estágio</span>
          <span className="font-semibold text-slate-200 truncate block">{item.stage_name || 'Não definido'}</span>
        </div>
        <div className="bg-slate-950/60 p-2 rounded-xl border border-slate-800/80">
          <span className="text-slate-500 block text-[10px]">Próximo Contato</span>
          <span className="font-semibold text-[#FF6600] truncate block">{item.next_follow_up_date_br || 'Sem agendamento'}</span>
        </div>
      </div>

      {item.lead_id && onOpenLead && (
        <button
          type="button"
          onClick={handleOpen}
          className="mt-1 px-3 py-2 rounded-xl bg-[#FF6600] hover:bg-[#e65c00] text-white font-bold text-xs flex items-center justify-center gap-1 transition-colors cursor-pointer shadow-sm"
        >
          Ver no Pipeline →
        </button>
      )}
    </div>
  );
}

// FollowUp Result Card (Agenda / Activity -> Follow-ups)
function FollowupResultCard({
  item,
  onOpenFollowUp,
}: {
  item: CondoResultItem;
  onOpenFollowUp?: (leadId?: string) => void;
}) {
  // Check for meeting links inside notes
  const urlMatch = (item.notes || '').match(/(https?:\/\/[^\s<]+)/i);
  const meetingUrl = urlMatch ? urlMatch[0] : null;

  return (
    <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 text-white flex flex-col gap-2 shadow-md">
      <div className="flex items-center justify-between min-w-0">
        <div className="font-bold text-sm text-white truncate flex items-center gap-1.5">
          <span>📅</span>
          <span className="truncate">{item.title || item.label || 'Follow-up Agendado'}</span>
        </div>
        <span className="text-xs font-bold px-2.5 py-0.5 rounded-lg bg-[#FF6600]/20 text-[#FF6600] border border-[#FF6600]/30 shrink-0">
          {item.next_follow_up_date_br || 'Em breve'}
        </span>
      </div>

      {item.subtitle && <div className="text-[11px] text-slate-400 font-medium">{item.subtitle}</div>}
      {item.notes && (
        <div className="text-xs text-slate-300 bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80 leading-relaxed">
          "{item.notes}"
        </div>
      )}

      <div className="flex items-center gap-2 mt-1">
        {meetingUrl && (
          <a
            href={meetingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-1 transition-colors cursor-pointer shadow-sm"
          >
            Abrir reunião ↗
          </a>
        )}
        <button
          type="button"
          onClick={() => onOpenFollowUp && onOpenFollowUp(item.lead_id)}
          className="flex-1 px-3 py-2 rounded-xl bg-[#FF6600] hover:bg-[#e65c00] text-white font-bold text-xs flex items-center justify-center gap-1 transition-colors cursor-pointer shadow-sm"
        >
          Ver em Follow-ups →
        </button>
      </div>
    </div>
  );
}

// Help Result Card (Platform Tutorial & Target Highlighting)
function HelpResultCard({
  item,
  onShowHelpTarget,
}: {
  item: CondoResultItem;
  onShowHelpTarget?: (helpId: string, route?: string, leadId?: string, title?: string) => void;
}) {
  const handleShowTarget = () => {
    if (item.target && onShowHelpTarget) {
      onShowHelpTarget(item.target, item.route, item.lead_id, item.title);
    }
  };

  return (
    <div className="p-4 rounded-2xl bg-slate-900/95 border border-[#FF6600]/30 text-white flex flex-col gap-3 shadow-lg">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-xl bg-[#FF6600]/20 text-[#FF6600] border border-[#FF6600]/30 flex items-center justify-center font-bold shrink-0">
          ?
        </div>
        <div className="font-bold text-sm text-[#FF6600]">{item.title || 'Guia da Plataforma Triverus'}</div>
      </div>

      {item.steps && item.steps.length > 0 && (
        <ol className="space-y-1.5 text-xs text-slate-300 pl-4 list-decimal marker:text-[#FF6600] font-medium">
          {item.steps.map((step, idx) => (
            <li key={idx} className="pl-1">
              {step}
            </li>
          ))}
        </ol>
      )}

      {item.target && onShowHelpTarget && (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleShowTarget}
            className="flex-1 px-3.5 py-2 rounded-xl bg-[#FF6600] hover:bg-[#e65c00] text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-sm"
          >
            <span>🎯</span>
            Mostrar onde clicar
          </button>
        </div>
      )}
    </div>
  );
}

// Main Result Switcher Component
export default function CondoResultRenderer({
  results,
  onOpenLead,
  onOpenFollowUp,
  onShowHelpTarget,
}: CondoResultRendererProps) {
  if (!results || results.length === 0) return null;

  // Cap initial list display at 5 items max for token/UI efficiency
  const displayedResults = results.slice(0, 5);
  const remainingCount = results.length - 5;

  return (
    <div className="flex flex-col gap-3 my-2 w-full">
      {displayedResults.map((item, idx) => {
        switch (item.type) {
          case 'whatsapp':
            return <WhatsAppResultCard key={idx} item={item} />;
          case 'email':
            return <EmailResultCard key={idx} item={item} />;
          case 'link':
            return <LinkResultCard key={idx} item={item} />;
          case 'lead':
            return <LeadResultCard key={idx} item={item} onOpenLead={onOpenLead} />;
          case 'followup':
            return <FollowupResultCard key={idx} item={item} onOpenFollowUp={onOpenFollowUp} />;
          case 'help':
            return <HelpResultCard key={idx} item={item} onShowHelpTarget={onShowHelpTarget} />;
          case 'copyable_text':
            return (
              <div key={idx} className="p-3 rounded-2xl bg-slate-900 border border-slate-800">
                <CopyableValue textToCopy={item.value || ''} label={item.label} displayValue={item.display_value} />
              </div>
            );
          default:
            return <LeadResultCard key={idx} item={item} onOpenLead={onOpenLead} />;
        }
      })}

      {remainingCount > 0 && onOpenFollowUp && (
        <button
          type="button"
          onClick={() => onOpenFollowUp()}
          className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs text-center transition-colors cursor-pointer"
        >
          Ver todos em Follow-ups ({results.length}) →
        </button>
      )}
    </div>
  );
}
