#pragma once
#include <Arduino.h>

// MODO ESCUTA (ativo quando MODO_ESCUTA = 1, ambiente "escuta" do platformio.ini).
// Somente recepcao no RS485: nunca transmite (DE/RE em LOW). Troca o formato a cada 15 s
// e mostra os bytes em hexadecimal, para descobrir o formato do barramento da IHM/CLP.
// Nao inicializa Ethernet nem MQTT (por isso os LEDs do RJ45 ficam apagados neste modo).

namespace escuta {

struct Modo {
  uint32_t baud;
  uint32_t formato;
  const char* nome;
};

const Modo MODOS[] = {
  {9600, SERIAL_7E1, "9600 7E1 (padrao Wecon/IHM)"},
  {9600, SERIAL_8N1, "9600 8N1 (Modbus RTU)"},
  {19200, SERIAL_8N1, "19200 8N1"},
  {9600, SERIAL_8E1, "9600 8E1"},
  {9600, SERIAL_7O1, "9600 7O1"},
};
const int NUM_MODOS = sizeof(MODOS) / sizeof(MODOS[0]);

const unsigned long TROCA_MS = 15000;      // tempo em cada formato
const unsigned long PAUSA_QUADRO_MS = 10;  // silencio que separa quadros
const unsigned long RELATORIO_MS = 5000;   // resumo periodico

int modoAtual = -1;
unsigned long inicioModo = 0;
unsigned long ultimoByte = 0;
unsigned long bytesModo = 0;
unsigned long bytesDesdeRelatorio = 0;
unsigned long ultimoRelatorio = 0;
bool linhaAberta = false;

void abreModo(int i, int rxPin, int txPin) {
  if (linhaAberta) {
    Serial.println();
    linhaAberta = false;
  }
  Serial2.end();
  Serial2.begin(MODOS[i].baud, MODOS[i].formato, rxPin, txPin);
  modoAtual = i;
  inicioModo = millis();
  bytesModo = 0;
  Serial.printf("\n=== MODO %d/%d: %s ===\n", i + 1, NUM_MODOS, MODOS[i].nome);
}

void setup(int rxPin, int txPin, int dirPin) {
  Serial.begin(115200);   // monitor USB (sem isso nada aparece)
  delay(200);
  pinMode(dirPin, OUTPUT);
  digitalWrite(dirPin, LOW);   // escuta apenas
  Serial.println("Escuta RS485 iniciada. Nada e transmitido.");
  abreModo(0, rxPin, txPin);
  ultimoRelatorio = millis();
}

void loop(int rxPin, int txPin) {
  const unsigned long agora = millis();

  if (agora - inicioModo >= TROCA_MS) {
    abreModo((modoAtual + 1) % NUM_MODOS, rxPin, txPin);
  }

  while (Serial2.available()) {
    const uint8_t b = Serial2.read();
    const unsigned long t = millis();
    if (linhaAberta && t - ultimoByte > PAUSA_QUADRO_MS) {
      Serial.println();
      linhaAberta = false;
    }
    Serial.printf("%02X ", b);
    linhaAberta = true;
    ultimoByte = t;
    bytesModo++;
    bytesDesdeRelatorio++;
  }

  if (linhaAberta && agora - ultimoByte > PAUSA_QUADRO_MS) {
    Serial.println();
    linhaAberta = false;
  }

  if (agora - ultimoRelatorio >= RELATORIO_MS) {
    Serial.printf("[%s] bytes nos ultimos %lu s: %lu (total neste modo: %lu)\n",
                  MODOS[modoAtual].nome, RELATORIO_MS / 1000, bytesDesdeRelatorio, bytesModo);
    bytesDesdeRelatorio = 0;
    ultimoRelatorio = agora;
  }

  delay(1);   // cede o processador (watchdog)
}

}  // namespace escuta
