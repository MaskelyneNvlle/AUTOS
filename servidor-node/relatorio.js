'use strict';
// Relatorio parcial de desempenho da prensa.
// Calculado a partir do que o servidor ja grava (producao.csv e alarmes.csv) mais o minuto em andamento,
// entao continua valendo depois de reiniciar o servidor.

const fs = require('fs');

// ---------------------------------------------------------------- leitura de CSV (separador ';', BOM, aspas)
function parseCsv(txt) {
  txt = txt.replace(/^﻿/, '');
  const linhas = [];
  let campo = '';
  let linha = [];
  let aspas = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (aspas) {
      if (c === '"') {
        if (txt[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ';') { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && txt[i + 1] === '\n') i++;
      linha.push(campo);
      campo = '';
      if (linha.length > 1 || linha[0] !== '') linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

function leCsv(arq) {
  try {
    const l = parseCsv(fs.readFileSync(arq, 'utf8'));
    const cab = l.shift() || [];
    return l.map((r) => Object.fromEntries(cab.map((k, i) => [k, r[i]])));
  } catch (_) {
    return []; // arquivo ainda nao existe
  }
}

// "2026-10-21 09:25" ou "2026-10-21T09:25:25" (hora local) -> segundos
const seg = (s) => Date.parse(String(s || '').trim().replace(' ', 'T')) / 1000;
const r1 = (x) => Math.round(x * 10) / 10;

// Referencias para o veredito (eficiencia = disponibilidade x desempenho)
const LIMITE_BOM = 85;
const LIMITE_ATENCAO = 65;

// ---------------------------------------------------------------- calculo
// opts: { prod, alarmes, agora, de, ate, spm, tol, paradaS, vivo, paradaAtiva }
//  prod/alarmes: linhas ja lidas dos CSV; vivo: minuto ainda aberto (analise.parcial())
function calcula(opts) {
  const { prod, alarmes, agora, de, spm, tol, paradaS, vivo, paradaAtiva } = opts;
  const ate = opts.ate || agora;
  const minDe = Math.floor(de / 60) * 60;

  const linhas = prod
    .map((r) => ({
      t: seg(r.data_hora),
      batidas: Number(r.batidas) || 0,
      perdidas: Number(r.perdidas) || 0,
      duplas: Number(r.duplas) || 0,
    }))
    .filter((r) => Number.isFinite(r.t) && r.t >= minDe && r.t <= ate);
  const vivoComAtividade = vivo && (vivo.batidas || vivo.perdidas || vivo.duplas);
  if (vivoComAtividade && vivo.minuto >= minDe && !linhas.some((r) => r.t === vivo.minuto)) {
    linhas.push({ t: vivo.minuto, batidas: vivo.batidas || 0, perdidas: vivo.perdidas || 0, duplas: vivo.duplas || 0 });
  }
  linhas.sort((a, b) => a.t - b.t);

  const base = {
    periodo: { de, ate },
    parametros: { spm, tol, paradaS },
    limites: { bom: LIMITE_BOM, atencao: LIMITE_ATENCAO },
  };
  if (!linhas.length) return { ...base, vazio: true };

  // inicio do tempo observado: o minuto da primeira atividade; se a memoria souber o instante exato, usa-o
  let ini = Math.max(de, linhas[0].t);
  const exata = vivo && vivo.primeira;
  if (exata && exata >= linhas[0].t && exata < linhas[0].t + 60) ini = Math.max(de, exata);
  const alm = alarmes
    .map((a) => ({ t: seg(a.data_hora), tipo: a.tipo, msg: a.mensagem || '' }))
    .filter((a) => Number.isFinite(a.t))
    .sort((a, b) => a.t - b.t);

  // ---- tempo com o servidor desligado: o servidor registra "servidor_iniciado" a cada partida; se entre a
  // ultima atividade conhecida e a partida passou mais de 90 s, esse intervalo nao conta como tempo observado
  let foraDoAr = 0;
  for (const s of alm) {
    if (s.tipo !== 'servidor_iniciado' || s.t <= ini || s.t > ate) continue;
    let ultimo = -Infinity;
    // so minutos que terminaram antes da partida (a linha do minuto da partida e gravada depois dela)
    for (const r of linhas) if (r.t + 60 <= s.t) ultimo = Math.max(ultimo, r.t + 60);
    for (const a of alm) if (a.t < s.t && a.tipo !== 'servidor_iniciado') ultimo = Math.max(ultimo, a.t);
    if (ultimo > -Infinity && s.t - ultimo > 90) foraDoAr += s.t - Math.max(ultimo, ini);
  }
  const observado = Math.max(1, ate - ini - foraDoAr);

  // ---- paradas (alarmes "parada" e "retomada")
  const paradasBrutas = [];
  let aberta = null;
  for (const a of alm) {
    if (a.tipo === 'parada') {
      const n = /há (\d+) s/.exec(a.msg);
      aberta = { inicio: a.t - (n ? Number(n[1]) : paradaS) };
    } else if (a.tipo === 'retomada' && aberta) {
      const n = /após (\d+) s/.exec(a.msg);
      paradasBrutas.push({ inicio: aberta.inicio, fim: a.t, duracao: n ? Number(n[1]) : a.t - aberta.inicio });
      aberta = null;
    }
  }
  if (aberta && paradaAtiva) {
    paradasBrutas.push({ inicio: aberta.inicio, fim: null, duracao: ate - aberta.inicio, emAndamento: true });
  }
  const paradas = [];
  let parado = 0;
  for (const p of paradasBrutas) {
    const fimP = p.fim === null ? ate : p.fim;
    if (fimP < ini || p.inicio > ate) continue;
    const naJanela = Math.max(0, Math.min(fimP, ate) - Math.max(p.inicio, ini));
    parado += naJanela;
    paradas.push({ ...p, duracao: Math.round(p.duracao), naJanela: Math.round(naJanela) });
  }
  parado = Math.min(parado, observado);
  const operando = Math.max(0, observado - parado);

  // ---- producao
  const soma = (k) => linhas.reduce((s, r) => s + r[k], 0);
  const batidas = soma('batidas');
  const perdidas = soma('perdidas');
  const duplas = soma('duplas');
  const ritmoOperacao = operando > 0 ? (batidas / operando) * 60 : 0; // batidas/min durante o tempo operando
  const esperadas = spm * (operando / 60);
  const desempenho = esperadas > 0 ? batidas / esperadas : 0;
  const disponibilidade = operando / observado;
  const eficiencia = disponibilidade * Math.min(1, desempenho);
  const pctPerdidas = batidas + perdidas ? perdidas / (batidas + perdidas) : 0;
  const pctDuplas = batidas + duplas ? duplas / (batidas + duplas) : 0;
  const ativos = linhas.filter((r) => r.batidas > 0);
  const picoMinuto = Math.max(0, ...ativos.map((r) => r.batidas));

  const alertasPorTipo = {};
  for (const a of alm) {
    if (a.t >= ini && a.t <= ate && a.tipo !== 'servidor_iniciado') alertasPorTipo[a.tipo] = (alertasPorTipo[a.tipo] || 0) + 1;
  }

  // ---- serie por minuto (preenche minutos sem batida com zero)
  const porMin = new Map(linhas.map((r) => [r.t, r]));
  const serie = [];
  for (let t = Math.floor(ini / 60) * 60; t <= Math.floor(ate / 60) * 60; t += 60) {
    const r = porMin.get(t);
    serie.push({ t, batidas: r ? r.batidas : 0, perdidas: r ? r.perdidas : 0, duplas: r ? r.duplas : 0 });
  }

  const efPct = eficiencia * 100;
  const veredito = efPct >= LIMITE_BOM ? 'bom' : efPct >= LIMITE_ATENCAO ? 'atencao' : 'baixo';

  return {
    ...base,
    vazio: false,
    periodo: { de, ate, inicioObservado: ini, observado: Math.round(observado), foraDoAr: Math.round(foraDoAr) },
    tempos: { operando: Math.round(operando), parado: Math.round(parado) },
    producao: {
      batidas,
      perdidas,
      duplas,
      ritmoOperacao: r1(ritmoOperacao),
      picoMinuto,
      esperadas: Math.round(esperadas),
    },
    indices: {
      disponibilidade: r1(disponibilidade * 100),
      desempenho: r1(desempenho * 100),
      eficiencia: r1(efPct),
      pctPerdidas: r1(pctPerdidas * 100),
      pctDuplas: r1(pctDuplas * 100),
    },
    paradas: {
      quantidade: paradas.length,
      total: Math.round(parado),
      maior: paradas.length ? Math.max(...paradas.map((p) => p.naJanela)) : 0,
      media: paradas.length ? Math.round(parado / paradas.length) : 0,
      mtbf: paradas.length ? Math.round(operando / paradas.length) : null, // tempo medio operando entre paradas
      lista: paradas.slice(-20).reverse(),
    },
    alertasPorTipo,
    serie: serie.slice(-1440),
    veredito,
  };
}

// ---------------------------------------------------------------- CSV do resumo
function paraCsv(rel, nome) {
  const f = (s) => new Date(s * 1000).toISOString().replace('T', ' ').slice(0, 19);
  if (rel.vazio) return '﻿indicador;valor\r\nsem dados no periodo;\r\n';
  const L = [
    ['indicador', 'valor'],
    ['maquina', nome],
    ['periodo_de', f(rel.periodo.de)],
    ['periodo_ate', f(rel.periodo.ate)],
    ['tempo_observado_s', rel.periodo.observado],
    ['tempo_operando_s', rel.tempos.operando],
    ['tempo_parado_s', rel.tempos.parado],
    ['batidas', rel.producao.batidas],
    ['batidas_esperadas_no_ritmo_programado', rel.producao.esperadas],
    ['ritmo_medio_operando_por_min', rel.producao.ritmoOperacao],
    ['pico_batidas_por_min', rel.producao.picoMinuto],
    ['perdidas', rel.producao.perdidas],
    ['duplas', rel.producao.duplas],
    ['disponibilidade_pct', rel.indices.disponibilidade],
    ['desempenho_pct', rel.indices.desempenho],
    ['eficiencia_pct', rel.indices.eficiencia],
    ['perdidas_pct', rel.indices.pctPerdidas],
    ['duplas_pct', rel.indices.pctDuplas],
    ['paradas', rel.paradas.quantidade],
    ['maior_parada_s', rel.paradas.maior],
    ['media_parada_s', rel.paradas.media],
    ['tempo_medio_entre_paradas_s', rel.paradas.mtbf === null ? '' : rel.paradas.mtbf],
    ['veredito', rel.veredito],
  ];
  return '﻿' + L.map((r) => r.join(';')).join('\r\n') + '\r\n';
}

module.exports = { leCsv, parseCsv, calcula, paraCsv, LIMITE_BOM, LIMITE_ATENCAO };
