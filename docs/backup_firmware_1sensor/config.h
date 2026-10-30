#ifndef CONFIG_H
#define CONFIG_H

// Broker MQTT executado no computador servidor da Airfix.
const char* mqtt_server = "10.0.1.202";
const int mqtt_port = 1883;

// Topicos separados: estado nao conta producao; batida conta uma ocorrencia.
const char* topico_estado = "prensa/sensor1/estado";
const char* topico_batida = "prensa/sensor1/batida";
const char* topico_heartbeat = "prensa/heartbeat";

// CONFIRMAR no manual/esquema da PLC32 qual GPIO corresponde ao sensor.
// GPIO34 e entrada-only e nao possui pull-up/pull-down interno no ESP32.
// NUNCA aplique 24 V diretamente a um GPIO; use interface eletrica adequada.
const int pinoSensor = 34;

#endif
