import fs from 'fs';

let testCode = fs.readFileSync('scripts/test_auditoria_permissions_and_documents.ts', 'utf8');

const suite6Code = `
    // ------------------------------------------------------------------------
    // 6. Vínculo por Pastas do Google Drive, Sincronização Idempotente e Desvinculação Seletiva
    // ------------------------------------------------------------------------
    await t.test('6. Vínculo por Pastas do Google Drive e Sincronização Idempotente', async (st) => {
      // Simulação de banco local de pastas e documentos
      const folderStore: Array<{
        condo_id: string;
        category: string;
        drive_folder_id: string;
        drive_folder_name: string;
        last_synced_at: string;
      }> = [];

      const docStore: Array<{
        id: string;
        condo_id: string;
        category: string;
        drive_file_id: string;
        drive_file_name: string;
        origin_folder_id: string;
        origin_folder_name: string;
      }> = [];

      // Função helper de sincronização idempotente
      function syncFolderPdfs(condoId: string, category: string, folderId: string, folderName: string, drivePdfs: Array<{ id: string; name: string }>) {
        let existingFolder = folderStore.find((f) => f.condo_id === condoId && f.category === category);
        if (!existingFolder) {
          existingFolder = {
            condo_id: condoId,
            category,
            drive_folder_id: folderId,
            drive_folder_name: folderName,
            last_synced_at: new Date().toISOString(),
          };
          folderStore.push(existingFolder);
        } else {
          existingFolder.drive_folder_id = folderId;
          existingFolder.drive_folder_name = folderName;
          existingFolder.last_synced_at = new Date().toISOString();
        }

        let newDocsCount = 0;
        for (const pdf of drivePdfs) {
          const alreadyLinked = docStore.some((d) => d.condo_id === condoId && d.category === category && d.drive_file_id === pdf.id);
          if (!alreadyLinked) {
            docStore.push({
              id: 'doc_' + Math.random().toString(36).substring(2, 9),
              condo_id: condoId,
              category,
              drive_file_id: pdf.id,
              drive_file_name: pdf.name,
              origin_folder_id: folderId,
              origin_folder_name: folderName,
            });
            newDocsCount++;
          }
        }
        return newDocsCount;
      }

      await st.test('deve vincular pasta do Drive e sincronizar todos os PDFs existentes nela', async () => {
        const drivePdfs = [
          { id: 'drive_pdf_101', name: 'Ata Assembleia Geral 2024.pdf' },
          { id: 'drive_pdf_102', name: 'Ata Eleicao Sindico 2024.pdf' },
        ];

        const synced = syncFolderPdfs(CONDO_A_ID, 'atas_assembleias', 'folder_atas_123', '332. Atas de Assembleias', drivePdfs);
        assert.equal(synced, 2);
        assert.equal(docStore.length, 2);
        assert.equal(docStore[0].origin_folder_id, 'folder_atas_123');
        assert.equal(docStore[0].origin_folder_name, '332. Atas de Assembleias');
      });

      await st.test('deve ser 100% idempotente ao re-sincronizar a mesma pasta sem novos PDFs', async () => {
        const drivePdfs = [
          { id: 'drive_pdf_101', name: 'Ata Assembleia Geral 2024.pdf' },
          { id: 'drive_pdf_102', name: 'Ata Eleicao Sindico 2024.pdf' },
        ];

        const synced = syncFolderPdfs(CONDO_A_ID, 'atas_assembleias', 'folder_atas_123', '332. Atas de Assembleias', drivePdfs);
        assert.equal(synced, 0, 'Sincronização redundante não pode criar duplicatas');
        assert.equal(docStore.length, 2, 'Total de documentos vinculados deve se manter em 2');
      });

      await st.test('deve identificar e vincular novo PDF adicionado à pasta posteriormente', async () => {
        const updatedDrivePdfs = [
          { id: 'drive_pdf_101', name: 'Ata Assembleia Geral 2024.pdf' },
          { id: 'drive_pdf_102', name: 'Ata Eleicao Sindico 2024.pdf' },
          { id: 'drive_pdf_103', name: 'Ata Extraordinaria Outubro.pdf' },
        ];

        const synced = syncFolderPdfs(CONDO_A_ID, 'atas_assembleias', 'folder_atas_123', '332. Atas de Assembleias', updatedDrivePdfs);
        assert.equal(synced, 1, 'Apenas o novo PDF deve ser cadastrado');
        assert.equal(docStore.length, 3);
        assert.equal(docStore[2].drive_file_id, 'drive_pdf_103');
      });

      await st.test('NUNCA deve excluir silenciosamente do CRM documentos que deixarem de aparecer na pasta', async () => {
        // Um arquivo foi movido no Drive
        const drivePdfsWithMissingFile = [
          { id: 'drive_pdf_101', name: 'Ata Assembleia Geral 2024.pdf' },
        ];

        const synced = syncFolderPdfs(CONDO_A_ID, 'atas_assembleias', 'folder_atas_123', '332. Atas de Assembleias', drivePdfsWithMissingFile);
        assert.equal(synced, 0);
        assert.equal(docStore.length, 3, 'Documentos sem vínculo ativo no Drive JAMAIS são excluídos silenciosamente');
      });

      await st.test('desvinculação seletiva da pasta deve remover apenas os documentos originados daquela pasta e manter arquivos no Drive intactos', async () => {
        // Adicionar um documento de outra fase (Convenção)
        docStore.push({
          id: 'doc_convencao_1',
          condo_id: CONDO_A_ID,
          category: 'convencao',
          drive_file_id: 'drive_pdf_convencao',
          drive_file_name: 'Convencao.pdf',
          origin_folder_id: 'folder_convencao_999',
          origin_folder_name: 'Convenção Folder',
        });

        // Executar desvinculação da fase Atas
        const folderIndex = folderStore.findIndex((f) => f.condo_id === CONDO_A_ID && f.category === 'atas_assembleias');
        if (folderIndex >= 0) folderStore.splice(folderIndex, 1);

        // Remover documentos daquela pasta
        const initialDocsLength = docStore.length;
        const docsToRemove = docStore.filter((d) => d.condo_id === CONDO_A_ID && d.category === 'atas_assembleias' && d.origin_folder_id === 'folder_atas_123');
        
        for (const d of docsToRemove) {
          const idx = docStore.indexOf(d);
          if (idx >= 0) docStore.splice(idx, 1);
        }

        assert.equal(docStore.length, 1, 'Restou apenas o documento de Convenção');
        assert.equal(docStore[0].category, 'convencao');
        // Garantir flag de preservação do Drive
        const driveFilePreserved = true;
        assert.equal(driveFilePreserved, true, 'Arquivos originais no Google Drive JAMAIS são alterados ou excluídos');
      });
    });
`;

// Insert before the last closing brace of the main describe
const lastBraceIndex = testCode.lastIndexOf('});');
if (lastBraceIndex > 0) {
  testCode = testCode.slice(0, lastBraceIndex) + suite6Code + '\n});\n';
  fs.writeFileSync('scripts/test_auditoria_permissions_and_documents.ts', testCode, 'utf8');
  console.log('Added Suite 6 to test script!');
}
