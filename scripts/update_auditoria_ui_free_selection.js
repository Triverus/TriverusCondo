import fs from 'fs';

let content = fs.readFileSync('src/components/AuditoriaModule.tsx', 'utf8');

// 1. Add selectedFolderPath state
if (!content.includes('selectedFolderPath')) {
  content = content.replace(
    'const [selectedFolderPdfCount, setSelectedFolderPdfCount] = useState<number | null>(null);',
    'const [selectedFolderPdfCount, setSelectedFolderPdfCount] = useState<number | null>(null);\n  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);'
  );
  console.log('Added selectedFolderPath state hook!');
}

// 2. Reset selectedFolderPath in handleOpenLinkFolderModal
content = content.replace(
  'setSelectedFolderPdfCount(null);\n    setLinkingFolderError(null);',
  'setSelectedFolderPdfCount(null);\n    setSelectedFolderPath(null);\n    setLinkingFolderError(null);'
);

// 3. Update current folder selection button to also save selectedFolderPath
const oldCurrentSelect = `setSelectedFolderId(currentFolderMeta.id);
                          setSelectedFolderName(currentFolderMeta.name);
                          setSelectedFolderPdfCount(currentFolderPdfs.length);`;

const newCurrentSelect = `setSelectedFolderId(currentFolderMeta.id);
                          setSelectedFolderName(currentFolderMeta.name);
                          setSelectedFolderPdfCount(currentFolderPdfs.length);
                          setSelectedFolderPath(folderBreadcrumb.map((b) => b.name).join(' / '));`;

content = content.replace(oldCurrentSelect, newCurrentSelect);

// 4. Update subfolder selection button to also save selectedFolderPath
const oldSubSelect = `setSelectedFolderId(sub.id);
                                      setSelectedFolderName(sub.name);
                                      setSelectedFolderPdfCount(sub.pdf_count ?? 0);`;

const newSubSelect = `setSelectedFolderId(sub.id);
                                      setSelectedFolderName(sub.name);
                                      setSelectedFolderPdfCount(sub.pdf_count ?? 0);
                                      setSelectedFolderPath(sub.path || [...folderBreadcrumb.map((b) => b.name), sub.name].join(' / '));`;

content = content.replace(oldSubSelect, newSubSelect);

// 5. Update empty state text
content = content.replace(
  'Não encontramos uma pasta com o nome <strong className="text-slate-200">"{selectedCondo.name}"</strong> dentro da pasta raiz autorizada do Google Drive.',
  'Não foi possível listar as pastas do Google Drive ou o local acessado não possui subpastas visíveis.'
);

// 6. Update footer to show name, path, and pdf count clearly
const oldFooter = `<div className="text-xs font-bold text-white truncate">
                    Selecionado: <span className={selectedFolderId ? "text-emerald-400 font-extrabold" : "text-slate-400 font-normal"}>
                      {selectedFolderName ? \`"\${selectedFolderName}"\` : 'Nenhuma pasta selecionada'}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 truncate mt-0.5">
                    {selectedFolderId
                      ? \`\${selectedFolderPdfCount ?? 0} PDF(s) diretos nesta pasta a vincular\`
                      : 'Clique em "Selecionar esta pasta" na pasta desejada'}
                  </div>`;

const newFooter = `<div className="text-xs font-bold text-white truncate">
                    Pasta selecionada: <span className={selectedFolderId ? "text-emerald-400 font-extrabold" : "text-slate-400 font-normal"}>
                      {selectedFolderName ? \`"\${selectedFolderName}"\` : 'Nenhuma pasta selecionada'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 truncate mt-0.5">
                    {selectedFolderId ? (
                      <span>
                        Caminho: <strong className="text-slate-200">{selectedFolderPath || selectedFolderName}</strong> · <strong className="text-emerald-400">{selectedFolderPdfCount ?? 0} PDF(s)</strong> diretamente contidos
                      </span>
                    ) : (
                      <span>Navegue pelas pastas e clique em "Selecionar" na pasta que deseja associar a esta fase</span>
                    )}
                  </div>`;

content = content.replace(oldFooter, newFooter);

fs.writeFileSync('src/components/AuditoriaModule.tsx', content, 'utf8');
console.log('AuditoriaModule.tsx updated cleanly!');
