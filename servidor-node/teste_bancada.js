'use strict';
// Roteiro guiado do TESTE A de bancada: sensor NPN real ligado na PLC32 (borne I34 / GPIO34).
// Diferente de simular_batidas.js (que finge ser a PLC), aqui quem gera as batidas e voce, com o sensor.
// O roteiro le o que a PLC32 realmente enviou (via servidor), confere os criterios e mostra tudo na
// dashboard de teste (faixa "TESTE DE BANCADA": passo atual, contagem, criterios e resultado).
//
//   1) pare o servidor normal e inicie o de teste:   node server.js --teste
//   2) abra http://localhost:8085 (deve aparecer "MODO TESTE")
//   3) rode um roteiro:   node teste_bancada.js sinal        (ou contagem, ritmo, repique, tudo)
//
// Opcoes: --n 10 (contagem)  --tempo 30 (segundos do ritmo/repique)  --porta 8085  --host localhost
//         --dados <pasta>    --forcar (permite rodar fora do modo teste: NAO recomendado)

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (n, p) => {
  const i = args.indexOf('--' + n);
  return i > -1 && args[i + 1] ? args[i + 1] : p;
};
const nome = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || 'lista';
const HOST = opt('host', 'localhost');
const MAQ = opt('maquina', null); // maquina a testar (padrao: a primeira cadastrada)
const PORTA = opt('porta', '8085');
const N = Number(opt('n', 10));
const TEMPO = Number(opt('tempo', nome === 'ritmo' ? 60 : 30));
const DADOS = path.resolve(opt('dados', path.join(__dirname, 'dados_teste')));
const BASE = `http://${HOST}:${PORTA}`;
const FORCAR = args.includes('--forcar');

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const rot = (e) => (e === '1' ? 'nível 1 (HIGH)' : e === '0' ? 'nível 0 (LOW)' : 'desconhecido');
const crit = (texto, estado) => ({ texto, estado }); // estado: ok | falha | info | pend

async function le() {
  const j = await (await fetch(BASE + '/api/state')).json();
  const id = MAQ || Object.keys(j.maquinas)[0];
  if (!j.maquinas[id]) throw new Error('maquina nao encontrada: ' + id);
  return { m: j.maquinas[id], modo: j.modo_teste };
}
async function envia(o) {
  try {
    await fetch(BASE + '/api/teste', { method: 'POST', body: JSON.stringify(o) });
  } catch (_) {
    /* a dashboard e so um espelho: o roteiro continua mesmo assim */
  }
}

const ctx = { m: null, passoN: 0, passoTotal: 0, criterios: [] };

// Um passo do roteiro: instrucao, tempo, e (opcional) condicao para terminar antes. Atualiza a dashboard ~1x/s.
async function passo({ texto, seg, ate, aoVivo }) {
  ctx.passoN++;
  console.log(`\n>> PASSO ${ctx.passoN}/${ctx.passoTotal}: ${texto}`);
  const t0 = Date.now();
  let ultimoEnvio = 0;
  let ultimoExtra = '';
  for (;;) {
    const { m } = await le();
    ctx.m = m;
    const dec = (Date.now() - t0) / 1000;
    const extra = aoVivo ? aoVivo(m) || {} : {};
    const terminou = dec >= seg || (ate && ate(m));
    const chave = JSON.stringify(extra);
    if (chave !== ultimoExtra || Date.now() - ultimoEnvio >= 1000 || terminou) {
      ultimoEnvio = Date.now();
      ultimoExtra = chave;
      const restante = Math.max(0, Math.ceil(seg - dec));
      await envia({
        atualiza: true,
        passo: texto,
        passoN: ctx.passoN,
        passoTotal: ctx.passoTotal,
        restante,
        progresso: Math.min(100, ((ctx.passoN - 1 + Math.min(1, dec / seg)) / ctx.passoTotal) * 100),
        criterios: ctx.criterios,
        ...extra,
      });
      process.stdout.write(`\r   ${String(restante).padStart(3)} s   ${extra.resumo || ''}                    `);
    }
    if (terminou) break;
    await dorme(250);
  }
  process.stdout.write('\n');
}

const final = (criterios, extra = {}) => {
  const falhou = criterios.filter((c) => c.estado === 'falha');
  return { criterios, resultado: falhou.length ? 'REPROVADO' : 'APROVADO', detalhe: falhou.map((c) => c.texto).join(' | '), ...extra };
};

// ------------------------------------------------------------------ roteiros
const TESTES = {
  sinal: {
    passos: 3,
    descricao: 'Confere o nível do sinal (polaridade) e se UM ciclo do alvo (aproximar e afastar) vira UMA batida.',
    esperado: 'O estado do sensor muda entre repouso e acionado, a polaridade é a que o firmware espera (acionado = nível 1), e o ciclo completo conta exatamente 1 batida, sem pulsos duplos.',
    async roda() {
      const d0 = ctx.m.duplas;
      ctx.criterios = [crit('Estado muda ao aproximar o alvo', 'pend'), crit('Polaridade do sinal', 'pend'), crit('1 batida por ciclo', 'pend'), crit('Sem pulsos duplos', 'pend')];
      await passo({ texto: 'AFASTE o alvo do sensor (repouso) e deixe PARADO', seg: 6, aoVivo: (m) => ({ resumo: 'sensor: ' + rot(m.sensor_estado) }) });
      const repouso = ctx.m.sensor_estado;
      const t1 = ctx.m.total;
      await passo({ texto: 'APROXIME o alvo do sensor (até o LED do sensor acender) e MANTENHA parado', seg: 8, aoVivo: (m) => ({ resumo: `sensor: ${rot(m.sensor_estado)} · contagem +${m.total - t1}` }) });
      const acionado = ctx.m.sensor_estado;
      const contAprox = ctx.m.total - t1;
      const t2 = ctx.m.total;
      await passo({ texto: 'AFASTE o alvo de novo e deixe PARADO', seg: 6, aoVivo: (m) => ({ resumo: `sensor: ${rot(m.sensor_estado)} · contagem +${m.total - t2}` }) });
      const contAfasta = ctx.m.total - t2;
      const duplas = ctx.m.duplas - d0;

      const validos = ['0', '1'].includes(repouso) && ['0', '1'].includes(acionado);
      const mudou = validos && repouso !== acionado;
      const normal = repouso === '0' && acionado === '1';
      const ciclo = contAprox + contAfasta;
      return final([
        crit(mudou ? `Estado muda ao aproximar o alvo (${rot(repouso)} → ${rot(acionado)})` : 'O estado NÃO mudou ao aproximar o alvo: confira a ligação (Com no +24 V, sinal no I34) e o LED Dp2', mudou ? 'ok' : 'falha'),
        crit(!mudou ? 'Polaridade não avaliada (sem mudança de estado)' : normal ? 'Polaridade normal: acionado = nível 1, como o firmware espera' : 'Polaridade INVERTIDA: acionado = nível 0. Inverta a leitura no firmware (config.h)', !mudou ? 'falha' : normal ? 'ok' : 'falha'),
        crit(ciclo === 1 ? `1 batida por ciclo (na ${contAprox ? 'aproximação' : 'saída do alvo'})` : `Esperada 1 batida por ciclo, contou ${ciclo}`, ciclo === 1 ? 'ok' : 'falha'),
        crit(duplas === 0 ? 'Sem pulsos duplos' : `${duplas} pulso(s) duplo(s): repique/ruído no sinal`, duplas === 0 ? 'ok' : 'falha'),
      ], { medidas: { repouso, acionado, contAprox, contAfasta, duplas } });
    },
  },

  contagem: {
    passos: 2,
    descricao: `Passe o alvo na frente do sensor exatamente ${N} vezes e confira se o sistema contou ${N}.`,
    esperado: `Contagem final = ${N}, sem batidas extras depois de parar e sem pulsos duplos.`,
    async roda() {
      const t0 = ctx.m.total;
      const d0 = ctx.m.duplas;
      const conta = (m) => ({ contagem: { atual: m.total - t0, alvo: N }, resumo: `contagem ${m.total - t0}/${N}` });
      ctx.criterios = [crit(`Contagem = ${N}`, 'pend'), crit('Sem batidas extras', 'pend'), crit('Sem pulsos duplos', 'pend')];
      await passo({ texto: `Passe o alvo na frente do sensor ${N} vezes, devagar (cerca de 1 por segundo)`, seg: Math.max(40, N * 5), ate: (m) => m.total - t0 >= N, aoVivo: conta });
      await passo({ texto: 'PARE e afaste o alvo. Conferindo se aparece contagem extra...', seg: 4, aoVivo: conta });
      const contado = ctx.m.total - t0;
      const duplas = ctx.m.duplas - d0;
      return final([
        crit(contado === N ? `Contagem exata: ${contado} de ${N}` : contado < N ? `Faltaram ${N - contado} batida(s): contou ${contado} de ${N}` : `Sobraram ${contado - N} batida(s): contou ${contado} de ${N}`, contado === N ? 'ok' : 'falha'),
        crit(contado <= N ? 'Sem batidas extras depois de parar' : 'Houve batidas além do esperado (possível repique)', contado <= N ? 'ok' : 'falha'),
        crit(duplas === 0 ? 'Sem pulsos duplos' : `${duplas} pulso(s) duplo(s) filtrados (repique/ruído)`, duplas === 0 ? 'ok' : 'falha'),
      ], { contagem: { atual: contado, alvo: N }, medidas: { contado, duplas } });
    },
  },

  ritmo: {
    passos: 1,
    descricao: `Mede o ritmo por ${TEMPO} s com o Teste B (Wecon gerando batidas) ou com a prensa funcionando, e compara com o programado.`,
    esperado: 'Ritmo médio dentro da faixa programada, sem batidas perdidas, sem pulsos duplos e variação abaixo do limite.',
    async roda() {
      const cfg = ctx.m.cfg;
      const t0 = ctx.m.total;
      const d0 = ctx.m.duplas;
      const p0 = ctx.m.perdidas;
      const amostras = [];
      ctx.criterios = [crit('Ritmo médio na faixa', 'pend'), crit('Sem batidas perdidas', 'pend'), crit('Sem pulsos duplos', 'pend'), crit('Variação do ritmo', 'pend')];
      await passo({
        texto: `Gere as batidas no ritmo programado (Teste B ou prensa) por ${TEMPO} s`, seg: TEMPO,
        aoVivo: (m) => {
          if (m.spm > 0) amostras.push(m.spm);
          return { resumo: `ritmo ${Math.round(m.spm)}/min · batidas +${m.total - t0}`, contagem: { atual: m.total - t0, alvo: Math.round((cfg.spm * TEMPO) / 60) } };
        },
      });
      const m = ctx.m;
      const medio = amostras.length ? amostras.reduce((a, b) => a + b, 0) / amostras.length : 0;
      const lo = cfg.spm * (1 - cfg.tol / 100);
      const hi = cfg.spm * (1 + cfg.tol / 100);
      const perd = m.perdidas - p0;
      const dup = m.duplas - d0;
      return final([
        crit(medio >= lo && medio <= hi ? `Ritmo médio ${Math.round(medio)}/min dentro de ${Math.round(lo)}–${Math.round(hi)}` : `Ritmo médio ${Math.round(medio)}/min fora de ${Math.round(lo)}–${Math.round(hi)}`, medio >= lo && medio <= hi ? 'ok' : 'falha'),
        crit(perd === 0 ? 'Sem batidas perdidas' : `${perd} batida(s) perdida(s)`, perd === 0 ? 'ok' : 'falha'),
        crit(dup === 0 ? 'Sem pulsos duplos' : `${dup} pulso(s) duplo(s)`, dup === 0 ? 'ok' : 'falha'),
        crit(m.variacao <= cfg.instab ? `Variação ${m.variacao}% (limite ${cfg.instab}%)` : `Variação ${m.variacao}% acima do limite de ${cfg.instab}%`, m.variacao <= cfg.instab ? 'ok' : 'falha'),
      ], { medidas: { medio: Math.round(medio), batidas: m.total - t0, perdidas: perd, duplas: dup } });
    },
  },

  repique: {
    passos: 1,
    descricao: 'Com o alvo parado na borda da distância de detecção, o sensor não pode gerar pulsos sozinho.',
    esperado: 'Nenhuma batida espúria e nenhum pulso duplo durante o período.',
    async roda() {
      const t0 = ctx.m.total;
      const d0 = ctx.m.duplas;
      ctx.criterios = [crit('Sem batidas espúrias', 'pend'), crit('Sem pulsos duplos', 'pend')];
      await passo({ texto: `Deixe o alvo PARADO na borda da distância de detecção (sem tocar) por ${TEMPO} s`, seg: TEMPO, aoVivo: (m) => ({ resumo: `batidas +${m.total - t0} · duplas +${m.duplas - d0}` }) });
      const extra = ctx.m.total - t0;
      const dup = ctx.m.duplas - d0;
      return final([
        crit(extra === 0 ? 'Sem batidas espúrias' : `${extra} batida(s) sem o alvo se mover`, extra === 0 ? 'ok' : 'falha'),
        crit(dup === 0 ? 'Sem pulsos duplos' : `${dup} pulso(s) duplo(s)`, dup === 0 ? 'ok' : 'falha'),
      ], { medidas: { extra, dup } });
    },
  },
};

function lista() {
  console.log('Roteiros de bancada (Teste A, sensor real):\n');
  for (const [n, t] of Object.entries(TESTES)) console.log(`  ${n.padEnd(10)} ${t.descricao}`);
  console.log('\n  tudo       Roda sinal, contagem e repique em sequência.');
  console.log('\nUso: node teste_bancada.js <roteiro> [--n 10] [--tempo 30] [--porta 8085]');
  console.log('Antes: pare o servidor normal e inicie  node server.js --teste');
}

function salvaCsv(nomeTeste, r) {
  try {
    fs.mkdirSync(DADOS, { recursive: true });
    const arq = path.join(DADOS, 'resultados_bancada.csv');
    const novo = !fs.existsSync(arq);
    const agora = new Date();
    const dh = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')} ${agora.toTimeString().slice(0, 8)}`;
    const campo = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    const linha = [dh, nomeTeste, r.resultado, campo(r.criterios.map((c) => `${c.estado}: ${c.texto}`).join(' | '))].join(';');
    fs.appendFileSync(arq, (novo ? '﻿data_hora;teste;resultado;criterios\r\n' : '') + linha + '\r\n');
    return arq;
  } catch (e) {
    return null;
  }
}

async function executa(nomeTeste) {
  const t = TESTES[nomeTeste];
  const { m, modo } = await le();
  if (!modo && !FORCAR) {
    console.error('O servidor NÃO está em MODO TESTE: os dados deste roteiro iriam para a produção.');
    console.error('Pare o servidor normal (Ctrl+C) e inicie:   node server.js --teste');
    process.exit(2);
  }
  if (m.placa_ha == null || m.placa_ha > 10) {
    console.error('A PLC32 não está comunicando com o servidor (verifique o cabo de rede, a alimentação e o IP no config.h).');
    process.exit(2);
  }
  ctx.m = m;
  ctx.passoN = 0;
  ctx.passoTotal = t.passos;
  ctx.criterios = [];
  console.log(`\n=== TESTE DE BANCADA: ${nomeTeste} ===\n${t.descricao}\nEsperado: ${t.esperado}`);
  await envia({ bancada: true, cenario: nomeTeste, descricao: t.descricao, esperado: t.esperado, passoTotal: t.passos, progresso: 0, criterios: ctx.criterios });
  let r;
  try {
    r = await t.roda();
  } catch (e) {
    r = { resultado: 'REPROVADO', detalhe: 'Erro no roteiro: ' + e.message, criterios: [crit('Erro: ' + e.message, 'falha')] };
  }
  await envia({ fim: true, resultado: r.resultado, detalhe: r.detalhe, criterios: r.criterios, progresso: 100, contagem: r.contagem, passo: '' });
  console.log(`\n--- RESULTADO: ${r.resultado} ---`);
  for (const c of r.criterios) console.log(`  [${c.estado === 'ok' ? 'OK' : c.estado === 'falha' ? 'FALHA' : '--'}] ${c.texto}`);
  const arq = salvaCsv(nomeTeste, r);
  if (arq) console.log(`\nRegistrado em ${arq}`);
  return r;
}

(async () => {
  try {
    if (nome === 'lista' || (nome !== 'tudo' && !TESTES[nome])) {
      if (nome !== 'lista') console.log(`Roteiro desconhecido: "${nome}"\n`);
      return lista();
    }
    const nomes = nome === 'tudo' ? ['sinal', 'contagem', 'repique'] : [nome];
    const resultados = [];
    for (const n of nomes) {
      resultados.push([n, (await executa(n)).resultado]);
      if (nomes.length > 1 && n !== nomes[nomes.length - 1]) {
        console.log('\n(próximo roteiro em 8 s)');
        await dorme(8000);
      }
    }
    if (resultados.length > 1) {
      console.log('\n=== RESUMO ===');
      for (const [n, r] of resultados) console.log(`  ${n.padEnd(10)} ${r}`);
    }
    process.exit(resultados.some(([, r]) => r !== 'APROVADO') ? 1 : 0);
  } catch (e) {
    console.error('Falha: ' + e.message + `\nO servidor de teste está rodando em ${BASE}? (node server.js --teste)`);
    process.exit(2);
  }
})();
