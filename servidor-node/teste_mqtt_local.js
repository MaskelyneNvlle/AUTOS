'use strict';
// Teste ponta a ponta SEM a PLC: simula a placa publicando no broker do servidor.
// 1) em outro terminal: node server.js --mqtt-port 1884 --port 8086 --board-port 8087
// 2) node teste_mqtt_local.js            (usa 1884 / 8086 por padrao)
const assert = require('assert');
const mqtt = require('mqtt');

const MQTT_PORT = process.argv[2] || 1884;
const HTTP_PORT = process.argv[3] || 8086;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const estado = async () => (await (await fetch(`http://localhost:${HTTP_PORT}/api/state`)).json()).maquinas.prensa1;

(async () => {
  const c = mqtt.connect(`mqtt://localhost:${MQTT_PORT}`, { clientId: 'teste-plc' });
  await new Promise((ok) => c.on('connect', ok));
  await fetch(`http://localhost:${HTTP_PORT}/reset`, { method: 'POST', body: '{}' });

  c.publish('prensa/heartbeat', 'ping');
  c.publish('prensa/sensor1/estado', '1');
  c.publish('prensa/teste', 'ping');
  await espera(300);
  let m = await estado();
  assert.strictEqual(m.total, 0, 'estado/heartbeat/teste nao podem contar producao');
  assert.strictEqual(m.sensor_estado, '1');
  console.log('ok: estado, heartbeat e teste nao contam; sensor_estado =', m.sensor_estado);

  for (let i = 0; i < 5; i++) {
    c.publish('prensa/sensor1/batida', '1');
    await espera(390);
  }
  c.publish('prensa/sensor1', '1'); // legado conta tambem
  await espera(300);
  m = await estado();
  assert.strictEqual(m.total, 6, 'esperado 6 batidas, veio ' + m.total);
  console.log('ok: 5 batidas + 1 legada = total', m.total, '| status:', m.status);

  const h = await (await fetch(`http://localhost:${HTTP_PORT}/api/health`)).json();
  assert.strictEqual(h.placaOnline, true);
  console.log('ok: health', JSON.stringify(h));
  c.end();
  console.log('\nTudo certo.');
  process.exit(0);
})().catch((e) => {
  console.error('FALHOU:', e.message);
  process.exit(1);
});
