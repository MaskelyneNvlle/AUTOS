#include <Arduino.h>

// FIRMWARE DE ESCUTA (somente recepcao) para o barramento RS485 de uma maquina.
// Nunca transmite: o pino DE/RE (GPIO2) fica em LOW, e o MAX485 so recebe.
// Troca de formato a cada 15 s (velocidade e paridade) e mostra os bytes em hexadecimal,
// para descobrir qual formato a IHM e o CLP usam.
// Monitor serial: 115200 baud.

const int RS485_RX = 17;   // mesmo pino usado pelo firmware principal (Crescer)
const int RS485_TX = 16;
const int RS485_DIR = 2;   // LOW = so receber

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

const unsigned long TROCA_MS = 15000;     // tempo em cada formato
const unsigned long PAUSA_QUADRO_MS = 10; // silencio que separa quadros (folga acima dos 3,5 caracteres)
const unsigned long RELATORIO_MS = 5000;  // resumo periodico

int modoAtual = -1;
unsigned long inicioModo = 0;
unsigned long ultimoByte = 0;
unsigned long bytesModo = 0;
unsigned long bytesDesdeRelatorio = 0;
unsigned long ultimoRelatorio = 0;
bool linhaAberta = false;

void abreModo(int i) {
  if (linhaAberta) {
    Serial.println();
    linhaAberta = false;
  }
  Serial2.end();
  Serial2.begin(MODOS[i].baud, MODOS[i].formato, RS485_RX, RS485_TX);
  modoAtual = i;
  inicioModo = millis();
  bytesModo = 0;
  Serial.printf("\n=== MODO %d/%d: %s ===\n", i + 1, NUM_MODOS, MODOS[i].nome);
}

void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(RS485_DIR, OUTPUT);
  digitalWrite(RS485_DIR, LOW);   // escuta apenas
  Serial.println("Escuta RS485 iniciada. Nada e transmitido.");
  abreModo(0);
  ultimoRelatorio = millis();
}

void loop() {
  const unsigned long agora = millis();

  // troca de formato
  if (agora - inicioModo >= TROCA_MS) {
    abreModo((modoAtual + 1) % NUM_MODOS);
  }

  // bytes recebidos: cada byte em hexadecimal; pausa longa separa quadros
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

  // fecha a linha quando o barramento fica em silencio
  if (linhaAberta && agora - ultimoByte > PAUSA_QUADRO_MS) {
    Serial.println();
    linhaAberta = false;
  }

  // resumo periodico
  if (agora - ultimoRelatorio >= RELATORIO_MS) {
    Serial.printf("[%s] bytes nos ultimos %lu s: %lu (total neste modo: %lu)\n",
                  MODOS[modoAtual].nome, RELATORIO_MS / 1000, bytesDesdeRelatorio, bytesModo);
    bytesDesdeRelatorio = 0;
    ultimoRelatorio = agora;
  }

  delay(1);   // cede o processador (watchdog)
}
