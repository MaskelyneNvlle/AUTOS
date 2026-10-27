'use strict';
// Servidor de monitoramento da prensa Airfix (Node.js) - porte do servidor.py.
// Broker MQTT embutido (aedes) na porta 1883: NAO precisa do Mosquitto.
// Para usar um Mosquitto existente: node server.js --mqtt-host localhost
//
// Dashboard:   http://localhost:8085        Diagnostico: /api/health
// Compatibilidade: tambem aceita POST HTTP em /api/batida (portas 8085 e 4000).

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const http = require('http');
const { Maquina } = require('./analise');

const arg = (nome, padrao) => {
  const i = process.argv.indexOf('--' + nome);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};
const HTTP_PORT = Number(arg('port', 8085));
const BOARD_PORT = Number(arg('board-port', 4000)); // HTTP extra para firmware legado
const MQTT_PORT = Number(arg('mqtt-port', 1883));
const MQTT_HOST = arg('mqtt-host', null); // null = broker embutido

const BASE = __dirname;
// --dados <pasta>: guarda maquinas.json e os CSV em outra pasta (usado nos testes, para nao misturar com producao)
const DADOS = path.resolve(arg('dados', BASE));
fs.mkdirSync(DADOS, { recursive: true });
const CFG_FILE = path.join(DADOS, 'maquinas.json');
const PROD_CSV = path.join(DADOS, 'producao.csv');
const ALARM_CSV = path.join(DADOS, 'alarmes.csv');
const MAQUINA_PADRAO = 'prensa1';
const TEMPO_SEM_COMUNICACAO_S = 10;

const maquinas = {}; // id -> Maquina
const visto = {}; // id -> [instante(s), origem] do ultimo contato da placa
const estadoSensor = {}; // id -> '1' (acionado) | '0' (repouso)
const clientes = new Set(); // respostas SSE abertas
let mqttStatus = MQTT_HOST ? 'conectando' : 'broker embutido ativo';
let mqttUltimoErro = '';

const agoraS = () => Date.now() / 1000;
const pad = (n) => String(n).padStart(2, '0');
const dataHora = (s) => {
  const d = new Date(s * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const isoLocal = (s) => dataHora(s).replace(' ', 'T') + ':' + pad(new Date(s * 1000).getSeconds());

// ---------------------------------------------------------------- persistencia
function carregaConfig() {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
  } catch (_) {
    /* arquivo ausente ou invalido: usa o padrao */
  }
  if (!cfg[MAQUINA_PADRAO]) {
    cfg[MAQUINA_PADRAO] = {
      nome: 'Prensa 1',
      modelo: 'Formadora hidráulica de alta velocidade (manual: 150-160/min)',
      spm: 155,
    };
  }
  for (const [mid, c] of Object.entries(cfg)) maquinas[mid] = new Maquina(mid, c);
  salvaConfig();
}

function salvaConfig() {
  const obj = {};
  for (const m of Object.values(maquinas)) obj[m.id] = m.cfg;
  fs.writeFileSync(CFG_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

const campoCsv = (v) => {
  const s = String(v);
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
function gravaCsv(arq, cab, linha) {
  const novo = !fs.existsSync(arq);
  let txt = novo ? '﻿' + cab.join(';') + '\r\n' : ''; // BOM + ';' para abrir direto no Excel
  txt += linha.map(campoCsv).join(';') + '\r\n';
  try {
    fs.appendFileSync(arq, txt, 'utf8');
  } catch (e) {
    console.log(`Aviso: nao foi possivel gravar ${path.basename(arq)}: ${e.message}`);
  }
}

const gravaLinhaMinuto = (r) =>
  gravaCsv(PROD_CSV, ['data_hora', 'maquina', 'batidas', 'perdidas', 'duplas', 'spm_programado'], [
    dataHora(r.minuto), r.maquina, r.batidas, r.perdidas, r.duplas, r.spm_programado,
  ]);

const gravaAlerta = (a) =>
  gravaCsv(ALARM_CSV, ['data_hora', 'maquina', 'nivel', 'tipo', 'mensagem'], [
    isoLocal(a.t), a.maquina, a.nivel, a.tipo, a.msg,
  ]);

// ---------------------------------------------------------------- difusao (SSE)
function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clientes) res.write(data);
}

function maquina(mid) {
  if (!maquinas[mid]) {
    maquinas[mid] = new Maquina(mid, { nome: mid });
    salvaConfig();
  }
  return maquinas[mid];
}

function snapshotTodas(agora) {
  const dados = {};
  for (const [mid, m] of Object.entries(maquinas)) {
    const ultimo = visto[mid];
    const idade = ultimo ? Math.round((agora - ultimo[0]) * 10) / 10 : null;
    const item = m.snapshot(agora);
    // Nao confundir perda de comunicacao com parada mecanica
    if (idade === null || idade > TEMPO_SEM_COMUNICACAO_S) item.status = 'sem_comunicacao';
    item.placa_ha = idade;
    item.origem = ultimo ? ultimo[1] : '';
    item.sensor_estado = estadoSensor[mid] || 'desconhecido';
    dados[mid] = item;
  }
  return { type: 'snapshot', now: agora, maquinas: dados };
}

function publica(alertas, linha) {
  for (const a of alertas) {
    gravaAlerta(a);
    broadcast({ type: 'alert', ...a });
  }
  if (linha) gravaLinhaMinuto(linha);
}

function recebeBatidas(mid, instantes, origem, ruido = 0) {
  const agora = agoraS();
  const m = maquina(mid);
  visto[mid] = [agora, origem];
  m.ruidoPlaca += ruido;
  for (const t of [...instantes].sort((a, b) => a - b)) {
    const [flag, alertas, linha] = m.batida(t);
    if (flag !== 'fora_de_ordem') broadcast({ type: 'hit', id: mid, t, flag });
    publica(alertas, linha);
  }
  broadcast(snapshotTodas(agora));
}

setInterval(() => {
  const agora = agoraS();
  for (const m of Object.values(maquinas)) {
    const [alertas, linha] = m.tick(agora);
    publica(alertas, linha);
  }
  broadcast(snapshotTodas(agora));
}, 1000);

// Firmware antigo (HTTP): {"maquina":..., "agora":ms, "batidas":[ms,...], "ruido":n} ou 1 batida por POST
function trataBatida(body, origem) {
  let d;
  try {
    d = JSON.parse(body || '{}');
  } catch (_) {
    return false;
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
  const mid = String(d.maquina || MAQUINA_PADRAO).slice(0, 40);
  const agora = agoraS();
  if ('batidas' in d) {
    const ref = parseInt(d.agora, 10);
    if (!Array.isArray(d.batidas) || Number.isNaN(ref)) return false;
    const inst = [];
    for (const ms of d.batidas) {
      const n = parseInt(ms, 10);
      if (Number.isNaN(n)) return false;
      inst.push(agora - ((ref - n) >>> 0) / 1000);
    }
    const ruido = Math.max(0, parseInt(d.ruido, 10) || 0);
    recebeBatidas(mid, inst, origem, ruido);
  } else {
    recebeBatidas(mid, [agora], origem);
  }
  return true;
}

// ---------------------------------------------------------------- MQTT (PLC32)
// Firmware novo:  prensa/sensor1/estado (0|1, nao conta) | prensa/sensor1/batida (1, conta)
//                 prensa/heartbeat (ping, nao conta)
// Legado:         prensa/sensor1 com payload 1 conta como batida
function onMqttMessage(topicoBruto, payloadBruto) {
  try {
    const payload = String(payloadBruto).trim();
    const topico = topicoBruto.replace(/^\/+|\/+$/g, '');
    const mid = MAQUINA_PADRAO;
    const agora = agoraS();
    visto[mid] = [agora, `MQTT (${topico})`];
    if (topico.endsWith('/estado') || topico === 'prensa/sensor1') {
      if (payload === '0' || payload === '1') estadoSensor[mid] = payload;
    }
    if (topico === 'prensa/heartbeat') return;
    if (topico.endsWith('/batida') && payload === '1') {
      recebeBatidas(mid, [agora], `MQTT (${topico})`);
    } else if (topico === 'prensa/sensor1' && payload === '1') {
      recebeBatidas(mid, [agora], `MQTT legado (${topico})`);
    }
  } catch (e) {
    console.log(`Erro ao processar MQTT: ${e.message}`);
  }
}

function iniciaMqtt() {
  if (!MQTT_HOST) {
    const aedes = require('aedes')();
    aedes.on('publish', (pacote, cliente) => {
      if (cliente) onMqttMessage(pacote.topic, pacote.payload);
    });
    aedes.on('client', (c) => console.log(`[MQTT] cliente conectado: ${c.id}`));
    aedes.on('clientDisconnect', (c) => console.log(`[MQTT] cliente saiu: ${c.id}`));
    const srv = net.createServer(aedes.handle);
    srv.on('error', (e) => {
      mqttStatus = 'erro ao abrir a porta';
      mqttUltimoErro = e.message;
      console.log(`[MQTT] ERRO ao abrir 0.0.0.0:${MQTT_PORT}: ${e.message} (outro broker, como o Mosquitto, esta rodando?)`);
    });
    srv.listen(MQTT_PORT, '0.0.0.0', () => console.log(`[MQTT] broker embutido ouvindo em 0.0.0.0:${MQTT_PORT}`));
  } else {
    const mqtt = require('mqtt');
    const c = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, { clientId: 'airfix-prensa-servidor', reconnectPeriod: 3000 });
    c.on('connect', () => {
      mqttStatus = 'conectado';
      mqttUltimoErro = '';
      c.subscribe('prensa/#');
      console.log(`[MQTT] conectado a ${MQTT_HOST}:${MQTT_PORT}`);
    });
    c.on('close', () => (mqttStatus = 'desconectado; tentando reconectar'));
    c.on('error', (e) => {
      mqttUltimoErro = e.message;
      console.log('[MQTT] erro:', e.message);
    });
    c.on('message', onMqttMessage);
  }
}

// ---------------------------------------------------------------- HTTP
const PAGINA = () => fs.readFileSync(path.join(BASE, 'public', 'index.html'));

function enviar(res, code, corpo, tipo = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': tipo, 'Access-Control-Allow-Origin': '*' });
  res.end(corpo);
}

function lerCorpo(req, cb) {
  let b = '';
  req.on('data', (c) => {
    b += c;
    if (b.length > 1e6) req.destroy();
  });
  req.on('end', () => cb(b));
}

function tratar(req, res) {
  const url = req.url.split('?')[0];
  if (req.method === 'GET') {
    if (url === '/' || url === '/index.html') return enviar(res, 200, PAGINA(), 'text/html; charset=utf-8');
    if (url === '/api/health') {
      const ult = Math.max(0, ...Object.values(visto).map((v) => v[0]));
      return enviar(
        res, 200,
        JSON.stringify({
          servidor: 'ok',
          mqtt: mqttStatus,
          broker: MQTT_HOST ? `${MQTT_HOST}:${MQTT_PORT}` : `embutido:${MQTT_PORT}`,
          ultimo_erro: mqttUltimoErro,
          placaOnline: ult > 0 && agoraS() - ult <= TEMPO_SEM_COMUNICACAO_S,
        }),
        'application/json'
      );
    }
    if (url === '/api/state') return enviar(res, 200, JSON.stringify(snapshotTodas(agoraS())), 'application/json');
    if (url === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const agora = agoraS();
      const hist = {};
      for (const [mid, m] of Object.entries(maquinas)) {
        hist[mid] = {
          spm: m.spmHist,
          hits: m.hits.filter((h) => agora - h <= 70),
          alertas: m.alertas.slice(0, 30),
        };
      }
      res.write(`data: ${JSON.stringify({ ...snapshotTodas(agora), type: 'init', hist })}\n\n`);
      clientes.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => {
        clearInterval(ping);
        clientes.delete(res);
      });
      return;
    }
    return enviar(res, 404, 'nao encontrado');
  }

  if (req.method === 'POST') {
    return lerCorpo(req, (body) => {
      if (url === '/api/batida') {
        const ok = trataBatida(body, `HTTP ${req.socket.remoteAddress}`);
        return enviar(res, ok ? 200 : 400, ok ? 'OK' : 'payload invalido');
      }
      if (url === '/api/config') {
        try {
          const d = JSON.parse(body);
          const mid = String(d.maquina || MAQUINA_PADRAO);
          delete d.maquina;
          maquina(mid).config(d);
          salvaConfig();
          broadcast(snapshotTodas(agoraS()));
          return enviar(res, 200, 'OK');
        } catch (_) {
          return enviar(res, 400, 'config invalida');
        }
      }
      if (url === '/reset') {
        let mid = MAQUINA_PADRAO;
        try {
          mid = String(JSON.parse(body || '{}').maquina || MAQUINA_PADRAO);
        } catch (_) {
          /* usa a maquina padrao */
        }
        maquina(mid).reset();
        broadcast({ type: 'reset', id: mid });
        broadcast(snapshotTodas(agoraS()));
        return enviar(res, 200, 'OK');
      }
      return enviar(res, 404, 'nao encontrado');
    });
  }
  enviar(res, 405, 'metodo nao permitido');
}

function ouvir(porta, rotulo) {
  const srv = http.createServer(tratar);
  srv.on('error', (e) => {
    console.log(`[HTTP] ERRO na porta ${porta} (${rotulo}): ${e.message}`);
    if (rotulo === 'dashboard') process.exit(1); // sem dashboard nao ha o que servir
  });
  srv.listen(porta, '0.0.0.0');
}

function main() {
  carregaConfig();
  iniciaMqtt();
  ouvir(HTTP_PORT, 'dashboard');
  if (BOARD_PORT !== HTTP_PORT) ouvir(BOARD_PORT, 'firmware legado');

  let ip = '?';
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista || []) if (i.family === 'IPv4' && !i.internal && ip === '?') ip = i.address;
  }
  console.log(`Dashboard: http://localhost:${HTTP_PORT}`);
  console.log(`Diagnóstico: http://localhost:${HTTP_PORT}/api/health`);
  console.log(`Acesso pela rede: http://${ip}:${HTTP_PORT}`);
  console.log(`Broker MQTT: ${MQTT_HOST ? `${MQTT_HOST}:${MQTT_PORT} (externo)` : `embutido (aedes) na porta ${MQTT_PORT}`}`);
  console.log(`Ritmo programado em: ${CFG_FILE} | registros: ${path.basename(PROD_CSV)}, ${path.basename(ALARM_CSV)}`);
}

main();
