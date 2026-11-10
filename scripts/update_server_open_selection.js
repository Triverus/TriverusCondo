import fs from 'fs';

// ----------------------------------------------------------------------------
// 1. UPDATE server.ts
// ----------------------------------------------------------------------------
let serverTs = fs.readFileSync('server.ts', 'utf8');

// Add verifyFolderAccessibleInDrive to imports and exports
if (!serverTs.includes('verifyFolderAccessibleInDrive,')) {
  serverTs = serverTs.replace(
    '  getFolderContentsAndBreadcrumb,\n} from \'./googleDriveService.ts\';',
    '  getFolderContentsAndBreadcrumb,\n  verifyFolderAccessibleInDrive,\n} from \'./googleDriveService.ts\';'
  );
  serverTs = serverTs.replace(
    '  listAvailableFoldersForCondo,\n};',
    '  listAvailableFoldersForCondo,\n  getFolderContentsAndBreadcrumb,\n  verifyFolderAccessibleInDrive,\n};'
  );
}

const tsValidationSnippet = `  const cleanCategory = String(category).trim().toLowerCase();
  if (!cleanCategory || cleanCategory.length > 50 || !/^[a-z0-9_-]+$/.test(cleanCategory)) {
    return res.status(400).json({ error: 'Categoria documental inválida.' });
  }

  // Validar autorização real de acesso da pasta no Google Drive pela conta de serviço
  const accessCheck = await verifyFolderAccessibleInDrive(drive_folder_id);
  if (!accessCheck.accessible) {
    return res.status(400).json({ error: accessCheck.error || 'A pasta selecionada não está acessível no Google Drive.' });
  }
  const resolvedFolderName = accessCheck.folder?.name || String(drive_folder_name).trim();`;

const oldTsValidation = `  const cleanCategory = String(category).trim().toLowerCase();
  if (!cleanCategory || cleanCategory.length > 50 || !/^[a-z0-9_-]+$/.test(cleanCategory)) {
    return res.status(400).json({ error: 'Categoria documental inválida.' });
  }`;

if (!serverTs.includes('const accessCheck = await verifyFolderAccessibleInDrive')) {
  serverTs = serverTs.replace(oldTsValidation, tsValidationSnippet);
  serverTs = serverTs.replace('drive_folder_name: String(drive_folder_name).trim(),', 'drive_folder_name: resolvedFolderName,');
}

fs.writeFileSync('server.ts', serverTs, 'utf8');
console.log('server.ts updated with folder accessibility check!');


// ----------------------------------------------------------------------------
// 2. UPDATE server.js
// ----------------------------------------------------------------------------
let serverJs = fs.readFileSync('server.js', 'utf8');

if (!serverJs.includes('verifyFolderAccessibleInDrive,')) {
  serverJs = serverJs.replace(
    '  getFolderContentsAndBreadcrumb,\n} from \'./googleDriveService.js\';',
    '  getFolderContentsAndBreadcrumb,\n  verifyFolderAccessibleInDrive,\n} from \'./googleDriveService.js\';'
  );
  serverJs = serverJs.replace(
    '  listAvailableFoldersForCondo,\n};',
    '  listAvailableFoldersForCondo,\n  getFolderContentsAndBreadcrumb,\n  verifyFolderAccessibleInDrive,\n};'
  );
}

const jsValidationSnippet = `  const cleanCategory = String(category).trim().toLowerCase();
  if (!cleanCategory || cleanCategory.length > 50 || !/^[a-z0-9_-]+$/.test(cleanCategory)) {
    return res.status(400).json({ error: 'Categoria documental inválida.' });
  }

  // Validar autorização real de acesso da pasta no Google Drive pela conta de serviço
  const accessCheck = await verifyFolderAccessibleInDrive(drive_folder_id);
  if (!accessCheck.accessible) {
    return res.status(400).json({ error: accessCheck.error || 'A pasta selecionada não está acessível no Google Drive.' });
  }
  const resolvedFolderName = accessCheck.folder?.name || String(drive_folder_name).trim();`;

const oldJsValidation = `  const cleanCategory = String(category).trim().toLowerCase();
  if (!cleanCategory || cleanCategory.length > 50 || !/^[a-z0-9_-]+$/.test(cleanCategory)) {
    return res.status(400).json({ error: 'Categoria documental inválida.' });
  }`;

if (!serverJs.includes('const accessCheck = await verifyFolderAccessibleInDrive')) {
  serverJs = serverJs.replace(oldJsValidation, jsValidationSnippet);
  serverJs = serverJs.replace('drive_folder_name: String(drive_folder_name).trim(),', 'drive_folder_name: resolvedFolderName,');
}

fs.writeFileSync('server.js', serverJs, 'utf8');
console.log('server.js updated with folder accessibility check!');
