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
const relatorio = require('./relatorio');

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
// --teste: atalho para "--dados dados_teste" nas portas normais (a PLC32 conecta na 1883 do jeito de sempre,
// mas tudo o que ela mandar fica isolado em dados_teste e a dashboard mostra "MODO TESTE")
const DADOS = path.resolve(arg('dados', process.argv.includes('--teste') ? path.join(__dirname, 'dados_teste') : BASE));
const MODO_TESTE = DADOS !== path.resolve(BASE);
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
// Cenario em execucao do simulador (topico prensa/simulacao); a dashboard mostra uma faixa de "TESTE"
let simulacao = null;

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
  // migracao: maquinas antigas nao tinham a lista de sensores; o topico prensa/sensor1 era a batida da prensa1
  if (!Array.isArray(cfg[MAQUINA_PADRAO].sensores)) {
    cfg[MAQUINA_PADRAO].sensores = [{ id: 'sensor1', papel: 'batida', nome: 'Sensor principal' }];
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
    // o resultado do teste fica na tela por 30 s depois do fim do cenario
    // o resultado fica na tela depois do fim: 30 s no simulador, 3 min no teste de bancada (para dar tempo de ler)
    if (simulacao && simulacao.fim && agora - simulacao.fim > (simulacao.bancada ? 180 : 30)) simulacao = null;
  }
  return { type: 'snapshot', now: agora, maquinas: dados, sim: simulacao, modo_teste: MODO_TESTE };
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

// Faixa de TESTE da dashboard. Duas origens usam o mesmo mecanismo:
//  - simulador (MQTT, topico prensa/simulacao)
//  - roteiro de bancada com a PLC32 real (HTTP, POST /api/teste, ver teste_bancada.js)
// Mensagens: inicio {cenario, descricao, ...} | atualizacao {atualiza:true, ...campos} | fim {fim:true, ...resultado}
function aplicaTeste(d, agora) {
  if (d.fim) {
    const { fim, ...resto } = d;
    simulacao = simulacao ? { ...simulacao, ...resto, fim: agora } : null;
  } else if (d.atualiza) {
    const { atualiza, ...resto } = d;
    if (simulacao) simulacao = { ...simulacao, ...resto };
  } else {
    simulacao = { ...d, inicio: agora };
  }
}

// ---------------------------------------------------------------- MQTT (PLC32) e cadastro de sensores
// Topicos (qualquer sensor, de qualquer maquina):
//   prensa/<sensor>/estado  -> "0"/"1": nivel do sinal (nao conta producao)
//   prensa/<sensor>/batida  -> "1": uma batida (conta, se o sensor tiver papel "batida")
//   prensa/heartbeat        -> "ping": a PLC inteira esta viva (nao conta)
//   prensa/<sensor>         -> legado: "1" = batida, "0"/"1" = estado
// A maquina que recebe um sensor vem do cadastro (pagina /sensores), e nao do nome do topico.
const RE_SENSOR_ID = /^[A-Za-z0-9_-]{1,30}$/;
const RE_MAQ_ID = /^[a-z0-9_-]{1,30}$/;
const sensoresVistos = {}; // sensor -> {ultimo, topico, estado}: inclui sensores ainda nao cadastrados

function sensoresDe(m) {
  return Array.isArray(m.cfg.sensores) ? m.cfg.sensores : [];
}

function localizaSensor(sid) {
  for (const m of Object.values(maquinas)) {
    const s = sensoresDe(m).find((x) => x.id === sid);
    if (s) return { m, s };
  }
  return null;
}

function listaSensores(agora) {
  return Object.entries(sensoresVistos)
    .map(([sid, v]) => {
      const loc = localizaSensor(sid);
      return {
        id: sid,
        topico: v.topico,
        ultimo_ha: Math.round(agora - v.ultimo),
        estado: v.estado,
        maquina: loc ? loc.m.id : null,
        papel: loc ? loc.s.papel : null,
        nome: loc ? loc.s.nome : null,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

function onMqttMessage(topicoBruto, payloadBruto) {
  try {
    const payload = String(payloadBruto).trim();
    const topico = topicoBruto.replace(/^\/+|\/+$/g, '');
    const agora = agoraS();
    // Informacao do simulador: nao e da placa, nao conta producao nem presenca
    if (topico === 'prensa/simulacao') {
      aplicaTeste(JSON.parse(payload), agora);
      return;
    }
    if (topico === 'prensa/heartbeat') {
      for (const id of Object.keys(maquinas)) visto[id] = [agora, `MQTT (${topico})`];
      return;
    }
    const partes = topico.split('/');
    if (partes[0] !== 'prensa' || partes.length < 2 || partes.length > 3) return;
    const sid = partes[1];
    if (!RE_SENSOR_ID.test(sid)) return;
    const tipo = partes.length === 3 ? partes[2] : 'legado';
    const nivel = payload === '0' || payload === '1' ? payload : null;

    const v = sensoresVistos[sid] || (sensoresVistos[sid] = { ultimo: agora, topico, estado: null });
    v.ultimo = agora;
    v.topico = topico;
    const ehEstado = tipo === 'estado' || tipo === 'legado';
    if (nivel !== null && ehEstado) v.estado = nivel;

    const local = localizaSensor(sid);
    if (!local) return; // ainda nao cadastrado: aparece em /sensores para voce atribuir
    const { m, s } = local;
    visto[m.id] = [agora, `MQTT (${topico})`];
    if (s.papel !== 'batida') return; // sensor auxiliar: so informa o nivel do sinal
    if (nivel !== null && ehEstado) estadoSensor[m.id] = nivel;
    if ((tipo === 'batida' || tipo === 'legado') && payload === '1') {
      recebeBatidas(m.id, [agora], `MQTT (${topico})`);
    }
  } catch (e) {
    console.log(`Erro ao processar MQTT: ${e.message}`);
  }
}

// ---------------------------------------------------------------- cadastro de maquinas e sensores (rotas /api/maquinas, /api/maquinas/sensores)
const enviaJson = (res, code, obj) => enviar(res, code, JSON.stringify(obj), 'application/json; charset=utf-8');

function proximoIdMaquina() {
  let n = 1;
  while (maquinas[`prensa${n}`]) n++;
  return `prensa${n}`;
}

function salvaEBroadcast() {
  salvaConfig();
  broadcast(snapshotTodas(agoraS()));
}

function cadastraMaquina(res, body) {
  let d;
  try {
    d = JSON.parse(body || '{}');
  } catch (_) {
    return enviaJson(res, 400, { erro: 'JSON invalido' });
  }
  const id = d.id ? String(d.id) : proximoIdMaquina();
  if (!RE_MAQ_ID.test(id)) return enviaJson(res, 400, { erro: 'id invalido: use letras minusculas, numeros, _ ou - (ate 30)' });
  const novo = !maquinas[id];
  const dados = { ...d };
  delete dados.id;
  try {
    if (novo) maquinas[id] = new Maquina(id, { nome: id, sensores: [] });
    maquinas[id].config(dados); // lanca erro se algum numero for invalido
  } catch (e) {
    if (novo) delete maquinas[id];
    return enviaJson(res, 400, { erro: 'valor invalido: ' + e.message });
  }
  salvaEBroadcast();
  enviaJson(res, 200, { ok: true, id, criada: novo });
}

function excluiMaquina(res, reqUrl) {
  const id = new URL(reqUrl, 'http://x').searchParams.get('id') || '';
  if (!maquinas[id]) return enviaJson(res, 404, { erro: 'maquina nao encontrada' });
  delete maquinas[id];
  delete estadoSensor[id];
  delete visto[id];
  salvaEBroadcast();
  enviaJson(res, 200, { ok: true });
}

function atribuiSensor(res, body) {
  let d;
  try {
    d = JSON.parse(body || '{}');
  } catch (_) {
    return enviaJson(res, 400, { erro: 'JSON invalido' });
  }
  const sid = String(d.sensor || '').trim();
  const papel = d.papel === 'batida' || d.papel === 'estado' ? d.papel : null;
  const m = maquinas[String(d.maquina || '')];
  if (!RE_SENSOR_ID.test(sid)) return enviaJson(res, 400, { erro: 'id do sensor invalido (ex.: sensor2)' });
  if (!papel) return enviaJson(res, 400, { erro: 'papel deve ser "batida" ou "estado"' });
  if (!m) return enviaJson(res, 404, { erro: 'maquina nao encontrada' });
  const outra = localizaSensor(sid);
  if (outra && outra.m.id !== m.id) {
    return enviaJson(res, 409, { erro: `${sid} ja esta atribuido a ${outra.m.id}. Remova-o de la antes.` });
  }
  if (!Array.isArray(m.cfg.sensores)) m.cfg.sensores = [];
  const lista = m.cfg.sensores;
  if (papel === 'batida' && lista.some((s) => s.papel === 'batida' && s.id !== sid)) {
    return enviaJson(res, 409, { erro: `${m.id} ja tem um sensor de batida. Os demais devem ser "estado".` });
  }
  const nome = String(d.nome || (papel === 'batida' ? 'Sensor de batida' : 'Sensor auxiliar')).slice(0, 60);
  const existente = lista.find((s) => s.id === sid);
  if (existente) Object.assign(existente, { papel, nome });
  else lista.push({ id: sid, papel, nome });
  salvaEBroadcast();
  enviaJson(res, 200, { ok: true });
}

function removeSensor(res, reqUrl) {
  const q = new URL(reqUrl, 'http://x').searchParams;
  const m = maquinas[q.get('maquina') || ''];
  const sid = q.get('sensor') || '';
  if (!m) return enviaJson(res, 404, { erro: 'maquina nao encontrada' });
  const lista = Array.isArray(m.cfg.sensores) ? m.cfg.sensores : [];
  const i = lista.findIndex((s) => s.id === sid);
  if (i < 0) return enviaJson(res, 404, { erro: 'sensor nao atribuido a esta maquina' });
  if (lista[i].papel === 'batida') delete estadoSensor[m.id];
  lista.splice(i, 1);
  salvaEBroadcast();
  enviaJson(res, 200, { ok: true });
}

// aedes 1.x e so ESM e o broker se cria com `await Aedes.createBroker()`; a 0.x e CommonJS.
// O import() dinamico funciona nas duas.
async function criaBroker() {
  const mod = await import('aedes');
  if (mod.Aedes && typeof mod.Aedes.createBroker === 'function') return mod.Aedes.createBroker();
  return mod.default();
}

async function iniciaMqtt() {
  if (!MQTT_HOST) {
    const aedes = await criaBroker();
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
    // temas visuais: public/estilo-<nome>.css (o nome nao aceita barras, entao nao sai da pasta public)
    const css = url.match(/^\/(estilo-[\w-]+\.css)$/);
    if (css) {
      const arq = path.join(BASE, 'public', css[1]);
      if (fs.existsSync(arq)) return enviar(res, 200, fs.readFileSync(arq), 'text/css; charset=utf-8');
    }
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
    if (url === '/relatorio') {
      return enviar(res, 200, fs.readFileSync(path.join(BASE, 'public', 'relatorio.html')), 'text/html; charset=utf-8');
    }
    if (url === '/api/relatorio') {
      const q = new URL(req.url, 'http://x').searchParams;
      const mid = q.get('maquina') || MAQUINA_PADRAO;
      const m = maquinas[mid];
      if (!m) return enviar(res, 404, 'maquina desconhecida');
      const agora = agoraS();
      const periodo = q.get('periodo') || 'hoje';
      const duracao = { '15m': 900, '1h': 3600, '4h': 14400, '8h': 28800, '24h': 86400 }[periodo];
      const de = duracao ? agora - duracao : new Date().setHours(0, 0, 0, 0) / 1000; // 'hoje' = desde 00:00
      const rel = relatorio.calcula({
        prod: relatorio.leCsv(PROD_CSV).filter((r) => r.maquina === mid),
        alarmes: relatorio.leCsv(ALARM_CSV).filter((a) => a.maquina === mid),
        agora, de,
        spm: m.cfg.spm, tol: m.cfg.tol, paradaS: m.cfg.parada_s,
        vivo: m.parcial(), paradaAtiva: m.parada,
      });
      rel.maquina = { id: mid, nome: m.cfg.nome };
      rel.periodoNome = periodo;
      rel.geradoEm = agora;
      if (q.get('formato') === 'csv') {
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="relatorio_${mid}_${periodo}.csv"`,
        });
        return res.end(relatorio.paraCsv(rel, m.cfg.nome));
      }
      return enviar(res, 200, JSON.stringify(rel), 'application/json');
    }
    if (url === '/sensores') return enviar(res, 200, fs.readFileSync(path.join(BASE, 'public', 'sensores.html')), 'text/html; charset=utf-8');
    if (url === '/api/maquinas') return enviaJson(res, 200, Object.values(snapshotTodas(agoraS()).maquinas));
    if (url === '/api/sensores') return enviaJson(res, 200, listaSensores(agoraS()));
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
      if (url === '/api/teste') {
        try {
          aplicaTeste(JSON.parse(body), agoraS());
          broadcast(snapshotTodas(agoraS()));
          return enviar(res, 200, 'OK');
        } catch (_) {
          return enviar(res, 400, 'teste invalido');
        }
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
      if (url === '/api/maquinas') return cadastraMaquina(res, body);
      if (url === '/api/maquinas/sensores') return atribuiSensor(res, body);
      return enviar(res, 404, 'nao encontrado');
    });
  }
  if (req.method === 'DELETE') {
    if (url === '/api/maquinas') return excluiMaquina(res, req.url);
    if (url === '/api/maquinas/sensores') return removeSensor(res, req.url);
    return enviar(res, 404, 'nao encontrado');
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
  // marca a partida no alarmes.csv: o relatorio usa isso para nao contar como parada o tempo com o servidor desligado
  gravaAlerta({ t: agoraS(), maquina: MAQUINA_PADRAO, nivel: 'info', tipo: 'servidor_iniciado', msg: 'Servidor iniciado' });
  iniciaMqtt().catch((e) => {
    mqttStatus = 'erro ao iniciar o broker';
    mqttUltimoErro = e.message;
    console.log(`[MQTT] ERRO ao iniciar o broker: ${e.message}`);
  });
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
  if (MODO_TESTE) console.log(`*** MODO TESTE: os dados ficam isolados em ${DADOS} (nao vao para a producao) ***`);
}

main();
