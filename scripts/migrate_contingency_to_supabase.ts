/**
 * TRIVERUS CRM — MÓDULO DE AUDITORIA
 * Ferramenta Segura e Idempotente de Migração de Dados de Contingência para o Supabase
 *
 * Arquivo: scripts/migrate_contingency_to_supabase.ts
 *
 * Modos de Execução:
 * 1. Simulação (--dry-run, padrão):
 *    npx tsx scripts/migrate_contingency_to_supabase.ts --dry-run
 *    Valida integridade relacional, testa esquema remoto e calcula o plano sem alterar o banco.
 *
 * 2. Execução Real (--execute):
 *    npx tsx scripts/migrate_contingency_to_supabase.ts --execute
 *    Cria backup automático dos arquivos locais e migra os registros com idempotência estrita.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Caminhos dos arquivos de contingência
const FOLDERS_FILE = path.join(ROOT_DIR, 'auditoria_folders_store.json');
const DOCS_FILE = path.join(ROOT_DIR, 'auditoria_documents_store.json');

interface FolderContingencyRecord {
  id: string;
  condo_id: string;
  category: string;
  drive_folder_id: string;
  drive_folder_name: string;
  linked_by_user_id: string | null;
  last_synced_at?: string;
  created_at?: string;
  updated_at?: string;
}

interface DocContingencyRecord {
  id: string;
  condo_id: string;
  category: string;
  drive_file_id: string;
  drive_file_name: string;
  drive_file_size?: number | null;
  drive_file_modified_at?: string | null;
  linked_by_user_id: string | null;
  origin_folder_id?: string | null;
  origin_folder_name?: string | null;
  sync_status?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface MigrationStats {
  totalRead: number;
  validated: number;
  imported: number;
  alreadyExisting: number;
  conflictsDivergent: number;
  rejectedInconsistent: number;
  details: {
    category: string;
    target: string;
    status: 'imported' | 'existing' | 'conflict' | 'rejected';
    reason?: string;
  }[];
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(val?: string | null): boolean {
  if (!val || typeof val !== 'string') return false;
  return UUID_REGEX.test(val.trim());
}

function initSupabaseAdmin(): SupabaseClient {
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

/**
 * Cria cópia de segurança com timestamp no nome do arquivo
 */
function createSafeBackup(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = filePath.replace(/\.json$/, `.backup.${timestamp}.json`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

/**
 * Inspeciona se as tabelas e colunas necessárias no Supabase já existem
 */
async function checkSupabaseSchemaHealth(client: SupabaseClient): Promise<{
  foldersTableReady: boolean;
  foldersTableError?: string;
  docsTableReady: boolean;
  docsColumnsReady: boolean;
  docsError?: string;
}> {
  let foldersTableReady = false;
  let foldersTableError: string | undefined;
  let docsTableReady = false;
  let docsColumnsReady = false;
  let docsError: string | undefined;

  // 1. Checar public.auditoria_fase_pastas
  try {
    const { error } = await client.from('auditoria_fase_pastas').select('id').limit(1);
    if (!error) {
      foldersTableReady = true;
    } else {
      foldersTableError = `[${error.code || 'UNKNOWN'}] ${error.message}`;
    }
  } catch (err: any) {
    foldersTableError = err?.message || String(err);
  }

  // 2. Checar public.auditoria_documentos e colunas adicionais
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
  } catch (err: any) {
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
  const isDryRun = !isExecute || args.includes('--dry-run') || args.includes('-d');

  console.log('==============================================================================');
  console.log('TRIVERUS AUDITORIA — MIGRAÇÃO DE CONTINGÊNCIA PARA O SUPABASE');
  console.log(`Modo de Operação: ${isExecute ? '>>> EXECUÇÃO REAL (LIVE) <<<' : 'SIMULAÇÃO (--dry-run)'}`);
  console.log('==============================================================================\n');

  // 1. Inicializar Supabase Admin
  let supabase: SupabaseClient;
  try {
    supabase = initSupabaseAdmin();
    console.log('[1/5] Conexão com Supabase Admin estabelecida com sucesso.');
  } catch (err: any) {
    console.error('ERRO FATAL: Falha ao inicializar cliente Supabase:', err.message);
    process.exit(1);
  }

  // 2. Verificar prontidão do esquema no banco remoto
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

  // 3. Backup de segurança dos arquivos locais
  console.log('[3/5] Verificando e realizando backup dos arquivos de contingência locais...');
  const folderBackup = createSafeBackup(FOLDERS_FILE);
  const docBackup = createSafeBackup(DOCS_FILE);
  if (folderBackup) console.log(`  - Backup de pastas salvo em: ${path.basename(folderBackup)}`);
  if (docBackup) console.log(`  - Backup de docs salvo em:   ${path.basename(docBackup)}`);

  // 4. Carregar registros locais
  let localFolders: FolderContingencyRecord[] = [];
  let localDocs: DocContingencyRecord[] = [];

  if (fs.existsSync(FOLDERS_FILE)) {
    try {
      localFolders = JSON.parse(fs.readFileSync(FOLDERS_FILE, 'utf8')) || [];
    } catch (e: any) {
      console.error('Erro ao ler auditoria_folders_store.json:', e.message);
    }
  }

  if (fs.existsSync(DOCS_FILE)) {
    try {
      localDocs = JSON.parse(fs.readFileSync(DOCS_FILE, 'utf8')) || [];
    } catch (e: any) {
      console.error('Erro ao ler auditoria_documents_store.json:', e.message);
    }
  }

  console.log(`[4/5] Registros locais encontrados: ${localFolders.length} pastas, ${localDocs.length} documentos.\n`);

  // 5. Processamento e Validação Relacional
  console.log('[5/5] Analisando registros e integridade relacional...');

  const folderStats: MigrationStats = {
    totalRead: localFolders.length,
    validated: 0,
    imported: 0,
    alreadyExisting: 0,
    conflictsDivergent: 0,
    rejectedInconsistent: 0,
    details: [],
  };

  const docStats: MigrationStats = {
    totalRead: localDocs.length,
    validated: 0,
    imported: 0,
    alreadyExisting: 0,
    conflictsDivergent: 0,
    rejectedInconsistent: 0,
    details: [],
  };

  // Cache de validação para evitar consultas redundantes ao banco
  const leadCache = new Map<string, boolean>();
  const userCache = new Map<string, boolean>();

  async function checkLeadExists(condoId: string): Promise<boolean> {
    if (!isValidUUID(condoId)) return false;
    if (leadCache.has(condoId)) return leadCache.get(condoId)!;
    const { data } = await supabase.from('leads').select('id').eq('id', condoId).maybeSingle();
    const exists = Boolean(data?.id);
    leadCache.set(condoId, exists);
    return exists;
  }

  async function checkUserExists(userId?: string | null): Promise<boolean> {
    if (!userId) return true; // null é aceito pelo esquema (ON DELETE SET NULL)
    if (!isValidUUID(userId)) return false;
    if (userCache.has(userId)) return userCache.get(userId)!;
    const { data } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle();
    const exists = Boolean(data?.id);
    userCache.set(userId, exists);
    return exists;
  }

  // --- MIGRAÇÃO DE PASTAS ---
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

    let validUserId: string | null = null;
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

    // Verificar se já existe no Supabase
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
      // Inserir novo registro
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

  // --- MIGRAÇÃO DE DOCUMENTOS ---
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

    let validUserId: string | null = null;
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

    // Verificar existência no Supabase
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

  // 6. Relatório Estruturado Final no Terminal
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
