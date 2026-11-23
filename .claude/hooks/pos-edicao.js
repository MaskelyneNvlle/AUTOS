// Hook PostToolUse (Edit|Write): roda os testes puros do servidor quando um .js dele muda.
// Saida 2 + stderr devolve a falha ao Claude. Nao toca em rede nem em hardware.
const { spawnSync } = require('child_process');
const path = require('path');
let raw = '';
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => {
  let f = '';
  try { f = (JSON.parse(raw).tool_input || {}).file_path || ''; } catch { return; }
  const p = f.replace(/\/g, '/');
  if (!/\/servidor-node\/[^/]+\.js$/.test(p)) return;
  const dir = path.dirname(f);
  for (const t of ['teste_analise.js', 'teste_relatorio.js']) {
    const r = spawnSync('node', [t], { cwd: dir, encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0) {
      console.error(`Falha em ${t}:\n${(r.stdout || '') + (r.stderr || '')}`.slice(0, 3000));
      process.exit(2);
    }
  }
});
