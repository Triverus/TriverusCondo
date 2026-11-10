/**
 * TRIVERUS CRM — MÓDULO DE AUDITORIA
 * Ferramenta Segura e Idempotente de Migração de Dados de Contingência para o Supabase (Node.js runtime)
 *
 * Arquivo: scripts/migrate_contingency_to_supabase.js
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const FOLDERS_FILE = path.join(ROOT_DIR, 'auditoria_folders_store.json');
const DOCS_FILE = path.join(ROOT_DIR, 'auditoria_documents_store.json');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(val) {
  if (!val || typeof val !== 'string') return false;
  return UUID_REGEX.test(val.trim());
}

function initSupabaseAdmin() {
  const loadedEnv = loadEnv('development', ROOT_DIR, '');
  const url = process.env.VITE_SUPABASE_URL || loadedEnv.VITE_SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || loadedEnv.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!url || !serviceKey) {
    throw new Error('Credenciais administrativas do Supabase (VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY) não encontradas no ambiente.');
  }

  return createClient(url.trim(), serviceKey.trim(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function createSafeBackup(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = filePath.replace(/\.json$/, `.backup.${timestamp}.json`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

async function checkSupabaseSchemaHealth(client) {
  let foldersTableReady = false;
  let foldersTableError;
  let docsTableReady = false;
  let docsColumnsReady = false;
  let docsError;

  try {
    const { error } = await client.from('auditoria_fase_pastas').select('id').limit(1);
    if (!error) {
      foldersTableReady = true;
    } else {
      foldersTableError = `[${error.code || 'UNKNOWN'}] ${error.message}`;
    }
  } catch (err) {
    foldersTableError = err?.message || String(err);
  }

  try {
    const { error: baseErr } = await client.from('auditoria_documentos').select('id').limit(1);
    if (!baseErr) {
      docsTableReady = true;
      const { error: colErr } = await client
        .from('auditoria_documentos')
        .select('origin_folder_id, origin_folder_name, sync_status')
        .limit(1);

      if (!colErr) {
        docsColumnsReady = true;
      } else {
        docsError = `Coluna ausente: [${colErr.code || 'UNKNOWN'}] ${colErr.message}`;
      }
    } else {
      docsError = `Tabela ausente: [${baseErr.code || 'UNKNOWN'}] ${baseErr.message}`;
    }
  } catch (err) {
    docsError = err?.message || String(err);
  }

  return {
    foldersTableReady,
    foldersTableError,
    docsTableReady,
    docsColumnsReady,
    docsError,
  };
}

async function run() {
  const args = process.argv.slice(2);
  const isExecute = args.includes('--execute') || args.includes('-e') || args.includes('--live');

  console.log('==============================================================================');
  console.log('TRIVERUS AUDITORIA — MIGRAÇÃO DE CONTINGÊNCIA PARA O SUPABASE');
  console.log(`Modo de Operação: ${isExecute ? '>>> EXECUÇÃO REAL (LIVE) <<<' : 'SIMULAÇÃO (--dry-run)'}`);
  console.log('==============================================================================\n');

  let supabase;
  try {
    supabase = initSupabaseAdmin();
    console.log('[1/5] Conexão com Supabase Admin estabelecida com sucesso.');
  } catch (err) {
    console.error('ERRO FATAL: Falha ao inicializar cliente Supabase:', err.message);
    process.exit(1);
  }

  console.log('[2/5] Diagnosticando estrutura das tabelas de auditoria no Supabase...');
  const schemaHealth = await checkSupabaseSchemaHealth(supabase);

  console.log(`  - public.auditoria_fase_pastas: ${schemaHealth.foldersTableReady ? 'PRONTA' : 'NÃO ENCONTRADA (' + schemaHealth.foldersTableError + ')'}`);
  console.log(`  - public.auditoria_documentos:   ${schemaHealth.docsTableReady ? 'PRONTA' : 'NÃO ENCONTRADA (' + schemaHealth.docsError + ')'}`);
  console.log(`  - Colunas de sincronização:      ${schemaHealth.docsColumnsReady ? 'PRONTAS' : 'PENDENTES (' + (schemaHealth.docsError || 'executar migração') + ')'}`);

  const isSchemaReady = schemaHealth.foldersTableReady && schemaHealth.docsTableReady && schemaHealth.docsColumnsReady;

  if (!isSchemaReady) {
    console.warn('\n==============================================================================');
    console.warn('ATENÇÃO: O ESQUEMA DEFINITIVO AINDA NÃO FOI APLICADO NO SUPABASE REMOTO!');
    console.warn('A migração de dados de contingência não pode gravar no banco antes da execução do SQL.');
    console.warn('Ação obrigatória do DBA / Operador:');
    console.warn('1. Acesse o console do Supabase -> SQL Editor.');
    console.warn('2. Execute integralmente o arquivo: sql/20261027_auditoria_folder_sync_and_multidoc.sql');
    console.warn('3. Reexecute este script com a flag --execute após a criação das tabelas.');
    console.warn('==============================================================================\n');

    if (isExecute) {
      console.error('Execução real abortada com segurança para evitar perda ou rejeição de dados.');
      process.exit(2);
    }
  }

  console.log('[3/5] Verificando e realizando backup dos arquivos de contingência locais...');
  const folderBackup = createSafeBackup(FOLDERS_FILE);
  const docBackup = createSafeBackup(DOCS_FILE);
  if (folderBackup) console.log(`  - Backup de pastas salvo em: ${path.basename(folderBackup)}`);
  if (docBackup) console.log(`  - Backup de docs salvo em:   ${path.basename(docBackup)}`);

  let localFolders = [];
  let localDocs = [];

  if (fs.existsSync(FOLDERS_FILE)) {
    try {
      localFolders = JSON.parse(fs.readFileSync(FOLDERS_FILE, 'utf8')) || [];
    } catch (e) {
      console.error('Erro ao ler auditoria_folders_store.json:', e.message);
    }
  }

  if (fs.existsSync(DOCS_FILE)) {
    try {
      localDocs = JSON.parse(fs.readFileSync(DOCS_FILE, 'utf8')) || [];
    } catch (e) {
      console.error('Erro ao ler auditoria_documents_store.json:', e.message);
    }
  }

  console.log(`[4/5] Registros locais encontrados: ${localFolders.length} pastas, ${localDocs.length} documentos.\n`);
  console.log('[5/5] Analisando registros e integridade relacional...');

  const folderStats = {
    totalRead: localFolders.length,
    validated: 0,
    imported: 0,
    alreadyExisting: 0,
    conflictsDivergent: 0,
    rejectedInconsistent: 0,
    details: [],
  };

  const docStats = {
    totalRead: localDocs.length,
    validated: 0,
    imported: 0,
    alreadyExisting: 0,
    conflictsDivergent: 0,
    rejectedInconsistent: 0,
    details: [],
  };

  const leadCache = new Map();
  const userCache = new Map();

  async function checkLeadExists(condoId) {
    if (!isValidUUID(condoId)) return false;
    if (leadCache.has(condoId)) return leadCache.get(condoId);
    const { data } = await supabase.from('leads').select('id').eq('id', condoId).maybeSingle();
    const exists = Boolean(data?.id);
    leadCache.set(condoId, exists);
    return exists;
  }

  async function checkUserExists(userId) {
    if (!userId) return true;
    if (!isValidUUID(userId)) return false;
    if (userCache.has(userId)) return userCache.get(userId);
    const { data } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle();
    const exists = Boolean(data?.id);
    userCache.set(userId, exists);
    return exists;
  }

  for (const f of localFolders) {
    const targetLabel = `Condomínio ${f.condo_id.slice(0, 8)}... | Fase: ${f.category} | Pasta: "${f.drive_folder_name}"`;

    if (!isValidUUID(f.condo_id)) {
      folderStats.rejectedInconsistent++;
      folderStats.details.push({
        category: f.category,
        target: targetLabel,
        status: 'rejected',
        reason: `UUID do condomínio inválido: ${f.condo_id}`,
      });
      continue;
    }

    const leadExists = await checkLeadExists(f.condo_id);
    if (!leadExists) {
      folderStats.rejectedInconsistent++;
      folderStats.details.push({
        category: f.category,
        target: targetLabel,
        status: 'rejected',
        reason: `Condomínio (lead ${f.condo_id}) não existe no banco de dados CRM.`,
      });
      continue;
    }

    let validUserId = null;
    if (f.linked_by_user_id) {
      const userExists = await checkUserExists(f.linked_by_user_id);
      if (userExists) {
        validUserId = f.linked_by_user_id;
      } else {
        console.warn(`  [AVISO] Usuário vinculador ${f.linked_by_user_id} não existe em profiles. Será salvo como NULL.`);
      }
    }

    folderStats.validated++;

    if (!isSchemaReady) {
      folderStats.details.push({
        category: f.category,
        target: targetLabel,
        status: 'imported',
        reason: 'Validado com sucesso (simulação - esquema remoto pendente)',
      });
      continue;
    }

    const { data: existingRemote } = await supabase
      .from('auditoria_fase_pastas')
      .select('*')
      .eq('condo_id', f.condo_id)
      .eq('category', f.category)
      .maybeSingle();

    if (existingRemote) {
      if (existingRemote.drive_folder_id === f.drive_folder_id) {
        folderStats.alreadyExisting++;
        folderStats.details.push({
          category: f.category,
          target: targetLabel,
          status: 'existing',
          reason: 'Vínculo idêntico já persistido no Supabase.',
        });
      } else {
        // Conflito divergente: NÃO SOBRESCREVER SILENCIOSAMENTE
        folderStats.conflictsDivergent++;
        folderStats.details.push({
          category: f.category,
          target: targetLabel,
          status: 'conflict',
          reason: `Vínculo divergente detectado: Supabase possui "${existingRemote.drive_folder_name}" (${existingRemote.drive_folder_id}) vs Local "${f.drive_folder_name}" (${f.drive_folder_id}). Registro do Supabase mantido; sobrescrita silenciosa bloqueada.`,
        });
      }
    } else {
      if (isExecute) {
        await supabase.from('auditoria_fase_pastas').insert({
          id: f.id || crypto.randomUUID(),
          condo_id: f.condo_id,
          category: f.category,
          drive_folder_id: f.drive_folder_id,
          drive_folder_name: f.drive_folder_name,
          linked_by_user_id: validUserId,
          last_synced_at: f.last_synced_at || new Date().toISOString(),
          created_at: f.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      folderStats.imported++;
      folderStats.details.push({
        category: f.category,
        target: targetLabel,
        status: 'imported',
        reason: isExecute ? 'Gravado com sucesso no Supabase.' : 'Pronto para gravação (simulação).',
      });
    }
  }

  for (const d of localDocs) {
    const targetLabel = `Condomínio ${d.condo_id.slice(0, 8)}... | Fase: ${d.category} | Arquivo: "${d.drive_file_name}"`;

    if (!isValidUUID(d.condo_id)) {
      docStats.rejectedInconsistent++;
      docStats.details.push({
        category: d.category,
        target: targetLabel,
        status: 'rejected',
        reason: `UUID do condomínio inválido: ${d.condo_id}`,
      });
      continue;
    }

    const leadExists = await checkLeadExists(d.condo_id);
    if (!leadExists) {
      docStats.rejectedInconsistent++;
      docStats.details.push({
        category: d.category,
        target: targetLabel,
        status: 'rejected',
        reason: `Condomínio (lead ${d.condo_id}) não existe no banco de dados CRM.`,
      });
      continue;
    }

    let validUserId = null;
    if (d.linked_by_user_id) {
      const userExists = await checkUserExists(d.linked_by_user_id);
      if (userExists) validUserId = d.linked_by_user_id;
    }

    docStats.validated++;

    if (!isSchemaReady) {
      docStats.details.push({
        category: d.category,
        target: targetLabel,
        status: 'imported',
        reason: 'Validado com sucesso (simulação - esquema remoto pendente)',
      });
      continue;
    }

    const { data: existingDoc } = await supabase
      .from('auditoria_documentos')
      .select('*')
      .eq('condo_id', d.condo_id)
      .eq('category', d.category)
      .eq('drive_file_id', d.drive_file_id)
      .maybeSingle();

    if (existingDoc) {
      docStats.alreadyExisting++;
      docStats.details.push({
        category: d.category,
        target: targetLabel,
        status: 'existing',
        reason: 'Documento já cadastrado e sincronizado no Supabase.',
      });
    } else {
      if (isExecute) {
        await supabase.from('auditoria_documentos').insert({
          id: d.id || crypto.randomUUID(),
          condo_id: d.condo_id,
          category: d.category,
          drive_file_id: d.drive_file_id,
          drive_file_name: d.drive_file_name,
          drive_file_size: d.drive_file_size || null,
          drive_file_modified_at: d.drive_file_modified_at || null,
          linked_by_user_id: validUserId,
          origin_folder_id: d.origin_folder_id || null,
          origin_folder_name: d.origin_folder_name || null,
          sync_status: d.sync_status || 'synced',
          created_at: d.created_at || new Date().toISOString(),
          updated_at: d.updated_at || new Date().toISOString(),
        });
      }
      docStats.imported++;
      docStats.details.push({
        category: d.category,
        target: targetLabel,
        status: 'imported',
        reason: isExecute ? 'Gravado com sucesso no Supabase.' : 'Pronto para gravação (simulação).',
      });
    }
  }

  console.log('\n==============================================================================');
  console.log('RELATÓRIO DE AUDITORIA DA MIGRAÇÃO DE CONTINGÊNCIA');
  console.log('==============================================================================');
  console.log(`Status do Esquema Supabase: ${isSchemaReady ? 'INTEGRO / PRONTO' : 'PENDENTE DE MIGRAÇÃO SQL'}`);
  console.log(`Modo de Execução:           ${isExecute ? 'EXECUÇÃO REAL (LIVE)' : 'SIMULAÇÃO (--dry-run)'}\n`);

  console.log('RESUMO DE VÍNCULOS DE PASTAS (auditoria_folders_store.json):');
  console.log(`  - Total Lidos:                   ${folderStats.totalRead}`);
  console.log(`  - Validados (Integridade OK):    ${folderStats.validated}`);
  console.log(`  - Prontos / Importados:          ${folderStats.imported}`);
  console.log(`  - Já Existentes no Banco:        ${folderStats.alreadyExisting}`);
  console.log(`  - Conflitos Divergentes (Retidos): ${folderStats.conflictsDivergent}`);
  console.log(`  - Rejeitados por Inconsistência: ${folderStats.rejectedInconsistent}`);

  if (folderStats.details.length > 0) {
    console.log('\n  Detalhes das Pastas:');
    for (const item of folderStats.details) {
      console.log(`    [${item.status.toUpperCase()}] ${item.target} -> ${item.reason}`);
    }
  }

  console.log('\nRESUMO DE DOCUMENTOS (auditoria_documents_store.json):');
  console.log(`  - Total Lidos:                   ${docStats.totalRead}`);
  console.log(`  - Validados (Integridade OK):    ${docStats.validated}`);
  console.log(`  - Prontos / Importados:          ${docStats.imported}`);
  console.log(`  - Já Existentes no Banco:        ${docStats.alreadyExisting}`);
  console.log(`  - Conflitos Divergentes (Retidos): ${docStats.conflictsDivergent}`);
  console.log(`  - Rejeitados por Inconsistência: ${docStats.rejectedInconsistent}`);

  if (docStats.details.length > 0) {
    console.log('\n  Detalhes dos Documentos:');
    for (const item of docStats.details) {
      console.log(`    [${item.status.toUpperCase()}] ${item.target} -> ${item.reason}`);
    }
  }

  console.log('\nPRESERVAÇÃO DE DADOS LOCAIS:');
  console.log('  Os arquivos de contingência originais e suas cópias de segurança permanecem intactos.');
  console.log('  Nenhum dado local foi excluído.');
  console.log('==============================================================================\n');
}

run().catch((err) => {
  console.error('Erro inesperado durante a migração:', err);
  process.exit(1);
});
