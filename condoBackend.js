import { PLATFORM_HELP_ITEMS, searchPlatformHelp } from './src/config/platformHelp.ts';
import * as CRMReader from './crmReadModel.js';

export const CONDO_MODEL_REQUESTED = 'gpt-4o-mini';

export function buildSystemPrompt() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const todayBR = `${dd}/${mm}/${yyyy}`;
  const todayISO = `${yyyy}-${mm}-${dd}`;

  return `Você é Condo, a inteligência operacional e especialista de consulta do CRM da Triverus.
Data atual do sistema: ${todayBR} (${todayISO}, ano vigente: ${yyyy}).

REGRAS CRÍTICAS DE COMPOSIÇÃO DE MENSAGEM:
1. VOCÊ É 100% READ-ONLY (APENAS LEITURA): Você NÃO possui ferramentas de gravação/edição/exclusão no CRM.
2. Se o usuário pedir qualquer alteração ou criação no CRM (ex: "Mude Condomínio F para Quente", "Crie um contato", "Exclua o condomínio"), responda objetivamente:
"Essa alteração é feita diretamente no Pipeline." (ou no menu correspondente).
3. COMPLEMENTARIDADE OBRIGATÓRIA (NÃO REPETIR RICH RESULTS):
   - Se a ferramenta retornar um cartão estruturado (Rich Result como 'help', 'whatsapp', 'email', 'link' ou 'followup'), a sua mensagem em texto DEVE ser uma introdução curta e objetiva (1 frase).
   - NUNCA repita no texto os números de telefone, os e-mails ou a lista numerada de passos quando um cartão 'help', 'whatsapp' ou 'email' já estiver presente nos resultados!
   - Exemplo com WhatsApp: "Encontrei o WhatsApp do Henrique." (o cartão exibirá o número e botão de cópia/abrir).
   - Exemplo com Guia/Help: "Os contatos são gerenciados pelo próprio card do condomínio no Pipeline." (o cartão HelpResult exibirá os passos e o botão 'Mostrar onde clicar').
4. INTENÇÃO ESPECÍFICA (SEM DADOS EXTRAS):
   - Se o usuário perguntar EXCLUSIVAMENTE sobre um dado específico (ex: "qual o drive do Condomínio E?"), use a ferramenta \`get_folder_link\` e responda APENAS sobre o link da pasta.
   - NUNCA adicione telefones, e-mails ou cartões de contatos quando o usuário pediu apenas a pasta/Drive!
   - Se o link não estiver cadastrado, responda: "📁 Não encontrei um link de pasta cadastrado para o Condomínio E." e NÃO inclua outros cartões.
5. CONTEXTO CONVERSACIONAL:
   - Se o usuário fizer uma pergunta de continuação (ex: "me fale mais", "qual horário?", "qual o link?", "e amanhã?", "e dele?"), responda considerando o compromisso, condomínio ou contato conversado na mensagem anterior.
6. TONALIDADE E ESTILO:
   - Responda em português do Brasil de forma direta, humana, amigável e clara.
   - Use parágrafos curtos, quebras de linha e emojis moderados (📞, 📅, 📁, 🔗, 👉, ⚠️).
   - Não use frases robóticas de bot como "Sou um assistente virtual projetado para...". Responda diretamente como parte da Triverus.`;
}

export function isValidUUID(str) {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());
}

export function formatDateBRBackend(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return `${m[3]}/${m[2]}/${m[1]}`;
  }
  return dateStr;
}

// Helper: Resolve human name reference to contacts / leads
export async function resolveHumanReferenceToLead(supabaseClient, params) {
  const { contact_name, lead_name, lead_id } = params || {};

  if (lead_id && isValidUUID(lead_id)) {
    const { data: lead } = await supabaseClient
      .from('leads')
      .select('id, name, temperature, administrator, unit_count, city, current_stage_id, responsible_user_id, address, notes')
      .eq('id', lead_id)
      .single();
    if (lead) {
      return { found: true, lead, source: 'lead_id' };
    }
  }

  if (lead_name && typeof lead_name === 'string' && lead_name.trim()) {
    const qName = lead_name.trim().toLowerCase();
    const { data: exactLeads } = await supabaseClient
      .from('leads')
      .select('id, name, temperature, administrator, unit_count, city, current_stage_id, responsible_user_id, address, notes')
      .ilike('name', qName);

    if (exactLeads && exactLeads.length === 1) {
      return { found: true, lead: exactLeads[0], source: 'lead_name_exact' };
    }

    const { data: partialLeads } = await supabaseClient
      .from('leads')
      .select('id, name, temperature, administrator, unit_count, city, current_stage_id, responsible_user_id, address, notes')
      .ilike('name', `%${qName}%`);

    if (partialLeads && partialLeads.length === 1) {
      return { found: true, lead: partialLeads[0], source: 'lead_name_partial' };
    }

    if (partialLeads && partialLeads.length > 1) {
      return {
        found: false,
        ambiguous: true,
        message: `Encontrei mais de um condomínio com "${lead_name}". Por favor, seja mais específico.`,
        options: partialLeads.map((l) => ({ id: l.id, name: l.name })),
      };
    }
  }

  if (contact_name && typeof contact_name === 'string' && contact_name.trim()) {
    const qContact = contact_name.trim().toLowerCase();
    const { data: contacts } = await supabaseClient
      .from('contacts')
      .select('id, name, role_title, phone, email')
      .ilike('name', `%${qContact}%`);

    if (contacts && contacts.length === 1) {
      const contact = contacts[0];
      const { data: lc } = await supabaseClient
        .from('lead_contacts')
        .select('lead_id')
        .eq('contact_id', contact.id)
        .limit(1);

      if (lc && lc.length > 0) {
        const { data: lead } = await supabaseClient
          .from('leads')
          .select('id, name, temperature, administrator, unit_count, city, current_stage_id, responsible_user_id, address, notes')
          .eq('id', lc[0].lead_id)
          .single();

        if (lead) {
          return { found: true, lead, contact, source: 'contact_name' };
        }
      }
      return { found: true, contact, source: 'contact_only' };
    }

    if (contacts && contacts.length > 1) {
      return {
        found: false,
        ambiguous: true,
        message: `Encontrei mais de um contato chamado "${contact_name}". Por favor, especifique o condomínio.`,
        options: contacts.map((c) => ({ id: c.id, name: c.name, role_title: c.role_title })),
      };
    }
  }

  return { found: false };
}

// Find current active follow-up for a lead
export async function findCurrentFollowUpForLead(supabaseClient, leadId) {
  const { data: interactions } = await supabaseClient
    .from('interactions')
    .select('id, lead_id, interaction_type, notes, occurred_at, next_follow_up_date')
    .eq('lead_id', leadId)
    .order('occurred_at', { ascending: false });

  if (!interactions || interactions.length === 0) {
    return { currentFollowUp: null, allInteractions: [] };
  }

  const withFollowUp = interactions.filter(
    (i) => i.next_follow_up_date && String(i.next_follow_up_date).trim() !== ''
  );

  const currentFollowUp = withFollowUp.length > 0 ? withFollowUp[0] : null;
  return { currentFollowUp, allInteractions: interactions };
}

// Helper: Search folder link for lead
export async function findFolderLinkForLead(supabaseClient, leadId, clientContext) {
  if (clientContext?.folderLinks && clientContext.folderLinks[leadId]) {
    const rawUrl = clientContext.folderLinks[leadId];
    if (typeof rawUrl === 'string' && /^https?:\/\//i.test(rawUrl.trim())) {
      const { data: lead } = await supabaseClient
        .from('leads')
        .select('name')
        .eq('id', leadId)
        .single();
      return { found: true, url: rawUrl.trim(), leadName: lead?.name || 'Condomínio' };
    }
  }

  const { data: lead } = await supabaseClient
    .from('leads')
    .select('id, name, address, notes')
    .eq('id', leadId)
    .single();

  if (lead) {
    if (lead.address && /^https?:\/\//i.test(lead.address.trim())) {
      return { found: true, url: lead.address.trim(), leadName: lead.name };
    }
    if (lead.notes) {
      const match = lead.notes.match(/(https?:\/\/[^\s<]+)/i);
      if (match) return { found: true, url: match[0], leadName: lead.name };
    }
  }

  const { data: ints } = await supabaseClient
    .from('interactions')
    .select('notes')
    .eq('lead_id', leadId)
    .order('occurred_at', { ascending: false });

  for (const item of ints || []) {
    if (item.notes) {
      const match = item.notes.match(/(https?:\/\/[^\s<]+)/i);
      if (match) return { found: true, url: match[0], leadName: lead?.name || 'Condomínio' };
    }
  }

  return { found: false, leadName: lead?.name || 'Condomínio' };
}

// CONDO READ-ONLY TOOLS DEFINITIONS
export const CONDO_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_crm',
      description: 'Buscar informações gerais no CRM (condomínios, temperaturas, estagios, contatos).',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Nome do condomínio, cidade, temperatura ou palavra-chave.',
          },
          entity: {
            type: 'string',
            enum: ['all', 'leads', 'contacts', 'followups'],
            description: 'Tipo de entidade a buscar.',
          },
          limit: {
            type: 'number',
            description: 'Quantidade máxima de resultados.',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_condominium',
      description: 'Obter detalhes completos de um condomínio específico.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nome do condomínio' },
          lead_id: { type: 'string', description: 'ID do condomínio' },
          contact_name: { type: 'string', description: 'Nome do contato associado' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_folder_link',
      description: 'Consultar exclusivamente o link da pasta do Google Drive ou documentos de um condomínio.',
      parameters: {
        type: 'object',
        properties: {
          lead_id: { type: 'string', description: 'ID do condomínio se disponível' },
          lead_name: { type: 'string', description: 'Nome do condomínio (ex: Condomínio E)' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_contact',
      description: 'Obter informações de um contato específico (telefone/WhatsApp, e-mail, cargo, condomínio vinculado).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nome do contato (ex: Henrique)' },
          contact_id: { type: 'string', description: 'ID do contato' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_followups',
      description: 'Listar agendamentos e follow-ups de contatos (vencidos, hoje, amanhã ou próximos).',
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            enum: ['overdue', 'today', 'tomorrow', 'upcoming', 'all'],
            description: 'Filtro de período do follow-up.',
          },
          contact_name: { type: 'string', description: 'Nome do contato para filtrar' },
          lead_name: { type: 'string', description: 'Nome do condomínio para filtrar' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_interactions',
      description: 'Obter histórico recente de notas e conversas de um condomínio.',
      parameters: {
        type: 'object',
        properties: {
          lead_name: { type: 'string', description: 'Nome do condomínio' },
          contact_name: { type: 'string', description: 'Nome do contato' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_services',
      description: 'Obter lista de serviços cadastrados na plataforma.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_crm_summary',
      description: 'Obter resumo consolidado das métricas do CRM (contagem por temperatura, total de condomínios, follow-ups vencidos e hoje).',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_platform_help',
      description: 'Consultar o guia de ajuda e tutoriais de como utilizar a plataforma Triverus (ex: "como cadastrar contato", "como alterar temperatura", "como ver followups", "como excluir condomínio").',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Assunto ou dúvida sobre como usar a plataforma Triverus.',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
];

// Execute Tool Call (Strict Read-Only)
export async function executeToolCall(
  name,
  args,
  supabaseClient,
  currentUserId,
  requestId,
  lastUserMessage,
  clientContext,
  snapshot
) {
  const maxLimit = Math.min(Number(args?.limit) || 10, 20);

  try {
    switch (name) {
      case 'get_folder_link': {
        let resolvedLead = null;
        if (snapshot) {
          const resRef = CRMReader.resolveReference(snapshot, args?.lead_name || args?.name || args?.lead_id);
          if (resRef.found && resRef.lead) resolvedLead = resRef.lead;
        }
        if (!resolvedLead) {
          const resolved = await resolveHumanReferenceToLead(supabaseClient, {
            lead_id: args?.lead_id,
            lead_name: args?.lead_name,
          });
          resolvedLead = resolved.lead;
        }

        if (!resolvedLead) {
          return {
            result: {
              found: false,
              message: `📁 Não encontrei um link de pasta cadastrado para este condomínio.`,
            },
            richResults: [],
          };
        }

        let folderInfo = { found: false, url: null };
        if (snapshot) {
          folderInfo = CRMReader.getLeadFolderLink(snapshot, resolvedLead.id);
        } else {
          folderInfo = await findFolderLinkForLead(supabaseClient, resolvedLead.id, clientContext);
        }

        if (folderInfo.found && folderInfo.url) {
          return {
            result: {
              found: true,
              condominium_name: resolvedLead.name,
              url: folderInfo.url,
            },
            richResults: [
              {
                type: 'link',
                title: `Pasta do ${resolvedLead.name}`,
                subtitle: 'Google Drive',
                url: folderInfo.url,
                value: folderInfo.url,
              },
            ],
            contextRefs: { lead: { id: resolvedLead.id, name: resolvedLead.name } },
          };
        }

        return {
          result: {
            found: false,
            message: `📁 Não encontrei um link de pasta cadastrado para o ${resolvedLead.name}.`,
          },
          richResults: [],
        };
      }

      case 'search_crm': {
        const q = (args?.query || '').trim();
        const entity = args?.entity || 'all';

        const tempNormalized = q.toLowerCase();
        const isGenericQuery =
          /^(condom[ií]nios|leads|contatos|todos|all|cadastrados|lista|quais|crm|follow-?ups|agendamentos)$/i.test(
            tempNormalized
          ) || tempNormalized.length === 0;

        const isTempQuery = ['quente', 'quentes', 'frio', 'frios', 'morno', 'mornos', 'cliente', 'clientes'].includes(
          tempNormalized
        );
        const targetTemp = tempNormalized.startsWith('quente')
          ? 'quente'
          : tempNormalized.startsWith('frio')
          ? 'frio'
          : tempNormalized.startsWith('morno')
          ? 'morno'
          : tempNormalized.startsWith('cliente')
          ? 'cliente'
          : null;

        const isNoFollowUpQuery = /(sem.*(follow|contato|retorno|próximo|agendamento))/i.test(q);
        const results = {};
        const richResults = [];

        if (entity === 'all' || entity === 'leads') {
          let leadsQuery = supabaseClient
            .from('leads')
            .select('id, name, temperature, administrator, unit_count, city, current_stage_id, responsible_user_id')
            .limit(maxLimit);

          if (targetTemp) {
            leadsQuery = leadsQuery.ilike('temperature', targetTemp);
          } else if (!isNoFollowUpQuery && !isGenericQuery && q.length > 0) {
            leadsQuery = leadsQuery.or(`name.ilike.%${q}%,administrator.ilike.%${q}%,city.ilike.%${q}%`);
          }

          const { data: leads } = await leadsQuery;
          if (isNoFollowUpQuery && leads) {
            const { data: ints } = await supabaseClient
              .from('interactions')
              .select('lead_id, next_follow_up_date')
              .not('next_follow_up_date', 'is', null);

            const todayStr = new Date().toISOString().split('T')[0];
            const leadsWithFutureFollowUp = new Set(
              (ints || [])
                .filter((i) => i.next_follow_up_date && i.next_follow_up_date >= todayStr)
                .map((i) => i.lead_id)
            );

            const matchedWithout = leads.filter((l) => !leadsWithFutureFollowUp.has(l.id)).slice(0, maxLimit);
            results.leads_without_next_follow_up = matchedWithout.map((l) => ({ id: l.id, name: l.name, temperature: l.temperature }));

            matchedWithout.forEach((l) => {
              richResults.push({
                type: 'lead',
                lead_id: l.id,
                title: l.name,
                city: l.city,
                temperature: l.temperature,
                unit_count: l.unit_count,
                next_follow_up_date_br: 'Sem agendamento',
              });
            });
          } else if (leads && leads.length > 0) {
            const enrichedLeads = await Promise.all(
              leads.map(async (l) => {
                const { currentFollowUp } = await findCurrentFollowUpForLead(supabaseClient, l.id);
                return {
                  ...l,
                  next_follow_up_date_br: currentFollowUp?.next_follow_up_date
                    ? formatDateBRBackend(currentFollowUp.next_follow_up_date)
                    : 'Sem agendamento',
                };
              })
            );
            results.leads = enrichedLeads;
            enrichedLeads.forEach((l) => {
              richResults.push({
                type: 'lead',
                lead_id: l.id,
                title: l.name,
                city: l.city,
                temperature: l.temperature,
                unit_count: l.unit_count,
                next_follow_up_date_br: l.next_follow_up_date_br,
              });
            });
          }
        }

        if (entity === 'all' || entity === 'contacts') {
          if (!isTempQuery && (isGenericQuery || q.length > 0)) {
            let cQuery = supabaseClient
              .from('contacts')
              .select('id, name, role_title, phone, email')
              .limit(maxLimit);

            if (!isGenericQuery && q.length > 0) {
              cQuery = cQuery.or(`name.ilike.%${q}%,role_title.ilike.%${q}%,phone.ilike.%${q}%`);
            }

            const { data: contacts } = await cQuery;
            if (contacts && contacts.length > 0) {
              results.contacts = contacts;
              for (const c of contacts) {
                if (c.phone) {
                  richResults.push({
                    type: 'whatsapp',
                    contact_id: c.id,
                    label: c.name,
                    subtitle: c.role_title || 'Contato',
                    value: c.phone,
                    display_value: c.phone,
                  });
                }
                if (c.email) {
                  richResults.push({
                    type: 'email',
                    contact_id: c.id,
                    label: c.name,
                    subtitle: c.role_title || 'Contato',
                    value: c.email,
                  });
                }
              }
            }
          }
        }

        return { result: results, richResults };
      }

      case 'get_condominium': {
        const resolved = await resolveHumanReferenceToLead(supabaseClient, {
          lead_id: args?.lead_id,
          lead_name: args?.name || args?.lead_name,
          contact_name: args?.contact_name,
        });

        if (resolved.ambiguous) {
          return { result: { ambiguous: true, message: resolved.message, options: resolved.options } };
        }

        if (!resolved.found || !resolved.lead) {
          return { result: { found: false, message: `Não encontrei esse condomínio no CRM.` } };
        }

        const leadRecord = resolved.lead;
        const contactsList = resolved.contacts || [];
        const { currentFollowUp } = await findCurrentFollowUpForLead(supabaseClient, leadRecord.id);

        // Check if last user prompt specifically asked for Drive/pasta only
        const promptLower = (lastUserMessage || '').toLowerCase();
        const isDriveQuery = promptLower.includes('drive') || promptLower.includes('pasta') || promptLower.includes('link da pasta');

        if (isDriveQuery) {
          const folderInfo = await findFolderLinkForLead(supabaseClient, leadRecord.id, clientContext);
          if (folderInfo.found && folderInfo.url) {
            return {
              result: {
                found: true,
                condominium_name: leadRecord.name,
                url: folderInfo.url,
              },
              richResults: [
                {
                  type: 'link',
                  title: `Pasta do ${leadRecord.name}`,
                  subtitle: 'Google Drive',
                  url: folderInfo.url,
                  value: folderInfo.url,
                },
              ],
            };
          }
          return {
            result: {
              found: false,
              message: `📁 Não encontrei um link de pasta cadastrado para o ${leadRecord.name}.`,
            },
            richResults: [],
          };
        }

        const richResults = [
          {
            type: 'lead',
            lead_id: leadRecord.id,
            title: leadRecord.name,
            city: leadRecord.city,
            temperature: leadRecord.temperature,
            unit_count: leadRecord.unit_count,
            next_follow_up_date_br: currentFollowUp?.next_follow_up_date
              ? formatDateBRBackend(currentFollowUp.next_follow_up_date)
              : 'Sem agendamento',
          },
        ];

        // Add drive folder link if available
        const folderInfo = await findFolderLinkForLead(supabaseClient, leadRecord.id, clientContext);
        if (folderInfo.found && folderInfo.url) {
          richResults.push({
            type: 'link',
            title: `Pasta do ${leadRecord.name}`,
            subtitle: 'Google Drive',
            url: folderInfo.url,
            value: folderInfo.url,
          });
        }

        // Add contacts rich cards
        contactsList.forEach((c) => {
          if (c.phone) {
            richResults.push({
              type: 'whatsapp',
              contact_id: c.id,
              label: c.name,
              subtitle: `${c.role_title || 'Contato'} · ${leadRecord.name}`,
              value: c.phone,
              display_value: c.phone,
            });
          }
          if (c.email) {
            richResults.push({
              type: 'email',
              contact_id: c.id,
              label: c.name,
              subtitle: `${c.role_title || 'Contato'} · ${leadRecord.name}`,
              value: c.email,
            });
          }
        });

        return {
          result: {
            found: true,
            condominium: {
              id: leadRecord.id,
              name: leadRecord.name,
              city: leadRecord.city,
              temperature: leadRecord.temperature,
              administrator: leadRecord.administrator,
              unit_count: leadRecord.unit_count,
              contacts: contactsList,
              next_follow_up_date_br: currentFollowUp?.next_follow_up_date
                ? formatDateBRBackend(currentFollowUp.next_follow_up_date)
                : 'Sem agendamento',
            },
          },
          richResults,
        };
      }

      case 'get_contact': {
        if (snapshot) {
          const resRef = CRMReader.resolveReference(snapshot, args?.name || args?.contact_name);
          if (resRef.found) {
            if (resRef.contact) {
              const c = resRef.contact;
              const leadContacts = snapshot.leadContacts || [];
              const lc = leadContacts.find((l) => l.contact_id === c.id);
              const linkedLead = lc ? (snapshot.leads || []).find((l) => l.id === lc.lead_id) : null;
              const linkedLeadName = linkedLead?.name || 'Condomínio';
              const richResults = [];

              if (c.phone) {
                richResults.push({
                  type: 'whatsapp',
                  contact_id: c.id,
                  label: c.name,
                  subtitle: `${c.role_title || 'Contato'} · ${linkedLeadName}`,
                  value: c.phone,
                  display_value: c.phone,
                });
              }
              if (c.email) {
                richResults.push({
                  type: 'email',
                  contact_id: c.id,
                  label: c.name,
                  subtitle: `${c.role_title || 'Contato'} · ${linkedLeadName}`,
                  value: c.email,
                });
              }

              return {
                result: {
                  found: true,
                  contact: c,
                  condominium_name: linkedLeadName,
                },
                richResults,
              };
            }

            if (resRef.type === 'mentions' && resRef.mentions) {
              const mentions = resRef.mentions;
              const richResults = [];
              if (mentions.matchedContacts?.length > 0) {
                for (const c of mentions.matchedContacts) {
                  if (c.phone) {
                    richResults.push({
                      type: 'whatsapp',
                      contact_id: c.id,
                      label: c.name,
                      subtitle: c.role_title || 'Contato',
                      value: c.phone,
                      display_value: c.phone,
                    });
                  }
                  if (c.email) {
                    richResults.push({
                      type: 'email',
                      contact_id: c.id,
                      label: c.name,
                      subtitle: c.role_title || 'Contato',
                      value: c.email,
                    });
                  }
                }
              }

              return {
                result: {
                  found: true,
                  is_mention_in_notes: true,
                  term: mentions.term,
                  mentioned_in_notes: mentions.matchedNotes || [],
                  matched_contacts: mentions.matchedContacts || [],
                  message: `Encontrei menções a "${mentions.term}" no histórico de interações da plataforma.`,
                },
                richResults,
              };
            }
          }
        }

        const resolved = await resolveHumanReferenceToLead(supabaseClient, {
          contact_name: args?.name || args?.contact_name,
        });

        if (resolved.ambiguous) {
          return { result: { ambiguous: true, message: resolved.message, options: resolved.options } };
        }

        if (!resolved.found || !resolved.contact) {
          return { result: { found: false, message: 'Contato não encontrado no CRM.' } };
        }

        const c = resolved.contact;
        const linkedLeadName = resolved.lead?.name || 'Condomínio';
        const richResults = [];

        if (c.phone) {
          richResults.push({
            type: 'whatsapp',
            contact_id: c.id,
            label: c.name,
            subtitle: `${c.role_title || 'Contato'} · ${linkedLeadName}`,
            value: c.phone,
            display_value: c.phone,
          });
        }
        if (c.email) {
          richResults.push({
            type: 'email',
            contact_id: c.id,
            label: c.name,
            subtitle: `${c.role_title || 'Contato'} · ${linkedLeadName}`,
            value: c.email,
          });
        }

        return {
          result: {
            found: true,
            contact: c,
            condominium_name: linkedLeadName,
          },
          richResults,
        };
      }

      case 'get_followups': {
        const filter = args.filter || 'all';

        if (snapshot) {
          let targetLeadId = null;
          if (args.contact_name || args.lead_name) {
            const resRef = CRMReader.resolveReference(snapshot, args.lead_name || args.contact_name);
            if (resRef.found && resRef.lead) {
              targetLeadId = resRef.lead.id;
            }
          }

          const followups = CRMReader.getLeadFollowups(snapshot, targetLeadId, filter);
          const sliced = followups.slice(0, maxLimit);

          const richResults = sliced.map((f) => ({
            type: 'followup',
            lead_id: f.lead_id,
            title: f.lead_name,
            subtitle: f.interaction_type || 'Contato Agendado',
            next_follow_up_date_br: f.next_follow_up_date_br || f.date,
            date: f.date,
            time: f.time,
            notes: f.notes,
            route: '/app/followups',
          }));

          return {
            result: {
              count: sliced.length,
              followups: sliced.map((f) => ({
                lead_name: f.lead_name,
                interaction_type: f.interaction_type,
                date: f.date,
                time: f.time || 'Não especificado',
                next_follow_up_date_br: f.next_follow_up_date_br,
                notes: f.notes,
              })),
            },
            richResults,
          };
        }

        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tmrStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

        let filterLeadId = null;
        if (args.contact_name || args.lead_name) {
          const resolved = await resolveHumanReferenceToLead(supabaseClient, {
            contact_name: args.contact_name,
            lead_name: args.lead_name,
          });
          if (resolved.found && resolved.lead) {
            filterLeadId = resolved.lead.id;
          }
        }

        let intQuery = supabaseClient
          .from('interactions')
          .select('id, lead_id, interaction_type, notes, occurred_at, next_follow_up_date')
          .not('next_follow_up_date', 'is', null);

        if (filterLeadId) intQuery = intQuery.eq('lead_id', filterLeadId);

        const { data: allFollowUps } = await intQuery;
        const latestByLead = new Map();

        for (const item of allFollowUps || []) {
          if (!item.next_follow_up_date || String(item.next_follow_up_date).trim() === '') continue;
          const prev = latestByLead.get(item.lead_id);
          if (!prev || new Date(item.occurred_at || 0).getTime() >= new Date(prev.occurred_at || 0).getTime()) {
            latestByLead.set(item.lead_id, item);
          }
        }

        const filtered = Array.from(latestByLead.values()).filter((f) => {
          const datePrefix = String(f.next_follow_up_date).trim().slice(0, 10);
          if (filter === 'overdue') return datePrefix < todayStr;
          if (filter === 'today') return datePrefix === todayStr;
          if (filter === 'tomorrow') return datePrefix === tmrStr;
          if (filter === 'upcoming') return datePrefix >= todayStr;
          return true;
        });

        const sliced = filtered.slice(0, maxLimit);
        const leadIds = Array.from(new Set(sliced.map((f) => f.lead_id)));
        const leadMap = new Map();

        if (leadIds.length > 0) {
          const { data: leadsData } = await supabaseClient.from('leads').select('id, name').in('id', leadIds);
          (leadsData || []).forEach((l) => leadMap.set(l.id, l.name));
        }

        const richResults = sliced.map((f) => ({
          type: 'followup',
          lead_id: f.lead_id,
          title: leadMap.get(f.lead_id) || 'Condomínio',
          subtitle: f.interaction_type || 'Contato Agendado',
          next_follow_up_date_br: formatDateBRBackend(f.next_follow_up_date),
          notes: f.notes,
          route: '/app/followups',
        }));

        return {
          result: {
            count: sliced.length,
            followups: sliced.map((f) => ({
              lead_name: leadMap.get(f.lead_id) || 'Condomínio',
              interaction_type: f.interaction_type,
              next_follow_up_date_br: formatDateBRBackend(f.next_follow_up_date),
            })),
          },
          richResults,
        };
      }

      case 'get_interactions': {
        if (snapshot) {
          const resRef = CRMReader.resolveReference(snapshot, args?.lead_name || args?.contact_name);
          if (resRef.found && resRef.lead) {
            const notes = CRMReader.getLeadNotes(snapshot, resRef.lead.id);
            return {
              result: {
                condominium_name: resRef.lead.name,
                interactions: notes.slice(0, 5).map((n) => {
                  const { date, time } = CRMReader.parseDateTime(n.occurred_at);
                  const parsedFollow = n.next_follow_up_date ? CRMReader.parseDateTime(n.next_follow_up_date) : null;
                  return {
                    interaction_type: n.interaction_type || 'Nota',
                    notes: n.notes || n.text || '',
                    occurred_at_br: time ? `${date} às ${time}` : date,
                    next_follow_up_date_br: parsedFollow ? (parsedFollow.time ? `${parsedFollow.date} às ${parsedFollow.time}` : parsedFollow.date) : null,
                  };
                }),
              },
            };
          }
        }

        const resolved = await resolveHumanReferenceToLead(supabaseClient, {
          contact_name: args?.contact_name,
          lead_name: args?.lead_name,
        });

        if (resolved.found && resolved.lead) {
          const { allInteractions } = await findCurrentFollowUpForLead(supabaseClient, resolved.lead.id);
          return {
            result: {
              condominium_name: resolved.lead.name,
              interactions: allInteractions.slice(0, 5).map((i) => ({
                interaction_type: i.interaction_type,
                notes: i.notes,
                occurred_at_br: formatDateBRBackend(i.occurred_at),
                next_follow_up_date_br: formatDateBRBackend(i.next_follow_up_date),
              })),
            },
          };
        }

        return { result: { found: false, message: 'Não encontrei histórico de notas.' } };
      }

      case 'get_services': {
        const { data: services } = await supabaseClient.from('services').select('id, name, title');
        return { result: { count: services?.length || 0, services: services || [] } };
      }

      case 'get_crm_summary': {
        if (snapshot) {
          const leads = snapshot.leads || [];
          const stages = snapshot.stages || [];
          const stageMap = new Map(stages.map((s) => [s.id, s.name]));

          const countsByStage = {};
          stages.forEach((s) => {
            countsByStage[s.name] = 0;
          });

          leads.forEach((l) => {
            const stgName = l.current_stage_id ? stageMap.get(l.current_stage_id) || 'Início' : 'Início';
            countsByStage[stgName] = (countsByStage[stgName] || 0) + 1;
          });

          return {
            result: {
              total_condominios: leads.length,
              por_estagio: countsByStage,
            },
          };
        }

        const { data: leads } = await supabaseClient.from('leads').select('id, current_stage_id');
        const { data: stages } = await supabaseClient.from('pipeline_stages').select('id, name').order('position');
        const stageMap = new Map((stages || []).map((s) => [s.id, s.name]));

        const countsByStage = {};
        (stages || []).forEach((s) => {
          countsByStage[s.name] = 0;
        });

        (leads || []).forEach((l) => {
          const stgName = l.current_stage_id ? stageMap.get(l.current_stage_id) || 'Início' : 'Início';
          countsByStage[stgName] = (countsByStage[stgName] || 0) + 1;
        });

        return {
          result: {
            total_condominios: leads?.length || 0,
            por_estagio: countsByStage,
          },
        };
      }

      case 'search_platform_help': {
        const query = (args?.query || '').trim();
        const helpMatches = searchPlatformHelp(query);

        if (helpMatches.length === 0) {
          return {
            result: {
              found: false,
              message: 'Não encontrei uma instrução cadastrada para isso.',
            },
            richResults: [],
          };
        }

        const top = helpMatches[0];
        const richResults = [
          {
            type: 'help',
            title: top.title,
            steps: top.steps,
            route: top.route,
            target: top.target,
            image: top.image,
            imageHighlight: top.imageHighlight,
          },
        ];

        return {
          result: {
            found: true,
            title: top.title,
            steps: top.steps,
            route: top.route,
            target: top.target,
          },
          richResults,
        };
      }

      default:
        return { result: { error: 'Ferramenta desconhecida.' } };
    }
  } catch (err) {
    return { result: { error: err?.message || 'Erro ao consultar CRM.' } };
  }
}
