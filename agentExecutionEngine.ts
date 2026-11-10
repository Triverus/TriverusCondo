import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import OpenAI from 'openai';
import type { AgentSlotData, BrainProfile } from './src/types/agentBuilder.ts';
import { ToolRegistry, type ToolContext } from './src/tools/registry.ts';
import { resolveModelCapability, type ModelCapability, markModelAsOperational, checkModelCapabilityForAgent } from './modelCatalogService.ts';
import { getTodayBRISO } from './crmTools.ts';

export interface ExecutionOptions {
  agent: AgentSlotData;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  clientContext?: any;
  snapshot?: any;
  toolContext?: ToolContext;
}

export interface ExecutionResult {
  ok: boolean;
  text: string;
  modelUsed: string;
  providerUsed: 'google' | 'openai' | 'fallback';
  brainProfileUsed: BrainProfile;
  error?: string;
  results?: any[];
}

/**
 * Extrai e valida representações estruturadas de registros reais obtidos exclusivamente
 * pelas ferramentas, garantindo que não sejam fabricados registros e que perguntas curtas
 * ou simples não gerem cards desnecessários.
 */
export function extractStructuredResults(
  collectedToolResults: any[],
  userPrompt: string
): any[] {
  if (!Array.isArray(collectedToolResults) || collectedToolResults.length === 0) {
    return [];
  }

  const promptNorm = (userPrompt || '').toLowerCase();
  // Se for apenas pergunta de contagem simples, não gerar cards
  const isSimpleCountQuery = /^(quantos|quantas|total|qual a quantidade|numero de|número de)/i.test(promptNorm.trim()) &&
    !promptNorm.includes('liste') &&
    !promptNorm.includes('mostre') &&
    !promptNorm.includes('quais') &&
    !promptNorm.includes('veja');

  if (isSimpleCountQuery) {
    return [];
  }

  const structuredItems: any[] = [];
  const seenIds = new Set<string>();

  for (const tRes of collectedToolResults) {
    if (!tRes || typeof tRes !== 'object') continue;

    // 1. Interações / Reuniões / Follow-ups
    if (Array.isArray(tRes.interacoes)) {
      for (const item of tRes.interacoes) {
        if (!item || !item.id || seenIds.has(item.id)) continue;
        seenIds.add(item.id);

        const condoTitle = item.lead_name || 'Condomínio';
        const typeStr = item.interaction_type || 'Interação';
        const dateStr = item.next_follow_up_date_br || item.occurred_at_br || '';
        const notesStr = item.notes || '';

        // Se for follow-up agendado com data futura ou hoje
        if (item.next_follow_up_date || item.next_follow_up_at) {
          structuredItems.push({
            type: 'followup',
            id: item.id,
            lead_id: item.lead_id,
            title: condoTitle,
            subtitle: typeStr,
            next_follow_up_date_br: dateStr,
            notes: notesStr,
            status: item.followup_status || (item.is_today ? 'hoje' : 'agendado'),
          });
        } else {
          structuredItems.push({
            type: 'interaction',
            id: item.id,
            lead_id: item.lead_id,
            title: condoTitle,
            interactionType: typeStr,
            interaction_type: typeStr,
            date: dateStr,
            description: notesStr,
            notes: notesStr,
          });
        }
      }
    }

    // 2. Condomínios / Clientes
    if (Array.isArray(tRes.condominios)) {
      const isListRequest = promptNorm.includes('liste') || promptNorm.includes('quais') || promptNorm.includes('mostre') || promptNorm.includes('ver');
      if (isListRequest) {
        for (const c of tRes.condominios) {
          if (!c || !c.id || seenIds.has(c.id)) continue;
          seenIds.add(c.id);

          structuredItems.push({
            type: 'lead',
            id: c.id,
            lead_id: c.id,
            title: c.name || 'Condomínio',
            label: c.name || 'Condomínio',
            city: c.city || '',
            unit_count: c.unit_count,
            stage_name: c.stage_name || c.stage_category || 'Carteira',
          });
        }
      }
    }
  }

  return structuredItems;
}

/**
 * Resolve o modelo canônico e suas capacidades a partir do catálogo dinâmico.
 * Se o modelo não estiver configurado ou for inválido, retorna estado não-válido sem substituição silenciosa.
 */
export function resolveModelInfo(modelId?: string): {
  isValid: boolean;
  provider: 'google' | 'openai' | null;
  canonicalModel: string;
  displayName: string;
  capability: ModelCapability | null;
} {
  const capability = resolveModelCapability(modelId);
  return {
    isValid: capability.isValid,
    provider: capability.provider,
    canonicalModel: capability.canonicalModel,
    displayName: capability.displayName,
    capability: capability.model,
  };
}

/**
 * Mapeia o perfil de inteligência do Cérebro para parâmetros reais de execução.
 */
export function resolveBrainParameters(profile?: BrainProfile): {
  maxOutputTokens: number;
  thinkingLevel: ThinkingLevel;
  profileLabel: string;
} {
  switch (profile) {
    case 'economic':
    case 'economico':
      return {
        maxOutputTokens: 1024,
        thinkingLevel: ThinkingLevel.LOW,
        profileLabel: 'Econômico (Respostas rápidas e alta eficiência de tokens)',
      };
    case 'advanced':
    case 'avancado':
      return {
        maxOutputTokens: 4096,
        thinkingLevel: ThinkingLevel.HIGH,
        profileLabel: 'Avançado (Raciocínio profundo e orçamento ampliado)',
      };
    case 'balanced':
    case 'equilibrado':
    default:
      return {
        maxOutputTokens: 2048,
        thinkingLevel: ThinkingLevel.MEDIUM,
        profileLabel: 'Equilibrado (Balanceamento entre capacidade e concisão)',
      };
  }
}

/**
 * Constrói o System Prompt preservando rigorosamente as regras Triverus, identidade do agente e metadados reais.
 */
export function buildAgentSystemPrompt(
  agent: AgentSlotData,
  modelDisplayName: string,
  brainProfileLabel: string,
  providerDisplayName: string
): string {
  const todayISO = getTodayBRISO();
  const [yyyy, mm, dd] = todayISO.split('-');
  const todayBR = `${dd}/${mm}/${yyyy}`;

  const agentName = agent.name?.trim() || 'Agente Triverus';
  const agentRole = agent.role?.trim() || 'Especialista em Gestão e Auditoria';
  const customPrompt = agent.prompt?.trim()
    ? `\nDIRETRIZES E PROMPT PERSONALIZADO DO AGENTE:\n${agent.prompt.trim()}\n`
    : '';

  return `Você é ${agentName}, ${agentRole}.${customPrompt}
Data atual do sistema: ${todayBR} (${todayISO}, ano vigente: ${yyyy}, fuso horário America/Sao_Paulo).

METADADOS DE EXECUÇÃO EM TEMPO REAL DA PLATAFORMA:
- Nome do Agente: ${agentName}
- Função: ${agentRole}
- Modelo de Linguagem em Execução: ${modelDisplayName}
- Perfil de Inteligência (Cérebro): ${brainProfileLabel}
- Provedor de IA: ${providerDisplayName}
Quando o usuário perguntar qual modelo de linguagem, cérebro ou inteligência artificial você está utilizando nesta conversa, responda com precisão informando exatamente estes metadados de execução.

REGRAS CRÍTICAS DE COMPOSIÇÃO DE MENSAGEM TRIVERUS:
1. VOCÊ É 100% READ-ONLY (APENAS LEITURA): Você NÃO possui ferramentas de gravação/edição/exclusão no CRM.
2. Se o usuário pedir qualquer alteração no CRM (ex: "Mude Condomínio F para Quente", "Crie um contato"), responda objetivamente: "Essa alteração é feita diretamente no Pipeline."
3. COMPLEMENTARIDADE OBRIGATÓRIA: Se houver cartões estruturados (Rich Results), não repita dados telefônicos ou e-mails no texto.
4. TONALIDADE: Responda em português do Brasil de forma direta, humana, profissional e clara.
5. ISOLAMENTO DE IDENTIDADE: Responda SEMPRE com a identidade de ${agentName} (${agentRole}). Nunca finja ser outro assistente.
6. CONSULTAS DE CRM (CLIENTES, OPORTUNIDADES, REUNIÕES E FOLLOW-UPS):
- CLASSIFICAÇÃO COMERCIAL REAL NO CRM TRIVERUS:
  * "Clientes" = condomínios cujo estágio possui is_won = true (etapa de conversão do CRM, ex: "Assinatura do contrato"). NUNCA use o nome literal "Cliente" para buscar no banco.
  * "Oportunidades em aberto" (leads em negociação) = condomínios com is_won = false e is_lost = false.
  * "Oportunidades perdidas" = condomínios com is_lost = true.
  * "Total da carteira CRM" = todos os registros na tabela leads aos quais o usuário tem acesso.
  * À pergunta "Quantos clientes tenho?", responda direta e precisamente a quantidade de clientes convertidos (clientes_count / is_won=true). Não crie listas nem cards para essa pergunta simples de contagem.
  * À pergunta "Quantos clientes, oportunidades em aberto e perdidas tenho?" ou similares de contagem comercial, informe os números exatos retornados pelas ferramentas ('clientes_count', 'oportunidades_abertas_count', 'oportunidades_perdidas_count', 'total_leads_no_crm') de forma limpa e direta em texto. Exemplo: "Você possui **X clientes convertidos**, **Y oportunidades em aberto** e **Z oportunidades perdidas** de um total de **N condomínios** no CRM."
- CONSULTAS DE FOLLOW-UPS VENCIDOS E HISTÓRICO:
  * Ao ser perguntado por pendências, follow-ups vencidos ou compromissos atrasados (ex: "Quais follow-ups estão vencidos?", "O que tenho pendente?"), use 'search_interactions' com filter: "overdue" ou "vencidos".
  * Não confunda históricos de reuniões passadas com follow-ups pendentes com data agendada vencida.
- CONSULTAS GERAIS DE REUNIÕES OU COMPROMISSOS (REGRA OBRIGATÓRIA):
  * Quando o usuário fizer uma pergunta ampla sobre compromissos ou reuniões (ex: "Tenho alguma reunião ou follow-up hoje?", "Alguma reunião hoje?", "Quais minhas reuniões hoje?"):
    - NUNCA exija, solicite ou pergunte o nome de um condomínio.
    - Acione IMEDIATAMENTE a ferramenta 'search_interactions' (ou 'crm_get_interactions') informando filter: "today" e SEM passar condoId. A ferramenta consultará automaticamente todos os registros autorizados da carteira de condomínios.
    - Se a consulta retornar zero registros (count: 0), responda com clareza e objetividade que não há reuniões ou follow-ups agendados para hoje na carteira.
- CONSULTAS ESPECÍFICAS DE CONDOMÍNIO:
  * Se o usuário especificar um condomínio (ex: "reuniões do Lagoinha") ou se a pergunta for continuação imediata sobre um condomínio já citado, passe seu nome ou ID no parâmetro condoId das ferramentas.
- TRATAMENTO DE FALHAS (REGRA CRÍTICA):
  * Se a ferramenta de CRM retornar erro ('ok: false' ou mensagem de falha/indisponibilidade), NUNCA afirme que não há reuniões ou que a agenda está livre.
  * Informe com honestidade que o serviço de consulta ao CRM está temporariamente indisponível e oriente o usuário a tentar novamente em instantes.
7. DIRETRIZES GLOBAIS DE APRESENTAÇÃO E ESTRUTURA VISUAL DA RESPOSTA:
   - QUANDO RETORNAR RESULTADOS ESTRUTURADOS (interações, reuniões, condomínios, follow-ups, contatos) QUE GERAM CARTÕES INTERATIVOS NA INTERFACE:
     * Forneça APENAS uma breve frase introdutória em texto de 1 linha (ex: "Localizei as seguintes 5 interações no CRM:").
     * É SEVERAMENTE PROIBIDO DUPLICAR OS REGISTROS NO CORPO DO TEXTO MARKDOWN EM FORMA DE LISTAS COM MARCADORES (-) OU NÚMEROS. Deixe a renderização visual dos detalhes exclusivamente a cargo dos cartões estruturados que a interface renderiza.
   - Para respostas puramente conceituais, análises, orientações ou respostas de contagem sem cartões estruturados:
     * Responda de forma direta, clara e bem formatada em texto simples, separando tópicos em parágrafos sem espaçamentos verticais excessivos ou blocos gigantes.
   - NUNCA adicione dados ou seções fictícias apenas para preencher espaço; utilize estritamente os dados reais consultados.
   - Preserve integralmente a identidade e o escopo de atuação do agente (${agentName}).`;
}

/**
 * Executa a inferência utilizando a camada de roteamento multi-provedor (Google GenAI ou OpenAI) adaptada às capacidades do modelo e do agente.
 */
export async function executeAgentChat(options: ExecutionOptions): Promise<ExecutionResult> {
  const { agent, messages, toolContext } = options;

  // 0. Validação de modelo configurado
  if (!agent.modelId || !agent.modelId.trim()) {
    const errorText = `⚠️ O agente **${agent.name}** ainda não possui um modelo de inteligência configurado. Um administrador precisa selecionar um modelo válido nas configurações do agente.`;
    return {
      ok: false,
      providerUsed: 'fallback',
      modelUsed: 'Não configurado',
      brainProfileUsed: agent.brainProfile || 'equilibrado',
      text: errorText,
      error: 'unsupported_or_missing_model',
    };
  }

  // 1. Validação estrita de compatibilidade entre o modelo selecionado e as capacidades do agente
  const capCheck = checkModelCapabilityForAgent(agent.modelId, agent.capabilities);
  if (!capCheck.isCompatible) {
    const errorText = `⚠️ Incompatibilidade de Modelo: ${capCheck.reason || 'O modelo selecionado não suporta as capacidades ativas do agente.'} Escolha outro modelo no Construtor de Agentes.`;

    return {
      ok: false,
      providerUsed: 'fallback',
      modelUsed: capCheck.displayName || agent.modelId || 'Não configurado',
      brainProfileUsed: agent.brainProfile || 'equilibrado',
      text: errorText,
      error: 'model_capability_incompatible',
    };
  }

  const modelInfo = resolveModelInfo(agent.modelId);

  if (!modelInfo.isValid || !modelInfo.provider) {
    const errorText = `⚠️ O modelo de inteligência **${agent.modelId}** configurado para o agente **${agent.name}** não é compatível com o catálogo do motor. Um administrador precisa selecionar um modelo válido.`;

    return {
      ok: false,
      providerUsed: 'fallback',
      modelUsed: modelInfo.displayName,
      brainProfileUsed: agent.brainProfile || 'equilibrado',
      text: errorText,
      error: 'unsupported_or_missing_model',
    };
  }

  const brainParams = resolveBrainParameters(agent.brainProfile);
  const providerDisplayName = modelInfo.provider === 'google' ? 'Google GenAI' : 'OpenAI';
  const systemPrompt = buildAgentSystemPrompt(
    agent,
    modelInfo.displayName,
    brainParams.profileLabel,
    providerDisplayName
  );

  // Filtragem rigorosa de ferramentas baseada nas capacidades habilitadas para este agente
  const agentCapabilities = agent.capabilities || {
    crm: false,
    auditoria: false,
    google_drive: false,
    memorias: false,
    agenda: false,
  };

  const allowedTools = ToolRegistry.getAllTools().filter(
    (t) => !t.capabilityKey || Boolean(agentCapabilities[t.capabilityKey])
  );

  const activeToolContext: ToolContext = {
    ...(toolContext || { userId: 'anonymous' }),
    agentCapabilities,
    agentName: agent.name,
    agentModelId: agent.modelId,
    agent,
  };

  const capability = modelInfo.capability;

  // 1. EXECUÇÃO VIA GOOGLE GENAI SDK
  if (modelInfo.provider === 'google') {
    const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim();

    if (!apiKey) {
      return {
        ok: false,
        providerUsed: 'fallback',
        modelUsed: modelInfo.displayName,
        brainProfileUsed: agent.brainProfile || 'equilibrado',
        text: `⚠️ O modelo de inteligência **${modelInfo.displayName}** para o agente **${agent.name}** está temporariamente indisponível (chave de API não configurada no servidor).`,
        error: 'gemini_api_key_missing',
      };
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const historyContents: any[] = messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      const genConfig: any = {
        systemInstruction: systemPrompt,
        maxOutputTokens: brainParams.maxOutputTokens,
      };

      if (capability?.supportsTools === true && allowedTools.length > 0) {
        genConfig.tools = [{ functionDeclarations: ToolRegistry.toGeminiTools(allowedTools) }];
      }

      if (capability?.supportsThinking) {
        genConfig.thinkingConfig = {
          thinkingLevel: brainParams.thinkingLevel,
        };
      }

      let iterationCount = 0;
      const MAX_ITERATIONS = 5;
      let finalContent: string | null = null;
      let lastToolName = '';
      let totalRecordsReturned = 0;
      const collectedToolResults: any[] = [];

      const currentContents: any[] = [...historyContents];

      while (iterationCount < MAX_ITERATIONS) {
        iterationCount++;
        const response = await ai.models.generateContent({
          model: modelInfo.canonicalModel,
          contents: currentContents,
          config: genConfig,
        });

        const functionCalls = response.functionCalls;
        if (functionCalls && functionCalls.length > 0 && capability?.supportsTools === true && allowedTools.length > 0) {
          const candidateContent = response.candidates?.[0]?.content;
          if (candidateContent) {
            currentContents.push(candidateContent);
          }

          const responseParts: any[] = [];
          for (const call of functionCalls) {
            const toolName = call.name || '';
            lastToolName = toolName;
            const toolResult = await ToolRegistry.executeTool(toolName, call.args, activeToolContext);

            if (toolResult) {
              collectedToolResults.push(toolResult);
              if (typeof toolResult.count === 'number') {
                totalRecordsReturned += toolResult.count;
              } else if (Array.isArray(toolResult.condominios)) {
                totalRecordsReturned += toolResult.condominios.length;
              } else if (Array.isArray(toolResult.contatos)) {
                totalRecordsReturned += toolResult.contatos.length;
              } else if (toolResult.condominio) {
                totalRecordsReturned += 1;
              }
            }

            responseParts.push({
              functionResponse: {
                id: call.id || '',
                name: toolName,
                response: { result: toolResult },
              },
            });
          }

          currentContents.push({
            role: 'user',
            parts: responseParts,
          });
        } else {
          finalContent = response.text || null;
          break;
        }
      }

      if (!finalContent || !finalContent.trim()) {
        const synthConfig = { ...genConfig };
        delete synthConfig.tools;
        const synthResponse = await ai.models.generateContent({
          model: modelInfo.canonicalModel,
          contents: [
            ...currentContents,
            {
              role: 'user',
              parts: [{ text: 'Por favor, elabore uma resposta clara e objetiva em português apresentando os dados e resultados encontrados na consulta.' }],
            },
          ],
          config: synthConfig,
        });
        finalContent = synthResponse.text || null;
      }

      const ok = Boolean(finalContent && finalContent.trim());
      const responseText = ok
        ? finalContent!.trim()
        : `⚠️ Não foi possível sintetizar a resposta com os dados consultados. Por favor, tente novamente.`;

      const lastUserMsg = messages.filter((m) => m.role === 'user').pop()?.content || '';
      const structuredResults = extractStructuredResults(collectedToolResults, lastUserMsg);

      console.log('[AgentEngine Execution Log]', {
        requestId: options.clientContext?.requestId || 'req_local',
        agentId: agent.id,
        modelId: modelInfo.canonicalModel,
        provider: 'google',
        toolName: lastToolName || 'none',
        recordCount: totalRecordsReturned,
        structuredCount: structuredResults.length,
        iterations: iterationCount,
        ok,
        error: ok ? null : 'empty_final_content',
      });

      if (ok) {
        markModelAsOperational(agent.modelId || modelInfo.canonicalModel);
      }

      return {
        ok,
        text: responseText,
        modelUsed: modelInfo.displayName,
        providerUsed: 'google',
        brainProfileUsed: agent.brainProfile || 'equilibrado',
        results: structuredResults,
        error: ok ? undefined : 'empty_final_content',
      };
    } catch (err: any) {
      console.warn(`[AgentEngine Google Error] Agente: ${agent.name}, Modelo: ${modelInfo.displayName}:`, err?.message || err);

      return {
        ok: false,
        providerUsed: 'fallback',
        modelUsed: modelInfo.displayName,
        brainProfileUsed: agent.brainProfile || 'equilibrado',
        text: `⚠️ O modelo de inteligência **${modelInfo.displayName}** para o agente **${agent.name}** está temporariamente indisponível devido a limite de cota ou instabilidade na API do Google GenAI. Por favor, tente novamente em instantes.`,
        error: err?.message || 'google_genai_error',
      };
    }
  }

  // 2. EXECUÇÃO VIA OPENAI SDK
  if (modelInfo.provider === 'openai') {
    const apiKey = (process.env.OPENAI_API_KEY || '').trim();

    if (!apiKey) {
      return {
        ok: false,
        providerUsed: 'fallback',
        modelUsed: modelInfo.displayName,
        brainProfileUsed: agent.brainProfile || 'equilibrado',
        text: `⚠️ O modelo de inteligência **${modelInfo.displayName}** para o agente **${agent.name}** está temporariamente indisponível (chave OpenAI não configurada no servidor).`,
        error: 'openai_api_key_missing',
      };
    }

    try {
      const openai = new OpenAI({ apiKey, timeout: 25000 });

      const isReasoning = capability?.supportsThinking === true;
      const conversationMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

      if (!isReasoning) {
        conversationMessages.push({ role: 'system', content: systemPrompt });
      }

      for (const m of messages) {
        conversationMessages.push({
          role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: m.content,
        });
      }

      const requestPayload: any = {
        model: modelInfo.canonicalModel,
        messages: conversationMessages,
        max_completion_tokens: brainParams.maxOutputTokens,
      };

      if (capability?.supportsTemperature !== false) {
        requestPayload.temperature = 0.3;
      }

      if (capability?.supportsTools === true && allowedTools.length > 0) {
        requestPayload.tools = ToolRegistry.toOpenAITools(allowedTools);
      }

      let iterationCount = 0;
      const MAX_ITERATIONS = 5;
      let finalContent: string | null = null;
      let lastToolName = '';
      let totalRecordsReturned = 0;
      const collectedToolResults: any[] = [];

      while (iterationCount < MAX_ITERATIONS) {
        iterationCount++;
        const response = await openai.chat.completions.create(requestPayload);
        const responseMsg = response.choices?.[0]?.message;

        if (!responseMsg) {
          break;
        }

        const toolCalls = responseMsg.tool_calls;
        if (toolCalls && toolCalls.length > 0 && capability?.supportsTools === true && allowedTools.length > 0) {
          conversationMessages.push(responseMsg);

          for (const call of (toolCalls as any[])) {
            if (call.function) {
              const fnName = call.function.name;
              lastToolName = fnName;
              let parsedArgs = {};
              try {
                parsedArgs = JSON.parse(call.function.arguments || '{}');
              } catch {}

              const toolResult = await ToolRegistry.executeTool(fnName, parsedArgs, activeToolContext);

              if (toolResult) {
                collectedToolResults.push(toolResult);
                if (typeof toolResult.count === 'number') {
                  totalRecordsReturned += toolResult.count;
                } else if (Array.isArray(toolResult.condominios)) {
                  totalRecordsReturned += toolResult.condominios.length;
                } else if (Array.isArray(toolResult.contatos)) {
                  totalRecordsReturned += toolResult.contatos.length;
                } else if (toolResult.condominio) {
                  totalRecordsReturned += 1;
                }
              }

              conversationMessages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(toolResult),
              });
            }
          }
        } else {
          finalContent = responseMsg.content || null;
          break;
        }
      }

      if (!finalContent || !finalContent.trim()) {
        const synthesisMessages = [...conversationMessages];
        synthesisMessages.push({
          role: 'user',
          content: 'Por favor, elabore uma resposta clara e objetiva em português apresentando os dados e resultados encontrados na consulta.',
        });

        const synthesisPayload: any = {
          model: modelInfo.canonicalModel,
          messages: synthesisMessages,
          max_completion_tokens: brainParams.maxOutputTokens,
        };
        if (capability?.supportsTemperature !== false) {
          synthesisPayload.temperature = 0.3;
        }

        const synthResponse = await openai.chat.completions.create(synthesisPayload);
        finalContent = synthResponse.choices?.[0]?.message?.content || null;
      }

      const ok = Boolean(finalContent && finalContent.trim());
      const responseText = ok
        ? finalContent!.trim()
        : `⚠️ Não foi possível sintetizar a resposta com os dados consultados. Por favor, tente novamente.`;

      const lastUserMsg = messages.filter((m) => m.role === 'user').pop()?.content || '';
      const structuredResults = extractStructuredResults(collectedToolResults, lastUserMsg);

      console.log('[AgentEngine Execution Log]', {
        requestId: options.clientContext?.requestId || 'req_local',
        agentId: agent.id,
        modelId: modelInfo.canonicalModel,
        provider: 'openai',
        toolName: lastToolName || 'none',
        recordCount: totalRecordsReturned,
        structuredCount: structuredResults.length,
        iterations: iterationCount,
        ok,
        error: ok ? null : 'empty_final_content',
      });

      if (ok) {
        markModelAsOperational(agent.modelId || modelInfo.canonicalModel);
      }

      return {
        ok,
        text: responseText,
        modelUsed: modelInfo.displayName,
        providerUsed: 'openai',
        brainProfileUsed: agent.brainProfile || 'equilibrado',
        results: structuredResults,
        error: ok ? undefined : 'empty_final_content',
      };
    } catch (err: any) {
      console.warn(`[AgentEngine OpenAI Error] Agente: ${agent.name}, Modelo: ${modelInfo.displayName}:`, err?.message || err);

      return {
        ok: false,
        providerUsed: 'fallback',
        modelUsed: modelInfo.displayName,
        brainProfileUsed: agent.brainProfile || 'equilibrado',
        text: `⚠️ O modelo de inteligência **${modelInfo.displayName}** para o agente **${agent.name}** está temporariamente indisponível devido a limite de cota ou instabilidade na API do provedor OpenAI. Por favor, tente novamente em instantes.`,
        error: err?.message || 'openai_error',
      };
    }
  }

  return {
    ok: false,
    providerUsed: 'fallback',
    modelUsed: modelInfo.displayName,
    brainProfileUsed: agent.brainProfile || 'equilibrado',
    text: `⚠️ Provedor de inteligência não localizado para o modelo ${modelInfo.displayName}.`,
    error: 'unknown_provider',
  };
}
