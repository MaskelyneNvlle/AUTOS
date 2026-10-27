#include <Arduino.h>
#include <WiFi.h>
#include <ETH.h>
#include <PubSubClient.h>
#include "config.h"

WiFiClient espClient;
PubSubClient client(espClient);

static volatile bool eth_conectado = false;
int estadoAtual = LOW;
int estadoAnterior = LOW;
bool estadoPendente = true;
bool estadoInicializado = false;
uint32_t batidasPendentes = 0;

unsigned long ultimaTentativaMQTT = 0;
unsigned long ultimoHeartbeat = 0;
const unsigned long INTERVALO_RECONEXAO = 5000;
const unsigned long INTERVALO_HEARTBEAT = 3000;

void WiFiEvent(WiFiEvent_t event) {
  switch (event) {
    case ARDUINO_EVENT_ETH_START:
      Serial.println("Ethernet iniciada.");
      ETH.setHostname("plc32-prensa");
      break;
    case ARDUINO_EVENT_ETH_CONNECTED:
      Serial.println("Link fisico Ethernet conectado.");
      break;
    case ARDUINO_EVENT_ETH_GOT_IP:
      Serial.print("IP recebido pela Ethernet: ");
      Serial.println(ETH.localIP());
      eth_conectado = true;
      break;
    case ARDUINO_EVENT_ETH_DISCONNECTED:
      Serial.println("Link Ethernet desconectado.");
      eth_conectado = false;
      break;
    case ARDUINO_EVENT_ETH_STOP:
      Serial.println("Interface Ethernet parada.");
      eth_conectado = false;
      break;
    default:
      break;
  }
}

void setup_ethernet() {
  WiFi.onEvent(WiFiEvent);
  // Pinagem conforme o exemplo oficial da PLC32/CRESCER testado na placa.
  if (!ETH.begin(1, 32, 14, 4, ETH_PHY_LAN8720)) {
    Serial.println("Falha ao iniciar Ethernet. Verifique a placa/pinagem.");
  }
}

void tentarMQTT() {
  if (!eth_conectado || client.connected()) return;

  const unsigned long agora = millis();
  if (agora - ultimaTentativaMQTT < INTERVALO_RECONEXAO) return;
  ultimaTentativaMQTT = agora;

  Serial.print("Tentando MQTT em ");
  Serial.print(mqtt_server);
  Serial.print(":");
  Serial.println(mqtt_port);

  String clientId = "PLC32-Prensa-";
  clientId += String((uint32_t)ESP.getEfuseMac(), HEX);

  if (client.connect(clientId.c_str())) {
    Serial.println("Conectado ao broker MQTT.");
    // Reenvia somente o estado atual; isso NÃO representa uma nova batida.
    estadoPendente = true;
  } else {
    Serial.print("Falha MQTT. Estado PubSubClient: ");
    Serial.println(client.state());
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(pinoSensor, INPUT);

  // Inicializar com o nível atual evita contar como batida um sensor que já
  // esteja HIGH ao ligar/reconectar a placa.
  estadoAtual = digitalRead(pinoSensor);
  estadoAnterior = estadoAtual;
  estadoInicializado = true;
  estadoPendente = true;
  Serial.print("Estado inicial do sensor: ");
  Serial.println(estadoAtual == HIGH ? "ACIONADO" : "REPOUSO");

  client.setServer(mqtt_server, mqtt_port);
  client.setSocketTimeout(2);
  client.setKeepAlive(30);
  setup_ethernet();
  Serial.println("PLC32 pronta para monitoramento.");
}

void loop() {
  const int leitura = digitalRead(pinoSensor);
  if (!estadoInicializado) {
    estadoAtual = leitura;
    estadoAnterior = leitura;
    estadoInicializado = true;
    estadoPendente = true;
  } else if (leitura != estadoAnterior) {
    estadoAnterior = leitura;
    estadoAtual = leitura;
    estadoPendente = true;
    Serial.print("Mudanca do sensor: ");
    Serial.println(estadoAtual == HIGH ? "ACIONADO" : "REPOUSO");

    // Uma batida é somente a borda de subida (LOW -> HIGH). Alterar o estado
    // ou reconectar ao MQTT não gera batida. Eventos aguardam reconexão.
    if (estadoAtual == HIGH && batidasPendentes < 1000) {
      ++batidasPendentes;
      Serial.print("Evento de batida pendente: ");
      Serial.println(batidasPendentes);
    }
  }

  if (!eth_conectado) {
    if (client.connected()) client.disconnect();
  } else {
    tentarMQTT();
  }

  if (client.connected()) {
    client.loop();

    // Estado do sensor: serve para a dashboard, nunca incrementa produção.
    if (estadoPendente) {
      const char* estado = estadoAtual == HIGH ? "1" : "0";
      if (client.publish(topico_estado, estado)) {
        Serial.print("Estado publicado em ");
        Serial.print(topico_estado);
        Serial.print(": ");
        Serial.println(estado);
        estadoPendente = false;
      } else {
        Serial.println("Falha ao publicar estado do sensor.");
      }
    }

    // Evento de batida separado: o servidor conta apenas este tópico.
    if (batidasPendentes > 0 && client.publish(topico_batida, "1")) {
      --batidasPendentes;
      Serial.print("Batida publicada. Pendentes: ");
      Serial.println(batidasPendentes);
    }

    const unsigned long agora = millis();
    if (agora - ultimoHeartbeat >= INTERVALO_HEARTBEAT) {
      if (client.publish(topico_heartbeat, "ping")) {
        ultimoHeartbeat = agora;
      } else {
        Serial.println("Falha ao publicar heartbeat.");
      }
    }
  }
  delay(10);
}
