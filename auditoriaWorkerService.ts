import { indexDocument } from './auditoriaIndexService.ts';

export interface WorkerLoopOptions {
  intervalMs?: number;
  batchSize?: number;
  workerId?: string;
}

export class AuditoriaIndexingWorker {
  private isRunning: boolean = false;
  private intervalHandle: NodeJS.Timeout | null = null;
  private workerId: string;

  constructor(workerId?: string) {
    this.workerId = workerId || `worker_${process.pid}_${Math.random().toString(36).substring(2, 7)}`;
  }

  /**
   * Processa itens pendentes na fila do Supabase com trava atômica.
   */
  public async processPendingBatch(supabaseAdmin: any, batchSize: number = 5): Promise<number> {
    if (!supabaseAdmin) return 0;

    const nowStr = new Date().toISOString();
    const lockExpiryWindow = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    // 1. Recuperação de travas presas (Stuck Locks > 10 min)
    try {
      await supabaseAdmin
        .from('auditoria_documentos_status')
        .update({
          locked_at: null,
          locked_by: null,
          indexing_status: 'pending',
          updated_at: nowStr,
        })
        .eq('indexing_status', 'indexing')
        .lt('locked_at', lockExpiryWindow);
    } catch (err: any) {
      console.warn('[Worker] Erro ao destravar tarefas presas:', err?.message);
    }

    // 2. Busca itens pendentes com limite de tentativas (< 3)
    let pendingDocs: any[] = [];
    try {
      const { data, error } = await supabaseAdmin
        .from('auditoria_documentos_status')
        .select('*')
        .or('indexing_status.eq.pending,indexing_status.eq.erro_extracao')
        .lt('retry_count', 3)
        .is('locked_at', null)
        .order('created_at', { ascending: true })
        .limit(batchSize);

      if (error || !data) {
        return 0;
      }
      pendingDocs = data;
    } catch (err: any) {
      return 0;
    }

    if (pendingDocs.length === 0) return 0;

    let processedCount = 0;

    for (const doc of pendingDocs) {
      // Tenta adquirir trava atômica para o item
      const { data: lockedItem, error: lockErr } = await supabaseAdmin
        .from('auditoria_documentos_status')
        .update({
          locked_at: nowStr,
          locked_by: this.workerId,
          indexing_status: 'indexing',
          updated_at: nowStr,
        })
        .eq('document_id', doc.document_id)
        .is('locked_at', null)
        .select()
        .maybeSingle();

      if (lockErr || !lockedItem) {
        // Outra instância do worker já pegou o documento
        continue;
      }

      // Buscar buffer de PDF via auditoria_documentos / drive_file_id
      try {
        const { data: parentDoc } = await supabaseAdmin
          .from('auditoria_documentos')
          .select('pdf_buffer_base64, drive_file_id, drive_file_name, category, condo_id')
          .eq('id', doc.document_id)
          .maybeSingle();

        let pdfBuffer: Buffer | null = null;
        if (parentDoc?.pdf_buffer_base64) {
          pdfBuffer = Buffer.from(parentDoc.pdf_buffer_base64, 'base64');
        }

        if (!pdfBuffer) {
          // Registrar erro se não houver conteúdo
          await supabaseAdmin
            .from('auditoria_documentos_status')
            .update({
              indexing_status: 'erro_extracao',
              retry_count: (doc.retry_count || 0) + 1,
              last_error: 'Conteúdo do PDF não encontrado para indexação.',
              locked_at: null,
              locked_by: null,
              updated_at: new Date().toISOString(),
            })
            .eq('document_id', doc.document_id);
          continue;
        }

        const res = await indexDocument({
          condoId: doc.condo_id,
          documentId: doc.document_id,
          driveFileId: doc.drive_file_id,
          driveFileName: doc.drive_file_name,
          category: doc.category,
          pdfBuffer,
          supabaseAdmin,
        });

        if (res.ok) {
          processedCount++;
        } else {
          // Incrementar contagem de tentativas em caso de erro tratável
          await supabaseAdmin
            .from('auditoria_documentos_status')
            .update({
              retry_count: (doc.retry_count || 0) + 1,
              locked_at: null,
              locked_by: null,
              updated_at: new Date().toISOString(),
            })
            .eq('document_id', doc.document_id);
        }
      } catch (err: any) {
        console.error(`[Worker] Exceção ao processar documento ${doc.document_id}:`, err?.message);
        await supabaseAdmin
          .from('auditoria_documentos_status')
          .update({
            indexing_status: 'erro_extracao',
            retry_count: (doc.retry_count || 0) + 1,
            last_error: err?.message || 'Exceção não tratada no worker.',
            locked_at: null,
            locked_by: null,
            updated_at: new Date().toISOString(),
          })
          .eq('document_id', doc.document_id);
      }
    }

    return processedCount;
  }

  /**
   * Inicia o loop contínuo de escuta da fila do worker em segundo plano.
   */
  public start(supabaseAdmin: any, options: WorkerLoopOptions = {}): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const intervalMs = options.intervalMs || 15000;
    const batchSize = options.batchSize || 5;

    console.log(`[Worker ${this.workerId}] Serviço de indexação em segundo plano iniciado (Intervalo: ${intervalMs}ms).`);

    const tick = async () => {
      try {
        await this.processPendingBatch(supabaseAdmin, batchSize);
      } catch (err: any) {
        console.error(`[Worker ${this.workerId}] Erro no ciclo de execução:`, err?.message);
      }
    };

    void tick();
    this.intervalHandle = setInterval(() => {
      void tick();
    }, intervalMs);
  }

  /**
   * Interrompe o worker de forma graciosa.
   */
  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    console.log(`[Worker ${this.workerId}] Serviço de indexação interrompido.`);
  }
}

export const auditoriaWorker = new AuditoriaIndexingWorker();
