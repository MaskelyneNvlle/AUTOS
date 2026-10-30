#include <Arduino.h>
#include <WiFi.h>
#include <ETH.h>
#include <PubSubClient.h>
#include "config.h"

// EXEMPLO DE REFERENCIA (nao esta em uso): le varios sensores. Compare com o seu main.cpp.
// A diferenca para o firmware de 1 sensor: as variaveis soltas (estadoAtual, estadoAnterior,
// estadoPendente, batidasPendentes) viram UMA struct, e existe um vetor com uma por sensor.

WiFiClient espClient;
PubSubClient client(espClient);

static volatile bool eth_conectado = false;

// Estado de um sensor (o "cadastro" fixo dele fica em SENSORES[], no config.h)
struct SensorEstado {
  bool acionado = false;          // ultimo estado lido (ja considerando ativoAlto)
  bool estadoPendente = true;     // falta publicar o estado
  uint32_t batidasPendentes = 0;  // batidas ainda nao publicadas
};
SensorEstado sens[NUM_SENSORES];

unsigned long ultimaTentativaMQTT = 0;
unsigned long ultimoHeartbeat = 0;
const unsigned long INTERVALO_RECONEXAO = 5000;
const unsigned long INTERVALO_HEARTBEAT = 3000;

// true quando o sensor i esta acionado, respeitando a polaridade configurada
bool lerAcionado(int i) {
  const int nivel = digitalRead(SENSORES[i].pino);
  return SENSORES[i].ativoAlto ? (nivel == HIGH) : (nivel == LOW);
}

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
    // Reenvia somente o estado atual de CADA sensor; isso NAO representa uma nova batida.
    for (int i = 0; i < NUM_SENSORES; i++) sens[i].estadoPendente = true;
  } else {
    Serial.print("Falha MQTT. Estado PubSubClient: ");
    Serial.println(client.state());
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);

  // Inicializar com o nivel atual evita contar como batida um sensor que ja
  // esteja acionado ao ligar/reconectar a placa.
  for (int i = 0; i < NUM_SENSORES; i++) {
    pinMode(SENSORES[i].pino, INPUT);
    sens[i].acionado = lerAcionado(i);
    sens[i].estadoPendente = true;
    Serial.printf("Sensor %d (GPIO%d) estado inicial: %s\n", i + 1, SENSORES[i].pino,
                  sens[i].acionado ? "ACIONADO" : "REPOUSO");
  }

  client.setServer(mqtt_server, mqtt_port);
  client.setSocketTimeout(2);
  client.setKeepAlive(30);
  setup_ethernet();
  Serial.println("PLC32 pronta para monitoramento.");
}

void loop() {
  // 1) Ler todos os sensores e detectar mudancas
  for (int i = 0; i < NUM_SENSORES; i++) {
    const bool agoraAcionado = lerAcionado(i);
    if (agoraAcionado != sens[i].acionado) {
      sens[i].acionado = agoraAcionado;
      sens[i].estadoPendente = true;
      Serial.printf("Sensor %d (GPIO%d): %s\n", i + 1, SENSORES[i].pino,
                    agoraAcionado ? "ACIONADO" : "REPOUSO");

      // Uma batida e somente a transicao para ACIONADO. Alterar o estado ou
      // reconectar ao MQTT nao gera batida. Eventos aguardam reconexao.
      if (agoraAcionado && sens[i].batidasPendentes < 1000) {
        ++sens[i].batidasPendentes;
        Serial.printf("Sensor %d: batida pendente %u\n", i + 1, (unsigned)sens[i].batidasPendentes);
      }
    }
  }

  // 2) Manter a conexao
  if (!eth_conectado) {
    if (client.connected()) client.disconnect();
  } else {
    tentarMQTT();
  }

  // 3) Publicar o que estiver pendente
  if (client.connected()) {
    client.loop();

    for (int i = 0; i < NUM_SENSORES; i++) {
      // Estado: serve para a dashboard, nunca incrementa producao.
      if (sens[i].estadoPendente) {
        const char* estado = sens[i].acionado ? "1" : "0";
        if (client.publish(SENSORES[i].topicoEstado, estado)) {
          Serial.printf("Sensor %d: estado publicado em %s: %s\n", i + 1, SENSORES[i].topicoEstado, estado);
          sens[i].estadoPendente = false;
        } else {
          Serial.printf("Sensor %d: falha ao publicar estado.\n", i + 1);
        }
      }

      // Evento de batida separado: o servidor conta apenas este topico.
      if (sens[i].batidasPendentes > 0 && client.publish(SENSORES[i].topicoBatida, "1")) {
        --sens[i].batidasPendentes;
      }
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
