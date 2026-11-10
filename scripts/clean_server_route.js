import fs from 'fs';

['server.ts', 'server.js'].forEach((file) => {
  let content = fs.readFileSync(file, 'utf8');

  const startMarker = "app.get('/api/auditoria/condo/:condoId/drive-folders'";
  const startIdx = content.indexOf(startMarker);
  const nextRouteMarker = "// 1.2. Consultar pastas do Drive vinculadas por fase";
  const endIdx = content.indexOf(nextRouteMarker, startIdx);

  if (startIdx > 0 && endIdx > startIdx) {
    const cleanRoute = `app.get('/api/auditoria/condo/:condoId/drive-folders', requireAuditoriaAccess('can_access_auditoria'), async (req, res) => {
  const { condoId } = req.params;
  const leadData = (req as any).condoLead;
  const condoName = leadData?.name;
  try {
    const reqFolderId = req.query.folderId ? String(req.query.folderId) : null;
    const result = await getFolderContentsAndBreadcrumb(condoName, reqFolderId);
    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        error: result.error || \`A pasta do condomínio "\${condoName}" não foi localizada no Google Drive central.\`,
        currentFolder: null,
        breadcrumb: [],
        subfolders: [],
        pdfs: [],
      });
    }
    return res.json(result);
  } catch (err: any) {
    console.error('[AUDITORIA_DRIVE_FOLDERS_ERROR]', err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Falha ao consultar pastas do Google Drive.',
      currentFolder: null,
      breadcrumb: [],
      subfolders: [],
      pdfs: [],
    });
  }
});\n\n`;

    content = content.slice(0, startIdx) + cleanRoute + content.slice(endIdx);
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Cleaned route block in ${file}!`);
  } else {
    console.warn(`Could not find route markers in ${file}`);
  }
});
