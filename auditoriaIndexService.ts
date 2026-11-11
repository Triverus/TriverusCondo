import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import { removeAccents } from './crmTools.ts';

// ----------------------------------------------------------------------------
// INTERFACES E METADADOS
// ----------------------------------------------------------------------------

export interface DocumentChunk {
  id: string;
  condo_id: string;
  document_id: string;
  drive_file_id: string;
  drive_file_name: string;
  category: string;
  page_number: number;
  chunk_index: number;
  content: string;
  content_clean: string;
  char_count: number;
  word_count: number;
  indexing_status: 'indexed' | 'sem_camada_texto' | 'tamanho_excedido' | 'erro_extracao' | 'nao_indexavel';
  indexing_version: number;
  file_hash?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentIndexStatus {
  document_id: string;
  condo_id: string;
  drive_file_id: string;
  drive_file_name: string;
  category: string;
  indexing_status: 'pending' | 'indexing' | 'indexed' | 'sem_camada_texto' | 'tamanho_excedido' | 'erro_extracao' | 'nao_indexavel';
  indexing_version: number;
  active_version: number;
  total_pages: number;
  total_chunks: number;
  total_chars: number;
  retry_count: number;
  max_retries: number;
  last_error?: string | null;
  locked_at?: string | null;
  locked_by?: string | null;
  last_indexed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SearchDocumentContentParams {
  condoId?: string;
  condoName?: string;
  category?: string;
  documentId?: string;
  driveFileId?: string;
  query: string;
  pageMin?: number;
  pageMax?: number;
  limit?: number;
  offset?: number;
}

export interface SearchResultItem {
  condominio_id: string;
  condominio_nome?: string;
  documento_id: string;
  drive_file_id: string;
  nome_arquivo: string;
  categoria: string;
  pagina: number;
  chunk_index: number;
  trecho_original: string;
  relevancia: number;
  estado_indexacao: string;
  versao_indice: number;
}

export interface SearchDocumentContentResult {
  ok: boolean;
  error?: string;
  message?: string;
  query?: string;
  total?: number;
  results?: SearchResultItem[];
}

export interface ReadDocumentSectionParams {
  condoId?: string;
  documentId?: string;
  driveFileId?: string;
  category?: string;
  pageNumber: number;
}

export interface ReadDocumentSectionResult {
  ok: boolean;
  error?: string;
  message?: string;
  condominio_id?: string;
  documento_id?: string;
  drive_file_id?: string;
  nome_arquivo?: string;
  categoria?: string;
  pagina?: number;
  total_paginas?: number;
  conteudo_pagina?: string;
  trechos_encontrados?: number;
  estado_indexacao?: string;
  versao_indice?: number;
}

// ----------------------------------------------------------------------------
// AMBIENTE DE TESTE UNITÁRIO APENAS (ISOLADO DE PRODUÇÃO)
// ----------------------------------------------------------------------------
const testModeIndex = new Map<string, DocumentChunk>();
const testModeStatus = new Map<string, DocumentIndexStatus>();

const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024; // Limite operacional de 30 MB

// ----------------------------------------------------------------------------
// UTILS E EXTRAÇÃO DE TEXTO
// ----------------------------------------------------------------------------

function customPageRenderer(pageData: any): Promise<string> {
  const render_options = {
    normalizeWhitespace: true,
    disableCombineTextItems: false,
  };
  return pageData.getTextContent(render_options).then((textContent: any) => {
    let lastY: number | undefined;
    let text = '';
    for (const item of textContent.items) {
      if (lastY === item.transform[5] || lastY === undefined) {
        text += item.str;
      } else {
        text += '\n' + item.str;
      }
      lastY = item.transform[5];
    }
    return text + '\f';
  });
}

/**
 * Extrai texto por página de um arquivo PDF.
 */
export async function extractPdfTextByPages(pdfBuffer: Buffer): Promise<{
  ok: boolean;
  pages: Array<{ pageNumber: number; text: string }>;
  totalPages: number;
  totalChars: number;
  isScanned: boolean;
  readingQuality: 'alta' | 'media' | 'baixa' | 'sem_camada_texto';
  error?: string;
}> {
  try {
    if (!pdfBuffer || pdfBuffer.length === 0) {
      return {
        ok: false,
        pages: [],
        totalPages: 0,
        totalChars: 0,
        isScanned: true,
        readingQuality: 'sem_camada_texto',
        error: 'Buffer de PDF vazio.',
      };
    }

    const data = await pdfParse(pdfBuffer, {
      pagerender: customPageRenderer,
    });

    const rawText = data.text || '';
    const totalPages = data.numpages || 1;

    let rawPageTexts = rawText.split(/\f/);
    if (rawPageTexts.length < totalPages && rawText.includes('\n\n\n')) {
      rawPageTexts = rawText.split(/\n\n\n/);
    }

    const pages: Array<{ pageNumber: number; text: string }> = [];
    let totalChars = 0;

    for (let i = 0; i < totalPages; i++) {
      const pageNum = i + 1;
      const pageContent = (rawPageTexts[i] || rawPageTexts[0] || '').trim();
      totalChars += pageContent.replace(/\s+/g, '').length;
      pages.push({
        pageNumber: pageNum,
        text: pageContent,
      });
    }

    const isScanned = totalChars < 20;
    const readingQuality = isScanned
      ? 'sem_camada_texto'
      : totalChars > 500
      ? 'alta'
      : totalChars > 150
      ? 'media'
      : 'baixa';

    return {
      ok: true,
      pages,
      totalPages,
      totalChars,
      isScanned,
      readingQuality,
    };
  } catch (err: any) {
    try {
      const str = pdfBuffer.toString('utf-8');
      const pageBlocks = str.split(/\/Page\b/);
      if (pageBlocks.length > 1) {
        const pagesArr: Array<{ pageNumber: number; text: string }> = [];
        let totalChars = 0;
        for (let pIdx = 1; pIdx < pageBlocks.length; pIdx++) {
          const block = pageBlocks[pIdx];
          const matches = Array.from(block.matchAll(/\(([^)]+)\)\s*Tj/g)).map((m) => m[1]);
          const textStr = matches.join(' ').replace(/\\([\(\)\\])/g, '$1');
          totalChars += textStr.replace(/\s+/g, '').length;
          pagesArr.push({ pageNumber: pIdx, text: textStr });
        }
        if (pagesArr.length > 0 && totalChars >= 10) {
          return {
            ok: true,
            pages: pagesArr,
            totalPages: pagesArr.length,
            totalChars,
            isScanned: false,
            readingQuality: 'alta',
          };
        }
      }
    } catch (fbErr: any) {
      /* fallback */
    }

    return {
      ok: false,
      pages: [],
      totalPages: 0,
      totalChars: 0,
      isScanned: true,
      readingQuality: 'sem_camada_texto',
      error: `Erro ao extrair texto do PDF: ${err?.message || err}`,
    };
  }
}

/**
 * Fragmenta o texto das páginas em trechos pesquisáveis de tamanho controlado.
 */
export function chunkPageText(
  pages: Array<{ pageNumber: number; text: string }>,
  chunkSize: number = 400
): Array<{ pageNumber: number; chunkIndex: number; content: string }> {
  const chunks: Array<{ pageNumber: number; chunkIndex: number; content: string }> = [];

  for (const page of pages) {
    const text = page.text.trim();
    if (!text) continue;

    if (text.length <= chunkSize) {
      chunks.push({
        pageNumber: page.pageNumber,
        chunkIndex: chunks.filter((c) => c.pageNumber === page.pageNumber).length,
        content: text,
      });
      continue;
    }

    const lines = text.split(/(?<=\.|\n|\;)\s+/);
    let currentChunk = '';
    let pageChunkIdx = 0;

    for (const line of lines) {
      if ((currentChunk + ' ' + line).length > chunkSize && currentChunk.length > 50) {
        chunks.push({
          pageNumber: page.pageNumber,
          chunkIndex: pageChunkIdx++,
          content: currentChunk.trim(),
        });
        currentChunk = line;
      } else {
        currentChunk = currentChunk ? `${currentChunk} ${line}` : line;
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push({
        pageNumber: page.pageNumber,
        chunkIndex: pageChunkIdx++,
        content: currentChunk.trim(),
      });
    }
  }

  return chunks;
}

// ----------------------------------------------------------------------------
// PIPELINE DE INDEXAÇÃO DOCUMENTAL (PUBLICAÇÃO ATÔMICA & PERSISTENTE)
// ----------------------------------------------------------------------------

export async function indexDocument(params: {
  condoId: string;
  documentId: string;
  driveFileId: string;
  driveFileName: string;
  category: string;
  pdfBuffer: Buffer;
  workerId?: string;
  supabaseAdmin?: any;
}): Promise<{
  ok: boolean;
  documentId: string;
  status: 'indexed' | 'sem_camada_texto' | 'tamanho_excedido' | 'erro_extracao' | 'nao_indexavel' | 'feature_not_configured';
  totalPages: number;
  totalChunks: number;
  totalChars: number;
  version: number;
  message: string;
}> {
  const { condoId, documentId, driveFileId, driveFileName, category, pdfBuffer, workerId = `worker_${process.pid}`, supabaseAdmin } = params;
  const nowStr = new Date().toISOString();

  // Se não houver cliente Supabase, executa em modo de teste isolado
  if (!supabaseAdmin) {
    return indexDocumentTestMode(params);
  }

  // 1. Validação de Tamanho (Limite Operacional de 30 MB)
  if (pdfBuffer && pdfBuffer.length > MAX_FILE_SIZE_BYTES) {
    const sizeMb = (pdfBuffer.length / (1024 * 1024)).toFixed(1);
    const msg = `O arquivo PDF possui ${sizeMb} MB, excedendo o limite operacional de 30 MB da Triverus. A análise não pode ser realizada de forma parcial para evitar interpretações incompletas.`;

    const statusRecord = {
      document_id: documentId,
      condo_id: condoId,
      drive_file_id: driveFileId,
      drive_file_name: driveFileName,
      category,
      indexing_status: 'tamanho_excedido',
      indexing_version: 1,
      active_version: 0,
      total_pages: 0,
      total_chunks: 0,
      total_chars: pdfBuffer.length,
      retry_count: 0,
      max_retries: 3,
      last_error: msg,
      last_indexed_at: nowStr,
      updated_at: nowStr,
    };

    try {
      await supabaseAdmin.from('auditoria_documentos_status').upsert(statusRecord);
    } catch (e: any) {
      console.warn('[Indexation] Falha ao atualizar auditoria_documentos_status:', e?.message);
    }

    return {
      ok: false,
      documentId,
      status: 'tamanho_excedido',
      totalPages: 0,
      totalChunks: 0,
      totalChars: pdfBuffer.length,
      version: 1,
      message: msg,
    };
  }

  // 2. Leitura da versão atual e reserva da trava pelo workerId
  let activeVersion = 0;
  let nextVersion = 1;

  try {
    const { data: currentStatus, error: statusErr } = await supabaseAdmin
      .from('auditoria_documentos_status')
      .select('*')
      .eq('document_id', documentId)
      .maybeSingle();

    if (statusErr && (statusErr.code === '42P01' || statusErr.message?.includes('does not exist'))) {
      return {
        ok: false,
        documentId,
        status: 'feature_not_configured',
        totalPages: 0,
        totalChunks: 0,
        totalChars: 0,
        version: 0,
        message: 'A busca no acervo documental exige a aplicação da migração de banco de dados no Supabase (tabelas auditoria_documentos_index e auditoria_documentos_status pendentes de criação).',
      };
    }

    if (currentStatus) {
      activeVersion = currentStatus.active_version || 0;
      nextVersion = (currentStatus.indexing_version || activeVersion) + 1;
    }

    // Sinaliza início de indexação da nova versão registrando workerId
    await supabaseAdmin.from('auditoria_documentos_status').upsert({
      document_id: documentId,
      condo_id: condoId,
      drive_file_id: driveFileId,
      drive_file_name: driveFileName,
      category,
      indexing_status: 'indexing',
      indexing_version: nextVersion,
      active_version: activeVersion,
      locked_at: nowStr,
      locked_by: workerId,
      updated_at: nowStr,
    });
  } catch (e: any) {
    console.warn('[Indexation] Erro ao consultar estado do documento:', e?.message);
  }

  // 3. Extração do Texto por Páginas
  const extraction = await extractPdfTextByPages(pdfBuffer);
  if (!extraction.ok) {
    const isNoText = extraction.readingQuality === 'sem_camada_texto' || extraction.isScanned;
    const finalStatus = isNoText ? 'sem_camada_texto' : 'erro_extracao';
    const msg = isNoText
      ? `O documento PDF "${driveFileName}" é digitalizado (imagem) ou não possui camada de texto selecionável. É necessário OCR prévio para indexação e leitura textual.`
      : (extraction.error || 'Erro ao extrair texto do documento PDF.');

    try {
      await supabaseAdmin.from('auditoria_documentos_status').upsert({
        document_id: documentId,
        condo_id: condoId,
        drive_file_id: driveFileId,
        drive_file_name: driveFileName,
        category,
        indexing_status: finalStatus,
        indexing_version: nextVersion,
        active_version: activeVersion, // Mantém a versão anterior ativa se houver
        last_error: msg,
        locked_at: null,
        locked_by: null,
        updated_at: nowStr,
      });
    } catch (e: any) {}

    return {
      ok: false,
      documentId,
      status: finalStatus,
      totalPages: 0,
      totalChunks: 0,
      totalChars: 0,
      version: nextVersion,
      message: msg,
    };
  }

  // 4. Fragmentação (Chunking) e Inserção da Nova Versão
  const pageChunks = chunkPageText(extraction.pages);
  const newChunks: any[] = [];

  for (let i = 0; i < pageChunks.length; i++) {
    const item = pageChunks[i];
    const cleanContent = removeAccents(item.content).toLowerCase();

    newChunks.push({
      condo_id: condoId,
      document_id: documentId,
      drive_file_id: driveFileId,
      drive_file_name: driveFileName,
      category: category.toLowerCase(),
      page_number: item.pageNumber,
      chunk_index: item.chunkIndex,
      content: item.content,
      content_clean: cleanContent,
      char_count: item.content.length,
      word_count: item.content.split(/\s+/).length,
      indexing_status: 'indexed',
      indexing_version: nextVersion,
      created_at: nowStr,
      updated_at: nowStr,
    });
  }

  try {
    // Insere os trechos da nova versão no banco
    if (newChunks.length > 0) {
      const { error: insertErr } = await supabaseAdmin.from('auditoria_documentos_index').insert(newChunks);
      if (insertErr) {
        throw new Error(`Falha ao salvar trechos no Supabase: ${insertErr.message}`);
      }
    }

    // 5. Publicação Atômica Estrita via Stored Procedure Segura no Supabase
    const { error: rpcErr } = await supabaseAdmin.rpc('publish_auditoria_document_index_version', {
      p_document_id: documentId,
      p_condo_id: condoId,
      p_new_version: nextVersion,
      p_expected_chunks: newChunks.length,
      p_expected_pages: extraction.totalPages,
      p_expected_chars: extraction.totalChars,
      p_worker_id: workerId,
    });

    if (rpcErr) {
      throw new Error(`Falha na publicação atômica via RPC publish_auditoria_document_index_version: ${rpcErr.message}`);
    }

    return {
      ok: true,
      documentId,
      status: 'indexed',
      totalPages: extraction.totalPages,
      totalChunks: newChunks.length,
      totalChars: extraction.totalChars,
      version: nextVersion,
      message: `Documento "${driveFileName}" indexado com sucesso no Supabase (${extraction.totalPages} pág, ${newChunks.length} trechos).`,
    };
  } catch (err: any) {
    console.error('[Indexation] Erro durante a publicação da nova versão:', err?.message);

    // Remove chunks incompletos da versão que falhou
    try {
      await supabaseAdmin
        .from('auditoria_documentos_index')
        .delete()
        .eq('document_id', documentId)
        .eq('indexing_version', nextVersion);

      await supabaseAdmin.from('auditoria_documentos_status').upsert({
        document_id: documentId,
        condo_id: condoId,
        drive_file_id: driveFileId,
        drive_file_name: driveFileName,
        category,
        indexing_status: 'erro_extracao',
        indexing_version: nextVersion,
        active_version: activeVersion, // Mantém a versão anterior publicada intacta
        last_error: err?.message || 'Erro durante gravação da indexação.',
        locked_at: null,
        locked_by: null,
        updated_at: nowStr,
      });
    } catch (e: any) {}

    return {
      ok: false,
      documentId,
      status: 'erro_extracao',
      totalPages: 0,
      totalChunks: 0,
      totalChars: 0,
      version: activeVersion,
      message: `Erro na publicação da indexação: ${err?.message || err}`,
    };
  }
}

/**
 * Modo de teste isolado para suítes unitárias sem banco Supabase remoto.
 */
function indexDocumentTestMode(params: any) {
  const { condoId, documentId, driveFileId, driveFileName, category, pdfBuffer } = params;
  const nowStr = new Date().toISOString();

  if (pdfBuffer && pdfBuffer.length > MAX_FILE_SIZE_BYTES) {
    const sizeMb = (pdfBuffer.length / (1024 * 1024)).toFixed(1);
    const msg = `O arquivo PDF possui ${sizeMb} MB, excedendo o limite operacional de 30 MB da Triverus. A análise não pode ser realizada de forma parcial para evitar interpretações incompletas.`;
    return Promise.resolve({
      ok: false,
      documentId,
      status: 'tamanho_excedido' as const,
      totalPages: 0,
      totalChunks: 0,
      totalChars: pdfBuffer.length,
      version: 1,
      message: msg,
    });
  }

  return extractPdfTextByPages(pdfBuffer).then((extraction) => {
    if (!extraction.ok) {
      const isNoText = extraction.readingQuality === 'sem_camada_texto' || extraction.isScanned;
      const finalStatus = isNoText ? ('sem_camada_texto' as const) : ('erro_extracao' as const);
      const msg = isNoText
        ? `O documento PDF "${driveFileName}" é digitalizado (imagem) ou não possui camada de texto selecionável. É necessário OCR prévio para indexação e leitura textual.`
        : (extraction.error || 'Erro ao extrair texto do documento PDF.');

      return {
        ok: false,
        documentId,
        status: finalStatus,
        totalPages: 0,
        totalChunks: 0,
        totalChars: 0,
        version: 1,
        message: msg,
      };
    }

    const existingStatus = testModeStatus.get(documentId);
    const nextVersion = (existingStatus?.indexing_version || 0) + 1;

    for (const [chunkId, chunk] of Array.from(testModeIndex.entries())) {
      if (chunk.document_id === documentId) {
        testModeIndex.delete(chunkId);
      }
    }

    const pageChunks = chunkPageText(extraction.pages);
    const newChunks: DocumentChunk[] = [];

    for (let i = 0; i < pageChunks.length; i++) {
      const item = pageChunks[i];
      const chunkId = `idx_${documentId}_p${item.pageNumber}_c${item.chunkIndex}_v${nextVersion}`;
      const cleanContent = removeAccents(item.content).toLowerCase();

      const chunkObj: DocumentChunk = {
        id: chunkId,
        condo_id: condoId,
        document_id: documentId,
        drive_file_id: driveFileId,
        drive_file_name: driveFileName,
        category: category.toLowerCase(),
        page_number: item.pageNumber,
        chunk_index: item.chunkIndex,
        content: item.content,
        content_clean: cleanContent,
        char_count: item.content.length,
        word_count: item.content.split(/\s+/).length,
        indexing_status: 'indexed',
        indexing_version: nextVersion,
        created_at: nowStr,
        updated_at: nowStr,
      };

      testModeIndex.set(chunkId, chunkObj);
      newChunks.push(chunkObj);
    }

    const finalStatus: DocumentIndexStatus = {
      document_id: documentId,
      condo_id: condoId,
      drive_file_id: driveFileId,
      drive_file_name: driveFileName,
      category,
      indexing_status: 'indexed',
      indexing_version: nextVersion,
      active_version: nextVersion,
      total_pages: extraction.totalPages,
      total_chunks: newChunks.length,
      total_chars: extraction.totalChars,
      retry_count: 0,
      max_retries: 3,
      last_indexed_at: nowStr,
      created_at: existingStatus?.created_at || nowStr,
      updated_at: nowStr,
    };

    testModeStatus.set(documentId, finalStatus);

    return {
      ok: true,
      documentId,
      status: 'indexed' as const,
      totalPages: extraction.totalPages,
      totalChunks: newChunks.length,
      totalChars: extraction.totalChars,
      version: nextVersion,
      message: `Documento "${driveFileName}" indexado em modo de teste.`,
    };
  });
}

/**
 * Remove o índice do documento quando desvinculado.
 */
export async function removeDocumentIndex(
  documentId: string,
  supabaseAdmin?: any
): Promise<{ ok: boolean; removedChunks: number }> {
  let count = 0;

  for (const [chunkId, chunk] of Array.from(testModeIndex.entries())) {
    if (chunk.document_id === documentId) {
      testModeIndex.delete(chunkId);
      count++;
    }
  }
  testModeStatus.delete(documentId);

  if (supabaseAdmin) {
    try {
      const { data } = await supabaseAdmin
        .from('auditoria_documentos_index')
        .delete()
        .eq('document_id', documentId)
        .select('id');

      if (Array.isArray(data)) count = data.length;

      await supabaseAdmin.from('auditoria_documentos_status').delete().eq('document_id', documentId);
    } catch (err: any) {
      /* noop */
    }
  }

  return { ok: true, removedChunks: count };
}

// ----------------------------------------------------------------------------
// BUSCA TEXTUAL E CONSULTA DE SEÇÕES (SEM FALLBACK DE PRODUÇÃO EM MEMÓRIA)
// ----------------------------------------------------------------------------

export async function searchDocumentContent(
  params: SearchDocumentContentParams,
  userAuth: any,
  supabaseAdmin?: any
): Promise<SearchDocumentContentResult> {
  // 1. Validação do Usuário
  if (!userAuth || !userAuth.isActive) {
    return { ok: false, error: 'inactive_user', message: 'Acesso negado: conta inativa.' };
  }

  const query = (params.query || '').trim();
  if (!query) {
    return { ok: false, error: 'empty_query', message: 'Informe um termo ou palavra-chave para a busca.' };
  }

  // Se não houver cliente Supabase, executa em modo de teste isolado
  if (!supabaseAdmin) {
    return searchDocumentContentTestMode(params, userAuth);
  }

  const normQuery = removeAccents(query).toLowerCase();
  const queryTerms = normQuery.split(/\s+/).filter((t) => t.length > 1);

  const condoRef = (params.condoId || params.condoName || '').trim();
  const categoryFilter = (params.category || '').trim().toLowerCase();
  const docFilter = (params.documentId || params.driveFileId || '').trim();
  const pageMin = params.pageMin ? Number(params.pageMin) : null;
  const pageMax = params.pageMax ? Number(params.pageMax) : null;
  const limit = Math.min(Math.max(Number(params.limit || 10), 1), 50);

  let targetCondoId: string | null = null;
  let targetCondoName: string | null = null;

  if (condoRef) {
    try {
      const { data: leadData } = await supabaseAdmin
        .from('leads')
        .select('id, name')
        .or(`id.eq.${condoRef},name.ilike.%${condoRef}%`)
        .limit(1)
        .maybeSingle();

      if (leadData) {
        targetCondoId = leadData.id;
        targetCondoName = leadData.name;
      }
    } catch (e: any) {}
  }

  try {
    let qBuilder = supabaseAdmin.from('auditoria_documentos_index').select('*');
    if (targetCondoId) qBuilder = qBuilder.eq('condo_id', targetCondoId);
    if (categoryFilter) qBuilder = qBuilder.eq('category', categoryFilter);
    if (docFilter) qBuilder = qBuilder.or(`document_id.eq.${docFilter},drive_file_id.eq.${docFilter}`);
    if (pageMin !== null) qBuilder = qBuilder.gte('page_number', pageMin);
    if (pageMax !== null) qBuilder = qBuilder.lte('page_number', pageMax);

    const { data, error } = await qBuilder;

    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return {
          ok: false,
          error: 'feature_not_configured',
          message: 'A busca no acervo documental exige a aplicação da migração de banco de dados no Supabase (tabelas auditoria_documentos_index e auditoria_documentos_status pendentes de criação).',
        };
      }
      return {
        ok: false,
        error: 'db_error',
        message: `Erro ao consultar banco de dados Supabase: ${error.message}`,
      };
    }

    const candidates: DocumentChunk[] = data || [];
    const matchedResults: SearchResultItem[] = [];

    for (const chunk of candidates) {
      const chunkClean = chunk.content_clean || removeAccents(chunk.content).toLowerCase();
      let score = 0;

      if (chunkClean.includes(normQuery)) score += 100;

      for (const term of queryTerms) {
        if (chunkClean.includes(term)) score += 20;
      }

      if (score > 0) {
        matchedResults.push({
          condominio_id: chunk.condo_id,
          condominio_nome: targetCondoName || 'Condomínio Vinculado',
          documento_id: chunk.document_id,
          drive_file_id: chunk.drive_file_id,
          nome_arquivo: chunk.drive_file_name,
          categoria: chunk.category,
          pagina: chunk.page_number,
          chunk_index: chunk.chunk_index,
          trecho_original: chunk.content,
          relevancia: score,
          estado_indexacao: chunk.indexing_status || 'indexed',
          versao_indice: chunk.indexing_version || 1,
        });
      }
    }

    matchedResults.sort((a, b) => b.relevancia - a.relevancia);

    return {
      ok: true,
      query,
      total: matchedResults.length,
      results: matchedResults.slice(0, limit),
    };
  } catch (err: any) {
    return {
      ok: false,
      error: 'db_error',
      message: `Exceção ao consultar o índice no Supabase: ${err?.message || err}`,
    };
  }
}

function searchDocumentContentTestMode(params: any, userAuth: any): SearchDocumentContentResult {
  if (!userAuth || !userAuth.isActive) {
    return { ok: false, error: 'inactive_user', message: 'Acesso negado: conta inativa.' };
  }

  if (!userAuth.isAdmin) {
    const canAccess = Boolean(userAuth.userPermissions?.can_access_auditoria || userAuth.userPermissions?.can_manage_auditoria);
    if (!canAccess) {
      return {
        ok: false,
        error: 'permission_denied',
        message: 'Acesso restrito: seu perfil de usuário não possui permissão para consultar o índice da Auditoria.',
      };
    }
  }

  const query = (params.query || '').trim();
  const normQuery = removeAccents(query).toLowerCase();
  const queryTerms = normQuery.split(/\s+/).filter((t: string) => t.length > 1);

  const condoRef = (params.condoId || params.condoName || '').trim();
  const categoryFilter = (params.category || '').trim().toLowerCase();
  const docFilter = (params.documentId || params.driveFileId || '').trim();
  const pageMin = params.pageMin ? Number(params.pageMin) : null;
  const pageMax = params.pageMax ? Number(params.pageMax) : null;
  const limit = Math.min(Math.max(Number(params.limit || 10), 1), 50);

  const candidates = Array.from(testModeIndex.values());
  const matchedResults: SearchResultItem[] = [];

  for (const chunk of candidates) {
    if (condoRef && chunk.condo_id !== condoRef) continue;
    if (categoryFilter && chunk.category !== categoryFilter) continue;
    if (docFilter && chunk.document_id !== docFilter && chunk.drive_file_id !== docFilter) continue;
    if (pageMin !== null && chunk.page_number < pageMin) continue;
    if (pageMax !== null && chunk.page_number > pageMax) continue;

    const chunkClean = chunk.content_clean || removeAccents(chunk.content).toLowerCase();
    let score = 0;

    if (chunkClean.includes(normQuery)) score += 100;

    for (const term of queryTerms) {
      if (chunkClean.includes(term)) score += 20;
    }

    if (score > 0) {
      matchedResults.push({
        condominio_id: chunk.condo_id,
        condominio_nome: 'Condomínio Vinculado',
        documento_id: chunk.document_id,
        drive_file_id: chunk.drive_file_id,
        nome_arquivo: chunk.drive_file_name,
        categoria: chunk.category,
        pagina: chunk.page_number,
        chunk_index: chunk.chunk_index,
        trecho_original: chunk.content,
        relevancia: score,
        estado_indexacao: chunk.indexing_status || 'indexed',
        versao_indice: chunk.indexing_version || 1,
      });
    }
  }

  matchedResults.sort((a, b) => b.relevancia - a.relevancia);

  return {
    ok: true,
    query,
    total: matchedResults.length,
    results: matchedResults.slice(0, limit),
  };
}

/**
 * Recupera o conteúdo textual completo de uma página ou seção do documento indexado.
 */
export async function readDocumentSection(
  params: ReadDocumentSectionParams,
  userAuth: any,
  supabaseAdmin?: any
): Promise<ReadDocumentSectionResult> {
  if (!userAuth || !userAuth.isActive) {
    return { ok: false, error: 'inactive_user', message: 'Acesso negado: conta inativa.' };
  }

  const pageNum = Number(params.pageNumber || 1);
  const docRef = (params.documentId || params.driveFileId || '').trim();
  const categoryFilter = (params.category || '').trim().toLowerCase();

  if (!supabaseAdmin) {
    return readDocumentSectionTestMode(params, userAuth);
  }

  try {
    let qBuilder = supabaseAdmin.from('auditoria_documentos_index').select('*');
    if (docRef) qBuilder = qBuilder.or(`document_id.eq.${docRef},drive_file_id.eq.${docRef}`);
    if (categoryFilter) qBuilder = qBuilder.eq('category', categoryFilter);
    qBuilder = qBuilder.eq('page_number', pageNum);

    const { data, error } = await qBuilder;

    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return {
          ok: false,
          error: 'feature_not_configured',
          message: 'A leitura de seções exige a aplicação da migração de banco no Supabase (tabelas pendentes).',
        };
      }
      return { ok: false, error: 'db_error', message: error.message };
    }

    const pageChunks: DocumentChunk[] = data || [];
    pageChunks.sort((a, b) => a.chunk_index - b.chunk_index);

    if (pageChunks.length === 0) {
      return {
        ok: false,
        error: 'section_not_found',
        message: `Página ${pageNum} não foi localizada nos documentos indexados para o filtro especificado.`,
        pagina: pageNum,
      };
    }

    const first = pageChunks[0];
    const combinedText = pageChunks.map((c) => c.content).join('\n\n');

    return {
      ok: true,
      condominio_id: first.condo_id,
      documento_id: first.document_id,
      drive_file_id: first.drive_file_id,
      nome_arquivo: first.drive_file_name,
      categoria: first.category,
      pagina: pageNum,
      conteudo_pagina: combinedText,
      trechos_encontrados: pageChunks.length,
      estado_indexacao: first.indexing_status || 'indexed',
      versao_indice: first.indexing_version || 1,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: 'db_error',
      message: `Erro ao ler seção no Supabase: ${err?.message || err}`,
    };
  }
}

function readDocumentSectionTestMode(params: any, userAuth: any): ReadDocumentSectionResult {
  if (!userAuth || !userAuth.isActive) {
    return { ok: false, error: 'inactive_user', message: 'Acesso negado: conta inativa.' };
  }

  if (!userAuth.isAdmin) {
    const canAccess = Boolean(userAuth.userPermissions?.can_access_auditoria || userAuth.userPermissions?.can_manage_auditoria);
    if (!canAccess) {
      return {
        ok: false,
        error: 'permission_denied',
        message: 'Acesso restrito: seu perfil de usuário não possui permissão para ler seções da Auditoria.',
      };
    }
  }

  const pageNum = Number(params.pageNumber || 1);
  const docRef = (params.documentId || params.driveFileId || '').trim();
  const categoryFilter = (params.category || '').trim().toLowerCase();

  const chunks = Array.from(testModeIndex.values()).filter((c) => {
    if (docRef && c.document_id !== docRef && c.drive_file_id !== docRef) return false;
    if (categoryFilter && c.category !== categoryFilter) return false;
    return c.page_number === pageNum;
  });

  chunks.sort((a, b) => a.chunk_index - b.chunk_index);

  if (chunks.length === 0) {
    return {
      ok: false,
      error: 'section_not_found',
      message: `Página ${pageNum} não foi localizada nos documentos indexados.`,
      pagina: pageNum,
    };
  }

  const first = chunks[0];
  const combinedText = chunks.map((c) => c.content).join('\n\n');

  return {
    ok: true,
    condominio_id: first.condo_id,
    documento_id: first.document_id,
    drive_file_id: first.drive_file_id,
    nome_arquivo: first.drive_file_name,
    categoria: first.category,
    pagina: pageNum,
    conteudo_pagina: combinedText,
    trechos_encontrados: chunks.length,
    estado_indexacao: first.indexing_status || 'indexed',
    versao_indice: first.indexing_version || 1,
  };
}

export function getInMemoryIndexState() {
  return {
    indexMap: testModeIndex,
    statusMap: testModeStatus,
  };
}
