import type { Express, Request, Response, NextFunction } from 'express';
import {
  prepareMemoryCreate,
  prepareMemoryUpdate,
  filterBatchEligibleMemories,
  groupMemoriesByDriveFile,
  executeBatchGroupLoop,
  type AuditoriaMemoryRecord,
} from './auditoriaMemoryService.ts';

export interface AuditoriaMemoryRoutesOptions {
  requireAccess: (req: Request, res: Response, next: NextFunction) => void;
  requireManageAccess: (req: Request, res: Response, next: NextFunction) => void;
  getSupabaseAdmin: () => any;
  getDriveFileStream: (fileId: string) => Promise<any>;
  executeSingleExtraction?: (params: any) => Promise<any>;
  executeBatchExtraction: (params: any) => Promise<any>;
  saveFallbackMemory: (record: AuditoriaMemoryRecord) => void;
  readFallbackMemories: () => AuditoriaMemoryRecord[];
  deleteFallbackMemory: (condoId: string, memoryId: string) => void;
  isTableMissingError: (error: any) => boolean;
}

/**
 * Registra os endpoints de gerenciamento e execução das memórias da Auditoria.
 * Compartilhado identicamente entre o servidor de produção e a suíte de testes.
 */
export function registerAuditoriaMemoryRoutes(app: Express | any, options: AuditoriaMemoryRoutesOptions) {
  const {
    requireAccess,
    requireManageAccess,
    getSupabaseAdmin,
    getDriveFileStream,
    executeSingleExtraction,
    executeBatchExtraction,
    saveFallbackMemory,
    readFallbackMemories,
    deleteFallbackMemory,
    isTableMissingError,
  } = options;

  // 1. Listar memórias da auditoria por condomínio e categoria
  app.get('/api/auditoria/condo/:condoId/memories', requireAccess, async (req: Request, res: Response) => {
    const { condoId } = req.params;
    const categoryParam = req.query.category ? String(req.query.category).trim().toLowerCase() : null;

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Serviço Supabase indisponível no servidor.' });
    }

    try {
      let query = supabaseAdmin
        .from('auditoria_memorias')
        .select('*')
        .eq('condo_id', condoId);

      if (categoryParam) {
        query = query.eq('category', categoryParam);
      }

      query = query.order('created_at', { ascending: true });

      const { data, error } = await query;

      if (!error) {
        return res.json({
          ok: true,
          memories: data || [],
          persisted_definitively: true,
        });
      }

      if (isTableMissingError(error)) {
        const fallback = readFallbackMemories().filter((m) => {
          if (m.condo_id !== condoId) return false;
          if (categoryParam && m.category !== categoryParam) return false;
          return true;
        });
        return res.json({
          ok: true,
          memories: fallback,
          persisted_definitively: false,
          pending_migration: true,
          migration_file: 'sql/20261029_auditoria_memorias.sql',
          warning: 'Tabela public.auditoria_memorias pendente de aplicação no Supabase. Executando em contingência local.',
        });
      }

      return res.status(500).json({ error: 'Erro ao consultar memórias: ' + error.message });
    } catch (err: any) {
      return res.status(500).json({ error: 'Falha interna ao buscar memórias: ' + err.message });
    }
  });

  // 2. Criar nova memória na auditoria (Modo Manual ou Modo IA)
  app.post('/api/auditoria/condo/:condoId/memories', requireManageAccess, async (req: Request, res: Response) => {
    const { condoId } = req.params;
    const currentUserId = (req as any).user?.id || null;

    // Garantir autoria autenticada obrigatória
    if (!currentUserId) {
      return res.status(401).json({ error: 'Usuário autenticado não identificado para autoria do cadastro.' });
    }

    try {
      const newRecord = prepareMemoryCreate({
        condoId,
        currentUserId,
        category: req.body?.category,
        label: req.body?.label,
        fill_mode: req.body?.fill_mode,
        manual_value: req.body?.manual_value,
        instruction: req.body?.instruction,
        source_drive_file_id: req.body?.source_drive_file_id,
        source_drive_file_name: req.body?.source_drive_file_name,
        source_document_id: req.body?.source_document_id,
      });

      const supabaseAdmin = getSupabaseAdmin();
      if (!supabaseAdmin) {
        return res.status(500).json({ error: 'Serviço Supabase indisponível no servidor.' });
      }

      const { data, error } = await supabaseAdmin
        .from('auditoria_memorias')
        .insert([newRecord])
        .select()
        .single();

      if (!error && data) {
        return res.json({
          ok: true,
          success: true,
          memory: data,
          persisted_definitively: true,
        });
      }

      if (isTableMissingError(error)) {
        saveFallbackMemory(newRecord);
        return res.json({
          ok: true,
          success: true,
          memory: newRecord,
          persisted_definitively: false,
          pending_migration: true,
          migration_file: 'sql/20261029_auditoria_memorias.sql',
          warning: 'Memória criada em contingência local temporária (migração SQL pendente no Supabase).',
        });
      }

      return res.status(500).json({ error: 'Erro ao criar memória no Supabase: ' + (error?.message || 'Erro no Supabase') });
    } catch (err: any) {
      if (
        err.message?.includes('obrigatório') ||
        err.message?.includes('obrigatória') ||
        err.message?.includes('Campos obrigatórios') ||
        err.message?.includes('vazio') ||
        err.message?.includes('seleção de um PDF') ||
        err.message?.includes('Modo de preenchimento inválido')
      ) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: 'Falha interna ao criar memória: ' + err.message });
    }
  });

  // 3. Atualizar memória existente (sem executar IA) com validação completa de consistência de estado
  app.put('/api/auditoria/condo/:condoId/memories/:memoryId', requireManageAccess, async (req: Request, res: Response) => {
    const { condoId, memoryId } = req.params;

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Serviço Supabase indisponível no servidor.' });
    }

    try {
      // 1. Buscar o registro atual antes de montar o objeto final
      let existingRecord: AuditoriaMemoryRecord | null = null;
      const { data: dbMem, error: fetchErr } = await supabaseAdmin
        .from('auditoria_memorias')
        .select('*')
        .eq('condo_id', condoId)
        .eq('id', memoryId)
        .maybeSingle();

      if (!fetchErr && dbMem) {
        existingRecord = dbMem;
      } else if (isTableMissingError(fetchErr)) {
        existingRecord = readFallbackMemories().find((m) => m.condo_id === condoId && m.id === memoryId) || null;
      } else if (fetchErr) {
        return res.status(500).json({ error: 'Erro ao consultar memória no banco de dados: ' + fetchErr.message });
      }

      if (!existingRecord) {
        return res.status(404).json({ error: 'Memória não encontrada para atualização.' });
      }

      // 2. Preparar e validar atualizações através da função canônica compartilhada
      const updates = prepareMemoryUpdate(existingRecord, {
        label: req.body?.label,
        fill_mode: req.body?.fill_mode,
        manual_value: req.body?.manual_value,
        instruction: req.body?.instruction,
        source_drive_file_id: req.body?.source_drive_file_id,
        source_drive_file_name: req.body?.source_drive_file_name,
        source_document_id: req.body?.source_document_id,
      });

      // 3. Persistir no Supabase ou contingência
      const { data, error } = await supabaseAdmin
        .from('auditoria_memorias')
        .update(updates)
        .eq('condo_id', condoId)
        .eq('id', memoryId)
        .select()
        .single();

      if (!error && data) {
        return res.json({
          ok: true,
          success: true,
          memory: data,
          persisted_definitively: true,
        });
      }

      if (isTableMissingError(error)) {
        const updatedRecord: AuditoriaMemoryRecord = {
          ...existingRecord,
          ...updates,
        };
        saveFallbackMemory(updatedRecord);
        return res.json({
          ok: true,
          success: true,
          memory: updatedRecord,
          persisted_definitively: false,
          pending_migration: true,
          migration_file: 'sql/20261029_auditoria_memorias.sql',
        });
      }

      return res.status(500).json({ error: 'Erro ao atualizar memória: ' + (error?.message || 'Erro no Supabase') });
    } catch (err: any) {
      if (
        err.message?.includes('obrigatório') ||
        err.message?.includes('obrigatória') ||
        err.message?.includes('vazio') ||
        err.message?.includes('seleção de um PDF') ||
        err.message?.includes('Modo de preenchimento inválido')
      ) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: 'Falha interna ao atualizar memória: ' + err.message });
    }
  });

  // 4. Excluir memória da auditoria
  app.delete('/api/auditoria/condo/:condoId/memories/:memoryId', requireManageAccess, async (req: Request, res: Response) => {
    const { condoId, memoryId } = req.params;

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Serviço Supabase indisponível no servidor.' });
    }

    try {
      const { error } = await supabaseAdmin
        .from('auditoria_memorias')
        .delete()
        .eq('condo_id', condoId)
        .eq('id', memoryId);

      if (!error) {
        return res.json({ ok: true, success: true });
      }

      if (isTableMissingError(error)) {
        deleteFallbackMemory(condoId, memoryId);
        return res.json({ ok: true, success: true, persisted_definitively: false });
      }

      return res.status(500).json({ error: 'Erro ao excluir memória: ' + error.message });
    } catch (err: any) {
      return res.status(500).json({ error: 'Falha interna ao excluir memória: ' + err.message });
    }
  });

  // 5. Executar busca individual sob demanda por IA para uma memória específica
  app.post('/api/auditoria/condo/:condoId/memories/:memoryId/execute', requireManageAccess, async (req: Request, res: Response) => {
    const { condoId, memoryId } = req.params;
    const leadData = (req as any).condoLead || { name: 'Condomínio' };

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Serviço Supabase indisponível no servidor.' });
    }

    try {
      let memoryRecord: AuditoriaMemoryRecord | null = null;
      const { data: dbMem, error: dbErr } = await supabaseAdmin
        .from('auditoria_memorias')
        .select('*')
        .eq('condo_id', condoId)
        .eq('id', memoryId)
        .single();

      if (!dbErr && dbMem) {
        memoryRecord = dbMem;
      } else if (isTableMissingError(dbErr)) {
        memoryRecord = readFallbackMemories().find((m) => m.condo_id === condoId && m.id === memoryId) || null;
      }

      if (!memoryRecord) {
        return res.status(404).json({ error: 'Memória não encontrada para execução.' });
      }

      if (memoryRecord.fill_mode === 'manual') {
        return res.status(400).json({ error: 'Esta memória é de preenchimento manual e não utiliza extração por IA.' });
      }

      if (!memoryRecord.source_drive_file_id) {
        return res.status(400).json({ error: 'Nenhum documento PDF de origem selecionado nesta memória. Edite a memória e selecione um PDF antes de executar a IA.' });
      }

      let driveRes: any;
      try {
        driveRes = await getDriveFileStream(memoryRecord.source_drive_file_id);
      } catch (driveErr: any) {
        console.error('[AUDITORIA_MEMORY_DRIVE_FETCH_ERROR]', driveErr);
        return res.status(502).json({
          error: `Não foi possível recuperar o arquivo PDF no Google Drive ("${memoryRecord.source_drive_file_name || memoryRecord.source_drive_file_id}"): ` + (driveErr?.message || driveErr),
        });
      }

      const arrayBuffer = await driveRes.arrayBuffer();
      const pdfBuffer = Buffer.from(arrayBuffer);

      if (!pdfBuffer || pdfBuffer.length === 0) {
        return res.status(400).json({ error: 'O arquivo PDF recuperado do Google Drive está vazio ou corrompido.' });
      }

      if (!executeSingleExtraction) {
        return res.status(500).json({ error: 'Extrator de IA individual não configurado no servidor.' });
      }

      const extractionResult = await executeSingleExtraction({
        pdfBuffer,
        fileName: memoryRecord.source_drive_file_name || 'documento.pdf',
        category: memoryRecord.category,
        condoName: leadData.name,
        memoryLabel: memoryRecord.label,
        instruction: memoryRecord.instruction || '',
      });

      const now = new Date().toISOString();
      const updatedRecord: AuditoriaMemoryRecord = {
        ...memoryRecord,
        last_result: extractionResult.value,
        page_reference: extractionResult.page_reference || null,
        last_result_metadata: {
          found: extractionResult.found,
          page_reference: extractionResult.page_reference || null,
          quoted_excerpt: extractionResult.quoted_excerpt || null,
          confidence: extractionResult.confidence || 'alta',
          notes: extractionResult.notes || null,
        },
        status: 'result_available',
        last_executed_at: now,
        updated_at: now,
      };

      let isDefinitive = true;
      const { data: savedDb, error: saveErr } = await supabaseAdmin
        .from('auditoria_memorias')
        .update({
          last_result: updatedRecord.last_result,
          page_reference: updatedRecord.page_reference,
          last_result_metadata: updatedRecord.last_result_metadata,
          status: updatedRecord.status,
          last_executed_at: updatedRecord.last_executed_at,
          updated_at: updatedRecord.updated_at,
        })
        .eq('condo_id', condoId)
        .eq('id', memoryId)
        .select()
        .single();

      if (saveErr && isTableMissingError(saveErr)) {
        saveFallbackMemory(updatedRecord);
        isDefinitive = false;
      } else if (saveErr) {
        console.warn('[AUDITORIA_MEMORY_SAVE_ERROR]', saveErr);
        saveFallbackMemory(updatedRecord);
        isDefinitive = false;
      } else if (savedDb) {
        return res.json({
          ok: true,
          success: true,
          memory: savedDb,
          persisted_definitively: true,
        });
      }

      return res.json({
        ok: true,
        success: true,
        memory: updatedRecord,
        persisted_definitively: isDefinitive,
      });
    } catch (err: any) {
      console.error('[AUDITORIA_MEMORY_EXECUTE_ERROR]', err);
      return res.status(500).json({ error: 'Erro durante a extração da memória por IA: ' + (err?.message || err) });
    }
  });

  // 6. Executar busca agrupada por documento para memórias pendentes da etapa (utiliza executeBatchGroupLoop canônico)
  app.post('/api/auditoria/condo/:condoId/memories/batch-execute', requireManageAccess, async (req: Request, res: Response) => {
    const { condoId } = req.params;
    const { category, memory_ids } = req.body || {};
    const leadData = (req as any).condoLead || { name: 'Condomínio' };

    if (!category || typeof category !== 'string' || !category.trim()) {
      return res.status(400).json({ error: 'Etapa/categoria obrigatória para a busca agrupada.' });
    }

    const cleanCategory = String(category).trim().toLowerCase();
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Serviço Supabase indisponível no servidor.' });
    }

    try {
      // 1. Obter todas as memórias do condomínio na categoria
      let allMems: AuditoriaMemoryRecord[] = [];
      const { data: dbMems, error: dbErr } = await supabaseAdmin
        .from('auditoria_memorias')
        .select('*')
        .eq('condo_id', condoId)
        .eq('category', cleanCategory);

      if (!dbErr && dbMems) {
        allMems = dbMems;
      } else if (isTableMissingError(dbErr)) {
        allMems = readFallbackMemories().filter((m) => m.condo_id === condoId && m.category === cleanCategory);
      }

      // 2. Filtrar memórias de IA elegíveis
      const eligibleMems = filterBatchEligibleMemories(allMems, {
        category: cleanCategory,
        condoId,
        memory_ids,
      });

      if (eligibleMems.length === 0) {
        return res.json({
          ok: true,
          success: true,
          message: 'Nenhuma memória de IA pendente para processar nesta etapa.',
          processed_count: 0,
          groups_count: 0,
          updated_memories: [],
        });
      }

      // 3. Agrupar memórias por documento PDF
      const groups = groupMemoriesByDriveFile(eligibleMems);

      // 4. Execução do processamento unificado via executeBatchGroupLoop com isolamento estrito
      const { updatedMemories, failedMemories } = await executeBatchGroupLoop({
        groups,
        cleanCategory,
        condoName: leadData.name,
        fetchPdfBuffer: async (driveFileId: string) => {
          const driveRes = await getDriveFileStream(driveFileId);
          const arrayBuffer = await driveRes.arrayBuffer();
          return Buffer.from(arrayBuffer);
        },
        extractBatch: async (params) => {
          return executeBatchExtraction(params);
        },
        saveSuccessResult: async (mem: AuditoriaMemoryRecord, resItem: any) => {
          const now = new Date().toISOString();
          const updatedRecord: AuditoriaMemoryRecord = {
            ...mem,
            last_result: resItem ? resItem.value : 'Informação não localizada pela IA.',
            page_reference: resItem?.page_reference || null,
            last_result_metadata: resItem
              ? {
                  found: resItem.found,
                  page_reference: resItem.page_reference || null,
                  quoted_excerpt: resItem.quoted_excerpt || null,
                  confidence: resItem.confidence || 'alta',
                  notes: resItem.notes || null,
                }
              : null,
            status: 'result_available',
            last_executed_at: now,
            updated_at: now,
          };

          try {
            const { data: savedDb, error: saveErr } = await supabaseAdmin
              .from('auditoria_memorias')
              .update({
                last_result: updatedRecord.last_result,
                page_reference: updatedRecord.page_reference,
                last_result_metadata: updatedRecord.last_result_metadata,
                status: updatedRecord.status,
                last_executed_at: updatedRecord.last_executed_at,
                updated_at: updatedRecord.updated_at,
              })
              .eq('condo_id', condoId)
              .eq('id', mem.id)
              .select()
              .single();

            if (!saveErr && savedDb) {
              return savedDb;
            }
            saveFallbackMemory(updatedRecord);
            return updatedRecord;
          } catch {
            saveFallbackMemory(updatedRecord);
            return updatedRecord;
          }
        },
        handleGroupFailure: async (mem: AuditoriaMemoryRecord, error: any) => {
          const now = new Date().toISOString();
          const fileName = mem.source_drive_file_name || 'documento.pdf';
          const failedRecord: AuditoriaMemoryRecord = {
            ...mem,
            status: 'failed',
            last_result: `Falha ao processar arquivo "${fileName}": ${error?.message || 'Erro inesperado'}`,
            updated_at: now,
          };

          try {
            await supabaseAdmin
              .from('auditoria_memorias')
              .update({
                status: 'failed',
                last_result: failedRecord.last_result,
                updated_at: now,
              })
              .eq('condo_id', condoId)
              .eq('id', mem.id);
          } catch {}
          saveFallbackMemory(failedRecord);
          return failedRecord;
        },
      });

      return res.json({
        ok: true,
        success: true,
        message: `Busca agrupada concluída: ${updatedMemories.length} memórias processadas em ${groups.size} execução(ões) agrupada(s).`,
        processed_count: updatedMemories.length,
        groups_count: groups.size,
        updated_memories: updatedMemories,
        failed_count: failedMemories.length,
      });
    } catch (err: any) {
      console.error('[AUDITORIA_BATCH_EXECUTE_ERROR]', err);
      return res.status(500).json({ error: 'Erro ao executar busca agrupada por IA: ' + (err?.message || err) });
    }
  });
}
