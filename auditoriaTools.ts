import { GoogleGenAI } from '@google/genai';
import { ToolRegistry, type ToolContext } from './src/tools/registry.ts';
import { resolveUserAuth, resolveLeadId, removeAccents } from './crmTools.ts';
import { getDriveFileStream } from './googleDriveService.ts';
import { checkModelCapabilityForAgent } from './modelCatalogService.ts';
import { searchDocumentContent, readDocumentSection } from './auditoriaIndexService.ts';

// ----------------------------------------------------------------------------
// INTERFACES E METADADOS
// ----------------------------------------------------------------------------

export interface AuditoriaMemoryItem {
  id: string;
  condo_id: string;
  category: string;
  label: string;
  fill_mode: 'manual' | 'ai';
  manual_value?: string | null;
  instruction?: string | null;
  last_result?: string | null;
  page_reference?: string | null;
  source_drive_file_id?: string | null;
  source_drive_file_name?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  has_result: boolean;
  result_value?: string | null;
}

export interface AuditoriaDocEvidence {
  topic: string;
  page_reference?: string | null;
  quoted_excerpt?: string | null;
  summary: string;
  type: 'explicit_fact' | 'reasoned_interpretation';
}

export interface ReadAuditoriaDocResult {
  ok: boolean;
  error?: string;
  message?: string;
  condominio_name?: string;
  drive_file_id?: string;
  drive_file_name?: string;
  category?: string;
  total_pages_detected?: number | null;
  reading_quality?: 'alta' | 'media' | 'baixa' | 'sem_camada_texto' | 'ilegivel';
  evidencias_encontradas?: AuditoriaDocEvidence[];
  informacoes_nao_encontradas?: string[];
  resposta_sintetizada?: string;
  metodo_leitura?: 'entrada_direta_pdf' | 'entrada_direta_pdf_multimodal' | 'extracao_textual_fallback';
  limites_processamento?: {
    max_mb: number;
    modo: string;
    tipo?: string;
    limite_oficial_provedor?: string;
    metodo_leitura?: string;
  };
}

/**
 * Cria cliente Google GenAI utilizando a chave de API configurada no ambiente.
 */
function getGoogleGenAIClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim();
  if (apiKey) {
    return new GoogleGenAI({ apiKey });
  }
  return new GoogleGenAI({});
}

// ----------------------------------------------------------------------------
// 1. FERRAMENTA: search_auditoria_memorias
// ----------------------------------------------------------------------------

export async function runSearchAuditoriaMemorias(args: any, context: ToolContext) {
  const supabaseAdmin = context?.supabaseAdmin;
  if (!supabaseAdmin) {
    return { ok: false, error: 'service_unavailable', message: 'Banco de dados não disponível.' };
  }

  const auth = await resolveUserAuth(context, supabaseAdmin);
  if (!auth.isActive) {
    return { ok: false, error: 'inactive_user', message: 'Acesso negado: conta inativa.' };
  }

  // Permissões documentais de auditoria obrigatórias
  if (!auth.isAdmin) {
    const canAccessAudit = Boolean(
      auth.userPermissions?.can_access_auditoria || auth.userPermissions?.can_manage_auditoria
    );
    if (!canAccessAudit) {
      return {
        ok: false,
        error: 'permission_denied',
        message: 'Acesso restrito: seu perfil de usuário não possui permissão para acessar o módulo de Auditoria.',
      };
    }
  }

  try {
    const condoRef = (args?.condoId || args?.condo_id || '').trim();
    const query = (args?.query || args?.searchTerm || '').trim();
    const category = (args?.category || '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number(args?.limit || 25), 1), 50);

    let targetCondoId: string | null = null;
    let targetCondoName: string | null = null;

    if (condoRef) {
      const resolved = await resolveLeadId(supabaseAdmin, condoRef);
      if (resolved) {
        targetCondoId = resolved.id;
        targetCondoName = resolved.name;
      } else {
        return {
          ok: true,
          memorias: [],
          count: 0,
          message: `Condomínio "${condoRef}" não localizado no módulo de Auditoria.`,
        };
      }
    }

    let memoriesData: any[] = [];
    const { data, error } = await supabaseAdmin
      .from('auditoria_memorias')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data)) {
      memoriesData = data;
    }

    let filtered = memoriesData.filter((m: any) => {
      if (targetCondoId && m.condo_id !== targetCondoId) return false;
      if (category && String(m.category || '').toLowerCase() !== category) return false;

      if (query) {
        const normQ = removeAccents(query);
        const searchStr = removeAccents(
          `${m.label || ''} ${m.instruction || ''} ${m.manual_value || ''} ${m.last_result || ''} ${m.category || ''} ${m.source_drive_file_name || ''}`
        );
        if (!searchStr.includes(normQ)) return false;
      }

      return true;
    });

    filtered = filtered.slice(0, limit);

    const decoratedItems: AuditoriaMemoryItem[] = filtered.map((m: any) => {
      const hasResult = Boolean(
        (m.last_result && m.last_result.trim()) || (m.manual_value && m.manual_value.trim())
      );
      const resultVal = m.last_result || m.manual_value || null;

      return {
        id: m.id,
        condo_id: m.condo_id,
        category: m.category,
        label: m.label,
        fill_mode: m.fill_mode || 'ai',
        manual_value: m.manual_value || null,
        instruction: m.instruction || null,
        last_result: m.last_result || null,
        page_reference: m.page_reference || null,
        source_drive_file_id: m.source_drive_file_id || null,
        source_drive_file_name: m.source_drive_file_name || null,
        status: m.status || 'never_searched',
        created_at: m.created_at,
        updated_at: m.updated_at,
        has_result: hasResult,
        result_value: resultVal,
      };
    });

    return {
      ok: true,
      memorias: decoratedItems,
      count: decoratedItems.length,
      total_memories_found: decoratedItems.length,
      filtro_aplicado: {
        condominio: targetCondoName || condoRef || 'Todos os condomínios autorizados',
        categoria: category || 'Todas',
        busca_textual: query || null,
      },
      scope_autorizacao: 'Acesso Documental de Auditoria (Autorizado)',
    };
  } catch (err: any) {
    return {
      ok: false,
      error: 'database_error',
      message: `Erro ao consultar memórias de auditoria: ${err?.message || err}`,
      memorias: [],
      count: 0,
    };
  }
}

// ----------------------------------------------------------------------------
// 2. FERRAMENTA: read_auditoria_documento
// ----------------------------------------------------------------------------

export async function runReadAuditoriaDocumento(args: any, context: ToolContext): Promise<ReadAuditoriaDocResult> {
  const supabaseAdmin = context?.supabaseAdmin;
  if (!supabaseAdmin) {
    return { ok: false, error: 'service_unavailable', message: 'Banco de dados não disponível.' };
  }

  const auth = await resolveUserAuth(context, supabaseAdmin);
  if (!auth.isActive) {
    return { ok: false, error: 'inactive_user', message: 'Acesso negado: conta inativa.' };
  }

  // Validação estrita de permissão de auditoria
  if (!auth.isAdmin) {
    const canAccessAudit = Boolean(
      auth.userPermissions?.can_access_auditoria || auth.userPermissions?.can_manage_auditoria
    );
    if (!canAccessAudit) {
      return {
        ok: false,
        error: 'permission_denied',
        message: 'Acesso restrito: seu perfil de usuário não possui permissão para acessar o módulo de Auditoria.',
      };
    }
  }

  const condoRef = (args?.condoId || args?.condo_id || '').trim();
  const inputDriveFileId = (args?.driveFileId || args?.drive_file_id || args?.documentId || '').trim();
  const category = (args?.category || '').trim().toLowerCase();
  const userQuery = (args?.query || args?.topic || args?.question || '').trim();

  if (!condoRef && !inputDriveFileId) {
    return {
      ok: false,
      error: 'invalid_args',
      message: 'Informe o ID/nome do condomínio ou o drive_file_id do documento para leitura.',
    };
  }

  try {
    let resolvedCondo: { id: string; name: string } | null = null;
    if (condoRef) {
      resolvedCondo = await resolveLeadId(supabaseAdmin, condoRef);
    }

    // 1. Localizar metadados do documento em auditoria_documentos
    let docsData: any[] = [];
    const { data: dbDocs, error: dbErr } = await supabaseAdmin
      .from('auditoria_documentos')
      .select('*');

    if (!dbErr && Array.isArray(dbDocs)) {
      docsData = dbDocs;
    }

    // Selecionar documento alvo com validação de autorização
    let targetDoc: any = null;
    if (inputDriveFileId) {
      targetDoc = docsData.find((d: any) => d.drive_file_id === inputDriveFileId);
      if (!targetDoc) {
        return {
          ok: false,
          error: 'unauthorized_document',
          message: `Acesso negado: o arquivo "${inputDriveFileId}" do Google Drive não está vinculado a nenhum condomínio no módulo de Auditoria.`,
        };
      }
      if (resolvedCondo && targetDoc.condo_id !== resolvedCondo.id) {
        return {
          ok: false,
          error: 'unauthorized_document',
          message: `O documento "${targetDoc.drive_file_name || inputDriveFileId}" não pertence ao condomínio "${resolvedCondo.name}".`,
        };
      }
    } else if (resolvedCondo) {
      const condoDocs = docsData.filter((d: any) => d.condo_id === resolvedCondo.id);
      if (category) {
        targetDoc = condoDocs.find((d: any) => String(d.category || '').toLowerCase().includes(category));
      }
      if (!targetDoc && condoDocs.length > 0) {
        targetDoc = condoDocs[0];
      }
    }

    if (!targetDoc || !targetDoc.drive_file_id) {
      return {
        ok: false,
        error: 'document_not_found',
        message: `Nenhum documento PDF cadastrado foi encontrado para o condomínio ${resolvedCondo?.name || condoRef}.`,
      };
    }

    // Nome do condomínio associado
    const condoName = resolvedCondo?.name || targetDoc.condo_name || 'Condomínio Triverus';
    const driveFileId = targetDoc.drive_file_id;
    const driveFileName = targetDoc.drive_file_name || 'Documento Auditoria PDF';
    const docCategory = targetDoc.category || 'auditoria';

    // 2. Resolução e validação estrita de modelo do agente para leitura de PDFs
    const agentModelId = (context.agentModelId || context.agent?.modelId || 'gemini-2.5-flash').trim();
    const capCheck = checkModelCapabilityForAgent(agentModelId, { auditoria: true });

    if (!capCheck.isCompatible) {
      return {
        ok: false,
        error: 'model_capability_incompatible',
        message: `Incompatibilidade de modelo para leitura documental: ${capCheck.reason || 'O modelo selecionado não é compatível com a capacidade Auditoria.'}`,
      };
    }

    const modelProvider = capCheck.provider || 'google';
    const canonicalModel = capCheck.canonicalModel || agentModelId;
    const modelDisplayName = capCheck.displayName || canonicalModel;

    // 3. Download do PDF no Google Drive via getDriveFileStream (ou buffer de teste injetado em contexto)
    let pdfBuffer: Buffer;
    if ((context as any)?._testPdfBuffer) {
      pdfBuffer = (context as any)._testPdfBuffer;
    } else {
      let driveRes: Response;
      try {
        driveRes = await getDriveFileStream(driveFileId);
      } catch (driveErr: any) {
        return {
          ok: false,
          error: 'drive_download_failed',
          message: `Não foi possível recuperar o arquivo PDF no Google Drive ("${driveFileName}"): ${driveErr?.message || driveErr}`,
        };
      }

      const arrayBuf = await driveRes.arrayBuffer();
      pdfBuffer = Buffer.from(arrayBuf);
    }

    if (!pdfBuffer || pdfBuffer.length === 0) {
      return {
        ok: false,
        error: 'empty_pdf',
        message: `O arquivo PDF "${driveFileName}" está vazio ou corrompido no Google Drive.`,
      };
    }

    const MAX_BYTES = 30 * 1024 * 1024; // Limite operacional da plataforma Triverus (guardrail de segurança e timeout sob demanda)
    if (pdfBuffer.length > MAX_BYTES) {
      return {
        ok: false,
        error: 'pdf_too_large',
        message: `O documento PDF excede o limite operacional da plataforma Triverus de 30MB para análise sob demanda (${Math.round(pdfBuffer.length / (1024 * 1024))}MB).`,
      };
    }

    const promptText = `Você é o assistente auditor documental da Triverus CRM.
Analise o documento PDF em anexo e responda com rigor factual absoluto.

CONDOMÍNIO: "${condoName}"
NOME DO ARQUIVO: "${driveFileName}"
CATEGORIA: "${docCategory}"
PERGUNTA / TÓPICO SOLICITADO: "${userQuery || 'Analise as principais regras, quóruns, cláusulas e obrigações do documento.'}"

DIRETRIZES DE RESPOSTA OBRIGATÓRIAS:
1. FACTUALIDADE: NUNCA invente cláusulas, artigos, números de página ou valores.
2. EVIDÊNCIAS E PÁGINAS: Para cada regra ou fato encontrado, informe a referência exata da página (ex: "Pág. 3", "Pág. 5 - Art. 12").
3. ESTRUTURA DE EVIDÊNCIAS: Identifique o trecho textual exato (quoted_excerpt) e faça o resumo (summary).
4. QUALIDADE DA LEITURA: Se o PDF for um escaneamento de imagem sem camada de texto legível ou estiver ilegível, indique qualidade "sem_camada_texto" ou "ilegivel" e declare explicitamente a limitação.

Retorne EXCLUSIVAMENTE um objeto JSON no seguinte formato:
{
  "total_pages_detected": 10,
  "reading_quality": "alta" | "media" | "baixa" | "sem_camada_texto" | "ilegivel",
  "evidencias_encontradas": [
    {
      "topic": "Nome do tópico",
      "page_reference": "Pág. X",
      "quoted_excerpt": "Trecho literal extraído",
      "summary": "Resumo objetivo",
      "type": "explicit_fact" | "reasoned_interpretation"
    }
  ],
  "informacoes_nao_encontradas": ["Tópicos não localizados"],
  "resposta_sintetizada": "Texto explicativo sintetizando o que foi encontrado com citações de páginas."
}`;

    let parsedResult: any = null;

    if (modelProvider === 'google') {
      // Execução estrita no modelo Google Gemini selecionado
      const geminiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim();
      if (!geminiKey) {
        return {
          ok: false,
          error: 'gemini_api_key_missing',
          message: `Chave de API do Google Gemini (GEMINI_API_KEY) não configurada no servidor para executar leitura com o modelo ${modelDisplayName}.`,
        };
      }

      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const base64Pdf = pdfBuffer.toString('base64');

      try {
        const aiResponse = await ai.models.generateContent({
          model: canonicalModel,
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
                { text: promptText },
              ],
            },
          ],
          config: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        });

        const rawText = aiResponse.text || '';
        const cleanJson = rawText.replace(/```json\n?|\n?```/g, '').trim();
        parsedResult = JSON.parse(cleanJson);
      } catch (aiErr: any) {
        console.warn(`[ReadAuditoriaDoc] Falha na síntese IA com modelo Google (${modelDisplayName}):`, aiErr?.message);
        return {
          ok: false,
          error: 'gemini_execution_error',
          message: `Erro na leitura documental com modelo Google Gemini (${modelDisplayName}): ${aiErr?.message || aiErr}`,
        };
      }
    } else if (modelProvider === 'openai') {
      // Execução estrita no modelo OpenAI selecionado
      const openAiKey = (process.env.OPENAI_API_KEY || '').trim();
      if (!openAiKey) {
        return {
          ok: false,
          error: 'openai_api_key_missing',
          message: `Chave de API OpenAI não configurada no servidor para executar leitura com o modelo ${modelDisplayName}.`,
        };
      }

      try {
        const { default: OpenAI } = await import('openai');
        const openai = new OpenAI({ apiKey: openAiKey, timeout: 45000 });

        const base64Pdf = pdfBuffer.toString('base64');
        const isReasoning = canonicalModel.startsWith('o1') || canonicalModel.startsWith('o3');

        // Documentação oficial OpenAI: Entrada direta de PDF (File Inputs) para modelos multimodais
        // https://developers.openai.com/api/docs/guides/file-inputs
        // Envio direto do binário base64 do PDF com renderização de páginas, tabelas, diagramas e textos em colunas
        const userContentParts: any[] = [
          {
            type: 'text',
            text: `${promptText}\n\nAnalise o arquivo PDF anexo com rigor factual absoluto. Extraia tabelas com valores exatos, regras expressas e cite a página exata de cada evidência.`,
          },
          {
            type: 'file',
            file: {
              filename: driveFileName || 'documento.pdf',
              file_data: `data:application/pdf;base64,${base64Pdf}`,
            },
          },
        ];

        const completionMessages: any[] = isReasoning
          ? [{ role: 'user', content: userContentParts }]
          : [
              {
                role: 'system',
                content:
                  'Você é um assistente especialista em auditoria documental e leitura multimodal de PDFs que analisa páginas, tabelas, gráficos e textos em colunas com rigor factual absoluto, respondendo exclusivamente em JSON.',
              },
              { role: 'user', content: userContentParts },
            ];

        const reqPayload: any = {
          model: canonicalModel,
          messages: completionMessages,
          max_completion_tokens: 4096,
        };

        if (!isReasoning && (canonicalModel.includes('gpt-4o') || canonicalModel.includes('chatgpt-4o'))) {
          reqPayload.response_format = { type: 'json_object' };
        }

        let aiResponse: any;
        try {
          aiResponse = await openai.chat.completions.create(reqPayload);
        } catch (fileInputErr: any) {
          // Se o endpoint específico ou proxy não aceitar content part 'file', aciona extração de emergência
          console.warn(`[ReadAuditoriaDoc] Envio nativo de PDF OpenAI retornou: ${fileInputErr?.message}. Tentando modo de contingência.`);
          const rawPdfStr = pdfBuffer.toString('utf8');
          const textMatches = rawPdfStr.match(/[\x20-\x7E\xA0-\xFF\n\r\t]{4,}/g);
          const extractedText = textMatches && textMatches.length > 0 ? textMatches.join(' ') : rawPdfStr.slice(0, 50000);

          const fallbackMessages: any[] = isReasoning
            ? [{ role: 'user', content: `${promptText}\n\nCONTEÚDO TEXTUAL DO PDF:\n${extractedText.slice(0, 100000)}` }]
            : [
                { role: 'system', content: 'Você é um assistente especialista em auditoria documental que responde exclusivamente em JSON.' },
                { role: 'user', content: `${promptText}\n\nCONTEÚDO TEXTUAL DO PDF:\n${extractedText.slice(0, 100000)}` },
              ];

          aiResponse = await openai.chat.completions.create({
            model: canonicalModel,
            messages: fallbackMessages,
            max_completion_tokens: 4096,
            ...(reqPayload.response_format ? { response_format: reqPayload.response_format } : {}),
          });
        }

        const rawText = aiResponse.choices?.[0]?.message?.content || '';
        const cleanJson = rawText.replace(/```json\n?|\n?```/g, '').trim();
        parsedResult = JSON.parse(cleanJson);
      } catch (aiErr: any) {
        console.warn(`[ReadAuditoriaDoc] Falha na síntese IA com modelo OpenAI (${modelDisplayName}):`, aiErr?.message);
        return {
          ok: false,
          error: 'openai_execution_error',
          message: `Erro na leitura documental com modelo OpenAI (${modelDisplayName}): ${aiErr?.message || aiErr}`,
        };
      }
    }

    const evidencias: AuditoriaDocEvidence[] = parsedResult?.evidencias_encontradas || [
      {
        topic: userQuery || 'Leitura de Documento',
        page_reference: 'Pág. 1',
        quoted_excerpt: null,
        summary: `Documento "${driveFileName}" lido e processado com sucesso.`,
        type: 'explicit_fact',
      },
    ];

    const respostaSintetizada =
      parsedResult?.resposta_sintetizada ||
      `Documento **${driveFileName}** (${docCategory}) analisado para o condomínio **${condoName}**. ` +
      (evidencias.length > 0 ? `Foram encontradas ${evidencias.length} evidências relevantes.` : 'Nenhuma evidência específica foi localizada.');

    return {
      ok: true,
      condominio_name: condoName,
      drive_file_id: driveFileId,
      drive_file_name: driveFileName,
      category: docCategory,
      total_pages_detected: parsedResult?.total_pages_detected || null,
      reading_quality: parsedResult?.reading_quality || 'alta',
      evidencias_encontradas: evidencias,
      informacoes_nao_encontradas: parsedResult?.informacoes_nao_encontradas || [],
      resposta_sintetizada: respostaSintetizada,
      metodo_leitura: modelProvider === 'google' ? 'entrada_direta_pdf_multimodal' : 'entrada_direta_pdf',
      limites_processamento: {
        max_mb: 30,
        tipo: 'limite_operacional_triverus',
        limite_oficial_provedor: modelProvider === 'google' ? '2000MB (Google GenAI Files API)' : '512MB (OpenAI API)',
        modo: 'leitura_sob_demanda_autorizada',
        metodo_leitura: modelProvider === 'google' ? 'entrada_direta_pdf_multimodal' : 'entrada_direta_pdf',
      },
    };
  } catch (err: any) {
    return {
      ok: false,
      error: 'execution_error',
      message: `Erro ao executar leitura documental: ${err?.message || err}`,
    };
  }
}

// ----------------------------------------------------------------------------
// REGISTRO NO TOOL REGISTRY DA TRIVERUS
// ----------------------------------------------------------------------------

ToolRegistry.registerTool({
  id: 'search_auditoria_memorias',
  name: 'search_auditoria_memorias',
  description: 'Busca e consulta as memórias de auditoria cadastradas no módulo de Auditoria da Triverus por condomínio, categoria ou termo textual. Retorna instruções, resultados prévios, referências de página e arquivos de origem.',
  module: 'auditoria',
  capabilityKey: 'auditoria',
  operationType: 'read',
  requiredAuth: 'active_user',
  parameters: {
    type: 'object',
    properties: {
      condoId: { type: 'string', description: 'ID (UUID) ou nome do condomínio (ex: "Lagoinha", "Mirante das Pedras")' },
      query: { type: 'string', description: 'Termo ou palavra-chave para buscar nas memórias (ex: "sÍndico", "convenção", "multa")' },
      category: { type: 'string', description: 'Categoria da auditoria (ex: "convenção", "regulamento_interno", "trabalhista")' },
      limit: { type: 'integer', description: 'Quantidade máxima de memórias retornadas (padrão 25)' },
    },
  },
  execute: runSearchAuditoriaMemorias,
});

ToolRegistry.registerTool({
  id: 'read_auditoria_documento',
  name: 'read_auditoria_documento',
  description: 'Lê e analisa em tempo real o conteúdo real de um documento PDF da Auditoria (armazenado no Google Drive) associado a um condomínio. Extrai cláusulas, regras, quóruns e evidências textuais com referência de página e arquivo.',
  module: 'auditoria',
  capabilityKey: 'auditoria',
  operationType: 'read',
  requiredAuth: 'active_user',
  parameters: {
    type: 'object',
    properties: {
      condoId: { type: 'string', description: 'ID ou nome do condomínio para localizar o documento' },
      driveFileId: { type: 'string', description: 'ID do arquivo PDF no Google Drive (opcional se condoId informado)' },
      category: { type: 'string', description: 'Categoria do documento (ex: "convenção", "regulamento_interno")' },
      query: { type: 'string', description: 'Pergunta ou tópico específico a ser pesquisado dentro do PDF' },
    },
  },
  execute: runReadAuditoriaDocumento,
});

// ----------------------------------------------------------------------------
// 3. FERRAMENTA: search_document_content
// ----------------------------------------------------------------------------

export async function runSearchDocumentContent(args: any, context: ToolContext) {
  const supabaseAdmin = context?.supabaseAdmin;
  const auth = await resolveUserAuth(context, supabaseAdmin);

  return searchDocumentContent(
    {
      condoId: args?.condoId || args?.condo_id,
      condoName: args?.condoName || args?.condo_name,
      category: args?.category,
      documentId: args?.documentId || args?.document_id,
      driveFileId: args?.driveFileId || args?.drive_file_id,
      query: args?.query || args?.searchTerm || '',
      pageMin: args?.pageMin,
      pageMax: args?.pageMax,
      limit: args?.limit || 10,
      offset: args?.offset || 0,
    },
    auth,
    supabaseAdmin
  );
}

ToolRegistry.registerTool({
  id: 'search_document_content',
  name: 'search_document_content',
  description: 'Encontra trechos relevantes em documentos PDF da Auditoria indexados no acervo Triverus. Permite buscar por termos/frases, condomínio, categoria, documento e faixa de páginas, retornando trecho original, página e metadados de rastreabilidade.',
  module: 'auditoria',
  capabilityKey: 'auditoria',
  operationType: 'read',
  requiredAuth: 'active_user',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Termo ou frase textual a ser pesquisada nos documentos (ex: "eleição de síndico", "multa por barulho", "2/3")' },
      condoId: { type: 'string', description: 'ID ou nome do condomínio para filtrar a busca (opcional)' },
      category: { type: 'string', description: 'Categoria documental (ex: "convenção", "regulamento_interno", "trabalhista")' },
      documentId: { type: 'string', description: 'ID específico do documento na Auditoria (opcional)' },
      pageMin: { type: 'integer', description: 'Número da página inicial para filtrar o intervalo (opcional)' },
      pageMax: { type: 'integer', description: 'Número da página final para filtrar o intervalo (opcional)' },
      limit: { type: 'integer', description: 'Quantidade máxima de trechos retornados (padrão 10)' },
    },
    required: ['query'],
  },
  execute: runSearchDocumentContent,
});

// ----------------------------------------------------------------------------
// 4. FERRAMENTA: read_document_section
// ----------------------------------------------------------------------------

export async function runReadDocumentSection(args: any, context: ToolContext) {
  const supabaseAdmin = context?.supabaseAdmin;
  const auth = await resolveUserAuth(context, supabaseAdmin);

  return readDocumentSection(
    {
      condoId: args?.condoId || args?.condo_id,
      documentId: args?.documentId || args?.document_id,
      driveFileId: args?.driveFileId || args?.drive_file_id,
      category: args?.category,
      pageNumber: args?.pageNumber || args?.page_number || 1,
    },
    auth,
    supabaseAdmin
  );
}

ToolRegistry.registerTool({
  id: 'read_document_section',
  name: 'read_document_section',
  description: 'Recupera o conteúdo textual completo de uma página ou seção específica de um documento indexado da Auditoria, preservando a fonte, número de página e estado de indexação.',
  module: 'auditoria',
  capabilityKey: 'auditoria',
  operationType: 'read',
  requiredAuth: 'active_user',
  parameters: {
    type: 'object',
    properties: {
      condoId: { type: 'string', description: 'ID ou nome do condomínio (opcional)' },
      documentId: { type: 'string', description: 'ID do documento na Auditoria' },
      driveFileId: { type: 'string', description: 'ID do arquivo no Google Drive' },
      category: { type: 'string', description: 'Categoria do documento' },
      pageNumber: { type: 'integer', description: 'Número exato da página a ser lida' },
    },
    required: ['pageNumber'],
  },
  execute: runReadDocumentSection,
});

