/**
 * SERVIÇO CANÔNICO DE REGRAS DE NEGÓCIO DAS MEMÓRIAS DA AUDITORIA (TRIVERUS)
 *
 * Módulo compartilhado para garantir consistência estrita entre endpoints HTTP reais
 * e a suíte de testes automatizados, evitando duplicações ou divergências lógicas.
 */

/**
 * Prepara e valida os dados para criação de uma nova memória (POST)
 */
export function prepareMemoryCreate(params) {
  // 1. Garantir autoria autenticada obrigatória
  if (!params.currentUserId || typeof params.currentUserId !== 'string' || !params.currentUserId.trim()) {
    throw new Error('Usuário autenticado não identificado para autoria do cadastro.');
  }

  const cleanCategory = String(params.category || '').trim().toLowerCase();
  const cleanLabel = String(params.label || '').trim();

  // 2. Validação estrita do fill_mode (rejeita valores inválidos, padrão 'ai' se omitido)
  let fillMode;
  if (params.fill_mode === undefined || params.fill_mode === null || params.fill_mode === '') {
    fillMode = 'ai';
  } else if (params.fill_mode === 'manual' || params.fill_mode === 'ai') {
    fillMode = params.fill_mode;
  } else {
    throw new Error(`Modo de preenchimento inválido: "${params.fill_mode}". Valores permitidos: 'manual' ou 'ai'.`);
  }

  if (!cleanCategory || !cleanLabel) {
    throw new Error('Campos obrigatórios ausentes (category, label).');
  }

  if (fillMode === 'manual') {
    if (!params.manual_value || typeof params.manual_value !== 'string' || !params.manual_value.trim()) {
      throw new Error('O valor da informação é obrigatório no modo Manual.');
    }
  } else {
    if (!params.source_drive_file_id || typeof params.source_drive_file_id !== 'string' || !params.source_drive_file_id.trim()) {
      throw new Error('A seleção de um PDF desta etapa é obrigatória no modo Buscar com IA.');
    }
    if (!params.instruction || typeof params.instruction !== 'string' || !params.instruction.trim()) {
      throw new Error('A instrução de busca para a IA é obrigatória no modo Buscar com IA.');
    }
  }

  const memoryId = params.memoryId || crypto.randomUUID();
  const timestamp = params.now || new Date().toISOString();

  return {
    id: memoryId,
    condo_id: params.condoId,
    category: cleanCategory,
    label: cleanLabel,
    fill_mode: fillMode,
    manual_value: fillMode === 'manual' ? String(params.manual_value).trim() : null,
    instruction: fillMode === 'ai' ? String(params.instruction).trim() : null,
    source_document_id: fillMode === 'ai' && params.source_document_id ? String(params.source_document_id).trim() : null,
    source_drive_file_id: fillMode === 'ai' && params.source_drive_file_id ? String(params.source_drive_file_id).trim() : null,
    source_drive_file_name: fillMode === 'ai' && params.source_drive_file_name ? String(params.source_drive_file_name).trim() : null,
    last_result: null,
    page_reference: null,
    last_result_metadata: null,
    status: fillMode === 'manual' ? 'result_available' : 'never_searched',
    last_executed_at: null,
    source_file_modified_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    created_by: params.currentUserId.trim(),
  };
}

/**
 * Prepara e valida a atualização de uma memória existente (PUT)
 * Trata rigorosamente a consistência de modos e a atualização de metadados quando o PDF mudar.
 */
export function prepareMemoryUpdate(existingRecord, updatesInput) {
  if (!existingRecord) {
    throw new Error('Memória não encontrada para atualização.');
  }

  // 1. Resolver rótulo (label)
  let finalLabel = existingRecord.label;
  if (updatesInput.label !== undefined) {
    const cleanLabel = String(updatesInput.label).trim();
    if (!cleanLabel) {
      throw new Error('O nome da memória não pode ser vazio.');
    }
    finalLabel = cleanLabel;
  }

  // 2. Resolver e validar modo de preenchimento final
  let finalFillMode;
  if (updatesInput.fill_mode === undefined || updatesInput.fill_mode === null) {
    finalFillMode = existingRecord.fill_mode;
  } else if (updatesInput.fill_mode === 'manual' || updatesInput.fill_mode === 'ai') {
    finalFillMode = updatesInput.fill_mode;
  } else {
    throw new Error(`Modo de preenchimento inválido: "${updatesInput.fill_mode}". Valores permitidos: 'manual' ou 'ai'.`);
  }

  const isModeTransition = existingRecord.fill_mode !== finalFillMode;
  const timestamp = updatesInput.now || new Date().toISOString();
  const updates = {
    label: finalLabel,
    fill_mode: finalFillMode,
    updated_at: timestamp,
  };

  // 3. Validação do Modo Manual
  if (finalFillMode === 'manual') {
    let candidateManualVal = null;
    if (updatesInput.manual_value !== undefined) {
      candidateManualVal = updatesInput.manual_value !== null ? String(updatesInput.manual_value).trim() : '';
    } else {
      candidateManualVal = existingRecord.manual_value ? String(existingRecord.manual_value).trim() : '';
    }

    if (!candidateManualVal) {
      throw new Error(
        isModeTransition
          ? 'Ao alterar para o modo Manual, o preenchimento do valor da informação é obrigatório.'
          : 'O valor da informação é obrigatório no modo Manual.'
      );
    }

    // Regra canônica: Modo manual limpa todos os metadados de arquivo e IA
    updates.manual_value = candidateManualVal;
    updates.instruction = null;
    updates.source_document_id = null;
    updates.source_drive_file_id = null;
    updates.source_drive_file_name = null;
    updates.source_file_modified_at = null; // Limpa também data de modificação

    if (isModeTransition) {
      updates.status = 'result_available';
      updates.last_result = null;
      updates.page_reference = null;
      updates.last_result_metadata = null;
      updates.last_executed_at = null;
    } else if (updatesInput.manual_value !== undefined) {
      updates.status = 'result_available';
    }
  } else {
    // 4. Validação do Modo IA
    let candidateInstruction = null;
    if (updatesInput.instruction !== undefined) {
      candidateInstruction = updatesInput.instruction !== null ? String(updatesInput.instruction).trim() : '';
    } else {
      candidateInstruction = existingRecord.instruction ? String(existingRecord.instruction).trim() : '';
    }

    if (!candidateInstruction) {
      throw new Error(
        isModeTransition
          ? 'Ao alterar para o modo Buscar com IA, a instrução de busca para a IA é obrigatória.'
          : 'A instrução de busca para a IA é obrigatória no modo Buscar com IA.'
      );
    }

    let candidateDriveFileId = null;
    if (updatesInput.source_drive_file_id !== undefined) {
      candidateDriveFileId = updatesInput.source_drive_file_id !== null ? String(updatesInput.source_drive_file_id).trim() : '';
    } else {
      candidateDriveFileId = existingRecord.source_drive_file_id ? String(existingRecord.source_drive_file_id).trim() : '';
    }

    if (!candidateDriveFileId) {
      throw new Error(
        isModeTransition
          ? 'Ao alterar para o modo Buscar com IA, a seleção de um PDF desta etapa é obrigatória.'
          : 'A seleção de um PDF desta etapa é obrigatória no modo Buscar com IA.'
      );
    }

    // Detecção de mudança de arquivo PDF
    const fileChanged = candidateDriveFileId !== existingRecord.source_drive_file_id;
    const instructionChanged = candidateInstruction !== existingRecord.instruction;

    updates.manual_value = null;
    updates.instruction = candidateInstruction;
    updates.source_drive_file_id = candidateDriveFileId;

    if (fileChanged) {
      // Quando o PDF de origem mudar:
      // - Não preservar nome antigo caso novo não venha informado
      // - Não preservar source_document_id antigo
      // - Limpar source_file_modified_at até que seja reobtido
      updates.source_drive_file_name =
        updatesInput.source_drive_file_name !== undefined && updatesInput.source_drive_file_name !== null
          ? String(updatesInput.source_drive_file_name).trim() || null
          : null;

      updates.source_document_id =
        updatesInput.source_document_id !== undefined && updatesInput.source_document_id !== null
          ? String(updatesInput.source_document_id).trim() || null
          : null;

      updates.source_file_modified_at = null;
    } else {
      // Quando o PDF NÃO mudar:
      // Preservar metadados existentes a menos que sejam explicitamente fornecidos
      if (updatesInput.source_drive_file_name !== undefined) {
        updates.source_drive_file_name =
          updatesInput.source_drive_file_name !== null ? String(updatesInput.source_drive_file_name).trim() || null : null;
      } else {
        updates.source_drive_file_name = existingRecord.source_drive_file_name || null;
      }

      if (updatesInput.source_document_id !== undefined) {
        updates.source_document_id =
          updatesInput.source_document_id !== null ? String(updatesInput.source_document_id).trim() || null : null;
      } else {
        updates.source_document_id = existingRecord.source_document_id || null;
      }

      updates.source_file_modified_at = existingRecord.source_file_modified_at || null;
    }

    if (isModeTransition) {
      updates.status = 'never_searched';
      updates.last_result = null;
      updates.page_reference = null;
      updates.last_result_metadata = null;
      updates.last_executed_at = null;
    } else {
      // Se manteve no modo IA, mas mudou arquivo ou instrução e havia resultado disponível, marca como outdated
      if ((fileChanged || instructionChanged) && existingRecord.status === 'result_available') {
        updates.status = 'outdated';
      }
      // Se não mudou nem arquivo nem instrução (ex: edição parcial só do label), preserva status e resultado válido
    }
  }

  return updates;
}

/**
 * Filtra as memórias elegíveis para o processamento em lote
 */
export function filterBatchEligibleMemories(allMems, params) {
  const cleanCategory = String(params.category || '').trim().toLowerCase();

  return allMems.filter((m) => {
    // Isolamento por condomínio se informado
    if (params.condoId && m.condo_id !== params.condoId) return false;

    // Isolamento estrito por categoria da etapa
    if (m.category !== cleanCategory) return false;

    // Ignora memórias manuais
    if (m.fill_mode === 'manual') return false;

    // Deve possuir PDF vinculado
    if (!m.source_drive_file_id) return false;

    // Se informados IDs específicos (ex: seleção do usuário)
    if (Array.isArray(params.memory_ids) && params.memory_ids.length > 0) {
      return params.memory_ids.includes(m.id);
    }

    // Por padrão: nunca pesquisadas, falhas anteriores ou desatualizadas
    return m.status === 'never_searched' || m.status === 'failed' || m.status === 'outdated';
  });
}

/**
 * Agrupa memórias elegíveis por identificador do PDF no Google Drive
 */
export function groupMemoriesByDriveFile(eligibleMems) {
  const groups = new Map();
  for (const mem of eligibleMems) {
    const fileId = mem.source_drive_file_id;
    const list = groups.get(fileId) || [];
    list.push(mem);
    groups.set(fileId, list);
  }
  return groups;
}

/**
 * Processador de lote com isolamento estrito de falhas por grupo, documento e memória individual
 */
export async function executeBatchGroupLoop({
  groups,
  cleanCategory,
  condoName,
  fetchPdfBuffer,
  extractBatch,
  saveSuccessResult,
  handleGroupFailure,
}) {
  const updatedMemories = [];
  const failedMemories = [];

  for (const [driveFileId, groupItems] of groups.entries()) {
    const fileName = groupItems[0]?.source_drive_file_name || 'documento.pdf';

    // 1. Download do PDF com isolamento de falha por documento
    let pdfBuffer;
    try {
      pdfBuffer = await fetchPdfBuffer(driveFileId);
      if (!pdfBuffer || pdfBuffer.length === 0) {
        throw new Error(`Arquivo PDF do Drive ("${fileName}") está vazio ou corrompido.`);
      }
    } catch (downloadErr) {
      console.error(`[AUDITORIA_BATCH_DOWNLOAD_ERROR] Falha ao baixar PDF ${driveFileId} ("${fileName}"):`, downloadErr);
      for (const mem of groupItems) {
        const errMsg = downloadErr?.message || 'Falha ao baixar PDF do Google Drive';
        failedMemories.push({ id: mem.id, error: errMsg });
        try {
          const failedMem = await handleGroupFailure(mem, downloadErr);
          if (failedMem) updatedMemories.push(failedMem);
        } catch (recordErr) {
          console.error(`[AUDITORIA_BATCH_RECORD_ERROR] Falha ao registrar status de erro para ${mem.id}:`, recordErr);
        }
      }
      // Continua para o próximo grupo (PDF)
      continue;
    }

    // 2. Extração pelo Gemini com isolamento de falha do grupo
    let extractionResults = [];
    try {
      extractionResults = await extractBatch({
        pdfBuffer,
        fileName,
        category: cleanCategory,
        condoName,
        items: groupItems.map((m) => ({
          id: m.id,
          label: m.label,
          instruction: m.instruction || '',
        })),
      });
    } catch (geminiErr) {
      console.error(`[AUDITORIA_BATCH_GEMINI_ERROR] Falha na chamada ao Gemini para ${driveFileId} ("${fileName}"):`, geminiErr);
      for (const mem of groupItems) {
        const errMsg = geminiErr?.message || 'Falha na chamada ao modelo de IA';
        failedMemories.push({ id: mem.id, error: errMsg });
        try {
          const failedMem = await handleGroupFailure(mem, geminiErr);
          if (failedMem) updatedMemories.push(failedMem);
        } catch (recordErr) {
          console.error(`[AUDITORIA_BATCH_RECORD_ERROR] Falha ao registrar status de erro para ${mem.id}:`, recordErr);
        }
      }
      // Continua para o próximo grupo (PDF)
      continue;
    }

    // 3. Processamento e persistência individual com isolamento por memória
    const resultMap = new Map();
    if (Array.isArray(extractionResults)) {
      for (const resItem of extractionResults) {
        if (resItem?.id) {
          resultMap.set(resItem.id, resItem);
        }
      }
    }

    for (const mem of groupItems) {
      const resItem = resultMap.get(mem.id);

      // Cenário: O Gemini não retornou resultado para esta memória específica
      if (!resItem) {
        const missingErr = new Error(`Resultado ausente retornado pela IA para a memória "${mem.label}".`);
        failedMemories.push({ id: mem.id, error: missingErr.message });
        try {
          const failedMem = await handleGroupFailure(mem, missingErr);
          if (failedMem) updatedMemories.push(failedMem);
        } catch (recordErr) {
          console.error(`[AUDITORIA_BATCH_RECORD_ERROR] Falha ao registrar status de erro para ${mem.id}:`, recordErr);
        }
        continue;
      }

      // Cenário: Persistência individual do resultado com sucesso
      try {
        const saved = await saveSuccessResult(mem, resItem);
        if (saved) updatedMemories.push(saved);
      } catch (persistErr) {
        console.error(`[AUDITORIA_BATCH_PERSIST_ERROR] Falha ao persistir resultado da memória ${mem.id}:`, persistErr);
        const errMsg = persistErr?.message || 'Falha ao persistir memória';
        failedMemories.push({ id: mem.id, error: errMsg });
        try {
          const failedMem = await handleGroupFailure(mem, persistErr);
          if (failedMem) updatedMemories.push(failedMem);
        } catch (recordErr) {
          console.error(`[AUDITORIA_BATCH_RECORD_ERROR] Falha ao registrar status de erro para ${mem.id}:`, recordErr);
        }
      }
    }
  }

  return { updatedMemories, failedMemories };
}
