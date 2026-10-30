'use strict';
// Teste do calculo do relatorio parcial com dados sinteticos. Executar: node teste_relatorio.js
const assert = require('assert');
const { calcula, parseCsv, paraCsv } = require('./relatorio');

const pad = (n) => String(n).padStart(2, '0');
const hm = (s) => {
  const d = new Date(s * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const iso = (s) => hm(s).replace(' ', 'T') + ':' + pad(new Date(s * 1000).getSeconds());

// janela de 10 minutos alinhada ao minuto; maquina para entre o minuto 4 e o 6 (120 s) e volta
const T0 = Math.floor(Date.now() / 1000 / 60) * 60 - 600;
const prod = [];
for (let m = 0; m < 10; m++) {
  if (m === 4 || m === 5) continue; // sem batidas
  prod.push({ data_hora: hm(T0 + m * 60), maquina: 'prensa1', batidas: '155', perdidas: m === 2 ? '3' : '0', duplas: m === 7 ? '5' : '0', spm_programado: '155' });
}
const alarmes = [
  { data_hora: iso(T0 + 4 * 60 + 3), maquina: 'prensa1', nivel: 'falha', tipo: 'parada', mensagem: 'Máquina PAROU: sem batida há 3 s' },
  { data_hora: iso(T0 + 6 * 60), maquina: 'prensa1', nivel: 'info', tipo: 'retomada', mensagem: 'Máquina voltou a bater após 120 s parada' },
];

const r = calcula({ prod, alarmes, agora: T0 + 600, de: T0, spm: 155, tol: 10, paradaS: 3, vivo: null, paradaAtiva: false });
assert.strictEqual(r.vazio, false);
assert.strictEqual(r.producao.batidas, 8 * 155);
assert.strictEqual(r.producao.perdidas, 3);
assert.strictEqual(r.producao.duplas, 5);
assert.strictEqual(r.paradas.quantidade, 1);
assert.strictEqual(r.paradas.total, 120);
assert.strictEqual(r.tempos.operando, 480);
assert.strictEqual(r.indices.disponibilidade, 80);
assert.strictEqual(r.indices.desempenho, 100);
assert.strictEqual(r.indices.eficiencia, 80);
assert.strictEqual(r.veredito, 'atencao');
assert.strictEqual(r.serie.length, 11); // 10 minutos + o minuto atual
assert.strictEqual(r.alertasPorTipo.parada, 1);
console.log('ok: periodo com uma parada de 120 s -> disponibilidade 80%, desempenho 100%, eficiencia 80% (atencao)');

// parada em andamento (sem retomada) so conta se a maquina esta mesmo parada agora
const sem = alarmes.slice(0, 1);
const a1 = calcula({ prod: prod.slice(0, 4), alarmes: sem, agora: T0 + 600, de: T0, spm: 155, tol: 10, paradaS: 3, vivo: null, paradaAtiva: true });
assert.strictEqual(a1.paradas.quantidade, 1);
assert.strictEqual(a1.paradas.lista[0].emAndamento, true);
const a2 = calcula({ prod: prod.slice(0, 4), alarmes: sem, agora: T0 + 600, de: T0, spm: 155, tol: 10, paradaS: 3, vivo: null, paradaAtiva: false });
assert.strictEqual(a2.paradas.quantidade, 0);
console.log('ok: parada em andamento so entra quando a maquina esta parada agora');

// sem dados
assert.strictEqual(calcula({ prod: [], alarmes: [], agora: T0, de: T0 - 60, spm: 155, tol: 10, paradaS: 3 }).vazio, true);
// minuto em andamento sem nenhuma batida nao pode virar "dados"
assert.strictEqual(
  calcula({ prod: [], alarmes: [], agora: T0, de: T0 - 60, spm: 155, tol: 10, paradaS: 3, vivo: { minuto: T0, batidas: 0, perdidas: 0, duplas: 0 } }).vazio,
  true
);
console.log('ok: periodo sem dados devolve vazio');

// ritmo abaixo do programado reduz o desempenho
const lento = [];
for (let m = 0; m < 10; m++) lento.push({ data_hora: hm(T0 + m * 60), batidas: '120', perdidas: '0', duplas: '0', spm_programado: '155' });
const b = calcula({ prod: lento, alarmes: [], agora: T0 + 600, de: T0, spm: 155, tol: 10, paradaS: 3 });
assert.strictEqual(b.indices.disponibilidade, 100);
assert.ok(b.indices.desempenho > 77 && b.indices.desempenho < 78, b.indices.desempenho);
console.log('ok: 120/min com programado 155/min -> desempenho', b.indices.desempenho + '%');

// servidor desligado: minutos 0-1 com batidas, servidor volta no minuto 8 e trabalha nos minutos 8-9.
// Os 6 minutos sem servidor nao podem virar "tempo observado" (senao a disponibilidade despenca sem motivo)
const duas = [];
for (const m of [0, 1, 8, 9]) duas.push({ data_hora: hm(T0 + m * 60), batidas: '155', perdidas: '0', duplas: '0', spm_programado: '155' });
const reinicio = [{ data_hora: iso(T0 + 8 * 60), maquina: 'prensa1', nivel: 'info', tipo: 'servidor_iniciado', mensagem: 'Servidor iniciado' }];
const c = calcula({ prod: duas, alarmes: reinicio, agora: T0 + 600, de: T0, spm: 155, tol: 10, paradaS: 3 });
assert.strictEqual(c.periodo.foraDoAr, 6 * 60);
assert.strictEqual(c.periodo.observado, 4 * 60);
assert.strictEqual(c.indices.disponibilidade, 100);
assert.strictEqual(c.indices.desempenho, 100);
assert.strictEqual(c.alertasPorTipo.servidor_iniciado, undefined);
console.log('ok: tempo com o servidor desligado e descontado (6 min fora do ar -> observado 4 min, eficiencia 100%)');

// CSV com aspas e ponto e virgula
assert.deepStrictEqual(parseCsv('a;b\r\n"x;y";"z""w"\r\n'), [['a', 'b'], ['x;y', 'z"w']]);
assert.ok(paraCsv(r, 'prensa1').includes('eficiencia_pct;80'));
console.log('ok: leitura de CSV e exportacao do resumo');

console.log('\nTudo certo.');
