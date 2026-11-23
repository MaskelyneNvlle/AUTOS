# AUTOS: monitoramento da prensa de grampo (Airfix)

Firmware ESP32 (PLC32) + servidor Node.js (broker MQTT, dashboard, relatórios). Documentação em português; manter assim (código, comentários, commits, docs).

## Estrutura
- `firmware/`: `main.cpp`, `config.h`, `escuta.h`. Um único código, dois ambientes PlatformIO.
- `servidor-node/`: `server.js` (broker Aedes + HTTP), `analise.js`, `relatorio.js`, `maquinas.json`, `public/`, scripts `teste_*.js`.
- `docs/`: bancada, ligações, programa Wecon, cadastro de máquinas e sensores.
- `scripts/`: atalhos de bancada (Windows).

## Comandos
- PlatformIO não está no PATH: usar `~/.platformio/penv/Scripts/pio.exe`.
  - Produção: `pio.exe run -e plc32`
  - Bancada (só escuta RS485): `pio.exe run -e escuta`
  - `build_dir = C:/pio_build/auto` de propósito (caminhos longos do OneDrive quebram o g++ do ESP32).
- Servidor: `cd servidor-node && node server.js` (`--teste` usa `dados_teste/`, sem tocar nos dados reais).
- Testes puros (rápidos, sem rede/hardware): `node teste_analise.js`, `node teste_relatorio.js`.
  Os demais (`teste_bancada.js`, `teste_mqtt_local.js`, `simular_batidas.js`) abrem portas ou precisam da bancada.

## Regras importantes
- Plataforma `espressif32@6.9.0` travada (ETH.begin mudou no core 3.x). Não atualizar sem testar.
- Modo `escuta` NUNCA transmite no RS485; não adicionar escrita nele.
- Nunca aplicar 24 V direto em GPIO: só pelos bornes optoacoplados.
- `producao.csv` e `alarmes.csv` são dados reais da empresa: não versionar, não editar.
- IP do broker em `firmware/config.h` (`mqtt_server`); não commitar credenciais.

## Automação neste repositório
`.claude/settings.json` roda `teste_analise.js` e `teste_relatorio.js` após editar qualquer `.js` de `servidor-node/` (hook em `.claude/hooks/pos-edicao.js`). Firmware não é compilado automaticamente (demora); rodar o build antes de commitar mudanças em `firmware/`.
