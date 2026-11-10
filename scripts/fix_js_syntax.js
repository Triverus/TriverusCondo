import fs from 'fs';
import { execSync } from 'child_process';

const jsFiles = ['server.js', 'googleDriveService.js', 'googleCalendarAuth.js', 'auditoriaAiService.js'];

jsFiles.forEach((file) => {
  if (!fs.existsSync(file)) return;
  let content = fs.readFileSync(file, 'utf8');

  // Fix (req as any).condoLead or similar TS casts
  content = content.replace(/\(req as any\)/g, 'req');
  content = content.replace(/\(res as any\)/g, 'res');
  content = content.replace(/\(err as any\)/g, 'err');

  // Fix catch (err: any) -> catch (err)
  content = content.replace(/catch\s*\(\s*([a-zA-Z0-9_$]+)\s*:\s*any\s*\)/g, 'catch ($1)');

  // Fix parameter type annotations in JS functions e.g. (param: string)
  content = content.replace(/\b([a-zA-Z0-9_$]+)\s*:\s*(string|number|boolean|any)\b(?!\s*[:?{,;])/g, '$1');

  fs.writeFileSync(file, content, 'utf8');

  try {
    execSync(`node --check ${file}`);
    console.log(`PASS: node --check ${file} passed cleanly!`);
  } catch (err) {
    console.error(`FAIL: node --check ${file} failed:`, err.message);
  }
});
