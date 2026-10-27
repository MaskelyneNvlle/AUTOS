'use strict';
// Analise das batidas de UMA maquina (ritmo programado por maquina).
// Porte direto de analise.py. O tempo (segundos) e sempre passado de fora.
//
//  parada          : sem batidas por mais de `parada_s` depois de estar rodando
//  batida_perdida  : intervalo ~2x (ou mais) o normal
//  batida_dupla    : intervalo muito curto -> duplo disparo / ruido do sensor
//  ritmo_baixo/alto: batidas/min fora da faixa programada (spm +- tol %)
//  instavel        : intervalos irregulares
//  falhas_seguidas : muitas batidas perdidas em 60 s

const CFG_PADRAO = {
  nome: 'Prensa',
  modelo: '',
  spm: 155, // batidas/min programadas
  tol: 10, // tolerancia do ritmo, em %
  parada_s: 3.0, // sem batida por X s = maquina parada
  falhas_limite: 3, // batidas perdidas em 60 s que viram FALHA
  instab: 25, // variacao (%) entre batidas que vira "instavel"
};

const JANELA = 20; // n de intervalos usados na estatistica
const MIN_AMOSTRAS = 8; // intervalos minimos antes de julgar o ritmo
const CONFIRMA = 3; // ticks (s) seguidos para ligar/desligar um alerta de ritmo

const media = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const mediana = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const pstdev = (a) => {
  const m = media(a);
  return Math.sqrt(media(a.map((x) => (x - m) ** 2)));
};
const pushMax = (arr, v, max) => {
  arr.push(v);
  if (arr.length > max) arr.shift();
};
const r1 = (x) => Math.round(x * 10) / 10;

class Maquina {
  constructor(mid, cfg) {
    this.id = mid;
    this.cfg = { ...CFG_PADRAO, ...(cfg || {}) };
    this.reset();
  }

  reset() {
    this.total = 0;
    this.perdidas = 0;
    this.duplas = 0;
    this.hits = []; // instantes das batidas validas (max 3000)
    this.intervalos = []; // max JANELA
    this.ultimo = 0.0;
    this.inicioRun = 0.0;
    this.runHits = 0;
    this.parada = false;
    this.ativos = {}; // alerta -> [nivel, mensagem]
    this._cont = {};
    this.falhas = [];
    this.alertas = []; // mais recente primeiro (max 100)
    this.spmHist = []; // [t, spm] 1 amostra/s (max 600)
    this._min = null;
    this._m = { batidas: 0, perdidas: 0, duplas: 0 };
    this.ruidoPlaca = 0;
    this._dupPend = 0;
    this._dupAlerta = 0.0;
  }

  config(novo) {
    for (const [k, v] of Object.entries(novo)) {
      if (k === 'nome' || k === 'modelo') {
        this.cfg[k] = String(v).slice(0, 80);
      } else if (k in CFG_PADRAO) {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new TypeError('valor invalido para ' + k);
        this.cfg[k] = k === 'parada_s' ? n : Math.trunc(n);
      }
    }
  }

  _alerta(t, tipo, nivel, msg) {
    const a = { t, maquina: this.id, tipo, nivel, msg };
    this.alertas.unshift(a);
    if (this.alertas.length > 100) this.alertas.pop();
    return a;
  }

  // Intervalo de referencia: mediana recente (ou o programado, se faltar historico)
  _ref() {
    if (this.intervalos.length >= MIN_AMOSTRAS) return [mediana(this.intervalos), true];
    return [60.0 / this.cfg.spm, false];
  }

  spmAtual() {
    if (this.intervalos.length < 3 || this.parada) return 0.0;
    return 60.0 / mediana(this.intervalos);
  }

  variacao() {
    if (this.intervalos.length < MIN_AMOSTRAS) return 0.0;
    const m = media(this.intervalos);
    return m ? (100.0 * pstdev(this.intervalos)) / m : 0.0;
  }

  // Devolve a linha de producao do minuto que acabou (ou null)
  _fechaMinuto(t) {
    const minuto = Math.floor(t / 60);
    let row = null;
    if (
      this._min !== null &&
      minuto > this._min &&
      (this._m.batidas || this._m.perdidas || this._m.duplas)
    ) {
      row = { minuto: this._min * 60, maquina: this.id, ...this._m, spm_programado: this.cfg.spm };
      this._m = { batidas: 0, perdidas: 0, duplas: 0 };
    }
    if (this._min === null || minuto > this._min) this._min = minuto;
    return row;
  }

  // Registra uma batida em `t` (segundos). Retorna [flag, alertas, linhaMinuto]
  batida(t) {
    const alertas = [];
    const linha = this._fechaMinuto(t);
    if (this.ultimo && t < this.ultimo) return ['fora_de_ordem', alertas, linha];

    const dt = this.ultimo ? t - this.ultimo : null;
    let flag = null;
    // batida durante "parada" (lote da placa pode atrasar ~1 s): e retomada
    const novaRun = dt === null || dt > this.cfg.parada_s || this.parada;

    if (novaRun) {
      if (this.parada && dt !== null) {
        alertas.push(this._alerta(t, 'retomada', 'info', `Máquina voltou a bater após ${dt.toFixed(0)} s parada`));
      }
      this.parada = false;
      delete this.ativos.parada;
      this.intervalos = [];
      this.inicioRun = t;
      this.runHits = 0;
    } else {
      const [ref, confiavel] = this._ref();
      let piso = (0.5 * 60.0) / this.cfg.spm; // nunca mais rapido que 2x o programado
      if (confiavel) piso = Math.max(piso, 0.5 * ref);
      if (dt < piso) {
        // duplo disparo / ruido: nao conta e mantem a referencia anterior
        this.duplas += 1;
        this._m.duplas += 1;
        this._dupPend += 1;
        if (t - this._dupAlerta >= 10) {
          // agrupa: no max. 1 alerta a cada 10 s
          alertas.push(
            this._alerta(
              t,
              'batida_dupla',
              'atencao',
              `${this._dupPend} pulso(s) fora de ritmo (ex.: ${(dt * 1000).toFixed(0)} ms após a anterior) - ruído/repique do sensor?`
            )
          );
          this._dupAlerta = t;
          this._dupPend = 0;
        }
        return ['dupla', alertas, linha];
      }
      if (confiavel && dt > 1.6 * ref) {
        const pul = Math.max(1, Math.round(dt / ref) - 1);
        this.perdidas += pul;
        this._m.perdidas += pul;
        for (let i = 0; i < pul; i++) this.falhas.push(t);
        flag = 'perdida';
        alertas.push(
          this._alerta(
            t,
            'batida_perdida',
            'atencao',
            `${pul} batida(s) perdida(s): intervalo ${dt.toFixed(2)} s (normal ${ref.toFixed(2)} s)`
          )
        );
      } else {
        pushMax(this.intervalos, dt, JANELA);
      }
    }

    this.total += 1;
    this._m.batidas += 1;
    this.runHits += 1;
    pushMax(this.hits, t, 3000);
    this.ultimo = t;
    return [flag, alertas, linha];
  }

  // Liga/desliga um alerta de estado com confirmacao (histerese)
  _cond(t, nome, ligado, nivel, msg, alertas) {
    const ativo = nome in this.ativos;
    if (ligado !== ativo) {
      this._cont[nome] = (this._cont[nome] || 0) + 1;
      if (this._cont[nome] >= CONFIRMA) {
        this._cont[nome] = 0;
        if (ligado) {
          this.ativos[nome] = [nivel, msg];
          alertas.push(this._alerta(t, nome, nivel, msg));
        } else {
          delete this.ativos[nome];
          alertas.push(this._alerta(t, nome + '_ok', 'info', `Normalizou: ${msg}`));
        }
      }
    } else {
      this._cont[nome] = 0;
    }
  }

  // Chamar 1x por segundo. Retorna [alertas, linhaMinuto]
  tick(agora) {
    const alertas = [];
    const linha = this._fechaMinuto(agora);
    const cfg = this.cfg;
    const ocioso = !this.ultimo || agora - this.ultimo > cfg.parada_s;

    if (ocioso && this.ultimo && !this.parada && this.runHits >= 10) {
      this.parada = true;
      this.ativos.parada = ['falha', 'Máquina parada'];
      alertas.push(
        this._alerta(agora, 'parada', 'falha', `Máquina PAROU: sem batida há ${(agora - this.ultimo).toFixed(0)} s`)
      );
    }
    if (ocioso) {
      for (const n of ['ritmo_baixo', 'ritmo_alto', 'instavel']) {
        delete this.ativos[n];
        delete this._cont[n];
      }
    }

    while (this.falhas.length && agora - this.falhas[0] > 60) this.falhas.shift();
    this._cond(
      agora,
      'falhas_seguidas',
      this.falhas.length >= cfg.falhas_limite,
      'falha',
      `${this.falhas.length} batidas perdidas em 60 s`,
      alertas
    );

    const spm = this.spmAtual();
    const julga = !ocioso && this.intervalos.length >= MIN_AMOSTRAS && agora - this.inicioRun >= 8;
    if (julga) {
      const baixo = cfg.spm * (1 - cfg.tol / 100);
      const alto = cfg.spm * (1 + cfg.tol / 100);
      this._cond(agora, 'ritmo_baixo', spm < baixo, 'atencao', `Ritmo baixo: ${spm.toFixed(0)}/min (programado ${cfg.spm}/min)`, alertas);
      this._cond(agora, 'ritmo_alto', spm > alto, 'atencao', `Ritmo alto: ${spm.toFixed(0)}/min (programado ${cfg.spm}/min)`, alertas);
      const v = this.variacao();
      this._cond(agora, 'instavel', v > cfg.instab, 'atencao', `Ritmo instável: variação ${v.toFixed(0)}% entre batidas`, alertas);
    }

    pushMax(this.spmHist, [agora, r1(spm)], 600);
    return [alertas, linha];
  }

  status(agora) {
    if (this.parada) return 'parada';
    if (!this.ultimo || agora - this.ultimo > this.cfg.parada_s) return 'ociosa';
    const niveis = Object.values(this.ativos).map((v) => v[0]);
    if (niveis.includes('falha')) return 'falha';
    if (niveis.length) return 'atencao';
    if (this.intervalos.length < MIN_AMOSTRAS) return 'medindo';
    return 'ok';
  }

  snapshot(agora) {
    return {
      id: this.id,
      cfg: this.cfg,
      status: this.status(agora),
      spm: r1(this.spmAtual()),
      variacao: r1(this.variacao()),
      total: this.total,
      perdidas: this.perdidas,
      duplas: this.duplas,
      ruido: this.ruidoPlaca,
      ultimos_60s: this.hits.filter((h) => agora - h <= 60).length,
      ciclo: this.intervalos.length ? Math.round(this.intervalos[this.intervalos.length - 1] * 1000) / 1000 : null,
      ultimo_ha: this.ultimo ? r1(agora - this.ultimo) : null,
      ativos: Object.values(this.ativos).map((v) => v[1]),
    };
  }
}

module.exports = { Maquina, CFG_PADRAO };
