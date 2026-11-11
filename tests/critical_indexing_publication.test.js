import test from 'node:test';
import assert from 'node:assert/strict';

// Mock transacional leve para simulação local do comportamento da stored procedure PostgreSQL
class MockSupabaseDatabase {
  constructor() {
    this.statusTable = new Map();
    this.indexTable = new Map();
  }

  seedDocument(docId, condoId, activeVer = 1, lockedBy = 'worker_alpha', lockedAt = new Date().toISOString(), reservedVer = activeVer + 1) {
    this.statusTable.set(docId, {
      document_id: docId,
      condo_id: condoId,
      indexing_status: lockedBy ? 'indexing' : 'indexed',
      active_version: activeVer,
      indexing_version: reservedVer,
      total_chunks: 10,
      locked_at: lockedAt,
      locked_by: lockedBy,
    });
  }

  seedChunks(docId, condoId, version, count, totalPages = 1) {
    for (let i = 0; i < count; i++) {
      const pageNumber = Math.min(i + 1, totalPages);
      const id = `chk_${docId}_v${version}_${i}`;
      this.indexTable.set(id, {
        id,
        document_id: docId,
        condo_id: condoId,
        indexing_version: version,
        page_number: pageNumber,
        chunk_index: i,
        content: `Trecho ${i} da versão ${version} página ${pageNumber}`,
      });
    }
  }

  // Simulação estrita do algoritmo da Stored Procedure PostgreSQL `publish_auditoria_document_index_version`
  publishVersionRpc(params) {
    const { p_document_id, p_condo_id, p_new_version, p_expected_chunks, p_expected_pages, p_expected_chars, p_worker_id } = params;

    const statusRec = this.statusTable.get(p_document_id);
    if (!statusRec || statusRec.condo_id !== p_condo_id) {
      return { ok: false, error: 'PUBLICATION_ERROR: Registro de status do documento não localizado.' };
    }

    if (!statusRec.locked_by || statusRec.locked_by !== p_worker_id) {
      return { ok: false, error: `PUBLICATION_ERROR: A trava da tarefa pertence a outro worker ou não foi adquirida. Solicitante: ${p_worker_id}, Gravado: ${statusRec.locked_by}` };
    }

    // Validação temporal da trava (10 minutos)
    if (!statusRec.locked_at) {
      return { ok: false, error: 'PUBLICATION_ERROR: A trava do worker expirou temporalmente.' };
    }
    const lockAgeMs = Date.now() - new Date(statusRec.locked_at).getTime();
    if (lockAgeMs > 10 * 60 * 1000) {
      return { ok: false, error: 'PUBLICATION_ERROR: A trava do worker expirou temporalmente (limite de 10 minutos).' };
    }

    if (statusRec.indexing_status !== 'indexing') {
      return { ok: false, error: `PUBLICATION_ERROR: O documento não está em estado de indexação ativo. Estado: ${statusRec.indexing_status}` };
    }

    // Validação da versão reservada
    if (p_new_version !== statusRec.indexing_version) {
      return { ok: false, error: `PUBLICATION_ERROR: A versão a publicar (${p_new_version}) diverge da versão reservada para processamento (${statusRec.indexing_version}).` };
    }

    if (p_new_version <= statusRec.active_version) {
      return { ok: false, error: `PUBLICATION_ERROR: Versão solicitada (${p_new_version}) deve ser maior que a versão ativa atual (${statusRec.active_version}).` };
    }

    if (p_expected_chunks <= 0) {
      return { ok: false, error: `PUBLICATION_ERROR: Quantidade esperada de trechos deve ser maior que zero. Recebido: ${p_expected_chunks}.` };
    }

    if (p_expected_pages <= 0) {
      return { ok: false, error: `PUBLICATION_ERROR: Quantidade esperada de páginas deve ser maior que zero. Recebido: ${p_expected_pages}.` };
    }

    const versionChunks = Array.from(this.indexTable.values()).filter(
      (c) => c.document_id === p_document_id && c.indexing_version === p_new_version
    );
    const actualChunks = versionChunks.length;

    if (actualChunks !== p_expected_chunks) {
      return { ok: false, error: `PUBLICATION_ERROR: Divergência na contagem de trechos. Esperados: ${p_expected_chunks}, Encontrados no banco: ${actualChunks}.` };
    }

    const distinctPages = new Set(versionChunks.map((c) => c.page_number)).size;
    if (distinctPages < p_expected_pages) {
      return { ok: false, error: `PUBLICATION_ERROR: Páginas incompletas no índice. Esperadas: ${p_expected_pages}, Páginas com trechos no banco: ${distinctPages}.` };
    }

    // Promoção atômica
    statusRec.active_version = p_new_version;
    statusRec.indexing_version = p_new_version;
    statusRec.indexing_status = 'indexed';
    statusRec.total_chunks = p_expected_chunks;
    statusRec.total_pages = p_expected_pages;
    statusRec.total_chars = p_expected_chars;
    statusRec.locked_at = null;
    statusRec.locked_by = null;
    statusRec.last_indexed_at = new Date().toISOString();

    // Limpeza de trechos antigos
    for (const [id, chunk] of Array.from(this.indexTable.entries())) {
      if (chunk.document_id === p_document_id && chunk.indexing_version < p_new_version) {
        this.indexTable.delete(id);
      }
    }

    return { ok: true };
  }
}

test('SUÍTE CRÍTICA TRIVERUS — Validação Estrita de Publicação e Segurança do Worker', async (t) => {
  await t.test('Cenário A: Tentativa de publicar versão sem trechos (0 trechos esperados) é bloqueada', () => {
    const db = new MockSupabaseDatabase();
    db.seedDocument('doc1', 'condo1', 1, 'worker_alpha');

    const res = db.publishVersionRpc({
      p_document_id: 'doc1',
      p_condo_id: 'condo1',
      p_new_version: 2,
      p_expected_chunks: 0,
      p_expected_pages: 1,
      p_expected_chars: 100,
      p_worker_id: 'worker_alpha',
    });

    assert.equal(res.ok, false);
    assert.match(res.error || '', /Quantidade esperada de trechos deve ser maior que zero/);
    assert.equal(db.statusTable.get('doc1').active_version, 1);
  });

  await t.test('Cenário B: Tentativa de publicar versão com contagem incompleta (espera 5, gravou 3) é bloqueada', () => {
    const db = new MockSupabaseDatabase();
    db.seedDocument('doc1', 'condo1', 1, 'worker_alpha');
    db.seedChunks('doc1', 'condo1', 2, 3); // Apenas 3 trechos salvos

    const res = db.publishVersionRpc({
      p_document_id: 'doc1',
      p_condo_id: 'condo1',
      p_new_version: 2,
      p_expected_chunks: 5, // Espera 5
      p_expected_pages: 1,
      p_expected_chars: 500,
      p_worker_id: 'worker_alpha',
    });

    assert.equal(res.ok, false);
    assert.match(res.error || '', /Divergência na contagem de trechos/);
    assert.equal(db.statusTable.get('doc1').active_version, 1);
  });

  await t.test('Cenário C: Tentativa de publicar versão antiga ou igual (v1 <= v1) é bloqueada', () => {
    const db = new MockSupabaseDatabase();
    db.seedDocument('doc1', 'condo1', 2, 'worker_alpha', new Date().toISOString(), 1);
    db.seedChunks('doc1', 'condo1', 1, 4);

    const res = db.publishVersionRpc({
      p_document_id: 'doc1',
      p_condo_id: 'condo1',
      p_new_version: 1, // Tenta publicar versão 1 sendo que a versão ativa já é 2
      p_expected_chunks: 4,
      p_expected_pages: 1,
      p_expected_chars: 400,
      p_worker_id: 'worker_alpha',
    });

    assert.equal(res.ok, false);
    assert.match(res.error || '', /Versão solicitada \(1\) deve ser maior que a versão ativa atual \(2\)/);
    assert.equal(db.statusTable.get('doc1').active_version, 2);
  });

  await t.test('Cenário D: Worker perde a trava (worker_beta assumiu) e worker_alpha tenta publicar -> bloqueado', () => {
    const db = new MockSupabaseDatabase();
    db.seedDocument('doc1', 'condo1', 1, 'worker_beta'); // Trava mudou para worker_beta
    db.seedChunks('doc1', 'condo1', 2, 5);

    const res = db.publishVersionRpc({
      p_document_id: 'doc1',
      p_condo_id: 'condo1',
      p_new_version: 2,
      p_expected_chunks: 5,
      p_expected_pages: 1,
      p_expected_chars: 500,
      p_worker_id: 'worker_alpha', // worker_alpha tenta publicar
    });

    assert.equal(res.ok, false);
    assert.match(res.error || '', /A trava da tarefa pertence a outro worker/);
    assert.equal(db.statusTable.get('doc1').active_version, 1);
  });

  await t.test('Cenário E: Dois workers tentam publicar simultaneamente -> apenas o proprietário legítimo conclui', () => {
    const db = new MockSupabaseDatabase();
    db.seedDocument('doc1', 'condo1', 1, 'worker_legitimo');
    db.seedChunks('doc1', 'condo1', 2, 5);

    // Tentativa do worker ilegítimo
    const resIntruso = db.publishVersionRpc({
      p_document_id: 'doc1',
      p_condo_id: 'condo1',
      p_new_version: 2,
      p_expected_chunks: 5,
      p_expected_pages: 1,
      p_expected_chars: 500,
      p_worker_id: 'worker_impostor',
    });
    assert.equal(resIntruso.ok, false);

    // Tentativa do worker legítimo
    const resLegitimo = db.publishVersionRpc({
      p_document_id: 'doc1',
      p_condo_id: 'condo1',
      p_new_version: 2,
      p_expected_chunks: 5,
      p_expected_pages: 1,
      p_expected_chars: 500,
      p_worker_id: 'worker_legitimo',
    });
    assert.equal(resLegitimo.ok, true);
    assert.equal(db.statusTable.get('doc1').active_version, 2);
  });

  await t.test('Cenário F: Falha na publicação mantém a versão anterior ativa integralmente disponível', () => {
    const db = new MockSupabaseDatabase();
    db.seedDocument('doc1', 'condo1', 1, 'worker_alpha');
    db.seedChunks('doc1', 'condo1', 1, 4); // Chunks da v1
    db.seedChunks('doc1', 'condo1', 2, 2); // Chunks incompletos da v2

    const res = db.publishVersionRpc({
      p_document_id: 'doc1',
      p_condo_id: 'condo1',
      p_new_version: 2,
      p_expected_chunks: 5, // Erro provocado: espera 5, encontrou 2
      p_expected_pages: 1,
      p_expected_chars: 500,
      p_worker_id: 'worker_alpha',
    });

    assert.equal(res.ok, false);
    // Versão ativa permanece v1 e chunks da v1 continuam intactos
    assert.equal(db.statusTable.get('doc1').active_version, 1);
    const v1Chunks = Array.from(db.indexTable.values()).filter((c) => c.document_id === 'doc1' && c.indexing_version === 1);
    assert.equal(v1Chunks.length, 4);
  });

  await t.test('Cenário G: Worker com trava expirada temporalmente (>10 min) é impedido de publicar', () => {
    const db = new MockSupabaseDatabase();
    // Trava de 15 minutos atrás
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    db.seedDocument('doc1', 'condo1', 1, 'worker_lento', fifteenMinutesAgo, 2);
    db.seedChunks('doc1', 'condo1', 2, 5);

    const res = db.publishVersionRpc({
      p_document_id: 'doc1',
      p_condo_id: 'condo1',
      p_new_version: 2,
      p_expected_chunks: 5,
      p_expected_pages: 1,
      p_expected_chars: 500,
      p_worker_id: 'worker_lento',
    });

    assert.equal(res.ok, false);
    assert.match(res.error || '', /trava do worker expirou temporalmente/);
    assert.equal(db.statusTable.get('doc1').active_version, 1);
  });

  await t.test('Cenário H: Publicação com versão divergente da versão reservada no status é bloqueada', () => {
    const db = new MockSupabaseDatabase();
    // Documento reservado para versão 3
    db.seedDocument('doc1', 'condo1', 1, 'worker_alpha', new Date().toISOString(), 3);
    db.seedChunks('doc1', 'condo1', 2, 5);

    const res = db.publishVersionRpc({
      p_document_id: 'doc1',
      p_condo_id: 'condo1',
      p_new_version: 2, // Tenta publicar v2 mas o status reservou v3
      p_expected_chunks: 5,
      p_expected_pages: 1,
      p_expected_chars: 500,
      p_worker_id: 'worker_alpha',
    });

    assert.equal(res.ok, false);
    assert.match(res.error || '', /diverge da versão reservada para processamento/);
    assert.equal(db.statusTable.get('doc1').active_version, 1);
  });

  await t.test('Cenário I: Incompletude estrutural de páginas (espera 3 páginas, banco só possui 2) é bloqueada', () => {
    const db = new MockSupabaseDatabase();
    db.seedDocument('doc1', 'condo1', 1, 'worker_alpha', new Date().toISOString(), 2);
    // Salva 4 trechos, mas apenas cobrindo 2 páginas (p1 e p2)
    db.seedChunks('doc1', 'condo1', 2, 4, 2);

    const res = db.publishVersionRpc({
      p_document_id: 'doc1',
      p_condo_id: 'condo1',
      p_new_version: 2,
      p_expected_chunks: 4,
      p_expected_pages: 3, // Espera 3 páginas completas
      p_expected_chars: 400,
      p_worker_id: 'worker_alpha',
    });

    assert.equal(res.ok, false);
    assert.match(res.error || '', /Páginas incompletas no índice/);
    assert.equal(db.statusTable.get('doc1').active_version, 1);
  });
});
