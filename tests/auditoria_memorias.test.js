import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  prepareMemoryCreate,
  prepareMemoryUpdate,
  filterBatchEligibleMemories,
  groupMemoriesByDriveFile,
  executeBatchGroupLoop,
} from '../auditoriaMemoryService.js';
import { registerAuditoriaMemoryRoutes } from '../auditoriaMemoryRoutes.js';

describe('1. Testes de Unidade das Regras Canônicas e Isolamento de Falhas (auditoriaMemoryService)', () => {
  // 1.1 Cadastro com autoria autenticada e rejeição quando não houver usuário autenticado
  test('1.1 Cadastro exige obrigatoriamente usuário autenticado para autoria (rejeita se ausente)', () => {
    assert.throws(
      () =>
        prepareMemoryCreate({
          condoId: 'condo-1',
          currentUserId: null,
          category: 'financeira',
          label: 'Fundo de Reserva',
          fill_mode: 'manual',
          manual_value: '10%',
        }),
      /Usuário autenticado não identificado para autoria do cadastro/
    );

    assert.throws(
      () =>
        prepareMemoryCreate({
          condoId: 'condo-1',
          currentUserId: '   ',
          category: 'financeira',
          label: 'Fundo de Reserva',
          fill_mode: 'manual',
          manual_value: '10%',
        }),
      /Usuário autenticado não identificado para autoria do cadastro/
    );

    const mem = prepareMemoryCreate({
      condoId: 'condo-1',
      currentUserId: 'usr-autor-123',
      category: 'financeira',
      label: 'Fundo de Reserva',
      fill_mode: 'manual',
      manual_value: '10%',
    });

    assert.equal(mem.created_by, 'usr-autor-123');
    assert.equal(mem.manual_value, '10%');
    assert.equal(mem.status, 'result_available');
  });

  // 1.2 Validação estrita do fill_mode no cadastro e na atualização
  test('1.2 fill_mode: rejeita valores inválidos e mantém padrão se omitido no cadastro', () => {
    // Rejeição de valor inválido no cadastro
    assert.throws(
      () =>
        prepareMemoryCreate({
          condoId: 'condo-1',
          currentUserId: 'usr-1',
          category: 'financeira',
          label: 'Taxa',
          fill_mode: 'modo_invalido',
          instruction: 'instrucao',
          source_drive_file_id: 'pdf-1',
        }),
      /Modo de preenchimento inválido/
    );

    // Se omitido no cadastro, assume 'ai' por padrão
    const memPadrao = prepareMemoryCreate({
      condoId: 'condo-1',
      currentUserId: 'usr-1',
      category: 'financeira',
      label: 'Taxa',
      instruction: 'Localizar taxa',
      source_drive_file_id: 'pdf-1',
    });
    assert.equal(memPadrao.fill_mode, 'ai');

    // Rejeição de valor inválido na atualização
    assert.throws(
      () =>
        prepareMemoryUpdate(memPadrao, {
          fill_mode: 'automatic',
        }),
      /Modo de preenchimento inválido/
    );
  });

  // 1.3 Troca de PDF sem envio do nome ou do source_document_id antigo
  test('1.3 Troca de PDF não preserva nome nem source_document_id antigos se não forem enviados', () => {
    const existingAi = {
      id: 'mem-10',
      condo_id: 'condo-1',
      category: 'financeira',
      label: 'Conta de Água',
      fill_mode: 'ai',
      manual_value: null,
      instruction: 'Localizar valor da conta',
      source_drive_file_id: 'pdf-antigo-id',
      source_drive_file_name: 'conta_antiga.pdf',
      source_document_id: 'doc-antigo-uuid',
      source_file_modified_at: '2026-01-01T00:00:00Z',
      last_result: 'R$ 1.500,00',
      page_reference: 'Pág 1',
      status: 'result_available',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      created_by: 'usr-1',
    };

    const updates = prepareMemoryUpdate(existingAi, {
      source_drive_file_id: 'pdf-novo-id',
    });

    assert.equal(updates.source_drive_file_id, 'pdf-novo-id');
    assert.equal(updates.source_drive_file_name, null, 'Não deve preservar nome do PDF anterior');
    assert.equal(updates.source_document_id, null, 'Não deve preservar source_document_id do PDF anterior');
    assert.equal(updates.source_file_modified_at, null, 'Deve limpar data de modificação anterior');
    assert.equal(updates.status, 'outdated', 'Deve marcar como outdated já que o PDF mudou e havia resultado disponível');

    const updatesWithNewName = prepareMemoryUpdate(existingAi, {
      source_drive_file_id: 'pdf-novo-id',
      source_drive_file_name: 'conta_nova.pdf',
      source_document_id: 'doc-novo-uuid',
    });
    assert.equal(updatesWithNewName.source_drive_file_name, 'conta_nova.pdf');
    assert.equal(updatesWithNewName.source_document_id, 'doc-novo-uuid');
    assert.equal(updatesWithNewName.source_file_modified_at, null);
  });

  // 1.4 Limpeza de source_file_modified_at na troca de arquivo e na transição para Manual
  test('1.4 Limpeza de source_file_modified_at na troca de arquivo e na transição para Manual', () => {
    const existingAi = {
      id: 'mem-11',
      condo_id: 'condo-1',
      category: 'financeira',
      label: 'Despesa Ordinária',
      fill_mode: 'ai',
      manual_value: null,
      instruction: 'Encontrar despesa',
      source_drive_file_id: 'pdf-1',
      source_drive_file_name: 'balancete.pdf',
      source_document_id: 'doc-1',
      source_file_modified_at: '2026-05-10T12:00:00Z',
      status: 'result_available',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const updateTrocaArquivo = prepareMemoryUpdate(existingAi, {
      source_drive_file_id: 'pdf-2',
    });
    assert.equal(updateTrocaArquivo.source_file_modified_at, null);

    const updateTransicaoManual = prepareMemoryUpdate(existingAi, {
      fill_mode: 'manual',
      manual_value: 'R$ 5.000,00',
    });
    assert.equal(updateTransicaoManual.source_file_modified_at, null);
    assert.equal(updateTransicaoManual.source_drive_file_id, null);
    assert.equal(updateTransicaoManual.source_drive_file_name, null);
    assert.equal(updateTransicaoManual.source_document_id, null);
    assert.equal(updateTransicaoManual.instruction, null);
    assert.equal(updateTransicaoManual.status, 'result_available');
  });

  // 1.5 Preservação de resultado válido quando não houver alteração de instrução ou PDF
  test('1.5 Preservação de resultado válido e metadados quando não houver alteração de instrução ou PDF', () => {
    const existingAi = {
      id: 'mem-12',
      condo_id: 'condo-1',
      category: 'juridica',
      label: 'Nome do Síndico Eleito',
      fill_mode: 'ai',
      manual_value: null,
      instruction: 'Localizar nome do síndico',
      source_drive_file_id: 'pdf-ata-eleicao',
      source_drive_file_name: 'ata.pdf',
      source_document_id: 'doc-ata-1',
      source_file_modified_at: '2026-03-01T10:00:00Z',
      last_result: 'Carlos Eduardo',
      page_reference: 'Página 3',
      last_result_metadata: { found: true },
      status: 'result_available',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const updates = prepareMemoryUpdate(existingAi, {
      label: 'Nome Completo do Síndico Eleito',
    });

    assert.equal(updates.label, 'Nome Completo do Síndico Eleito');
    assert.equal(updates.fill_mode, 'ai');
    assert.equal(updates.source_drive_file_id, 'pdf-ata-eleicao');
    assert.equal(updates.source_drive_file_name, 'ata.pdf');
    assert.equal(updates.source_document_id, 'doc-ata-1');
    assert.equal(updates.source_file_modified_at, '2026-03-01T10:00:00Z');
    assert.equal(updates.status, undefined, 'Status não deve ser alterado em edição parcial de label');
    assert.equal(updates.last_result, undefined, 'Resultado existente deve ser preservado');
  });

  // 1.6 Isolamento de falhas por download de PDF em executeBatchGroupLoop
  test('1.6 Falha ao baixar um PDF: somente as memórias daquele documento são marcadas como falha e o próximo PDF continua', async () => {
    const memDoc1_A = { id: 'm1-a', label: 'Item 1A', instruction: 'inst', status: 'never_searched' };
    const memDoc1_B = { id: 'm1-b', label: 'Item 1B', instruction: 'inst', status: 'never_searched' };
    const memDoc2_A = { id: 'm2-a', label: 'Item 2A', instruction: 'inst', status: 'never_searched' };

    const groups = new Map();
    groups.set('pdf-com-falha-download', [memDoc1_A, memDoc1_B]);
    groups.set('pdf-com-sucesso', [memDoc2_A]);

    const result = await executeBatchGroupLoop({
      groups,
      cleanCategory: 'financeira',
      condoName: 'Condomínio Teste',
      fetchPdfBuffer: async (driveFileId) => {
        if (driveFileId === 'pdf-com-falha-download') {
          throw new Error('Falha no Google Drive (Download 404)');
        }
        return Buffer.from('%PDF-1.4 Mock');
      },
      extractBatch: async () => [{ id: 'm2-a', found: true, value: 'R$ 1.200,00' }],
      saveSuccessResult: async (mem, resItem) => ({ ...mem, status: 'result_available', last_result: resItem.value }),
      handleGroupFailure: async (mem, err) => ({ ...mem, status: 'failed', last_result: err.message }),
    });

    assert.equal(result.failedMemories.length, 2);
    assert.equal(result.failedMemories[0].id, 'm1-a');
    assert.equal(result.failedMemories[1].id, 'm1-b');

    // Documento 2 processado normalmente
    const successMem = result.updatedMemories.find((m) => m.id === 'm2-a');
    assert.ok(successMem);
    assert.equal(successMem.status, 'result_available');
    assert.equal(successMem.last_result, 'R$ 1.200,00');
  });

  // 1.7 Isolamento de falhas na chamada ao Gemini
  test('1.7 Falha na chamada ao Gemini: somente as memórias daquele documento são afetadas e outros documentos continuam', async () => {
    const memDoc1 = { id: 'm-gemini-fail', label: 'Item Gemini Fail', instruction: 'inst', status: 'never_searched', source_drive_file_name: 'doc_com_erro.pdf' };
    const memDoc2 = { id: 'm-gemini-ok', label: 'Item Gemini OK', instruction: 'inst', status: 'never_searched', source_drive_file_name: 'doc_com_sucesso.pdf' };

    const groups = new Map();
    groups.set('pdf-gemini-fail', [memDoc1]);
    groups.set('pdf-gemini-ok', [memDoc2]);

    const result = await executeBatchGroupLoop({
      groups,
      cleanCategory: 'financeira',
      condoName: 'Condomínio Teste',
      fetchPdfBuffer: async () => Buffer.from('%PDF-1.4 Mock'),
      extractBatch: async ({ fileName }) => {
        if (fileName === 'doc_com_erro.pdf') {
          throw new Error('Gemini API 503 Service Unavailable');
        }
        return [{ id: 'm-gemini-ok', found: true, value: 'Resultado OK' }];
      },
      saveSuccessResult: async (mem, resItem) => ({ ...mem, status: 'result_available', last_result: resItem.value }),
      handleGroupFailure: async (mem, err) => ({ ...mem, status: 'failed', last_result: err.message }),
    });

    assert.equal(result.failedMemories.length, 1);
    assert.equal(result.failedMemories[0].id, 'm-gemini-fail');
    assert.ok(result.failedMemories[0].error.includes('Gemini API 503'));
    const successMem = result.updatedMemories.find((m) => m.id === 'm-gemini-ok');
    assert.ok(successMem);
    assert.equal(successMem.status, 'result_available');
  });

  // 1.8 Isolamento quando o Gemini não retorna resultado para uma das memórias
  test('1.8 Gemini não retorna resultado para uma memória: tratada individualmente como falha sem invalidar as demais', async () => {
    const mem1 = { id: 'm-retornada', label: 'Item Encontrado', instruction: 'inst', status: 'never_searched' };
    const mem2 = { id: 'm-omitida', label: 'Item Omitido pelo Modelo', instruction: 'inst', status: 'never_searched' };

    const groups = new Map();
    groups.set('pdf-unico', [mem1, mem2]);

    const result = await executeBatchGroupLoop({
      groups,
      cleanCategory: 'financeira',
      condoName: 'Condomínio Teste',
      fetchPdfBuffer: async () => Buffer.from('%PDF-1.4 Mock'),
      extractBatch: async () => [
        // Apenas mem1 retorna do modelo, mem2 não é retornada
        { id: 'm-retornada', found: true, value: 'Valor Localizado' },
      ],
      saveSuccessResult: async (mem, resItem) => ({ ...mem, status: 'result_available', last_result: resItem.value }),
      handleGroupFailure: async (mem, err) => ({ ...mem, status: 'failed', last_result: err.message }),
    });

    // mem2 foi tratada como falha
    assert.equal(result.failedMemories.length, 1);
    assert.equal(result.failedMemories[0].id, 'm-omitida');
    assert.ok(result.failedMemories[0].error.includes('Resultado ausente'));

    // mem1 foi salva com sucesso normalmente
    const savedSuccess = result.updatedMemories.find((m) => m.id === 'm-retornada');
    assert.equal(savedSuccess.status, 'result_available');
    assert.equal(savedSuccess.last_result, 'Valor Localizado');
  });

  // 1.9 Isolamento de falhas de persistência: erro em uma memória não invalida memórias já persistidas com sucesso
  test('1.9 Falha ao persistir uma memória: não marca como falhas memórias já salvas com sucesso', async () => {
    const mem1 = { id: 'm-salva-ok', label: 'Primeira Memória', instruction: 'inst', status: 'never_searched' };
    const mem2 = { id: 'm-erro-persist', label: 'Segunda Memória', instruction: 'inst', status: 'never_searched' };
    const mem3 = { id: 'm-terceira-ok', label: 'Terceira Memória', instruction: 'inst', status: 'never_searched' };

    const groups = new Map();
    groups.set('pdf-teste', [mem1, mem2, mem3]);

    const result = await executeBatchGroupLoop({
      groups,
      cleanCategory: 'financeira',
      condoName: 'Condomínio Teste',
      fetchPdfBuffer: async () => Buffer.from('%PDF-1.4 Mock'),
      extractBatch: async () => [
        { id: 'm-salva-ok', found: true, value: 'Valor 1' },
        { id: 'm-erro-persist', found: true, value: 'Valor 2' },
        { id: 'm-terceira-ok', found: true, value: 'Valor 3' },
      ],
      saveSuccessResult: async (mem, resItem) => {
        if (mem.id === 'm-erro-persist') {
          throw new Error('Supabase DB timeout ao salvar mem-2');
        }
        return { ...mem, status: 'result_available', last_result: resItem.value };
      },
      handleGroupFailure: async (mem, err) => ({ ...mem, status: 'failed', last_result: err.message }),
    });

    // Somente mem2 falhou
    assert.equal(result.failedMemories.length, 1);
    assert.equal(result.failedMemories[0].id, 'm-erro-persist');

    // mem1 e mem3 foram salvas com sucesso!
    const m1 = result.updatedMemories.find((m) => m.id === 'm-salva-ok');
    const m3 = result.updatedMemories.find((m) => m.id === 'm-terceira-ok');
    assert.equal(m1.status, 'result_available');
    assert.equal(m3.status, 'result_available');
  });

  // 1.10 Resiliência a falha dupla: quando handleGroupFailure também falha ao persistir status de erro no banco
  test('1.10 Falha dupla: quando handleGroupFailure lança exceção ao tentar persistir status de erro, não interrompe os outros grupos e o próximo PDF é processado normalmente', async () => {
    const memGrupo1 = {
      id: 'mem-falha-dupla',
      label: 'Taxa Condominial Ordinária',
      instruction: 'Localizar valor da taxa ordinária',
      status: 'never_searched',
      source_drive_file_name: 'boleto_com_defeito.pdf',
    };
    const memGrupo2 = {
      id: 'mem-sucesso-posterior',
      label: 'Fundo de Reserva',
      instruction: 'Localizar percentual do fundo de reserva',
      status: 'never_searched',
      source_drive_file_name: 'convocacao_valida.pdf',
    };

    const groups = new Map();
    groups.set('pdf-grupo-1-erro-duplo', [memGrupo1]);
    groups.set('pdf-grupo-2-processamento-normal', [memGrupo2]);

    let handleGroupFailureCalled = false;
    let grupo2ProcessadoComSucesso = false;

    const result = await executeBatchGroupLoop({
      groups,
      cleanCategory: 'financeira',
      condoName: 'Condomínio Residencial Horizonte',
      fetchPdfBuffer: async (driveFileId) => {
        // 1. Um grupo de PDFs apresenta uma falha inicial (ex: falha de download no Google Drive)
        if (driveFileId === 'pdf-grupo-1-erro-duplo') {
          throw new Error('Falha no download do PDF do Google Drive (HTTP 500)');
        }
        return Buffer.from('%PDF-1.4 Mock Sucesso');
      },
      extractBatch: async ({ fileName }) => {
        if (fileName === 'convocacao_valida.pdf') {
          grupo2ProcessadoComSucesso = true;
          return [{ id: 'mem-sucesso-posterior', found: true, value: '5%' }];
        }
        return [];
      },
      saveSuccessResult: async (mem, resItem) => ({
        ...mem,
        status: 'result_available',
        last_result: resItem.value,
      }),
      handleGroupFailure: async (mem, err) => {
        if (mem.id === 'mem-falha-dupla') {
          handleGroupFailureCalled = true;
          // 2. A função handleGroupFailure também lança uma exceção (ex: falha de conexão/banco ao salvar status 'failed')
          throw new Error('Falha de conexão com o banco de dados Supabase ao persistir status de erro');
        }
        return { ...mem, status: 'failed', last_result: err.message };
      },
    });

    // 1 & 2. Comprova que o grupo 1 sofreu falha inicial e handleGroupFailure foi invocado e lançou exceção
    assert.strictEqual(handleGroupFailureCalled, true, 'handleGroupFailure deve ter sido invocado para a memória do grupo 1');

    // 3. Comprova que a segunda falha não interrompeu a execução dos demais grupos
    // 4. Comprova que o próximo PDF foi processado normalmente com sucesso
    assert.strictEqual(grupo2ProcessadoComSucesso, true, 'O próximo PDF deve ter sido extraído normalmente');
    const mem2Sucesso = result.updatedMemories.find((m) => m.id === 'mem-sucesso-posterior');
    assert.ok(mem2Sucesso, 'A memória do grupo 2 deve estar presente em updatedMemories');
    assert.strictEqual(mem2Sucesso.status, 'result_available');
    assert.strictEqual(mem2Sucesso.last_result, '5%');

    // 5. Comprova que o resultado final identifica corretamente a memória cuja falha não pôde ser registrada no banco
    assert.strictEqual(result.failedMemories.length, 1);
    assert.strictEqual(result.failedMemories[0].id, 'mem-falha-dupla');
    assert.ok(result.failedMemories[0].error.includes('Falha no download'));

    // A memória cuja falha não pôde ser gravada no banco NÃO deve estar presente em updatedMemories
    const mem1Atualizada = result.updatedMemories.find((m) => m.id === 'mem-falha-dupla');
    assert.strictEqual(mem1Atualizada, undefined, 'A memória cuja atualização de falha deu erro no DB não deve constar em updatedMemories');
  });
});

describe('2. Testes HTTP Reais Executando as Mesmas Rotas de Produção (auditoriaMemoryRoutes)', () => {
  let server;
  let port;
  let baseUrl;
  let simulatedDatabase = [];

  before(async () => {
    const app = express();
    app.use(express.json());

    // Middleware simulado de autenticação/autorização
    const testAuthMiddleware = (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de autorização não fornecido.' });
      }
      const token = authHeader.slice(7).trim();
      if (token === 'unauthenticated-token') {
        req.user = null;
      } else {
        req.user = { id: 'user-auth-uuid-42' };
      }
      next();
    };

    // Objeto mock do Supabase Client para os testes
    const mockSupabaseAdmin = {
      from: (tableName) => {
        return {
          select: (cols) => {
            let filterCondoId = null;
            let filterCategory = null;
            let filterId = null;

            const chain = {
              eq: (col, val) => {
                if (col === 'condo_id') filterCondoId = val;
                if (col === 'category') filterCategory = val;
                if (col === 'id') filterId = val;
                return chain;
              },
              order: () => chain,
              single: async () => {
                const found = simulatedDatabase.find((m) => {
                  if (filterCondoId && m.condo_id !== filterCondoId) return false;
                  if (filterId && m.id !== filterId) return false;
                  return true;
                });
                return { data: found || null, error: found ? null : { message: 'Not found' } };
              },
              maybeSingle: async () => {
                const found = simulatedDatabase.find((m) => {
                  if (filterCondoId && m.condo_id !== filterCondoId) return false;
                  if (filterId && m.id !== filterId) return false;
                  return true;
                });
                return { data: found || null, error: null };
              },
              then: (resolve) => {
                let list = simulatedDatabase;
                if (filterCondoId) list = list.filter((m) => m.condo_id === filterCondoId);
                if (filterCategory) list = list.filter((m) => m.category === filterCategory);
                resolve({ data: list, error: null });
              },
            };
            return chain;
          },
          insert: (records) => {
            const list = Array.isArray(records) ? records : [records];
            for (const r of list) {
              simulatedDatabase.push(r);
            }
            return {
              select: () => ({
                single: async () => ({ data: list[0], error: null }),
              }),
            };
          },
          update: (updates) => {
            let filterCondoId = null;
            let filterId = null;
            const chain = {
              eq: (col, val) => {
                if (col === 'condo_id') filterCondoId = val;
                if (col === 'id') filterId = val;
                return chain;
              },
              select: () => ({
                single: async () => {
                  const idx = simulatedDatabase.findIndex((m) => m.condo_id === filterCondoId && m.id === filterId);
                  if (idx >= 0) {
                    simulatedDatabase[idx] = { ...simulatedDatabase[idx], ...updates };
                    return { data: simulatedDatabase[idx], error: null };
                  }
                  return { data: null, error: { message: 'Not found' } };
                },
              }),
              then: (resolve) => {
                const idx = simulatedDatabase.findIndex((m) => m.condo_id === filterCondoId && m.id === filterId);
                if (idx >= 0) {
                  simulatedDatabase[idx] = { ...simulatedDatabase[idx], ...updates };
                }
                resolve({ error: null });
              },
            };
            return chain;
          },
          delete: () => {
            let filterCondoId = null;
            let filterId = null;
            const chain = {
              eq: (col, val) => {
                if (col === 'condo_id') filterCondoId = val;
                if (col === 'id') filterId = val;
                return chain;
              },
              then: (resolve) => {
                simulatedDatabase = simulatedDatabase.filter(
                  (m) => !(m.condo_id === filterCondoId && m.id === filterId)
                );
                resolve({ error: null });
              },
            };
            return chain;
          },
        };
      },
    };

    // Mock das extrações de IA
    const mockExecuteBatchExtraction = async ({ items }) => {
      return items.map((item) => ({
        id: item.id,
        found: true,
        value: `Resultado simulado para: ${item.label}`,
        page_reference: 'Página 1',
        confidence: 'alta',
      }));
    };

    const mockGetDriveFileStream = async () => {
      const buffer = Buffer.from('%PDF-1.4 Mocked Test PDF File');
      return {
        arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      };
    };

    // REGISTRO DOS ENDPOINTS REAIS utilizando a função canônica do módulo compartilhado auditoriaMemoryRoutes!
    registerAuditoriaMemoryRoutes(app, {
      requireAccess: testAuthMiddleware,
      requireManageAccess: testAuthMiddleware,
      getSupabaseAdmin: () => mockSupabaseAdmin,
      getDriveFileStream: mockGetDriveFileStream,
      executeBatchExtraction: mockExecuteBatchExtraction,
      saveFallbackMemory: (record) => simulatedDatabase.push(record),
      readFallbackMemories: () => simulatedDatabase,
      deleteFallbackMemory: (condoId, id) => {
        simulatedDatabase = simulatedDatabase.filter((m) => !(m.condo_id === condoId && m.id === id));
      },
      isTableMissingError: () => false,
    });

    // Iniciar servidor em porta efêmera aleatória
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('2.1 HTTP POST real: Retorna 401 se usuário não autenticado', async () => {
    const res = await fetch(`${baseUrl}/api/auditoria/condo/condo-100/memories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer unauthenticated-token',
      },
      body: JSON.stringify({
        category: 'financeira',
        label: 'Taxa Condominial',
        fill_mode: 'manual',
        manual_value: 'R$ 450,00',
      }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.ok(body.error.includes('Usuário autenticado não identificado'));
  });

  test('2.2 HTTP POST real: Cadastra com sucesso e carimba created_by do usuário autenticado', async () => {
    const res = await fetch(`${baseUrl}/api/auditoria/condo/condo-100/memories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-jwt-token',
      },
      body: JSON.stringify({
        category: 'financeira',
        label: 'Taxa Condominial',
        fill_mode: 'manual',
        manual_value: 'R$ 450,00',
        created_by: 'tentativa_de_forjar_usuario_hacker',
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.memory.created_by, 'user-auth-uuid-42', 'Deve ignorar valor do body e carimbar auth.user.id');
    assert.equal(body.memory.manual_value, 'R$ 450,00');
  });

  test('2.3 HTTP POST real: Rejeita com 400 fill_mode inválido', async () => {
    const res = await fetch(`${baseUrl}/api/auditoria/condo/condo-100/memories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-jwt-token',
      },
      body: JSON.stringify({
        category: 'financeira',
        label: 'Memória Teste',
        fill_mode: 'modo_invalido',
        manual_value: '123',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('Modo de preenchimento inválido'));
  });

  test('2.4 HTTP PUT real: Rejeita com 400 se transição para Manual não contiver manual_value', async () => {
    // Cadastrar memória IA
    const postRes = await fetch(`${baseUrl}/api/auditoria/condo/condo-100/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-jwt-token' },
      body: JSON.stringify({
        category: 'financeira',
        label: 'Multa por Atraso',
        fill_mode: 'ai',
        instruction: 'Qual percentual de multa?',
        source_drive_file_id: 'pdf-convencao',
      }),
    });
    const postBody = await postRes.json();
    const memId = postBody.memory.id;

    // Tentar transição para manual sem valor
    const putRes = await fetch(`${baseUrl}/api/auditoria/condo/condo-100/memories/${memId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-jwt-token' },
      body: JSON.stringify({
        fill_mode: 'manual',
        manual_value: '',
      }),
    });

    assert.equal(putRes.status, 400);
    const putBody = await putRes.json();
    assert.ok(putBody.error.includes('valor da informação é obrigatório'));
  });

  test('2.5 HTTP PUT real: Ao trocar PDF, limpa nome do PDF anterior e source_document_id', async () => {
    const postRes = await fetch(`${baseUrl}/api/auditoria/condo/condo-100/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-jwt-token' },
      body: JSON.stringify({
        category: 'financeira',
        label: 'Seguro Predial',
        fill_mode: 'ai',
        instruction: 'Valor da apólice?',
        source_drive_file_id: 'pdf-apolice-velha',
        source_drive_file_name: 'apolice_2025.pdf',
        source_document_id: 'doc-uuid-velho',
      }),
    });
    const postBody = await postRes.json();
    const memId = postBody.memory.id;

    const putRes = await fetch(`${baseUrl}/api/auditoria/condo/condo-100/memories/${memId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-jwt-token' },
      body: JSON.stringify({
        source_drive_file_id: 'pdf-apolice-nova',
      }),
    });

    assert.equal(putRes.status, 200);
    const putBody = await putRes.json();
    assert.equal(putBody.memory.source_drive_file_id, 'pdf-apolice-nova');
    assert.equal(putBody.memory.source_drive_file_name, null, 'Nome anterior não deve ser preservado');
    assert.equal(putBody.memory.source_document_id, null, 'Document ID anterior não deve ser preservado');
    assert.equal(putBody.memory.source_file_modified_at, null);
  });

  test('2.6 HTTP batch-execute real: Executa através de executeBatchGroupLoop e retorna resultados agrupados', async () => {
    // Cadastrar memória adicional
    await fetch(`${baseUrl}/api/auditoria/condo/condo-100/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-jwt-token' },
      body: JSON.stringify({
        category: 'financeira',
        label: 'Fundo Obras',
        fill_mode: 'ai',
        instruction: 'Valor do fundo?',
        source_drive_file_id: 'pdf-lote-drive-1',
      }),
    });

    const batchRes = await fetch(`${baseUrl}/api/auditoria/condo/condo-100/memories/batch-execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-jwt-token' },
      body: JSON.stringify({
        category: 'financeira',
      }),
    });

    assert.equal(batchRes.status, 200);
    const batchBody = await batchRes.json();
    assert.equal(batchBody.ok, true);
    assert.ok(batchBody.processed_count >= 1);
    assert.ok(batchBody.groups_count >= 1);
    assert.ok(Array.isArray(batchBody.updated_memories));
    assert.equal(batchBody.updated_memories[0].status, 'result_available');
  });
});
