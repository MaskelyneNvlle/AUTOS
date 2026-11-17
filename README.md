# AUTOS: monitoramento da prensa de grampo (Airfix)

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `firmware/` | Firmware da PLC32 (ESP32). Dois modos no mesmo código: `plc32` (produção) e `escuta` (só escuta o RS485) |
| `servidor-node/` | Servidor Node.js: broker MQTT, dashboard, relatórios, cadastro de máquinas e testes |
| `scripts/` | Atalhos de bancada: `escuta.bat` (menu de gravação e monitor), `escuta.vbs` (duplo clique), `monitor_serial.ps1`, e `logs/` |
| `docs/` | Documentação: bancada, ligações, programa da Wecon, máquina, relatório |
| `platformio.ini` | Ambientes de compilação (`plc32` e `escuta`) |

## Uso rápido

- **Gravar e monitorar na bancada:** duplo clique em `scripts\escuta.vbs`.
- **Servidor:** `cd servidor-node` e `node server.js` (use `--teste` na bancada).

## Backup

Arquivos antigos (firmware de um sensor, pasta de escuta antiga e exemplos) foram movidos para `Documents\_backup_organizacao_2026-11-06`.
