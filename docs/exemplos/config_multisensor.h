#ifndef CONFIG_H
#define CONFIG_H

// EXEMPLO DE REFERENCIA (nao esta em uso): firmware com varios sensores. Compare com o seu config.h.

// Broker MQTT executado no computador servidor da Airfix.
const char* mqtt_server = "10.0.1.202";
const int mqtt_port = 1883;

// O heartbeat e da PLC inteira (nao de um sensor so).
const char* topico_heartbeat = "prensa/heartbeat";

// Um "sensor" = uma entrada optoacoplada da PLC32 + os 2 topicos MQTT dele.
struct SensorCfg {
  int pino;                  // GPIO do ESP32: borne I39 = 39, I34 = 34, I35 = 35
  bool ativoAlto;            // true: sensor acionado le HIGH; false: acionado le LOW (opto invertido)
  const char* topicoEstado;  // "1" acionado / "0" repouso (nao conta producao)
  const char* topicoBatida;  // "1" = uma batida (e isto que o servidor conta)
};

// Para adicionar outro sensor, acrescente UMA linha aqui.
// O servidor entende "prensa/sensorN/..." como a maquina "prensaN".
const SensorCfg SENSORES[] = {
  {34, true, "prensa/sensor1/estado", "prensa/sensor1/batida"},  // borne I34 -> prensa1
  {35, true, "prensa/sensor2/estado", "prensa/sensor2/batida"},  // borne I35 -> prensa2
};
const int NUM_SENSORES = sizeof(SENSORES) / sizeof(SENSORES[0]);

#endif
