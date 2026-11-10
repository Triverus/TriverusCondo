import { GoogleGenAI } from '@google/genai';

/**
 * Cria o cliente do Google GenAI utilizando a chave disponível no ambiente.
 */
function getGoogleGenAIClient() {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim();
  if (apiKey) {
    return new GoogleGenAI({ apiKey });
  }
  return new GoogleGenAI({});
}

/**
 * Executa a análise assistida por IA de um documento PDF da Auditoria Triverus
 * com rigor factual estrito, preservação de páginas e detecção de incompatibilidade.
 */
export async function analyzeAuditoriaDocument(params) {
  const { pdfBuffer, fileName, category, condoName } = params;

  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new Error('Arquivo PDF vazio ou corrompido.');
  }

  // Limite razoável de tamanho de arquivo para análise multimodal (30MB)
  const MAX_SIZE_BYTES = 30 * 1024 * 1024;
  if (pdfBuffer.length > MAX_SIZE_BYTES) {
    throw new Error(
      `O arquivo PDF excede o tamanho máximo suportado para análise direta (${Math.round(
        pdfBuffer.length / (1024 * 1024)
      )}MB > 30MB).`
    );
  }

  const ai = getGoogleGenAIClient();
  const base64Data = pdfBuffer.toString('base64');

  const systemPrompt = `Você é o auditor assistente especializado em auditoria condominial da plataforma Triverus CRM.
Sua missão é analisar o documento PDF em anexo com rigor factual absoluto, precisão técnica e imparcialidade.

CATEGORIA ESPERADA DO VÍNCULO: "${category}" (Convenção do Condomínio).
NOME DO CONDOMÍNIO NO CRM: "${condoName}".
NOME DO ARQUIVO: "${fileName}".

DIRETRIZES FUNDAMENTAIS DE CONFIABILIDADE (NÃO VIOLE):
1. FACTUALIDADE ESTRITA: NUNCA invente cláusulas, páginas, artigos, datas ou informações ausentes. Se uma informação não estiver explícita no documento, indique como ausente ou não localizada.
2. DISTINÇÃO CLARA: Separe categoricamente:
   - Fatos expressos no texto do documento;
   - Inferências da análise de IA;
   - Itens que necessitam de conferência e validação por auditor humano.
3. DETECÇÃO DE INCOMPATIBILIDADE DE TIPO:
   - Se o documento NÃO for uma Convenção de Condomínio (por exemplo: se for uma conta de consumo de energia/água, boleto bancário, recibo, ata de assembleia avulsa, contrato de prestação de serviços ou termo genérico), declare IMEDIATAMENTE:
     - is_convention: false
     - compatibility_status: "incompatible"
     - detected_type: tipo real identificado (ex: "Conta de Energia Elétrica", "Boleto Bancário", "Ata de Assembleia")
     - compatibility_notes: explicação clara do motivo pelo qual o documento não é uma convenção.
   - NUNCA invente regras condominiais fictícias para um documento que não seja uma convenção!
4. LOCALIZAÇÃO E PÁGINAS:
   - Sempre que citar uma cláusula, quórum, penalidade ou regra, informe a referência exata da página (ex: "Pág. 3", "Pág. 7 - Art. 14").
5. SEM DECLARAÇÃO DE REGULARIDADE JURÍDICA:
   - NUNCA declare que o condomínio está juridicamente regular ou irregular. Esta é uma ferramenta de triagem prévia para auxílio à auditoria.
6. AVALIAÇÃO DE QUALIDADE E LEGIBILIDADE:
   - Avalie a qualidade da leitura (se há páginas cortadas, texto ilegível, escaneamento de baixa resolução ou documento em branco).

ESTRUTURA DE RESPOSTA OBRIGATÓRIA (JSON ESTREITO):
Retorne EXCLUSIVAMENTE um objeto JSON válido, sem cercaduras markdown de código ou textos fora do JSON, no seguinte formato:

{
  "document_identification": {
    "title": "Título real ou aparente do documento",
    "detected_type": "Convenção de Condomínio | Conta de Consumo | Ata de Assembleia | Outro",
    "is_convention": true ou false,
    "compatibility_status": "compatible" | "incompatible" | "uncertain",
    "compatibility_notes": "Justificativa clara sobre a compatibilidade ou incompatibilidade com a categoria Convenção",
    "condominium_name_in_doc": "Nome do condomínio citado no texto ou null",
    "estimated_date": "Data ou ano identificado no documento ou null",
    "registry_info": "Dados de cartório/registro de imóveis identificados ou null",
    "total_pages_detected": número total de páginas identificadas ou null
  },
  "executive_summary": {
    "summary": "Síntese executiva dos principais temas abordados no documento",
    "main_purpose": "Finalidade principal do documento analisado",
    "overall_structure": "Descrição resumida da divisão dos capítulos/seções ou do conteúdo"
  },
  "relevant_clauses": [
    {
      "topic": "Nome do tema (ex: Quóruns de Deliberação, Frações Ideais, Competências do Síndico, Taxas e Rateios, Penalidades)",
      "page_reference": "Pág. X ou null",
      "summary": "Resumo do que o documento estipula sobre o tema",
      "quoted_excerpt": "Pequeno trecho literal relevante ou null",
      "relevance": "alta" | "media" | "informativa"
    }
  ],
  "points_of_attention": [
    {
      "type": "ambiguidade" | "lacuna" | "potencial_conflito" | "desatualizacao" | "incompatibilidade",
      "description": "Explicação detalhada do ponto de atenção ou risco identificado",
      "page_reference": "Pág. X ou null",
      "recommendation": "Recomendação prática de auditoria para averiguação"
    }
  ],
  "preliminary_checklist": [
    {
      "item": "Item essencial para auditoria (ex: Definição clara de quóruns, Regras de rateio de despesas, Forma de eleição do síndico, Conselho fiscal)",
      "status": "confirmado_no_documento" | "ausente_ou_nao_localizado" | "requer_validacao_humana",
      "details": "Justificativa factual do status apontado",
      "page_reference": "Pág. X ou null"
    }
  ],
  "analysis_limitations": {
    "reading_quality": "alta" | "media" | "baixa" | "ilegivel",
    "unreadable_pages": "Páginas não interpretadas ou null",
    "limitations_notes": "Notas sobre limitações de OCR, resolução ou informações truncadas",
    "confidence_level": "alta" | "moderada" | "baixa",
    "legal_disclaimer": "Esta análise é uma triagem técnica preliminar assistida por inteligência artificial para apoio ao processo de auditoria. Não substitui parecer jurídico formal e não atesta a regularidade legal definitiva do condomínio. As constatações devem ser validadas por um auditor humano com base na via oficial registrada."
  }
}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: base64Data,
          },
        },
        systemPrompt,
      ],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    const rawText = response.text || '';
    if (!rawText.trim()) {
      throw new Error('A IA não retornou conteúdo após a leitura do documento.');
    }

    const cleaned = rawText
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '');

    const parsed = JSON.parse(cleaned);

    if (!parsed.document_identification || !parsed.executive_summary) {
      throw new Error('A resposta gerada não contém a estrutura obrigatória da análise.');
    }

    parsed.relevant_clauses = Array.isArray(parsed.relevant_clauses) ? parsed.relevant_clauses : [];
    parsed.points_of_attention = Array.isArray(parsed.points_of_attention)
      ? parsed.points_of_attention
      : [];
    parsed.preliminary_checklist = Array.isArray(parsed.preliminary_checklist)
      ? parsed.preliminary_checklist
      : [];

    return parsed;
  } catch (err) {
    console.error('[AUDITORIA_AI_ANALYSIS_ERROR]', err);
    throw new Error(
      err?.message || 'Falha ao processar a análise inteligente do documento com IA.'
    );
  }
}

/**
 * Executa a extração pontual assistida por IA para uma Memória específica da Auditoria Triverus
 * com base no PDF selecionado e na instrução do usuário.
 */
export async function executeMemoryExtraction(params) {
  const { pdfBuffer, fileName, category, condoName, memoryLabel, instruction } = params;

  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new Error('Arquivo PDF de origem está vazio ou corrompido.');
  }

  const MAX_SIZE_BYTES = 30 * 1024 * 1024;
  if (pdfBuffer.length > MAX_SIZE_BYTES) {
    throw new Error(
      `O arquivo PDF excede o tamanho máximo suportado (${Math.round(
        pdfBuffer.length / (1024 * 1024)
      )}MB > 30MB).`
    );
  }

  const ai = getGoogleGenAIClient();
  const base64Data = pdfBuffer.toString('base64');

  const systemPrompt = `Você é um assistente especialista em auditoria condominial da plataforma Triverus.
Sua missão é analisar o documento PDF em anexo ("${fileName}") do condomínio "${condoName}" na categoria "${category}" e responder EXCLUSIVAMENTE e com rigor factual estrito à instrução fornecida sobre o campo "${memoryLabel}".

CAMPO / RÓTULO: "${memoryLabel}"
INSTRUÇÃO DO USUÁRIO: "${instruction}"

DIRETRIZES DE EXTRAÇÃO:
1. Responda de forma direta, concisa e fundamentada apenas ao que foi solicitado na instrução.
2. Se a informação estiver presente no documento, extraia a resposta no campo "value", defina "found": true, e forneça a referência de página/artigo em "page_reference" (ex: "Pág. 4, Art. 10").
3. Se a informação NÃO estiver presente ou se o documento não for suficiente para responder, informe claramente no campo "value" que a informação não foi localizada no texto e defina "found": false.
4. NUNCA invente cláusulas, números ou dados ausentes.

ESTRUTURA DE RESPOSTA OBRIGATÓRIA (JSON):
Retorne EXCLUSIVAMENTE um JSON válido no formato:
{
  "value": "Resposta sintética, fundamentada e objetiva para o campo",
  "found": true ou false,
  "page_reference": "Pág. X ou null",
  "quoted_excerpt": "Trecho literal curto do documento ou null",
  "confidence": "alta" | "moderada" | "baixa",
  "notes": "Observação de auditoria complementar se relevante ou null"
}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: base64Data,
          },
        },
        systemPrompt,
      ],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    const rawText = response.text || '';
    if (!rawText.trim()) {
      throw new Error('A IA não retornou conteúdo após o processamento do documento.');
    }

    const cleaned = rawText
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '');

    const parsed = JSON.parse(cleaned);

    if (!parsed || typeof parsed.value !== 'string') {
      throw new Error('Estrutura de resposta inválida gerada pela IA.');
    }

    return {
      value: parsed.value,
      found: Boolean(parsed.found),
      page_reference: parsed.page_reference || null,
      quoted_excerpt: parsed.quoted_excerpt || null,
      confidence: parsed.confidence || 'moderada',
      notes: parsed.notes || null,
    };
  } catch (err) {
    console.error('[AUDITORIA_MEMORY_EXTRACTION_ERROR]', err);
    throw new Error(err?.message || 'Falha ao executar extração por IA para a memória.');
  }
}

/**
 * Executa a extração em lote assistida por IA para múltiplas Memórias associadas ao mesmo PDF.
 * Permite processar todas as instruções do grupo em uma ÚNICA chamada ao modelo Gemini,
 * economizando tokens e tempo de requisição de forma expressiva.
 */
export async function executeBatchMemoryExtraction(params) {
  const { pdfBuffer, fileName, category, condoName, items } = params;

  if (!items || items.length === 0) {
    return [];
  }

  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new Error('Arquivo PDF de origem está vazio ou corrompido.');
  }

  const MAX_SIZE_BYTES = 30 * 1024 * 1024;
  if (pdfBuffer.length > MAX_SIZE_BYTES) {
    throw new Error(
      `O arquivo PDF excede o tamanho máximo suportado (${Math.round(
        pdfBuffer.length / (1024 * 1024)
      )}MB > 30MB).`
    );
  }

  const ai = getGoogleGenAIClient();
  const base64Data = pdfBuffer.toString('base64');

  const systemPrompt = `Você é um assistente especialista em auditoria condominial da plataforma Triverus.
Sua missão é analisar o documento PDF em anexo ("${fileName}") do condomínio "${condoName}" na categoria "${category}" e responder EXCLUSIVAMENTE e com rigor factual estrito a CADA UMA das instruções fornecidas na lista de memórias abaixo.

LISTA DE MEMÓRIAS PARA EXTRAIR (Total: ${items.length}):
${JSON.stringify(
  items.map((it) => ({
    id: it.id,
    label: it.label,
    instruction: it.instruction,
  })),
  null,
  2
)}

DIRETRIZES DE EXTRAÇÃO EM LOTE:
1. Responda individualmente para cada item da lista utilizando o "id" exato de cada memória como chave de identificação.
2. Se a informação solicitada estiver expressa no texto do documento, extraia uma resposta objetiva em "value", defina "found": true, e informe a página ou artigo em "page_reference" (ex: "Pág. 5, Art. 18").
3. Se a informação NÃO constar no documento ou não for possível localizá-la, defina "found": false, informe claramente em "value" que a informação não foi localizada neste arquivo, e defina "page_reference": null. A não localização de um item JAMAIS deve prejudicar a análise dos outros itens.
4. NUNCA invente artigos, quóruns, valores ou dados ausentes.
5. Retorne a resposta para TODOS os itens informados na lista.

ESTRUTURA DE RESPOSTA OBRIGATÓRIA (JSON ARRAY):
Retorne EXCLUSIVAMENTE um JSON array válido contendo um objeto para cada item:
[
  {
    "id": "identificador_exato_do_item",
    "value": "Resposta sintética, fundamentada e objetiva para o campo",
    "found": true ou false,
    "page_reference": "Pág. X ou null",
    "quoted_excerpt": "Trecho literal curto do documento ou null",
    "confidence": "alta" | "moderada" | "baixa",
    "notes": "Observação de auditoria complementar se relevante ou null"
  }
]`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: base64Data,
          },
        },
        systemPrompt,
      ],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    const rawText = response.text || '';
    if (!rawText.trim()) {
      throw new Error('A IA não retornou conteúdo após o processamento agrupado do documento.');
    }

    const cleaned = rawText
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '');

    let parsedArray = [];
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        parsedArray = parsed;
      } else if (parsed && Array.isArray(parsed.results)) {
        parsedArray = parsed.results;
      } else if (parsed && typeof parsed === 'object') {
        parsedArray = Object.values(parsed);
      }
    } catch (parseErr) {
      console.warn('[AUDITORIA_BATCH_PARSE_WARN] Falha ao fazer parse direto do array JSON:', parseErr);
    }

    const resultMap = new Map();
    for (const res of parsedArray) {
      if (res && res.id) {
        resultMap.set(String(res.id), {
          id: String(res.id),
          value: typeof res.value === 'string' ? res.value : 'Informação processada pela IA.',
          found: Boolean(res.found),
          page_reference: res.page_reference || null,
          quoted_excerpt: res.quoted_excerpt || null,
          confidence: res.confidence || 'moderada',
          notes: res.notes || null,
        });
      }
    }

    const results = items.map((item) => {
      const foundItem = resultMap.get(item.id);
      if (foundItem) {
        return foundItem;
      }
      return {
        id: item.id,
        value: 'Informação não localizada ou não retornada no processamento deste documento.',
        found: false,
        page_reference: null,
        quoted_excerpt: null,
        confidence: 'baixa',
        notes: 'Item ausente na resposta da IA.',
      };
    });

    return results;
  } catch (err) {
    console.error('[AUDITORIA_BATCH_EXTRACTION_ERROR]', err);
    throw new Error(err?.message || 'Falha ao executar extração agrupada por IA para os itens.');
  }
}

