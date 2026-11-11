import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import { removeAccents } from './crmTools.js';

// ----------------------------------------------------------------------------
// INTERFACES E CONSTANTES
// ----------------------------------------------------------------------------
const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024; // 30 MB

function customPageRenderer(pageData) {
  const render_options = {
    normalizeWhitespace: true,
    disableCombineTextItems: false,
  };
  return pageData.getTextContent(render_options).then((textContent) => {
    let lastY;
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
export async function extractPdfTextByPages(pdfBuffer) {
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

    const pages = [];
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
  } catch (err) {
    return {
      ok: false,
      pages: [],
      totalPages: 0,
      totalChars: 0,
      isScanned: true,
      readingQuality: 'sem_camada_texto',
      error: `Erro ao extrair texto do PDF: ${err && err.message ? err.message : err}`,
    };
  }
}

/**
 * Fragmenta o texto das páginas em trechos pesquisáveis de tamanho controlado.
 */
export function chunkPageText(pages, chunkSize = 400) {
  const chunks = [];

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

/**
 * Pipeline de indexação documental
 */
export async function indexDocument(params) {
  const { condoId, documentId, driveFileId, driveFileName, category, pdfBuffer, workerId = `worker_${process.pid}`, supabaseAdmin } = params;
  const nowStr = new Date().toISOString();

  if (!supabaseAdmin) {
    throw new Error('SupabaseAdmin é obrigatório para indexDocument em produção.');
  }

  if (pdfBuffer && pdfBuffer.length > MAX_FILE_SIZE_BYTES) {
    const sizeMb = (pdfBuffer.length / (1024 * 1024)).toFixed(1);
    const msg = `O arquivo PDF possui ${sizeMb} MB, excedendo o limite operacional de 30 MB da Triverus.`;
    await supabaseAdmin.from('auditoria_documentos_status').upsert({
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
    });
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

  let activeVersion = 0;
  let nextVersion = 1;

  const { data: currentStatus } = await supabaseAdmin
    .from('auditoria_documentos_status')
    .select('*')
    .eq('document_id', documentId)
    .maybeSingle();

  if (currentStatus) {
    activeVersion = currentStatus.active_version || 0;
    nextVersion = (currentStatus.indexing_version || activeVersion) + 1;
  }

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

  const extraction = await extractPdfTextByPages(pdfBuffer);
  if (!extraction.ok) {
    const isNoText = extraction.readingQuality === 'sem_camada_texto' || extraction.isScanned;
    const finalStatus = isNoText ? 'sem_camada_texto' : 'erro_extracao';
    const msg = isNoText
      ? `O documento PDF "${driveFileName}" é digitalizado (imagem) ou não possui camada de texto selecionável.`
      : (extraction.error || 'Erro ao extrair texto do documento PDF.');

    await supabaseAdmin.from('auditoria_documentos_status').upsert({
      document_id: documentId,
      condo_id: condoId,
      drive_file_id: driveFileId,
      drive_file_name: driveFileName,
      category,
      indexing_status: finalStatus,
      indexing_version: nextVersion,
      active_version: activeVersion,
      last_error: msg,
      locked_at: null,
      locked_by: null,
      updated_at: nowStr,
    });

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

  const pageChunks = chunkPageText(extraction.pages);
  const newChunks = [];

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

  if (newChunks.length > 0) {
    const { error: insertErr } = await supabaseAdmin.from('auditoria_documentos_index').insert(newChunks);
    if (insertErr) {
      throw new Error(`Falha ao salvar trechos no Supabase: ${insertErr.message}`);
    }
  }

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
    throw new Error(`Falha na publicação atômica via RPC: ${rpcErr.message}`);
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
}
