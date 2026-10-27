'use strict';
// Porte de teste_analise.py. Executar: node teste_analise.js
const assert = require('assert');
const { Maquina } = require('./analise');

// gerador pseudo-aleatorio deterministico (os cenarios nao dependem de sorte)
let seed = 1;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const uniform = (a, b) => a + (b - a) * rnd();

const T0 = 1_000_000.0;

function roda(titulo, intervalos, spm = 155, extraS = 1) {
  const m = new Maquina('teste', { spm });
  let t = T0;
  let proximoTick = T0 + 1;
  const alertas = [];
  for (const dt of intervalos) {
    t += dt;
    while (proximoTick <= t) {
      alertas.push(...m.tick(proximoTick)[0]);
      proximoTick += 1;
    }
    alertas.push(...m.batida(t)[1]);
  }
  const fim = t + extraS;
  while (proximoTick <= fim) {
    alertas.push(...m.tick(proximoTick)[0]);
    proximoTick += 1;
  }
  const s = m.snapshot(fim);
  console.log(`\n== ${titulo}`);
  console.log(`   status=${s.status} spm=${s.spm} variacao=${s.variacao}% total=${s.total} perdidas=${s.perdidas} duplas=${s.duplas}`);
  for (const a of alertas) console.log(`   [${a.nivel.padEnd(7)}] ${(a.t - T0).toFixed(1).padStart(6)}s  ${a.tipo}: ${a.msg}`);
  return [m, alertas];
}

const tipos = (alertas) => new Set(alertas.map((a) => a.tipo));
const T = 60 / 155;
const normal = (n, jit = 0.02) => Array.from({ length: n }, () => T * uniform(1 - jit, 1 + jit));
const tem = (alertas, ...ts) => ts.every((x) => tipos(alertas).has(x));

let [m, a] = roda('1) Normal 155/min por 1 minuto', normal(155));
assert.strictEqual(tipos(a).size, 0, [...tipos(a)].join());

[, a] = roda('2) Batida perdida no meio', [...normal(60), 2 * T, ...normal(60)]);
assert(tem(a, 'batida_perdida'));

[, a] = roda('3) Duplo disparo (ruido)', [...normal(60), 0.08, T - 0.08, ...normal(60)]);
assert(tem(a, 'batida_dupla'));

[, a] = roda('4) Ritmo caiu para ~120/min', [...normal(40), ...Array.from({ length: 80 }, () => 0.5 * uniform(0.98, 1.02))]);
assert(tem(a, 'ritmo_baixo'));

[, a] = roda('5) Ritmo alto ~190/min', Array.from({ length: 120 }, () => (60 / 190) * uniform(0.98, 1.02)));
assert(tem(a, 'ritmo_alto'));

[, a] = roda('6) Ritmo irregular', Array.from({ length: 120 }, () => T * uniform(0.6, 1.4)));
assert(tem(a, 'instavel'));

[, a] = roda('7) Varias batidas perdidas (falha)', [...normal(40), 2 * T, T, 2 * T, T, 3 * T, ...normal(40)]);
assert(tem(a, 'falhas_seguidas'));

[m, a] = roda('8) Parada e retomada', [...normal(60), 8.0, ...normal(30)], 155, 1);
assert(tem(a, 'parada', 'retomada'));

[m, a] = roda('9) Parou e nao voltou', normal(60), 155, 6);
assert(tem(a, 'parada') && m.snapshot(T0 + 999).status === 'parada');

[, a] = roda('10) Firmware antigo (delay 500) com programado 155', Array(60).fill(0.55));
assert(tem(a, 'ritmo_baixo'));

// 12) ruido: cada batida vem com rajada de pulsos 40..180 ms depois
m = new Maquina('teste', { spm: 155 });
let t = T0;
let alertas = [];
for (let i = 0; i < 60; i++) {
  t += T;
  m.batida(t);
  for (const extra of [0.04, 0.09, 0.13, 0.18]) alertas.push(...m.batida(t + extra)[1]);
}
const nRuido = alertas.filter((x) => x.tipo === 'batida_dupla').length;
assert(m.total === 60 && m.duplas === 240, `${m.total} ${m.duplas}`);
assert(nRuido <= 3, 'alerta de ruido deve ser agrupado');
console.log(`\n== 12) Rajadas de ruido: total=${m.total} (esperado 60), duplas filtradas=${m.duplas}, alertas=${nRuido}`);

// 11) batida chega logo depois de a parada ja ter sido declarada (lote atrasado)
m = new Maquina('teste', { spm: 155 });
t = T0;
for (let i = 0; i < 30; i++) {
  t += T;
  m.batida(t);
}
const [al] = m.tick(t + 3.1);
assert(al.some((x) => x.tipo === 'parada'));
m.batida(t + 2.95);
assert(!m.parada && m.status(t + 3.2) !== 'parada');
console.log('\n== 11) Lote atrasado apos alarme de parada: voltou a operar, status =', m.status(t + 3.2));

console.log('\nTudo certo: todos os cenarios foram detectados.');
