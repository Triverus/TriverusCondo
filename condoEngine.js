// Shared Condo AI Operational Engine (used by both server.js and server.ts)

export const CONDO_MODEL_REQUESTED = 'gpt-4o-mini';

export function buildSystemPrompt() {
  const now = new Date();
  const todayBR = now.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const year = now.getFullYear();

  return `Você é Condo, a inteligência operacional da Triverus.
Data atual do sistema: ${todayBR} (ano vigente: ${year}). Padrão de data brasileiro: DD/MM (dia/mês). Nunca interprete 06/10 como mês 06 dia 10; 06/10 é sempre 06 de outubro (${year}-10-06).

Seu trabalho é ajudar funcionários a consultar e operar o CRM.
Use as ferramentas sempre que a resposta depender de dados do CRM.
Nunca invente informações do banco.

REGRAS OBRIGATÓRIAS DE RESOLUÇÃO DE NOMES:
1. O usuário NUNCA deve precisar informar IDs técnicos (UUID, lead_id, contact_id, interaction_id, stage_id). NUNCA peça IDs ao usuário e NUNCA exiba IDs nas respostas.
2. Quando o usuário mencionar uma pessoa pelo nome (ex: "Mude o follow-up do Henrique para 06/10", "Coloque o condomínio da Bruna como Quente", "Quem é o responsável pelo cliente do Carlos?", "Adicione uma nota para o condomínio do João"), chame diretamente a ferramenta da ação passando o nome da pessoa em contact_name (ou name) — o backend resolve automaticamente: contato -> lead_contacts -> condomínio -> follow-up atual.
3. Quando o usuário mencionar um condomínio pelo nome parcial (ex: "Solar"), passe em lead_name (ou name).
4. Só faça uma pergunta de desambiguação se a ferramenta retornar que existem múltiplos registros homônimos, listando apenas os nomes legíveis (ex: "- Henrique — Condomínio A\n- Henrique — Condomínio B\nQual deles?").
5. Se não encontrar o contato ou condomínio, responda de forma direta (ex: "Não encontrei nenhum contato chamado Henrique.").
6. Após executar uma ação, confirme de forma curta e objetiva (ex: "Follow-up do Henrique alterado para 06/10.").
7. Não repita sua apresentação em todas as mensagens. Não execute DELETE: informe que exclusões exigem confirmação manual.`;
}

export function sanitizeTemperatureForDB(temp) {
  if (!temp) return 'Morno';
  const val = String(temp).trim().toLowerCase();
  if (val === 'frio' || val === 'cold') return 'Frio';
  if (val === 'morno' || val === 'warm') return 'Morno';
  if (val === 'quente' || val === 'hot') return 'Quente';
  if (val === 'cliente' || val === 'client' || val === 'ganho' || val === 'won') return 'Cliente';
  return 'Morno';
}

export function sanitizeInteractionTypeForDB(type) {
  if (!type) return 'Outro';
  const lower = String(type).trim().toLowerCase();
  if (lower.includes('liga') || lower.includes('call') || lower.includes('tel')) return 'Ligação';
  if (lower.includes('whats') || lower.includes('zap') || lower.includes('msg')) return 'WhatsApp';
  if (lower.includes('mail')) return 'E-mail';
  if (lower.includes('reun') || lower.includes('meet')) return 'Reunião';
  if (lower.includes('event')) return 'Evento';
  if (lower.includes('visit')) return 'Visita';
  return 'Outro';
}

export function cleanHumanReference(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(/^(o|a|os|as|do|da|dos|das|de|no|na|nos|nas|para|pro|pra|com)\s+/gi, '')
    .replace(/^(condom[íi]nio|edif[íi]cio|residencial|ed\.|cond\.|cliente|contato|s[íi]ndico|s[íi]ndica|sr\.|sra\.|retorno|follow-up|followup)\s+/gi, '')
    .replace(/^(o|a|os|as|do|da|dos|das|de)\s+/gi, '')
    .trim();
}

export function formatBRShort(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return `${m[3]}/${m[2]}/${m[1]}`;
  }
  return dateStr;
}

/**
 * Parses Brazilian date expressions (DD/MM, D/M, DD/MM/YYYY, amanhã, hoje, sexta, próxima segunda, dia 15, or ISO).
 * Always interprets numeric slash dates as DD/MM (never MM/DD) and preserves the appropriate year.
 */
export function parseBrazilianDate(rawInput, userMessageText = '', existingDateStr = null) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();

  let defaultYear = currentYear;
  if (existingDateStr) {
    const m = String(existingDateStr).match(/^(\d{4})-/);
    if (m) {
      const exYear = Number(m[1]);
      if (exYear >= currentYear) {
        defaultYear = exYear;
      }
    }
  }

  const inputStr = String(rawInput || '').trim();
  const inputClean = inputStr.toLowerCase();
  const userClean = String(userMessageText || '').trim().toLowerCase();

  // 1. Explicit DD/MM or DD/MM/YYYY in rawInput or user's message (ALWAYS DD/MM)
  const slashFromInput = inputStr.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  const slashFromUser = userClean.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  const brSlashMatch = slashFromInput || slashFromUser;

  if (brSlashMatch) {
    const day = Number(brSlashMatch[1]);
    const month = Number(brSlashMatch[2]);
    let year = defaultYear;
    if (brSlashMatch[3]) {
      year = brSlashMatch[3].length === 2 ? 2000 + Number(brSlashMatch[3]) : Number(brSlashMatch[3]);
    }
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const dd = String(day).padStart(2, '0');
      const mm = String(month).padStart(2, '0');
      return {
        isoDate: `${year}-${mm}-${dd}`,
        displayBR: brSlashMatch[3] ? `${dd}/${mm}/${year}` : `${dd}/${mm}`,
        fullDisplayBR: `${dd}/${mm}/${year}`,
      };
    }
  }

  // 2. Relative dates: "depois de amanhã", "amanhã", "hoje"
  if (/depois de amanh[aã]/i.test(inputClean) || /depois de amanh[aã]/i.test(userClean)) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 12, 0, 0);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return { isoDate: `${yyyy}-${mm}-${dd}`, displayBR: `${dd}/${mm}`, fullDisplayBR: `${dd}/${mm}/${yyyy}` };
  }

  if (/amanh[aã]/i.test(inputClean) || /amanh[aã]/i.test(userClean)) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12, 0, 0);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return { isoDate: `${yyyy}-${mm}-${dd}`, displayBR: `${dd}/${mm}`, fullDisplayBR: `${dd}/${mm}/${yyyy}` };
  }

  if (/\bhoje\b/i.test(inputClean) || /\bhoje\b/i.test(userClean)) {
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return { isoDate: `${yyyy}-${mm}-${dd}`, displayBR: `${dd}/${mm}`, fullDisplayBR: `${dd}/${mm}/${yyyy}` };
  }

  // 3. Weekdays in Portuguese ("segunda", "próxima segunda", "sexta", etc.)
  const weekdayMap = [
    { regex: /\bdomingo\b/i, dow: 0 },
    { regex: /\bsegunda(?:-feira)?\b/i, dow: 1 },
    { regex: /\bter[çc]a(?:-feira)?\b/i, dow: 2 },
    { regex: /\bquarta(?:-feira)?\b/i, dow: 3 },
    { regex: /\bquinta(?:-feira)?\b/i, dow: 4 },
    { regex: /\bsexta(?:-feira)?\b/i, dow: 5 },
    { regex: /\bs[áa]bado\b/i, dow: 6 },
  ];
  for (const w of weekdayMap) {
    if (w.regex.test(inputClean) || w.regex.test(userClean)) {
      const currentDow = now.getDay();
      let daysAhead = (w.dow - currentDow + 7) % 7;
      if (daysAhead === 0) daysAhead = 7;
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead, 12, 0, 0);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return { isoDate: `${yyyy}-${mm}-${dd}`, displayBR: `${dd}/${mm}`, fullDisplayBR: `${dd}/${mm}/${yyyy}` };
    }
  }

  // 4. "dia X" (e.g., "dia 15")
  const diaMatch = inputClean.match(/\bdia\s+(\d{1,2})\b/i) || userClean.match(/\bdia\s+(\d{1,2})\b/i);
  if (diaMatch) {
    const targetDay = Number(diaMatch[1]);
    if (targetDay >= 1 && targetDay <= 31) {
      let targetMonth = currentMonth;
      let targetYear = defaultYear;
      if (targetDay < currentDay) {
        targetMonth += 1;
        if (targetMonth > 12) {
          targetMonth = 1;
          targetYear += 1;
        }
      }
      const dd = String(targetDay).padStart(2, '0');
      const mm = String(targetMonth).padStart(2, '0');
      return { isoDate: `${targetYear}-${mm}-${dd}`, displayBR: `${dd}/${mm}`, fullDisplayBR: `${dd}/${mm}/${targetYear}` };
    }
  }

  // 5. ISO YYYY-MM-DD sent by model
  const isoMatch = inputStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    let year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const userHasExplicitYear = /\b20\d{2}\b/.test(userClean);
    if (!userHasExplicitYear && year < currentYear) {
      year = defaultYear;
    }
    const dd = String(day).padStart(2, '0');
    const mm = String(month).padStart(2, '0');
    return {
      isoDate: `${year}-${mm}-${dd}`,
      displayBR: `${dd}/${mm}`,
      fullDisplayBR: `${dd}/${mm}/${year}`,
    };
  }

  return null;
}

export function buildFollowUpIsoValue(isoDate, existingDateStr) {
  if (existingDateStr && typeof existingDateStr === 'string') {
    const timeMatch = existingDateStr.match(/[T\s](\d{2}:\d{2}(?::\d{2})?)/);
    if (timeMatch) {
      const t = timeMatch[1].length === 5 ? `${timeMatch[1]}:00` : timeMatch[1];
      return `${isoDate}T${t}`;
    }
    if (existingDateStr.trim().length === 10) {
      return isoDate;
    }
  }
  return `${isoDate}T09:00:00`;
}
