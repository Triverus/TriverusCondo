// Script to apply folder sync logic to server.ts and server.js
import fs from 'fs';

function updateServerTs() {
  let content = fs.readFileSync('server.ts', 'utf8');

  // 1. Add listAvailableFoldersForCondo to imports if not present
  if (!content.includes('listAvailableFoldersForCondo')) {
    content = content.replace(
      'normalizeNameForMatching,\n};',
      'normalizeNameForMatching,\n  listAvailableFoldersForCondo,\n};'
    );
  }

  // 2. Add folder fallback structures and types
  if (!content.includes('AUDITORIA_FOLDERS_FALLBACK_FILE')) {
    const target = 'const AUDITORIA_DOCS_FALLBACK_FILE = path.join(__dirname, \'auditoria_documents_store.json\');';
    const addition = `const AUDITORIA_DOCS_FALLBACK_FILE = path.join(__dirname, 'auditoria_documents_store.json');
const AUDITORIA_FOLDERS_FALLBACK_FILE = path.join(__dirname, 'auditoria_folders_store.json');

interface AuditoriaFasePastaRecord {
  id: string;
  condo_id: string;
  category: string;
  drive_folder_id: string;
  drive_folder_name: string;
  linked_by_user_id: string | null;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
}

function readFallbackFolders(): AuditoriaFasePastaRecord[] {
  try {
    if (fs.existsSync(AUDITORIA_FOLDERS_FALLBACK_FILE)) {
      const raw = fs.readFileSync(AUDITORIA_FOLDERS_FALLBACK_FILE, 'utf8');
      return JSON.parse(raw) || [];
    }
  } catch (e) {
    console.warn('[AUDITORIA_FOLDERS_FALLBACK] Falha ao ler arquivo local:', e);
  }
  return [];
}

function saveFallbackFolder(record: AuditoriaFasePastaRecord): void {
  try {
    const list = readFallbackFolders();
    const idx = list.findIndex((f) => f.condo_id === record.condo_id && f.category === record.category);
    if (idx >= 0) {
      list[idx] = record;
    } else {
      list.push(record);
    }
    fs.writeFileSync(AUDITORIA_FOLDERS_FALLBACK_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.warn('[AUDITORIA_FOLDERS_FALLBACK] Falha ao salvar arquivo local:', e);
  }
}

function deleteFallbackFolder(condoId: string, category: string): boolean {
  try {
    const list = readFallbackFolders();
    const filtered = list.filter((f) => !(f.condo_id === condoId && f.category === category));
    if (filtered.length !== list.length) {
      fs.writeFileSync(AUDITORIA_FOLDERS_FALLBACK_FILE, JSON.stringify(filtered, null, 2), 'utf8');
      return true;
    }
  } catch (e) {
    console.warn('[AUDITORIA_FOLDERS_FALLBACK] Falha ao remover do arquivo local:', e);
  }
  return false;
}

function deleteFallbackDocumentsByOriginFolder(condoId: string, category: string, folderId: string): number {
  try {
    const list = readFallbackDocuments();
    const remaining = list.filter((d) => {
      if (d.condo_id === condoId && d.category === category && d.origin_folder_id === folderId) {
        return false;
      }
      return true;
    });
    const removedCount = list.length - remaining.length;
    if (removedCount > 0) {
      fs.writeFileSync(AUDITORIA_DOCS_FALLBACK_FILE, JSON.stringify(remaining, null, 2), 'utf8');
    }
    return removedCount;
  } catch (e) {
    console.warn('[AUDITORIA_DOCS_FALLBACK] Falha ao remover documentos por pasta de origem:', e);
    return 0;
  }
}`;
    content = content.replace(target, addition);
  }

  // 3. Update AuditoriaDocumentRecord interface
  if (!content.includes('origin_folder_id?: string | null;')) {
    content = content.replace(
      'linked_by_user_id: string | null;\n  created_at: string;',
      'linked_by_user_id: string | null;\n  origin_folder_id?: string | null;\n  origin_folder_name?: string | null;\n  sync_status?: string | null;\n  created_at: string;'
    );
  }

  // 4. Add the folder routes before `// 2. Consultar documentos vinculados`
  if (!content.includes('/api/auditoria/condo/:condoId/drive-folders')) {
    const targetEndpoint = '// 2. Consultar documentos vinculados para o condomínio';
    const folderEndpoints = `// 1.1. Listar pastas disponíveis para seleção no condomínio (pasta principal + subpastas)
app.get('/api/auditoria/condo/:condoId/drive-folders', requireAuditoriaAccess('can_access_auditoria'), async (req, res) => {
  const { condoId } = req.params;
  const leadData = (req as any).condoLead;
  const condoName = leadData?.name;

  try {
    const result = await listAvailableFoldersForCondo(condoName);
    if (!result.condo_found) {
      return res.json({
        ok: true,
        found: false,
        condo_id: condoId,
        condo_name: condoName,
        message: result.error || \`A pasta do condomínio "\${condoName}" não foi localizada no Google Drive central.\`,
        folders: [],
      });
    }

    return res.json({
      ok: true,
      found: true,
      condo_id: condoId,
      condo_name: condoName,
      condo_folder: result.condo_folder,
      folders: result.folders,
    });
  } catch (err: any) {
    console.error('[AUDITORIA_DRIVE_FOLDERS_ERROR]', err);
    return res.status(500).json({
      ok: false,
      error: 'Falha ao consultar pastas no Google Drive: ' + (err?.message || err),
    });
  }
});

// 1.2. Consultar pastas do Drive vinculadas por fase
app.get('/api/auditoria/condo/:condoId/folder-links', requireAuditoriaAccess('can_access_auditoria'), async (req, res) => {
  const { condoId } = req.params;
  const supabaseAdmin = getAdminSupabaseClient();

  let folderLinks: any[] = [];
  let dbError: any = null;

  if (supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin
        .from('auditoria_fase_pastas')
        .select('*')
        .eq('condo_id', condoId);

      if (error) {
        dbError = error;
      } else {
        folderLinks = data || [];
      }
    } catch (err: any) {
      dbError = err;
    }
  }

  const fallbackFolders = readFallbackFolders().filter((f) => f.condo_id === condoId);

  // Mesclar: prioriza Supabase, completa com contingência local
  const existingCategories = new Set(folderLinks.map((f) => f.category));
  const mergedLinks = [
    ...folderLinks.map((f) => ({ ...f, persisted_definitively: true })),
    ...fallbackFolders
      .filter((f) => !existingCategories.has(f.category))
      .map((f) => ({ ...f, persisted_definitively: false })),
  ];

  return res.json({
    ok: true,
    folder_links: mergedLinks,
    source: folderLinks.length > 0 ? 'supabase' : 'fallback_local',
  });
});

// 1.3. Vincular uma pasta do Google Drive a uma fase e sincronizar todos os seus PDFs
app.post('/api/auditoria/condo/:condoId/phases/:category/link-folder', requireAuditoriaAccess('can_manage_auditoria'), async (req, res) => {
  const { condoId, category } = req.params;
  const { drive_folder_id, drive_folder_name } = req.body || {};

  if (!drive_folder_id || typeof drive_folder_id !== 'string' || !drive_folder_id.trim()) {
    return res.status(400).json({ error: 'ID da pasta no Google Drive é obrigatório.' });
  }
  if (!drive_folder_name || typeof drive_folder_name !== 'string' || !drive_folder_name.trim()) {
    return res.status(400).json({ error: 'Nome da pasta no Google Drive é obrigatório.' });
  }

  const cleanCategory = String(category).trim().toLowerCase();
  if (!cleanCategory || cleanCategory.length > 50 || !/^[a-z0-9_-]+$/.test(cleanCategory)) {
    return res.status(400).json({ error: 'Categoria documental inválida.' });
  }

  const currentUserId = (req as any).user?.id || null;
  const nowIso = new Date().toISOString();
  const supabaseAdmin = getAdminSupabaseClient();

  const folderRecord: AuditoriaFasePastaRecord = {
    id: crypto.randomUUID(),
    condo_id: condoId,
    category: cleanCategory,
    drive_folder_id: String(drive_folder_id).trim(),
    drive_folder_name: String(drive_folder_name).trim(),
    linked_by_user_id: currentUserId,
    last_synced_at: nowIso,
    created_at: nowIso,
    updated_at: nowIso,
  };

  // 1. Persistir o vínculo da pasta no Supabase (com contingência)
  let folderPersistedDefinitively = false;
  if (supabaseAdmin) {
    try {
      const { data: existingFolder } = await supabaseAdmin
        .from('auditoria_fase_pastas')
        .select('id')
        .eq('condo_id', condoId)
        .eq('category', cleanCategory)
        .maybeSingle();

      let folderRes;
      if (existingFolder?.id) {
        folderRes = await supabaseAdmin
          .from('auditoria_fase_pastas')
          .update({
            drive_folder_id: folderRecord.drive_folder_id,
            drive_folder_name: folderRecord.drive_folder_name,
            linked_by_user_id: currentUserId,
            last_synced_at: nowIso,
            updated_at: nowIso,
          })
          .eq('id', existingFolder.id)
          .select()
          .maybeSingle();
      } else {
        folderRes = await supabaseAdmin
          .from('auditoria_fase_pastas')
          .insert(folderRecord)
          .select()
          .maybeSingle();
      }

      if (!folderRes.error && folderRes.data) {
        folderPersistedDefinitively = true;
        deleteFallbackFolder(condoId, cleanCategory);
      } else {
        saveFallbackFolder(folderRecord);
      }
    } catch {
      saveFallbackFolder(folderRecord);
    }
  } else {
    saveFallbackFolder(folderRecord);
  }

  // 2. Ler todos os PDFs contidos diretamente na pasta selecionada
  let pdfFiles: any[] = [];
  try {
    pdfFiles = await listPdfFilesInFolder(folderRecord.drive_folder_id);
  } catch (driveErr: any) {
    return res.status(500).json({
      ok: false,
      error: 'Falha ao consultar arquivos PDF na pasta do Google Drive: ' + (driveErr?.message || driveErr),
    });
  }

  // 3. Registrar ou atualizar cada PDF de forma idempotente
  let importedCount = 0;
  let updatedCount = 0;
  const syncedDocs: any[] = [];

  for (const pdf of pdfFiles) {
    const docRecord: AuditoriaDocumentRecord = {
      id: crypto.randomUUID(),
      condo_id: condoId,
      category: cleanCategory,
      drive_file_id: pdf.id,
      drive_file_name: pdf.name,
      drive_file_size: pdf.size || null,
      drive_file_modified_at: pdf.modifiedTime || null,
      linked_by_user_id: currentUserId,
      origin_folder_id: folderRecord.drive_folder_id,
      origin_folder_name: folderRecord.drive_folder_name,
      sync_status: 'synced',
      created_at: nowIso,
      updated_at: nowIso,
    };

    let docSaved = false;

    if (supabaseAdmin) {
      try {
        const { data: existingDoc } = await supabaseAdmin
          .from('auditoria_documentos')
          .select('id')
          .eq('condo_id', condoId)
          .eq('category', cleanCategory)
          .eq('drive_file_id', pdf.id)
          .maybeSingle();

        if (existingDoc?.id) {
          const updateRes = await supabaseAdmin
            .from('auditoria_documentos')
            .update({
              drive_file_name: docRecord.drive_file_name,
              drive_file_size: docRecord.drive_file_size,
              drive_file_modified_at: docRecord.drive_file_modified_at,
              origin_folder_id: docRecord.origin_folder_id,
              origin_folder_name: docRecord.origin_folder_name,
              sync_status: 'synced',
              updated_at: nowIso,
            })
            .eq('id', existingDoc.id)
            .select()
            .maybeSingle();

          if (!updateRes.error && updateRes.data) {
            docSaved = true;
            updatedCount++;
            syncedDocs.push({ ...updateRes.data, persisted_definitively: true });
          }
        } else {
          const insertRes = await supabaseAdmin
            .from('auditoria_documentos')
            .insert(docRecord)
            .select()
            .maybeSingle();

          if (!insertRes.error && insertRes.data) {
            docSaved = true;
            importedCount++;
            syncedDocs.push({ ...insertRes.data, persisted_definitively: true });
          }
        }
      } catch {}
    }

    // Se não salvou no Supabase (restrição legada de unicidade ou tabela ausente), persiste em contingência local
    if (!docSaved) {
      const fallbackList = readFallbackDocuments();
      const existingFbIdx = fallbackList.findIndex(
        (d) => d.condo_id === condoId && d.category === cleanCategory && d.drive_file_id === pdf.id
      );

      saveFallbackDocument(docRecord);
      if (existingFbIdx >= 0) {
        updatedCount++;
      } else {
        importedCount++;
      }
      syncedDocs.push({ ...docRecord, persisted_definitively: false });
    }
  }

  return res.json({
    ok: true,
    success: true,
    message: \`Pasta "\${folderRecord.drive_folder_name}" vinculada com sucesso. \${importedCount} novos documentos registrados, \${updatedCount} atualizados.\`,
    folder_link: folderRecord,
    persisted_definitively: folderPersistedDefinitively,
    imported_count: importedCount,
    updated_count: updatedCount,
    total_in_folder: pdfFiles.length,
    documents: syncedDocs,
  });
});

// 1.4. Sincronizar pasta já vinculada (identifica novos PDFs sem excluir arquivos existentes)
app.post('/api/auditoria/condo/:condoId/phases/:category/sync-folder', requireAuditoriaAccess('can_manage_auditoria'), async (req, res) => {
  const { condoId, category } = req.params;
  const cleanCategory = String(category).trim().toLowerCase();
  const supabaseAdmin = getAdminSupabaseClient();
  const currentUserId = (req as any).user?.id || null;
  const nowIso = new Date().toISOString();

  // 1. Obter vínculo atual da pasta
  let folderLink: AuditoriaFasePastaRecord | null = null;
  if (supabaseAdmin) {
    try {
      const { data } = await supabaseAdmin
        .from('auditoria_fase_pastas')
        .select('*')
        .eq('condo_id', condoId)
        .eq('category', cleanCategory)
        .maybeSingle();
      if (data) folderLink = data;
    } catch {}
  }

  if (!folderLink) {
    const fbFolders = readFallbackFolders();
    const fbMatch = fbFolders.find((f) => f.condo_id === condoId && f.category === cleanCategory);
    if (fbMatch) folderLink = fbMatch;
  }

  if (!folderLink) {
    return res.status(404).json({
      ok: false,
      error: 'Nenhuma pasta do Google Drive vinculada a esta fase. Vincule uma pasta primeiro.',
    });
  }

  // 2. Consultar arquivos atuais na pasta do Drive
  let pdfFiles: any[] = [];
  try {
    pdfFiles = await listPdfFilesInFolder(folderLink.drive_folder_id);
  } catch (driveErr: any) {
    return res.status(500).json({
      ok: false,
      error: 'Falha ao consultar pasta no Google Drive: ' + (driveErr?.message || driveErr),
    });
  }

  let importedCount = 0;
  let updatedCount = 0;

  for (const pdf of pdfFiles) {
    const docRecord: AuditoriaDocumentRecord = {
      id: crypto.randomUUID(),
      condo_id: condoId,
      category: cleanCategory,
      drive_file_id: pdf.id,
      drive_file_name: pdf.name,
      drive_file_size: pdf.size || null,
      drive_file_modified_at: pdf.modifiedTime || null,
      linked_by_user_id: currentUserId,
      origin_folder_id: folderLink.drive_folder_id,
      origin_folder_name: folderLink.drive_folder_name,
      sync_status: 'synced',
      created_at: nowIso,
      updated_at: nowIso,
    };

    let docSaved = false;
    if (supabaseAdmin) {
      try {
        const { data: existingDoc } = await supabaseAdmin
          .from('auditoria_documentos')
          .select('id')
          .eq('condo_id', condoId)
          .eq('category', cleanCategory)
          .eq('drive_file_id', pdf.id)
          .maybeSingle();

        if (existingDoc?.id) {
          await supabaseAdmin
            .from('auditoria_documentos')
            .update({
              drive_file_name: docRecord.drive_file_name,
              drive_file_size: docRecord.drive_file_size,
              drive_file_modified_at: docRecord.drive_file_modified_at,
              origin_folder_id: docRecord.origin_folder_id,
              origin_folder_name: docRecord.origin_folder_name,
              sync_status: 'synced',
              updated_at: nowIso,
            })
            .eq('id', existingDoc.id);
          docSaved = true;
          updatedCount++;
        } else {
          const insertRes = await supabaseAdmin
            .from('auditoria_documentos')
            .insert(docRecord)
            .select()
            .maybeSingle();
          if (!insertRes.error && insertRes.data) {
            docSaved = true;
            importedCount++;
          }
        }
      } catch {}
    }

    if (!docSaved) {
      const fbList = readFallbackDocuments();
      const existsIdx = fbList.findIndex(
        (d) => d.condo_id === condoId && d.category === cleanCategory && d.drive_file_id === pdf.id
      );
      saveFallbackDocument(docRecord);
      if (existsIdx >= 0) updatedCount++;
      else importedCount++;
    }
  }

  // Atualizar data da última sincronização
  folderLink.last_synced_at = nowIso;
  if (supabaseAdmin) {
    try {
      await supabaseAdmin
        .from('auditoria_fase_pastas')
        .update({ last_synced_at: nowIso, updated_at: nowIso })
        .eq('condo_id', condoId)
        .eq('category', cleanCategory);
    } catch {}
  }
  saveFallbackFolder(folderLink);

  return res.json({
    ok: true,
    success: true,
    message: \`Sincronização concluída. \${importedCount} novos PDFs encontrados, \${updatedCount} atualizados. Nenhum arquivo foi excluído.\`,
    folder_link: folderLink,
    imported_count: importedCount,
    updated_count: updatedCount,
    total_in_folder: pdfFiles.length,
  });
});

// 1.5. Desvincular pasta de uma fase (remove SOMENTE vínculos de documentos oriundos desta pasta no CRM)
app.delete('/api/auditoria/condo/:condoId/phases/:category/unlink-folder', requireAuditoriaAccess('can_manage_auditoria'), async (req, res) => {
  const { condoId, category } = req.params;
  const cleanCategory = String(category).trim().toLowerCase();
  const supabaseAdmin = getAdminSupabaseClient();

  // 1. Localizar vínculo da pasta
  let targetFolderId: string | null = null;
  if (supabaseAdmin) {
    try {
      const { data } = await supabaseAdmin
        .from('auditoria_fase_pastas')
        .select('drive_folder_id')
        .eq('condo_id', condoId)
        .eq('category', cleanCategory)
        .maybeSingle();
      if (data?.drive_folder_id) targetFolderId = data.drive_folder_id;
    } catch {}
  }

  if (!targetFolderId) {
    const fbFolders = readFallbackFolders();
    const fbMatch = fbFolders.find((f) => f.condo_id === condoId && f.category === cleanCategory);
    if (fbMatch) targetFolderId = fbMatch.drive_folder_id;
  }

  // 2. Remover vínculo da pasta
  if (supabaseAdmin) {
    try {
      await supabaseAdmin
        .from('auditoria_fase_pastas')
        .delete()
        .eq('condo_id', condoId)
        .eq('category', cleanCategory);
    } catch {}
  }
  deleteFallbackFolder(condoId, cleanCategory);

  // 3. Remover do CRM apenas os documentos cuja origem foi esta pasta
  let removedFromDbCount = 0;
  if (targetFolderId && supabaseAdmin) {
    try {
      const delRes = await supabaseAdmin
        .from('auditoria_documentos')
        .delete()
        .eq('condo_id', condoId)
        .eq('category', cleanCategory)
        .eq('origin_folder_id', targetFolderId);
      if (!delRes.error) {
        removedFromDbCount = 1;
      }
    } catch {}
  }

  let removedFallbackCount = 0;
  if (targetFolderId) {
    removedFallbackCount = deleteFallbackDocumentsByOriginFolder(condoId, cleanCategory, targetFolderId);
  }

  return res.json({
    ok: true,
    success: true,
    drive_file_preserved: true,
    removed_documents_count: removedFromDbCount + removedFallbackCount,
    message: 'Pasta desvinculada com sucesso da fase. Os vínculos correspondentes foram removidos do CRM. Os arquivos originais no Google Drive permanecem intactos.',
  });
});

`;
    content = content.replace(targetEndpoint, folderEndpoints + '\n' + targetEndpoint);
  }

  fs.writeFileSync('server.ts', content, 'utf8');
  console.log('server.ts updated successfully with folder sync routes!');
}

function updateServerJs() {
  let content = fs.readFileSync('server.js', 'utf8');

  // 1. Add listAvailableFoldersForCondo to imports if not present
  if (!content.includes('listAvailableFoldersForCondo')) {
    content = content.replace(
      'normalizeNameForMatching,\n};',
      'normalizeNameForMatching,\n  listAvailableFoldersForCondo,\n};'
    );
  }

  // 2. Add folder fallback structures
  if (!content.includes('AUDITORIA_FOLDERS_FALLBACK_FILE')) {
    const target = 'const AUDITORIA_DOCS_FALLBACK_FILE = path.join(__dirname, \'auditoria_documents_store.json\');';
    const addition = `const AUDITORIA_DOCS_FALLBACK_FILE = path.join(__dirname, 'auditoria_documents_store.json');
const AUDITORIA_FOLDERS_FALLBACK_FILE = path.join(__dirname, 'auditoria_folders_store.json');

function readFallbackFolders() {
  try {
    if (fs.existsSync(AUDITORIA_FOLDERS_FALLBACK_FILE)) {
      const raw = fs.readFileSync(AUDITORIA_FOLDERS_FALLBACK_FILE, 'utf8');
      return JSON.parse(raw) || [];
    }
  } catch (e) {
    console.warn('[AUDITORIA_FOLDERS_FALLBACK] Falha ao ler arquivo local:', e);
  }
  return [];
}

function saveFallbackFolder(record) {
  try {
    const list = readFallbackFolders();
    const idx = list.findIndex((f) => f.condo_id === record.condo_id && f.category === record.category);
    if (idx >= 0) {
      list[idx] = record;
    } else {
      list.push(record);
    }
    fs.writeFileSync(AUDITORIA_FOLDERS_FALLBACK_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.warn('[AUDITORIA_FOLDERS_FALLBACK] Falha ao salvar arquivo local:', e);
  }
}

function deleteFallbackFolder(condoId, category) {
  try {
    const list = readFallbackFolders();
    const filtered = list.filter((f) => !(f.condo_id === condoId && f.category === category));
    if (filtered.length !== list.length) {
      fs.writeFileSync(AUDITORIA_FOLDERS_FALLBACK_FILE, JSON.stringify(filtered, null, 2), 'utf8');
      return true;
    }
  } catch (e) {
    console.warn('[AUDITORIA_FOLDERS_FALLBACK] Falha ao remover do arquivo local:', e);
  }
  return false;
}

function deleteFallbackDocumentsByOriginFolder(condoId, category, folderId) {
  try {
    const list = readFallbackDocuments();
    const remaining = list.filter((d) => {
      if (d.condo_id === condoId && d.category === category && d.origin_folder_id === folderId) {
        return false;
      }
      return true;
    });
    const removedCount = list.length - remaining.length;
    if (removedCount > 0) {
      fs.writeFileSync(AUDITORIA_DOCS_FALLBACK_FILE, JSON.stringify(remaining, null, 2), 'utf8');
    }
    return removedCount;
  } catch (e) {
    console.warn('[AUDITORIA_DOCS_FALLBACK] Falha ao remover documentos por pasta de origem:', e);
    return 0;
  }
}`;
    content = content.replace(target, addition);
  }

  // 3. Add the folder routes before `// 2. Consultar documentos vinculados`
  if (!content.includes('/api/auditoria/condo/:condoId/drive-folders')) {
    const targetEndpoint = '// 2. Consultar documentos vinculados para o condomínio';
    const folderEndpoints = `// 1.1. Listar pastas disponíveis para seleção no condomínio (pasta principal + subpastas)
app.get('/api/auditoria/condo/:condoId/drive-folders', requireAuditoriaAccess('can_access_auditoria'), async (req, res) => {
  const { condoId } = req.params;
  const leadData = req.condoLead;
  const condoName = leadData?.name;

  try {
    const result = await listAvailableFoldersForCondo(condoName);
    if (!result.condo_found) {
      return res.json({
        ok: true,
        found: false,
        condo_id: condoId,
        condo_name: condoName,
        message: result.error || \`A pasta do condomínio "\${condoName}" não foi localizada no Google Drive central.\`,
        folders: [],
      });
    }

    return res.json({
      ok: true,
      found: true,
      condo_id: condoId,
      condo_name: condoName,
      condo_folder: result.condo_folder,
      folders: result.folders,
    });
  } catch (err) {
    console.error('[AUDITORIA_DRIVE_FOLDERS_ERROR]', err);
    return res.status(500).json({
      ok: false,
      error: 'Falha ao consultar pastas no Google Drive: ' + (err?.message || err),
    });
  }
});

// 1.2. Consultar pastas do Drive vinculadas por fase
app.get('/api/auditoria/condo/:condoId/folder-links', requireAuditoriaAccess('can_access_auditoria'), async (req, res) => {
  const { condoId } = req.params;
  const supabaseAdmin = getAdminSupabaseClient();

  let folderLinks = [];
  let dbError = null;

  if (supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin
        .from('auditoria_fase_pastas')
        .select('*')
        .eq('condo_id', condoId);

      if (error) {
        dbError = error;
      } else {
        folderLinks = data || [];
      }
    } catch (err) {
      dbError = err;
    }
  }

  const fallbackFolders = readFallbackFolders().filter((f) => f.condo_id === condoId);

  // Mesclar: prioriza Supabase, completa com contingência local
  const existingCategories = new Set(folderLinks.map((f) => f.category));
  const mergedLinks = [
    ...folderLinks.map((f) => ({ ...f, persisted_definitively: true })),
    ...fallbackFolders
      .filter((f) => !existingCategories.has(f.category))
      .map((f) => ({ ...f, persisted_definitively: false })),
  ];

  return res.json({
    ok: true,
    folder_links: mergedLinks,
    source: folderLinks.length > 0 ? 'supabase' : 'fallback_local',
  });
});

// 1.3. Vincular uma pasta do Google Drive a uma fase e sincronizar todos os seus PDFs
app.post('/api/auditoria/condo/:condoId/phases/:category/link-folder', requireAuditoriaAccess('can_manage_auditoria'), async (req, res) => {
  const { condoId, category } = req.params;
  const { drive_folder_id, drive_folder_name } = req.body || {};

  if (!drive_folder_id || typeof drive_folder_id !== 'string' || !drive_folder_id.trim()) {
    return res.status(400).json({ error: 'ID da pasta no Google Drive é obrigatório.' });
  }
  if (!drive_folder_name || typeof drive_folder_name !== 'string' || !drive_folder_name.trim()) {
    return res.status(400).json({ error: 'Nome da pasta no Google Drive é obrigatório.' });
  }

  const cleanCategory = String(category).trim().toLowerCase();
  if (!cleanCategory || cleanCategory.length > 50 || !/^[a-z0-9_-]+$/.test(cleanCategory)) {
    return res.status(400).json({ error: 'Categoria documental inválida.' });
  }

  const currentUserId = req.user?.id || null;
  const nowIso = new Date().toISOString();
  const supabaseAdmin = getAdminSupabaseClient();

  const folderRecord = {
    id: crypto.randomUUID(),
    condo_id: condoId,
    category: cleanCategory,
    drive_folder_id: String(drive_folder_id).trim(),
    drive_folder_name: String(drive_folder_name).trim(),
    linked_by_user_id: currentUserId,
    last_synced_at: nowIso,
    created_at: nowIso,
    updated_at: nowIso,
  };

  // 1. Persistir o vínculo da pasta no Supabase (com contingência)
  let folderPersistedDefinitively = false;
  if (supabaseAdmin) {
    try {
      const { data: existingFolder } = await supabaseAdmin
        .from('auditoria_fase_pastas')
        .select('id')
        .eq('condo_id', condoId)
        .eq('category', cleanCategory)
        .maybeSingle();

      let folderRes;
      if (existingFolder?.id) {
        folderRes = await supabaseAdmin
          .from('auditoria_fase_pastas')
          .update({
            drive_folder_id: folderRecord.drive_folder_id,
            drive_folder_name: folderRecord.drive_folder_name,
            linked_by_user_id: currentUserId,
            last_synced_at: nowIso,
            updated_at: nowIso,
          })
          .eq('id', existingFolder.id)
          .select()
          .maybeSingle();
      } else {
        folderRes = await supabaseAdmin
          .from('auditoria_fase_pastas')
          .insert(folderRecord)
          .select()
          .maybeSingle();
      }

      if (!folderRes.error && folderRes.data) {
        folderPersistedDefinitively = true;
        deleteFallbackFolder(condoId, cleanCategory);
      } else {
        saveFallbackFolder(folderRecord);
      }
    } catch {
      saveFallbackFolder(folderRecord);
    }
  } else {
    saveFallbackFolder(folderRecord);
  }

  // 2. Ler todos os PDFs contidos diretamente na pasta selecionada
  let pdfFiles = [];
  try {
    pdfFiles = await listPdfFilesInFolder(folderRecord.drive_folder_id);
  } catch (driveErr) {
    return res.status(500).json({
      ok: false,
      error: 'Falha ao consultar arquivos PDF na pasta do Google Drive: ' + (driveErr?.message || driveErr),
    });
  }

  // 3. Registrar ou atualizar cada PDF de forma idempotente
  let importedCount = 0;
  let updatedCount = 0;
  const syncedDocs = [];

  for (const pdf of pdfFiles) {
    const docRecord = {
      id: crypto.randomUUID(),
      condo_id: condoId,
      category: cleanCategory,
      drive_file_id: pdf.id,
      drive_file_name: pdf.name,
      drive_file_size: pdf.size || null,
      drive_file_modified_at: pdf.modifiedTime || null,
      linked_by_user_id: currentUserId,
      origin_folder_id: folderRecord.drive_folder_id,
      origin_folder_name: folderRecord.drive_folder_name,
      sync_status: 'synced',
      created_at: nowIso,
      updated_at: nowIso,
    };

    let docSaved = false;

    if (supabaseAdmin) {
      try {
        const { data: existingDoc } = await supabaseAdmin
          .from('auditoria_documentos')
          .select('id')
          .eq('condo_id', condoId)
          .eq('category', cleanCategory)
          .eq('drive_file_id', pdf.id)
          .maybeSingle();

        if (existingDoc?.id) {
          const updateRes = await supabaseAdmin
            .from('auditoria_documentos')
            .update({
              drive_file_name: docRecord.drive_file_name,
              drive_file_size: docRecord.drive_file_size,
              drive_file_modified_at: docRecord.drive_file_modified_at,
              origin_folder_id: docRecord.origin_folder_id,
              origin_folder_name: docRecord.origin_folder_name,
              sync_status: 'synced',
              updated_at: nowIso,
            })
            .eq('id', existingDoc.id)
            .select()
            .maybeSingle();

          if (!updateRes.error && updateRes.data) {
            docSaved = true;
            updatedCount++;
            syncedDocs.push({ ...updateRes.data, persisted_definitively: true });
          }
        } else {
          const insertRes = await supabaseAdmin
            .from('auditoria_documentos')
            .insert(docRecord)
            .select()
            .maybeSingle();

          if (!insertRes.error && insertRes.data) {
            docSaved = true;
            importedCount++;
            syncedDocs.push({ ...insertRes.data, persisted_definitively: true });
          }
        }
      } catch {}
    }

    // Se não salvou no Supabase (restrição legada de unicidade ou tabela ausente), persiste em contingência local
    if (!docSaved) {
      const fallbackList = readFallbackDocuments();
      const existingFbIdx = fallbackList.findIndex(
        (d) => d.condo_id === condoId && d.category === cleanCategory && d.drive_file_id === pdf.id
      );

      saveFallbackDocument(docRecord);
      if (existingFbIdx >= 0) {
        updatedCount++;
      } else {
        importedCount++;
      }
      syncedDocs.push({ ...docRecord, persisted_definitively: false });
    }
  }

  return res.json({
    ok: true,
    success: true,
    message: \`Pasta "\${folderRecord.drive_folder_name}" vinculada com sucesso. \${importedCount} novos documentos registrados, \${updatedCount} atualizados.\`,
    folder_link: folderRecord,
    persisted_definitively: folderPersistedDefinitively,
    imported_count: importedCount,
    updated_count: updatedCount,
    total_in_folder: pdfFiles.length,
    documents: syncedDocs,
  });
});

// 1.4. Sincronizar pasta já vinculada (identifica novos PDFs sem excluir arquivos existentes)
app.post('/api/auditoria/condo/:condoId/phases/:category/sync-folder', requireAuditoriaAccess('can_manage_auditoria'), async (req, res) => {
  const { condoId, category } = req.params;
  const cleanCategory = String(category).trim().toLowerCase();
  const supabaseAdmin = getAdminSupabaseClient();
  const currentUserId = req.user?.id || null;
  const nowIso = new Date().toISOString();

  // 1. Obter vínculo atual da pasta
  let folderLink = null;
  if (supabaseAdmin) {
    try {
      const { data } = await supabaseAdmin
        .from('auditoria_fase_pastas')
        .select('*')
        .eq('condo_id', condoId)
        .eq('category', cleanCategory)
        .maybeSingle();
      if (data) folderLink = data;
    } catch {}
  }

  if (!folderLink) {
    const fbFolders = readFallbackFolders();
    const fbMatch = fbFolders.find((f) => f.condo_id === condoId && f.category === cleanCategory);
    if (fbMatch) folderLink = fbMatch;
  }

  if (!folderLink) {
    return res.status(404).json({
      ok: false,
      error: 'Nenhuma pasta do Google Drive vinculada a esta fase. Vincule uma pasta primeiro.',
    });
  }

  // 2. Consultar arquivos atuais na pasta do Drive
  let pdfFiles = [];
  try {
    pdfFiles = await listPdfFilesInFolder(folderLink.drive_folder_id);
  } catch (driveErr) {
    return res.status(500).json({
      ok: false,
      error: 'Falha ao consultar pasta no Google Drive: ' + (driveErr?.message || driveErr),
    });
  }

  let importedCount = 0;
  let updatedCount = 0;

  for (const pdf of pdfFiles) {
    const docRecord = {
      id: crypto.randomUUID(),
      condo_id: condoId,
      category: cleanCategory,
      drive_file_id: pdf.id,
      drive_file_name: pdf.name,
      drive_file_size: pdf.size || null,
      drive_file_modified_at: pdf.modifiedTime || null,
      linked_by_user_id: currentUserId,
      origin_folder_id: folderLink.drive_folder_id,
      origin_folder_name: folderLink.drive_folder_name,
      sync_status: 'synced',
      created_at: nowIso,
      updated_at: nowIso,
    };

    let docSaved = false;
    if (supabaseAdmin) {
      try {
        const { data: existingDoc } = await supabaseAdmin
          .from('auditoria_documentos')
          .select('id')
          .eq('condo_id', condoId)
          .eq('category', cleanCategory)
          .eq('drive_file_id', pdf.id)
          .maybeSingle();

        if (existingDoc?.id) {
          await supabaseAdmin
            .from('auditoria_documentos')
            .update({
              drive_file_name: docRecord.drive_file_name,
              drive_file_size: docRecord.drive_file_size,
              drive_file_modified_at: docRecord.drive_file_modified_at,
              origin_folder_id: docRecord.origin_folder_id,
              origin_folder_name: docRecord.origin_folder_name,
              sync_status: 'synced',
              updated_at: nowIso,
            })
            .eq('id', existingDoc.id);
          docSaved = true;
          updatedCount++;
        } else {
          const insertRes = await supabaseAdmin
            .from('auditoria_documentos')
            .insert(docRecord)
            .select()
            .maybeSingle();
          if (!insertRes.error && insertRes.data) {
            docSaved = true;
            importedCount++;
          }
        }
      } catch {}
    }

    if (!docSaved) {
      const fbList = readFallbackDocuments();
      const existsIdx = fbList.findIndex(
        (d) => d.condo_id === condoId && d.category === cleanCategory && d.drive_file_id === pdf.id
      );
      saveFallbackDocument(docRecord);
      if (existsIdx >= 0) updatedCount++;
      else importedCount++;
    }
  }

  // Atualizar data da última sincronização
  folderLink.last_synced_at = nowIso;
  if (supabaseAdmin) {
    try {
      await supabaseAdmin
        .from('auditoria_fase_pastas')
        .update({ last_synced_at: nowIso, updated_at: nowIso })
        .eq('condo_id', condoId)
        .eq('category', cleanCategory);
    } catch {}
  }
  saveFallbackFolder(folderLink);

  return res.json({
    ok: true,
    success: true,
    message: \`Sincronização concluída. \${importedCount} novos PDFs encontrados, \${updatedCount} atualizados. Nenhum arquivo foi excluído.\`,
    folder_link: folderLink,
    imported_count: importedCount,
    updated_count: updatedCount,
    total_in_folder: pdfFiles.length,
  });
});

// 1.5. Desvincular pasta de uma fase (remove SOMENTE vínculos de documentos oriundos desta pasta no CRM)
app.delete('/api/auditoria/condo/:condoId/phases/:category/unlink-folder', requireAuditoriaAccess('can_manage_auditoria'), async (req, res) => {
  const { condoId, category } = req.params;
  const cleanCategory = String(category).trim().toLowerCase();
  const supabaseAdmin = getAdminSupabaseClient();

  // 1. Localizar vínculo da pasta
  let targetFolderId = null;
  if (supabaseAdmin) {
    try {
      const { data } = await supabaseAdmin
        .from('auditoria_fase_pastas')
        .select('drive_folder_id')
        .eq('condo_id', condoId)
        .eq('category', cleanCategory)
        .maybeSingle();
      if (data?.drive_folder_id) targetFolderId = data.drive_folder_id;
    } catch {}
  }

  if (!targetFolderId) {
    const fbFolders = readFallbackFolders();
    const fbMatch = fbFolders.find((f) => f.condo_id === condoId && f.category === cleanCategory);
    if (fbMatch) targetFolderId = fbMatch.drive_folder_id;
  }

  // 2. Remover vínculo da pasta
  if (supabaseAdmin) {
    try {
      await supabaseAdmin
        .from('auditoria_fase_pastas')
        .delete()
        .eq('condo_id', condoId)
        .eq('category', cleanCategory);
    } catch {}
  }
  deleteFallbackFolder(condoId, cleanCategory);

  // 3. Remover do CRM apenas os documentos cuja origem foi esta pasta
  let removedFromDbCount = 0;
  if (targetFolderId && supabaseAdmin) {
    try {
      const delRes = await supabaseAdmin
        .from('auditoria_documentos')
        .delete()
        .eq('condo_id', condoId)
        .eq('category', cleanCategory)
        .eq('origin_folder_id', targetFolderId);
      if (!delRes.error) {
        removedFromDbCount = 1;
      }
    } catch {}
  }

  let removedFallbackCount = 0;
  if (targetFolderId) {
    removedFallbackCount = deleteFallbackDocumentsByOriginFolder(condoId, cleanCategory, targetFolderId);
  }

  return res.json({
    ok: true,
    success: true,
    drive_file_preserved: true,
    removed_documents_count: removedFromDbCount + removedFallbackCount,
    message: 'Pasta desvinculada com sucesso da fase. Os vínculos correspondentes foram removidos do CRM. Os arquivos originais no Google Drive permanecem intactos.',
  });
});

`;
    content = content.replace(targetEndpoint, folderEndpoints + '\n' + targetEndpoint);
  }

  fs.writeFileSync('server.js', content, 'utf8');
  console.log('server.js updated successfully with folder sync routes!');
}

updateServerTs();
updateServerJs();
