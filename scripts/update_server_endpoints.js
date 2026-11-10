import fs from 'fs';

['server.ts', 'server.js'].forEach((file) => {
  let content = fs.readFileSync(file, 'utf8');

  // 1. Add getFolderContentsAndBreadcrumb to import & export blocks
  content = content.replace(
    '  listAvailableFoldersForCondo,',
    '  listAvailableFoldersForCondo,\n  getFolderContentsAndBreadcrumb,'
  );

  // 2. Update GET /api/auditoria/condo/:condoId/drive-folders endpoint
  const endpointMarker = `    const condoName = lead.name;
    const result = await listAvailableFoldersForCondo(condoName);
    return res.json(result);`;

  const newEndpoint = `    const condoName = lead.name;
    const reqFolderId = req.query.folderId ? String(req.query.folderId) : null;
    const result = await getFolderContentsAndBreadcrumb(condoName, reqFolderId);
    return res.json(result);`;

  if (content.includes(endpointMarker)) {
    content = content.replace(endpointMarker, newEndpoint);
    console.log(`Endpoint updated in ${file}!`);
  } else {
    // Try alternate formatting
    content = content.replace(
      /listAvailableFoldersForCondo\(condoName\);[\s\S]*?return res\.json\(result\);/,
      'req.query.folderId ? String(req.query.folderId) : null;\n    const result = await getFolderContentsAndBreadcrumb(condoName, reqFolderId);\n    return res.json(result);'
    );
    console.log(`Endpoint updated via regex in ${file}!`);
  }

  fs.writeFileSync(file, content, 'utf8');
});
