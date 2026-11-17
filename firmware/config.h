#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>   // tipos uint8_t/uint16_t e o restante da API do Arduino

// Modo do firmware. 0 = producao (MQTT + sensores + RTU). 1 = escuta RS485 (so recebe).
// Definido pelo ambiente do platformio.ini (build_flags = -DMODO_ESCUTA=1); padrao 0.
#ifndef MODO_ESCUTA
#define MODO_ESCUTA 0
#endif

// ---------------------------------------------------------------- rede e MQTT
// Broker MQTT executado no computador servidor da Airfix.
const char* mqtt_server = "10.0.1.202";
const int mqtt_port = 1883;
const char* topico_heartbeat = "prensa/heartbeat";   // a PLC inteira: nao conta producao

// ---------------------------------------------------------------- sensores (entradas optoacopladas)
// Borne I39 = GPIO39, I34 = GPIO34, I35 = GPIO35. Entradas sem pull-up interno no ESP32.
// NUNCA aplique 24 V diretamente a um GPIO: use sempre o borne optoacoplado.
//
// Campos:
//   pino           : GPIO do borne
//   ativoAlto      : true = acionado le HIGH; false = acionado le LOW
//   topicoEstado   : "1"/"0" (nivel do sinal) - nunca conta producao
//   publicaBatida  : true = publica "1" em topicoBatida a cada transicao para ACIONADO
//   topicoBatida   : so usado se publicaBatida = true
// O servidor decide a maquina e o papel (batida/estado) de cada sensor pela pagina /sensores.
struct SensorCfg {
  int pino;
  bool ativoAlto;
  const char* topicoEstado;
  bool publicaBatida;
  const char* topicoBatida;
};

const SensorCfg SENSORES[] = {
  {34, true, "prensa/sensor1/estado", true,  "prensa/sensor1/batida"},  // I34: sensor de batida
  {35, true, "prensa/sensor2/estado", false, nullptr},                  // I35: fim de curso (so estado)
};
const int NUM_SENSORES = sizeof(SENSORES) / sizeof(SENSORES[0]);

// ---------------------------------------------------------------- RS485 (COM2 da Wecon, Modbus RTU)
// Pinos do RS485 na PLC32 (manual Crescer): TX = GPIO16, RX = GPIO17, DIR = GPIO2.
const int RTU_RX = 17;
const int RTU_TX = 16;
const int RTU_DIR = 2;
// Padroes de comunicacao da Wecon LX3V (D8120 = 81H): 9600 bps, 8 bits, sem paridade, 1 stop.
const unsigned long RTU_BAUD = 9600;
const uint8_t RTU_ESTACAO = 1;        // D8121 da Wecon
const uint16_t RTU_REGISTRO = 0;      // D0 da Wecon (endereco Modbus 0)
const unsigned long RTU_INTERVALO_MS = 1000;
const char* topico_contador = "prensa/plc/contador";   // valor de D0 publicado quando muda

#endif
