// EXEMPLO (nao em uso): a PLC32 le um registro Modbus RTU da Wecon LX3V-2416MT-A (COM2, escravo 1)
// e publica o valor no MQTT. Requer a biblioteca "ModbusMaster" (Doc Walker) no platformio.ini:
//   lib_deps = knolleary/PubSubClient@^2.8, 4-20ma/ModbusMaster@^2.0.1
//
// Ligacao: PLC32 A+ -> Wecon 485+ (ou A), PLC32 B- -> Wecon 485- (ou B), Gcom -> GND do 485.
// Pinos do RS485 na PLC32 (manual Crescer): TX = GPIO16, RX = GPIO17, DIR = GPIO2.

#include <Arduino.h>
#include <ModbusMaster.h>

const int RS485_DIR = 2;        // HIGH = transmitir, LOW = receber (MAX485)
const int RS485_RX = 17;
const int RS485_TX = 16;
const uint8_t ESCRAVO_WECON = 1;    // D8121 da Wecon
const uint16_t REGISTRO_D0 = 0;     // Wecon: D0 = endereco Modbus 0 (faixa D0~D8255 -> 0~8255)
const unsigned long INTERVALO_LEITURA_MS = 1000;

ModbusMaster no;
unsigned long ultimaLeitura = 0;

void antesDeTransmitir() { digitalWrite(RS485_DIR, HIGH); }
void depoisDeTransmitir() { digitalWrite(RS485_DIR, LOW); }

void setup() {
  Serial.begin(115200);
  pinMode(RS485_DIR, OUTPUT);
  digitalWrite(RS485_DIR, LOW);
  // 9600 bps, 8 bits, sem paridade, 1 stop: igual a D8120 = 81H da Wecon
  Serial2.begin(9600, SERIAL_8N1, RS485_RX, RS485_TX);
  no.begin(ESCRAVO_WECON, Serial2);
  no.preTransmission(antesDeTransmitir);
  no.postTransmission(depoisDeTransmitir);
  Serial.println("Leitura Modbus RTU da Wecon iniciada.");
}

void loop() {
  if (millis() - ultimaLeitura >= INTERVALO_LEITURA_MS) {
    ultimaLeitura = millis();
    // Funcao 03 (ler registradores), 1 registro a partir de D0
    const uint8_t r = no.readHoldingRegisters(REGISTRO_D0, 1);
    if (r == no.ku8MBSuccess) {
      Serial.print("Wecon D0 = ");
      Serial.println(no.getResponseBuffer(0));
    } else {
      // 0xE2 = timeout (sem resposta): confira endereco, velocidade, A/B e o cabo
      Serial.print("Erro Modbus: 0x");
      Serial.println(r, HEX);
    }
  }
  delay(10);
}
