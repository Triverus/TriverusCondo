import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Endpoint de saúde
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Arquivos estáticos gerados pelo Vite
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// Fallback SPA compatível com versões do Express
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(distPath, 'index.html'));
  }
  next();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
