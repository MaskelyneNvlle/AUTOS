#include <Arduino.h>
#include <WiFi.h>
#include <ETH.h>
#include <PubSubClient.h>
#include <ModbusMaster.h>
#include "config.h"

// Firmware da PLC32: sensores optoacoplados (I39/I34/I35) + leitura Modbus RTU da Wecon (COM2).
// Cada sensor tem seu estado (nivel) e, se configurado, sua batida (transicao para ACIONADO).
// A leitura Modbus roda em outra tarefa do ESP32: assim o bloqueio de uma resposta lenta nao
// atrasa a deteccao dos sensores (um pulso curto poderia ser perdido).

WiFiClient espClient;
PubSubClient client(espClient);

static volatile bool eth_conectado = false;

struct SensorEstado {
  bool acionado = false;          // ultimo nivel lido (ja considerando ativoAlto)
  bool estadoPendente = true;     // falta publicar o estado
  uint32_t batidasPendentes = 0;  // batidas ainda nao publicadas
};
SensorEstado sens[NUM_SENSORES];

unsigned long ultimaTentativaMQTT = 0;
unsigned long ultimoHeartbeat = 0;
const unsigned long INTERVALO_RECONEXAO = 5000;
const unsigned long INTERVALO_HEARTBEAT = 3000;

// RTU (Modbus) - escrito pela tarefa, lido pelo loop
ModbusMaster no;
volatile bool rtuOk = false;
volatile uint16_t rtuValor = 0;
volatile uint32_t rtuErros = 0;
uint16_t rtuPublicado = 0xFFFF;   // ultimo valor publicado (0xFFFF = nunca)
bool rtuPublicadoAlgumaVez = false;

// true quando o sensor i esta acionado, respeitando a polaridade configurada
bool lerAcionado(int i) {
  const int nivel = digitalRead(SENSORES[i].pino);
  return SENSORES[i].ativoAlto ? (nivel == HIGH) : (nivel == LOW);
}

void antesDeTransmitir() { digitalWrite(RTU_DIR, HIGH); }
void depoisDeTransmitir() { digitalWrite(RTU_DIR, LOW); }

void tarefaModbus(void*) {
  for (;;) {
    const uint8_t r = no.readHoldingRegisters(RTU_REGISTRO, 1);  // funcao 03
    if (r == no.ku8MBSuccess) {
      rtuValor = no.getResponseBuffer(0);
      rtuOk = true;
    } else {
      rtuOk = false;
      rtuErros++;
    }
    vTaskDelay(pdMS_TO_TICKS(RTU_INTERVALO_MS));
  }
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
    // Reenvia o estado atual de cada sensor; isso NAO representa uma nova batida.
    for (int i = 0; i < NUM_SENSORES; i++) sens[i].estadoPendente = true;
    rtuPublicadoAlgumaVez = false;   // reenvia o contador ao reconectar
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

  // RS485 (COM2 da Wecon, Modbus RTU mestre)
  pinMode(RTU_DIR, OUTPUT);
  digitalWrite(RTU_DIR, LOW);
  Serial2.begin(RTU_BAUD, SERIAL_8N1, RTU_RX, RTU_TX);
  no.begin(RTU_ESTACAO, Serial2);
  no.preTransmission(antesDeTransmitir);
  no.postTransmission(depoisDeTransmitir);
  xTaskCreatePinnedToCore(tarefaModbus, "modbus", 4096, nullptr, 1, nullptr, 0);

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

      // Batida = transicao para ACIONADO, so nos sensores que publicam batida.
      if (agoraAcionado && SENSORES[i].publicaBatida && sens[i].batidasPendentes < 1000) {
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
          sens[i].estadoPendente = false;
        }
      }
      // Batida: so para sensores configurados com publicaBatida.
      if (SENSORES[i].publicaBatida && sens[i].batidasPendentes > 0 &&
          client.publish(SENSORES[i].topicoBatida, "1")) {
        --sens[i].batidasPendentes;
      }
    }

    // Contador da Wecon (D0): publica somente quando o valor muda
    if (rtuOk && (!rtuPublicadoAlgumaVez || rtuValor != rtuPublicado)) {
      const uint16_t v = rtuValor;
      if (client.publish(topico_contador, String(v).c_str())) {
        rtuPublicado = v;
        rtuPublicadoAlgumaVez = true;
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
  delay(5);
}
