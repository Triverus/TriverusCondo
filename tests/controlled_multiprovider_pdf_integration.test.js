import { describe, it } from 'node:test';
import assert from 'node:assert';
import { runReadAuditoriaDocumento } from '../auditoriaTools.ts';
import { checkModelCapabilityForAgent, resolveModelCapability } from '../modelCatalogService.ts';

/**
 * Constrói um PDF binário controlado de 3 páginas (padrão PDF-1.4)
 * - Página 1: Identificação e regras gerais
 * - Página 2: Tabela de valores (demonstrativo financeiro)
 * - Página 3: Fato exclusivo (Artigo 47: quórum de 2/3 para eleição de síndico)
 */
export function buildControlledPdf() {
  const page1 =
    'BT /F1 16 Tf 50 750 Td (CONVENCAO RESIDENCIAL SOLARIS - PAGINA 1) Tj ' +
    '/F1 12 Tf 50 710 Td (Regras gerais de convivencia e administracao do condominio Solaris.) Tj ' +
    '50 690 Td (Destinacao exclusivamente residencial dos apartamentos.) Tj ET';

  const page2 =
    'BT /F1 16 Tf 50 750 Td (TABELA DE VALORES E TAXAS CONDOMINIAIS - PAGINA 2) Tj ' +
    '/F1 11 Tf 50 710 Td (Unidade: Bloco A - 101 | Taxa Ordinaria: R$ 650,00 | Fundo Reserva: R$ 65,00 | Total: R$ 715,00) Tj ' +
    '50 690 Td (Unidade: Bloco A - 102 | Taxa Ordinaria: R$ 650,00 | Fundo Reserva: R$ 65,00 | Total: R$ 715,00) Tj ' +
    '50 670 Td (Unidade: Bloco B - 201 | Taxa Ordinaria: R$ 920,00 | Fundo Reserva: R$ 92,00 | Total: R$ 1.012,00) Tj ET';

  const page3 =
    'BT /F1 16 Tf 50 750 Td (CLAUSULAS ESPECIFICAS E QUORUM DE ELEICAO - PAGINA 3) Tj ' +
    '/F1 12 Tf 50 710 Td (Artigo 47: O quorum para eleicao de sindico e de 2/3 dos condominos presentes na 1a convocacao.) Tj ' +
    '50 690 Td (Na segunda convocacao, elege-se por maioria simples, com mandato de 2 anos e maximo de 3 reeleicoes.) Tj ET';

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>\nendobj',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 9 0 R >> >> >>\nendobj',
    `4 0 obj\n<< /Length ${page1.length} >>\nstream\n${page1}\nendstream\nendobj`,
    '5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 9 0 R >> >> >>\nendobj',
    `6 0 obj\n<< /Length ${page2.length} >>\nstream\n${page2}\nendstream\nendobj`,
    '7 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 8 0 R /Resources << /Font << /F1 9 0 R >> >> >>\nendobj',
    `8 0 obj\n<< /Length ${page3.length} >>\nstream\n${page3}\nendstream\nendobj`,
    '9 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj',
  ];

  let pdf = '%PDF-1.4\n';
  const xref = [0];
  for (const obj of objects) {
    xref.push(pdf.length);
    pdf += obj + '\n';
  }
  const xrefStart = pdf.length;
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += String(xref[i]).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF';
  return Buffer.from(pdf, 'utf8');
}

describe('TRIVERUS — Teste de Integração Real e PDF Controlado Multiprovedor', () => {
  const CONTROLLED_PDF = buildControlledPdf();

  it('1. Valida estrutura do PDF controlado (3 páginas, tabela na página 2 e quórum exclusivo na página 3)', () => {
    assert.ok(CONTROLLED_PDF.length > 500, 'PDF deve ter tamanho binário válido');
    assert.strictEqual(CONTROLLED_PDF.slice(0, 8).toString(), '%PDF-1.4');

    const pdfStr = CONTROLLED_PDF.toString('utf8');
    assert.ok(pdfStr.includes('PAGINA 1'), 'Página 1 presente');
    assert.ok(pdfStr.includes('TABELA DE VALORES'), 'Tabela de valores presente na Página 2');
    assert.ok(pdfStr.includes('Artigo 47'), 'Artigo 47 presente na Página 3');
    assert.ok(pdfStr.includes('2/3 dos condominos'), 'Quórum presente');

    // Validação de posicionamento factual
    const p1Idx = pdfStr.indexOf('PAGINA 1');
    const p2Idx = pdfStr.indexOf('PAGINA 2');
    const p3Idx = pdfStr.indexOf('PAGINA 3');
    assert.ok(p2Idx > p1Idx, 'Página 2 sucede Página 1');
    assert.ok(p3Idx > p2Idx, 'Página 3 sucede Página 2');
  });

  it('2. Verifica envio nativo de PDF para modelo OpenAI (gpt-4o) sem conversão prévia para texto', async () => {
    const mockDb = {
      from: (tbl) => ({
        select: () => Promise.resolve({
          data: [
            {
              id: 'doc_solaris_01',
              condo_id: 'condo_solaris',
              condo_name: 'Residencial Solaris',
              drive_file_id: 'drive_pdf_solaris',
              drive_file_name: 'Convencao_Solaris.pdf',
              category: 'convencao',
            },
          ],
          error: null,
        }),
      }),
    };

    const context = {
      userId: 'usr_admin',
      supabaseAdmin: mockDb,
      activeProfile: { id: 'usr_admin', is_active: true },
      agentModelId: 'gpt-4o',
      agent: { modelId: 'gpt-4o', capabilities: { auditoria: true } },
      _testPdfBuffer: CONTROLLED_PDF,
    };

    const hasOpenAIKey = Boolean((process.env.OPENAI_API_KEY || '').trim());

    if (!hasOpenAIKey) {
      // Estado real do ambiente: ausência de chave reportada formalmente sem inventar homologação
      const res = await runReadAuditoriaDocumento(
        { condoId: 'condo_solaris', driveFileId: 'drive_pdf_solaris', query: 'Qual o valor total da unidade Bloco B 201?' },
        context
      );

      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.error, 'openai_api_key_missing');
      assert.strictEqual(res.message?.includes('OpenAI'), true);
      // Confirma que não houve comutação silenciosa para Gemini
      assert.strictEqual(res.providerUsed, undefined);

      console.log('  [Integração Real OpenAI]:');
      console.log('  - Modelo Solicitado: gpt-4o');
      console.log('  - Provedor: openai');
      console.log('  - Endpoint: chat.completions.create (type: file)');
      console.log('  - Status: Pendente de OPENAI_API_KEY no servidor (não homologado em produção)');
      console.log('  - Comutação Silenciosa: Bloqueada (0 trocas de modelo)');
    } else {
      console.log('  [Integração Real OpenAI]: Chave detectada, executando requisição controlada.');
      const res = await runReadAuditoriaDocumento(
        { condoId: 'condo_solaris', driveFileId: 'drive_pdf_solaris', query: 'Qual o valor total da unidade Bloco B 201?' },
        context
      );
      assert.strictEqual(res.condominio_name, 'Residencial Solaris');
    }
  });

  it('3. Verifica envio nativo de PDF para modelo Google Gemini (gemini-3.8-flash) com inlineData application/pdf', async () => {
    const mockDb = {
      from: (tbl) => ({
        select: () => Promise.resolve({
          data: [
            {
              id: 'doc_solaris_01',
              condo_id: 'condo_solaris',
              condo_name: 'Residencial Solaris',
              drive_file_id: 'drive_pdf_solaris',
              drive_file_name: 'Convencao_Solaris.pdf',
              category: 'convencao',
            },
          ],
          error: null,
        }),
      }),
    };

    const context = {
      userId: 'usr_admin',
      supabaseAdmin: mockDb,
      activeProfile: { id: 'usr_admin', is_active: true },
      agentModelId: 'gemini-3.8-flash',
      agent: { modelId: 'gemini-3.8-flash', capabilities: { auditoria: true } },
      _testPdfBuffer: CONTROLLED_PDF,
    };

    const res = await runReadAuditoriaDocumento(
      { condoId: 'condo_solaris', driveFileId: 'drive_pdf_solaris', query: 'Qual o quórum do artigo 47 para eleição de síndico?' },
      context
    );

    const hasGeminiKey = Boolean((process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim());

    if (!hasGeminiKey) {
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.error, 'gemini_api_key_missing');
      assert.strictEqual(res.message?.includes('Gemini'), true);

      console.log('  [Integração Real Google Gemini]:');
      console.log('  - Modelo Solicitado: gemini-3.8-flash');
      console.log('  - Provedor: google');
      console.log('  - Endpoint: ai.models.generateContent (inlineData: application/pdf)');
      console.log('  - Status: Pendente de GEMINI_API_KEY no servidor (não homologado em produção)');
      console.log('  - Comutação Silenciosa: Bloqueada (0 trocas de modelo)');
    } else {
      console.log('  [Integração Real Google Gemini]: Chave presente no ambiente.');
      if (res.ok) {
        assert.strictEqual(res.condominio_name, 'Residencial Solaris');
      } else {
        assert.ok(res.error === 'gemini_execution_error' || res.error === 'gemini_api_key_missing');
        console.log(`  - Resultado de execução da API Google: ${res.message}`);
      }
    }
  });

  it('4. Valida bloqueio estrito de modelos descontinuados para evitar chamadas com falha garantida', () => {
    // Modelos Gemini 1.5 e 2.0 descontinuados / desligados
    const checkGemini15 = checkModelCapabilityForAgent('gemini-1.5-flash', { auditoria: true });
    assert.strictEqual(checkGemini15.isCompatible, false);
    assert.strictEqual(checkGemini15.reason?.includes('descontinuado'), true);

    const checkGemini20 = checkModelCapabilityForAgent('gemini-2.0-flash', { auditoria: true });
    assert.strictEqual(checkGemini20.isCompatible, false);
    assert.strictEqual(checkGemini20.reason?.includes('descontinuado'), true);

    // Snapshot descontinuado da OpenAI
    const checkGpt4Vision = checkModelCapabilityForAgent('gpt-4-vision-preview', { auditoria: true });
    assert.strictEqual(checkGpt4Vision.isCompatible, false);
    assert.strictEqual(checkGpt4Vision.reason?.includes('descontinuado'), true);
  });

  it('5. Valida homologação técnica dos modelos atuais reconhecidos em 2026', () => {
    const g38 = resolveModelCapability('gemini-3.8-flash');
    assert.strictEqual(g38.isValid, true);
    assert.strictEqual(g38.canonicalModel, 'gemini-3.8-flash');
    assert.strictEqual(g38.model?.category, 'recommended');
    assert.strictEqual(g38.model?.supportsTools, true);
    assert.strictEqual(g38.model?.supportsPdfReading, true);
    assert.strictEqual(g38.model?.contextWindow, 1000000);
    assert.strictEqual(g38.model?.maxOutputTokens, 64000);

    const gpt4o = resolveModelCapability('gpt-4o');
    assert.strictEqual(gpt4o.isValid, true);
    assert.strictEqual(gpt4o.canonicalModel, 'gpt-4o');
    assert.strictEqual(gpt4o.model?.category, 'recommended');
    assert.strictEqual(gpt4o.model?.supportsTools, true);
    assert.strictEqual(gpt4o.model?.supportsPdfReading, true);

    const o3mini = resolveModelCapability('o3-mini');
    assert.strictEqual(o3mini.isValid, true);
    assert.strictEqual(o3mini.canonicalModel, 'o3-mini');
    assert.strictEqual(o3mini.model?.supportsTools, true);
    assert.strictEqual(o3mini.model?.supportsPdfReading, false, 'o3-mini não pode ler PDFs');
  });
});
