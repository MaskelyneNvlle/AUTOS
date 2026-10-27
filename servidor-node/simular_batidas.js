'use strict';
// Simulador da PLC32: publica no broker os mesmos topicos do firmware, em tempo real,
// para ver na dashboard como o sistema reage a cada situacao. Nao precisa da PLC.
//
//   node simular_batidas.js <cenario> [--host localhost] [--porta 1884] [--spm 155]
//   node simular_batidas.js lista
//
// Por padrao usa a porta 1884 (servidor de TESTE). Para a porta 1883 (servidor real) ha
// que passar --porta 1883, o que suja a contagem e os CSV de producao: evite.

const mqtt = require('mqtt');

const args = process.argv.slice(2);
const opt = (nome, padrao) => {
  const i = args.indexOf('--' + nome);
  return i > -1 && args[i + 1] ? args[i + 1] : padrao;
};
const cenario = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || 'lista';
const HOST = opt('host', 'localhost');
const PORTA = Number(opt('porta', 1884));
const SPM = Number(opt('spm', 155)); // ritmo "normal" simulado; deve ser igual ao programado na dashboard
const T = 60 / SPM;

const jit = (x, p = 0.02) => x * (1 + (Math.random() * 2 - 1) * p);
const uni = (a, b) => a + Math.random() * (b - a);

// Cada cenario devolve { descricao, esperado, eventos } onde eventos = [{t, tipo}] (t em segundos)
const CENARIOS = {
  normal: {
    descricao: 'Maquina no ritmo programado por ~25 s (65 batidas).',
    esperado: 'Banner "MEDINDO O RITMO..." e depois "OPERANDO NORMAL". Perdidas 0, duplas 0, nenhum alerta.',
    gera: (b) => { for (let i = 0; i < 65; i++) b(jit(T)); },
  },
  perdida: {
    descricao: 'Ritmo normal, uma batida some no meio (intervalo de 2x) e segue normal.',
    esperado: 'Alerta amarelo "1 batida(s) perdida(s)". Card "Batidas perdidas" = 1. Banner volta a OPERANDO NORMAL.',
    gera: (b) => { for (let i = 0; i < 30; i++) b(jit(T)); b(2 * T); for (let i = 0; i < 25; i++) b(jit(T)); },
  },
  dupla: {
    descricao: 'Ritmo normal e, em uma batida, um pulso extra 80 ms depois (repique/ruido do sensor).',
    esperado: 'Alerta amarelo "pulso(s) fora de ritmo". Card "Batidas duplas" = 1. O total NAO conta o pulso extra.',
    gera: (b, extra) => { for (let i = 0; i < 30; i++) b(jit(T)); b(jit(T)); extra(0.08); for (let i = 0; i < 25; i++) b(jit(T)); },
  },
  ruido: {
    descricao: 'Cada batida vem acompanhada de uma rajada de 4 pulsos (40 a 180 ms depois).',
    esperado: 'Total sobe so pelas batidas reais; "duplas" sobe muito (4 por batida) e os alertas de ruido aparecem agrupados (1 a cada 10 s).',
    gera: (b, extra) => { for (let i = 0; i < 40; i++) { b(jit(T)); [0.04, 0.09, 0.13, 0.18].forEach(extra); } },
  },
  ritmo_baixo: {
    descricao: 'Comeca normal e cai para ~120 batidas/min.',
    esperado: 'Apos ~10 s no ritmo novo: alerta "Ritmo baixo: ~120/min", banner ATENCAO (amarelo).',
    gera: (b) => { for (let i = 0; i < 25; i++) b(jit(T)); for (let i = 0; i < 70; i++) b(jit(0.5)); },
  },
  ritmo_alto: {
    descricao: 'Ritmo de ~190 batidas/min o tempo todo.',
    esperado: 'Apos ~10 s: alerta "Ritmo alto: ~190/min", banner ATENCAO (amarelo).',
    gera: (b) => { for (let i = 0; i < 100; i++) b(jit(60 / 190)); },
  },
  instavel: {
    descricao: 'Intervalos irregulares: repete o ciclo "curto (0,65x), normal, longo (1,35x)", com ritmo medio igual ao programado.',
    esperado: 'Alerta "Ritmo instavel: variacao ~29%". Card "Variacao do ritmo" acima de 25%. Banner ATENCAO. O ritmo medio em si continua dentro da faixa.',
    gera: (b) => { const ciclo = [0.65, 1, 1.35]; for (let i = 0; i < 100; i++) b(T * ciclo[i % 3]); },
  },
  falhas: {
    descricao: 'Varias batidas perdidas seguidas (falha).',
    esperado: 'Varios alertas de batida perdida e, ao chegar em 3 perdidas em 60 s, alerta vermelho "batidas perdidas em 60 s" e banner FALHA.',
    gera: (b) => { for (let i = 0; i < 40; i++) b(jit(T)); [2 * T, T, 2 * T, T, 3 * T].forEach((d) => b(d)); for (let i = 0; i < 30; i++) b(jit(T)); },
  },
  parada: {
    descricao: 'Maquina roda 15 s, para por 9 s e volta a bater.',
    esperado: 'Apos 3 s sem batida: alerta vermelho "Maquina PAROU" e banner MAQUINA PARADA. Quando volta: alerta verde "Maquina voltou a bater".',
    gera: (b) => { for (let i = 0; i < 40; i++) b(jit(T)); b(9); for (let i = 0; i < 40; i++) b(jit(T)); },
  },
  sem_comunicacao: {
    descricao: 'Maquina roda ~10 s e a placa some (nenhuma mensagem por 14 s).',
    esperado: 'Depois de ~10 s sem mensagens: banner SEM COMUNICACAO e a etiqueta "placa sem sinal ha N s". Nao e a mesma coisa que MAQUINA PARADA.',
    gera: (b) => { for (let i = 0; i < 26; i++) b(jit(T)); },
    silencioFinalS: 14,
    semHeartbeatNoFim: true,
  },
};

function monta(c) {
  const ev = [];
  let t = 1; // comeca 1 s depois de conectar
  const b = (dt) => {
    t += dt;
    ev.push({ t, tipo: 'batida' });
    ev.push({ t: t + 0.1, tipo: 'estado0' });
  };
  const extra = (dt) => ev.push({ t: t + dt, tipo: 'pulso' }); // pulso extra depois da ultima batida
  c.gera(b, extra);
  const fim = t + (c.silencioFinalS || 3);
  if (!c.semHeartbeatNoFim) for (let h = 0; h < fim; h += 5) ev.push({ t: h, tipo: 'heartbeat' });
  else for (let h = 0; h < t; h += 5) ev.push({ t: h, tipo: 'heartbeat' });
  ev.push({ t: fim, tipo: 'fim' });
  return ev.sort((x, y) => x.t - y.t);
}

function lista() {
  console.log('Cenarios disponiveis:\n');
  for (const [nome, c] of Object.entries(CENARIOS)) console.log(`  ${nome.padEnd(16)} ${c.descricao}`);
  console.log('\nUso: node simular_batidas.js <cenario> [--host localhost] [--porta 1884] [--spm 155]');
  console.log('     node simular_batidas.js tudo        (roda todos em sequencia, ~5 min)');
}

function roda(nome) {
  const c = CENARIOS[nome];
  return new Promise((resolve) => {
    const ev = monta(c);
    console.log(`\n=== ${nome}: ${c.descricao}`);
    console.log(`    Esperado: ${c.esperado}`);
    const cli = mqtt.connect(`mqtt://${HOST}:${PORTA}`, { clientId: 'simulador-plc', reconnectPeriod: 0 });
    cli.on('error', (e) => {
      console.error(`ERRO ao conectar em ${HOST}:${PORTA}: ${e.message}. O servidor de teste esta rodando?`);
      process.exit(1);
    });
    cli.on('connect', () => {
      const ini = Date.now();
      let n = 0;
      const prox = () => {
        const e = ev.shift();
        if (!e) return;
        const espera = ini + e.t * 1000 - Date.now();
        setTimeout(() => {
          if (e.tipo === 'batida') { cli.publish('prensa/sensor1/estado', '1'); cli.publish('prensa/sensor1/batida', '1'); n++; }
          else if (e.tipo === 'pulso') { cli.publish('prensa/sensor1/batida', '1'); }
          else if (e.tipo === 'estado0') cli.publish('prensa/sensor1/estado', '0');
          else if (e.tipo === 'heartbeat') cli.publish('prensa/heartbeat', 'ping');
          else if (e.tipo === 'fim') { console.log(`    Concluido: ${n} batidas publicadas.`); cli.end(false, resolve); return; }
          prox();
        }, Math.max(0, espera));
      };
      prox();
    });
  });
}

(async () => {
  if (cenario === 'lista' || (cenario !== 'tudo' && !CENARIOS[cenario])) {
    if (cenario !== 'lista') console.log(`Cenario desconhecido: "${cenario}"\n`);
    return lista();
  }
  const nomes = cenario === 'tudo' ? Object.keys(CENARIOS) : [cenario];
  for (const n of nomes) {
    await roda(n);
    if (nomes.length > 1) await new Promise((r) => setTimeout(r, 12000)); // deixa a dashboard "esfriar"
  }
  process.exit(0);
})();
