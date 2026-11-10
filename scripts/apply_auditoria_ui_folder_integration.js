import fs from 'fs';

let content = fs.readFileSync('src/components/AuditoriaModule.tsx', 'utf8');

// 1. Add state variables for folder integration
const stateAnchor = `  // Estados dos documentos vinculados (múltiplos documentos por categoria)
  const [linkedDocuments, setLinkedDocuments] = useState<Record<string, LinkedDocument[]>>({});
  const [otherDocuments, setOtherDocuments] = useState<LinkedDocument[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState<boolean>(false);`;

const newFolderStates = `  // Estados dos documentos vinculados (múltiplos documentos por categoria)
  const [linkedDocuments, setLinkedDocuments] = useState<Record<string, LinkedDocument[]>>({});
  const [otherDocuments, setOtherDocuments] = useState<LinkedDocument[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState<boolean>(false);

  // Estados dos vínculos de pasta por fase do Google Drive
  const [folderLinks, setFolderLinks] = useState<Record<string, FolderLink>>({});
  const [isFolderModalOpen, setIsFolderModalOpen] = useState<boolean>(false);
  const [activeFolderCategory, setActiveFolderCategory] = useState<string>('convencao');
  const [availableFolders, setAvailableFolders] = useState<AvailableFolder[]>([]);
  const [isLoadingAvailableFolders, setIsLoadingAvailableFolders] = useState<boolean>(false);
  const [availableFoldersError, setAvailableFoldersError] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [folderSearchTerm, setFolderSearchTerm] = useState<string>('');
  const [isLinkingFolder, setIsLinkingFolder] = useState<boolean>(false);
  const [linkingFolderError, setLinkingFolderError] = useState<string | null>(null);

  // Estado de sincronização em andamento por categoria
  const [syncingCategory, setSyncingCategory] = useState<string | null>(null);

  // Estados de confirmação para desvinculação de pasta
  const [folderToUnlink, setFolderToUnlink] = useState<{ category: string; folder: FolderLink } | null>(null);
  const [isConfirmUnlinkFolderOpen, setIsConfirmUnlinkFolderOpen] = useState<boolean>(false);
  const [isUnlinkingFolder, setIsUnlinkingFolder] = useState<boolean>(false);
  const [unlinkFolderError, setUnlinkFolderError] = useState<string | null>(null);`;

if (!content.includes('const [folderLinks, setFolderLinks]')) {
  content = content.replace(stateAnchor, newFolderStates);
  console.log('Folder states added!');
}

// 2. Enhance loadLinkedDocuments to also fetch folder-links
const loadDocsAnchor = `        setLinkedDocuments(map);
        setOtherDocuments(unmapped);
        if (data.persisted_definitively === false) {
          setContingencyWarning(
            data.warning || 'Migração SQL pendente no Supabase. Os vínculos estão em contingência local temporária.'
          );
        } else {
          setContingencyWarning(null);
        }
      }
    } catch (err) {
      console.warn('[Auditoria] Falha ao carregar documentos do condomínio:', err);
    } finally {
      setIsLoadingDocuments(false);
    }
  }, []);`;

const newLoadDocs = `        setLinkedDocuments(map);
        setOtherDocuments(unmapped);
        if (data.persisted_definitively === false) {
          setContingencyWarning(
            data.warning || 'Migração SQL pendente no Supabase. Os vínculos estão em contingência local temporária.'
          );
        } else {
          setContingencyWarning(null);
        }
      }

      // Carregar também vínculos de pasta por fase
      try {
        const foldersRes = await fetch(\`/api/auditoria/condo/\${condoId}/folder-links\`, {
          headers: token ? { Authorization: \`Bearer \${token}\` } : {},
        });
        if (foldersRes.ok) {
          const fData = await foldersRes.json();
          const fMap: Record<string, FolderLink> = {};
          (fData.folders || []).forEach((f: FolderLink) => {
            fMap[f.category] = f;
          });
          setFolderLinks(fMap);
        }
      } catch (fErr) {
        console.warn('[Auditoria] Falha ao carregar vínculos de pasta:', fErr);
      }
    } catch (err) {
      console.warn('[Auditoria] Falha ao carregar documentos do condomínio:', err);
    } finally {
      setIsLoadingDocuments(false);
    }
  }, []);`;

if (!content.includes('const foldersRes = await fetch')) {
  content = content.replace(loadDocsAnchor, newLoadDocs);
  console.log('loadLinkedDocuments updated with folder links!');
}

// 3. Add folder handlers right before fetchDriveFiles
const fetchDriveAnchor = `  // Buscar arquivos PDF no Drive para vincular
  const fetchDriveFiles = useCallback(async (condoId: string, condoName: string) => {`;

const folderHandlers = `  // Buscar pastas disponíveis no Drive para o condomínio
  const fetchAvailableFolders = useCallback(async (condoId: string) => {
    try {
      setIsLoadingAvailableFolders(true);
      setAvailableFoldersError(null);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(\`/api/auditoria/condo/\${condoId}/drive-folders\`, {
        headers: token ? { Authorization: \`Bearer \${token}\` } : {},
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.details || errData.error || 'Falha ao buscar pastas do condomínio no Google Drive');
      }

      const data = await res.json();
      setAvailableFolders(data.folders || []);
      if ((data.folders || []).length > 0) {
        setSelectedFolderId(data.folders[0].id);
      }
    } catch (err: any) {
      setAvailableFoldersError(err.message || 'Erro ao carregar pastas do Google Drive');
    } finally {
      setIsLoadingAvailableFolders(false);
    }
  }, []);

  // Abrir modal para vincular pasta a uma fase canônica
  const handleOpenLinkFolderModal = useCallback((category: string) => {
    if (!currentCondoId) return;
    setActiveFolderCategory(category);
    setSelectedFolderId(null);
    setLinkingFolderError(null);
    setFolderSearchTerm('');
    setIsFolderModalOpen(true);
    fetchAvailableFolders(currentCondoId);
  }, [currentCondoId, fetchAvailableFolders]);

  // Confirmar vínculo de pasta e sincronização automática idempotente dos PDFs
  const handleConfirmLinkFolder = useCallback(async () => {
    if (!currentCondoId || !selectedFolderId) return;
    const folder = availableFolders.find((f) => f.id === selectedFolderId);
    if (!folder) return;

    try {
      setIsLinkingFolder(true);
      setLinkingFolderError(null);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(\`/api/auditoria/condo/\${currentCondoId}/phases/\${activeFolderCategory}/link-folder\`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: \`Bearer \${token}\` } : {}),
        },
        body: JSON.stringify({
          drive_folder_id: folder.id,
          drive_folder_name: folder.name,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.details || errData.error || 'Falha ao vincular pasta da fase');
      }

      const resData = await res.json();
      await loadLinkedDocuments(currentCondoId);
      setIsFolderModalOpen(false);
      setFeedbackMessage(\`Pasta "\${folder.name}" vinculada com sucesso! \${resData.syncedCount || 0} PDFs sincronizados.\`);
      setTimeout(() => setFeedbackMessage(null), 5000);
    } catch (err: any) {
      setLinkingFolderError(err.message || 'Erro ao vincular pasta');
    } finally {
      setIsLinkingFolder(false);
    }
  }, [currentCondoId, selectedFolderId, availableFolders, activeFolderCategory, loadLinkedDocuments]);

  // Sincronizar PDFs da pasta vinculada à fase sob demanda (idempotente)
  const handleSyncFolder = useCallback(async (category: string) => {
    if (!currentCondoId) return;
    try {
      setSyncingCategory(category);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(\`/api/auditoria/condo/\${currentCondoId}/phases/\${category}/sync-folder\`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: \`Bearer \${token}\` } : {}),
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.details || errData.error || 'Falha ao sincronizar pasta');
      }

      const resData = await res.json();
      await loadLinkedDocuments(currentCondoId);
      const newCount = resData.syncedCount || 0;
      const totalCount = resData.totalPdfsInFolder || 0;
      setFeedbackMessage(\`Sincronização concluída: \${newCount} novos PDFs vinculados (\${totalCount} no total na pasta).\`);
      setTimeout(() => setFeedbackMessage(null), 5000);
    } catch (err: any) {
      setFeedbackMessage(\`Erro na sincronização: \${err.message}\`);
      setTimeout(() => setFeedbackMessage(null), 6000);
    } finally {
      setSyncingCategory(null);
    }
  }, [currentCondoId, loadLinkedDocuments]);

  // Solicitar desvinculação da pasta (abre modal de confirmação)
  const handleRequestUnlinkFolder = useCallback((category: string, folder: FolderLink) => {
    setFolderToUnlink({ category, folder });
    setUnlinkFolderError(null);
    setIsConfirmUnlinkFolderOpen(true);
  }, []);

  // Confirmar desvinculação seletiva da pasta (mantém arquivos intactos no Drive)
  const handleConfirmUnlinkFolder = useCallback(async () => {
    if (!currentCondoId || !folderToUnlink) return;
    try {
      setIsUnlinkingFolder(true);
      setUnlinkFolderError(null);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(\`/api/auditoria/condo/\${currentCondoId}/phases/\${folderToUnlink.category}/unlink-folder\`, {
        method: 'DELETE',
        headers: token ? { Authorization: \`Bearer \${token}\` } : {},
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.details || errData.error || 'Falha ao desvincular pasta');
      }

      await loadLinkedDocuments(currentCondoId);
      setIsConfirmUnlinkFolderOpen(false);
      setFolderToUnlink(null);
      setFeedbackMessage('Pasta e documentos desvinculados no CRM. Arquivos no Drive permanecem 100% intactos.');
      setTimeout(() => setFeedbackMessage(null), 5000);
    } catch (err: any) {
      setUnlinkFolderError(err.message || 'Erro ao desvincular pasta');
    } finally {
      setIsUnlinkingFolder(false);
    }
  }, [currentCondoId, folderToUnlink, loadLinkedDocuments]);

  // Buscar arquivos PDF no Drive para vincular`;

if (!content.includes('fetchAvailableFolders')) {
  content = content.replace(fetchDriveAnchor, folderHandlers);
  console.log('Folder handlers added!');
}

fs.writeFileSync('src/components/AuditoriaModule.tsx', content, 'utf8');
