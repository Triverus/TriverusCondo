import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPdfTextByPages,
  chunkPageText,
  indexDocument,
  removeDocumentIndex,
  searchDocumentContent,
  readDocumentSection,
  getInMemoryIndexState,
} from '../auditoriaIndexService.ts';
import { ToolRegistry } from '../src/tools/registry.ts';
import '../auditoriaTools.ts';
import '../crmTools.ts';

// ----------------------------------------------------------------------------
// GERADOR DE HELPER PARA PDF DE TESTE CONTROLADO EM BUFFER
// ----------------------------------------------------------------------------
function createSimpleTestPdfBuffer(pagesText) {
  // Constrói estrutura PDF 1.4 básica com texto explícito por página
  const objList = [];
  objList.push('%PDF-1.4');
  objList.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');

  const pageObjRefs = pagesText.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objList.push(`2 0 obj\n<< /Type /Pages /Kids [ ${pageObjRefs} ] /Count ${pagesText.length} >>\nendobj`);
  objList.push('3 0 obj\n<< /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>\nendobj');

  let currentObjId = 4;
  for (let i = 0; i < pagesText.length; i++) {
    const text = pagesText[i];
    const streamContent = `BT /F1 12 Tf 50 700 Td (${text.replace(/[\(\)\\]/g, '\\$&')}) Tj ET`;
    const streamLen = streamContent.length;

    const contentObjId = currentObjId + 1;
    objList.push(
      `${currentObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjId} 0 R /Resources 3 0 R >>\nendobj`
    );
    objList.push(
      `${contentObjId} 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream\nendobj`
    );

    currentObjId += 2;
  }

  const pdfString = objList.join('\n') + '\n%%EOF';
  return Buffer.from(pdfString, 'utf-8');
}

// ----------------------------------------------------------------------------
// SUÍTE DE TESTES DE INDEXAÇÃO E BUSCA DOCUMENTAL DA TRIVERUS (ETAPA 3)
// ----------------------------------------------------------------------------

test('TRIVERUS — Indexação e Busca Inteligente em Documentos (Etapa 3)', async (t) => {
  // Limpa estado em memória antes dos testes
  const state = getInMemoryIndexState();
  state.indexMap.clear();
  state.statusMap.clear();

  // Mock de usuários para controle de segurança
  const validUser = {
    userId: 'user_active_123',
    isActive: true,
    isAdmin: false,
    userPermissions: { can_access_auditoria: true, can_manage_auditoria: true },
  };

  const unauthorizedUser = {
    userId: 'user_no_audit_456',
    isActive: true,
    isAdmin: false,
    userPermissions: { can_access_auditoria: false, can_manage_auditoria: false },
  };

  const inactiveUser = {
    userId: 'user_inactive_789',
    isActive: false,
    isAdmin: false,
    userPermissions: { can_access_auditoria: true },
  };

  // Mock de PDF controlado de 3 páginas
  const pdfBufferDocA = createSimpleTestPdfBuffer([
    'Regimento Interno do Condomínio Mirante das Pedras. Artigo 1: O horário de silêncio é das 22h às 07h.',
    'Artigo 2: O uso da piscina é restrito aos moradores. Demonstrativo financeiro das contas aprovado em assembleia.',
    'Artigo 3: A eleição do síndico exige quórum qualificado de 2/3 dos condôminos presentes em primeira convocação.',
  ]);

  const pdfBufferDocB = createSimpleTestPdfBuffer([
    'Convenção Coletiva do Condomínio Spazio Di Fiori. Cláusula de segurança e controle de acesso de visitantes.',
    'Demonstrativo financeiro de despesas trabalhistas e fundo de reserva aprovado em ata.',
  ]);

  const condoIdA = 'condo_mirante_111';
  const docIdA = 'doc_mirante_regimento_222';
  const condoIdB = 'condo_spazio_333';
  const docIdB = 'doc_spazio_convencao_444';

  await t.test('Cenário A: Informação localizada em um documento específico', async () => {
    const resIdx = await indexDocument({
      condoId: condoIdA,
      documentId: docIdA,
      driveFileId: 'drive_file_mirante_1',
      driveFileName: 'Regimento_Mirante_Pedras.pdf',
      category: 'regulamento_interno',
      pdfBuffer: pdfBufferDocA,
    });

    assert.equal(resIdx.ok, true);
    assert.equal(resIdx.status, 'indexed');
    assert.equal(resIdx.totalPages, 3);
    assert.ok(resIdx.totalChunks > 0);

    const searchRes = await searchDocumentContent(
      {
        condoId: condoIdA,
        query: 'horário de silêncio',
      },
      validUser
    );

    assert.equal(searchRes.ok, true);
    assert.ok(searchRes.total >= 1);
    const topResult = searchRes.results[0];
    assert.equal(topResult.documento_id, docIdA);
    assert.equal(topResult.pagina, 1);
    assert.ok(topResult.trecho_original.includes('22h às 07h'));
  });

  await t.test('Cenário B: Informação encontrada em vários documentos (busca multi-doc)', async () => {
    await indexDocument({
      condoId: condoIdB,
      documentId: docIdB,
      driveFileId: 'drive_file_spazio_2',
      driveFileName: 'Convencao_Spazio.pdf',
      category: 'convenção',
      pdfBuffer: pdfBufferDocB,
    });

    const searchRes = await searchDocumentContent(
      {
        query: 'financeiro',
      },
      validUser
    );

    assert.equal(searchRes.ok, true);
    assert.ok(searchRes.total >= 2);
    const docIds = searchRes.results.map((r) => r.documento_id);
    assert.ok(docIds.includes(docIdA));
    assert.ok(docIds.includes(docIdB));
  });

  await t.test('Cenário C: Busca sem correspondências (sem alucinações)', async () => {
    const searchRes = await searchDocumentContent(
      {
        query: 'termo_inexistente_xpto_9999',
      },
      validUser
    );

    assert.equal(searchRes.ok, true);
    assert.equal(searchRes.total, 0);
    assert.equal(searchRes.results.length, 0);
  });

  await t.test('Cenário D: Página e trecho corretos associados aos resultados', async () => {
    const sectionRes = await readDocumentSection(
      {
        documentId: docIdA,
        pageNumber: 3,
      },
      validUser
    );

    assert.equal(sectionRes.ok, true);
    assert.equal(sectionRes.pagina, 3);
    assert.ok(sectionRes.conteudo_pagina.includes('quórum qualificado de 2/3'));
    assert.equal(sectionRes.estado_indexacao, 'indexed');
  });

  await t.test('Cenário E: Documento alterado e índice atualizado (versão e re-indexação)', async () => {
    const updatedPdfBuffer = createSimpleTestPdfBuffer([
      'Regimento Atualizado Mirante das Pedras V2. Artigo 1: Novo horário de silêncio a partir das 23h.',
      'Artigo 2: Regulamento de animais domésticos alterado na assembleia geral.',
    ]);

    const resUpdate = await indexDocument({
      condoId: condoIdA,
      documentId: docIdA,
      driveFileId: 'drive_file_mirante_1',
      driveFileName: 'Regimento_Mirante_Pedras_V2.pdf',
      category: 'regulamento_interno',
      pdfBuffer: updatedPdfBuffer,
    });

    assert.equal(resUpdate.ok, true);
    assert.equal(resUpdate.version, 2);

    const searchRes = await searchDocumentContent(
      {
        documentId: docIdA,
        query: '23h',
      },
      validUser
    );

    assert.equal(searchRes.ok, true);
    assert.ok(searchRes.total >= 1);
    assert.equal(searchRes.results[0].versao_indice, 2);
    assert.ok(searchRes.results[0].trecho_original.includes('23h'));
  });

  await t.test('Cenário F: Documento desvinculado e resultado removido do índice', async () => {
    const removeRes = await removeDocumentIndex(docIdB);
    assert.equal(removeRes.ok, true);
    assert.ok(removeRes.removedChunks > 0);

    const searchRes = await searchDocumentContent(
      {
        documentId: docIdB,
        query: 'segurança',
      },
      validUser
    );

    assert.equal(searchRes.ok, true);
    assert.equal(searchRes.total, 0);
  });

  await t.test('Cenário G: Usuário sem permissão não acessa trechos indexados', async () => {
    const searchNoAudit = await searchDocumentContent(
      { query: 'horário' },
      unauthorizedUser
    );
    assert.equal(searchNoAudit.ok, false);
    assert.equal(searchNoAudit.error, 'permission_denied');

    const searchInactive = await searchDocumentContent(
      { query: 'horário' },
      inactiveUser
    );
    assert.equal(searchInactive.ok, false);
    assert.equal(searchInactive.error, 'inactive_user');

    const readNoAudit = await readDocumentSection(
      { documentId: docIdA, pageNumber: 1 },
      unauthorizedUser
    );
    assert.equal(readNoAudit.ok, false);
    assert.equal(readNoAudit.error, 'permission_denied');
  });

  await t.test('Cenário H: Validação de ferramentas no ToolRegistry e cruzamento CRM + Auditoria', async () => {
    const searchDocTool = ToolRegistry.getTool('search_document_content');
    const readSecTool = ToolRegistry.getTool('read_document_section');

    assert.ok(searchDocTool);
    assert.equal(searchDocTool.module, 'auditoria');
    assert.equal(searchDocTool.capabilityKey, 'auditoria');

    assert.ok(readSecTool);
    assert.equal(readSecTool.module, 'auditoria');

    // Execução da ferramenta via ToolRegistry
    const toolExecRes = await searchDocTool.execute(
      { query: 'silêncio', condoId: condoIdA },
      { userId: validUser.userId, isActive: true, isAdmin: false, userPermissions: validUser.userPermissions }
    );

    assert.equal(toolExecRes.ok, true);
    assert.ok(toolExecRes.total >= 1);
  });

  await t.test('Cenário I: PDFs não indexáveis recebem status adequado (sem camada de texto e tamanho excedido)', async () => {
    // 1. PDF Digitalizado sem texto
    const scannedPdfBuffer = Buffer.from('%PDF-1.4 %imagem escaneada sem texto fonte', 'utf-8');
    const scannedRes = await indexDocument({
      condoId: condoIdA,
      documentId: 'doc_scanned_999',
      driveFileId: 'drive_scanned_999',
      driveFileName: 'Estatuto_Escaneado.pdf',
      category: 'estatuto',
      pdfBuffer: scannedPdfBuffer,
    });

    assert.equal(scannedRes.ok, false);
    assert.equal(scannedRes.status, 'sem_camada_texto');
    assert.ok(scannedRes.message.includes('digitalizado'));

    // 2. PDF Excedendo 30MB
    const hugePdfBuffer = Buffer.alloc(31 * 1024 * 1024); // 31 MB
    const hugeRes = await indexDocument({
      condoId: condoIdA,
      documentId: 'doc_huge_888',
      driveFileId: 'drive_huge_888',
      driveFileName: 'Documento_31MB.pdf',
      category: 'auditoria_completa',
      pdfBuffer: hugePdfBuffer,
    });

    assert.equal(hugeRes.ok, false);
    assert.equal(hugeRes.status, 'tamanho_excedido');
    assert.ok(hugeRes.message.includes('30 MB'));
  });
});
