#!/usr/bin/env node
/**
 * Ponto de entrada executável do Worker de Indexação Documental da Triverus.
 * 100% JavaScript nativo ESM compatível com Node 22.x e ambiente Hostinger.
 *
 * Modos de operação:
 * 1. Modo Lote Único (One-Shot para Cron Jobs):
 *    node scripts/run-auditoria-worker.js --once
 *
 * 2. Modo Daemon Contínuo (para systemd / PM2 / Hostinger Node Apps):
 *    node scripts/run-auditoria-worker.js
 */

import { createClient } from '@supabase/supabase-js';
import { auditoriaWorker } from '../auditoriaWorkerService.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('[AuditoriaWorker Runner Error]: Variáveis VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias.');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl.trim(), serviceKey.trim(), {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const isOnce = process.argv.includes('--once') || process.env.WORKER_RUN_ONCE === 'true';

async function main() {
  if (isOnce) {
    console.log('[AuditoriaWorker Runner]: Executando lote único de processamento...');
    try {
      const processed = await auditoriaWorker.processPendingBatch(supabaseAdmin, 5);
      console.log(`[AuditoriaWorker Runner]: Lote concluído com sucesso. Documentos processados: ${processed}`);
      process.exit(0);
    } catch (err) {
      console.error('[AuditoriaWorker Runner Error]:', err && err.message ? err.message : err);
      process.exit(1);
    }
  } else {
    console.log('[AuditoriaWorker Runner]: Iniciando worker em modo daemon contínuo...');
    auditoriaWorker.start(supabaseAdmin, { intervalMs: 15000, batchSize: 5 });

    const handleShutdown = () => {
      console.log('\n[AuditoriaWorker Runner]: Sinal de interrupção recebido. Encerrando worker...');
      auditoriaWorker.stop();
      process.exit(0);
    };

    process.on('SIGINT', handleShutdown);
    process.on('SIGTERM', handleShutdown);
  }
}

main().catch((err) => {
  console.error('[AuditoriaWorker Fatal Error]:', err);
  process.exit(1);
});
