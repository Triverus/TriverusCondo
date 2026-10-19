import { loadEnv } from 'vite';

loadEnv('development', process.cwd(), '');

async function runRevocationDiagnostics() {
  console.log('================================================================');
  console.log('DIAGNÓSTICO ISOLADO: PROTOCOLO DE REVOGAÇÃO GOOGLE OAUTH 2.0');
  console.log('================================================================\n');

  // Teste 1: Envio correto via POST x-www-form-urlencoded com token sintético
  console.log('1. Testando endpoint oficial https://oauth2.googleapis.com/revoke com body formal...');
  const resSynthetic = await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: 'test_token_synthetic_12345' }).toString(),
  });

  const errDataSynthetic: any = await resSynthetic.json().catch(() => ({}));
  console.log('Resposta do Google para token sintético:', {
    httpStatus: resSynthetic.status,
    ok: resSynthetic.ok,
    body: errDataSynthetic,
  });

  const isInvalidTokenExpected = resSynthetic.status === 400 && errDataSynthetic?.error === 'invalid_token';
  console.log(`Resultado do Teste 1: ${isInvalidTokenExpected ? 'APROVADO (Google responde 400 invalid_token como esperado para credencial inexistente)' : 'FALHOU'}\n`);

  // Teste 2: Validação com payload vazio (sem parâmetro token)
  console.log('2. Testando endpoint com corpo vazio (sem token)...');
  const resEmpty = await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({}).toString(),
  });
  const errDataEmpty: any = await resEmpty.json().catch(() => ({}));
  console.log('Resposta do Google para corpo vazio:', {
    httpStatus: resEmpty.status,
    body: errDataEmpty,
  });
  const isInvalidRequestExpected = resEmpty.status === 400 && errDataEmpty?.error === 'invalid_request';
  console.log(`Resultado do Teste 2: ${isInvalidRequestExpected ? 'APROVADO (Google responde 400 invalid_request para parâmetro ausente)' : 'FALHOU'}\n`);

  console.log('================================================================');
  console.log('CONCLUSÕES DO DIAGNÓSTICO:');
  console.log('- O endpoint https://oauth2.googleapis.com/revoke requer POST x-www-form-urlencoded com o parâmetro "token".');
  console.log('- Para credenciais falsas ou já expiradas/revogadas, a resposta oficial do Google é HTTP 400 com "invalid_token".');
  console.log('- A priorização de refresh_token sobre access_token previne falhas causadas pela expiração de 1 hora do access_token.');
  console.log('================================================================');
}

runRevocationDiagnostics().catch(console.error);
